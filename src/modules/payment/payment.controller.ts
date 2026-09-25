import { Request, Response, NextFunction } from 'express';
import { paymentService } from './payment.service.js';
import { InitiateStkPushInput } from './payment.schemas.js';

export class PaymentController {
  async initiateStkPush(req: Request, res: Response, next: NextFunction) {
    try {
      const input = req.body as InitiateStkPushInput;
      const result = await paymentService.initiateStkPush(input);
      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }

  async handleCallback(req: Request, res: Response, next: NextFunction) {
    try {
      const response = await paymentService.handleCallback(req.body);
      // Safaricom expects a strict HTTP 200 JSON response with ResultCode and ResultDesc
      res.status(200).json(response);
    } catch (err) {
      // In case of unexpected server errors, still return 200 to avoid infinite callback retries from Daraja
      res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
    }
  }

  async getPaymentStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const checkoutToken = req.params.checkoutToken;
      const result = await paymentService.getPaymentStatus(checkoutToken);
      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }
}

export const paymentController = new PaymentController();
