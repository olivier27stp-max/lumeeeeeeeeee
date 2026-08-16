import { supabase } from './supabase';
import type { Job } from '../types';
import type { JobLineItem } from './jobsApi';
import type { TaxLine } from './jobCalc';
import type { JobAgreement } from './jobAgreementsApi';
import { getTaxRegistrationLines } from './jobAgreementsApi';
import type { AgreementDocData } from '../components/agreements/AgreementDocument';

export interface AgreementCompanyBranding {
  company_name: string;
  logo_url: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  address: string | null;
  taxLines: string[];
}

/** Company branding of the CURRENT org (org-scoped — RLS can expose several orgs). */
export async function getAgreementCompanyBranding(): Promise<AgreementCompanyBranding> {
  const { getCurrentOrgIdOrThrow } = await import('./orgApi');
  const orgId = await getCurrentOrgIdOrThrow();
  const [{ data }, taxLines] = await Promise.all([
    supabase
      .from('company_settings')
      .select('company_name, logo_url, phone, email, website, street1, city, province, postal_code')
      .eq('org_id', orgId)
      .limit(1)
      .maybeSingle(),
    getTaxRegistrationLines(),
  ]);
  const address = data
    ? [data.street1, data.city, data.province, data.postal_code].filter(Boolean).join(', ') || null
    : null;
  return {
    company_name: data?.company_name || 'Business',
    logo_url: data?.logo_url || null,
    phone: data?.phone || null,
    email: data?.email || null,
    website: data?.website || null,
    address,
    taxLines,
  };
}

/**
 * Compose the render-ready document from the live job (same money logic as
 * the JobDetails financial card). Once the agreement is signed, the frozen
 * snapshot takes precedence so the signed document never drifts.
 */
export function buildAgreementDocData(params: {
  agreement: JobAgreement;
  job: Job;
  lineItems: JobLineItem[];
  company: AgreementCompanyBranding;
  clientName: string | null;
  clientEmail: string | null;
  clientPhone: string | null;
  /** 12-month calendar of service-plan jobs — shown on the contract when present. */
  serviceContract?: { year: number; visits: Array<{ month: number; date: string; year?: number }> } | null;
}): AgreementDocData {
  const { agreement, job, lineItems, company, clientName, clientEmail, clientPhone, serviceContract } = params;

  let items: AgreementDocData['items'];
  let subtotalCents: number;
  let discount: AgreementDocData['discount'] = null;
  let taxLines: AgreementDocData['taxLines'];
  let totalCents: number;
  let propertyAddress: string | null;
  let docClientName = clientName;
  let servicePlan: AgreementDocData['servicePlan'] = null;
  let paymentTerms: AgreementDocData['paymentTerms'] = null;

  if (agreement.snapshot) {
    const snap = agreement.snapshot;
    items = snap.items || [];
    subtotalCents = snap.subtotal_cents || 0;
    discount = snap.discount_cents
      ? { amount_cents: snap.discount_cents, percent: snap.discount_percent ?? null }
      : null;
    taxLines = snap.tax_lines || [];
    totalCents = snap.total_cents || 0;
    propertyAddress = snap.property_address ?? (job.property_address || null);
    docClientName = snap.client_name ?? clientName;
    servicePlan = snap.service_plan ?? null;
    paymentTerms = snap.payment_terms ?? null;
  } else {
    items = lineItems
      .filter((it) => it.included)
      .map((it) => ({ name: it.name, qty: it.qty, unit_price_cents: it.unit_price_cents, total_cents: it.total_cents }));
    const computedSubtotal = items.reduce((sum, it) => sum + it.total_cents, 0);
    // N1.4 — subtotal_cents (entier) fait foi ; repli sur la somme des lignes.
    subtotalCents = Number(job.subtotal_cents) > 0
      ? Number(job.subtotal_cents)
      : computedSubtotal;
    const enabled = (Array.isArray(job.tax_lines) ? (job.tax_lines as TaxLine[]) : []).filter((tx) => tx.enabled && tx.rate > 0);
    taxLines = enabled.map((tx) => ({
      label: tx.label,
      rate: tx.rate,
      amount_cents: Math.round(subtotalCents * (tx.rate / 100)),
    }));
    totalCents = subtotalCents + taxLines.reduce((sum, tx) => sum + tx.amount_cents, 0);
    propertyAddress = job.property_address || null;
    servicePlan = serviceContract && serviceContract.visits.length > 0
      ? { year: serviceContract.year, visits: serviceContract.visits }
      : null;
    // Payment terms from the live job — the deposit amount is recomputed from
    // the composed total so it always matches the amounts printed above it.
    const depositRequired = job.deposit_required === true;
    const depositType = depositRequired && (job.deposit_type === 'percentage' || job.deposit_type === 'fixed')
      ? job.deposit_type
      : null;
    const depositValue = depositRequired ? Number(job.deposit_value || 0) : 0;
    const depositCents = !depositRequired
      ? 0
      : depositType === 'percentage'
        ? Math.round(totalCents * (depositValue / 100))
        : Math.round(depositValue * 100);
    const requirePaymentMethod = job.require_payment_method === true;
    paymentTerms = (depositRequired || requirePaymentMethod)
      ? {
          deposit_required: depositRequired,
          deposit_type: depositType,
          deposit_value: depositValue,
          deposit_cents: depositCents,
          require_payment_method: requirePaymentMethod,
        }
      : null;
  }

  return {
    agreementNumber: `CTR-${job.job_number || agreement.id.slice(0, 6)}`,
    createdAt: agreement.created_at,
    requireSignature: agreement.require_signature,
    terms: agreement.terms,
    logoUrl: agreement.logo_url || company.logo_url,
    company: {
      name: company.company_name,
      address: company.address,
      phone: company.phone,
      email: company.email,
      website: company.website,
      taxLines: company.taxLines,
    },
    clientName: docClientName,
    clientEmail,
    clientPhone,
    propertyAddress,
    items,
    subtotalCents,
    discount,
    taxLines,
    totalCents,
    servicePlan,
    paymentTerms,
    signature: agreement.signature_data && agreement.signer_name
      ? { signerName: agreement.signer_name, signatureData: agreement.signature_data, signedAt: agreement.signed_at }
      : null,
  };
}
