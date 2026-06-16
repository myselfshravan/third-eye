import { describe, it, expect } from 'vitest';
import { parseOgImage } from './og.js';

const BASE = 'https://shop.example.com/products/tee';

describe('parseOgImage', () => {
  it('extracts a basic og:image (property=…content=)', () => {
    const html = `<head><meta property="og:image" content="https://cdn.x.com/a.jpg"></head>`;
    expect(parseOgImage(html, BASE)).toBe('https://cdn.x.com/a.jpg');
  });

  it('handles reversed attribute order (content=…property=)', () => {
    const html = `<meta content="https://cdn.x.com/b.jpg" property="og:image" />`;
    expect(parseOgImage(html, BASE)).toBe('https://cdn.x.com/b.jpg');
  });

  it('accepts name= as well as property=', () => {
    const html = `<meta name="og:image" content="https://cdn.x.com/c.jpg">`;
    expect(parseOgImage(html, BASE)).toBe('https://cdn.x.com/c.jpg');
  });

  it('prefers og:image:secure_url over og:image', () => {
    const html = `
      <meta property="og:image" content="http://cdn.x.com/plain.jpg">
      <meta property="og:image:secure_url" content="https://cdn.x.com/secure.jpg">`;
    expect(parseOgImage(html, BASE)).toBe('https://cdn.x.com/secure.jpg');
  });

  it('resolves relative + protocol-relative URLs against the base', () => {
    expect(parseOgImage(`<meta property="og:image" content="/img/a.jpg">`, BASE)).toBe(
      'https://shop.example.com/img/a.jpg',
    );
    expect(parseOgImage(`<meta property="og:image" content="//cdn.x.com/a.jpg">`, BASE)).toBe(
      'https://cdn.x.com/a.jpg',
    );
  });

  it('decodes &amp; in the URL', () => {
    const html = `<meta property="og:image" content="https://cdn.x.com/a.jpg?w=10&amp;h=20">`;
    expect(parseOgImage(html, BASE)).toBe('https://cdn.x.com/a.jpg?w=10&h=20');
  });

  it('handles single-quoted attributes', () => {
    const html = `<meta property='og:image' content='https://cdn.x.com/d.jpg'>`;
    expect(parseOgImage(html, BASE)).toBe('https://cdn.x.com/d.jpg');
  });

  it('returns null when there is no og:image', () => {
    expect(parseOgImage(`<head><title>hi</title></head>`, BASE)).toBeNull();
    expect(parseOgImage(`<meta name="description" content="x">`, BASE)).toBeNull();
  });

  it('ignores data: and unparseable content', () => {
    expect(parseOgImage(`<meta property="og:image" content="data:image/png;base64,xx">`, BASE)).toBeNull();
  });
});
