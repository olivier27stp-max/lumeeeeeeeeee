/**
 * Agent S — isolation par bureau des NOUVELLES lectures (points 4 et 5) :
 *   · les fonctions SQL `automation_statistiques`, `automation_journal`, `automation_passages`,
 *     `automation_evenements` (SECURITY INVOKER : la RLS de l'appelant s'applique) ;
 *   · les routes `GET /api/automations/rules/stats | historique | journaux | modifications`.
 *
 * L'agent D avait vérifié l'isolation des lectures d'origine (40-isolation.preuve.ts, 13 preuves
 * vertes). Les mêmes attaques, sur ce qui a été ajouté : le bureau B (jeton d'un vrai
 * utilisateur de B) ne voit RIEN du bureau A, même en donnant l'identifiant du bureau A, d'une
 * règle de A ou d'un client de A ; un membre de A sans « Voir les automatisations » ne lit rien ;
 * un visiteur sans session n'exécute rien.
 */
import { describe, it, expect, beforeAll, inject } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { sessionComplete } from '../../../automations-suite/harnais/navigateur';
import { COMPTES } from '../../../automations-suite/harnais/bureau-test';
import { lireManifeste, attenduTotal, type Manifeste } from '../jeu-connu';
import { ACTIONS_MESSAGE_CLIENT, CATEGORIES_PAR_CODE } from '../../../../src/lib/automationIssues';

let jeu: Manifeste;
let jetonA: string;
let jetonB: string;
let jetonTechA: string;
let api: string;
const DEPUIS = new Date(Date.now() - 90 * 86_400_000).toISOString();

function clientDe(jeton: string | null, bureau?: string): SupabaseClient {
  return createClient(process.env.VITE_SUPABASE_URL ?? '', process.env.VITE_SUPABASE_ANON_KEY ?? '', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { ...(jeton ? { Authorization: `Bearer ${jeton}` } : {}), ...(bureau ? { 'x-lume-org': bureau, 'x-org-id': bureau } : {}) } },
  });
}

const COMMUNS = { p_categories: CATEGORIES_PAR_CODE, p_messages: ACTIONS_MESSAGE_CLIENT };
const statistiques = (c: SupabaseClient, org: string, regle: string | null = null) =>
  c.rpc('automation_statistiques', { p_org: org, p_depuis: DEPUIS, p_rule: regle, p_fuseau: 'America/Montreal', ...COMMUNS });
const journal = (c: SupabaseClient, org: string, plus: Record<string, unknown> = {}) =>
  c.rpc('automation_journal', { p_org: org, p_depuis: DEPUIS, p_jusqua: null, p_rule: null, p_statuts: null, p_action: null, p_client: null, p_recherche: null, ...COMMUNS, p_limite: 50, p_decalage: 0, ...plus });
const passages = (c: SupabaseClient, org: string, plus: Record<string, unknown> = {}) =>
  c.rpc('automation_passages', { p_org: org, p_depuis: DEPUIS, p_jusqua: null, p_rule: null, p_statuts: null, p_client: null, p_recherche: null, ...COMMUNS, p_limite: 50, p_decalage: 0, ...plus });

beforeAll(async () => {
  jeu = lireManifeste();
  api = inject('uiApi');
  jetonA = (await sessionComplete(COMPTES.proprioA.email)).access_token;
  jetonB = (await sessionComplete(COMPTES.proprioB.email)).access_token;
  jetonTechA = (await sessionComplete(COMPTES.techA.email)).access_token;
});

