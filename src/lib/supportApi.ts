import { supabase } from './supabase';

export type SupportCategory = 'question' | 'bug' | 'billing' | 'feature' | 'other';

export interface SupportRequestInput {
  subject: string;
  message: string;
  category?: SupportCategory;
}

export interface SupportRequestResult {
  ok: true;
  priority: 'priority' | 'normal';
  sla: string;
}

async function authHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session?.access_token || ''}`,
  };
}

export async function submitSupportRequest(input: SupportRequestInput): Promise<SupportRequestResult> {
  const response = await fetch('/api/support', {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(input),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || 'Could not send your support request.');
  }
  return data as SupportRequestResult;
}
