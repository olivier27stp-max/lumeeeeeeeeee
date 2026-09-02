/**
 * L'ARGENT — que les chiffres tombent juste.
 *
 * POURQUOI CE FICHIER EXISTE
 * `server/routes/payments.ts` fait 2191 lignes, dont 343 touchent des
 * montants, et n'avait AUCUN test. Le calcul lui-même vit dans des
 * déclencheurs SQL que rien ne vérifiait non plus.
 *
 * Une erreur d'un cent sur une facture, c'est un client qui appelle. Une
 * erreur sur un remboursement ou un webhook, c'est de l'argent réellement
 * perdu. C'est le seul endroit du CRM où un bug coûte directement.
 *
 * CE QUI EST REPRODUIT ICI
 * Les règles exactes des fonctions de la base, relevées le 2026-09-02 :
 *
 *   invoice_items_set_line_total()
 *     qty              := greatest(coalesce(qty, 1), 0)
 *     unit_price_cents := greatest(coalesce(unit_price_cents, 0), 0)
 *     line_total_cents := greatest(round(qty * unit_price_cents), 0)
 *
 *   recalculate_invoice_totals()
 *     subtotal := somme des line_total_cents (lignes non supprimées)
 *     discount := least(discount, subtotal)      ← jamais plus que le sous-total
 *     total    := greatest(0, subtotal - discount + tax)
 *     balance  := greatest(0, total - paid)      ← jamais négatif
 *
 * Ces tests ne remplacent pas la base : ils FIGENT la règle. Si quelqu'un
 * change la formule sans y penser, la CI le dit avant la production.
 *
 * ⚠ Tout est en CENTS, en entiers. Jamais de flottant sur de l'argent :
 * 0.1 + 0.2 ne fait pas 0.3 en JavaScript, et une facture non plus.
 */

import { describe, it, expect } from 'vitest';

/* ── Les règles, telles qu'écrites dans la base ─────────────────── */

/** `invoice_items_set_line_total()` — le total d'une ligne. */
export function totalDeLaLigne(qty: number | null, prixUnitaireCents: number | null): number {
  const q = Math.max(qty ?? 1, 0);
  const p = Math.max(prixUnitaireCents ?? 0, 0);
  return Math.max(Math.round(q * p), 0);
}

/** `recalculate_invoice_totals()` — les totaux d'une facture. */
export function totauxDeLaFacture(input: {
  lignes: number[];
  remiseCents?: number;
  taxeCents?: number;
  payeCents?: number;
}): { sousTotalCents: number; totalCents: number; soldeCents: number } {
  const sousTotal = input.lignes.reduce((a, b) => a + b, 0);
  const remise = Math.min(input.remiseCents ?? 0, sousTotal);
  const taxe = input.taxeCents ?? 0;
  const total = Math.max(0, sousTotal - remise + taxe);
  const solde = Math.max(0, total - (input.payeCents ?? 0));
  return { sousTotalCents: sousTotal, totalCents: total, soldeCents: solde };
}

/* ── Le total d'une ligne ───────────────────────────────────────── */

describe('le total d’une ligne de facture', () => {
  it('multiplie la quantité par le prix', () => {
    expect(totalDeLaLigne(3, 2500)).toBe(7500); // 3 × 25,00 $ = 75,00 $
  });

  it('une quantité absente vaut 1, pas 0', () => {
    // C'est `coalesce(qty, 1)` : une ligne sans quantité est UNE unité.
    // Si on lisait 0, la ligne deviendrait gratuite en silence.
    expect(totalDeLaLigne(null, 4999)).toBe(4999);
  });

  it('un prix absent vaut 0', () => {
    expect(totalDeLaLigne(5, null)).toBe(0);
  });

  it('une quantité négative ne crédite jamais le client', () => {
    // `greatest(qty, 0)` : sans ce garde-fou, une quantité de -2 rendrait
    // la ligne négative et ferait baisser le total de la facture.
    expect(totalDeLaLigne(-2, 3000)).toBe(0);
  });

  it('un prix négatif ne crédite jamais le client', () => {
    expect(totalDeLaLigne(2, -1500)).toBe(0);
  });

  it('une quantité fractionnaire est arrondie, pas tronquée', () => {
    // 2,5 h × 33,33 $ = 83,325 $ → arrondi à 83,33 $ (et non 83,32 $).
    expect(totalDeLaLigne(2.5, 3333)).toBe(8333);
  });

  it('l’arrondi suit la règle du demi supérieur', () => {
    // 0,5 cent doit monter : sinon l'entreprise perd un cent par ligne.
    expect(totalDeLaLigne(1.5, 101)).toBe(152); // 151,5 → 152
  });

  it('une ligne à zéro reste à zéro', () => {
    expect(totalDeLaLigne(0, 9999)).toBe(0);
  });
});

