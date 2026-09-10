/**
 * L'ACCESSIBILITÉ NE PEUT QUE S'AMÉLIORER (cliquet).
 *
 * Audit bloc 3 (2026-09-10), C4/C5 — mesuré sur src/ : 432 <label> pour
 * 4 htmlFor, 526 <input> dont 3 avec id, 204 div/span cliquables, 94 boutons
 * icône sans nom accessible, 141 outline-none, 3 <img> sans alt. Un lecteur
 * d'écran annonçait « zone d'édition » sans dire quel champ ; cliquer une
 * étiquette ne plaçait pas le curseur ; les cartes cliquables étaient
 * inaccessibles au clavier (WCAG 2.1 AA — 1.3.1, 2.1.1, 2.4.7, 4.1.2).
 *
 * scripts/accessibilite-mesure.mjs compte ces motifs par heuristique. Ce test
 * fige des PLAFONDS : chaque compteur doit rester ≤ à sa valeur du jour où
 * le chantier a été livré. Si un plafond est dépassé, un nouveau composant a
 * réintroduit le motif ; si un compteur descend, on abaisse le plafond ici.
 */

import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { mesurer, mesurerSource } from '../scripts/accessibilite-mesure.mjs';

const RACINE = resolve(__dirname, '..');

// Plafonds livrés le 2026-09-10 (voir le rapport de la PR) — à abaisser, jamais à monter.
const PLAFONDS = {
  labelsSansHtmlFor: 0,
  champsSansNom: 0,
  divsCliquables: 0,
  boutonsIconeSansNom: 0,
  outlineNoneSansFocus: 0,
  imgSansAlt: 0,
};

describe('la mesure elle-même', () => {
  it('voit un label sans htmlFor et un champ sans nom', () => {
    const m = mesurerSource(`<label className="x">Courriel</label>\n<input type="email" value={v} />`);
    expect(m.labelsSansHtmlFor).toBe(1);
    expect(m.champsSansNom).toBe(1);
  });
  it('accepte label htmlFor + input id, label enveloppant, aria-label', () => {
    expect(mesurerSource(`<label htmlFor={id}>Courriel</label><input id={id} />`).labelsSansHtmlFor).toBe(0);
    expect(mesurerSource(`<label htmlFor={id}>Courriel</label><input id={id} />`).champsSansNom).toBe(0);
    expect(mesurerSource(`<label>Courriel <input type="email" /></label>`).labelsSansHtmlFor).toBe(0);
    expect(mesurerSource(`<input aria-label="Recherche" />`).champsSansNom).toBe(0);
    expect(mesurerSource(`<input type="hidden" name="x" />`).champsSansNom).toBe(0);
  });
  it('voit un div cliquable sans rôle, un bouton icône sans nom, outline-none sans focus, img sans alt', () => {
    const m = mesurerSource(`<div onClick={f}>x</div><button onClick={g}><Trash size={14} /></button><input className="outline-none" aria-label="a" /><img src="x" />`);
    expect(m).toMatchObject({ divsCliquables: 1, boutonsIconeSansNom: 1, outlineNoneSansFocus: 1, imgSansAlt: 1 });
  });
  it('accepte role+tabIndex, aria-label, focus-visible, alt', () => {
    const m = mesurerSource(`<div role="button" tabIndex={0} onClick={f}>x</div><button aria-label="Supprimer" onClick={g}><Trash size={14} /></button><input className="outline-none focus-visible:ring-2" id="a" /><img src="x" alt="" />`);
    expect(m).toEqual({ labelsSansHtmlFor: 0, champsSansNom: 0, divsCliquables: 0, boutonsIconeSansNom: 0, outlineNoneSansFocus: 0, imgSansAlt: 0 });
  });
});

describe('src/ ne régresse pas', () => {
  const { total, parFichier } = mesurer(RACINE);
  for (const [cle, plafond] of Object.entries(PLAFONDS)) {
    it(`${cle} ≤ ${plafond}`, () => {
      const fautifs = parFichier.filter((f) => (f as any)[cle] > 0).slice(0, 8).map((f) => `${f.fichier} (${(f as any)[cle]})`);
      expect((total as any)[cle], `dépassement — fichiers : ${fautifs.join(', ')}`).toBeLessThanOrEqual(plafond);
    });
  }
});
