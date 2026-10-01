// @vitest-environment jsdom
/**
 * Un double clic sur « Tout arrêter » laisse la confirmation à l'écran.
 *
 * Audit du 2026-10-01 (liste-08) : le premier clic ouvre le dialogue, le
 * second — parti dans la foulée — tombe sur le FOND du dialogue, qui vaut
 * « Annuler ». À l'écran le dialogue clignote et « rien ne se passe », sur le
 * bouton qu'on clique en urgence.
 *
 * Le VRAI dialogue est monté (`ConfirmDialogHost`) : c'est son fond qui
 * reçoit le second clic. Seuls l'API de la pause et les toasts sont simulés.
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const api = vi.hoisted(() => ({
  lire: vi.fn(async (): Promise<{ paused: boolean; pausedAt: null }> => ({ paused: false, pausedAt: null })),
  basculer: vi.fn(async (v: boolean) => ({ paused: v, pausedAt: null })),
}));
vi.mock('../../src/lib/automationWebhooksApi', () => ({
  lireEtatPause: () => api.lire(),
  basculerPause: (v: boolean) => api.basculer(v),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import BandeauPause from '../../src/components/automations/BandeauPause';
import { ConfirmDialogHost } from '../../src/components/ui/ConfirmDialog';
import { LanguageProvider } from '../../src/i18n';

let conteneur: HTMLDivElement;
let racine: Root | null = null;
const laisser = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const attendre = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

async function rendre() {
  localStorage.setItem('lume-language', 'fr');
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  await act(async () => {
    racine!.render(<LanguageProvider><BandeauPause fr /><ConfirmDialogHost /></LanguageProvider>);
  });
  await laisser();
}
const dialogue = () => conteneur.querySelector('[role="dialog"]') as HTMLElement | null;
/** Le fond assombri : le parent du dialogue, qui annule au clic. */
const fond = () => dialogue()!.parentElement as HTMLElement;
const boutonDuBandeau = () => Array.from(conteneur.querySelectorAll('button'))
  .find((b) => !b.closest('[role="dialog"]') && (b.textContent || '').trim() === 'Tout arrêter') as HTMLButtonElement;
const boutonDuDialogue = (libelle: string) => Array.from(dialogue()!.querySelectorAll('button'))
  .find((b) => (b.textContent || '').trim() === libelle) as HTMLButtonElement;
async function cliquer(el: Element) {
  await act(async () => { (el as HTMLElement).click(); });
  await laisser();
}

beforeEach(() => {
  api.lire.mockClear(); api.basculer.mockClear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(async () => {
  // Une confirmation restée ouverte ne doit pas fuir dans le test suivant.
  if (dialogue()) await cliquer(boutonDuDialogue('Annuler'));
  if (racine) { await act(async () => racine!.unmount()); racine = null; }
  conteneur?.remove();
  vi.mocked(console.error).mockRestore?.();
});

describe('liste-08 — double clic sur « Tout arrêter »', () => {
  it('le second clic, tombé sur le fond du dialogue, ne l’annule pas : la confirmation reste à l’écran', async () => {
    await rendre();
    await cliquer(boutonDuBandeau());
    expect(dialogue(), 'le premier clic ouvre la confirmation').not.toBeNull();
    expect(dialogue()!.textContent).toContain('Arrêter toutes vos automatisations');

    await cliquer(fond());
    expect(dialogue(), 'le second clic du double clic a refermé la confirmation').not.toBeNull();
    expect(api.basculer).not.toHaveBeenCalled();

    // Et elle marche : confirmer arrête tout.
    await cliquer(boutonDuDialogue('Tout arrêter'));
    expect(dialogue()).toBeNull();
    expect(api.basculer).toHaveBeenCalledTimes(1);
    expect(api.basculer).toHaveBeenCalledWith(true);
  });

  it('« Annuler » répond tout de suite, même dans la foulée de l’ouverture', async () => {
    await rendre();
    await cliquer(boutonDuBandeau());
    await cliquer(boutonDuDialogue('Annuler'));
    expect(dialogue()).toBeNull();
    expect(api.basculer).not.toHaveBeenCalled();
  });

  it('passé le temps d’un double clic, cliquer sur le fond annule comme avant', async () => {
    await rendre();
    await cliquer(boutonDuBandeau());
    await attendre(650);
    await cliquer(fond());
    expect(dialogue()).toBeNull();
    expect(api.basculer).not.toHaveBeenCalled();
  });

  it('deux activations du bouton ne posent qu’UNE question (pas de second dialogue après la réponse)', async () => {
    await rendre();
    await cliquer(boutonDuBandeau());
    await cliquer(boutonDuBandeau());
    await cliquer(boutonDuDialogue('Annuler'));
    expect(dialogue(), 'une seconde confirmation attendait derrière la première').toBeNull();
    expect(api.basculer).not.toHaveBeenCalled();
  });

  it('après une annulation, le garde ne reste pas armé : un clic ailleurs dans la page passe', async () => {
    await rendre();
    await cliquer(boutonDuBandeau());
    await cliquer(boutonDuDialogue('Annuler'));
    const vus: Event[] = [];
    const ecoute = (e: Event) => vus.push(e);
    document.addEventListener('click', ecoute);
    await cliquer(conteneur);
    document.removeEventListener('click', ecoute);
    expect(vus).toHaveLength(1);
  });
});
