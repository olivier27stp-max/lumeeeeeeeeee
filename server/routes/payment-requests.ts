import { Router } from 'express';
import { sendSafeError } from '../lib/error-handler';
import { requireAuthedClient, isOrgMember, getServiceClient } from '../lib/supabase';
import { parseOrgId, resolvePublicBaseUrl } from '../lib/helpers';
import { emailFrom, twilioClient, getTwilioStatusCallbackUrl } from '../lib/config';
import { getOrgSmsFromNumber, SmsNumberNotProvisionedError, SmsNotInPlanError } from '../lib/twilioProvisioning';
import { sendEmail, isMailerConfigured } from '../lib/mailer';
import { isSmsOptedOut } from '../lib/notificationHelpers';
import { getInvoiceForOrg } from '../lib/payments';
import {
  getConnectedAccount,
  createPaymentRequest,
  getPaymentRequestsByInvoice,
  updatePaymentRequestStatus,
} from '../lib/stripe-connect';
import { validate, createPaymentRequestSchema } from '../lib/validation';
import { getPaymentSettings } from '../lib/payment-settings';
import { getCompanySettings, senderFor, marqueDepuis, langueEntreprise, type CompanyInfo as CompanyInfoCourriel } from './emails';
import { rendreCourrielClient, montant as montantLisible, MOTS, type Langue } from '../lib/courriels/gabarit';

const router = Router();

const ERREUR_PAIEMENTS_DESACTIVES =
  'Online invoice payments are disabled in Lume Payments settings. Enable them to send a payment link.';

// ── Helpers ──

function formatCurrency(cents: number, currency = 'CAD') {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency }).format(cents / 100);
}

interface CompanyInfo {
  company_name?: string | null;
  company_logo_url?: string | null;
  email?: string | null;
  phone?: string | null;
}

async function getCompanyInfo(orgId: string): Promise<CompanyInfo> {
  try {
    const admin = getServiceClient();
    const { data } = await admin
      .from('company_settings')
      .select('company_name, logo_url, email, phone')
      .eq('org_id', orgId)
      .maybeSingle();
    if (data) return { company_name: data.company_name, company_logo_url: data.logo_url, email: data.email, phone: data.phone };

    // Fallback to org_billing_settings — cette table ne porte ni logo ni
    // téléphone, et son courriel s'appelle `email_from`.
    const { data: billing } = await admin
      .from('org_billing_settings')
      .select('company_name, email_from')
      .eq('org_id', orgId)
      .maybeSingle();
    if (!billing) return {};
    return { company_name: billing.company_name, email: billing.email_from };
  } catch {
    return {};
  }
}

async function getClientContact(clientId: string | null, orgId: string) {
  if (!clientId) return null;
  try {
    const admin = getServiceClient();
    const { data } = await admin
      .from('clients')
      .select('id, first_name, last_name, email, phone')
      .eq('id', clientId)
      .eq('org_id', orgId)
      .maybeSingle();
    return data;
  } catch {
    return null;
  }
}

/** Le courriel « paiement demandé » : gabarit commun, aux couleurs de l'entreprise, dans sa langue. */
function buildPaymentEmailHtml(params: { company: CompanyInfoCourriel; clientName: string; invoiceNumber: string; amountFormatted: string; paymentUrl: string; langue: Langue }) {
  const m = MOTS[params.langue];
  const fr = params.langue === 'fr';
  return rendreCourrielClient({
    langue: params.langue,
    marque: marqueDepuis(params.company),
    preheader: fr ? `${params.amountFormatted} à payer — facture ${params.invoiceNumber}` : `${params.amountFormatted} due — invoice ${params.invoiceNumber}`,
    titre: fr ? 'Paiement demandé' : 'Payment requested',
    salutation: m.bonjour(params.clientName),
    intro: fr ? `Un paiement de ${params.amountFormatted} est demandé pour la facture ${params.invoiceNumber}. Vous pouvez payer en ligne, par carte, en moins d’une minute.` : `A payment of ${params.amountFormatted} is requested for invoice ${params.invoiceNumber}. You can pay online by card in under a minute.`,
    montant: { libelle: m.montantDu, valeur: params.amountFormatted, sous: `${m.facture} ${params.invoiceNumber}` },
    bouton: { texte: m.payer(params.amountFormatted), url: params.paymentUrl },
    note: fr ? 'Paiement sécurisé par Stripe. Une question ? Répondez simplement à ce courriel.' : 'Payment secured by Stripe. Questions? Just reply to this email.',
  });
}

function normalizeE164(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('1') && digits.length === 11) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (phone.startsWith('+')) return phone;
  return `+${digits}`;
}

// ── Send email notification ──

