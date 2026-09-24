// Multi-bureaux : l'en-tête x-org-id part sur chaque appel à /api, jamais ailleurs, et ne remplace jamais un en-tête déjà posé.
import { describe, expect, it } from 'vitest';
import { enTetesAvecBureau, estAppelApi } from '../../src/lib/apiOrgHeader';

describe('estAppelApi', () => {
  it('reconnaît /api relatif et même origine, ignore Supabase et les tiers', () => {
    expect(estAppelApi('/api/request-forms/submissions', 'https://lumecrm.net')).toBe(true);
    expect(estAppelApi('https://lumecrm.net/api/quotes', 'https://lumecrm.net')).toBe(true);
    expect(estAppelApi('https://bbzcuzqfgsdvjsymfwmr.supabase.co/rest/v1/clients', 'https://lumecrm.net')).toBe(false);
    expect(estAppelApi('https://maps.googleapis.com/x', 'https://lumecrm.net')).toBe(false);
  });
});

describe('enTetesAvecBureau', () => {
  it('ajoute x-org-id sans écraser un en-tête existant, et garde les autres', () => {
    const h = enTetesAvecBureau({ Authorization: 'Bearer t' }, '483377cd-3a25-414c-8b58-2cbf351386ef');
    expect(h.get('x-org-id')).toBe('483377cd-3a25-414c-8b58-2cbf351386ef');
    expect(h.get('authorization')).toBe('Bearer t');
    const deja = enTetesAvecBureau({ 'x-org-id': 'autre' }, '483377cd-3a25-414c-8b58-2cbf351386ef');
    expect(deja.get('x-org-id')).toBe('autre');
    expect(enTetesAvecBureau(undefined, null).has('x-org-id')).toBe(false);
  });
});
