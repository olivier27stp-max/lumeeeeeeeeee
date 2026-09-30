/**
 * PERFORMANCE des Statistiques sur le tenant volumineux T4 (50 000 jobs, 100 000 factures,
 * 100 000 paiements). Mesure les VRAIS appels de la page (modules src/lib) à travers PostgREST,
 * puis l'EXPLAIN ANALYZE de chaque requête (RLS active ; intérieur des RPC via auto_explain).
 *
 *   node scripts/qa/stats-fixture.mjs --volume
 *   STATS_DB_URL=… STATS_PERF=1 npx vitest run tests/stats/performance.integration.test.ts
 * Rapport : tests/stats/.resultats/performance.json (non versionné).
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type pg from 'pg';
import { ACTIF, T4, U, base, clientComme } from './harnais';

// analyserRentabilite lit les permissions avec getServiceClient() : dans vitest, il pointe vers une URL
// factice (vitest.setup.ts). On le branche sur la stack locale, en service_role.
vi.mock('../../server/lib/supabase', async (orig) => {
  const vrai = await orig<typeof import('../../server/lib/supabase')>();
  const { clientComme: comme } = await import('./harnais');
  const service = comme('service_role'); // signé à l'heure RÉELLE, avant toute horloge figée
  return { ...vrai, getServiceClient: () => service };
});

const etat = vi.hoisted(() => ({ client: null as unknown as SupabaseClient, org: '' }));
vi.mock('../../src/lib/supabase', () => ({
  get supabase() { return etat.client; },
  bureauActifPourEntete: () => null,
  fetchAvecBureauActif: (i: RequestInfo | URL, init?: RequestInit) => fetch(i, init),
}));
vi.mock('../../src/lib/orgApi', async (orig) => ({
  ...(await orig<typeof import('../../src/lib/orgApi')>()),
  getCurrentOrgIdOrThrow: async () => etat.org,
  getCurrentOrgId: async () => etat.org,
}));

import * as insights from '../../src/lib/insightsApi';
import * as extra from '../../src/lib/statsExtraApi';
import { fetchQuoteKpis } from '../../src/lib/quotesApi';
import { analyserRentabilite, viderCacheRentabilite } from '../../server/lib/rentabilite';

const REPETITIONS = 12;
const PERIODE = { from: '2025-09-30', to: '2026-09-30', granularity: 'month' as const };
const AUTRE = { from: '2023-09-30', to: '2026-09-30', granularity: 'month' as const }; // « 3 dernières années »

/** Les appels que fait /insights au chargement (Statistiques.tsx + ses cartes), dans l'ordre. */
function appelsDeLaPage(p: typeof PERIODE) {
  return {
    'revenu (série)': () => insights.fetchInsightsRevenueSeries(p),
    'revenu par service': () => insights.fetchTopServices(p),
    'modes de paiement': () => extra.fetchPaymentMix(p),
    'valeur moyenne job': () => extra.fetchAvgJobValueSeries({ ...p, fr: true }),
    'équipes': () => insights.fetchTeamPerformance(p),
    'top clients (5, tri en base)': () => insights.fetchTopClientsParRevenu(5),
    'valeur vie moyenne': () => insights.fetchValeurVieMoyenne(),
    'fidélité (jobs + cohortes)': () => extra.fetchLoyalty(p),
    'conversion leads': () => insights.fetchInsightsLeadConversion(p),
    'vélocité pipeline': () => insights.fetchPipelineVelocity(p),
    'soumissions': () => fetchQuoteKpis(p),
    'trésorerie': () => insights.fetchInsightsInvoicesSummary(p),
    'zones (par adresse)': () => insights.fetchZonesParAdresse(p),
  } as Record<string, () => Promise<unknown>>;
}
/** Les cartes qui ne dépendent PAS de la période (pas relancées au changement de filtre). */
const HORS_PERIODE = new Set(['top clients (5, tri en base)', 'valeur vie moyenne']);

const pct = (xs: number[], q: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)]; };
const rapport: Record<string, unknown> = {};

