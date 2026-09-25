import { Router } from 'express';
import { getServiceClient } from '../lib/supabase';
import { sendSafeError } from '../lib/error-handler';
import {
  getPaymentRequestByToken,
  getConnectedAccount,
  createDestinationPaymentIntent,
  calculateApplicationFee,
  updatePaymentRequestStatus,
  getOrCreatePlatformCustomerForClient,
} from '../lib/stripe-connect';
import { getPlatformStripe } from '../lib/stripe-connect';
import { getCompanyBranding } from '../lib/companyBranding';
import { lireLiensSociaux } from '../lib/socialLinks';
import { getPaymentSettings, plafonnerPourboire } from '../lib/payment-settings';
import { validate, publicTipSchema } from '../lib/validation';

const router = Router();

// Réglage « paiement des factures en ligne » coupé par l'entreprise : la page
// l'apprend au chargement (statut 'disabled'), et toute création ou mise à
// jour de PaymentIntent est refusée ici, pas seulement masquée.
const ERREUR_PAIEMENTS_DESACTIVES = 'Online payments are currently disabled for this business.';

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
    const [orgSettings, reglages] = await Promise.all([
      getCompanyBranding(
        admin,
        paymentRequest.org_id,
        'company_name, logo_url, email, phone, brand_color, social_links, default_language',
      ),
      getPaymentSettings(paymentRequest.org_id),
    ]);

    const business = {
      name: orgSettings?.company_name || null,
      logo_url: orgSettings?.logo_url || null,
      brand_color: orgSettings?.brand_color || null,
      email: orgSettings?.email || null,
      phone: orgSettings?.phone || null,
      social_links: lireLiensSociaux(orgSettings?.social_links),
      // La page de paiement parle la langue de l'entreprise, pas celle du navigateur du client.
      language: orgSettings?.default_language === 'en' ? 'en' : 'fr',
    };

    if (!reglages.invoice_payments_enabled) {
      return res.json({
        status: 'disabled',
        message: ERREUR_PAIEMENTS_DESACTIVES,
        amount_cents: Number(invoice.balance_cents || 0),
        currency: paymentRequest.currency,
        business,
      });
    }

    // Use the actual current balance, not the original request amount
    const currentBalance = Number(invoice.balance_cents || 0);

    return res.json({
      status: paymentRequest.status,
      options: {
        tips_enabled: reglages.tips_enabled,
        wallets_enabled: reglages.wallets_enabled,
      },
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
      business,
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

    // Interrupteur « paiement des factures en ligne » de l'entreprise.
    const reglages = await getPaymentSettings(paymentRequest.org_id);
    if (!reglages.invoice_payments_enabled) {
      return res.status(403).json({ error: ERREUR_PAIEMENTS_DESACTIVES });
    }

    // Get connected account for destination charge
    const connectedAccount = await getConnectedAccount(paymentRequest.org_id);
    if (!connectedAccount || !connectedAccount.charges_enabled) {
      return res.status(503).json({ error: 'This business is not yet ready to accept payments.' });
    }

    // Atomic lock: mark this payment request as "processing" to prevent concurrent PI creation.
    // If another request is already processing, this update will match 0 rows.
    // Le lien naît en « pending » puis passe en « sent » dès l'envoi
    // (payment-requests/create) : le verrou doit accepter les DEUX. Avec
    // « pending » seul, chaque première tentative répondait 409 « déjà en
    // traitement » — aucun paiement par lien n'avait jamais abouti en prod
    // (trouvé le 2026-09-17 en payant une facture test).
    const admin = getServiceClient();
    const statutAvant = paymentRequest.status;
    const { data: lockResult, error: lockErr } = await admin
      .from('payment_requests')
      .update({ status: 'processing' })
      .eq('id', paymentRequest.id)
      .in('status', ['pending', 'sent'])
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
      await admin.from('payment_requests').update({ status: statutAvant }).eq('id', paymentRequest.id);
      return res.status(403).json({ error: 'Payment request mismatch.' });
    }

    const amountCents = Number(invoice.balance_cents);
    const currency = String(invoice.currency || paymentRequest.currency || 'CAD');

    // Create destination charge PaymentIntent
    let result: Awaited<ReturnType<typeof createDestinationPaymentIntent>>;
    try {
      result = await createDestinationPaymentIntent({
        amountCents,
        currency,
        connectedAccountId: connectedAccount.stripe_account_id,
        metadata: {
          org_id: paymentRequest.org_id,
          invoice_id: paymentRequest.invoice_id,
          payment_request_id: paymentRequest.id,
          client_id: invoice.client_id || '',
          public_token: publicToken,
          tip_cents: '0',
        },
      });
    } catch (e) {
      // Stripe a refusé : on rend le lien à son état d'avant, sinon il reste « processing » sans intent → 409 pour toujours.
      await admin.from('payment_requests').update({ status: statutAvant }).eq('id', paymentRequest.id);
      throw e;
    }

    // Store PI id on the payment request (et retour au statut d'avant le verrou)
    await updatePaymentRequestStatus(paymentRequest.id, statutAvant as any, {
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

// ── POST /pay/:publicToken/save-card — opt-in « sauvegarder ma carte » (NO AUTH) ──
// Loi 25 : le customer Stripe n'est créé et le PaymentIntent n'est marqué
// setup_future_usage=off_session QUE lorsque le payeur coche explicitement
// l'option sur la page publique. Décocher retire l'intention de sauvegarde.
router.post('/pay/:publicToken/save-card', async (req, res) => {
  try {
    const publicToken = String(req.params.publicToken || '').trim();
    if (!publicToken || !/^[a-f0-9]{48}$/.test(publicToken)) {
      return res.status(400).json({ error: 'Invalid payment link.' });
    }
    const save = Boolean(req.body?.save);

    const paymentRequest = await getPaymentRequestByToken(publicToken);
    if (!paymentRequest || !paymentRequest.stripe_payment_intent_id) {
      return res.status(404).json({ error: 'Payment not found.' });
    }
    if (paymentRequest.status === 'paid') {
      return res.status(400).json({ error: 'This invoice has already been paid.' });
    }

    const admin = getServiceClient();
    const { data: invoice } = await admin
      .from('invoices')
      .select('id, client_id, org_id')
      .eq('id', paymentRequest.invoice_id)
      .maybeSingle();
    if (!invoice || invoice.org_id !== paymentRequest.org_id || !invoice.client_id) {
      return res.status(400).json({ error: 'This invoice cannot save a card on file.' });
    }

    const stripe = getPlatformStripe();
    const intent = await stripe.paymentIntents.retrieve(paymentRequest.stripe_payment_intent_id);
    if (!['requires_payment_method', 'requires_confirmation', 'requires_action'].includes(intent.status)) {
      return res.status(400).json({ error: 'Payment can no longer be updated.' });
    }

    if (save) {
      const customerId = await getOrCreatePlatformCustomerForClient(paymentRequest.org_id, invoice.client_id);
      await stripe.paymentIntents.update(intent.id, {
        customer: customerId,
        setup_future_usage: 'off_session',
        metadata: {
          ...intent.metadata,
          save_card: '1',
          // Horodatage du consentement (Loi 25) — repris par le webhook.
          save_card_consented_at: new Date().toISOString(),
        },
      });
    } else {
      await stripe.paymentIntents.update(intent.id, {
        setup_future_usage: '',
        metadata: { ...intent.metadata, save_card: '', save_card_consented_at: '' },
      } as any);
    }

    return res.json({ ok: true, save });
  } catch (error: any) {
    return sendSafeError(res, error, 'Failed to update card saving.', '[public-pay/save-card]');
  }
});

// ── POST /pay/:publicToken/tip — pourboire choisi par le payeur (NO AUTH) ──
// Le montant du PaymentIntent devient solde + pourboire ; la facture ne reçoit
// que le solde (le webhook lit metadata.tip_cents pour séparer les deux).
// Tout est recalculé ici à partir du solde en base : le client n'envoie qu'un
// entier borné (0 ≤ tip ≤ min(solde, 1 000 $)), jamais un total.
router.post('/pay/:publicToken/tip', validate(publicTipSchema), async (req, res) => {
  try {
    const publicToken = String(req.params.publicToken || '').trim();
    if (!publicToken || !/^[a-f0-9]{48}$/.test(publicToken)) {
      return res.status(400).json({ error: 'Invalid payment link.' });
    }

    const paymentRequest = await getPaymentRequestByToken(publicToken);
    if (!paymentRequest || !paymentRequest.stripe_payment_intent_id) {
      return res.status(404).json({ error: 'Payment not found.' });
    }
    if (paymentRequest.status === 'paid') {
      return res.status(400).json({ error: 'This invoice has already been paid.' });
    }

    const reglages = await getPaymentSettings(paymentRequest.org_id);
    if (!reglages.invoice_payments_enabled) {
      return res.status(403).json({ error: ERREUR_PAIEMENTS_DESACTIVES });
    }
    if (!reglages.tips_enabled) {
      return res.status(400).json({ error: 'Tips are not enabled for this business.' });
    }

    const admin = getServiceClient();
    const { data: invoice } = await admin
      .from('invoices')
      .select('id, org_id, balance_cents')
      .eq('id', paymentRequest.invoice_id)
      .maybeSingle();
    if (!invoice || invoice.org_id !== paymentRequest.org_id) {
      return res.status(403).json({ error: 'Payment request mismatch.' });
    }
    const soldeCents = Number(invoice.balance_cents || 0);
    if (soldeCents <= 0) return res.status(400).json({ error: 'Invoice has no remaining balance.' });

    const tipCents = plafonnerPourboire(req.body.tip_cents, soldeCents);
    if (tipCents === null) return res.status(400).json({ error: 'Invalid tip amount.' });

    const stripe = getPlatformStripe();
    const intent = await stripe.paymentIntents.retrieve(paymentRequest.stripe_payment_intent_id);
    if (!['requires_payment_method', 'requires_confirmation', 'requires_action'].includes(intent.status)) {
      return res.status(400).json({ error: 'Payment can no longer be updated.' });
    }

    const totalCents = soldeCents + tipCents;
    await stripe.paymentIntents.update(intent.id, {
      amount: totalCents,
      application_fee_amount: calculateApplicationFee(totalCents),
      metadata: { ...intent.metadata, tip_cents: String(tipCents) },
    });

    return res.json({ ok: true, tip_cents: tipCents, amount_cents: totalCents });
  } catch (error: any) {
    return sendSafeError(res, error, 'Failed to update tip.', '[public-pay/tip]');
  }
});

export default router;
