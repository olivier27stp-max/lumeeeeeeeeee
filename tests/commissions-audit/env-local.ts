/**
 * Connexion à la pile Supabase LOCALE de l'audit des commissions.
 * Garde : refuse toute URL qui n'est pas 127.0.0.1 — la prod et le staging ne
 * doivent JAMAIS recevoir le tenant de test.
 *
 * Variables (valeurs par défaut = pile `supabase start` du dossier
 * lume-commissions-db, clés de démo publiques de la CLI Supabase) :
 *   COMMISSIONS_AUDIT_API  http://127.0.0.1:56421
 *   COMMISSIONS_AUDIT_DB   postgresql://postgres:postgres@127.0.0.1:56422/postgres
 */
export const API = process.env.COMMISSIONS_AUDIT_API || 'http://127.0.0.1:56421';
export const DB_URL = process.env.COMMISSIONS_AUDIT_DB || 'postgresql://postgres:postgres@127.0.0.1:56422/postgres';
// Clés de démo de la CLI Supabase (identiques sur toutes les piles locales, non secrètes).
export const SERVICE_KEY = process.env.COMMISSIONS_AUDIT_SERVICE_KEY
  || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
export const ANON_KEY = process.env.COMMISSIONS_AUDIT_ANON_KEY
  || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

export function exigerLocal() {
  for (const u of [API, DB_URL]) {
    if (!/(127\.0\.0\.1|localhost)/.test(u)) {
      throw new Error(`Refus : ${u.replace(/:[^:@/]+@/, ':***@')} n'est pas une base locale.`);
    }
  }
}

/** Branche les modules serveur (getServiceClient…) sur la pile locale AVANT leur import. */
export function brancherServeurSurLocal() {
  exigerLocal();
  process.env.VITE_SUPABASE_URL = API;
  process.env.SUPABASE_URL = API;
  process.env.VITE_SUPABASE_ANON_KEY = ANON_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
}

/**
 * Vrai si l'audit est DEMANDÉ (COMMISSIONS_AUDIT=1) et que la pile locale
 * répond. Opt-in : les fichiers rejouent le même tenant et doivent tourner en
 * série (--no-file-parallelism) — un `npm test` ordinaire les saute.
 */
export async function pileLocaleDisponible(): Promise<boolean> {
  if (process.env.COMMISSIONS_AUDIT !== '1') return false;
  try {
    const r = await fetch(`${API}/rest/v1/`, { headers: { apikey: ANON_KEY }, signal: AbortSignal.timeout(1500) });
    return r.status < 500;
  } catch {
    return false;
  }
}
