import type { InvoiceDetail } from './invoicesApi';

/**
 * Address printed in the « Bill to » block of an invoice (HTML preview, PDF).
 * - Issued invoices: the snapshot frozen at creation (migration
 *   20260915000000) — editing the client never rewrites an issued invoice.
 * - Drafts (or legacy invoices without a snapshot): live resolution — the
 *   client's billing address when it bills to a distinct one, otherwise its
 *   service address.
 */
export function resolveInvoiceBillingAddress(detail: Pick<InvoiceDetail, 'invoice' | 'client'>): string | null {
  const inv = detail.invoice as { status?: string | null; billing_address_snapshot?: string | null };
  const client = detail.client;
  if (inv.status && inv.status !== 'draft' && inv.billing_address_snapshot) return inv.billing_address_snapshot;
  if (!client) return inv.billing_address_snapshot || null;
  if (client.billing_same_as_service === false && client.billing_address) return client.billing_address;
  return client.address || inv.billing_address_snapshot || null;
}
