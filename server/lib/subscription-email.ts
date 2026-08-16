/**
 * Courriels d'abonnement — changement de forfait et annulation.
 *
 * POURQUOI CE MODULE
 * Le webhook Stripe mettait la base à jour sans jamais prévenir le client.
 * Un changement de forfait est une modification de contrat : sans trace écrite
 * de ce qu'il paiera désormais, on s'expose à « je n'ai jamais demandé ça » au
 * prochain prélèvement. Une annulation sans confirmation est pire encore — le
 * client croit avoir perdu l'accès immédiatement, écrit au support, ou pense
 * que l'annulation a échoué et conteste le prélèvement suivant.
 *
 * Ces courriels viennent de Lume (la plateforme) et non de l'organisation :
 * ils ne passent donc PAS par `buildEmailLayout`, réservé aux envois faits au
 * nom d'un locataire vers SES propres clients.
 *
 * Stripe rejoue ses webhooks : chaque envoi est journalisé dans
 * `billing_receipt_log` et vérifié avant émission, sinon un rejeu enverrait le
 * courriel une seconde fois.
 */

import { getServiceClient } from './supabase';
import { sendEmail, isMailerConfigured } from './mailer';
import { emailFrom, supportEmail } from './config';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatMoney(cents: number, currency: string): string {
  const amount = (cents / 100).toFixed(2);
  const symbol = currency === 'USD' ? '$' : currency === 'CAD' ? 'CA$' : `${currency} `;
  return `${symbol}${amount}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat('fr-CA', { dateStyle: 'long', timeZone: 'America/Toronto' })
      .format(new Date(iso));
  } catch {
    return '';
  }
}

/** Gabarit commun : en-tête Lume, bloc de contenu, pied avec l'adresse de support. */
function layout(titre: string, corpsHtml: string): string {
  return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:24px;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#1a1a2e;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
    <tr><td style="padding:20px 24px;border-bottom:1px solid #f0f1f3;font-weight:700;font-size:15px;">Lume</td></tr>
    <tr><td style="padding:24px;">
      <h1 style="margin:0 0 14px;font-size:17px;font-weight:700;">${escapeHtml(titre)}</h1>
      ${corpsHtml}
    </td></tr>
    <tr><td style="padding:16px 24px;border-top:1px solid #f0f1f3;font-size:11.5px;color:#8a8f98;">
      Une question ? Écrivez-nous à <a href="mailto:${escapeHtml(supportEmail)}" style="color:#8a8f98;">${escapeHtml(supportEmail)}</a>.
    </td></tr>
  </table>
</body></html>`;
}

interface EnvoiParams {
  orgId: string;
  /** Identifiant d'événement Stripe — clé d'idempotence contre les rejeux. */
  eventId: string;
  emailType:
    | 'subscription_changed'
    | 'subscription_canceled'
    | 'payment_failed'
    | 'dunning_reminder'
    | 'access_suspended';
  sujet: string;
  titre: string;
  corpsHtml: string;
  amountCents: number;
  currency: string;
  planName: string | null;
}

/**
 * Résout le destinataire, vérifie l'idempotence, envoie et journalise.
 * Ne lève jamais : un courriel raté ne doit pas faire rejouer le webhook en
 * boucle, la mise à jour de l'abonnement ayant déjà eu lieu.
 */
