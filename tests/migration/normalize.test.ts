// Normalisation : argent → cents, dates flexibles, courriels, téléphones,
// scission du nom complet, clés de relation.

import { describe, it, expect } from 'vitest';
import {
  normalizeAddressKey, normalizeDigits, normalizeRow, parseDateFlexible,
  parseDateTimeFlexible, parseMoneyToCents,
} from '../../server/lib/migration/normalize';

describe('parseMoneyToCents', () => {
  it('formats usuels en/fr', () => {
    expect(parseMoneyToCents('$1,234.56')).toBe(123456);
    expect(parseMoneyToCents('1 234,56 $')).toBe(123456);
    expect(parseMoneyToCents('150')).toBe(15000);
    expect(parseMoneyToCents('99.5')).toBe(9950);
    expect(parseMoneyToCents('(45.00)')).toBe(-4500);
    expect(parseMoneyToCents('-12.25')).toBe(-1225);
  });
  it('invalide → null', () => {
    expect(parseMoneyToCents('abc')).toBeNull();
    expect(parseMoneyToCents('')).toBeNull();
    expect(parseMoneyToCents('12.34.56')).toBeNull();
  });
});

describe('parseDateFlexible', () => {
  it('ISO, US, DD/MM certain, mois textuels fr/en', () => {
    expect(parseDateFlexible('2024-03-05')).toBe('2024-03-05');
    expect(parseDateFlexible('03/05/2024')).toBe('2024-03-05'); // MM/DD par défaut
    expect(parseDateFlexible('25/03/2024')).toBe('2024-03-25'); // jour > 12 ⇒ DD/MM
    expect(parseDateFlexible('Mar 5, 2024')).toBe('2024-03-05');
    expect(parseDateFlexible('5 mars 2024')).toBe('2024-03-05');
  });
  it('invalide → null', () => {
    expect(parseDateFlexible('13/13/2024')).toBeNull();
    expect(parseDateFlexible('2024-02-30')).toBeNull();
    expect(parseDateFlexible('bientôt')).toBeNull();
  });
});

describe('parseDateTimeFlexible', () => {
  it('date + heure, AM/PM, date seule → minuit', () => {
    expect(parseDateTimeFlexible('2024-03-05 14:30')).toBe('2024-03-05T14:30:00');
    expect(parseDateTimeFlexible('03/05/2024 2:30 PM')).toBe('2024-03-05T14:30:00');
    expect(parseDateTimeFlexible('2024-03-05')).toBe('2024-03-05T00:00:00');
  });
});

describe('normalizeAddressKey / normalizeDigits', () => {
  it('clé d\'adresse stable (accents, abréviations)', () => {
    expect(normalizeAddressKey('123 Rue Saint-Denis Été')).toBe(normalizeAddressKey('123 rue saint denis ete'));
    expect(normalizeAddressKey('45 Boulevard des Pins')).toBe('45 blvd des pins');
  });
  it('téléphone → chiffres seuls', () => {
    expect(normalizeDigits('(514) 555-1234')).toBe('5145551234');
  });
});

describe('normalizeRow', () => {
  it('convertit selon la correspondance et extrait les relations', () => {
    const res = normalizeRow(
      'invoice',
      { 'Invoice #': 'INV-042', Amount: '$150.00', 'Due Date': '03/15/2024', Client: 'Marc Tremblay', Notes: 'merci' },
      { 'Invoice #': 'invoice_number', Amount: 'total', 'Due Date': 'due_date', Client: 'client_ref', Notes: 'notes' },
    );
    expect(res.normalized.invoice_number).toBe('INV-042');
    expect(res.normalized.total_cents).toBe(15000);
    expect(res.normalized.due_date).toBe('2024-03-15');
    expect(res.relations.client_ref).toBe('Marc Tremblay');
    expect(res.problems).toEqual([]);
  });

  it('signale les valeurs invalides sans planter', () => {
    const res = normalizeRow('invoice', { Amount: 'n/a', 'Due Date': 'jamais' }, { Amount: 'total', 'Due Date': 'due_date' });
    expect(res.problems).toContain('invalid_money:total');
    expect(res.problems).toContain('invalid_date:due_date');
  });

  it('client : full_name scindé en prénom/nom', () => {
    const res = normalizeRow('client', { Name: 'Marie Ève Gagnon' }, { Name: 'full_name' });
    expect(res.normalized.first_name).toBe('Marie Ève');
    expect(res.normalized.last_name).toBe('Gagnon');
  });

  it('courriel invalide signalé, valide normalisé en minuscules', () => {
    const bad = normalizeRow('client', { Email: 'pas-un-courriel' }, { Email: 'email' });
    expect(bad.problems).toContain('invalid_email:email');
    const good = normalizeRow('client', { Email: 'Marc@Exemple.COM' }, { Email: 'email' });
    expect(good.normalized.email).toBe('marc@exemple.com');
  });
});
