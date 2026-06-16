import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { config, type Plan } from '../core/config.js';
import { Errors } from '../core/errors.js';

declare module 'fastify' {
  interface FastifyRequest {
    apiKey?: string;
    plan?: Plan;
  }
}

const keyMap = new Map(config.auth.keys.map((k) => [k.key, k.plan]));

/**
 * API-key auth via the `x-api-key` header (or `Authorization: Bearer <key>`).
 * Keys carry a plan that drives rate limits downstream. When no keys are
 * configured (dev), auth is disabled and everyone is `unlimited`.
 */
function extractKey(req: FastifyRequest): string | undefined {
  const header = req.headers['x-api-key'];
  if (typeof header === 'string' && header) return header;
  const auth = req.headers.authorization;
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) return auth.slice(7);
  return undefined;
}

const plugin: FastifyPluginAsync = async (app) => {
  app.decorateRequest('apiKey', undefined);
  app.decorateRequest('plan', undefined);

  app.addHook('onRequest', async (req) => {
    // Public, unauthenticated endpoints.
    const url = req.url.split('?')[0] ?? '';
    if (['/healthz', '/readyz', '/metrics', '/'].includes(url)) return;

    if (!config.auth.enabled) {
      req.apiKey = 'dev';
      req.plan = 'unlimited';
      return;
    }
    const key = extractKey(req);
    if (!key || !keyMap.has(key)) throw Errors.unauthorized();
    req.apiKey = key;
    req.plan = keyMap.get(key)!;
  });
};

export const authPlugin = fp(plugin, { name: 'auth' });
