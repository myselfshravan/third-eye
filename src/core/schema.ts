import { z } from 'zod';
import { config } from './config.js';

/**
 * The capture contract. This single schema is the source of truth for the API
 * routes, the queue payloads, and the capture engine — there is no second
 * place a field can drift.
 */

export const DEVICE_NAMES = [
  'desktop',
  'desktop-hd',
  'iphone-15',
  'iphone-15-pro-max',
  'iphone-se',
  'pixel-7',
  'galaxy-s23',
  'ipad-pro-11',
  'ipad-mini',
] as const;
export type DeviceName = (typeof DEVICE_NAMES)[number];

export const ImageFormatSchema = z.enum(['png', 'jpeg', 'webp']);
export type ImageFormat = z.infer<typeof ImageFormatSchema>;

export const ResponseTypeSchema = z.enum(['binary', 'base64', 'json']);
export type ResponseType = z.infer<typeof ResponseTypeSchema>;

/**
 * The readiness strategy — *when* we decide the page is done.
 *  - load:           DOM + sync resources (fastest, OK for static/SSR)
 *  - domcontentloaded: HTML parsed (fastest, rarely what you want visually)
 *  - networkidle:    no network for 500ms (good for SPAs)
 *  - auto:           networkidle + fonts.ready + lazy-load scroll + canvas/Flutter
 *                    handling. The default; the "readiness oracle".
 */
export const WaitStrategySchema = z.enum([
  'load',
  'domcontentloaded',
  'networkidle',
  'auto',
]);
export type WaitStrategy = z.infer<typeof WaitStrategySchema>;

const ViewportSchema = z
  .object({
    width: z.number().int().min(16).max(config.limits.maxViewportWidth),
    height: z.number().int().min(16).max(config.limits.maxViewportHeight),
  })
  .strict();

const ClipSchema = z
  .object({
    x: z.number().min(0),
    y: z.number().min(0),
    width: z.number().positive(),
    height: z.number().positive(),
  })
  .strict();

const CaptureOptionsBase = z
  .object({
    url: z.string().url(),

    // ── Output ──────────────────────────────────────────────────────────
    format: ImageFormatSchema.default('png'),
    // 1-100; ignored for png.
    quality: z.number().int().min(1).max(100).optional(),
    fullPage: z.boolean().default(false),
    omitBackground: z.boolean().default(false),
    // Capture a single element matching this CSS selector.
    selector: z.string().min(1).optional(),
    clip: ClipSchema.optional(),
    // Downscale the final image to this width (px), preserving aspect ratio.
    // (Applied by the engine via re-render scale, not post-resize, to stay sharp.)
    pdf: z.boolean().default(false),

    // ── Rendering surface ───────────────────────────────────────────────
    device: z.enum(DEVICE_NAMES).optional(),
    viewport: ViewportSchema.optional(),
    // CSS px ratio. iPhones are 3, most desktops 1-2. Drives image sharpness.
    deviceScaleFactor: z.number().min(0.5).max(4).optional(),
    isMobile: z.boolean().optional(),
    hasTouch: z.boolean().optional(),
    darkMode: z.boolean().optional(),
    reducedMotion: z.boolean().default(true),
    locale: z.string().optional(),
    timezone: z.string().optional(),
    userAgent: z.string().optional(),

    // ── Readiness oracle ────────────────────────────────────────────────
    waitStrategy: WaitStrategySchema.default('auto'),
    // Extra settle delay AFTER the strategy resolves (ms). Capped server-side.
    delayMs: z.number().int().min(0).max(15_000).default(0),
    // Block until this selector appears.
    waitForSelector: z.string().min(1).optional(),
    // Block until this JS expression is truthy (evaluated in page context).
    waitForFunction: z.string().min(1).optional(),
    // Scroll the full page to trigger lazy-loaded content before capture.
    scrollPage: z.boolean().default(true),

    // ── Page manipulation ───────────────────────────────────────────────
    // Hide elements (e.g. cookie banners) by CSS selector before capture.
    hideSelectors: z.array(z.string()).max(50).optional(),
    // Remove elements entirely (display:none) before capture.
    removeSelectors: z.array(z.string()).max(50).optional(),
    // Inject CSS / JS into the page before capture.
    injectCss: z.string().max(20_000).optional(),
    injectJs: z.string().max(20_000).optional(),
    // Block ads/trackers/analytics. Faster + cleaner shots.
    blockAds: z.boolean().default(true),
    blockCookieBanners: z.boolean().default(true),
    // Force the software-WebGL (SwiftShader) browser. Default auto: a fast
    // no-GPU render first, retried with WebGL only if a canvas/Flutter app is
    // detected. Set true to skip straight to WebGL (canvas apps you know need it).
    webgl: z.boolean().optional(),
    // Per-request egress proxy (overrides PROXY_URL). e.g. http://user:pass@host:port
    proxy: z.string().optional(),
    // Throw `upstream_blocked` instead of returning a capture when a bot-wall /
    // challenge page is detected. Default false: we return whatever loaded and
    // flag `blocked` in the metadata.
    failOnBlock: z.boolean().default(false),
    // Extra request headers and cookies for auth'd pages.
    headers: z.record(z.string()).optional(),
    cookies: z
      .array(
        z.object({
          name: z.string(),
          value: z.string(),
          domain: z.string().optional(),
          path: z.string().optional(),
        }),
      )
      .max(50)
      .optional(),
  })
  .strict();

