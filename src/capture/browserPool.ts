import { type Browser, type BrowserContext } from 'playwright';
import genericPool, { type Pool } from 'generic-pool';
import { config } from '../core/config.js';
import { logger } from '../core/logger.js';
import { browserEngine, engineName } from './engine.js';

/**
 * The browser pool is the reliability core of the service. Headless Chrome eats
 * 150-400MB per instance and leaks under long-running load; left unmanaged it
 * OOMs the host. We therefore:
 *   - keep a fixed pool of warm browsers (no per-request cold start),
 *   - hand each request its own *context* (cookie/storage isolation),
 *   - recycle a browser after N uses (caps leak growth),
 *   - validate liveness and self-heal on crash.
 *
 * There are TWO pools, keyed by GL mode:
 *   - default (no-GPU): CPU raster — fast 2D rendering for normal DOM pages.
 *   - webgl (SwiftShader): software WebGL so Flutter/CanvasKit/WebGL render at
 *     all — but ~10x slower to screenshot. Created lazily, only for canvas apps.
 */

interface PooledBrowser {
  browser: Browser;
  uses: number;
  id: number;
}

function launchArgs(webgl: boolean): string[] {
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
    // Hide the most obvious automation tell at the renderer level. Patchright
    // also strips this and the Runtime.enable CDP leak at the binary level.
    '--disable-blink-features=AutomationControlled',
  ];
  if (webgl) {
    // ANGLE over SwiftShader = software WebGL that works without a real GPU.
    // Needed for canvas/Flutter, but ~10x slower to composite — opt-in only.
    args.push(
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--enable-webgl',
      '--ignore-gpu-blocklist',
    );
  } else {
    args.push('--disable-gpu'); // CPU raster — fast for normal pages
  }
  return args;
}

let counter = 0;

function createPool(webgl: boolean, warm: boolean): Pool<PooledBrowser> {
  const factory: genericPool.Factory<PooledBrowser> = {
    async create() {
      const id = ++counter;
      const browser = await browserEngine.launch({
        headless: config.browser.headless,
        args: launchArgs(webgl),
        ...(config.browser.channel ? { channel: config.browser.channel } : {}),
        ...(config.browser.proxyUrl ? { proxy: { server: config.browser.proxyUrl } } : {}),
      });
      browser.on('disconnected', () => logger.warn({ browserId: id, webgl }, 'browser disconnected'));
      logger.info({ browserId: id, engine: engineName, webgl }, 'browser launched');
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
    min: warm ? config.browser.poolSize : 0, // webgl pool is lazy (cold)
    max: config.browser.poolSize,
    testOnBorrow: true,
    acquireTimeoutMillis: 30_000,
    idleTimeoutMillis: 300_000,
    evictionRunIntervalMillis: 60_000,
  });
}

export class BrowserPool {
  private pool: Pool<PooledBrowser>;

  constructor(
    private readonly webgl: boolean,
    warm: boolean,
  ) {
    this.pool = createPool(webgl, warm);
  }

  /** Warm the pool to `min` so the first real request isn't a cold start. */
  async warmUp(): Promise<void> {
    const n = config.browser.poolSize;
    const seeds = await Promise.all(Array.from({ length: n }, () => this.pool.acquire()));
    await Promise.all(seeds.map((s) => this.pool.release(s)));
    logger.info({ size: n, webgl: this.webgl }, 'browser pool warmed');
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
      if (!pb.browser.isConnected()) healthy = false;
      throw err;
    } finally {
      if (context) await context.close().catch(() => {});
      if (!healthy || pb.uses >= config.browser.maxUses || !pb.browser.isConnected()) {
        await this.pool.destroy(pb).catch(() => {});
      } else {
        await this.pool.release(pb).catch(() => {});
      }
    }
  }

  stats() {
    return {
      webgl: this.webgl,
      size: this.pool.size,
      available: this.pool.available,
      borrowed: this.pool.borrowed,
      pending: this.pool.pending,
      max: this.pool.max,
    };
  }

  async drain(): Promise<void> {
    logger.info({ webgl: this.webgl }, 'draining browser pool');
    await this.pool.drain();
    await this.pool.clear();
  }
}

// One pool per GL mode. Default (no-GPU) is warm; webgl is lazy (canvas-only).
const pools = new Map<boolean, BrowserPool>();

export function getBrowserPool(webgl = false): BrowserPool {
  let p = pools.get(webgl);
  if (!p) {
    p = new BrowserPool(webgl, /* warm */ !webgl);
    pools.set(webgl, p);
  }
  return p;
}

export async function drainAllPools(): Promise<void> {
  await Promise.all([...pools.values()].map((p) => p.drain()));
}
