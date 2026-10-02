/**
 * `ecrireRegle` — la seule porte par laquelle Lumi écrit le contenu d'une
 * automatisation (mission finale, 2026-10-02).
 *
 * Avant : chaque outil écrivait `automation_rules` à sa façon (un `insert`,
 * trois `update`), avec ses contrôles ou sans. Ce que ces tests figent :
 *   1. rien n'est écrit hors du bureau, ni à la corbeille ;
 *   2. un contenu que les routes refuseraient est refusé ici aussi ;
 *   3. `steps` et `actions` sont écrits ENSEMBLE et disent la même chose ;
 *   4. le résultat rendu est la ligne RELUE, pas ce qu'on voulait écrire ;
 *   5. une écriture filtrée par la RLS (0 ligne) n'est jamais un succès ;
 *   6. la publication ne passe jamais par ici.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const { etat } = vi.hoisted(() => ({
  etat: {
    lignes: [] as Array<Record<string, any>>,
    ops: [] as Array<{ op: string; charge?: any; filtres: Array<[string, any]> }>,
    /** Simule la RLS : l'écriture « réussit » sans toucher de ligne. */
    rlsBloque: false,
    /** Ce que la base rend à la relecture, si elle normalise (pour prouver qu'on rend la ligne RELUE). */
    alaRelecture: null as null | ((l: Record<string, any>) => Record<string, any>),
    offert: true,
  },
}));

function requete() {
  const filtres: Array<[string, any]> = [];
  let op: 'select' | 'insert' | 'update' = 'select';
  let charge: any = null;
  const correspond = (l: Record<string, any>) => filtres.every(([k, v]) => (v === null ? l[k] == null : l[k] === v));
  const q: any = {
    select: () => q,
    insert: (c: any) => { op = 'insert'; charge = c; return q; },
    update: (c: any) => { op = 'update'; charge = c; return q; },
    eq: (k: string, v: any) => { filtres.push([k, v]); return q; },
    is: (k: string, v: any) => { filtres.push([k, v]); return q; },
    maybeSingle: async () => { const r = executer(); return { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: r.error }; },
    then: (ok: any, ko: any) => Promise.resolve(executer()).then(ok, ko),
  };
  function executer(): { data: any; error: any } {
    etat.ops.push({ op, charge, filtres });
    if (op === 'insert') {
      const l = { id: `r${etat.lignes.length + 1}`, deleted_at: null, purged_at: null, modele_id: null, ...charge };
      etat.lignes.push(l);
      return { data: [{ id: l.id }], error: null };
    }
    if (op === 'update') {
      if (etat.rlsBloque) return { data: [], error: null };
      const touchees = etat.lignes.filter(correspond);
      for (const l of touchees) Object.assign(l, charge);
      return { data: touchees.map((l) => ({ id: l.id })), error: null };
    }
    const trouvees = etat.lignes.filter(correspond).map((l) => (etat.alaRelecture ? etat.alaRelecture(l) : l));
    return { data: trouvees, error: null };
  }
  return q;
}
const client = { from: (_table: string) => requete() } as any;

vi.mock('../server/lib/automations-drapeaux', () => ({
  declencheurOffertA: async () => etat.offert,
  refusDeclencheurNonOffert: () => 'Ce déclencheur n’est pas encore offert à votre entreprise.',
}));
vi.mock('../server/lib/automations-publication', () => ({
  // Un problème bloquant « de laboratoire » : une étape nommée CASSE.
  problemesBloquants: (r: any) => (Array.isArray(r.steps) && r.steps.some((e: any) => e?.nom === 'CASSE') ? ['Une étape est incomplète'] : []),
  messagePublieeCassee: (p: string[]) => `Cette automatisation est publiée : la modification la casserait (${p.join(', ')}).`,
  refAutomatisationInventee: async () => false,
}));
vi.mock('../server/routes/automation-rules', () => ({ verifierCoherence: () => null }));
vi.mock('../server/lib/logger', () => ({ logger: { info: () => {}, warn: () => {}, error: () => {} } }));

