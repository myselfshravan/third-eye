import { Queue, QueueEvents, type ConnectionOptions } from 'bullmq';
import { Redis } from 'ioredis';
import { config } from '../core/config.js';
import type { CaptureOptions } from '../core/schema.js';

/**
 * Async capture is decoupled via BullMQ on Redis. The API enqueues; one or more
 * worker processes consume. This is what makes the system scale horizontally —
 * add worker replicas to add capture throughput without touching the API tier.
 */

export const CAPTURE_QUEUE = 'captures';

export interface CaptureJobData {
  options: CaptureOptions;
  webhookUrl?: string;
  apiKey: string;
  batchId?: string;
}

export interface CaptureJobResult {
  url: string;
  finalUrl: string;
  status: 'done' | 'failed';
  imageUrl?: string;
  key?: string;
  width?: number;
  height?: number;
  format?: string;
  bytes?: number;
  durationMs?: number;
  isCanvasApp?: boolean;
  error?: string;
}

// BullMQ requires maxRetriesPerRequest: null on the connection.
export function createRedis(): Redis {
  return new Redis(config.redis.url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
}

// BullMQ v5's `Queue` has six generic params; constructing with two and
// annotating with two trips its inference. Letting `ReturnType` capture the
// exact shape keeps full type-safety at every call site without the mismatch.
function makeQueue() {
  return new Queue<CaptureJobData, CaptureJobResult>(CAPTURE_QUEUE, {
    connection: createRedis() as unknown as ConnectionOptions,
    defaultJobOptions: {
      attempts: config.worker.attempts,
      backoff: { type: 'exponential', delay: config.worker.backoffMs },
      removeOnComplete: { age: config.worker.ttlSeconds },
      removeOnFail: { age: config.worker.ttlSeconds },
    },
  });
}

let queue: ReturnType<typeof makeQueue> | null = null;
export function getCaptureQueue(): ReturnType<typeof makeQueue> {
  if (!queue) queue = makeQueue();
  return queue;
}

let events: QueueEvents | null = null;
export function getQueueEvents(): QueueEvents {
  if (!events) {
    events = new QueueEvents(CAPTURE_QUEUE, {
      connection: createRedis() as unknown as ConnectionOptions,
    });
  }
  return events;
}
