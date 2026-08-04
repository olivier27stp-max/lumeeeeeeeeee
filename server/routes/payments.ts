import { Router } from 'express';
import express from 'express';
import Stripe from 'stripe';
import { z } from 'zod';
import { requireAuthedClient, isOrgMember, isOrgAdminOrOwner, getServiceClient, findUserByEmail } from '../lib/supabase';
import { parseOrgId, clampInt, resolvePublicBaseUrl } from '../lib/helpers';
import { dispatchWebhook } from '../lib/webhookDispatcher';
import { generateCommissionsForInvoice, handleInvoiceReversal } from '../lib/field-sales/commission-engine';

// Refund input validation
const refundSchema = z.object({
  paymentId: z.string().uuid('Invalid paymentId.'),
  amountCents: z.number().int().positive().max(100_000_000).optional(),
  reason: z.string().trim().max(500).optional(),
});
import { stripeWebhookSecret, stripeConnectWebhookSecret, stripeWebhookClient, supabaseServiceRoleKey, paypalWebhookId, paypalEnv } from '../lib/config';
import {
  validate,
  paymentKeysSchema,
  paymentSettingsSchema,
  providerSettingsSchema,
  stripeCreateIntentSchema,
  paypalCreateOrderSchema,
  paypalCaptureOrderSchema,
} from '../lib/validation';
import {
  parsePaymentMetadata,
  normalizeDefaultProvider,
  isSchemaNotReadyError,
  defaultPaymentSettings,
  ensurePaymentSettingsRow,
  getPaymentProviderSettings,
  getPaymentProviderSecrets,
  isValidDefaultProvider,
  saveProviderKeys,
  parsePayoutProvider,
  parseDateParam,
  resolvePayoutProvider,
  buildStripePayoutSummary,
  listStripePayouts,
  getStripePayoutDetail,
  buildPayPalPayoutSummary,
  listPayPalPayouts,
  getPayPalPayoutDetail,
  csvEscape,
  serializeCursor,
  insertOrUpdatePaymentIdempotent,
  getInvoiceForOrg,
  getPayPalAccessToken,
  getPayPalBaseUrl,
  parseCustomId,
  verifyPayPalWebhookSignature,
  createOrUpdatePayPalPaymentFromCapture,
  PayoutListItem,
} from '../lib/payments';
import {
  logWebhookEvent,
  markWebhookEventProcessed,
  updatePaymentRequestStatus as updatePayReqStatus,
  saveCardOnFileFromIntent,
  chargeInvoiceOnFile,
  getPlatformStripe,
} from '../lib/stripe-connect';
import { logSecurityEvent, extractIP } from '../lib/security';
import { sendSafeError } from '../lib/error-handler';
import { logDataExport } from '../lib/data-export-log';

const router = Router();

