/**
 * LES COMMISSIONS — ce que touchent les vendeurs.
 *
 * `calculateCommissionAmount()` decide combien un vendeur gagne sur chaque
 * facture. Elle n avait aucun test, alors que c est une formule a plusieurs
 * etages : taux de base, taux par categorie de produit, paliers de
 * performance, primes conditionnelles.
 *
 * Chaque etage peut se tromper discretement. Un vendeur paye en moins ne
 * s en apercoit pas tout de suite ; paye en trop, l entreprise non plus.
 *
 * On teste ici la VRAIE fonction exportee (`server/lib/field-sales/
 * commission-engine.ts`), pas une reproduction : si la formule change, ces
 * tests le voient.
 *
 * L ORDRE DES ETAGES, tel qu il est code :
 *   1. base    — pourcentage OU montant fixe, avec surcharges par categorie
 *   2. paliers — bonus additionnels quand le vendeur depasse un seuil
 *   3. primes  — bonus conditionnels (ex. facture d au moins X)
 *   total = max(0, base + paliers + primes)
 */

import { describe, it, expect } from 'vitest';
import { calculateCommissionAmount, type CalcInput } from '../server/lib/field-sales/commission-engine';

// `CalcInput` exige `invoicePaidAt`, et `category` accepte `null` : la
// fabrique reprend le type reel plutot que de le paraphraser, sinon les
// tests passent sous vitest mais `tsc --noEmit` refuse le fichier.
const entree = (over: Partial<CalcInput> = {}): CalcInput => ({
  invoiceTotalCents: 100000,
  invoicePaidAt: '2026-09-02T12:00:00.000Z',
  lineItems: [],
  repPeriodRevenueCents: 0,
  repPeriodSaleCount: 0,
  ...over,
});

/* === LA BASE ==================================================== */

describe('la commission de base', () => {
  it('un pourcentage sur le total de la facture', () => {
    // 10 % de 1000,00 $ = 100,00 $
    const r = calculateCommissionAmount(
      { base_kind: 'percent', base_percent: 10 },
      entree(),
    );
    expect(r.amountCents).toBe(10000);
  });

  it('un montant fixe ignore le total de la facture', () => {
    const r = calculateCommissionAmount(
      { base_kind: 'flat', base_value_cents: 5000 },
      entree({ invoiceTotalCents: 999999 }),
    );
    expect(r.amountCents).toBe(5000);
  });

  it('sans taux configure, la commission est nulle', () => {
    const r = calculateCommissionAmount({ base_kind: 'percent' }, entree());
    expect(r.amountCents).toBe(0);
  });

  it('un pourcentage fractionnaire est arrondi au cent', () => {
    // 7,5 % de 333,33 $ = 24,99975 $ -> 25,00 $
    const r = calculateCommissionAmount(
      { base_kind: 'percent', base_percent: 7.5 },
      entree({ invoiceTotalCents: 33333 }),
    );
    expect(r.amountCents).toBe(2500);
  });

  it('une facture a zero ne genere aucune commission', () => {
    const r = calculateCommissionAmount(
      { base_kind: 'percent', base_percent: 10 },
      entree({ invoiceTotalCents: 0 }),
    );
    expect(r.amountCents).toBe(0);
  });

  it('la commission n est JAMAIS negative', () => {
    // `Math.max(0, amount)` : meme avec une regle incoherente, un vendeur
    // ne doit jamais DEVOIR de l argent a l entreprise.
    const r = calculateCommissionAmount(
      { base_kind: 'flat', base_value_cents: -50000 },
      entree(),
    );
    expect(r.amountCents).toBe(0);
  });
});

/* === LES LIGNES ET LES CATEGORIES =============================== */

describe('la commission ligne par ligne', () => {
  it('le pourcentage s applique a chaque ligne', () => {
    // 10 % sur 600 $ + 400 $ = 100,00 $
    const r = calculateCommissionAmount(
      { base_kind: 'percent', base_percent: 10 },
      entree({ lineItems: [{ total_cents: 60000 }, { total_cents: 40000 }] }),
    );
    expect(r.amountCents).toBe(10000);
  });

  it('une categorie surchargee utilise SON taux', () => {
    // toiture a 20 %, le reste a 10 %
    const r = calculateCommissionAmount(
      {
        base_kind: 'percent', base_percent: 10,
        product_overrides: [{ category: 'toiture', base_kind: 'percent', base_percent: 20, base_value_cents: null }],
      },
      entree({ lineItems: [
        { total_cents: 50000, category: 'toiture' },  // 20 % = 100,00 $
        { total_cents: 50000, category: 'lavage' },   // 10 % =  50,00 $
      ] }),
    );
    expect(r.amountCents).toBe(15000);
  });

  it('une surcharge a montant fixe donne ce montant pour la ligne', () => {
    const r = calculateCommissionAmount(
      {
        base_kind: 'percent', base_percent: 10,
        product_overrides: [{ category: 'pose', base_kind: 'flat', base_percent: null, base_value_cents: 7500 }],
      },
      entree({ lineItems: [{ total_cents: 100000, category: 'pose' }] }),
    );
    expect(r.amountCents).toBe(7500);
  });

  it('le detail indique quelles surcharges ont servi', () => {
    // Utile pour expliquer sa paie a un vendeur qui conteste.
    const r = calculateCommissionAmount(
      {
        base_kind: 'percent', base_percent: 10,
        product_overrides: [{ category: 'toiture', base_kind: 'percent', base_percent: 20, base_value_cents: null }],
      },
      entree({ lineItems: [{ total_cents: 50000, category: 'toiture' }] }),
    );
    expect(r.breakdown.product_overrides_applied).toHaveLength(1);
    expect(r.breakdown.product_overrides_applied[0].category).toBe('toiture');
  });

  it('une ligne sans categorie prend le taux de base', () => {
    const r = calculateCommissionAmount(
      {
        base_kind: 'percent', base_percent: 10,
        product_overrides: [{ category: 'toiture', base_kind: 'percent', base_percent: 20, base_value_cents: null }],
      },
      entree({ lineItems: [{ total_cents: 100000 }] }),
    );
    expect(r.amountCents).toBe(10000);
  });
});

