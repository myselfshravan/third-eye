import pino from 'pino';
import { config } from './config.js';

/**
 * Structured JSON logging in production (machine-parseable, ships to any log
 * aggregator). Pretty output in dev when pino-pretty is installed.
 */
const transport =
  !config.isProd && config.env !== 'test'
    ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l' } }
    : undefined;

export const logger = pino({
  level: config.logLevel,
  base: { role: config.role },
  redact: {
    paths: ['req.headers["x-api-key"]', 'req.headers.authorization'],
    censor: '[redacted]',
  },
  ...(transport ? { transport } : {}),
});

export type Logger = typeof logger;
