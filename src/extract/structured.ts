import type { Page } from 'playwright';
import type { ProductImage } from './types.js';
import { absolutize } from './normalize.js';

/**
 * Structured-data extraction: the highest-confidence source. Priority is
 * JSON-LD `Product` → OpenGraph → microdata. We read the raw signals in-page
 * (cheap DOM access) and parse JSON-LD tolerantly in Node (real PDPs ship
 * malformed JSON-LD — trailing commas, template artefacts).
 */

export interface StructuredResult {
  title?: string;
  brand?: string;
  description?: string;
  sku?: string;
  price?: number;
  currency?: string;
  availability?: string;
  color?: string;
  sizes?: string[];
  images: ProductImage[];
  hadJsonLd: boolean;
}

interface RawSignals {
  jsonld: string[];
  og: Record<string, string>;
  micro: { image?: string; name?: string; price?: string; brand?: string; sku?: string };
}

async function readSignals(page: Page): Promise<RawSignals> {
  return page.evaluate(() => {
    const jsonld = Array.from(
      document.querySelectorAll('script[type="application/ld+json"]'),
    ).map((s) => s.textContent ?? '');

    const og: Record<string, string> = {};
    document.querySelectorAll('meta[property], meta[name]').forEach((m) => {
      const key = (m.getAttribute('property') || m.getAttribute('name') || '').toLowerCase();
      const content = m.getAttribute('content');
      if (content && (key.startsWith('og:') || key.startsWith('product:') || key.startsWith('twitter:'))) {
        // keep the first occurrence for single keys; collect og:image specially below
        if (!(key in og)) og[key] = content;
      }
    });
    // og:image can repeat — capture all into a synthetic newline-joined value.
    const ogImages = Array.from(document.querySelectorAll('meta[property="og:image"]'))
      .map((m) => m.getAttribute('content') || '')
      .filter(Boolean);
    if (ogImages.length) og['og:image'] = ogImages.join('\n');

    const micro: RawSignals['micro'] = {};
    const scope = document.querySelector('[itemtype*="Product" i]');
    if (scope) {
      const prop = (name: string) =>
        scope.querySelector(`[itemprop="${name}"]`) as HTMLElement | null;
      const img = prop('image') as HTMLImageElement | null;
      micro.image = img?.getAttribute('content') || img?.getAttribute('src') || undefined;
      micro.name = prop('name')?.textContent?.trim() || undefined;
      micro.price =
        (prop('price') as HTMLElement | null)?.getAttribute('content') ||
        prop('price')?.textContent?.trim() ||
        undefined;
      micro.sku = prop('sku')?.textContent?.trim() || undefined;
      micro.brand = prop('brand')?.textContent?.trim() || undefined;
    }
    return { jsonld, og, micro };
  });
}

/** Tolerant JSON parse — strips trailing commas that break real-world JSON-LD. */
function parseLoose(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    try {
      return JSON.parse(raw.replace(/,\s*([}\]])/g, '$1'));
    } catch {
      return null;
    }
  }
}

function typeIncludes(node: { '@type'?: unknown }, t: string): boolean {
  const ty = node['@type'];
  if (typeof ty === 'string') return ty.toLowerCase() === t.toLowerCase();
  if (Array.isArray(ty)) return ty.some((x) => String(x).toLowerCase() === t.toLowerCase());
  return false;
}

/** Flatten JSON-LD payloads (arrays, @graph) into a node list. */
function collectNodes(parsed: unknown, acc: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (!parsed) return acc;
  if (Array.isArray(parsed)) {
    parsed.forEach((p) => collectNodes(p, acc));
  } else if (typeof parsed === 'object') {
    const node = parsed as Record<string, unknown>;
    acc.push(node);
    if (Array.isArray(node['@graph'])) collectNodes(node['@graph'], acc);
  }
  return acc;
}

function imagesFromJsonLd(value: unknown, base: string): string[] {
  const out: string[] = [];
  const push = (v: unknown) => {
    if (typeof v === 'string') {
      const u = absolutize(v, base);
      if (u) out.push(u);
    } else if (v && typeof v === 'object') {
      const url = (v as Record<string, unknown>).url ?? (v as Record<string, unknown>).contentUrl;
      if (typeof url === 'string') {
        const u = absolutize(url, base);
        if (u) out.push(u);
      }
    }
  };
  if (Array.isArray(value)) value.forEach(push);
  else push(value);
  return out;
}

function firstOffer(offers: unknown): Record<string, unknown> | null {
  if (!offers) return null;
  if (Array.isArray(offers)) return (offers[0] as Record<string, unknown>) ?? null;
  if (typeof offers === 'object') return offers as Record<string, unknown>;
  return null;
}

export async function extractStructured(page: Page, base: string): Promise<StructuredResult> {
  const { jsonld, og, micro } = await readSignals(page);
  const result: StructuredResult = { images: [], hadJsonLd: false };

  // ── JSON-LD Product (highest confidence) ──────────────────────────────────
  const nodes = jsonld.flatMap((raw) => collectNodes(parseLoose(raw)));
  const product = nodes.find((n) => typeIncludes(n, 'Product'));
  if (product) {
    result.hadJsonLd = true;
    if (typeof product.name === 'string') result.title = product.name;
    if (typeof product.description === 'string') result.description = product.description;
    if (typeof product.sku === 'string') result.sku = product.sku;
    if (typeof product.color === 'string') result.color = product.color;
    const brand = product.brand;
    result.brand =
      typeof brand === 'string'
        ? brand
        : (brand && typeof brand === 'object'
            ? (((brand as Record<string, unknown>).name as string) ?? undefined)
            : undefined);
    for (const u of imagesFromJsonLd(product.image, base)) {
      result.images.push({ url: u, source: 'jsonld' });
    }
    const offer = firstOffer(product.offers);
    if (offer) {
      const price = offer.price ?? offer.lowPrice ??
        (offer.priceSpecification as Record<string, unknown> | undefined)?.price;
      if (price != null && !Number.isNaN(Number(price))) result.price = Number(price);
      if (typeof offer.priceCurrency === 'string') result.currency = offer.priceCurrency;
      if (typeof offer.availability === 'string')
        result.availability = offer.availability.replace(/^https?:\/\/schema\.org\//i, '');
    }
  }

  // ── OpenGraph / Twitter (medium confidence fallback) ─────────────────────
  if (!result.title && og['og:title']) result.title = og['og:title'];
  if (!result.description && og['og:description']) result.description = og['og:description'];
  if (!result.price && og['product:price:amount'] && !Number.isNaN(Number(og['product:price:amount'])))
    result.price = Number(og['product:price:amount']);
  if (!result.currency && og['product:price:currency']) result.currency = og['product:price:currency'];
  if (og['og:image']) {
    for (const raw of og['og:image'].split('\n')) {
      const u = absolutize(raw, base);
      if (u) result.images.push({ url: u, source: 'og' });
    }
  }
  const twImg = og['twitter:image'] ?? og['twitter:image:src'];
  if (twImg) {
    const u = absolutize(twImg, base);
    if (u) result.images.push({ url: u, source: 'og' });
  }

  // ── Microdata (last-resort structured) ───────────────────────────────────
  if (!result.title && micro.name) result.title = micro.name;
  if (!result.brand && micro.brand) result.brand = micro.brand;
  if (!result.sku && micro.sku) result.sku = micro.sku;
  if (!result.price && micro.price && !Number.isNaN(Number(micro.price))) result.price = Number(micro.price);
  if (micro.image) {
    const u = absolutize(micro.image, base);
    if (u) result.images.push({ url: u, source: 'microdata' });
  }

  return result;
}
