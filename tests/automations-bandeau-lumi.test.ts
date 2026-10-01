/**
 * Le bandeau du résumé de Lumi ne cache pas la carte du déclencheur.
 *
 * Constaté en prod le 2026-10-01 : la réponse de Lumi (plusieurs paragraphes
 * depuis qu'elle cite les nouveaux textes et les étapes retirées) était
 * affichée EN ENTIER, aplatie, dans un bandeau flottant en haut du canevas —
 * exactement par-dessus la carte « QUAND ». Elle était aussi déjà visible,
 * mise en forme, dans la conversation ouverte à gauche.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const page = readFileSync(resolve(__dirname, '..', 'src/pages/AutomationBuilderPage.tsx'), 'utf8');

describe('bandeau du résumé de Lumi sur le canevas', () => {
  it('absent quand la conversation est ouverte à gauche (la réponse y est déjà)', () => {
    expect(page).toMatch(/\{resumeLumi && !\(lumiLateral && !lumiReduit\) && \(/);
  });

  it('sinon, seulement la première phrase — jamais la réponse entière aplatie', () => {
    expect(page).toMatch(/\{resumeLumi\.split\('\\n\\n'\)\[0\]\}/);
    expect(page).not.toMatch(/<p className="text-\[12px\] text-text-primary">\{resumeLumi\}<\/p>/);
  });
});
