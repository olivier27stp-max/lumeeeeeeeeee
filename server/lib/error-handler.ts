/**
 * LUME CRM — Safe Error Response Handler
 * ========================================
 * Provides a centralized, safe way to respond to errors in route handlers.
 * NEVER leaks internal error details (DB schemas, SQL, stack traces) to clients.
 *
 * Usage in route handlers:
 *   } catch (error: any) {
 *     return sendSafeError(res, error, 'Unable to create lead.');
 *   }
 */

import type { Response } from 'express';

// PostgreSQL error codes → user-friendly messages
const PG_CODE_MAP: Record<string, { status: number; message: string }> = {
  '23505': { status: 409, message: 'A record with this value already exists.' },
  '23503': { status: 400, message: 'Referenced record not found.' },
  '23514': { status: 400, message: 'Data validation failed.' },
  '22023': { status: 400, message: 'Invalid parameter value.' },
  '22P02': { status: 400, message: 'Invalid input format.' },
  '42501': { status: 403, message: 'Permission denied.' },
  'P0002': { status: 404, message: 'Record not found.' },
  'P0001': { status: 400, message: 'Operation not allowed.' },
  '42P01': { status: 500, message: 'Internal server error.' }, // undefined table — never expose
  '42703': { status: 500, message: 'Internal server error.' }, // undefined column — never expose
};

// Patterns that indicate internal details we must NEVER expose
const UNSAFE_PATTERNS = [
  /\b(SELECT|INSERT|UPDATE|DELETE|FROM|WHERE|JOIN|INDEX|TABLE|COLUMN|SCHEMA|CONSTRAINT|TRIGGER|FUNCTION)\b/,
  /\b(pg_|PG_|PGRES|relation|violates|duplicate key)\b/i,
  /at\s+\w+.*\.ts:/,  // stack traces
  /node_modules\//,    // module paths
  /\bsupabase\b.*\berror\b/i,
  /row-level security/i,
  /authentication|auth\.uid/i,
];

/**
 * Check if an error message is safe to show to clients.
 */
function isSafeMessage(msg: string): boolean {
  if (!msg) return false;
  return !UNSAFE_PATTERNS.some(p => p.test(msg));
}

/**
 * Send a safe error response. NEVER leaks internal details.
 *
 * @param res - Express response
 * @param error - The caught error (any type)
 * @param fallbackMessage - User-friendly fallback message
 * @param logPrefix - Optional prefix for server-side logging
 */
export function sendSafeError(
  res: Response,
  error: any,
  fallbackMessage = 'An error occurred.',
  logPrefix = '[route]',
): Response {
  // Always log full error server-side
  console.error(logPrefix, {
    code: String(error?.code || ''),
    message: String(error?.message || 'unknown'),
    hint: error?.hint,
  });

  // Don't send headers twice
  if (res.headersSent) return res;

  const pgCode = String(error?.code || '');

  // Check for known PostgreSQL error codes
  if (pgCode && PG_CODE_MAP[pgCode]) {
    const mapped = PG_CODE_MAP[pgCode];
    return res.status(mapped.status).json({ error: mapped.message });
  }

  // Check if it's an error with an explicit HTTP status
  const status = error?.status || error?.statusCode;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    // Client errors: show message only if it's safe
    const msg = String(error?.message || '');
    if (isSafeMessage(msg)) {
      return res.status(status).json({ error: msg });
    }
    return res.status(status).json({ error: fallbackMessage });
  }

  // Default: 500 with generic message
  return res.status(500).json({ error: fallbackMessage });
}

/**
 * Convenience: wrap an async route handler with safe error handling.
 *
 * Usage:
 *   router.post('/foo', safeRoute(async (req, res) => {
 *     // ... your logic ...
 *   }, 'Unable to process foo.'));
 */
export function safeRoute(
  handler: (req: any, res: any) => Promise<any>,
  fallbackMessage = 'An error occurred.',
) {
  return async (req: any, res: any) => {
    try {
      await handler(req, res);
    } catch (error: any) {
      sendSafeError(res, error, fallbackMessage);
    }
  };
}