// ── Stripe webhook handler — exported separately for mounting BEFORE express.json() ──
// Handles both direct Stripe events AND Stripe Connect events
export const stripeWebhookHandler: import('express').RequestHandler = async (req, res) => {
  try {
    // Accept both the platform-account webhook secret and the Connect webhook
    // secret. The same handler is mounted at /api/webhooks/stripe (direct
    // account events) and /api/webhooks/stripe-connect (Connect events). Which
    // secret signed the request depends on which endpoint Stripe is calling, so
    // we try every configured secret and accept the first that verifies.
    const webhookSecrets = [stripeWebhookSecret, stripeConnectWebhookSecret].filter(Boolean);
    if (!stripeWebhookClient || webhookSecrets.length === 0) {
      res.status(503).json({ error: 'Stripe webhook is not configured.' });
      return;
    }

    const signature = req.header('stripe-signature');
    if (!signature) {
      logSecurityEvent({
        event_type: 'stripe_webhook_missing_signature',
        severity: 'high',
        source: 'webhook',
        ip_address: extractIP(req),
        user_agent: req.headers['user-agent'],
        details: { path: '/api/webhooks/stripe' },
      });
      res.status(400).json({ error: 'Missing Stripe signature header.' });
      return;
    }

    const rawBody = req.body instanceof Buffer ? req.body : Buffer.from('');
    let event: Stripe.Event | null = null;
    let lastSigErr: any = null;
    for (const secret of webhookSecrets) {
      try {
        event = stripeWebhookClient.webhooks.constructEvent(rawBody, signature, secret);
        break;
      } catch (sigErr: any) {
        lastSigErr = sigErr;
      }
    }
    if (!event) {
      const sigErr = lastSigErr;
      logSecurityEvent({
        event_type: 'stripe_webhook_invalid_signature',
        severity: 'critical',
        source: 'webhook',
        ip_address: extractIP(req),
        user_agent: req.headers['user-agent'],
        details: { error: sigErr?.message, path: '/api/webhooks/stripe' },
      });
      res.status(400).json({ error: 'Invalid Stripe signature.' });
      return;
    }

    // Reject events older than 5 minutes (anti-replay)
    const eventAge = Math.floor(Date.now() / 1000) - event.created;
    if (eventAge > 300) {
      logSecurityEvent({
        event_type: 'stripe_webhook_stale_event',
        severity: 'medium',
        source: 'webhook',
        ip_address: extractIP(req),
        details: { event_id: event.id, event_type: event.type, age_seconds: eventAge },
      });
      res.json({ received: true, note: 'stale_event_ignored' });
      return;
    }

    // Log webhook event for auditing & idempotency
    const connectAccountId = (event as any).account || null;
    const logResult = await logWebhookEvent({
      provider: 'stripe',
      stripeEventId: event.id,
      stripeAccountId: connectAccountId,
      eventType: event.type,
      payload: event as any,
    });

    // Idempotency: skip if already processed
    if (logResult.alreadyProcessed) {
      res.json({ received: true, note: 'already_processed' });
      return;
    }

    const webhookEventId = logResult.id;

    try {
      // ── Handle payment_intent.succeeded ──
      if (event.type === 'payment_intent.succeeded') {
        const intent = event.data.object as Stripe.PaymentIntent;
        const metadata = parsePaymentMetadata(intent.metadata);

        if (metadata.orgId && metadata.invoiceId) {
          // Determine if this is a destination charge (has transfer_data)
          const charge = intent.latest_charge;
          const transferData = (intent as any).transfer_data;

          // Pull card brand + last4 from the charge so we can store them on the
          // payment. latest_charge is a bare id on webhook events, so retrieve it.
          // Failure here must never fail the webhook — fall back to null.
          let cardLast4: string | null = null;
          let cardBrand: string | null = null;
          if (intent.payment_method_types?.[0] === 'card') {
            try {
              const chargeId = typeof charge === 'string' ? charge : charge?.id;
              if (chargeId) {
                const ch = await stripeWebhookClient.charges.retrieve(
                  chargeId,
                  connectAccountId ? { stripeAccount: connectAccountId } : undefined,
                );
                const cardDetails = ch.payment_method_details?.card;
                cardLast4 = cardDetails?.last4 || null;
                cardBrand = cardDetails?.brand || null;
              }
            } catch (cardErr: any) {
              console.error('[webhook/stripe] card detail fetch failed:', cardErr?.message);
            }
          }

          await insertOrUpdatePaymentIdempotent({
            org_id: metadata.orgId,
            invoice_id: metadata.invoiceId,
            client_id: metadata.clientId,
            job_id: metadata.jobId,
            provider: 'stripe',
            provider_payment_id: intent.id,
            provider_event_id: event.id,
            status: 'succeeded',
            method: intent.payment_method_types?.[0] === 'card' ? 'card' : null,
            card_last4: cardLast4,
            card_brand: cardBrand,
            amount_cents: Math.max(0, Math.round(intent.amount_received || intent.amount || 0)),
            currency: String(intent.currency || 'CAD').toUpperCase(),
            payment_date: new Date((intent.created || Math.floor(Date.now() / 1000)) * 1000).toISOString(),
          });

          // If there's a payment_request_id in metadata, mark it as paid
          const paymentRequestId = String((intent.metadata as any)?.payment_request_id || '').trim();
          if (paymentRequestId) {
            await updatePayReqStatus(paymentRequestId, 'paid', {
              stripe_payment_intent_id: intent.id,
            });
          }

          // Carte au dossier : le payeur a coché « Sauvegarder ma carte »
          // (consentement explicite Loi 25 — save_card + horodatage posés par
          // /pay/:token/save-card). Best-effort : n'échoue jamais le webhook.
          if (String((intent.metadata as any)?.save_card || '') === '1' && metadata.clientId) {
            const pmId = typeof intent.payment_method === 'string'
              ? intent.payment_method
              : (intent.payment_method as any)?.id || null;
            const customerId = typeof intent.customer === 'string'
              ? intent.customer
              : (intent.customer as any)?.id || null;
            if (pmId && customerId) {
              try {
                await saveCardOnFileFromIntent({
                  orgId: metadata.orgId,
                  clientId: metadata.clientId,
                  stripeCustomerId: customerId,
                  paymentMethodId: pmId,
                  consentedAtIso: String((intent.metadata as any)?.save_card_consented_at || '') || null,
                });
              } catch (cofErr: any) {
                console.error('[webhook/stripe] card-on-file save failed:', cofErr?.message);
              }
            }
          }

          // Update invoice paid_cents and status
          const admin = getServiceClient();
          const amountPaid = Math.max(0, Math.round(intent.amount_received || intent.amount || 0));

          const { data: applied, error: applyErr } = await admin.rpc('apply_invoice_payment', {
            p_invoice_id: metadata.invoiceId,
            p_org_id: metadata.orgId,
            p_amount_cents: amountPaid,
          });
          if (applyErr) throw new Error('apply_invoice_payment failed: ' + applyErr.message);
          const invoiceRow = Array.isArray(applied) ? applied[0] : applied;

          if (invoiceRow) {
            const newPaidCents = Number(invoiceRow.paid_cents || 0);
            const newStatus = invoiceRow.status;

            // Outbound webhooks — payment.received always; invoice.paid when fully settled.
            dispatchWebhook(metadata.orgId, 'payment.received', {
              invoice_id: metadata.invoiceId,
              client_id: metadata.clientId,
              job_id: metadata.jobId,
              provider: 'stripe',
              provider_payment_id: intent.id,
              amount_cents: amountPaid,
              currency: String(intent.currency || 'CAD').toUpperCase(),
            }).catch((err) => console.error('[webhooks] payment.received failed:', err?.message));

            if (newStatus === 'paid') {
              dispatchWebhook(metadata.orgId, 'invoice.paid', {
                invoice_id: metadata.invoiceId,
                client_id: metadata.clientId,
                total_cents: Number(invoiceRow.total_cents || 0),
                paid_cents: newPaidCents,
                provider: 'stripe',
                provider_payment_id: intent.id,
              }).catch((err) => console.error('[webhooks] invoice.paid failed:', err?.message));
              // Auto-generate sales commission entries
              generateCommissionsForInvoice(admin, metadata.orgId, metadata.invoiceId)
                .catch((err) => console.error('[commissions] generate failed:', err?.message));
            }
          }
        }

        // ── Handle quote deposit payments ──
        const entityType = String((intent.metadata as any)?.entity_type || '').trim();
        const quoteId = String((intent.metadata as any)?.quote_id || '').trim();
        if (entityType === 'quote_deposit' && quoteId) {
          const admin = getServiceClient();
          const webhookOrgId = String((intent.metadata as any)?.org_id || '').trim();
          // Mark quote deposit as paid — scoped to org for safety
          const quoteUpdate: Record<string, any> = { deposit_status: 'paid', updated_at: new Date().toISOString() };
          let qb = admin.from('quotes').update(quoteUpdate).eq('id', quoteId);
          if (webhookOrgId) qb = qb.eq('org_id', webhookOrgId);
          const { error: quoteDepErr } = await qb;
          if (quoteDepErr) throw new Error('quote deposit_status update failed: ' + quoteDepErr.message);

          // Mark payment_requirement as paid
          const payReqId = String((intent.metadata as any)?.payment_requirement_id || '').trim();
          if (payReqId) {
            const { error: payReqErr } = await admin.from('payment_requirements').update({
              status: 'paid',
              payment_id: null,
              updated_at: new Date().toISOString(),
            }).eq('id', payReqId);
            if (payReqErr) throw new Error('payment_requirements paid update failed: ' + payReqErr.message);
          }
        }
      }

      // ── Handle payment_intent.payment_failed ──
      if (event.type === 'payment_intent.payment_failed') {
        const intent = event.data.object as Stripe.PaymentIntent;
        const metadata = parsePaymentMetadata(intent.metadata);
        const paymentRequestId = String((intent.metadata as any)?.payment_request_id || '').trim();

        if (metadata.orgId && metadata.invoiceId) {
          await insertOrUpdatePaymentIdempotent({
            org_id: metadata.orgId,
            invoice_id: metadata.invoiceId,
            client_id: metadata.clientId,
            job_id: metadata.jobId,
            provider: 'stripe',
            provider_payment_id: intent.id,
            provider_event_id: event.id,
            status: 'failed',
            method: intent.payment_method_types?.[0] === 'card' ? 'card' : null,
            amount_cents: Math.max(0, Math.round(intent.amount || 0)),
            currency: String(intent.currency || 'CAD').toUpperCase(),
            payment_date: new Date().toISOString(),
          });
        }
      }

      // ── Handle account.updated (Connect onboarding status changes) ──
      if (event.type === 'account.updated' && connectAccountId) {
        const account = event.data.object as Stripe.Account;
        const { getServiceClient } = await import('../lib/supabase');
        const admin = getServiceClient();

        await admin
          .from('connected_accounts')
          .update({
            charges_enabled: Boolean(account.charges_enabled),
            payouts_enabled: Boolean(account.payouts_enabled),
            details_submitted: Boolean(account.details_submitted),
            onboarding_complete: Boolean(account.charges_enabled && account.details_submitted),
            country: account.country || null,
            default_currency: (account.default_currency || 'cad').toUpperCase(),
          })
          .eq('stripe_account_id', connectAccountId);
      }

      // ── F-13: Handle customer.subscription.updated ──
      // Sync Stripe-side subscription status (renewals, plan changes from Schedules,
      // cancellation scheduling, past_due) back into our subscriptions table.
      if (event.type === 'customer.subscription.updated') {
        const sub = event.data.object as Stripe.Subscription;
        const admin = getServiceClient();
        // Stripe SDK v20 moved current_period_* off the Subscription type onto each item;
        // the field is still present in API responses, so cast to read it.
        const subAny = sub as any;
        const firstItem = sub.items.data[0] as any;
        const periodStart = (subAny.current_period_start ?? firstItem?.current_period_start)
          ? new Date((subAny.current_period_start ?? firstItem.current_period_start) * 1000).toISOString()
          : null;
        const periodEnd = (subAny.current_period_end ?? firstItem?.current_period_end)
          ? new Date((subAny.current_period_end ?? firstItem.current_period_end) * 1000).toISOString()
          : null;
        const canceledAt = sub.canceled_at
          ? new Date(sub.canceled_at * 1000).toISOString()
          : null;

        // Detect plan change from Stripe Schedule transition or direct update.
        // We resolve the Lume plan by matching the price recurring.interval + unit_amount.
        const updateRow: Record<string, any> = {
          status: sub.status,
          cancel_at_period_end: Boolean(sub.cancel_at_period_end),
          canceled_at: canceledAt,
          current_period_start: periodStart,
          current_period_end: periodEnd,
          // pas d'updated_at sur subscriptions : l'inclure faisait echouer la
          // requete, donc le webhook levait une erreur -> rejeu Stripe en boucle.
        };

        if (firstItem?.price) {
          const stripeInterval = firstItem.price.recurring?.interval; // 'month' | 'year'
          const unitAmount = firstItem.price.unit_amount as number | null;
          const currency = (firstItem.price.currency || 'usd').toUpperCase();
          if (stripeInterval && unitAmount != null) {
            const lumeInterval = stripeInterval === 'year' ? 'yearly' : 'monthly';
            const priceField = lumeInterval === 'yearly'
              ? (currency === 'USD' ? 'yearly_price_usd' : 'yearly_price_cad')
              : (currency === 'USD' ? 'monthly_price_usd' : 'monthly_price_cad');

            // Find the matching Lume plan by price + interval (active plans only).
            const { data: matchingPlan } = await admin
              .from('plans')
              .select('id, slug')
              .eq('is_active', true)
              .eq(priceField, unitAmount)
              .maybeSingle();

            if (matchingPlan) {
              updateRow.plan_id = matchingPlan.id;
              updateRow.interval = lumeInterval;
              updateRow.amount_cents = unitAmount;
              // Clear scheduled change flags if the scheduled plan just became current.
              updateRow.scheduled_plan_id = null;
              updateRow.scheduled_interval = null;
              updateRow.scheduled_at = null;
            }
          }
        }

        // Cross-validate via stripe_subscription_id only — never trust metadata blindly.
        const { error: subSyncErr } = await admin
          .from('subscriptions')
          .update(updateRow)
          .eq('stripe_subscription_id', sub.id);
        if (subSyncErr) throw new Error('subscription.updated sync failed: ' + subSyncErr.message);

        // ── Sync the org's SMS number with its new entitlement ──
        // A downgrade to a plan without SMS must not leave the number running:
        // Twilio keeps billing us and the org keeps a service it stopped paying for.
        try {
          const { data: row } = await admin
            .from('subscriptions')
            .select('org_id')
            .eq('stripe_subscription_id', sub.id)
            .maybeSingle();

          if (row?.org_id) {
            const { orgPlanIncludesSms } = await import('../lib/twilioProvisioning');
            const { scheduleSmsNumberRelease, cancelSmsNumberRelease } = await import('../lib/twilioRelease');

            if (await orgPlanIncludesSms(row.org_id)) {
              // Upgraded back (or still entitled) — undo any pending release.
              await cancelSmsNumberRelease(row.org_id);
            } else {
              await scheduleSmsNumberRelease(row.org_id, `plan_change:${sub.status}`);
            }
          }
        } catch (smsErr: any) {
          // Never fail the webhook over number housekeeping — it is retried by the sweep.
          console.error('[webhook/subscription.updated] SMS entitlement sync failed:', smsErr?.message);
        }
      }

      // ── F-13: Handle customer.subscription.deleted ──
      if (event.type === 'customer.subscription.deleted') {
        const sub = event.data.object as Stripe.Subscription;
        const admin = getServiceClient();

        const { data: canceledRow } = await admin
          .from('subscriptions')
          .update({
            status: 'canceled',
            canceled_at: new Date().toISOString(),
            // idem : subscriptions n'a pas de colonne updated_at.
          })
          .eq('stripe_subscription_id', sub.id)
          .select('org_id')
          .maybeSingle();

        // Schedule the Twilio number for release (grace period, not immediate —
        // releasing is irreversible and breaks every existing conversation).
        try {
          if (canceledRow?.org_id) {
            const { orgPlanIncludesSms } = await import('../lib/twilioProvisioning');
            // Only if no OTHER live subscription still grants SMS.
            if (!(await orgPlanIncludesSms(canceledRow.org_id))) {
              const { scheduleSmsNumberRelease } = await import('../lib/twilioRelease');
              await scheduleSmsNumberRelease(canceledRow.org_id, 'subscription_canceled');
            }
          }
        } catch (smsErr: any) {
          console.error('[webhook/subscription.deleted] SMS release scheduling failed:', smsErr?.message);
        }
      }

      // ── F-13: Handle invoice.paid (SaaS subscription renewal) ──
      if (event.type === 'invoice.paid') {
        const inv = event.data.object as Stripe.Invoice;
        // Stripe SDK v20 reshaped Invoice; `subscription` still arrives in webhook payloads,
        // so read via cast. May be a string or an expanded Subscription object.
        const invAny = inv as any;
        const stripeSubId = typeof invAny.subscription === 'string' ? invAny.subscription : invAny.subscription?.id;
        const admin = getServiceClient();
        if (stripeSubId) {
          // Cross-validate: only touch the subscription row owned by the matching stripe sub id.
          const { error: invPaidErr } = await admin
            .from('subscriptions')
            .update({
              // pas d'updated_at sur subscriptions (colonne inexistante) :
              // l'inclure faisait echouer la requete et, depuis le durcissement
              // des erreurs, partir le webhook en boucle de rejeu Stripe.
              status: 'active',
            })
            .eq('stripe_subscription_id', stripeSubId);
          if (invPaidErr) throw new Error('invoice.paid subscription sync failed: ' + invPaidErr.message);
        }
        // If the invoice is on our internal invoices table (org-level), reconcile paid_cents.
        const internalInvoiceId = String((inv.metadata as any)?.invoice_id || '').trim();
        const metaOrgId = String((inv.metadata as any)?.org_id || '').trim();
        if (internalInvoiceId && metaOrgId) {
          const amountPaid = Math.max(0, Math.round(inv.amount_paid || 0));
          const { data: row } = await admin
            .from('invoices')
            .select('id, total_cents, paid_cents')
            .eq('id', internalInvoiceId)
            .eq('org_id', metaOrgId)
            .maybeSingle();
          if (row) {
            const newPaid = Math.min(Number(row.total_cents || 0), Number(row.paid_cents || 0) + amountPaid);
            const newBal = Math.max(0, Number(row.total_cents || 0) - newPaid);
            const { error: invReconcileErr } = await admin
              .from('invoices')
              .update({
                paid_cents: newPaid,
                balance_cents: newBal,
                status: newBal <= 0 ? 'paid' : 'partial',
                paid_at: newBal <= 0 ? new Date().toISOString() : null,
              })
              .eq('id', internalInvoiceId)
              .eq('org_id', metaOrgId);
            if (invReconcileErr) throw new Error('invoice.paid reconcile failed: ' + invReconcileErr.message);
          }
        }
      }

      // ── F-13/F-60: Handle invoice.payment_failed ──
      if (event.type === 'invoice.payment_failed') {
        const inv = event.data.object as Stripe.Invoice;
        const invAny = inv as any;
        const stripeSubId = typeof invAny.subscription === 'string' ? invAny.subscription : invAny.subscription?.id;
        const admin = getServiceClient();
        if (stripeSubId) {
          const { error: pastDueErr } = await admin
            .from('subscriptions')
            .update({
              // subscriptions n'a pas de colonne updated_at.
              status: 'past_due',
            })
            .eq('stripe_subscription_id', stripeSubId);
          if (pastDueErr) throw new Error('invoice.payment_failed subscription sync failed: ' + pastDueErr.message);
        }
        // Hook point for dunning emails — kept as a log entry for now to avoid
        // sending unverified PII through unrelated mailer paths.
        console.warn('[webhook] invoice.payment_failed', {
          stripe_subscription_id: stripeSubId,
          attempt: inv.attempt_count,
        });
      }

      // ── F-12: Handle charge.refunded (refunds initiated from the Stripe Dashboard) ──
      if (event.type === 'charge.refunded') {
        const charge = event.data.object as Stripe.Charge;
        const paymentIntentId = typeof charge.payment_intent === 'string'
          ? charge.payment_intent
          : charge.payment_intent?.id;
        if (paymentIntentId) {
          const admin = getServiceClient();
          // Cross-validate: only update the matching payment row; org_id stays as-is.
          const fullyRefunded = charge.amount_refunded >= charge.amount;
          await admin
            .from('payments')
            .update({
              status: fullyRefunded ? 'refunded' : 'partially_refunded',
              updated_at: new Date().toISOString(),
            })
            .eq('provider', 'stripe')
            .eq('provider_payment_id', paymentIntentId);
        }
      }

      // ── F-12: Handle charge.dispute.created — flag for ops review ──
      if (event.type === 'charge.dispute.created') {
        const dispute = event.data.object as Stripe.Dispute;
        const chargeId = typeof dispute.charge === 'string' ? dispute.charge : dispute.charge?.id;
        console.warn('[webhook] charge.dispute.created — manual review required', {
          dispute_id: dispute.id,
          charge_id: chargeId,
          reason: dispute.reason,
          status: dispute.status,
        });
        // Best-effort: surface on the corresponding payment row so the org sees it.
        if (chargeId) {
          const admin = getServiceClient();
          await admin
            .from('payments')
            .update({
              // CHECK de payments.status : failed | pending | refunded | succeeded.
              // 'disputed' n'en fait pas partie — le litige n'etait jamais
              // consigne. Le motif reste tracable via failure_reason.
              status: 'failed',
              failure_reason: `dispute:${dispute.reason || 'unknown'}`,
              updated_at: new Date().toISOString(),
            })
            .eq('provider', 'stripe')
            .eq('stripe_charge_id', chargeId);
        }
      }

      // ── Handle checkout.session.completed (billing subscription activation) ──
      if (event.type === 'checkout.session.completed') {
        const session = event.data.object as Stripe.Checkout.Session;
        const meta = session.metadata || {};

        // C1-05 — Billing provisioning must ONLY come from the PLATFORM account.
        // Both webhook secrets (platform + Connect) are accepted for signature
        // verification, so a connected merchant can craft a Checkout Session in
        // THEIR OWN account with our billing metadata (plan_slug/plan_id/email)
        // and a $1 amount. Such an event carries `event.account` (the merchant's
        // acct id). Provisioning on it would let the merchant self-grant the top
        // plan for $1, or hijack another org's billing via an email collision.
        // Platform billing events have `event.account === null`.
        if (connectAccountId) {
          logSecurityEvent({
            event_type: 'stripe_billing_event_from_connect_rejected',
            severity: 'high',
            source: 'webhook',
            ip_address: extractIP(req),
            details: { event_id: event.id, account: connectAccountId, session_id: session.id },
          });
        } else if (meta.plan_slug && session.payment_status === 'paid') {
          await handleCheckoutSessionCompleted(session, meta);
        }
      }

      // Mark webhook event as processed
      if (webhookEventId) {
        await markWebhookEventProcessed(webhookEventId, 'processed');
      }
    } catch (processingError: any) {
      // Mark as failed but don't re-throw — we still return 200 to Stripe
      if (webhookEventId) {
        await markWebhookEventProcessed(webhookEventId, 'failed', processingError?.message);
      }
      console.error('[webhook] processing error:', processingError?.message);
    }

    res.json({ received: true });
  } catch (error: any) {
    console.error('[webhook] signature verification failed:', error?.message);
    res.status(400).json({ error: 'Webhook signature verification failed.' });
  }
};

