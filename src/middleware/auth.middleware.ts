import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { UnauthorizedError } from '../errors/app.error.js';
import { JwtPayload } from '../modules/auth/auth.service.js';

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

export const authenticateJwt = (req: Request, _res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(new UnauthorizedError('Authentication token missing or invalid format'));
  }

  const token = authHeader.substring(7);

  try {
    const decoded = jwt.verify(token, env.JWT_SECRET, { issuer: 'LuxeWear Kenya' }) as JwtPayload;
    req.user = decoded;
    next();
  } catch (error) {
    return next(new UnauthorizedError('Invalid or expired authentication token'));
  }
};
