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
import { MemoryRouter } from 'react-router-dom';
const quota = { can_create: true };
vi.mock('../src/lib/officesApi', () => ({
  listOffices: async () => ({ offices: [], capacity: 2, used: 2, caller_role: 'owner', can_create: quota.can_create }),
}));
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
  officeCount = 2,
): CompanyContextValue {
  const companies = [
    { ...membership(ORG_A, 'Bureau Montréal'), role },
    { ...membership(ORG_B, 'Bureau Québec'), role },
  ].slice(0, officeCount);
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

describe('OfficeSwitcher (header pill)', () => {
  it('renders a pill trigger showing the current office name, icon and chevron', () => {
    const switchCompany = vi.fn();
    act(() => {
      root.render(
        <MemoryRouter>
        <CompanyContext.Provider value={makeCtx(switchCompany)}>
          <OfficeSwitcher />
        </CompanyContext.Provider>
        </MemoryRouter>,
      );
    });
    const trigger = container.querySelector('button')!;
    // The pill now surfaces the office name as visible text…
    expect(trigger.textContent).toContain('Bureau Montréal');
    // …alongside the building icon + the switch-affordance chevron (2 SVGs).
    expect(trigger.querySelectorAll('svg').length).toBe(2);
    // The office name stays discoverable via the tooltip too.
    expect(trigger.getAttribute('title')).toContain('Bureau Montréal');
  });

  it('opens the dropdown and switches office on click', () => {
    const switchCompany = vi.fn();
    act(() => {
      root.render(
        <MemoryRouter>
        <CompanyContext.Provider value={makeCtx(switchCompany)}>
          <OfficeSwitcher />
        </CompanyContext.Provider>
        </MemoryRouter>,
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

  it('renders nothing for a sales_rep with a single office', () => {
    const switchCompany = vi.fn();
    act(() => {
      root.render(
        <MemoryRouter>
        <CompanyContext.Provider value={makeCtx(switchCompany, 'sales_rep', 1)}>
          <OfficeSwitcher />
        </CompanyContext.Provider>
        </MemoryRouter>,
      );
    });
    // Un représentant épinglé à un seul bureau n'a rien à changer.
    expect(container.querySelector('button')).toBeNull();
    expect(container.textContent?.trim()).toBe('');
  });

  it('lets an admin switch offices', () => {
    const switchCompany = vi.fn();
    act(() => {
      root.render(
        <MemoryRouter>
        <CompanyContext.Provider value={makeCtx(switchCompany, 'admin')}>
          <OfficeSwitcher />
        </CompanyContext.Provider>
        </MemoryRouter>,
      );
    });
    openTrigger();
    clickByText('Bureau Québec');
    expect(switchCompany).toHaveBeenCalledWith(ORG_B);
    expect(assignSpy).toHaveBeenCalledWith('/');
  });

  it('lets a sales_rep switch once they have access to two offices', () => {
    const switchCompany = vi.fn();
    act(() => {
      root.render(
        <MemoryRouter>
        <CompanyContext.Provider value={makeCtx(switchCompany, 'sales_rep', 2)}>
          <OfficeSwitcher />
        </CompanyContext.Provider>
        </MemoryRouter>,
      );
    });
    openTrigger();
    // Pas de « Créer un bureau » : réservé au propriétaire.
    expect(container.textContent).not.toContain('Create office');
    clickByText('Bureau Québec');
    expect(switchCompany).toHaveBeenCalledWith(ORG_B);
  });

  it('owner: « Create office » only when the office quota allows it', async () => {
    for (const permet of [false, true]) {
      quota.can_create = permet;
      act(() => {
        root.render(
          <MemoryRouter>
          <CompanyContext.Provider value={makeCtx(vi.fn())}>
            <OfficeSwitcher key={String(permet)} />
          </CompanyContext.Provider>
          </MemoryRouter>,
        );
      });
      openTrigger();
      await act(async () => { await Promise.resolve(); });
      if (permet) expect(container.textContent).toContain('Create office');
      else expect(container.textContent).not.toContain('Create office');
      openTrigger(); // referme
    }
  });
});
