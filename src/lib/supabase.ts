import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || supabaseUrl.includes('placeholder')) {
  throw new Error('Missing VITE_SUPABASE_URL — check your .env.local file.');
}

if (!supabaseAnonKey || supabaseAnonKey.includes('placeholder')) {
  throw new Error('Missing VITE_SUPABASE_ANON_KEY — check your .env.local file.');
}

/** Clé localStorage du bureau actif — la même que CompanyContext.switchCompany et orgApi. */
const CLE_BUREAU_ACTIF = 'lume-active-org';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Bureau actif du navigateur, ou null (compte à un seul bureau, stockage indisponible). */
export function bureauActifPourEntete(): string | null {
  try {
    const v = localStorage.getItem(CLE_BUREAU_ACTIF);
    return v && UUID_RE.test(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * Chaque requête vers Supabase porte le bureau actif dans l'en-tête `x-lume-org`.
 * En base, current_org_id() le lit en premier (SQL 20260926120000) : sans lui, un
 * compte propriétaire de deux bureaux voyait les factures, les prochains numéros et
 * les créations de l'AUTRE bureau (la plus ancienne adhésion) — Vision Lavage,
 * 2026-09-24 : 15 factures affichées au lieu de 645. L'adhésion est vérifiée côté
 * base : un en-tête forgé est ignoré.
 */
function fetchAvecBureauActif(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const org = bureauActifPourEntete();
  if (!org) return fetch(input, init);
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  headers.set('x-lume-org', org);
  return fetch(input, { ...init, headers });
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: { fetch: fetchAvecBureauActif },
  auth: {
    // Automatically refresh tokens before they expire
    autoRefreshToken: true,
    // Persist session to localStorage (default, but explicit for security review)
    persistSession: true,
    // Detect session from URL (for OAuth redirects, password reset)
    detectSessionInUrl: true,
    // Storage key for session data
    storageKey: 'lume-auth-token',
    // Flow type: PKCE is more secure than implicit for SPAs
    flowType: 'pkce',
  },
});