import { ecrireRegle } from '../server/lib/automations-ecriture';

const ORG = 'org-1';
const texto = (id: string, body: string, suivant: string | null = null, nom?: string) => ({ id, type: 'action', ...(nom ? { nom } : {}), action: { type: 'send_sms', config: { body } }, suivant });
const attente = (id: string, s: number, suivant: string) => ({ id, type: 'attendre', delai_secondes: s, suivant });
const regle = (plus: Record<string, any> = {}) => ({
  id: 'r1', org_id: ORG, name: 'Relance devis', trigger_event: 'quote.sent', conditions: {}, delay_seconds: 0,
  steps: [texto('e1', 'Bonjour [client_first_name]')], actions: [{ type: 'send_sms', config: { body: 'vieux texte' } }],
  settings: null, is_active: false, is_preset: false, deleted_at: null, purged_at: null, modele_id: null, ...plus,
});
const ecritures = () => etat.ops.filter((o) => o.op === 'update' || o.op === 'insert');

beforeEach(() => { etat.lignes = []; etat.ops = []; etat.rlsBloque = false; etat.alaRelecture = null; etat.offert = true; });

describe('1 — la règle : dans ce bureau, pas à la corbeille', () => {
  it('une automatisation d’un autre bureau est introuvable, et rien n’est écrit', async () => {
    etat.lignes = [regle({ org_id: 'autre-bureau' })];
    const r = await ecrireRegle({ client, orgId: ORG, ruleId: 'r1', changements: { name: 'Volée' }, auteurId: 'u', origine: 'lumi' });
    expect(r).toMatchObject({ ok: false, code: 'introuvable' });
    expect(ecritures()).toEqual([]);
    expect(etat.lignes[0].name).toBe('Relance devis');
  });

  it('une automatisation à la corbeille est refusée, et rien n’est écrit (A-08)', async () => {
    etat.lignes = [regle({ deleted_at: '2026-10-01T00:00:00Z' })];
    const r = await ecrireRegle({ client, orgId: ORG, ruleId: 'r1', changements: { steps: [texto('e1', 'Nouveau')] }, auteurId: 'u', origine: 'lumi' });
    expect(r).toMatchObject({ ok: false, code: 'corbeille' });
    expect(ecritures()).toEqual([]);
  });

  it('toute écriture est bornée à l’automatisation ET au bureau', async () => {
    etat.lignes = [regle()];
    await ecrireRegle({ client, orgId: ORG, ruleId: 'r1', changements: { name: 'Relance douce' }, auteurId: 'u', origine: 'lumi' });
    const [maj] = ecritures();
    expect(maj.filtres).toEqual(expect.arrayContaining([['id', 'r1'], ['org_id', ORG], ['deleted_at', null]]));
  });
});

