import { supabase } from './supabase';
import type { QuoteTemplate, QuoteTemplateService } from '../types';

const API_BASE = '/api';

async function authHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Not authenticated');
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session.access_token}`,
  };
}

export async function listQuoteTemplates(activeOnly = false): Promise<QuoteTemplate[]> {
  const headers = await authHeaders();
  const url = activeOnly
    ? `${API_BASE}/quote-templates?active_only=true`
    : `${API_BASE}/quote-templates`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error((await res.json()).error || 'Failed to fetch templates');
  const { templates } = await res.json();
  return templates || [];
}

export async function getQuoteTemplate(id: string): Promise<QuoteTemplate> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/quote-templates/${id}`, { headers });
  if (!res.ok) throw new Error((await res.json()).error || 'Failed to fetch template');
  const { template } = await res.json();
  return template;
}

export type QuoteTemplatePayload = {
  name: string;
  description?: string | null;
  services?: QuoteTemplateService[];
  images?: string[];
  notes?: string | null;
  terms?: string | null;
  custom_fields?: Record<string, any>;
  is_default?: boolean;
  is_active?: boolean;
  sort_order?: number;
  template_category?: string | null;
  quote_title?: string | null;
  intro_text?: string | null;
  footer_notes?: string | null;
  deposit_required?: boolean;
  deposit_type?: 'percentage' | 'fixed' | null;
  deposit_value?: number;
  tax_enabled?: boolean;
  tax_rate?: number;
  tax_label?: string;
  sections?: Array<{ type: string; title: string; content: string; sort_order: number; enabled: boolean }>;
  layout_config?: Record<string, any>;
  style_config?: Record<string, any>;
};

export async function createQuoteTemplate(payload: QuoteTemplatePayload): Promise<QuoteTemplate> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/quote-templates`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error((await res.json()).error || 'Failed to create template');
  const { template } = await res.json();
  return template;
}

export async function updateQuoteTemplate(id: string, payload: QuoteTemplatePayload): Promise<QuoteTemplate> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/quote-templates/${id}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error((await res.json()).error || 'Failed to update template');
  const { template } = await res.json();
  return template;
}

export async function deleteQuoteTemplate(id: string): Promise<void> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/quote-templates/${id}`, {
    method: 'DELETE',
    headers,
  });
  if (!res.ok) throw new Error((await res.json()).error || 'Failed to delete template');
}

export async function duplicateQuoteTemplate(id: string): Promise<QuoteTemplate> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/quote-templates/${id}/duplicate`, {
    method: 'POST',
    headers,
  });
  if (!res.ok) throw new Error((await res.json()).error || 'Failed to duplicate template');
  const { template } = await res.json();
  return template;
}

export async function setTemplateDefault(id: string, isDefault: boolean): Promise<QuoteTemplate> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/quote-templates/${id}/default`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ is_default: isDefault }),
  });
  if (!res.ok) throw new Error((await res.json()).error || 'Failed to update default');
  const { template } = await res.json();
  return template;
}

export async function setTemplateActive(id: string, isActive: boolean): Promise<QuoteTemplate> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/quote-templates/${id}/active`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ is_active: isActive }),
  });
  if (!res.ok) throw new Error((await res.json()).error || 'Failed to toggle active');
  const { template } = await res.json();
  return template;
}

export async function seedQuoteTemplates(): Promise<{ seeded: boolean; templates?: QuoteTemplate[] }> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/quote-templates/seed`, {
    method: 'POST',
    headers,
  });
  if (!res.ok) throw new Error((await res.json()).error || 'Failed to seed templates');
  return res.json();
}
