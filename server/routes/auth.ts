import { Router } from 'express';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { supabaseUrl, supabaseServiceRoleKey } from '../lib/config';
import { getBaseUrl } from '../lib/config';
import { sendSafeError } from '../lib/error-handler';
import { passwordSchema } from '../lib/validation';
import { sendEmail, isMailerConfigured } from '../lib/mailer';
import { guardCommonShape, maxBodySize } from '../lib/validation-guards';
import { findUserByEmail } from '../lib/supabase';
import { redisRateLimit } from '../lib/rate-limiter';
import { extractIP, recordLoginAttempt } from '../lib/security';

// Per-IP rate limit for auth endpoints (defeats brute-force + cron-driven abuse)
const authRateLimit = redisRateLimit({
  preset: 'auth',
  keyFn: (req) => `auth:${extractIP(req)}`,
});

const router = Router();
router.use(maxBodySize());
router.use(guardCommonShape);

function getAdminClient() {
  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Envoie le courriel de confirmation de compte.
 *
 * Retourne désormais le résultat au lieu de `void` : la fonction ne le lisait
 * pas et les appelants journalisaient « email sent » sans preuve. Sur le
 * parcours d'achat (`register-checkout`), le paiement reste bloqué tant que
 * l'adresse n'est pas confirmée — un courriel non délivré laissait donc un
 * client payant coincé, sans le moindre signal côté serveur.
 */
async function sendVerificationEmail(
  to: string,
  verifyUrl: string,
  name: string,
): Promise<{ sent: boolean; error?: string }> {
  if (!isMailerConfigured()) {
    console.error('[auth] SMTP non configuré — courriel de vérification NON envoyé à', to);
    return { sent: false, error: 'SMTP not configured' };
  }

  const result = await sendEmail({
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

  if (!result.sent) {
    // Journalisé en `error` (et non `log`) : l'utilisateur ne pourra pas
    // confirmer son compte, donc pas payer. C'est un incident, pas une trace.
    console.error('[auth] échec d’envoi du courriel de vérification à', to, '—', result.error);
  }
  return { sent: result.sent, error: result.error };
}

// ─── POST /api/auth/register — create account + send verification email ───
router.post('/auth/register', authRateLimit, async (req, res) => {
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
          const existingUser = await findUserByEmail(admin, email);

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
            // `sendVerificationEmail` ne lève jamais et journalise elle-même
            // ses échecs : le try/catch qui entourait cet appel était une
            // branche morte, et le `console.log` qui suivait affirmait un
            // envoi jamais vérifié.
            await sendVerificationEmail(email, verifyUrl, fullName.trim());
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

    const verif = await sendVerificationEmail(email, verifyUrl, fullName.trim());

    // `ok: true` est conservé même en cas d'échec d'envoi : le compte EST créé,
    // et une réponse uniforme évite l'énumération d'adresses. Mais le drapeau
    // permet au front d'afficher « nous n'avons pas pu envoyer le courriel »
    // plutôt que de laisser l'utilisateur attendre indéfiniment.
    return res.json({ ok: true, verification_email_sent: verif.sent });
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to create account.', '[auth]');
  }
});

// ─── POST /api/auth/verify-email — verify token + confirm user ───────────
router.post('/auth/verify-email', authRateLimit, async (req, res) => {
  try {
    const { email, token } = req.body;

    if (!email || !token) {
      return res.status(400).json({ error: 'Email and token are required.' });
    }
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) {
      return res.status(400).json({ error: 'Invalid verification link.' });
    }

    const admin = getAdminClient();

    // Targeted lookup (was: listUsers — O(N) + 50-row default page)
    const user: any = await findUserByEmail(admin, email);
    if (!user) {
      // Add a small random delay so missing-user and bad-token paths
      // are not distinguishable by response time.
      await new Promise(r => setTimeout(r, 50 + Math.random() * 100));
      return res.status(400).json({ error: 'Invalid verification link.' });
    }

    // Constant-time token compare
    const meta = user.user_metadata || {};
    const stored = String(meta.verification_token || '');
    const a = Buffer.from(token);
    const b = Buffer.from(stored.padEnd(token.length, '\0').slice(0, token.length));
    const ok = stored.length === token.length && crypto.timingSafeEqual(a, b);
    if (!ok) {
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
router.post('/auth/resend-verification', authRateLimit, async (req, res) => {
  try {
    const { email } = req.body;

    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'Email is required.' });
    }

    const admin = getAdminClient();

    // Targeted lookup (was: listUsers — O(N))
    const user: any = await findUserByEmail(admin, email);

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

    // Renvoi explicitement demandé par l'utilisateur : il doit savoir si le
    // courriel est réellement reparti, sinon il attend indéfiniment un message
    // qui n'arrivera jamais.
    const verif = await sendVerificationEmail(email, verifyUrl, name);

    return res.json({
      ok: true,
      sent: verif.sent,
      ...(verif.sent ? {} : { error_detail: verif.error }),
    });
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to resend verification.', '[auth]');
  }
});

// ─── POST /api/auth/register-checkout — create account for checkout flow ───
// Creates user with email auto-confirmed (for Supabase sign-in), and sends
// a verification email. Tracks billing email verification in user_metadata.
// Backend payment gates check user_metadata.billing_email_verified before
// allowing payment to proceed.
router.post('/auth/register-checkout', authRateLimit, async (req, res) => {
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
        const existingUser: any = await findUserByEmail(admin, email);
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
            await sendVerificationEmail(email, verifyUrl, fullName.trim());
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
    // Le résultat est remonté au client : sur ce parcours, le paiement est
    // bloqué tant que l'adresse n'est pas confirmée. Un courriel non délivré
    // laissait l'acheteur coincé sans explication, pendant que le serveur
    // journalisait « Verification email sent » sans aucune preuve.
    const verif = await sendVerificationEmail(email, verifyUrl, fullName.trim());

    return res.json({
      ok: true,
      userId: userData.user?.id,
      email_verified: false,
      verification_email_sent: verif.sent,
      ...(verif.sent ? {} : { verification_email_error: verif.error }),
    });
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to create account.', '[auth]');
  }
});

// ────────────────────────────────────────────────────────────────────
// POST /api/auth/login-failed — télémétrie des tentatives échouées
// ────────────────────────────────────────────────────────────────────
//
// POURQUOI CET ENDPOINT EXISTE
// L'authentification se fait entièrement dans le navigateur
// (src/pages/Auth.tsx, supabase.auth.signInWithPassword) : le serveur ne voit
// jamais un échec de connexion. Résultat, `failed_login_attempts` et
// `ip_blocklist` sont restées vides depuis toujours, et
// `recordLoginAttempt()` — pourtant écrite, détection de force brute
// comprise — n'était appelée nulle part (audit 2026-07-31).
//
// Les connexions RÉUSSIES, elles, n'ont pas besoin de ce chemin : elles
// créent une ligne dans `auth.sessions`, que la tâche
// `lume_sync_auth_telemetry` recopie toutes les 15 minutes vers
// `login_history`. Cet endpoint ne traite donc QUE les échecs.
//
// PRÉCAUTIONS — c'est un point d'entrée NON AUTHENTIFIÉ
//   * limité par IP via `authRateLimit`, comme les autres routes d'auth ;
//   * répond TOUJOURS 204, quoi qu'il arrive : il ne doit jamais révéler si
//     un compte existe, ni si l'enregistrement a réussi. C'est de la
//     télémétrie, pas une API ;
//   * n'accepte AUCUN identifiant venant du client — l'utilisateur est résolu
//     côté serveur à partir du courriel ;
//   * n'accepte pas de rapport de succès : un client qui affirme avoir réussi
//     ne prouve rien.
router.post('/auth/login-failed', authRateLimit, async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase().slice(0, 320);
    const reason = String(req.body?.reason || 'invalid_credentials').slice(0, 120);
    if (!email || !email.includes('@')) return res.status(204).end();

    const admin = getAdminClient();

    const { error } = await admin.from('failed_login_attempts').insert({
      email,
      ip_address: extractIP(req),
      user_agent: String(req.headers['user-agent'] || '').slice(0, 500) || null,
      reason,
    });
    if (error) console.error('[auth/login-failed] insert refusé:', error.message, error.code || '');

    // Si le courriel correspond à un compte connu, on alimente aussi
    // login_history : c'est elle que lit la détection de force brute.
    const user = await findUserByEmail(admin, email);
    if (user?.id) {
      // On résout l'organisation CÔTÉ SERVEUR. Ce n'est pas cosmétique :
      // la détection de force brute déclenche createSecurityAlert(), et
      // security_alerts.org_id est `uuid NOT NULL`. Sans org valide, l'alerte
      // est rejetée — c'est-à-dire que la détection fonctionne mais que
      // personne n'en voit jamais le résultat.
      const { data: membership } = await admin
        .from('memberships')
        .select('org_id')
        .eq('user_id', user.id)
        .order('created_at')
        .limit(1)
        .maybeSingle();

      await recordLoginAttempt({
        userId: user.id,
        orgId: membership?.org_id || undefined,
        req: req as any,
        success: false,
        method: 'password',
        failureReason: reason,
      });
    }
  } catch (err: any) {
    // Ne jamais faire échouer l'appelant : c'est de la télémétrie.
    console.error('[auth/login-failed] erreur inattendue:', err?.message);
  }
  return res.status(204).end();
});

export default router;