describe('2 — le contenu : les contrôles des routes', () => {
  it('un parcours invalide (texto vide) est refusé', async () => {
    etat.lignes = [regle()];
    const r = await ecrireRegle({ client, orgId: ORG, ruleId: 'r1', changements: { steps: [texto('e1', '')] }, auteurId: 'u', origine: 'lumi' });
    expect(r).toMatchObject({ ok: false, code: 'invalide' });
    expect(ecritures()).toEqual([]);
  });

  it('un déclencheur hors catalogue est refusé — à la modification comme à la création', async () => {
    etat.lignes = [regle()];
    const m = await ecrireRegle({ client, orgId: ORG, ruleId: 'r1', changements: { trigger_event: 'lune.pleine' }, auteurId: 'u', origine: 'lumi' });
    expect(m.ok).toBe(false);
    const c = await ecrireRegle({ client, orgId: ORG, ruleId: null, changements: { name: 'X', trigger_event: 'lune.pleine', steps: [texto('e1', 'Bonjour')] }, auteurId: 'u', origine: 'lumi' });
    expect(c.ok).toBe(false);
    expect(ecritures()).toEqual([]);
  });

  it('un déclencheur pas encore offert à l’entreprise est refusé', async () => {
    etat.offert = false;
    const c = await ecrireRegle({ client, orgId: ORG, ruleId: null, changements: { name: 'X', trigger_event: 'quote.sent', steps: [texto('e1', 'Bonjour')] }, auteurId: 'u', origine: 'lumi' });
    expect(c).toMatchObject({ ok: false, code: 'invalide' });
    expect(ecritures()).toEqual([]);
  });

  it('le déclencheur d’une automatisation fournie ne se change pas', async () => {
    etat.lignes = [regle({ is_preset: true })];
    const r = await ecrireRegle({ client, orgId: ORG, ruleId: 'r1', changements: { trigger_event: 'invoice.overdue' }, auteurId: 'u', origine: 'lumi' });
    expect(r).toMatchObject({ ok: false, code: 'invalide' });
    expect((r as any).erreur).toMatch(/Dupliquez-la/);
  });

  it('une variable inventée DE PLUS est refusée ; une variable déjà là ne bloque pas la correction d’un autre message (A-06)', async () => {
    etat.lignes = [regle({ steps: [texto('e1', 'Bonjour [prenom_du_chien]', 'e2'), texto('e2', 'Merci')] })];
    const refuse = await ecrireRegle({ client, orgId: ORG, ruleId: 'r1', changements: { steps: [texto('e1', 'Bonjour [prenom_du_chien]', 'e2'), texto('e2', 'Merci [nom_du_chat]')] }, auteurId: 'u', origine: 'lumi' });
    expect(refuse).toMatchObject({ ok: false, code: 'invalide' });
    expect((refuse as any).erreur).toMatch(/nom_du_chat/);
    expect((refuse as any).erreur).not.toMatch(/prenom_du_chien/);
    const accepte = await ecrireRegle({ client, orgId: ORG, ruleId: 'r1', changements: { steps: [texto('e1', 'Bonjour [prenom_du_chien]', 'e2'), texto('e2', 'Merci beaucoup')] }, auteurId: 'u', origine: 'lumi' });
    expect(accepte.ok).toBe(true);
  });

  it('une automatisation PUBLIÉE que la modification casserait reste intacte', async () => {
    etat.lignes = [regle({ is_active: true })];
    const r = await ecrireRegle({ client, orgId: ORG, ruleId: 'r1', changements: { steps: [texto('e1', 'Bonjour', null, 'CASSE')] }, auteurId: 'u', origine: 'lumi' });
    expect(r).toMatchObject({ ok: false, code: 'publiee_cassee' });
    expect(ecritures()).toEqual([]);
    // … la même modification sur un BROUILLON passe : on a le droit de travailler un brouillon incomplet.
    etat.lignes = [regle({ is_active: false })];
    const brouillon = await ecrireRegle({ client, orgId: ORG, ruleId: 'r1', changements: { steps: [texto('e1', 'Bonjour', null, 'CASSE')] }, auteurId: 'u', origine: 'lumi' });
    expect(brouillon.ok).toBe(true);
  });

  it('`steps` ET `actions` ensemble : refusé (actions est re-dérivé)', async () => {
    etat.lignes = [regle()];
    const r = await ecrireRegle({ client, orgId: ORG, ruleId: 'r1', changements: { steps: [texto('e1', 'A')], actions: [{ type: 'send_sms', config: { body: 'B' } }] }, auteurId: 'u', origine: 'lumi' });
    expect(r).toMatchObject({ ok: false, code: 'invalide' });
  });

  it('`actions` seul n’est accepté que pour une règle SANS parcours — sinon on écrirait une copie que le moteur ne lit pas (A-07)', async () => {
    etat.lignes = [regle()];
    const refuse = await ecrireRegle({ client, orgId: ORG, ruleId: 'r1', changements: { actions: [{ type: 'send_sms', config: { body: 'B' } }] }, auteurId: 'u', origine: 'lumi' });
    expect(refuse).toMatchObject({ ok: false, code: 'invalide' });
    etat.lignes = [regle({ steps: null, actions: [{ type: 'send_sms', config: { body: 'ancien' } }, { type: 'log_activity', config: {} }] })];
    const ok = await ecrireRegle({ client, orgId: ORG, ruleId: 'r1', changements: { actions: [{ type: 'send_sms', config: { body: 'nouveau' } }, { type: 'log_activity', config: {} }] }, auteurId: 'u', origine: 'lumi' });
    expect(ok.ok).toBe(true);
    // … et un texto vidé, ou de 5 000 caractères, ne passe pas par là non plus.
    for (const body of ['', 'x'.repeat(1601)]) {
      const r = await ecrireRegle({ client, orgId: ORG, ruleId: 'r1', changements: { actions: [{ type: 'send_sms', config: { body } }] }, auteurId: 'u', origine: 'lumi' });
      expect(r, `texto de ${body.length} caractères`).toMatchObject({ ok: false, code: 'invalide' });
    }
  });
});

