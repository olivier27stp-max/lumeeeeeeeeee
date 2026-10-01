// @vitest-environment jsdom
/**
 * Fenêtre de forfait (PlanUpgradeModal) — le bouton × parle la langue de
 * l'interface.
 *
 * Audit du 2026-10-01 (liste-17) : interface en français, le bouton de
 * fermeture avait pour nom accessible « Close ». Un lecteur d'écran annonçait
 * un mot anglais au milieu d'une fenêtre en français.
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, afterEach } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import PlanUpgradeModal from '../src/components/PlanUpgradeModal';
import { LanguageProvider } from '../src/i18n';

let conteneur: HTMLDivElement;
let racine: Root | null = null;

async function rendre(langue: 'fr' | 'en', onClose = () => {}) {
  localStorage.setItem('lume-language', langue);
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  await act(async () => {
    racine!.render(
      <MemoryRouter>
        <LanguageProvider>
          <PlanUpgradeModal open onClose={onClose} flag="includes_automations" requiredPlan={null} currentPlan={null} />
        </LanguageProvider>
      </MemoryRouter>,
    );
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
/** Le bouton × : le seul bouton de la fenêtre qui n'a pas de texte. */
const boutonFermer = () => Array.from(conteneur.querySelectorAll('button'))
  .find((b) => !(b.textContent || '').trim()) as HTMLButtonElement;

afterEach(async () => {
  if (racine) { await act(async () => racine!.unmount()); racine = null; }
  conteneur?.remove();
  localStorage.clear();
});

describe('liste-17 — le bouton × de la fenêtre de forfait', () => {
  it('en français, il s’appelle « Fermer »', async () => {
    await rendre('fr');
    expect(conteneur.textContent, 'la fenêtre est bien en français').toContain('Plus tard');
    expect(boutonFermer().getAttribute('aria-label')).toBe('Fermer');
  });

  it('en anglais, « Close »', async () => {
    await rendre('en');
    expect(conteneur.textContent).toContain('Maybe later');
    expect(boutonFermer().getAttribute('aria-label')).toBe('Close');
  });

  it('et il ferme toujours la fenêtre', async () => {
    const onClose = vi.fn();
    await rendre('fr', onClose);
    await act(async () => { boutonFermer().click(); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
