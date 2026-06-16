import { config } from '../core/config.js';
import { logger } from '../core/logger.js';
import { absolutize } from '../extract/normalize.js';
import { looksBlockedHtml } from '../capture/block.js';
import { getBrowserPool } from '../capture/browserPool.js';
import { buildContextOptions } from '../capture/capture.js';
import type { CaptureOptions } from '../core/schema.js';

const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export type OgSource = 'cache' | 'fetch' | 'browser';

/**
 * Parse the `og:image` URL out of raw HTML. Pure + unit-tested. Handles any
 * meta attribute order, `property=` and `name=`, and prefers `og:image:secure_url`.
 */
export function parseOgImage(html: string, baseUrl: string): string | null {
  const metas = html.match(/<meta\b[^>]*>/gi);
  if (!metas) return null;

  const attr = (tag: string, name: string): string | null => {
    const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s">]+))`, 'i'));
    return m ? (m[2] ?? m[3] ?? m[4] ?? null) : null;
  };
  const decode = (s: string) =>
    s
      .replace(/&amp;/gi, '&')
      .replace(/&#0*38;/g, '&')
      .replace(/&quot;/gi, '"')
      .replace(/&#0*47;|&#x2f;/gi, '/');

  let secure: string | null = null;
  let plain: string | null = null;
  for (const tag of metas) {
    const key = (attr(tag, 'property') ?? attr(tag, 'name') ?? '').toLowerCase();
    if (!key.startsWith('og:image')) continue;
    const content = attr(tag, 'content');
    if (!content) continue;
    if (key === 'og:image:secure_url') secure ??= decode(content);
    else if (key === 'og:image' || key === 'og:image:url') plain ??= decode(content);
  }
  const chosen = secure ?? plain;
  return chosen ? absolutize(chosen, baseUrl) : null;
}

/**
 * Fast path: plain HTTP fetch, streamed and aborted as soon as og:image is found
 * (or </head> / byte cap is hit) — so latency ≈ TTFB + first chunk, never the
 * whole page. No browser involved.
 */
async function fetchOgImage(url: string): Promise<{ image: string | null; blocked: boolean }> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), config.og.fetchTimeoutMs);
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: ac.signal,
      headers: { 'user-agent': CHROME_UA, accept: 'text/html,application/xhtml+xml,*/*' },
    });
    const finalUrl = res.url || url;

    if (!res.body) {
      const text = await res.text().catch(() => '');
      return { image: parseOgImage(text, finalUrl), blocked: looksBlockedHtml(text, res.status) };
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let html = '';
    let bytes = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        html += decoder.decode(value, { stream: true });
        if (parseOgImage(html, finalUrl)) break; // found it — stop early
        if (/<\/head>/i.test(html) || bytes >= config.og.maxBytes) break;
      }
    } finally {
      ac.abort(); // stop downloading the remainder
    }

    const image = parseOgImage(html, finalUrl);
    return { image, blocked: !image && looksBlockedHtml(html, res.status) };
  } catch (err) {
    logger.debug({ err: String(err), url }, 'og fast fetch failed');
    return { image: null, blocked: true }; // network/timeout → let the browser try
  } finally {
    clearTimeout(timer);
  }
}

/** Fallback: lean browser read (no readiness oracle) for blocked / no-og sites. */
async function browserOgImage(url: string): Promise<string | null> {
  return getBrowserPool().withContext(
    buildContextOptions({ url } as CaptureOptions),
    async (context) => {
      const page = await context.newPage();
      await page
        .goto(url, { waitUntil: 'domcontentloaded', timeout: config.browser.navTimeoutMs })
        .catch(() => {});
      const finalUrl = page.url();
      const content = await page
        .evaluate(() => {
          const pick = (sel: string) =>
            document.querySelector(sel)?.getAttribute('content') ?? null;
          return (
            pick('meta[property="og:image:secure_url"]') ||
            pick('meta[property="og:image"]') ||
            pick('meta[name="og:image"]') ||
            null
          );
        })
        .catch(() => null);
      return content ? absolutize(content, finalUrl) : null;
    },
  );
}

// ── TTL + LRU cache (key-agnostic: og:image depends only on the URL) ──────────
interface Entry {
  image: string | null;
  expires: number;
}
const cache = new Map<string, Entry>();

function normalizeKey(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    return u.toString();
  } catch {
    return url;
  }
}
function cacheGet(key: string): Entry | undefined {
  const e = cache.get(key);
  if (!e) return undefined;
  if (Date.now() > e.expires) {
    cache.delete(key);
    return undefined;
  }
  cache.delete(key); // re-insert to mark as most-recently-used
  cache.set(key, e);
  return e;
}
function cacheSet(key: string, image: string | null): void {
  const ttl = (image ? config.og.cacheTtlSeconds : config.og.negativeTtlSeconds) * 1000;
  cache.set(key, { image, expires: Date.now() + ttl });
  while (cache.size > config.og.cacheMax) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/**
 * Orchestrator: cache → fast HTTP → (on miss/blocked) browser fallback.
 * Returns the og:image URL (or null) and which tier produced it.
 */
export async function getOgImage(url: string): Promise<{ image: string | null; source: OgSource }> {
  const key = normalizeKey(url);
  const cached = cacheGet(key);
  if (cached) return { image: cached.image, source: 'cache' };

  const fast = await fetchOgImage(url);
  if (fast.image) {
    cacheSet(key, fast.image);
    return { image: fast.image, source: 'fetch' };
  }

  if (fast.blocked && config.og.browserFallback) {
    const image = await browserOgImage(url).catch(() => null);
    cacheSet(key, image);
    return { image, source: 'browser' };
  }

  cacheSet(key, null);
  return { image: null, source: 'fetch' };
}
