// @vitest-environment jsdom
/**
 * À REPORTER — `src/components/automations/MessageEditor.tsx` (et son appelant
 * `src/pages/Automations.tsx`), hors de la zone de l'agent T.
 *
 * Ces tests sont ROUGES tant que le changement décrit dans
 * `D:/lume-final/notes/T-corrections.md` (bloc « À REPORTER — MessageEditor.tsx
 * et Automations.tsx » ; patchs prêts dans `D:/lume-final/notes/T-a-reporter/`)
 * n'est pas appliqué par les agents qui possèdent ces fichiers. Ils passent
 * TOUS avec les deux patchs. L'API et la route (zone T) offrent déjà tout ce
 * qu'il faut : `ecrireMessageDeRegle(…, cible)`, `LONGUEUR_MAX_TEXTO`,
 * `remplacerVariables(texte, fr)`.
 *
 * Le VRAI `MessageEditor`, monté comme la liste le monte (avec les propriétés
 * que le patch d'`Automations.tsx` lui passe), la VRAIE API des messages et la
 * VRAIE route, sur une fausse base. Un bloc par ligne du triage ; chaque test
 * fait le geste de la spec Playwright citée.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';

const toasts = vi.hoisted(() => ({ succes: [] as string[], erreurs: [] as string[] }));
vi.mock('../../../src/lib/supabase', async () => (await import('./faux-supabase')).moduleSupabase());
vi.mock('../../../src/lib/orgApi', () => ({ getCurrentOrgId: async () => 'org-1', getCurrentOrgIdOrThrow: async () => 'org-1' }));
vi.mock('../../../server/lib/supabase', async () => (await import('./faux-supabase')).moduleSupabaseServeur());
vi.mock('../../../server/lib/automatisations-bureaux', () => ({ bureauxCibles: async () => [], copierVersBureaux: async () => [], propagerAuxCopies: async () => [] }));
vi.mock('../../../src/components/ui/ConfirmDialog', () => ({ confirmer: async () => true, default: () => null }));
vi.mock('sonner', () => ({
  toast: Object.assign(() => {}, {
    success: (m: string) => { toasts.succes.push(m); },
    error: (m: string) => { toasts.erreurs.push(m); },
  }),
}));

import { base, remettre, ligne } from './faux-supabase';
import { monter, demonter, bouton, boutonPresent, champ, champs, cliquer, saisir, jusqua, texteEcran } from './banc-composants';
import { brancherServeur, arreterServeur } from './serveur-messages';
import MessageEditor from '../../../src/components/automations/MessageEditor';

type Action = { type: string; config: Record<string, unknown> };
type Regle = { id: string; actions: Action[]; steps: unknown[] | null };

function poser(actions: Action[], plus: Record<string, unknown> = {}): void {
  remettre({ automation_rules: [{ id: 'r1', org_id: 'org-1', actions, steps: null, deleted_at: null, ...plus }] });
}
const enBase = () => ligne<Regle>('automation_rules', 'r1');
const corpsSms = () => enBase().actions.filter((a) => a.type === 'send_sms').map((a) => a.config.body);
const ZONE = 'Texto envoyé au client';
const zones = () => champs(ZONE);
/** Le texte de « Le client lira : … ». */
const lu = () => Array.from(document.body.querySelectorAll('span')).find((s) => s.textContent === 'Le client lira :' || s.textContent === 'The client will read:')?.nextElementSibling?.textContent ?? '';
const compteur = () => Array.from(document.body.querySelectorAll('p')).find((p) => /^\d+ (caractères|characters)/.test(p.textContent ?? ''))?.textContent ?? '';

interface Options { fr?: boolean; langueBureau?: 'fr' | 'en' | null; lectureSeule?: boolean }
/** La ligne dépliée, comme `Automations.tsx` la rend une fois son patch appliqué. */
async function deplier(actions: Action[], options: Options = {}) {
  const Editeur = MessageEditor as unknown as React.ComponentType<Record<string, unknown>>;
  const messages = actions.filter((a) => a.type === 'send_sms' || a.type === 'send_email');
  await monter(
    <div>
      {messages.map((a, i) => (
        <Editeur
          key={`r1-${a.type}-${i}`} ruleId="r1" ruleName="Rappel" actionType={a.type}
          body={String(a.config.body ?? '')} subject={a.config.subject ? String(a.config.subject) : undefined}
          fr={options.fr ?? true} onSaved={() => {}} declencheur="appointment.created"
          rang={messages.slice(0, i).filter((m) => m.type === a.type).length}
          bodyEn={typeof a.config.body_en === 'string' ? a.config.body_en : undefined}
          langueBureau={options.langueBureau === undefined ? 'fr' : options.langueBureau}
          lectureSeule={options.lectureSeule ?? false}
        />
      ))}
    </div>,
  );
}
const sms = (body: string, plus: Record<string, unknown> = {}): Action => ({ type: 'send_sms', config: { body, ...plus } });

