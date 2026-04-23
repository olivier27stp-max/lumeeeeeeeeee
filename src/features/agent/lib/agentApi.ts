/* ═══════════════════════════════════════════════════════════════
   Mr Lume Agent — Frontend API Client (stub)
   ─────────────────────────────────────────────────────────────
   AI backend removed (cleanup Phase 4.2). The interactive chat
   is disabled. The only live endpoint is the external-agent login
   flow (POST /api/agent/connect), implemented server-side in
   server/routes/agent-auth.ts.
   ═══════════════════════════════════════════════════════════════ */

import { supabase } from '../../../lib/supabase';

/**
 * Exchange an external-agent API token for a short-lived JWT.
 * The returned JWT authorises the external agent to POST messages
 * via /api/agent/webhook into the user's chat (RLS-scoped by org_id).
 */
export async function connectExternalAgent(token: string): Promise<
  | { ok: true; jwt: string; expiresIn: number }
  | { ok: false; error: string }
> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;

    const res = await fetch('/api/agent/connect', {
      method: 'POST',
      headers,
      body: JSON.stringify({ token }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json?.jwt) {
      return { ok: false, error: json?.error || `connect failed: ${res.status}` };
    }
    return { ok: true, jwt: json.jwt, expiresIn: json.expiresIn || 0 };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Connection error' };
  }
}
