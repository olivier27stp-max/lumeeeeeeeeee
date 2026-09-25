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
 * ils passent par `rendreCourrielLume` (voix Lume, tutoiement, un bouton vers
 * Forfait & facturation), jamais par le gabarit client d'un locataire.
 *
 * Stripe rejoue ses webhooks : chaque envoi est journalisé dans
 * `billing_receipt_log` et vérifié avant émission, sinon un rejeu enverrait le
 * courriel une seconde fois.
 */

import { getServiceClient } from './supabase';
import { sendEmail, isMailerConfigured } from './mailer';
import { emailFrom, supportEmail } from './config';
import { rendreCourrielLume, echapper, montant, dateLisible, type LigneDetail } from './courriels/gabarit';
import { intervalleLu, libellePeriode, type IntervalleAbonnement } from './abonnement-intervalle';

/** Un courriel prêt à partir : le sujet et le HTML naissent au même endroit. */
export interface CourrielPret { sujet: string; html: string }

/** La page Forfait & facturation de l'app — la cible du seul bouton de chaque courriel. */
function urlFacturation(): string {
  return `${(process.env.FRONTEND_URL || 'http://localhost:5173').trim().replace(/\/$/, '')}/settings/billing`;
}

function formatMoney(cents: number, currency: string): string {
  return montant(cents, (currency || 'CAD').toUpperCase(), 'fr');
}

function formatDate(iso: string | null): string {
  return dateLisible(iso, 'fr');
}

