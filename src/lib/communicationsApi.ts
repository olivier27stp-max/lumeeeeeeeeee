import { supabase } from './supabase';

// ─── Types ───────────────────────────────────────────────────────────

export interface CommunicationMessage {
  id: string;
  org_id: string;
  user_id: string | null;
  client_id: string | null;
  job_id: string | null;
  channel_type: 'sms' | 'email';
  direction: 'outbound' | 'inbound';
  provider: string | null;
  channel_id: string | null;
  from_value: string | null;
  to_value: string | null;
  subject: string | null;
  body_text: string | null;
  body_html: string | null;
  template_key: string | null;
  status: 'queued' | 'sent' | 'delivered' | 'failed' | 'received' | 'opened' | 'bounced';
  sent_at: string | null;
  delivered_at: string | null;
  failed_at: string | null;
  provider_message_id: string | null;
  error_message: string | null;
  metadata: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface CommunicationChannel {
  id: string;
  org_id: string;
  user_id: string | null;
  channel_type: 'sms' | 'email';
  provider: string;
  phone_number: string | null;
  email_address: string | null;
  is_default: boolean;
  status: 'active' | 'inactive' | 'provisioning' | 'failed';
  created_at: string;
}

export interface CommunicationSettings {
  sms_enabled: boolean;
  email_enabled: boolean;
  sms_two_way_enabled: boolean;
  default_sms_channel_id: string | null;
  booking_confirmation_sms_enabled: boolean;
  booking_confirmation_email_enabled: boolean;
}

export interface SendSmsPayload {
  to: string;
  body: string;
  client_id?: string | null;
  job_id?: string | null;
}

export interface SendEmailPayload {
  to: string;
  subject: string;
  body: string;
  body_html?: string;
  client_id?: string | null;
  job_id?: string | null;
  reply_to?: string;
}

// ─── Auth helper ─────────────────────────────────────────────────────

async function getAuthHeaders(extra?: Record<string, string>): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Not authenticated');
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...extra };
}

// ─── API functions ───────────────────────────────────────────────────

export async function sendSms(payload: SendSmsPayload) {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/communications/send-sms', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || 'Failed to send SMS');
  return data;
}

export async function sendEmail(payload: SendEmailPayload) {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/communications/send-email', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || 'Failed to send email');
  return data;
}

export async function fetchCommunications(params: {
  job_id?: string;
  client_id?: string;
  limit?: number;
}): Promise<CommunicationMessage[]> {
  const headers = await getAuthHeaders();
  const query = new URLSearchParams();
  if (params.job_id) query.set('job_id', params.job_id);
  if (params.client_id) query.set('client_id', params.client_id);
  if (params.limit) query.set('limit', String(params.limit));

  const res = await fetch(`/api/communications/messages?${query}`, { headers });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || 'Failed to fetch communications');
  return data;
}

export async function fetchChannels(): Promise<CommunicationChannel[]> {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/communications/channels', { headers });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || 'Failed to fetch channels');
  return data;
}

export async function fetchCommSettings(): Promise<CommunicationSettings> {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/communications/settings', { headers });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || 'Failed to fetch settings');
  return data;
}

// ─── A2P 10DLC (US only) ────────────────────────────────────────────

export interface A2PRegistration {
  id: string;
  org_id: string;
  legal_business_name: string | null;
  ein: string | null;
  business_type: string | null;
  vertical: string | null;
  street: string | null;
  city: string | null;
  region: string | null;
  postal_code: string | null;
  country: string | null;
  website: string | null;
  support_email: string | null;
  support_phone: string | null;
  use_case: string | null;
  campaign_description: string | null;
  message_samples: string[];
  opt_in_keywords: string[];
  opt_in_message: string | null;
  opt_out_message: string | null;
  has_embedded_links: boolean;
  has_embedded_phone: boolean;
  brand_status: string;
  campaign_status: string;
  brand_error: string | null;
  campaign_error: string | null;
  last_checked_at: string | null;
}

export interface A2PBrandPayload {
  legal_business_name: string;
  ein: string;
  business_type: string;
  vertical: string;
  street: string;
  city: string;
  region: string;
  postal_code: string;
  country: string;
  website: string;
  support_email: string;
  support_phone: string;
}

export interface A2PCampaignPayload {
  use_case: string;
  description: string;
  message_samples: string[];
  opt_in_keywords: string[];
  opt_in_message: string;
  opt_out_message: string;
  has_embedded_links: boolean;
  has_embedded_phone: boolean;
}

export async function fetchA2PStatus(): Promise<A2PRegistration | null> {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/communications/a2p/status', { headers });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || 'Failed to fetch A2P status');
  return data;
}

export async function submitA2PBrand(payload: A2PBrandPayload) {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/communications/a2p/submit-brand', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || data?.message || 'Failed to submit brand');
  return data;
}

export async function submitA2PCampaign(payload: A2PCampaignPayload) {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/communications/a2p/submit-campaign', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || data?.message || 'Failed to submit campaign');
  return data;
}

export async function refreshA2PStatus() {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/communications/a2p/refresh', { method: 'POST', headers });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || 'Failed to refresh A2P status');
  return data as { brand_status: string; campaign_status: string };
}
