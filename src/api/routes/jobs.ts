import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { getCaptureQueue } from '../../queue/queue.js';
import { Errors } from '../../core/errors.js';

export async function registerJobRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.route({
    method: 'GET',
    url: '/v1/jobs/:id',
    schema: { params: z.object({ id: z.string().min(1) }) },
    handler: async (req) => {
      const { id } = req.params as { id: string };
      const job = await getCaptureQueue().getJob(id);
      if (!job) throw Errors.notFound(`Job ${id} not found or expired`);

      const state = await job.getState();
      const base = {
        jobId: job.id,
        state, // waiting | active | completed | failed | delayed
        attemptsMade: job.attemptsMade,
        progress: job.progress,
      };
      if (state === 'completed') {
        return { ...base, result: job.returnvalue };
      }
      if (state === 'failed') {
        return { ...base, error: job.failedReason };
      }
      return base;
    },
  });
}
