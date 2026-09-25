// Contraintes prod attrapées à l'import final Vision Lavage (2026-09-17) :
// predefined_services.default_price_cents NOT NULL, properties.name NOT NULL,
// quotes/invoices total_non_negatif, et NULL envoyés par PostgREST pour les
// clés absentes d'un lot (defaultToNull).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildEntityRow } from '../../server/lib/migration/importer';
import type { BuildContext, StagingRow } from '../../server/lib/migration/importer';

const ctx: BuildContext = {
  migration: { org_id: 'org-1' } as unknown as BuildContext['migration'],
  createdBy: 'user-1',
  clientIdByRef: new Map([['a@b.ca', 'client-1']]),
  propertyIdByRef: new Map(),
  jobIdByRef: new Map(),
};
function staging(entity: string, normalized: Record<string, unknown>, relations: Record<string, string> = {}): StagingRow {
  return { id: 's1', row_number: 1, entity_type: entity, external_id: null, normalized, relations, status: 'staged' };
}

describe('contraintes NOT NULL / non négatif encodées dans buildEntityRow', () => {
  it('service sans prix → 0 (rapport d\'utilisation Jobber)', () => {
    const r = buildEntityRow('service', staging('service', { name: 'Lavage de vitres' }), ctx);
    expect(r.ok && r.row.default_price_cents).toBe(0);
  });
  it('propriété sans nom → l\'adresse sert de nom', () => {
    const r = buildEntityRow('property', staging('property', { address: '123 rue X' }, { client_email_ref: 'a@b.ca' }), ctx);
    expect(r.ok && r.row.name).toBe('123 rue X');
    const r2 = buildEntityRow('property', staging('property', { address: '123 rue X', name: 'Chalet' }, { client_email_ref: 'a@b.ca' }), ctx);
    expect(r2.ok && r2.row.name).toBe('Chalet');
  });
  it('soumission à total négatif → 0, original dans les notes', () => {
    const r = buildEntityRow('quote', staging('quote', { quote_number: '7', total_cents: -4500 }, { client_email_ref: 'a@b.ca' }), ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.row.total_cents).toBe(0);
    expect(String(r.row.notes)).toContain('-45.00');
  });
  it('facture à total négatif → 0, original dans les notes', () => {
    const r = buildEntityRow('invoice', staging('invoice', { invoice_number: '9', total_cents: -1000, balance_cents: 0 }, { client_email_ref: 'a@b.ca' }), ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.row.total_cents).toBe(0);
    expect(String(r.row.notes)).toContain('-10.00');
  });
  it('les upserts vers les tables actives n\'envoient jamais NULL pour une clé absente', () => {
    const src = readFileSync('server/lib/migration/importer.ts', 'utf8');
    const upserts = src.split('\n').filter((l) => l.includes('.upsert(') && l.includes("onConflict: 'id'"));
    expect(upserts.length).toBeGreaterThanOrEqual(2);
    for (const l of upserts) expect(l).toContain('defaultToNull: false');
  });
});
