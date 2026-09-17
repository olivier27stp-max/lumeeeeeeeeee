/**
 * Courriel « paiement reçu » à l'entreprise et notification de litige.
 *
 * Réglage notify_owner_email (payment_settings) : à chaque paiement en ligne
 * réussi (facture ou dépôt de devis), un courriel court part à l'adresse de
 * l'entreprise (company_settings.email). La notification in-app « Paiement
 * reçu » existe déjà par trigger DB (ac_track_payments) — ici c'est le
 * courriel, l'équivalent du « Get notified of payments by email » de Jobber.
 *
 * Tout est best-effort : un courriel raté ne doit JAMAIS faire échouer le
 * webhook Stripe (sinon Stripe rejoue l'événement).
 */
import { getServiceClient } from './supabase';
import { rendreCourrielLume } from './courriels/gabarit';
import { getPaymentSettings } from './payment-settings';
import { createNotification } from './notificationHelpers';
import { sendEmail, isMailerConfigured } from './mailer';

function formaterMontant(cents: number, currency: string, langue: 'fr' | 'en'): string {
  return new Intl.NumberFormat(langue === 'fr' ? 'fr-CA' : 'en-CA', {
    style: 'currency',
    currency: currency || 'CAD',
  }).format(cents / 100);
}

function echapper(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

export interface PaiementRecuParams {
  orgId: string;
  genre: 'invoice' | 'deposit';
  /** Montant appliqué à la facture / au dépôt (sans pourboire). */
  amountCents: number;
  tipCents?: number;
  currency: string;
  /** Numéro de facture ou de devis, pour le sujet. */
  reference: string;
  clientName?: string | null;
  /** Chemin interne vers la fiche (ex. /invoices/:id), préfixé du domaine public. */
  lienInterne?: string | null;
}

/**
 * Sujet du courriel, exporté pour les tests : « Paiement reçu — 125,00 $ —
 * facture 2026-014 » (+ mention du pourboire s'il y en a un).
 */
export function sujetPaiementRecu(p: PaiementRecuParams, langue: 'fr' | 'en'): string {
  const montant = formaterMontant(p.amountCents, p.currency, langue);
  const quoi = p.genre === 'deposit'
    ? (langue === 'fr' ? `dépôt du devis ${p.reference}` : `deposit for quote ${p.reference}`)
    : (langue === 'fr' ? `facture ${p.reference}` : `invoice ${p.reference}`);
  const tete = langue === 'fr' ? 'Paiement reçu' : 'Payment received';
  const pourboire = p.tipCents && p.tipCents > 0
    ? (langue === 'fr' ? ` (+ ${formaterMontant(p.tipCents, p.currency, langue)} de pourboire)` : ` (+ ${formaterMontant(p.tipCents, p.currency, langue)} tip)`)
    : '';
  return `${tete} — ${montant}${pourboire} — ${quoi}`;
}

export async function notifierPaiementRecu(p: PaiementRecuParams): Promise<void> {
  try {
    const reglages = await getPaymentSettings(p.orgId);
    if (!reglages.notify_owner_email) return;
    if (!isMailerConfigured()) return;

    const admin = getServiceClient();
    const { data: societe } = await admin
      .from('company_settings')
      .select('company_name, email, default_language')
      .eq('org_id', p.orgId)
      .maybeSingle();
    const destinataire = String(societe?.email || '').trim();
    if (!destinataire) return;

    const langue: 'fr' | 'en' = societe?.default_language === 'en' ? 'en' : 'fr';
    const sujet = sujetPaiementRecu(p, langue);
    const montant = formaterMontant(p.amountCents, p.currency, langue);
    const client = p.clientName ? echapper(p.clientName) : (langue === 'fr' ? 'un client' : 'a client');
    const base = (process.env.PUBLIC_APP_URL || process.env.FRONTEND_URL || '').replace(/\/$/, '');
    const lien = p.lienInterne && base ? `${base}${p.lienInterne}` : null;

    void client;
    const html = rendreCourrielLume({
      langue,
      preheader: sujet,
      titre: langue === 'fr' ? 'Paiement reçu' : 'Payment received',
      intro: langue === 'fr'
        ? `${p.clientName || 'Un client'} vient de payer en ligne ${p.genre === 'deposit' ? `le dépôt du devis ${p.reference}` : `la facture ${p.reference}`}.`
        : `${p.clientName || 'A client'} just paid online ${p.genre === 'deposit' ? `the deposit for quote ${p.reference}` : `invoice ${p.reference}`}.`,
      montant: { libelle: langue === 'fr' ? 'Montant reçu' : 'Amount received', valeur: montant, sous: p.tipCents && p.tipCents > 0 ? `${langue === 'fr' ? 'Pourboire' : 'Tip'} : ${formaterMontant(p.tipCents, p.currency, langue)}` : null },
      lignes: [
        { libelle: 'Client', valeur: p.clientName || (langue === 'fr' ? 'un client' : 'a client') },
        { libelle: p.genre === 'deposit' ? (langue === 'fr' ? 'Devis' : 'Quote') : (langue === 'fr' ? 'Facture' : 'Invoice'), valeur: p.reference },
      ],
      bouton: lien ? { texte: langue === 'fr' ? (p.genre === 'deposit' ? 'Voir le devis' : 'Voir la facture') : (p.genre === 'deposit' ? 'View quote' : 'View invoice'), url: lien } : null,
      note: langue === 'fr' ? 'Vous recevez ce courriel parce que « Être avisé de chaque paiement par courriel » est activé dans Paramètres → Lume Payments.' : 'You receive this email because “Get notified of payments by email” is on in Settings → Lume Payments.',
    });
    await sendEmail({
      to: destinataire,
      subject: sujet,
      html,
      suivi: { orgId: p.orgId, entityType: p.genre === 'deposit' ? 'quote' : 'invoice', entityId: null },
      // Envoi de fond (webhook de paiement) : un échec transitoire part dans la file de reprise.
      reessayer: true,
    });
  } catch (err: any) {
    console.error('[paiement-recu] courriel au propriétaire non envoyé:', err?.message);
  }
}

/**
 * Litige ouvert par le client auprès de sa banque : notification in-app +
 * push aux membres de l'org (le webhook a déjà marqué la ligne de paiement).
 */
export async function notifierLitigeOuvert(params: {
  orgId: string;
  amountCents: number;
  currency: string;
  reason: string | null;
  paymentId: string | null;
}): Promise<void> {
  try {
    const admin = getServiceClient();
    const { data: societe } = await admin
      .from('company_settings')
      .select('default_language')
      .eq('org_id', params.orgId)
      .maybeSingle();
    const langue: 'fr' | 'en' = societe?.default_language === 'en' ? 'en' : 'fr';
    const montant = formaterMontant(params.amountCents, params.currency, langue);
    const titre = langue === 'fr' ? 'Litige ouvert sur un paiement' : 'Payment dispute opened';
    const corps = langue === 'fr'
      ? `Un client conteste un paiement de ${montant} auprès de sa banque${params.reason ? ` (motif : ${params.reason})` : ''}. Répondez dans votre tableau de bord Stripe depuis Réglages → Lume Payments.`
      : `A client is disputing a ${montant} payment with their bank${params.reason ? ` (reason: ${params.reason})` : ''}. Respond from your Stripe dashboard via Settings → Lume Payments.`;
    await createNotification(admin, params.orgId, titre, corps, params.paymentId, 'payment_dispute');
  } catch (err: any) {
    console.error('[paiement-recu] notification de litige non créée:', err?.message);
  }
}
