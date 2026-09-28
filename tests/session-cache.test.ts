/**
 * requireAuthedClient garde 30 s une résolution RÉUSSIE (jeton + bureau) :
 * une page lance une dizaine d'appels, chacun refaisait auth.getUser() et
 * has_org_membership (~0,3 s, mesuré en prod le 2026-09-28).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

type Fn = (...a: unknown[]) => Promise<unknown>;
let getUser: ReturnType<typeof vi.fn<Fn>>;
let rpc: ReturnType<typeof vi.fn<Fn>>;
let utilisateurValide = true;

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { getUser: (...a: unknown[]) => getUser(...a) },
    rpc: (...a: unknown[]) => rpc(...a),
    from: () => ({ select: () => ({ eq: async () => ({ count: 1 }) }) }),
  }),
}));

const ORG_A = '11111111-1111-1111-1111-111111111111';
const ORG_B = '22222222-2222-2222-2222-222222222222';

function req(jeton: string, org?: string) {
  const h: Record<string, string> = { authorization: `Bearer ${jeton}` };
  if (org) h['x-org-id'] = org;
  return { header: (n: string) => h[n.toLowerCase()] } as any;
}
function res() {
  const r: any = { statut: 0 };
  r.status = (s: number) => { r.statut = s; return r; };
  r.json = () => r;
  return r;
}

beforeEach(() => {
  vi.resetModules();
  utilisateurValide = true;
  getUser = vi.fn<Fn>(async () => (utilisateurValide
    ? { data: { user: { id: 'u1', email: 'a@b.c' } }, error: null }
    : { data: { user: null }, error: { message: 'invalid' } }));
  rpc = vi.fn<Fn>(async () => ({ data: true, error: null }));
});

describe('requireAuthedClient — cache de session', () => {
  it('deux requêtes, même jeton et même bureau → une seule vérification', async () => {
    const { requireAuthedClient } = await import('../server/lib/supabase');
    const a = await requireAuthedClient(req('jeton-1', ORG_A), res());
    const b = await requireAuthedClient(req('jeton-1', ORG_A), res());
    expect(a?.orgId).toBe(ORG_A);
    expect(b?.orgId).toBe(ORG_A);
    expect(getUser).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('un autre bureau est revérifié (anti-IDOR intact)', async () => {
    const { requireAuthedClient } = await import('../server/lib/supabase');
    await requireAuthedClient(req('jeton-2', ORG_A), res());
    rpc = vi.fn<Fn>(async () => ({ data: false, error: null }));
    const r = res();
    const b = await requireAuthedClient(req('jeton-2', ORG_B), r);
    expect(b).toBeNull();
    expect(r.statut).toBe(403);
  });

  it('un refus n’est jamais gardé', async () => {
    const { requireAuthedClient } = await import('../server/lib/supabase');
    utilisateurValide = false;
    const r1 = res();
    expect(await requireAuthedClient(req('jeton-3', ORG_A), r1)).toBeNull();
    expect(r1.statut).toBe(401);
    utilisateurValide = true;
    expect((await requireAuthedClient(req('jeton-3', ORG_A), res()))?.orgId).toBe(ORG_A);
    expect(getUser).toHaveBeenCalledTimes(2);
  });

  it('un autre jeton est revérifié', async () => {
    const { requireAuthedClient } = await import('../server/lib/supabase');
    await requireAuthedClient(req('jeton-4', ORG_A), res());
    await requireAuthedClient(req('jeton-5', ORG_A), res());
    expect(getUser).toHaveBeenCalledTimes(2);
  });
});