describe('S — isolation : les fonctions SQL, appelées directement par PostgREST', () => {
  it('[S-ISO-01] témoin : le propriétaire du bureau A lit bien son bureau par ces fonctions', async () => {
    const s = await statistiques(clientDe(jetonA, jeu.orgA), jeu.orgA);
    expect(s.error).toBeNull();
    const declenchees = ((s.data as { declenchees: Array<{ n: number }> }).declenchees ?? []).reduce((t, d) => t + Number(d.n), 0);
    expect(declenchees).toBe(attenduTotal(jeu, 90).declenchees);
    expect(Number((await journal(clientDe(jetonA, jeu.orgA), jeu.orgA)).data?.total)).toBe(attenduTotal(jeu, 90).journal);
    expect(Number((await passages(clientDe(jetonA, jeu.orgA), jeu.orgA)).data?.total)).toBe(attenduTotal(jeu, 90).passages);
  });

  for (const [titre, bureau] of [['sans en-tête de bureau', undefined], ['en se déclarant dans le bureau A', 'A'], ['en se déclarant dans le bureau B', 'B']] as const) {
    it(`[S-ISO-02] le bureau B, ${titre}, demande les chiffres du bureau A : tout est vide`, async () => {
      const c = clientDe(jetonB, bureau === 'A' ? jeu.orgA : bureau === 'B' ? jeu.orgB : undefined);
      const s = await statistiques(c, jeu.orgA);
      expect(s.error).toBeNull();
      const brut = s.data as Record<string, unknown[]>;
      for (const cle of ['lignes', 'declenchees', 'par_jour', 'par_jour_categorie', 'en_cours', 'dernier_echec', 'dernier_ignore']) {
        expect(brut[cle], cle).toEqual([]);
      }
      // Par l'identifiant d'une règle de A.
      const parRegle = (await statistiques(c, jeu.orgA, jeu.regles.S.id)).data as Record<string, unknown[]>;
      expect([parRegle.lignes, parRegle.declenchees, parRegle.etapes, parRegle.etapes_en_attente]).toEqual([[], [], [], []]);

      for (const lecture of [journal, passages]) {
        const tout = await lecture(c, jeu.orgA);
        expect(tout.error).toBeNull();
        expect(JSON.stringify(tout.data), 'aucune ligne, aucun total').toMatch(/"total": ?0/);
        // Par une règle de A, par un client de A, par le nom d'un client de A.
        for (const plus of [{ p_rule: jeu.regles.S.id }, { p_client: jeu.regles.S.clients[0].id }, { p_recherche: 'Jeu' }]) {
          const r = await lecture(c, jeu.orgA, plus);
          expect(Number((r.data as { total: number } | null)?.total ?? -1), JSON.stringify(plus)).toBe(0);
        }
      }
      const ev = await c.rpc('automation_evenements', { p_org: jeu.orgA, p_depuis: DEPUIS, p_rule: null, ...COMMUNS });
      expect(ev.data ?? []).toEqual([]);
      const client = await c.rpc('automation_client_de', { p_org: jeu.orgA, p_type: 'client', p_id: jeu.regles.S.clients[0].id });
      expect(client.data ?? null, 'le client d’une fiche de A').toBeNull();
    });
  }

  it('[S-ISO-03] le bureau B demandant SON bureau ne reçoit aucune ligne du bureau A', async () => {
    const c = clientDe(jetonB, jeu.orgB);
    const ids = new Set(Object.values(jeu.regles).map((r) => r.id));
    const s = (await statistiques(c, jeu.orgB)).data as { lignes: Array<{ rule_id: string }>; declenchees: Array<{ rule_id: string }> };
    expect([...s.lignes, ...s.declenchees].filter((l) => ids.has(l.rule_id))).toEqual([]);
    const j = (await journal(c, jeu.orgB)).data as { lignes: Array<{ rule_id: string }> };
    expect(j.lignes.filter((l) => ids.has(l.rule_id))).toEqual([]);
  });

  it('[S-ISO-04] un membre du bureau A sans « Voir les automatisations » (technicien) ne lit rien', async () => {
    const c = clientDe(jetonTechA, jeu.orgA);
    const s = (await statistiques(c, jeu.orgA)).data as Record<string, unknown[]>;
    expect([s.lignes, s.declenchees, s.en_cours]).toEqual([[], [], []]);
    expect(Number(((await journal(c, jeu.orgA)).data as { total: number }).total)).toBe(0);
    expect(Number(((await passages(c, jeu.orgA)).data as { total: number }).total)).toBe(0);
  });

  it('[S-ISO-05] sans session (anon), aucune de ces fonctions ne s’exécute', async () => {
    const c = clientDe(null);
    for (const appel of [statistiques(c, jeu.orgA), journal(c, jeu.orgA), passages(c, jeu.orgA),
      c.rpc('automation_evenements', { p_org: jeu.orgA, p_depuis: DEPUIS, p_rule: null, ...COMMUNS }),
      c.rpc('automation_client_de', { p_org: jeu.orgA, p_type: 'client', p_id: jeu.regles.S.clients[0].id })]) {
      const r = await appel;
      expect(r.data ?? null, 'aucune donnée').toBeNull();
      expect(r.error, 'refus').not.toBeNull();
    }
  });
});

