import { prisma } from '../../db/prisma.js';
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
} from '../../errors/app.error.js';
import { InitiateCheckoutInput } from './checkout.schemas.js';
import { PricingService } from '../catalog/pricing.service.js';
import { randomUUID, createHash } from 'crypto';
import { Prisma } from '@prisma/client';

// ─── Business Constants ────────────────────────────────────────────────────
const RESERVATION_TTL_MINUTES = 15;

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

/**
 * Computes a SHA-256 fingerprint hash for the entire checkout request payload
 * to guarantee strict idempotency verification across all parameters.
 */
function computeRequestFingerprint(input: InitiateCheckoutInput): string {
  const normalized = {
    cartToken: input.cartToken,
    phoneNumber: normaliseKenyanPhone(input.phoneNumber),
    deliveryAddress: input.deliveryAddress,
  };
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

/**
 * Executes a transaction block with bounded exponential retry for PostgreSQL
 * SERIALIZABLE isolation failures (P2034 / SQLSTATE 40001).
 */
async function withSerializableRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  baseDelayMs = 50
): Promise<T> {
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      return await fn();
    } catch (err: any) {
      attempt++;
      const isSerializationError =
        err?.code === 'P2034' ||
        err?.message?.includes('serialization') ||
        err?.message?.includes('could not serialize access');

      if (isSerializationError && attempt < maxRetries) {
        const jitter = Math.floor(Math.random() * 30);
        await new Promise((resolve) => setTimeout(resolve, baseDelayMs * attempt + jitter));
        continue;
      }
      throw err;
    }
  }
  throw new Error('Transaction failed after maximum retries');
}

export class CheckoutService {
  /**
   * POST /api/v1/checkout/initiate
   *
   * Atomically:
   *  1. Load the cart and validate it is non-empty.
   *  2. Validate all variants are still active.
   *  3. Calculate zone-based delivery fee & totals using exact Prisma.Decimal arithmetic via PricingService.
   *  4. Lock inventory rows with SELECT ... FOR UPDATE inside a Serializable transaction with retry.
   *  5. Check per-variant availability.
   *  6. Create the CheckoutSession + InventoryReservations in one transaction.
   *  7. Write an OutboxEvent for n8n to pick up.
   *
   * Idempotent when the same Idempotency-Key is resent — returns the
   * existing CheckoutSession without re-locking inventory, verifying request payload fingerprint matching.
   */
  static async initiateCheckout(
    input: InitiateCheckoutInput,
    idempotencyKey?: string
  ) {
    const phoneNumber = normaliseKenyanPhone(input.phoneNumber);
    const requestFingerprint = computeRequestFingerprint(input);

    // ── Pre-check Idempotency Guard ──────────────────────────────────────────
    if (idempotencyKey) {
      const existing = await prisma.checkoutSession.findUnique({
        where: { checkoutToken: idempotencyKey },
        include: { reservations: true },
      });
      if (existing) {
        // Validate request payload fingerprint consistency
        const storedFingerprint = (existing.deliveryAddressJson as any)?._fingerprint;
        if (storedFingerprint && storedFingerprint !== requestFingerprint) {
          throw new ConflictError(
            'Idempotency-Key reused with different request parameters.',
            'IDEMPOTENCY_CONFLICT'
          );
        }
        if (existing.phoneNumber !== phoneNumber) {
          throw new ConflictError(
            'Idempotency-Key reused with different request parameters.',
            'IDEMPOTENCY_CONFLICT'
          );
        }
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

    // ── 3. Calculate Totals & Zone-Based Delivery Fee using Prisma.Decimal ──
    const { subtotalKes, deliveryFeeKes, totalPayableKes } =
      PricingService.calculateCheckoutTotals(cart.items, input.deliveryAddress);

    // ── 4 & 5 & 6. Transactional Inventory Lock + Session Creation ──────────
    const checkoutToken = idempotencyKey ?? randomUUID();
    const expiresAt = new Date(Date.now() + RESERVATION_TTL_MINUTES * 60 * 1000);

    let checkoutSession: Awaited<ReturnType<typeof prisma.checkoutSession.findUniqueOrThrow>>;

    try {
      checkoutSession = await withSerializableRetry(async () => {
        return prisma.$transaction(
          async (tx) => {
            // Check for concurrent session creation inside transaction if idempotencyKey was provided
            if (idempotencyKey) {
              const insideExisting = await tx.checkoutSession.findUnique({
                where: { checkoutToken: idempotencyKey },
                include: { reservations: true },
              });
              if (insideExisting) {
                return insideExisting;
              }
            }

            // Lock all inventory rows for this checkout in deterministic variantId order
            const sortedItems = [...cart.items].sort((a, b) =>
              a.variantId.localeCompare(b.variantId)
            );

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

            // Store delivery address along with SHA-256 payload fingerprint
            const deliveryAddressJson = {
              ...input.deliveryAddress,
              _fingerprint: requestFingerprint,
            };

            // Create CheckoutSession
            const session = await tx.checkoutSession.create({
              data: {
                checkoutToken,
                phoneNumber,
                deliveryAddressJson: deliveryAddressJson as object,
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

            // Write OutboxEvent for n8n automation (checkout.initiated)
            await tx.outboxEvent.create({
              data: {
                eventType: 'checkout.initiated',
                aggregateType: 'CheckoutSession',
                aggregateId: session.id,
                payload: {
                  checkoutSessionId: session.id,
                  checkoutToken,
                  phoneNumber,
                  subtotalKes: subtotalKes.toFixed(2),
                  deliveryFeeKes: deliveryFeeKes.toFixed(2),
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
      });
    } catch (err: any) {
      // Catch concurrent unique constraint violation on checkoutToken (P2002)
      if (err?.code === 'P2002' && idempotencyKey) {
        const winningSession = await prisma.checkoutSession.findUnique({
          where: { checkoutToken: idempotencyKey },
          include: { reservations: true },
        });
        if (winningSession) {
          const storedFingerprint = (winningSession.deliveryAddressJson as any)?._fingerprint;
          if (storedFingerprint && storedFingerprint !== requestFingerprint) {
            throw new ConflictError(
              'Idempotency-Key reused with different request parameters.',
              'IDEMPOTENCY_CONFLICT'
            );
          }
          return this.formatCheckoutResponse(winningSession);
        }
      }

      // Re-wrap Prisma serialization failures (P2034) if retries exhausted
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
    const delAddr = { ...session.deliveryAddressJson };
    delete delAddr._fingerprint; // Clean up internal fingerprint from public API response

    return {
      checkoutSessionId: session.id,
      checkoutToken: session.checkoutToken,
      status: session.status,
      phoneNumber: session.phoneNumber,
      deliveryAddress: delAddr,
      subtotalKes: Number(session.subtotalKes),
      deliveryFeeKes: Number(session.deliveryFeeKes),
      totalPayableKes: Number(session.totalPayableKes),
      reservationExpiresAt: session.reservationExpiresAt,
      createdAt: session.createdAt,
      reservationCount: session.reservations?.length ?? 0,
    };
  }
}
