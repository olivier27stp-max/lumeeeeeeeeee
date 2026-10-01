/**
 * Audit commissions — fonctions pures (aucune base). Tourne en CI.
 */
import { describe, expect, it } from 'vitest';
import {
  repartirParts, totauxCommissions, bornesPeriode, debutDuMoisLocal, baseAvantTaxesCents, enCents, estEstimation,
} from '../../server/lib/field-sales/commission-periode';
import { calculateCommissionAmount } from '../../server/lib/field-sales/commission-engine';

const TZ = 'America/Toronto';

describe('repartirParts — split', () => {
  it('50/50 sur un montant impair : Σ parts = total (l’ancien arrondi par part versait 1 ¢ de trop)', () => {
    const anciennes = [50, 50].map((pct) => Math.round(5 * (pct / 100)));
    expect(anciennes.reduce((a, b) => a + b, 0)).toBe(6); // le défaut d'origine, prouvé
    const parts = repartirParts(5, [{ pct: 50 }, { pct: 50 }]);
    expect(parts.map((p) => p.part_cents)).toEqual([3, 2]);
  });

  it('tiers : 100 ¢ → 34/33/33, jamais 99 ni 101', () => {
    expect(repartirParts(100, [{ pct: 33.33 }, { pct: 33.33 }, { pct: 33.34 }]).reduce((s, p) => s + p.part_cents, 0)).toBe(100);
  });

  it('propriété : pour tout total et tout jeu de %, Σ parts = total et chaque part ≥ 0', () => {
    let graine = 42;
    const alea = () => { graine = (graine * 1103515245 + 12345) % 2 ** 31; return graine / 2 ** 31; };
    for (let i = 0; i < 2000; i++) {
      const total = Math.floor(alea() * 1_000_000);
      const n = 1 + Math.floor(alea() * 5);
      const benef = Array.from({ length: n }, () => ({ pct: Math.round(alea() * 10000) / 100 + 0.01 }));
      const parts = repartirParts(total, benef);
      expect(parts.reduce((s, p) => s + p.part_cents, 0)).toBe(total);
      expect(parts.every((p) => p.part_cents >= 0)).toBe(true);
    }
  });

  it('somme des % < 100 : normalisée (comportement historique, décision D7)', () => {
    expect(repartirParts(1000, [{ pct: 30 }, { pct: 30 }]).map((p) => p.part_cents)).toEqual([500, 500]);
  });
});

describe('base avant taxes', () => {
  it('sous-total − rabais, jamais les taxes', () => {
    expect(baseAvantTaxesCents({ subtotal_cents: 100000, discount_cents: 10000, tax_cents: 13478, total_cents: 103478 })).toBe(90000);
  });
  it('rabais plafonné au sous-total', () => {
    expect(baseAvantTaxesCents({ subtotal_cents: 5000, discount_cents: 9000 })).toBe(0);
  });
  it('ligne héritée sans sous-total : total − taxes', () => {
    expect(baseAvantTaxesCents({ subtotal_cents: null, total_cents: 114975, tax_cents: 14975 })).toBe(100000);
  });
});

describe('bornes de période dans le fuseau de l’entreprise', () => {
  it('août à Toronto = [1er août 04:00Z, 1er sept 04:00Z)', () => {
    expect(bornesPeriode('2026-08-01', '2026-08-31', TZ)).toEqual({ debut: '2026-08-01T04:00:00.000Z', finExclusive: '2026-09-01T04:00:00.000Z' });
  });
  it('31 août 23 h 30 Toronto (03:30Z le 1er sept) est en août', () => {
    const { debut, finExclusive } = bornesPeriode('2026-08-01', '2026-08-31', TZ);
    const t = '2026-09-01T03:30:00.000Z';
    expect(t >= debut && t < finExclusive).toBe(true);
  });
  it('31 déc. / 1er janv. (heure normale, UTC−5)', () => {
    expect(bornesPeriode('2025-12-01', '2025-12-31', TZ).finExclusive).toBe('2026-01-01T05:00:00.000Z');
  });
  it('changement d’heure : novembre commence à 04:00Z, finit à 05:00Z', () => {
    expect(bornesPeriode('2026-11-01', '2026-11-30', TZ)).toEqual({ debut: '2026-11-01T04:00:00.000Z', finExclusive: '2026-12-01T05:00:00.000Z' });
  });
  it('mars (passage à l’heure avancée le 8)', () => {
    expect(bornesPeriode('2026-03-01', '2026-03-31', TZ)).toEqual({ debut: '2026-03-01T05:00:00.000Z', finExclusive: '2026-04-01T04:00:00.000Z' });
  });
  it('mois des paliers : 30 sept. 23 h 30 Toronto appartient à septembre', () => {
    expect(debutDuMoisLocal('2026-10-01T03:30:00.000Z', TZ)).toBe('2026-09-01T04:00:00.000Z');
  });
});