beforeEach(async () => { localStorage.setItem('lume-language', 'fr'); toasts.succes.length = 0; toasts.erreurs.length = 0; await brancherServeur(); });
afterEach(async () => { await demonter(); });
afterAll(async () => { await arreterServeur(); });

describe('03-texto:172 [MSG-010] — modifier un texto ne touche pas à l’autre texto de la même automatisation', () => {
  it('corriger le premier de deux textos, « Enregistrer » : « Message enregistré », et seul le premier a changé', async () => {
    const actions = [sms('Premier texto : confirmation.'), sms('Second texto : rappel la veille.')];
    poser(actions);
    await deplier(actions);
    await saisir(zones()[0], 'Premier texto, corrigé.');
    await cliquer(bouton('Enregistrer', 0));
    await jusqua(() => toasts.erreurs.length + toasts.succes.length > 0);
    expect(toasts.erreurs).toEqual([]);
    expect(toasts.succes).toContain('Message enregistré');
    expect(corpsSms()).toEqual(['Premier texto, corrigé.', 'Second texto : rappel la veille.']);
  });

  it('et le SECOND se corrige sans toucher au premier', async () => {
    const actions = [sms('Premier texto : confirmation.'), sms('Second texto : rappel la veille.')];
    poser(actions);
    await deplier(actions);
    await saisir(zones()[1], 'Second texto, corrigé.');
    await cliquer(bouton('Enregistrer', 1));
    await jusqua(() => toasts.succes.length === 1);
    expect(corpsSms()).toEqual(['Premier texto : confirmation.', 'Second texto, corrigé.']);
  });
});

describe('03-texto:345 [MSG-001][MSG-010] — bureau qui écrit en ANGLAIS : le champ montre et modifie le texte qui part', () => {
  const FR = 'Bonjour, votre rendez-vous est confirmé.';
  const EN = 'Hi, your appointment is confirmed.';

  it('le champ « Texto envoyé au client » porte l’anglais ; « Enregistrer » écrit `body_en` ; le français, juste en dessous, ne bouge pas', async () => {
    const actions = [sms(FR, { body_en: EN })];
    poser(actions);
    await deplier(actions, { langueBureau: 'en' });
    expect(zones()).toHaveLength(1);
    expect(zones()[0].value).toBe(EN);
    expect(champ(`${ZONE} — version française`).value).toBe(FR);
    expect(texteEcran()).toContain('Version anglaise — celle qui part');
    await saisir(zones()[0], 'Hi, see you tomorrow.');
    await cliquer(bouton('Enregistrer'));
    await jusqua(() => toasts.succes.includes('Message enregistré'));
    expect(enBase().actions).toEqual([sms(FR, { body_en: 'Hi, see you tomorrow.' })]);
  });

  it('bureau en français, texto qui porte une version anglaise : corriger le français sans l’anglais est signalé, « Enregistrer » attend', async () => {
    const actions = [sms(FR, { body_en: EN })];
    poser(actions);
    await deplier(actions, { langueBureau: 'fr' });
    expect(zones()[0].value).toBe(FR);
    expect(champ(`${ZONE} — version anglaise`).value).toBe(EN);
    await saisir(zones()[0], 'Bonjour, à demain.');
    expect(texteEcran()).toContain('Le texte français a changé, pas sa version anglaise.');
    expect(bouton('Enregistrer').disabled).toBe(true);
    await cliquer(document.body.querySelector('input[type="checkbox"]'));
    await cliquer(bouton('Enregistrer'));
    await jusqua(() => toasts.succes.includes('Message enregistré'));
    expect(enBase().actions).toEqual([sms('Bonjour, à demain.', { body_en: EN })]);
  });

  it('un texto sans version anglaise, bureau en français : un seul champ, rien de plus', async () => {
    const actions = [sms(FR)];
    poser(actions);
    await deplier(actions);
    expect(document.body.querySelectorAll('textarea')).toHaveLength(1);
    expect(texteEcran()).not.toContain('version anglaise');
  });
});

describe('03-texto:316 [MSG-001][MSG-010] — au-delà de 1 600 caractères, l’écran le dit et grise « Enregistrer »', () => {
  it('1 700 caractères : rien n’est tronqué, la phrase dit le plafond, le bouton est grisé, rien ne part', async () => {
    const actions = [sms('Bonjour')];
    poser(actions);
    await deplier(actions);
    const long = 'a'.repeat(1700);
    await saisir(zones()[0], long);
    expect(zones()[0].value).toBe(long);
    expect(compteur()).toContain('1700 caractères · 12 SMS');
    expect(texteEcran()).toMatch(/1 ?600|trop long/i);
    expect(bouton('Enregistrer').disabled).toBe(true);
    expect(base.ecritures).toHaveLength(0);
    // 1 600 tout rond : enregistrable.
    await saisir(zones()[0], 'a'.repeat(1600));
    expect(bouton('Enregistrer').disabled).toBe(false);
  });
});

