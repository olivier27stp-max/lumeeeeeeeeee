import nodemailer from 'nodemailer';
import { redirigerEmail } from './qa-redirect';
import { logger } from './logger';
import { getServiceClient } from './supabase';

/**
 * Centralized email sender.
 *
 * Deux fournisseurs, choisis par l'environnement :
 *
 *   RESEND_API_KEY présent → API Resend (https://resend.com), domaine
 *     lumecrm.net avec SPF / DKIM / DMARC, webhooks de rebond captés par
 *     POST /api/webhooks/email. C'est le chemin de production visé.
 *
 *   sinon → SMTP (Gmail par défaut). Audit QA 2026-09-09, n°8 : un seul
 *     compte Gmail pour tout le transactionnel de tous les clients — plafond
 *     ~500 destinataires/jour, expéditeur @gmail.com, et AUCUN rebond capté :
 *     une adresse mal saisie donnait une facture « envoyée, en attente de
 *     paiement » pour toujours.
 *
 * Quel que soit le fournisseur, chaque envoi laisse une ligne dans
 * `email_deliveries` (statut `sent`), que le webhook fait évoluer. L'interface
 * lit la dernière ligne d'une entité pour afficher « courriel non livré », et
 * les relances sautent une adresse qui a rebondi.
 *
 * Env :
 *   RESEND_API_KEY — active Resend
 *   EMAIL_FROM     — expéditeur par défaut (ex. "Lume CRM <factures@lumecrm.net>")
 *   SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS — repli SMTP
 */

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter {
  if (transporter) return transporter;

  const host = process.env.SMTP_HOST || 'smtp.gmail.com';
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!user || !pass) {
    throw new Error('[mailer] SMTP_USER and SMTP_PASS are required. Set them in .env.local');
  }

  transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });

  logger.info(`[mailer] SMTP transport ready (${host}:${port})`);
  return transporter;
}

export type FournisseurCourriel = 'resend' | 'smtp';

export function fournisseurCourriel(env: NodeJS.ProcessEnv = process.env): FournisseurCourriel {
  return env.RESEND_API_KEY ? 'resend' : 'smtp';
}

/** Ce que le courriel concerne — pour retrouver son sort depuis la facture. */
export interface SuiviCourriel {
  orgId: string | null;
  entityType: string;
  entityId?: string | null;
}

export interface SendEmailParams {
  from?: string;
  to: string | string[];
  replyTo?: string;
  subject: string;
  html: string;
  /**
   * En-têtes SMTP additionnels.
   *
   * Nécessaire pour `List-Unsubscribe` / `List-Unsubscribe-Post` : sans eux,
   * Gmail et Outlook n'affichent pas leur bouton natif « Se désabonner », et
   * les courriels commerciaux sont davantage classés en pourriel.
   */
  headers?: Record<string, string>;
  /** Journalise l'envoi dans email_deliveries (badge « non livré », relances). */
  suivi?: SuiviCourriel;
}

export interface SendEmailResult {
  sent: boolean;
  messageId?: string;
  error?: string;
}

const RESEND_API = 'https://api.resend.com/emails';

async function envoyerViaResend(p: { from: string; to: string[]; replyTo?: string; subject: string; html: string; headers?: Record<string, string> }): Promise<{ id: string }> {
  const res = await fetch(RESEND_API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: p.from,
      to: p.to,
      ...(p.replyTo ? { reply_to: p.replyTo } : {}),
      subject: p.subject,
      html: p.html,
      ...(p.headers ? { headers: p.headers } : {}),
    }),
  });
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok || !body?.id) {
    throw new Error(`Resend ${res.status}: ${body?.message || body?.name || 'unknown error'}`);
  }
  return { id: String(body.id) };
}

/**
 * Journal d'envoi. Best-effort : un échec ici ne doit jamais faire échouer
 * l'envoi — mais il est journalisé, un trou dans ce journal est une
 * information (la table peut manquer sur un environnement pas encore migré).
 */
