/**
 * Single source of truth for a job's contractual document.
 *
 * A job has exactly ONE active approved-document type:
 *   • the quote it was converted from (quotes.job_id = job) — the signed
 *     quote IS the contract, no agreement may exist and no second
 *     signature is ever requested; or
 *   • a written agreement (job_agreements.job_id = job) for jobs created
 *     manually without a quote; or
 *   • nothing yet (the job saves fine, but the hub shows a warning).
 *
 * Mirrors the DB trigger `trg_job_agreements_job_only`
 * (20260733000000_agreements_job_only.sql).
 */

export type ApprovedDocumentStatus =
  | 'QUOTE_SIGNED'
  | 'QUOTE_PENDING'
  | 'AGREEMENT_SIGNED'
  | 'AGREEMENT_PENDING'
  | 'MISSING';

export interface ApprovedQuoteLike {
  id: string;
  /** Client approval timestamp — set when the client signs/accepts the quote. */
  approved_at: string | null;
}

export interface ApprovedAgreementLike {
  id: string;
  status: 'draft' | 'sent' | 'signed';
}

export type ApprovedDocument =
  | { type: 'QUOTE'; status: Extract<ApprovedDocumentStatus, 'QUOTE_SIGNED' | 'QUOTE_PENDING'> }
  | { type: 'AGREEMENT'; status: Extract<ApprovedDocumentStatus, 'AGREEMENT_SIGNED' | 'AGREEMENT_PENDING'> }
  | null;

/** The quote always wins over an agreement — never both. */
export function resolveApprovedDocument(
  quote: ApprovedQuoteLike | null,
  agreement: ApprovedAgreementLike | null,
): ApprovedDocument {
  if (quote) {
    return { type: 'QUOTE', status: quote.approved_at ? 'QUOTE_SIGNED' : 'QUOTE_PENDING' };
  }
  if (agreement) {
    return {
      type: 'AGREEMENT',
      status: agreement.status === 'signed' ? 'AGREEMENT_SIGNED' : 'AGREEMENT_PENDING',
    };
  }
  return null;
}

export function approvedDocumentStatus(
  quote: ApprovedQuoteLike | null,
  agreement: ApprovedAgreementLike | null,
): ApprovedDocumentStatus {
  return resolveApprovedDocument(quote, agreement)?.status ?? 'MISSING';
}

/** A job with an associated quote can never receive an agreement. */
export function canCreateAgreementForJob(
  quote: ApprovedQuoteLike | null,
  agreement: ApprovedAgreementLike | null,
): boolean {
  return !quote && !agreement;
}

/** Same wording as the DB trigger — shown when a guard is bypassed up to the API. */
export const AGREEMENT_BLOCKED_BY_QUOTE_MESSAGE: Record<'en' | 'fr', string> = {
  en: 'This job already has an associated quote. An agreement cannot be added because the quote serves as the approved contract for this job.',
  fr: 'Cette job possède déjà une soumission associée. Il est impossible d’ajouter un contrat, puisque la soumission sert déjà de document contractuel approuvé.',
};
