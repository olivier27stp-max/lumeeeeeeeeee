// @vitest-environment jsdom
/**
 * Le tiroir « Déclencheurs » / « Actions » au clavier.
 *
 * Audit du 2026-10-01 (observé à l'écran) :
 *   · declencheurs-04 — à l'ouverture, le champ « Rechercher… » n'avait pas le
 *     focus : 25 à 28 choix, et il fallait cliquer dans la recherche avant de
 *     taper ;
 *   · declencheurs-05 — Échap ne faisait rien : seule la croix fermait un
 *     tiroir ouvert par erreur.
 */
import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, vi, afterEach } from 'vitest';

import TiroirChoix, { type ChoixTiroir } from '../../src/components/automations/TiroirChoix';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FAMILLES = [{ cle: 'devis', fr: 'Devis', en: 'Quotes' }, { cle: 'facture', fr: 'Factures', en: 'Invoices' }];
const CHOIX: ChoixTiroir[] = [
  { cle: 'quote.sent', titre: 'Devis envoyé', aide: 'Quand un devis part chez le client.', famille: 'devis' },
  { cle: 'invoice.paid', titre: 'Facture payée', aide: 'Quand le paiement d’une facture est encaissé.', famille: 'facture' },
];

let conteneur: HTMLDivElement;
let racine: Root | null = null;
const ferme = vi.fn();
const choisi = vi.fn();

/** L'écran autour du tiroir : le bouton qui l'ouvre, et un champ qui n'est pas à lui. */
function Hote({ titre = 'Déclencheurs', fr = true }: { titre?: string; fr?: boolean }) {
  const [ouvert, setOuvert] = useState(false);
  return (
    <div>
      <input aria-label="Nom de l’automatisation" defaultValue="Relance" />
      <button type="button" onClick={() => setOuvert(true)}>Quand</button>
      {ouvert && (
        <TiroirChoix
          titre={titre} familles={FAMILLES} choix={CHOIX} fr={fr}
          onChoisir={(cle) => { choisi(cle); setOuvert(false); }}
          onFermer={() => { ferme(); setOuvert(false); }}
        />
      )}
    </div>
  );
}

async function monter(props: { titre?: string; fr?: boolean } = {}) {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  await act(async () => { racine!.render(<Hote {...props} />); });
}
const ouvreur = () => Array.from(conteneur.querySelectorAll('button')).find((b) => b.textContent === 'Quand') as HTMLButtonElement;
const tiroir = () => conteneur.querySelector('aside');
const recherche = () => conteneur.querySelector<HTMLInputElement>('aside input[type="search"]');
/** L'utilisateur clique le bouton : il prend le focus, puis le clic part. */
async function ouvrirTiroir() {
  await act(async () => { ouvreur().focus(); ouvreur().click(); });
}
async function touche(cible: Element, key: string) {
  await act(async () => { cible.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); });
}

afterEach(async () => {
  ferme.mockClear(); choisi.mockClear();
  if (racine) { await act(async () => racine!.unmount()); racine = null; }
  conteneur?.remove();
});

describe('declencheurs-04 — à l’ouverture du tiroir, le curseur est dans la recherche', () => {
  it('tiroir « Déclencheurs » : le champ « Rechercher… » a le focus', async () => {
    await monter({ titre: 'Déclencheurs' });
    await ouvrirTiroir();
    expect(recherche()).not.toBeNull();
    expect(recherche()?.getAttribute('aria-label')).toBe('Rechercher dans Déclencheurs');
    expect(document.activeElement).toBe(recherche());
  });

  it('tiroir « Actions » (anglais) : pareil', async () => {
    await monter({ titre: 'Actions', fr: false });
    await ouvrirTiroir();
    expect(recherche()?.getAttribute('aria-label')).toBe('Search Actions');
    expect(document.activeElement).toBe(recherche());
  });
});

describe('declencheurs-05 — Échap ferme le tiroir, et le focus revient à ce qui l’a ouvert', () => {
  it('Échap, le curseur dans la recherche : le tiroir se ferme', async () => {
    await monter();
    await ouvrirTiroir();
    await touche(recherche()!, 'Escape');
    expect(ferme).toHaveBeenCalledTimes(1);
    expect(tiroir()).toBeNull();
  });

  it('Échap, le focus sur un choix du tiroir : pareil', async () => {
    await monter();
    await ouvrirTiroir();
    const choix = Array.from(tiroir()!.querySelectorAll('button')).find((b) => b.textContent?.includes('Facture payée'))!;
    await act(async () => { choix.focus(); });
    await touche(choix, 'Escape');
    expect(ferme).toHaveBeenCalledTimes(1);
    expect(choisi).not.toHaveBeenCalled();
    expect(tiroir()).toBeNull();
  });

  it('Échap, le focus nulle part (on a cliqué le canevas) : le tiroir se ferme aussi', async () => {
    await monter();
    await ouvrirTiroir();
    await act(async () => { recherche()!.blur(); });
    await touche(document.body, 'Escape');
    expect(tiroir()).toBeNull();
  });

  it('après Échap, le focus est rendu au bouton qui avait ouvert le tiroir', async () => {
    await monter();
    await ouvrirTiroir();
    expect(document.activeElement).toBe(recherche());
    await touche(recherche()!, 'Escape');
    expect(document.activeElement).toBe(ouvreur());
  });

  it('la croix rend le focus de la même façon', async () => {
    await monter();
    await ouvrirTiroir();
    await act(async () => { tiroir()!.querySelector<HTMLButtonElement>('button[aria-label="Fermer"]')!.click(); });
    expect(tiroir()).toBeNull();
    expect(document.activeElement).toBe(ouvreur());
  });

  it('Échap tapé dans un champ HORS du tiroir (le nom de l’automatisation) ne ferme pas le tiroir', async () => {
    await monter();
    await ouvrirTiroir();
    const nom = conteneur.querySelector<HTMLInputElement>('input[aria-label="Nom de l’automatisation"]')!;
    await act(async () => { nom.focus(); });
    await touche(nom, 'Escape');
    expect(ferme).not.toHaveBeenCalled();
    expect(tiroir()).not.toBeNull();
  });

  it('une autre touche ne ferme rien', async () => {
    await monter();
    await ouvrirTiroir();
    await touche(recherche()!, 'Enter');
    await touche(recherche()!, 'a');
    expect(tiroir()).not.toBeNull();
  });

  it('le tiroir fermé n’écoute plus le clavier', async () => {
    await monter();
    await ouvrirTiroir();
    await touche(recherche()!, 'Escape');
    await touche(document.body, 'Escape');
    expect(ferme).toHaveBeenCalledTimes(1);
  });
});
