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
  it('respecte les dépendances (taxes → services → clients → propriétés → adresses de facturation → jobs → soumissions → visites → factures → paiements)', () => {
    expect(IMPORT_ORDER).toEqual(['tax_config', 'service', 'client', 'property', 'billing_property', 'job', 'quote', 'visit', 'invoice', 'payment']);
    expect(IMPORT_ORDER.indexOf('invoice')).toBeLessThan(IMPORT_ORDER.indexOf('payment'));
    expect(IMPORT_ORDER.indexOf('tax_config')).toBeLessThan(IMPORT_ORDER.indexOf('service'));
    expect(IMPORT_ORDER.indexOf('client')).toBeLessThan(IMPORT_ORDER.indexOf('property'));
    expect(IMPORT_ORDER.indexOf('client')).toBeLessThan(IMPORT_ORDER.indexOf('billing_property'));
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

  it('taxe : nom + taux en pourcentage, région majuscule, pays CA par défaut, active', () => {
    const res = buildEntityRow('tax_config', {
      id: 't1', row_number: 1, entity_type: 'tax_config', external_id: null, status: 'ready',
      normalized: { name: 'TVQ', rate: 9.975, region: 'qc', is_compound: false, registration_number: '1234567890 TQ 0001' },
      relations: {},
    } as any, ctx);
    expect(res.ok).toBe(true);
    const row = (res as any).row;
    expect(row).toMatchObject({ org_id: 'org-1', name: 'TVQ', rate: 9.975, type: 'percentage', region: 'QC', country: 'CA', is_compound: false, is_active: true, sort_order: 0 });
    expect(row.registration_number).toBe('1234567890 TQ 0001');
  });

  it('taxe sans taux lisible ou hors 0-100 : rejetée, jamais insérée à 0', () => {
    const base = { id: 't2', row_number: 2, entity_type: 'tax_config', external_id: null, status: 'ready', relations: {} };
    expect(buildEntityRow('tax_config', { ...base, normalized: { name: 'TPS' } } as any, ctx).ok).toBe(false);
    expect(buildEntityRow('tax_config', { ...base, normalized: { name: 'TPS', rate: 150 } } as any, ctx).ok).toBe(false);
    expect(buildEntityRow('tax_config', { ...base, normalized: { rate: 5 } } as any, ctx).ok).toBe(false);
  });

  it('adresse de facturation : properties.kind = billing, jamais principale, client obligatoire', () => {
    const res = buildEntityRow('billing_property', {
      id: 'b1', row_number: 1, entity_type: 'billing_property', external_id: null, status: 'ready',
      normalized: { address: '12 rue des Comptables', city: 'Laval', province: 'QC', postal_code: 'H7A 1A1' },
      relations: { client_ref: 'Marc Tremblay' },
    } as any, ctx);
    expect(res.ok).toBe(true);
    const row = (res as any).row;
    expect(row.kind).toBe('billing');
    expect(row.is_primary).toBe(false);
    expect(row.client_id).toBe('client-1');
    expect(row.city).toBe('Laval');

    const orphan = buildEntityRow('billing_property', {
      id: 'b2', row_number: 2, entity_type: 'billing_property', external_id: null, status: 'ready',
      normalized: { address: '1 rue X' }, relations: { client_ref: 'Inconnu' },
    } as any, ctx);
    expect(orphan.ok).toBe(false);
    expect((orphan as any).reason).toBe('orphan');

    // la propriété de SERVICE reste explicitement kind = service
    const svc = buildEntityRow('property', {
      id: 'p1', row_number: 3, entity_type: 'property', external_id: null, status: 'ready',
      normalized: { address: '99 rue Y' }, relations: { client_ref: 'Marc Tremblay' },
    } as any, ctx);
    expect((svc as any).row.kind).toBe('service');
  });

  it('deux adresses de facturation pour le même client = doublon interne (une seule active par client)', async () => {
    const { planIntraDedupe } = await import('../../server/lib/migration/importer');
    const rows = [
      { id: 'b1', row_number: 1, entity_type: 'billing_property', external_id: null, status: 'ready', normalized: { address: '1 rue A' }, relations: { client_ref: 'Marc Tremblay' } },
      { id: 'b2', row_number: 2, entity_type: 'billing_property', external_id: null, status: 'ready', normalized: { address: '2 rue B' }, relations: { client_ref: 'Marc Tremblay' } },
      { id: 'b3', row_number: 3, entity_type: 'billing_property', external_id: null, status: 'ready', normalized: { address: '1 rue A' }, relations: { client_ref: 'Julie Roy' } },
    ] as any[];
    const plan = planIntraDedupe('billing_property', rows);
    expect(plan.siblingOf.get('b2')).toBe('b1');
    expect(plan.siblingOf.has('b3')).toBe(false); // même adresse, client distinct : légitime
  });

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

describe('audit S2 — visites en UTC (jamais « 9 h devient 5 h »)', async () => {
  const { buildEntityRow } = await import('../../server/lib/migration/importer');
  const ctx = {
    migration: { org_id: 'org-1' },
    createdBy: 'user-1',
    clientIdByRef: new Map(),
    propertyIdByRef: new Map(),
    jobIdByRef: new Map([['job-42', 'job-uuid-1']]),
  } as any;
  const visitFor = (normalized: Record<string, unknown>) => (buildEntityRow('visit', {
    id: 'v1', row_number: 1, entity_type: 'visit', external_id: null, status: 'ready',
    normalized, relations: { job_ref: 'JOB-42' },
  } as any, ctx) as any).row;

  it('9 h locales (été) → 13:00Z, cohérent avec toISOString() de l\'app', () => {
    const row = visitFor({ start_at: '2024-07-15T09:00:00', end_at: '2024-07-15T10:00:00' });
    expect(row.start_at).toBe('2024-07-15T13:00:00Z');
    expect(row.end_at).toBe('2024-07-15T14:00:00Z');
    expect(row.timezone).toBe('America/Toronto'); // aligné sur DEFAULT_TIMEZONE
  });

  it('convention « pas d\'heure précise » (00:00→23:59) survit à la conversion', () => {
    const row = visitFor({ start_at: '2024-07-15T00:00:00' });
    // relu par l'app : new Date('...T04:00:00Z').getHours() === 0 à Toronto
    expect(row.start_at).toBe('2024-07-15T04:00:00Z');
    expect(row.end_at).toBe('2024-07-16T03:59:00Z');
    expect(new Date(row.start_at).getUTCHours()).toBe(4);
  });
});

describe('audit S3 — colonnes non mappées rattachées aux notes, statuts inconnus signalés', async () => {
  const { buildEntityRow, statusRecognized, unmappedNotesBlock } = await import('../../server/lib/migration/importer');
  const ctx = {
    migration: { org_id: 'org-1' },
    createdBy: 'user-1',
    clientIdByRef: new Map([['marc tremblay', 'client-1']]),
    propertyIdByRef: new Map(),
    jobIdByRef: new Map(),
  } as any;

  it('client : _unmapped devient un bloc de notes, formules neutralisées', () => {
    const res = buildEntityRow('client', {
      id: 's1', row_number: 1, entity_type: 'client', external_id: null, status: 'ready',
      normalized: { first_name: 'Marc', notes: 'client fidèle', _unmapped: { 'Ancien champ': 'valeur', Piege: '=cmd|calc' } },
      relations: {},
    } as any, ctx);
    const notes = (res as any).row.notes as string;
    expect(notes).toContain('client fidèle');
    expect(notes).toContain('Champs non importés (ancien CRM)');
    expect(notes).toContain('Ancien champ : valeur');
    expect(notes).toContain("'=cmd|calc"); // anti-injection : apostrophe préfixée
    expect(unmappedNotesBlock({})).toBe('');
  });

  it('statusRecognized : valeurs mappées et bénignes reconnues, l\'inconnu signalé', () => {
    expect(statusRecognized('job', 'Complete')).toBe(true);
    expect(statusRecognized('job', 'Scheduled')).toBe(true);
    expect(statusRecognized('invoice', 'Payée')).toBe(true);
    expect(statusRecognized('job', 'Zombie-Status-42')).toBe(false);
    expect(statusRecognized('quote', 'bizarre-42')).toBe(false);
    expect(statusRecognized('client', 'Active')).toBe(true); // statut client désormais interprété (prospect / archivé)
    expect(statusRecognized('client', 'peu importe')).toBe(false);
    expect(statusRecognized('tax_config', 'peu importe')).toBe(true); // entité sans statut mappé
  });
});

describe('audit S6 — created_at historique préservé pour jobs/soumissions/factures', async () => {
  const { buildEntityRow } = await import('../../server/lib/migration/importer');
  const ctx = {
    migration: { org_id: 'org-1' },
    createdBy: 'user-1',
    clientIdByRef: new Map([['marc tremblay', 'client-1']]),
    propertyIdByRef: new Map(),
    jobIdByRef: new Map(),
  } as any;
  const rowOf = (entity: string, normalized: Record<string, unknown>) => (buildEntityRow(entity as any, {
    id: 'x1', row_number: 1, entity_type: entity, external_id: null, status: 'ready',
    normalized, relations: { client_ref: 'Marc Tremblay' },
  } as any, ctx) as any).row;

  it('job de 2019 : created_at = created_date (sinon date de vente), midi, jamais now()', () => {
    expect(rowOf('job', { title: 'T', created_date: '2019-05-10' }).created_at).toBe('2019-05-10T12:00:00');
    expect(rowOf('job', { title: 'T', sale_date: '2020-08-01' }).created_at).toBe('2020-08-01T12:00:00');
    expect('created_at' in rowOf('job', { title: 'T' })).toBe(false); // clé absente → DEFAULT now()
  });
  it('soumission : created_at = created_date, facture : created_at = created_date (sinon date d\'émission)', () => {
    expect(rowOf('quote', { quote_number: 'Q-1', created_date: '2021-02-03' }).created_at).toBe('2021-02-03T12:00:00');
    expect(rowOf('invoice', { invoice_number: '9', total_cents: 100, issued_date: '2022-11-30' }).created_at).toBe('2022-11-30T12:00:00');
    expect(rowOf('invoice', { invoice_number: '9', total_cents: 100, created_date: '2022-11-01', issued_date: '2022-11-30' }).created_at).toBe('2022-11-01T12:00:00');
    // la date de création ne touche pas l'émission
    expect(rowOf('invoice', { invoice_number: '9', total_cents: 100, created_date: '2022-11-01', issued_date: '2022-11-30' }).issued_at).toBe('2022-11-30T12:00:00');
    expect('created_at' in rowOf('invoice', { invoice_number: '9', total_cents: 100 })).toBe(false);
  });
});

describe('audit S9 — injection de formule neutralisée dans les tables actives', async () => {
  const { buildEntityRow } = await import('../../server/lib/migration/importer');
  const ctx = {
    migration: { org_id: 'org-1' },
    createdBy: 'user-1',
    clientIdByRef: new Map([['marc tremblay', 'client-1']]),
    propertyIdByRef: new Map(),
    jobIdByRef: new Map(),
  } as any;

  it('un « =cmd… » importé en note/nom ressort préfixé, jamais exécutable au réexport', () => {
    const res = buildEntityRow('client', {
      id: 's1', row_number: 1, entity_type: 'client', external_id: null, status: 'ready',
      normalized: { first_name: '=1+2', company: '@SUM(A1)', notes: '=HYPERLINK("http://x")', city: 'Laval' },
      relations: {},
    } as any, ctx);
    const row = (res as any).row;
    expect(row.first_name).toBe("'=1+2");
    expect(row.company).toBe("'@SUM(A1)");
    expect(row.notes.startsWith("'=HYPERLINK")).toBe(true);
    expect(row.city).toBe('Laval'); // texte normal intact
  });

  it('les nombres négatifs et numéros ne sont jamais dénaturés', () => {
    const res = buildEntityRow('job', {
      id: 's2', row_number: 2, entity_type: 'job', external_id: null, status: 'ready',
      normalized: { title: '-45 degrés', notes: '-12.50', job_number: '1001' },
      relations: { client_ref: 'Marc Tremblay' },
    } as any, ctx);
    const row = (res as any).row;
    expect(row.title).toBe('-45 degrés');
    expect(row.notes).toBe('-12.50');
    expect(row.job_number).toBe('1001');
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

  it('visites : même job + même début → fusionnées ; autre heure ou autre job → distinctes', () => {
    const v = (id: string, job_ref: string, start_at: string) => ({ id, row_number: 1, entity_type: 'visit', external_id: null, status: 'ready', normalized: { start_at }, relations: { job_ref } } as any);
    const plan = planIntraDedupe('visit', [
      v('a', '1001', '2026-10-01T09:00:00'),
      v('b', '1001', '2026-10-01T09:00:00'),
      v('c', '1001', '2026-10-01T13:00:00'),
      v('d', '1002', '2026-10-01T09:00:00'),
      v('e', '', '2026-10-01T09:00:00'),
    ]);
    expect(plan.siblingOf.get('b')).toBe('a');
    expect(plan.siblingOf.has('c')).toBe(false);
    expect(plan.siblingOf.has('d')).toBe(false);
    expect(plan.siblingOf.has('e')).toBe(false); // sans job : jamais devinée
  });
});

describe('visitDedupKey — une visite déjà dans le CRM est reconnue quel que soit le format d\'horodatage', async () => {
  const { visitDedupKey } = await import('../../server/lib/migration/importer');
  it('même instant en Z et en +00:00 → même clé', () => {
    expect(visitDedupKey('job-1', '2026-10-01T13:00:00Z')).toBe(visitDedupKey('job-1', '2026-10-01T13:00:00+00:00'));
    expect(visitDedupKey('job-1', '2026-10-01T13:00:00Z')).not.toBe(visitDedupKey('job-2', '2026-10-01T13:00:00Z'));
    expect(visitDedupKey('job-1', '2026-10-01T13:00:00Z')).not.toBe(visitDedupKey('job-1', '2026-10-01T14:00:00Z'));
  });
  it('job ou date manquants → null', () => {
    expect(visitDedupKey('', '2026-10-01T13:00:00Z')).toBeNull();
    expect(visitDedupKey('job-1', 'n/a')).toBeNull();
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
  it('facture : le vendeur mappé devient salesperson_id, sinon null (héritage job côté CRM)', () => {
    const inv = (salesperson?: string) => (buildEntityRow('invoice', {
      id: 'ix', row_number: 1, entity_type: 'invoice', external_id: null, status: 'ready',
      normalized: { invoice_number: '9', total_cents: 100, ...(salesperson ? { salesperson } : {}) },
      relations: { client_ref: 'Marc Tremblay' },
    } as any, ctx) as any).row;
    expect(inv('Marc Employe').salesperson_id).toBe('u-marc');
    expect(inv().salesperson_id).toBeNull();
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

describe('quotes.title NOT NULL (leçon E2E round 8)', async () => {
  const { buildEntityRow } = await import('../../server/lib/migration/importer');
  const ctx = { migration: { org_id: 'o' }, createdBy: 'u', clientIdByRef: new Map([['marc tremblay', 'c1']]), propertyIdByRef: new Map(), jobIdByRef: new Map() } as any;
  it('le titre est toujours rempli, même absent de la source', () => {
    const r = (buildEntityRow('quote', {
      id: 'q', row_number: 1, entity_type: 'quote', external_id: null, status: 'ready',
      normalized: { quote_number: 'Q-101', total_cents: 100 }, relations: { client_ref: 'Marc Tremblay' },
    } as any, ctx) as any).row;
    expect(r.title).toBe('Soumission Q-101');
    const r2 = (buildEntityRow('quote', {
      id: 'q2', row_number: 2, entity_type: 'quote', external_id: null, status: 'ready',
      normalized: { total_cents: 100 }, relations: { client_ref: 'Marc Tremblay' },
    } as any, ctx) as any).row;
    expect(r2.title).toBe('Soumission importée');
  });
});

describe('facture — rabais (discount_cents, soustrait avant taxes)', async () => {
  const { buildEntityRow } = await import('../../server/lib/migration/importer');
  const ctx = {
    migration: { org_id: 'org-1' }, createdBy: 'u',
    clientIdByRef: new Map([['marc tremblay', 'c1']]), propertyIdByRef: new Map(), jobIdByRef: new Map(),
  } as any;
  const inv = (extra: Record<string, unknown>) => (buildEntityRow('invoice', {
    id: 'x', row_number: 1, entity_type: 'invoice', external_id: null, status: 'ready',
    normalized: { invoice_number: '78', ...extra },
    relations: { client_ref: 'Marc Tremblay' },
  } as any, ctx) as any).row;

  it('sans rabais → discount_cents 0, montants inchangés', () => {
    const row = inv({ subtotal_cents: 10000, tax_cents: 1498, total_cents: 11498 });
    expect(row.discount_cents).toBe(0);
    expect(row.subtotal_cents).toBe(10000);
    expect(row.total_cents).toBe(11498);
  });
  it('sous-total brut exporté → conservé tel quel', () => {
    const row = inv({ subtotal_cents: 10000, discount_cents: 1000, tax_cents: 1348, total_cents: 10348 });
    expect(row.discount_cents).toBe(1000);
    expect(row.subtotal_cents).toBe(10000);
    expect(row.subtotal_cents - row.discount_cents + row.tax_cents).toBe(row.total_cents);
  });
  it('sous-total déjà net du rabais → remis brut pour que la facture s\'additionne', () => {
    const row = inv({ subtotal_cents: 9000, discount_cents: 1000, tax_cents: 1348, total_cents: 10348 });
    expect(row.subtotal_cents).toBe(10000);
    expect(row.subtotal_cents - row.discount_cents + row.tax_cents).toBe(row.total_cents);
  });
  it('total absent → recalculé sous-total − rabais + taxes', () => {
    const row = inv({ subtotal_cents: 10000, discount_cents: 1000, tax_cents: 1348 });
    expect(row.total_cents).toBe(10348);
  });
  it('rabais négatif → 0', () => {
    const row = inv({ subtotal_cents: 10000, discount_cents: -500, tax_cents: 0, total_cents: 10000 });
    expect(row.discount_cents).toBe(0);
  });
});

describe('rattachement client avec repli — id/nom, puis courriel, puis nom complet', async () => {
  const { buildEntityRow } = await import('../../server/lib/migration/importer');
  const ctx = {
    migration: { org_id: 'org-1' }, createdBy: 'u',
    clientIdByRef: new Map([['j-102', 'c-id'], ['marc@ex.com', 'c-mail'], ['marc tremblay', 'c-name']]),
    propertyIdByRef: new Map(), jobIdByRef: new Map(),
  } as any;
  const quote = (relations: Record<string, string>) => buildEntityRow('quote', {
    id: 'q', row_number: 1, entity_type: 'quote', external_id: null, status: 'ready',
    normalized: { quote_number: 'Q-9', total_cents: 100 }, relations,
  } as any, ctx) as any;

  it('courriel seul → client trouvé', () => {
    expect(quote({ client_email_ref: 'Marc@Ex.com' }).row.client_id).toBe('c-mail');
  });
  it('nom complet seul → client trouvé', () => {
    expect(quote({ client_name_ref: 'Marc Tremblay' }).row.client_id).toBe('c-name');
  });
  it('identifiant prioritaire sur courriel et nom', () => {
    expect(quote({ client_ref: 'J-102', client_email_ref: 'marc@ex.com', client_name_ref: 'Marc Tremblay' }).row.client_id).toBe('c-id');
  });
  it('identifiant inconnu → repli sur le courriel', () => {
    expect(quote({ client_ref: 'J-999', client_email_ref: 'marc@ex.com' }).row.client_id).toBe('c-mail');
  });
  it('aucune clé connue → orphelin', () => {
    expect(quote({ client_email_ref: 'nobody@ex.com' }).ok).toBe(false);
  });
  it('job : client_name affiché = nom de la fiche client, jamais le courriel de rattachement (2026-09-24)', () => {
    const rec = {
      id: 'j', row_number: 1, entity_type: 'job', external_id: null, status: 'ready',
      normalized: { job_number: '5', title: 'T' }, relations: { client_email_ref: 'marc@ex.com' },
    } as any;
    const sansNom = buildEntityRow('job', rec, ctx) as any;
    expect(sansNom.row.client_id).toBe('c-mail');
    expect(sansNom.row.client_name).toBeNull(); // pas de nom connu → pas de courriel à l'écran
    const avecNom = buildEntityRow('job', rec, { ...ctx, clientNameById: new Map([['c-mail', 'Marc Tremblay']]) }) as any;
    expect(avecNom.row.client_name).toBe('Marc Tremblay');
  });
});

describe('rattachement client par téléphone (repli final)', async () => {
  const { buildEntityRow, refKeysOf } = await import('../../server/lib/migration/importer');
  it('les clés d\'un client incluent ses 10 derniers chiffres de téléphone', () => {
    const keys = refKeysOf('client', {
      id: 'c', row_number: 1, entity_type: 'client', external_id: null, status: 'ready',
      normalized: { first_name: 'Marc', last_name: 'Tremblay', phone: '(438) 340-0627' }, relations: {},
    } as any);
    expect(keys).toContain('tel:4383400627');
  });
  it('facture avec téléphone seul → client trouvé, formats différents', () => {
    const ctx = {
      migration: { org_id: 'org-1' }, createdBy: 'u',
      clientIdByRef: new Map([['tel:4383400627', 'c-tel']]), propertyIdByRef: new Map(), jobIdByRef: new Map(),
    } as any;
    const inv = buildEntityRow('invoice', {
      id: 'i', row_number: 1, entity_type: 'invoice', external_id: null, status: 'ready',
      normalized: { invoice_number: '1', total_cents: 100 }, relations: { client_phone_ref: '+1 438-340-0627' },
    } as any, ctx) as any;
    expect(inv.row.client_id).toBe('c-tel');
  });
});
