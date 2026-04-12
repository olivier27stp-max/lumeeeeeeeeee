import { supabase } from './supabase';

export interface InvoiceTemplate {
  id: string;
  org_id: string;
  created_by: string | null;
  name: string;
  title: string;
  description: string;
  line_items: Array<{ description: string; qty: number; unit_price_cents: number }>;
  taxes: Array<{ name: string; rate: number }>;
  payment_terms: string;
  client_note: string;
  branding: Record<string, any>;
  payment_methods: Record<string, any>;
  email_subject: string;
  email_body: string;
  is_default: boolean;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  layout_type?: string;
}

export type InvoiceTemplateInput = Omit<
  InvoiceTemplate,
  'id' | 'org_id' | 'created_by' | 'created_at' | 'updated_at' | 'archived_at' | 'layout_type'
>;

/* ── Auth helper ─────────────────────────────────────────────── */
async function authHeaders(extra?: Record<string, string>): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('You must be signed in.');
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...extra };
}

async function apiFetch<T>(url: string, opts: RequestInit = {}): Promise<T> {
  const headers = await authHeaders(opts.headers as Record<string, string>);
  const res = await fetch(url, { ...opts, headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as any)?.error || `Request failed (${res.status})`);
  return body as T;
}

/* ── CRUD via Express backend (service_role — bypasses RLS) ── */

export async function listInvoiceTemplates(): Promise<InvoiceTemplate[]> {
  return apiFetch<InvoiceTemplate[]>('/api/invoice-templates');
}

export async function getInvoiceTemplate(id: string): Promise<InvoiceTemplate> {
  return apiFetch<InvoiceTemplate>(`/api/invoice-templates/${id}`);
}

export async function createInvoiceTemplate(input: InvoiceTemplateInput): Promise<InvoiceTemplate> {
  return apiFetch<InvoiceTemplate>('/api/invoice-templates', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateInvoiceTemplate(
  id: string,
  input: Partial<InvoiceTemplateInput>,
): Promise<InvoiceTemplate> {
  return apiFetch<InvoiceTemplate>(`/api/invoice-templates/${id}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

export async function duplicateInvoiceTemplate(id: string): Promise<InvoiceTemplate> {
  return apiFetch<InvoiceTemplate>(`/api/invoice-templates/${id}/duplicate`, {
    method: 'POST',
  });
}

export async function setDefaultInvoiceTemplate(id: string): Promise<void> {
  await apiFetch<any>(`/api/invoice-templates/${id}/set-default`, {
    method: 'POST',
  });
}

export async function deleteInvoiceTemplate(id: string): Promise<void> {
  await apiFetch<any>(`/api/invoice-templates/${id}`, {
    method: 'DELETE',
  });
}
