import type { SupabaseClient } from '@supabase/supabase-js';

import { sendExpoPushToOrg } from './pushNotifications';

interface TwilioConfig {
  client: any;
  phoneNumber: string;
}

/**
 * Insert a notification row into the notifications table.
 */
export async function createNotification(
  supabase: SupabaseClient,
  orgId: string,
  title: string,
  body: string,
  referenceId?: string | null,
  type: string = 'automation',
) {
  const { error } = await supabase.from('notifications').insert({
    org_id: orgId,
    type,
    title,
    body,
    reference_id: referenceId ?? null,
  });
  if (error) {
    console.error('[notifications] insert failed:', error.message);
    return;
  }

  // Also deliver as a device push (never throws; no-op if the org has no tokens).
  await sendExpoPushToOrg(supabase, orgId, {
    title,
    body,
    data: { type, referenceId: referenceId ?? null },
  });
}

/**
 * Le destinataire a-t-il répondu STOP à cette organisation ?
 *
 * Conformité CASL/A2P. La vérification existait déjà, dupliquée, dans
 * `routes/messages.ts` et `lib/actions/index.ts` — mais 8 des 10 points
 * d'envoi l'ignoraient : un client ayant répondu STOP continuait de recevoir
 * devis, contrats, demandes de paiement et toutes les relances automatiques.
 *
 * Fail-open volontaire : si la requête échoue, on laisse passer l'envoi plutôt
 * que de bloquer silencieusement toutes les communications d'un tenant sur un
 * incident de base de données. L'erreur est journalisée.
 *
 * @param supabase client ayant accès à `sms_opt_outs` (service ou org-scopé)
 * @param phone    numéro déjà normalisé en E.164
 */
export async function isSmsOptedOut(
  supabase: SupabaseClient,
  orgId: string,
  phone: string | null | undefined,
): Promise<boolean> {
  if (!phone) return false;
  try {
    const { data, error } = await supabase
      .from('sms_opt_outs')
      .select('id')
      .eq('org_id', orgId)
      .eq('phone', phone)
      .maybeSingle();
    if (error) {
      console.error('[sms] opt-out lookup failed (envoi autorisé par défaut):', error.message);
      return false;
    }
    return !!data;
  } catch (err: any) {
    console.error('[sms] opt-out lookup threw (envoi autorisé par défaut):', err?.message);
    return false;
  }
}

/**
 * Cette adresse s'est-elle désabonnée des courriels de cette organisation ?
 *
 * Conformité CASL. Pendant email de `isSmsOptedOut`. À n'appeler QUE pour les
 * communications commerciales (relances, suivis, réengagement) : les courriels
 * strictement transactionnels — reçu de paiement, facture demandée, courriel
 * de sécurité — ne se désabonnent pas, et c'est légal.
 *
 * Fail-open, comme pour le SMS : un incident de lecture ne doit pas couper
 * toutes les communications d'un locataire.
 */
export async function isEmailUnsubscribed(
  supabase: SupabaseClient,
  orgId: string,
  email: string | null | undefined,
): Promise<boolean> {
  if (!email) return false;
  try {
    // `category = 'pending'` = la ligne n'est qu'un porteur de jeton, créée
    // pour construire le lien du pied de page. Elle ne devient un
    // désabonnement qu'au clic (la route publique bascule la catégorie).
    const { data, error } = await supabase
      .from('email_unsubscribes')
      .select('id')
      .eq('org_id', orgId)
      .eq('email', email.trim().toLowerCase())
      .neq('category', 'pending')
      .limit(1)
      .maybeSingle();
    if (error) {
      console.error('[email] vérification de désabonnement échouée (envoi autorisé par défaut):', error.message);
      return false;
    }
    return !!data;
  } catch (err: any) {
    console.error('[email] vérification de désabonnement échouée (envoi autorisé par défaut):', err?.message);
    return false;
  }
}

/**
 * Récupère (ou crée) le jeton de désinscription d'une adresse, et retourne le
 * lien à insérer dans le pied de page.
 *
 * Le jeton est créé à l'avance, sans marquer l'adresse comme désabonnée : la
 * ligne ne porte le désabonnement qu'une fois le lien réellement cliqué.
 * Retourne `null` si le lien ne peut pas être construit — on préfère un
 * courriel sans lien qu'un courriel avec un lien mort.
 */
