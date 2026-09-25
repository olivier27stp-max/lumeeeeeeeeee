/**
 * Rapports — export Excel : un classeur qu'un comptable ouvre sans retouche.
 * Vrais nombres et vraies dates (pas du texte), en-tête stylé et figé,
 * filtre automatique, totaux en formules, bloc d'en-tête lisible seul.
 */
import { describe, it, expect } from 'vitest';
import { PassThrough } from 'stream';
import ExcelJS from 'exceljs';
import { writeXlsx, xlsxValue, columnWidth, numFmt, sheetName, XLSX_HEADER_ROW } from '../server/lib/reports/xlsx';
import type { ExportMeta } from '../server/lib/reports/meta';
import type { ReportColumn, Row } from '../server/lib/reports/types';

const columns: ReportColumn[] = [
  { key: 'invoice_number', label: { fr: 'N°', en: 'Number' }, type: 'text', width: '90px' },
  { key: 'client', label: { fr: 'Client', en: 'Client' }, type: 'text', width: '1.4fr' },
  { key: 'issued_at', label: { fr: 'Émise le', en: 'Issued' }, type: 'date' },
  { key: 'paid_at', label: { fr: 'Payée le', en: 'Paid on' }, type: 'datetime' },
  { key: 'status', label: { fr: 'Statut', en: 'Status' }, type: 'enum', labels: { paid: { fr: 'Payée', en: 'Paid' } } },
  { key: 'total_cents', label: { fr: 'Total', en: 'Total' }, type: 'money', total: 'sum' },
  { key: 'hours', label: { fr: 'Heures', en: 'Hours' }, type: 'hours', total: 'sum' },
];

const meta: ExportMeta = {
  reportId: 'invoices', title: 'Factures', description: 'Toutes les factures.', company: 'Vision Lavage',
  period: 'Du 1 juin 2026 au 30 juin 2026', periodFrom: '2026-06-01', periodTo: '2026-06-30', dateField: null,
  filters: [{ label: 'Statut', value: 'Payée' }],
  generatedAt: '2026-09-25T18:32:00.000Z', generatedAtLabel: '25 sept. 2026, 14:32', generatedBy: 'Olivier',
  lang: 'fr', rowCount: 2,
};

const rows: Row[] = [
  { invoice_number: '1042', client: 'Plomberie "Chez Roger"', issued_at: '2026-06-03', paid_at: '2026-06-10T23:30:00.000Z', status: 'paid', total_cents: 123456, hours: 2.5 },
  { invoice_number: '=SUM(A1)', client: 'Client, virgule', issued_at: '2026-06-15T03:00:00.000Z', paid_at: null, status: 'paid', total_cents: -500, hours: null },
];

async function* batches(all: Row[]): AsyncGenerator<Row[]> { yield all; }

async function build(lang: 'fr' | 'en' = 'fr', data: Row[] = rows): Promise<ExcelJS.Workbook> {
  const out = new PassThrough();
  const chunks: Buffer[] = [];
  out.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<void>((resolve) => out.on('end', () => resolve()));
  await writeXlsx(out, { columns, meta: { ...meta, lang, rowCount: data.length }, rows: batches(data), tz: 'America/Toronto' });
  await done;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.concat(chunks));
  return wb;
}

describe('xlsxValue', () => {
  const money = columns[5]; const date = columns[2]; const dt = columns[3]; const en = columns[4];
  it('écrit les montants en dollars (nombre), pas en cents ni en texte', () => {
    expect(xlsxValue(money, 123456, 'fr')).toBe(1234.56);
    expect(xlsxValue(money, 'abc', 'fr')).toBeNull();
    expect(xlsxValue(money, '', 'fr')).toBeNull();
  });
  it('convertit une date seule en Date UTC minuit (le jour reste le bon dans Excel)', () => {
    const d = xlsxValue(date, '2026-06-03', 'fr') as Date;
    expect(d.toISOString()).toBe('2026-06-03T00:00:00.000Z');
  });
  it('ramène un horodatage à la date LOCALE de l org (23 h à Toronto reste le même jour)', () => {
    const d = xlsxValue(date, '2026-06-15T03:00:00.000Z', 'fr', 'America/Toronto') as Date;
    expect(d.toISOString()).toBe('2026-06-14T00:00:00.000Z');
    const t = xlsxValue(dt, '2026-06-10T23:30:00.000Z', 'fr', 'America/Toronto') as Date;
    expect(t.toISOString()).toBe('2026-06-10T19:30:00.000Z');
  });
  it('traduit les énumérations dans la langue demandée', () => {
    expect(xlsxValue(en, 'paid', 'fr')).toBe('Payée');
    expect(xlsxValue(en, 'paid', 'en')).toBe('Paid');
    expect(xlsxValue(en, 'unknown', 'en')).toBe('unknown');
  });
});

