/**
 * Agent D — point 5 : isolation par bureau des statistiques, de l'historique et des journaux.
 *
 * Le bureau B (jeton d'un vrai utilisateur de B) essaie de voir le bureau A par trois chemins :
 * PostgREST directement, l'API Express, et l'écran (y compris en forçant le bureau actif).
 * Tout est attendu VERT : c'est un état des lieux, pas un constat.
 */
import { describe, it, expect, beforeAll, afterAll, inject } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { ouvrirOnglet, fermerNavigateur, sessionComplete, admin, type Onglet } from '../../../automations-suite/harnais/navigateur';
import { COMPTES } from '../../../automations-suite/harnais/bureau-test';
import { lireManifeste, type Manifeste } from '../jeu-connu';

let jeu: Manifeste;
let jetonB: string;
/**
 * Les bureaux dont l'utilisateur B est MEMBRE. Un compte peut en avoir plusieurs (propriétaire de tous les
 * bureaux de son entreprise) : voir les lignes de SES bureaux n'est pas une fuite. Ce que la preuve interdit,
 * c'est une ligne d'un bureau dont il n'est pas membre — et, nommément, du bureau A.
 */
let bureauxDeB: Set<string>;
let jetonTechA: string;
let api: string;

const propre = (t: string | null | undefined) => String(t ?? '').replace(/\s+/g, ' ').trim();