describe('3 — `steps` et `actions` écrits ensemble, et d’accord', () => {
  it('modifier le parcours remet `actions` en accord dans la MÊME écriture (A-02, A-07)', async () => {
    etat.lignes = [regle()];
    const steps = [attente('e0', 86400, 'e1'), texto('e1', 'Bonjour, petit rappel', 'e2'), texto('e2', 'Dernier rappel')];
    const r = await ecrireRegle({ client, orgId: ORG, ruleId: 'r1', changements: { steps }, auteurId: 'u', origine: 'lumi' });
    expect(r.ok).toBe(true);
    const maj = ecritures();
    expect(maj).toHaveLength(1);
    expect(maj[0].charge.steps).toHaveLength(3);
    expect(maj[0].charge.actions.map((a: any) => a.config.body)).toEqual(['Bonjour, petit rappel', 'Dernier rappel']);
    // Le « vieux texte » que le parcours n'envoie plus a disparu de la copie d'origine.
    expect(JSON.stringify(etat.lignes[0].actions)).not.toContain('vieux texte');
  });

  it('une création naît en BROUILLON, dans le bureau, avec `actions` qui redit le parcours (A-11)', async () => {
    const r = await ecrireRegle({ client, orgId: ORG, ruleId: null, changements: { name: 'Merci après le job', trigger_event: 'job.completed', steps: [texto('e1', 'Merci [client_first_name] !')] }, auteurId: 'u', origine: 'lumi' });
    expect(r).toMatchObject({ ok: true, creee: true });
    const [ins] = ecritures();
    expect(ins.op).toBe('insert');
    expect(ins.charge).toMatchObject({ org_id: ORG, is_active: false, is_preset: false, trigger_event: 'job.completed' });
    expect(ins.charge.actions).toEqual([{ type: 'send_sms', config: { body: 'Merci [client_first_name] !' } }]);
  });

  it('une création sans nom, sans déclencheur ou sans étape est refusée', async () => {
    const base = { name: 'X', trigger_event: 'job.completed', steps: [texto('e1', 'Merci')] };
    for (const manque of ['name', 'trigger_event', 'steps'] as const) {
      const changements: Record<string, unknown> = { ...base };
      delete changements[manque];
      const r = await ecrireRegle({ client, orgId: ORG, ruleId: null, changements, auteurId: 'u', origine: 'lumi' });
      expect(r, `sans ${manque}`).toMatchObject({ ok: false, code: 'invalide' });
    }
    expect(ecritures()).toEqual([]);
  });

  it('modifier une copie liée à un modèle la détache (sinon le modèle l’écraserait)', async () => {
    etat.lignes = [regle({ modele_id: 'm1' })];
    await ecrireRegle({ client, orgId: ORG, ruleId: 'r1', changements: { name: 'À moi' }, auteurId: 'u', origine: 'lumi' });
    expect(ecritures()[0].charge.modele_id).toBeNull();
  });
});

