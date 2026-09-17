/**
 * Rapports — écriture CSV : échappement, BOM, formats par type de colonne.
 * Ce qui casse ici casse Excel chez le client (accents, virgules, formules).
 */
import { describe, it, expect } from 'vitest';
import { CSV_BOM, csvCell, csvLine, csvHeader, csvRows, formatCsvValue, csvFilename } from '../server/lib/reports/csv';
import type { ReportColumn } from '../server/lib/reports/types';

const money: ReportColumn = { key: 'total_cents', label: { fr: 'Total', en: 'Total' }, type: 'money' };
const date: ReportColumn = { key: 'd', label: { fr: 'Date', en: 'Date' }, type: 'date' };
const datetime: ReportColumn = { key: 'dt', label: { fr: 'Quand', en: 'When' }, type: 'datetime' };
const status: ReportColumn = { key: 's', label: { fr: 'Statut', en: 'Status' }, type: 'enum', labels: { paid: { fr: 'Payée', en: 'Paid' } } };

describe('csvCell', () => {
  it('met chaque champ entre guillemets et double les guillemets internes', () => {
    expect(csvCell('Plomberie "Chez Roger"')).toBe('"Plomberie ""Chez Roger"""');
    expect(csvCell('a, b')).toBe('"a, b"');
    expect(csvCell(null)).toBe('""');
  });
  it('neutralise une formule en tête de cellule', () => {
    const out = csvCell('=HYPERLINK("http://x")');
    expect(out.startsWith('"=')).toBe(false);
  });
});

describe('csvLine / csvHeader', () => {
  it('sépare par des virgules et termine par CRLF', () => {
    expect(csvLine(['a', 'b'])).toBe('"a","b"\r\n');
  });
  it("commence par le BOM UTF-8 pour qu'Excel lise les accents", () => {
    const h = csvHeader([money, date], 'fr');
    expect(h.startsWith(CSV_BOM)).toBe(true);
    expect(h).toContain('"Total","Date"\r\n');
  });
  it('prend les libellés dans la langue demandée', () => {
    expect(csvHeader([status], 'en')).toContain('"Status"');
  });
});

describe('formatCsvValue', () => {
  it('écrit les montants en dollars avec deux décimales et un point', () => {
    expect(formatCsvValue(money, 123456, 'fr')).toBe('1234.56');
    expect(formatCsvValue(money, 0, 'fr')).toBe('0.00');
    expect(formatCsvValue(money, null, 'fr')).toBe('');
  });
  it('garde une date seule telle quelle et ramène un timestamp à la date locale de l org', () => {
    expect(formatCsvValue(date, '2026-09-15', 'fr')).toBe('2026-09-15');
    // 03:30Z le 16 = 23:30 le 15 à Toronto (UTC-4 en été)
    expect(formatCsvValue(date, '2026-09-16T03:30:00Z', 'fr')).toBe('2026-09-15');
  });
  it('écrit les horodatages en heure locale « YYYY-MM-DD HH:mm »', () => {
    expect(formatCsvValue(datetime, '2026-09-16T03:30:00Z', 'fr')).toBe('2026-09-15 23:30');
  });
  it('traduit les énumérations et laisse la valeur brute inconnue', () => {
    expect(formatCsvValue(status, 'paid', 'fr')).toBe('Payée');
    expect(formatCsvValue(status, 'paid', 'en')).toBe('Paid');
    expect(formatCsvValue(status, 'weird', 'fr')).toBe('weird');
  });
  it('csvRows produit une ligne par enregistrement dans l ordre des colonnes', () => {
    const out = csvRows([money, status], [{ total_cents: 100, s: 'paid' }, { total_cents: 250, s: 'x' }], 'fr');
    expect(out).toBe('"1.00","Payée"\r\n"2.50","x"\r\n');
  });
});

describe('csvFilename', () => {
  it('nomme le fichier par rapport et période, sans caractères douteux', () => {
    expect(csvFilename('aged-receivables', '2026-01-01', '2026-01-31')).toBe('rapport-aged-receivables-2026-01-01_2026-01-31.csv');
    expect(csvFilename('x/../y', undefined, undefined, '2026-09-17')).toBe('rapport-xy-2026-09-17.csv');
  });
});
