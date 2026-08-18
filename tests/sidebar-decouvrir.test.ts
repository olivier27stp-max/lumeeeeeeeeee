/**
 * Le bouton « Découvrir les fonctionnalités » a été retiré de la barre latérale.
 *
 * C'était un encart promotionnel affiché à TOUS les utilisateurs dont le
 * forfait n'avait pas déverrouillé les cinq options premium — donc, en
 * pratique, à la quasi-totalité des comptes, en permanence, dans leur outil de
 * travail quotidien.
 *
 * Ces tests empêchent qu'il revienne par inadvertance, et vérifient qu'aucun
 * fragment mort n'est resté derrière.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const app = readFileSync(resolve(__dirname, '..', 'src', 'App.tsx'), 'utf8');

describe('la barre latérale ne fait plus de promotion', () => {
  it('le bouton a disparu', () => {
    expect(app).not.toContain('Découvrir les fonctionnalités');
    expect(app).not.toContain('Discover features');
  });

  it('l’état et la modale ne sont plus montés', () => {
    // Un état conservé « au cas où » finit par être remis à l'écran par
    // quelqu'un qui le trouve inutilisé.
    expect(app).not.toContain('exploreFeaturesOpen');
    expect(app).not.toContain('<ExploreFeaturesModal');
  });

  it('les drapeaux qui ne servaient qu’à lui sont partis', () => {
    expect(app).not.toContain('DISCOVER_FEATURE_FLAGS');
    expect(app).not.toContain('allFeaturesUnlocked');
  });

  it('aucun import orphelin ne subsiste', () => {
    // `Sparkles` n'était importé que pour l'icône de ce bouton.
    expect(app).not.toContain("from './components/ExploreFeaturesModal'");
    expect(app).not.toMatch(/^\s*Sparkles,\s*$/m);
  });

  it('le reste de la barre latérale est intact', () => {
    // Garde-fou : le retrait devait enlever UN bouton, pas ébrécher le bloc
    // qui l'entourait.
    expect(app).toContain('<CompanySwitcher />');
    expect(app).toContain('setIsDark(!isDark)');
  });
});
