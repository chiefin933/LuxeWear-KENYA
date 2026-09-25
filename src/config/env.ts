import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  PORT: z.string().default('4000').transform((val) => parseInt(val, 10)),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().default('redis://localhost:6380'),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters long'),
  CORS_ORIGIN: z.string().default('*'),
  DARAJA_CONSUMER_KEY: z.string().default('mock_consumer_key'),
  DARAJA_CONSUMER_SECRET: z.string().default('mock_consumer_secret'),
  DARAJA_PASSKEY: z.string().default('bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919'),
  DARAJA_SHORTCODE: z.string().default('174379'),
  DARAJA_CALLBACK_URL: z.string().default('http://localhost:4000/api/v1/payments/mpesa/callback'),
  DARAJA_ENV: z.enum(['sandbox', 'production', 'mock']).default('mock'),
});

const _env = envSchema.safeParse(process.env);

if (!_env.success) {
  console.error('❌ Invalid environment variables configuration:', _env.error.format());
  throw new Error('Invalid environment variables.');
}

export const env = _env.data;
