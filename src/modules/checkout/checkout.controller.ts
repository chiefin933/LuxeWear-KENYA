import { Request, Response, NextFunction } from 'express';
import { CheckoutService } from './checkout.service.js';

export class CheckoutController {
  static async initiateCheckout(req: Request, res: Response, next: NextFunction) {
    try {
      const idempotencyKey = req.headers['idempotency-key'] as string | undefined;
      const result = await CheckoutService.initiateCheckout(req.body, idempotencyKey);

      res.status(201).json({
        success: true,
        message: 'Checkout session created. Items reserved for 15 minutes.',
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }
}
