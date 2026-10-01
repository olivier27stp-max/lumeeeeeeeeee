/**
 * « job 33 », « INV-000017 » passés comme identifiants : résolus dans l'org
 * (audit des outils de Lumi, 2026-09-30). Avant : uuid invalide → « souci de connexion ».
 */
import { describe, it, expect, vi } from 'vitest';

const { lignes } = vi.hoisted(() => ({ lignes: {
  jobs: [{ id: '11111111-1111-4111-8111-111111111111', job_number: '33', org_id: 'o' }, { id: '22222222-2222-4222-8222-222222222222', job_number: 'MTL-8', org_id: 'o' }],
  invoices: [{ id: '33333333-3333-4333-8333-333333333333', invoice_number: 'INV-000017', org_id: 'o' }, { id: '44444444-4444-4444-8444-444444444444', invoice_number: 'INV-000117', org_id: 'o' }],
  quotes: [] as any[],
} as Record<string, any[]> }));
vi.mock('../server/lib/supabase', () => ({
  getServiceClient: () => ({
    from: (t: string) => {
      const f: Array<(r: any) => boolean> = [];
      const q: any = {
        select: () => q, is: () => q, limit: () => q,
        eq: (k: string, v: any) => { f.push((r) => r[k] === v); return q; },
        ilike: (k: string, v: string) => { const fin = v.replace(/^%/, ''); f.push((r) => String(r[k]).endsWith(fin)); return q; },
        then: (ok: any) => Promise.resolve({ data: lignes[t].filter((r) => f.every((x) => x(r))), error: null }).then(ok),
      };
      return q;
    },
  }),
  companyOrgIds: async () => [],
}));

import { resoudreNumeros } from '../server/lib/agent/garde';

describe('resoudreNumeros', () => {
  it('numéro exact, numéro sans préfixe, identifiant laissé tel quel', async () => {
    expect(await resoudreNumeros({ job_id: '33' }, 'o')).toEqual({ args: { job_id: '11111111-1111-4111-8111-111111111111' } });
    expect(await resoudreNumeros({ job_id: '#8' }, 'o')).toEqual({ args: { job_id: '22222222-2222-4222-8222-222222222222' } });
    expect(await resoudreNumeros({ invoice_id: 'INV-000017' }, 'o')).toEqual({ args: { invoice_id: '33333333-3333-4333-8333-333333333333' } });
    expect(await resoudreNumeros({ invoice_id: '17' }, 'o')).toEqual({ args: { invoice_id: '33333333-3333-4333-8333-333333333333' } }); // 117 n'est pas 17
    const uuid = '11111111-1111-4111-8111-111111111111';
    expect(await resoudreNumeros({ job_id: uuid, title: 'x' }, 'o')).toEqual({ args: { job_id: uuid, title: 'x' } });
  });
  it('introuvable : erreur lisible, jamais une devinette', async () => {
    expect(await resoudreNumeros({ job_id: '999' }, 'o')).toMatchObject({ erreur: expect.stringMatching(/Aucun\(e\) job n° 999/) });
    expect(await resoudreNumeros({ quote_id: '8' }, 'o')).toMatchObject({ erreur: expect.stringMatching(/devis/) });
  });
});
