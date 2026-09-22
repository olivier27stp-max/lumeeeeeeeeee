// Formulaire « Importer vos données » : analyse directe des fichiers déposés (compte d'éléments
// uniques, doublons internes, lignes à corriger, identifiants manquants), lecture Excel,
// catégorie « plans récurrents », entité paiements de bout en bout (pur, sans base).
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { analyzeCsvBuffer, detectCategory } from '../../server/lib/migration/analyzer';
import { suggestMappings, entityForCategory } from '../../server/lib/migration/mapping';
import { resumerLignes } from '../../server/lib/migration/resume-fichier';
import { convertirExcelEnCsv, sniffIsExcel } from '../../server/lib/migration/pipeline';
import { buildEntityRow, mapPaymentMethod, planIntraDedupe, IMPORT_ORDER, TABLE_BY_ENTITY, type BuildContext, type StagingRow } from '../../server/lib/migration/importer';
import type { MigrationCategory, TargetEntity } from '../../server/lib/migration/types';

/** Parcours d'analyse d'un fichier tel que le pipeline l'enchaîne (sans base) : CSV → colonnes → correspondances utilisables → résumé. */
async function analyserFichier(nom: string, csv: string, declared?: MigrationCategory) {
  const analyzed = await analyzeCsvBuffer(Buffer.from(csv, 'utf8'));
  const detected = detectCategory(nom, analyzed.headers);
  const category = declared ?? detected;
  const entity = entityForCategory(category)!;
  const fieldByHeader: Record<string, string> = {};
  for (const s of suggestMappings(category, analyzed.columns, nom)) {
    if (s.targetField && (!s.needsReview && s.confidence >= 70)) fieldByHeader[s.header] = s.targetField;
  }
  const rows = analyzed.rows.map((payload, i) => ({ id: `r${i + 1}`, row_number: i + 1, payload }));
  return { analyzed, detected, category, entity, fieldByHeader, resume: resumerLignes(entity, rows, fieldByHeader) };
}

describe('résumé direct dans le formulaire — éléments uniques, pas lignes', () => {
  it('une facture de 5 lignes de services compte pour UNE facture', async () => {
    const lignes = ['Invoice #,Client name,Client email,Issued date,Line item,Total ($)'];
    for (const inv of ['1001', '1002', '1003']) for (let i = 1; i <= 5; i++) lignes.push(`${inv},Denise Côté,denise@ex.ca,2026-03-0${i},Service ${i},150.00`);
    const r = await analyserFichier('Invoices_Report.csv', lignes.join('\n'));
    expect(r.entity).toBe('invoice');
    expect(r.resume.rows).toBe(15);
    expect(r.resume.unique).toBe(3);
    expect(r.resume.internal_duplicates).toBe(12);
    expect(r.resume.identifiers_ok).toBe(true);
  });

  it('clients : même courriel = même client ; lignes sans données = à corriger', async () => {
    const csv = [
      'First name,Last name,Email,Phone,Service Street 1',
      'Nicole,Hébert,nicole@ex.ca,819-555-0101,12 rue A',
      'Nicole,Hebert,nicole@ex.ca,819-555-0101,12 rue A',
      'Gilles,Roy,,819-555-0202,44 rue B',
      'Report totals:,,,,',
    ].join('\n');
    const r = await analyserFichier('Jobber Clients.csv', csv);
    expect(r.entity).toBe('client');
    expect(r.resume.unique).toBe(3); // Nicole ×2 fusionnées, Gilles, « Report totals » (nom seul, sans clé forte)
    expect(r.resume.internal_duplicates).toBe(1);
    expect(r.resume.invalid).toBe(0);
  });

  it('fichier sans colonne identifiante : pas de faux compte, on demande la correspondance', () => {
    const rows = [{ id: 'a', row_number: 1, payload: { Titre: 'Lavage', Prix: '100' } }, { id: 'b', row_number: 2, payload: { Titre: 'Lavage', Prix: '120' } }];
    const r = resumerLignes('job', rows, { Titre: 'title', Prix: 'total' });
    expect(r.identifiers_ok).toBe(false);
    expect(r.identifier_labels).toContain('Numéro de job');
  });

  it('montants illisibles : la ligne est comptée « à corriger » avec son motif', () => {
    const rows = [
      { id: 'a', row_number: 1, payload: { 'Invoice #': '9', 'Total ($)': 'abc' } },
      { id: 'b', row_number: 2, payload: { 'Invoice #': '10', 'Total ($)': '50.00' } },
    ];
    const r = resumerLignes('invoice', rows, { 'Total ($)': 'total' }); // seul le total est mappé : la ligne 1 n'a aucune valeur exploitable
    expect(r.invalid).toBe(1);
    expect(r.invalid_reasons[0].reason).toBe('invalid_money:total');
    expect(r.unique).toBe(1);
  });
});

