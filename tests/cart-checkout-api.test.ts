/**
 * Phase 3D — Cart & Checkout API Integration Tests
 *
 * Run: npx tsx tests/cart-checkout-api.test.ts
 * Requires: Docker PostgreSQL running and seed data loaded.
 */

import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/db/prisma.js';
import { randomUUID } from 'crypto';

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const TEST_SKU = 'LW-W-DRS-01-S-EMERALDGREEN';
const DELIVERY_ADDRESS = {
  recipientName: 'Wanjiru Muthoni',
  phoneNumber: '0712345678',
  city: 'Nairobi',
  suburbArea: 'Kilimani',
  streetAddress: '14 Rose Avenue, Apartment 3B',
};

// ─── Test Runner ──────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

async function test(name: string, fn: () => Promise<void>) {
  process.stdout.write(`▶ ${name} ... `);
  try {
    await fn();
    console.log('✅ PASS');
    passed++;
  } catch (err: any) {
    console.log(`❌ FAIL: ${err.message}`);
    failed++;
  }
}

// ─── DB Helpers ───────────────────────────────────────────────────────────────
async function getVariantId(sku: string): Promise<string> {
  const v = await prisma.productVariant.findUnique({ where: { sku } });
  if (!v) throw new Error(`Variant ${sku} not in DB — run prisma db seed`);
  return v.id;
}

async function resetStock(variantId: string, qty: number) {
  await prisma.inventory.update({ where: { variantId }, data: { stockQuantity: qty } });
}

async function cancelReservations(variantId: string) {
  await prisma.inventoryReservation.updateMany({
    where: { variantId, status: 'ACTIVE' },
    data: { status: 'CANCELLED' },
  });
}

async function createCartWithItem(variantId: string, qty = 1) {
  const cartRes = await request(app).get('/api/v1/cart');
  const cartToken: string = cartRes.body.cartToken;
  await request(app)
    .put('/api/v1/cart/items')
    .set('X-Cart-Token', cartToken)
    .send({ variantId, quantity: qty });
  return cartToken;
}

