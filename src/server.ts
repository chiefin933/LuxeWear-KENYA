import { app } from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { prisma } from './db/prisma.js';

const server = app.listen(env.PORT, () => {
  logger.info(`🚀 LuxeWear Kenya Backend API listening on port ${env.PORT} [${env.NODE_ENV}]`);
});

const gracefulShutdown = async (signal: string) => {
  logger.info(`Received ${signal}. Initiating graceful shutdown...`);
  
  server.close(async () => {
    logger.info('HTTP server closed.');
    try {
      await prisma.$disconnect();
      logger.info('Database connection disconnected.');
      process.exit(0);
    } catch (err) {
      logger.error('Error during database disconnect:', err);
      process.exit(1);
    }
  });

  // Force shutdown after 10 seconds if hanging
  setTimeout(() => {
    logger.error('Forced shutdown due to timeout.');
    process.exit(1);
  }, 10000);
};

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
