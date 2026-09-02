/**
 * LES TAXES — TPS, TVQ, et le cent qui doit tomber juste.
 *
 * `calculateTaxes()` decide combien de taxes figurent sur chaque facture.
 * Elle n avait aucun test, alors que c est le calcul le plus surveille d une
 * entreprise : Revenu Quebec et l ARC verifient ces montants.
 *
 * Un cent d ecart sur une facture passe inapercu. Sur une annee de factures,
 * il devient un ecart de remise de taxes qu il faut expliquer.
 *
 * On teste la VRAIE fonction exportee (`src/lib/taxApi.ts`), pas une
 * reproduction.
 *
 * LA REGLE, telle qu elle est codee :
 *
 *     base = sous-total - remise
 *     si base <= 0 ou aucune taxe  ->  aucune taxe
 *     pour chaque taxe active, dans l ordre :
 *       montant = pourcentage ? round((composee ? baseCourante : base) * taux / 100)
 *                             : round(taux * 100)          // montant fixe
 *       baseCourante += montant
 *
 * LE POINT DELICAT — les taxes COMPOSEES
 * Une taxe composee s applique sur la base PLUS toutes les taxes precedentes.
 * C est pourquoi chaque taxe alimente `runningBase`, meme celles qui ne sont
 * pas composees : sinon une taxe composee placee apres elles calculerait sur
 * une base incomplete.
 *
 * Au Quebec, TPS et TVQ ne sont PAS composees depuis 2013 — la TVQ se calcule
 * sur le montant hors taxes, pas sur le montant TPS incluse. Les preréglages
 * du produit sont conformes (`is_compound: false` pour les deux) et ce
 * fichier le verifie explicitement.
 */

import { describe, it, expect } from 'vitest';
import { calculateTaxes, type TaxConfig } from '../src/lib/taxApi';

/** Fabrique une taxe complete a partir de l essentiel. */
const taxe = (over: Partial<TaxConfig> & { name: string; rate: number }): TaxConfig => ({
  id: `tax_${over.name}`,
  org_id: 'org_A',
  type: 'percentage',
  region: 'QC',
  country: 'CA',
  is_compound: false,
  is_active: true,
  sort_order: 0,
  registration_number: null,
  ...over,
});

const TPS = taxe({ name: 'TPS', rate: 5, sort_order: 0 });
const TVQ = taxe({ name: 'TVQ', rate: 9.975, sort_order: 1 });

/* === LE CAS QUEBECOIS ============================================ */

describe('TPS et TVQ sur une facture quebecoise', () => {
  it('100,00 $ donne 5,00 $ de TPS et 9,98 $ de TVQ', () => {
    // Le cas de reference : 9,975 % de 100 $ = 9,975 $, arrondi a 9,98 $.
    const r = calculateTaxes(10000, 0, [TPS, TVQ]);
    expect(r.map((t) => t.amount_cents)).toEqual([500, 998]);
  });

  it('la TVQ se calcule HORS TPS, pas dessus', () => {
    // Depuis 2013 la TVQ n est plus composee. Si elle l etait, elle vaudrait
    // 9,975 % de 105,00 $ = 10,47 $ au lieu de 9,98 $ — 49 cents d ecart
    // par tranche de 100 $ facturee.
    const r = calculateTaxes(10000, 0, [TPS, TVQ]);
    expect(r[1].amount_cents).toBe(998);
    expect(r[1].amount_cents).not.toBe(1047);
  });

  it('le total facture correspond a la somme attendue', () => {
    // 100,00 $ + 5,00 $ + 9,98 $ = 114,98 $
    const r = calculateTaxes(10000, 0, [TPS, TVQ]);
    const totalTaxes = r.reduce((s, t) => s + t.amount_cents, 0);
    expect(totalTaxes).toBe(1498);
    expect(10000 + totalTaxes).toBe(11498);
  });

  it('un montant impair est arrondi au cent, pas tronque', () => {
    // 9,975 % de 33,33 $ = 3,3247... $ -> 3,32 $
    const r = calculateTaxes(3333, 0, [TVQ]);
    expect(r[0].amount_cents).toBe(332);
  });

  it('l arrondi monte quand il le doit', () => {
    // 5 % de 1,50 $ = 0,075 $ -> 0,08 $ (et non 0,07 $)
    const r = calculateTaxes(150, 0, [TPS]);
    expect(r[0].amount_cents).toBe(8);
  });
});

/* === LA REMISE =================================================== */

describe('la remise avant taxes', () => {
  it('les taxes se calculent APRES la remise', () => {
    // 100,00 $ - 20,00 $ = 80,00 $ imposables -> TPS 4,00 $
    const r = calculateTaxes(10000, 2000, [TPS]);
    expect(r[0].amount_cents).toBe(400);
  });

  it('une remise egale au sous-total annule les taxes', () => {
    expect(calculateTaxes(10000, 10000, [TPS, TVQ])).toEqual([]);
  });

  it('une remise superieure au sous-total ne cree pas de taxe negative', () => {
    // `base <= 0` : sans ce garde, la taxe serait negative et viendrait
    // CREDITER le client sur sa facture.
    expect(calculateTaxes(10000, 15000, [TPS, TVQ])).toEqual([]);
  });
});

/* === LES CAS LIMITES ============================================= */

