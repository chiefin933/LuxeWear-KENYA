import { Router } from 'express';
import { CheckoutController } from './checkout.controller.js';
import { validate } from '../../middleware/validate.middleware.js';
import { initiateCheckoutSchema } from './checkout.schemas.js';

export const checkoutRouter = Router();

/**
 * POST /api/v1/checkout/initiate
 * Begin the checkout process — validates the cart, locks inventory, and returns
 * a CheckoutSession with a 15-minute reservation window.
 *
 * Optional Idempotency-Key header (UUID): Repeat the same key to safely retry
 * without double-reserving stock.
 */
checkoutRouter.post(
  '/initiate',
  validate(initiateCheckoutSchema),
  CheckoutController.initiateCheckout
);
