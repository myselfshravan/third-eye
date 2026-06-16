import { config as loadEnv } from 'dotenv';
import { z } from 'zod';

loadEnv();

/**
 * Centralised, validated runtime configuration.
 * Fail fast: an invalid environment crashes the process at boot rather than
 * surfacing as a confusing runtime error mid-capture.
 */
const boolish = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v == null ? def : v === 'true' || v === '1'));

const intish = (def: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v == null || v === '' ? def : Number(v)))
    .pipe(z.number().int());

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.string().default('info'),
  ROLE: z.enum(['api', 'worker']).default('api'),

  PORT: intish(8080),
  HOST: z.string().default('0.0.0.0'),
  CORS_ORIGINS: z.string().default('*'),
  BODY_LIMIT_BYTES: intish(1_048_576),

  API_KEYS: z.string().default(''),
  RATE_FREE_PER_MIN: intish(10),
  RATE_PRO_PER_MIN: intish(120),
  RATE_UNLIMITED_PER_MIN: intish(100_000),

  REDIS_URL: z.string().default('redis://localhost:6379'),

  BROWSER_POOL_SIZE: intish(2),
  BROWSER_MAX_USES: intish(80),
  CAPTURE_TIMEOUT_MS: intish(30_000),
  NAV_TIMEOUT_MS: intish(20_000),
  BROWSER_HEADLESS: boolish(true),
  BROWSER_ENABLE_WEBGL: boolish(true),

  WORKER_CONCURRENCY: intish(2),
  JOB_ATTEMPTS: intish(3),
  JOB_BACKOFF_MS: intish(5_000),
  JOB_TTL_SECONDS: intish(86_400),

  // Pluggable storage backend. 'none' returns binary/base64 only (no uploads).
  STORAGE_DRIVER: z.enum(['none', 's3', 'local']).default('none'),
  S3_ENDPOINT: z.string().default(''),
  S3_REGION: z.string().default('auto'),
  S3_BUCKET: z.string().default('third-eye'),
  S3_ACCESS_KEY_ID: z.string().default(''),
  S3_SECRET_ACCESS_KEY: z.string().default(''),
  S3_PUBLIC_BASE_URL: z.string().default(''),
  S3_PRESIGN_TTL_SECONDS: intish(3_600),
  LOCAL_STORAGE_DIR: z.string().default('captures'),
  LOCAL_PUBLIC_BASE_URL: z.string().default(''),

  MAX_BULK_URLS: intish(100),
  MAX_VIEWPORT_WIDTH: intish(3_840),
  MAX_VIEWPORT_HEIGHT: intish(4_320),
});

export type Plan = 'free' | 'pro' | 'unlimited';

export interface ApiKey {
  key: string;
  plan: Plan;
}

function parseApiKeys(raw: string): ApiKey[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const [key, plan = 'free'] = entry.split(':');
      const normalizedPlan: Plan = (['free', 'pro', 'unlimited'] as const).includes(
        plan as Plan,
      )
        ? (plan as Plan)
        : 'free';
      return { key: key!, plan: normalizedPlan };
    });
}

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}
const env = parsed.data;

export const config = {
  env: env.NODE_ENV,
  isProd: env.NODE_ENV === 'production',
  logLevel: env.LOG_LEVEL,
  role: env.ROLE,

  http: {
    port: env.PORT,
    host: env.HOST,
    corsOrigins: env.CORS_ORIGINS,
    bodyLimit: env.BODY_LIMIT_BYTES,
  },

  auth: {
    keys: parseApiKeys(env.API_KEYS),
    enabled: env.API_KEYS.trim().length > 0,
    ratePerMin: {
      free: env.RATE_FREE_PER_MIN,
      pro: env.RATE_PRO_PER_MIN,
      unlimited: env.RATE_UNLIMITED_PER_MIN,
    } satisfies Record<Plan, number>,
  },

  redis: { url: env.REDIS_URL },

  browser: {
    poolSize: env.BROWSER_POOL_SIZE,
    maxUses: env.BROWSER_MAX_USES,
    captureTimeoutMs: env.CAPTURE_TIMEOUT_MS,
    navTimeoutMs: env.NAV_TIMEOUT_MS,
    headless: env.BROWSER_HEADLESS,
    enableWebgl: env.BROWSER_ENABLE_WEBGL,
  },

  worker: {
    concurrency: env.WORKER_CONCURRENCY,
    attempts: env.JOB_ATTEMPTS,
    backoffMs: env.JOB_BACKOFF_MS,
    ttlSeconds: env.JOB_TTL_SECONDS,
  },

  storage: {
    driver: env.STORAGE_DRIVER,
    s3: {
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      bucket: env.S3_BUCKET,
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      publicBaseUrl: env.S3_PUBLIC_BASE_URL,
      presignTtlSeconds: env.S3_PRESIGN_TTL_SECONDS,
    },
    local: {
      dir: env.LOCAL_STORAGE_DIR,
      publicBaseUrl: env.LOCAL_PUBLIC_BASE_URL,
    },
  },

  limits: {
    maxBulkUrls: env.MAX_BULK_URLS,
    maxViewportWidth: env.MAX_VIEWPORT_WIDTH,
    maxViewportHeight: env.MAX_VIEWPORT_HEIGHT,
  },
} as const;

export type Config = typeof config;
