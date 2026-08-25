// Doublons (scoring pur) + importeur (id déterministe, ordre d'import).

import { describe, it, expect } from 'vitest';
import { scoreClientDuplicate } from '../../server/lib/migration/duplicates';
import { deterministicEntityId, IMPORT_ORDER, TABLE_BY_ENTITY } from '../../server/lib/migration/importer';

const existing = {
  id: 'c1',
  email: 'marc@exemple.com',
  phone: '(514) 555-1234',
  first_name: 'Marc',
  last_name: 'Tremblay',
  company: null,
  address: '123 rue Saint-Denis',
};

describe('scoreClientDuplicate', () => {
  it('courriel identique → 95', () => {
    const { score, reasons } = scoreClientDuplicate({ email: 'marc@exemple.com' }, existing);
    expect(score).toBe(95);
    expect(reasons).toContain('email');
  });

  it('téléphone identique (formats différents) → 90', () => {
    const { score } = scoreClientDuplicate({ phoneDigits: '5145551234' }, existing);
    expect(score).toBe(90);
  });

  it('nom + adresse → 75 (jamais de fusion automatique)', () => {
    const { score } = scoreClientDuplicate(
      { fullName: 'marc tremblay', addressKey: '123 rue saint denis' },
      existing,
    );
    expect(score).toBe(75);
    expect(score).toBeLessThan(90);
  });

  it('nom seul → 60 (revue humaine)', () => {
    const { score, reasons } = scoreClientDuplicate({ fullName: 'marc tremblay' }, existing);
    expect(score).toBe(60);
    expect(reasons).toContain('name');
  });

  it('clients similaires mais différents → sous les seuils', () => {
    const { score } = scoreClientDuplicate({ email: 'autre@exemple.com', fullName: 'marc tremble' }, existing);
    expect(score).toBe(0);
  });
});

describe('deterministicEntityId — idempotence', () => {
  const MIG = '11111111-2222-3333-4444-555555555555';
  const REC = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

  it('stable pour la même (migration, ligne, table)', () => {
    expect(deterministicEntityId(MIG, REC, 'clients')).toBe(deterministicEntityId(MIG, REC, 'clients'));
  });

  it('distinct par table et par ligne', () => {
    const a = deterministicEntityId(MIG, REC, 'clients');
    expect(deterministicEntityId(MIG, REC, 'jobs')).not.toBe(a);
    expect(deterministicEntityId(MIG, 'ffffffff-bbbb-cccc-dddd-eeeeeeeeeeee', 'clients')).not.toBe(a);
  });

  it('forme UUID valide (version 5, variante RFC)', () => {
    const id = deterministicEntityId(MIG, REC, 'clients');
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('ordre d\'import', () => {
  it('respecte les dépendances (services → clients → propriétés → jobs → visites → factures)', () => {
    expect(IMPORT_ORDER).toEqual(['service', 'client', 'property', 'job', 'visit', 'invoice']);
    expect(IMPORT_ORDER.indexOf('client')).toBeLessThan(IMPORT_ORDER.indexOf('property'));
    expect(IMPORT_ORDER.indexOf('job')).toBeLessThan(IMPORT_ORDER.indexOf('visit'));
    expect(IMPORT_ORDER.indexOf('job')).toBeLessThan(IMPORT_ORDER.indexOf('invoice'));
  });

  it('chaque entité importable a une table cible', () => {
    for (const e of IMPORT_ORDER) expect(TABLE_BY_ENTITY[e], e).toBeTruthy();
  });
});

describe('buildEntityRow — contraintes NOT NULL de prod (leçon E2E 2026-08-24)', async () => {
  const { buildEntityRow } = await import('../../server/lib/migration/importer');
  const MIG = { org_id: 'org-1' } as any;
  const ctx = {
    migration: MIG,
    createdBy: 'user-1',
    clientIdByRef: new Map([['marc tremblay', 'client-1']]),
    propertyIdByRef: new Map(),
    jobIdByRef: new Map(),
  } as any;

  it('job sans sous-total : jamais de null sur les colonnes monétaires', () => {
    const res = buildEntityRow('job', {
      id: 's1', row_number: 1, entity_type: 'job', external_id: null, status: 'ready',
      normalized: { title: 'Lavage', total_cents: 15000, status: 'Complete' },
      relations: { client_ref: 'Marc Tremblay' },
    } as any, ctx);
    expect(res.ok).toBe(true);
    const row = (res as any).row;
    expect(row.total_cents).toBe(15000);
    expect(row.subtotal_cents).toBe(15000); // retombe sur le total, jamais null
    expect(row.client_name).toBe('Marc Tremblay'); // colonne héritée remplie
    expect(row.status).toBe('completed');
  });

  it('job sans aucun montant : 0, pas null', () => {
    const res = buildEntityRow('job', {
      id: 's2', row_number: 2, entity_type: 'job', external_id: null, status: 'ready',
      normalized: { title: 'Entretien' },
      relations: { client_ref: 'Marc Tremblay' },
    } as any, ctx);
    const row = (res as any).row;
    expect(row.total_cents).toBe(0);
    expect(row.subtotal_cents).toBe(0);
  });

  it('facture : montants toujours non nuls et cohérents', () => {
    const res = buildEntityRow('invoice', {
      id: 's3', row_number: 3, entity_type: 'invoice', external_id: null, status: 'ready',
      normalized: { invoice_number: '501', total_cents: 17246, subtotal_cents: 15000, tax_cents: 2246, status: 'Paid' },
      relations: { client_ref: 'Marc Tremblay' },
    } as any, ctx);
    const row = (res as any).row;
    expect(row.total_cents).toBe(17246);
    expect(row.paid_cents).toBe(17246);
    expect(row.balance_cents).toBe(0);
    expect(row.status).toBe('paid');
  });
});

describe('mapJobStatus — respecte jobs_status_check de prod (leçon E2E round 3)', async () => {
  const { buildEntityRow } = await import('../../server/lib/migration/importer');
  const ctx = {
    migration: { org_id: 'org-1' },
    createdBy: 'user-1',
    clientIdByRef: new Map([['marc tremblay', 'client-1']]),
    propertyIdByRef: new Map(),
    jobIdByRef: new Map(),
  } as any;
  const rowFor = (status: string) => (buildEntityRow('job', {
    id: 's9', row_number: 9, entity_type: 'job', external_id: null, status: 'ready',
    normalized: { title: 'T', status },
    relations: { client_ref: 'Marc Tremblay' },
  } as any, ctx) as any).row;

  it('toutes les valeurs produites sont dans la contrainte CHECK', () => {
    const allowed = new Set(['draft', 'scheduled', 'in_progress', 'completed', 'cancelled']);
    for (const src of ['Complete', 'Cancelled', 'Canceled', 'Annulé', 'Scheduled', 'In Progress', 'Draft', 'Fermé', 'n\'importe quoi']) {
      const st = rowFor(src).status;
      expect(allowed.has(st), `${src} → ${st}`).toBe(true);
    }
    expect(rowFor('Cancelled').status).toBe('cancelled');
    expect(rowFor('Complete').status).toBe('completed');
  });
});
