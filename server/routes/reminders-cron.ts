/**
 * Automated Payment Reminders — cron worker.
 *
 * POST /api/cron/payment-reminders
 *   Auth: Bearer <CRON_SECRET> OR header x-cron-secret: <CRON_SECRET>
 *
 * For each org with reminder_settings.enabled = true:
 *   For each schedule entry {days_after_due, channel}:
 *     For each invoice with status IN ('sent','partial')
 *       AND due_date IS NOT NULL
 *       AND due_date < (today - days_after_due days)
 *       AND not already logged for (invoice_id, days_after_due, channel):
 *         - send email/sms per channel
 *         - upsert reminder_log row (UNIQUE constraint guarantees idempotency)
 *
 * Status remains in ('sent','partial') — there's no 'overdue' status in
 * invoices.status check constraint; the dashboard derives "overdue" from
 * due_date < now() on read.
 */

import { Router, type Request, type Response } from 'express';
import crypto from 'crypto';
import { getServiceClient } from '../lib/supabase';
import { sendSafeError } from '../lib/error-handler';
import { sendEmail, isMailerConfigured } from '../lib/mailer';
import { sendSmsIfConfigured, applyTemplate } from '../lib/notificationHelpers';
import { twilioClient, twilioPhoneNumber } from '../lib/config';
import { resolvePublicBaseUrl } from '../lib/helpers';
import { createPaymentRequest } from '../lib/stripe-connect';
import { getOrgSmsFromNumber, SmsNumberNotProvisionedError } from '../lib/twilioProvisioning';

const router = Router();

function checkCronAuth(req: Request, res: Response): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    res.status(503).json({ error: 'CRON_SECRET not configured on server' });
    return false;
  }
  // Accept either Authorization: Bearer ... or x-cron-secret
  const header = req.headers['authorization'];
  let provided: string | null = null;
  if (typeof header === 'string' && header.toLowerCase().startsWith('bearer ')) {
    provided = header.slice(7).trim();
  } else if (typeof req.headers['x-cron-secret'] === 'string') {
    provided = String(req.headers['x-cron-secret']);
  }
  if (!provided) {
    res.status(401).json({ error: 'Invalid cron secret' });
    return false;
  }
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    res.status(401).json({ error: 'Invalid cron secret' });
    return false;
  }
  return true;
}

interface ScheduleEntry {
  days_after_due: number;
  channel: 'email' | 'sms' | 'both';
  template_id?: string | null;
}

const DEFAULT_EMAIL_SUBJECT = 'Payment reminder — invoice {invoice_number}';
const DEFAULT_EMAIL_BODY =
  'Hello {client_name},\n\n' +
  'This is a friendly reminder that invoice {invoice_number} for {amount_due} ' +
  'was due on {due_date}.\n\n' +
  'You can pay securely here: {pay_url}\n\n' +
  'Thank you,\n{company_name}';
const DEFAULT_SMS_BODY =
  'Reminder: invoice {invoice_number} ({amount_due}) was due {due_date}. Pay: {pay_url}';

function formatMoney(cents: number, currency = 'CAD') {
  try {
    return new Intl.NumberFormat('en-CA', { style: 'currency', currency }).format((cents || 0) / 100);
  } catch {
    return `$${((cents || 0) / 100).toFixed(2)}`;
  }
}

