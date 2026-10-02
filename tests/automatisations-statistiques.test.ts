/**
 * LES STATISTIQUES DES AUTOMATISATIONS — une définition par métrique.
 *
 * Audit du 2026-09-28 : « Total déclenché » et « En cours » valaient toujours « — ».
 * Mission du 2026-10-01 (points 4 et 5) : chaque écran comptait à sa façon, dans le navigateur,
 * sur 200 ou 1 000 lignes au plus (constats D-01, D-02, D-09). Le compte se fait désormais EN
 * BASE (fonction SQL `automation_statistiques`, migration S-01) ; le serveur additionne ce que
 * la base rend. Ce fichier éprouve, sans réseau :
 *   · l'addition (`plierStatistiques`) : envoyée ≠ action faite ≠ ignorée ≠ échouée ≠ reportée ;
 *   · la période : des jours civils dans le fuseau de l'ENTREPRISE ;
 *   · les routes : paramètres refusés, panne dite comme une panne, filtres passés à la base.
 * La justesse des comptes contre de vraies lignes est prouvée sur la pile locale :
 * tests/automations-finale/d/integration/10-jeu-connu.preuve.ts et 12-nouveau-format.preuve.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';

const ORG = '11111111-2222-3333-4444-555555555555';
const R1 = 'aaaaaaaa-0000-4000-8000-000000000001';
const R2 = 'aaaaaaaa-0000-4000-8000-000000000002';

/** Ce que la base rendrait pour un petit bureau. */
const BRUT = () => ({
  lignes: [
    { rule_id: R1, action_type: 'send_sms', issue: 'fait', categorie: 'envoyee', n: 4 },
    { rule_id: R1, action_type: 'create_task', issue: 'fait', categorie: 'action', n: 2 },
    { rule_id: R1, action_type: 'send_sms', issue: 'sans_telephone', categorie: 'ignoree', n: 3 },
    { rule_id: R1, action_type: 'send_sms', issue: 'plafond_frequence', categorie: 'ignoree', n: 1 },
    { rule_id: R1, action_type: 'conditions', issue: 'conditions', categorie: 'ignoree', n: 5 },
    { rule_id: R1, action_type: 'send_sms', issue: 'annulee', categorie: 'annulee', n: 1 },
    { rule_id: R1, action_type: 'send_sms', issue: 'hors_heures', categorie: 'reportee', n: 2 },
    { rule_id: R1, action_type: 'send_sms', issue: 'echec', categorie: 'echouee', n: 1 },
    // Jamais comptées sur une période : tentatives reprises, envois en file.
    { rule_id: R1, action_type: 'send_sms', issue: 'tentative', categorie: 'tentative', n: 3 },
    { rule_id: R1, action_type: 'send_sms', issue: 'en_attente', categorie: 'en_cours', n: 2 },
    { rule_id: R2, action_type: 'send_email', issue: 'fait', categorie: 'envoyee', n: 1 },
    { rule_id: R2, action_type: 'send_email', issue: 'code_inconnu_du_fichier', categorie: 'ignoree', n: 1 },
  ],
  declenchees: [{ rule_id: R1, n: 9 }, { rule_id: R2, n: 2 }],
  par_jour: [{ jour: '2026-09-29', n: 4 }, { jour: '2026-10-01', n: 7 }],
  par_jour_categorie: [
    { jour: '2026-09-29', categorie: 'envoyee', n: 2 },
    { jour: '2026-10-01', categorie: 'envoyee', n: 3 },
    { jour: '2026-10-01', categorie: 'echouee', n: 1 },
    { jour: '2026-10-01', categorie: 'ignoree', n: 10 },
    { jour: '2026-10-01', categorie: 'annulee', n: 1 },
    { jour: '2026-10-01', categorie: 'action', n: 2 },
  ],
  en_cours: [{ rule_id: R1, n: 2 }],
  dernier_echec: [{ rule_id: R1, quand: '2026-10-01T15:00:00Z', action_type: 'send_sms', erreur: 'Twilio 30007' }],
  dernier_ignore: [{ rule_id: R1, quand: '2026-10-01T16:00:00Z', action_type: 'send_sms', issue: 'sans_telephone', detail: 'Aucun numéro de téléphone pour ce client' }],
  etapes: null as null | Array<{ step_id: string; categorie: string; n: number }>,
  etapes_en_attente: null as null | Array<{ step_id: string; n: number }>,
});

