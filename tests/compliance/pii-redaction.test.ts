/**
 * Tests — PII redaction (Bloc 1)
 * Ensures server-side redaction catches PII before it leaves to Gemini/Ollama/etc.
 */

import { describe, it, expect } from 'vitest';
import { redactPii, containsPii, redactPiiDeep } from '../../server/lib/pii-redaction';

describe('redactPii', () => {
  it('redacts emails', () => {
    const r = redactPii('Contact me at john.doe@example.com for details');
    expect(r.text).not.toContain('john.doe@example.com');
    expect(r.text).toContain('[REDACTED_EMAIL]');
    expect(r.counts.email).toBe(1);
  });

  it('redacts North American phone numbers', () => {
    const samples = ['514-555-1234', '(514) 555-1234', '1-800-555-1234', '+1 514 555 1234'];
    for (const s of samples) {
      const r = redactPii(`My number: ${s}`);
      expect(r.text).toContain('[REDACTED_PHONE]');
      expect(r.counts.phone).toBeGreaterThanOrEqual(1);
    }
  });

  it('redacts Canadian postal codes and US ZIPs', () => {
    expect(redactPii('H2X 1Y4').counts.postal).toBe(1);
    expect(redactPii('90210').counts.postal).toBe(1);
    expect(redactPii('10001-2345').counts.postal).toBe(1);
  });

  it('redacts SIN / SSN', () => {
    expect(redactPii('SIN 123 456 789').counts.sin_ssn).toBeGreaterThanOrEqual(1);
    expect(redactPii('SSN 123-45-6789').counts.sin_ssn).toBeGreaterThanOrEqual(1);
  });

  it('redacts credit cards before phones', () => {
    const r = redactPii('Card: 4111 1111 1111 1111');
    expect(r.text).toContain('[REDACTED_CC]');
    expect(r.counts.credit_card).toBeGreaterThanOrEqual(1);
  });

  it('redacts IPv4', () => {
    expect(redactPii('from 192.168.1.42').counts.ip).toBe(1);
  });

  it('redacts street addresses', () => {
    const r = redactPii('Meet at 1234 Main Street tomorrow');
    expect(r.text).toContain('[REDACTED_ADDR]');
  });

  it('leaves clean text untouched', () => {
    const clean = 'This is just product documentation with no PII.';
    expect(redactPii(clean).text).toBe(clean);
    expect(containsPii(clean)).toBe(false);
  });

  it('handles null/empty gracefully', () => {
    expect(redactPii(null).text).toBe('');
    expect(redactPii('').text).toBe('');
    expect(redactPii(undefined).counts.email).toBe(0);
  });
});

describe('redactPiiDeep', () => {
  it('recursively redacts nested objects', () => {
    const input = {
      id: 'keep-this-id',
      user: { email: 'john@example.com', phone: '514-555-1234' },
      notes: ['Call me at +1 514 555 9999', 'No PII here'],
    };
    const out = redactPiiDeep(input) as typeof input;
    expect(out.id).toBe('keep-this-id');
    expect(out.user.email).not.toContain('john@example.com');
    expect(out.user.phone).not.toContain('1234');
    expect(out.notes[0]).not.toContain('9999');
    expect(out.notes[1]).toBe('No PII here');
  });

  it('preserves whitelisted keys', () => {
    const input = { org_id: 'org-uuid-keep', status: 'active', email: 'a@b.com' };
    const out = redactPiiDeep(input) as typeof input;
    expect(out.org_id).toBe('org-uuid-keep');
    expect(out.status).toBe('active');
    expect(out.email).toContain('[REDACTED_EMAIL]');
  });
});
