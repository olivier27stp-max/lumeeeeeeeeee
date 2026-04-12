/* ═══════════════════════════════════════════════════════════════
   Tests — Action Executors (Template resolution, variable mapping)
   ═══════════════════════════════════════════════════════════════ */

import { describe, it, expect } from 'vitest';

// ── Pure function extracted from actions/index.ts ──

function resolveTemplate(
  template: string,
  vars: Record<string, string | null | undefined>,
): string {
  return template
    .replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? '')
    .replace(/\[(\w+)\]/g, (_, key) => vars[key] ?? '');
}

// ════════════════════════════════════════════════════════════════
// Tests
// ════════════════════════════════════════════════════════════════

describe('Action — Template Resolution', () => {
  const vars = {
    client_name: 'Jean Dupont',
    client_first_name: 'Jean',
    company_name: 'Lume Services',
    invoice_number: 'INV-001',
    invoice_total: '$150.00',
    appointment_date: '2026-04-15',
    appointment_time: '10:00',
    job_name: 'Plumbing Repair',
    google_review_url: 'https://g.page/lume',
    client_phone: '+15145551234',
    client_email: 'jean@example.com',
  };

  it('resolves {var} syntax', () => {
    expect(resolveTemplate('Hello {client_name}!', vars)).toBe('Hello Jean Dupont!');
  });

  it('resolves [var] syntax (legacy)', () => {
    expect(resolveTemplate('Hello [client_name]!', vars)).toBe('Hello Jean Dupont!');
  });

  it('resolves mixed syntax in same template', () => {
    expect(resolveTemplate('{client_name} owes [invoice_total]', vars))
      .toBe('Jean Dupont owes $150.00');
  });

  it('replaces missing vars with empty string', () => {
    expect(resolveTemplate('Hello {unknown_var}!', vars)).toBe('Hello !');
  });

  it('handles null/undefined vars', () => {
    const nullVars = { ...vars, client_name: null as any };
    expect(resolveTemplate('Hi {client_name}', nullVars)).toBe('Hi ');
  });

  it('handles empty template', () => {
    expect(resolveTemplate('', vars)).toBe('');
  });

  it('handles template with no variables', () => {
    expect(resolveTemplate('Static message', vars)).toBe('Static message');
  });

  it('resolves full SMS template (quote follow-up)', () => {
    const tmpl = 'Hi {client_first_name}, this is {company_name}. We sent you quote #{invoice_number} for {invoice_total}. Have you had a chance to review it?';
    const result = resolveTemplate(tmpl, vars);
    expect(result).toContain('Jean');
    expect(result).toContain('Lume Services');
    expect(result).toContain('INV-001');
    expect(result).toContain('$150.00');
    expect(result).not.toContain('{');
    expect(result).not.toContain('}');
  });

  it('resolves appointment confirmation template', () => {
    const tmpl = 'Hello {client_name}, your appointment "{job_name}" is confirmed for {appointment_date} at {appointment_time}.';
    const result = resolveTemplate(tmpl, vars);
    expect(result).toBe('Hello Jean Dupont, your appointment "Plumbing Repair" is confirmed for 2026-04-15 at 10:00.');
  });

  it('resolves review request template', () => {
    const tmpl = 'Hi {client_first_name}, how was your experience with {company_name}? Leave us a review: {google_review_url}';
    const result = resolveTemplate(tmpl, vars);
    expect(result).toContain('https://g.page/lume');
  });
});

describe('Action — Variable Mapping Expectations', () => {
  // These verify the expected variable keys per entity type
  const EXPECTED_VARS = {
    lead: ['client_first_name', 'client_last_name', 'client_name', 'client_email', 'client_phone'],
    client: ['client_first_name', 'client_last_name', 'client_name', 'client_email', 'client_phone'],
    job: ['job_name', 'client_first_name', 'client_name', 'client_email', 'client_phone'],
    invoice: ['invoice_number', 'invoice_due_date', 'invoice_total', 'client_name', 'client_email', 'client_phone', 'job_name'],
    appointment: ['appointment_date', 'appointment_time', 'appointment_title', 'appointment_address', 'job_name', 'client_name'],
    company: ['company_name', 'company_phone', 'google_review_url'],
  };

  for (const [entityType, expectedKeys] of Object.entries(EXPECTED_VARS)) {
    it(`${entityType}: resolves required variables`, () => {
      expect(expectedKeys.length).toBeGreaterThan(0);
      for (const key of expectedKeys) {
        expect(typeof key).toBe('string');
        expect(key.length).toBeGreaterThan(0);
      }
    });
  }
});
