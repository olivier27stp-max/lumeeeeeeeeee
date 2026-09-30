/**
 * SÉCURITÉ des Statistiques : isolation entre entreprises, rôles (page Rôles), anonyme.
 * Chaque RPC de la page et de Lumi est appelée À TRAVERS PostgREST avec un vrai jeton.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ACTIF, P, T1, T2, U, clientComme } from './harnais';

const PERIODE = { p_from: P.douzeMois.du, p_to: P.douzeMois.au };
/** Toutes les lectures financières de /insights, de Lumi et des rapports programmés. */
const RPC_FINANCIERES: Array<[string, Record<string, unknown>]> = [
  ['rpc_insights_revenue_series', { ...PERIODE, p_granularity: 'month' }],
  ['rpc_insights_overview', PERIODE],
  ['rpc_insights_invoices_summary', PERIODE],
  ['rpc_insights_team_performance', PERIODE],
  ['rpc_insights_client_lifetime_value', { p_limit: 50 }],
  ['rpc_insights_period_comparison', PERIODE],
  ['rpc_insights_job_profitability', PERIODE],
  ['rpc_insights_churn_risk', { p_limit: 50 }],
  ['rpc_insights_revenue_forecast', {}],
  ['rpc_invoices_kpis_30d', {}],
  ['rentabilite_jobs', PERIODE],
  // Agrégats ajoutés par la migration proposée (présents seulement une fois appliquée).
  ['rpc_insights_payment_mix', PERIODE],
  ['rpc_insights_service_mix', PERIODE],
  ['rpc_insights_completed_jobs_monthly', PERIODE],
  ['rpc_insights_valeur_vie_moyenne', {}],
  ['rpc_insights_zones', PERIODE],
];
const RPC_COMMERCIALES: Array<[string, Record<string, unknown>]> = [
  ['rpc_insights_lead_conversion', PERIODE],
  ['rpc_insights_pipeline_velocity', PERIODE],
  ['rpc_insights_cohort_retention', {}],
];

async function appel(c: SupabaseClient, nom: string, args: Record<string, unknown>, org: string) {
  const { data, error } = await c.rpc(nom, { p_org: org, ...args });
  return { data, error };
}
const texte = (x: unknown) => JSON.stringify(x ?? null);

describe.skipIf(!ACTIF)('Statistiques — sécurité', () => {
  let proprio: SupabaseClient; let theo: SupabaseClient; let remi: SupabaseClient; let anon: SupabaseClient;
  beforeAll(() => {
    proprio = clientComme(U.proprio); theo = clientComme(U.theo); remi = clientComme(U.remi); anon = clientComme('anon');
  });

  describe('isolation : le propriétaire de T1 qui vise T2 (paramètre p_org trafiqué)', () => {
    for (const [nom, args] of [...RPC_FINANCIERES, ...RPC_COMMERCIALES]) {
      it(`${nom}(p_org = T2) est refusée`, async () => {
        const r = await appel(proprio, nom, args, T2);
        expect(r.error, `${nom} a répondu ${texte(r.data).slice(0, 200)}`).not.toBeNull();
      });
    }
    it('lecture directe des tables de T2 (factures, paiements, jobs, soumissions, deals) : rien', async () => {
      for (const t of ['invoices', 'payments', 'jobs', 'quotes', 'pipeline_deals', 'clients', 'schedule_events']) {
        const { data, error } = await proprio.from(t).select('id').eq('org_id', T2);
        expect(error).toBeNull();
        expect(data, t).toEqual([]);
      }
    });
    it('aucune réponse de T1 ne contient un montant ou un nom de T2', async () => {
      for (const [nom, args] of [...RPC_FINANCIERES, ...RPC_COMMERCIALES]) {
        const r = await appel(proprio, nom, args, T1);
        expect(r.error, nom).toBeNull();
        const t = texte(r.data);
        expect(t, nom).not.toMatch(/7777777|Fantôme|Intruse/);
      }
    });
  });

  describe('rôles : ce que la page Rôles refuse, la base doit le refuser', () => {
    for (const [nom, args] of RPC_FINANCIERES) {
      it(`technicien : ${nom} refusée (pas de financial.view_analytics)`, async () => {
        const r = await appel(theo, nom, args, T1);
        expect(r.error, `${nom} a livré au technicien : ${texte(r.data).slice(0, 160)}`).not.toBeNull();
      });
      it(`vendeur : ${nom} refusée (pas de financial.view_analytics)`, async () => {
        const r = await appel(remi, nom, args, T1);
        expect(r.error, `${nom} a livré au vendeur : ${texte(r.data).slice(0, 160)}`).not.toBeNull();
      });
    }
    // ÉCART CONNU (STATS_AUDIT.md, bug S-3) : la RLS de team_members laisse tout membre lire
    // hourly_rate_cents de ses collègues. Correction = migration RLS/colonnes à concevoir avec la
    // paie (qui lit cette colonne) — pas écrite à l'aveugle. it.fails signalera le jour où c'est réglé.
    it.fails('technicien : les taux horaires des AUTRES ne lui sont pas lisibles', async () => {
      const { data } = await theo.from('team_members').select('user_id, hourly_rate_cents').eq('org_id', T1);
      const autres = (data || []).filter((m: { user_id: string; hourly_rate_cents: number | null }) => m.user_id !== U.theo && (m.hourly_rate_cents || 0) > 0);
      expect(autres, 'taux des collègues visibles').toEqual([]);
    });
    it('technicien : aucun paiement lisible directement', async () => {
      const { data } = await theo.from('payments').select('id, amount_cents').eq('org_id', T1);
      expect(data || []).toEqual([]);
    });
  });

  it('rpc_insights_budget_vs_actual est CASSÉE : la table budget_targets n’existe pas (fonction morte, aussi en prod)', async () => {
    const r = await appel(proprio, 'rpc_insights_budget_vs_actual', PERIODE, T1);
    expect(r.error?.code).toBe('42P01');
  });

  describe('anonyme (clé publique seule)', () => {
    for (const [nom, args] of [...RPC_FINANCIERES, ...RPC_COMMERCIALES]) {
      it(`${nom} refusée`, async () => {
        const r = await appel(anon, nom, args, T1);
        expect(r.error, `${nom} a répondu à un anonyme : ${texte(r.data).slice(0, 160)}`).not.toBeNull();
      });
    }
  });

  describe('rapports programmés (service_role, sans utilisateur)', () => {
    // server/lib/scheduled-reports.ts appelle ces RPC avec getServiceClient().
    for (const nom of ['rpc_insights_overview', 'rpc_insights_lead_conversion', 'rpc_insights_invoices_summary', 'rpc_insights_client_lifetime_value', 'rpc_insights_churn_risk']) {
      it(`${nom} répond au service_role`, async () => {
        const r = await appel(clientComme('service_role'), nom, nom.includes('lifetime') || nom.includes('churn') ? { p_limit: 5 } : PERIODE, T1);
        expect(r.error?.message ?? null, nom).toBeNull();
      });
    }
  });
});
