/**
 * LES IDENTIFIANTS DE PRIX STRIPE (2026-09-22).
 *
 * Un prix Stripe est IMMUABLE : changer un montant veut dire créer un
 * nouveau prix et brancher son identifiant. Si la table `plans` garde les
 * anciens, le site affiche la nouvelle grille et facture l'ancienne — le
 * pire des écarts, parce qu'il est invisible jusqu'à la première facture.
 *
 * Ce test vérifie que chaque forfait a ses quatre identifiants, qu'ils sont
 * tous distincts, et qu'aucun ancien prix (série de juillet) ne traîne.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(
  resolve(__dirname, '..', 'supabase/migrations/20260922100000_prix_stripe_nouvelle_grille.sql'),
  'utf8',
);

/** Les 12 prix créés en mode réel le 2026-09-22. */
const ATTENDU = {
  starter: ['price_1UIUrQ1MfRbVcYlQiauP20K6', 'price_1UIUro1MfRbVcYlQP79QWKhe', 'price_1UIUsI1MfRbVcYlQY738Ct7T', 'price_1UIUsg1MfRbVcYlQ8V8NlHxZ'],
  pro: ['price_1UIUtW1MfRbVcYlQP5Vncyte', 'price_1UIUtw1MfRbVcYlQUnQTIfyU', 'price_1UIUuE1MfRbVcYlQnmJt4amD', 'price_1UIUue1MfRbVcYlQKaWsDJEJ'],
  autopilot: ['price_1UIUvI1MfRbVcYlQylOgkcrz', 'price_1UIUvg1MfRbVcYlQYCqdADoq', 'price_1UIUw51MfRbVcYlQiNzbBAmi', 'price_1UIUwh1MfRbVcYlQEXcYAM10'],
} as const;

describe('identifiants de prix Stripe', () => {
  it.each(Object.entries(ATTENDU))('%s : ses 4 identifiants sont branchés', (_slug, ids) => {
    for (const id of ids) expect(migration).toContain(`'${id}'`);
  });

  it('les 12 identifiants sont distincts', () => {
    const tous = Object.values(ATTENDU).flat();
    expect(new Set(tous).size).toBe(12);
  });

  it('aucun ancien prix (série de juillet) ne subsiste', () => {
    // Les prix du 8 juillet : price_1Tqy… (CAD) et price_1Tr0… (USD).
    expect(migration).not.toMatch(/'price_1Tqy/);
    expect(migration).not.toMatch(/'price_1Tr0/);
  });

  it('chaque identifiant a le format Stripe attendu', () => {
    const ids = [...migration.matchAll(/'(price_[A-Za-z0-9]+)'/g)].map((m) => m[1]);
    expect(ids).toHaveLength(12);
    for (const id of ids) expect(id).toMatch(/^price_[A-Za-z0-9]{24}$/);
  });
});