async function journaliserEnvoi(entree: {
  provider: FournisseurCourriel; messageId: string; to: string; subject: string; suivi?: SuiviCourriel;
}): Promise<void> {
  try {
    const { error } = await getServiceClient().from('email_deliveries').insert({
      org_id: entree.suivi?.orgId ?? null,
      provider: entree.provider,
      message_id: entree.messageId,
      to_email: entree.to,
      subject: entree.subject.slice(0, 500),
      entity_type: entree.suivi?.entityType ?? null,
      entity_id: entree.suivi?.entityId ?? null,
      status: 'sent',
    });
    if (error) logger.error('[mailer] email_deliveries non journalisé', { error: error.message, messageId: entree.messageId });
  } catch (err: any) {
    logger.error('[mailer] email_deliveries non journalisé', { error: err?.message || String(err) });
  }
}

/**
 * Send an email — Resend si configuré, sinon SMTP.
 * Drop-in replacement for Resend's `resend.emails.send()`.
 */
export async function sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
  const defaultFrom = process.env.EMAIL_FROM || `Lume CRM <${process.env.SMTP_USER}>`;

  // Mode QA : quand QA_REDIRECT_EMAIL est défini, tout courriel part vers cette
  // adresse et le destinataire d'origine passe dans l'objet. Passe-plat sinon.
  const qa = redirigerEmail(params.to, params.subject);
  if (qa.redirige) {
    console.warn(`[qa] courriel redirigé : ${qa.destinataireOrigine} → ${qa.to}`);
  }
  const destinataires = Array.isArray(qa.to) ? qa.to : [qa.to];
  const provider = fournisseurCourriel();

  try {
    let messageId: string;
    if (provider === 'resend') {
      const { id } = await envoyerViaResend({
        from: params.from || defaultFrom,
        to: destinataires,
        replyTo: params.replyTo,
        subject: qa.subject,
        html: params.html,
        headers: params.headers,
      });
      messageId = id;
    } else {
      const transport = getTransporter();
      const info = await transport.sendMail({
        from: params.from || defaultFrom,
        to: destinataires.join(', '),
        replyTo: params.replyTo,
        subject: qa.subject,
        html: params.html,
        ...(params.headers ? { headers: params.headers } : {}),
      });
      messageId = info.messageId;
    }

    // Une ligne par destinataire réel (pas l'adresse de redirection QA).
    const originaux = Array.isArray(params.to) ? params.to : [params.to];
    await Promise.all(originaux.map((to, i) => journaliserEnvoi({
      provider,
      messageId: originaux.length > 1 ? `${messageId}#${i}` : messageId,
      to,
      subject: params.subject,
      suivi: params.suivi,
    })));

    return { sent: true, messageId };
  } catch (err: any) {
    console.error('[mailer] send failed:', err.message);
    // Remonté à Sentry : cette erreur est attrapée volontairement (pour ne pas
    // casser le flux appelant), donc le gestionnaire global ne la verrait
    // jamais. Sans ça, un serveur SMTP en panne reste invisible jusqu'à ce
    // qu'un client se plaigne de ne rien avoir reçu.
    try {
      const { captureException } = await import('./sentry');
      captureException(err, {
        kind: 'email_send_failed',
        to: Array.isArray(params.to) ? params.to.join(', ') : params.to,
        subject: params.subject,
      });
    } catch { /* no-op */ }
    return { sent: false, error: err.message };
  }
}

/**
 * Check if a mail provider is configured (non-throwing check for optional email features).
 */
export function isMailerConfigured(): boolean {
  return !!process.env.RESEND_API_KEY || !!(process.env.SMTP_USER && process.env.SMTP_PASS);
}

/**
 * Cette adresse a-t-elle rebondi (ou signalé un pourriel) pour cette org ?
 * Les relances automatiques s'en servent : relancer une adresse morte ne
 * sert à rien et abîme la réputation du domaine.
 */
export async function adresseInjoignable(orgId: string, email: string): Promise<boolean> {
  try {
    const { data, error } = await getServiceClient()
      .from('email_deliveries')
      .select('id')
      .eq('org_id', orgId)
      .ilike('to_email', email.trim())
      .in('status', ['bounced', 'complained'])
      .limit(1);
    if (error) return false;
    return (data?.length ?? 0) > 0;
  } catch {
    return false;
  }
}
