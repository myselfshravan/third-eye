import { config } from '../core/config.js';
import { logger } from '../core/logger.js';
import { looksBlockedHtml } from '../capture/block.js';
import { dedupeImages } from './normalize.js';
import { readSignalsFromHtml, parseSignals } from './structured.js';
import { extractNextProductObject, nextProductToData } from './nextflight.js';
import { shopifyJsonUrl, parseShopifyJson } from './shopify.js';
import type { ImageSource, ProductData, ProductImage } from './types.js';

/**
 * Plain-HTTP extraction (no browser). Most commerce PDPs server-render the data
 * we need — JSON-LD, OpenGraph, Shopify `.json`, or the Next.js RSC flight — and
 * a clean HTTP client passes bot walls that fingerprint/block the headless
 * browser (e.g. ABFRL's Cloudflare). So we try this first; the browser is the
 * fallback for true JS-rendered SPAs.
 */

const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const MAX_HTML_BYTES = 3_000_000;

const SOURCE_RANK: Record<ImageSource, number> = {
  shopify: 0,
  nextflight: 1,
  jsonld: 2,
  og: 3,
  microdata: 4,
  dom: 5,
};
const first = <T>(...vals: (T | undefined)[]): T | undefined => vals.find((v) => v != null);
function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

async function fetchText(url: string): Promise<{ html: string; finalUrl: string; status: number } | null> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), config.browser.navTimeoutMs);
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: ac.signal,
      headers: {
        'user-agent': CHROME_UA,
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'en-IN,en;q=0.9',
      },
    });
    const finalUrl = res.url || url;
    const reader = res.body?.getReader();
    if (!reader) return { html: await res.text().catch(() => ''), finalUrl, status: res.status };
    const decoder = new TextDecoder('utf-8');
    let html = '';
    let bytes = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      html += decoder.decode(value, { stream: true });
      if (bytes >= MAX_HTML_BYTES) {
        ac.abort();
        break;
      }
    }
    return { html, finalUrl, status: res.status };
  } catch (err) {
    logger.debug({ err: String(err), url }, 'fast fetch failed');
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function fetchShopify(finalUrl: string) {
  const jsonUrl = shopifyJsonUrl(finalUrl);
  if (!jsonUrl) return null;
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 10_000);
    const res = await fetch(jsonUrl, { signal: ac.signal, headers: { 'user-agent': CHROME_UA } });
    clearTimeout(t);
    if (!res.ok) return null;
    return parseShopifyJson((await res.json()) as { product?: never }, finalUrl);
  } catch {
    return null;
  }
}

/**
 * Try to extract a product with no browser. Returns null when the page yields
 * nothing useful (or is blocked even to a plain client) → caller falls back to
 * the browser.
 */
export async function fastExtract(
  url: string,
  maxImages: number,
): Promise<ProductData | null> {
  const startedAt = Date.now();
  const fetched = await fetchText(url);
  if (!fetched) return null;
  const { html, finalUrl, status } = fetched;
  if (status >= 400 && looksBlockedHtml(html, status)) return null; // let the browser try

  const structured = parseSignals(readSignalsFromHtml(html), finalUrl);

  // Next.js RSC (ABFRL et al). Image host derived from the og:image we already have.
  const imageHost = hostOf(structured.images.find((i) => i.source === 'og')?.url);
  const nextObj = extractNextProductObject(html);
  const next = nextObj ? nextProductToData(nextObj, imageHost) : null;

  const shopify = await fetchShopify(finalUrl);

  const allImages: ProductImage[] = [
    ...(shopify?.images ?? []),
    ...(next?.images ?? []).map((u) => ({ url: u, source: 'nextflight' as const })),
    ...structured.images,
  ].sort((a, b) => SOURCE_RANK[a.source] - SOURCE_RANK[b.source]);
  const images = dedupeImages(allImages, maxImages);

  const title = first(shopify?.title, next?.title, structured.title);
  // Nothing usable → defer to the browser fallback.
  if (!images.length && !title) return null;

  const sources = [...new Set(images.map((i) => i.source))];
  const confidence: ProductData['confidence'] =
    shopify?.matched || structured.hadJsonLd || next
      ? 'high'
      : sources.some((s) => s === 'og' || s === 'microdata')
        ? 'medium'
        : 'low';

  return {
    url,
    finalUrl,
    title,
    brand: first(shopify?.brand, next?.brand, structured.brand),
    description: first(structured.description, next?.description, shopify?.description),
    sku: structured.sku,
    price: first(shopify?.price, next?.price, structured.price),
    currency: first(structured.currency, next?.currency, shopify?.currency),
    availability: structured.availability,
    color: first(structured.color, next?.color),
    sizes: first(shopify?.sizes, next?.sizes, structured.sizes),
    images,
    primaryImage: images[0]?.url,
    confidence,
    sources,
    blocked: false,
    httpStatus: status,
    durationMs: Date.now() - startedAt,
  };
}