/* === LES PALIERS DE PERFORMANCE ================================= */

describe('les paliers de performance', () => {
  it('sous le seuil, aucun bonus', () => {
    const r = calculateCommissionAmount(
      {
        base_kind: 'percent', base_percent: 10,
        performance_tiers: [{ metric: 'revenue_cents', threshold: 5000000, modifier_percent: 5, modifier_flat_cents: null }],
      },
      entree({ repPeriodRevenueCents: 100000 }),
    );
    expect(r.amountCents).toBe(10000);
    expect(r.breakdown.tier_bonuses_cents).toBe(0);
  });

  it('au-dessus du seuil, le bonus s ajoute', () => {
    // Le seuil compare le chiffre de la periode PLUS la facture en cours.
    const r = calculateCommissionAmount(
      {
        base_kind: 'percent', base_percent: 10,
        performance_tiers: [{ metric: 'revenue_cents', threshold: 500000, modifier_percent: 5, modifier_flat_cents: null }],
      },
      entree({ repPeriodRevenueCents: 500000 }),
    );
    expect(r.breakdown.tier_bonuses_cents).toBe(5000);
    expect(r.amountCents).toBe(15000);
  });

  it('un palier au nombre de ventes compte la vente en cours', () => {
    // `repPeriodSaleCount + 1` : la vente qu on est en train de calculer
    // compte dans le total, sinon le 10e palier ne tomberait qu au 11e.
    const r = calculateCommissionAmount(
      {
        base_kind: 'percent', base_percent: 10,
        performance_tiers: [{ metric: 'sale_count', threshold: 10, modifier_flat_cents: 2500, modifier_percent: null }],
      },
      entree({ repPeriodSaleCount: 9 }),
    );
    expect(r.breakdown.tier_bonuses_cents).toBe(2500);
  });

  it('plusieurs paliers atteints se cumulent', () => {
    const r = calculateCommissionAmount(
      {
        base_kind: 'percent', base_percent: 10,
        performance_tiers: [
          { metric: 'revenue_cents', threshold: 100000, modifier_flat_cents: 1000, modifier_percent: null },
          { metric: 'revenue_cents', threshold: 200000, modifier_flat_cents: 2000, modifier_percent: null },
        ],
      },
      entree({ repPeriodRevenueCents: 500000 }),
    );
    expect(r.breakdown.tier_bonuses_cents).toBe(3000);
  });
});

/* === LES PRIMES CONDITIONNELLES ================================= */

describe('les primes conditionnelles', () => {
  it('une facture assez grosse declenche la prime', () => {
    const r = calculateCommissionAmount(
      {
        base_kind: 'percent', base_percent: 10,
        bonuses: [{ condition: 'min_sale_amount', value: 50000, modifier_flat_cents: 5000, modifier_percent: null }],
      },
      entree({ invoiceTotalCents: 100000 }),
    );
    expect(r.breakdown.conditional_bonuses_cents).toBe(5000);
  });

  it('une facture trop petite ne la declenche pas', () => {
    const r = calculateCommissionAmount(
      {
        base_kind: 'percent', base_percent: 10,
        bonuses: [{ condition: 'min_sale_amount', value: 200000, modifier_flat_cents: 5000, modifier_percent: null }],
      },
      entree({ invoiceTotalCents: 100000 }),
    );
    expect(r.breakdown.conditional_bonuses_cents).toBe(0);
  });

  it('le seuil est inclusif : pile le montant declenche la prime', () => {
    // `total >= b.value` — une facture exactement au seuil compte.
    const r = calculateCommissionAmount(
      {
        base_kind: 'percent', base_percent: 10,
        bonuses: [{ condition: 'min_sale_amount', value: 100000, modifier_flat_cents: 5000, modifier_percent: null }],
      },
      entree({ invoiceTotalCents: 100000 }),
    );
    expect(r.breakdown.conditional_bonuses_cents).toBe(5000);
  });
});

/* === LE TOTAL, TOUS ETAGES ====================================== */

describe('une commission complete', () => {
  it('base + palier + prime tombent juste', () => {
    // base 10 % de 1000 $ = 100 $
    // palier +5 % de 1000 $ =  50 $
    // prime fixe            =  25 $
    // total                 = 175 $
    const r = calculateCommissionAmount(
      {
        base_kind: 'percent', base_percent: 10,
        performance_tiers: [{ metric: 'revenue_cents', threshold: 100000, modifier_percent: 5, modifier_flat_cents: null }],
        bonuses: [{ condition: 'min_sale_amount', value: 50000, modifier_flat_cents: 2500, modifier_percent: null }],
      },
      entree({ invoiceTotalCents: 100000, repPeriodRevenueCents: 0 }),
    );
    expect(r.breakdown.base_amount_cents).toBe(10000);
    expect(r.breakdown.tier_bonuses_cents).toBe(5000);
    expect(r.breakdown.conditional_bonuses_cents).toBe(2500);
    expect(r.amountCents).toBe(17500);
  });

  it('le detail permet d expliquer le calcul au vendeur', () => {
    const r = calculateCommissionAmount(
      { base_kind: 'percent', base_percent: 12 },
      entree(),
    );
    expect(r.breakdown.base_kind).toBe('percent');
    expect(r.breakdown.base_value).toBe(12);
    expect(r.breakdown.base_amount_cents).toBe(12000);
  });
});