async function envoyer(p: EnvoiParams): Promise<{ sent: boolean; skipped: boolean; error?: string }> {
  const admin = getServiceClient();
  try {
    // ── Idempotence : Stripe rejoue ses webhooks ──
    const { data: existant } = await admin
      .from('billing_receipt_log')
      .select('id')
      .eq('stripe_invoice_id', p.eventId)
      .eq('email_type', p.emailType)
      .eq('status', 'sent')
      .maybeSingle();
    if (existant) return { sent: false, skipped: true };

    if (!isMailerConfigured()) {
      console.warn(`[subscription-email] SMTP non configuré — ${p.emailType} ignoré`);
      return { sent: false, skipped: true, error: 'SMTP not configured' };
    }

    // ── Destinataire ──
    // `company_settings.email` est la seule adresse portée par l'org ; il n'y a
    // pas de colonne dédiée à la facturation. Repli sur le propriétaire du
    // compte, sans quoi une org qui n'a pas rempli ses réglages ne recevrait
    // jamais ces courriels — précisément les comptes les plus fragiles.
    const { data: org } = await admin
      .from('company_settings')
      .select('email')
      .eq('org_id', p.orgId)
      .maybeSingle();

    let destinataire = (org?.email || '').trim();

    if (!destinataire) {
      const { data: membre } = await admin
        .from('memberships')
        .select('user_id')
        .eq('org_id', p.orgId)
        .eq('role', 'owner')
        .limit(1)
        .maybeSingle();
      if (membre?.user_id) {
        const { data: u } = await admin.auth.admin.getUserById(membre.user_id);
        destinataire = (u?.user?.email || '').trim();
      }
    }

    if (!destinataire) {
      console.warn(`[subscription-email] aucune adresse pour l'org ${p.orgId} — ${p.emailType} ignoré`);
      return { sent: false, skipped: true, error: 'no recipient' };
    }

    const resultat = await sendEmail({
      from: emailFrom,
      to: destinataire,
      replyTo: supportEmail,
      subject: p.sujet,
      html: layout(p.titre, p.corpsHtml),
    });

    // L'erreur est LUE : cette ligne est la garde d'idempotence. Si l'insertion
    // échoue en silence, le prochain rejeu de webhook par Stripe ne trouvera
    // aucune trace et renverra le même courriel au client.
    const { error: journalErr } = await admin.from('billing_receipt_log').insert({
      org_id: p.orgId,
      recipient_email: destinataire,
      email_type: p.emailType,
      stripe_invoice_id: p.eventId,
      amount_cents: p.amountCents,
      currency: p.currency,
      plan_name: p.planName,
      status: resultat.sent ? 'sent' : 'failed',
      error_message: resultat.error || null,
      message_id: resultat.messageId || null,
      sent_at: resultat.sent ? new Date().toISOString() : null,
    });

    // Journaliser, pas lever : le courriel est DÉJÀ parti. Faire échouer ici
    // ferait rejouer le webhook Stripe et enverrait un second courriel — soit
    // exactement le doublon que ce journal doit empêcher.
    if (journalErr) {
      console.error(
        `[subscription-email] journal non écrit pour ${p.emailType} (${p.eventId}) —`,
        `un rejeu Stripe pourrait renvoyer ce courriel :`, journalErr.message,
      );
    }

    return { sent: resultat.sent, skipped: false, error: resultat.error };
  } catch (err: any) {
    console.error(`[subscription-email] ${p.emailType} échoué:`, err?.message);
    return { sent: false, skipped: false, error: err?.message };
  }
}

/** Confirme au client son nouveau forfait et ce qu'il paiera désormais. */
export async function sendPlanChangedEmail(params: {
  orgId: string;
  eventId: string;
  planName: string;
  amountCents: number;
  currency: string;
  interval: 'monthly' | 'yearly';
  periodEnd: string | null;
}): Promise<{ sent: boolean; skipped: boolean; error?: string }> {
  const periode = params.interval === 'yearly' ? 'an' : 'mois';
  const prochain = formatDate(params.periodEnd);
  const corps = `
    <p style="margin:0 0 14px;font-size:13.5px;line-height:1.65;">
      Votre forfait a été modifié. Voici ce qui s'applique désormais :
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;line-height:1.9;border:1px solid #f0f1f3;border-radius:8px;">
      <tr><td style="padding:10px 14px;color:#6b7280;width:45%;">Forfait</td><td style="padding:10px 14px;font-weight:600;">${escapeHtml(params.planName)}</td></tr>
      <tr><td style="padding:10px 14px;color:#6b7280;">Montant</td><td style="padding:10px 14px;font-weight:600;">${escapeHtml(formatMoney(params.amountCents, params.currency))} / ${periode}</td></tr>
      ${prochain ? `<tr><td style="padding:10px 14px;color:#6b7280;">Prochain prélèvement</td><td style="padding:10px 14px;">${escapeHtml(prochain)}</td></tr>` : ''}
    </table>
    <p style="margin:16px 0 0;font-size:12.5px;line-height:1.65;color:#6b7280;">
      Vous n'êtes pas à l'origine de ce changement ? Répondez à ce courriel, on regarde tout de suite.
    </p>`;

  return envoyer({
    orgId: params.orgId,
    eventId: params.eventId,
    emailType: 'subscription_changed',
    sujet: `Votre forfait Lume est maintenant « ${params.planName} »`,
    titre: 'Votre forfait a été modifié',
    corpsHtml: corps,
    amountCents: params.amountCents,
    currency: params.currency,
    planName: params.planName,
  });
}

