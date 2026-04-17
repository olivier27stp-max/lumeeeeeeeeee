import nodemailer from 'nodemailer';

/**
 * Centralized email sender using Nodemailer + Gmail SMTP.
 *
 * Required env vars:
 *   SMTP_HOST     — SMTP server (default: smtp.gmail.com)
 *   SMTP_PORT     — SMTP port (default: 587)
 *   SMTP_USER     — Gmail address (e.g. you@gmail.com)
 *   SMTP_PASS     — Gmail App Password (16-char code from Google)
 *   EMAIL_FROM    — Default "from" (e.g. "Lume CRM <you@gmail.com>")
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

  console.log(`[mailer] SMTP transport ready (${host}:${port})`);
  return transporter;
}

export interface SendEmailParams {
  from?: string;
  to: string | string[];
  replyTo?: string;
  subject: string;
  html: string;
}

export interface SendEmailResult {
  sent: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Send an email via SMTP (Gmail by default).
 * Drop-in replacement for Resend's `resend.emails.send()`.
 */
export async function sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
  const defaultFrom = process.env.EMAIL_FROM || `Lume CRM <${process.env.SMTP_USER}>`;

  try {
    const transport = getTransporter();
    const info = await transport.sendMail({
      from: params.from || defaultFrom,
      to: Array.isArray(params.to) ? params.to.join(', ') : params.to,
      replyTo: params.replyTo,
      subject: params.subject,
      html: params.html,
    });

    return { sent: true, messageId: info.messageId };
  } catch (err: any) {
    console.error('[mailer] send failed:', err.message);
    return { sent: false, error: err.message };
  }
}

/**
 * Check if SMTP is configured (non-throwing check for optional email features).
 */
export function isMailerConfigured(): boolean {
  return !!(process.env.SMTP_USER && process.env.SMTP_PASS);
}