// ── Payment settings ──

router.get('/payments/settings', async (req, res) => {
  let fallbackOrgId = parseOrgId(req.query.orgId) || null;
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const requestedOrgId = parseOrgId(req.query.orgId) || auth.orgId;
    fallbackOrgId = requestedOrgId;
    const member = await isOrgMember(auth.client, auth.user.id, requestedOrgId);
    if (!member) {
      return res.status(403).json({ error: 'You are not a member of this organization.' });
    }

    await ensurePaymentSettingsRow(auth.client, requestedOrgId);
    const settings = await getPaymentProviderSettings(auth.client, requestedOrgId);
    const canManage = await isOrgAdminOrOwner(auth.client, auth.user.id, requestedOrgId);

    return res.json({
      settings,
      permissions: { can_manage: canManage },
    });
  } catch (error: any) {
    const message = String(error?.message || '').toLowerCase();
    const shouldFallback =
      isSchemaNotReadyError(error) ||
      message.includes('payment_provider_settings') ||
      message.includes('payment_provider_secrets') ||
      message.includes('ensure_payment_settings_row');

    if (shouldFallback && fallbackOrgId) {
      return res.json({
        settings: defaultPaymentSettings(fallbackOrgId),
        permissions: { can_manage: false },
        warning: 'Payments settings schema is not fully applied yet.',
      });
    }
    return sendSafeError(res, error, 'Unable to load payment settings.', '[payments/settings/get]');
  }
});

router.post('/payments/keys', validate(paymentKeysSchema), async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const requestedOrgId = parseOrgId(req.body?.orgId) || auth.orgId;
    const provider = String(req.body?.provider || '').trim().toLowerCase();
    if (provider !== 'stripe' && provider !== 'paypal') {
      return res.status(400).json({ error: 'provider must be stripe or paypal.' });
    }

    const member = await isOrgMember(auth.client, auth.user.id, requestedOrgId);
    if (!member) return res.status(403).json({ error: 'You are not a member of this organization.' });

    const canManage = await isOrgAdminOrOwner(auth.client, auth.user.id, requestedOrgId);
    if (!canManage) return res.status(403).json({ error: 'Only owner/admin can save payment keys.' });

    await ensurePaymentSettingsRow(auth.client, requestedOrgId);
    const result = await saveProviderKeys({
      client: auth.client,
      orgId: requestedOrgId,
      provider,
      body: req.body,
    });

    return res.json({ ok: true, provider: result.provider, keysPresent: result.keysPresent });
  } catch (error: any) {
    return sendSafeError(res, error, 'Unable to save payment keys.', '[payments/keys]');
  }
});

