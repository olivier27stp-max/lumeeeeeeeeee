import { supabase } from './supabase';
import { getCurrentOrgIdOrThrow } from './orgApi';
import { AGREEMENT_BLOCKED_BY_QUOTE_MESSAGE } from './approvedDocument';

/**
 * A job agreement is the written contract attached to a job: company
 * branding + the job's services/prices/taxes + customizable terms, with an
 * optional required client signature captured on the public
 * /contract/:view_token page. Composed live from the job until signed, then
 * frozen server-side into `snapshot`. See migration
 * `20260721000000_job_agreements.sql`.
 *
 * Agreements attach to JOBS ONLY. A job converted from a quote keeps the
 * signed quote as its approved contract and can never receive an agreement
 * (enforced here, in the UI and by the DB trigger of
 * `20260733000000_agreements_job_only.sql`).
 */

export type AgreementStatus = 'draft' | 'sent' | 'signed';

export interface AgreementSnapshotItem {
  name: string;
  qty: number;
  unit_price_cents: number;
  total_cents: number;
}

export interface AgreementSnapshotTaxLine {
  label: string;
  rate: number;
  amount_cents: number;
}

export interface AgreementSnapshot {
  items: AgreementSnapshotItem[];
  subtotal_cents: number;
  /** Quote discount (absent/0 for jobs) — frozen so the signed document's lines keep adding up. */
  discount_cents?: number;
  discount_percent?: number | null;
  tax_lines: AgreementSnapshotTaxLine[];
  total_cents: number;
  client_name?: string | null;
  property_address?: string | null;
  /** 12-month calendar of service-plan jobs — frozen with the rest of the document. */
  service_plan?: { year: number; visits: Array<{ month: number; date: string; year?: number }> } | null;
}

export interface JobAgreement {
  id: string;
  org_id: string;
  /** Null only on legacy quote-linked rows kept as read-only history. */
  job_id: string | null;
  client_id: string | null;
  require_signature: boolean;
  terms: string;
  logo_url: string | null;
  status: AgreementStatus;
  view_token: string;
  sent_at: string | null;
  signer_name: string | null;
  signature_data: string | null;
  signed_at: string | null;
  snapshot: AgreementSnapshot | null;
  created_at: string;
  updated_at: string;
}

/** Default T&C prefilled in the job form — editable per agreement. */
export const DEFAULT_AGREEMENT_TERMS: Record<'en' | 'fr', string> = {
  fr: `1. Accès à la propriété : Le client n'a pas besoin d'être présent. En confirmant le rendez-vous, il autorise l'accès à la propriété. Les accès doivent être dégagés et les animaux sécurisés.
2. Garantie (7 jours) : Une garantie de 7 jours est offerte sur la qualité du travail. Toute correction sera effectuée sans frais si signalée dans ce délai.
3. État des surfaces : L'entreprise n'est pas responsable des dommages liés à des surfaces déjà endommagées ou à l'usure normale.
4. Annulation : Toute annulation doit être faite au moins 24 heures à l'avance.
5. Responsabilité : Le client doit informer l'entreprise de toute condition particulière ou surface fragile avant le début des travaux.`,
  en: `1. Property access: The client does not need to be present. By confirming the appointment, they authorize access to the property. Access must be clear and pets secured.
2. Warranty (7 days): A 7-day warranty covers the quality of the work. Any correction reported within this period is done free of charge.
3. Surface condition: The company is not responsible for damage related to already-damaged surfaces or normal wear.
4. Cancellation: Any cancellation must be made at least 24 hours in advance.
5. Liability: The client must inform the company of any special condition or fragile surface before work begins.`,
};

function isMissingTableError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  // 42P01 = undefined_table; PGRST205 = table not found in PostgREST schema cache
  return error.code === '42P01' || error.code === 'PGRST205' || /job_agreements/.test(error.message || '');
}

