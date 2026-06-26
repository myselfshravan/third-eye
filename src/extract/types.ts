/**
 * Product extraction output. The whole point of third-eye: given a commerce PDP
 * URL, return the actual product image(s) + structured data, not just a PNG of
 * the page. Designed to feed a downstream similar-image-search pipeline.
 */

export type ImageSource = 'jsonld' | 'og' | 'shopify' | 'dom' | 'microdata' | 'nextflight';

export interface ProductImage {
  url: string;
  width?: number;
  height?: number;
  alt?: string;
  source: ImageSource;
}

export interface ProductData {
  url: string;
  finalUrl: string;
  title?: string;
  brand?: string;
  description?: string;
  sku?: string;
  price?: number;
  currency?: string;
  availability?: string;
  color?: string;
  sizes?: string[];
  /** Ranked, deduped, absolute product images. */
  images: ProductImage[];
  /** The single best image (first of `images`). */
  primaryImage?: string;
  /** high = JSON-LD/Shopify structured data; medium = OG/microdata; low = DOM heuristics only. */
  confidence: 'high' | 'medium' | 'low';
  /** Which extractors contributed (for debugging/observability). */
  sources: ImageSource[];
  blocked: boolean;
  httpStatus: number | null;
  durationMs: number;
}

/** A product card on a listing (PLP) page. */
export interface ProductCard {
  url: string;
  image?: string;
  title?: string;
  price?: number;
  currency?: string;
}

export interface ListingData {
  url: string;
  finalUrl: string;
  products: ProductCard[];
  count: number;
  blocked: boolean;
  httpStatus: number | null;
  durationMs: number;
}
