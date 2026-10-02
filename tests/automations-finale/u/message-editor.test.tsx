// @vitest-environment jsdom
/**
 * LE TEXTO DE LA LISTE (`MessageEditor`) — corrections de l'agent U. Le vrai
 * composant, la vraie API des messages et la vraie route, sur la fausse base
 * et le banc de l'agent T (tests/automations-finale/t/).
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';

vi.mock('../../../src/lib/supabase', async () => (await import('../t/faux-supabase')).moduleSupabase());
vi.mock('../../../src/lib/orgApi', () => ({ getCurrentOrgId: async () => 'org-1', getCurrentOrgIdOrThrow: async () => 'org-1' }));
vi.mock('../../../server/lib/supabase', async () => (await import('../t/faux-supabase')).moduleSupabaseServeur());
vi.mock('../../../server/lib/automatisations-bureaux', () => ({ bureauxCibles: async () => [], copierVersBureaux: async () => [], propagerAuxCopies: async () => [] }));
vi.mock('../../../src/components/ui/ConfirmDialog', () => ({ confirmer: async () => true, default: () => null }));
vi.mock('sonner', () => ({ toast: Object.assign(() => {}, { success: () => {}, error: () => {} }) }));

import { remettre } from '../t/faux-supabase';
import { monter, demonter, choix, cliquer, saisir, champs } from '../t/banc-composants';
import { brancherServeur, arreterServeur } from '../t/serveur-messages';
import MessageEditor from '../../../src/components/automations/MessageEditor';

const FR = 'Bonjour, votre rendez-vous est confirmé.';
const EN = 'Hi, your appointment is confirmed.';

async function deplier(options: { fr?: boolean; langueBureau?: 'fr' | 'en' } = {}) {
  remettre({ automation_rules: [{ id: 'r1', org_id: 'org-1', actions: [{ type: 'send_sms', config: { body: FR, body_en: EN } }], steps: null, deleted_at: null }] });
  await monter(
    <MessageEditor
      ruleId="r1" ruleName="Rappel" actionType="send_sms" body={FR} bodyEn={EN} fr={options.fr ?? true}
      onSaved={() => {}} declencheur="appointment.created" rang={0} langueBureau={options.langueBureau ?? 'fr'}
    />,
  );
}

let amenes: Element[] = [];
beforeEach(async () => {
  await brancherServeur();
  amenes = [];
  (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView = function scrollIntoView(this: Element) { amenes.push(this); };
});
afterEach(async () => {
  await demonter();
  delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
});
afterAll(async () => { await arreterServeur(); });

const avis = () => document.body.querySelector('[data-testid="avis-retrait-autre-version"]');
const bloc = () => document.body.querySelector('[data-testid="autre-version"]');
const principal = () => champs('Texto envoyé au client')[0];

// ─── Remarque d'usage (a) : rien n'est retiré sans être écrit à côté d'« Enregistrer » ───

describe('texto de la liste — ce qu’« Enregistrer » va retirer est écrit à côté du bouton, comme dans le panneau d’étape', () => {
  it('rien de touché : aucun avis', async () => {
    await deplier();
    expect(avis()).toBeNull();
    expect(amenes).toEqual([]);
  });

  it('texte principal corrigé : « La version anglaise sera retirée. », dans la rangée du bouton « Enregistrer » ; le bloc déplié est amené dans la vue', async () => {
    await deplier();
    await saisir(principal(), 'Bonjour, à demain.');
    expect(avis()?.textContent).toBe('La version anglaise sera retirée. Voir');
    const rangee = Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Enregistrer')?.parentElement;
    expect(rangee?.contains(avis())).toBe(true);
    expect(amenes).toContain(bloc());
  });

  it('« Voir » mène au bloc ; « La garder telle quelle » fait disparaître l’avis', async () => {
    await deplier();
    await saisir(principal(), 'Bonjour, à demain.');
    amenes = [];
    await cliquer(Array.from(avis()?.querySelectorAll('button') ?? []).find((b) => b.textContent === 'Voir'));
    expect(amenes).toEqual([bloc()]);
    await cliquer(choix('La garder telle quelle'));
    expect(avis()).toBeNull();
  });

  it('bureau qui envoie en anglais : « La version française sera retirée. » ; interface anglaise : en anglais', async () => {
    await deplier({ langueBureau: 'en' });
    await saisir(principal(), 'Hi, see you tomorrow.');
    expect(avis()?.textContent).toBe('La version française sera retirée. Voir');
    await demonter();
    await deplier({ fr: false });
    await saisir(champs('Text sent to the client')[0] ?? document.body.querySelector('textarea'), 'Bonjour, à demain.');
    expect(avis()?.textContent).toBe('The English version will be removed. View');
  });
});
