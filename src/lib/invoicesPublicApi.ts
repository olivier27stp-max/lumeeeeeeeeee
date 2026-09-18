/**
 * Facture vue par le client, sans session — GET /api/invoices/public/:token.
 * Audit QA prod 2026-09-09, n°1 : cette route n'existait pas ; le lien copié
 * depuis la fiche facture tombait sur « Soumission introuvable ».
 */
import type { SocialLinks } from './socialLinks';
const API_BASE = import.meta.env.VITE_API_URL || '';

export interface PublicInvoiceCompany {
  company_name: string;
  logo_url: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  street1: string | null;
  city: string | null;
  province: string | null;
  postal_code: string | null;
  country: string | null;
  brand_color: string | null;
  /** Langue de l'entreprise : la page s'affiche dans celle-là. */
  language?: 'fr' | 'en' | null;
  /** Réseaux sociaux — icônes au pied de la page. */
  social_links?: SocialLinks | null;
}

export interface PublicInvoiceItem {
  id: string;
  title: string | null;
  description: string | null;
  qty: number;
  unit_price_cents: number;
  line_total_cents: number;
}

export interface PublicInvoice {
  id: string;
  invoice_number: string;
  status: string;
  subject: string | null;
  issued_at: string | null;
  due_date: string | null;
  sent_at: string | null;
  paid_at: string | null;
  subtotal_cents: number;
  discount_cents: number | null;
  tax_cents: number;
  /** Ventilation par taxe (TPS, TVQ…) ; vide → une seule ligne « Taxes ». */
  tax_lines?: Array<{ name: string; rate: number; amount_cents: number; registration_number?: string | null }>;
  total_cents: number;
  paid_cents: number;
  balance_cents: number;
  currency: string;
  notes: string | null;
}

export interface PublicInvoiceData {
  invoice: PublicInvoice;
  items: PublicInvoiceItem[];
  client: { first_name: string | null; last_name: string | null; company: string | null; email: string | null; phone: string | null } | null;
  company: PublicInvoiceCompany | null;
  /** Jeton d'un lien de paiement actif (/pay/:token), ou null. */
  pay_token: string | null;
}

export async function fetchPublicInvoice(token: string): Promise<PublicInvoiceData> {
  const res = await fetch(`${API_BASE}/api/invoices/public/${encodeURIComponent(token)}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body?.error || `HTTP ${res.status}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return res.json();
}