router.post('/payments/settings', validate(paymentSettingsSchema), async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const action = String(req.body?.action || '').trim();
    const provider = String(req.body?.provider || '').trim().toLowerCase();
    const requestedOrgId = parseOrgId(req.body?.orgId) || auth.orgId;

    if (!action) return res.status(400).json({ error: 'Missing action.' });

    const member = await isOrgMember(auth.client, auth.user.id, requestedOrgId);
    if (!member) return res.status(403).json({ error: 'You are not a member of this organization.' });

    const canManage = await isOrgAdminOrOwner(auth.client, auth.user.id, requestedOrgId);
    if (!canManage) return res.status(403).json({ error: 'Only owner/admin can update payment settings.' });

    await ensurePaymentSettingsRow(auth.client, requestedOrgId);

    if (action === 'save_keys') {
      try {
        await saveProviderKeys({
          client: auth.client,
          orgId: requestedOrgId,
          provider,
          body: req.body,
        });
      } catch (error: any) {
        return sendSafeError(res, error, 'Unable to save provider keys.', '[payments/save-keys]');
      }
    } else if (action === 'toggle_enabled') {
      if (provider !== 'stripe' && provider !== 'paypal') {
        return res.status(400).json({ error: 'Provider must be stripe or paypal.' });
      }

      if (typeof req.body?.enabled !== 'boolean') {
        return res.status(400).json({ error: 'enabled must be a boolean.' });
      }

      const enabled = Boolean(req.body.enabled);
      const current = await getPaymentProviderSettings(auth.client, requestedOrgId);

      if (provider === 'stripe' && enabled && !current.stripe_keys_present) {
        return res.status(400).json({ error: 'Stripe keys are missing. Save keys before enabling.' });
      }
      if (provider === 'paypal' && enabled && !current.paypal_keys_present) {
        return res.status(400).json({ error: 'PayPal keys are missing. Save keys before enabling.' });
      }

      const nextDefault =
        !enabled && current.default_provider === provider
          ? 'none'
          : current.default_provider;

      const patch =
        provider === 'stripe'
          ? { stripe_enabled: enabled, default_provider: nextDefault, updated_at: new Date().toISOString() }
          : { paypal_enabled: enabled, default_provider: nextDefault, updated_at: new Date().toISOString() };

      const { error: settingsError } = await auth.client
        .from('payment_provider_settings')
        .update(patch)
        .eq('org_id', requestedOrgId);
      if (settingsError) throw settingsError;
    } else if (action === 'set_default') {
      const defaultProvider = normalizeDefaultProvider(req.body?.defaultProvider ?? req.body?.default_provider);
      if (!isValidDefaultProvider(defaultProvider)) {
        return res.status(400).json({ error: 'Invalid default provider value.' });
      }

      const current = await getPaymentProviderSettings(auth.client, requestedOrgId);

      if (defaultProvider === 'stripe') {
        if (!current.stripe_enabled || !current.stripe_keys_present) {
          return res.status(400).json({ error: 'Stripe must be enabled and configured before setting as default.' });
        }
      }

      if (defaultProvider === 'paypal') {
        if (!current.paypal_enabled || !current.paypal_keys_present) {
          return res.status(400).json({ error: 'PayPal must be enabled and configured before setting as default.' });
        }
      }

      const { error: settingsError } = await auth.client
        .from('payment_provider_settings')
        .update({ default_provider: defaultProvider, updated_at: new Date().toISOString() })
        .eq('org_id', requestedOrgId);
      if (settingsError) throw settingsError;
    } else {
      return res.status(400).json({ error: 'Unsupported action.' });
    }

    const settings = await getPaymentProviderSettings(auth.client, requestedOrgId);
    return res.json({ settings });
  } catch (error: any) {
    return sendSafeError(res, error, 'Unable to update payment settings.', '[payments/settings/update]');
  }
});

// ── Payouts ──

router.get('/payments/payouts/summary', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const requestedOrgId = parseOrgId(req.query.orgId) || auth.orgId;
    const requestedProvider = parsePayoutProvider(req.query.provider);
    const member = await isOrgMember(auth.client, auth.user.id, requestedOrgId);
    if (!member) return res.status(403).json({ error: 'Forbidden for this organization.' });

    const { provider } = await resolvePayoutProvider({
      client: auth.client,
      orgId: requestedOrgId,
      requestedProvider,
    });

    if (provider === 'stripe') {
      const summary = await buildStripePayoutSummary(requestedOrgId);
      return res.json(summary);
    }

    const summary = await buildPayPalPayoutSummary(requestedOrgId);
    return res.json(summary);
  } catch (error: any) {
    return sendSafeError(res, error, 'Unable to load payout summary.', '[payments/payouts/summary]');
  }
});

router.get('/payments/payouts/list', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const requestedOrgId = parseOrgId(req.query.orgId) || auth.orgId;
    const requestedProvider = parsePayoutProvider(req.query.provider);
    const member = await isOrgMember(auth.client, auth.user.id, requestedOrgId);
    if (!member) return res.status(403).json({ error: 'Forbidden for this organization.' });

    const { provider } = await resolvePayoutProvider({
      client: auth.client,
      orgId: requestedOrgId,
      requestedProvider,
    });

    const limit = clampInt(req.query.limit, 25, 1, 100);
    const cursor = String(req.query.cursor || '').trim() || null;
    const method = String(req.query.method || '').trim().toLowerCase() || null;
    const dateFrom = parseDateParam(req.query.date_from);
    const dateTo = parseDateParam(req.query.date_to);

    if (provider === 'stripe') {
      const list = await listStripePayouts({
        orgId: requestedOrgId,
        limit,
        cursor,
        dateFrom,
        dateTo,
        method,
      });
      return res.json(list);
    }

    const list = await listPayPalPayouts({
      orgId: requestedOrgId,
      limit,
      cursor,
      dateFrom,
      dateTo,
      method,
    });
    return res.json(list);
  } catch (error: any) {
    return sendSafeError(res, error, 'Unable to load payouts list.', '[payments/payouts/list]');
  }
});

router.get('/payments/payouts/detail', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const requestedOrgId = parseOrgId(req.query.orgId) || auth.orgId;
    const requestedProvider = parsePayoutProvider(req.query.provider);
    const payoutId = String(req.query.id || '').trim();
    if (!payoutId) return res.status(400).json({ error: 'Missing payout id.' });

    const member = await isOrgMember(auth.client, auth.user.id, requestedOrgId);
    if (!member) return res.status(403).json({ error: 'Forbidden for this organization.' });

    const { provider } = await resolvePayoutProvider({
      client: auth.client,
      orgId: requestedOrgId,
      requestedProvider,
    });

    if (provider === 'stripe') {
      const detail = await getStripePayoutDetail(requestedOrgId, payoutId);
      return res.json(detail);
    }

    const detail = await getPayPalPayoutDetail({
      orgId: requestedOrgId,
      id: payoutId,
      dateFrom: parseDateParam(req.query.date_from),
      dateTo: parseDateParam(req.query.date_to),
    });
    return res.json(detail);
  } catch (error: any) {
    return sendSafeError(res, error, 'Unable to load payout detail.', '[payments/payouts/detail]');
  }
});

// Single-payment detail — used by the Facturation tab payment-detail drawer.
// `payments` ne stocke ni la marque ni les 4 derniers chiffres de la carte :
// ces champs sont renvoyés à null. receipt_url est lu en direct chez Stripe.
router.get('/payments/:id/detail', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const requestedOrgId = parseOrgId(req.query.orgId) || auth.orgId;
    const member = await isOrgMember(auth.client, auth.user.id, requestedOrgId);
    if (!member) return res.status(403).json({ error: 'Forbidden for this organization.' });

    const paymentId = String(req.params.id || '').trim();
    if (!paymentId) return res.status(400).json({ error: 'Missing payment id.' });

    const admin = getServiceClient();
    const { data: payment, error } = await admin
      .from('payments')
      .select('id, status, method, provider, amount_cents, currency, payment_date, paid_at, stripe_charge_id')
      .eq('id', paymentId)
      .eq('org_id', requestedOrgId)
      .is('deleted_at', null)
      .maybeSingle();
    if (error) throw error;
    if (!payment) return res.status(404).json({ error: 'Payment not found.' });

    // Best-effort live receipt url from Stripe (not persisted).
    let receiptUrl: string | null = null;
    try {
      if (payment.provider === 'stripe' && payment.stripe_charge_id) {
        const secrets = await getPaymentProviderSecrets(requestedOrgId);
        if (secrets.stripe_secret_key) {
          const stripeClient = new Stripe(secrets.stripe_secret_key);
          const ch = await stripeClient.charges.retrieve(payment.stripe_charge_id);
          receiptUrl = ch.receipt_url || null;
        }
      }
    } catch (recErr: any) {
      console.error('[payments/:id/detail] receipt fetch failed:', recErr?.message);
    }

    return res.json({
      id: payment.id,
      status: payment.status,
      method: payment.method,
      provider: payment.provider,
      card_last4: null,
      card_brand: null,
      amount_cents: payment.amount_cents,
      currency: payment.currency,
      payment_date: payment.paid_at || payment.payment_date,
      receipt_url: receiptUrl,
    });
  } catch (error: any) {
    return sendSafeError(res, error, 'Unable to load payment detail.', '[payments/:id/detail]');
  }
});

