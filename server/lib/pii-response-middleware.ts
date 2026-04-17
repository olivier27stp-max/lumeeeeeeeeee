/**
 * LUME CRM — PII Auto-Decrypt Response Middleware
 * =================================================
 * Automatically decrypts PII fields (enc:xxx) in ALL API JSON responses.
 *
 * This ensures users see real emails, phones, and addresses in the CRM
 * while the data stays encrypted at rest in the database.
 *
 * How it works:
 * - Monkey-patches res.json() to intercept the response body
 * - Recursively walks the response object
 * - Any string starting with "enc:" gets decrypted transparently
 * - Plaintext values pass through unchanged (gradual migration safe)
 */

import { Request, Response, NextFunction } from 'express';
import { decryptPii, isEncrypted } from './pii-crypto';

/**
 * Recursively decrypt all encrypted string values in an object/array.
 * Only touches strings that start with "enc:" — everything else passes through.
 */
function decryptDeep(obj: any, depth = 0): any {
  if (depth > 15) return obj; // Safety: prevent infinite recursion

  if (obj === null || obj === undefined) return obj;

  if (typeof obj === 'string') {
    return isEncrypted(obj) ? decryptPii(obj) : obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => decryptDeep(item, depth + 1));
  }

  if (typeof obj === 'object') {
    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = decryptDeep(value, depth + 1);
    }
    return result;
  }

  return obj;
}

/**
 * Express middleware that auto-decrypts PII in API responses.
 * Mount this BEFORE route handlers in the middleware chain.
 */
export function piiDecryptResponseMiddleware() {
  return (_req: Request, res: Response, next: NextFunction) => {
    // Only intercept API routes
    if (!_req.path.startsWith('/api')) return next();

    const originalJson = res.json.bind(res);

    res.json = function (body: any) {
      // Decrypt any enc: values in the response body
      try {
        const decrypted = decryptDeep(body);
        return originalJson(decrypted);
      } catch (err) {
        // If decryption fails, send the original body — never break the response
        console.error('[pii-decrypt] Response decryption failed:', (err as any)?.message);
        return originalJson(body);
      }
    } as any;

    next();
  };
}