let brut = BRUT();
let erreurRpc: { message: string } | null = null;
let fuseauBureau: string | null = 'America/Vancouver';
const appels: Array<{ fn: string; args: Record<string, unknown> }> = [];

/** Faux client de l'utilisateur : `rpc` rend ce que la base rendrait, `from` le fuseau du bureau. */
function fauxClient() {
  const chaine = (resultat: unknown) => {
    const c: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in', 'order', 'range']) c[m] = () => c;
    c.maybeSingle = async () => resultat;
    c.then = (ok: (r: unknown) => unknown) => Promise.resolve(resultat).then(ok);
    return c;
  };
  return {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      appels.push({ fn, args });
      if (erreurRpc) return { data: null, error: erreurRpc };
      if (fn === 'automation_statistiques') return { data: brut, error: null };
      if (fn === 'automation_journal') return { data: { total: 0, actions: [], lignes: [] }, error: null };
      if (fn === 'automation_passages') return { data: { total: 0, passages: [] }, error: null };
      return { data: null, error: { message: `fonction inconnue : ${fn}` } };
    },
    from: (table: string) => (table === 'company_settings'
      ? chaine({ data: fuseauBureau ? { timezone: fuseauBureau } : null, error: null })
      : chaine({ data: [], error: null, count: 0 })),
  };
}

vi.mock('../server/lib/supabase', () => ({
  requireAuthedClient: async () => ({ client: fauxClient(), orgId: ORG, user: { id: 'u1' } }),
  getServiceClient: () => fauxClient(),
}));

// Le numéro texto du bureau : même source que le moteur (getOrgSmsChannel).
let canalSms: { phone_number: string } | null = null;
vi.mock('../server/lib/twilioProvisioning', () => ({ getOrgSmsChannel: async () => canalSms }));
vi.mock('../server/lib/config', () => ({ twilioClient: { messages: {} } }));

const { default: routeur } = await import('../server/routes/automation-stats');
const { plierStatistiques, periode, bornes, jourLocal, minuitLocal } = await import('../server/lib/automations-stats');
const { CATEGORIES_PAR_CODE, ACTIONS_MESSAGE_CLIENT } = await import('../src/lib/automationIssues');

