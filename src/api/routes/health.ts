import type { FastifyInstance } from 'fastify';
import { registry } from '../../core/metrics.js';
import { config } from '../../core/config.js';
import { getBrowserPool } from '../../capture/browserPool.js';

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', async () => ({
    name: 'third-eye',
    version: '0.1.0',
    docs: '/ (see README)',
    endpoints: ['/v1/screenshot', '/v1/screenshot/async', '/v1/jobs/:id', '/v1/bulk'],
  }));

  // Liveness — process is up.
  app.get('/healthz', async () => ({ status: 'ok' }));

  // Readiness — only true on the API role once it can serve. The worker has its
  // own liveness via the process manager; here we report browser pool stats if
  // this process owns one.
  app.get('/readyz', async (_req, reply) => {
    const ready = true;
    const body: Record<string, unknown> = { status: ready ? 'ready' : 'not_ready', role: config.role };
    if (config.role === 'worker') body.pool = getBrowserPool().stats();
    return reply.status(ready ? 200 : 503).send(body);
  });

  app.get('/metrics', async (_req, reply) => {
    reply.header('content-type', registry.contentType);
    return registry.metrics();
  });
}
