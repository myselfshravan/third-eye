import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { nanoid } from 'nanoid';
import { BulkCaptureSchema, CaptureOptionsSchema, type BulkCapture } from '../../core/schema.js';
import { getCaptureQueue } from '../../queue/queue.js';

export async function registerBulkRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // Fan a batch of URLs into individual queue jobs sharing a batchId. Each URL
  // is validated against the full capture schema (merged with shared options),
  // so a single bad URL fails fast at the API rather than deep in a worker.
  r.route({
    method: 'POST',
    url: '/v1/bulk',
    schema: { body: BulkCaptureSchema },
    handler: async (req, reply) => {
      const { urls, options, webhookUrl } = req.body as BulkCapture;
      const batchId = nanoid();

      const jobs = await Promise.all(
        urls.map((url) => {
          const merged = CaptureOptionsSchema.parse({ ...(options ?? {}), url });
          return getCaptureQueue().add(
            'capture',
            { options: merged, webhookUrl, apiKey: req.apiKey ?? 'dev', batchId },
            { jobId: `${batchId}:${nanoid(8)}` },
          );
        }),
      );

      return reply.status(202).send({
        batchId,
        count: jobs.length,
        jobs: jobs.map((j) => ({ jobId: j.id, url: (j.data.options as { url: string }).url })),
      });
    },
  });
}
