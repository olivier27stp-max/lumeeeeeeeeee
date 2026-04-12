import { Router } from 'express';
import express from 'express';
import Stripe from 'stripe';
import { requireAuthedClient, isOrgMember, isOrgAdminOrOwner, getServiceClient } from '../lib/supabase';
import { parseOrgId, clampInt, resolvePublicBaseUrl } from '../lib/helpers';
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
    return res.status(500).json({ error: error?.message || 'Unable to load payment settings.' });
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
    return res.status(500).json({ error: error?.message || 'Unable to save payment keys.' });
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
        return res.status(400).json({ error: error?.message || 'Unable to save provider keys.' });
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
    return res.status(500).json({ error: error?.message || 'Unable to update payment settings.' });
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
    const status = Number(error?.status || 500);
    return res.status(status).json({ error: error?.message || 'Unable to load payout summary.' });
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
    const status = Number(error?.status || 500);
    return res.status(status).json({ error: error?.message || 'Unable to load payouts list.' });
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
    const status = Number(error?.status || 500);
    return res.status(status).json({ error: error?.message || 'Unable to load payout detail.' });
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
    const status = Number(error?.status || 500);
    return res.status(status).json({ error: error?.message || 'Unable to export payouts CSV.' });
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
    return res.status(500).json({ error: error?.message || 'Unable to load provider status.' });
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
    return res.status(500).json({ error: error?.message || 'Unable to update provider settings.' });
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
    return res.status(500).json({ error: error?.message || 'Unable to create Stripe payment intent.' });
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
    return res.status(500).json({ error: error?.message || 'Unable to fetch Stripe transactions.' });
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
    return res.status(500).json({ error: error?.message || 'Unable to fetch Stripe balance.' });
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

    const createResponse = await fetch(`${getPayPalBaseUrl()}/v2/checkout/orders`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
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
    return res.status(500).json({ error: error?.message || 'Unable to create PayPal order.' });
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
    return res.status(500).json({ error: error?.message || 'Unable to capture PayPal order.' });
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
    return res.status(500).json({ error: error?.message || 'PayPal webhook handling failed.' });
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

    const paymentId = String(req.body?.paymentId || '').trim();
    if (!paymentId) return res.status(400).json({ error: 'Missing paymentId.' });

    const refundAmountCents = req.body?.amountCents ? Math.round(Number(req.body.amountCents)) : null; // null = full refund
    const reason = String(req.body?.reason || '').trim() || undefined;

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

    const refund = await stripe.refunds.create(refundParams);

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
    return res.status(500).json({ error: error?.message || 'Failed to process refund.' });
  }
});

export default router;
