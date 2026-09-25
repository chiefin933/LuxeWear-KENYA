import { Request, Response, NextFunction } from 'express';
import { AppError } from '../errors/app.error.js';
import { logger } from '../config/logger.js';
import { env } from '../config/env.js';

export const errorHandlerMiddleware = (
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
) => {
  const correlationId = req.correlationId;

  if (err instanceof AppError) {
    logger.warn(`[${err.code}] ${err.message}`, { correlationId, statusCode: err.statusCode, errors: err.errors });

    return res.status(err.statusCode).json({
      success: false,
      code: err.code,
      message: err.message,
      errors: err.errors || undefined,
      correlationId,
      timestamp: new Date().toISOString(),
    });
  }

  // Unhandled / Internal Server Error
  logger.error(`[UnhandledError] ${err.message}`, { correlationId, stack: err.stack });

  return res.status(500).json({
    success: false,
    code: 'INTERNAL_SERVER_ERROR',
    message: env.NODE_ENV === 'production' ? 'An unexpected server error occurred.' : err.message,
    correlationId,
    timestamp: new Date().toISOString(),
  });
};