describe('S — isolation : les routes de l’API', () => {
  const lire = (chemin: string, jeton: string, bureau?: string) => fetch(`${api}/api/automations/rules/${chemin}`, {
    headers: { Authorization: `Bearer ${jeton}`, ...(bureau ? { 'x-org-id': bureau } : {}) },
  });

  it('[S-ISO-10] le bureau B ne reçoit rien du bureau A par les routes, même avec une règle ou un client de A', async () => {
    for (const chemin of [
      `historique?jours=90&rule_id=${jeu.regles.S.id}`,
      `journaux?jours=90&rule_id=${jeu.regles.S.id}`,
      `historique?jours=90&client_id=${jeu.regles.S.clients[0].id}`,
      `journaux?jours=90&client_id=${jeu.regles.S.clients[0].id}`,
      'historique?jours=90&q=Jeu',
      'journaux?jours=90&q=Jeu',
      `modifications?rule_id=${jeu.regles.S.id}`,
    ]) {
      const r = await lire(chemin, jetonB, jeu.orgB);
      expect(r.status, chemin).toBe(200);
      const corps = await r.json() as { total: number; lignes?: unknown[]; passages?: unknown[] };
      expect({ chemin, total: corps.total, n: (corps.lignes ?? corps.passages ?? []).length }).toEqual({ chemin, total: 0, n: 0 });
    }
    const stats = await (await lire(`stats?jours=90&rule_id=${jeu.regles.S.id}`, jetonB, jeu.orgB)).json() as { par_regle: Record<string, unknown>; par_etape: Record<string, unknown> };
    expect([stats.par_regle, stats.par_etape]).toEqual([{}, {}]);
    const tout = await (await lire('stats?jours=90', jetonB, jeu.orgB)).json() as { par_regle: Record<string, unknown> };
    expect(Object.keys(tout.par_regle).filter((id) => Object.values(jeu.regles).some((r) => r.id === id))).toEqual([]);
  });

  it('[S-ISO-11] le bureau B demandant le bureau A (`x-org-id`) : 403 sur chaque route', async () => {
    for (const chemin of ['stats?jours=30', 'historique?jours=30', 'journaux?jours=30', `modifications?rule_id=${jeu.regles.S.id}`]) {
      expect((await lire(chemin, jetonB, jeu.orgA)).status, chemin).toBe(403);
    }
  });

  it('[S-ISO-12] le technicien du bureau A (sans le droit) : 403 sur chaque route', async () => {
    for (const chemin of ['stats?jours=30', 'historique?jours=30', 'journaux?jours=30', `modifications?rule_id=${jeu.regles.S.id}`]) {
      expect((await lire(chemin, jetonTechA, jeu.orgA)).status, chemin).toBe(403);
    }
  });

  it('[S-ISO-13] sans jeton : 401', async () => {
    for (const chemin of ['stats', 'historique', 'journaux', `modifications?rule_id=${jeu.regles.S.id}`]) {
      expect((await fetch(`${api}/api/automations/rules/${chemin}`)).status, chemin).toBe(401);
    }
  });
});
