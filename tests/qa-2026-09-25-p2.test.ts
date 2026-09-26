/**
 * QA DU 2026-09-25 — le polish qui se voit.
 *
 * Trois défauts qui ne cassent rien mais qui font douter du reste :
 * du code brut affiché en français, un bouton grisé sans raison, et un
 * texte tronqué sans prévenir.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DECLENCHEURS } from '../src/lib/automationCatalogue';

const RACINE = resolve(__dirname, '..');
const lire = (p: string) => readFileSync(resolve(RACINE, p), 'utf8');

describe('P2-11 — aucun déclencheur ne s’affiche en code brut', () => {
  const liste = lire('src/pages/Automations.tsx');

  it('CHAQUE déclencheur du catalogue a son libellé', () => {
    /*
     * La liste affichait « deal.stage_entered » et
     * « custom_field.changed » au milieu de libellés français. Neuf
     * manquaient en réalité, pas deux — d'où ce test qui croise les
     * deux sources plutôt que d'en corriger quelques-uns à la main.
     */
    const bloc = liste.slice(liste.indexOf('TRIGGER_DISPLAY'), liste.indexOf('};', liste.indexOf('TRIGGER_DISPLAY')));
    const manquants = DECLENCHEURS.filter((d) => !bloc.includes(`'${d.cle}'`)).map((d) => d.cle);
    expect(manquants, 'ces déclencheurs s’afficheraient en clé brute').toEqual([]);
  });

  it('« 1 étape » ne prend pas de s', () => {
    expect(liste).toMatch(/\$\{rule\.steps\.length\} étape\$\{rule\.steps\.length > 1 \? 's' : ''\}/);
  });
});

describe('P2-12 — un bouton grisé doit dire POURQUOI', () => {
  const panneau = lire('src/components/automations/PanneauEtape.tsx');

  it('la raison est affichée à côté d’« Enregistrer »', () => {
    /*
     * Le bouton était désactivé sans un mot : au clic, rien ne se
     * passait, l'étape restait « à compléter ». Cas rencontré au QA :
     * un message de texto laissé vide.
     */
    expect(panneau).toMatch(/\{problemes\.length > 0 && \(/);
    expect(panneau).toMatch(/\{problemes\[0\]\}/);
  });
});

describe('P2-14 — `maxLength` tronque en silence', () => {
  const champ = lire('src/components/automations/ChampAction.tsx');

  it('un compteur montre où on en est', () => {
    /*
     * Le navigateur refuse la frappe une fois la limite atteinte, sans
     * rien dire : on colle 1800 caractères, il en reste 1600, et
     * personne ne voit ce qui a été coupé.
     */
    expect(champ).toMatch(/\{valeur\.length\} \/ \{champ\.max\}/);
  });

  it('il prévient AVANT la limite, pas seulement à 100 %', () => {
    // À 100 %, le mal est déjà fait.
    expect(champ).toMatch(/valeur\.length > champ\.max \* 0\.9/);
  });
});
