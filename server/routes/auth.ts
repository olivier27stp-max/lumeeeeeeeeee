import { Router } from 'express';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { supabaseUrl, supabaseServiceRoleKey } from '../lib/config';
import { getBaseUrl } from '../lib/config';
import { sendSafeError } from '../lib/error-handler';
import { passwordSchema } from '../lib/validation';
import { sendEmail, isMailerConfigured } from '../lib/mailer';
import { guardCommonShape, maxBodySize } from '../lib/validation-guards';

const router = Router();
router.use(maxBodySize());
router.use(guardCommonShape);

function getAdminClient() {
  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function sendVerificationEmail(to: string, verifyUrl: string, name: string) {
  if (!isMailerConfigured()) {
    console.warn('[auth] SMTP not configured — verification email not sent');
    return;
  }

  await sendEmail({
    to,
    subject: 'Confirme ton compte Lume CRM',
    html: `
      <div style="font-family: -apple-system, sans-serif; max-width: 500px; margin: 0 auto; padding: 40px 20px;">
        <h1 style="font-size: 24px; font-weight: 300; letter-spacing: 4px; margin-bottom: 24px;">LUME</h1>
        <p style="font-size: 14px; color: #555; line-height: 1.6;">
          Salut <strong>${name}</strong>,
        </p>
        <p style="font-size: 14px; color: #555; line-height: 1.6;">
          Merci d'avoir créé ton compte. Clique sur le bouton ci-dessous pour confirmer ton adresse email et activer ton espace de travail.
        </p>
        <a href="${verifyUrl}" style="display: inline-block; margin-top: 24px; padding: 14px 32px; background: #111; color: white; text-decoration: none; border-radius: 8px; font-size: 14px; font-weight: 600; letter-spacing: 0.5px;">
          Confirmer mon compte
        </a>
        <p style="font-size: 12px; color: #999; margin-top: 32px;">
          Ce lien expire dans 24 heures. Si tu n'as pas créé de compte, ignore cet email.
        </p>
      </div>
    `,
  });
}

// ─── POST /api/auth/register — create account + send verification email ───
router.post('/auth/register', async (req, res) => {
  try {
    const { email, password, fullName } = req.body;

    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'Email is required.' });
    }
    if (!fullName || typeof fullName !== 'string' || fullName.trim().length < 1) {
      return res.status(400).json({ error: 'Full name is required.' });
    }

    // Validate password server-side
    const pwResult = passwordSchema.safeParse(password);
    if (!pwResult.success) {
      return res.status(400).json({ error: pwResult.error.issues[0].message });
    }

    const admin = getAdminClient();

    // Generate a verification token
    const verificationToken = crypto.randomBytes(32).toString('hex');
    const tokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24h

    // Create user via admin API — email NOT confirmed yet
    const { data: userData, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: false,
      user_metadata: {
        full_name: fullName.trim(),
        verification_token: verificationToken,
        verification_token_expires: tokenExpiry,
      },
    });

    if (createError) {
      // User already exists — resend verification if email not confirmed yet
      if (createError.message?.includes('already been registered') || createError.message?.includes('already exists')) {
        try {
          const { data: userList } = await admin.auth.admin.listUsers();
          const existingUser = userList?.users.find((u: any) => u.email === email) as any;

          if (existingUser && !existingUser.email_confirmed_at) {
            // Not confirmed yet — generate new token and resend
            const newToken = crypto.randomBytes(32).toString('hex');
            const newExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

            await (admin.auth.admin as any).updateUserById(existingUser.id, {
              user_metadata: {
                ...existingUser.user_metadata,
                full_name: fullName.trim(),
                verification_token: newToken,
                verification_token_expires: newExpiry,
              },
            });

            const baseUrl = getBaseUrl();
            const verifyUrl = `${baseUrl}/verify-email?token=${newToken}&email=${encodeURIComponent(email)}`;
            try {
              await sendVerificationEmail(email, verifyUrl, fullName.trim());
              console.log('[auth] Resent verification email for existing unconfirmed user:', email);
            } catch (emailErr: any) {
              console.error('[auth] Failed to resend verification email:', emailErr.message);
            }
          }
          // Already confirmed — return ok silently (prevent enumeration)
        } catch (lookupErr: any) {
          console.error('[auth] Error looking up existing user:', lookupErr.message);
        }
        return res.json({ ok: true });
      }
      console.error('[auth] createUser error:', createError.message);
      return res.status(400).json({ error: createError.message });
    }

    // New user created — send verification email
    const baseUrl = getBaseUrl();
    const verifyUrl = `${baseUrl}/verify-email?token=${verificationToken}&email=${encodeURIComponent(email)}`;

    try {
      await sendVerificationEmail(email, verifyUrl, fullName.trim());
    } catch (emailErr: any) {
      console.error('[auth] Failed to send verification email:', emailErr.message);
    }

    return res.json({ ok: true });
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to create account.', '[auth]');
  }
});