/** Un client PostgREST au nom de B ; `bureau` = l'en-tête de bureau actif qu'il prétend. */
function clientDe(jeton: string, bureau?: string): SupabaseClient {
  return createClient(process.env.VITE_SUPABASE_URL ?? '', process.env.VITE_SUPABASE_ANON_KEY ?? '', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${jeton}`, ...(bureau ? { 'x-lume-org': bureau, 'x-org-id': bureau } : {}) } },
  });
}

beforeAll(async () => {
  jeu = lireManifeste();
  api = inject('uiApi');
  const sessionB = await sessionComplete(COMPTES.proprioB.email);
  jetonB = sessionB.access_token;
  const { data: adhesions } = await admin.from('memberships').select('org_id').eq('user_id', sessionB.user.id).eq('status', 'active');
  bureauxDeB = new Set((adhesions ?? []).map((m) => m.org_id as string));
  // Témoins : B est bien membre de son bureau, et PAS du bureau A.
  expect(bureauxDeB.has(lireManifeste().orgB)).toBe(true);
  expect(bureauxDeB.has(lireManifeste().orgA)).toBe(false);
  jetonTechA = (await sessionComplete(COMPTES.techA.email)).access_token;
});

afterAll(async () => { await fermerNavigateur(); });

const TABLES = ['automation_execution_logs', 'automation_scheduled_tasks', 'automation_rules'] as const;

describe('D — isolation : PostgREST avec le jeton d’un utilisateur du bureau B', () => {
  it('[D-ISO-01] témoin : la base contient bien des lignes du bureau A dans chaque table', async () => {
    for (const t of TABLES) {
      const { count } = await admin.from(t).select('id', { count: 'exact', head: true }).eq('org_id', jeu.orgA);
      expect(count ?? 0, t).toBeGreaterThan(0);
    }
  });

  for (const [titre, bureau] of [['sans en-tête de bureau', undefined], ['en se déclarant dans le bureau A', 'A'], ['en se déclarant dans le bureau B', 'B']] as const) {
    it(`[D-ISO-02] ${titre} : aucune ligne du bureau A (journaux, file, règles)`, async () => {
      const c = clientDe(jetonB, bureau === 'A' ? jeu.orgA : bureau === 'B' ? jeu.orgB : undefined);
      for (const t of TABLES) {
        const cible = await c.from(t).select('id, org_id').eq('org_id', jeu.orgA).limit(5);
        expect(cible.data ?? [], `${t} filtré sur le bureau A`).toEqual([]);
        const tout = await c.from(t).select('org_id').limit(1000);
        const vus = [...new Set((tout.data ?? []).map((l) => l.org_id as string))];
        expect(vus.filter((o) => !bureauxDeB.has(o)), `${t} sans filtre : bureaux dont B n'est pas membre`).toEqual([]);
        expect(vus.includes(jeu.orgA), `${t} sans filtre : le bureau A`).toBe(false);
      }
      // Par l'identifiant d'une règle du bureau A, et par celui d'un de ses clients.
      const parRegle = await c.from('automation_execution_logs').select('id').eq('automation_rule_id', jeu.regles.S.id);
      expect(parRegle.data ?? []).toEqual([]);
      const parClient = await c.from('automation_execution_logs').select('id').eq('entity_id', jeu.regles.S.clients[0].id);
      expect(parClient.data ?? []).toEqual([]);
    });
  }

  it('[D-ISO-03] le bac à sable (envois_simules) et l’outbox (domain_events) ne sont pas lisibles par une session', async () => {
    const c = clientDe(jetonB);
    for (const t of ['envois_simules', 'orgs_envois_simules', 'domain_events']) {
      const r = await c.from(t).select('*').limit(5);
      expect(r.data ?? [], `${t} : ${r.error?.message ?? 'aucune erreur'}`).toEqual([]);
    }
  });

  it('[D-ISO-04] B ne peut ni écrire, ni modifier, ni supprimer une ligne de journal du bureau A', async () => {
    const c = clientDe(jetonB);
    const { data: avant } = await admin.from('automation_execution_logs').select('id, result_error').eq('automation_rule_id', jeu.regles.E.id);
    const cible = (avant ?? [])[0] as { id: string; result_error: string };
    const ecrit = await c.from('automation_execution_logs').insert({
      org_id: jeu.orgA, automation_rule_id: jeu.regles.S.id, trigger_event: 'lead.created', entity_type: 'client',
      entity_id: jeu.regles.S.clients[0].id, action_type: 'send_sms', action_config: {}, result_success: true,
    }).select('id');
    expect(ecrit.data ?? []).toEqual([]);
    const modifie = await c.from('automation_execution_logs').update({ result_error: 'modifié par B' }).eq('id', cible.id).select('id');
    expect(modifie.data ?? []).toEqual([]);
    const supprime = await c.from('automation_execution_logs').delete().eq('id', cible.id).select('id');
    expect(supprime.data ?? []).toEqual([]);
    const { data: apres } = await admin.from('automation_execution_logs').select('id, result_error').eq('automation_rule_id', jeu.regles.E.id);
    expect(apres).toEqual(avant);
  });

  it('[D-ISO-05] un membre du bureau A ne peut pas falsifier son propre journal (aucune écriture par une session)', async () => {
    const proprio = clientDe((await sessionComplete(COMPTES.proprioA.email)).access_token, jeu.orgA);
    const { data: cible } = await admin.from('automation_execution_logs').select('id, result_success').eq('automation_rule_id', jeu.regles.E.id).limit(1).single();
    const modifie = await proprio.from('automation_execution_logs').update({ result_success: true, result_error: null }).eq('id', cible!.id).select('id');
    expect(modifie.data ?? [], 'modification du journal par le propriétaire').toEqual([]);
    const supprime = await proprio.from('automation_execution_logs').delete().eq('id', cible!.id).select('id');
    expect(supprime.data ?? [], 'suppression du journal par le propriétaire').toEqual([]);
  });

  it('[D-ISO-06] le technicien du bureau A (sans le droit de lire les automatisations) ne lit pas les journaux — ils portent des numéros et des messages', async () => {
    const c = clientDe(jetonTechA, jeu.orgA);
    const r = await c.from('automation_execution_logs').select('id, result_data').eq('org_id', jeu.orgA).limit(5);
    expect(r.data ?? []).toEqual([]);
  });
});

