import { Router } from 'express';
import { getServiceClient } from '../lib/supabase';
import { sendSafeError } from '../lib/error-handler';
import {
  getPaymentRequestByToken,
  getConnectedAccount,
  createDestinationPaymentIntent,
  updatePaymentRequestStatus,
} from '../lib/stripe-connect';
import { getPlatformStripe } from '../lib/stripe-connect';

const router = Router();

// ── GET /pay/:publicToken — Fetch payment page data (NO AUTH) ──

router.get('/pay/:publicToken', async (req, res) => {
  try {
    const publicToken = String(req.params.publicToken || '').trim();
    if (!publicToken || !/^[a-f0-9]{48}$/.test(publicToken)) {
      return res.status(400).json({ error: 'Invalid payment link.' });
    }

    const paymentRequest = await getPaymentRequestByToken(publicToken);
    if (!paymentRequest) {
      return res.status(404).json({ error: 'Payment link not found or has expired.' });
    }

    // Check expiration
    if (paymentRequest.expires_at && new Date(paymentRequest.expires_at) < new Date()) {
      await updatePaymentRequestStatus(paymentRequest.id, 'expired');
      return res.status(410).json({ error: 'This payment link has expired.' });
    }

    // Check if already paid
    if (paymentRequest.status === 'paid') {
      return res.json({
        status: 'paid',
        message: 'This invoice has already been paid.',
        amount_cents: paymentRequest.amount_cents,
        currency: paymentRequest.currency,
      });
    }

    if (paymentRequest.status === 'cancelled' || paymentRequest.status === 'expired') {
      return res.status(410).json({ error: 'This payment link is no longer valid.' });
    }

    // Fetch invoice details for display
    const admin = getServiceClient();
    const { data: invoice } = await admin
      .from('invoices')
      .select('id, invoice_number, subject, total_cents, balance_cents, currency, client_id, org_id, status')
      .eq('id', paymentRequest.invoice_id)
      .maybeSingle();

    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found.' });
    }

    // Cross-org safety: verify the invoice belongs to the same org as the payment request
    if (invoice.org_id !== paymentRequest.org_id) {
      return res.status(403).json({ error: 'Payment request mismatch.' });
    }

    // Double-check: if invoice is fully paid, mark request as paid
    if (Number(invoice.balance_cents || 0) <= 0 || invoice.status === 'paid') {
      await updatePaymentRequestStatus(paymentRequest.id, 'paid');
      return res.json({
        status: 'paid',
        message: 'This invoice has already been paid.',
        amount_cents: paymentRequest.amount_cents,
        currency: paymentRequest.currency,
      });
    }

    // Fetch client info
    const { data: client } = await admin
      .from('clients')
      .select('id, first_name, last_name, email')
      .eq('id', invoice.client_id)
      .maybeSingle();

    // Fetch invoice items
    const { data: items } = await admin
      .from('invoice_items')
      .select('id, description, qty, unit_price_cents, line_total_cents')
      .eq('invoice_id', invoice.id)
      .order('created_at', { ascending: true });

    // Fetch company settings for branding (single source of truth)
    const { data: orgSettings } = await admin
      .from('company_settings')
      .select('company_name, logo_url, email, phone')
      .eq('org_id', paymentRequest.org_id)
      .maybeSingle();

    // Use the actual current balance, not the original request amount
    const currentBalance = Number(invoice.balance_cents || 0);

    return res.json({
      status: paymentRequest.status,
      payment_request_id: paymentRequest.id,
      public_token: publicToken,
      amount_cents: currentBalance,
      currency: paymentRequest.currency,
      invoice: {
        invoice_number: invoice.invoice_number,
        subject: invoice.subject,
        total_cents: invoice.total_cents,
        balance_cents: currentBalance,
      },
      items: items || [],
      client: client ? {
        name: [client.first_name, client.last_name].filter(Boolean).join(' '),
        email: client.email,
      } : null,
      business: {
        name: orgSettings?.company_name || null,
        logo_url: orgSettings?.logo_url || null,
        email: orgSettings?.email || null,
        phone: orgSettings?.phone || null,
      },
    });
  } catch (error: any) {
    return sendSafeError(res, error, 'Failed to load payment page.', '[public-pay/get]');
  }
});

// ── POST /pay/:publicToken/create-payment-intent — Create Stripe PI (NO AUTH) ──

