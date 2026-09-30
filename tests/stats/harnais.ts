/**
 * Harnais des tests d'intégration Statistiques — stack LOCALE uniquement
 * (bash scripts/qa/stats-stack.sh && node scripts/qa/stats-fixture.mjs).
 * Les tests sont ignorés tant que STATS_DB_URL n'est pas défini : la CI ne les lance pas.
 */
import pg from 'pg';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { STATS_LOCAL, signerJwt } from '../../scripts/qa/stats-local.mjs';

export const ACTIF = !!process.env.STATS_DB_URL;

export const T1 = 'a1000000-0000-4000-8000-000000000001';
export const T2 = 'b2000000-0000-4000-8000-000000000001';
export const T3 = 'c3000000-0000-4000-8000-000000000001';
export const T4 = 'd4000000-0000-4000-8000-000000000001';
export const U = {
  proprio: 'a1000000-0000-4000-8000-0000000000a1',
  admin: 'a1000000-0000-4000-8000-0000000000a2',
  theo: 'a1000000-0000-4000-8000-0000000000a3',
  tina: 'a1000000-0000-4000-8000-0000000000a4',
  remi: 'a1000000-0000-4000-8000-0000000000a5',
  proprioT2: 'b2000000-0000-4000-8000-0000000000b1',
  proprioT3: 'c3000000-0000-4000-8000-0000000000c1',
  proprioT4: 'd4000000-0000-4000-8000-0000000000d1',
} as const;

/** Périodes de référence ; « aujourd'hui » = mercredi 30 septembre 2026 (Toronto). */
export const P = {
  aout: { du: '2026-08-01', au: '2026-08-31' },
  sept: { du: '2026-09-01', au: '2026-09-30' },
  mars: { du: '2026-03-01', au: '2026-03-31' },
  nov2025: { du: '2025-11-01', au: '2025-11-30' },
  dec2025: { du: '2025-12-01', au: '2025-12-31' },
  ytd: { du: '2026-01-01', au: '2026-09-30' },
  /** periodRange('12m') le 30 septembre 2026 à midi (Toronto). */
  douzeMois: { du: '2025-09-30', au: '2026-09-30' },
} as const;
export const AUJOURDHUI = '2026-09-30';

export function base(): pg.Client {
  return new pg.Client({ connectionString: STATS_LOCAL.dbUrl });
}

/** Réécrit http://stats.local/{rest,auth}/v1/… vers PostgREST / GoTrue locaux (ce que fait Kong sur Supabase). */
const fetchLocal: typeof fetch = (input, init) => {
  const url = String(typeof input === 'string' || input instanceof URL ? input : input.url)
    .replace('http://stats.local/rest/v1', STATS_LOCAL.restUrl)
    .replace('http://stats.local/auth/v1', STATS_LOCAL.authUrl);
  return fetch(url, init);
};

/** Client supabase-js authentifié comme `userId` (rôle authenticated → RLS active), ou anonyme, ou service_role. */
export function clientComme(userId: string | 'anon' | 'service_role'): SupabaseClient {
  const anon = signerJwt({ role: 'anon' });
  const jeton = userId === 'anon' ? anon
    : userId === 'service_role' ? signerJwt({ role: 'service_role' })
      : signerJwt({ sub: userId, role: 'authenticated' });
  return createClient('http://stats.local', anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: fetchLocal, headers: { Authorization: `Bearer ${jeton}` } },
  });
}

/** Somme d'un tableau de cents. */
export const somme = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