router.post('/payments/payouts/email-csv', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const requestedOrgId = parseOrgId(req.body?.orgId) || auth.orgId;
    const requestedProvider = parsePayoutProvider(req.body?.provider);
    const canManage = await isOrgAdminOrOwner(auth.client, auth.user.id, requestedOrgId);
    if (!canManage) return res.status(403).json({ error: 'Only owner/admin can export payouts CSV.' });

    const { provider } = await resolvePayoutProvider({
      client: auth.client,
      orgId: requestedOrgId,
      requestedProvider,
    });

    const filters = req.body?.filters || {};
    const limit = 100;
    const method = String(filters?.method || 'all').toLowerCase();
    const dateFrom = parseDateParam(filters?.date_from);
    const dateTo = parseDateParam(filters?.date_to);

    let items: PayoutListItem[] = [];
    if (provider === 'stripe') {
      let cursor: string | null = null;
      for (let i = 0; i < 10; i += 1) {
        const page = await listStripePayouts({
          orgId: requestedOrgId,
          limit,
          cursor,
          dateFrom,
          dateTo,
          method,
        });
        items = items.concat(page.items);
        if (!page.has_more || !page.next_cursor) break;
        cursor = page.next_cursor;
      }
    } else {
      let cursor: string | null = serializeCursor({ page: 1 });
      for (let i = 0; i < 10; i += 1) {
        const page = await listPayPalPayouts({
          orgId: requestedOrgId,
          limit,
          cursor,
          dateFrom,
          dateTo,
          method,
        });
        items = items.concat(page.items);
        if (!page.has_more || !page.next_cursor) break;
        cursor = page.next_cursor;
      }
    }

    const header = ['Date', 'Type', 'Status', 'Net', 'Currency', 'Id'];
    const lines = items.map((item) =>
      [
        csvEscape(item.date),
        csvEscape(item.type),
        csvEscape(item.status),
        csvEscape((Number(item.net || 0) / 100).toFixed(2)),
        csvEscape(item.currency),
        csvEscape(item.id),
      ].join(',')
    );
    const csv = [header.join(','), ...lines].join('\n');

    // N7.7 — trace de l'export de donnees financieres.
    await logDataExport({
      orgId: requestedOrgId,
      userId: auth.user.id,
      exportType: 'payouts',
      entityType: 'payment',
      recordCount: lines.length,
      req,
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="payouts-${provider}-${new Date().toISOString().slice(0, 10)}.csv"`);
    return res.status(200).send(csv);
  } catch (error: any) {
    return sendSafeError(res, error, 'Unable to export payouts CSV.', '[payments/payouts/email-csv]');
  }
});

// ── Compatibility route ──

router.get('/payments/providers/status', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const requestedOrgId = parseOrgId(req.query.orgId) || auth.orgId;
    const settings = await getPaymentProviderSettings(auth.client, requestedOrgId);
    const baseUrl = resolvePublicBaseUrl(req);

    return res.json({
      settings,
      environment: {
        stripe_configured: settings.stripe_keys_present,
        stripe_webhook_configured: Boolean(stripeWebhookSecret),
        paypal_configured: settings.paypal_keys_present,
        paypal_webhook_configured: Boolean(paypalWebhookId),
        paypal_env: paypalEnv,
      },
      public_keys: {
        stripe_publishable_key: settings.stripe_publishable_key,
        paypal_client_id: settings.paypal_client_id,
      },
      webhook_urls: {
        stripe: `${baseUrl}/api/webhooks/stripe`,
        paypal: `${baseUrl}/api/webhooks/paypal`,
      },
    });
  } catch (error: any) {
    return sendSafeError(res, error, 'Unable to load provider status.', '[payments/providers/status]');
  }
});

router.post('/payments/providers/settings', validate(providerSettingsSchema), async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const requestedOrgId = parseOrgId(req.body?.orgId) || auth.orgId;
    const canManage = await isOrgAdminOrOwner(auth.client, auth.user.id, requestedOrgId);
    if (!canManage) return res.status(403).json({ error: 'Only owner/admin can update payment settings.' });

    await ensurePaymentSettingsRow(auth.client, requestedOrgId);
    const current = await getPaymentProviderSettings(auth.client, requestedOrgId);

    const stripeEnabled = req.body?.stripe_enabled == null ? current.stripe_enabled : Boolean(req.body.stripe_enabled);
    const paypalEnabled = req.body?.paypal_enabled == null ? current.paypal_enabled : Boolean(req.body.paypal_enabled);
    const nextDefault = normalizeDefaultProvider(req.body?.default_provider ?? current.default_provider);

    if (stripeEnabled && !current.stripe_keys_present) {
      return res.status(400).json({ error: 'Stripe keys are missing. Save keys before enabling.' });
    }
    if (paypalEnabled && !current.paypal_keys_present) {
      return res.status(400).json({ error: 'PayPal keys are missing. Save keys before enabling.' });
    }
    if (nextDefault === 'stripe' && !stripeEnabled) {
      return res.status(400).json({ error: 'Stripe must be enabled before setting default.' });
    }
    if (nextDefault === 'paypal' && !paypalEnabled) {
      return res.status(400).json({ error: 'PayPal must be enabled before setting default.' });
    }

    const { error } = await auth.client
      .from('payment_provider_settings')
      .update({
        stripe_enabled: stripeEnabled,
        paypal_enabled: paypalEnabled,
        default_provider: nextDefault,
        updated_at: new Date().toISOString(),
      })
      .eq('org_id', requestedOrgId);
    if (error) throw error;

    const updated = await getPaymentProviderSettings(auth.client, requestedOrgId);
    return res.json({ settings: updated });
  } catch (error: any) {
    return sendSafeError(res, error, 'Unable to update provider settings.', '[payments/providers/settings]');
  }
});

// ── Stripe create intent ──

router.post('/payments/stripe/create-intent', validate(stripeCreateIntentSchema), async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const { client, orgId } = auth;
    const invoiceId = String(req.body?.invoiceId || '').trim();
    if (!invoiceId) return res.status(400).json({ error: 'Missing invoiceId.' });

    const settings = await getPaymentProviderSettings(client, orgId);
    if (!settings.stripe_enabled || !settings.stripe_keys_present) {
      return res.status(400).json({ error: 'Stripe provider is disabled or not configured for this organization.' });
    }

    if (!supabaseServiceRoleKey) {
      return res.status(503).json({
        error: 'Server is missing SUPABASE_SERVICE_ROLE_KEY. Stripe payment is temporarily unavailable.',
      });
    }

    const secrets = await getPaymentProviderSecrets(orgId);
    if (!secrets.stripe_secret_key || !secrets.stripe_publishable_key) {
      return res.status(400).json({ error: 'Stripe keys are not configured.' });
    }

    const invoice = await getInvoiceForOrg(client, orgId, invoiceId);
    if (!invoice) return res.status(404).json({ error: 'Invoice not found.' });

    const balanceCents = Number(invoice.balance_cents || 0);
    if (balanceCents <= 0) return res.status(400).json({ error: 'Invoice has no balance to pay.' });

    const stripeClient = new Stripe(secrets.stripe_secret_key);
    const currency = String(invoice.currency || 'CAD').toLowerCase();
    const intent = await stripeClient.paymentIntents.create({
      amount: balanceCents,
      currency,
      payment_method_types: ['card'],
      metadata: {
        org_id: orgId,
        invoice_id: invoiceId,
        client_id: invoice.client_id || '',
      },
    });

    return res.json({
      payment_intent_id: intent.id,
      client_secret: intent.client_secret,
      amount_cents: balanceCents,
      currency: currency.toUpperCase(),
      publishable_key: secrets.stripe_publishable_key,
    });
  } catch (error: any) {
    return sendSafeError(res, error, 'Unable to create Stripe payment intent.', '[payments/stripe/create-intent]');
  }
});

// ── Stripe transactions ──

router.get('/payments/stripe/transactions', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const { client, orgId } = auth;
    const settings = await getPaymentProviderSettings(client, orgId);
    if (!settings.stripe_enabled || !settings.stripe_keys_present) {
      return res.status(400).json({ error: 'Stripe is not configured for this organization.' });
    }

    const secrets = await getPaymentProviderSecrets(orgId);
    if (!secrets.stripe_secret_key) {
      return res.status(400).json({ error: 'Stripe secret key is not configured.' });
    }

    const stripeClient = new Stripe(secrets.stripe_secret_key);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
    const startingAfter = String(req.query.starting_after || '').trim() || undefined;

    const charges = await stripeClient.charges.list({
      limit,
      starting_after: startingAfter,
    });

    const transactions = charges.data.map((ch) => ({
      id: ch.id,
      amount_cents: ch.amount,
      currency: (ch.currency || 'usd').toUpperCase(),
      status: ch.status === 'succeeded' ? 'succeeded' :
              ch.status === 'pending' ? 'pending' :
              ch.refunded ? 'refunded' : 'failed',
      customer_email: ch.billing_details?.email || ch.receipt_email || null,
      customer_name: ch.billing_details?.name || null,
      description: ch.description || null,
      payment_method: ch.payment_method_details?.type || null,
      created_at: new Date(ch.created * 1000).toISOString(),
      receipt_url: ch.receipt_url || null,
    }));

    return res.json({
      transactions,
      has_more: charges.has_more,
      total_count: transactions.length,
    });
  } catch (error: any) {
    return sendSafeError(res, error, 'Unable to fetch Stripe transactions.', '[payments/stripe/transactions]');
  }
});

// ── Stripe balance ──

router.get('/payments/stripe/balance', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const { client, orgId } = auth;
    const secrets = await getPaymentProviderSecrets(orgId);
    if (!secrets.stripe_secret_key) {
      return res.status(400).json({ error: 'Stripe secret key is not configured.' });
    }

    const stripeClient = new Stripe(secrets.stripe_secret_key);
    const balance = await stripeClient.balance.retrieve();

    return res.json({
      available: balance.available.map((b) => ({ amount: b.amount, currency: b.currency.toUpperCase() })),
      pending: balance.pending.map((b) => ({ amount: b.amount, currency: b.currency.toUpperCase() })),
    });
  } catch (error: any) {
    return sendSafeError(res, error, 'Unable to fetch Stripe balance.', '[payments/stripe/balance]');
  }
});

// ── PayPal create order ──

router.post('/payments/paypal/create-order', validate(paypalCreateOrderSchema), async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const { client, orgId } = auth;
    const invoiceId = String(req.body?.invoiceId || '').trim();
    if (!invoiceId) return res.status(400).json({ error: 'Missing invoiceId.' });

    const settings = await getPaymentProviderSettings(client, orgId);
    if (!settings.paypal_enabled || !settings.paypal_keys_present) {
      return res.status(400).json({ error: 'PayPal provider is disabled or not configured for this organization.' });
    }

    if (!supabaseServiceRoleKey) {
      return res.status(503).json({
        error: 'Server is missing SUPABASE_SERVICE_ROLE_KEY. PayPal payment is temporarily unavailable.',
      });
    }

    const secrets = await getPaymentProviderSecrets(orgId);
    if (!secrets.paypal_client_id || !secrets.paypal_secret) {
      return res.status(400).json({ error: 'PayPal keys are not configured.' });
    }

    const invoice = await getInvoiceForOrg(client, orgId, invoiceId);
    if (!invoice) return res.status(404).json({ error: 'Invoice not found.' });

    const balanceCents = Number(invoice.balance_cents || 0);
    if (balanceCents <= 0) return res.status(400).json({ error: 'Invoice has no balance to pay.' });

    const token = await getPayPalAccessToken({ clientId: secrets.paypal_client_id, secret: secrets.paypal_secret });
    const currency = String(invoice.currency || 'CAD').toUpperCase();
    const amountValue = (balanceCents / 100).toFixed(2);
    const customId = JSON.stringify({ org_id: orgId, invoice_id: invoiceId, client_id: invoice.client_id || null });

    // PayPal-Request-Id is PayPal's idempotency header — dedupes retries within 6h
    const paypalRequestId = `order-${orgId}-${invoiceId}-${Math.floor(Date.now() / 60_000)}`;
    const createResponse = await fetch(`${getPayPalBaseUrl()}/v2/checkout/orders`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'PayPal-Request-Id': paypalRequestId,
      },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [{ reference_id: invoiceId, custom_id: customId, amount: { currency_code: currency, value: amountValue } }],
      }),
    });

    if (!createResponse.ok) {
      const text = await createResponse.text();
      throw new Error(`PayPal create order failed (${createResponse.status}): ${text}`);
    }

    const order = (await createResponse.json()) as any;
    const approveUrl = Array.isArray(order.links) ? order.links.find((link: any) => link.rel === 'approve')?.href || null : null;

    return res.json({
      order_id: order.id,
      approve_url: approveUrl,
      paypal_client_id: secrets.paypal_client_id,
      amount_cents: balanceCents,
      currency,
    });
  } catch (error: any) {
    return sendSafeError(res, error, 'Unable to create PayPal order.', '[payments/paypal/create-order]');
  }
});

// ── PayPal capture order ──

router.post('/payments/paypal/capture-order', validate(paypalCaptureOrderSchema), async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const { client, orgId } = auth;
    const orderId = String(req.body?.orderId || '').trim();
    if (!orderId) return res.status(400).json({ error: 'Missing orderId.' });

    const settings = await getPaymentProviderSettings(client, orgId);
    if (!settings.paypal_enabled || !settings.paypal_keys_present) {
      return res.status(400).json({ error: 'PayPal provider is disabled or not configured for this organization.' });
    }

    if (!supabaseServiceRoleKey) {
      return res.status(503).json({
        error: 'Server is missing SUPABASE_SERVICE_ROLE_KEY. PayPal capture is temporarily unavailable.',
      });
    }

    const secrets = await getPaymentProviderSecrets(orgId);
    if (!secrets.paypal_client_id || !secrets.paypal_secret) {
      return res.status(400).json({ error: 'PayPal keys are not configured.' });
    }

    const token = await getPayPalAccessToken({ clientId: secrets.paypal_client_id, secret: secrets.paypal_secret });
    const captureResponse = await fetch(`${getPayPalBaseUrl()}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'PayPal-Request-Id': `capture-${orderId}`,
      },
      body: JSON.stringify({}),
    });

    const captureBody = (await captureResponse.json()) as any;
    if (!captureResponse.ok) {
      throw new Error(`PayPal capture failed (${captureResponse.status}): ${JSON.stringify(captureBody)}`);
    }

    const purchaseUnit = Array.isArray(captureBody?.purchase_units) ? captureBody.purchase_units[0] : null;
    const capture = purchaseUnit?.payments?.captures?.[0] || null;
    if (!capture) throw new Error('PayPal capture response missing capture details.');

    const custom = parseCustomId(purchaseUnit?.custom_id);
    if (custom.orgId && custom.orgId !== orgId) {
      return res.status(403).json({ error: 'Order does not belong to your organization.' });
    }

    const result = await createOrUpdatePayPalPaymentFromCapture({ capture, orderId, orderData: captureBody, eventId: null });
    return res.json({ ok: true, payment_id: result.id });
  } catch (error: any) {
    return sendSafeError(res, error, 'Unable to capture PayPal order.', '[payments/paypal/capture-order]');
  }
});

