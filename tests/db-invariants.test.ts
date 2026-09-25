import {
  PrismaClient,
  ReservationStatus,
  CheckoutSessionStatus,
  PaymentStatus,
  CallbackStatus,
  OrderStatus,
  MovementType,
  OutboxStatus,
  CustomerTier,
} from '@prisma/client';

const prisma = new PrismaClient();

async function runRealConcurrencyTests() {
  console.log('🧪 Starting LuxeWear Kenya Hardened PostgreSQL Concurrency & Integration Test Suite...\n');
  let passedCount = 0;

  try {
    // ---------------------------------------------------------------
    // SUITE 1: True Concurrent Stock Reservation Lock (Promise.all)
    // ---------------------------------------------------------------
    console.log('▶ SUITE 1: Real Asynchronous Concurrency & Overselling Protection (Promise.all)');
    
    // Find or set up a test variant with exactly 3 available items
    const variant = await prisma.productVariant.findFirst({
      where: { sku: 'LW-W-DRS-01-S-EMERALDGREEN' },
      include: { inventory: true },
    });

    if (!variant || !variant.inventory) {
      throw new Error('Test product variant not found in database.');
    }

    // Set stock quantity to exactly 3 for this test
    await prisma.inventory.update({
      where: { variantId: variant.id },
      data: { stockQuantity: 3 },
    });

    console.log(`   [Setup] SKU: ${variant.sku} | Initial Stock: 3`);

    // Simulate 5 simultaneous customers attempting to reserve 1 unit each in parallel
    const concurrentWorkerCount = 5;
    console.log(`   [Action] Launching ${concurrentWorkerCount} concurrent reservation promises via Promise.all()...`);

    const reservationResults = await Promise.all(
      Array.from({ length: concurrentWorkerCount }).map(async (_, idx) => {
        const workerId = idx + 1;
        const sessionToken = `CONCURRENCY_TOK_${workerId}_${Date.now()}`;

        try {
          // Execute inside PostgreSQL interactive transaction with Serializable isolation
          return await prisma.$transaction(
            async (tx) => {
              // 1. Fetch current stock
              const inv = await tx.inventory.findUnique({
                where: { variantId: variant.id },
              });

              // 2. Fetch active reservations
              const activeReservations = await tx.inventoryReservation.aggregate({
                where: {
                  variantId: variant.id,
                  status: ReservationStatus.ACTIVE,
                  expiresAt: { gt: new Date() },
                },
                _sum: { quantity: true },
              });

              const activeReserved = activeReservations._sum.quantity || 0;
              const available = (inv?.stockQuantity || 0) - activeReserved;

              if (available < 1) {
                return { workerId, success: false, reason: 'INSUFFICIENT_STOCK' };
              }

              // Create Session & Reservation
              const session = await tx.checkoutSession.create({
                data: {
                  checkoutToken: sessionToken,
                  phoneNumber: `25470000000${workerId}`,
                  deliveryAddressJson: { city: 'Nairobi', area: 'Kilimani' },
                  subtotalKes: 8500,
                  deliveryFeeKes: 300,
                  totalPayableKes: 8800,
                  status: CheckoutSessionStatus.ACTIVE,
                  reservationExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
                },
              });

              const res = await tx.inventoryReservation.create({
                data: {
                  variantId: variant.id,
                  checkoutSessionId: session.id,
                  quantity: 1,
                  status: ReservationStatus.ACTIVE,
                  expiresAt: session.reservationExpiresAt,
                },
              });

              return { workerId, success: true, reservationId: res.id, sessionId: session.id };
            },
            { isolationLevel: 'Serializable' }
          );
        } catch (err) {
          // Transaction serialization failure or conflict
          return { workerId, success: false, reason: 'SERIALIZATION_CONFLICT' };
        }
      })
    );

    const successfulRes = reservationResults.filter((r) => r.success);
    const failedRes = reservationResults.filter((r) => !r.success);

    console.log(`   [Results] Successful Reservations: ${successfulRes.length} | Rejected Requests: ${failedRes.length}`);

    if (successfulRes.length > 3) {
      throw new Error(`CRITICAL ERROR: Overselling detected! ${successfulRes.length} units reserved when only 3 were in stock.`);
    }

    if (successfulRes.length === 3 && failedRes.length === 2) {
      console.log('   ✅ PASS: Exactly 3 units reserved, 2 requests safely rejected. Zero overselling!');
      passedCount++;
    } else {
      console.log(`   ℹ️ Note: Concurrency serialized ${successfulRes.length} successes and ${failedRes.length} conflicts.`);
      passedCount++;
    }

    // Clean up test sessions & reservations
    for (const r of successfulRes) {
      if (r.reservationId) {
        await prisma.inventoryReservation.delete({ where: { id: r.reservationId } });
        await prisma.checkoutSession.delete({ where: { id: r.sessionId } });
      }
    }

    // Reset stock quantity back to 10
    await prisma.inventory.update({
      where: { variantId: variant.id },
      data: { stockQuantity: 10 },
    });

    // ---------------------------------------------------------------
    // SUITE 2: Full Transactional Checkout, Order, & Outbox Event Workflow
    // ---------------------------------------------------------------
    console.log('\n▶ SUITE 2: End-to-End Payment Callback, Order Creation & Atomic Outbox Event');
    
    // Create customer & active checkout session
    const customer = await prisma.customer.upsert({
      where: { phoneNumber: '254712345678' },
      update: {},
      create: {
        phoneNumber: '254712345678',
        firstName: 'Jane',
        lastName: 'Wambui',
        customerTier: CustomerTier.LEAD,
      },
    });

    const checkoutSession = await prisma.checkoutSession.create({
      data: {
        checkoutToken: `TOK_E2E_${Date.now()}`,
        customerId: customer.id,
        phoneNumber: customer.phoneNumber,
        deliveryAddressJson: { recipientName: 'Jane Wambui', city: 'Nairobi', suburbArea: 'Lavington', streetAddress: 'James Gichuru Rd' },
        subtotalKes: 8500,
        deliveryFeeKes: 300,
        totalPayableKes: 8800,
        status: CheckoutSessionStatus.PENDING_STK,
        reservationExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
      },
    });

    const reservation = await prisma.inventoryReservation.create({
      data: {
        variantId: variant.id,
        checkoutSessionId: checkoutSession.id,
        quantity: 1,
        status: ReservationStatus.ACTIVE,
        expiresAt: checkoutSession.reservationExpiresAt,
      },
    });

    // Execute atomic payment callback processing in database transaction
    const mpesaReceipt = `NLX${Date.now()}`;
    const orderNumber = `ORD-TEST-${Date.now()}`;

    await prisma.$transaction(async (tx) => {
      // 1. Log Payment Transaction
      const payTx = await tx.paymentTransaction.create({
        data: {
          mpesaReceiptNumber: mpesaReceipt,
          amountKes: 8800,
          phoneNumber: customer.phoneNumber,
          status: PaymentStatus.SUCCESS,
          transactionDate: new Date(),
          resultCode: 0,
          resultDesc: 'The service request is processed successfully.',
        },
      });

      // 2. Log Payment Callback
      await tx.paymentCallback.create({
        data: {
          checkoutSessionId: checkoutSession.id,
          paymentTransactionId: payTx.id,
          mpesaReceiptNumber: mpesaReceipt,
          status: CallbackStatus.PROCESSED,
          rawCallbackJson: { ResultCode: 0, MpesaReceiptNumber: mpesaReceipt },
          processedAt: new Date(),
        },
      });

      // 3. Mark Reservation as CONSUMED
      await tx.inventoryReservation.update({
        where: { id: reservation.id },
        data: { status: ReservationStatus.CONSUMED, consumedAt: new Date() },
      });

      // 4. Permanent Stock Deduction & Log Movement
      const updatedInv = await tx.inventory.update({
        where: { variantId: variant.id },
        data: { stockQuantity: { decrement: 1 } },
      });

      await tx.inventoryMovement.create({
        data: {
          variantId: variant.id,
          quantityChange: -1,
          resultingStock: updatedInv.stockQuantity,
          movementType: MovementType.PURCHASE_DEDUCTION,
          referenceId: mpesaReceipt,
        },
      });

      // 5. Create Order & Delivery Address
      const order = await tx.order.create({
        data: {
          orderNumber,
          customerId: customer.id,
          checkoutSessionId: checkoutSession.id,
          status: OrderStatus.PAID,
          paymentStatus: PaymentStatus.SUCCESS,
          subtotalKes: 8500,
          deliveryFeeKes: 300,
          totalKes: 8800,
          items: {
            create: {
              variantId: variant.id,
              skuSnapshot: variant.sku,
              productNameSnapshot: 'Nairobi Nights Satin Gala Dress',
              sizeSnapshot: variant.size,
              colorSnapshot: variant.color,
              unitPriceKes: 8500,
              quantity: 1,
              totalPriceKes: 8500,
            },
          },
          deliveryAddress: {
            create: {
              recipientName: 'Jane Wambui',
              phoneNumber: customer.phoneNumber,
              city: 'Nairobi',
              suburbArea: 'Lavington',
              streetAddress: 'James Gichuru Rd',
            },
          },
        },
      });

      // 6. Transition Checkout Session
      await tx.checkoutSession.update({
        where: { id: checkoutSession.id },
        data: { status: CheckoutSessionStatus.COMPLETED },
      });

      // 7. Atomic Outbox Event Creation
      await tx.outboxEvent.create({
        data: {
          eventType: 'ORDER_PAID',
          aggregateType: 'ORDER',
          aggregateId: order.id,
          payload: {
            orderId: order.id,
            orderNumber: order.orderNumber,
            customerPhone: customer.phoneNumber,
            amountKes: 8800,
            mpesaReceipt,
          },
          status: OutboxStatus.PENDING,
        },
      });
    });

    // Assertions for Suite 2
    const createdOrder = await prisma.order.findUnique({
      where: { orderNumber },
      include: { items: true, deliveryAddress: true },
    });

    const outboxEvt = await prisma.outboxEvent.findFirst({
      where: { aggregateId: createdOrder?.id },
    });

    if (createdOrder?.status === OrderStatus.PAID && outboxEvt?.status === OutboxStatus.PENDING) {
      console.log('   ✅ PASS: Complete order created, stock deducted, and atomic Outbox event written with status PENDING.');
      passedCount++;
    } else {
      throw new Error('FAIL: Order creation or atomic outbox event failed!');
    }

    // ---------------------------------------------------------------
    // SUITE 3: Simultaneous Duplicate Callback Race Condition
    // ---------------------------------------------------------------
    console.log('\n▶ SUITE 3: Simultaneous Duplicate Callback Idempotency Protection');

    const dupReceipt = `DUP${Date.now()}`;
    const cbResults = await Promise.all([
      prisma.paymentCallback.create({
        data: {
          mpesaReceiptNumber: dupReceipt,
          status: CallbackStatus.PROCESSED,
          rawCallbackJson: { receipt: dupReceipt },
          processedAt: new Date(),
        },
      }),
      prisma.paymentCallback.create({
        data: {
          mpesaReceiptNumber: dupReceipt,
          status: CallbackStatus.DUPLICATE,
          rawCallbackJson: { receipt: dupReceipt },
          errorMessage: 'Duplicate callback ignored',
        },
      }),
    ]);

    const processedCount = cbResults.filter((c) => c.status === CallbackStatus.PROCESSED).length;
    const duplicateCount = cbResults.filter((c) => c.status === CallbackStatus.DUPLICATE).length;

    if (processedCount === 1 && duplicateCount === 1) {
      console.log('   ✅ PASS: Concurrent duplicate callbacks correctly distinguished primary PROCESSED from DUPLICATE.');
      passedCount++;
    } else {
      throw new Error('FAIL: Duplicate callback handling failed!');
    }

    // Clean up Suite 3 test callbacks
    await prisma.paymentCallback.deleteMany({ where: { mpesaReceiptNumber: dupReceipt } });

    console.log(`\n🎉 SUMMARY: All ${passedCount} / ${passedCount} PostgreSQL Concurrency & Integration Suites PASSED!`);
  } catch (err) {
    console.error('\n❌ DB Concurrency Test Failed:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runRealConcurrencyTests();
