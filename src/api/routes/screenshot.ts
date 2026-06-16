import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { nanoid } from 'nanoid';
import {
  CaptureOptionsSchema,
  ResponseTypeSchema,
  type CaptureOptions,
  type CaptureResult,
} from '../../core/schema.js';
import { capture } from '../../capture/capture.js';
import { isStorageEnabled, putObject } from '../../storage/storage.js';
import { getCaptureQueue } from '../../queue/queue.js';
import { captureCounter, captureDuration } from '../../core/metrics.js';
import { logger } from '../../core/logger.js';

const ResponseQuery = z.object({ response: ResponseTypeSchema.default('binary') });

/** Coercing schema for the convenience GET endpoint (?url=...&full_page=true). */
const GetQuery = z.object({
  url: z.string().url(),
  format: z.enum(['png', 'jpeg', 'webp']).optional(),
  full_page: z.coerce.boolean().optional(),
  device: z.string().optional(),
  width: z.coerce.number().int().optional(),
  height: z.coerce.number().int().optional(),
  dark: z.coerce.boolean().optional(),
  response: ResponseTypeSchema.default('binary'),
});

async function formatResponse(result: CaptureResult, response: 'binary' | 'base64' | 'json') {
  captureCounter.inc({
    outcome: 'ok',
    format: result.meta.format,
    canvas: String(result.meta.isCanvasApp),
  });
  captureDuration.observe({ format: result.meta.format, outcome: 'ok' }, result.meta.durationMs / 1000);

  if (response === 'binary') return { kind: 'binary' as const, result };

  if (response === 'json' && isStorageEnabled()) {
    const stored = await putObject(result.buffer, result.contentType, nanoid());
    return { kind: 'json' as const, body: { url: stored.url, key: stored.key, meta: result.meta } };
  }

  const b64 = result.buffer.toString('base64');
  return {
    kind: 'json' as const,
    body: { image: `data:${result.contentType};base64,${b64}`, meta: result.meta },
  };
}

export async function registerScreenshotRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // ── Synchronous capture (POST, full options) ────────────────────────────
  r.route({
    method: 'POST',
    url: '/v1/screenshot',
    schema: { querystring: ResponseQuery, body: CaptureOptionsSchema },
    handler: async (req, reply) => {
      const opts = req.body as CaptureOptions;
      const { response } = req.query as z.infer<typeof ResponseQuery>;
      try {
        const result = await capture(opts);
        const formatted = await formatResponse(result, response);
        if (formatted.kind === 'binary') {
          return reply
            .header('content-type', formatted.result.contentType)
            .header('x-capture-ms', String(formatted.result.meta.durationMs))
            .header('x-canvas-app', String(formatted.result.meta.isCanvasApp))
            .send(formatted.result.buffer);
        }
        return reply.send(formatted.body);
      } catch (err) {
        captureCounter.inc({ outcome: 'error', format: opts.format, canvas: 'unknown' });
        logger.warn({ err, url: opts.url }, 'capture failed');
        throw err;
      }
    },
  });

  // ── Convenience GET (browser-friendly, subset of options) ───────────────
  r.route({
    method: 'GET',
    url: '/v1/screenshot',
    schema: { querystring: GetQuery },
    handler: async (req, reply) => {
      const q = req.query as z.infer<typeof GetQuery>;
      const opts = CaptureOptionsSchema.parse({
        url: q.url,
        format: q.format ?? 'png',
        fullPage: q.full_page ?? false,
        device: q.device,
        viewport: q.width && q.height ? { width: q.width, height: q.height } : undefined,
        darkMode: q.dark,
      });
      const result = await capture(opts);
      const formatted = await formatResponse(result, q.response);
      if (formatted.kind === 'binary') {
        return reply
          .header('content-type', formatted.result.contentType)
          .header('x-capture-ms', String(formatted.result.meta.durationMs))
          .send(formatted.result.buffer);
      }
      return reply.send(formatted.body);
    },
  });

  // ── Asynchronous capture (enqueue, optional webhook) ────────────────────
  r.route({
    method: 'POST',
    url: '/v1/screenshot/async',
    schema: {
      body: CaptureOptionsSchema.and(z.object({ webhookUrl: z.string().url().optional() })),
    },
    handler: async (req, reply) => {
      const { webhookUrl, ...options } = req.body as CaptureOptions & { webhookUrl?: string };
      const job = await getCaptureQueue().add(
        'capture',
        { options: options as CaptureOptions, webhookUrl, apiKey: req.apiKey ?? 'dev' },
        { jobId: nanoid() },
      );
      return reply.status(202).send({ jobId: job.id, status: 'queued' });
    },
  });
}
