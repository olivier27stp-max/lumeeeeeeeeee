// @vitest-environment jsdom
/**
 * RÉGLAGES › MESSAGERIE › « Textos automatiques » — constats A-19 et E-64, et
 * la même racine que 03-texto:345 (bureau dont les messages partent en anglais).
 *
 * La VRAIE section `AutomationSmsSection` (src/pages/SettingsMessaging.tsx), la
 * VRAIE API des messages et la VRAIE route d'écriture, sur une fausse base.
 */
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';

const toasts = vi.hoisted(() => ({ succes: [] as string[], erreurs: [] as string[] }));
vi.mock('../../../src/lib/supabase', async () => (await import('./faux-supabase')).moduleSupabase());
vi.mock('../../../src/lib/orgApi', () => ({ getCurrentOrgId: async () => 'org-1', getCurrentOrgIdOrThrow: async () => 'org-1' }));
vi.mock('../../../server/lib/supabase', async () => (await import('./faux-supabase')).moduleSupabaseServeur());
vi.mock('../../../server/lib/automatisations-bureaux', () => ({ bureauxCibles: async () => [], copierVersBureaux: async () => [], propagerAuxCopies: async () => [] }));
vi.mock('../../../src/lib/sentry', () => ({ captureClientException: () => {} }));
vi.mock('../../../src/i18n', () => ({ useTranslation: () => ({ language: 'fr', t: {} }) }));
vi.mock('sonner', () => ({
  toast: Object.assign(() => {}, {
    success: (m: string) => { toasts.succes.push(m); },
    error: (m: string) => { toasts.erreurs.push(m); },
  }),
}));

import { base, remettre, ligne } from './faux-supabase';
import { brancherServeur, arreterServeur } from './serveur-messages';
import { monter, demonter, bouton, boutons, champ, champs, cliquer, saisir, jusqua, texteEcran } from './banc-composants';
import { AutomationSmsSection } from '../../../src/pages/SettingsMessaging';

type Action = { type: string; config: Record<string, unknown> };
type Regle = { id: string; actions: Action[]; steps: unknown[] | null };

const sms = (body: string, plus: Record<string, unknown> = {}): Action => ({ type: 'send_sms', config: { body, ...plus } });
let n = 0;
function regle(sup: Record<string, unknown>): Record<string, unknown> {
  n += 1;
  return {
    id: `r${n}`, org_id: 'org-1', name: `Règle ${n}`, description: '', trigger_event: 'appointment.created', conditions: {},
    delay_seconds: 0, actions: [], steps: null, is_active: true, is_preset: false, preset_key: null,
    deleted_at: null, purged_at: null, ...sup,
  };
}
function poser(regles: Array<Record<string, unknown>>, langue: 'fr' | 'en' = 'fr'): void {
  remettre({
    automation_rules: regles,
    company_settings: [{ id: 'cs1', org_id: 'org-1', company_name: 'Nettoyage Test A', default_language: langue }],
  });
}
async function ouvrir(isFr = true) {
  await monter(<MemoryRouter><AutomationSmsSection isFr={isFr} /></MemoryRouter>);
  await jusqua(() => !texteEcran().includes('Chargement…'));
}
/** Les noms des automatisations listées, dans l'ordre de l'écran. */
const lignes = () => Array.from(document.body.querySelectorAll('p.truncate.font-medium')).map((p) => p.textContent);
const enBase = (id: string) => ligne<Regle>('automation_rules', id);

beforeEach(async () => { n = 0; localStorage.setItem('lume-language', 'fr'); toasts.succes.length = 0; toasts.erreurs.length = 0; await brancherServeur(); });
afterEach(async () => { await demonter(); });
afterAll(async () => { await arreterServeur(); });

