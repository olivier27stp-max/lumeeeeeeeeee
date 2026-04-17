/**
 * Billing Email Service
 *
 * Handles idempotent sending of payment receipt emails.
 * - Checks DB before sending to prevent duplicates
 * - Logs every attempt (sent/failed/skipped)
 * - Never throws — failures are logged, not propagated
 */

import { getServiceClient } from './supabase';
import { sendEmail, isMailerConfigured } from './mailer';
import { renderPaymentReceiptEmail, type ReceiptTemplateData } from './email-templates/payment-receipt';

export interface SendReceiptParams {
  orgId: string;
  subscriptionId?: string;
  recipientEmail: string;
  companyName: string;
  planName: string;
  interval: 'monthly' | 'yearly';
  amountCents: number;
  currency: string;
  taxes: number | null; // cents
  stripePaymentIntentId?: string | null;
  stripeCheckoutSessionId?: string | null;
  stripeInvoiceId?: string | null;
  paymentDate: Date;
  dashboardUrl: string;
  billingUrl: string;
}

/**
 * Send a payment receipt email — idempotent.
 * Returns { sent, skipped, error } — never throws.
 */
export async function sendPaymentReceipt(params: SendReceiptParams): Promise<{
  sent: boolean;
  skipped: boolean;
  error?: string;
}> {
  const admin = getServiceClient();

  try {
    // ── 1. Idempotency check: already sent for this checkout session? ──
    if (params.stripeCheckoutSessionId) {
      const { data: existing } = await admin
        .from('billing_receipt_log')
        .select('id, status')
        .eq('stripe_checkout_session_id', params.stripeCheckoutSessionId)
        .eq('email_type', 'payment_receipt')
        .maybeSingle();

      if (existing && existing.status === 'sent') {
        console.log(`[billing-email] Receipt already sent for session ${params.stripeCheckoutSessionId}, skipping`);
        return { sent: false, skipped: true };
      }
    }

    // Also check by payment intent
    if (params.stripePaymentIntentId) {
      const { data: existing } = await admin
        .from('billing_receipt_log')
        .select('id, status')
        .eq('stripe_payment_intent_id', params.stripePaymentIntentId)
        .eq('email_type', 'payment_receipt')
        .eq('status', 'sent')
        .maybeSingle();

      if (existing) {
        console.log(`[billing-email] Receipt already sent for PI ${params.stripePaymentIntentId}, skipping`);
        return { sent: false, skipped: true };
      }
    }

    // ── 2. Check mailer configuration ──
    if (!isMailerConfigured()) {
      console.warn('[billing-email] SMTP not configured — receipt email skipped');
      await insertReceiptLog(admin, params, 'skipped', null, 'SMTP not configured');
      return { sent: false, skipped: true, error: 'SMTP not configured' };
    }

    // ── 3. Build template data ──
    const formatCurrency = (cents: number, cur: string) => {
      const amount = (cents / 100).toFixed(2);
      const symbol = cur === 'USD' ? '$' : cur === 'CAD' ? 'CA$' : `${cur} `;
      return `${symbol}${amount}`;
    };

    const subtotal = params.taxes ? params.amountCents - params.taxes : params.amountCents;
    const templateData: ReceiptTemplateData = {
      companyName: params.companyName || 'Your company',
      planName: params.planName,
      billingPeriod: params.interval === 'yearly' ? 'Yearly' : 'Monthly',
      amountPaid: formatCurrency(subtotal, params.currency),
      currency: params.currency,
      taxes: params.taxes ? formatCurrency(params.taxes, params.currency) : null,
      total: formatCurrency(params.amountCents, params.currency),
      paymentDate: params.paymentDate.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }),
      billingEmail: params.recipientEmail,
      transactionId: params.stripePaymentIntentId || params.stripeCheckoutSessionId || 'N/A',
      dashboardUrl: params.dashboardUrl,
      billingUrl: params.billingUrl,
    };

    const html = renderPaymentReceiptEmail(templateData);

    // ── 4. Send email ──
    const result = await sendEmail({
      to: params.recipientEmail,
      subject: `Payment confirmed — Lume ${params.planName}`,
      html,
    });

    // ── 5. Log result ──
    if (result.sent) {
      console.log(`[billing-email] Receipt sent to ${params.recipientEmail} for session ${params.stripeCheckoutSessionId || 'N/A'}`);
      await insertReceiptLog(admin, params, 'sent', result.messageId || null, null);

      // Also update subscription receipt tracking
      if (params.subscriptionId) {
        await admin
          .from('subscriptions')
          .update({
            receipt_email_sent: true,
            receipt_email_sent_at: new Date().toISOString(),
            receipt_email_error: null,
          })
          .eq('id', params.subscriptionId);
      }

      return { sent: true, skipped: false };
    } else {
      console.error(`[billing-email] Receipt send failed for ${params.recipientEmail}:`, result.error);
      await insertReceiptLog(admin, params, 'failed', null, result.error || 'Unknown send error');

      if (params.subscriptionId) {
        await admin
          .from('subscriptions')
          .update({
            receipt_email_sent: false,
            receipt_email_error: result.error || 'Send failed',
          })
          .eq('id', params.subscriptionId);
      }

      return { sent: false, skipped: false, error: result.error };
    }
  } catch (err: any) {
    console.error('[billing-email] Unexpected error in sendPaymentReceipt:', err.message);
    // Best-effort log
    try {
      await insertReceiptLog(admin, params, 'failed', null, err.message);
    } catch {}
    return { sent: false, skipped: false, error: err.message };
  }
}

