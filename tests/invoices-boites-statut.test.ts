// Boîtes Payées / En attente / En retard de la page Factures.
// Vision Lavage, 2026-09-24 : « En retard : 0 $ » alors que 20 factures émises avant le mois
// totalisaient 15 002 $ de retard — la période « Ce mois-ci » filtrait les soldes ouverts par
// date d'émission. Un solde ouvert est un état : seule Payées (argent encaissé) a une période.
import { describe, it, expect } from 'vitest';
import { computeInvoiceStatusTotals, type InvoiceStatsRow } from '../src/lib/invoicesApi';

const il_y_a = (jours: number) => new Date(Date.now() - jours * 86400000).toISOString();
const ymd = (jours: number) => il_y_a(jours).slice(0, 10);
const ligne = (p: Partial<InvoiceStatsRow>): InvoiceStatsRow => ({
  status: 'sent', total_cents: 10000, balance_cents: 10000, due_date: ymd(-30), issued_at: il_y_a(0), created_at: il_y_a(0), paid_at: null, ...p,
});

describe('computeInvoiceStatusTotals', () => {
  it('une facture en retard émise il y a 4 mois compte dans En retard même en période « Ce mois-ci »', () => {
    const t = computeInvoiceStatusTotals([
      ligne({ issued_at: il_y_a(120), created_at: il_y_a(120), due_date: ymd(90), balance_cents: 1500211 }),
    ], 'this_month');
    expect(t.pastDue).toEqual({ count: 1, cents: 1500211 });
    expect(t.awaiting).toEqual({ count: 0, cents: 0 });
  });

  it('En attente = solde ouvert non échu, quelle que soit la date d\'émission', () => {
    const t = computeInvoiceStatusTotals([
      ligne({ issued_at: il_y_a(400), created_at: il_y_a(400), due_date: ymd(-10), balance_cents: 97729 }),
      ligne({ status: 'partial', total_cents: 20000, balance_cents: 5000, due_date: ymd(-3) }),
    ], 'this_week');
    expect(t.awaiting).toEqual({ count: 2, cents: 102729 });
    expect(t.pastDue.count).toBe(0);
  });

  it('Payées respecte la période (date de paiement) et somme le total encaissé', () => {
    const lignes = [
      ligne({ status: 'paid', balance_cents: 0, total_cents: 241448, paid_at: il_y_a(1) }),
      ligne({ status: 'paid', balance_cents: 0, total_cents: 99999, paid_at: il_y_a(400), created_at: il_y_a(400) }),
    ];
    expect(computeInvoiceStatusTotals(lignes, 'this_year').paid.count).toBe(1);
    expect(computeInvoiceStatusTotals(lignes, 'all_time').paid).toEqual({ count: 2, cents: 341447 });
  });

  it('un solde à zéro ne compte ni en attente ni en retard', () => {
    const t = computeInvoiceStatusTotals([ligne({ balance_cents: 0, due_date: ymd(90) })], 'all_time');
    expect(t.pastDue.count + t.awaiting.count).toBe(0);
  });
});
