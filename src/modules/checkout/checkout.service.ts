import { prisma } from '../../db/prisma.js';
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
} from '../../errors/app.error.js';
import { InitiateCheckoutInput } from './checkout.schemas.js';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';

// ─── Business Constants ────────────────────────────────────────────────────
const RESERVATION_TTL_MINUTES = 15;
const DELIVERY_FEE_KES = 200; // Flat-rate Nairobi delivery

/**
 * Normalise a Kenyan phone number to the international 254XXXXXXXXX format.
 * Accepts 07XXXXXXXX, 01XXXXXXXX, 2547XXXXXXXX, +2547XXXXXXXX.
 */
function normaliseKenyanPhone(raw: string): string {
  const cleaned = raw.replace(/\s+/g, '');
  if (cleaned.startsWith('+254')) return cleaned.slice(1); // strip leading +
  if (cleaned.startsWith('254')) return cleaned;
  if (cleaned.startsWith('0')) return `254${cleaned.slice(1)}`;
  return cleaned;
}

export class CheckoutService {
  /**
   * POST /api/v1/checkout/initiate
   *
   * Atomically:
   *  1. Load the cart and validate it is non-empty.
   *  2. Validate all variants are still active.
   *  3. Lock inventory rows with SELECT ... FOR UPDATE.
   *  4. Check per-variant availability.
   *  5. Create the CheckoutSession + InventoryReservations in one transaction.
   *  6. Write an OutboxEvent for n8n to pick up.
   *
   * Idempotent when the same Idempotency-Key is resent — returns the
   * existing CheckoutSession without re-locking inventory.
   */
  static async initiateCheckout(
    input: InitiateCheckoutInput,
    idempotencyKey?: string
  ) {
    // ── Idempotency Guard ──────────────────────────────────────────────────
    if (idempotencyKey) {
      const existing = await prisma.checkoutSession.findUnique({
        where: { checkoutToken: idempotencyKey },
        include: { reservations: true },
      });
      if (existing) {
        return this.formatCheckoutResponse(existing);
      }
    }

    // ── 1. Load Cart ───────────────────────────────────────────────────────
    const cart = await prisma.cart.findUnique({
      where: { sessionToken: input.cartToken },
      include: {
        items: {
          include: {
            variant: {
              include: {
                product: {
                  select: {
                    id: true,
                    name: true,
                    basePriceKes: true,
                    salePriceKes: true,
                    isActive: true,
                    deletedAt: true,
                  },
                },
                inventory: { select: { stockQuantity: true } },
                // priceOverrideKes is required for correct per-variant pricing
                // (Prisma includes all scalar fields by default in `include`, so
                //  this is already present — but made explicit here for clarity)
              },
            },
          },
        },
      },
    });

    if (!cart) {
      throw new NotFoundError('Cart not found. Please create a new cart.');
    }
    if (cart.items.length === 0) {
      throw new BadRequestError('Your cart is empty. Please add items before checking out.');
    }

    // ── 2. Validate all variants are still purchasable ──────────────────────
    const invalidItems = cart.items.filter(
      (item) =>
        !item.variant.isActive ||
        item.variant.deletedAt !== null ||
        !item.variant.product.isActive ||
        item.variant.product.deletedAt !== null
    );
    if (invalidItems.length > 0) {
      const names = invalidItems.map((i) => i.variant.sku).join(', ');
      throw new BadRequestError(
        `The following items are no longer available: ${names}. Please remove them from your cart.`
      );
    }

    // ── 3 & 4 & 5. Transactional Inventory Lock + Session Creation ──────────
    const checkoutToken = idempotencyKey ?? randomUUID();
    const expiresAt = new Date(Date.now() + RESERVATION_TTL_MINUTES * 60 * 1000);
    const phoneNumber = normaliseKenyanPhone(input.phoneNumber);

    let checkoutSession: Awaited<ReturnType<typeof prisma.checkoutSession.findUniqueOrThrow>>;

    try {
      checkoutSession = await prisma.$transaction(
        async (tx) => {
          // Lock all inventory rows for this checkout in a deterministic order
          // (order by variantId to prevent deadlocks between concurrent checkouts)
          const sortedItems = [...cart.items].sort((a, b) =>
            a.variantId.localeCompare(b.variantId)
          );

          // SELECT ... FOR UPDATE on each inventory row
          const stockMap: Record<string, number> = {};
          for (const item of sortedItems) {
            const inv = await tx.$queryRaw<{ stock_quantity: number }[]>`
              SELECT stock_quantity
              FROM inventory
              WHERE variant_id::text = ${item.variantId}
              FOR UPDATE
            `;

            if (!inv.length) {
              throw new ConflictError(
                `Inventory record missing for variant ${item.variantId}.`,
                'INVENTORY_NOT_FOUND'
              );
            }

            stockMap[item.variantId] = inv[0].stock_quantity;
          }

          // Count existing ACTIVE reservations for each variant
          const activeReservations = await tx.inventoryReservation.groupBy({
            by: ['variantId'],
            where: {
              variantId: { in: sortedItems.map((i) => i.variantId) },
              status: 'ACTIVE',
              expiresAt: { gt: new Date() },
            },
            _sum: { quantity: true },
          });

          const reservedMap: Record<string, number> = {};
          for (const r of activeReservations) {
            reservedMap[r.variantId] = r._sum.quantity ?? 0;
          }

          // Check each item for sufficient free stock
          const insufficientItems: string[] = [];
          for (const item of sortedItems) {
            const stock = stockMap[item.variantId] ?? 0;
            const reserved = reservedMap[item.variantId] ?? 0;
            const freeStock = stock - reserved;

            if (freeStock < item.quantity) {
              insufficientItems.push(
                `${item.variant.product.name} (${item.variant.size}/${item.variant.color}): ` +
                  `requested ${item.quantity}, only ${Math.max(0, freeStock)} available`
              );
            }
          }

          if (insufficientItems.length > 0) {
            throw new ConflictError(
              `Insufficient stock for: ${insufficientItems.join('; ')}`,
              'INSUFFICIENT_STOCK'
            );
          }

          // Compute totals
          let subtotalKes = new Prisma.Decimal(0);
          for (const item of sortedItems) {
            const v = item.variant;
            const unitPrice =
              v.priceOverrideKes ?? v.product.salePriceKes ?? v.product.basePriceKes;
            subtotalKes = subtotalKes.add(new Prisma.Decimal(unitPrice.toString()).mul(item.quantity));
          }
          const deliveryFeeKes = new Prisma.Decimal(DELIVERY_FEE_KES);
          const totalPayableKes = subtotalKes.add(deliveryFeeKes);

          // Create CheckoutSession
          const session = await tx.checkoutSession.create({
            data: {
              checkoutToken,
              phoneNumber,
              deliveryAddressJson: input.deliveryAddress as object,
              subtotalKes,
              deliveryFeeKes,
              totalPayableKes,
              status: 'ACTIVE',
              reservationExpiresAt: expiresAt,
              reservations: {
                create: sortedItems.map((item) => ({
                  variantId: item.variantId,
                  quantity: item.quantity,
                  status: 'ACTIVE',
                  expiresAt,
                })),
              },
            },
            include: { reservations: true },
          });

          // Write OutboxEvent for n8n to process (checkout.initiated)
          await tx.outboxEvent.create({
            data: {
              eventType: 'checkout.initiated',
              aggregateType: 'CheckoutSession',
              aggregateId: session.id,
              payload: {
                checkoutSessionId: session.id,
                checkoutToken,
                phoneNumber,
                totalPayableKes: totalPayableKes.toFixed(2),
                reservationExpiresAt: expiresAt.toISOString(),
                itemCount: cart.items.length,
              },
            },
          });

          return session;
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 10_000,
        }
      );
    } catch (err: any) {
      // Re-wrap Prisma serialization failures (P2034) into our typed error
      if (err?.code === 'P2034' || err?.message?.includes('serialization')) {
        throw new ConflictError(
          'Checkout could not be completed due to concurrent demand. Please try again.',
          'SERIALIZATION_FAILURE'
        );
      }
      throw err;
    }

    return this.formatCheckoutResponse(checkoutSession);
  }

  // ─── Format response ─────────────────────────────────────────────────────
  private static formatCheckoutResponse(session: any) {
    return {
      checkoutSessionId: session.id,
      checkoutToken: session.checkoutToken,
      status: session.status,
      phoneNumber: session.phoneNumber,
      deliveryAddress: session.deliveryAddressJson,
      subtotalKes: Number(session.subtotalKes),
      deliveryFeeKes: Number(session.deliveryFeeKes),
      totalPayableKes: Number(session.totalPayableKes),
      reservationExpiresAt: session.reservationExpiresAt,
      createdAt: session.createdAt,
      reservationCount: session.reservations?.length ?? 0,
    };
  }
}
