// @vitest-environment jsdom
//
// Tests the REAL leaderboardApi client code: the scope ('mine' | 'all') and the
// active office (orgId + x-org-id header) must reach the server correctly.
// This is the heart of "voir mon office vs tous les offices".
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the supabase client so getAuthHeaders gets a token without a backend.
vi.mock('../src/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: { access_token: 'tok-123' } } })),
    },
  },
}));

import { getLeaderboard } from '../src/lib/leaderboardApi';

const ORG = '11111111-1111-1111-1111-111111111111';

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  // jsdom's localStorage is unreliable under this runner — use a memory stub.
  const store: Record<string, string> = { 'lume-active-org': ORG };
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => { store[k] = String(v); },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { for (const k of Object.keys(store)) delete store[k]; },
  });
  fetchMock = vi.fn(async () => ({ ok: true, json: async () => [] }) as any);
  vi.stubGlobal('fetch', fetchMock);
});

function lastCall() {
  const [url, init] = fetchMock.mock.calls[0];
  return { url: String(url), headers: (init as any).headers as Record<string, string> };
}

describe('leaderboardApi.getLeaderboard — scope plumbing', () => {
  it("scope 'mine' sends scope + active orgId + x-org-id header", async () => {
    await getLeaderboard('weekly', { scope: 'mine', orgId: ORG });
    const { url, headers } = lastCall();
    expect(url).toContain('/api/leaderboard?');
    expect(url).toContain('period=weekly');
    expect(url).toContain('scope=mine');
    expect(url).toContain(`orgId=${ORG}`);
    // The server scopes on this office only if the user is a member of it.
    expect(headers['x-org-id']).toBe(ORG);
    expect(headers.Authorization).toBe('Bearer tok-123');
  });

  it("scope 'all' sends scope=all", async () => {
    await getLeaderboard('monthly', { scope: 'all', orgId: ORG });
    const { url } = lastCall();
    expect(url).toContain('period=monthly');
    expect(url).toContain('scope=all');
  });

  it('legacy call (no opts) stays backward-compatible: no scope param', async () => {
    // Dashboard / D2D widgets call getLeaderboard('daily') — must not break.
    await getLeaderboard('daily');
    const { url } = lastCall();
    expect(url).toContain('period=daily');
    expect(url).not.toContain('scope=');
  });
});
