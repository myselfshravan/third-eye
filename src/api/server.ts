import Fastify, { type FastifyInstance, type FastifyBaseLogger } from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import rateLimit from '@fastify/rate-limit';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { config } from '../core/config.js';
import { logger } from '../core/logger.js';
import { isAppError } from '../core/errors.js';
import { createRedis } from '../queue/queue.js';
import { authPlugin } from './auth.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerScreenshotRoutes } from './routes/screenshot.js';
import { registerJobRoutes } from './routes/jobs.js';
import { registerBulkRoutes } from './routes/bulk.js';

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({
    // pino and fastify's bundled pino types drift on `msgPrefix`; the instance
    // is structurally compatible at runtime.
    loggerInstance: logger as unknown as FastifyBaseLogger,
    bodyLimit: config.http.bodyLimit,
    trustProxy: true,
    requestIdHeader: 'x-request-id',
    disableRequestLogging: false,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: config.http.corsOrigins === '*' ? true : config.http.corsOrigins.split(','),
  });
  await app.register(sensible);

  // Rate limit, Redis-backed so it holds across API replicas. Plan drives max.
  await app.register(rateLimit, {
    global: true,
    redis: createRedis(),
    nameSpace: 'te-rl:',
    keyGenerator: (req) => req.apiKey ?? req.ip,
    max: (req) => config.auth.ratePerMin[req.plan ?? 'free'],
    timeWindow: '1 minute',
    allowList: (req) => ['/healthz', '/readyz', '/metrics', '/'].includes(req.url.split('?')[0] ?? ''),
  });

  await app.register(authPlugin);

  // Unified error shape: { error: { code, message, details? } }.
  app.setErrorHandler((err, req, reply) => {
    if (isAppError(err)) {
      return reply.status(err.statusCode).send({
        error: { code: err.code, message: err.message, details: err.details },
      });
    }
    if ((err as { statusCode?: number }).statusCode === 429) {
      return reply.status(429).send({
        error: { code: 'rate_limited', message: 'Rate limit exceeded' },
      });
    }
    const fe = err as { validation?: unknown; message?: string };
    if (fe.validation) {
      return reply.status(400).send({
        error: { code: 'bad_request', message: fe.message ?? 'Validation failed', details: fe.validation },
      });
    }
    req.log.error({ err }, 'unhandled error');
    return reply.status(500).send({
      error: { code: 'internal', message: 'Internal server error' },
    });
  });

  await app.register(registerHealthRoutes);
  await app.register(registerScreenshotRoutes);
  await app.register(registerJobRoutes);
  await app.register(registerBulkRoutes);

  return app;
}
