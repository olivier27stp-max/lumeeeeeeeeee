/**
 * Rapports — PDF : mise en page des colonnes et génération d'un document
 * complet (en-tête, chiffres clés, tableau paginé, totaux, pieds de page).
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/lib/supabase', () => ({ supabase: {} }));
vi.mock('../src/lib/storage', () => ({ resolveStorageUrl: async (u: string) => u }));
vi.mock('../src/lib/agreementDoc', () => ({ getAgreementCompanyBranding: async () => null }));

import { layoutColumns, buildReportPdf } from '../src/lib/generateReportPdf';
import type { ReportColumn, ReportExportData } from '../src/lib/reportsApi';

const columns: ReportColumn[] = [
  { key: 'invoice_number', label: { fr: 'N°', en: 'Number' }, type: 'text', width: '90px' },
  { key: 'client', label: { fr: 'Client', en: 'Client' }, type: 'text', width: '1.4fr' },
  { key: 'issued_at', label: { fr: 'Émise le', en: 'Issued' }, type: 'date' },
  { key: 'status', label: { fr: 'Statut', en: 'Status' }, type: 'enum', labels: { paid: { fr: 'Payée', en: 'Paid' } } },
  { key: 'total_cents', label: { fr: 'Total', en: 'Total' }, type: 'money', total: 'sum' },
];

function data(n: number): ReportExportData {
  return {
    meta: {
      reportId: 'invoices', title: 'Factures', description: 'Toutes les factures.', company: 'Vision Lavage',
      period: 'Du 1 juin 2026 au 30 juin 2026', periodFrom: '2026-06-01', periodTo: '2026-06-30', dateField: null,
      filters: [{ label: 'Statut', value: 'Payée' }], generatedAt: '2026-09-25T18:32:00.000Z', generatedAtLabel: '25 sept. 2026, 14:32',
      generatedBy: 'Olivier', lang: 'fr', rowCount: n,
    },
    columns,
    rows: Array.from({ length: n }, (_, i) => ({ id: String(i), invoice_number: String(1000 + i), client: `Client ${i} — nom très long pour forcer la troncature à l'écran`, issued_at: '2026-06-03', status: 'paid', total_cents: 12345 + i })),
    total: n,
    totals: { total_cents: n * 12345 },
    fileName: 'rapport-invoices-2026-06-01_2026-06-30.pdf',
  };
}

describe('layoutColumns', () => {
  it('remplit toute la largeur : le surplus va aux colonnes texte', () => {
    const { widths, fontSize } = layoutColumns(columns, 700);
    expect(Math.round(widths.reduce((a, b) => a + b, 0))).toBe(700);
    expect(fontSize).toBe(8);
    expect(widths[1]).toBeGreaterThan(widths[0]);
    expect(widths[4]).toBe(66);
  });
  it('réduit proportionnellement et baisse la police quand il y a trop de colonnes', () => {
    const many = Array.from({ length: 18 }, (_, i) => ({ key: `c${i}`, label: { fr: `C${i}`, en: `C${i}` }, type: 'text' as const, width: '1fr' }));
    const { widths, fontSize } = layoutColumns(many, 712);
    expect(Math.round(widths.reduce((a, b) => a + b, 0))).toBe(712);
    expect(fontSize).toBeLessThan(8);
    expect(Math.min(...widths)).toBeGreaterThanOrEqual(30);
  });
});

describe('buildReportPdf', () => {
  it('génère un document paysage d une page pour un petit rapport, avec métadonnées', () => {
    const doc = buildReportPdf(data(5), { company: null, logo: null });
    expect(doc.getNumberOfPages()).toBe(1);
    const size = doc.internal.pageSize;
    expect(size.getWidth()).toBeGreaterThan(size.getHeight());
    const out = doc.output('arraybuffer');
    expect(out.byteLength).toBeGreaterThan(1000);
  });
  it('pagine et répète l en-tête : 400 lignes tiennent sur plusieurs pages', () => {
    const doc = buildReportPdf(data(400), { company: null, logo: null });
    expect(doc.getNumberOfPages()).toBeGreaterThan(8);
  });
  it('accepte un rapport vide et une identité d entreprise avec accent', () => {
    const doc = buildReportPdf({ ...data(0), rows: [], totals: null }, {
      company: { company_name: 'Vision Lavage', logo_url: null, phone: '514 555-0100', email: 'info@vl.ca', website: null, address: null, taxLines: [], brand_color: '#1d4ed8' },
      logo: null,
    });
    expect(doc.getNumberOfPages()).toBe(1);
  });
});
