import { supabase } from './supabase';

const API_BASE = '/api';

export type WebhookEndpoint = {
  id: string;
  name: string;
  url: string;
  events: string[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
  last_delivery_at: string | null;
  last_delivery_status: string | null;
};

export type WebhookDelivery = {
  id: string;
  event_name: string;
  status: 'pending' | 'sent' | 'failed' | 'abandoned';
  attempt_count: number;
  http_status: number | null;
  error_message: string | null;
  created_at: string;
  sent_at: string | null;
  next_attempt_at: string | null;
};

async function authHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Not authenticated');
  return {
    'Content-Type': 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
    Authorization: `Bearer ${session.access_token}`,
  };
}

async function readError(res: Response): Promise<string> {
  try {
    const j = await res.json();
    return j.error || j.message || `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

export async function listWebhooks(): Promise<WebhookEndpoint[]> {
  const res = await fetch(`${API_BASE}/webhooks`, { headers: await authHeaders() });
  if (!res.ok) throw new Error(await readError(res));
  const { endpoints } = await res.json();
  return endpoints || [];
}

export async function fetchKnownEvents(): Promise<string[]> {
  const res = await fetch(`${API_BASE}/webhooks/events`, { headers: await authHeaders() });
  if (!res.ok) throw new Error(await readError(res));
  const { events } = await res.json();
  return events || [];
}

export async function createWebhook(payload: {
  name: string;
  url: string;
  events: string[];
  is_active?: boolean;
}): Promise<{ endpoint: WebhookEndpoint; secret: string }> {
  const res = await fetch(`${API_BASE}/webhooks`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function updateWebhook(id: string, payload: Partial<{
  name: string;
  url: string;
  events: string[];
  is_active: boolean;
}>): Promise<WebhookEndpoint> {
  const res = await fetch(`${API_BASE}/webhooks/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: await authHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await readError(res));
  const { endpoint } = await res.json();
  return endpoint;
}

export async function deleteWebhook(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/webhooks/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error(await readError(res));
}

export async function testWebhook(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/webhooks/${encodeURIComponent(id)}/test`, {
    method: 'POST',
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error(await readError(res));
}

export async function listDeliveries(id: string, limit = 50): Promise<WebhookDelivery[]> {
  const res = await fetch(
    `${API_BASE}/webhooks/${encodeURIComponent(id)}/deliveries?limit=${limit}`,
    { headers: await authHeaders() },
  );
  if (!res.ok) throw new Error(await readError(res));
  const { deliveries } = await res.json();
  return deliveries || [];
}
