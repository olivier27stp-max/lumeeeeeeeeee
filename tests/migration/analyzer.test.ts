// Analyse CSV : encodages, délimiteurs, types, masquage, injection de
// formules, fichiers vides/binaires. Tout est pur (Buffer → données).

import { describe, it, expect } from 'vitest';
import {
  analyzeCsvBuffer, detectDelimiter, detectEncoding, detectColumnType, detectCategory,
  headersLookLikeData, looksBinary, sniffIsPdf,
} from '../../server/lib/migration/analyzer';
import { maskEmail, maskPhone, sanitizeCellForDisplay } from '../../server/lib/migration/masks';

describe('détection bas niveau', () => {
  it('encodage par BOM et fallback', () => {
    expect(detectEncoding(Buffer.from('﻿a,b\n1,2'))).toBe('utf-8');
    expect(detectEncoding(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('a,b', 'utf16le')]))).toBe('utf-16le');
    expect(detectEncoding(Buffer.from('Nom,Prénom\nHélène,Côté', 'latin1'))).toBe('latin1');
  });

  it('UTF-16BE (BOM FE FF) décodé par permutation d\'octets (audit S1)', () => {
    const be = Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from('a,b\n1,2', 'utf16le').swap16()]);
    expect(detectEncoding(be)).toBe('utf-16be');
    const res = analyzeCsvBuffer(be);
    expect(res.headers).toEqual(['a', 'b']);
    expect(res.rows[0]?.a).toBe('1');
  });

  it('ponctuation Windows-1252 (’ 0x92) décodée correctement, pas en contrôle (audit S1)', () => {
    const cp1252 = Buffer.concat([
      Buffer.from('Nom\n', 'latin1'),
      Buffer.from([0x4c, 0x92]), // « L’ » avec l'apostrophe courbe CP1252
      Buffer.from('Anse H\xe9l\xe8ne\n', 'latin1'),
    ]);
    const res = analyzeCsvBuffer(cp1252);
    expect(res.rows[0]?.Nom).toBe('L’Anse Hélène');
  });

  it('délimiteurs , ; tab |', () => {
    expect(detectDelimiter('a,b,c\n1,2,3')).toBe(',');
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';');
    expect(detectDelimiter('a\tb\tc\n1\t2\t3')).toBe('\t');
    expect(detectDelimiter('a|b|c\n1|2|3')).toBe('|');
  });

  it('fins de ligne \\r seules (vieux Mac) : délimiteur détecté quand même (audit S1)', () => {
    expect(detectDelimiter('a;b;c\r1;2;3\r4;5;6')).toBe(';');
    const res = analyzeCsvBuffer(Buffer.from('a,b\r1,2\r3,4'));
    expect(res.rowCount).toBe(2);
  });

  it('binaire et PDF', () => {
    expect(looksBinary(Buffer.from([0x00, 0x01, 0x02, 0x03]))).toBe(true);
    expect(looksBinary(Buffer.from('a,b\n1,2'))).toBe(false);
    expect(sniffIsPdf(Buffer.from('%PDF-1.7 blah'))).toBe(true);
    expect(sniffIsPdf(Buffer.from('a,b\n1,2'))).toBe(false);
  });

  it('types de colonnes', () => {
    expect(detectColumnType(['a@b.com', 'c@d.ca', 'e@f.org'])).toBe('email');
    expect(detectColumnType(['514-555-1234', '(438) 555-9876', '450 555 1111'])).toBe('phone');
    expect(detectColumnType(['$1,234.56', '$99.00', '$5.25'])).toBe('money');
    expect(detectColumnType(['2024-01-05', '2024-02-10', '2024-03-15'])).toBe('date');
    expect(detectColumnType(['H2X 1Y4', 'J4W 2S9', 'G1R 5P3'])).toBe('postal_code');
  });
});

