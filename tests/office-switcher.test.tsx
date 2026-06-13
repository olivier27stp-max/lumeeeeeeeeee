// @vitest-environment jsdom
//
// Verifies the OfficeSwitcher actually switches office: opening the dropdown
// and clicking another office must call switchCompany(orgId) from CompanyContext.
// Renders the component in isolation (no backend/login) by feeding a fake
// CompanyContext value — the same context the header now consumes.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CompanyContext } from '../src/contexts/CompanyContext';
import type { CompanyContextValue, CompanyMembership } from '../src/contexts/CompanyContext';
import { OfficeSwitcher } from '../src/components/OfficeSwitcher';

const ORG_A = '11111111-1111-1111-1111-111111111111';
const ORG_B = '22222222-2222-2222-2222-222222222222';

function membership(orgId: string, name: string): CompanyMembership {
  return {
    orgId,
    role: 'owner',
    scope: 'org' as any,
    permissions: {} as any,
    teamId: null,
    departmentId: null,
    managerId: null,
    status: 'active',
    fullName: 'Test Owner',
    avatarUrl: null,
    companyName: name,
  };
}

function makeCtx(switchCompany: (id: string) => void): CompanyContextValue {
  const companies = [membership(ORG_A, 'Bureau Montréal'), membership(ORG_B, 'Bureau Québec')];
  return {
    current: companies[0],
    currentOrgId: ORG_A,
    currentRole: 'owner',
    currentScope: 'org' as any,
    currentPermissions: {} as any,
    companies,
    loading: false,
    isMultiCompany: true,
    hasNoCompany: false,
    switchCompany,
    refresh: async () => {},
    userId: 'user-1',
  };
}

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function clickByText(text: string) {
  const el = Array.from(container.querySelectorAll('button')).find((b) =>
    b.textContent?.includes(text),
  );
  if (!el) throw new Error(`No clickable element containing "${text}"`);
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

describe('OfficeSwitcher (header)', () => {
  it('shows the current office in the trigger', () => {
    const switchCompany = vi.fn();
    act(() => {
      root.render(
        <CompanyContext.Provider value={makeCtx(switchCompany)}>
          <OfficeSwitcher />
        </CompanyContext.Provider>,
      );
    });
    expect(container.textContent).toContain('Bureau Montréal');
  });

  it('opens the dropdown and switches office on click', () => {
    const switchCompany = vi.fn();
    act(() => {
      root.render(
        <CompanyContext.Provider value={makeCtx(switchCompany)}>
          <OfficeSwitcher />
        </CompanyContext.Provider>,
      );
    });

    // Dropdown closed initially → other office not yet in the DOM.
    expect(container.textContent).not.toContain('Bureau Québec');

    // Open the dropdown (click the trigger pill showing the current office).
    clickByText('Bureau Montréal');
    expect(container.textContent).toContain('Bureau Québec');

    // Click the other office → must call switchCompany with its orgId.
    clickByText('Bureau Québec');
    expect(switchCompany).toHaveBeenCalledTimes(1);
    expect(switchCompany).toHaveBeenCalledWith(ORG_B);
  });
});