// ─── Main ──────────────────────────────────────────────────────────────────────
async function run() {
  console.log('\n🧪 LuxeWear Kenya — Phase 3D: Cart & Checkout API Integration Tests\n');

  const variantId = await getVariantId(TEST_SKU);

  // ═══════════════════════════════════════════════════════════════════════════
  // CART TESTS
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('─── Cart API ───────────────────────────────────────────────────\n');

  await test('GET /api/v1/cart — creates new cart (no token)', async () => {
    const res = await request(app).get('/api/v1/cart');
    assert(res.status === 201, `expected 201 got ${res.status}`);
    assert(res.body.success === true, 'success must be true');
    assert(typeof res.body.cartToken === 'string', 'cartToken must be a string');
    assert(res.body.data.itemCount === 0, 'new cart must be empty');
    assert(res.headers['x-cart-token'] !== undefined, 'X-Cart-Token header must be set');
  });

  await test('GET /api/v1/cart — returns existing cart with valid token', async () => {
    const create = await request(app).get('/api/v1/cart');
    const token = create.body.cartToken;
    const res = await request(app).get('/api/v1/cart').set('X-Cart-Token', token);
    assert(res.status === 200, `expected 200 got ${res.status}`);
    assert(res.body.cartToken === token, 'cartToken must match');
  });

  await test('GET /api/v1/cart — stale token recovery creates new cart', async () => {
    const staleToken = randomUUID();
    const res = await request(app).get('/api/v1/cart').set('X-Cart-Token', staleToken);
    assert(res.status === 201, `expected 201 got ${res.status}`);
    assert(res.body.cartToken !== staleToken, 'new token must differ from stale');
  });

  await test('PUT /api/v1/cart/items — adds item to cart', async () => {
    await resetStock(variantId, 10);
    const cartRes = await request(app).get('/api/v1/cart');
    const token = cartRes.body.cartToken;

    const res = await request(app)
      .put('/api/v1/cart/items')
      .set('X-Cart-Token', token)
      .send({ variantId, quantity: 2 });

    assert(res.status === 200, `expected 200 got ${res.status}: ${JSON.stringify(res.body)}`);
    assert(res.body.data.itemCount === 2, `expected itemCount=2, got ${res.body.data.itemCount}`);
    assert(res.body.data.items.length === 1, 'expected 1 line item');
    assert(res.body.data.items[0].quantity === 2, 'quantity must be 2');
    assert(res.body.data.subtotalKes > 0, 'subtotal must be positive');
  });

  await test('PUT /api/v1/cart/items — updates existing item quantity', async () => {
    await resetStock(variantId, 10);
    const cartRes = await request(app).get('/api/v1/cart');
    const token = cartRes.body.cartToken;

    await request(app).put('/api/v1/cart/items').set('X-Cart-Token', token).send({ variantId, quantity: 1 });
    const res = await request(app).put('/api/v1/cart/items').set('X-Cart-Token', token).send({ variantId, quantity: 3 });

    assert(res.status === 200, `expected 200 got ${res.status}`);
    assert(res.body.data.items[0].quantity === 3, 'quantity should be updated to 3');
  });

  await test('PUT /api/v1/cart/items — rejects quantity 0', async () => {
    const cartRes = await request(app).get('/api/v1/cart');
    const res = await request(app)
      .put('/api/v1/cart/items')
      .set('X-Cart-Token', cartRes.body.cartToken)
      .send({ variantId, quantity: 0 });
    assert(res.status === 400, `expected 400 got ${res.status}`);
  });

  await test('PUT /api/v1/cart/items — rejects quantity > 10', async () => {
    const cartRes = await request(app).get('/api/v1/cart');
    const res = await request(app)
      .put('/api/v1/cart/items')
      .set('X-Cart-Token', cartRes.body.cartToken)
      .send({ variantId, quantity: 11 });
    assert(res.status === 400, `expected 400 got ${res.status}`);
  });

  await test('PUT /api/v1/cart/items — rejects invalid UUID variantId', async () => {
    const cartRes = await request(app).get('/api/v1/cart');
    const res = await request(app)
      .put('/api/v1/cart/items')
      .set('X-Cart-Token', cartRes.body.cartToken)
      .send({ variantId: 'not-a-uuid', quantity: 1 });
    assert(res.status === 400, `expected 400 got ${res.status}`);
  });

  await test('PUT /api/v1/cart/items — returns 404 for non-existent variant', async () => {
    const cartRes = await request(app).get('/api/v1/cart');
    const res = await request(app)
      .put('/api/v1/cart/items')
      .set('X-Cart-Token', cartRes.body.cartToken)
      .send({ variantId: randomUUID(), quantity: 1 });
    assert(res.status === 404, `expected 404 got ${res.status}`);
  });

  await test('PUT /api/v1/cart/items — rejects quantity exceeding stock', async () => {
    await resetStock(variantId, 2);
    const cartRes = await request(app).get('/api/v1/cart');
    const res = await request(app)
      .put('/api/v1/cart/items')
      .set('X-Cart-Token', cartRes.body.cartToken)
      .send({ variantId, quantity: 5 });
    assert(res.status === 409, `expected 409 got ${res.status}`);
    assert(res.body.code === 'INSUFFICIENT_STOCK', `expected INSUFFICIENT_STOCK got ${res.body.code}`);
    await resetStock(variantId, 10);
  });

  await test('DELETE /api/v1/cart/items/:variantId — removes item from cart', async () => {
    await resetStock(variantId, 10);
    const token = await createCartWithItem(variantId, 1);
    const res = await request(app)
      .delete(`/api/v1/cart/items/${variantId}`)
      .set('X-Cart-Token', token);
    assert(res.status === 200, `expected 200 got ${res.status}`);
    assert(res.body.data.itemCount === 0, 'cart must be empty after removal');
  });

  await test('DELETE /api/v1/cart/items/:variantId — 404 for item not in cart', async () => {
    const token = await createCartWithItem(variantId, 1);
    const res = await request(app)
      .delete(`/api/v1/cart/items/${randomUUID()}`)
      .set('X-Cart-Token', token);
    assert(res.status === 404, `expected 404 got ${res.status}`);
  });

  await test('DELETE /api/v1/cart/items/:variantId — 400 without cart token', async () => {
    const res = await request(app).delete(`/api/v1/cart/items/${variantId}`);
    assert(res.status === 400, `expected 400 got ${res.status}`);
  });

  await test('DELETE /api/v1/cart — clears all items', async () => {
    await resetStock(variantId, 10);
    const token = await createCartWithItem(variantId, 2);
    const res = await request(app).delete('/api/v1/cart').set('X-Cart-Token', token);
    assert(res.status === 200, `expected 200 got ${res.status}`);
    assert(res.body.data.itemCount === 0, 'cart must be empty');
    assert(res.body.data.items.length === 0, 'items array must be empty');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // CHECKOUT TESTS
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n─── Checkout API ────────────────────────────────────────────────\n');

  await test('POST /checkout/initiate — happy path creates session & reservations', async () => {
    await cancelReservations(variantId);
    await resetStock(variantId, 10);
    const token = await createCartWithItem(variantId, 2);

    const res = await request(app).post('/api/v1/checkout/initiate').send({
      cartToken: token,
      phoneNumber: '0712345678',
      deliveryAddress: DELIVERY_ADDRESS,
    });

    assert(res.status === 201, `expected 201 got ${res.status}: ${JSON.stringify(res.body)}`);
    assert(res.body.success === true, 'success must be true');
    assert(typeof res.body.data.checkoutToken === 'string', 'checkoutToken must exist');
    assert(res.body.data.status === 'ACTIVE', 'status must be ACTIVE');
    assert(res.body.data.deliveryFeeKes === 200, 'delivery fee must be KES 200');
    assert(res.body.data.totalPayableKes > 0, 'totalPayable must be positive');
    assert(res.body.data.reservationCount === 1, 'must have 1 reservation');

    // Verify reservation is actually in the database
    const dbReservations = await prisma.inventoryReservation.findMany({
      where: { checkoutSessionId: res.body.data.checkoutSessionId, status: 'ACTIVE' },
    });
    assert(dbReservations.length === 1, 'DB must have 1 ACTIVE reservation');
    assert(dbReservations[0].quantity === 2, 'reservation quantity must be 2');
  });

  await test('POST /checkout/initiate — idempotent with same Idempotency-Key', async () => {
    await cancelReservations(variantId);
    await resetStock(variantId, 10);
    const token = await createCartWithItem(variantId, 1);
    const idempotencyKey = randomUUID();
    const body = { cartToken: token, phoneNumber: '0712345678', deliveryAddress: DELIVERY_ADDRESS };

    const r1 = await request(app)
      .post('/api/v1/checkout/initiate')
      .set('Idempotency-Key', idempotencyKey)
      .send(body);
    const r2 = await request(app)
      .post('/api/v1/checkout/initiate')
      .set('Idempotency-Key', idempotencyKey)
      .send(body);

    assert(r1.status === 201, `first request failed: ${r1.status}`);
    assert(r2.status === 201, `second request failed: ${r2.status}`);
    assert(
      r1.body.data.checkoutSessionId === r2.body.data.checkoutSessionId,
      'both responses must return the same checkout session'
    );

    // Confirm only 1 reservation exists (not 2)
    const dbReservations = await prisma.inventoryReservation.findMany({
      where: { checkoutSessionId: r1.body.data.checkoutSessionId, status: 'ACTIVE' },
    });
    assert(dbReservations.length === 1, 'idempotency must not double-create reservations');
  });

  await test('POST /checkout/initiate — 400 for empty cart', async () => {
    const emptyCartRes = await request(app).get('/api/v1/cart');
    const res = await request(app).post('/api/v1/checkout/initiate').send({
      cartToken: emptyCartRes.body.cartToken,
      phoneNumber: '0712345678',
      deliveryAddress: DELIVERY_ADDRESS,
    });
    assert(res.status === 400, `expected 400 got ${res.status}`);
  });

  await test('POST /checkout/initiate — 400 for invalid phone number', async () => {
    await cancelReservations(variantId);
    await resetStock(variantId, 10);
    const token = await createCartWithItem(variantId, 1);
    const res = await request(app).post('/api/v1/checkout/initiate').send({
      cartToken: token,
      phoneNumber: '+1-800-FLOWERS',
      deliveryAddress: DELIVERY_ADDRESS,
    });
    assert(res.status === 400, `expected 400 got ${res.status}`);
  });

  await test('POST /checkout/initiate — 400 for missing recipientName', async () => {
    await cancelReservations(variantId);
    await resetStock(variantId, 10);
    const token = await createCartWithItem(variantId, 1);
    const { recipientName: _omit, ...badAddress } = DELIVERY_ADDRESS;
    const res = await request(app).post('/api/v1/checkout/initiate').send({
      cartToken: token,
      phoneNumber: '0712345678',
      deliveryAddress: badAddress,
    });
    assert(res.status === 400, `expected 400 got ${res.status}`);
  });

  await test('POST /checkout/initiate — 409 INSUFFICIENT_STOCK when qty > stock', async () => {
    await cancelReservations(variantId);
    await resetStock(variantId, 10);
    // Add to cart while stock is healthy
    const token = await createCartWithItem(variantId, 2);
    // Now drop stock to 1 — cart holds 2 but only 1 unit exists
    await resetStock(variantId, 1);

    const res = await request(app).post('/api/v1/checkout/initiate').send({
      cartToken: token,
      phoneNumber: '0712345678',
      deliveryAddress: DELIVERY_ADDRESS,
    });
    assert(res.status === 409, `expected 409 got ${res.status}: ${JSON.stringify(res.body)}`);
    assert(res.body.code === 'INSUFFICIENT_STOCK', `expected INSUFFICIENT_STOCK got ${res.body.code}`);
  });

  await test('POST /checkout/initiate — 409 when stock is consumed by active reservations', async () => {
    await cancelReservations(variantId);
    await resetStock(variantId, 2);

    // Create a competing active reservation consuming all 2 units
    const competingSession = await prisma.checkoutSession.create({
      data: {
        checkoutToken: randomUUID(),
        phoneNumber: '254711111111',
        deliveryAddressJson: DELIVERY_ADDRESS,
        subtotalKes: 5000,
        deliveryFeeKes: 200,
        totalPayableKes: 5200,
        status: 'ACTIVE',
        reservationExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
        reservations: {
          create: { variantId, quantity: 2, status: 'ACTIVE', expiresAt: new Date(Date.now() + 15 * 60 * 1000) },
        },
      },
    });

    const token = await createCartWithItem(variantId, 1);
    const res = await request(app).post('/api/v1/checkout/initiate').send({
      cartToken: token,
      phoneNumber: '0712345678',
      deliveryAddress: DELIVERY_ADDRESS,
    });

    assert(res.status === 409, `expected 409 got ${res.status}`);
    assert(res.body.code === 'INSUFFICIENT_STOCK', 'should report INSUFFICIENT_STOCK');

    await prisma.checkoutSession.delete({ where: { id: competingSession.id } });
  });

  await test('POST /checkout/initiate — concurrent demand: only 1 succeeds for last unit', async () => {
    await cancelReservations(variantId);
    await resetStock(variantId, 1); // Only 1 unit

    const [token1, token2] = await Promise.all([
      createCartWithItem(variantId, 1),
      createCartWithItem(variantId, 1),
    ]);

    const [r1, r2] = await Promise.all([
      request(app).post('/api/v1/checkout/initiate').send({
        cartToken: token1,
        phoneNumber: '0712345678',
        deliveryAddress: DELIVERY_ADDRESS,
      }),
      request(app).post('/api/v1/checkout/initiate').send({
        cartToken: token2,
        phoneNumber: '0798765432',
        deliveryAddress: { ...DELIVERY_ADDRESS, recipientName: 'Aisha Odhiambo' },
      }),
    ]);

    const statuses = [r1.status, r2.status];
    const successes = statuses.filter((s) => s === 201).length;
    const failures = statuses.filter((s) => s === 409).length;

    console.log(`\n   → Concurrent result — success: ${successes}, blocked: ${failures}`);
    assert(successes === 1, `expected exactly 1 success, got ${successes}`);
    assert(failures === 1, `expected exactly 1 failure, got ${failures}`);
  });

  await test('POST /checkout/initiate — writes checkout.initiated outbox event', async () => {
    await cancelReservations(variantId);
    await resetStock(variantId, 10);
    const token = await createCartWithItem(variantId, 1);

    const res = await request(app).post('/api/v1/checkout/initiate').send({
      cartToken: token,
      phoneNumber: '0712345678',
      deliveryAddress: DELIVERY_ADDRESS,
    });

    assert(res.status === 201, `expected 201 got ${res.status}`);

    const event = await prisma.outboxEvent.findFirst({
      where: {
        aggregateType: 'CheckoutSession',
        aggregateId: res.body.data.checkoutSessionId,
        eventType: 'checkout.initiated',
      },
    });

    assert(event !== null, 'outbox event must exist in DB');
    assert(event!.status === 'PENDING', `event status must be PENDING, got ${event!.status}`);
    const payload = event!.payload as any;
    assert(payload.checkoutSessionId === res.body.data.checkoutSessionId, 'payload must contain checkoutSessionId');
  });

  // ─── Summary ───────────────────────────────────────────────────────────────
  const total = passed + failed;
  console.log(`\n${'─'.repeat(60)}`);
  if (failed === 0) {
    console.log(`🎉 PASSED: All ${total} / ${total} Phase 3D tests passed!\n`);
  } else {
    console.log(`⚠️  RESULTS: ${passed} passed, ${failed} failed (of ${total} total)\n`);
  }

  await prisma.$disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
