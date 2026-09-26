/**
 * Tests — Cookie consent local storage (Bloc 3)
 *
 * Un choix fait tient jusqu'à ce que la POLITIQUE change, et rien d'autre ne
 * le remet en question. La péremption aux 13 mois qui vivait ici a été
 * retirée le 2026-09-26 : redemander son choix à quelqu'un sans qu'aucune
 * finalité n'ait bougé, c'est le pousser à cliquer « Tout accepter » pour se
 * débarrasser du bandeau. Le test ci-dessous verrouille l'inverse de
 * l'ancien : le vieux choix DOIT survivre.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

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

  it('keeps a years-old choice: only a policy change re-prompts', () => {
    const old = {
      analytics: false, marketing: false, preferences: true,
      decidedAt: new Date(Date.now() - 3 * 365 * 24 * 60 * 60 * 1000).toISOString(),
      docVersion: CURRENT_COOKIE_POLICY_VERSION,
    };
    store['lume.cookieConsent.v1'] = JSON.stringify(old);
    // Un refus d'il y a trois ans reste un refus : le bandeau ne revient pas.
    expect(readStoredConsent()?.analytics).toBe(false);
  });

  it('no time-based expiry is smuggled back in', () => {
    // Garde-fou : une constante de péremption réintroduite dans le module
    // ferait réapparaître le bandeau chez des gens qui ont déjà répondu.
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/consentApi.ts'),
      'utf8',
    );
    expect(source).not.toContain('REVALIDATE_AFTER_MS');
    expect(source).not.toMatch(/decidedAt\).getTime\(\)/);
  });

  it('clear removes stored consent', () => {
    writeStoredConsent({ analytics: true, marketing: true, preferences: true });
    clearStoredConsent();
    expect(readStoredConsent()).toBeNull();
  });
});
