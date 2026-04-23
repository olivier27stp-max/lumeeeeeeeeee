import { Router } from 'express';
import express from 'express';
import Stripe from 'stripe';
import { z } from 'zod';
import { requireAuthedClient, isOrgMember, isOrgAdminOrOwner, getServiceClient } from '../lib/supabase';
import { parseOrgId, clampInt, resolvePublicBaseUrl } from '../lib/helpers';

// Refund input validation
const refundSchema = z.object({
  paymentId: z.string().uuid('Invalid paymentId.'),
  amountCents: z.number().int().positive().max(100_000_000).optional(),
  reason: z.string().trim().max(500).optional(),
});
import { stripeWebhookSecret, stripeWebhookClient, supabaseServiceRoleKey, paypalWebhookId, paypalEnv } from '../lib/config';
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
} from '../lib/stripe-connect';
import { logSecurityEvent, extractIP } from '../lib/security';
import { sendSafeError } from '../lib/error-handler';

const router = Router();

// ── Stripe webhook handler — exported separately for mounting BEFORE express.json() ──
// Handles both direct Stripe events AND Stripe Connect events
export const stripeWebhookHandler: import('express').RequestHandler = async (req, res) => {
  try {
    if (!stripeWebhookClient || !stripeWebhookSecret) {
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
    let event: Stripe.Event;
    try {
      event = stripeWebhookClient.webhooks.constructEvent(rawBody, signature, stripeWebhookSecret);
    } catch (sigErr: any) {
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

          // Update invoice paid_cents and status
          const admin = getServiceClient();
          const amountPaid = Math.max(0, Math.round(intent.amount_received || intent.amount || 0));

          const { data: invoice } = await admin
            .from('invoices')
            .select('id, total_cents, paid_cents, balance_cents')
            .eq('id', metadata.invoiceId)
            .maybeSingle();

          if (invoice) {
            const newPaidCents = Math.min(
              Number(invoice.total_cents || 0),
              Number(invoice.paid_cents || 0) + amountPaid
            );
            const newBalanceCents = Math.max(0, Number(invoice.total_cents || 0) - newPaidCents);
            const newStatus = newBalanceCents <= 0 ? 'paid' : 'partial';

            await admin
              .from('invoices')
              .update({
                paid_cents: newPaidCents,
                balance_cents: newBalanceCents,
                status: newStatus,
                paid_at: newBalanceCents <= 0 ? new Date().toISOString() : null,
              })
              .eq('id', metadata.invoiceId);
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
          await qb;

          // Mark payment_requirement as paid
          const payReqId = String((intent.metadata as any)?.payment_requirement_id || '').trim();
          if (payReqId) {
            await admin.from('payment_requirements').update({
              status: 'paid',
              payment_id: null,
              updated_at: new Date().toISOString(),
            }).eq('id', payReqId);
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

      // ── Handle checkout.session.completed (billing subscription activation) ──
      if (event.type === 'checkout.session.completed') {
        const session = event.data.object as Stripe.Checkout.Session;
        const meta = session.metadata || {};

        // Only process sessions with our billing metadata (plan_slug present)
        if (meta.plan_slug && session.payment_status === 'paid') {
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

    // If full refund, update invoice paid_cents
    if (isFullRefund && payment.invoice_id) {
      const { data: invoice } = await admin
        .from('invoices')
        .select('id, total_cents, paid_cents')
        .eq('id', payment.invoice_id)
        .maybeSingle();

      if (invoice) {
        const newPaid = Math.max(0, Number(invoice.paid_cents || 0) - payment.amount_cents);
        const newBalance = Math.max(0, Number(invoice.total_cents || 0) - newPaid);
        await admin
          .from('invoices')
          .update({
            paid_cents: newPaid,
            balance_cents: newBalance,
            status: newPaid <= 0 ? 'sent' : 'partial',
            paid_at: null,
          })
          .eq('id', payment.invoice_id);
      }
    }

    // Update associated payment_request status if full refund
    if (isFullRefund && payment.payment_request_id) {
      await admin
        .from('payment_requests')
        .update({ status: 'cancelled' })
        .eq('id', payment.payment_request_id);
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

  const userEmail = meta.email || '';
  const fullName = meta.full_name || '';
  const companyName = meta.company_name || '';
  const planId = meta.plan_id || '';
  const planSlug = meta.plan_slug || '';
  const interval = (meta.interval || 'monthly') as 'monthly' | 'yearly';
  const currency = (meta.currency || 'CAD').toUpperCase();
  const promoCode = meta.promo_code || null;

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
  const { data: existingUsers } = await admin.auth.admin.listUsers();
  const existingUser = existingUsers?.users.find((u: any) => u.email === userEmail);

  if (existingUser) {
    userId = existingUser.id;
    // Confirm email if not already confirmed
    if (!existingUser.email_confirmed_at) {
      await (admin.auth.admin as any).updateUserById(userId, { email_confirm: true });
    }
  } else {
    // Create new user with confirmed email (they paid, so we trust the email)
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
    await admin.from('memberships').insert({ user_id: userId, org_id: orgId, role: 'owner' });
  }

  // ── 5. Cancel any existing active subscriptions for this org ──
  const now = new Date();
  try {
    await admin
      .from('subscriptions')
      .update({ status: 'canceled', canceled_at: now.toISOString() })
      .eq('org_id', orgId)
      .eq('status', 'active');
  } catch {}

  // ── 6. Create subscription ──
  const periodEnd = new Date(now);
  if (interval === 'yearly') periodEnd.setFullYear(periodEnd.getFullYear() + 1);
  else periodEnd.setMonth(periodEnd.getMonth() + 1);

  const amountCents = session.amount_total || 0;

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
      current_period_start: now.toISOString(),
      current_period_end: periodEnd.toISOString(),
      stripe_checkout_session_id: sessionId,
      stripe_payment_intent_id: typeof session.payment_intent === 'string' ? session.payment_intent : null,
      payment_confirmed_at: now.toISOString(),
    })
    .select('*')
    .single();

  if (subError) {
    console.error('[webhook/checkout] Failed to create subscription:', subError.message);
    return;
  }

  // ── 7. Update billing profile + propagate billing address to org ──
  // Stripe populates customer_details.address when checkout collects billing info.
  // We copy it into orgs so the Twilio auto-provisioning step below picks the right
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
  } catch {}

  // Propagate address to org only if org fields are empty — never overwrite what the user set during onboarding.
  if (billingCountry || billingCity || billingPostal) {
    try {
      const { data: currentOrg } = await admin
        .from('orgs')
        .select('country, city, region, postal_code, address')
        .eq('id', orgId)
        .maybeSingle();

      const patch: Record<string, any> = {};
      if (!currentOrg?.country && billingCountry) patch.country = billingCountry;
      if (!currentOrg?.city && billingCity) patch.city = billingCity;
      if (!currentOrg?.region && billingRegion) patch.region = billingRegion;
      if (!currentOrg?.postal_code && billingPostal) patch.postal_code = billingPostal;
      if (!currentOrg?.address && billingStreet) patch.address = billingStreet;

      if (Object.keys(patch).length > 0) {
        await admin.from('orgs').update(patch).eq('id', orgId);
      }
    } catch {}
  }

  // ── 8. Mark onboarding done ──
  try {
    await admin.from('profiles').update({ onboarding_done: true }).eq('id', userId);
  } catch {}

  // ── 9. Record processed session (idempotency) ──
  try {
    await admin.from('processed_checkout_sessions').insert({
      stripe_checkout_session_id: sessionId,
      org_id: orgId,
      user_id: userId,
      subscription_id: subscription.id,
      status: 'processed',
    });
  } catch (dedupErr: any) {
    // Unique constraint = already processed concurrently — safe to ignore
    if (dedupErr?.code === '23505') return;
    console.error('[webhook/checkout] Failed to record processed session:', dedupErr.message);
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

export default router;
