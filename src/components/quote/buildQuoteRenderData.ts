import type { QuoteDetail } from '../../lib/quotesApi';
import type { QuoteRenderData } from './types';

/**
 * Convert a QuoteDetail + company settings into QuoteRenderData
 * for the visual template renderer.
 */
export function buildQuoteRenderData(
  detail: QuoteDetail,
  company: {
    company_name?: string | null;
    company_email?: string | null;
    company_phone?: string | null;
    company_address?: string | null;
    company_logo_url?: string | null;
  } | null,
): QuoteRenderData {
  const q = detail.quote;
  const contact = detail.lead || detail.client;
  const contactName = contact
    ? `${contact.first_name || ''} ${contact.last_name || ''}`.trim()
    : '';

  const serviceItems = detail.line_items
    .filter(li => li.item_type === 'service' && !li.is_optional)
    .sort((a, b) => a.sort_order - b.sort_order);

  const optionalItems = detail.line_items
    .filter(li => li.item_type === 'service' && li.is_optional)
    .sort((a, b) => a.sort_order - b.sort_order);

  const mapItem = (li: typeof detail.line_items[0]) => ({
    id: li.id,
    name: li.name,
    description: li.description,
    qty: li.quantity,
    unit_price_cents: li.unit_price_cents,
    total_cents: li.total_cents,
    item_type: li.item_type,
  });

  const intro = detail.sections.find(s => s.section_type === 'introduction' && s.enabled);
  const disclaimer = detail.sections.find(s => s.section_type === 'contract_disclaimer' && s.enabled);

  return {
    quote_number: q.quote_number,
    title: q.title,
    status: q.status,
    valid_until: q.valid_until,
    created_at: q.created_at,
    notes: q.notes,
    currency: q.currency || 'CAD',

    subtotal_cents: q.subtotal_cents,
    discount_cents: q.discount_cents,
    tax_cents: q.tax_cents,
    tax_rate: q.tax_rate,
    tax_rate_label: q.tax_rate_label,
    total_cents: q.total_cents,

    deposit_required: q.deposit_required,
    deposit_cents: q.deposit_cents,
    deposit_status: q.deposit_status,

    contact_name: contactName,
    contact_email: contact?.email || null,
    contact_phone: contact?.phone || null,
    contact_company: (contact as any)?.company || null,
    contact_address: contact?.address || null,

    company_name: company?.company_name || 'Company',
    company_email: company?.company_email || null,
    company_phone: company?.company_phone || null,
    company_address: company?.company_address || null,
    company_logo_url: company?.company_logo_url || null,

    introduction: intro?.content || null,
    contract_disclaimer: disclaimer?.content || null,

    items: serviceItems.map(mapItem),
    optional_items: optionalItems.map(mapItem),
  };
}
