/**
 * LUME CRM — SMS 2FA + trusted-device routes
 * ===========================================
 * Owners verify a mobile number, then step up with an SMS code on sensitive
 * payment actions / new devices. A verified device receives a device token
 * (stored client-side, sent as `x-device-token`) that keeps it trusted for
 * 30 days so it isn't re-challenged.
 */
import { Router } from 'express';
import { requireAuthedClient, getServiceClient } from '../lib/supabase';
import { guardCommonShape, maxBodySize } from '../lib/validation-guards';
import { sendSafeError } from '../lib/error-handler';
import {
  isSmsConfigured,
  getVerifiedPhone,
  isDeviceTrusted,
  trustDevice,
  startSmsChallenge,
  verifySmsChallenge,
  DEVICE_TRUST_DAYS,
} from '../lib/mfa-sms';

const router = Router();
router.use(maxBodySize());
router.use(guardCommonShape);

/** Very light E.164 sanity check; Twilio does the real validation on send. */
function normalizePhone(raw: unknown): string | null {
  const s = String(raw || '').trim().replace(/[()\s.-]/g, '');
  if (/^\+[1-9]\d{7,14}$/.test(s)) return s;
  // Bare 10-digit North-American number → assume +1.
  if (/^\d{10}$/.test(s)) return `+1${s}`;
  return null;
}

function deviceTokenFrom(req: any): string | null {
  const h = req.header('x-device-token');
  return typeof h === 'string' && h.length >= 32 ? h : null;
}

function deviceLabel(req: any): string {
  const ua = String(req.header('user-agent') || '');
  const os = /Mac/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : 'Unknown';
  const br = /Edg/.test(ua) ? 'Edge' : /Chrome/.test(ua) ? 'Chrome' : /Firefox/.test(ua) ? 'Firefox' : /Safari/.test(ua) ? 'Safari' : 'Browser';
  return `${br} · ${os}`;
}

// ── GET /api/mfa/sms/status — enrollment + this-device trust state ──
router.get('/mfa/sms/status', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const admin = getServiceClient();
    const phone = await getVerifiedPhone(admin, auth.user.id);
    const trusted = await isDeviceTrusted(admin, auth.user.id, deviceTokenFrom(req));
    const hint = phone ? phone.replace(/\D/g, '').slice(-4) : null;
    return res.json({
      sms_configured: isSmsConfigured(),
      enrolled: !!phone,
      phone_hint: hint,
      device_trusted: trusted,
      trust_days: DEVICE_TRUST_DAYS,
    });
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to load 2FA status.', '[mfa/sms/status]');
  }
});

// ── POST /api/mfa/sms/enroll/start — send code to a new number ──
router.post('/mfa/sms/enroll/start', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    if (!isSmsConfigured()) return res.status(503).json({ error: 'SMS is not configured on the server.', code: 'sms_not_configured' });

    const phone = normalizePhone(req.body?.phone);
    if (!phone) return res.status(400).json({ error: 'Enter a valid mobile number.', code: 'invalid_phone' });

    const admin = getServiceClient();
    // Upsert the (unverified) phone so verify knows the target number.
    await admin.from('mfa_phone').upsert(
      { user_id: auth.user.id, org_id: auth.orgId, phone, verified_at: null, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    );

    const result = await startSmsChallenge(admin, auth.user.id, phone, 'enroll');
    if (!result.ok) {
      const status = result.error === 'too_soon' ? 429 : 502;
      return res.status(status).json({ error: result.error, retry_after: (result as any).retryAfter });
    }
    return res.json({ sent: true, phone_hint: result.phoneHint });
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to start verification.', '[mfa/sms/enroll/start]');
  }
});

// ── POST /api/mfa/sms/enroll/verify — confirm number, trust this device ──
router.post('/mfa/sms/enroll/verify', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const admin = getServiceClient();

    const result = await verifySmsChallenge(admin, auth.user.id, String(req.body?.code || ''), 'enroll');
    if (!result.ok) return res.status(400).json({ error: result.error, code: result.error });

    await admin.from('mfa_phone').update({ verified_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('user_id', auth.user.id);
    const deviceToken = await trustDevice(admin, auth.user.id, deviceLabel(req));
    return res.json({ verified: true, device_token: deviceToken });
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to verify code.', '[mfa/sms/enroll/verify]');
  }
});

// ── POST /api/mfa/sms/challenge/start — step-up: send code to verified phone ──
router.post('/mfa/sms/challenge/start', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const admin = getServiceClient();

    const phone = await getVerifiedPhone(admin, auth.user.id);
    if (!phone) return res.status(400).json({ error: 'No verified phone number.', code: 'not_enrolled' });

    const result = await startSmsChallenge(admin, auth.user.id, phone, 'stepup');
    if (!result.ok) {
      const status = result.error === 'too_soon' ? 429 : 502;
      return res.status(status).json({ error: result.error, retry_after: (result as any).retryAfter });
    }
    return res.json({ sent: true, phone_hint: result.phoneHint });
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to send code.', '[mfa/sms/challenge/start]');
  }
});

// ── POST /api/mfa/sms/challenge/verify — step-up: verify + trust this device ──
router.post('/mfa/sms/challenge/verify', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const admin = getServiceClient();

    const result = await verifySmsChallenge(admin, auth.user.id, String(req.body?.code || ''), 'stepup');
    if (!result.ok) return res.status(400).json({ error: result.error, code: result.error });

    const deviceToken = await trustDevice(admin, auth.user.id, deviceLabel(req));
    return res.json({ verified: true, device_token: deviceToken });
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to verify code.', '[mfa/sms/challenge/verify]');
  }
});

export default router;