describe('4 et 5 — on rend ce qui est ENREGISTRÉ, et 0 ligne écrite n’est pas un succès', () => {
  it('la ligne rendue est la ligne RELUE après l’écriture (A-05)', async () => {
    etat.lignes = [regle()];
    // La base « normalise » : ce qu'on relit n'est pas mot pour mot ce qu'on a envoyé.
    etat.alaRelecture = (l) => ({ ...l, name: String(l.name).toUpperCase() });
    const r = await ecrireRegle({ client, orgId: ORG, ruleId: 'r1', changements: { name: 'Relance douce' }, auteurId: 'u', origine: 'lumi' });
    expect(r.ok && r.regle.name).toBe('RELANCE DOUCE');
    // L'ordre : lecture, écriture, relecture.
    expect(etat.ops.map((o) => o.op)).toEqual(['select', 'update', 'select']);
  });

  it('une écriture filtrée par la RLS (0 ligne touchée, aucune erreur) est un ÉCHEC dit comme tel', async () => {
    etat.lignes = [regle()];
    etat.rlsBloque = true;
    const r = await ecrireRegle({ client, orgId: ORG, ruleId: 'r1', changements: { name: 'Relance douce' }, auteurId: 'u', origine: 'lumi' });
    expect(r).toMatchObject({ ok: false, code: 'droit' });
    expect(etat.lignes[0].name).toBe('Relance devis');
  });

  it('les refus se disent dans la langue demandée', async () => {
    etat.lignes = [regle()];
    const r = await ecrireRegle({ client, orgId: ORG, ruleId: 'absente', changements: { name: 'X' }, auteurId: 'u', origine: 'lumi', fr: false });
    expect((r as any).erreur).toMatch(/not found/i);
  });
});

describe('6 — la publication ne passe jamais par ici, et les outils n’écrivent plus eux-mêmes', () => {
  const lire = (f: string) => readFileSync(resolve(__dirname, '..', f), 'utf8');

  it('`is_active` ne fait pas partie de ce que `ecrireRegle` accepte', async () => {
    etat.lignes = [regle()];
    const r = await ecrireRegle({ client, orgId: ORG, ruleId: 'r1', changements: { is_active: true, name: 'Relance douce' } as any, auteurId: 'u', origine: 'lumi' });
    expect(r.ok).toBe(true);
    expect(ecritures()[0].charge).not.toHaveProperty('is_active');
    expect(etat.lignes[0].is_active).toBe(false);
  });

  it('plus aucun insert ni update direct de `automation_rules` dans les outils de Lumi', () => {
    for (const f of ['server/lib/agent/tools-reglages.ts', 'server/lib/lumi/avant-carte.ts', 'server/lib/lumi/panneau-automatisation.ts', 'server/lib/lumi/contexte-automatisation.ts']) {
      const src = lire(f);
      const directes = [...src.matchAll(/\.from\('automation_rules'\)([\s\S]{0,160}?)(\.insert\(|\.update\(|\.upsert\(|\.delete\()/g)]
        // Une lecture suivie, plus loin, d'une autre requête : on ne compte que la MÊME chaîne d'appels.
        .filter((m) => !/;/.test(m[1]))
        // Seule écriture directe admise : le FIL de la conversation gardé avec l'automatisation
        // (`lumi_conversation`) — ce n'est pas du contenu exécuté, et la route le faisait déjà.
        .filter((m) => !src.slice(m.index! + m[0].length, m.index! + m[0].length + 40).startsWith('{ lumi_conversation'));
      expect(directes.map((m) => m[0].slice(0, 80)), f).toEqual([]);
    }
  });

  it('la publication passe par `changerPublication` (la base refuse `is_active = true` écrit par une session d’utilisateur)', () => {
    const outils = lire('server/lib/agent/tools-reglages.ts');
    const i = outils.indexOf("name: 'toggle_automation_rule'");
    expect(i).toBeGreaterThan(-1);
    expect(outils.slice(i, i + 6000)).toContain('changerPublication(');
    expect(lire('server/lib/lumi/panneau-automatisation.ts')).toContain('changerPublication(');
  });
});
