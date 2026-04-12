import { supabase } from './supabase';
import type { QuotePreset, QuotePresetService } from '../types';

const API_BASE = '/api';

async function authHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Not authenticated');
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session.access_token}`,
  };
}

/** List all active quote content presets */
export async function listQuotePresets(activeOnly = false): Promise<QuotePreset[]> {
  const headers = await authHeaders();
  const url = activeOnly
    ? `${API_BASE}/quote-templates?active_only=true`
    : `${API_BASE}/quote-templates`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error((await res.json()).error || 'Failed to fetch presets');
  const { templates } = await res.json();
  // Map backend fields to preset shape (strip pricing/layout fields)
  return (templates || []).map(mapToPreset);
}

/** Get a single preset by ID */
export async function getQuotePreset(id: string): Promise<QuotePreset> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/quote-templates/${id}`, { headers });
  if (!res.ok) throw new Error((await res.json()).error || 'Failed to fetch preset');
  const { template } = await res.json();
  return mapToPreset(template);
}

export type QuotePresetPayload = {
  name: string;
  description?: string | null;
  cover_image?: string | null;
  images?: string[];
  services?: QuotePresetService[];
  notes?: string | null;
  intro_text?: string | null;
  is_active?: boolean;
};

/** Create a new quote content preset */
export async function createQuotePreset(payload: QuotePresetPayload): Promise<QuotePreset> {
  const headers = await authHeaders();
  const body = mapToBackend(payload);
  const res = await fetch(`${API_BASE}/quote-templates`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json()).error || 'Failed to create preset');
  const { template } = await res.json();
  return mapToPreset(template);
}

/** Update an existing preset */
export async function updateQuotePreset(id: string, payload: QuotePresetPayload): Promise<QuotePreset> {
  const headers = await authHeaders();
  const body = mapToBackend(payload);
  const res = await fetch(`${API_BASE}/quote-templates/${id}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json()).error || 'Failed to update preset');
  const { template } = await res.json();
  return mapToPreset(template);
}

/** Delete a preset (soft delete) */
export async function deleteQuotePreset(id: string): Promise<void> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/quote-templates/${id}`, {
    method: 'DELETE',
    headers,
  });
  if (!res.ok) throw new Error((await res.json()).error || 'Failed to delete preset');
}

/** Duplicate a preset */
export async function duplicateQuotePreset(id: string): Promise<QuotePreset> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/quote-templates/${id}/duplicate`, {
    method: 'POST',
    headers,
  });
  if (!res.ok) throw new Error((await res.json()).error || 'Failed to duplicate preset');
  const { template } = await res.json();
  return mapToPreset(template);
}

// ── Mapping helpers ──

/** Map backend quote_template row to QuotePreset (strip layout/pricing fields) */
function mapToPreset(row: any): QuotePreset {
  return {
    id: row.id,
    org_id: row.org_id,
    created_by: row.created_by,
    name: row.name || '',
    description: row.description || null,
    cover_image: row.images?.[0] || null,
    images: row.images || [],
    services: (row.services || []).map((s: any) => ({
      id: s.id,
      name: s.name || '',
      description: s.description || '',
      quantity: s.quantity || 1,
      is_optional: s.is_optional || false,
    })),
    notes: row.notes || null,
    intro_text: row.intro_text || row.quote_title || null,
    is_active: row.is_active !== false,
    deleted_at: row.deleted_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** Map preset payload to backend quote_template shape */
function mapToBackend(payload: QuotePresetPayload): Record<string, any> {
  const images: string[] = [];
  if (payload.cover_image) images.push(payload.cover_image);
  if (payload.images) images.push(...payload.images.filter(i => i !== payload.cover_image));

  return {
    name: payload.name,
    description: payload.description || null,
    images: images.length > 0 ? images : [],
    services: (payload.services || []).map(s => ({
      id: s.id || crypto.randomUUID(),
      name: s.name,
      description: s.description || '',
      unit_price_cents: 0, // No pricing in presets
      quantity: s.quantity || 1,
      is_optional: s.is_optional || false,
    })),
    notes: payload.notes || null,
    intro_text: payload.intro_text || null,
    is_active: payload.is_active !== false,
    // Zero out all pricing/layout fields
    deposit_required: false,
    deposit_type: null,
    deposit_value: 0,
    tax_enabled: false,
    tax_rate: 0,
    tax_label: '',
    layout_config: {},
    style_config: {},
  };
}