// ── PayPal webhook ──

router.post('/webhooks/paypal', async (req, res) => {
  try {
    if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_SECRET || !paypalWebhookId) {
      return res.status(503).json({ error: 'PayPal webhook is not configured.' });
    }

    const isVerified = await verifyPayPalWebhookSignature(req, req.body);
    if (!isVerified) return res.status(400).json({ error: 'Invalid PayPal webhook signature.' });

    const event = req.body || {};
    const eventType = String(event.event_type || '');
    const eventId = String(event.id || '').trim() || null;

    if (eventType === 'PAYMENT.CAPTURE.COMPLETED') {
      const capture = event.resource || {};
      const orderId = String(capture?.supplementary_data?.related_ids?.order_id || '').trim() || null;
      await createOrUpdatePayPalPaymentFromCapture({ capture, eventId, orderId });
    }

    return res.json({ received: true });
  } catch (error: any) {
    return sendSafeError(res, error, 'PayPal webhook handling failed.', '[payments/webhooks/paypal]');
  }
});

// ── Refund a payment (Stripe Connect destination charge refund) ──

router.post('/payments/refund', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const { orgId } = auth;
    const canManage = await isOrgAdminOrOwner(auth.client, auth.user.id, orgId);
    if (!canManage) return res.status(403).json({ error: 'Only owner/admin can issue refunds.' });

    const parsedBody = refundSchema.safeParse(req.body);
    if (!parsedBody.success) {
      return res.status(400).json({ error: 'Invalid request body.', issues: parsedBody.error.issues.map(i => i.message) });
    }
    const { paymentId, amountCents, reason: reasonInput } = parsedBody.data;
    const refundAmountCents = amountCents ?? null; // null = full refund
    const reason = reasonInput || undefined;

    // Fetch the payment
    const admin = getServiceClient();
    const { data: payment, error: paymentError } = await admin
      .from('payments')
      .select('*')
      .eq('id', paymentId)
      .eq('org_id', orgId)
      .maybeSingle();

    if (paymentError) throw paymentError;
    if (!payment) return res.status(404).json({ error: 'Payment not found.' });

    if (payment.status === 'refunded') {
      return res.status(400).json({ error: 'Payment has already been refunded.' });
    }

    if (payment.status !== 'succeeded') {
      return res.status(400).json({ error: 'Only succeeded payments can be refunded.' });
    }

    const stripePaymentIntentId = payment.provider_payment_id;
    if (!stripePaymentIntentId || payment.provider !== 'stripe') {
      return res.status(400).json({ error: 'Only Stripe payments can be refunded through this endpoint.' });
    }

    // Use platform Stripe key for destination charge refunds
    const { getPlatformStripe } = await import('../lib/stripe-connect');
    const stripe = getPlatformStripe();

    const refundParams: any = {
      payment_intent: stripePaymentIntentId,
      reason: reason === 'duplicate' ? 'duplicate' : reason === 'fraudulent' ? 'fraudulent' : 'requested_by_customer',
    };

    if (refundAmountCents && refundAmountCents > 0 && refundAmountCents < payment.amount_cents) {
      refundParams.amount = refundAmountCents;
    }

    // For destination charges, Stripe auto-reverses the transfer
    refundParams.reverse_transfer = true;

    // Idempotency per-payment + amount dedupes accidental double refund clicks
    const refundIdemKey = `refund-${payment.id}-${refundAmountCents ?? 'full'}`;
    const refund = await stripe.refunds.create(refundParams, { idempotencyKey: refundIdemKey });

    // Update payment record
    const isFullRefund = !refundAmountCents || refundAmountCents >= payment.amount_cents;
    const { error: updateError } = await admin
      .from('payments')
      .update({
        status: isFullRefund ? 'refunded' : 'succeeded', // partial refund keeps succeeded
        failure_reason: `Refunded: ${refund.id} (${isFullRefund ? 'full' : 'partial: ' + refundAmountCents + ' cents'})`,
      })
      .eq('id', paymentId);

    if (updateError) throw updateError;

    // If full refund, atomically reverse paid_cents
    if (isFullRefund && payment.invoice_id) {
      const { error: reverseErr } = await admin.rpc('reverse_invoice_payment', {
        p_invoice_id: payment.invoice_id,
        p_org_id: orgId,
        p_amount_cents: payment.amount_cents,
      });
      if (reverseErr) {
        console.error('[payments/refund] reverse_invoice_payment failed:', reverseErr.message);
        return res.status(500).json({
          error: 'Refund issued but DB sync failed — manual reconciliation required.',
          refund_id: refund.id,
          code: 'DB_SYNC_FAILED',
        });
      }
      // Apply commission reversal policy
      handleInvoiceReversal(admin, orgId, payment.invoice_id, `Refund: ${refund.id}`)
        .catch((err) => console.error('[commissions] reversal failed:', err?.message));
    }

    // Update associated payment_request status if full refund
    if (isFullRefund && payment.payment_request_id) {
      const { error: payReqCancelErr } = await admin
        .from('payment_requests')
        .update({ status: 'cancelled' })
        .eq('id', payment.payment_request_id);
      if (payReqCancelErr) {
        console.error('[payments/refund] payment_request cancel failed:', payReqCancelErr.message);
        return res.status(500).json({
          error: 'Refund issued but DB sync failed — manual reconciliation required.',
          refund_id: refund.id,
          code: 'DB_SYNC_FAILED',
        });
      }
    }

    return res.json({
      ok: true,
      refund_id: refund.id,
      refund_amount: refund.amount,
      refund_status: refund.status,
      full_refund: isFullRefund,
    });
  } catch (error: any) {
    return sendSafeError(res, error, 'Failed to process refund.', '[payments/refund]');
  }
});

