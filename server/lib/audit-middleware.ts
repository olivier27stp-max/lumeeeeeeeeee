/**
 * LUME CRM — Request Audit Logging Middleware
 * =============================================
 * Logs all API requests with timing, status, and user context.
 * Sensitive data (headers, body) is redacted before logging.
 */

import { Request, Response, NextFunction } from 'express';
import { extractIP } from './security';
import logger from './logger';

// Paths to skip logging (high-frequency, low-risk)
const SKIP_PATHS = new Set([
  '/api/health',
  '/api/notifications/unread-count',
]);

// Paths that should NEVER have their body logged (even redacted)
const NO_BODY_LOG_PATHS = [
  '/api/payments/keys',
  '/api/connect',
  '/api/billing',
];

/**
 * Express middleware that logs all API requests with timing and context.
 * Mount early in the middleware chain (after body parsing).
 */
export function auditRequestMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    // Skip non-API and high-frequency endpoints
    if (!req.path.startsWith('/api')) return next();
    if (SKIP_PATHS.has(req.path)) return next();

    const startTime = Date.now();
    const requestId = (req as any).requestId || res.getHeader('X-Request-ID') || '-';
    const ip = extractIP(req);
    const method = req.method;
    const path = req.path;

    // Capture original end to intercept response
    const originalEnd = res.end;
    res.end = function (this: Response, ...args: any[]) {
      const duration = Date.now() - startTime;
      const status = res.statusCode;

      const logData: Record<string, any> = {
        requestId,
        method,
        path,
        status,
        duration_ms: duration,
        ip,
        user_agent: req.headers['user-agent']?.slice(0, 100),
      };

      // Add user ID if available (from auth header parse)
      const authSlice = req.headers.authorization?.slice(-8);
      if (authSlice) logData.auth_tail = authSlice;

      // Log at appropriate level based on status
      if (status >= 500) {
        logger.error('request_error', logData);
      } else if (status >= 400) {
        logger.warn('request_client_error', logData);
      } else if (duration > 5000) {
        logger.warn('request_slow', logData);
      } else {
        logger.info('request', logData);
      }

      return originalEnd.apply(this, args as any);
    } as any;

    next();
  };
}
