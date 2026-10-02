/**
 * M-25 — le cron des relances de paiement relançait une facture à la
 * CORBEILLE : une facture supprimée garde son statut « envoyée », et la
 * requête du cron ne filtrait que sur le statut.
 *
 * Le comportement est prouvé sur la pile locale par
 * tests/automations-finale/b/m-25-relance-facture-corbeille.test.ts ; ici, le
 * garde rapide : la requête des factures à relancer écarte la corbeille.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(__dirname, '../../../server/routes/reminders-cron.ts'), 'utf8');

describe('[M-25] relances de paiement : jamais pour une facture à la corbeille', () => {
  /** La requête des factures candidates : de `.from('invoices')` à sa pagination. */
  const debut = source.indexOf("const lirePage = (de: number, a: number) =>");
  const requete = source.slice(debut, source.indexOf('.range(de, a)', debut));

  it('la requête des factures à relancer est bien celle qu’on lit (témoin)', () => {
    expect(debut).toBeGreaterThan(-1);
    expect(requete).toContain(".from('invoices')");
    expect(requete).toContain(".in('status', ['sent', 'partial'])");
  });

  it('elle écarte les factures supprimées', () => {
    expect(requete).toContain(".is('deleted_at', null)");
  });
});
