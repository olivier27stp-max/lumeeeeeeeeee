// @vitest-environment jsdom
/**
 * L'éditeur de courriel d'une automatisation ne crie pas « Cette variable
 * n'existe pas » sur une variable que le serveur remplit.
 *
 * Vu sur lumecrm.net le 2026-10-01, en ouvrant le courriel de l'automatisation
 * FOURNIE « Confirmation de rendez-vous » : bandeau « Cette variable n'existe
 * pas : [appointment_address] — votre client verra un blanc ». C'est faux : le
 * moteur la remplit (`resolveEntityVariables`). L'éditeur ne connaissait que
 * les huit raccourcis de sa palette, et prenait toute autre variable réelle
 * pour une faute. Même erreur pour {{soumission.total}} et les autres
 * variables pointées que le serveur remplit lui-même.
 *
 * Un avertissement qui a tort apprend à l'ignorer le jour où il a raison.
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../src/components/ui/ConfirmDialog', () => ({ confirmer: vi.fn(async () => true), default: () => null }));
vi.mock('../../src/hooks/useChampsPersoActifs', () => ({ useChampsPersoActifs: () => ({ isEnabled: false, loading: false }) }));
vi.mock('../../src/lib/champsPersoApi', () => ({ listerChamps: async () => ({ fields: [] }) }));
vi.mock('../../src/lib/automationRulesApi', () => ({
  updateRuleMessage: vi.fn(async () => {}),
  getCompanyBranding: async () => ({ company_name: 'Nettoyage Test' }),
}));
vi.mock('../../src/lib/emailTemplatesApi', () => ({
  apercuCourriel: async () => '<p>aperçu</p>',
  envoyerEssaiCourriel: async () => 'proprio@lume-qa.test',
}));
vi.mock('sonner', () => ({ toast: { success: () => {}, error: () => {} } }));

import EmailPreviewEditor from '../../src/components/automations/EmailPreviewEditor';
import { VARIABLES_CONNUES, VARIABLES_POINTEES_CONNUES } from '../../src/lib/emailBodyText';

let conteneur: HTMLDivElement;
let racine: Root | null = null;

async function monter(corps: string, props: { typeCourriel?: string; subject?: string } = {}): Promise<string> {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    racine!.render(
      <QueryClientProvider client={qc}>
        <EmailPreviewEditor
          ruleId="r1" ruleName="Confirmation de rendez-vous" subject={props.subject ?? 'Votre rendez-vous'} fr
          body={corps} onClose={() => {}} onSaved={() => {}} declencheur="appointment.created" typeCourriel={props.typeCourriel}
        />
      </QueryClientProvider>,
    );
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return document.body.textContent ?? '';
}
afterEach(async () => {
  if (racine) { await act(async () => racine!.unmount()); racine = null; }
  conteneur?.remove();
});

const ALERTE = 'Cette variable n’existe pas';
const ALERTES = /Cette variable n’existe pas|Ces variables n’existent pas/;

describe('courriel d’AUTOMATISATION : une variable que le moteur remplit n’est pas une faute', () => {
  it('le texte fourni « Confirmation de rendez-vous » ne déclenche aucun avertissement', async () => {
    const ecran = await monter(
      '<h2>Bonjour [client_first_name],</h2><p>Votre rendez-vous est confirmé :</p><ul><li>Date : [appointment_date]</li><li>Heure : [appointment_time]</li><li>Adresse : [appointment_address]</li></ul><p>À bientôt!</p><p>[company_name]</p><p>[contract_html]</p>',
    );
    expect(ecran).not.toMatch(ALERTES);
  });

  it('aucune des variables que le serveur remplit n’est signalée', async () => {
    const corps = `<p>${VARIABLES_CONNUES.map((v) => `[${v}]`).join(' ')}</p>`;
    expect(await monter(corps)).not.toMatch(ALERTES);
  });

  it('aucune des variables pointées que le serveur remplit ({{soumission.total}}…) n’est signalée', async () => {
    const corps = `<p>${VARIABLES_POINTEES_CONNUES.map((v) => `{{${v}}}`).join(' ')}</p>`;
    expect(await monter(corps)).not.toMatch(ALERTES);
  });

  it('une vraie faute de frappe reste signalée', async () => {
    const ecran = await monter('<p>Adresse : [appointment_adress]</p>');
    expect(ecran).toContain(ALERTE);
    expect(ecran).toContain('[appointment_adress]');
  });

  it('une variable pointée inconnue reste signalée', async () => {
    const ecran = await monter('<p>Total : {{soumission.totl}}</p>');
    expect(ecran).toContain(ALERTE);
    expect(ecran).toContain('{{soumission.totl}}');
  });
});

describe('MODÈLE de courriel (poste précis) : inchangé', () => {
  it('une variable d’un autre poste reste signalée — le serveur ne la remplit pas là', async () => {
    const ecran = await monter('<p>Soumission {quote_number}</p>', { typeCourriel: 'invoice_sent' });
    expect(ecran).toContain(ALERTE);
  });
});
