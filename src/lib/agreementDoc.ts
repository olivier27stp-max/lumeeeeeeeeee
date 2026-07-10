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
}): AgreementDocData {
  const { agreement, job, lineItems, company, clientName, clientEmail, clientPhone } = params;

  let items: AgreementDocData['items'];
  let subtotalCents: number;
  let taxLines: AgreementDocData['taxLines'];
  let totalCents: number;
  let propertyAddress: string | null;
  let docClientName = clientName;

  if (agreement.snapshot) {
    const snap = agreement.snapshot;
    items = snap.items || [];
    subtotalCents = snap.subtotal_cents || 0;
    taxLines = snap.tax_lines || [];
    totalCents = snap.total_cents || 0;
    propertyAddress = snap.property_address ?? (job.property_address || null);
    docClientName = snap.client_name ?? clientName;
  } else {
    items = lineItems
      .filter((it) => it.included)
      .map((it) => ({ name: it.name, qty: it.qty, unit_price_cents: it.unit_price_cents, total_cents: it.total_cents }));
    const computedSubtotal = items.reduce((sum, it) => sum + it.total_cents, 0);
    subtotalCents = job.subtotal ? Math.round(job.subtotal * 100) : computedSubtotal;
    const enabled = (Array.isArray(job.tax_lines) ? (job.tax_lines as TaxLine[]) : []).filter((tx) => tx.enabled && tx.rate > 0);
    taxLines = enabled.map((tx) => ({
      label: tx.label,
      rate: tx.rate,
      amount_cents: Math.round(subtotalCents * (tx.rate / 100)),
    }));
    totalCents = subtotalCents + taxLines.reduce((sum, tx) => sum + tx.amount_cents, 0);
    propertyAddress = job.property_address || null;
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
    taxLines,
    totalCents,
    signature: agreement.signature_data && agreement.signer_name
      ? { signerName: agreement.signer_name, signatureData: agreement.signature_data, signedAt: agreement.signed_at }
      : null,
  };
}