function mapAgreement(raw: any): JobAgreement {
  return {
    id: raw.id,
    org_id: raw.org_id,
    job_id: raw.job_id ?? null,
    client_id: raw.client_id ?? null,
    require_signature: raw.require_signature !== false,
    terms: raw.terms || '',
    logo_url: raw.logo_url ?? null,
    status: (raw.status || 'draft') as AgreementStatus,
    view_token: raw.view_token,
    sent_at: raw.sent_at ?? null,
    signer_name: raw.signer_name ?? null,
    signature_data: raw.signature_data ?? null,
    signed_at: raw.signed_at ?? null,
    snapshot: raw.snapshot ?? null,
    created_at: raw.created_at,
    updated_at: raw.updated_at,
  };
}

/**
 * Best-effort creation: if the migration hasn't been applied yet the insert
 * silently no-ops (returns null) so job creation never breaks.
 *
 * Refused when the job already has an associated quote — the quote is the
 * approved contract (also enforced by the DB trigger for direct API calls).
 */
export async function createJobAgreement(payload: {
  job_id: string;
  client_id?: string | null;
  require_signature: boolean;
  terms: string;
  logo_url?: string | null;
}, language: 'en' | 'fr' = 'en'): Promise<JobAgreement | null> {
  if (!payload.job_id) throw new Error('Agreement needs a job.');
  const orgId = await getCurrentOrgIdOrThrow();

  const { data: linkedQuote } = await supabase
    .from('quotes')
    .select('id')
    .eq('job_id', payload.job_id)
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle();
  if (linkedQuote) throw new Error(AGREEMENT_BLOCKED_BY_QUOTE_MESSAGE[language]);

  const { data, error } = await supabase
    .from('job_agreements')
    .insert({
      org_id: orgId,
      job_id: payload.job_id,
      client_id: payload.client_id || null,
      require_signature: payload.require_signature,
      terms: payload.terms,
      logo_url: payload.logo_url || null,
      status: 'draft',
    })
    .select('*')
    .single();
  if (error) {
    if (isMissingTableError(error)) {
      console.warn('[job-agreements] table missing (migration pending) — agreement skipped');
      return null;
    }
    throw error;
  }
  return mapAgreement(data);
}

/** Latest agreement for a job, or null (also null if migration pending). */
export async function getJobAgreementByJob(jobId: string): Promise<JobAgreement | null> {
  if (!jobId) return null;
  const { data, error } = await supabase
    .from('job_agreements')
    .select('*')
    .eq('job_id', jobId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    if (isMissingTableError(error)) return null;
    throw error;
  }
  return data ? mapAgreement(data) : null;
}

export async function updateJobAgreement(
  id: string,
  patch: Partial<Pick<JobAgreement, 'require_signature' | 'terms' | 'logo_url'>>,
): Promise<JobAgreement | null> {
  const { data, error } = await supabase
    .from('job_agreements')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();
  if (error) {
    if (isMissingTableError(error)) return null;
    throw error;
  }
  return mapAgreement(data);
}

/** Email the agreement (public link) to the job's client via the server. */
export async function sendAgreementEmail(agreementId: string): Promise<void> {
  const { data: session } = await supabase.auth.getSession();
  const token = session.session?.access_token;
  if (!token) throw new Error('Not authenticated.');

  const res = await fetch('/api/emails/send-agreement', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ agreementId }),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload?.error || 'Failed to send agreement email.');
}

/** Text the agreement (public link) to the job's client by SMS via the server. */
export async function sendAgreementSms(agreementId: string): Promise<void> {
  const { data: session } = await supabase.auth.getSession();
  const token = session.session?.access_token;
  if (!token) throw new Error('Not authenticated.');

  const res = await fetch('/api/agreements/send-sms', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ agreementId }),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload?.error || 'Failed to send agreement SMS.');
}

/** Tax registration numbers (e.g. TPS/TVQ) shown in the contract header. */
export async function getTaxRegistrationLines(): Promise<string[]> {
  try {
    const { data } = await supabase
      .from('tax_configs')
      .select('name, registration_number')
      .eq('is_active', true)
      .not('registration_number', 'is', null);
    return (data || [])
      .filter((t: any) => t.registration_number)
      .map((t: any) => `${t.name} No: ${t.registration_number}`);
  } catch {
    return [];
  }
}
