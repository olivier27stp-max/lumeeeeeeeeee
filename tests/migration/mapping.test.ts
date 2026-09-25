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
    expect(entityForCategory('taxes')).toBe('tax_config');
    expect(entityForCategory('billing_addresses')).toBe('billing_property');
    expect(entityForCategory(null)).toBe(null);
  });

  it('billing_property : catalogue de champs dédié, client obligatoire', () => {
    const fields = FIELD_CATALOG.billing_property.map((f) => f.field);
    expect(fields).toEqual(expect.arrayContaining(['address', 'city', 'province', 'postal_code', 'country', 'client_ref']));
    expect(FIELD_CATALOG.billing_property.find((f) => f.field === 'client_ref')?.required).toBe(true);
    const [addr, client] = suggestMappings('billing_addresses', [col('Billing Address', 'address'), col('Customer Name', 'name', 1)], 'billing_addresses.csv');
    expect(addr.targetEntity).toBe('billing_property');
    expect(addr.targetField).toBe('address');
    expect(client.targetField).toBe('client_ref');
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

  it('facture : Created Date → created_date, Invoice Date → issued_date (deux dates distinctes)', () => {
    const suggestions = suggestMappings(
      'invoices',
      [col('Invoice #', 'id', 0), col('Invoice Date', 'date', 1), col('Created Date', 'date', 2)],
      'invoices.csv',
    );
    const byHeader = new Map(suggestions.map((s) => [s.header, s]));
    expect(byHeader.get('Invoice Date')?.targetField).toBe('issued_date');
    expect(byHeader.get('Created Date')?.targetField).toBe('created_date');
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

describe('trous de catalogue attrapés au round 8b', () => {
  it('« Assigned To » d\'un job → job.salesperson', () => {
    const [s] = suggestMappings('jobs', [col('Assigned To', 'name')], 'jobs.csv');
    expect(s.targetField).toBe('salesperson');
    expect(s.confidence).toBeGreaterThanOrEqual(90);
  });
  it('« Job # » d\'une soumission → quote.job_ref', () => {
    const [s] = suggestMappings('quotes', [col('Job #', 'id')], 'quotes.csv');
    expect(s.targetField).toBe('job_ref');
    expect(s.confidence).toBeGreaterThanOrEqual(90);
  });
});

describe('champs de rattachement client de repli', () => {
  it('présents sur soumissions, jobs, factures, propriétés et adresses de facturation', () => {
    for (const e of ['quote', 'job', 'invoice', 'property', 'billing_property'] as const) {
      const fields = FIELD_CATALOG[e].map((f) => f.field);
      expect(fields).toEqual(expect.arrayContaining(['client_ref', 'client_email_ref', 'client_name_ref']));
    }
  });
  it('« Client email » sur un fichier de soumissions → client_email_ref', () => {
    const [s] = suggestMappings('quotes', [col('Client email', 'email')], 'quotes.csv');
    expect(s.targetField).toBe('client_email_ref');
  });
  it('« Customer Name » reste sur client_ref', () => {
    const [s] = suggestMappings('quotes', [col('Customer Name', 'name')], 'quotes.csv');
    expect(s.targetField).toBe('client_ref');
  });
});

describe('manques comblés (rapport du bot, export Jobber 2026-09)', () => {
  it('« Service Street 2 » d\'un client → address_line2, jamais address', () => {
    const [s] = suggestMappings('clients', [col('Service Street 2', 'address')], 'clients.csv');
    expect(s.targetField).toBe('address_line2');
  });
  it('« Service Street 1 » reste sur address', () => {
    const [s] = suggestMappings('clients', [col('Service Street 1', 'address')], 'clients.csv');
    expect(s.targetField).toBe('address');
  });
  it('« Archived » (oui/non) → archived ; « Lead (as of …) » → is_lead', () => {
    const [a] = suggestMappings('clients', [col('Archived', 'boolean')], 'clients.csv');
    expect(a.targetField).toBe('archived');
    const [l] = suggestMappings('clients', [col('Lead (as of 2026-09-15 15:07)', 'boolean')], 'clients.csv');
    expect(l.targetField).toBe('is_lead');
  });
  it('« Lead source » reste sur lead_source', () => {
    const [s] = suggestMappings('clients', [col('Lead source', 'text')], 'clients.csv');
    expect(s.targetField).toBe('lead_source');
  });
  it('« Marked paid date » d\'une facture → paid_date, pas issued_date', () => {
    const [s] = suggestMappings('invoices', [col('Marked paid date', 'date')], 'invoices.csv');
    expect(s.targetField).toBe('paid_date');
    const [i] = suggestMappings('invoices', [col('Issued date', 'date')], 'invoices.csv');
    expect(i.targetField).toBe('issued_date');
  });
  it('« Billing address » d\'un fichier adresses de facturation → address', () => {
    const [s] = suggestMappings('billing_addresses', [col('Billing address', 'address')], 'billing.csv');
    expect(s.targetField).toBe('address');
  });
  it('address_line2 présent sur client, propriété et adresse de facturation', () => {
    for (const e of ['client', 'property', 'billing_property'] as const) {
      expect(FIELD_CATALOG[e].map((f) => f.field)).toContain('address_line2');
    }
  });
});