export const CaptureOptionsSchema = CaptureOptionsBase.superRefine((v, ctx) => {
    if (v.clip && v.fullPage) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'clip and fullPage are mutually exclusive',
        path: ['clip'],
      });
    }
    if (v.device && v.viewport) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'device and viewport are mutually exclusive — device implies a viewport',
        path: ['device'],
      });
    }
  });

export type CaptureOptions = z.infer<typeof CaptureOptionsSchema>;

/** Async + sync share the same body; async adds an optional webhook. */
export const AsyncCaptureSchema = CaptureOptionsSchema.and(
  z.object({ webhookUrl: z.string().url().optional() }),
);

export const BulkCaptureSchema = z
  .object({
    urls: z.array(z.string().url()).min(1).max(config.limits.maxBulkUrls),
    // Options applied to every URL in the batch.
    options: CaptureOptionsBase.omit({ url: true }).partial().optional(),
    webhookUrl: z.string().url().optional(),
  })
  .strict();

export type BulkCapture = z.infer<typeof BulkCaptureSchema>;

/**
 * Extraction reuses the full capture surface (device, stealth, waits, proxy)
 * and adds extraction-specific knobs. A superset of CaptureOptions, so it can be
 * handed straight to the shared preparePage()/capture() helpers.
 */
const ExtractOptionsBase = CaptureOptionsBase.extend({
  // Cap the number of product images returned (default from EXTRACT_MAX_IMAGES).
  maxImages: z.number().int().min(1).max(50).optional(),
  // Also capture + return a screenshot of the page alongside the product data.
  includeScreenshot: z.boolean().default(false),
}).strict();

export const ExtractOptionsSchema = ExtractOptionsBase.superRefine((v, ctx) => {
  if (v.device && v.viewport) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'device and viewport are mutually exclusive — device implies a viewport',
      path: ['device'],
    });
  }
});

export type ExtractOptions = z.infer<typeof ExtractOptionsSchema>;

export interface CaptureResult {
  buffer: Buffer;
  contentType: string;
  meta: {
    url: string;
    finalUrl: string;
    width: number;
    height: number;
    format: ImageFormat | 'pdf';
    bytes: number;
    durationMs: number;
    isCanvasApp: boolean; // detected Flutter/CanvasKit/WebGL surface
    httpStatus: number | null;
    blocked: boolean; // bot-wall / challenge page detected
  };
}
