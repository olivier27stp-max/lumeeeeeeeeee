// Manques comblés dans l'importeur (rapport du bot, export Jobber 2026-09) :
// prospect / archivé, complément d'adresse accolé, date de paiement.

import { describe, it, expect } from 'vitest';
import { buildEntityRow, clientStatusOf, composeAddress, statusRecognized } from '../../server/lib/migration/importer';
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

describe('clientStatusOf', () => {
  it('archivé prime sur prospect ; sans drapeau → actif', () => {
    expect(clientStatusOf({})).toBe('active');
    expect(clientStatusOf({ is_lead: true })).toBe('lead');
    expect(clientStatusOf({ archived: true, is_lead: true })).toBe('inactive');
    expect(clientStatusOf({ is_lead: false, archived: false })).toBe('active');
  });
  it('statut texte interprété', () => {
    expect(clientStatusOf({ status: 'Lead' })).toBe('lead');
    expect(clientStatusOf({ status: 'Archived' })).toBe('inactive');
    expect(clientStatusOf({ status: 'Active' })).toBe('active');
    expect(clientStatusOf({ status: 'n importe quoi' })).toBe('active');
    expect(statusRecognized('client', 'n importe quoi')).toBe(false);
    expect(statusRecognized('client', 'Active')).toBe(true);
  });
});

describe('composeAddress', () => {
  it('accole le complément, ignore une répétition de la ville', () => {
    expect(composeAddress({ address: '123 rue X', address_line2: 'app. 4' })).toBe('123 rue X, app. 4');
    expect(composeAddress({ address: '123 rue X', address_line2: 'Montréal', city: 'Montréal' })).toBe('123 rue X');
    expect(composeAddress({ address: '123 rue X app. 4', address_line2: 'app. 4' })).toBe('123 rue X app. 4');
    expect(composeAddress({ address: '123 rue X' })).toBe('123 rue X');
  });
});

describe('buildEntityRow — client', () => {
  it('prospect archivé → inactive ; adresse composée', () => {
    const res = buildEntityRow('client', staging('client', {
      first_name: 'Marc', last_name: 'T', address: '123 rue X', address_line2: 'app. 4', is_lead: true, archived: true,
    }), ctx);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.row.status).toBe('inactive');
    expect(res.row.address).toBe('123 rue X, app. 4');
  });
  it('prospect non archivé → lead', () => {
    const res = buildEntityRow('client', staging('client', { first_name: 'Marc', is_lead: true, archived: false }), ctx);
    expect(res.ok && res.row.status).toBe('lead');
  });
});

describe('buildEntityRow — facture : date de paiement', () => {
  it('facture soldée avec paid_date → paid_at à midi', () => {
    const res = buildEntityRow('invoice', staging('invoice',
      { invoice_number: '12', total_cents: 10000, balance_cents: 0, paid_date: '2026-09-03', issued_date: '2026-08-01' },
      { client_email_ref: 'a@b.ca' }), ctx);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.row.status).toBe('paid');
    expect(res.row.paid_at).toBe('2026-09-03T12:00:00');
  });
  it('facture avec solde : paid_date ignorée', () => {
    const res = buildEntityRow('invoice', staging('invoice',
      { invoice_number: '13', total_cents: 10000, balance_cents: 4000, paid_date: '2026-09-03', issued_date: '2026-08-01' },
      { client_email_ref: 'a@b.ca' }), ctx);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.row.status).toBe('partial');
    expect(res.row).not.toHaveProperty('paid_at');
  });
});