describe('D — isolation : l’API Express avec le jeton d’un utilisateur du bureau B', () => {
  // Sans bureau nommé, B parle depuis SON bureau du jeu : un compte qui a plusieurs bureaux doit dire lequel
  // (sans en-tête, l'API répond « quel bureau ? » — et la preuve lisait alors une erreur, pas des données).
  const appel = (chemin: string, bureau?: string) => fetch(`${api}${chemin}`, {
    headers: { Authorization: `Bearer ${jetonB}`, 'x-org-id': bureau ?? jeu.orgB },
  });

  it('[D-ISO-07] statistiques : aucune règle du bureau A, même demandée par son identifiant', async () => {
    const idsA = new Set(Object.values(jeu.regles).map((r) => r.id));
    const toutes = await (await appel('/api/automations/rules/stats')).json() as { par_regle: Record<string, unknown> };
    expect(Object.keys(toutes.par_regle ?? {}).filter((id) => idsA.has(id))).toEqual([]);
    const une = await (await appel(`/api/automations/rules/stats?rule_id=${jeu.regles.P.id}`)).json() as { par_regle: Record<string, unknown>; par_etape: Record<string, unknown> | null };
    expect({ par_regle: une.par_regle, par_etape: une.par_etape }).toEqual({ par_regle: {}, par_etape: {} });
  });

  it('[D-ISO-08] en se déclarant dans le bureau A (en-tête x-org-id) : refusé', async () => {
    const r = await appel('/api/automations/rules/stats', jeu.orgA);
    const corps = await r.text();
    const idsA = Object.values(jeu.regles).map((x) => x.id);
    expect(r.status === 403 || r.status === 401 || !idsA.some((id) => corps.includes(id)), `statut ${r.status}`).toBe(true);
    expect(idsA.some((id) => corps.includes(id))).toBe(false);
  });

  it('[D-ISO-09] l’éditeur et le diagnostic (GET /api/automations/editeur, /test) ne rendent rien du bureau A', async () => {
    const editeur = await (await appel(`/api/automations/editeur?rule_id=${jeu.regles.S.id}`)).json() as { rule: unknown };
    expect(editeur.rule).toBeNull();
    const diagnostic = await (await appel('/api/automations/test')).text();
    expect(diagnostic).not.toContain('[QA-D jeu]');
    expect(diagnostic).not.toContain(jeu.orgA);
  });
});

describe('D — isolation : l’écran du bureau B', () => {
  let b: Onglet;
  afterAll(async () => { await b?.fermer(); });

  it('[D-ISO-10] la liste, la Vue d’ensemble et l’adresse directe d’une règle de A ne montrent rien du bureau A', async () => {
    b = await ouvrirOnglet({ langue: 'fr', email: COMPTES.proprioB.email, org: inject('uiOrgB') });
    await b.page.goto(`${b.base}/automations`);
    await b.page.locator('#rech-automations').waitFor();
    await b.page.locator('#rech-automations').fill('[QA-D jeu]');
    await b.page.waitForTimeout(800);
    // Les LIGNES d'automatisation (celles qui portent une case à cocher) : l'état vide, lui, répète la recherche
    // (« Aucun résultat pour « [QA-D jeu] » », lot « liste », triage 03-onglets-etats:277) et n'est pas une ligne.
    const lignesDuJeu = b.page.locator('table tbody tr').filter({ has: b.page.locator('input[type="checkbox"]') }).filter({ hasText: '[QA-D jeu]' });
    expect(await lignesDuJeu.count()).toBe(0);
    expect(await b.page.locator('table tbody tr input[type="checkbox"]').count()).toBe(0);

    await b.page.goto(`${b.base}/automations/${jeu.regles.S.id}`);
    await expect.poll(async () => propre(await b.page.locator('body').innerText())).toContain('introuvable');
    expect(propre(await b.page.locator('body').innerText())).not.toContain('[QA-D jeu]');
  });

  it('[D-ISO-11] un utilisateur de B qui force le bureau actif A dans son navigateur ne voit toujours rien de A', async () => {
    const force = await ouvrirOnglet({ langue: 'fr', email: COMPTES.proprioB.email, org: jeu.orgA });
    try {
      const vus: string[] = [];
      force.page.on('response', async (r) => {
        if (!/automation_execution_logs|automation_rules|automations\/rules/.test(r.url())) return;
        const corps = await r.text().catch(() => '');
        if (corps.includes('[QA-D jeu]') || Object.values(jeu.regles).some((x) => corps.includes(x.id))) vus.push(r.url().replace(/^https?:\/\/[^/]+/, '').slice(0, 120));
      });
      await force.page.goto(`${force.base}/automations`);
      await force.page.waitForLoadState('networkidle').catch(() => undefined);
      await force.page.goto(`${force.base}/automations/apercu`);
      await force.page.waitForLoadState('networkidle').catch(() => undefined);
      await force.page.goto(`${force.base}/automations/${jeu.regles.E.id}`);
      await force.page.waitForLoadState('networkidle').catch(() => undefined);
      expect(propre(await force.page.locator('body').innerText())).not.toContain('[QA-D jeu]');
      expect(vus, 'réponses réseau portant des données du bureau A').toEqual([]);
    } finally {
      await force.fermer();
    }
  });
});