export async function getUnsubscribeUrl(
  supabase: SupabaseClient,
  orgId: string,
  email: string | null | undefined,
): Promise<string | null> {
  if (!email) return null;
  const base = (process.env.FRONTEND_URL || process.env.PUBLIC_URL || '').trim().replace(/\/$/, '');
  if (!base || !/^https?:\/\//.test(base)) return null;

  const normalise = email.trim().toLowerCase();
  try {
    const { data: existant } = await supabase
      .from('email_unsubscribes')
      .select('token')
      .eq('org_id', orgId)
      .eq('email', normalise)
      .limit(1)
      .maybeSingle();
    if (existant?.token) return `${base}/api/unsubscribe/${existant.token}`;

    // Créée en `category: 'pending'` : simple porteur de jeton, ignoré par
    // `isEmailUnsubscribed` tant que le lien n'a pas été cliqué.
    const { data: cree, error } = await supabase
      .from('email_unsubscribes')
      .insert({ org_id: orgId, email: normalise, category: 'pending' })
      .select('token')
      .single();
    if (error || !cree?.token) {
      console.error('[email] création du jeton de désinscription échouée:', error?.message);
      return null;
    }
    return `${base}/api/unsubscribe/${cree.token}`;
  } catch (err: any) {
    console.error('[email] création du jeton de désinscription échouée:', err?.message);
    return null;
  }
}

/**
 * Résultat d'un envoi SMS.
 *
 * `sent: false` ne veut pas dire « erreur Twilio » : il couvre aussi les cas où
 * l'envoi n'a même pas été tenté (pas de config, pas de numéro). `reason` sert
 * précisément à distinguer les deux, parce que « le SMS n'est pas parti parce
 * qu'aucun numéro n'est provisionné » et « Twilio a rejeté le message » n'ont
 * ni la même cause ni le même correctif.
 */
export interface SmsSendResult {
  sent: boolean;
  sid?: string;
  /** `not_configured` | `no_recipient` | `send_failed` */
  reason?: 'not_configured' | 'no_recipient' | 'send_failed';
  error?: string;
}

/**
 * Envoie un SMS via Twilio si la configuration le permet.
 *
 * Ne lève JAMAIS — mais retourne désormais ce qui s'est réellement passé.
 *
 * Historique : cette fonction avalait ses erreurs et retournait `undefined`
 * quoi qu'il arrive. Impossible pour un appelant de distinguer « envoyé »,
 * « sauté » et « échoué ». Deux conséquences réelles en production :
 *   - `reminders-cron` enveloppait l'appel dans un try/catch inatteignable et
 *     écrivait `status: 'sent'` en base même quand Twilio rejetait le message ;
 *   - le scheduler affichait une notification « envoyé » à l'utilisateur pour
 *     des SMS qui n'étaient jamais partis.
 *
 * Le retour est rétrocompatible : un appelant qui ignore la valeur se comporte
 * exactement comme avant.
 */
export async function sendSmsIfConfigured(
  twilio: TwilioConfig | null,
  to: string | null | undefined,
  body: string,
): Promise<SmsSendResult> {
  if (!twilio || !twilio.client || !twilio.phoneNumber) {
    console.warn('[sms] skipped — Twilio not configured (no client or no from-number)');
    return { sent: false, reason: 'not_configured' };
  }
  if (!to) {
    console.warn('[sms] skipped — recipient has no phone number');
    return { sent: false, reason: 'no_recipient' };
  }
  try {
    const { getTwilioStatusCallbackUrl } = await import('./config');
    const statusCallback = getTwilioStatusCallbackUrl();
    const msg = await twilio.client.messages.create({
      body,
      from: twilio.phoneNumber,
      to,
      // Sans ce paramètre, Twilio ne renvoie aucun accusé de réception pour un
      // message sortant : le statut resterait figé à « envoyé » même si
      // l'opérateur a rejeté le SMS.
      ...(statusCallback ? { statusCallback } : {}),
    });
    return { sent: true, sid: msg?.sid };
  } catch (err: any) {
    console.error('[sms] send failed:', err?.message);
    // Remonté à Sentry : l'erreur est attrapée volontairement ici, donc le
    // gestionnaire global d'Express ne la verrait jamais. Twilio expose un
    // `code` numérique très parlant (21610 = destinataire désabonné,
    // 21452 = solde insuffisant, 21408 = permissions géographiques) : on le
    // conserve pour pouvoir regrouper les incidents par cause.
    try {
      const { captureException } = await import('./sentry');
      captureException(err, {
        kind: 'sms_send_failed',
        twilio_code: err?.code,
        to,
        from: twilio.phoneNumber,
      });
    } catch { /* no-op */ }
    return { sent: false, reason: 'send_failed', error: err?.message || 'send failed' };
  }
}

/**
 * Apply {variable} substitution on a template string.
 * Also supports legacy [variable] syntax for backward compat.
 */
export function applyTemplate(
  template: string,
  vars: Record<string, string | null | undefined>,
): string {
  return template
    .replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? '')
    .replace(/\[(\w+)\]/g, (_, key) => vars[key] ?? '');
}
