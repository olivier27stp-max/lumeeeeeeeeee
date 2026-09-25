/**
 * Rapports — cohérence du registre et des gardes.
 *
 * Chaque définition est déclarative ; une faute (tri sur une colonne
 * inexistante, filtre sans options, permission inconnue) ne se verrait
 * qu'en prod. On la voit ici.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { listReports, getReport } from '../server/lib/reports/registry';
import { PERMISSION_KEYS, ROLE_PRESETS } from '../src/lib/permissions';
import { hasPermission, type UserContext } from '../server/lib/rbac';

const NUMERIC = new Set(['money', 'integer', 'number', 'hours', 'percent']);

describe('registre des rapports', () => {
  const reports = listReports();

  it('contient les 15 rapports V1 + V1.1 et le lien Paie', () => {
    const ids = reports.map((r) => r.id).sort();
    expect(ids).toEqual([
      'aged-receivables', 'client-balances', 'clients', 'commissions', 'field-activity', 'invoices', 'jobs',
      'payments', 'payroll', 'pipeline', 'quotes', 'revenue-by-period', 'sales-performance', 'taxes', 'timesheets', 'visits',
    ]);
  });

  it('a des identifiants uniques, en minuscules-tirets', () => {
    const ids = reports.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]{2,40}$/);
    expect(getReport('invoices')?.id).toBe('invoices');
    expect(getReport('nope')).toBeUndefined();
  });

  for (const def of reports) {
    describe(def.id, () => {
      it('exige une permission connue', () => {
        expect((PERMISSION_KEYS as readonly string[]).includes(def.permission)).toBe(true);
      });
      it('a un titre et une description dans les deux langues', () => {
        expect(def.title.fr.length).toBeGreaterThan(0);
        expect(def.title.en.length).toBeGreaterThan(0);
        expect(def.description.fr.length).toBeGreaterThan(0);
        expect(def.description.en.length).toBeGreaterThan(0);
      });
      const link = def.link;
      if (link) {
        it('rapport « lien » : pas de colonnes, pointe vers une page interne', () => {
          expect(def.columns).toEqual([]);
          expect(link.startsWith('/')).toBe(true);
        });
        return;
      }
      it('a des colonnes aux clés uniques, toutes bilingues', () => {
        const keys = def.columns.map((c) => c.key);
        expect(keys.length).toBeGreaterThan(0);
        expect(new Set(keys).size).toBe(keys.length);
        for (const c of def.columns) {
          expect(c.label.fr.length, `${def.id}.${c.key}`).toBeGreaterThan(0);
          expect(c.label.en.length, `${def.id}.${c.key}`).toBeGreaterThan(0);
        }
      });
      it('trie par défaut sur une colonne existante et triable', () => {
        const c = def.columns.find((x) => x.key === def.defaultSort.key);
        expect(c, `${def.id}: tri par défaut ${def.defaultSort.key}`).toBeDefined();
        expect(c?.sortable, `${def.id}: ${def.defaultSort.key} doit être triable`).toBe(true);
      });
      it('ne totalise que des colonnes numériques', () => {
        for (const c of def.columns) {
          if (c.total === 'sum') expect(NUMERIC.has(c.type), `${def.id}.${c.key}`).toBe(true);
        }
      });
      it('a des libellés pour chaque colonne enum', () => {
        for (const c of def.columns) {
          if (c.type === 'enum') expect(Object.keys(c.labels || {}).length, `${def.id}.${c.key}`).toBeGreaterThan(0);
        }
      });
      it('a des filtres cohérents (select = options ou source, clés uniques)', () => {
        const keys = def.filters.map((f) => f.key);
        expect(new Set(keys).size).toBe(keys.length);
        for (const f of def.filters) {
          if (f.type === 'select') expect(!!(f.options?.length || f.source), `${def.id}.${f.key}`).toBe(true);
          if (f.default) expect(f.options?.some((o) => o.value === f.default), `${def.id}.${f.key} défaut inconnu`).toBe(true);
        }
      });
      if (def.dateFilter) {
        it('a un préréglage de période valide', () => {
          expect(['thisMonth', 'last30', 'last90', 'last12m', 'thisYear', 'all']).toContain(def.dateFilter!.default);
          for (const f of def.dateFilter!.fields || []) expect(f.value).toMatch(/^[a-z_]+$/);
        });
      }
    });
  }
});

describe('gardes', () => {
  it('les quatre routes /api/reports sont déclarées avec les bonnes permissions', () => {
    const src = readFileSync('server/lib/route-permissions.ts', 'utf8');
    expect(src).toContain("'GET /api/reports/catalogue': 'financial.view_reports'");
    expect(src).toContain("'GET /api/reports/definition': 'financial.view_reports'");
    expect(src).toContain("'GET /api/reports/rows': 'financial.view_reports'");
    expect(src).toContain("'GET /api/reports/export.csv': 'financial.export_data'");
    expect(src).toContain("'GET /api/reports/export.xlsx': 'financial.export_data'");
    expect(src).toContain("'GET /api/reports/export.json': 'financial.export_data'");
  });

  it('le routeur est monté et journalise sous le type « report »', () => {
    expect(readFileSync('server/index.ts', 'utf8')).toContain("app.use('/api', reportsRouter)");
    expect(readFileSync('server/lib/data-export-log.ts', 'utf8')).toMatch(/\|\s*'report'/);
    expect(readFileSync('server/routes/reports.ts', 'utf8')).toContain("exportType: 'report'");
  });

  it('un technicien ne voit aucun rapport, un vendeur non plus par défaut, un admin tous', () => {
    const ctx = (role: UserContext['role']): UserContext => ({
      userId: 'u', orgId: 'o', role, scope: 'company', teamId: null, departmentId: null, managerId: null, permissions: {},
    });
    const visible = (role: UserContext['role']) => listReports().filter((r) => hasPermission(ctx(role), r.permission)).length;
    expect(visible('technician')).toBe(0);
    expect(visible('sales_rep')).toBe(ROLE_PRESETS.sales_rep['financial.view_reports'] ? listReports().length : 0);
    expect(visible('admin')).toBe(listReports().length);
    expect(visible('owner')).toBe(listReports().length);
  });

  it('un vendeur autorisé par la page Rôles voit les rapports mais pas forcément l export', () => {
    const rep: UserContext = {
      userId: 'u', orgId: 'o', role: 'sales_rep', scope: 'self', teamId: null, departmentId: null, managerId: null,
      permissions: { 'financial.view_reports': true },
    };
    expect(hasPermission(rep, 'financial.view_reports')).toBe(true);
    expect(hasPermission(rep, 'financial.export_data')).toBe(ROLE_PRESETS.sales_rep['financial.export_data'] === true);
  });
});