describe.skipIf(!ACTIF || !process.env.STATS_PERF)('Statistiques — performance (T4 volumineux)', () => {
  let db: pg.Client;
  beforeAll(async () => {
    db = base(); await db.connect();
    etat.client = clientComme(U.proprioT4); etat.org = T4;
    process.env.TZ = 'America/Toronto';
  });
  afterAll(async () => {
    await db?.end();
    const dir = path.resolve('tests/stats/.resultats');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'performance.json'), JSON.stringify(rapport, null, 2));
  });

  it('p50 / p95 de chaque appel de la page', async () => {
    const mesures: Record<string, number[]> = {};
    const appels = appelsDeLaPage(PERIODE);
    for (const nom of Object.keys(appels)) await appels[nom](); // réchauffe caches et plans
    for (let i = 0; i < REPETITIONS; i++) {
      for (const [nom, f] of Object.entries(appels)) {
        const t0 = performance.now(); await f(); (mesures[nom] ||= []).push(performance.now() - t0);
      }
    }
    const table = Object.fromEntries(Object.entries(mesures).map(([k, v]) => [k, { p50: Math.round(pct(v, 0.5)), p95: Math.round(pct(v, 0.95)) }]));
    rapport.appels = table;
    console.table(table);
    expect(Object.keys(table).length).toBe(13);
  }, 600_000);

  it('chargement initial (tous les appels en parallèle, comme React Query) et changement de période', async () => {
    const charge: number[] = []; const filtre: number[] = [];
    for (let i = 0; i < REPETITIONS; i++) {
      const t0 = performance.now();
      await Promise.all(Object.values(appelsDeLaPage(PERIODE)).map((f) => f()));
      charge.push(performance.now() - t0);
      const t1 = performance.now();
      await Promise.all(Object.entries(appelsDeLaPage(AUTRE)).filter(([k]) => !HORS_PERIODE.has(k)).map(([, f]) => f()));
      filtre.push(performance.now() - t1);
    }
    rapport.page = { chargement_p50: Math.round(pct(charge, 0.5)), chargement_p95: Math.round(pct(charge, 0.95)), filtre_p50: Math.round(pct(filtre, 0.5)), filtre_p95: Math.round(pct(filtre, 0.95)) };
    console.table(rapport.page);
  }, 600_000);

  // Depuis #781, la carte Rentabilité passe par /api/profitability → analyserRentabilite (serveur).
  // Mesurée à part : sur ce volume, elle sature le pool de PostgREST (charger.ts, parLots en Promise.all).
  it('rentabilité (#781) sur le tenant volumineux', async () => {
    viderCacheRentabilite();
    const t0 = performance.now();
    let issue = 'ok';
    try {
      const r = await analyserRentabilite({ client: etat.client, orgId: T4, userId: U.proprioT4, demande: { date_from: PERIODE.from, date_to: PERIODE.to, group_by: 'job', sort: 'revenus_desc', limit: 500 } });
      issue = r.ok ? `ok (${r.resultat.nb_jobs} jobs)` : 'refus';
    } catch (e) { issue = `échec : ${(e as Error).message}`; }
    rapport.rentabilite = { ms: Math.round(performance.now() - t0), issue };
    console.log('RENTABILITE', rapport.rentabilite);
  }, 600_000);

  it('troncatures silencieuses à 1000 / 5000 lignes (max_rows PostgREST = 1000, comme la prod)', async () => {
    const [svc, mix, loy] = await Promise.all([
      insights.fetchTopServices(AUTRE), extra.fetchPaymentMix(AUTRE), extra.fetchLoyalty(AUTRE),
    ]);
    const vrai = await db.query(`
      select (select coalesce(sum(total_cents),0) from jobs where org_id=$1 and deleted_at is null and status not in ('draft','cancelled')
               and created_at >= '2023-09-30 00:00 America/Toronto' and created_at < '2026-10-01 00:00 America/Toronto')::bigint svc,
             (select coalesce(sum(amount_cents),0) from payments where org_id=$1 and deleted_at is null and status='succeeded'
               and payment_date >= '2023-09-30 00:00 America/Toronto' and payment_date < '2026-10-01 00:00 America/Toronto')::bigint mix`, [T4]);
    rapport.troncatures = {
      'revenu par service : affiché / réel': [svc.reduce((a, s) => a + s.value, 0), Number(vrai.rows[0].svc)],
      'modes de paiement : affiché / réel': [mix.reduce((a, s) => a + s.value, 0), Number(vrai.rows[0].mix)],
      'fidélité (part récurrente)': loy.recurringPct,
    };
    console.table(rapport.troncatures);
    expect(svc.reduce((a, s) => a + s.value, 0)).toBe(Number(vrai.rows[0].svc));
    expect(mix.reduce((a, s) => a + s.value, 0)).toBe(Number(vrai.rows[0].mix));
  }, 600_000);

  it('EXPLAIN ANALYZE de chaque requête (rôle authenticated, RLS active ; RPC via auto_explain)', async () => {
    const plans: Record<string, unknown> = {};
    const notes: string[] = [];
    db.on('notice', (n) => { if (n.message?.includes('Query Text')) notes.push(n.message); });
    await db.query(`load 'auto_explain'; set auto_explain.log_min_duration = 0; set auto_explain.log_analyze = on;
      set auto_explain.log_buffers = on; set auto_explain.log_nested_statements = on; set auto_explain.log_level = notice;
      set auto_explain.log_format = text; set auto_explain.log_timing = on`);
    const claims = JSON.stringify({ sub: U.proprioT4, role: 'authenticated' });
    const f = PERIODE.from; const t = PERIODE.to;
    const RPC: Array<[string, string]> = [
      ['rpc_insights_revenue_series', `select * from rpc_insights_revenue_series('${T4}', '${f}', '${t}', 'month')`],
      ['rpc_insights_team_performance', `select * from rpc_insights_team_performance('${T4}', '${f}', '${t}')`],
      ['rpc_insights_client_lifetime_value(50)', `select * from rpc_insights_client_lifetime_value('${T4}', 50)`],
      ['rpc_insights_cohort_retention', `select * from rpc_insights_cohort_retention('${T4}')`],
      ['rpc_insights_lead_conversion', `select * from rpc_insights_lead_conversion('${T4}', '${f}', '${t}')`],
      ['rpc_insights_pipeline_velocity', `select * from rpc_insights_pipeline_velocity('${T4}', '${f}', '${t}')`],
      ['rpc_insights_invoices_summary', `select * from rpc_insights_invoices_summary('${T4}', '${f}', '${t}')`],
      ['rentabilite_jobs', `select * from rentabilite_jobs('${T4}', '${f}', '${t}')`],
      ['rpc_list_payments (5 pages de 1000)', `select * from rpc_list_payments('succeeded', 'all', 'custom', null, '${f}', '${t}', 1000, 4000, '${T4}')`],
    ];
    const DIRECT: Array<[string, string]> = [
      ['jobs par titre (revenu par service)', `select title, total_cents from jobs where org_id = '${T4}' and deleted_at is null and status not in ('draft','cancelled') and created_at >= '${f}T04:00:00Z' and created_at < '2026-10-01T04:00:00Z'`],
      ['jobs complétés (valeur moyenne, fidélité)', `select created_at, total_cents, status, job_type from jobs where org_id = '${T4}' and deleted_at is null and status in ('completed','invoiced') and created_at >= '${f}' and created_at <= '${t}T23:59:59.999Z' limit 5000`],
      ['soumissions (3 requêtes)', `select total_cents from quotes where org_id = '${T4}' and deleted_at is null and created_at >= '${f}' and created_at <= '${t}T23:59:59.999Z'`],
      ['visites + jobs (zones)', `select e.id, e.start_at, j.status, j.total_cents from schedule_events e left join jobs j on j.id = e.job_id where e.org_id = '${T4}' and e.deleted_at is null and e.start_at >= '${f}' and e.start_at < '${t}T23:59:59.999Z' order by e.start_at`],
    ];
    await db.query('begin');
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [claims]);
    await db.query('set local role authenticated');
    for (const [nom, sql] of RPC) {
      notes.length = 0;
      const t0 = performance.now(); await db.query(sql); const ms = performance.now() - t0;
      const imbriquees = notes.filter((m) => !m.includes(sql.slice(0, 40)));
      plans[nom] = {
        ms: Math.round(ms),
        seq_scans: [...new Set(imbriquees.flatMap((m) => [...m.matchAll(/Seq Scan on (\w+)/g)].map((x) => x[1])))],
        plans: imbriquees.map((m) => m.split('\n').slice(0, 40).join('\n')),
      };
    }
    for (const [nom, sql] of DIRECT) {
      const r = await db.query(`explain (analyze, buffers, format text) ${sql}`);
      const txt = r.rows.map((x: Record<string, string>) => x['QUERY PLAN']).join('\n');
      plans[nom] = { ms: Number(/Execution Time: ([\d.]+)/.exec(txt)?.[1] ?? 0), seq_scans: [...txt.matchAll(/Seq Scan on (\w+)/g)].map((x) => x[1]), plan: txt };
    }
    await db.query('rollback');
    rapport.explain = plans;
    console.table(Object.fromEntries(Object.entries(plans).map(([k, v]: [string, any]) => [k, { ms: v.ms, seq_scans: v.seq_scans.join(',') }])));
  }, 600_000);
});
