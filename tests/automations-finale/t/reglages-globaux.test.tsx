// @vitest-environment jsdom
/**
 * RÉGLAGES GLOBAUX des automatisations — triage « modèles » du 2026-10-01,
 * fichier `06-reglages-globaux` (les deux lignes « cosmétique » des cartes).
 * La VRAIE page `AutomationsReglages` ; seuls la garde de permission, la
 * sous-navigation et la carte des adresses d'appel sont remplacées.
 */
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, afterEach } from 'vitest';

const interfaceLangue = vi.hoisted(() => ({ langue: 'fr' }));
vi.mock('../../../src/i18n', () => ({ useTranslation: () => ({ language: interfaceLangue.langue, t: {} }) }));
vi.mock('../../../src/components/PermissionGate', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('../../../src/components/automations/SousNavigation', () => ({ default: () => null }));
vi.mock('../../../src/components/automations/AdressesDAppel', () => ({ default: () => null }));
vi.mock('../../../src/lib/automationRulesApi', () => ({ getAutomationLanguage: async () => 'fr' }));

import { monter, demonter, jusqua, texteEcran } from './banc-composants';
import AutomationsReglages from '../../../src/pages/AutomationsReglages';

async function ouvrir(langue: 'fr' | 'en' = 'fr') {
  interfaceLangue.langue = langue;
  await monter(<MemoryRouter><AutomationsReglages /></MemoryRouter>);
  await jusqua(() => document.body.querySelectorAll('section').length >= 7);
}
/** Le texte d'une carte, par son titre. */
function carte(titre: string): string {
  const section = Array.from(document.body.querySelectorAll('section')).find((s) => s.querySelector('h2')?.textContent === titre);
  return section?.textContent ?? '';
}
afterEach(async () => { await demonter(); });

describe('06-reglages-globaux:72 — la carte « Mettre en pause » parle de « Tout arrêter »', () => {
  it('elle dit les DEUX façons de mettre en pause : tout d’un coup, ou une à une', async () => {
    await ouvrir();
    expect(carte('Mettre en pause')).toContain('« Tout arrêter », dans la liste, met en pause toutes les automatisations d’un coup');
    expect(carte('Mettre en pause')).toContain('chaque automatisation se met en pause individuellement');
  });

  it('en anglais, avec le nom anglais du bouton', async () => {
    await ouvrir('en');
    expect(carte('Pause workflows')).toContain('“Pause everything”, in the list, pauses all automations at once');
  });
});

describe('06-reglages-globaux:116 — la carte « Langue des messages » dit que la liste change le même réglage', () => {
  it('« définie une fois… dans Paramètres », et le sélecteur FR / EN de la liste est nommé', async () => {
    await ouvrir();
    expect(carte('Langue des messages')).toContain('définie une fois pour toute l’entreprise dans Paramètres');
    expect(carte('Langue des messages')).toContain('Le sélecteur « FR / EN » de la liste des automatisations change ce même réglage.');
    expect(texteEcran()).toContain('Français');
  });
});
