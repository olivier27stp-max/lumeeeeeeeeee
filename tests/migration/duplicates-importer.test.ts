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