describe('totaux', () => {
  const e = (status: string, amount: number, invoice_id: string | null = 'f1') => ({ status, amount, invoice_id });
  it('dû = en attente + approuvé + versé ; ni reprises ni estimations ; en cents exacts', () => {
    const t = totauxCommissions([e('pending', 0.1), e('approved', 0.2, 'f2'), e('paid', 0.3, 'f3'), e('reversed', 99), e('pending', 50, null)]);
    expect(t).toEqual({ du_cents: 60, en_attente_cents: 10, approuve_cents: 20, verse_cents: 30, repris_cents: 9900, estime_cents: 5000, ventes: 3 });
  });
  it('un split (2 lignes, même facture) = UNE vente', () => {
    expect(totauxCommissions([e('approved', 40.03, 'f1'), e('approved', 40.02, 'f1')]).ventes).toBe(1);
  });
  it('0,1 + 0,2 $ = 30 ¢ exactement', () => { expect(enCents(0.1) + enCents(0.2)).toBe(30); });
  it('estimation = pending sans facture', () => {
    expect(estEstimation({ status: 'pending', invoice_id: null })).toBe(true);
    expect(estEstimation({ status: 'pending', invoice_id: 'f' })).toBe(false);
  });
});

describe('calculateCommissionAmount — règles d’avant les colonnes du moteur', () => {
  const entree = { invoiceTotalCents: 100000, invoicePaidAt: '', lineItems: [], repPeriodRevenueCents: 0, repPeriodSaleCount: 0 };
  it('« [DEMO] Commission 10% » (percentage = 10, base_* vides) paie 10 %, pas 0 $', () => {
    expect(calculateCommissionAmount({ type: 'percentage', percentage: 10, base_kind: null, base_percent: null, base_value_cents: null }, entree).amountCents).toBe(10000);
  });
  it('règle historique à montant fixe (flat_amount en dollars)', () => {
    expect(calculateCommissionAmount({ type: 'flat', flat_amount: 150, base_kind: null, base_percent: null, base_value_cents: null }, entree).amountCents).toBe(15000);
  });
  it('les colonnes du moteur gardent la priorité', () => {
    expect(calculateCommissionAmount({ type: 'percentage', percentage: 10, base_kind: 'percent', base_percent: 8 }, entree).amountCents).toBe(8000);
  });
});

describe('calculateCommissionAmount — paliers en cents', () => {
  const regle = { base_kind: 'percent', base_percent: 5, performance_tiers: [{ metric: 'revenue_cents', threshold: 250000, modifier_percent: 2, modifier_flat_cents: null }] };
  it('cumul 2 300 $ + 300 $ ≥ 2 500 $ → 7 %', () => {
    const r = calculateCommissionAmount(regle, { invoiceTotalCents: 30000, invoicePaidAt: '', lineItems: [], repPeriodRevenueCents: 230000, repPeriodSaleCount: 2 });
    expect(r.amountCents).toBe(2100);
  });
  it('cumul 1 500 $ + 800 $ < 2 500 $ → 5 %', () => {
    const r = calculateCommissionAmount(regle, { invoiceTotalCents: 80000, invoicePaidAt: '', lineItems: [], repPeriodRevenueCents: 150000, repPeriodSaleCount: 1 });
    expect(r.amountCents).toBe(4000);
  });
});
