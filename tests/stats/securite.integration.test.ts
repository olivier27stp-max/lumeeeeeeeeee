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
  ['rpc_insights_top_clients', PERIODE],
  ['rpc_insights_entonnoir', PERIODE],
  ['rpc_insights_soumissions', PERIODE],
  ['rpc_insights_detail', { ...PERIODE, p_carte: 'revenu' }],
  ['rpc_insights_detail', { ...PERIODE, p_carte: 'a_recevoir' }],
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
    // Bug S-3 (STATS_AUDIT.md), corrigé par 20261004300300 : les colonnes de rémunération et la
    // date de naissance ne sont plus lisibles en direct ; membres_remuneration() filtre par droit.
    it('technicien : taux horaire et date de naissance illisibles en direct (team_members ET memberships)', async () => {
      for (const [table, col] of [['team_members', 'hourly_rate_cents'], ['team_members', 'labour_cost_hourly'], ['team_members', 'birth_date'], ['memberships', 'hourly_rate_cents'], ['memberships', 'labour_cost_hourly']]) {
        const r = await theo.from(table).select(`user_id, ${col}`).eq('org_id', T1);
        expect(r.error?.code, `${table}.${col} lisible : ${texte(r.data).slice(0, 160)}`).toBe('42501');
      }
      // Les autres colonnes restent lisibles (horaire, équipe, noms…).
      const r = await theo.from('team_members').select('user_id, first_name, team_id, compensation_mode, working_hours').eq('org_id', T1);
      expect(r.error).toBeNull();
      expect((r.data || []).length).toBeGreaterThan(1);
    });
    it('technicien : membres_remuneration ne rend QUE sa propre fiche', async () => {
      const r = await appel(theo, 'membres_remuneration', {}, T1);
      expect(r.error).toBeNull();
      const lignes = (r.data || []) as Array<{ user_id: string; hourly_rate_cents: number }>;
      expect(lignes.map((l) => l.user_id)).toEqual([U.theo]);
      expect(lignes[0].hourly_rate_cents).toBe(2500);
    });
    it('vendeur : membres_remuneration ne rend aucune fiche de collègue', async () => {
      const r = await appel(remi, 'membres_remuneration', {}, T1);
      expect(r.error).toBeNull();
      expect(((r.data || []) as Array<{ user_id: string }>).every((l) => l.user_id === U.remi)).toBe(true);
    });
    it('propriétaire : membres_remuneration rend toute l’équipe ; rien pour une autre entreprise', async () => {
      const r = await appel(proprio, 'membres_remuneration', {}, T1);
      expect(r.error).toBeNull();
      const parUser = new Map(((r.data || []) as Array<{ user_id: string; hourly_rate_cents: number }>).map((l) => [l.user_id, l.hourly_rate_cents]));
      expect(parUser.get(U.theo)).toBe(2500);
      expect(parUser.get(U.tina)).toBe(3250);
      const autre = await appel(proprio, 'membres_remuneration', {}, T2);
      expect(autre.data || []).toEqual([]);
    });
    it('anonyme : membres_remuneration refusée', async () => {
      const r = await appel(anon, 'membres_remuneration', {}, T1);
      expect(r.error).not.toBeNull();
    });
    it('technicien : aucun paiement lisible directement', async () => {
      const { data } = await theo.from('payments').select('id, amount_cents').eq('org_id', T1);
      expect(data || []).toEqual([]);
    });
  });

  it('rpc_insights_budget_vs_actual (fonction morte) a été retirée', async () => {
    const r = await appel(proprio, 'rpc_insights_budget_vs_actual', PERIODE, T1);
    expect(r.error?.code).toBe('PGRST202');
  });

  // Paie sur memberships (migration 20261005600600) : la politique d'UPDATE laisse un membre
  // modifier sa propre ligne ; la rémunération, elle, exige team.update.
  describe('rémunération sur memberships : réservée à qui gère l’équipe', () => {
    it('technicien : ne change ni son taux ni son mode de paie, mais garde ses préférences', async () => {
      const taux = await theo.from('memberships').update({ hourly_rate_cents: 99900 }).eq('org_id', T1).eq('user_id', U.theo);
      expect(taux.error?.code).toBe('42501');
      const mode = await theo.from('memberships').update({ compensation_mode: 'both' }).eq('org_id', T1).eq('user_id', U.theo);
      expect(mode.error?.code).toBe('42501');
      const langue = await theo.from('memberships').update({ language: 'fr' }).eq('org_id', T1).eq('user_id', U.theo);
      expect(langue.error).toBeNull();
    });
    it('propriétaire : peut fixer le taux d’un membre', async () => {
      const r = await proprio.from('memberships').update({ hourly_rate_cents: 0 }).eq('org_id', T1).eq('user_id', U.theo);
      expect(r.error).toBeNull();
    });
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