/** Libellés lisibles des motifs d'annulation renvoyés par Stripe. */
const MOTIFS: Record<string, string> = {
  too_expensive: 'Trop cher',
  missing_features: 'Fonctionnalités manquantes',
  switched_service: 'Est passé à un concurrent',
  unused: 'N’utilisait pas le service',
  customer_service: 'Insatisfait du service client',
  too_complex: 'Trop compliqué',
  low_quality: 'Qualité insuffisante',
  other: 'Autre',
};

/**
 * Prévient l'équipe qu'un client vient de partir, avec le motif qu'il a donné.
 *
 * C'est la seule information qui permette de réduire un taux de départ : sans
 * elle, on optimise à l'aveugle. Envoyée à l'adresse de support, séparément de
 * la confirmation adressée au client.
 */
export async function sendChurnAlert(params: {
  orgName: string | null;
  orgId: string;
  planName: string | null;
  feedback: string | null;
  comment: string | null;
}): Promise<void> {
  if (!isMailerConfigured() || !supportEmail) return;
  try {
    const motif = params.feedback ? (MOTIFS[params.feedback] || params.feedback) : 'non renseigné';
    const nom = params.orgName || params.orgId;
    const corps = `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;line-height:1.9;border:1px solid #f0f1f3;border-radius:8px;">
        <tr><td style="padding:10px 14px;color:#6b7280;width:38%;">Client</td><td style="padding:10px 14px;font-weight:600;">${escapeHtml(nom)}</td></tr>
        <tr><td style="padding:10px 14px;color:#6b7280;">Forfait</td><td style="padding:10px 14px;">${escapeHtml(params.planName || '—')}</td></tr>
        <tr><td style="padding:10px 14px;color:#6b7280;">Motif</td><td style="padding:10px 14px;font-weight:600;">${escapeHtml(motif)}</td></tr>
        <tr><td style="padding:10px 14px;color:#6b7280;">Org ID</td><td style="padding:10px 14px;font-family:monospace;font-size:11px;color:#9ca3af;">${escapeHtml(params.orgId)}</td></tr>
      </table>
      ${params.comment
        ? `<p style="margin:16px 0 0;font-size:13px;line-height:1.65;"><strong>Commentaire :</strong><br>${escapeHtml(params.comment)}</p>`
        : '<p style="margin:16px 0 0;font-size:12.5px;color:#6b7280;">Aucun commentaire laissé.</p>'}
      <p style="margin:18px 0 0;font-size:12.5px;line-height:1.65;color:#6b7280;">
        Un départ vaut souvent un appel : c'est le moment où le client dit ce
        qu'aucune enquête ne capte.
      </p>`;

    await sendEmail({
      from: emailFrom,
      to: supportEmail,
      subject: `[Départ] ${nom} — ${motif}`,
      html: layout('Un client a annulé son abonnement', corps),
    });
  } catch (err: any) {
    // Purement informatif : ne doit jamais perturber le flux d'annulation.
    console.error('[subscription-email] alerte de départ échouée:', err?.message);
  }
}

