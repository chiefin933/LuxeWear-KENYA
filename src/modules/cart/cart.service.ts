import { prisma } from '../../db/prisma.js';
import { NotFoundError, BadRequestError, ConflictError } from '../../errors/app.error.js';
import { UpsertCartItemInput } from './cart.schemas.js';
import { PricingService } from '../catalog/pricing.service.js';
import { randomUUID } from 'crypto';

/**
 * Resolve the cart for a request.
 * - If cartToken is provided and the cart exists, return it.
 * - If cartToken is provided but not found, throw NotFoundError (CART_NOT_FOUND).
 * - If no token provided (fresh guest), create a brand-new cart and return both cart + new token.
 */
export class CartService {
  // ─── Internal Helpers ─────────────────────────────────────────────────────

  private static async resolveCart(cartToken: string | undefined) {
    if (cartToken) {
      const existing = await prisma.cart.findUnique({
        where: { sessionToken: cartToken },
        include: { items: true },
      });
      if (existing) {
        return { cart: existing, token: cartToken, isNew: false };
      }
      // Stale or invalid cart token provided
      throw new NotFoundError('Cart not found. It may have expired.');
    }

    // No cart token provided — create a fresh guest cart
    const newToken = randomUUID();
    const cart = await prisma.cart.create({
      data: { sessionToken: newToken },
      include: { items: true },
    });
    return { cart, token: newToken, isNew: true };
  }

  private static async buildCartView(cartId: string) {
    const cart = await prisma.cart.findUnique({
      where: { id: cartId },
      include: {
        items: {
          include: {
            variant: {
              include: {
                product: {
                  select: {
                    id: true,
                    name: true,
                    slug: true,
                    basePriceKes: true,
                    salePriceKes: true,
                    images: {
                      where: { isThumbnail: true },
                      take: 1,
                      select: { url: true, altText: true },
                    },
                  },
                },
                inventory: { select: { stockQuantity: true, safetyStockThreshold: true } },
              },
            },
          },
        },
      },
    });

    if (!cart) return null;

    const items = cart.items.map((item) => {
      const v = item.variant;
      const p = v.product;
      const unitPriceDecimal = PricingService.calculateVariantUnitPrice(v);
      const lineTotalDecimal = unitPriceDecimal.mul(item.quantity);

      // Badge — never expose raw stock quantity to the browser
      const qty = v.inventory?.stockQuantity ?? 0;
      const threshold = v.inventory?.safetyStockThreshold ?? 3;
      const stockStatus: 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK' =
        qty > threshold ? 'IN_STOCK' : qty > 0 ? 'LOW_STOCK' : 'OUT_OF_STOCK';

      return {
        cartItemId: item.id,
        variantId: v.id,
        sku: v.sku,
        productId: p.id,
        productName: p.name,
        productSlug: p.slug,
        size: v.size,
        color: v.color,
        thumbnailUrl: p.images[0]?.url ?? null,
        unitPriceKes: unitPriceDecimal.toNumber(),
        quantity: item.quantity,
        lineTotalKes: lineTotalDecimal.toNumber(),
        stockStatus,
        inStock: qty > 0,
      };
    });

    const subtotalKes = items.reduce((acc, i) => acc + i.lineTotalKes, 0);
    const itemCount = items.reduce((acc, i) => acc + i.quantity, 0);

    return {
      cartId: cart.id,
      itemCount,
      subtotalKes,
      items,
    };
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  static async getCart(cartToken: string | undefined) {
    const { cart, token, isNew } = await this.resolveCart(cartToken);
    const view = await this.buildCartView(cart.id);
    return { cart: view, cartToken: token, isNew };
  }

  static async upsertItem(cartToken: string | undefined, input: UpsertCartItemInput) {
    // Validate variant exists and is active
    const variant = await prisma.productVariant.findFirst({
      where: {
        id: input.variantId,
        isActive: true,
        deletedAt: null,
        product: { isActive: true, deletedAt: null },
      },
      include: { inventory: { select: { stockQuantity: true } } },
    });

    if (!variant) {
      throw new NotFoundError(`Product variant '${input.variantId}' not found or unavailable.`);
    }

    // Check stock BEFORE locking the cart (soft check — hard lock happens at checkout)
    const available = variant.inventory?.stockQuantity ?? 0;
    if (available <= 0) {
      throw new ConflictError(
        `This variant is currently out of stock and cannot be added to your cart.`,
        'OUT_OF_STOCK'
      );
    }
    if (input.quantity > available) {
      throw new ConflictError(
        `Only ${available} unit(s) available for this variant.`,
        'INSUFFICIENT_STOCK'
      );
    }

    const { cart, token, isNew } = await this.resolveCart(cartToken);

    // Upsert the CartItem
    await prisma.cartItem.upsert({
      where: { cartId_variantId: { cartId: cart.id, variantId: input.variantId } },
      update: { quantity: input.quantity },
      create: { cartId: cart.id, variantId: input.variantId, quantity: input.quantity },
    });

    // Update cart updatedAt
    await prisma.cart.update({ where: { id: cart.id }, data: {} });

    const view = await this.buildCartView(cart.id);
    return { cart: view, cartToken: token, isNew };
  }

  static async removeItem(cartToken: string | undefined, variantId: string) {
    if (!cartToken) {
      throw new BadRequestError('X-Cart-Token header is required to modify a cart.');
    }

    const cart = await prisma.cart.findUnique({ where: { sessionToken: cartToken } });
    if (!cart) {
      throw new NotFoundError('Cart not found. It may have expired.');
    }

    const item = await prisma.cartItem.findUnique({
      where: { cartId_variantId: { cartId: cart.id, variantId } },
    });

    if (!item) {
      throw new NotFoundError(`Item with variantId '${variantId}' not found in cart.`);
    }

    await prisma.cartItem.delete({
      where: { cartId_variantId: { cartId: cart.id, variantId } },
    });

    const view = await this.buildCartView(cart.id);
    return { cart: view, cartToken };
  }

  static async clearCart(cartToken: string | undefined) {
    if (!cartToken) {
      throw new BadRequestError('X-Cart-Token header is required to clear a cart.');
    }

    const cart = await prisma.cart.findUnique({ where: { sessionToken: cartToken } });
    if (!cart) {
      throw new NotFoundError('Cart not found.');
    }

    await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
    const view = await this.buildCartView(cart.id);
    return { cart: view, cartToken };
  }
}
