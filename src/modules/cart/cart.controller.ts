import { Request, Response, NextFunction } from 'express';
import { CartService } from './cart.service.js';

/**
 * Extract X-Cart-Token from headers (case-insensitive by Express).
 */
function getCartToken(req: Request): string | undefined {
  const header = req.headers['x-cart-token'];
  if (!header) return undefined;
  return Array.isArray(header) ? header[0] : header;
}

export class CartController {
  static async getCart(req: Request, res: Response, next: NextFunction) {
    try {
      const cartToken = getCartToken(req);
      const result = await CartService.getCart(cartToken);

      res
        .status(result.isNew ? 201 : 200)
        .set('X-Cart-Token', result.cartToken)
        .json({ success: true, data: result.cart, cartToken: result.cartToken });
    } catch (err) {
      next(err);
    }
  }

  static async upsertItem(req: Request, res: Response, next: NextFunction) {
    try {
      const cartToken = getCartToken(req);
      const result = await CartService.upsertItem(cartToken, req.body);

      res
        .status(200)
        .set('X-Cart-Token', result.cartToken)
        .json({ success: true, data: result.cart, cartToken: result.cartToken });
    } catch (err) {
      next(err);
    }
  }

  static async removeItem(req: Request, res: Response, next: NextFunction) {
    try {
      const cartToken = getCartToken(req);
      const result = await CartService.removeItem(cartToken, req.params.variantId);

      res
        .status(200)
        .set('X-Cart-Token', result.cartToken)
        .json({ success: true, data: result.cart });
    } catch (err) {
      next(err);
    }
  }

  static async clearCart(req: Request, res: Response, next: NextFunction) {
    try {
      const cartToken = getCartToken(req);
      const result = await CartService.clearCart(cartToken);

      res
        .status(200)
        .set('X-Cart-Token', result.cartToken)
        .json({ success: true, data: result.cart });
    } catch (err) {
      next(err);
    }
  }
}