describe('formats et largeurs', () => {
  it('donne un format monétaire selon la langue et un format de date', () => {
    expect(numFmt(columns[5], 'fr')).toContain('"$"');
    expect(numFmt(columns[5], 'en')!.startsWith('"$"')).toBe(true);
    expect(numFmt(columns[2], 'fr')).toBe('yyyy-mm-dd');
    expect(numFmt(columns[0], 'fr')).toBeUndefined();
  });
  it('déduit la largeur de la largeur d écran, bornée', () => {
    expect(columnWidth(columns[1])).toBe(34);
    expect(columnWidth(columns[0])).toBe(13);
    expect(columnWidth(columns[5])).toBe(15);
  });
  it('nettoie le nom d onglet (31 caractères, sans caractères interdits)', () => {
    expect(sheetName('Comptes clients : en retard [2026] / *?')).toBe('Comptes clients en retard 2026');
    expect(sheetName('x'.repeat(50)).length).toBe(31);
    expect(sheetName('')).toBe('Rapport');
  });
});

describe('writeXlsx', () => {
  it('produit un classeur lisible : bloc d en-tête, en-têtes stylés en ligne 7, données typées, totaux en formules', async () => {
    const wb = await build();
    const ws = wb.worksheets[0];
    expect(ws.name).toBe('Factures');
    expect(ws.getCell('A1').value).toBe('Vision Lavage');
    expect(ws.getCell('A2').value).toBe('Factures');
    expect(String(ws.getCell('A3').value)).toContain('Période : Du 1 juin 2026 au 30 juin 2026');
    expect(String(ws.getCell('A3').value)).toContain('Statut : Payée');
    expect(String(ws.getCell('A4').value)).toContain('Généré le 25 sept. 2026, 14:32 par Olivier');

    const header = ws.getRow(XLSX_HEADER_ROW);
    expect(header.getCell(1).value).toBe('N°');
    expect(header.getCell(6).value).toBe('Total');
    expect(header.getCell(1).font?.bold).toBe(true);
    expect((header.getCell(1).fill as any)?.fgColor?.argb).toBe('FF171717');

    const r1 = ws.getRow(XLSX_HEADER_ROW + 1);
    expect(r1.getCell(1).value).toBe('1042');
    expect(r1.getCell(3).value).toBeInstanceOf(Date);
    expect(r1.getCell(5).value).toBe('Payée');
    expect(r1.getCell(6).value).toBe(1234.56);
    expect(r1.getCell(6).numFmt).toContain('#,##0.00');
    expect(r1.getCell(7).value).toBe(2.5);

    // Une chaîne qui ressemble à une formule reste une chaîne : Excel ne l évalue pas.
    const r2 = ws.getRow(XLSX_HEADER_ROW + 2);
    expect(r2.getCell(1).value).toBe('=SUM(A1)');
    expect(r2.getCell(1).type).toBe(ExcelJS.ValueType.String);
    expect(r2.getCell(6).value).toBe(-5);

    const totals = ws.getRow(XLSX_HEADER_ROW + 3);
    expect(totals.getCell(1).value).toBe('Totaux');
    const f = totals.getCell(6).value as any;
    expect(f?.formula).toBe('SUBTOTAL(109,F8:F9)');
    expect((totals.getCell(7).value as any)?.formula).toBe('SUBTOTAL(109,G8:G9)');
    expect(totals.getCell(6).font?.bold).toBe(true);
  });

  it('fige l en-tête, pose un filtre automatique et une mise en page paysage', async () => {
    const wb = await build('en');
    const ws = wb.worksheets[0];
    expect(ws.views[0]).toMatchObject({ state: 'frozen', ySplit: XLSX_HEADER_ROW });
    expect(ws.autoFilter).toBe(`A${XLSX_HEADER_ROW}:G${XLSX_HEADER_ROW + 2}`);
    expect(ws.pageSetup.orientation).toBe('landscape');
    expect(ws.pageSetup.fitToWidth).toBe(1);
    expect(ws.getRow(XLSX_HEADER_ROW).getCell(3).value).toBe('Issued');
    expect(ws.getRow(XLSX_HEADER_ROW + 1).getCell(5).value).toBe('Paid');
  });

  it('sans ligne : en-têtes présents, pas de ligne de totaux', async () => {
    const wb = await build('fr', []);
    const ws = wb.worksheets[0];
    expect(ws.getRow(XLSX_HEADER_ROW).getCell(1).value).toBe('N°');
    expect(ws.getRow(XLSX_HEADER_ROW + 1).getCell(1).value).toBeNull();
  });
});
