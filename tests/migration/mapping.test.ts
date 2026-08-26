// Correspondance déterministe : exact > synonyme > partiel > type seul, et
// validation humaine obligatoire sous 70 % de confiance.

import { describe, it, expect } from 'vitest';
import { FIELD_CATALOG, entityForCategory, normalizeHeader, suggestMappings } from '../../server/lib/migration/mapping';
import type { AnalyzedColumn } from '../../server/lib/migration/types';

function col(header: string, detectedType: AnalyzedColumn['detectedType'], position = 0): AnalyzedColumn {
  return { position, header, detectedType, emptyRatio: 0, samplesMasked: [] };
}

describe('normalizeHeader', () => {
  it('minuscule, accents retirés, ponctuation → espaces', () => {
    expect(normalizeHeader('Téléphone (mobile)')).toBe('telephone mobile');
    expect(normalizeHeader('  Invoice_Number ')).toBe('invoice number');
  });
});

describe('entityForCategory', () => {
  it('mappe les catégories vers les entités', () => {
    expect(entityForCategory('clients')).toBe('client');
    expect(entityForCategory('invoices')).toBe('invoice');
    expect(entityForCategory(null)).toBe(null);
  });
});

describe('suggestMappings — échelle de confiance', () => {
  it('synonyme connu → confiance élevée, pas de revue', () => {
    const [s] = suggestMappings('clients', [col('Customer Name', 'name')], 'clients.csv');
    expect(s.targetEntity).toBe('client');
    expect(s.targetField).toBe('full_name');
    expect(s.confidence).toBeGreaterThanOrEqual(90);
    expect(s.needsReview).toBe(false);
  });

  it('« Courriel » (fr) est reconnu', () => {
    const [s] = suggestMappings('clients', [col('Courriel', 'email')], 'clients.csv');
    expect(s.targetField).toBe('email');
    expect(s.confidence).toBeGreaterThanOrEqual(90);
  });

  it('colonne inconnue de type texte → validation humaine obligatoire', () => {
    const [s] = suggestMappings('clients', [col('Zorblatt', 'text')], 'clients.csv');
    expect(s.confidence).toBeLessThan(70);
    expect(s.needsReview).toBe(true);
  });

  it('deux colonnes vers le même champ : une seule garde la confiance élevée', () => {
    const suggestions = suggestMappings(
      'clients',
      [col('Email', 'email', 0), col('E-mail Address', 'email', 1)],
      'clients.csv',
    );
    const emails = suggestions.filter((s) => s.targetField === 'email' && s.confidence >= 90 && !s.needsReview);
    expect(emails.length).toBeLessThanOrEqual(1);
    expect(suggestions.some((s) => s.needsReview || s.confidence < 90)).toBe(true);
  });

  it('facture : Invoice # → invoice_number ; Amount → montant', () => {
    const suggestions = suggestMappings(
      'invoices',
      [col('Invoice #', 'id', 0), col('Amount', 'money', 1), col('Due Date', 'date', 2)],
      'invoices.csv',
    );
    const byHeader = new Map(suggestions.map((s) => [s.header, s]));
    expect(byHeader.get('Invoice #')?.targetField).toBe('invoice_number');
    expect(byHeader.get('Due Date')?.targetField).toBe('due_date');
    expect(byHeader.get('Amount')?.targetEntity).toBe('invoice');
  });
});

describe('catalogue de champs', () => {
  it('chaque entité expose des champs avec libellés bilingues et synonymes minuscules', () => {
    for (const [entity, fields] of Object.entries(FIELD_CATALOG)) {
      expect(fields.length, entity).toBeGreaterThan(0);
      for (const f of fields) {
        expect(f.labelFr.length).toBeGreaterThan(0);
        expect(f.labelEn.length).toBeGreaterThan(0);
        for (const syn of f.synonyms) expect(syn).toBe(syn.toLowerCase());
      }
    }
  });
});

describe('précision du catalogue (leçons E2E)', () => {
  it('« Notes » d\'un job va dans job.notes, pas dans description', () => {
    const [s] = suggestMappings('jobs', [col('Notes', 'text')], 'jobs.csv');
    expect(s.targetField).toBe('notes');
    expect(s.confidence).toBeGreaterThanOrEqual(95);
  });
});
