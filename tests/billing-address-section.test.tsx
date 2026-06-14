// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const updateClientMock = vi.fn(async (...args: any[]) => ({ id: args[0], ...args[1] }));
vi.mock('../src/lib/clientsApi', () => ({
  updateClient: (...args: any[]) => updateClientMock(...args),
}));

import { BillingAddressSection } from '../src/components/BillingAddressSection';

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  updateClientMock.mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function renderWith(client: any) {
  act(() => {
    root.render(<BillingAddressSection client={client} fr onUpdated={() => {}} />);
  });
}

const SWITCH = () => container.querySelector('button[role="switch"]') as HTMLButtonElement;

describe('BillingAddressSection', () => {
  it('hides the billing input while "same as service" is on', () => {
    renderWith({ id: 'c1', billing_same_as_service: true, billing_address: null });
    expect(SWITCH().getAttribute('aria-checked')).toBe('true');
    expect(container.querySelector('textarea')).toBeNull();
  });

  it('turning it off persists the flag and reveals the billing input', async () => {
    renderWith({ id: 'c1', billing_same_as_service: true, billing_address: null });
    act(() => {
      SWITCH().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(updateClientMock).toHaveBeenCalledWith('c1', { billing_same_as_service: false });
    expect(SWITCH().getAttribute('aria-checked')).toBe('false');
    expect(container.querySelector('textarea')).not.toBeNull();
    await act(async () => {});
  });

  it('shows the existing billing address when already different', () => {
    renderWith({ id: 'c1', billing_same_as_service: false, billing_address: '99 Billing St' });
    const ta = container.querySelector('textarea') as HTMLTextAreaElement;
    expect(ta).not.toBeNull();
    expect(ta.value).toBe('99 Billing St');
  });
});
