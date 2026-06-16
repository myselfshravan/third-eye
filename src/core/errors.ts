/**
 * Typed application errors. Each carries an HTTP status and a stable machine
 * code so clients can branch on `error.code` rather than parsing messages.
 */
export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const Errors = {
  unauthorized: (msg = 'Missing or invalid API key') =>
    new AppError(401, 'unauthorized', msg),
  forbidden: (msg = 'Forbidden') => new AppError(403, 'forbidden', msg),
  badRequest: (msg: string, details?: unknown) =>
    new AppError(400, 'bad_request', msg, details),
  rateLimited: (msg = 'Rate limit exceeded') =>
    new AppError(429, 'rate_limited', msg),
  notFound: (msg = 'Not found') => new AppError(404, 'not_found', msg),
  captureTimeout: (msg = 'Capture timed out') =>
    new AppError(504, 'capture_timeout', msg),
  navigationFailed: (msg: string, details?: unknown) =>
    new AppError(502, 'navigation_failed', msg, details),
  upstreamBlocked: (msg = 'Target blocked the request (bot protection)') =>
    new AppError(502, 'upstream_blocked', msg),
  internal: (msg = 'Internal error') => new AppError(500, 'internal', msg),
};

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}
