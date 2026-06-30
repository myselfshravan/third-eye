import { Agent, setGlobalDispatcher } from 'undici';

/**
 * Shared keep-alive HTTP dispatcher for all outbound `fetch()` (og + fast-tier
 * extract). A bare `fetch()` opens a fresh TCP + TLS connection per request — at
 * realtime scale over 1000+ PDP hosts that handshake alone is ~100–300ms of dead
 * latency on every call. Pooling connections per origin and keeping them warm
 * amortises it away after the first hit to a host.
 *
 * `setGlobalDispatcher` routes Node's global `fetch` through this pool. It does
 * not touch the AWS SDK (its own http handler) or ioredis/BullMQ.
 */
export const httpAgent = new Agent({
  // Keep idle sockets around long enough to be reused by the next request to the
  // same brand host, but not so long we leak fds.
  keepAliveTimeout: 60_000,
  keepAliveMaxTimeout: 120_000,
  // Generous per-origin connection ceiling for burst traffic to popular brands.
  connections: 128,
  pipelining: 1,
});

setGlobalDispatcher(httpAgent);
