import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { nanoid } from 'nanoid';
import { ExtractOptionsSchema, type ExtractOptions, type CaptureOptions } from '../../core/schema.js';
import { extractProduct } from '../../extract/extract.js';
import { extractListing } from '../../extract/plp.js';
import { capture } from '../../capture/capture.js';
import { getCaptureQueue } from '../../queue/queue.js';
import { isStorageEnabled, putObject } from '../../storage/storage.js';
import { logger } from '../../core/logger.js';

const ResponseQuery = z.object({ response: z.enum(['json', 'image']).default('json') });

/** Download a remote image through plain fetch and stream its bytes back. */
async function fetchImage(url: string): Promise<{ buffer: Buffer; contentType: string } | null> {
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 15_000);
    const resp = await fetch(url, { signal: ac.signal, headers: { 'user-agent': 'third-eye/0.2' } });
    clearTimeout(t);
    if (!resp.ok) return null;
    const buffer = Buffer.from(await resp.arrayBuffer());
    return { buffer, contentType: resp.headers.get('content-type') ?? 'image/jpeg' };
  } catch {
    return null;
  }
}

async function maybeScreenshot(opts: CaptureOptions): Promise<string | undefined> {
  try {
    const shot = await capture({ ...opts, pdf: false });
    if (isStorageEnabled()) {
      const stored = await putObject(shot.buffer, shot.contentType, nanoid());
      return stored.url;
    }
    return `data:${shot.contentType};base64,${shot.buffer.toString('base64')}`;
  } catch (err) {
    logger.warn({ err }, 'includeScreenshot capture failed');
    return undefined;
  }
}

export async function registerExtractRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // ── PDP extraction ────────────────────────────────────────────────────────
  // Default: JSON product data (title/brand/price/sizes + ranked product images).
  // ?response=image: return the primary product image bytes ("the image from the
  // URL"); falls back to a screenshot if no product image is found.
  r.route({
    method: 'POST',
    url: '/v1/extract',
    schema: { querystring: ResponseQuery, body: ExtractOptionsSchema },
    handler: async (req, reply) => {
      const opts = req.body as ExtractOptions;
      const { response } = req.query as z.infer<typeof ResponseQuery>;
      const product = await extractProduct(opts);

      if (response === 'image') {
        if (product.primaryImage) {
          const img = await fetchImage(product.primaryImage);
          if (img) {
            return reply
              .header('content-type', img.contentType)
              .header('x-image-source', product.sources[0] ?? 'unknown')
              .header('x-extract-confidence', product.confidence)
              .send(img.buffer);
          }
        }
        // No product image (or download failed) → honor "screenshot by default".
        const shot = await capture({ ...(opts as CaptureOptions), pdf: false });
        return reply
          .header('content-type', shot.contentType)
          .header('x-image-source', 'screenshot-fallback')
          .send(shot.buffer);
      }

      const screenshot = opts.includeScreenshot ? await maybeScreenshot(opts as CaptureOptions) : undefined;
      return reply.send({ ...product, screenshot });
    },
  });

  // ── Async PDP extraction (enqueue, optional webhook) ───────────────────────
  r.route({
    method: 'POST',
    url: '/v1/extract/async',
    schema: { body: ExtractOptionsSchema.and(z.object({ webhookUrl: z.string().url().optional() })) },
    handler: async (req, reply) => {
      const { webhookUrl, ...options } = req.body as ExtractOptions & { webhookUrl?: string };
      const job = await getCaptureQueue().add(
        'extract',
        { kind: 'extract', options: options as CaptureOptions, webhookUrl, apiKey: req.apiKey ?? 'dev' },
        { jobId: nanoid() },
      );
      return reply.status(202).send({ jobId: job.id, status: 'queued' });
    },
  });

  // ── PLP / listing extraction ───────────────────────────────────────────────
  r.route({
    method: 'POST',
    url: '/v1/extract/listing',
    schema: { body: ExtractOptionsSchema },
    handler: async (req) => {
      const opts = req.body as ExtractOptions;
      return extractListing(opts);
    },
  });
}
