import type { InvoiceDetail } from '../../lib/invoicesApi';
import type { InvoiceRenderData } from './types';

/**
 * Convert an InvoiceDetail + company settings into InvoiceRenderData
 * for the visual template renderer.
 */
export function buildRenderData(
  detail: InvoiceDetail,
  company: {
    company_name?: string | null;
    company_email?: string | null;
    company_phone?: string | null;
    company_address?: string | null;
    company_logo_url?: string | null;
  } | null,
  branding?: { primary_color?: string; accent_color?: string } | null,
): InvoiceRenderData {
  const inv = detail.invoice;
  const client = detail.client;

  return {
    invoice_number: inv.invoice_number,
    status: inv.status,
    subject: inv.subject,
    issued_at: inv.issued_at,
    due_date: inv.due_date,
    created_at: inv.created_at,
    notes: (inv as any).notes || null,
    currency: inv.currency || 'CAD',

    subtotal_cents: inv.subtotal_cents,
    discount_cents: (inv as any).discount_cents || 0,
    tax_cents: inv.tax_cents,
    total_cents: inv.total_cents,
    paid_cents: inv.paid_cents,
    balance_cents: inv.balance_cents,

    client_name: client
      ? `${client.first_name || ''} ${client.last_name || ''}`.trim() || inv.client_name
      : inv.client_name,
    client_email: client?.email || null,
    client_phone: client?.phone || null,
    client_company: (client as any)?.company || null,
    client_address: null,

    company_name: company?.company_name || 'LUME',
    company_email: company?.company_email || null,
    company_phone: company?.company_phone || null,
    company_address: company?.company_address || null,
    company_logo_url: company?.company_logo_url || null,

    items: detail.items.map((item) => ({
      id: item.id,
      description: item.description,
      title: (item as any).title || null,
      qty: item.qty,
      unit_price_cents: item.unit_price_cents,
      line_total_cents: item.line_total_cents,
    })),

    primary_color: branding?.primary_color || '#1a1a2e',
    accent_color: branding?.accent_color || '#374151',
  };
}