/** Confirme l'annulation et, surtout, jusqu'à quand l'accès reste ouvert. */
export async function sendSubscriptionCanceledEmail(params: {
  orgId: string;
  eventId: string;
  planName: string | null;
  accessUntil: string | null;
}): Promise<{ sent: boolean; skipped: boolean; error?: string }> {
  const jusquau = formatDate(params.accessUntil);
  const corps = `
    <p style="margin:0 0 14px;font-size:13.5px;line-height:1.65;">
      Votre abonnement Lume${params.planName ? ` « ${escapeHtml(params.planName)} »` : ''} a été annulé.
      Aucun montant supplémentaire ne sera prélevé.
    </p>
    ${jusquau
      ? `<p style="margin:0 0 14px;font-size:13.5px;line-height:1.65;">
           <strong>Vous gardez l'accès jusqu'au ${escapeHtml(jusquau)}</strong>, la période déjà payée
           allant à son terme.
         </p>`
      : `<p style="margin:0 0 14px;font-size:13.5px;line-height:1.65;">
           L'accès à votre espace prend fin immédiatement.
         </p>`}
    <p style="margin:0 0 14px;font-size:13.5px;line-height:1.65;">
      Vos données restent conservées : si vous revenez, vous retrouverez tout en l'état.
    </p>
    <p style="margin:16px 0 0;font-size:12.5px;line-height:1.65;color:#6b7280;">
      Si cette annulation est une erreur, ou si quelque chose n'a pas fonctionné pour vous,
      répondez simplement à ce courriel.
    </p>`;

  return envoyer({
    orgId: params.orgId,
    eventId: params.eventId,
    emailType: 'subscription_canceled',
    sujet: 'Votre abonnement Lume a été annulé',
    titre: 'Abonnement annulé',
    corpsHtml: corps,
    amountCents: 0,
    currency: 'CAD',
    planName: params.planName,
  });
}

/* ═══════════════════════════════════════════════════════════════
   Relance d'impayé (dunning)

   Un paiement refusé, c'est presque toujours une carte expirée — pas
   quelqu'un qui refuse de payer. Le client ne le sait pas : sa banque ne
   le prévient pas, Stripe non plus. Sans ces courriels, il découvre le
   problème le jour où son CRM se ferme, en pleine journée de travail.

   Trois messages, de plus en plus directs :
     · l'échec, le jour même — ce qui s'est passé, comment le corriger ;
     · une relance à J+3 — la date de fermeture, en clair ;
     · la suspension, à J+7 — l'accès est coupé, les données sont là.

   Le ton reste factuel. Un artisan dont la carte a expiré n'est pas un
   mauvais payeur ; le traiter comme tel est le meilleur moyen de le
   perdre pour de bon.
   ═══════════════════════════════════════════════════════════════ */

/** Jours d'accès maintenus après le premier échec, avant suspension. */
export const JOURS_DE_GRACE = 7;

/** Bloc « comment corriger », commun aux trois courriels. */
function commentCorriger(): string {
  return `
    <p style="margin:0 0 14px;font-size:13.5px;line-height:1.65;">
      Pour régler ça : ouvrez Lume, puis <strong>Paramètres → Facturation</strong>,
      et mettez à jour votre carte. Le prélèvement est relancé aussitôt.
    </p>`;
}

/**
 * Premier échec de prélèvement — le client a encore tout son accès.
 *
 * Idempotent sur l'identifiant de la facture Stripe ET le numéro de
 * tentative : Stripe réessaie plusieurs fois et émet l'événement à chaque
 * fois. Sans le numéro de tentative dans la clé, la 2e relance serait prise
 * pour un rejeu et le client ne serait jamais prévenu qu'on a réessayé.
 */
