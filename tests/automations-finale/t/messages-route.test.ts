/**
 * LA ROUTE `PATCH /api/automations/rules/:id/messages` — le serveur est le
 * seul à écrire le texte d'un message d'automatisation.
 *
 * La VRAIE route est montée dans une app Express de test ; seuls Supabase et
 * la session sont simulés (`faux-supabase.ts` : mêmes filtres, mêmes écritures
 * relues). Le droit `automations.update` est lu pour de bon dans la fausse
 * table `memberships`.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('../../../src/lib/supabase', async () => (await import('./faux-supabase')).moduleSupabase());
vi.mock('../../../src/lib/orgApi', () => ({ getCurrentOrgId: async () => 'org-1', getCurrentOrgIdOrThrow: async () => 'org-1' }));
vi.mock('../../../server/lib/supabase', async () => (await import('./faux-supabase')).moduleSupabaseServeur());
const propager = vi.hoisted(() => ({ appels: [] as unknown[][] }));
vi.mock('../../../server/lib/automatisations-bureaux', () => ({
  bureauxCibles: async () => [], copierVersBureaux: async () => [],
  propagerAuxCopies: async (...a: unknown[]) => { propager.appels.push(a); return []; },
}));

import { base, remettre, ligne } from './faux-supabase';
import { brancherServeur, arreterServeur, appeler } from './serveur-messages';
import { messagesDeRegle as messagesCoteServeur, texteQuiPart as partCoteServeur, refletDuParcours } from '../../../server/lib/automation-messages';
import { messagesDeRegle as messagesCoteNavigateur, texteQuiPart as partCoteNavigateur, avecTexteDuMessage } from '../../../src/lib/automationRulesApi';

type Action = { type: string; config: Record<string, unknown> };
type Regle = { id: string; actions: Action[]; steps: unknown[] | null; modele_id?: string | null; updated_at?: string };

const sms = (body: string, plus: Record<string, unknown> = {}): Action => ({ type: 'send_sms', config: { body, ...plus } });
const courriel = (subject: string, body: string, plus: Record<string, unknown> = {}): Action => ({ type: 'send_email', config: { subject, body, ...plus } });
const tache: Action = { type: 'create_task', config: { title: 'Rappeler le client' } };
const PARCOURS = [
  { id: 'e1', type: 'action', action: sms('Premier texto.'), suivant: 'e2' },
  { id: 'e2', type: 'si', conditions: {}, alors: 'e3', sinon: 'e4' },
  { id: 'e3', type: 'action', action: courriel('Objet', '<p>Corps</p>'), suivant: 'e5' },
  { id: 'e4', type: 'attendre', delai_secondes: 3600, suivant: 'e5' },
  { id: 'e5', type: 'action', action: sms('Second texto.'), suivant: null },
];

function poser(regle: Record<string, unknown>): void {
  remettre({
    automation_rules: [{
      id: 'r1', org_id: 'org-1', name: 'Rappel', trigger_event: 'appointment.created', conditions: {},
      actions: [], steps: null, is_active: false, is_preset: false, modele_id: null, deleted_at: null, purged_at: null,
      ...regle,
    }],
  });
}
const enBase = () => ligne<Regle>('automation_rules', 'r1');

beforeEach(async () => {
  remettre();
  propager.appels.length = 0;
  vi.spyOn(console, 'error').mockImplementation(() => {});
  await brancherServeur();
});
afterAll(async () => { await arreterServeur(); });

describe('la route désigne et écrit UN message', () => {
  it('règle à plat : `index_action` désigne l’action ; les autres ne bougent pas, et `steps` n’est pas inventé', async () => {
    poser({ actions: [sms('Premier texto.'), tache, sms('Second texto.')] });
    const r = await appeler('r1', { canal: 'send_sms', index_action: 2, texte: 'Second texto, corrigé.' });
    expect(r.status).toBe(200);
    expect(enBase().actions).toEqual([sms('Premier texto.'), tache, sms('Second texto, corrigé.')]);
    expect(Object.keys(base.ecritures[0].valeurs).sort()).toEqual(['actions', 'updated_at']);
  });

  it('`index_action` qui désigne autre chose qu’un message de ce canal : 409, rien n’est écrit', async () => {
    poser({ actions: [sms('Premier texto.'), tache] });
    const r = await appeler('r1', { canal: 'send_sms', index_action: 1, texte: 'Texte' });
    expect(r.status).toBe(409);
    expect(r.json.code).toBe('modifiee_ailleurs');
    expect(base.ecritures).toHaveLength(0);
  });

  it('parcours : `etape_id` désigne l’étape ; `steps` ET le reflet `actions` partent dans la même écriture', async () => {
    poser({ steps: PARCOURS, actions: [sms('À compléter')] });
    const r = await appeler('r1', { canal: 'send_sms', etape_id: 'e5', texte: 'Second texto, corrigé.' });
    expect(r.status).toBe(200);
    const etapes = enBase().steps as Array<{ id: string; action?: Action }>;
    expect(etapes.find((e) => e.id === 'e5')?.action).toEqual(sms('Second texto, corrigé.'));
    expect(etapes.find((e) => e.id === 'e1')?.action).toEqual(sms('Premier texto.'));
    // Le reflet : les actions du parcours dans l'ordre (le fil « si oui », puis « si non »), sans condition ni attente.
    expect(enBase().actions).toEqual([sms('Premier texto.'), courriel('Objet', '<p>Corps</p>'), sms('Second texto, corrigé.')]);
    expect(base.ecritures).toHaveLength(1);
    expect(Object.keys(base.ecritures[0].valeurs).sort()).toEqual(['actions', 'steps', 'updated_at']);
  });

  it('elle RELIT la ligne et rend l’état enregistré', async () => {
    poser({ actions: [sms('Bonjour')] });
    const r = await appeler('r1', { canal: 'send_sms', texte: 'Bonjour à vous' });
    expect(r.status).toBe(200);
    const regle = r.json.regle as Regle;
    expect(regle.actions).toEqual(enBase().actions);
    expect(regle.updated_at).toBe(enBase().updated_at);
    // Une lecture avant, une écriture, une relecture.
    expect(base.lectures.automation_rules).toBe(2);
  });

  it('deux messages du canal, aucun désigné : 400, la phrase dit quoi faire, rien n’est écrit', async () => {
    poser({ actions: [sms('Premier texto.'), sms('Second texto.')] });
    const r = await appeler('r1', { canal: 'send_sms', texte: 'Texte' });
    expect(r.status).toBe(400);
    expect(r.json).toEqual({ error: 'Cette automatisation envoie 2 messages de ce type : modifiez celui que vous voulez dans Automatisations.', code: 'message_ambigu' });
    expect(base.ecritures).toHaveLength(0);
  });

  it('le message a changé ailleurs depuis l’ouverture de l’écran : 409 `modifiee_ailleurs`, rien n’est écrit', async () => {
    poser({ actions: [sms('Texte que Lumi vient d’écrire.')] });
    const r = await appeler('r1', { canal: 'send_sms', rang: 0, corps_lu: 'Ancien texte.', texte: 'Ma correction' });
    expect(r.status).toBe(409);
    expect(r.json.code).toBe('modifiee_ailleurs');
    expect(String(r.json.error)).toContain('modifié ailleurs');
    expect(base.ecritures).toHaveLength(0);
  });

  it('modifier le message d’une copie liée la détache de son modèle, comme toute modification de contenu', async () => {
    poser({ actions: [sms('Bonjour')], modele_id: 'modele-1' });
    expect((await appeler('r1', { canal: 'send_sms', texte: 'Bonjour à vous' })).status).toBe(200);
    expect(enBase().modele_id).toBeNull();
    // Et les copies des autres bureaux suivent.
    expect(propager.appels).toHaveLength(1);
  });
});

describe('la route valide ce qu’aucun écran ne peut plus contourner', () => {
  it('03-texto:316 — un texto de plus de 1 600 caractères est refusé avec une phrase claire ; 1 600 passe', async () => {
    poser({ actions: [sms('Bonjour')] });
    const r = await appeler('r1', { canal: 'send_sms', texte: 'a'.repeat(1700) });
    expect(r.status).toBe(400);
    expect(r.json).toEqual({ error: 'Un texto fait 1 600 caractères au plus (celui-ci : 1 700). Raccourcissez-le — rien n’a été enregistré.', code: 'texto_trop_long' });
    expect(base.ecritures).toHaveLength(0);
    expect((await appeler('r1', { canal: 'send_sms', texte: 'a'.repeat(1600) })).status).toBe(200);
    expect(String(enBase().actions[0].config.body)).toHaveLength(1600);
  });

  it('la version anglaise d’un texto a le même plafond', async () => {
    poser({ actions: [sms('Bonjour', { body_en: 'Hello' })] });
    const r = await appeler('r1', { canal: 'send_sms', langue: 'en', texte: 'a'.repeat(1601) });
    expect(r.status).toBe(400);
    expect(r.json.code).toBe('texto_trop_long');
  });

  it('courriel : un objet de plus de 200 caractères et un corps de plus de 10 000 sont refusés', async () => {
    poser({ actions: [courriel('Objet', '<p>Corps</p>')] });
    const long = await appeler('r1', { canal: 'send_email', objet: 'o'.repeat(201) });
    expect(long.status).toBe(400);
    expect(long.json).toEqual({ error: 'L’objet d’un courriel fait 200 caractères au plus (celui-ci : 201). Raccourcissez-le — rien n’a été enregistré.', code: 'objet_trop_long' });
    const gros = await appeler('r1', { canal: 'send_email', texte: `<p>${'m'.repeat(10_000)}</p>` });
    expect(gros.status).toBe(400);
    expect(gros.json.code).toBe('courriel_trop_long');
    expect(base.ecritures).toHaveLength(0);
  });

  it('un corps déjà trop long en base n’empêche pas de corriger l’objet à côté', async () => {
    const gros = `<p>${'m'.repeat(12_000)}</p>`;
    poser({ actions: [courriel('Objet', gros)] });
    const r = await appeler('r1', { canal: 'send_email', texte: gros, objet: 'Nouvel objet' });
    expect(r.status).toBe(200);
    expect(enBase().actions[0].config).toEqual({ subject: 'Nouvel objet', body: gros });
  });

  it('un message vide est refusé — texto, courriel, objet ; on ne vide pas le texto d’une règle publiée', async () => {
    poser({ actions: [sms('Bonjour'), courriel('Objet', '<p>Corps</p>')], is_active: true });
    for (const corps of [
      { canal: 'send_sms', texte: '   ' },
      { canal: 'send_sms', texte: '' },
      { canal: 'send_email', texte: '<div><p> </p>&nbsp;</div>' },
    ]) {
      const r = await appeler('r1', corps);
      expect(r.status).toBe(400);
      expect(r.json).toEqual({ error: 'Le message ne peut pas être vide.', code: 'message_vide' });
    }
    const objet = await appeler('r1', { canal: 'send_email', objet: '  ' });
    expect(objet.status).toBe(400);
    expect(objet.json).toEqual({ error: 'L’objet du courriel ne peut pas être vide.', code: 'objet_vide' });
    expect(base.ecritures).toHaveLength(0);
  });

  it('une version anglaise vide est RETIRÉE — sauf si le français, lui, est vide : il ne resterait rien à envoyer', async () => {
    poser({ actions: [sms('Bonjour', { body_en: 'Hello' })] });
    expect((await appeler('r1', { canal: 'send_sms', langue: 'en', texte: '' })).status).toBe(200);
    expect(enBase().actions).toEqual([sms('Bonjour')]);
    poser({ actions: [sms('', { body_en: 'Hello' })] });
    const r = await appeler('r1', { canal: 'send_sms', langue: 'en', texte: '' });
    expect(r.status).toBe(400);
    expect(r.json.code).toBe('message_vide');
    expect(base.ecritures).toHaveLength(0);
  });

  it('les deux langues dans la même écriture (`autre_version`), dans un sens comme dans l’autre', async () => {
    poser({ actions: [courriel('Objet', '<p>Corps</p>', { subject_en: 'Subject', body_en: '<p>Body</p>' })] });
    const r = await appeler('r1', { canal: 'send_email', texte: '<p>Corps corrigé</p>', objet: 'Objet', autre_version: { texte: '<p>Fixed body</p>', objet: 'Subject' } });
    expect(r.status).toBe(200);
    expect(base.ecritures).toHaveLength(1);
    expect(enBase().actions[0].config).toEqual({ subject: 'Objet', body: '<p>Corps corrigé</p>', subject_en: 'Subject', body_en: '<p>Fixed body</p>' });
    // Le texte écrit est l'anglais ; l'autre langue est alors le français.
    const sens = await appeler('r1', { canal: 'send_email', langue: 'en', texte: '<p>Body, again</p>', autre_version: { texte: '<p>Corps, encore</p>' } });
    expect(sens.status).toBe(200);
    expect(enBase().actions[0].config).toEqual({ subject: 'Objet', body: '<p>Corps, encore</p>', subject_en: 'Subject', body_en: '<p>Body, again</p>' });
  });
});

describe('les deux langues d’un message — l’ordre « retirer l’autre version » (règle du 2026-10-01)', () => {
  const FR = 'Bonjour, votre rendez-vous est confirmé.';
  const EN = 'Hi, your appointment is confirmed.';

  it('sans l’ordre, rien n’est retiré : écrire une langue laisse l’autre telle quelle', async () => {
    poser({ actions: [sms(FR, { body_en: EN })] });
    expect((await appeler('r1', { canal: 'send_sms', texte: 'Bonjour, à demain.' })).status).toBe(200);
    expect(enBase().actions).toEqual([sms('Bonjour, à demain.', { body_en: EN })]);
    expect((await appeler('r1', { canal: 'send_sms', langue: 'en', texte: 'Hi, see you tomorrow.' })).status).toBe(200);
    expect(enBase().actions).toEqual([sms('Bonjour, à demain.', { body_en: 'Hi, see you tomorrow.' })]);
  });

  it('texte écrit en français + retirer : la version anglaise DISPARAÎT du message (jamais `body_en: ""`)', async () => {
    poser({ actions: [sms(FR, { body_en: EN })] });
    const r = await appeler('r1', { canal: 'send_sms', langue: 'fr', texte: 'Bonjour, à demain.', retirer_autre_version: true });
    expect(r.status).toBe(200);
    expect(enBase().actions).toEqual([sms('Bonjour, à demain.')]);
    expect('body_en' in enBase().actions[0].config).toBe(false);
  });

  it('texte écrit en anglais + retirer : le texte anglais devient LE texte du message, il n’en reste qu’un', async () => {
    poser({ actions: [sms(FR, { body_en: EN })] });
    const r = await appeler('r1', { canal: 'send_sms', langue: 'en', texte: 'Hi, see you tomorrow.', retirer_autre_version: true });
    expect(r.status).toBe(200);
    expect(enBase().actions).toEqual([sms('Hi, see you tomorrow.')]);
  });

  it('courriel : l’objet suit le corps, dans les deux sens', async () => {
    const C = { subject_en: 'Your appointment', body_en: '<p>See you tomorrow.</p>' };
    poser({ actions: [courriel('Votre rendez-vous', '<p>À demain.</p>', C)] });
    expect((await appeler('r1', { canal: 'send_email', langue: 'en', objet: 'Your appointment tomorrow', retirer_autre_version: true })).status).toBe(200);
    expect(enBase().actions[0].config).toEqual({ subject: 'Your appointment tomorrow', body: '<p>See you tomorrow.</p>' });
    poser({ actions: [courriel('Votre rendez-vous', '<p>À demain.</p>', C)] });
    expect((await appeler('r1', { canal: 'send_email', objet: 'Votre rendez-vous de jeudi', retirer_autre_version: true })).status).toBe(200);
    expect(enBase().actions[0].config).toEqual({ subject: 'Votre rendez-vous de jeudi', body: '<p>À demain.</p>' });
    // Version anglaise sans objet propre : l'objet de base reste celui du message.
    poser({ actions: [courriel('Votre rendez-vous', '<p>À demain.</p>', { body_en: '<p>See you tomorrow.</p>' })] });
    expect((await appeler('r1', { canal: 'send_email', langue: 'en', texte: '<p>See you soon.</p>', retirer_autre_version: true })).status).toBe(200);
    expect(enBase().actions[0].config).toEqual({ subject: 'Votre rendez-vous', body: '<p>See you soon.</p>' });
  });

  it('dans un parcours : l’étape ET le reflet `actions` perdent la version retirée', async () => {
    poser({ steps: [{ id: 'e1', type: 'action', action: sms(FR, { body_en: EN }), suivant: null }], actions: [sms(FR, { body_en: EN })] });
    expect((await appeler('r1', { canal: 'send_sms', etape_id: 'e1', texte: 'Bonjour, à demain.', retirer_autre_version: true })).status).toBe(200);
    expect((enBase().steps as Array<{ action: unknown }>)[0].action).toEqual(sms('Bonjour, à demain.'));
    expect(enBase().actions).toEqual([sms('Bonjour, à demain.')]);
  });

  it('l’ordre seul suffit (on retire sans rien réécrire)', async () => {
    poser({ actions: [sms(FR, { body_en: EN })] });
    expect((await appeler('r1', { canal: 'send_sms', retirer_autre_version: true })).status).toBe(200);
    expect(enBase().actions).toEqual([sms(FR)]);
  });

  it('refus : retirer le français d’un message sans anglais (il ne resterait rien) ; écrire ET retirer l’autre version', async () => {
    poser({ actions: [sms(FR)] });
    const rien = await appeler('r1', { canal: 'send_sms', langue: 'en', retirer_autre_version: true });
    expect(rien.status).toBe(400);
    expect(rien.json).toEqual({
      error: 'Ce message n’a pas de version anglaise : il n’y a rien à garder si on retire le texte français. Rien n’a été enregistré.',
      code: 'message_vide',
    });
    const deux = await appeler('r1', { canal: 'send_sms', texte: 'Bonjour', autre_version: { texte: 'Hello' }, retirer_autre_version: true });
    expect(deux.status).toBe(400);
    expect(deux.json.code).toBe('corps_invalide');
    expect(base.ecritures).toHaveLength(0);
  });

  it('un corps mal formé est refusé : clé inconnue, canal inconnu, rien à écrire', async () => {
    poser({ actions: [sms('Bonjour')] });
    for (const corps of [
      { canal: 'send_sms', texte: 'x', to: '+15145550000' },
      { canal: 'create_task', texte: 'x' },
      { canal: 'send_sms' },
      { canal: 'send_sms', texte: 'x', index_action: -1 },
    ]) expect((await appeler('r1', corps)).status).toBe(400);
    expect(base.ecritures).toHaveLength(0);
  });

  it('une variable que le serveur ne saura pas remplir est SIGNALÉE dans la réponse (l’enregistrement est fait)', async () => {
    poser({ actions: [sms('Bonjour')] });
    const r = await appeler('r1', { canal: 'send_sms', texte: 'Bonjour [prenom], [client_first_name] — {{client.toitur}}' });
    expect(r.status).toBe(200);
    expect(r.json.variables_inconnues).toEqual(['prenom']);
    expect((await appeler('r1', { canal: 'send_sms', texte: 'Bonjour [client_first_name]' })).json.variables_inconnues).toEqual([]);
  });
});

describe('les gardes : droit, corbeille, bureau', () => {
  it('sans le droit `automations.update` : 403, la phrase lisible, rien n’est lu ni écrit', async () => {
    poser({ actions: [sms('Bonjour')] });
    base.utilisateur = 'technicien';
    const r = await appeler('r1', { canal: 'send_sms', texte: 'Texte du technicien' });
    expect(r.status).toBe(403);
    expect(r.json.error).toBe('Permission denied: automations.update');
    expect(typeof r.json.message).toBe('string');
    expect(base.ecritures).toHaveLength(0);
    expect(base.lectures.automation_rules ?? 0).toBe(0);
  });

  it('03-texto:363 — une automatisation à la corbeille ne se modifie pas : 409, la phrase des autres routes', async () => {
    poser({ actions: [sms('Bonjour')], deleted_at: '2026-10-01T12:00:00Z' });
    const r = await appeler('r1', { canal: 'send_sms', texte: 'Texte modifié depuis la corbeille' });
    expect(r.status).toBe(409);
    expect(r.json).toEqual({ error: 'Cette automatisation est à la corbeille : restaurez-la pour la modifier.', code: 'corbeille' });
    expect(base.ecritures).toHaveLength(0);
  });

  it('une règle d’un autre bureau, supprimée définitivement ou inconnue : 404', async () => {
    poser({ actions: [sms('Bonjour')], org_id: 'autre-bureau' });
    expect((await appeler('r1', { canal: 'send_sms', texte: 'x' })).status).toBe(404);
    poser({ actions: [sms('Bonjour')], purged_at: '2026-10-01T12:00:00Z' });
    expect((await appeler('r1', { canal: 'send_sms', texte: 'x' })).status).toBe(404);
    expect((await appeler('inconnue', { canal: 'send_sms', texte: 'x' })).status).toBe(404);
    expect(base.ecritures).toHaveLength(0);
  });

  it('une règle sans message de ce canal : 404 `message_introuvable`', async () => {
    poser({ actions: [tache] });
    const r = await appeler('r1', { canal: 'send_sms', texte: 'x' });
    expect(r.status).toBe(404);
    expect(r.json.code).toBe('message_introuvable');
  });

  it('une écriture filtrée par la RLS (0 ligne) n’est pas un succès : 403', async () => {
    poser({ actions: [sms('Bonjour')] });
    base.ecritureFiltree = true;
    const r = await appeler('r1', { canal: 'send_sms', texte: 'x' });
    expect(r.status).toBe(403);
    expect(r.json).toEqual({ error: 'Modification refusée — vous n’avez pas accès à cette automatisation.', code: 'ecriture_refusee' });
  });

  it('03-texto:155 — une panne de la base ne montre jamais son texte technique', async () => {
    poser({ actions: [sms('Bonjour')] });
    base.erreurEcriture = { message: 'canceling statement due to statement timeout', code: '57014' };
    const r = await appeler('r1', { canal: 'send_sms', texte: 'x' });
    expect(r.status).toBe(500);
    expect(r.json.error).toBe('Enregistrement impossible pour le moment : rien n’a été modifié. Réessayez dans un instant.');
    expect(JSON.stringify(r.json)).not.toContain('canceling');
  });

  it('04-courriel:895 — interface anglaise (`Accept-Language: en`) : les refus sont dits en anglais', async () => {
    const en = { 'Accept-Language': 'en' };
    poser({ actions: [sms('Bonjour')] });
    base.ecritureFiltree = true;
    expect((await appeler('r1', { canal: 'send_sms', texte: 'x' }, en)).json.error).toBe('Change refused — you do not have access to this automation.');
    base.ecritureFiltree = false;
    expect((await appeler('r1', { canal: 'send_sms', texte: 'a'.repeat(1700) }, en)).json.error)
      .toBe('A text is 1,600 characters at most (this one: 1,700). Shorten it — nothing was saved.');
    expect((await appeler('r1', { canal: 'send_sms', texte: ' ' }, en)).json.error).toBe('The message cannot be empty.');
    poser({ actions: [sms('Bonjour')], deleted_at: '2026-10-01T12:00:00Z' });
    expect((await appeler('r1', { canal: 'send_sms', texte: 'x' }, en)).json.error).toBe('This automation is in the bin: restore it to edit it.');
  });
});

describe('le navigateur et le serveur lisent les messages de la même façon', () => {
  const REGLES = [
    { steps: null, actions: [sms('a'), tache, courriel('o', 'c'), sms('b', { body_en: 'B' })] },
    { steps: PARCOURS, actions: [sms('périmé')] },
    { steps: [PARCOURS[4], PARCOURS[0], PARCOURS[2], PARCOURS[1], PARCOURS[3]], actions: [] },
    { steps: [], actions: [sms('resté dans actions')] },
    { steps: null, actions: [] },
  ];

  it('mêmes messages, même ordre, mêmes rangs, mêmes étapes', () => {
    for (const regle of REGLES) {
      for (const canal of [undefined, 'send_sms', 'send_email'] as const) {
        const navigateur = messagesCoteNavigateur(regle, canal).map((m) => [m.type, m.rang, m.etapeId, m.config]);
        const serveur = messagesCoteServeur(regle, canal).map((m) => [m.canal, m.rang, m.etapeId, m.config]);
        expect(navigateur).toEqual(serveur);
      }
    }
  });

  it('même texte « qui part », et même reflet `actions` d’un parcours', () => {
    for (const config of [{ body: 'Bonjour', body_en: 'Hello' }, { body: 'Bonjour' }, { body: 'Bonjour', body_en: ' ' }, {}]) {
      for (const langue of ['fr', 'en'] as const) expect(partCoteNavigateur(config, 'body', langue)).toBe(partCoteServeur(config, 'body', langue));
    }
    const apres = avecTexteDuMessage({ steps: PARCOURS, actions: [] }, 'send_sms', 'Premier texto.');
    expect(apres.actions).toEqual(refletDuParcours(PARCOURS));
  });
});

describe('ce qui reste à brancher hors de la zone de l’agent T', () => {
  const lire = (p: string) => readFileSync(resolve(__dirname, '..', '..', '..', p), 'utf8');

  it('le navigateur n’écrit plus `automation_rules` depuis `automationRulesApi.ts`', () => {
    expect(lire('src/lib/automationRulesApi.ts')).not.toMatch(/\.from\('automation_rules'\)\s*\.(update|insert|delete|upsert)\(/);
  });

  it('la route porte sa propre garde de droit : elle refuse même sans entrée dans la table des routes', () => {
    // À REPORTER — server/lib/route-permissions.ts : 'PATCH /api/automations/rules/:id/messages': 'automations.update'.
    // Tant que la ligne n'y est pas, c'est la garde de la route (prouvée plus haut) qui protège.
    expect(lire('server/routes/automation-messages.ts')).toContain("hasPermission(ctx, 'automations.update')");
  });
});