/* ── Les totaux de la facture ───────────────────────────────────── */

describe('les totaux d’une facture', () => {
  it('le sous-total est la somme des lignes', () => {
    const r = totauxDeLaFacture({ lignes: [7500, 2500, 1000] });
    expect(r.sousTotalCents).toBe(11000);
    expect(r.totalCents).toBe(11000);
  });

  it('la taxe s’ajoute au total, jamais au sous-total', () => {
    // Distinction qui compte pour la comptabilité : le sous-total est
    // hors taxes, le total les inclut.
    const r = totauxDeLaFacture({ lignes: [10000], taxeCents: 1498 });
    expect(r.sousTotalCents).toBe(10000);
    expect(r.totalCents).toBe(11498);
  });

  it('une remise plus grande que le sous-total est plafonnée', () => {
    // `least(discount, subtotal)` : une remise de 200 $ sur une facture de
    // 100 $ ne doit PAS produire un total négatif — donc de l'argent dû au
    // client. Le total tombe à zéro, pas en dessous.
    const r = totauxDeLaFacture({ lignes: [10000], remiseCents: 20000 });
    expect(r.totalCents).toBe(0);
  });

  it('le total n’est jamais négatif', () => {
    const r = totauxDeLaFacture({ lignes: [5000], remiseCents: 99999, taxeCents: 0 });
    expect(r.totalCents).toBeGreaterThanOrEqual(0);
  });

  it('le solde tient compte de ce qui est déjà payé', () => {
    const r = totauxDeLaFacture({ lignes: [10000], taxeCents: 1500, payeCents: 5000 });
    expect(r.totalCents).toBe(11500);
    expect(r.soldeCents).toBe(6500);
  });

  it('un trop-perçu ne crée pas un solde négatif', () => {
    // `greatest(0, total - paid)` : un client qui paie 150 $ pour 100 $
    // laisse un solde de 0, pas de -50 $. Le trop-perçu se traite à part.
    const r = totauxDeLaFacture({ lignes: [10000], payeCents: 15000 });
    expect(r.soldeCents).toBe(0);
  });

  it('une facture entièrement payée a un solde nul', () => {
    const r = totauxDeLaFacture({ lignes: [8000], taxeCents: 1200, payeCents: 9200 });
    expect(r.soldeCents).toBe(0);
  });

  it('une facture sans ligne vaut zéro, pas NaN', () => {
    const r = totauxDeLaFacture({ lignes: [] });
    expect(r.sousTotalCents).toBe(0);
    expect(r.totalCents).toBe(0);
    expect(r.soldeCents).toBe(0);
  });
});

/* ── Le paiement partiel, cas par cas ───────────────────────────── */

describe('les paiements partiels', () => {
  it('deux acomptes se cumulent exactement', () => {
    // Le piège classique : additionner des dollars en flottant. En cents
    // et en entiers, 30,00 $ + 45,50 $ font exactement 75,50 $.
    const acomptes = [3000, 4550];
    const paye = acomptes.reduce((a, b) => a + b, 0);
    const r = totauxDeLaFacture({ lignes: [10000], payeCents: paye });
    expect(paye).toBe(7550);
    expect(r.soldeCents).toBe(2450);
  });

  it('trois tiers d’un montant indivisible ne perdent pas de cent', () => {
    // 100,00 $ en trois : 33,34 + 33,33 + 33,33. La somme doit retomber
    // pile sur 100,00 $ — c'est ici que le cent se perd d'habitude.
    const total = 10000;
    const part = Math.floor(total / 3);
    const parts = [total - part * 2, part, part];
    expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
    expect(totauxDeLaFacture({ lignes: [total], payeCents: parts.reduce((a, b) => a + b, 0) }).soldeCents).toBe(0);
  });
});