function htmlEscape(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function bodyToHtml(text: string) {
  return htmlEscape(text).replace(/\n/g, '<br/>');
}

router.post('/cron/payment-reminders', async (req, res) => {
  if (!checkCronAuth(req, res)) return;
  const svc = getServiceClient();

  let processed = 0;
  let sent = 0;
  let failed = 0;
  const errors: Array<{ invoice_id?: string; error: string }> = [];

  let publicBase = '';
  try {
    publicBase = resolvePublicBaseUrl(req);
  } catch (e: any) {
    return sendSafeError(res, e, 'Server PUBLIC_URL not configured.', '[cron/reminders]');
  }

  try {
    // 1. Load orgs with reminders enabled
    const { data: settingsRows, error: settingsErr } = await svc
      .from('reminder_settings')
      .select('org_id, schedule, custom_email_subject, custom_email_body, custom_sms_body, enabled')
      .eq('enabled', true);
    if (settingsErr) return sendSafeError(res, settingsErr, 'Failed to load reminder settings.', '[cron/reminders]');

    const today = new Date();

    for (const settings of settingsRows || []) {
      const orgId: string = settings.org_id;
      const schedule = Array.isArray(settings.schedule) ? (settings.schedule as ScheduleEntry[]) : [];
      if (!schedule.length) continue;

      // Fetch company branding for templating
      const { data: orgSettings } = await svc
        .from('company_settings')
        .select('company_name, email, phone')
        .eq('org_id', orgId)
        .maybeSingle();
      const companyName = orgSettings?.company_name || 'Your service provider';

      // For each schedule entry, find candidate invoices
      for (const entry of schedule) {
        const daysAfter = Number(entry.days_after_due);
        const channel = entry.channel;
        if (!Number.isFinite(daysAfter) || daysAfter < 0) continue;
        if (!['email', 'sms', 'both'].includes(channel)) continue;

        const cutoff = new Date(today.getTime());
        cutoff.setUTCDate(cutoff.getUTCDate() - daysAfter);
        const cutoffDate = cutoff.toISOString().slice(0, 10);

        const { data: invoices, error: invErr } = await svc
          .from('invoices')
          .select('id, org_id, client_id, invoice_number, total_cents, balance_cents, currency, due_date, status, subject')
          .eq('org_id', orgId)
          .in('status', ['sent', 'partial'])
          .lte('due_date', cutoffDate)
          .gt('balance_cents', 0)
          .limit(500);
        if (invErr) {
          errors.push({ error: `load invoices org=${orgId}: ${invErr.message}` });
          continue;
        }

        for (const inv of invoices || []) {
          processed++;
          try {
            // Dedupe: check log for (invoice_id, days_after_due, channel)
            const { data: logged } = await svc
              .from('reminder_log')
              .select('id')
              .eq('invoice_id', inv.id)
              .eq('days_after_due', daysAfter)
              .eq('channel', channel)
              .maybeSingle();
            if (logged) continue;

            // Fetch client contact
            const { data: client } = await svc
              .from('clients')
              .select('id, first_name, last_name, email, phone')
              .eq('id', inv.client_id)
              .maybeSingle();
            const clientName = [client?.first_name, client?.last_name].filter(Boolean).join(' ') || 'Customer';
            const toEmail = (client?.email || '').trim();
            const toPhone = (client?.phone || '').trim();

            // Build/find pay link (reuses existing pending request when available)
            let payUrl = `${publicBase}/dashboard`;
            try {
              const pr = await createPaymentRequest({
                orgId,
                invoiceId: inv.id,
                amountCents: Number(inv.balance_cents || 0),
                currency: String(inv.currency || 'CAD'),
              });
              const token = (pr as any)?.public_token;
              if (token) payUrl = `${publicBase}/pay/${token}`;
            } catch (e: any) {
              // Stripe Connect not set up — fall back to generic dashboard link.
              console.warn('[cron/reminders] payment request create failed:', e?.message);
            }

            const vars = {
              client_name: clientName,
              company_name: companyName,
              invoice_number: inv.invoice_number || inv.id.slice(0, 8),
              amount_due: formatMoney(Number(inv.balance_cents || 0), String(inv.currency || 'CAD')),
              due_date: String(inv.due_date || ''),
              pay_url: payUrl,
            };

            // EMAIL leg
            if ((channel === 'email' || channel === 'both') && toEmail && isMailerConfigured()) {
              const subject = applyTemplate(settings.custom_email_subject || DEFAULT_EMAIL_SUBJECT, vars);
              const body = applyTemplate(settings.custom_email_body || DEFAULT_EMAIL_BODY, vars);
              const result = await sendEmail({ to: toEmail, subject, html: bodyToHtml(body) });
              const emailChannel = channel === 'email' ? 'email' : 'both';
              if (channel === 'both') {
                // For 'both', defer logging until SMS attempted (single row with channel='both').
              } else {
                await svc.from('reminder_log').insert({
                  org_id: orgId,
                  invoice_id: inv.id,
                  days_after_due: daysAfter,
                  channel: emailChannel,
                  sent_to: toEmail,
                  status: result.sent ? 'sent' : 'failed',
                  error_message: result.sent ? null : (result.error || 'send failed'),
                });
                if (result.sent) sent++;
                else failed++;
              }
              // For 'both' track partial via variable below
              (inv as any)._email_result = result;
            }

            // SMS leg — resolve per-org Twilio "from" number, fallback to shared.
            let orgFromNumber: string | null = null;
            if (twilioClient && (channel === 'sms' || channel === 'both') && toPhone) {
              try {
                orgFromNumber = await getOrgSmsFromNumber(orgId);
              } catch (e) {
                if (!(e instanceof SmsNumberNotProvisionedError)) throw e;
                orgFromNumber = twilioPhoneNumber || null;
              }
            }
            if ((channel === 'sms' || channel === 'both') && toPhone && twilioClient && orgFromNumber) {
              const smsBody = applyTemplate(settings.custom_sms_body || DEFAULT_SMS_BODY, vars);
              let smsOk = true;
              let smsErr: string | null = null;
              try {
                await sendSmsIfConfigured({ client: twilioClient, phoneNumber: orgFromNumber }, toPhone, smsBody);
              } catch (e: any) {
                smsOk = false;
                smsErr = e?.message || 'sms failed';
              }
              if (channel === 'sms') {
                await svc.from('reminder_log').insert({
                  org_id: orgId,
                  invoice_id: inv.id,
                  days_after_due: daysAfter,
                  channel: 'sms',
                  sent_to: toPhone,
                  status: smsOk ? 'sent' : 'failed',
                  error_message: smsErr,
                });
                if (smsOk) sent++; else failed++;
              } else {
                // 'both' — combine results, single row
                const emailRes = (inv as any)._email_result;
                const ok = (emailRes?.sent ?? false) || smsOk;
                const sentTo = [toEmail, toPhone].filter(Boolean).join(' / ');
                await svc.from('reminder_log').insert({
                  org_id: orgId,
                  invoice_id: inv.id,
                  days_after_due: daysAfter,
                  channel: 'both',
                  sent_to: sentTo || 'unknown',
                  status: ok ? 'sent' : 'failed',
                  error_message: ok ? null : (smsErr || emailRes?.error || 'both channels failed'),
                });
                if (ok) sent++; else failed++;
              }
            } else if (channel === 'both' && (inv as any)._email_result) {
              // SMS was unavailable; record what email did
              const emailRes = (inv as any)._email_result;
              await svc.from('reminder_log').insert({
                org_id: orgId,
                invoice_id: inv.id,
                days_after_due: daysAfter,
                channel: 'both',
                sent_to: toEmail || 'unknown',
                status: emailRes?.sent ? 'sent' : 'failed',
                error_message: emailRes?.sent ? null : (emailRes?.error || 'sms unavailable'),
              });
              if (emailRes?.sent) sent++; else failed++;
            }
          } catch (e: any) {
            failed++;
            errors.push({ invoice_id: inv.id, error: e?.message || 'unknown' });
            console.error('[cron/reminders] invoice error:', inv.id, e?.message);
          }
        }
      }
    }

    return res.json({
      ok: true,
      processed,
      sent,
      failed,
      errors: errors.slice(0, 20),
    });
  } catch (error: any) {
    return sendSafeError(res, error, 'Cron job failed.', '[cron/reminders]');
  }
});

export default router;