async function sendPaymentEmail(params: {
  clientEmail: string;
  clientName: string;
  invoiceNumber: string;
  amountCents: number;
  currency: string;
  paymentUrl: string;
  orgId: string;
  invoiceId?: string | null;
}) {
  if (!isMailerConfigured()) return { sent: false, reason: 'SMTP not configured' };

  const company = await getCompanySettings(params.orgId);
  const langue = langueEntreprise(company);
  const amountFormatted = montantLisible(params.amountCents, params.currency, langue);

  const result = await sendEmail({
    // Expéditeur au nom de l'entreprise, réponses vers sa boîte (comme la facture).
    ...senderFor(company),
    to: params.clientEmail,
    subject: langue === 'fr' ? `Paiement demandé — ${amountFormatted} — facture ${params.invoiceNumber}` : `Payment requested — ${amountFormatted} — invoice ${params.invoiceNumber}`,
    suivi: { orgId: params.orgId, entityType: 'payment_request', entityId: params.invoiceId ?? null },
    html: buildPaymentEmailHtml({
      company,
      clientName: params.clientName,
      invoiceNumber: params.invoiceNumber,
      amountFormatted,
      paymentUrl: params.paymentUrl,
      langue,
    }),
  });

  if (!result.sent) return { sent: false, reason: result.error || 'Send failed' };
  return { sent: true, emailId: result.messageId || null };
}

// ── Send SMS notification ──

async function sendPaymentSms(params: {
  clientPhone: string;
  clientName: string;
  invoiceNumber: string;
  amountCents: number;
  currency: string;
  paymentUrl: string;
  orgId: string;
}) {
  if (!twilioClient) return { sent: false, reason: 'Twilio not configured' };

  // Conformité CASL : ne pas relancer par SMS un client qui a répondu STOP.
  const optOutPhone = normalizeE164(params.clientPhone);
  if (await isSmsOptedOut(getServiceClient(), params.orgId, optOutPhone)) {
    return { sent: false, reason: 'Recipient has opted out of SMS (STOP)' };
  }

  let fromNumber: string;
  try {
    fromNumber = await getOrgSmsFromNumber(params.orgId);
  } catch (e) {
    if (e instanceof SmsNumberNotProvisionedError) {
      return { sent: false, reason: 'Organization has no SMS number provisioned' };
    }
    if (e instanceof SmsNotInPlanError) {
      return { sent: false, reason: 'Plan does not include SMS' };
    }
    throw e;
  }

  const company = await getCompanyInfo(params.orgId);
  const companyName = company.company_name || 'LUME';
  const amountFormatted = formatCurrency(params.amountCents, params.currency);

  const body = `${companyName}: Payment of ${amountFormatted} requested for invoice ${params.invoiceNumber}. Pay securely here: ${params.paymentUrl}`;

  try {
    const statusCallback = getTwilioStatusCallbackUrl();
    const msg = await twilioClient.messages.create({
      body,
      from: fromNumber,
      to: normalizeE164(params.clientPhone),
      // Accusé de réception Twilio (sinon le statut reste figé à « envoyé »).
      ...(statusCallback ? { statusCallback } : {}),
    });
    return { sent: true, sid: msg.sid };
  } catch (err: any) {
    return { sent: false, reason: err?.message || 'SMS failed' };
  }
}

// ── Create payment request from invoice ──

router.post('/payment-requests/create', validate(createPaymentRequestSchema), async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const orgId = parseOrgId(req.body?.orgId) || auth.orgId;
    const member = await isOrgMember(auth.client, auth.user.id, orgId);
    if (!member) return res.status(403).json({ error: 'Forbidden for this organization.' });

    const invoiceId = String(req.body?.invoiceId || '').trim();
    if (!invoiceId) return res.status(400).json({ error: 'Missing invoiceId.' });

    // sendVia: 'email' | 'sms' | 'both' | 'link_only' (default)
    const sendVia = String(req.body?.sendVia || 'link_only').toLowerCase();

    // Verify invoice exists and belongs to org
    const invoice = await getInvoiceForOrg(auth.client, orgId, invoiceId);
    if (!invoice) return res.status(404).json({ error: 'Invoice not found.' });

    const balanceCents = Number(invoice.balance_cents || 0);
    if (balanceCents <= 0) return res.status(400).json({ error: 'Invoice has no balance to pay.' });

    // Interrupteur « paiement des factures en ligne » (réglages Lume Payments).
    const reglages = await getPaymentSettings(orgId);
    if (!reglages.invoice_payments_enabled) {
      return res.status(400).json({ error: ERREUR_PAIEMENTS_DESACTIVES, code: 'payments_disabled' });
    }

    // Verify connected account exists and is ready
    const account = await getConnectedAccount(orgId);
    if (!account || !account.charges_enabled) {
      return res.status(400).json({
        error: 'Payment account is not ready. Complete onboarding in Payment Settings first.',
      });
    }

    const currency = String(invoice.currency || 'CAD').toUpperCase();
    const paymentRequest = await createPaymentRequest({
      orgId,
      invoiceId,
      amountCents: balanceCents,
      currency,
    });

    // Build the public payment URL
    const baseUrl = resolvePublicBaseUrl(req);
    const paymentUrl = `${baseUrl}/pay/${paymentRequest.public_token}`;

    // Update the payment request with the URL
    await updatePaymentRequestStatus(paymentRequest.id, 'sent', { payment_url: paymentUrl });

    // ── Send notifications ──
    const notifications: { email?: any; sms?: any } = {};
    const client = await getClientContact(invoice.client_id, orgId);
    const clientName = client ? [client.first_name, client.last_name].filter(Boolean).join(' ') || 'Client' : 'Client';

    if ((sendVia === 'email' || sendVia === 'both') && client?.email) {
      notifications.email = await sendPaymentEmail({
        clientEmail: client.email,
        clientName,
        invoiceNumber: invoice.invoice_number || invoiceId,
        amountCents: balanceCents,
        currency,
        paymentUrl,
        orgId,
        invoiceId,
      });
    }

    if ((sendVia === 'sms' || sendVia === 'both') && client?.phone) {
      notifications.sms = await sendPaymentSms({
        clientPhone: client.phone,
        clientName,
        invoiceNumber: invoice.invoice_number || invoiceId,
        amountCents: balanceCents,
        currency,
        paymentUrl,
        orgId,
      });
    }

    return res.json({
      payment_request: {
        ...paymentRequest,
        status: 'sent',
        payment_url: paymentUrl,
      },
      notifications,
    });
  } catch (error: any) {
    return sendSafeError(res, error, 'Failed to create payment request.', '[payment-requests/create]');
  }
});

