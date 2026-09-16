/**
 * Items 8 à 14 (AGENTFORCE_GAP.md) :
 *  8  version du prompt figée par empreinte ; prompt de vente hors de la route ;
 *  9  descriptions d'outils dégraissées sans perdre les règles (compter TOUT, statut à l'écran) ;
 * 10  routeur : verdict validé, jamais une action devinée, seuil, hors scope ;
 * 11  topics : chaque outil a son topic, chaque outil cité existe ;
 * 12  escalade : motif lu dans un reçu, notification dédoublonnée, hooks dans la route ;
 * 14  aide : search_help trouve la page et cite sa source, sinon rien.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('../server/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { VERSION_PROMPT, EMPREINTE_PROMPT_ATTENDUE, empreintePrompt } from '../server/lib/lumi/version';
import { promptSystemeLumi } from '../server/lib/lumi/orchestrateur';
import { SYSTEM_PROMPT } from '../server/lib/agent/promptVente';
import { TOOLS_BY_NAME } from '../server/lib/agent/tools';
import { TOPICS, topicDeLOutil } from '../server/lib/lumi/topics';
import { validerVerdict, decider, SEUIL_CONFIANCE, modeRouteur } from '../server/lib/lumi/routeur';
import { motifDansResultat, escalader } from '../server/lib/lumi/escalade';
import { chercherAide } from '../server/lib/agent/tools-aide';

const lu = (p: string) => readFileSync(resolve(__dirname, '..', ...p.split('/')), 'utf8');

describe('item 8 — version du prompt', () => {
  it('le bloc stable a l empreinte figée ; un changement de prompt sans bump fait échouer ce test', () => {
    const stable = promptSystemeLumi({ companyName: 'Coquin lavage', userName: 'Will', language: 'fr', todayIso: '2026-09-13' })[0].text;
    expect(empreintePrompt(stable), `prompt modifié : bumper VERSION_PROMPT (${VERSION_PROMPT}) et EMPREINTE_PROMPT_ATTENDUE = '${empreintePrompt(stable)}'`).toBe(EMPREINTE_PROMPT_ATTENDUE);
    expect(VERSION_PROMPT).toMatch(/^v\d{4}-\d{2}-\d{2}(\.\d+)?$/);
  });
  it('le prompt de vente vit dans son module, la route l importe, et la version part dans les traces', () => {
    expect(SYSTEM_PROMPT).toContain('150 $/mois');
    const route = lu('server/routes/sales-chat.ts');
    // Le même Lumi partout : la route publique passe par le cerveau de support, qui porte la connaissance du site.
    expect(route).toContain("import { repondreSupportIA, isSupportIAConfigured, MODELE_SUPPORT } from '../lib/support/ia';");
    expect(lu('server/lib/support/ia.ts')).toContain("import { SYSTEM_PROMPT as CONNAISSANCE_PUBLIQUE } from '../agent/promptVente';");
    expect(route).not.toContain('const SYSTEM_PROMPT = `');
    expect(route).toContain('promptVersion: VERSION_PROMPT');
    expect(lu('server/routes/lumi.ts')).toContain('promptVersion: VERSION_PROMPT');
  });
});

describe('item 9 — descriptions dégraissées, règles gardées', () => {
  it('les outils de comptage disent encore d omettre query pour compter TOUT, et list_jobs garde le statut à l écran', () => {
    for (const n of ['search_clients', 'search_leads', 'list_jobs', 'list_quotes']) {
      const p: any = TOOLS_BY_NAME[n].declaration.parameters;
      expect(p.properties.query.description, n).toMatch(/Omit it to count ALL/);
    }
    expect(TOOLS_BY_NAME.list_jobs.declaration.description).toMatch(/"statut"/);
    expect(TOOLS_BY_NAME.search_clients.declaration.description.length).toBeLessThan(170);
  });
});

describe('item 10 — routeur', () => {
  it('validerVerdict : action connue et paramètres stricts, sinon null', () => {
    expect(validerVerdict({ topic: 'facturation', action: 'retards', params: {}, confidence: 0.95 })).toMatchObject({ action: 'retards' });
    expect(validerVerdict({ topic: 'planification', action: 'agenda', params: { periode: 'demain' }, confidence: 0.9 })).toMatchObject({ params: { periode: 'demain' } });
    expect(validerVerdict({ topic: 'planification', action: 'envoyer_sms', params: {}, confidence: 0.9 })).toBeNull();
    expect(validerVerdict({ topic: 'planification', action: 'agenda', params: { periode: 'hier' }, confidence: 0.9 })).toBeNull();
    expect(validerVerdict({ topic: 'planification', action: 'agenda', params: { client_id: 'x' }, confidence: 0.9 })).toBeNull();
    expect(validerVerdict('pas du json')).toBeNull();
    expect(validerVerdict({ topic: 'inconnu', action: null, params: {}, confidence: 1 })).toBeNull();
  });
  it('decider : action seulement au-dessus du seuil et hors multi ; hors scope confiant ; le reste au modèle', () => {
    expect(SEUIL_CONFIANCE).toBe(0.85);
    expect(decider(validerVerdict({ topic: 'facturation', action: 'retards', params: {}, confidence: 0.9 }))).toBe('action');
    expect(decider(validerVerdict({ topic: 'facturation', action: 'retards', params: {}, confidence: 0.6 }))).toBe('modele');
    expect(decider(validerVerdict({ topic: 'multi', action: 'retards', params: {}, confidence: 0.99 }))).toBe('modele');
    expect(decider(validerVerdict({ topic: 'hors_scope', action: null, params: {}, confidence: 0.95 }))).toBe('hors_scope');
    expect(decider(validerVerdict({ topic: 'clients', action: null, params: {}, confidence: 0.95 }))).toBe('modele');
    expect(decider(null)).toBe('modele');
  });
  it('mode : off par défaut, observation ou actif sur demande ; l actif ne suit que decision === action et jamais après un repli', () => {
    expect(modeRouteur({})).toBe('off');
    expect(modeRouteur({ LUMI_ROUTEUR: 'observation' })).toBe('observation');
    expect(modeRouteur({ LUMI_ROUTEUR: 'actif' })).toBe('actif');
    expect(modeRouteur({ LUMI_ROUTEUR: 'oui' })).toBe('off');
    const route = lu('server/routes/lumi.ts');
    // Observation : classifie en parallèle sans agir ; un verdict déjà obtenu par l'étage 5 n'est pas redemandé.
    expect(route).toContain("opts.routeur ? Promise.resolve(opts.routeur) : (modeRouteur() === 'observation' && opts.enonce ? classifier(opts.enonce, contexteRouteur(opts.historique)) : null)");
    // Actif (étage 5) : seulement une action déterministe validée (raccourciDepuisAction, jamais une action devinée), jamais avec une proposition en attente ni après un repli.
    // … aussi sur une suite de conversation, avec l'échange précédent en contexte (le prompt impose action null sur un « il », « le pire »…).
    expect(route).toContain("if (modeRouteur() === 'actif' && !enAttente.length && !repli)");
    expect(route).toContain("routeur = await classifier(message, contexteRouteur(historique));");
    expect(route).toContain("routeur.decision === 'action' && routeur.verdict?.action ? raccourciDepuisAction(routeur.verdict.action, routeur.verdict.params ?? {}) : null");
    // Le coût du routeur est journalisé dans ai_usage (il compte dans le budget de l'org).
    expect(route).toMatch(/journaliserUsage\(ctx\.admin, \{\s*orgId: ctx\.auth\.orgId, userId: ctx\.auth\.user\.id, conversationId, model: MODELE_ROUTEUR/);
  });
});

describe('item 11 — topics', () => {
  it('chaque outil cité existe et chaque outil de TOOLS_BY_NAME a un topic (sauf search_help, transverse)', () => {
    for (const t of TOPICS) for (const o of t.outils) expect(TOOLS_BY_NAME[o], `${t.id} cite ${o}`).toBeDefined();
    const sansTopic = Object.keys(TOOLS_BY_NAME).filter((o) => !topicDeLOutil(o) && o !== 'search_help');
    expect(sansTopic).toEqual([]);
    expect(TOPICS.map((t) => t.id)).toContain('hors_scope');
    expect(TOPICS.map((t) => t.id)).toContain('multi');
  });
});

describe('item 12 — escalade', () => {
  it('motifDansResultat lit incomplet / incertain dans un reçu, et rien d autre', () => {
    expect(motifDansResultat(JSON.stringify({ executed: true, result: { incomplet: true, note: 'job créé sans articles' } }))).toBe('effet_partiel');
    expect(motifDansResultat(JSON.stringify({ incertain: true }))).toBe('effet_partiel');
    expect(motifDansResultat(JSON.stringify({ executed: true, result: { created: true } }))).toBeNull();
    expect(motifDansResultat('pas du json')).toBeNull();
  });
  it('escalader : propriétaires + la personne, une notification par (conversation, motif), jamais d exception', async () => {
    const inserts: any[] = [];
    const chaine = (data: any) => { const c: any = {}; for (const m of ['select', 'eq', 'in']) c[m] = vi.fn(() => c); c.then = (ok: any) => Promise.resolve({ data, error: null }).then(ok); return c; };
    const admin: any = { from: vi.fn((table: string) => table === 'memberships' ? chaine([{ user_id: 'owner-1' }]) : table === 'notifications' ? { ...chaine([{ user_id: 'owner-1' }]), insert: vi.fn(async (l: any[]) => { inserts.push(...l); return { error: null }; }) } : chaine([])) };
    await escalader(admin, { orgId: 'org', userId: 'user-9', conversationId: 'conv', motif: 'effet_partiel', detail: 'Job créé sans ses articles.', fr: true });
    // owner-1 déjà prévenu pour cette conversation/motif → seul user-9 reçoit.
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({ org_id: 'org', user_id: 'user-9', type: 'lumi_escalade', link: '/lumi?c=conv', icon: 'effet_partiel', title: 'Lumi : une action à vérifier' });
    const casse: any = { from: vi.fn(() => { throw new Error('boom'); }) };
    await expect(escalader(casse, { orgId: 'o', userId: 'u', conversationId: null, motif: 'refus_modele', detail: 'x', fr: true })).resolves.toBeUndefined();
  });
  it('la route escalade sur refus, trop d étapes, effet partiel et plafond', () => {
    const r = lu('server/routes/lumi.ts');
    expect(r).toContain("motif: erreurModele === 'refusal' ? 'refus_modele' : 'trop_d_etapes'");
    expect(r).toContain('const motif = motifDansResultat(r.contenu);');
    expect(r).toContain("motif: 'plafond_ecritures'");
  });
});

describe('item 14 — search_help', () => {
  it('trouve la page qui répond et cite sa source ; rien quand rien ne matche', () => {
    const r = chercherAide('Est-ce que mes clients doivent créer un compte pour le portail ?');
    expect(r.length).toBeGreaterThan(0);
    expect(r[0].page).toBe('/fonctions/clients');
    expect(r[0].extrait).toMatch(/lien sécurisé|compte/);
    expect(chercherAide('xyzzy plugh')).toEqual([]);
    expect(chercherAide('')).toEqual([]);
    expect(TOOLS_BY_NAME.search_help.kind).toBe('read');
    // Différé (pas dans les outils de base), donc découvert par la recherche « help ».
    expect(lu('server/lib/lumi/orchestrateur.ts')).toContain('(\\`help\\`)');
  });
});
