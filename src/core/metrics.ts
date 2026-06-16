import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

/**
 * Prometheus metrics. Exposed at GET /metrics on the API and scrapeable from
 * the worker too. The capture duration histogram is the single most useful
 * production signal — p95 latency by format/outcome.
 */
export const registry = new Registry();
collectDefaultMetrics({ register: registry });

export const captureCounter = new Counter({
  name: 'thirdeye_captures_total',
  help: 'Total captures attempted',
  labelNames: ['outcome', 'format', 'canvas'] as const,
  registers: [registry],
});

export const captureDuration = new Histogram({
  name: 'thirdeye_capture_duration_seconds',
  help: 'Capture wall-clock duration',
  labelNames: ['format', 'outcome'] as const,
  buckets: [0.5, 1, 2, 3, 5, 8, 13, 21, 34],
  registers: [registry],
});

export const httpRequests = new Counter({
  name: 'thirdeye_http_requests_total',
  help: 'HTTP requests by route and status',
  labelNames: ['method', 'route', 'status'] as const,
  registers: [registry],
});