// ── Resend payment request (re-sends notification) ──

router.post('/payment-requests/resend', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const orgId = parseOrgId(req.body?.orgId) || auth.orgId;
    const member = await isOrgMember(auth.client, auth.user.id, orgId);
    if (!member) return res.status(403).json({ error: 'Forbidden for this organization.' });

    const invoiceId = String(req.body?.invoiceId || '').trim();
    if (!invoiceId) return res.status(400).json({ error: 'Missing invoiceId.' });

    const sendVia = String(req.body?.sendVia || 'link_only').toLowerCase();

    const reglages = await getPaymentSettings(orgId);
    if (!reglages.invoice_payments_enabled) {
      return res.status(400).json({ error: ERREUR_PAIEMENTS_DESACTIVES, code: 'payments_disabled' });
    }

    const requests = await getPaymentRequestsByInvoice(orgId, invoiceId);
    const active = requests.find((r: any) => r.status === 'sent' || r.status === 'pending');

    if (!active) {
      return res.status(404).json({ error: 'No active payment request found for this invoice.' });
    }

    const baseUrl = resolvePublicBaseUrl(req);
    const paymentUrl = `${baseUrl}/pay/${active.public_token}`;

    // Re-send notifications
    const notifications: { email?: any; sms?: any } = {};
    const invoice = await getInvoiceForOrg(auth.client, orgId, invoiceId);

    if (invoice) {
      const client = await getClientContact(invoice.client_id, orgId);
      const clientName = client ? [client.first_name, client.last_name].filter(Boolean).join(' ') || 'Client' : 'Client';

      if ((sendVia === 'email' || sendVia === 'both') && client?.email) {
        notifications.email = await sendPaymentEmail({
          clientEmail: client.email,
          clientName,
          invoiceNumber: invoice.invoice_number || invoiceId,
          amountCents: Number(active.amount_cents),
          currency: active.currency || 'CAD',
          paymentUrl,
          orgId,
          invoiceId,
        });
      }

      if ((sendVia === 'sms' || sendVia === 'both') && client?.phone) {
        notifications.sms = await sendPaymentSms({
          clientPhone: client.phone,
          clientName,
          invoiceNumber: invoice.invoice_number || invoiceId,
          amountCents: Number(active.amount_cents),
          currency: active.currency || 'CAD',
          paymentUrl,
          orgId,
        });
      }
    }

    return res.json({
      payment_request: { ...active, payment_url: paymentUrl },
      notifications,
    });
  } catch (error: any) {
    return sendSafeError(res, error, 'Failed to resend payment request.', '[payment-requests/resend]');
  }
});

// ── Get payment request status ──

router.get('/payment-requests/:id/status', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const orgId = parseOrgId(req.query.orgId) || auth.orgId;
    const member = await isOrgMember(auth.client, auth.user.id, orgId);
    if (!member) return res.status(403).json({ error: 'Forbidden for this organization.' });

    const invoiceId = req.params.id;
    const requests = await getPaymentRequestsByInvoice(orgId, invoiceId);

    return res.json({ payment_requests: requests });
  } catch (error: any) {
    return sendSafeError(res, error, 'Failed to fetch payment request status.', '[payment-requests/status]');
  }
});

export default router;
