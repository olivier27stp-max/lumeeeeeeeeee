// ── Shared types for quote visual rendering ──

export interface QuoteRenderData {
  // Quote
  quote_number: string;
  title: string;
  status: string;
  valid_until: string | null;
  created_at: string;
  notes: string | null;
  currency: string;

  // Totals
  subtotal_cents: number;
  discount_cents: number;
  tax_cents: number;
  tax_rate: number;
  tax_rate_label: string;
  total_cents: number;

  // Deposit
  deposit_required: boolean;
  deposit_cents: number;
  deposit_status: string;

  // Contact
  contact_name: string;
  contact_email: string | null;
  contact_phone: string | null;
  contact_company: string | null;
  contact_address: string | null;

  // Company
  company_name: string;
  company_email: string | null;
  company_phone: string | null;
  company_address: string | null;
  company_logo_url: string | null;

  // Sections
  introduction: string | null;
  contract_disclaimer: string | null;

  // Items
  items: QuoteRenderItem[];
  optional_items: QuoteRenderItem[];
}

export interface QuoteRenderItem {
  id: string;
  name: string;
  description: string | null;
  qty: number;
  unit_price_cents: number;
  total_cents: number;
  item_type: 'service' | 'text' | 'heading';
}

// Single fixed layout — no more layout picker
export type QuoteLayoutType = 'minimal_pro';
