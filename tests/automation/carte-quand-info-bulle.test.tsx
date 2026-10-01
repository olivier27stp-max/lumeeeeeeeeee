// @vitest-environment jsdom
/**
 * La carte « Quand » : un libellé coupé se lit en entier au survol.
 *
 * Audit du 2026-10-01 (declencheurs-08, relevé sur capture) : « Opportunité
 * entre dans une étape » s'affichait « Opportunité entre dans … » sur la carte
 * de 260 px, sans info-bulle ; même coupe pour le résumé des réglages quand il
 * est long. Rien ne permettait de lire le nom complet sans ouvrir le panneau.
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, afterEach } from 'vitest';

import SequenceCanvas from '../../src/components/automations/SequenceCanvas';
import type { Etape } from '../../src/lib/sequenceTypes';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LIBELLE = 'Opportunité entre dans une étape';
const DETAIL = 'Pipeline de ventes · Soumission envoyée · Seulement si le client a l’étiquette : VIP · 2 filtres';
const ETAPES: Etape[] = [
  { id: 'e1', type: 'action', action: { type: 'send_sms', config: { body: 'Bonjour' } }, suivant: null },
];

let conteneur: HTMLDivElement;
let racine: Root | null = null;

async function monter(props: { cliquable: boolean; detail?: string | null }) {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  await act(async () => {
    racine!.render(
      <SequenceCanvas
        declencheurLabel={LIBELLE}
        declencheurDetail={props.detail === undefined ? DETAIL : props.detail}
        steps={ETAPES}
        fr
        onSelection={() => {}}
        onAjouter={() => {}}
        onDeclencheur={props.cliquable ? () => {} : undefined}
      />,
    );
  });
}
/** L'élément qui porte exactement ce texte. */
const porteur = (texte: string) => Array.from(conteneur.querySelectorAll('span')).find((s) => s.textContent === texte);

afterEach(async () => {
  if (racine) { await act(async () => racine!.unmount()); racine = null; }
  conteneur?.remove();
});

describe('declencheurs-08 — carte « Quand » : le texte coupé se lit en entier au survol', () => {
  it('carte cliquable (l’éditeur) : le libellé du déclencheur porte son texte complet en info-bulle', async () => {
    await monter({ cliquable: true });
    const libelle = porteur(LIBELLE);
    expect(libelle?.className).toContain('truncate');
    expect(libelle?.getAttribute('title')).toBe(LIBELLE);
  });

  it('… et le résumé des réglages aussi', async () => {
    await monter({ cliquable: true });
    const detail = porteur(DETAIL);
    expect(detail?.className).toContain('truncate');
    expect(detail?.getAttribute('title')).toBe(DETAIL);
  });

  it('carte non cliquable (aperçu en lecture seule) : pareil', async () => {
    await monter({ cliquable: false });
    expect(porteur(LIBELLE)?.getAttribute('title')).toBe(LIBELLE);
    expect(porteur(DETAIL)?.getAttribute('title')).toBe(DETAIL);
  });

  it('sans réglages, aucune info-bulle vide n’est posée', async () => {
    await monter({ cliquable: true, detail: null });
    expect(porteur(LIBELLE)?.getAttribute('title')).toBe(LIBELLE);
    expect(conteneur.querySelector('[title=""]')).toBeNull();
  });
});
