import { supabase } from './supabase';
import type { RequestForm, FormSubmission } from '../types';

const API_BASE = '/api';

async function authHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Not authenticated');
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session.access_token}`,
  };
}

export async function fetchRequestForm(): Promise<RequestForm | null> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/request-forms`, { headers });
  if (!res.ok) throw new Error((await res.json()).error || 'Failed to fetch form');
  const { form } = await res.json();
  return form || null;
}

export async function upsertRequestForm(payload: {
  title: string;
  description?: string | null;
  success_message: string;
  enabled?: boolean;
  custom_fields?: RequestForm['custom_fields'];
  notify_email?: boolean;
  notify_in_app?: boolean;
}): Promise<RequestForm> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/request-forms`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error((await res.json()).error || 'Failed to save form');
  const { form } = await res.json();
  return form;
}

export async function regenerateApiKey(): Promise<string> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/request-forms/regenerate-key`, {
    method: 'POST',
    headers,
  });
  if (!res.ok) throw new Error((await res.json()).error || 'Failed to regenerate key');
  const { api_key } = await res.json();
  return api_key;
}

export async function fetchFormSubmissions(): Promise<FormSubmission[]> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/request-forms/submissions`, { headers });
  if (!res.ok) throw new Error((await res.json()).error || 'Failed to fetch submissions');
  const { submissions } = await res.json();
  return submissions || [];
}
