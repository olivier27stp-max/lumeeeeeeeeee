// @vitest-environment jsdom
/**
 * Launch 2026-09-28 — bloc 5 : un brouillon d'étape non enregistré ne se
 * jette pas sans prévenir. Fermer le panneau ou « Annuler » perdait la
 * saisie en silence. Vrai composant rendu.
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const confirmation = vi.hoisted(() => ({ reponse: false, appels: 0 }));
vi.mock('../src/components/ui/ConfirmDialog', () => ({ confirmer: async () => { confirmation.appels++; return confirmation.reponse; } }));
vi.mock('../src/hooks/useModuleAccess', () => ({ useModuleAccess: () => ({ isEnabled: false, loading: false }) }));

import PanneauEtape from '../src/components/automations/PanneauEtape';

let hote: HTMLDivElement;
let racine: ReturnType<typeof createRoot>;
beforeEach(() => { hote = document.createElement('div'); document.body.appendChild(hote); racine = createRoot(hote); confirmation.appels = 0; });
afterEach(() => { act(() => racine.unmount()); hote.remove(); });

const ETAPE = { id: 'm1', type: 'action', action: { type: 'send_sms', config: { body: 'Bonjour' } } } as any;
function rendre(onFermer: () => void) {
  act(() => racine.render(<PanneauEtape etape={ETAPE} fr declencheur="quote.sent" membres={[]} etiquettes={[]} onEnregistrer={() => {}} onSupprimer={() => {}} onFermer={onFermer} />));
}
const bouton = (texte: string) => [...hote.querySelectorAll('button')].find((b) => b.textContent?.trim() === texte)!;
function taper(texte: string) {
  const zone = hote.querySelector('textarea') as HTMLTextAreaElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  act(() => { setter.call(zone, texte); zone.dispatchEvent(new Event('input', { bubbles: true })); });
}
const cliquer = async (b: Element) => { await act(async () => { (b as HTMLElement).click(); await new Promise((r) => setTimeout(r, 0)); }); };

describe('panneau d’étape — brouillon non enregistré', () => {
  it('intact : « Annuler » ferme directement, sans question', async () => {
    const onFermer = vi.fn();
    rendre(onFermer);
    await cliquer(bouton('Annuler'));
    expect(confirmation.appels).toBe(0);
    expect(onFermer).toHaveBeenCalledTimes(1);
  });

  it('modifié : « Annuler » demande ; refuser garde le panneau ouvert', async () => {
    const onFermer = vi.fn();
    rendre(onFermer);
    taper('Bonjour Marie, votre rendez-vous est demain');
    confirmation.reponse = false;
    await cliquer(bouton('Annuler'));
    expect(confirmation.appels).toBe(1);
    expect(onFermer).not.toHaveBeenCalled();
    confirmation.reponse = true;
    await cliquer(hote.querySelector('[aria-label="Fermer le panneau"]')!);
    expect(onFermer).toHaveBeenCalledTimes(1);
  });
});
