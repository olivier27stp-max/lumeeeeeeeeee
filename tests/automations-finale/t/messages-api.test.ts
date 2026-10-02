/**
 * LES MESSAGES D'UNE AUTOMATISATION, CÔTÉ API — triage « modèles » du 2026-10-01.
 *
 * La vraie `src/lib/automationRulesApi.ts` sur une fausse base en mémoire : on
 * regarde ce qui est ÉCRIT, message par message. Un bloc `describe` par ligne
 * du triage.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../src/lib/supabase', async () => (await import('./faux-supabase')).moduleSupabase());
vi.mock('../../../src/lib/orgApi', () => ({ getCurrentOrgId: async () => 'org-1', getCurrentOrgIdOrThrow: async () => 'org-1' }));

import { base, remettre, ligne } from './faux-supabase';
import {
  updateRuleMessage, messagesDeRegle, texteDuMessage, avecTexteDuMessage,
} from '../../../src/lib/automationRulesApi';

type Action = { type: string; config: Record<string, unknown> };
type Regle = { id: string; actions: Action[]; steps: unknown[] | null; deleted_at?: string | null };

const sms = (body: string, plus: Record<string, unknown> = {}): Action => ({ type: 'send_sms', config: { body, ...plus } });
const courriel = (subject: string, body: string, plus: Record<string, unknown> = {}): Action => ({ type: 'send_email', config: { subject, body, ...plus } });
const tache: Action = { type: 'create_task', config: { title: 'Rappeler le client' } };

function poser(regle: Partial<Regle>): void {
  remettre({ automation_rules: [{ id: 'r1', org_id: 'org-1', actions: [], steps: null, deleted_at: null, ...regle }] });
}
const enBase = () => ligne<Regle>('automation_rules', 'r1');
const corps = (type: string) => enBase().actions.filter((a) => a.type === type).map((a) => a.config.body);

/** Un parcours : texto e1 → attente e2 → courriel e3 → texto e4. */
const PARCOURS = [
  { id: 'e1', type: 'action', action: sms('Premier texto : confirmation.'), suivant: 'e2' },
  { id: 'e2', type: 'attendre', delai_secondes: 86400, suivant: 'e3' },
  { id: 'e3', type: 'action', action: courriel('Objet', '<p>Corps</p>'), suivant: 'e4' },
  { id: 'e4', type: 'action', action: sms('Second texto : rappel la veille.'), suivant: null },
];

