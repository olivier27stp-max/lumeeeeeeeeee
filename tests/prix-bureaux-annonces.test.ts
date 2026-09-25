/**
 * Ce que la page de prix annonce sur les bureaux doit rester vrai.
 *
 * Autopilot inclut 2 bureaux depuis le 2026-09-25 (#650). La grille de prix
 * l'annonce maintenant — et une promesse affichée qui ne correspond plus au
 * code est pire que pas de promesse du tout : le client la découvre en
 * cliquant « Créer le bureau ».
 *
 * Ces tests croisent la page avec BUREAUX_PAR_FORFAIT, la source de vérité.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BUREAUX_PAR_FORFAIT } from '../server/lib/platformFeatures';

const PAGE = readFileSync(resolve(__dirname, '..', 'src/pages/marketing/Pricing.tsx'), 'utf8');

describe('la grille annonce les bureaux', () => {
  it('Autopilot affiche « 2 bureaux inclus » dans ses points forts', () => {
    expect(PAGE).toContain("fr: '2 bureaux inclus'");
    expect(PAGE).toContain("en: '2 offices included'");
  });

  it('le tableau comparatif porte une ligne « Bureaux inclus »', () => {
    expect(PAGE).toContain("fr: 'Bureaux inclus'");
  });
});

describe('le chiffre affiché est celui du code', () => {
  /** Les trois cellules de la ligne « Bureaux inclus », dans l'ordre des forfaits. */
  function cellulesBureaux(): string[] {
    const i = PAGE.indexOf("en: 'Offices included'");
    expect(i, 'ligne « Offices included » introuvable').toBeGreaterThan(-1);
    const ligne = PAGE.slice(i, PAGE.indexOf('\n', i));
    return [...ligne.matchAll(/fr: '(\d+)'/g)].map((m) => m[1]);
  }

  it('la ligne porte bien trois cellules', () => {
    expect(cellulesBureaux()).toHaveLength(3);
  });

  it('Minimum, Scale et Autopilot affichent leur vrai quota', () => {
    // L'ordre des colonnes suit PLANS : starter, pro, autopilot.
    const [minimum, scale, autopilot] = cellulesBureaux();
    expect(minimum).toBe(String(BUREAUX_PAR_FORFAIT.starter));
    expect(scale).toBe(String(BUREAUX_PAR_FORFAIT.pro));
    expect(autopilot).toBe(String(BUREAUX_PAR_FORFAIT.autopilot));
  });

  it('le point fort d’Autopilot cite le même chiffre que la table', () => {
    // Deux endroits annoncent le nombre : ils doivent dire la même chose.
    expect(PAGE).toContain(`fr: '${BUREAUX_PAR_FORFAIT.autopilot} bureaux inclus'`);
  });
});

describe('on n’annonce pas ce qui ne se vend pas', () => {
  it('la page ne promet pas de bureaux supplémentaires à l’unité', () => {
    // Les bureaux ne se revendent pas : seule la plateforme en accorde plus.
    expect(PAGE).not.toMatch(/bureaux? suppl[ée]mentaires?|extra offices?|par bureau\/mois/i);
  });
});
