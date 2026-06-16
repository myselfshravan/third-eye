import { Worker, type Job, type ConnectionOptions } from 'bullmq';
import { nanoid } from 'nanoid';
import { config } from '../core/config.js';
import { logger } from '../core/logger.js';
import { capture } from '../capture/capture.js';
import { extractProduct } from '../extract/extract.js';
import { isStorageEnabled, putObject } from '../storage/storage.js';
import { captureCounter, captureDuration } from '../core/metrics.js';
import {
  CAPTURE_QUEUE,
  createRedis,
  type CaptureJobData,
  type CaptureJobResult,
} from '../queue/queue.js';

/** Fire-and-forget webhook with a hard timeout so a dead endpoint can't hang us. */
async function postWebhook(url: string, payload: CaptureJobResult): Promise<void> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 10_000);
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': 'third-eye/0.1' },
      body: JSON.stringify(payload),
      signal: ac.signal,
    });
  } catch (err) {
    logger.warn({ err, url }, 'webhook delivery failed');
  } finally {
    clearTimeout(t);
  }
}

/** Optionally re-host product images in our own storage (vs. the source CDN). */
async function rehostImages(images: { url: string }[]): Promise<Map<string, string>> {
  const mapping = new Map<string, string>();
  if (!config.extract.downloadImages || !isStorageEnabled()) return mapping;
  await Promise.all(
    images.map(async (img) => {
      try {
        const ac = new AbortController();
        const t = setTimeout(() => ac.abort(), 15_000);
        const resp = await fetch(img.url, { signal: ac.signal });
        clearTimeout(t);
        if (!resp.ok) return;
        const buf = Buffer.from(await resp.arrayBuffer());
        const ct = resp.headers.get('content-type') ?? 'image/jpeg';
        const stored = await putObject(buf, ct, nanoid());
        mapping.set(img.url, stored.url);
      } catch (err) {
        logger.warn({ err, url: img.url }, 'image re-host failed');
      }
    }),
  );
  return mapping;
}

async function process(job: Job<CaptureJobData, CaptureJobResult>): Promise<CaptureJobResult> {
  const { kind = 'screenshot', options, webhookUrl, batchId } = job.data;
  logger.info({ jobId: job.id, url: options.url, kind, batchId }, 'processing job');

  try {
    // ── Extraction jobs ─────────────────────────────────────────────────────
    if (kind === 'extract') {
      const product = await extractProduct(options);
      const remap = await rehostImages(product.images);
      if (remap.size) {
        product.images = product.images.map((i) => ({ ...i, url: remap.get(i.url) ?? i.url }));
        product.primaryImage = product.images[0]?.url;
      }
      const payload: CaptureJobResult = {
        url: product.url,
        finalUrl: product.finalUrl,
        status: 'done',
        product,
        durationMs: product.durationMs,
      };
      if (webhookUrl) await postWebhook(webhookUrl, payload);
      return payload;
    }

    // ── Screenshot jobs ───────────────────────────────────────────────────────
    const result = await capture(options);
    captureCounter.inc({ outcome: 'ok', format: result.meta.format, canvas: String(result.meta.isCanvasApp) });
    captureDuration.observe({ format: result.meta.format, outcome: 'ok' }, result.meta.durationMs / 1000);

    let imageUrl: string | undefined;
    let key: string | undefined;
    if (isStorageEnabled()) {
      const stored = await putObject(result.buffer, result.contentType, job.id ?? nanoid());
      imageUrl = stored.url;
      key = stored.key;
    } else {
      // No object store configured: inline as a data URI. Fine for dev/small
      // images; production should enable storage to keep Redis lean.
      imageUrl = `data:${result.contentType};base64,${result.buffer.toString('base64')}`;
    }

    const payload: CaptureJobResult = {
      url: options.url,
      finalUrl: result.meta.finalUrl,
      status: 'done',
      imageUrl,
      key,
      width: result.meta.width,
      height: result.meta.height,
      format: result.meta.format,
      bytes: result.meta.bytes,
      durationMs: result.meta.durationMs,
      isCanvasApp: result.meta.isCanvasApp,
    };

    if (webhookUrl) await postWebhook(webhookUrl, payload);
    return payload;
  } catch (err) {
    captureCounter.inc({ outcome: 'error', format: options.format, canvas: 'unknown' });
    const payload: CaptureJobResult = {
      url: options.url,
      finalUrl: options.url,
      status: 'failed',
      error: err instanceof Error ? err.message : String(err),
    };
    // Only fire the failure webhook on the final attempt.
    if (webhookUrl && job.attemptsMade + 1 >= (job.opts.attempts ?? 1)) {
      await postWebhook(webhookUrl, payload);
    }
    throw err; // let BullMQ record/ retry per job options
  }
}

export function startWorker() {
  const worker = new Worker<CaptureJobData, CaptureJobResult>(CAPTURE_QUEUE, process, {
    connection: createRedis() as unknown as ConnectionOptions,
    concurrency: config.worker.concurrency,
  });

  worker.on('completed', (job) => logger.info({ jobId: job.id }, 'job completed'));
  worker.on('failed', (job, err) =>
    logger.error({ jobId: job?.id, err: err.message, attempts: job?.attemptsMade }, 'job failed'),
  );
  worker.on('error', (err) => logger.error({ err }, 'worker error'));

  logger.info({ concurrency: config.worker.concurrency }, 'capture worker started');
  return worker;
}
