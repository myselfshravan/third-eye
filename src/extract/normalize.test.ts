import { describe, it, expect } from 'vitest';
import { absolutize, bestFromSrcset, imageKey, looksLikeProductImage, dedupeImages } from './normalize.js';
import type { ProductImage } from './types.js';

const base = 'https://shop.example.com/products/tee';

describe('absolutize', () => {
  it('resolves relative and protocol-relative URLs', () => {
    expect(absolutize('/img/a.jpg', base)).toBe('https://shop.example.com/img/a.jpg');
    expect(absolutize('//cdn.example.com/a.jpg', base)).toBe('https://cdn.example.com/a.jpg');
    expect(absolutize('https://x.com/a.jpg', base)).toBe('https://x.com/a.jpg');
  });
  it('rejects data URIs and empties', () => {
    expect(absolutize('data:image/png;base64,xxx', base)).toBeNull();
    expect(absolutize('', base)).toBeNull();
    expect(absolutize(undefined, base)).toBeNull();
  });
});

describe('bestFromSrcset', () => {
  it('picks the highest-width candidate', () => {
    const ss = '/a-200.jpg 200w, /a-800.jpg 800w, /a-400.jpg 400w';
    expect(bestFromSrcset(ss, base)).toBe('https://shop.example.com/a-800.jpg');
  });
  it('weights x descriptors above small w', () => {
    const ss = '/a.jpg 1x, /a2.jpg 2x';
    expect(bestFromSrcset(ss, base)).toBe('https://shop.example.com/a2.jpg');
  });
});

describe('imageKey', () => {
  it('collapses size variants and query strings', () => {
    const a = imageKey('https://cdn.com/p/shirt_800x800.jpg?v=123');
    const b = imageKey('https://cdn.com/p/shirt_200x200.jpg?v=999');
    expect(a).toBe(b);
  });
});

describe('looksLikeProductImage', () => {
  it('rejects logos, sprites, svgs, data URIs', () => {
    expect(looksLikeProductImage('https://x.com/logo.png')).toBe(false);
    expect(looksLikeProductImage('https://x.com/sprite-icons.png')).toBe(false);
    expect(looksLikeProductImage('https://x.com/a.svg')).toBe(false);
    expect(looksLikeProductImage('data:image/png;base64,x')).toBe(false);
  });
  it('accepts plausible product photos', () => {
    expect(looksLikeProductImage('https://cdn.com/products/shirt-front.jpg')).toBe(true);
  });
});

describe('dedupeImages', () => {
  it('dedupes by normalized key and caps at maxImages, keeping first-seen order', () => {
    const imgs: ProductImage[] = [
      { url: 'https://cdn.com/p/a_800x.jpg', source: 'shopify' },
      { url: 'https://cdn.com/p/a_200x.jpg', source: 'og' }, // dup of first
      { url: 'https://cdn.com/p/b.jpg', source: 'jsonld' },
      { url: 'https://cdn.com/logo.png', source: 'dom' }, // filtered out
      { url: 'https://cdn.com/p/c.jpg', source: 'dom' },
    ];
    const out = dedupeImages(imgs, 2);
    expect(out).toHaveLength(2);
    expect(out[0]!.url).toContain('a_800x');
    expect(out[1]!.url).toContain('b.jpg');
  });
});
