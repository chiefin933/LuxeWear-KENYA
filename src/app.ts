import express, { Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env.js';
import { correlationIdMiddleware } from './middleware/correlationId.middleware.js';
import { globalRateLimiter } from './middleware/rateLimit.middleware.js';
import { errorHandlerMiddleware } from './middleware/error.middleware.js';
import { NotFoundError } from './errors/app.error.js';
import { prisma } from './db/prisma.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { catalogRouter } from './modules/catalog/catalog.routes.js';
import { cartRouter } from './modules/cart/cart.routes.js';
import { checkoutRouter } from './modules/checkout/checkout.routes.js';
import { authenticateJwt } from './middleware/auth.middleware.js';
import { requireRole, requirePermission } from './middleware/rbac.middleware.js';
import { RoleName } from '@prisma/client';

export const app = express();

// 1. Security & Core Middleware
app.use(helmet());
app.use(cors({ origin: env.CORS_ORIGIN }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(correlationIdMiddleware);
app.use(globalRateLimiter);

// 2. Health & Readiness Routes
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'UP', service: 'luxewear-backend-api', timestamp: new Date().toISOString() });
});

app.get('/api/v1/health', async (req: Request, res: Response, next) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({
      success: true,
      service: 'luxewear-backend-api',
      environment: env.NODE_ENV,
      database: 'CONNECTED',
      timestamp: new Date().toISOString(),
      correlationId: req.correlationId,
    });
  } catch (err) {
    next(err);
  }
});

// 3. API V1 Routes
const v1Router = express.Router();
v1Router.use('/auth', authRouter);
v1Router.use('/catalog', catalogRouter);
v1Router.use('/cart', cartRouter);
v1Router.use('/checkout', checkoutRouter);

// Sample Protected RBAC Route for Testing Role Guards
v1Router.get('/admin/super-only', authenticateJwt, requireRole([RoleName.SUPER_ADMIN]), (_req: Request, res: Response) => {
  res.status(200).json({ success: true, message: 'Super Admin access granted.' });
});

v1Router.get('/admin/products-write-only', authenticateJwt, requirePermission(['products:write']), (_req: Request, res: Response) => {
  res.status(200).json({ success: true, message: 'Permission products:write granted.' });
});

app.use('/api/v1', v1Router);

// 4. 404 Route Handler
app.use((_req: Request, _res: Response, next) => {
  next(new NotFoundError('The requested API route does not exist.'));
});

// 5. Global Error Handler Middleware
app.use(errorHandlerMiddleware);
