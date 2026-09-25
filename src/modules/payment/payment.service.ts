import { prisma } from '../../db/prisma.js';
import { NotFoundError, ConflictError, BadRequestError } from '../../errors/app.error.js';
import { darajaClient, DarajaClient } from './daraja.client.js';
import { InitiateStkPushInput } from './payment.schemas.js';
import { PaymentStatus, CheckoutSessionStatus, ReservationStatus, CustomerTier, MovementType } from '@prisma/client';
import { logger } from '../../config/logger.js';

export class PaymentService {
  /**
   * Triggers M-Pesa Daraja STK Push prompt for a checkout session
   */
  async initiateStkPush(input: InitiateStkPushInput) {
    const session = await prisma.checkoutSession.findUnique({
      where: { checkoutToken: input.checkoutToken },
      include: { customer: true },
    });

    if (!session) {
      throw new NotFoundError('Checkout session not found.');
    }

    if (
      session.status !== CheckoutSessionStatus.ACTIVE &&
      session.status !== CheckoutSessionStatus.PENDING_STK
    ) {
      throw new ConflictError(`Checkout session is in state '${session.status}' and cannot accept payment.`);
    }

    if (session.reservationExpiresAt < new Date()) {
      throw new ConflictError('Checkout session stock reservation has expired. Please re-initiate checkout.');
    }

    const rawPhone = input.phoneNumber || session.phoneNumber;
    const normalizedPhone = DarajaClient.normalizePhoneNumber(rawPhone);
    const amount = Number(session.totalPayableKes);

    // Create PaymentAttempt record in PENDING state
    const paymentAttempt = await prisma.paymentAttempt.create({
      data: {
        checkoutSessionId: session.id,
        paymentMethod: 'MPESA_STK',
        phoneNumber: normalizedPhone,
        amountKes: session.totalPayableKes,
        status: PaymentStatus.PENDING,
      },
    });

    try {
      // Call Daraja STK Push API (or mock response in test mode)
      const darajaRes = await darajaClient.initiateStkPush({
        phoneNumber: normalizedPhone,
        amount,
        accountReference: 'LuxeWear',
        transactionDesc: `Order payment for ${session.checkoutToken.substring(0, 8)}`,
      });

      // Update PaymentAttempt with Daraja IDs
      await prisma.paymentAttempt.update({
        where: { id: paymentAttempt.id },
        data: {
          merchantRequestId: darajaRes.merchantRequestId,
          checkoutRequestId: darajaRes.checkoutRequestId,
        },
      });

      // Update CheckoutSession state to PENDING_STK
      await prisma.checkoutSession.update({
        where: { id: session.id },
        data: { status: CheckoutSessionStatus.PENDING_STK },
      });

      return {
        paymentAttemptId: paymentAttempt.id,
        checkoutRequestId: darajaRes.checkoutRequestId,
        merchantRequestId: darajaRes.merchantRequestId,
        status: PaymentStatus.PENDING,
        customerMessage: darajaRes.customerMessage,
      };
    } catch (err: any) {
      // Mark payment attempt as failed if STK push call itself failed
      await prisma.paymentAttempt.update({
        where: { id: paymentAttempt.id },
        data: { status: PaymentStatus.FAILED },
      });

      throw new BadRequestError(`Failed to send STK Push prompt: ${err.message}`);
    }
  }

