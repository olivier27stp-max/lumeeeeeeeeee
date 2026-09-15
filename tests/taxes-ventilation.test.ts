// Ventilation des taxes affichée sur devis et factures : TPS + TVQ = total,
// taxe composée sur base + taxes précédentes, repli jamais inventé.

import { describe, it, expect } from 'vitest';
import { computeTaxLines, splitTaxTotal } from '../server/lib/taxResolve';

const TPS = { name: 'TPS', rate: 5, is_compound: false, id: 'tps' };
const TVQ = { name: 'TVQ', rate: 9.975, is_compound: false, id: 'tvq' };

describe('computeTaxLines', () => {
  it('TPS + TVQ sur 100 $ : 5,00 $ + 9,98 $', () => {
    const lines = computeTaxLines(10000, [TPS, TVQ]);
    expect(lines.map((l) => [l.name, l.amount_cents])).toEqual([['TPS', 500], ['TVQ', 998]]);
    expect(lines[0].tax_config_id).toBe('tps');
  });

  it('taxe composée : s\'applique sur base + taxes précédentes', () => {
    const lines = computeTaxLines(10000, [TPS, { ...TVQ, is_compound: true }]);
    expect(lines[1].amount_cents).toBe(Math.round(10500 * 9.975 / 100));
  });

  it('base nulle ou taxes inactives : aucune ligne', () => {
    expect(computeTaxLines(0, [TPS])).toEqual([]);
    expect(computeTaxLines(10000, [{ ...TPS, is_active: false }])).toEqual([]);
  });
});

describe('splitTaxTotal (documents sans applied_taxes)', () => {
  it('retrouve la ventilation quand les taxes expliquent le total', () => {
    const lines = splitTaxTotal(1498, 10000, [TPS, TVQ]);
    expect(lines.map((l) => l.amount_cents)).toEqual([500, 998]);
  });

  it('absorbe l\'écart d\'arrondi (1 cent par taxe) sur la dernière ligne', () => {
    const lines = splitTaxTotal(1497, 10000, [TPS, TVQ]);
    expect(lines.reduce((s, l) => s + l.amount_cents, 0)).toBe(1497);
  });

  it('total manuel qui ne colle pas : [] — jamais une ventilation inventée', () => {
    expect(splitTaxTotal(2000, 10000, [TPS, TVQ])).toEqual([]);
    expect(splitTaxTotal(0, 10000, [TPS, TVQ])).toEqual([]);
  });
});