// ── Billing checkout.session.completed handler ──────────────────────────────
// This is the ONLY place where billing subscriptions are activated after payment.
// It creates the user account, org, subscription, and sends the receipt email.

async function handleCheckoutSessionCompleted(
  session: Stripe.Checkout.Session,
  meta: Record<string, string>,
) {
  const admin = getServiceClient();
  const sessionId = session.id;

  // ── 1. Idempotency: check if this session was already processed ──
  const { data: existing } = await admin
    .from('processed_checkout_sessions')
    .select('id')
    .eq('stripe_checkout_session_id', sessionId)
    .maybeSingle();

  if (existing) {
    console.log(`[webhook/checkout] Session ${sessionId} already processed, skipping`);
    return;
  }

  // Email/name come from session metadata (app-driven checkout) OR from what
  // Stripe collected at payment (reusable Payment Links, where the email/name
  // aren't known when the link is created).
  const userEmail = meta.email || session.customer_details?.email || '';
  const fullName = meta.full_name || session.customer_details?.name || '';
  const companyName = meta.company_name || '';
  const planId = meta.plan_id || '';
  const planSlug = meta.plan_slug || '';
  const interval = (meta.interval || 'monthly') as 'monthly' | 'yearly';
  const currency = (meta.currency || 'CAD').toUpperCase();
  const promoCode = meta.promo_code || null;
  // Referral code arrives either from the app-driven checkout (set automatically)
  // or typed by hand into a Stripe Payment Link's metadata after a demo. Accept a
  // few spellings and normalize, since the hand-entered path is typo-prone.
  const rawReferral = meta.referral_code || meta.referralCode || meta.ref || '';
  const referralCode = rawReferral.trim().toUpperCase() || null;

  if (!userEmail || !planId) {
    console.error('[webhook/checkout] Missing email or plan_id in session metadata');
    return;
  }

  // ── 2. Get the plan ──
  const { data: plan } = await admin.from('plans').select('*').eq('id', planId).maybeSingle();
  if (!plan) {
    console.error(`[webhook/checkout] Plan ${planId} not found`);
    return;
  }

  // ── 3. Create or find user account ──
  let userId: string;
  const existingUser: any = await findUserByEmail(admin, userEmail);
  // New account = payment-link buyer: created WITHOUT a password (they set it on
  // the success page). Existing = came through in-app onboarding (already has a
  // password + a live session).
  const isNewUser = !existingUser;

  if (existingUser) {
    userId = existingUser.id;
    // Confirm email + mark the account as already having a password, so the
    // post-payment setup page never re-prompts an onboarding buyer.
    await (admin.auth.admin as any).updateUserById(userId, {
      email_confirm: true,
      user_metadata: { ...(existingUser.user_metadata || {}), password_set: true },
    });
  } else {
    // Create new user with confirmed email (they paid, so we trust the email).
    // No password yet — password_set stays unset until they claim the account.
    const { data: newUser, error: createErr } = await admin.auth.admin.createUser({
      email: userEmail,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
    if (createErr) {
      console.error('[webhook/checkout] Failed to create user:', createErr.message);
      return;
    }
    userId = newUser.user.id;
  }

  // ── 4. Create or find org + membership ──
  let orgId: string;
  const { data: existingMem } = await admin
    .from('memberships')
    .select('org_id')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle();

  if (existingMem) {
    orgId = existingMem.org_id;
  } else {
    const { data: newOrg } = await admin
      .from('orgs')
      .insert({ name: companyName || userEmail.split('@')[0], created_by: userId })
      .select('id')
      .single();
    if (!newOrg) {
      console.error('[webhook/checkout] Failed to create org');
      return;
    }
    orgId = newOrg.id;
    // status:'active' is REQUIRED — CompanyContext only surfaces active memberships,
    // so omitting it left payment-link buyers with "Aucune compagnie".
    const { error: memErr } = await admin.from('memberships').insert({ user_id: userId, org_id: orgId, role: 'owner', status: 'active', full_name: fullName || null });
    if (memErr) throw new Error('[webhook/checkout] Failed to create owner membership: ' + memErr.message);
  }

  // ── 5. Cancel any existing active subscriptions for this org ──
  const now = new Date();
  const { error: cancelPrevErr } = await admin
    .from('subscriptions')
    .update({ status: 'canceled', canceled_at: now.toISOString() })
    .eq('org_id', orgId)
    .eq('status', 'active');
  if (cancelPrevErr) throw new Error('[webhook/checkout] cancel previous active subscription failed: ' + cancelPrevErr.message);

  // ── 6. Create subscription ──
  const periodEnd = new Date(now);
  if (interval === 'yearly') periodEnd.setFullYear(periodEnd.getFullYear() + 1);
  else periodEnd.setMonth(periodEnd.getMonth() + 1);

  const amountCents = session.amount_total || 0;
  const stripeSubId = typeof session.subscription === 'string' ? session.subscription : (session.subscription as any)?.id || null;
  const stripeCustomerId = typeof session.customer === 'string' ? session.customer : (session.customer as any)?.id || null;

  const { data: subscription, error: subError } = await admin
    .from('subscriptions')
    .insert({
      org_id: orgId,
      user_id: userId,
      plan_id: plan.id,
      status: 'active',
      interval,
      currency,
      amount_cents: amountCents,
      promo_code: promoCode,
      referral_code: referralCode,
      current_period_start: now.toISOString(),
      current_period_end: periodEnd.toISOString(),
      stripe_checkout_session_id: sessionId,
      stripe_payment_intent_id: typeof session.payment_intent === 'string' ? session.payment_intent : null,
      stripe_subscription_id: stripeSubId,
      stripe_customer_id: stripeCustomerId,
      payment_confirmed_at: now.toISOString(),
    })
    .select('*')
    .single();

  if (subError) {
    console.error('[webhook/checkout] Failed to create subscription:', subError.message);
    return;
  }

  // ── 7. Update billing profile + propagate billing address to company_settings ──
  // Stripe populates customer_details.address when checkout collects billing info.
  // We copy it into company_settings (l'adresse de l'org y vit — `orgs` n'a aucune
  // colonne d'adresse) so the Twilio auto-provisioning step below picks the right
  // area code (Montréal → 514, NYC → 212, etc.) from the address the customer paid with.
  const stripeAddr = session.customer_details?.address || null;
  const billingCountry = (stripeAddr?.country || '').toUpperCase() || null;
  const billingCity = stripeAddr?.city || null;
  const billingRegion = stripeAddr?.state || null;
  const billingPostal = stripeAddr?.postal_code || null;
  const billingStreet = [stripeAddr?.line1, stripeAddr?.line2].filter(Boolean).join(', ') || null;

  try {
    await admin.from('billing_profiles').upsert({
      org_id: orgId,
      billing_email: userEmail,
      company_name: companyName,
      full_name: fullName,
      stripe_customer_id: typeof session.customer === 'string' ? session.customer : null,
      currency,
      address: billingStreet,
      city: billingCity,
      region: billingRegion,
      country: billingCountry,
      postal_code: billingPostal,
    }, { onConflict: 'org_id' });
  } catch (err) { console.error('[webhook/checkout] billing_profiles upsert failed:', err); }

  // Propagate address only if the org's fields are empty — never overwrite what the user
  // set during onboarding. Lecture ET écriture sur company_settings (colonne `province`,
  // pas `region` ; rue = `street1`). Upsert : la ligne peut ne pas encore exister.
  if (billingCountry || billingCity || billingPostal) {
    try {
      const { data: currentSettings } = await admin
        .from('company_settings')
        .select('country, city, province, postal_code, street1')
        .eq('org_id', orgId)
        .maybeSingle();

      const patch: Record<string, any> = {};
      if (!currentSettings?.country && billingCountry) patch.country = billingCountry;
      if (!currentSettings?.city && billingCity) patch.city = billingCity;
      if (!currentSettings?.province && billingRegion) patch.province = billingRegion;
      if (!currentSettings?.postal_code && billingPostal) patch.postal_code = billingPostal;
      if (!currentSettings?.street1 && billingStreet) patch.street1 = billingStreet;

      if (Object.keys(patch).length > 0) {
        await admin
          .from('company_settings')
          .upsert({ org_id: orgId, ...patch }, { onConflict: 'org_id' });
      }
    } catch (err) { console.error('[webhook/checkout] propagate billing address to company_settings failed:', err); }
  }

  // ── 8. Mark onboarding done ──
  try {
    await admin.from('profiles').update({ onboarding_done: true }).eq('id', userId);
  } catch (err) { console.error('[webhook/checkout] mark onboarding_done failed:', err); }

  // ── 9. Record processed session (idempotency) ──
  // NE JAMAIS throw ici : à ce stade l'org, la membership, l'abonnement, le
  // numéro Twilio et le crédit de parrainage existent déjà. Un throw renverrait
  // un non-2xx à Stripe, qui rejouerait l'événement — et la garde d'idempotence
  // en tête de fonction lit précisément cette table : elle ne verrait rien et
  // tout serait refait (2e abonnement, 2e numéro payant, 2e crédit).
  // On réessaie, puis on crie très fort sans faire échouer le webhook.
  const dedupRow = {
    stripe_checkout_session_id: sessionId,
    org_id: orgId,
    user_id: userId,
    subscription_id: subscription.id,
    status: 'processed',
  };
  let { error: dedupErr } = await admin.from('processed_checkout_sessions').insert(dedupRow);
  if (dedupErr && dedupErr.code !== '23505') {
    ({ error: dedupErr } = await admin.from('processed_checkout_sessions').insert(dedupRow));
  }
  if (dedupErr) {
    // Unique constraint = already processed concurrently — safe to ignore
    if (dedupErr.code === '23505') return;
    console.error(
      '[webhook/checkout] CRITIQUE — session traitée mais NON marquée. ' +
        'L\'acheteur restera bloqué sur la création de mot de passe et un rejeu ' +
        'Stripe dupliquerait le provisioning. Réconciliation manuelle requise. ' +
        `session=${sessionId} org=${orgId} user=${userId} sub=${subscription.id}`,
      dedupErr.message,
    );
  }

  // ── 9b. Referral reward: the referrer earns a free month ──
  // Runs AFTER the idempotency record so a replayed webhook returns early above
  // and can never double-credit. awardReferrerReward is itself idempotent per
  // (code, referred org) and rejects self-referral. Never blocks activation.
  if (referralCode) {
    try {
      const { awardReferrerReward } = await import('../lib/referral-rewards');
      const result = await awardReferrerReward({
        admin,
        stripe: stripeWebhookClient,
        referralCode,
        referredOrgId: orgId,
        referredUserId: userId,
        referredEmail: userEmail,
        now,
      });
      if (!result.awarded) {
        console.log(`[webhook/checkout] Referral ${referralCode} not rewarded: ${result.reason}`);
      }
    } catch (err: any) {
      console.error('[webhook/checkout] Referral reward error (non-blocking):', err?.message);
    }
  }

  // ── 10. Auto-provision Twilio SMS number (non-blocking) ──
  // Only for plans that include SMS (pro / enterprise). Starter is skipped.
  if (plan.includes_sms) {
    try {
      await provisionSmsForNewSubscription({ orgId, subscriptionId: subscription.id });
    } catch (provErr: any) {
      // Never fail the subscription on provisioning error — it's logged + retryable.
      console.error('[webhook/checkout] SMS provisioning error (non-blocking):', provErr?.message);
    }
  }

  // ── 11. Send receipt email (async, never blocks) ──
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  try {
    const { sendPaymentReceipt } = await import('../lib/billing-email');
    await sendPaymentReceipt({
      orgId,
      subscriptionId: subscription.id,
      recipientEmail: userEmail,
      companyName: companyName || 'Your company',
      planName: plan.name,
      interval,
      amountCents,
      currency,
      taxes: null,
      stripePaymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : null,
      stripeCheckoutSessionId: sessionId,
      paymentDate: now,
      dashboardUrl: frontendUrl,
      billingUrl: `${frontendUrl}/settings/billing`,
    });
  } catch (emailErr: any) {
    // Receipt email failure must NEVER fail the subscription activation
    console.error('[webhook/checkout] Receipt email error (non-blocking):', emailErr.message);
  }

  // ── 12. Welcome email for payment-link buyers (no password yet) ──
  // Gives them a durable link back to the setup page if they closed the tab.
  if (isNewUser) {
    try {
      const { sendEmail } = await import('../lib/mailer');
      const setupUrl = `${frontendUrl}/checkout/success?session_id=${encodeURIComponent(sessionId)}`;
      await sendEmail({
        to: userEmail,
        subject: 'Bienvenue chez Lume — configure ton compte',
        html: `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;color:#111114">
  <h1 style="font-size:22px;font-weight:800;letter-spacing:-.02em;margin:0 0 8px">Paiement confirmé 🎉</h1>
  <p style="font-size:14px;color:#555;line-height:1.6;margin:0 0 22px">Ton abonnement <strong>${plan.name}</strong> est actif. Il te reste une étape&nbsp;: créer ton mot de passe et remplir les infos de ton entreprise pour commencer à travailler.</p>
  <a href="${setupUrl}" style="display:inline-block;background:#111114;color:#fff;text-decoration:none;font-weight:700;font-size:15px;padding:14px 26px;border-radius:12px">Configurer mon compte →</a>
  <p style="font-size:12px;color:#999;line-height:1.6;margin:24px 0 0">Si le bouton ne fonctionne pas, copie ce lien&nbsp;:<br><span style="color:#555">${setupUrl}</span></p>
</div>`,
      });
    } catch (welcomeErr: any) {
      console.error('[webhook/checkout] Welcome email error (non-blocking):', welcomeErr.message);
    }
  }

  console.log(`[webhook/checkout] Subscription activated for ${userEmail} — plan: ${plan.name}, org: ${orgId}`);
}

// ─── Auto-provision Twilio SMS number after a paid subscription ────────────
// Idempotent: skips if an active SMS channel already exists for the org.
// Logs outcome to provisioning_events for observability + retry tooling.

async function provisionSmsForNewSubscription(params: {
  orgId: string;
  subscriptionId: string;
}): Promise<void> {
  const { orgId, subscriptionId } = params;
  const admin = getServiceClient();

  // If the org still has a number pending release (re-subscribed during the
  // grace period), reactivate it rather than buying a second one.
  try {
    const { cancelSmsNumberRelease } = await import('../lib/twilioRelease');
    if (await cancelSmsNumberRelease(orgId)) {
      console.log(`[provisioning] Org ${orgId} re-subscribed — restored its existing number`);
      return;
    }
  } catch (err: any) {
    console.error('[provisioning] Failed to check pending release:', err?.message);
  }

  // Skip if an active SMS channel is already attached to this org
  const { data: existingChannel } = await admin
    .from('communication_channels')
    .select('id, phone_number')
    .eq('org_id', orgId)
    .eq('channel_type', 'sms')
    .eq('status', 'active')
    .maybeSingle();

  if (existingChannel) {
    console.log(`[provisioning] Org ${orgId} already has SMS channel ${existingChannel.phone_number}, skipping`);
    return;
  }

  // Log intent so we can observe + retry failures
  const { data: eventRow } = await admin
    .from('provisioning_events')
    .insert({
      org_id: orgId,
      subscription_id: subscriptionId,
      event_type: 'sms_number_purchase',
      status: 'pending',
    })
    .select('id')
    .single();

  try {
    const { provisionSmsNumber } = await import('../lib/twilioProvisioning');
    const result = await provisionSmsNumber(orgId);

    if (eventRow) {
      await admin
        .from('provisioning_events')
        .update({
          status: 'success',
          twilio_number: result.phoneNumber,
        })
        .eq('id', eventRow.id);
    }
    console.log(`[provisioning] SMS number ${result.phoneNumber} assigned to org ${orgId}`);
  } catch (err: any) {
    if (eventRow) {
      await admin
        .from('provisioning_events')
        .update({
          status: 'failed',
          error_message: String(err?.message || err).slice(0, 500),
        })
        .eq('id', eventRow.id);
    }
    throw err;
  }
}

// ── Carte au dossier (payment on file) ────────────────────────────────────

// Retrait de la carte au dossier d'un client — droit de retrait (Loi 25) :
// détache le payment method chez Stripe puis soft-delete le profil local.
router.post('/payments/card-on-file/remove', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const requestedOrgId = parseOrgId(req.body?.orgId) || auth.orgId;
    const clientId = String(req.body?.clientId || '').trim();
    if (!clientId) return res.status(400).json({ error: 'Missing clientId.' });

    const member = await isOrgMember(auth.client, auth.user.id, requestedOrgId);
    if (!member) return res.status(403).json({ error: 'Forbidden for this organization.' });

    const admin = getServiceClient();
    const { data: profile } = await admin
      .from('client_payment_profiles')
      .select('id, payment_method_id')
      .eq('org_id', requestedOrgId)
      .eq('client_id', clientId)
      .is('deleted_at', null)
      .maybeSingle();
    if (!profile) return res.status(404).json({ error: 'No card on file for this client.' });

    if (profile.payment_method_id) {
      try {
        await getPlatformStripe().paymentMethods.detach(profile.payment_method_id);
      } catch (err: any) {
        // Déjà détachée / introuvable : le retrait local reste valable.
        console.error('[card-on-file] detach failed:', err?.message);
      }
    }

    const { error } = await admin
      .from('client_payment_profiles')
      .update({
        payment_method_id: null,
        card_brand: null,
        card_last4: null,
        card_exp_month: null,
        card_exp_year: null,
        deleted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', profile.id);
    if (error) throw error;

    return res.json({ ok: true });
  } catch (error: any) {
    return sendSafeError(res, error, 'Unable to remove the card on file.', '[card-on-file/remove]');
  }
});

// Charger la carte au dossier pour une facture (owner/admin). Le webhook
// payment_intent.succeeded applique ensuite le paiement comme un paiement
// public normal.
router.post('/payments/card-on-file/charge', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const requestedOrgId = parseOrgId(req.body?.orgId) || auth.orgId;
    const invoiceId = String(req.body?.invoiceId || '').trim();
    if (!invoiceId) return res.status(400).json({ error: 'Missing invoiceId.' });

    const member = await isOrgMember(auth.client, auth.user.id, requestedOrgId);
    if (!member) return res.status(403).json({ error: 'Forbidden for this organization.' });
    const canManage = await isOrgAdminOrOwner(auth.client, auth.user.id, requestedOrgId);
    if (!canManage) return res.status(403).json({ error: 'Only owner/admin can charge a card on file.' });

    const result = await chargeInvoiceOnFile({ orgId: requestedOrgId, invoiceId });
    return res.status(result.ok ? 200 : 402).json(result);
  } catch (error: any) {
    return sendSafeError(res, error, 'Unable to charge the card on file.', '[card-on-file/charge]');
  }
});

export default router;
