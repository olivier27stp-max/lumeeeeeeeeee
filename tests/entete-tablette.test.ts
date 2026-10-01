/**
 * La barre du haut tient sur un iPad en portrait.
 *
 * Mesuré sur lumecrm.net le 2026-10-01 (WebKit, 768 px, menu latéral ouvert) :
 * la barre faisait 551 px dans 536 px — l'avatar « Mon profil » dépassait de
 * l'écran sur TOUTES les pages. La recherche gardait sa largeur de bureau
 * (224 px) dès 768 px, et le sélecteur de bureau ne pouvait pas rétrécir.
 *
 * jsdom ne met rien en page : ce test fige les deux réglages qui décident de la
 * mise en page ; la preuve à l'écran est `outils/prod/p9-entete-tablette.mjs`
 * (mesure sur le vrai site).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const lire = (f: string) => readFileSync(join(process.cwd(), f), 'utf8');

describe('barre du haut sur tablette', () => {
  it('la recherche ne prend sa largeur de bureau (14 rem) qu’à partir de 1024 px', () => {
    const racine = /<div ref=\{rootRef\} className="([^"]+)"/.exec(lire('src/components/GlobalSearch.tsx'))?.[1] ?? '';
    const classes = racine.split(/\s+/);
    expect(classes).toContain('w-48');
    expect(classes).toContain('lg:w-56');
    expect(classes).not.toContain('md:w-56');
    // En saisie, elle s'élargit — mais pas au point de pousser l'avatar hors de l'écran à 768 px.
    expect(classes).toContain('lg:focus-within:w-[28rem]');
    expect(classes).not.toContain('md:focus-within:w-[28rem]');
  });

  it('le sélecteur de bureau peut rétrécir (son nom se tronque) au lieu de pousser le reste', () => {
    const source = lire('src/components/OfficeSwitcher.tsx');
    expect(source).toMatch(/<div className="relative min-w-0">/);
    // Le nom se tronque déjà : sans `min-w-0` sur le parent, il ne rétrécissait jamais.
    expect(source).toContain('min-w-0 truncate');
  });
});