async function lire(chemin: string) {
  const app = express();
  app.use('/api', routeur);
  const serveur = app.listen(0);
  try {
    const { port } = serveur.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/api${chemin}`, { headers: { Authorization: 'Bearer x' } });
    return { status: res.status, json: await res.json() as any };
  } finally {
    serveur.close();
  }
}

beforeEach(() => {
  brut = BRUT();
  erreurRpc = null;
  fuseauBureau = 'America/Vancouver';
  canalSms = null;
  appels.length = 0;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

const P = () => periode(7, 'America/Montreal', new Date('2026-10-01T16:00:00Z'));

describe('une définition par métrique', () => {
  it('envoyée ≠ action faite ≠ ignorée ≠ annulée ≠ reportée ≠ échouée ; tentatives et envois en file ne sont jamais comptés', () => {
    const s = plierStatistiques(brut, P());
    expect(s.par_regle[R1]).toMatchObject({
      declenchees: 9,
      envoyees: 4,        // textos partis
      actions: 2,         // tâches créées : PAS des envois (D-23)
      echouees: 1,        // 1 échec définitif, pas 1 + 3 tentatives
      ignorees: 10,       // 3 + 1 + 5 ignorées, + 1 annulée
      annulees: 1,
      reportees: 2,       // partira au prochain créneau : pas une ignorée
      en_cours: 2,
    });
  });

  it('les ignorées sont détaillées par raison : les groupes de automationMotifs.ts', () => {
    const s = plierStatistiques(brut, P());
    expect(s.par_regle[R1].ignorees_par_groupe).toEqual({
      donnee_manquante: 3, plafond: 1, hors_ciblage: 5, condition_plus_valide: 1,
    });
    expect(s.par_regle[R1].ignorees_par_code).toEqual({ sans_telephone: 3, plafond_frequence: 1, conditions: 5, annulee: 1 });
    expect(s.par_regle[R1].reportees_par_code).toEqual({ hors_heures: 2 });
  });

  it('un code que la liste ne connaît pas est rangé « autre », jamais perdu', () => {
    const s = plierStatistiques(brut, P());
    expect(s.par_regle[R2]).toMatchObject({ ignorees: 1, ignorees_par_groupe: { autre: 1 } });
  });

  it('le total du bureau est la somme des automatisations — pas une autre définition (D-09)', () => {
    const s = plierStatistiques(brut, P());
    for (const k of ['declenchees', 'envoyees', 'actions', 'echouees', 'ignorees', 'reportees', 'en_cours'] as const) {
      expect(s.total[k], k).toBe(Object.values(s.par_regle).reduce((t, r) => t + r[k], 0));
    }
    expect(s.total).toMatchObject({ declenchees: 11, envoyees: 5, echouees: 1, ignorees: 11 });
  });

  it('le dernier échec et le dernier envoi ignoré de chaque automatisation sont rendus avec leur cause', () => {
    const s = plierStatistiques(brut, P());
    expect(s.par_regle[R1].dernier_echec).toEqual({ quand: '2026-10-01T15:00:00Z', action_type: 'send_sms', erreur: 'Twilio 30007' });
    expect(s.par_regle[R1].dernier_ignore?.issue).toBe('sans_telephone');
    expect(s.par_regle[R2].dernier_echec).toBeNull();
  });

  it('les noms d’avant (panneau d’étape, suite) : un événement écarté par ses conditions n’est pas une « étape sautée »', () => {
    const s = plierStatistiques(brut, P());
    expect(s.par_regle[R1]).toMatchObject({ declenches: 9, envoyes: 6, sautes: 5, echecs: 1 });
    expect(s.par_regle[R1].sautes_par_raison).toEqual({ sans_telephone: 3, plafond_frequence: 1, annulee: 1 });
    expect(s.par_regle[R1].dernier_saut).toBe('Aucun numéro de téléphone pour ce client');
  });
});

describe('la courbe', () => {
  it('un élément par jour de la période, zéros compris, et leur somme est le total', () => {
    const s = plierStatistiques(brut, P());
    expect(s.par_jour.map((j) => j.jour)).toEqual(['2026-09-25', '2026-09-26', '2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01']);
    expect(s.par_jour.map((j) => j.declenchees)).toEqual([0, 0, 0, 0, 4, 0, 7]);
    expect(s.par_jour.reduce((t, j) => t + j.declenchees, 0)).toBe(s.total.declenchees);
    expect(s.par_jour[6]).toEqual({ jour: '2026-10-01', declenchees: 7, envoyees: 3, echouees: 1, ignorees: 11 });
  });
});

describe('par étape', () => {
  it('rattache chaque exécution à son étape ; « réussis » = envois + actions faites', () => {
    brut.etapes = [
      { step_id: 'e1', categorie: 'envoyee', n: 1 }, { step_id: 'e1', categorie: 'ignoree', n: 1 }, { step_id: 'e1', categorie: 'echouee', n: 1 },
      { step_id: 'e2', categorie: 'action', n: 2 }, { step_id: 'e2', categorie: 'tentative', n: 4 },
    ];
    brut.etapes_en_attente = [{ step_id: 'e2', n: 1 }, { step_id: 'e3', n: 2 }];
    expect(plierStatistiques(brut, P()).par_etape).toEqual({
      e1: { envoyes: 1, sautes: 1, echecs: 1, en_attente: 0 },
      e2: { envoyes: 2, sautes: 0, echecs: 0, en_attente: 1 },
      e3: { envoyes: 0, sautes: 0, echecs: 0, en_attente: 2 },
    });
  });

  it('sans automatisation demandée : pas de détail par étape', () => {
    expect(plierStatistiques(brut, P()).par_etape).toBeNull();
  });
});

describe('la période : des jours civils dans le fuseau de l’entreprise', () => {
  it('« 7 derniers jours » = aujourd’hui et les 6 jours d’avant, de minuit heure locale', () => {
    // 1er octobre, 12 h à Montréal.
    const p = periode(7, 'America/Montreal', new Date('2026-10-01T16:00:00Z'));
    expect(p).toMatchObject({ jours: 7, premier_jour: '2026-09-25', dernier_jour: '2026-10-01', depuis: '2026-09-25T04:00:00.000Z' });
  });

  it('le même instant n’est pas le même jour à Montréal et à Tokyo', () => {
    const instant = new Date('2026-10-01T02:30:00Z'); // 22 h 30 le 30 septembre à Montréal, 11 h 30 le 1er octobre à Tokyo
    expect(jourLocal(instant, 'America/Montreal')).toBe('2026-09-30');
    expect(jourLocal(instant, 'Asia/Tokyo')).toBe('2026-10-01');
    expect(periode(30, 'Asia/Tokyo', instant)).toMatchObject({ premier_jour: '2026-09-02', depuis: '2026-09-01T15:00:00.000Z' });
  });

  it('minuit local tient compte du changement d’heure', () => {
    // Le 1er novembre 2026, Montréal repasse à l'heure normale (UTC−5) à 2 h : minuit est encore à UTC−4.
    expect(minuitLocal('2026-11-01', 'America/Montreal').toISOString()).toBe('2026-11-01T04:00:00.000Z');
    expect(minuitLocal('2026-11-02', 'America/Montreal').toISOString()).toBe('2026-11-02T05:00:00.000Z');
  });

  it('un fuseau inconnu retombe sur celui par défaut, sans planter', () => {
    expect(periode(7, 'Pas/Un_Fuseau', new Date('2026-10-01T16:00:00Z')).fuseau).toBe('America/Montreal');
  });

  it('les dates choisies resserrent la période ; « au » comprend toute la journée', () => {
    const b = bornes({ jours: 30, du: '2026-09-28', au: '2026-09-29' }, 'America/Montreal', new Date('2026-10-01T16:00:00Z'));
    expect(b.depuis).toBe('2026-09-28T04:00:00.000Z');
    expect(b.jusqua).toBe('2026-09-30T03:59:59.999Z');
    // Une date d'avant la période ne l'élargit pas.
    expect(bornes({ jours: 7, du: '2026-01-01' }, 'America/Montreal', new Date('2026-10-01T16:00:00Z')).depuis).toBe('2026-09-25T04:00:00.000Z');
  });
});

describe('GET /api/automations/rules/stats', () => {
  it('compte sur la période demandée, dans le fuseau du BUREAU, avec la liste unique des codes', async () => {
    const r = await lire('/automations/rules/stats?jours=30');
    expect(r.status).toBe(200);
    expect(r.json.periode).toMatchObject({ jours: 30, fuseau: 'America/Vancouver' });
    expect(appels).toHaveLength(1);
    expect(appels[0].fn).toBe('automation_statistiques');
    expect(appels[0].args).toMatchObject({ p_org: ORG, p_rule: null, p_fuseau: 'America/Vancouver', p_categories: CATEGORIES_PAR_CODE, p_messages: ACTIONS_MESSAGE_CLIENT });
    expect(r.json.par_regle[R1].declenchees).toBe(9);
    expect(r.json.total.declenchees).toBe(11);
  });

  it.each(['7', '30', '90'])('accepte %s jours', async (jours) => {
    expect((await lire(`/automations/rules/stats?jours=${jours}`)).status).toBe(200);
  });

  it.each(['0', '45', '365', 'abc', '-7'])('refuse la période « %s » (400)', async (jours) => {
    const r = await lire(`/automations/rules/stats?jours=${jours}`);
    expect(r.status).toBe(400);
    expect(appels).toHaveLength(0);
  });

  it('sans période : 60 jours, la fenêtre que le panneau d’étape de l’éditeur annonce', async () => {
    const r = await lire(`/automations/rules/stats?rule_id=${R1}`);
    expect(r.json.periode.jours).toBe(60);
    expect(appels[0].args.p_rule).toBe(R1);
  });

  it('refuse un identifiant d’automatisation mal formé', async () => {
    const r = await lire('/automations/rules/stats?rule_id=nimporte');
    expect(r.status).toBe(400);
    expect(appels).toHaveLength(0);
  });

  it('une lecture en panne répond 500 — jamais des zéros', async () => {
    erreurRpc = { message: 'canceling statement due to statement timeout' };
    const r = await lire('/automations/rules/stats?jours=7');
    expect(r.status).toBe(500);
    expect(r.json.par_regle).toBeUndefined();
    expect(r.json.error).toBe('Impossible de lire les statistiques des automatisations.');
  });

  it('un bureau sans réglage de fuseau compte dans celui par défaut', async () => {
    fuseauBureau = null;
    expect((await lire('/automations/rules/stats?jours=7')).json.periode.fuseau).toBe('America/Montreal');
  });
});

describe('le bandeau « étapes texto sautées »', () => {
  it('texto_configure = false tant que le bureau n’a pas de numéro', async () => {
    expect((await lire('/automations/rules/stats')).json.texto_configure).toBe(false);
  });

  it('texto_configure = true quand le bureau a un numéro actif', async () => {
    canalSms = { phone_number: '+15145550101' };
    expect((await lire('/automations/rules/stats')).json.texto_configure).toBe(true);
  });
});

describe('GET /api/automations/rules/journaux et /historique', () => {
  it('les filtres partent à la BASE : statut → catégories, recherche, dates, page', async () => {
    const r = await lire(`/automations/rules/journaux?rule_id=${R1}&jours=90&statut=ignores&q=Tremblay&du=2026-09-01&au=2026-09-15&action=send_sms&page=3&par_page=50`);
    expect(r.status).toBe(200);
    const a = appels.find((x) => x.fn === 'automation_journal');
    expect(a?.args).toMatchObject({
      p_org: ORG, p_rule: R1, p_statuts: ['ignoree', 'annulee'], p_action: 'send_sms', p_recherche: 'Tremblay',
      p_limite: 50, p_decalage: 100, p_categories: CATEGORIES_PAR_CODE,
    });
    // Le bureau est à Vancouver : le 1er septembre commence à 7 h UTC, le 15 finit à 6 h 59 UTC le 16.
    expect(a?.args.p_depuis).toBe('2026-09-01T07:00:00.000Z');
    expect(a?.args.p_jusqua).toBe('2026-09-16T06:59:59.999Z');
  });

  it('« Réussis » ne contient pas les envois ignorés (D-10) : deux filtres distincts', async () => {
    await lire('/automations/rules/journaux?statut=reussis');
    expect(appels.find((x) => x.fn === 'automation_journal')?.args.p_statuts).toEqual(['envoyee', 'action']);
  });

  it('sans automatisation : tout le bureau (D-13)', async () => {
    await lire('/automations/rules/historique?jours=7');
    expect(appels.find((x) => x.fn === 'automation_passages')?.args).toMatchObject({ p_rule: null, p_statuts: null, p_limite: 50, p_decalage: 0 });
  });

  it.each([
    'statut=nimporte', 'jours=12', 'du=hier', 'rule_id=abc', 'client_id=1', 'page=0', 'par_page=5000', 'action=DROP%20TABLE',
  ])('refuse le filtre « %s » (400) sans interroger la base', async (filtre) => {
    for (const chemin of ['journaux', 'historique']) {
      const r = await lire(`/automations/rules/${chemin}?${filtre}`);
      expect(r.status, chemin).toBe(400);
    }
    expect(appels).toHaveLength(0);
  });

  it('une lecture en panne répond 500 avec une phrase, pas une liste vide', async () => {
    erreurRpc = { message: 'boom' };
    const r = await lire('/automations/rules/journaux');
    expect(r.status).toBe(500);
    expect(r.json.lignes).toBeUndefined();
  });

  it('les modifications se lisent pour UNE automatisation', async () => {
    expect((await lire('/automations/rules/modifications')).status).toBe(400);
    const r = await lire(`/automations/rules/modifications?rule_id=${R1}`);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ total: 0, page: 1, lignes: [] });
  });
});