export async function sendPaymentFailedEmail(params: {
  orgId: string;
  /** `stripe_invoice_id:attempt_count` — voir ci-dessus. */
  eventId: string;
  amountCents: number;
  currency: string;
  planName: string | null;
  /** Date de suspension, déjà calculée par l'appelant. */
  suspensionLe: string | null;
}): Promise<{ sent: boolean; skipped: boolean; error?: string }> {
  const date = formatDate(params.suspensionLe);
  const corps = `
    <p style="margin:0 0 14px;font-size:13.5px;line-height:1.65;">
      Le prélèvement de ${escapeHtml(formatMoney(params.amountCents, params.currency))} pour votre
      abonnement Lume n'a pas pu être effectué. Neuf fois sur dix, c'est une carte
      expirée ou un plafond atteint — rien de grave.
    </p>
    <p style="margin:0 0 14px;font-size:13.5px;line-height:1.65;">
      <strong>Votre accès reste ouvert${date ? ` jusqu'au ${escapeHtml(date)}` : ''}.</strong>
      Vos clients, vos jobs et vos factures sont intacts.
    </p>
    ${commentCorriger()}
    <p style="margin:16px 0 0;font-size:12.5px;line-height:1.65;color:#6b7280;">
      Votre banque a peut-être déjà réessayé de son côté. Si c'est le cas, ce
      courriel n'appelle aucune action.
    </p>`;

  return envoyer({
    orgId: params.orgId,
    eventId: params.eventId,
    emailType: 'payment_failed',
    sujet: 'Votre paiement Lume n’est pas passé — votre accès reste ouvert',
    titre: 'Le paiement n’a pas pu être effectué',
    corpsHtml: corps,
    amountCents: params.amountCents,
    currency: params.currency,
    planName: params.planName,
  });
}

/**
 * Relance pendant la grâce — la fermeture approche et le client ne l'a pas
 * encore réglée. Le message dit la date, sans détour.
 */
export async function sendDunningReminderEmail(params: {
  orgId: string;
  /** `orgId:jour` — un seul rappel par jour de relance, même si le cron rejoue. */
  eventId: string;
  joursRestants: number;
  suspensionLe: string | null;
  planName: string | null;
}): Promise<{ sent: boolean; skipped: boolean; error?: string }> {
  const date = formatDate(params.suspensionLe);
  const j = params.joursRestants;
  const delai = j <= 1 ? 'demain' : `dans ${j} jours`;
  const corps = `
    <p style="margin:0 0 14px;font-size:13.5px;line-height:1.65;">
      Votre paiement Lume n'est toujours pas passé, et nous n'avons pas réussi à
      le relancer.
    </p>
    <p style="margin:0 0 14px;font-size:14px;line-height:1.65;">
      <strong>Sans mise à jour de votre carte, votre accès sera suspendu ${escapeHtml(delai)}${date ? `, le ${escapeHtml(date)}` : ''}.</strong>
    </p>
    ${commentCorriger()}
    <p style="margin:16px 0 0;font-size:12.5px;line-height:1.65;color:#6b7280;">
      Un problème avec votre carte, ou besoin d'un délai ? Répondez à ce courriel :
      on trouve une solution, ça arrive à tout le monde.
    </p>`;

  return envoyer({
    orgId: params.orgId,
    eventId: params.eventId,
    emailType: 'dunning_reminder',
    sujet: `Votre accès Lume sera suspendu ${delai}`,
    titre: 'Votre carte n’a toujours pas été mise à jour',
    corpsHtml: corps,
    amountCents: 0,
    currency: 'CAD',
    planName: params.planName,
  });
}

/**
 * Suspension effective. L'insistance sur la conservation des données n'est pas
 * de la politesse : c'est la question que se pose immédiatement quelqu'un qui
 * vient de perdre l'accès à tout son carnet de clients.
 */
export async function sendAccessSuspendedEmail(params: {
  orgId: string;
  /** `orgId:suspended` — un seul envoi par épisode d'impayé. */
  eventId: string;
  planName: string | null;
}): Promise<{ sent: boolean; skipped: boolean; error?: string }> {
  const corps = `
    <p style="margin:0 0 14px;font-size:13.5px;line-height:1.65;">
      Faute de paiement, l'accès à votre espace Lume est suspendu.
    </p>
    <p style="margin:0 0 14px;font-size:13.5px;line-height:1.65;">
      <strong>Rien n'est perdu.</strong> Vos clients, vos jobs, vos factures et vos
      documents sont conservés tels quels. Dès que votre carte est à jour, tout
      revient immédiatement — vous ne recommencez rien.
    </p>
    ${commentCorriger()}
    <p style="margin:16px 0 0;font-size:12.5px;line-height:1.65;color:#6b7280;">
      Vous souhaitez plutôt arrêter, ou récupérer une copie de vos données ?
      Répondez à ce courriel, on s'en occupe.
    </p>`;

  return envoyer({
    orgId: params.orgId,
    eventId: params.eventId,
    emailType: 'access_suspended',
    sujet: 'Votre accès Lume est suspendu — vos données sont conservées',
    titre: 'Accès suspendu',
    corpsHtml: corps,
    amountCents: 0,
    currency: 'CAD',
    planName: params.planName,
  });
}
