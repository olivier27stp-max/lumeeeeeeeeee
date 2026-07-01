/**
 * SMS 2FA client — enroll a phone, run step-up challenges, read status.
 * On a successful verify the server returns a device token that we persist so
 * this device stays trusted for 30 days.
 */
import { supabase } from './supabase';
import { setDeviceToken, deviceTokenHeader } from './deviceToken';

const API_BASE = '/api';

async function headers(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  let activeOrg = '';
  try { activeOrg = localStorage.getItem('lume-active-org') || ''; } catch {}
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session?.access_token || ''}`,
    'x-org-id': activeOrg,
    ...deviceTokenHeader(),
  };
}

type ApiError = Error & { code?: string };

async function call<T>(path: string, method: 'GET' | 'POST', body?: any): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: await headers(),
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err: ApiError = new Error((payload as any)?.error || `Request failed (${res.status}).`);
    if ((payload as any)?.code) err.code = (payload as any).code;
    throw err;
  }
  return payload as T;
}

export interface SmsStatus {
  sms_configured: boolean;
  enrolled: boolean;
  phone_hint: string | null;
  device_trusted: boolean;
  trust_days: number;
}

export function getSmsStatus(): Promise<SmsStatus> {
  return call<SmsStatus>('/mfa/sms/status', 'GET');
}

export function enrollStart(phone: string): Promise<{ sent: boolean; phone_hint: string }> {
  return call('/mfa/sms/enroll/start', 'POST', { phone });
}

export async function enrollVerify(code: string): Promise<void> {
  const r = await call<{ verified: boolean; device_token: string }>('/mfa/sms/enroll/verify', 'POST', { code });
  if (r.device_token) setDeviceToken(r.device_token);
}

export function challengeStart(): Promise<{ sent: boolean; phone_hint: string }> {
  return call('/mfa/sms/challenge/start', 'POST');
}

export async function challengeVerify(code: string): Promise<void> {
  const r = await call<{ verified: boolean; device_token: string }>('/mfa/sms/challenge/verify', 'POST', { code });
  if (r.device_token) setDeviceToken(r.device_token);
}
