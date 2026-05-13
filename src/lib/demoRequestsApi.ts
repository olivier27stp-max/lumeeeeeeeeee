import { supabase } from './supabase';

export const DEMO_INDUSTRY_VALUES = [
  'landscaping',
  'snow_removal',
  'residential_cleaning',
  'commercial_cleaning',
  'plumbing',
  'electrical',
  'roofing',
  'hvac',
  'window_cleaning',
  'other',
] as const;
export type DemoIndustry = typeof DEMO_INDUSTRY_VALUES[number];

export const DEMO_STATUSES = ['new', 'contacted', 'demoed', 'converted', 'rejected'] as const;
export type DemoStatus = typeof DEMO_STATUSES[number];

export interface DemoRequest {
  id: string;
  full_name: string;
  company_name: string;
  email: string;
  phone: string;
  industry: DemoIndustry;
  employee_count: string | null;
  source: string | null;
  availability: string | null;
  message: string | null;
  status: DemoStatus;
  notes: string | null;
  contacted_at: string | null;
  converted_at: string | null;
  converted_user_id: string | null;
  created_at: string;
}

export interface SubmitDemoRequestPayload {
  full_name: string;
  company_name: string;
  email: string;
  phone: string;
  industry: DemoIndustry;
  employee_count?: string | null;
  source?: string | null;
  availability?: string | null;
  message?: string | null;
}

/** Public — no auth required. */
export async function submitDemoRequest(payload: SubmitDemoRequestPayload): Promise<{ ok: true; message: string }> {
  const res = await fetch('/api/public/book-demo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || 'Submission failed.');
  return body;
}

async function authHeader(): Promise<HeadersInit> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return {
    'Content-Type': 'application/json',
    'X-Requested-With': 'fetch',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export async function listDemoRequests(status?: DemoStatus | 'all'): Promise<DemoRequest[]> {
  const url = status && status !== 'all'
    ? `/api/admin/demo-requests?status=${encodeURIComponent(status)}`
    : '/api/admin/demo-requests';
  const res = await fetch(url, { headers: await authHeader() });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || 'Failed to load demo requests.');
  return body.requests || [];
}

export async function updateDemoRequest(id: string, patch: { status?: DemoStatus; notes?: string | null }): Promise<DemoRequest> {
  const res = await fetch(`/api/admin/demo-requests/${id}`, {
    method: 'PATCH',
    headers: await authHeader(),
    body: JSON.stringify(patch),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || 'Failed to update demo request.');
  return body.request;
}

export async function createAccountForDemoRequest(id: string): Promise<{ ok: true; user_id: string; invitation_url?: string }> {
  const res = await fetch(`/api/admin/demo-requests/${id}/create-account`, {
    method: 'POST',
    headers: await authHeader(),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || 'Failed to create account.');
  return body;
}
