/**
 * Email marketing campaigns — API client.
 */
import { supabase } from './supabase';

export type CampaignStatus = 'draft' | 'scheduled' | 'sending' | 'sent' | 'failed';
export type CampaignSegment = 'all_clients' | 'recent_clients' | 'overdue_clients' | 'custom_query';

export interface EmailCampaign {
  id: string;
  org_id: string;
  created_by: string | null;
  name: string;
  subject: string;
  body_html: string;
  body_text: string | null;
  segment: CampaignSegment;
  custom_query: any;
  status: CampaignStatus;
  scheduled_at: string | null;
  sent_at: string | null;
  total_recipients: number;
  total_sent: number;
  total_failed: number;
  total_bounced: number;
  total_opened: number;
  total_clicked: number;
  created_at: string;
  updated_at: string;
}

export interface CampaignInput {
  name: string;
  subject: string;
  body_html: string;
  body_text?: string | null;
  segment?: CampaignSegment;
  custom_query?: any;
}

export interface PreviewResult {
  total: number;
  sample: Array<{ email: string; name: string | null }>;
  max_per_send: number;
  over_limit: boolean;
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Not authenticated');
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = await authHeaders();
  const res = await fetch(url, { ...init, headers: { ...headers, ...(init?.headers || {}) } });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return res.json();
}

export async function listCampaigns(): Promise<EmailCampaign[]> {
  const res = await apiFetch<{ campaigns: EmailCampaign[] }>('/api/campaigns');
  return res.campaigns;
}

export async function createCampaign(input: CampaignInput): Promise<EmailCampaign> {
  const res = await apiFetch<{ campaign: EmailCampaign }>('/api/campaigns', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return res.campaign;
}

export async function updateCampaign(id: string, patch: Partial<CampaignInput>): Promise<EmailCampaign> {
  const res = await apiFetch<{ campaign: EmailCampaign }>(`/api/campaigns/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  return res.campaign;
}

export async function deleteCampaign(id: string): Promise<void> {
  await apiFetch<{ ok: true }>(`/api/campaigns/${id}`, { method: 'DELETE' });
}

export async function previewRecipients(id: string): Promise<PreviewResult> {
  return apiFetch<PreviewResult>(`/api/campaigns/${id}/preview-recipients`, { method: 'POST' });
}

export async function sendCampaign(id: string): Promise<{ recipients: number; sent: number; failed: number }> {
  return apiFetch<any>(`/api/campaigns/${id}/send`, { method: 'POST' });
}

export async function scheduleCampaign(id: string, scheduled_at: string): Promise<EmailCampaign> {
  const res = await apiFetch<{ campaign: EmailCampaign }>(`/api/campaigns/${id}/schedule`, {
    method: 'POST',
    body: JSON.stringify({ scheduled_at }),
  });
  return res.campaign;
}

export async function getCampaignStats(id: string): Promise<{ campaign: EmailCampaign; recipients: any[] }> {
  return apiFetch<any>(`/api/campaigns/${id}/stats`);
}

export function mailchimpExportUrl(): string {
  return '/api/campaigns/export/mailchimp.csv';
}

export async function downloadMailchimpCsv(): Promise<void> {
  const headers = await authHeaders();
  const res = await fetch(mailchimpExportUrl(), { headers });
  if (!res.ok) throw new Error(`Export failed (${res.status})`);
  const blob = await res.blob();
  const today = new Date().toISOString().slice(0, 10);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `lume-mailchimp-import-${today}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
