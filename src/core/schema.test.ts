import { describe, it, expect } from 'vitest';
import { CaptureOptionsSchema, BulkCaptureSchema } from './schema.js';

describe('CaptureOptionsSchema', () => {
  it('accepts a minimal valid request and applies defaults', () => {
    const parsed = CaptureOptionsSchema.parse({ url: 'https://example.com' });
    expect(parsed.format).toBe('png');
    expect(parsed.waitStrategy).toBe('auto');
    expect(parsed.fullPage).toBe(false);
    expect(parsed.blockAds).toBe(true);
  });

  it('rejects a non-URL', () => {
    expect(() => CaptureOptionsSchema.parse({ url: 'not-a-url' })).toThrow();
  });

  it('rejects unknown keys (strict contract)', () => {
    expect(() => CaptureOptionsSchema.parse({ url: 'https://x.com', bogus: 1 })).toThrow();
  });

  it('rejects clip + fullPage together', () => {
    expect(() =>
      CaptureOptionsSchema.parse({
        url: 'https://x.com',
        fullPage: true,
        clip: { x: 0, y: 0, width: 10, height: 10 },
      }),
    ).toThrow(/mutually exclusive/);
  });

  it('rejects device + viewport together', () => {
    expect(() =>
      CaptureOptionsSchema.parse({
        url: 'https://x.com',
        device: 'iphone-15',
        viewport: { width: 100, height: 100 },
      }),
    ).toThrow(/mutually exclusive/);
  });
});

describe('BulkCaptureSchema', () => {
  it('requires at least one URL', () => {
    expect(() => BulkCaptureSchema.parse({ urls: [] })).toThrow();
  });

  it('accepts shared options', () => {
    const parsed = BulkCaptureSchema.parse({
      urls: ['https://a.com', 'https://b.com'],
      options: { fullPage: true, device: 'desktop-hd' },
    });
    expect(parsed.urls).toHaveLength(2);
    expect(parsed.options?.fullPage).toBe(true);
  });
});
