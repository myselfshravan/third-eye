import { logger } from '../core/logger.js';
import { startWorker } from '../worker/worker.js';
import { getBrowserPool } from '../capture/browserPool.js';

/** Worker entrypoint. Consumes the capture queue; scale by adding replicas. */
async function main() {
  await getBrowserPool().warmUp();
  const worker = startWorker();

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down worker');
    try {
      await worker.close(); // stops taking new jobs, finishes in-flight
      await getBrowserPool().drain();
    } catch (err) {
      logger.error({ err }, 'error during worker shutdown');
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  logger.fatal({ err }, 'worker failed to start');
  process.exit(1);
});
