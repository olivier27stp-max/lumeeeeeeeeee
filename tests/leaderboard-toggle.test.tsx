// @vitest-environment jsdom
//
// Tests the REAL Leaderboard page: the "Mon office / Tous les offices" toggle
// must drive which scope is requested — default 'mine', then 'all' on click.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const getLeaderboardMock = vi.fn(async (..._args: any[]) => [] as any[]);
vi.mock('../src/lib/leaderboardApi', () => ({
  getLeaderboard: (...args: any[]) => getLeaderboardMock(...args),
  getRepPerformance: vi.fn(async () => ({ performance: {}, badges: [] })),
  // Leaderboard.tsx loads the office list on mount; the mock must provide it
  // or the component's effect throws ("No getOffices export …"). The scope
  // toggle only renders when the company has 2+ offices, so return two.
  getOffices: vi.fn(async () => ({
    offices: [
      { id: '11111111-1111-1111-1111-111111111111', name: 'Bureau A' },
      { id: '22222222-2222-2222-2222-222222222222', name: 'Bureau B' },
    ],
    activeOrgId: '11111111-1111-1111-1111-111111111111',
  })),
}));

const ORG = '11111111-1111-1111-1111-111111111111';

import Leaderboard from '../src/pages/Leaderboard';
import { CompanyContext } from '../src/contexts/CompanyContext';
import type { CompanyContextValue } from '../src/contexts/CompanyContext';

const ctx = {
  current: { orgId: ORG, companyName: 'Bureau A' },
  currentOrgId: ORG,
  currentRole: 'owner',
  currentScope: 'org',
  currentPermissions: {},
  companies: [{ orgId: ORG, companyName: 'Bureau A' }],
  loading: false,
  isMultiCompany: false,
  hasNoCompany: false,
  switchCompany: () => {},
  refresh: async () => {},
  userId: 'user-1',
} as unknown as CompanyContextValue;

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  getLeaderboardMock.mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render() {
  await act(async () => {
    root.render(
      <MemoryRouter>
        <CompanyContext.Provider value={ctx}>
          <Leaderboard />
        </CompanyContext.Provider>
      </MemoryRouter>,
    );
  });
  await act(async () => {}); // flush the effect's promise
}

function clickByText(text: string) {
  const el = Array.from(container.querySelectorAll('button')).find((b) =>
    b.textContent?.includes(text),
  );
  if (!el) throw new Error(`No button containing "${text}"`);
  act(() => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

describe('Leaderboard — scope toggle', () => {
  it("defaults to 'mine' and requests the active office", async () => {
    await render();
    expect(getLeaderboardMock).toHaveBeenCalled();
    const [, opts] = getLeaderboardMock.mock.calls[0];
    expect(opts).toMatchObject({ scope: 'mine', orgId: ORG });
  });

  it("switches to 'all' when clicking the all-offices toggle", async () => {
    await render();
    getLeaderboardMock.mockClear();
    // No LanguageProvider in the test → default language is 'en' → 'All offices'.
    clickByText('All offices');
    await act(async () => {}); // flush refetch
    const calls = getLeaderboardMock.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[calls.length - 1][1]).toMatchObject({ scope: 'all', orgId: ORG });
  });
});
