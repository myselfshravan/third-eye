import type { Page } from 'playwright';
import type { ProductImage } from './types.js';
import { absolutize } from './normalize.js';

/**
 * Shopify fast-path. Every Shopify product has a JSON endpoint at
 * `<product-url>.json` exposing images, title, vendor, and variants. We fetch
 * it *through the browser context* (`page.request`), so it inherits the same
 * cookies/stealth as the page — far more reliable than DOM scraping. A huge
 * share of D2C fashion (incl. most Indian labels) is Shopify.
 */

export interface ShopifyResult {
  title?: string;
  brand?: string;
  description?: string;
  price?: number;
  currency?: string;
  sizes?: string[];
  images: ProductImage[];
  matched: boolean;
}

const SHOPIFY_PATH = /\/products\/[^/]+/;

export function isShopifyProductUrl(url: string): boolean {
  try {
    return SHOPIFY_PATH.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

export async function extractShopify(page: Page, finalUrl: string): Promise<ShopifyResult> {
  const empty: ShopifyResult = { images: [], matched: false };
  if (!isShopifyProductUrl(finalUrl)) return empty;

  let u: URL;
  try {
    u = new URL(finalUrl);
  } catch {
    return empty;
  }
  // Strip query/hash, append .json to the /products/<handle> path.
  const handlePath = (u.pathname.match(/^.*\/products\/[^/]+/)?.[0] ?? u.pathname).replace(/\/$/, '');
  const jsonUrl = `${u.origin}${handlePath}.json`;

  try {
    const resp = await page.request.get(jsonUrl, { timeout: 10_000 });
    if (!resp.ok()) return empty;
    const body = (await resp.json()) as { product?: ShopifyProduct };
    const p = body.product;
    if (!p) return empty;

    const images: ProductImage[] = (p.images ?? [])
      .map((img) => absolutize(typeof img === 'string' ? img : img.src, finalUrl))
      .filter((x): x is string => !!x)
      .map((url) => ({ url, source: 'shopify' as const }));

    const variant = p.variants?.[0];
    const sizes = uniqueSizes(p);

    return {
      matched: true,
      title: p.title,
      brand: p.vendor,
      description: p.body_html ? stripHtml(p.body_html) : undefined,
      price: variant?.price != null ? Number(variant.price) : undefined,
      sizes: sizes.length ? sizes : undefined,
      images,
    };
  } catch {
    return empty;
  }
}

interface ShopifyProduct {
  title?: string;
  vendor?: string;
  body_html?: string;
  options?: { name: string; values: string[] }[];
  variants?: { price?: string | number; option1?: string }[];
  images?: (string | { src: string })[];
}

function uniqueSizes(p: ShopifyProduct): string[] {
  const sizeOpt = p.options?.find((o) => /size/i.test(o.name));
  if (sizeOpt?.values?.length) return sizeOpt.values;
  // Fallback: distinct option1 across variants.
  const set = new Set<string>();
  p.variants?.forEach((v) => v.option1 && set.add(v.option1));
  return [...set];
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 2000);
}