/** Paragraphes (HTML déjà échappé) → contenu libre du gabarit. */
function paragraphes(...textes: string[]): string {
  return textes.filter(Boolean).map((t) => `<p style="margin:0 0 14px;">${t}</p>`).join('');
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
  html: string;
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
      html: p.html,
      // Envoi de fond (webhook Stripe) : un échec transitoire part dans la file de reprise.
      reessayer: true,
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

/** Rendu pur du courriel « forfait modifié » (aperçu : scripts/qa/courriels-exemples/abonnement.mts). */
export function courrielForfaitModifie(params: {
  planName: string;
  amountCents: number;
  currency: string;
  interval: IntervalleAbonnement;
  periodEnd: string | null;
}): CourrielPret {
  const periode = libellePeriode(intervalleLu(params.interval));
  const prochain = formatDate(params.periodEnd);
  const prix = `${formatMoney(params.amountCents, params.currency)} / ${periode}`;
  const lignes: LigneDetail[] = [
    { libelle: 'Forfait', valeur: params.planName, fort: true },
    { libelle: 'Montant', valeur: prix },
  ];
  if (prochain) lignes.push({ libelle: 'Prochain prélèvement', valeur: prochain });
  return {
    sujet: `Ton forfait Lume est maintenant « ${params.planName} »`,
    html: rendreCourrielLume({
      langue: 'fr',
      preheader: `${params.planName} — ${prix}${prochain ? ` — prochain prélèvement le ${prochain}` : ''}`,
      titre: 'Ton forfait a été modifié',
      salutation: 'Bonjour,',
      intro: 'Ton forfait vient de changer. Voici ce qui s’applique à partir de maintenant.',
      montant: { libelle: 'Nouveau montant', valeur: prix, sous: prochain ? `Prochain prélèvement le ${prochain}` : null },
      lignes,
      bouton: { texte: 'Voir mon forfait', url: urlFacturation() },
      note: 'Tu n’es pas à l’origine de ce changement ? Réponds à ce courriel, on regarde tout de suite.',
      supportEmail,
    }),
  };
}

/** Confirme au client son nouveau forfait et ce qu'il paiera désormais. */
export async function sendPlanChangedEmail(params: {
  orgId: string;
  eventId: string;
  planName: string;
  amountCents: number;
  currency: string;
  interval: IntervalleAbonnement;
  periodEnd: string | null;
}): Promise<{ sent: boolean; skipped: boolean; error?: string }> {
  const courriel = courrielForfaitModifie(params);
  return envoyer({
    orgId: params.orgId,
    eventId: params.eventId,
    emailType: 'subscription_changed',
    sujet: courriel.sujet,
    html: courriel.html,
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
export function courrielAlerteDepart(params: {
  orgName: string | null;
  orgId: string;
  planName: string | null;
  feedback: string | null;
  comment: string | null;
}): CourrielPret {
  const motif = params.feedback ? (MOTIFS[params.feedback] || params.feedback) : 'non renseigné';
  const nom = params.orgName || params.orgId;
  return {
    sujet: `[Départ] ${nom} — ${motif}`,
    html: rendreCourrielLume({
      langue: 'fr',
      preheader: `${nom} — ${motif}`,
      titre: 'Un client a annulé son abonnement',
      lignes: [
        { libelle: 'Client', valeur: nom, fort: true },
        { libelle: 'Forfait', valeur: params.planName || '—' },
        { libelle: 'Motif', valeur: motif, fort: true },
        { libelle: 'Org ID', valeur: params.orgId },
      ],
      corpsHtml: params.comment
        ? `<p style="margin:0 0 14px;"><strong>Commentaire :</strong><br/>${echapper(params.comment)}</p>`
        : '<p style="margin:0 0 14px;color:#6b7280;">Aucun commentaire laissé.</p>',
      note: 'Un départ vaut souvent un appel : c’est le moment où le client dit ce qu’aucune enquête ne capte.',
      signature: null,
      supportEmail,
    }),
  };
}

export async function sendChurnAlert(params: {
  orgName: string | null;
  orgId: string;
  planName: string | null;
  feedback: string | null;
  comment: string | null;
}): Promise<void> {
  if (!isMailerConfigured() || !supportEmail) return;
  try {
    const courriel = courrielAlerteDepart(params);
    await sendEmail({
      from: emailFrom,
      to: supportEmail,
      subject: courriel.sujet,
      html: courriel.html,
      reessayer: true,
    });
  } catch (err: any) {
    // Purement informatif : ne doit jamais perturber le flux d'annulation.
    console.error('[subscription-email] alerte de départ échouée:', err?.message);
  }
}

export function courrielAbonnementAnnule(params: { planName: string | null; accessUntil: string | null }): CourrielPret {
  const jusquau = formatDate(params.accessUntil);
  const lignes: LigneDetail[] = [];
  if (params.planName) lignes.push({ libelle: 'Forfait', valeur: params.planName });
  lignes.push({ libelle: 'Accès jusqu’au', valeur: jusquau || 'maintenant', fort: true });
  return {
    sujet: 'Ton abonnement Lume a été annulé',
    html: rendreCourrielLume({
      langue: 'fr',
      preheader: jusquau ? `Tu gardes l’accès jusqu’au ${jusquau}. Tes données sont conservées.` : 'Aucun autre montant ne sera prélevé. Tes données sont conservées.',
      titre: 'Abonnement annulé',
      salutation: 'Bonjour,',
      intro: `Ton abonnement Lume${params.planName ? ` « ${params.planName} »` : ''} est annulé. Aucun autre montant ne sera prélevé.`,
      lignes,
      corpsHtml: paragraphes(
        jusquau
          ? `<strong>Tu gardes l’accès jusqu’au ${echapper(jusquau)}</strong> : la période déjà payée va à son terme.`
          : 'L’accès à ton espace prend fin maintenant.',
        'Tes données restent conservées. Si tu reviens, tu retrouves tout en l’état.',
      ),
      bouton: { texte: 'Voir mon forfait', url: urlFacturation() },
      note: 'Cette annulation est une erreur, ou quelque chose n’a pas fonctionné pour toi ? Réponds simplement à ce courriel.',
      supportEmail,
    }),
  };
}

/** Confirme l'annulation et, surtout, jusqu'à quand l'accès reste ouvert. */
export async function sendSubscriptionCanceledEmail(params: {
  orgId: string;
  eventId: string;
  planName: string | null;
  accessUntil: string | null;
}): Promise<{ sent: boolean; skipped: boolean; error?: string }> {
  const courriel = courrielAbonnementAnnule(params);
  return envoyer({
    orgId: params.orgId,
    eventId: params.eventId,
    emailType: 'subscription_canceled',
    sujet: courriel.sujet,
    html: courriel.html,
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
     · l'échec, le jour même — ce qui s'est passé, comment le corriger
       (sendPaymentFailedEmail) ;
     · une relance à J+3 — la date de fermeture, en clair
       (sendDunningReminderEmail) ;
     · la suspension, à J+7 — l'accès est coupé, les données sont là
       (sendAccessSuspendedEmail).

   Le ton reste factuel. Un artisan dont la carte a expiré n'est pas un
   mauvais payeur ; le traiter comme tel est le meilleur moyen de le
   perdre pour de bon.
   ═══════════════════════════════════════════════════════════════ */

/** Jours d'accès maintenus après le premier échec, avant suspension. */
export const JOURS_DE_GRACE = 7;

/** Phrase « comment corriger », commune aux trois courriels. */
function commentCorriger(): string {
  return 'Pour régler ça : ouvre Lume, puis <strong>Paramètres → Facturation</strong>, et mets ta carte à jour. Le prélèvement repart aussitôt.';
}

const BOUTON_CARTE = 'Mettre ma carte à jour';

export function courrielEchecPaiement(params: { amountCents: number; currency: string; suspensionLe: string | null }): CourrielPret {
  const date = formatDate(params.suspensionLe);
  const somme = formatMoney(params.amountCents, params.currency);
  return {
    sujet: 'Ton paiement Lume n’est pas passé — ton accès reste ouvert',
    html: rendreCourrielLume({
      langue: 'fr',
      preheader: `${somme} n’a pas pu être prélevé. Ton accès reste ouvert${date ? ` jusqu’au ${date}` : ''}.`,
      titre: 'Le paiement n’est pas passé',
      salutation: 'Bonjour,',
      intro: `Le prélèvement de ${somme} pour ton abonnement Lume n’a pas pu être fait. Neuf fois sur dix, c’est une carte expirée ou un plafond atteint. Rien de grave.`,
      montant: { libelle: 'Montant à prélever', valeur: somme, sous: date ? `Accès ouvert jusqu’au ${date}` : null },
      corpsHtml: paragraphes(
        `<strong>Ton accès reste ouvert${date ? ` jusqu’au ${echapper(date)}` : ''}.</strong> Tes clients, tes jobs et tes factures sont intacts.`,
        commentCorriger(),
      ),
      bouton: { texte: BOUTON_CARTE, url: urlFacturation() },
      note: 'Ta banque a peut-être déjà réessayé de son côté. Si c’est le cas, ce courriel ne demande rien.',
      supportEmail,
    }),
  };
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
  const courriel = courrielEchecPaiement(params);
  return envoyer({
    orgId: params.orgId,
    eventId: params.eventId,
    emailType: 'payment_failed',
    sujet: courriel.sujet,
    html: courriel.html,
    amountCents: params.amountCents,
    currency: params.currency,
    planName: params.planName,
  });
}

export function courrielRelanceImpaye(params: { joursRestants: number; suspensionLe: string | null }): CourrielPret {
  const date = formatDate(params.suspensionLe);
  const j = params.joursRestants;
  const delai = j <= 1 ? 'demain' : `dans ${j} jours`;
  return {
    sujet: `Ton accès Lume sera suspendu ${delai}`,
    html: rendreCourrielLume({
      langue: 'fr',
      preheader: `Sans mise à jour de ta carte, ton accès sera suspendu ${delai}${date ? `, le ${date}` : ''}.`,
      titre: 'Ta carte n’a toujours pas été mise à jour',
      salutation: 'Bonjour,',
      intro: 'Ton paiement Lume n’est toujours pas passé, et on n’a pas réussi à le relancer.',
      lignes: [{ libelle: 'Suspension prévue', valeur: date ? `${delai}, le ${date}` : delai, fort: true }],
      corpsHtml: paragraphes(
        `<strong>Sans mise à jour de ta carte, ton accès sera suspendu ${echapper(delai)}${date ? `, le ${echapper(date)}` : ''}.</strong>`,
        commentCorriger(),
      ),
      bouton: { texte: BOUTON_CARTE, url: urlFacturation() },
      note: 'Un problème avec ta carte, ou besoin d’un délai ? Réponds à ce courriel : on trouve une solution, ça arrive à tout le monde.',
      supportEmail,
    }),
  };
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
  const courriel = courrielRelanceImpaye(params);
  return envoyer({
    orgId: params.orgId,
    eventId: params.eventId,
    emailType: 'dunning_reminder',
    sujet: courriel.sujet,
    html: courriel.html,
    amountCents: 0,
    currency: 'CAD',
    planName: params.planName,
  });
}

export function courrielAccesSuspendu(): CourrielPret {
  return {
    sujet: 'Ton accès Lume est suspendu — tes données sont conservées',
    html: rendreCourrielLume({
      langue: 'fr',
      preheader: 'Rien n’est perdu : dès que ta carte est à jour, tout revient.',
      titre: 'Accès suspendu',
      salutation: 'Bonjour,',
      intro: 'Faute de paiement, l’accès à ton espace Lume est suspendu.',
      corpsHtml: paragraphes(
        '<strong>Rien n’est perdu.</strong> Tes clients, tes jobs, tes factures et tes documents sont conservés tels quels. Dès que ta carte est à jour, tout revient tout de suite. Tu ne recommences rien.',
        commentCorriger(),
      ),
      bouton: { texte: BOUTON_CARTE, url: urlFacturation() },
      note: 'Tu préfères arrêter, ou récupérer une copie de tes données ? Réponds à ce courriel, on s’en occupe.',
      supportEmail,
    }),
  };
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
  const courriel = courrielAccesSuspendu();
  return envoyer({
    orgId: params.orgId,
    eventId: params.eventId,
    emailType: 'access_suspended',
    sujet: courriel.sujet,
    html: courriel.html,
    amountCents: 0,
    currency: 'CAD',
    planName: params.planName,
  });
}
