import { config } from '../core/config.js';
import { logger } from '../core/logger.js';
import { buildServer } from '../api/server.js';
import { getBrowserPool, drainAllPools } from '../capture/browserPool.js';

/**
 * API entrypoint. The API process also owns a (small) browser pool so the
 * synchronous /v1/screenshot endpoint serves with low latency instead of
 * round-tripping through the queue. Async/bulk traffic goes to the workers.
 */
async function main() {
  const app = await buildServer();

  // Warm the pool before accepting traffic — no cold start on first request.
  await getBrowserPool().warmUp();

  await app.listen({ port: config.http.port, host: config.http.host });
  logger.info({ port: config.http.port }, 'third-eye API listening');

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down API');
    try {
      await app.close();
      await drainAllPools();
    } catch (err) {
      logger.error({ err }, 'error during shutdown');
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  logger.fatal({ err }, 'API failed to start');
  process.exit(1);
});
