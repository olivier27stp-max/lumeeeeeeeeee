/**
 * SMS-based 2FA + trusted-device helpers.
 *
 * Flow: a user verifies a mobile number once (enroll). Afterwards, sensitive
 * payment actions (or a login from a new device) trigger a one-time SMS code
 * — unless the current device is already trusted (30 days). Codes are stored
 * hashed with a short TTL and attempt cap; device tokens are random and only
 * their hash is persisted.
 */
import crypto from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { twilioClient, twilioPhoneNumber } from './config';

export const DEVICE_TRUST_DAYS = 30;
const CODE_TTL_MINUTES = 10;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_SECONDS = 30;

export function isSmsConfigured(): boolean {
  return !!(twilioClient && twilioPhoneNumber);
}

function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function generateCode(): string {
  // 6-digit, uniformly random, zero-padded.
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

export function newDeviceToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function hashDeviceToken(token: string): string {
  return sha256(token);
}

/** The verified phone for a user, or null if none/unverified. */
export async function getVerifiedPhone(admin: SupabaseClient, userId: string): Promise<string | null> {
  const { data } = await admin
    .from('mfa_phone')
    .select('phone, verified_at')
    .eq('user_id', userId)
    .maybeSingle();
  return data?.verified_at ? (data.phone as string) : null;
}

/** True if the device token maps to a non-expired trusted device (bumps last_seen). */
export async function isDeviceTrusted(admin: SupabaseClient, userId: string, token: string | null | undefined): Promise<boolean> {
  if (!token) return false;
  const tokenHash = hashDeviceToken(token);
  const { data } = await admin
    .from('mfa_trusted_devices')
    .select('id, expires_at')
    .eq('user_id', userId)
    .eq('token_hash', tokenHash)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();
  if (!data?.id) return false;
  // Best-effort refresh of last_seen; never block on it.
  admin.from('mfa_trusted_devices').update({ last_seen_at: new Date().toISOString() }).eq('id', data.id).then(() => {}, () => {});
  return true;
}

/** Persist a new trusted device (30 days) and return the raw token to hand to the client. */
export async function trustDevice(admin: SupabaseClient, userId: string, label?: string | null): Promise<string> {
  const token = newDeviceToken();
  const expiresAt = new Date(Date.now() + DEVICE_TRUST_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await admin.from('mfa_trusted_devices').insert({
    user_id: userId,
    token_hash: hashDeviceToken(token),
    label: label || null,
    expires_at: expiresAt,
  });
  return token;
}

/** Send an OTP for the given purpose. Returns the last 4 digits of the target phone for UI. */
export async function startSmsChallenge(
  admin: SupabaseClient,
  userId: string,
  phone: string,
  purpose: 'enroll' | 'stepup',
): Promise<{ ok: boolean; phoneHint?: string; error?: string; retryAfter?: number }> {
  if (!isSmsConfigured()) return { ok: false, error: 'sms_not_configured' };

  // Cooldown: block rapid re-sends.
  const { data: recent } = await admin
    .from('mfa_sms_challenges')
    .select('created_at')
    .eq('user_id', userId)
    .eq('purpose', purpose)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (recent?.created_at) {
    const elapsed = (Date.now() - new Date(recent.created_at).getTime()) / 1000;
    if (elapsed < RESEND_COOLDOWN_SECONDS) {
      return { ok: false, error: 'too_soon', retryAfter: Math.ceil(RESEND_COOLDOWN_SECONDS - elapsed) };
    }
  }

  const code = generateCode();
  const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000).toISOString();
  const { error: insertErr } = await admin.from('mfa_sms_challenges').insert({
    user_id: userId,
    phone,
    code_hash: sha256(code),
    purpose,
    expires_at: expiresAt,
  });
  // Never send an SMS whose code was not persisted — it would be unverifiable.
  if (insertErr) throw new Error('mfa_sms_challenges insert failed: ' + insertErr.message);

  try {
    await twilioClient!.messages.create({
      from: twilioPhoneNumber,
      to: phone,
      body: `Lume: your verification code is ${code}. It expires in ${CODE_TTL_MINUTES} minutes.`,
    });
  } catch (err: any) {
    return { ok: false, error: err?.message || 'sms_send_failed' };
  }

  const digits = phone.replace(/\D/g, '');
  return { ok: true, phoneHint: digits.slice(-4) };
}

/** Verify a submitted code for the latest pending challenge of the given purpose. */
export async function verifySmsChallenge(
  admin: SupabaseClient,
  userId: string,
  code: string,
  purpose: 'enroll' | 'stepup',
): Promise<{ ok: boolean; phone?: string; error?: string }> {
  const { data: challenge } = await admin
    .from('mfa_sms_challenges')
    .select('id, phone, code_hash, attempts, expires_at, consumed_at')
    .eq('user_id', userId)
    .eq('purpose', purpose)
    .is('consumed_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!challenge?.id) return { ok: false, error: 'no_pending_code' };
  if (new Date(challenge.expires_at) < new Date()) return { ok: false, error: 'code_expired' };
  if ((challenge.attempts ?? 0) >= MAX_ATTEMPTS) return { ok: false, error: 'too_many_attempts' };

  const matches = sha256(String(code || '').trim()) === challenge.code_hash;
  if (!matches) {
    const { error: attemptsErr } = await admin.from('mfa_sms_challenges').update({ attempts: (challenge.attempts ?? 0) + 1 }).eq('id', challenge.id);
    // If the attempt counter cannot be persisted, refuse further verification
    // rather than allowing an unbounded bruteforce window.
    if (attemptsErr) throw new Error('mfa_sms_challenges attempts update failed: ' + attemptsErr.message);
    return { ok: false, error: 'invalid_code' };
  }

  const { error: consumeErr } = await admin.from('mfa_sms_challenges').update({ consumed_at: new Date().toISOString() }).eq('id', challenge.id);
  // A code that cannot be marked consumed must not be treated as verified,
  // otherwise the same code stays replayable.
  if (consumeErr) throw new Error('mfa_sms_challenges consume update failed: ' + consumeErr.message);
  return { ok: true, phone: challenge.phone as string };
}
