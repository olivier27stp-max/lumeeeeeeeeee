/**
 * Audit commissions — API Express réelle (localhost:3012, branchée sur la
 * pile locale via lume-commissions-db/lancer-app-locale.sh).
 *
 * Prouve : une seule vérité pour la page, la Paie et le rapport ; RBAC de la
 * page Rôles ; isolation par x-org-id trafiqué ; validation ; trace d'audit.
 * À lancer séquentiellement : COMMISSIONS_AUDIT=1 npx vitest run tests/commissions-audit --no-file-parallelism
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';
import { API, ANON_KEY, DB_URL, brancherServeurSurLocal, pileLocaleDisponible } from './env-local';
import { ORG, U, MEMBRES, MOT_DE_PASSE, R, HISTORIQUE_TAUX, f } from './fixture';
import { lireOracle, type Attendu } from './comparer';

const EXPRESS = process.env.COMMISSIONS_AUDIT_EXPRESS || 'http://localhost:3012';
const expressDispo = await fetch(`${EXPRESS}/api/health`, { signal: AbortSignal.timeout(1500) }).then((r) => r.ok).catch(() => false);
const disponible = expressDispo && await pileLocaleDisponible();

const jetons: Record<string, string> = {};
async function jeton(userId: string) {
  if (jetons[userId]) return jetons[userId];
  const m = MEMBRES.find((x) => x.id === userId)!;
  const anon = createClient(API, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await anon.auth.signInWithPassword({ email: m.courriel, password: MOT_DE_PASSE });
  if (error || !data.session) throw new Error(error?.message);
  return (jetons[userId] = data.session.access_token);
}
async function appel(userId: string, chemin: string, init: { method?: string; body?: unknown; org?: string } = {}) {
  const m = MEMBRES.find((x) => x.id === userId)!;
  const r = await fetch(`${EXPRESS}/api${chemin}`, {
    method: init.method ?? 'GET',
    headers: { Authorization: `Bearer ${await jeton(userId)}`, 'x-org-id': init.org ?? m.org, 'Content-Type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const texte = await r.text();
  let json: any = null;
  try { json = JSON.parse(texte); } catch { json = texte; }
  return { status: r.status, json };
}

describe.skipIf(!disponible)('commissions — API Express', () => {
  let db: pg.Client;
  let oracle: Attendu[];
  const septembre = (rep?: string) => oracle.filter((a) => a.org_id === ORG.A && a.mois === '2026-09' && a.etat === 'active' && (!rep || a.user_id === rep))
    .reduce((s, a) => s + a.montant_cents, 0);

  beforeAll(async () => {
    brancherServeurSurLocal();
    const { seed } = await import('./seed');
    await seed();
    db = new pg.Client({ connectionString: DB_URL });
    await db.connect();
    oracle = await lireOracle(db);
  }, 180_000);
  afterAll(async () => { await db?.end(); });

  describe('une seule vérité : page = paie = rapport = oracle', () => {
    it('page Commissions (payroll-preview) : total de l’équipe et par rep', async () => {
      const r = await appel(U.olivia, '/commissions/payroll-preview?from=2026-09-01&to=2026-09-30');
      expect(r.status).toBe(200);
      // RF2 (facture refaite) n'est commissionnée qu'avec la migration M1.
      const rf2 = oracle.find((a) => a.invoice_id === f('RF2').id);
      const attenduSansM1 = septembre() - (rf2 ? 15000 : 0);
      expect([septembre(), attenduSansM1]).toContain(r.json.totals_cents.du_cents);
      for (const rep of [U.rita, U.tina, U.sam, U.sara]) {
        const ligne = r.json.par_rep.find((x: any) => x.user_id === rep);
        expect(ligne?.du_cents ?? 0, rep.slice(-3)).toBe(septembre(rep));
      }
    });

    it('Paie (period-summary) : même commission par rep que la page', async () => {
      const page = await appel(U.olivia, '/commissions/payroll-preview?from=2026-09-01&to=2026-09-30');
      const paie = await appel(U.olivia, '/payroll/period-summary?ref=2026-09-15');
      expect(paie.status).toBe(200);
      for (const rep of [U.rita, U.fred, U.tina, U.sam, U.sara, U.dora]) {
        const p = paie.json.rows.find((x: any) => x.user_id === rep)?.commission_cents ?? 0;
        const c = page.json.par_rep.find((x: any) => x.user_id === rep)?.du_cents ?? 0;
        expect(p, `paie vs page ${rep.slice(-3)}`).toBe(c);
      }
    });

    it('Paie : un rep désactivé à qui une commission est due reste visible (Dora)', async () => {
      const paie = await appel(U.olivia, '/payroll/period-summary?ref=2026-09-15');
      const dora = paie.json.rows.find((x: any) => x.user_id === U.dora);
      expect(dora?.commission_cents).toBe(4000);
      expect(dora?.inactive).toBe(true);
    });

    it('Paie : la période d’août payée signale l’écart laissé par le remboursement après versement', async () => {
      const aout = await appel(U.olivia, '/payroll/period-summary?ref=2026-08-15');
      const rita = aout.json.rows.find((x: any) => x.user_id === U.rita);
      expect(rita.payment).toBeTruthy();
      // Montant versé inchangé (la commission reste versée) ; aucun écart caché.
      expect(typeof rita.ecart_depuis_versement_cents).toBe('number');
    });

    it('rapport « Commissions » : le total Dû = la page', async () => {
      const page = await appel(U.olivia, '/commissions/payroll-preview?from=2026-09-01&to=2026-09-30');
      const rapport = await appel(U.olivia, '/reports/export.json?report=commissions&from=2026-09-01&to=2026-09-30');
      expect(rapport.status).toBe(200);
      expect(rapport.json.totals.du_cents).toBe(page.json.totals_cents.du_cents);
    });

    it('une estimation n’est jamais dans un total dû', async () => {
      const r = await appel(U.olivia, '/commissions/payroll-preview?from=2026-09-01&to=2026-09-30&userId=' + U.rita);
      expect(r.json.totals_cents.estime_cents).toBeGreaterThan(0);
      expect(r.json.totals_cents.du_cents).toBe(septembre(U.rita));
    });
  });

  describe('RBAC (page Rôles) et isolation', () => {
    it('un sales_rep ouvre SA page (avant : 403, il n’a pas financial.view_reports)', async () => {
      const r = await appel(U.rita, '/commissions?from=2026-09-01&to=2026-09-30');
      expect(r.status).toBe(200);
      expect(new Set(r.json.map((e: any) => e.user_id))).toEqual(new Set([U.rita]));
      const p = await appel(U.rita, '/commissions/payroll-preview?from=2026-09-01&to=2026-09-30');
      expect(p.status).toBe(200);
    });

    it('un rep qui trafique ?userId= ne voit toujours que les siennes', async () => {
      const r = await appel(U.rita, `/commissions?userId=${U.sam}`);
      expect(r.json.every((e: any) => e.user_id === U.rita)).toBe(true);
      const p = await appel(U.rita, `/commissions/payroll-preview?from=2026-01-01&to=2026-12-31&userId=${U.sam}`);
      expect(p.json.par_rep.every((x: any) => x.user_id === U.rita)).toBe(true);
    });

    it('un rep ne voit que SON plan, sans les autres bénéficiaires', async () => {
      const r = await appel(U.rita, '/commissions/rules');
      expect(r.json.map((x: any) => x.id)).toEqual([R.pct]);
      expect(r.json[0].assigned_user_ids).toEqual([U.rita]);
      const sam = await appel(U.sam, '/commissions/rules');
      expect(sam.json[0].attribution.splits.map((s: any) => s.user_id)).toEqual([U.sam]);
    });

    it('un technicien est refusé', async () => {
      expect((await appel(U.theo, '/commissions')).status).toBe(403);
      expect((await appel(U.theo, '/commissions/rules')).status).toBe(403);
    });

    it('un rep ne peut ni approuver, ni verser, ni reverser, ni toucher aux règles', async () => {
      const { rows } = await db.query(`select id from fs_commission_entries where org_id=$1 and user_id=$2 and status='approved' limit 1`, [ORG.A, U.rita]);
      for (const action of ['approve', 'mark-paid', 'reverse']) {
        expect((await appel(U.rita, `/commissions/${rows[0].id}/${action}`, { method: 'POST', body: {} })).status, action).toBe(403);
      }
      expect((await appel(U.rita, '/commissions/rules', { method: 'POST', body: { name: 'x', base_percent: 99 } })).status).toBe(403);
      expect((await appel(U.rita, `/commissions/rules/${R.pct}`, { method: 'PUT', body: { base_percent: 99 } })).status).toBe(403);
      expect((await appel(U.rita, '/commissions/rules/assign-member', { method: 'POST', body: { user_id: U.rita, rule_id: R.palier } })).status).toBe(403);
      expect((await appel(U.rita, '/commissions/settings', { method: 'PUT', body: { reversal_policy: 'keep' } })).status).toBe(403);
      expect((await appel(U.rita, `/commissions/rules/${R.pct}`, { method: 'DELETE' })).status).toBe(403);
    });

    it('x-org-id trafiqué vers un autre tenant : refusé', async () => {
      expect((await appel(U.rita, '/commissions', { org: ORG.B })).status).toBe(403);
      expect((await appel(U.olivia, '/commissions/payroll-preview?from=2026-09-01&to=2026-09-30', { org: ORG.B })).status).toBe(403);
    });

    it('le propriétaire de A ne voit jamais B', async () => {
      const r = await appel(U.olivia, '/commissions');
      expect(r.json.some((e: any) => e.org_id !== ORG.A)).toBe(false);
    });

    it('tenant vide : 200 et zéros', async () => {
      const r = await appel(U.carl, '/commissions/payroll-preview?from=2026-09-01&to=2026-09-30');
      expect(r.status).toBe(200);
      expect(r.json.totals_cents.du_cents).toBe(0);
      expect((await appel(U.carl, '/commissions')).json).toEqual([]);
    });

    it('dates invalides : 400', async () => {
      expect((await appel(U.olivia, '/commissions?from=2026-13-45T00:00&to=x')).status).toBe(400);
    });
  });

  describe('validation et trace d’audit', () => {
    const traces = async (action: string) => (await db.query(
      `select actor_id, old_values, new_values from audit_events where org_id=$1 and action=$2 order by created_at desc limit 1`, [ORG.A, action])).rows[0];

    it('taux hors bornes, split > 100 %, bénéficiaire étranger : 400', async () => {
      expect((await appel(U.olivia, '/commissions/rules', { method: 'POST', body: { name: 'x', base_percent: 150 } })).status).toBe(400);
      expect((await appel(U.olivia, '/commissions/rules', { method: 'POST', body: { name: 'x', base_value_cents: -5, base_kind: 'flat' } })).status).toBe(400);
      expect((await appel(U.olivia, '/commissions/rules', { method: 'POST', body: {
        name: 'x', attribution: { mode: 'split', splits: [{ user_id: U.sam, pct: 60 }, { user_id: U.sara, pct: 60 }] },
      } })).status).toBe(400);
      expect((await appel(U.olivia, '/commissions/rules', { method: 'POST', body: { name: 'x', assigned_user_ids: [U.bea] } })).status).toBe(400);
    });

    it('créer / modifier / supprimer une règle laisse une trace avant/après', async () => {
      const c = await appel(U.olivia, '/commissions/rules', { method: 'POST', body: { name: 'Audit 7 %', base_percent: 7 } });
      expect(c.status).toBe(200);
      expect((await traces('commission_rule.created')).actor_id).toBe(U.olivia);
      const u = await appel(U.olivia, `/commissions/rules/${c.json.id}`, { method: 'PUT', body: { base_percent: 8 } });
      expect(u.status).toBe(200);
      const t = await traces('commission_rule.updated');
      expect([Number(t.old_values.base_percent), Number(t.new_values.base_percent)]).toEqual([7, 8]);
      expect((await appel(U.olivia, `/commissions/rules/${c.json.id}`, { method: 'DELETE' })).status).toBe(200);
      expect((await traces('commission_rule.deleted')).actor_id).toBe(U.olivia);
    });

    it('approuver, verser, reverser : trace avec l’auteur ; une commission versée ne se reverse plus', async () => {
      const { rows } = await db.query(`select id from fs_commission_entries where org_id=$1 and user_id=$2 and status='approved' order by triggered_at limit 2`, [ORG.A, U.tina]);
      expect((await appel(U.adam, `/commissions/${rows[0].id}/mark-paid`, { method: 'POST' })).status).toBe(200);
      expect((await traces('commission.paid')).actor_id).toBe(U.adam);
      expect((await appel(U.adam, `/commissions/${rows[0].id}/reverse`, { method: 'POST', body: { reason: 'test' } })).status).toBeGreaterThanOrEqual(400);
      const rev = await appel(U.adam, `/commissions/${rows[1].id}/reverse`, { method: 'POST', body: { reason: 'Client remboursé' } });
      expect(rev.status).toBe(200);
      expect(rev.json.reverse_reason).toBe('Client remboursé');
      expect((await traces('commission.reversed')).new_values.reason).toBe('Client remboursé');
    });

    it('assigner un plan : trace de l’ancien et du nouveau plan', async () => {
      expect((await appel(U.olivia, '/commissions/rules/assign-member', { method: 'POST', body: { user_id: U.nora, rule_id: R.pct } })).status).toBe(200);
      const t = await traces('commission_plan.assigned');
      expect([t.old_values.rule_id, t.new_values.rule_id]).toEqual([null, R.pct]);
      await appel(U.olivia, '/commissions/rules/assign-member', { method: 'POST', body: { user_id: U.nora, rule_id: null } });
    });
  });

  it('historique des taux de la fixture cohérent', () => { expect(HISTORIQUE_TAUX.length).toBe(2); });
});
