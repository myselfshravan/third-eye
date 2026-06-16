import sharp from 'sharp';
import type { ImageFormat } from '../core/schema.js';

/**
 * Output encoding. Playwright emits PNG/JPEG natively from the compositor;
 * anything else is transcoded here. To add a format: extend `ImageFormat` in
 * the schema and add an encoder below — capture.ts needs no changes.
 */

export type OutputFormat = ImageFormat | 'pdf';

export function contentTypeFor(format: OutputFormat): string {
  switch (format) {
    case 'png':
      return 'image/png';
    case 'jpeg':
      return 'image/jpeg';
    case 'webp':
      return 'image/webp';
    case 'pdf':
      return 'application/pdf';
  }
}

export interface EncodedImage {
  out: Buffer;
  width: number;
  height: number;
}

/**
 * Per-format transcoders. `null` means "already in the right bytes from the
 * browser" (PNG/JPEG) — we only read back dimensions in that case.
 */
const TRANSCODERS: Record<ImageFormat, ((buf: Buffer, quality?: number) => Promise<Buffer>) | null> = {
  png: null,
  jpeg: null,
  webp: (buf, quality) => sharp(buf).webp({ quality: quality ?? 80 }).toBuffer(),
};

async function dimensions(buf: Buffer): Promise<{ width: number; height: number }> {
  const meta = await sharp(buf).metadata().catch(() => ({ width: 0, height: 0 }));
  return { width: meta.width ?? 0, height: meta.height ?? 0 };
}

export async function encodeImage(
  raw: Buffer,
  format: ImageFormat,
  quality?: number,
): Promise<EncodedImage> {
  const transcode = TRANSCODERS[format];
  const out = transcode ? await transcode(raw, quality) : raw;
  const { width, height } = await dimensions(out);
  return { out, width, height };
}