describe('03-texto:363 [MSG-001] — dans la corbeille, le texto n’est pas modifiable', () => {
  it('le champ est en lecture seule, sans « Enregistrer » ni « Insérer », et l’écran dit de restaurer d’abord', async () => {
    const actions = [sms('Bonjour'), { type: 'send_email', config: { subject: 'Objet', body: '<p>Corps</p>' } }];
    poser(actions, { deleted_at: '2026-10-01T12:00:00Z' });
    await deplier(actions, { lectureSeule: true });
    expect(zones()[0].readOnly).toBe(true);
    expect(boutonPresent('Enregistrer')).toBe(false);
    expect(boutonPresent('Prénom du client')).toBe(false);
    // Le courriel non plus ne s'ouvre pas en modification.
    expect(boutonPresent('Modifier')).toBe(false);
    expect(texteEcran()).toContain('Cette automatisation est à la corbeille : restaurez-la pour modifier ses messages.');
  });
});

describe('03-texto:237 [MSG-002] — « Insérer » place la variable là où est le curseur', () => {
  it('curseur après « Bonjour » : « Bonjour [client_first_name], à demain. »', async () => {
    const actions = [sms('Bonjour , à demain.')];
    poser(actions);
    await deplier(actions);
    await saisir(zones()[0], 'Bonjour , à demain.'); // lui donne le focus
    zones()[0].setSelectionRange(8, 8);
    await cliquer(bouton('Prénom du client'));
    expect(zones()[0].value).toBe('Bonjour [client_first_name], à demain.');
  });

  it('sans avoir mis le curseur dans le champ : à la fin, comme avant', async () => {
    const actions = [sms('Texte.')];
    poser(actions);
    await deplier(actions);
    await cliquer(bouton('Prénom du client'));
    await cliquer(bouton('Nom complet'));
    expect(zones()[0].value).toBe('Texte.[client_first_name][client_name]');
  });
});

describe('03-texto:259 [MSG-001] — avec une variable inconnue, « Le client lira » montre ce qu’il lira vraiment', () => {
  it('« Bonjour [prenom], à demain. » : le client lira « Bonjour , à demain. »', async () => {
    const actions = [sms('Bonjour')];
    poser(actions);
    await deplier(actions);
    await saisir(zones()[0], 'Bonjour [prenom], à demain.');
    expect(texteEcran()).toContain('Variable inconnue : [prenom]');
    expect(lu()).toBe('Bonjour , à demain.');
  });
});

describe('03-texto:306 [MSG-001] — le nombre de SMS annoncé est celui du texte que le client lira', () => {
  it('150 lettres + [client_first_name] : le client lit 155 caractères — un seul SMS, pas deux', async () => {
    const actions = [sms('Bonjour')];
    poser(actions);
    await deplier(actions);
    await saisir(zones()[0], `${'a'.repeat(150)}[client_first_name]`);
    expect(lu()).toBe(`${'a'.repeat(150)}Marie`);
    expect(compteur()).not.toContain('2 SMS');
    // Un texte sans variable se compte comme avant.
    await saisir(zones()[0], 'a'.repeat(161));
    expect(compteur()).toBe('161 caractères · 2 SMS');
  });
});

describe('03-texto:438 [MSG-004][MSG-008] — en anglais, les exemples de « The client will read » sont en anglais', () => {
  it('ni « Votre entreprise », ni « août », ni « 9 h 00 »', async () => {
    localStorage.setItem('lume-language', 'en');
    const actions = [sms('See you on [appointment_date] at [appointment_time] — [company_name]')];
    poser(actions);
    await deplier(actions, { fr: false });
    expect(lu()).toBe('See you on August 14, 2026 at 9:00 a.m. — Your company');
  });
});

describe('03-texto:113 [MSG-001] — un texto fait d’espaces ou de retours à la ligne : « Le client lira » montre « — »', () => {
  it('comme pour un texto vide', async () => {
    const actions = [sms('Bonjour')];
    poser(actions);
    await deplier(actions);
    for (const vide of ['', '   ', '\n\n']) {
      await saisir(zones()[0], vide);
      expect(texteEcran()).toContain('Le message ne peut pas être vide.');
      expect(lu(), `texte saisi : ${JSON.stringify(vide)}`).toBe('—');
    }
  });
});
