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
  it('respecte les dépendances (services → clients → propriétés → jobs → soumissions → visites → factures)', () => {
    expect(IMPORT_ORDER).toEqual(['service', 'client', 'property', 'job', 'quote', 'visit', 'invoice']);
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

describe('planIntraDedupe — doublons internes et homonymes (précision)', async () => {
  const { planIntraDedupe } = await import('../../server/lib/migration/importer');
  const rec = (id: string, normalized: Record<string, unknown>) => ({
    id, row_number: 1, entity_type: 'client', external_id: null, status: 'ready',
    normalized, relations: {},
  } as any);

  it('même client exporté deux fois → fusionné (courriel identique)', () => {
    const plan = planIntraDedupe('client', [
      rec('a', { first_name: 'Marc', last_name: 'Tremblay', email: 'marc@exemple.com' }),
      rec('b', { first_name: 'Marc', last_name: 'Tremblay', email: 'marc@exemple.com' }),
    ]);
    expect(plan.siblingOf.get('b')).toBe('a');
    expect(plan.ambiguousKeys.size).toBe(0);
  });

  it('homonymes DISTINCTS (courriels différents) → jamais fusionnés, clé ambiguë', () => {
    const plan = planIntraDedupe('client', [
      rec('a', { first_name: 'Jean', last_name: 'Dupont', email: 'jean1@exemple.com', address: '1 rue A' }),
      rec('b', { first_name: 'Jean', last_name: 'Dupont', email: 'jean2@exemple.com', address: '99 rue B' }),
    ]);
    expect(plan.siblingOf.size).toBe(0);
    expect(plan.ambiguousKeys.has('jean dupont')).toBe(true);
  });

  it('jobs au même numéro → fusionnés, factures au même numéro aussi', () => {
    const j = (id: string, job_number: string) => ({ id, row_number: 1, entity_type: 'job', external_id: null, status: 'ready', normalized: { job_number }, relations: {} } as any);
    const plan = planIntraDedupe('job', [j('a', '1001'), j('b', '1001'), j('c', '1002')]);
    expect(plan.siblingOf.get('b')).toBe('a');
    expect(plan.siblingOf.has('c')).toBe(false);
  });
});

describe('facture — le solde source fait foi (précision au cent)', async () => {
  const { buildEntityRow } = await import('../../server/lib/migration/importer');
  const ctx = {
    migration: { org_id: 'org-1' }, createdBy: 'u',
    clientIdByRef: new Map([['marc tremblay', 'c1']]), propertyIdByRef: new Map(), jobIdByRef: new Map(),
  } as any;
  const inv = (extra: Record<string, unknown>) => (buildEntityRow('invoice', {
    id: 'x', row_number: 1, entity_type: 'invoice', external_id: null, status: 'ready',
    normalized: { invoice_number: '77', total_cents: 10000, ...extra },
    relations: { client_ref: 'Marc Tremblay' },
  } as any, ctx) as any).row;

  it('solde partiel → statut partial et payé exact', () => {
    const row = inv({ balance_cents: 4000, status: 'Awaiting Payment' });
    expect(row.status).toBe('partial');
    expect(row.paid_cents).toBe(6000);
    expect(row.balance_cents).toBe(4000);
  });
  it('solde zéro → payé, même si le statut source dit autre chose', () => {
    const row = inv({ balance_cents: 0, status: 'Awaiting Payment' });
    expect(row.status).toBe('paid');
    expect(row.paid_cents).toBe(10000);
  });
  it('solde plein → sent (rien payé)', () => {
    const row = inv({ balance_cents: 10000, status: 'Awaiting Payment' });
    expect(row.status).toBe('sent');
    expect(row.paid_cents).toBe(0);
  });
});

describe('client — date d\'origine préservée sans null explicite', async () => {
  const { buildEntityRow } = await import('../../server/lib/migration/importer');
  const ctx = { migration: { org_id: 'o' }, createdBy: 'u', clientIdByRef: new Map(), propertyIdByRef: new Map(), jobIdByRef: new Map() } as any;
  const cl = (normalized: Record<string, unknown>) => (buildEntityRow('client', {
    id: 'x', row_number: 1, entity_type: 'client', external_id: null, status: 'ready', normalized, relations: {},
  } as any, ctx) as any).row;

  it('created_date → created_at midi (pas de décalage de jour)', () => {
    expect(cl({ first_name: 'A', created_date: '2023-06-01' }).created_at).toBe('2023-06-01T12:00:00');
  });
  it('sans created_date : la clé est ABSENTE (le DEFAULT now() agit)', () => {
    expect('created_at' in cl({ first_name: 'A' })).toBe(false);
  });
});

describe('post-audit — jobs migrés hors leaderboard (décision propriétaire)', async () => {
  const { buildEntityRow } = await import('../../server/lib/migration/importer');
  const ctx = {
    migration: { org_id: 'o' }, createdBy: 'u',
    clientIdByRef: new Map([['marc tremblay', 'c1']]), propertyIdByRef: new Map(), jobIdByRef: new Map(),
  } as any;
  it('tout job importé porte show_on_leaderboard=false', () => {
    const res = buildEntityRow('job', {
      id: 'x', row_number: 1, entity_type: 'job', external_id: null, status: 'ready',
      normalized: { title: 'T', total_cents: 100 }, relations: { client_ref: 'Marc Tremblay' },
    } as any, ctx) as any;
    expect(res.row.show_on_leaderboard).toBe(false);
  });
});

describe('P1 déclenchés — soumissions et employés historiques', async () => {
  const { buildEntityRow } = await import('../../server/lib/migration/importer');
  const ctx = {
    migration: { org_id: 'o' }, createdBy: 'invite',
    clientIdByRef: new Map([['marc tremblay', 'c1']]),
    propertyIdByRef: new Map(),
    jobIdByRef: new Map([['1001', 'j1']]),
    staffIdBySource: new Map([['marc employe', 'u-marc']]),
  } as any;

  it('soumission : statuts mappés au workflow Lume, client requis', () => {
    const q = (status: string) => (buildEntityRow('quote', {
      id: 'q1', row_number: 1, entity_type: 'quote', external_id: null, status: 'ready',
      normalized: { quote_number: '77', total_cents: 5000, status },
      relations: { client_ref: 'Marc Tremblay', job_ref: '1001' },
    } as any, ctx) as any);
    expect(q('Approved').row.status).toBe('approved');
    expect(q('Sent').row.status).toBe('awaiting_response');
    expect(q('Draft').row.status).toBe('draft');
    expect(q('Declined').row.status).toBe('archived');
    expect(q('Converted').row.status).toBe('converted');
    expect(q('Approved').row.job_id).toBe('j1');
    const orphan = buildEntityRow('quote', {
      id: 'q2', row_number: 2, entity_type: 'quote', external_id: null, status: 'ready',
      normalized: { quote_number: '78', total_cents: 100 }, relations: {},
    } as any, ctx) as any;
    expect(orphan.ok).toBe(false);
    expect(orphan.reason).toBe('orphan');
  });

  it('job : le vendeur historique mappé devient salesperson_id, sinon null', () => {
    const j = (salesperson?: string) => (buildEntityRow('job', {
      id: 'jx', row_number: 1, entity_type: 'job', external_id: null, status: 'ready',
      normalized: { title: 'T', ...(salesperson ? { salesperson } : {}) },
      relations: { client_ref: 'Marc Tremblay' },
    } as any, ctx) as any).row;
    expect(j('Marc Employe').salesperson_id).toBe('u-marc');
    expect(j('Inconnu Dupont').salesperson_id).toBeNull();
    expect(j().salesperson_id).toBeNull();
  });

  it('visite : le membre assigné historique mappé devient assigned_user', () => {
    const v = (buildEntityRow('visit', {
      id: 'vx', row_number: 1, entity_type: 'visit', external_id: null, status: 'ready',
      normalized: { start_at: '2024-05-01T09:00:00', assigned_to: 'Marc Employe' },
      relations: { job_ref: '1001' },
    } as any, ctx) as any).row;
    expect(v.assigned_user).toBe('u-marc');
  });
});
