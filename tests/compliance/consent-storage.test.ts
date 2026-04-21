/**
 * Tests — Cookie consent local storage (Bloc 3)
 * Validates 13-month re-consent window and version invalidation.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock localStorage
const store: Record<string, string> = {};
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store[k] ?? null,
  setItem: (k: string, v: string) => { store[k] = v; },
  removeItem: (k: string) => { delete store[k]; },
});

import {
  readStoredConsent,
  writeStoredConsent,
  clearStoredConsent,
  CURRENT_COOKIE_POLICY_VERSION,
} from '../../src/lib/consentApi';

describe('cookie consent storage', () => {
  beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k];
  });

  it('returns null when no consent stored', () => {
    expect(readStoredConsent()).toBeNull();
  });

  it('writes and reads back current-version consent', () => {
    const written = writeStoredConsent({ analytics: true, marketing: false, preferences: true });
    expect(written.docVersion).toBe(CURRENT_COOKIE_POLICY_VERSION);
    const read = readStoredConsent();
    expect(read?.analytics).toBe(true);
    expect(read?.marketing).toBe(false);
    expect(read?.preferences).toBe(true);
  });

  it('invalidates consent with outdated doc version', () => {
    const stale = {
      analytics: true, marketing: true, preferences: true,
      decidedAt: new Date().toISOString(),
      docVersion: 'cookie-policy-1999-01-01',
    };
    store['lume.cookieConsent.v1'] = JSON.stringify(stale);
    expect(readStoredConsent()).toBeNull();
  });

  it('invalidates consent older than 13 months (forces re-consent)', () => {
    const old = {
      analytics: true, marketing: false, preferences: false,
      decidedAt: new Date(Date.now() - 14 * 30 * 24 * 60 * 60 * 1000).toISOString(),
      docVersion: CURRENT_COOKIE_POLICY_VERSION,
    };
    store['lume.cookieConsent.v1'] = JSON.stringify(old);
    expect(readStoredConsent()).toBeNull();
  });

  it('clear removes stored consent', () => {
    writeStoredConsent({ analytics: true, marketing: true, preferences: true });
    clearStoredConsent();
    expect(readStoredConsent()).toBeNull();
  });
});
