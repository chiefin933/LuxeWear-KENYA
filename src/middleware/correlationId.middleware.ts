import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';

declare global {
  namespace Express {
    interface Request {
      correlationId?: string;
    }
  }
}

export const correlationIdMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const existingId = (req.headers['x-correlation-id'] || req.headers['x-request-id']) as string;
  const correlationId = existingId || randomUUID();

  req.correlationId = correlationId;
  res.setHeader('X-Correlation-ID', correlationId);

  next();
};
