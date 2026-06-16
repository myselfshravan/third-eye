import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { config } from '../../core/config.js';
import { Errors } from '../../core/errors.js';
import { getOgImage } from '../../og/og.js';

const Query = z.object({ url: z.string().url() });

/**
 * Ultra-low-latency `og:image` lookup. No browser on the happy path — a
 * streamed HTTP fetch + parse (~150-500ms), cached, with a browser fallback for
 * blocked/no-og sites. Returns ONLY the image URL.
 */
export async function registerOgRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.route({
    method: 'GET',
    url: '/v1/og',
    schema: { querystring: Query },
    handler: async (req, reply) => {
      const { url } = req.query as z.infer<typeof Query>;
      const { image, source } = await getOgImage(url);

      reply.header('x-og-source', source);
      reply.header('x-cache', source === 'cache' ? 'HIT' : 'MISS');
      if (!image) {
        // Don't cache misses at the edge for long; the engine already negative-caches.
        reply.header('cache-control', 'public, max-age=60');
        throw Errors.notFound('No og:image found for this URL');
      }
      reply.header('cache-control', `public, max-age=${config.og.cacheTtlSeconds}`);
      return reply.send({ image });
    },
  });
}