beforeEach(() => { remettre(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('03-texto:172 et 04-courriel:816 — modifier un message ne recopie pas son texte dans l’autre message du même type', () => {
  it('deux textos (règle à plat) : seul celui qu’on désigne par le texte lu change', async () => {
    poser({ actions: [sms('Premier texto : confirmation.'), sms('Second texto : rappel la veille.')] });
    await updateRuleMessage('r1', 'send_sms', 'Premier texto, corrigé.', undefined, { corpsLu: 'Premier texto : confirmation.' });
    expect(corps('send_sms')).toEqual(['Premier texto, corrigé.', 'Second texto : rappel la veille.']);
  });

  it('deux textos : le second se désigne par son rang, et le premier ne bouge pas', async () => {
    poser({ actions: [sms('Premier texto : confirmation.'), tache, sms('Second texto : rappel la veille.')] });
    await updateRuleMessage('r1', 'send_sms', 'Second texto, corrigé.', undefined, { rang: 1 });
    expect(enBase().actions).toEqual([sms('Premier texto : confirmation.'), tache, sms('Second texto, corrigé.')]);
  });

  it('deux courriels : changer l’objet du premier laisse au second son objet ET son corps', async () => {
    const second = courriel('Second objet', '<div><h2>Second courriel</h2><p>Texte du second.</p></div>');
    poser({ actions: [courriel('Votre rendez-vous', '<div><h2>Bonjour</h2></div>'), second] });
    await updateRuleMessage('r1', 'send_email', '<div><h2>Bonjour</h2></div>', 'Premier objet corrigé', {
      corpsLu: '<div><h2>Bonjour</h2></div>', objetLu: 'Votre rendez-vous',
    });
    expect(enBase().actions[0].config.subject).toBe('Premier objet corrigé');
    expect(enBase().actions[1]).toEqual(second);
  });

  it('sans désigner lequel, deux messages du même type : refus clair, rien n’est écrit (plus de recopie)', async () => {
    poser({ actions: [sms('Premier texto : confirmation.'), sms('Second texto : rappel la veille.')] });
    await expect(updateRuleMessage('r1', 'send_sms', 'Premier texto, corrigé.')).rejects.toThrow(/2 messages de ce type/);
    expect(base.ecritures).toHaveLength(0);
    expect(corps('send_sms')).toEqual(['Premier texto : confirmation.', 'Second texto : rappel la veille.']);
  });

  it('un seul message de ce type : pas besoin de le désigner, et les autres actions ne bougent pas', async () => {
    const c = courriel('Objet', '<p>Corps</p>');
    poser({ actions: [sms('Bonjour', { body_en: 'Hello' }), c, tache] });
    await updateRuleMessage('r1', 'send_sms', 'Nouveau texto.');
    expect(enBase().actions).toEqual([sms('Nouveau texto.', { body_en: 'Hello' }), c, tache]);
    // Règle à plat : on n'invente pas de parcours.
    expect(base.ecritures[0].valeurs).not.toHaveProperty('steps');
  });

  it('le message désigné a changé ailleurs depuis l’ouverture de l’écran : refus, rien n’est écrit', async () => {
    poser({ actions: [sms('Texte que quelqu’un d’autre vient d’écrire.'), sms('Second texto.')] });
    await expect(updateRuleMessage('r1', 'send_sms', 'Ma correction', undefined, { rang: 0, corpsLu: 'Ancien texte, lu il y a dix minutes.' }))
      .rejects.toThrow(/modifié ailleurs/);
    expect(base.ecritures).toHaveLength(0);
  });

  it('aucun message de ce type : l’écriture est refusée au lieu d’annoncer un enregistrement qui n’a rien changé', async () => {
    poser({ actions: [tache] });
    await expect(updateRuleMessage('r1', 'send_sms', 'Bonjour')).rejects.toThrow(/aucun message de ce type/);
    expect(base.ecritures).toHaveLength(0);
  });
});

describe('une seule source de vérité : le parcours (`steps`)', () => {
  it('parcours à deux textos : on modifie l’étape désignée, l’autre ne bouge pas, et `actions` est remis en accord dans la même écriture', async () => {
    // `actions` porte un reste périmé : le reflet doit être refait, pas rafistolé.
    poser({ steps: PARCOURS, actions: [sms('À compléter')] });
    await updateRuleMessage('r1', 'send_sms', 'Second texto, corrigé.', undefined, { etapeId: 'e4' });
    const r = enBase();
    const etapes = r.steps as Array<{ id: string; action?: Action }>;
    expect(etapes.find((e) => e.id === 'e4')?.action?.config.body).toBe('Second texto, corrigé.');
    expect(etapes.find((e) => e.id === 'e1')?.action?.config.body).toBe('Premier texto : confirmation.');
    expect(etapes.find((e) => e.id === 'e3')?.action).toEqual(courriel('Objet', '<p>Corps</p>'));
    // Le reflet : les actions du parcours, dans l'ordre, sans l'attente.
    expect(r.actions).toEqual([sms('Premier texto : confirmation.'), courriel('Objet', '<p>Corps</p>'), sms('Second texto, corrigé.')]);
    expect(base.ecritures).toHaveLength(1);
    expect(Object.keys(base.ecritures[0].valeurs).sort()).toEqual(['actions', 'steps', 'updated_at']);
  });

  it('parcours à deux textos, sans désigner l’étape : refus, rien n’est écrit', async () => {
    poser({ steps: PARCOURS, actions: [] });
    await expect(updateRuleMessage('r1', 'send_sms', 'Texte')).rejects.toThrow(/2 messages de ce type/);
    expect(base.ecritures).toHaveLength(0);
  });

  it('parcours à un seul courriel : il s’écrit dans l’étape, pas seulement dans `actions`', async () => {
    poser({ steps: PARCOURS, actions: [courriel('Vieil objet', '<p>Vieux corps</p>')] });
    await updateRuleMessage('r1', 'send_email', '<p>Nouveau corps</p>', 'Nouvel objet');
    const e3 = (enBase().steps as Array<{ id: string; action?: Action }>).find((e) => e.id === 'e3');
    expect(e3?.action?.config).toEqual({ subject: 'Nouvel objet', body: '<p>Nouveau corps</p>' });
    expect(enBase().actions.filter((a) => a.type === 'send_email')).toEqual([courriel('Nouvel objet', '<p>Nouveau corps</p>')]);
  });

  it('un parcours VIDE (`steps: []`) n’envoie rien : on ne relit pas le texto resté dans `actions`, et on n’y écrit pas', async () => {
    const regle = { steps: [], actions: [sms('Texto d’avant la conversion')] };
    expect(messagesDeRegle(regle)).toEqual([]);
    expect(texteDuMessage(regle, 'send_sms')).toBe('');
    poser(regle);
    await expect(updateRuleMessage('r1', 'send_sms', 'Bonjour')).rejects.toThrow(/aucun message de ce type/);
    expect(base.ecritures).toHaveLength(0);
  });

  it('les messages d’un parcours se listent dans l’ordre du parcours, pas dans celui du tableau', () => {
    const etapes = [PARCOURS[0], PARCOURS[3], PARCOURS[1], PARCOURS[2]];
    expect(messagesDeRegle({ steps: etapes, actions: [] }).map((m) => [m.type, m.rang, m.etapeId])).toEqual([
      ['send_sms', 0, 'e1'], ['send_email', 0, 'e3'], ['send_sms', 1, 'e4'],
    ]);
  });

  it('`texteDuMessage` et `avecTexteDuMessage` lisent et mettent à jour le parcours, reflet compris', () => {
    const regle = { steps: PARCOURS, actions: [sms('périmé')] };
    expect(texteDuMessage(regle, 'send_sms')).toBe('Premier texto : confirmation.');
    const apres = avecTexteDuMessage(regle, 'send_sms', 'Nouveau');
    expect(texteDuMessage(apres, 'send_sms')).toBe('Nouveau');
    expect(apres.actions.map((a) => a.config.body)).toEqual(['Nouveau', '<p>Corps</p>', 'Second texto : rappel la veille.']);
    // Règle à plat : seul le premier message du type change.
    const plat = avecTexteDuMessage({ steps: null, actions: [sms('a'), sms('b')] }, 'send_sms', 'c');
    expect(plat.actions.map((a) => a.config.body)).toEqual(['c', 'b']);
  });
});
