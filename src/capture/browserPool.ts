import { chromium, type Browser, type BrowserContext } from 'playwright';
import genericPool, { type Pool } from 'generic-pool';
import { config } from '../core/config.js';
import { logger } from '../core/logger.js';

/**
 * The browser pool is the reliability core of the service. Headless Chrome eats
 * 150-400MB per instance and leaks under long-running load; left unmanaged it
 * OOMs the host. We therefore:
 *   - keep a fixed pool of warm browsers (no per-request cold start),
 *   - hand each request its own *context* (cookie/storage isolation),
 *   - recycle a browser after N uses (caps leak growth),
 *   - validate liveness and self-heal on crash.
 */

interface PooledBrowser {
  browser: Browser;
  uses: number;
  id: number;
}

/**
 * Launch flags. The WebGL/SwiftShader flags are what make Flutter/CanvasKit and
 * WebGL pages render at all in headless — without a working GL stack the canvas
 * is blank and you "successfully" screenshot an empty page.
 */
function launchArgs(): string[] {
  const args = [
    '--disable-dev-shm-usage', // use /tmp not the tiny /dev/shm (Docker OOM fix)
    '--no-sandbox', // required in most container runtimes
    '--disable-setuid-sandbox',
    '--disable-gpu-sandbox',
    '--no-zygote',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-features=IsolateOrigins,site-per-process',
    '--hide-scrollbars',
    '--mute-audio',
    '--font-render-hinting=none', // deterministic text rendering
  ];
  if (config.browser.enableWebgl) {
    // ANGLE over SwiftShader = software WebGL that works without a real GPU.
    args.push(
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--enable-webgl',
      '--ignore-gpu-blocklist',
    );
  } else {
    args.push('--disable-gpu');
  }
  return args;
}

let counter = 0;

function createPool(): Pool<PooledBrowser> {
  const factory: genericPool.Factory<PooledBrowser> = {
    async create() {
      const id = ++counter;
      const browser = await chromium.launch({
        headless: config.browser.headless,
        args: launchArgs(),
      });
      browser.on('disconnected', () => {
        logger.warn({ browserId: id }, 'browser disconnected');
      });
      logger.info({ browserId: id }, 'browser launched');
      return { browser, uses: 0, id };
    },
    async destroy(pb) {
      try {
        await pb.browser.close();
      } catch (err) {
        logger.warn({ err, browserId: pb.id }, 'error closing browser');
      }
      logger.info({ browserId: pb.id, uses: pb.uses }, 'browser destroyed');
    },
    async validate(pb) {
      return pb.browser.isConnected() && pb.uses < config.browser.maxUses;
    },
  };

  return genericPool.createPool(factory, {
    min: config.browser.poolSize,
    max: config.browser.poolSize,
    testOnBorrow: true,
    acquireTimeoutMillis: 30_000,
    idleTimeoutMillis: 300_000,
    evictionRunIntervalMillis: 60_000,
  });
}

export class BrowserPool {
  private pool: Pool<PooledBrowser>;

  constructor() {
    this.pool = createPool();
  }

  /** Warm the pool to `min` so the first real request isn't a cold start. */
  async warmUp(): Promise<void> {
    const n = config.browser.poolSize;
    const seeds = await Promise.all(
      Array.from({ length: n }, () => this.pool.acquire()),
    );
    await Promise.all(seeds.map((s) => this.pool.release(s)));
    logger.info({ size: n }, 'browser pool warmed');
  }

  /**
   * Run `fn` against a fresh, isolated browser context. Handles acquire,
   * context lifecycle, recycle-after-N, and crash-driven destruction.
   */
  async withContext<T>(
    contextOptions: Parameters<Browser['newContext']>[0],
    fn: (ctx: BrowserContext) => Promise<T>,
  ): Promise<T> {
    const pb = await this.pool.acquire();
    pb.uses += 1;
    let context: BrowserContext | undefined;
    let healthy = true;
    try {
      context = await pb.browser.newContext(contextOptions);
      return await fn(context);
    } catch (err) {
      // A protocol/disconnect error means the browser is suspect — don't reuse.
      if (!pb.browser.isConnected()) healthy = false;
      throw err;
    } finally {
      if (context) {
        await context.close().catch(() => {});
      }
      if (!healthy || pb.uses >= config.browser.maxUses || !pb.browser.isConnected()) {
        await this.pool.destroy(pb).catch(() => {});
      } else {
        await this.pool.release(pb).catch(() => {});
      }
    }
  }

  stats() {
    return {
      size: this.pool.size,
      available: this.pool.available,
      borrowed: this.pool.borrowed,
      pending: this.pool.pending,
      max: this.pool.max,
    };
  }

  async drain(): Promise<void> {
    logger.info('draining browser pool');
    await this.pool.drain();
    await this.pool.clear();
  }
}

// Singleton — one pool per process.
let instance: BrowserPool | null = null;
export function getBrowserPool(): BrowserPool {
  if (!instance) instance = new BrowserPool();
  return instance;
}