  /**
   * Authoritative Async Callback Handler for M-Pesa Daraja
   */
  async handleCallback(rawCallbackJson: any) {
    logger.info('Received M-Pesa Daraja callback payload', { rawCallbackJson });

    // Store raw callback in database for security & audit trace
    const callbackLog = await prisma.paymentCallback.create({
      data: {
        rawCallbackJson: rawCallbackJson ?? {},
        status: 'RECEIVED',
      },
    });

    const stkCallback = rawCallbackJson?.Body?.stkCallback;
    if (!stkCallback) {
      await prisma.paymentCallback.update({
        where: { id: callbackLog.id },
        data: { status: 'UNMATCHED', errorMessage: 'Invalid or missing stkCallback structure' },
      });
      return { ResultCode: 0, ResultDesc: 'Accepted' };
    }

    const { MerchantRequestID, CheckoutRequestID, ResultCode, ResultDesc, CallbackMetadata } = stkCallback;

    // Locate PaymentAttempt by Daraja IDs
    const attempt = await prisma.paymentAttempt.findFirst({
      where: {
        OR: [
          { checkoutRequestId: CheckoutRequestID },
          { merchantRequestId: MerchantRequestID },
        ],
      },
      include: {
        checkoutSession: {
          include: {
            reservations: {
              include: {
                variant: {
                  include: {
                    product: true,
                    inventory: true,
                  },
                },
              },
            },
            customer: true,
          },
        },
      },
    });

    if (!attempt) {
      logger.warn('M-Pesa callback un-matched to any payment attempt', {
        MerchantRequestID,
        CheckoutRequestID,
      });
      await prisma.paymentCallback.update({
        where: { id: callbackLog.id },
        data: { status: 'UNMATCHED', errorMessage: 'No matching payment attempt found' },
      });
      return { ResultCode: 0, ResultDesc: 'Accepted' };
    }

    // Idempotency check: if attempt is already SUCCESS or FAILED
    if (attempt.status === PaymentStatus.SUCCESS || attempt.status === PaymentStatus.FAILED) {
      await prisma.paymentCallback.update({
        where: { id: callbackLog.id },
        data: {
          status: 'DUPLICATE',
          paymentAttemptId: attempt.id,
          checkoutSessionId: attempt.checkoutSessionId,
        },
      });
      return { ResultCode: 0, ResultDesc: 'Accepted' };
    }

    // If ResultCode != 0 -> User cancelled or PIN error
    if (ResultCode !== 0) {
      logger.info('M-Pesa payment failed or cancelled by user', { ResultCode, ResultDesc });
      await prisma.$transaction([
        prisma.paymentAttempt.update({
          where: { id: attempt.id },
          data: { status: PaymentStatus.FAILED },
        }),
        prisma.paymentCallback.update({
          where: { id: callbackLog.id },
          data: {
            status: 'PROCESSED',
            paymentAttemptId: attempt.id,
            checkoutSessionId: attempt.checkoutSessionId,
            errorMessage: ResultDesc,
          },
        }),
      ]);
      return { ResultCode: 0, ResultDesc: 'Accepted' };
    }

    // Parse CallbackMetadata for successful payment
    const metaItems: Array<{ Name: string; Value?: any }> = CallbackMetadata?.Item || [];
    const getItem = (name: string) => metaItems.find((i) => i.Name === name)?.Value;

    const amountPaid = getItem('Amount');
    const mpesaReceiptNumber = String(getItem('MpesaReceiptNumber') || `RECEIPT_${Date.now()}`);
    const phoneNumber = String(getItem('PhoneNumber') || attempt.phoneNumber);
    const rawTxDate = getItem('TransactionDate');

    let transactionDate = new Date();
    if (rawTxDate && String(rawTxDate).length === 14) {
      const str = String(rawTxDate);
      const YYYY = parseInt(str.substring(0, 4), 10);
      const MM = parseInt(str.substring(4, 6), 10) - 1;
      const DD = parseInt(str.substring(6, 8), 10);
      const HH = parseInt(str.substring(8, 10), 10);
      const mm = parseInt(str.substring(10, 12), 10);
      const ss = parseInt(str.substring(12, 14), 10);
      transactionDate = new Date(Date.UTC(YYYY, MM, DD, HH, mm, ss));
    }

    const session = attempt.checkoutSession;
    const isLatePayment = session.reservationExpiresAt < new Date() || session.status === CheckoutSessionStatus.EXPIRED;

    // Execute atomic transaction for order placement, stock deduction, & outbox
    await prisma.$transaction(
      async (tx) => {
        // Create PaymentTransaction log
        const transactionRecord = await tx.paymentTransaction.create({
          data: {
            paymentAttemptId: attempt.id,
            mpesaReceiptNumber,
            amountKes: session.totalPayableKes,
            phoneNumber,
            status: isLatePayment ? PaymentStatus.UNFULFILLED_LATE_PAYMENT : PaymentStatus.SUCCESS,
            transactionDate,
            resultCode: 0,
            resultDesc: ResultDesc || 'Success',
          },
        });

        // Resolve or create Customer record
        const delAddr = session.deliveryAddressJson as any;
        const firstName = delAddr?.recipientName?.split(' ')[0] || 'Valued';
        const lastName = delAddr?.recipientName?.split(' ').slice(1).join(' ') || 'Customer';

        let customerId = session.customerId;
        if (!customerId) {
          let cust = await tx.customer.findUnique({ where: { phoneNumber } });
          if (!cust) {
            cust = await tx.customer.create({
              data: {
                phoneNumber,
                firstName,
                lastName,
                customerTier: CustomerTier.FIRST_TIME_BUYER,
              },
            });
          }
          customerId = cust.id;
        }

        // Update Customer statistics
        const existingCust = await tx.customer.findUnique({ where: { id: customerId } });
        const newOrdersCount = (existingCust?.ordersCount || 0) + 1;
        const newTotalSpend = Number(existingCust?.totalSpendKes || 0) + Number(amountPaid || session.totalPayableKes);
        let newTier: CustomerTier = CustomerTier.FIRST_TIME_BUYER;
        if (newOrdersCount >= 5 || newTotalSpend >= 50000) {
          newTier = CustomerTier.VIP_LUMINARY;
        } else if (newOrdersCount >= 2) {
          newTier = CustomerTier.REPEAT_BUYER;
        }

        await tx.customer.update({
          where: { id: customerId },
          data: {
            ordersCount: newOrdersCount,
            totalSpendKes: newTotalSpend,
            customerTier: newTier,
          },
        });

        if (isLatePayment) {
          // Escalation path for late payments after stock reservation expired
          const lateOrderNumber = `LWK-LATE-${Date.now().toString().slice(-6)}`;
          const order = await tx.order.create({
            data: {
              orderNumber: lateOrderNumber,
              customerId,
              checkoutSessionId: session.id,
              paymentMethod: 'MPESA_STK',
              status: 'LATE_PAYMENT_ESCALATED',
              paymentStatus: PaymentStatus.UNFULFILLED_LATE_PAYMENT,
              subtotalKes: session.subtotalKes,
              deliveryFeeKes: session.deliveryFeeKes,
              totalKes: session.totalPayableKes,
              notes: `Late payment received after reservation expired. Receipt: ${mpesaReceiptNumber}`,
            },
          });

          await tx.paymentAttempt.update({
            where: { id: attempt.id },
            data: {
              status: PaymentStatus.UNFULFILLED_LATE_PAYMENT,
              orderId: order.id,
            },
          });

          await tx.checkoutSession.update({
            where: { id: session.id },
            data: { status: CheckoutSessionStatus.COMPLETED_LATE },
          });

          await tx.outboxEvent.create({
            data: {
              eventType: 'order.late_payment_escalated',
              aggregateType: 'Order',
              aggregateId: order.id,
              payload: {
                orderId: order.id,
                orderNumber: lateOrderNumber,
                mpesaReceiptNumber,
                amountPaid,
                customerPhone: phoneNumber,
              },
            },
          });
        } else {
          // Standard Success Order Path
          const orderNumber = `LWK-${Date.now().toString().slice(-6)}-${Math.floor(1000 + Math.random() * 9000)}`;

          const order = await tx.order.create({
            data: {
              orderNumber,
              customerId,
              checkoutSessionId: session.id,
              paymentMethod: 'MPESA_STK',
              status: 'PAID',
              paymentStatus: PaymentStatus.SUCCESS,
              subtotalKes: session.subtotalKes,
              deliveryFeeKes: session.deliveryFeeKes,
              totalKes: session.totalPayableKes,
            },
          });

          // Create OrderItems and process physical inventory deduction
          for (const res of session.reservations) {
            const variant = res.variant;
            const unitPrice = variant.priceOverrideKes ?? variant.product.salePriceKes ?? variant.product.basePriceKes;
            const totalPrice = Number(unitPrice) * res.quantity;

            await tx.orderItem.create({
              data: {
                orderId: order.id,
                variantId: variant.id,
                skuSnapshot: variant.sku,
                productNameSnapshot: variant.product.name,
                sizeSnapshot: variant.size,
                colorSnapshot: variant.color,
                unitPriceKes: unitPrice,
                quantity: res.quantity,
                totalPriceKes: totalPrice,
              },
            });

            // Consume inventory reservation
            await tx.inventoryReservation.update({
              where: { id: res.id },
              data: {
                status: ReservationStatus.CONSUMED,
                consumedAt: new Date(),
              },
            });

            // Physical inventory deduction & audit movement logging
            if (variant.inventory) {
              const newStock = Math.max(0, variant.inventory.stockQuantity - res.quantity);
              await tx.inventory.update({
                where: { id: variant.inventory.id },
                data: { stockQuantity: newStock },
              });

              await tx.inventoryMovement.create({
                data: {
                  variantId: variant.id,
                  quantityChange: -res.quantity,
                  resultingStock: newStock,
                  movementType: MovementType.PURCHASE_DEDUCTION,
                  referenceId: order.id,
                },
              });
            }
          }

          // Create DeliveryAddress for Order
          await tx.deliveryAddress.create({
            data: {
              orderId: order.id,
              recipientName: delAddr?.recipientName || `${firstName} ${lastName}`,
              phoneNumber: delAddr?.phoneNumber || phoneNumber,
              city: delAddr?.city || 'Nairobi',
              suburbArea: delAddr?.suburbArea || 'Nairobi',
              streetAddress: delAddr?.streetAddress || 'N/A',
              buildingName: delAddr?.buildingName || null,
            },
          });

          // Update PaymentAttempt & CheckoutSession state
          await tx.paymentAttempt.update({
            where: { id: attempt.id },
            data: {
              status: PaymentStatus.SUCCESS,
              orderId: order.id,
            },
          });

          await tx.checkoutSession.update({
            where: { id: session.id },
            data: { status: CheckoutSessionStatus.COMPLETED },
          });

          // Write Outbox Event for async notification (WhatsApp/n8n)
          await tx.outboxEvent.create({
            data: {
              eventType: 'order.created',
              aggregateType: 'Order',
              aggregateId: order.id,
              payload: {
                orderId: order.id,
                orderNumber,
                totalKes: session.totalPayableKes,
                customerPhone: phoneNumber,
                mpesaReceiptNumber,
                itemsCount: session.reservations.length,
              },
            },
          });
        }

        // Update PaymentCallback log status
        await tx.paymentCallback.update({
          where: { id: callbackLog.id },
          data: {
            status: 'PROCESSED',
            paymentAttemptId: attempt.id,
            paymentTransactionId: transactionRecord.id,
            checkoutSessionId: session.id,
            mpesaReceiptNumber,
            processedAt: new Date(),
          },
        });
      },
      { isolationLevel: 'Serializable' }
    );

    return { ResultCode: 0, ResultDesc: 'Accepted' };
  }

  /**
   * Polling API status lookup for frontend / client checkout page
   */
  async getPaymentStatus(checkoutToken: string) {
    const session = await prisma.checkoutSession.findUnique({
      where: { checkoutToken },
      include: {
        paymentAttempts: {
          orderBy: { initiatedAt: 'desc' },
          take: 1,
        },
        order: true,
      },
    });

    if (!session) {
      throw new NotFoundError('Checkout session not found.');
    }

    const latestAttempt = session.paymentAttempts[0] || null;

    return {
      checkoutToken: session.checkoutToken,
      sessionStatus: session.status,
      paymentStatus: latestAttempt ? latestAttempt.status : 'NONE',
      paymentAttemptId: latestAttempt ? latestAttempt.id : null,
      orderNumber: session.order ? session.order.orderNumber : null,
      orderId: session.order ? session.order.id : null,
    };
  }
}

export const paymentService = new PaymentService();
