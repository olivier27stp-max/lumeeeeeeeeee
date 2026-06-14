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

function makeCtx(
  switchCompany: (id: string) => void,
  role: 'owner' | 'admin' | 'sales_rep' | 'technician' = 'owner',
): CompanyContextValue {
  const companies = [
    { ...membership(ORG_A, 'Bureau Montréal'), role },
    membership(ORG_B, 'Bureau Québec'),
  ];
  return {
    current: companies[0],
    currentOrgId: ORG_A,
    currentRole: role,
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
let assignSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  // Switching does a full reload — stub it so jsdom doesn't warn and we can assert.
  assignSpy = vi.fn();
  Object.defineProperty(window, 'location', {
    value: { ...window.location, assign: assignSpy },
    writable: true,
  });
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

// The header trigger is icon-only — click the first button (the only one
// rendered while the dropdown is closed).
function openTrigger() {
  const trigger = container.querySelector('button');
  if (!trigger) throw new Error('No trigger button rendered');
  act(() => {
    trigger.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

describe('OfficeSwitcher (header, icon-only)', () => {
  it('renders an icon-only trigger that names the current office via title', () => {
    const switchCompany = vi.fn();
    act(() => {
      root.render(
        <CompanyContext.Provider value={makeCtx(switchCompany)}>
          <OfficeSwitcher />
        </CompanyContext.Provider>,
      );
    });
    const trigger = container.querySelector('button')!;
    // Icon-only: no office name in the visible text, only an SVG icon.
    expect(trigger.textContent?.trim()).toBe('');
    expect(trigger.querySelector('svg')).toBeTruthy();
    // The office name is still discoverable via the tooltip.
    expect(trigger.getAttribute('title')).toContain('Bureau Montréal');
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

    // Open the dropdown (click the icon trigger).
    openTrigger();
    expect(container.textContent).toContain('Bureau Québec');

    // Click the other office → must call switchCompany with its orgId
    // and trigger a full reload onto that office.
    clickByText('Bureau Québec');
    expect(switchCompany).toHaveBeenCalledTimes(1);
    expect(switchCompany).toHaveBeenCalledWith(ORG_B);
    expect(assignSpy).toHaveBeenCalledWith('/');
  });

  it('renders nothing for roles that cannot switch (sales_rep)', () => {
    const switchCompany = vi.fn();
    act(() => {
      root.render(
        <CompanyContext.Provider value={makeCtx(switchCompany, 'sales_rep')}>
          <OfficeSwitcher />
        </CompanyContext.Provider>,
      );
    });
    // Only owner/admin may switch offices — others get no header control.
    expect(container.querySelector('button')).toBeNull();
    expect(container.textContent?.trim()).toBe('');
  });

  it('lets an admin switch offices', () => {
    const switchCompany = vi.fn();
    act(() => {
      root.render(
        <CompanyContext.Provider value={makeCtx(switchCompany, 'admin')}>
          <OfficeSwitcher />
        </CompanyContext.Provider>,
      );
    });
    openTrigger();
    clickByText('Bureau Québec');
    expect(switchCompany).toHaveBeenCalledWith(ORG_B);
    expect(assignSpy).toHaveBeenCalledWith('/');
  });
});
