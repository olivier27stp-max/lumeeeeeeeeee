/**
 * Le total d'une facture tient compte du rabais — en base comme dans l'app.
 *
 * invoices_apply_status_logic posait total = sous-total + taxes : 8 factures
 * importées de Jobber (payées) apparaissaient « partiellement payées » avec
 * un solde égal au rabais. Migration 20260926100600. Scénario complet contre
 * staging : les blocs de ce fichier ont été rejoués avant/après (voir PR).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { calculateInvoiceTotals } from '../src/lib/invoiceCalc';

const MIG = readFileSync(join(__dirname, '../supabase/migrations/20260926100600_factures_total_avec_rabais.sql'), 'utf8');
const fn = MIG.slice(MIG.indexOf('create or replace function public.invoices_apply_status_logic'), MIG.indexOf('drop trigger if exists'));

/** La règle SQL, transcrite telle quelle. */
const totalSql = (sous: number, rabais: number, taxes: number) =>
  Math.max(sous - Math.min(Math.max(rabais, 0), sous) + taxes, 0);

describe('total de facture = sous-total − rabais + taxes', () => {
  it('la fonction applique le rabais, plafonné au sous-total', () => {
    expect(fn).toContain('new.subtotal_cents - least(greatest(coalesce(new.discount_cents, 0), 0), new.subtotal_cents) + new.tax_cents');
    expect(fn).not.toMatch(/new\.total_cents := greatest\(new\.subtotal_cents \+ new\.tax_cents/);
  });

  it.each([
    [89000, 5000, 12579],  // facture 355 : 965,79 $ chez Jobber
    [10000, 2000, 1500],
    [10000, 50000, 0],     // rabais plus grand que le sous-total
    [0, 0, 0],
  ])('même résultat que l’app (%i − %i + %i)', (sous, rabais, taxes) => {
    const app = calculateInvoiceTotals([{ description: 'x', qty: 1, unit_price_cents: sous }], taxes, rabais).total_cents;
    expect(totalSql(sous, rabais, taxes)).toBe(app);
  });

  it('changer SEULEMENT le rabais recalcule le total', () => {
    expect(MIG).toMatch(/before insert or update of [^\n]*discount_cents/);
  });

  it('la projection en dollars passe après le recalcul', () => {
    expect(MIG).toContain('rename to zz_sync_invoices_legacy_money');
    expect('zz_sync_invoices_legacy_money' > 'trg_invoices_apply_status_logic').toBe(true);
  });

  it('le rattrapage ne vise que la signature du défaut', () => {
    const r = MIG.slice(MIG.indexOf('-- ── Rattrapage'));
    expect(r).toContain('coalesce(i.discount_cents, 0) > 0');
    expect(r).toContain('i.total_cents = i.subtotal_cents + i.tax_cents');
    expect(r).toMatch(/i\.total_cents <> greatest\(0, i\.subtotal_cents - least\(i\.discount_cents, i\.subtotal_cents\) \+ i\.tax_cents\)/);
  });
});
