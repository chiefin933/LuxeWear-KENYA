import { Router } from 'express';
import { paymentController } from './payment.controller.js';
import { validate } from '../../middleware/validate.middleware.js';
import { initiateStkPushSchema } from './payment.schemas.js';

export const paymentRouter = Router();

// STK Push trigger endpoints (support both /stkpush and /stk-push per API specs)
paymentRouter.post('/mpesa/stkpush', validate(initiateStkPushSchema), (req, res, next) =>
  paymentController.initiateStkPush(req, res, next)
);

paymentRouter.post('/mpesa/stk-push', validate(initiateStkPushSchema), (req, res, next) =>
  paymentController.initiateStkPush(req, res, next)
);

// M-Pesa Daraja asynchronous webhook callback endpoint
paymentRouter.post('/mpesa/callback', (req, res, next) =>
  paymentController.handleCallback(req, res, next)
);

// Payment status polling endpoint
paymentRouter.get('/mpesa/status/:checkoutToken', (req, res, next) =>
  paymentController.getPaymentStatus(req, res, next)
);
