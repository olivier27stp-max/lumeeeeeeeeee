// VAGUE 4 — les fonctions API de l'interface des automatisations
// (audit V2, 11-interface.md §9), devant un faux client Supabase.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const etat = { lignesModifiees: [] as unknown[], ecritures: [] as unknown[] };
vi.mock('../src/lib/supabase', () => {
  const chaine: Record<string, unknown> = {};
  Object.assign(chaine, {
    select: () => chaine,
    eq: () => chaine,
    update: (p: unknown) => { etat.ecritures.push(p); return chaine; },
    then: (ok: (r: unknown) => unknown) => Promise.resolve({ data: etat.lignesModifiees, error: null }).then(ok),
  });
  return { supabase: { from: () => chaine, auth: { getSession: async () => ({ data: { session: { access_token: 't' } } }) } } };
});
vi.mock('../src/lib/orgApi', () => ({ getCurrentOrgId: async () => 'org-1' }));

import { setAutomationLanguage } from '../src/lib/automationRulesApi';

beforeEach(() => {
  etat.lignesModifiees = [];
  etat.ecritures = [];
});

describe('A-07 — « Messages en FR/EN » ne ment plus sur un refus silencieux', () => {
  it('0 ligne modifiée (RLS : rôle sans droit sur les réglages) = une erreur dite', async () => {
    etat.lignesModifiees = [];
    await expect(setAutomationLanguage('en')).rejects.toThrow(/administrateur|administrator/);
  });

  it('une ligne modifiée = succès', async () => {
    etat.lignesModifiees = [{ org_id: 'org-1' }];
    await expect(setAutomationLanguage('en')).resolves.toBeUndefined();
    expect(etat.ecritures).toEqual([{ default_language: 'en' }]);
  });
});

describe('A-09 — le navigateur envoie la langue de l’interface aux routes des automatisations', () => {
  it('Accept-Language suit « lume-language » (fr par défaut)', async () => {
    const { creerDossier } = await import('../src/lib/automationBuilderApi');
    const { listerAdressesDAppel } = await import('../src/lib/automationWebhooksApi');
    const vus: Array<Record<string, string>> = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      vus.push((init?.headers ?? {}) as Record<string, string>);
      return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }));
    let langue: string | null = 'en';
    vi.stubGlobal('localStorage', { getItem: () => langue, setItem: () => {}, removeItem: () => {} });
    await creerDossier('Relances');
    await listerAdressesDAppel();
    langue = null;
    await creerDossier('Relances');
    expect(vus.map((h) => h['Accept-Language'])).toEqual(['en', 'en', 'fr']);
    vi.unstubAllGlobals();
  });
});

describe('A-11 — réseau coupé : un message lisible, jamais « Failed to fetch »', () => {
  it('liste (publication) et pause disent « Connexion perdue », dans la langue de l’interface', async () => {
    const { changerPublication } = await import('../src/lib/automationBuilderApi');
    const { basculerPause } = await import('../src/lib/automationWebhooksApi');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    let langue: string | null = null;
    vi.stubGlobal('localStorage', { getItem: () => langue, setItem: () => {}, removeItem: () => {} });
    await expect(changerPublication('r1', true)).rejects.toThrow(/^Connexion perdue/);
    await expect(basculerPause(true)).rejects.toThrow(/^Connexion perdue/);
    langue = 'en';
    await expect(changerPublication('r1', true)).rejects.toThrow(/^Connection lost/);
    vi.unstubAllGlobals();
  });
});
