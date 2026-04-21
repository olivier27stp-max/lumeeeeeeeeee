/**
 * validation-guards.ts — lightweight Zod guards for bulk endpoints.
 *
 * Full per-endpoint schemas are ideal but slow to write for 150+ endpoints.
 * These guards reject the *most dangerous* inputs (body-size overflow,
 * non-object bodies, obviously wrong types on common fields) while
 * allowing extra keys through — so existing callers don't break.
 */
import { z } from 'zod';
import type { Request, Response, NextFunction } from 'express';

// ── Size guard — reject bodies > 1 MiB by default ──
export function maxBodySize(maxBytes = 1_048_576) {
  return (req: Request, res: Response, next: NextFunction) => {
    const contentLen = Number(req.headers['content-length'] || 0);
    if (contentLen > maxBytes) {
      return res.status(413).json({ error: 'Payload too large' });
    }
    next();
  };
}

// ── Body shape guards ──
// All fields optional / nullable — the guard's job is to reject the WRONG
// *types* when a field is present, not to enforce required fields.
const commonFieldsSchema = z.object({
  id: z.string().uuid().optional(),
  orgId: z.string().uuid().optional(),
  org_id: z.string().uuid().optional(),
  client_id: z.string().uuid().optional().nullable(),
  lead_id: z.string().uuid().optional().nullable(),
  job_id: z.string().uuid().optional().nullable(),
  user_id: z.string().uuid().optional().nullable(),
  rep_id: z.string().uuid().optional().nullable(),
  team_id: z.string().uuid().optional().nullable(),
  territory_id: z.string().uuid().optional().nullable(),
  email: z.string().email().max(320).optional().nullable(),
  phone: z.string().trim().max(50).optional().nullable(),
  name: z.string().trim().max(500).optional().nullable(),
  title: z.string().trim().max(500).optional().nullable(),
  description: z.string().trim().max(10_000).optional().nullable(),
  notes: z.string().trim().max(10_000).optional().nullable(),
  status: z.string().trim().max(100).optional().nullable(),
  amount_cents: z.number().int().min(0).max(100_000_000_000).optional().nullable(),
  total_cents: z.number().int().min(0).max(100_000_000_000).optional().nullable(),
  rate_bps: z.number().int().min(0).max(10_000).optional().nullable(),
  lat: z.number().min(-90).max(90).optional().nullable(),
  lng: z.number().min(-180).max(180).optional().nullable(),
  latitude: z.number().min(-90).max(90).optional().nullable(),
  longitude: z.number().min(-180).max(180).optional().nullable(),
  // Freeform textual fields — length-capped
  address: z.string().trim().max(1000).optional().nullable(),
  message: z.string().trim().max(20_000).optional().nullable(),
  reason: z.string().trim().max(2000).optional().nullable(),
}).passthrough();

/**
 * Lightweight body guard — verifies that common fields, when present,
 * have the right type/bounds. Extra fields are passed through.
 */
export function guardCommonShape(req: Request, res: Response, next: NextFunction) {
  if (req.body == null) return next();
  if (typeof req.body !== 'object' || Array.isArray(req.body)) {
    return res.status(400).json({ error: 'Body must be a JSON object' });
  }
  const parsed = commonFieldsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '),
    });
  }
  req.body = parsed.data;
  next();
}