describe('A-19 — « Textos automatiques » liste TOUTES les automatisations qui envoient un texto', () => {
  it('« Facture en retard » y est, dans « Factures & paiements »', async () => {
    poser([regle({ name: 'Relance de facture en retard', trigger_event: 'invoice.overdue', actions: [sms('Votre facture est en retard.')] })]);
    await ouvrir();
    expect(lignes()).toEqual(['Relance de facture en retard']);
    expect(texteEcran()).toContain('Factures & paiements');
  });

  it('une automatisation créée par Lumi (un PARCOURS : `actions` ne porte pas le texto) y est, avec le texte de son étape', async () => {
    poser([regle({
      name: 'Suivi après la visite',
      trigger_event: 'job.completed',
      actions: [],
      steps: [{ id: 'e1', type: 'action', action: sms('Merci [client_first_name] !'), suivant: null }],
    })]);
    await ouvrir();
    expect(lignes()).toEqual(['Suivi après la visite']);
    expect(texteEcran()).toContain('Merci [client_first_name] !');
    expect(texteEcran()).toContain('parcours à étapes');
  });

  it('un déclencheur qu’aucun groupe ne connaît : rangé sous « Autres automatisations », pas oublié', async () => {
    poser([regle({ name: 'Étiquette posée', trigger_event: 'client.tagged', actions: [sms('Bonjour')] })]);
    await ouvrir();
    expect(lignes()).toEqual(['Étiquette posée']);
    expect(texteEcran()).toContain('Autres automatisations');
  });

  it('ni la corbeille, ni un parcours qui n’envoie plus de texto (le texto resté dans `actions` ne compte pas)', async () => {
    poser([
      regle({ name: 'À la corbeille', actions: [sms('Bonjour')], deleted_at: '2026-10-01T12:00:00Z' }),
      regle({ name: 'Parcours sans texto', steps: [{ id: 'e1', type: 'action', action: { type: 'create_task', config: { title: 'Appeler' } }, suivant: null }], actions: [sms('Vieux texto')] }),
      regle({ name: 'Vivante', actions: [sms('Bonjour')] }),
    ]);
    await ouvrir();
    expect(lignes()).toEqual(['Vivante']);
  });

  it('un parcours à DEUX textos : la ligne le dit et renvoie à l’éditeur, au lieu d’offrir un champ qui ne saurait pas lequel écrire', async () => {
    poser([regle({
      name: 'Relance en deux temps',
      trigger_event: 'quote.sent',
      steps: [
        { id: 'e1', type: 'action', action: sms('Premier texto.'), suivant: 'e2' },
        { id: 'e2', type: 'action', action: sms('Second texto.'), suivant: null },
      ],
    })]);
    await ouvrir();
    expect(texteEcran()).toContain('et 1 autre texto');
    await cliquer(boutons().find((b) => (b.textContent ?? '').includes('Relance en deux temps')));
    expect(texteEcran()).toContain('Cette automatisation envoie 2 textos.');
    expect(document.body.querySelector('a[href="/automations/r1"]')?.textContent).toBe('Ouvrir dans Automatisations');
    expect(document.body.querySelector('textarea')).toBeNull();
  });

  it('modifier le texto d’un parcours à un seul texto écrit l’ÉTAPE, et le reflet `actions`', async () => {
    poser([regle({
      name: 'Merci après la visite',
      trigger_event: 'job.completed',
      actions: [sms('périmé')],
      steps: [{ id: 'e1', type: 'action', action: sms('Merci !'), suivant: null }],
    })]);
    await ouvrir();
    await cliquer(boutons().find((b) => (b.textContent ?? '').includes('Merci après la visite')));
    await saisir(champ('Texte du SMS — Merci après la visite'), 'Merci beaucoup !');
    await cliquer(bouton('Enregistrer'));
    await jusqua(() => base.ecritures.length === 1);
    expect((enBase('r1').steps as Array<{ action: Action }>)[0].action).toEqual(sms('Merci beaucoup !'));
    expect(enBase('r1').actions).toEqual([sms('Merci beaucoup !')]);
    expect(toasts.erreurs).toEqual([]);
    expect(champs('Texte du SMS — Merci après la visite')).toHaveLength(0);
    expect(texteEcran()).toContain('Merci beaucoup !');
  });
});
