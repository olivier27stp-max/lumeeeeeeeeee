/**
 * Rapports — en-tête d'export : période et filtres en clair, auteur,
 * horodatage. Ce bloc rend un fichier lisible seul, des semaines plus tard.
 */
import { describe, it, expect } from 'vitest';
import { periodLabel, formatDateOnly, formatGeneratedAt, describeFilters, buildExportMeta } from '../server/lib/reports/meta';
import type { ReportContext, ReportDefinition } from '../server/lib/reports/types';

const def: ReportDefinition = {
  id: 'invoices', category: 'finances', title: { fr: 'Factures', en: 'Invoices' }, description: { fr: 'Desc FR', en: 'Desc EN' },
  permission: 'financial.view_reports',
  columns: [{ key: 'n', label: { fr: 'N°', en: 'No' }, type: 'text' }],
  filters: [
    { key: 'status', label: { fr: 'Statut', en: 'Status' }, type: 'select', options: [{ value: 'paid', label: { fr: 'Payée', en: 'Paid' } }] },
    { key: 'q', label: { fr: 'Recherche', en: 'Search' }, type: 'search' },
  ],
  dateFilter: { label: { fr: 'Période', en: 'Period' }, default: 'last90', fields: [
    { value: 'issued_at', label: { fr: "Date d'émission", en: 'Issue date' } },
    { value: 'paid_at', label: { fr: 'Date de paiement', en: 'Paid date' } },
  ] },
  defaultSort: { key: 'n', dir: 'desc' },
  source: { kind: 'memory', loadAll: async () => [] },
};

/** Service-role factice : company_settings → nom d'entreprise ; memberships → nom du membre. */
function fakeService(company: string | null, member: string | null) {
  const table = (name: string) => {
    const chain: any = {};
    const answer = () => (name === 'company_settings'
      ? { data: company ? { company_name: company } : null, error: null }
      : name === 'memberships'
        ? { data: member ? [{ user_id: 'u1', full_name: member }] : [], error: null }
        : { data: [], error: null });
    for (const m of ['select', 'eq', 'in', 'limit']) chain[m] = () => chain;
    chain.maybeSingle = async () => answer();
    chain.then = (resolve: any) => resolve(answer());
    return chain;
  };
  return { from: table } as any;
}

function ctx(lang: 'fr' | 'en', company = 'Vision Lavage', member: string | null = 'Olivier'): ReportContext {
  return { user: {} as any, service: fakeService(company, member), orgId: 'o1', userId: 'u1', role: 'owner', isAdmin: true, lang, today: '2026-09-25' };
}

describe('periodLabel / formatDateOnly', () => {
  it('écrit la période en toutes lettres dans la langue', () => {
    expect(periodLabel('2026-06-01', '2026-06-30', 'fr')).toBe('Du 1 juin 2026 au 30 juin 2026');
    expect(periodLabel('2026-06-01', '2026-06-30', 'en')).toBe('June 1, 2026 to June 30, 2026');
    expect(periodLabel('2026-06-01', undefined, 'fr')).toBe('Depuis le 1 juin 2026');
    expect(periodLabel(undefined, '2026-06-30', 'en')).toBe('Up to June 30, 2026');
    expect(periodLabel(undefined, undefined, 'fr')).toBe('Toute la période');
  });
  it('ne décale jamais le jour (date seule formatée en UTC)', () => {
    expect(formatDateOnly('2026-01-01', 'fr')).toBe('1 janvier 2026');
    expect(formatDateOnly('pas-une-date', 'fr')).toBe('pas-une-date');
  });
  it('horodate dans le fuseau de l org', () => {
    expect(formatGeneratedAt(new Date('2026-09-25T18:32:00Z'), 'fr')).toMatch(/25 sept\. 2026,? 14(:| h )32/);
  });
});

describe('describeFilters', () => {
  it('traduit les filtres actifs, ignore « all » et le vide, nomme la colonne de date choisie', async () => {
    const lines = await describeFilters(def, ctx('fr'), { from: '2026-06-01', to: '2026-06-30', dateField: 'paid_at', filters: { status: 'paid', q: '' }, sort: { key: 'n', dir: 'desc' } });
    expect(lines).toEqual([
      { label: 'Date de référence', value: 'Date de paiement' },
      { label: 'Statut', value: 'Payée' },
    ]);
  });
  it('garde le texte libre tel quel et ne mentionne pas la colonne de date sans période', async () => {
    const lines = await describeFilters(def, ctx('en'), { filters: { status: 'all', q: 'roger' }, sort: { key: 'n', dir: 'desc' } });
    expect(lines).toEqual([{ label: 'Search', value: 'roger' }]);
  });
});

describe('buildExportMeta', () => {
  it('assemble entreprise, titre, période, filtres, auteur et horodatage', async () => {
    const m = await buildExportMeta(def, ctx('fr'), { from: '2026-06-01', to: '2026-06-30', filters: { status: 'paid' }, sort: { key: 'n', dir: 'desc' } }, 42, new Date('2026-09-25T18:32:00Z'));
    expect(m).toMatchObject({
      reportId: 'invoices', title: 'Factures', description: 'Desc FR', company: 'Vision Lavage',
      period: 'Du 1 juin 2026 au 30 juin 2026', periodFrom: '2026-06-01', periodTo: '2026-06-30',
      generatedAt: '2026-09-25T18:32:00.000Z', generatedBy: 'Olivier', lang: 'fr', rowCount: 42,
    });
    expect(m.filters).toEqual([{ label: 'Date de référence', value: "Date d'émission" }, { label: 'Statut', value: 'Payée' }]);
  });
  it('reste robuste sans réglages d entreprise ni nom de membre', async () => {
    const m = await buildExportMeta(def, ctx('en', '', null), { filters: {}, sort: { key: 'n', dir: 'desc' } }, 0);
    expect(m.company).toBe('');
    expect(m.generatedBy).toBe('');
    expect(m.period).toBe('All time');
  });
});
