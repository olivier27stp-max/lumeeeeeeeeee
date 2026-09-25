// @vitest-environment jsdom
//
// « Dernière visite complétée » — la suite normale, c'est de facturer.
//
// Le dialogue proposait fermer, replanifier ou laisser en « Action requise ».
// Le travail était fini et il fallait sortir, retrouver la job et créer la
// facture à la main. Signalé le 2026-09-25.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import FinalVisitDialog from '../src/components/schedule/FinalVisitDialog';

let conteneur: HTMLDivElement;
beforeEach(() => { conteneur = document.createElement('div'); document.body.appendChild(conteneur); });
afterEach(() => conteneur.remove());

async function rendre(props: Record<string, unknown>) {
  const racine = createRoot(conteneur);
  await act(async () => {
    racine.render(React.createElement(FinalVisitDialog, {
      open: true, fr: true, onCloseJob: () => {}, onScheduleNewVisit: () => {}, onLeave: () => {}, ...props,
    } as any));
  });
  return racine;
}

describe('le dialogue de dernière visite', () => {
  it('propose de facturer quand la job est facturable', async () => {
    const racine = await rendre({ onInvoice: () => {} });
    expect(conteneur.textContent).toContain('Facturer la job');
    await act(async () => racine.unmount());
  });

  it('ne propose rien à facturer sans action de facturation', async () => {
    // Une job « sans facturation » n'a pas de facture à produire : l'appelant
    // ne passe pas `onInvoice`, et le bouton disparaît.
    const racine = await rendre({});
    expect(conteneur.textContent).not.toContain('Facturer');
    await act(async () => racine.unmount());
  });

  it('facturer est le PREMIER choix', async () => {
    // C'est la suite attendue du travail terminé : elle doit venir avant
    // « fermer » et « replanifier ».
    const racine = await rendre({ onInvoice: () => {} });
    const boutons = [...conteneur.querySelectorAll('button')].map((b) => b.textContent || '');
    expect(boutons[0]).toContain('Facturer');
    await act(async () => racine.unmount());
  });

  it('garde les trois issues d’origine', async () => {
    const racine = await rendre({ onInvoice: () => {} });
    const t = conteneur.textContent || '';
    expect(t).toContain('Fermer la job');
    expect(t).toContain('Planifier une nouvelle visite');
    expect(t).toContain('Action requise');
    await act(async () => racine.unmount());
  });

  it('dit « la job », pas « le job »', async () => {
    const racine = await rendre({ onInvoice: () => {} });
    expect(conteneur.textContent).not.toContain('le job');
    await act(async () => racine.unmount());
  });
});
