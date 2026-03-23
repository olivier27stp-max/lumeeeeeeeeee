import { supabase } from './supabase';

const API_BASE = '/api';

async function authHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session?.access_token || ''}`,
  };
}

// ── Types ────────────────────────────────────────────────────────

export type ReferralStatus = 'invited' | 'signed_up' | 'subscribed' | 'reward_pending' | 'rewarded';

export interface Referral {
  id: string;
  referrer_user_id: string;
  referrer_org_id: string;
  code: string;
  referred_email: string;
  referred_org_id: string | null;
  referred_user_id: string | null;
  status: ReferralStatus;
  reward_amount_cents: number;
  reward_currency: string;
  converted_at: string | null;
  rewarded_at: string | null;
  created_at: string;
}

export interface ReferralStats {
  total: number;
  converted: number;
  pending: number;
  total_rewards_cents: number;
}

// ── API functions ────────────────────────────────────────────────

export async function fetchMyReferralCode(): Promise<{ code: string; referral_link: string }> {
  const res = await fetch(`${API_BASE}/referrals/me`, {
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error('Failed to get referral code.');
  return res.json();
}

export async function fetchReferralHistory(): Promise<{ referrals: Referral[]; stats: ReferralStats }> {
  const res = await fetch(`${API_BASE}/referrals/history`, {
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error('Failed to load referral history.');
  return res.json();
}

export async function trackReferral(code: string, email?: string): Promise<void> {
  await fetch(`${API_BASE}/referrals/track`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, email }),
  });
}

export async function validateReferralCode(code: string): Promise<boolean> {
  const res = await fetch(`${API_BASE}/referrals/validate/${encodeURIComponent(code)}`);
  if (!res.ok) return false;
  const data = await res.json();
  return data.valid === true;
}
