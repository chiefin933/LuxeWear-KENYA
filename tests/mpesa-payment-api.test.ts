import test from 'node:test';
import assert from 'node:assert';
import supertest from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/db/prisma.js';
import { CheckoutSessionStatus, PaymentStatus, ReservationStatus, OrderStatus } from '@prisma/client';

const request = supertest(app);

test('Phase 3E — M-Pesa Daraja STK Push & Async Callback Integration Suite', async (t) => {
  let categoryId: string;
  let productId: string;
  let variantId: string;
  let checkoutToken: string;

  t.before(async () => {
    // Clean database tables before running payment suite
    await prisma.paymentCallback.deleteMany();
    await prisma.paymentTransaction.deleteMany();
    await prisma.paymentAttempt.deleteMany();
    await prisma.orderItem.deleteMany();
    await prisma.deliveryAddress.deleteMany();
    await prisma.order.deleteMany();
    await prisma.outboxEvent.deleteMany();
    await prisma.inventoryReservation.deleteMany();
    await prisma.checkoutSession.deleteMany();
    await prisma.cartItem.deleteMany();
    await prisma.cart.deleteMany();
    await prisma.inventoryMovement.deleteMany();
    await prisma.inventory.deleteMany();
    await prisma.productVariant.deleteMany();
    await prisma.productImage.deleteMany();
    await prisma.product.deleteMany();
    await prisma.category.deleteMany();

    // Create Category
    const category = await prisma.category.create({
      data: {
        name: 'Gala Dresses',
        slug: 'gala-dresses-mpesa',
      },
    });
    categoryId = category.id;

    // Create Product
    const product = await prisma.product.create({
      data: {
        name: 'Savannah Silk Evening Gown',
        slug: 'savannah-silk-gown-mpesa',
        description: 'Luxury silk gown for high society galas.',
        basePriceKes: 12000.0,
        categoryId: category.id,
      },
    });
    productId = product.id;

    // Create Product Variant & Inventory
    const variant = await prisma.productVariant.create({
      data: {
        productId: product.id,
        sku: 'SKU-SAV-SILK-M',
        size: 'M',
        color: 'Emerald Green',
        inventory: {
          create: {
            stockQuantity: 10,
            safetyStockThreshold: 2,
          },
        },
      },
    });
    variantId = variant.id;

    // Initiate a Checkout Session directly in DB for testing
    const session = await prisma.checkoutSession.create({
      data: {
        checkoutToken: `chk_test_mpesa_${Date.now()}`,
        phoneNumber: '254712345678',
        subtotalKes: 12000.0,
        deliveryFeeKes: 300.0,
        totalPayableKes: 12300.0,
        status: CheckoutSessionStatus.ACTIVE,
        reservationExpiresAt: new Date(Date.now() + 15 * 60 * 1000), // 15 mins in future
        deliveryAddressJson: {
          recipientName: 'Amina Mohamed',
          phoneNumber: '254712345678',
          city: 'Nairobi',
          suburbArea: 'Kilimani',
          streetAddress: 'Argwings Kodhek Rd',
        },
        reservations: {
          create: {
            variantId: variant.id,
            quantity: 1,
            status: ReservationStatus.ACTIVE,
            expiresAt: new Date(Date.now() + 15 * 60 * 1000),
          },
        },
      },
    });
    checkoutToken = session.checkoutToken;
  });

  await t.test('1. POST /api/v1/payments/mpesa/stkpush — Successful STK Push initiation', async () => {
    const res = await request
      .post('/api/v1/payments/mpesa/stkpush')
      .send({
        checkoutToken,
        phoneNumber: '0712345678', // Normalizes to 254712345678
      });

    assert.strictEqual(res.status, 200, `Expected 200 got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.strictEqual(res.body.success, true);
    assert.ok(res.body.data.checkoutRequestId);
    assert.ok(res.body.data.merchantRequestId);
    assert.strictEqual(res.body.data.status, 'PENDING');
    assert.ok(res.body.data.customerMessage.includes('STK Push sent'));

    // Verify PaymentAttempt record created in DB
    const attempt = await prisma.paymentAttempt.findFirst({
      where: { checkoutRequestId: res.body.data.checkoutRequestId },
    });
    assert.ok(attempt);
    assert.strictEqual(attempt.status, PaymentStatus.PENDING);
    assert.strictEqual(attempt.phoneNumber, '254712345678');

    // Verify CheckoutSession status updated to PENDING_STK
    const session = await prisma.checkoutSession.findUnique({
      where: { checkoutToken },
    });
    assert.strictEqual(session?.status, CheckoutSessionStatus.PENDING_STK);
  });

  await t.test('2. POST /api/v1/payments/mpesa/stkpush — Validation error for bad phone format', async () => {
    const res = await request
      .post('/api/v1/payments/mpesa/stkpush')
      .send({
        checkoutToken,
        phoneNumber: '12345', // Invalid format
      });

    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.success, false);
    assert.strictEqual(res.body.code, 'BAD_REQUEST');
  });

  await t.test('3. POST /api/v1/payments/mpesa/stkpush — 404 for nonexistent checkoutToken', async () => {
    const res = await request
      .post('/api/v1/payments/mpesa/stkpush')
      .send({
        checkoutToken: 'nonexistent_token_999',
      });

    assert.strictEqual(res.status, 404);
    assert.strictEqual(res.body.code, 'NOT_FOUND');
  });

  await t.test('4. POST /api/v1/payments/mpesa/callback — Successful Daraja callback processing', async () => {
    // Fetch latest PaymentAttempt to get matching IDs
    const attempt = await prisma.paymentAttempt.findFirst({
      where: { status: PaymentStatus.PENDING },
      orderBy: { initiatedAt: 'desc' },
    });
    assert.ok(attempt);

    const mockMpesaReceipt = `QWE${Date.now().toString().slice(-7)}`;
    const mockCallbackPayload = {
      Body: {
        stkCallback: {
          MerchantRequestID: attempt.merchantRequestId,
          CheckoutRequestID: attempt.checkoutRequestId,
          ResultCode: 0,
          ResultDesc: 'The service request is processed successfully.',
          CallbackMetadata: {
            Item: [
              { Name: 'Amount', Value: 12300.0 },
              { Name: 'MpesaReceiptNumber', Value: mockMpesaReceipt },
              { Name: 'Balance' },
              { Name: 'TransactionDate', Value: 20260925224000 },
              { Name: 'PhoneNumber', Value: 254712345678 },
            ],
          },
        },
      },
    };

    const res = await request
      .post('/api/v1/payments/mpesa/callback')
      .send(mockCallbackPayload);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ResultCode, 0);
    assert.strictEqual(res.body.ResultDesc, 'Accepted');

    // 1. Verify PaymentAttempt status is SUCCESS
    const updatedAttempt = await prisma.paymentAttempt.findUnique({
      where: { id: attempt.id },
    });
    assert.strictEqual(updatedAttempt?.status, PaymentStatus.SUCCESS);
    assert.ok(updatedAttempt?.orderId);

    // 2. Verify Order created in DB
    const order = await prisma.order.findUnique({
      where: { id: updatedAttempt!.orderId! },
      include: { items: true, deliveryAddress: true },
    });
    assert.ok(order);
    assert.strictEqual(order.status, OrderStatus.PAID);
    assert.strictEqual(order.paymentStatus, PaymentStatus.SUCCESS);
    assert.strictEqual(Number(order.totalKes), 12300.0);
    assert.ok(order.orderNumber.startsWith('LWK-'));
    assert.strictEqual(order.items.length, 1);
    assert.strictEqual(order.items[0].skuSnapshot, 'SKU-SAV-SILK-M');
    assert.strictEqual(order.deliveryAddress?.recipientName, 'Amina Mohamed');

    // 3. Verify Inventory reservation status set to CONSUMED
    const reservation = await prisma.inventoryReservation.findFirst({
      where: { checkoutSessionId: attempt.checkoutSessionId },
    });
    assert.strictEqual(reservation?.status, ReservationStatus.CONSUMED);

    // 4. Verify Physical Inventory deducted from 10 to 9
    const inventory = await prisma.inventory.findUnique({
      where: { variantId },
    });
    assert.strictEqual(inventory?.stockQuantity, 9);

    // 5. Verify OutboxEvent generated
    const outbox = await prisma.outboxEvent.findFirst({
      where: { aggregateId: order.id },
    });
    assert.ok(outbox);
    assert.strictEqual(outbox.eventType, 'order.created');

    // 6. Verify CheckoutSession status COMPLETED
    const completedSession = await prisma.checkoutSession.findUnique({
      where: { checkoutToken },
    });
    assert.strictEqual(completedSession?.status, CheckoutSessionStatus.COMPLETED);
  });

  await t.test('5. POST /api/v1/payments/mpesa/callback — Idempotency / Duplicate callback handling', async () => {
    const attempt = await prisma.paymentAttempt.findFirst({
      where: { status: PaymentStatus.SUCCESS },
    });
    assert.ok(attempt);

    const duplicatePayload = {
      Body: {
        stkCallback: {
          MerchantRequestID: attempt.merchantRequestId,
          CheckoutRequestID: attempt.checkoutRequestId,
          ResultCode: 0,
          ResultDesc: 'The service request is processed successfully.',
        },
      },
    };

    const res = await request
      .post('/api/v1/payments/mpesa/callback')
      .send(duplicatePayload);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ResultCode, 0);

    // Verify duplicate callback logged in DB
    const callbackLogs = await prisma.paymentCallback.findMany({
      where: { paymentAttemptId: attempt.id },
    });
    assert.ok(callbackLogs.some((c) => c.status === 'DUPLICATE'));
  });

  await t.test('6. POST /api/v1/payments/mpesa/callback — User cancelled / failed payment handling', async () => {
    // Create new checkout session
    const session = await prisma.checkoutSession.create({
      data: {
        checkoutToken: `chk_test_cancel_${Date.now()}`,
        phoneNumber: '254799887766',
        subtotalKes: 5000.0,
        deliveryFeeKes: 300.0,
        totalPayableKes: 5300.0,
        status: CheckoutSessionStatus.ACTIVE,
        reservationExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
        deliveryAddressJson: { recipientName: 'John Doe', phoneNumber: '254799887766' },
      },
    });

    // Initiate STK Push
    const stkRes = await request.post('/api/v1/payments/mpesa/stkpush').send({
      checkoutToken: session.checkoutToken,
    });
    assert.strictEqual(stkRes.status, 200);

    // Send callback with ResultCode = 1032 (User cancelled)
    const cancelCallback = {
      Body: {
        stkCallback: {
          MerchantRequestID: stkRes.body.data.merchantRequestId,
          CheckoutRequestID: stkRes.body.data.checkoutRequestId,
          ResultCode: 1032,
          ResultDesc: 'Request cancelled by user.',
        },
      },
    };

    const res = await request
      .post('/api/v1/payments/mpesa/callback')
      .send(cancelCallback);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ResultCode, 0);

    // Verify PaymentAttempt status FAILED
    const failedAttempt = await prisma.paymentAttempt.findFirst({
      where: { checkoutRequestId: stkRes.body.data.checkoutRequestId },
    });
    assert.strictEqual(failedAttempt?.status, PaymentStatus.FAILED);
  });

  await t.test('7. GET /api/v1/payments/mpesa/status/:checkoutToken — Polling status check', async () => {
    const res = await request.get(`/api/v1/payments/mpesa/status/${checkoutToken}`);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.data.sessionStatus, CheckoutSessionStatus.COMPLETED);
    assert.strictEqual(res.body.data.paymentStatus, PaymentStatus.SUCCESS);
    assert.ok(res.body.data.orderNumber.startsWith('LWK-'));
  });

  await t.test('8. POST /api/v1/payments/mpesa/callback — Late Payment Escalation', async () => {
    // Create an EXPIRED checkout session
    const expiredSession = await prisma.checkoutSession.create({
      data: {
        checkoutToken: `chk_test_expired_${Date.now()}`,
        phoneNumber: '254700001122',
        subtotalKes: 8000.0,
        deliveryFeeKes: 300.0,
        totalPayableKes: 8300.0,
        status: CheckoutSessionStatus.EXPIRED,
        reservationExpiresAt: new Date(Date.now() - 5 * 60 * 1000), // Expired 5 mins ago
        deliveryAddressJson: { recipientName: 'Late Buyer', phoneNumber: '254700001122' },
      },
    });

    const merchantReqId = `MOCK-MR-LATE-${Date.now()}`;
    const checkoutReqId = `ws_CO_LATE_${Date.now()}`;

    // Create PaymentAttempt for expired session
    await prisma.paymentAttempt.create({
      data: {
        checkoutSessionId: expiredSession.id,
        paymentMethod: 'MPESA_STK',
        merchantRequestId: merchantReqId,
        checkoutRequestId: checkoutReqId,
        phoneNumber: '254700001122',
        amountKes: 8300.0,
        status: PaymentStatus.PENDING,
      },
    });

    // Send successful callback for expired session
    const lateCallback = {
      Body: {
        stkCallback: {
          MerchantRequestID: merchantReqId,
          CheckoutRequestID: checkoutReqId,
          ResultCode: 0,
          ResultDesc: 'Success',
          CallbackMetadata: {
            Item: [
              { Name: 'Amount', Value: 8300.0 },
              { Name: 'MpesaReceiptNumber', Value: `LATE_${Date.now()}` },
              { Name: 'PhoneNumber', Value: 254700001122 },
            ],
          },
        },
      },
    };

    const res = await request
      .post('/api/v1/payments/mpesa/callback')
      .send(lateCallback);

    assert.strictEqual(res.status, 200);

    // Verify late payment handling: Order status is LATE_PAYMENT_ESCALATED
    const lateOrder = await prisma.order.findFirst({
      where: { checkoutSessionId: expiredSession.id },
    });
    assert.ok(lateOrder);
    assert.strictEqual(lateOrder.status, OrderStatus.LATE_PAYMENT_ESCALATED);
    assert.strictEqual(lateOrder.paymentStatus, PaymentStatus.UNFULFILLED_LATE_PAYMENT);

    // Verify Outbox event created for late payment escalation
    const outbox = await prisma.outboxEvent.findFirst({
      where: { aggregateId: lateOrder.id },
    });
    assert.ok(outbox);
    assert.strictEqual(outbox.eventType, 'order.late_payment_escalated');
  });
});