describe('Excel', () => {
  it('reconnaît un .xlsx à sa signature et lit sa première feuille comme un CSV', async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Job #', 'Client name', 'Frequency', 'Total ($)'], ['501', 'Espace 20', 'Every 2 weeks', 95.5]]), 'Recurring');
    const buf = Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
    expect(sniffIsExcel(buf, 'xlsx')).toBe(true);
    expect(sniffIsExcel(Buffer.from('a,b\n1,2'), 'xlsx')).toBe(false);
    const csv = await convertirExcelEnCsv(buf);
    const analyzed = await analyzeCsvBuffer(csv);
    expect(analyzed.headers).toEqual(['Job #', 'Client name', 'Frequency', 'Total ($)']);
    expect(analyzed.rowCount).toBe(1);
    expect(analyzed.rows[0]['Client name']).toBe('Espace 20');
  });
});

describe('plans de service récurrents', () => {
  it('« Recurring jobs » est détecté comme plans récurrents, entité job', () => {
    expect(detectCategory('Recurring jobs_Report.csv', ['Job #', 'Client name', 'Schedule'])).toBe('recurring_jobs');
    expect(detectCategory('export.csv', ['Job #', 'Client name', 'Frequency', 'Total ($)'])).toBe('recurring_jobs');
    expect(detectCategory('export.csv', ['Job #', 'Client name', 'Total ($)'])).toBe('jobs');
    expect(entityForCategory('recurring_jobs')).toBe('job');
  });
  it('un job marqué récurrent au staging sort avec job_type = recurring et sa cadence dans les notes', () => {
    const ctx: BuildContext = { migration: { org_id: 'o' } as any, createdBy: 'u', clientIdByRef: new Map([['a@b.ca', 'c1']]), propertyIdByRef: new Map(), jobIdByRef: new Map() };
    const rec = { id: 'j', row_number: 1, entity_type: 'job', external_id: null, normalized: { job_number: '501', job_type: 'recurring', frequency: 'Every 2 weeks' }, relations: { client_email_ref: 'a@b.ca' }, status: 'ready' } as StagingRow;
    const r = buildEntityRow('job', rec, ctx);
    expect(r.ok).toBe(true);
    expect((r as any).row.job_type).toBe('recurring');
    expect(String((r as any).row.notes)).toContain('Every 2 weeks');
    const ponctuel = buildEntityRow('job', { ...rec, normalized: { job_number: '502' } } as StagingRow, ctx);
    expect((ponctuel as any).row.job_type).toBe('one_off');
  });
});

describe('paiements — entité importable de bout en bout', () => {
  const ctx = (): BuildContext => ({ migration: { org_id: 'o' } as any, createdBy: 'u', clientIdByRef: new Map([['a@b.ca', 'c1']]), propertyIdByRef: new Map(), jobIdByRef: new Map(), invoiceIdByRef: new Map([['1001', 'inv-1']]) });
  const rec = (normalized: Record<string, unknown>, relations: Record<string, string>): StagingRow => ({ id: 'p', row_number: 1, entity_type: 'payment', external_id: null, normalized, relations, status: 'ready' } as StagingRow);

  it('est dans l\'ordre d\'import après les factures, vers la table payments', () => {
    expect(IMPORT_ORDER.indexOf('payment' as TargetEntity)).toBeGreaterThan(IMPORT_ORDER.indexOf('invoice' as TargetEntity));
    expect(TABLE_BY_ENTITY.payment).toBe('payments');
  });
  it('rattaché à la facture par numéro, montant en cents, mode normalisé, statut succeeded', () => {
    const r = buildEntityRow('payment', rec({ amount_cents: 15000, date: '2026-03-05', method: 'Interac e-Transfer' }, { invoice_ref: '1001', client_email_ref: 'a@b.ca' }), ctx());
    expect(r.ok).toBe(true);
    const row = (r as any).row;
    expect(row.invoice_id).toBe('inv-1');
    expect(row.client_id).toBe('c1');
    expect(row.amount_cents).toBe(15000);
    expect(row.method).toBe('e-transfer');
    expect(row.status).toBe('succeeded');
    expect(row.payment_date).toBe('2026-03-05T12:00:00');
  });
  it('sans facture ni client reconnus → orphelin signalé, jamais rattaché au hasard', () => {
    const r = buildEntityRow('payment', rec({ amount_cents: 100 }, { invoice_ref: '9999' }), ctx());
    expect(r.ok).toBe(false);
    expect((r as any).reason).toBe('orphan');
  });
  it('montant nul ou absent → invalide', () => {
    const r = buildEntityRow('payment', rec({ amount_cents: 0 }, { invoice_ref: '1001' }), ctx());
    expect(r.ok).toBe(false);
    expect((r as any).reason).toBe('invalid');
  });
  it('même facture + montant + date = doublon interne (pas de double encaissement à la reprise)', () => {
    const a = rec({ amount_cents: 15000, date: '2026-03-05' }, { invoice_ref: '1001' });
    const b = { ...a, id: 'p2', row_number: 2 } as StagingRow;
    const plan = planIntraDedupe('payment', [a, b]);
    expect(plan.siblingOf.get('p2')).toBe('p');
  });
  it('modes de paiement', () => {
    expect(mapPaymentMethod('Visa')).toBe('card');
    expect(mapPaymentMethod('Cash')).toBe('cash');
    expect(mapPaymentMethod('Chèque')).toBe('cheque');
    expect(mapPaymentMethod('Virement Interac')).toBe('e-transfer');
    expect(mapPaymentMethod('')).toBe('other');
  });
});
