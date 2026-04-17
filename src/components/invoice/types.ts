// ── Shared types for invoice rendering ──

export interface InvoiceRenderData {
  // Invoice
  invoice_number: string;
  status: string;
  subject: string | null;
  issued_at: string | null;
  due_date: string | null;
  created_at: string;
  notes: string | null;
  currency: string;

  // Totals
  subtotal_cents: number;
  discount_cents: number;
  tax_cents: number;
  total_cents: number;
  paid_cents: number;
  balance_cents: number;

  // Client
  client_name: string;
  client_email: string | null;
  client_phone: string | null;
  client_company: string | null;
  client_address: string | null;

  // Company
  company_name: string;
  company_email: string | null;
  company_phone: string | null;
  company_address: string | null;
  company_logo_url: string | null;

  // Tax breakdown (individual taxes with optional registration numbers)
  tax_breakdown: InvoiceTaxLine[];

  // Items
  items: InvoiceRenderItem[];

  // Branding
  primary_color: string;
  accent_color: string;
}

export interface InvoiceTaxLine {
  name: string;
  rate: number;
  amount_cents: number;
  registration_number?: string | null;
}

export interface InvoiceRenderItem {
  id: string;
  description: string;
  title?: string | null;
  qty: number;
  unit_price_cents: number;
  line_total_cents: number;
}

// Single fixed layout — no template system
export type InvoiceLayoutType = 'clean_billing';
