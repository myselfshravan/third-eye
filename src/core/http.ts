import { Agent, setGlobalDispatcher } from 'undici';

// Keep-alive pool for outbound fetch() (og + fast-tier), so we don't pay a fresh
// TCP+TLS handshake per request to a PDP host.
export const httpAgent = new Agent({
  keepAliveTimeout: 60_000,
  keepAliveMaxTimeout: 120_000,
  connections: 128,
  pipelining: 1,
});

setGlobalDispatcher(httpAgent);
