/**
 * Un paiement = une ligne `payments` ; la facture suit par le trigger.
 *
 * `apply_invoice_payment` modifie la facture SANS ligne de paiement. Appelée
 * après l'insertion d'un paiement, elle le comptait deux fois (Stripe, #764) ;
 * appelée seule (outils Lumi), le paiement n'existait nulle part et le premier
 * paiement Stripe suivant l'effaçait (audit V2, 2026-09-30). Plus aucun
 * appelant côté serveur.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const RACINE = join(__dirname, '..', 'server');
const fichiers = (d: string): string[] => readdirSync(d).flatMap((n) => {
  const c = join(d, n);
  return statSync(c).isDirectory() ? fichiers(c) : /\.ts$/.test(n) ? [c] : [];
});

describe('aucun paiement sans ligne de paiement', () => {
  it('personne n’appelle apply_invoice_payment', () => {
    const fautifs = fichiers(RACINE)
      .filter((f) => /rpc\(\s*['"]apply_invoice_payment['"]/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(RACINE, f));
    expect(fautifs).toEqual([]);
  });
});
