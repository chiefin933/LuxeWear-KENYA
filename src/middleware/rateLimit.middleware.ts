import rateLimit from 'express-rate-limit';

export const globalRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300, // Limit each IP to 300 requests per 15 minutes
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    code: 'TOO_MANY_REQUESTS',
    message: 'Too many requests from this IP. Please try again after 15 minutes.',
  },
});

export const checkoutRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // Limit checkout actions to 10 requests per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    code: 'RATE_LIMIT_EXCEEDED',
    message: 'Too many checkout attempts. Please wait a minute before trying again.',
  },
});

export const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Max 5 login attempts per 15 minutes per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    code: 'LOGIN_RATE_LIMIT_EXCEEDED',
    message: 'Too many failed login attempts from this IP. Please try again in 15 minutes.',
  },
});
