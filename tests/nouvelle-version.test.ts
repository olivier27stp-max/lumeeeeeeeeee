/**
 * Nouvelle version en ligne → navigation complète au clic suivant (plus de
 * fichier de page introuvable ni de « demi-seconde qui bogue » après un
 * déploiement, 2026-09-25).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { estAutreVersion } from '../src/lib/nouvelleVersion';

describe('estAutreVersion', () => {
  const html = (h: string) => `<html><script type="module" src="/assets/index-${h}.js"></script></html>`;
  it('même entrée : pas de nouvelle version', () => {
    expect(estAutreVersion('/assets/index-AAA.js', html('AAA'))).toBe(false);
  });
  it('entrée différente : nouvelle version', () => {
    expect(estAutreVersion('/assets/index-AAA.js', html('BBB'))).toBe(true);
  });
  it('rien à comparer (développement, page d’erreur) : jamais de rechargement', () => {
    expect(estAutreVersion(null, html('BBB'))).toBe(false);
    expect(estAutreVersion('/assets/index-AAA.js', '<html>panne</html>')).toBe(false);
  });
});

describe('câblage', () => {
  it('installé au démarrage de l’app', () => {
    expect(readFileSync(join(__dirname, '..', 'src/main.tsx'), 'utf8')).toContain('installerDetectionVersion();');
  });
});
