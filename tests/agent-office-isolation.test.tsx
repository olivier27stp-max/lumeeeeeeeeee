// @vitest-environment jsdom
//
// Mr Lume (Lume Agent) must only ever touch the ACTIVE office — never mix data
// across offices of the same company group. Two guarantees:
//   1. Read tools that use an RPC scope it to the active office (p_org = ctx.orgId),
//      not current_org_id() (which is the user's first office).
//   2. The frontend agent API sends x-org-id (the active office) so the server's
//      requireAuthedClient scopes ctx.orgId to it.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const ORG = '33333333-3333-3333-3333-333333333333';

// ── 1. Tool-level isolation (real tool code) ───────────────────────────
import { TOOLS_BY_NAME } from '../server/lib/agent/tools';

describe('Lume Agent tools — RPC scoped to the active office', () => {
  it('list_invoices passes p_org = ctx.orgId (not null → no first-office leak)', async () => {
    const rpc = vi.fn(async () => ({ data: [], error: null }));
    const ctx = { client: { rpc } as any, orgId: ORG, userId: 'u' };
    const tool = TOOLS_BY_NAME['list_invoices'];
    expect(tool?.handler).toBeTypeOf('function');
    await tool.handler!({}, ctx as any);
    expect(rpc).toHaveBeenCalledWith(
      'rpc_list_invoices',
      expect.objectContaining({ p_org: ORG }),
    );
  });
});

// ── 2. Frontend sends the active office ────────────────────────────────
vi.mock('../src/lib/supabase', () => ({
  supabase: {
    auth: { getSession: vi.fn(async () => ({ data: { session: { access_token: 'tok' } } })) },
  },
}));

import { sendAgentMessage } from '../src/features/agent/lib/agentApi';

describe('agentApi — sends x-org-id (active office)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    const store: Record<string, string> = { 'lume-active-org': ORG };
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => { store[k] = String(v); },
      removeItem: (k: string) => { delete store[k]; },
      clear: () => { for (const k of Object.keys(store)) delete store[k]; },
    });
    fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ reply: 'ok', proposedAction: null }),
    }) as any);
    vi.stubGlobal('fetch', fetchMock);
  });

  it('chat request carries x-org-id = active office', async () => {
    await sendAgentMessage([{ role: 'user', content: 'salut' } as any], 'fr');
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('/api/agent/chat');
    expect((init as any).headers['x-org-id']).toBe(ORG);
    expect((init as any).headers.Authorization).toBe('Bearer tok');
  });
});