// ─── POST /api/auth/verify-email — verify token + confirm user ───────────
router.post('/auth/verify-email', async (req, res) => {
  try {
    const { email, token } = req.body;

    if (!email || !token) {
      return res.status(400).json({ error: 'Email and token are required.' });
    }

    const admin = getAdminClient();

    // Find user by email
    const { data: userList, error: listError } = await admin.auth.admin.listUsers();
    if (listError) {
      return res.status(500).json({ error: 'Internal error.' });
    }

    const user = userList.users.find((u: any) => u.email === email) as any;
    if (!user) {
      return res.status(400).json({ error: 'Invalid verification link.' });
    }

    // Check token matches
    const meta = user.user_metadata || {};
    if (meta.verification_token !== token) {
      return res.status(400).json({ error: 'Invalid verification link.' });
    }

    // Check token not expired
    if (meta.verification_token_expires && new Date(meta.verification_token_expires) < new Date()) {
      return res.status(400).json({ error: 'expired' });
    }

    // Confirm the user's email + mark billing email as verified
    const { error: updateError } = await (admin.auth.admin as any).updateUserById(user.id, {
      email_confirm: true,
      user_metadata: {
        ...meta,
        verification_token: null,
        verification_token_expires: null,
        billing_email_verified: true,
        billing_email_verified_at: new Date().toISOString(),
      },
    });

    if (updateError) {
      console.error('[auth] verify-email updateUser error:', updateError.message);
      return res.status(500).json({ error: 'Failed to verify email.' });
    }

    return res.json({ ok: true });
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to verify email.', '[auth]');
  }
});

// ─── POST /api/auth/resend-verification — resend verification email ──────
router.post('/auth/resend-verification', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'Email is required.' });
    }

    const admin = getAdminClient();

    // Find user
    const { data: userList } = await admin.auth.admin.listUsers();
    const user = userList?.users.find((u: any) => u.email === email) as any;

    // Always return success to prevent email enumeration
    if (!user || user.email_confirmed_at) {
      return res.json({ ok: true });
    }

    // Generate new token
    const verificationToken = crypto.randomBytes(32).toString('hex');
    const tokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    await (admin.auth.admin as any).updateUserById(user.id, {
      user_metadata: {
        ...user.user_metadata,
        verification_token: verificationToken,
        verification_token_expires: tokenExpiry,
      },
    });

    const baseUrl = getBaseUrl();
    const verifyUrl = `${baseUrl}/verify-email?token=${verificationToken}&email=${encodeURIComponent(email)}`;
    const name = user.user_metadata?.full_name || '';

    try {
      await sendVerificationEmail(email, verifyUrl, name);
    } catch (emailErr: any) {
      console.error('[auth] resend verification email failed:', emailErr.message);
    }

    return res.json({ ok: true });
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to resend verification.', '[auth]');
  }
});

// ─── POST /api/auth/register-checkout — create account for checkout flow ───
// Creates user with email auto-confirmed (for Supabase sign-in), and sends
// a verification email. Tracks billing email verification in user_metadata.
// Backend payment gates check user_metadata.billing_email_verified before
// allowing payment to proceed.
router.post('/auth/register-checkout', async (req, res) => {
  try {
    const { email, password, fullName } = req.body;
    if (!email || typeof email !== 'string') return res.status(400).json({ error: 'Email is required.' });
    if (!fullName || typeof fullName !== 'string') return res.status(400).json({ error: 'Full name is required.' });

    const pwResult = passwordSchema.safeParse(password);
    if (!pwResult.success) return res.status(400).json({ error: pwResult.error.issues[0].message });

    const admin = getAdminClient();

    // Generate verification token
    const verificationToken = crypto.randomBytes(32).toString('hex');
    const tokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    // Create user with email_confirm: true (allows Supabase sign-in)
    // but billing_email_verified: false — payment gates check this
    const { data: userData, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: fullName.trim(),
        billing_email_verified: false,
        verification_token: verificationToken,
        verification_token_expires: tokenExpiry,
      },
    });

    if (createError) {
      if (createError.message?.includes('already been registered') || createError.message?.includes('already exists')) {
        const { data: userList } = await admin.auth.admin.listUsers();
        const existingUser = userList?.users.find((u: any) => u.email === email) as any;
        if (existingUser) {
          const meta = existingUser.user_metadata || {};
          // If not billing-email-verified, resend verification
          if (!meta.billing_email_verified) {
            const newToken = crypto.randomBytes(32).toString('hex');
            const newExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
            await (admin.auth.admin as any).updateUserById(existingUser.id, {
              user_metadata: {
                ...meta,
                verification_token: newToken,
                verification_token_expires: newExpiry,
              },
            });
            const baseUrl = getBaseUrl();
            const verifyUrl = `${baseUrl}/verify-email?token=${newToken}&email=${encodeURIComponent(email)}`;
            try { await sendVerificationEmail(email, verifyUrl, fullName.trim()); } catch {}
          }
          return res.json({ ok: true, existing: true, email_verified: !!meta.billing_email_verified });
        }
        return res.json({ ok: true, existing: true });
      }
      return res.status(400).json({ error: createError.message });
    }

    // Send verification email for new user
    const baseUrl = getBaseUrl();
    const verifyUrl = `${baseUrl}/verify-email?token=${verificationToken}&email=${encodeURIComponent(email)}`;
    try {
      await sendVerificationEmail(email, verifyUrl, fullName.trim());
      console.log('[auth/register-checkout] Verification email sent to:', email);
    } catch (emailErr: any) {
      console.error('[auth/register-checkout] Verification email failed:', emailErr.message);
    }

    return res.json({ ok: true, userId: userData.user?.id, email_verified: false });
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to create account.', '[auth]');
  }
});

export default router;