router.post('/pay/:publicToken/create-payment-intent', async (req, res) => {
  try {
    const publicToken = String(req.params.publicToken || '').trim();
    if (!publicToken || !/^[a-f0-9]{48}$/.test(publicToken)) {
      return res.status(400).json({ error: 'Invalid payment link.' });
    }

    const paymentRequest = await getPaymentRequestByToken(publicToken);
    if (!paymentRequest) {
      return res.status(404).json({ error: 'Payment link not found or has expired.' });
    }

    if (paymentRequest.status === 'paid') {
      return res.status(400).json({ error: 'This invoice has already been paid.' });
    }

    if (paymentRequest.status === 'cancelled' || paymentRequest.status === 'expired') {
      return res.status(410).json({ error: 'This payment link is no longer valid.' });
    }

    // Check expiration
    if (paymentRequest.expires_at && new Date(paymentRequest.expires_at) < new Date()) {
      await updatePaymentRequestStatus(paymentRequest.id, 'expired');
      return res.status(410).json({ error: 'This payment link has expired.' });
    }

    // If we already have a PI, return the existing client_secret
    if (paymentRequest.stripe_payment_intent_id) {
      const stripe = getPlatformStripe();
      const existingIntent = await stripe.paymentIntents.retrieve(paymentRequest.stripe_payment_intent_id);

      // If the intent is still active, reuse it
      if (['requires_payment_method', 'requires_confirmation', 'requires_action'].includes(existingIntent.status)) {
        return res.json({
          client_secret: existingIntent.client_secret,
          payment_intent_id: existingIntent.id,
          amount_cents: existingIntent.amount,
          currency: existingIntent.currency.toUpperCase(),
          publishable_key: process.env.STRIPE_PUBLISHABLE_KEY || '',
        });
      }
    }

    // Get connected account for destination charge
    const connectedAccount = await getConnectedAccount(paymentRequest.org_id);
    if (!connectedAccount || !connectedAccount.charges_enabled) {
      return res.status(503).json({ error: 'This business is not yet ready to accept payments.' });
    }

    // Atomic lock: mark this payment request as "processing" to prevent concurrent PI creation.
    // If another request is already processing, this update will match 0 rows.
    const admin = getServiceClient();
    const { data: lockResult, error: lockErr } = await admin
      .from('payment_requests')
      .update({ status: 'processing' })
      .eq('id', paymentRequest.id)
      .eq('status', 'pending')
      .is('stripe_payment_intent_id', null)
      .select('id')
      .maybeSingle();

    if (lockErr || !lockResult) {
      // Another request is already creating a PI, or status changed — retry will get existing PI
      return res.status(409).json({ error: 'Payment is already being processed. Please wait and retry.' });
    }

    // Verify invoice balance server-side (NEVER trust client)
    const { data: invoice } = await admin
      .from('invoices')
      .select('id, balance_cents, currency, client_id, org_id')
      .eq('id', paymentRequest.invoice_id)
      .maybeSingle();

    if (!invoice || Number(invoice.balance_cents || 0) <= 0) {
      await updatePaymentRequestStatus(paymentRequest.id, 'paid');
      return res.status(400).json({ error: 'Invoice has no remaining balance.' });
    }

    // Cross-org safety: verify invoice belongs to the same org
    if (invoice.org_id !== paymentRequest.org_id) {
      // Revert lock
      await admin.from('payment_requests').update({ status: 'pending' }).eq('id', paymentRequest.id);
      return res.status(403).json({ error: 'Payment request mismatch.' });
    }

    const amountCents = Number(invoice.balance_cents);
    const currency = String(invoice.currency || paymentRequest.currency || 'CAD');

    // Create destination charge PaymentIntent
    const result = await createDestinationPaymentIntent({
      amountCents,
      currency,
      connectedAccountId: connectedAccount.stripe_account_id,
      metadata: {
        org_id: paymentRequest.org_id,
        invoice_id: paymentRequest.invoice_id,
        payment_request_id: paymentRequest.id,
        client_id: invoice.client_id || '',
        public_token: publicToken,
      },
    });

    // Store PI id on the payment request
    await updatePaymentRequestStatus(paymentRequest.id, paymentRequest.status as any, {
      stripe_payment_intent_id: result.paymentIntentId,
    });

    return res.json({
      client_secret: result.clientSecret,
      payment_intent_id: result.paymentIntentId,
      amount_cents: amountCents,
      currency: currency.toUpperCase(),
      publishable_key: process.env.STRIPE_PUBLISHABLE_KEY || '',
    });
  } catch (error: any) {
    return sendSafeError(res, error, 'Failed to create payment intent.', '[public-pay/create-pi]');
  }
});

export default router;
