/* /api/me/* — endpoints scoped to the currently authenticated user.
   Keep these endpoints cheap and server-authoritative. */

import { Router } from 'express';
import { requireAuthedClient } from '../lib/supabase';

const router = Router();

// Parse the beta-bypass allowlist once at module load. Server-side only —
// must NOT be exposed via a VITE_ env var (would ship into the JS bundle).
const BETA_BYPASS_EMAILS = (process.env.BETA_BYPASS_EMAILS || '')
  .split(',')
  .map(e => e.trim().toLowerCase())
  .filter(Boolean);

// GET /api/me/is-beta-bypassed — { bypassed: boolean }
// Reveals only a single boolean about the caller — no PII leak, no enumeration.
router.get('/me/is-beta-bypassed', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;
  const email = (auth.user.email || '').toLowerCase();
  const bypassed = !!email && BETA_BYPASS_EMAILS.includes(email);
  return res.json({ bypassed });
});

export default router;
