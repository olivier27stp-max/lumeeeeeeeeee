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

type NotifLang = 'fr' | 'en';

/**
 * Destinataires internes d'un devis : owners + admins actifs de l'org, plus
 * le vendeur assigné (salesperson_id, sinon le créateur du devis) s'il est
 * encore membre actif. Retourne user_id → langue (memberships.language,
 * défaut fr) pour localiser chaque ligne.
 */
export async function resolveQuoteRecipients(
  supabase: SupabaseClient,
  orgId: string,
  quote: { salesperson_id?: string | null; created_by?: string | null },
): Promise<Map<string, NotifLang>> {
  const out = new Map<string, NotifLang>();
  const { data: members, error } = await supabase
    .from('memberships')
    .select('user_id, role, status, language')
    .eq('org_id', orgId);
  if (error) {
    console.error('[notifications] memberships lookup failed:', error.message);
    return out;
  }
  const assigned = quote.salesperson_id || quote.created_by || null;
  for (const m of (members || []) as Array<{ user_id: string; role: string | null; status: string | null; language: string | null }>) {
    if (!m.user_id) continue;
    if (m.status && m.status !== 'active') continue;
    const isManager = m.role === 'owner' || m.role === 'admin';
    if (!isManager && m.user_id !== assigned) continue;
    out.set(m.user_id, m.language === 'en' ? 'en' : 'fr');
  }
  return out;
}

/**
 * Insère UNE notification par destinataire (user_id renseigné) : chacun a
 * son propre non-lu, la RLS ne montre la ligne qu'à lui, et le trigger DB
 * fn_push_on_notification pousse sur SES appareils mobiles seulement (pas
 * d'appel à sendExpoPushToOrg ici : il enverrait à tout l'org et doublerait
 * le trigger). Sans destinataire résolu, retombe sur une ligne org-wide
 * (user_id NULL) pour ne jamais perdre l'événement. Ne lance jamais.
 */
export async function insertTargetedNotifications(
  supabase: SupabaseClient,
  orgId: string,
  recipients: Map<string, NotifLang>,
  build: (lang: NotifLang) => { title: string; body: string },
  extra: {
    type: string;
    entityType?: string | null;
    entityId?: string | null;
    link?: string | null;
    icon?: string | null;
    actorName?: string | null;
  },
): Promise<void> {
  const base = {
    org_id: orgId,
    type: extra.type,
    entity_type: extra.entityType ?? null,
    entity_id: extra.entityId ?? null,
    reference_id: extra.entityId ?? null,
    link: extra.link ?? null,
    icon: extra.icon ?? null,
    actor_name: extra.actorName ?? null,
  };
  const targets: Array<[string | null, NotifLang]> = recipients.size > 0
    ? Array.from(recipients.entries())
    : [[null, 'fr']];
  const rows = targets.map(([userId, lang]) => {
    const { title, body } = build(lang);
    return { ...base, user_id: userId, title, body, message: body };
  });

  let { error } = await supabase.from('notifications').insert(rows);
  // Colonne inconnue (schéma sans entity_*/actor_name/message) : réessayer
  // avec la forme minimale pour que la cloche sonne quand même.
  if (error && (error.code === 'PGRST204' || error.code === '42703')) {
    const legacy = rows.map(({ entity_type: _et, entity_id: _ei, actor_name: _an, message: _m, ...r }) => r);
    ({ error } = await supabase.from('notifications').insert(legacy));
  }
  if (error) console.error(`[notifications] targeted insert (${extra.type}) failed:`, error.message);
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
