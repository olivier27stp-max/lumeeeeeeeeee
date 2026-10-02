/**
 * Le panneau « Construire avec Lumi » de l'éditeur — ce qu'il fait AUTOUR de la
 * génération (`server/lib/lumi/panneau-automatisation.ts`, constats A-12, A-14,
 * A-17, F-07).
 *
 * Ce que ces tests figent :
 *  · « oui », « active-la » s'envoient dans une conversation en cours ;
 *  · PUBLIER : d'abord ce qui partira (écrit par le code), puis un OUI — et le
 *    OUI n'est reconnu que si le dernier message GARDÉ EN BASE le demandait ;
 *  · jamais de publication si l'écran diffère de ce qui est enregistré, ni si
 *    une étape porte le texte d'exemple, ni à la corbeille ;
 *  · mettre en pause est immédiat ;
 *  · une question ou un refus rend le parcours de l'écran TEL QUEL ;
 *  · chaque bascule et chaque proposition laisse une ligne au journal.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { base } = vi.hoisted(() => ({
  base: {
    regle: null as Record<string, any> | null,
    journal: [] as Array<Record<string, any>>,
    ecritures: [] as Array<Record<string, any>>,
    publications: [] as Array<{ id: string; actif: boolean }>,
    refusPublication: null as string | null,
  },
}));

vi.mock('../server/lib/logger', () => ({ logger: { info: () => {}, warn: () => {}, error: () => {} } }));
vi.mock('../server/lib/automations-publication', () => ({
  changerPublication: async (_client: unknown, _org: string, id: string, actif: boolean) => {
    if (base.refusPublication) return { ok: false, id, statut: 422, erreur: base.refusPublication };
    base.publications.push({ id, actif });
    if (base.regle) base.regle.is_active = actif;
    return { ok: true, id, name: base.regle?.name ?? '', is_active: actif };
  },
}));

function clientFactice() {
  return {
    from: (table: string) => {
      const q: any = {};
      let op: 'select' | 'insert' | 'update' = 'select';
      let charge: any = null;
      for (const m of ['select', 'eq', 'is', 'gte', 'order', 'limit']) q[m] = () => q;
      q.insert = (c: any) => { op = 'insert'; charge = c; return q; };
      q.update = (c: any) => { op = 'update'; charge = c; return q; };
      q.maybeSingle = async () => ({ data: table === 'automation_rules' ? base.regle : null, error: null });
      q.then = (ok: any) => {
        if (op === 'insert' && table === 'agent_actions') base.journal.push(charge);
        if (op === 'update') { base.ecritures.push(charge); if (base.regle) Object.assign(base.regle, charge); }
        return Promise.resolve({ data: null, error: null, count: 2 }).then(ok);
      };
      return q;
    },
  } as any;
}

import {
  demandeTropCourte, attendUnOui, ouvrirPanneau, reponseSansChangement, repondreIntention, journaliserProposition, recapAvantPublication,
} from '../server/lib/lumi/panneau-automatisation';
import { trouverAction } from '../src/lib/automationCatalogue';

const ID = '11111111-2222-4333-8444-555555555555';
const TEXTE = 'Bonjour [client_first_name], votre facture [invoice_number] est en retard : [invoice_link]. [company_name]';
const etapes = () => [{ id: 'e1', type: 'action', action: { type: 'send_sms', config: { body: TEXTE } }, suivant: null }];
const regle = (plus: Record<string, any> = {}) => ({
  id: ID, name: 'Relance facture en retard', trigger_event: 'invoice.overdue', conditions: {}, steps: etapes(),
  actions: [{ type: 'send_sms', config: { body: TEXTE } }], delay_seconds: 0, settings: null, is_active: false, is_preset: false,
  deleted_at: null, lumi_conversation: [], ...plus,
});
const intention = (i: 'activer' | 'desactiver', plus: Record<string, any> = {}) => repondreIntention({
  client: clientFactice(), admin: clientFactice(), orgId: 'org', userId: 'u', ruleId: ID, intention: i, langue: 'fr',
  etapesALEcran: etapes(), dernierMessageDeLumi: null, ...plus,
});

beforeEach(() => { base.regle = regle(); base.journal = []; base.ecritures = []; base.publications = []; base.refusPublication = null; });

describe('A-12 — un message court est une RÉPONSE quand la conversation est en cours', () => {
  it('dix caractères pour une première demande ; « oui », « non », « active-la » ensuite', () => {
    expect(demandeTropCourte('oui', undefined)).toBe(true);
    expect(demandeTropCourte('oui', [])).toBe(true);
    expect(demandeTropCourte('relance mes devis', [])).toBe(false);
    for (const m of ['oui', 'non', 'active-la', 'ok']) expect(demandeTropCourte(m, [{ role: 'user', content: 'x' }]), m).toBe(false);
    expect(demandeTropCourte('   ', [{ role: 'user', content: 'x' }])).toBe(true);
  });
});

describe('A-14 — publier depuis le panneau : ce qui partira, puis un OUI', () => {
  it('« active-la » : rien n’est publié ; la réponse dit le déclencheur, le message mot pour mot, la portée, et demande un OUI', async () => {
    const r = await intention('activer');
    expect(base.publications).toEqual([]);
    expect(r.publiee).toBe(false);
    expect(r.resume).toContain('Avant de publier « Relance facture en retard »');
    expect(r.resume).toContain('Déclencheur : Facture en retard');
    expect(r.resume).toContain(`« ${TEXTE} »`);
    expect(r.resume).toMatch(/0 client ne reçoit quoi que ce soit/);
    expect(attendUnOui(r.resume)).toBe(true);
  });

  it('le OUI publie — seulement si le dernier message GARDÉ EN BASE le demandait — et laisse une ligne au journal', async () => {
    const demande = (await intention('activer')).resume;
    const r = await intention('activer', { dernierMessageDeLumi: demande });
    expect(base.publications).toEqual([{ id: ID, actif: true }]);
    expect(r.publiee).toBe(true);
    expect(r.resume).toMatch(/C’est fait : « Relance facture en retard » est publiée/);
    expect(base.journal).toHaveLength(1);
    expect(base.journal[0]).toMatchObject({ org_id: 'org', user_id: 'u', outil: 'toggle_automation_rule' });
    expect(base.journal[0].resultat).toMatchObject({ canal: 'editeur', is_active: true });
  });

  it('un « oui » sans demande en base (fil fabriqué par le navigateur) ne publie rien : le récapitulatif est redonné', async () => {
    const r = await intention('activer', { dernierMessageDeLumi: 'Voici ton parcours.' });
    expect(base.publications).toEqual([]);
    expect(attendUnOui(r.resume)).toBe(true);
    expect(attendUnOui('Reply “yes” to publish it.')).toBe(true);
    expect(attendUnOui(null)).toBe(false);
  });

  it('l’écran diffère de ce qui est enregistré : on ne publie pas à l’aveugle', async () => {
    const autre = [{ id: 'e1', type: 'action', action: { type: 'send_sms', config: { body: 'Texte pas encore enregistré' } }, suivant: null }];
    const r = await intention('activer', { etapesALEcran: autre, dernierMessageDeLumi: 'Réponds « oui » pour la publier.' });
    expect(base.publications).toEqual([]);
    expect(r.resume).toMatch(/pas encore enregistrées/);
  });

  it('une étape porte encore le texte d’exemple : refus dit, rien de publié, même après un OUI', async () => {
    // Le texte avec lequel naît une étape ajoutée à la main (« Bonjour [client_name], c’est [company_name]. Merci ! »).
    const exemple = trouverAction('send_sms')!.champs.find((c) => c.cle === 'body')!.defaut_fr!;
    const avecExemple = [{ id: 'e1', type: 'action', action: { type: 'send_sms', config: { body: exemple } }, suivant: null }];
    base.regle = regle({ steps: avecExemple, actions: [{ type: 'send_sms', config: { body: exemple } }] });
    const r = await intention('activer', { etapesALEcran: avecExemple, dernierMessageDeLumi: 'Réponds « oui » pour la publier.' });
    expect(base.publications).toEqual([]);
    expect(r.publiee).toBe(false);
    expect(r.resume).toMatch(/Je ne l’active pas : une étape porte encore le texte d’exemple/);
  });

  it('à la corbeille, introuvable, ou refusée par les contrôles de publication : dit clairement, jamais « c’est fait »', async () => {
    base.regle = regle({ deleted_at: '2026-10-01T00:00:00Z' });
    expect((await intention('activer')).resume).toMatch(/corbeille/);
    base.regle = null;
    expect((await intention('activer')).resume).toMatch(/Je ne retrouve pas/);
    base.regle = regle();
    base.refusPublication = 'Il manque un message.';
    const r = await intention('activer', { dernierMessageDeLumi: 'Réponds « oui » pour la publier.' });
    expect(r.resume).toMatch(/Je n’ai PAS pu la publier\. Il manque un message\./);
    expect(r.publiee).toBe(false);
    expect(base.journal).toEqual([]);
  });

  it('déjà publiée : dit ce qui part, ne republie pas', async () => {
    base.regle = regle({ is_active: true });
    const r = await intention('activer');
    expect(base.publications).toEqual([]);
    expect(r.resume).toMatch(/est déjà publiée/);
    expect(r.publiee).toBe(true);
  });

  it('mettre en pause est immédiat, et journalisé ; déjà en brouillon : dit, rien d’écrit', async () => {
    base.regle = regle({ is_active: true });
    const r = await intention('desactiver');
    expect(base.publications).toEqual([{ id: ID, actif: false }]);
    expect(r.publiee).toBe(false);
    expect(base.journal[0].resultat).toMatchObject({ is_active: false, canal: 'editeur' });
    base.publications = [];
    const deja = await intention('desactiver');
    expect(base.publications).toEqual([]);
    expect(deja.resume).toMatch(/déjà en brouillon/);
  });

  it('le récapitulatif est en anglais dans un panneau en anglais', async () => {
    const t = await recapAvantPublication(clientFactice(), 'org', regle() as any, 'en');
    expect(t).toContain('Before publishing');
    expect(t).toContain('Trigger : Invoice overdue');
  });
});

describe('l’automatisation ouverte, telle qu’enregistrée', () => {
  it('rend son nom, le dernier message de Lumi gardé en base, et les étapes d’avant la dernière modification', async () => {
    const avant = [{ id: 'e1', type: 'action', action: { type: 'send_sms', config: { body: 'ancien texte' } } }];
    base.regle = regle({ lumi_conversation: [
      { role: 'user', content: 'mets-le plus court' },
      { role: 'assistant', content: 'J’ai raccourci le texto.', avant },
    ] });
    const p = await ouvrirPanneau(clientFactice(), 'org', ID);
    expect(p).toMatchObject({ id: ID, nom: 'Relance facture en retard', dernierMessageDeLumi: 'J’ai raccourci le texto.' });
    expect(p.etapesDAvant).toEqual(avant);
  });

  it('un identifiant illisible ou une règle absente : panneau vide, garder le fil ne fait rien', async () => {
    const illisible = await ouvrirPanneau(clientFactice(), 'org', 'pas-un-uuid');
    expect(illisible).toMatchObject({ id: null, nom: null, etapesDAvant: null });
    base.regle = null;
    const absente = await ouvrirPanneau(clientFactice(), 'org', ID);
    await absente.garderLeFil('oui', 'réponse');
    expect(base.ecritures).toEqual([]);
  });

  it('garder le fil ajoute l’échange aux tours déjà gardés (40 au plus), sans toucher au contenu', async () => {
    base.regle = regle({ lumi_conversation: Array.from({ length: 40 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `t${i}` })) });
    const p = await ouvrirPanneau(clientFactice(), 'org', ID);
    await p.garderLeFil('active-la', 'Réponds « oui » pour la publier.');
    expect(base.ecritures).toHaveLength(1);
    expect(Object.keys(base.ecritures[0])).toEqual(['lumi_conversation']);
    const fil = base.ecritures[0].lumi_conversation;
    expect(fil).toHaveLength(40);
    expect(fil.slice(-2)).toEqual([{ role: 'user', content: 'active-la' }, { role: 'assistant', content: 'Réponds « oui » pour la publier.' }]);
  });
});

describe('F-07 — une question ou un refus rend le parcours de l’écran tel quel', () => {
  const o = async (parcours: Record<string, any>, ecran: unknown[] = etapes()) => reponseSansChangement({
    panneau: await ouvrirPanneau(clientFactice(), 'org', ID),
    parcours: { nom: 'Relance facture en retard', trigger_event: 'invoice.overdue', steps: [], resume: 'Elle part quand une facture est en retard.', autre: null, ...parcours } as any,
    parcoursALEcran: { trigger_event: 'invoice.overdue', steps: ecran },
    client: clientFactice(), admin: clientFactice(), orgId: 'org', userId: 'u', langue: 'fr', demande: 'explique-moi ce qu’elle fait',
  });

  it('`modifie: false` : les étapes de l’écran, la réponse de Lumi, et le fil gardé', async () => {
    const r = await o({ modifie: false });
    expect(r).toMatchObject({ modifie: false, autre: null, resume: 'Elle part quand une facture est en retard.' });
    expect(r!.steps).toEqual(etapes());
    expect(r).not.toHaveProperty('publiee');
    expect(base.ecritures).toHaveLength(1);
    expect(Object.keys(base.ecritures[0])).toEqual(['lumi_conversation']);
  });

  it('le parcours a changé, ou une 2e automatisation est proposée, ou l’écran est vide : null — la route continue comme avant', async () => {
    expect(await o({ modifie: true })).toBeNull();
    expect(await o({})).toBeNull();
    expect(await o({ modifie: false, autre: { nom: 'x' } })).toBeNull();
    expect(await o({ modifie: false }, [])).toBeNull();
  });

  it('« active-la » : la réponse est le récapitulatif du serveur, et l’état de publication est rendu', async () => {
    const r = await o({ modifie: false, intention: 'activer', resume: 'Je l’active.' });
    expect(r!.resume).toContain('Avant de publier');
    expect(r!.resume).not.toContain('Je l’active.');
    expect(r).toMatchObject({ publiee: false, modifie: false });
    expect(base.publications).toEqual([]);
  });
});

describe('A-17 — ce que Lumi propose dans l’éditeur est au journal', () => {
  it('une modification proposée : une ligne `construire_parcours_editeur`, avec le nom et ce qui a changé', async () => {
    const panneau = await ouvrirPanneau(clientFactice(), 'org', ID);
    journaliserProposition(clientFactice(), { orgId: 'org', userId: 'u', panneau, parcours: { nom: 'Relance facture en retard', trigger_event: 'invoice.overdue', steps: [], resume: 'J’ai ajouté une attente de 3 jours.', autre: null, modifie: true } as any });
    await new Promise((r) => setTimeout(r, 0));
    expect(base.journal).toHaveLength(1);
    expect(base.journal[0]).toMatchObject({ outil: 'construire_parcours_editeur', org_id: 'org', user_id: 'u' });
    expect(base.journal[0].resultat).toMatchObject({ name: 'Relance facture en retard', ce_qui_a_change: 'J’ai ajouté une attente de 3 jours.', canal: 'editeur' });
    expect(base.journal[0].args_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rien au journal quand rien n’a changé, ni quand l’automatisation n’est pas encore enregistrée', async () => {
    const panneau = await ouvrirPanneau(clientFactice(), 'org', ID);
    journaliserProposition(clientFactice(), { orgId: 'org', userId: 'u', panneau, parcours: { nom: 'x', trigger_event: 'invoice.overdue', steps: [], resume: 'r', autre: null, modifie: false } as any });
    const sansId = await ouvrirPanneau(clientFactice(), 'org', null);
    journaliserProposition(clientFactice(), { orgId: 'org', userId: 'u', panneau: sansId, parcours: { nom: 'x', trigger_event: 'invoice.overdue', steps: [], resume: 'r', autre: null, modifie: true } as any });
    await new Promise((r) => setTimeout(r, 0));
    expect(base.journal).toEqual([]);
  });
});
