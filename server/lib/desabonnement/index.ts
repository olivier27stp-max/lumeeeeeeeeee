/* ═══════════════════════════════════════════════════════════════
   DÉSABONNEMENT PAR CANAL — courriel et texto, séparément.

   Derrière le drapeau `auto_desabonnement_canal`. Sans lui, rien ici n'est
   appelé et le moteur garde son comportement d'avant.

   Les données restent là où elles vivaient déjà — on les relie, on ne les
   remplace pas :
     • texto   → `sms_opt_outs` (org, numéro) — ce que lisent déjà les 10
                 points d'envoi SMS ;
     • courriel → `email_unsubscribes` catégorie ≠ 'pending' — ce que lit
                 déjà l'action « Envoyer un courriel » ;
     • preuve  → `consents` via la RPC `record_consent` (journal probant
                 LCAP), avec la SOURCE du retrait dans `method`.

   ── Transactionnel ou marketing ──
   Un désabonnement coupe le MARKETING de ce canal ; le transactionnel
   (soumission, facture, rappel de rendez-vous, reçu) continue. C'est ce que
   permet la LCAP (art. 6(6) : confirmer une transaction, fournir une
   soumission demandée, un renseignement sur un compte), et c'est ce que le
   client attend : se désabonner des promotions ne doit pas faire disparaître
   sa facture.

   Avant ce drapeau, « marketing » voulait dire « envoi différé » : un rappel
   de rendez-vous 1 jour avant était traité comme une relance commerciale.
   Avec le drapeau, chaque envoi porte un type — choisi dans l'action, ou
   déduit de l'usage (voir `typeEnvoi`).
   ═══════════════════════════════════════════════════════════════ */

import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../logger';
import { normalizeE164 } from '../helpers';

export type TypeEnvoi = 'transactionnel' | 'marketing';
export type Canal = 'courriel' | 'texto';

// ── Mots-clés texto ─────────────────────────────────────────

/**
 * Le mot tel qu'on le compare : minuscules, sans accents, sans ponctuation
 * ni espaces. « Arrêt. », « ARRET » et « arret » deviennent « arret ».
 */
