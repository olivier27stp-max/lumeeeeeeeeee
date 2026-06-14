// The invoice "bill to" address must follow the client's billing preference:
//  - same_as_service (default) → the service (property) address
//  - else → the distinct billing address
import { describe, it, expect } from 'vitest';
import { buildRenderData } from '../src/components/invoice/buildRenderData';

const baseInvoice = {
  invoice_number: 'INV-1',
  status: 'draft',
  subject: null,
  issued_at: null,
  due_date: null,
  created_at: '2026-01-01',
  currency: 'CAD',
  subtotal_cents: 0,
  tax_cents: 0,
  total_cents: 0,
  paid_cents: 0,
  balance_cents: 0,
  client_name: 'Fallback Name',
};

function render(client: any) {
  return buildRenderData({ invoice: baseInvoice, client, items: [] } as any, null);
}

describe('buildRenderData — invoice billing address', () => {
  it('uses the service address when billing_same_as_service is true', () => {
    const out = render({
      first_name: 'A', last_name: 'B',
      address: 'Service Addr', billing_same_as_service: true, billing_address: 'IGNORED',
    });
    expect(out.client_address).toBe('Service Addr');
  });

  it('uses the distinct billing address when same_as_service is false', () => {
    const out = render({
      first_name: 'A', last_name: 'B',
      address: 'Service Addr', billing_same_as_service: false, billing_address: 'Billing Addr',
    });
    expect(out.client_address).toBe('Billing Addr');
  });

  it('falls back to the service address if billing is "different" but empty', () => {
    const out = render({
      first_name: 'A', last_name: 'B',
      address: 'Service Addr', billing_same_as_service: false, billing_address: null,
    });
    expect(out.client_address).toBe('Service Addr');
  });

  it('is null when there is no client', () => {
    expect(render(null).client_address).toBeNull();
  });
});
