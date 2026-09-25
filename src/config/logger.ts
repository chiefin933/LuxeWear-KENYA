import winston from 'winston';
import { env } from './env.js';

export const logger = winston.createLogger({
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'luxewear-backend-api' },
  transports: [
    new winston.transports.Console({
      format:
        env.NODE_ENV === 'development'
          ? winston.format.combine(
              winston.format.colorize(),
              winston.format.printf(({ level, message, timestamp, correlationId, stack }) => {
                const cid = correlationId ? ` [${correlationId}]` : '';
                return `${timestamp} ${level}${cid}: ${message}${stack ? `\n${stack}` : ''}`;
              })
            )
          : winston.format.json(),
    }),
  ],
});