describe('les cas ou il ne doit rien se passer', () => {
  it('une facture a zero ne porte aucune taxe', () => {
    expect(calculateTaxes(0, 0, [TPS, TVQ])).toEqual([]);
  });

  it('sans taxe configuree, aucune taxe', () => {
    expect(calculateTaxes(10000, 0, [])).toEqual([]);
  });

  it('une taxe DESACTIVEE ne s applique pas', () => {
    // L entrepreneur qui desactive une taxe ne doit plus la voir apparaitre.
    const r = calculateTaxes(10000, 0, [TPS, taxe({ name: 'TVQ', rate: 9.975, is_active: false })]);
    expect(r).toHaveLength(1);
    expect(r[0].name).toBe('TPS');
  });

  it('un taux a zero produit une ligne a zero, pas une absence', () => {
    // La ligne reste visible : une taxe a 0 % doit apparaitre sur la facture
    // pour que le client comprenne qu elle a ete consideree.
    const r = calculateTaxes(10000, 0, [taxe({ name: 'Exoneree', rate: 0 })]);
    expect(r).toHaveLength(1);
    expect(r[0].amount_cents).toBe(0);
  });
});

/* === LES TAXES COMPOSEES ========================================= */

describe('les taxes composees', () => {
  it('une taxe composee s applique sur la base PLUS la taxe precedente', () => {
    // Base 100,00 $ ; A = 10 % = 10,00 $ ; B composee = 10 % de 110,00 $ = 11,00 $
    const A = taxe({ name: 'A', rate: 10, sort_order: 0 });
    const B = taxe({ name: 'B', rate: 10, is_compound: true, sort_order: 1 });
    const r = calculateTaxes(10000, 0, [A, B]);
    expect(r[0].amount_cents).toBe(1000);
    expect(r[1].amount_cents).toBe(1100);
  });

  it('une taxe NON composee ignore les taxes precedentes', () => {
    const A = taxe({ name: 'A', rate: 10, sort_order: 0 });
    const B = taxe({ name: 'B', rate: 10, sort_order: 1 });
    const r = calculateTaxes(10000, 0, [A, B]);
    expect(r[1].amount_cents).toBe(1000);
  });

  it('deux taxes composees s empilent l une sur l autre', () => {
    // 100 -> A 10 % = 10 (base 110) -> B composee 10 % = 11 (base 121)
    //     -> C composee 10 % de 121 = 12,10 $
    const A = taxe({ name: 'A', rate: 10, sort_order: 0 });
    const B = taxe({ name: 'B', rate: 10, is_compound: true, sort_order: 1 });
    const C = taxe({ name: 'C', rate: 10, is_compound: true, sort_order: 2 });
    const r = calculateTaxes(10000, 0, [A, B, C]);
    expect(r.map((t) => t.amount_cents)).toEqual([1000, 1100, 1210]);
  });

  it('l ordre des taxes change le resultat quand l une est composee', () => {
    // Preuve que `sort_order` compte vraiment : la meme paire de taxes
    // donne deux totaux differents selon l ordre.
    const A = taxe({ name: 'A', rate: 10 });
    const Bc = taxe({ name: 'B', rate: 20, is_compound: true });
    const ordre1 = calculateTaxes(10000, 0, [A, Bc]).reduce((s, t) => s + t.amount_cents, 0);
    const ordre2 = calculateTaxes(10000, 0, [Bc, A]).reduce((s, t) => s + t.amount_cents, 0);
    expect(ordre1).not.toBe(ordre2);
  });
});

/* === LES TAXES A MONTANT FIXE ==================================== */

describe('les taxes a montant fixe', () => {
  it('un montant fixe ignore le sous-total', () => {
    // `type: 'fixed'` : le taux est un montant en DOLLARS, converti en cents.
    const fixe = taxe({ name: 'Ecofrais', rate: 2.5, type: 'fixed' });
    expect(calculateTaxes(10000, 0, [fixe])[0].amount_cents).toBe(250);
    expect(calculateTaxes(99999, 0, [fixe])[0].amount_cents).toBe(250);
  });

  it('un montant fixe alimente la base des taxes composees suivantes', () => {
    // Base 100 $ + frais fixe 10 $ = 110 $, puis 10 % composee = 11,00 $
    const fixe = taxe({ name: 'Frais', rate: 10, type: 'fixed', sort_order: 0 });
    const comp = taxe({ name: 'Comp', rate: 10, is_compound: true, sort_order: 1 });
    const r = calculateTaxes(10000, 0, [fixe, comp]);
    expect(r[0].amount_cents).toBe(1000);
    expect(r[1].amount_cents).toBe(1100);
  });
});

/* === CE QUI EST RENVOYE ========================================== */

describe('ce que la facture affiche', () => {
  it('chaque taxe garde son nom et son taux', () => {
    // Le client doit lire « TVQ 9,975 % » sur sa facture, pas un total opaque.
    const r = calculateTaxes(10000, 0, [TPS, TVQ]);
    expect(r[0].name).toBe('TPS');
    expect(r[0].rate).toBe(5);
    expect(r[1].name).toBe('TVQ');
    expect(r[1].rate).toBe(9.975);
  });

  it('le numero d enregistrement suit la taxe', () => {
    // Obligatoire sur une facture : le numero de TPS/TVQ de l entreprise.
    const avecNumero = taxe({ name: 'TPS', rate: 5, registration_number: '123456789RT0001' });
    expect(calculateTaxes(10000, 0, [avecNumero])[0].registration_number).toBe('123456789RT0001');
  });

  it('sans numero, le champ est null et non undefined', () => {
    expect(calculateTaxes(10000, 0, [TPS])[0].registration_number).toBeNull();
  });
});
