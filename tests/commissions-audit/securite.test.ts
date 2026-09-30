/**
 * Audit commissions — SÉCURITÉ en base (RLS), contre la pile locale.
 * Chaque requête part avec le JETON d'un vrai membre (GoTrue local) sur
 * PostgREST : c'est ce qu'un navigateur peut faire, sans passer par l'API.
 * Suppose le tenant de test rejoué (seed.ts) — exactitude.test.ts le fait.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { API, ANON_KEY, SERVICE_KEY, pileLocaleDisponible } from './env-local';
import { ORG, U, MEMBRES, MOT_DE_PASSE, R } from './fixture';

const disponible = await pileLocaleDisponible();

async function session(userId: string): Promise<SupabaseClient> {
  const m = MEMBRES.find((x) => x.id === userId)!;
  const anon = createClient(API, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await anon.auth.signInWithPassword({ email: m.courriel, password: MOT_DE_PASSE });
  if (error || !data.session) throw new Error(`connexion ${m.courriel}: ${error?.message}`);
  return createClient(API, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${data.session.access_token}` } },
  });
}

describe.skipIf(!disponible)('commissions — RLS (Loi 25, isolation, écritures)', () => {
  let rita: SupabaseClient, theo: SupabaseClient, bea: SupabaseClient, olivia: SupabaseClient;

  beforeAll(async () => {
    [rita, theo, bea, olivia] = await Promise.all([session(U.rita), session(U.theo), session(U.bea), session(U.olivia)]);
  }, 60_000);

  it('S-01 un technicien ne lit AUCUNE commission', async () => {
    const { data } = await theo.from('fs_commission_entries').select('id, user_id, amount').eq('org_id', ORG.A);
    expect(data ?? []).toEqual([]);
  });

  it('S-01 (latent) [exige M2] … même quand l’entreprise a enregistré ses réglages terrain (show_peer_payouts vrai par défaut)', async () => {
    // En prod au 2026-09-30, aucune org n'a encore de ligne field_settings :
    // la fuite s'ouvre dès la première sauvegarde des réglages terrain.
    const admin = createClient(API, SERVICE_KEY, { auth: { persistSession: false } });
    await admin.from('field_settings').upsert({ org_id: ORG.A }, { onConflict: 'org_id' });
    try {
      const { data } = await theo.from('fs_commission_entries').select('id').eq('org_id', ORG.A);
      expect(data ?? []).toEqual([]);
    } finally {
      await admin.from('field_settings').delete().eq('org_id', ORG.A);
    }
  });

  it('S-01 un rep ne lit que SES commissions', async () => {
    const { data } = await rita.from('fs_commission_entries').select('user_id').eq('org_id', ORG.A);
    expect(new Set((data ?? []).map((r) => r.user_id))).toEqual(new Set([U.rita]));
  });

  it('S-02 [exige M2] un rep ne lit que SON plan, pas les taux des autres', async () => {
    const { data } = await rita.from('fs_commission_rules').select('id').eq('org_id', ORG.A);
    expect((data ?? []).map((r) => r.id)).toEqual([R.pct]);
  });

  it('S-02 [exige M2] un technicien ne lit aucun plan', async () => {
    const { data } = await theo.from('fs_commission_rules').select('id').eq('org_id', ORG.A);
    expect(data ?? []).toEqual([]);
  });

  it('S-05 [décision en attente] un membre ne lit pas le taux horaire de ses collègues (team_members)', async () => {
    const { data } = await theo.from('team_members').select('user_id, hourly_rate_cents').eq('org_id', ORG.A).neq('user_id', U.theo);
    expect((data ?? []).filter((r) => r.hourly_rate_cents != null && r.hourly_rate_cents > 0)).toEqual([]);
  });

  it('le propriétaire lit tout son tenant', async () => {
    const { data } = await olivia.from('fs_commission_entries').select('id').eq('org_id', ORG.A);
    expect((data ?? []).length).toBeGreaterThan(20);
  });

  it('isolation : un membre de B ne voit rien de A, même en visant org_id = A', async () => {
    for (const t of ['fs_commission_entries', 'fs_commission_rules', 'commission_settings']) {
      const { data } = await bea.from(t).select('org_id').eq('org_id', ORG.A);
      expect(data ?? [], t).toEqual([]);
    }
  });

  it('isolation : le propriétaire de A ne voit rien de B', async () => {
    const { data } = await olivia.from('fs_commission_entries').select('id').eq('org_id', ORG.B);
    expect(data ?? []).toEqual([]);
  });

  it('écritures : un rep ne peut ni modifier son montant, ni se verser, ni créer une commission', async () => {
    const { data: miennes } = await rita.from('fs_commission_entries').select('id, amount, status').eq('user_id', U.rita).limit(1);
    const cible = miennes?.[0];
    expect(cible).toBeTruthy();
    const upd = await rita.from('fs_commission_entries').update({ amount: 999999, status: 'paid' }).eq('id', cible!.id).select('id');
    expect(upd.data ?? []).toEqual([]);
    const ins = await rita.from('fs_commission_entries').insert({ org_id: ORG.A, user_id: U.rita, rule_id: R.pct, amount: 1000, status: 'approved' }).select('id');
    expect(ins.data ?? []).toEqual([]);
    const regle = await rita.from('fs_commission_rules').update({ base_percent: 99 }).eq('id', R.pct).select('id');
    expect(regle.data ?? []).toEqual([]);
    const reglages = await rita.from('commission_settings').update({ reversal_policy: 'keep' }).eq('org_id', ORG.A).select('org_id');
    expect(reglages.data ?? []).toEqual([]);
  });
});