describe('analyzeCsvBuffer', () => {
  const csv = 'Customer Name,Email,Phone,Job Total\n"Marc Tremblay",marc@exemple.com,514-555-1234,$150.00\n"Julie Roy",julie@exemple.ca,438-555-9876,$275.50\n';

  it('analyse un CSV valide', () => {
    const res = analyzeCsvBuffer(Buffer.from(csv));
    expect(res.headers).toEqual(['Customer Name', 'Email', 'Phone', 'Job Total']);
    expect(res.rowCount).toBe(2);
    expect(res.columnCount).toBe(4);
    expect(res.delimiter).toBe(',');
    expect(res.rows[0]['Customer Name']).toBe('Marc Tremblay');
  });

  it('les échantillons de colonnes sont TOUJOURS masqués', () => {
    const res = analyzeCsvBuffer(Buffer.from(csv));
    const flat = JSON.stringify(res.columns.map((c) => c.samplesMasked));
    expect(flat).not.toContain('marc@exemple.com');
    expect(flat).not.toContain('514-555-1234');
    expect(flat).not.toContain('Tremblay');
  });

  it('fichier vide → 0 ligne + warning', () => {
    const res = analyzeCsvBuffer(Buffer.from(''));
    expect(res.rowCount).toBe(0);
    expect(res.warnings.length).toBeGreaterThan(0);
  });

  it('en-têtes seuls → 0 ligne de données', () => {
    const res = analyzeCsvBuffer(Buffer.from('a,b,c\n'));
    expect(res.rowCount).toBe(0);
  });

  it('en-têtes dupliqués : renommés « (2) » au lieu d\'écraser la valeur (audit S1)', () => {
    const res = analyzeCsvBuffer(Buffer.from('Email,Phone,Email\na@b.com,514-555-1234,perso@b.com\n'));
    expect(res.headers).toEqual(['Email', 'Phone', 'Email (2)']);
    expect(res.rows[0]['Email']).toBe('a@b.com');
    expect(res.rows[0]['Email (2)']).toBe('perso@b.com'); // la 2e valeur survit
    expect(res.warnings).toContain('duplicate_headers');
  });

  it('fichier sans ligne d\'en-tête : signalé, jamais deviné (audit S1)', () => {
    expect(headersLookLikeData(['marc@exemple.com', '514-555-1234', 'Marc Tremblay'])).toBe(true);
    expect(headersLookLikeData(['Customer Name', 'Email', 'Phone'])).toBe(false);
    const res = analyzeCsvBuffer(Buffer.from('julie@exemple.ca,438-555-9876\nmarc@exemple.com,514-555-1234\n'));
    expect(res.warnings).toContain('missing_header_row');
  });

  it('tokens nuls exclus de l\'inférence de type et des échantillons (audit S2)', () => {
    expect(detectColumnType(['N/A', 'a@b.com', 'c@d.ca', '-', 'e@f.org'])).toBe('email');
    const res = analyzeCsvBuffer(Buffer.from('Email\nN/A\n#REF!\na@b.com\n'));
    const emailCol = res.columns[0];
    expect(emailCol.samplesMasked.join('')).not.toContain('N/A');
    expect(emailCol.emptyRatio).toBeCloseTo(2 / 3, 2); // N/A et #REF! comptés vides
  });
});

describe('catégorie de fichier', () => {
  it('par nom de fichier (fr + en)', () => {
    expect(detectCategory('clients_export.csv', [])).toBe('clients');
    expect(detectCategory('Invoices 2024.csv', [])).toBe('invoices');
    expect(detectCategory('factures.csv', [])).toBe('invoices');
    expect(detectCategory('jobs-2024.csv', [])).toBe('jobs');
  });

  it('par signature d\'en-têtes quand le nom est neutre', () => {
    expect(detectCategory('export.csv', ['Invoice Number', 'Due Date', 'Total'])).toBe('invoices');
  });
});

describe('sécurité anti-injection CSV', () => {
  it('neutralise les préfixes de formule', () => {
    for (const evil of ['=SUM(A1:A9)', '+1+2', '@cmd', '=HYPERLINK("http://x")']) {
      expect(sanitizeCellForDisplay(evil).startsWith("'")).toBe(true);
    }
  });

  it('laisse passer les nombres négatifs et textes normaux', () => {
    expect(sanitizeCellForDisplay('-45.00')).toBe('-45.00');
    expect(sanitizeCellForDisplay('Marc Tremblay')).toBe('Marc Tremblay');
  });

  it('retire les caractères de contrôle', () => {
    expect(sanitizeCellForDisplay('abc\u0000\u0001def')).toBe('abcdef');
  });
});

describe('masquage PII', () => {
  it('courriel → a***@d***.tld', () => {
    expect(maskEmail('marc@exemple.com')).toBe('m***@e***.com');
  });
  it('téléphone → garde 4 derniers chiffres', () => {
    expect(maskPhone('514-555-1234')).toBe('***-***-1234');
  });
});
