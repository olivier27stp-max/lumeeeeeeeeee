// @vitest-environment jsdom
/**
 * À REPORTER — `src/components/automations/SequenceCanvas.tsx`, hors de la
 * zone de l'agent T.
 *
 * 02-chaque-modele:131 [MOD-029][EDT-037][EDT-042] : « Utiliser ce modèle » sur
 * « Relance de devis — 1, 2, 5, 10 et 30 jours » ouvre un canevas de 180 cartes
 * pour un parcours de 23 étapes. Après chaque « Si le devis est parti par
 * texto », la suite est redessinée une fois sous « si oui » et une fois sous
 * « si non » : au 5e « Si », chaque relance figure 32 fois.
 *
 * Cause : `rendre` (SequenceCanvas.tsx, l. 282-327) déroule les deux branches
 * d'un « Si » jusqu'au bout, indépendamment. `vues` ne protège que d'une boucle
 * le long d'UN chemin : une étape où deux branches se REJOIGNENT est dessinée
 * une fois par chemin. Le correctif exact est dans
 * `D:/lume-final/notes/T-corrections.md` (bloc « À REPORTER — SequenceCanvas.tsx »).
 *
 * Ces tests sont ROUGES tant que le report n'est pas fait. Le VRAI composant,
 * avec le VRAI parcours du modèle fourni.
 */
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { monter, demonter } from './banc-composants';
import SequenceCanvas from '../../../src/components/automations/SequenceCanvas';
import { trouverModele } from '../../../server/lib/automationTemplates';
import type { Etape } from '../../../src/lib/sequenceTypes';

afterEach(async () => { await demonter(); });

async function dessiner(steps: Etape[]) {
  await monter(
    <SequenceCanvas declencheurLabel="Devis envoyé" steps={steps} fr onSelection={() => {}} onAjouter={() => {}} onMenu={() => {}} />,
  );
}
/** Les cartes d'étape : chacune porte son bouton « Options de l'étape … ». */
const cartes = () => Array.from(document.body.querySelectorAll('button[aria-label^="Options de l’étape "]'));

const action = (id: string, body: string, suivant: string | null): Etape => ({ id, type: 'action', action: { type: 'send_sms', config: { body } }, suivant });

describe('02-chaque-modele:131 — une carte par étape, même quand les deux branches d’un « Si » se rejoignent', () => {
  it('le plus petit cas : Si → (oui : A) / (non : B) → C. Quatre étapes, quatre cartes', async () => {
    const steps: Etape[] = [
      { id: 's', type: 'si', conditions: {}, alors: 'a', sinon: 'b' },
      action('a', 'Texto', 'c'),
      action('b', 'Courriel à la place', 'c'),
      action('c', 'La suite, commune aux deux', null),
    ];
    await dessiner(steps);
    expect(cartes()).toHaveLength(4);
    // La suite commune n'est écrite qu'une fois.
    expect((document.body.textContent ?? '').split('La suite, commune aux deux').length - 1).toBe(1);
  });

  it('« Relance de devis — 1, 2, 5, 10 et 30 jours » : autant de cartes que d’étapes (pas une par chemin)', async () => {
    const modele = trouverModele('pack_relance_devis');
    expect(modele, 'le modèle fourni « pack_relance_devis » a disparu : prendre un autre parcours à branches qui se rejoignent').toBeDefined();
    const steps = (modele?.steps ?? []) as Etape[];
    expect(steps.filter((e) => e.type === 'si').length).toBeGreaterThanOrEqual(2);
    await dessiner(steps);
    expect(cartes()).toHaveLength(steps.length);
  });

  it('des branches qui ne se rejoignent PAS restent dessinées côte à côte, chacune jusqu’à sa fin', async () => {
    const steps: Etape[] = [
      { id: 's', type: 'si', conditions: {}, alors: 'a', sinon: 'b' },
      action('a', 'Branche oui', null),
      action('b', 'Branche non', null),
    ];
    await dessiner(steps);
    expect(cartes()).toHaveLength(3);
    expect(document.body.textContent).toContain('si oui');
    expect(document.body.textContent).toContain('si non');
  });
});