/**
 * Resend a receipt for a given subscription. Looks up the receipt log
 * and sends again if it was previously sent or failed.
 */
export async function resendPaymentReceipt(subscriptionId: string): Promise<{
  sent: boolean;
  error?: string;
}> {
  const admin = getServiceClient();

  // Get subscription + plan + billing profile
  const { data: sub } = await admin
    .from('subscriptions')
    .select('*, plans(*)')
    .eq('id', subscriptionId)
    .maybeSingle();

  if (!sub) return { sent: false, error: 'Subscription not found' };

  const { data: bp } = await admin
    .from('billing_profiles')
    .select('*')
    .eq('org_id', sub.org_id)
    .maybeSingle();

  const email = bp?.billing_email || '';
  if (!email) return { sent: false, error: 'No billing email on file' };

  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

  // Force re-send (bypass idempotency by not passing checkout session)
  const result = await sendPaymentReceipt({
    orgId: sub.org_id,
    subscriptionId: sub.id,
    recipientEmail: email,
    companyName: bp?.company_name || '',
    planName: sub.plans?.name || 'Unknown',
    interval: sub.interval || 'monthly',
    amountCents: sub.amount_cents || 0,
    currency: sub.currency || 'CAD',
    taxes: null,
    stripePaymentIntentId: sub.stripe_payment_intent_id,
    stripeCheckoutSessionId: null, // null to bypass dedup
    paymentDate: sub.payment_confirmed_at ? new Date(sub.payment_confirmed_at) : new Date(sub.created_at),
    dashboardUrl: frontendUrl,
    billingUrl: `${frontendUrl}/settings/billing`,
  });

  return { sent: result.sent, error: result.error };
}

// ── Internal helper ──

async function insertReceiptLog(
  admin: ReturnType<typeof getServiceClient>,
  params: SendReceiptParams,
  status: 'sent' | 'failed' | 'skipped',
  messageId: string | null,
  errorMessage: string | null,
) {
  try {
    await admin.from('billing_receipt_log').insert({
      org_id: params.orgId,
      subscription_id: params.subscriptionId || null,
      recipient_email: params.recipientEmail,
      email_type: 'payment_receipt',
      stripe_payment_intent_id: params.stripePaymentIntentId || null,
      stripe_checkout_session_id: params.stripeCheckoutSessionId || null,
      stripe_invoice_id: params.stripeInvoiceId || null,
      amount_cents: params.amountCents,
      currency: params.currency,
      plan_name: params.planName,
      status,
      message_id: messageId,
      error_message: errorMessage,
      sent_at: status === 'sent' ? new Date().toISOString() : null,
    });
  } catch (logErr: any) {
    // If it's a unique constraint violation, that's fine (duplicate)
    if (logErr?.code === '23505') return;
    console.error('[billing-email] Failed to insert receipt log:', logErr.message);
  }
}
