import { Router } from 'express';
import { CartController } from './cart.controller.js';
import { validate } from '../../middleware/validate.middleware.js';
import { upsertCartItemSchema, removeCartItemSchema, cartTokenHeaderSchema } from './cart.schemas.js';

export const cartRouter = Router();

/**
 * GET /api/v1/cart
 * Returns the current cart (creates one if X-Cart-Token is missing, returns 404 if invalid/stale token).
 */
cartRouter.get('/', validate(cartTokenHeaderSchema), CartController.getCart);

/**
 * PUT /api/v1/cart/items
 * Add or update a cart item (sets quantity absolutely, not delta).
 */
cartRouter.put('/items', validate(upsertCartItemSchema), CartController.upsertItem);

/**
 * DELETE /api/v1/cart/items/:variantId
 * Remove a specific variant from the cart.
 */
cartRouter.delete(
  '/items/:variantId',
  validate(removeCartItemSchema),
  CartController.removeItem
);

/**
 * DELETE /api/v1/cart
 * Clear all items from the cart.
 */
cartRouter.delete('/', CartController.clearCart);