export function motCle(texte: string | null | undefined): string {
  return String(texte ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

/**
 * Désabonnement. Les cinq de la demande, plus ceux que Twilio traite déjà
 * lui-même (cancel, end, quit, stopall) : un client qui les envoie croit se
 * désabonner, et Twilio bloque de toute façon — on doit le savoir aussi.
 */
export const MOTS_STOP = new Set(['stop', 'arret', 'desabonner', 'unsubscribe', 'stopall', 'cancel', 'end', 'quit']);
/** Réabonnement. « oui » n'en fait PAS partie : c'est une réponse, pas un ordre. */
export const MOTS_START = new Set(['start', 'reprendre', 'unstop']);

export function estStop(texte: string | null | undefined): boolean {
  return MOTS_STOP.has(motCle(texte));
}
export function estStart(texte: string | null | undefined): boolean {
  return MOTS_START.has(motCle(texte));
}

/** Le message de confirmation, dans la langue de l'entreprise. */
export function messageConfirmation(genre: 'stop' | 'start', entreprise: string, langue: 'fr' | 'en'): string {
  const nom = entreprise.trim() || (langue === 'fr' ? 'cette entreprise' : 'this business');
  if (genre === 'stop') {
    return langue === 'fr'
      ? `Vous ne recevrez plus de textos promotionnels de ${nom}. Les confirmations et rappels liés à vos rendez-vous et factures peuvent continuer. Répondez REPRENDRE pour vous réabonner.`
      : `You will no longer receive promotional texts from ${nom}. Confirmations and reminders about your appointments and invoices may continue. Reply START to resubscribe.`;
  }
  return langue === 'fr'
    ? `Vous êtes réabonné aux textos de ${nom}. Répondez STOP pour vous désabonner.`
    : `You are resubscribed to texts from ${nom}. Reply STOP to unsubscribe.`;
}

// ── Transactionnel ou marketing ─────────────────────────────

/**
 * Presets classés un par un (liste validée dans le rapport de phase 0,
 * RAPPORT_PHASE0_AUTOMATISATIONS.md §4). Tout preset absent d'ici retombe
 * sur la règle générale de `typeEnvoi`.
 */
const PRESETS_MARKETING = new Set([
  'quote_followup_1d', 'quote_followup_3d', 'quote_followup_7d', 'quote_followup_14d', 'quote_followup_21d',
  'estimate_followup', 'lead_followup_1d', 'lead_followup_3d', 'lead_followup_14d', 'stale_lead_7d',
  'cross_sell_30d', 'seasonal_reminder_6m', 'reengagement_90d', 'client_anniversary', 'lost_lead_reengagement',
  'google_review', 'review_reminder_7d',
]);
const PRESETS_TRANSACTIONNELS = new Set([
  'agreement_signed', 'appointment_confirmation', 'job_reminder_7d', 'job_reminder_1d', 'job_reminder_2h',
  'no_show_followup', 'deposit_reminder', 'deposit_followup_2d', 'deposit_received', 'payment_confirmation',
  'invoice_sent_reminder_1d', 'invoice_sent_reminder_3d', 'invoice_sent_reminder_7d', 'invoice_sent_reminder_14d',
  'invoice_sent_reminder_30d', 'welcome_new_lead', 'thank_you_after_job', 'post_appointment_survey',
]);

/** Déclencheurs dont l'envoi confirme ou suit une transaction en cours. */
const DECLENCHEURS_TRANSACTIONNELS = new Set([
  'appointment.created', 'appointment.cancelled',
  'invoice.sent', 'invoice.paid', 'invoice.overdue',
  'quote.approved', 'quote.declined', 'quote.changes_requested',
  'agreement.signed', 'job.ready_for_invoicing',
  // Suivre une facture consultée ou un paiement refusé, c'est encaisser une
  // dette existante — pas solliciter.
  'invoice.viewed', 'payment.failed',
]);

/** Au-delà, un message après un job terminé n'est plus un suivi : c'est une sollicitation. */
const SUIVI_JOB_MAX_S = 7 * 86_400;

/**
 * Le type d'un envoi.
 *
 * Ordre de priorité : le choix explicite dans l'action, puis le type fixe de
 * l'action (une demande d'avis est toujours marketing, envoyer la facture
 * toujours transactionnel), puis le preset, puis la règle générale — qui,
 * dans le doute, dit MARKETING : c'est le choix prudent, il ne fait que
 * respecter un désabonnement de plus.
 */
export function typeEnvoi(p: {
  actionType: string;
  config?: Record<string, unknown> | null;
  declencheur?: string | null;
  delaiSecondes?: number | null;
  presetKey?: string | null;
}): TypeEnvoi {
  const choisi = p.config?.type_envoi;
  if (choisi === 'transactionnel' || choisi === 'marketing') return choisi;
  if (p.actionType === 'request_review') return 'marketing';
  if (p.actionType === 'envoyer_facture' || p.actionType === 'envoyer_soumission') return 'transactionnel';
  if (p.presetKey && PRESETS_MARKETING.has(p.presetKey)) return 'marketing';
  if (p.presetKey && PRESETS_TRANSACTIONNELS.has(p.presetKey)) return 'transactionnel';

  const declencheur = p.declencheur ?? '';
  const delai = Number(p.delaiSecondes ?? 0);
  if (DECLENCHEURS_TRANSACTIONNELS.has(declencheur)) return 'transactionnel';
  // Accusé de réception immédiat d'une demande ou d'une soumission.
  if ((declencheur === 'lead.created' || declencheur === 'quote.sent') && delai <= 0) return 'transactionnel';
  // Remerciement, sondage : le suivi d'un travail qu'on vient de faire.
  if (declencheur === 'job.completed' && delai < SUIVI_JOB_MAX_S) return 'transactionnel';
  return 'marketing';
}

/** Le motif écrit dans le journal d'exécution quand un envoi est sauté. */
export function motifSaut(canal: Canal): string {
  return canal === 'texto' ? 'Client désabonné (texto)' : 'Client désabonné (courriel)';
}

// ── État par canal ──────────────────────────────────────────

export interface EtatCanal {
  desabonne: boolean;
  depuis: string | null;
  source: string | null;
}


/**
 * Où en est ce client, canal par canal. Lit les deux tables de retrait
 * existantes ; `clients.email_opt_out_at` compte aussi (jamais écrit par
 * l'app, mais une ligne posée à la main doit rester respectée).
 */
export async function etatDesabonnement(
  supabase: SupabaseClient,
  orgId: string,
  client: { email?: string | null; phone?: string | null; email_opt_out_at?: string | null },
): Promise<{ courriel: EtatCanal; texto: EtatCanal }> {
  const courriel: EtatCanal = { desabonne: false, depuis: null, source: null };
  const texto: EtatCanal = { desabonne: false, depuis: null, source: null };

  const email = client.email?.trim().toLowerCase();
  if (email) {
    const { data, error } = await supabase
      .from('email_unsubscribes')
      .select('unsubscribed_at, reason, category')
      .eq('org_id', orgId)
      .eq('email', email)
      .neq('category', 'pending')
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (data) Object.assign(courriel, { desabonne: true, depuis: (data as any).unsubscribed_at ?? null, source: (data as any).reason ?? 'lien-courriel' });
  }
  if (!courriel.desabonne && client.email_opt_out_at) {
    Object.assign(courriel, { desabonne: true, depuis: client.email_opt_out_at, source: 'fiche-client' });
  }

  if (client.phone) {
    const { data, error } = await supabase
      .from('sms_opt_outs')
      .select('opted_out_at, reason')
      .eq('org_id', orgId)
      .eq('phone', normalizeE164(client.phone))
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (data) Object.assign(texto, { desabonne: true, depuis: (data as any).opted_out_at ?? null, source: (data as any).reason ?? 'texto' });
  }
  return { courriel, texto };
}

// ── Journal probant ─────────────────────────────────────────

/**
 * Consigne un retrait ou un réabonnement dans `consents`.
 *
 * `granted = false` pour un retrait. `method` porte la SOURCE (texto STOP,
 * lien du courriel, page de préférences) : c'est ce que la fiche client
 * affiche dans l'historique, et ce qu'on produirait devant le CRTC.
 * Ne lève jamais : le retrait lui-même est déjà enregistré.
 */
export async function journaliserChoix(
  supabase: SupabaseClient,
  p: { orgId: string; clientId: string | null; canal: Canal; accorde: boolean; source: string },
): Promise<void> {
  if (!p.clientId) return;
  try {
    const { error } = await supabase.rpc('record_consent', {
      p_subject_type: 'client',
      p_subject_id: p.clientId,
      p_purpose: p.canal === 'texto' ? 'sms-marketing' : 'email-marketing',
      p_granted: p.accorde,
      p_method: p.source,
      p_doc_version: null,
      p_org_id: p.orgId,
    });
    if (error) throw new Error(error.message);
  } catch (err: any) {
    logger.error('[desabonnement] journal de consentement non écrit', { orgId: p.orgId, canal: p.canal, error: err?.message || String(err) });
  }
}

/** Le client de cette entreprise qui porte ce numéro (chiffres seuls comparés). */
export async function clientParTelephone(supabase: SupabaseClient, orgId: string, telephone: string): Promise<{ id: string } | null> {
  const dix = telephone.replace(/\D/g, '').slice(-10);
  if (dix.length < 10) return null;
  const { data, error } = await supabase
    .from('clients')
    .select('id, phone')
    .eq('org_id', orgId)
    .ilike('phone', `%${dix.slice(-4)}`)
    .is('deleted_at', null)
    .limit(50);
  if (error) throw new Error(error.message);
  const trouve = ((data ?? []) as Array<{ id: string; phone: string | null }>).find((c) => String(c.phone ?? '').replace(/\D/g, '').slice(-10) === dix);
  return trouve ? { id: trouve.id } : null;
}

/** Le client de cette entreprise qui porte cette adresse. */
export async function clientParCourriel(supabase: SupabaseClient, orgId: string, email: string): Promise<{ id: string; phone: string | null } | null> {
  const { data, error } = await supabase
    .from('clients')
    .select('id, phone')
    .eq('org_id', orgId)
    .eq('email', email.trim().toLowerCase())
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as { id: string; phone: string | null } | null) ?? null;
}

