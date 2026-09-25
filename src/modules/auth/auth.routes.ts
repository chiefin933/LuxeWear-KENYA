import { Router } from 'express';
import { AuthController } from './auth.controller.js';
import { validate } from '../../middleware/validate.middleware.js';
import { loginSchema } from './auth.schemas.js';
import { loginRateLimiter } from '../../middleware/rateLimit.middleware.js';
import { authenticateJwt } from '../../middleware/auth.middleware.js';

export const authRouter = Router();

authRouter.post('/login', loginRateLimiter, validate(loginSchema), AuthController.login);
authRouter.get('/me', authenticateJwt, AuthController.me);
