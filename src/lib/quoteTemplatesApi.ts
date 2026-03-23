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

export async function listQuoteTemplates(): Promise<QuoteTemplate[]> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/quote-templates`, { headers });
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

export async function createQuoteTemplate(payload: {
  name: string;
  description?: string | null;
  services?: QuoteTemplateService[];
  images?: string[];
  notes?: string | null;
  terms?: string | null;
  custom_fields?: Record<string, any>;
}): Promise<QuoteTemplate> {
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

export async function updateQuoteTemplate(id: string, payload: {
  name: string;
  description?: string | null;
  services?: QuoteTemplateService[];
  images?: string[];
  notes?: string | null;
  terms?: string | null;
  custom_fields?: Record<string, any>;
}): Promise<QuoteTemplate> {
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
