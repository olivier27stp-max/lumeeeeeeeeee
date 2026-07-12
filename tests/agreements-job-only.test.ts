/**
 * Agreements are job-only — the signed quote is itself the approved contract.
 *
 * Business rules under test (see 20260733000000_agreements_job_only.sql):
 *  - a quote can never carry an agreement (creation paths removed);
 *  - a job converted from a quote keeps the quote as its approved document,
 *    never receives an agreement and never asks for a second signature;
 *  - a job created without a quote may carry one agreement;
 *  - a job with neither saves fine but reports MISSING (hub warning);
 *  - the quote always wins over an agreement — never both.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  resolveApprovedDocument,
  approvedDocumentStatus,
  canCreateAgreementForJob,
  AGREEMENT_BLOCKED_BY_QUOTE_MESSAGE,
} from '../src/lib/approvedDocument';

const signedQuote = { id: 'q1', approved_at: '2026-07-12T10:00:00Z' };
const pendingQuote = { id: 'q2', approved_at: null };
const signedAgreement = { id: 'a1', status: 'signed' as const };
const draftAgreement = { id: 'a2', status: 'draft' as const };
const sentAgreement = { id: 'a3', status: 'sent' as const };

describe('resolveApprovedDocument — single contractual source per job', () => {
  it('job converted from a signed quote → the quote is the approved document', () => {
    const doc = resolveApprovedDocument(signedQuote, null);
    expect(doc).toEqual({ type: 'QUOTE', status: 'QUOTE_SIGNED' });
  });

  it('job converted from a quote without client approval → quote still the document, pending', () => {
    const doc = resolveApprovedDocument(pendingQuote, null);
    expect(doc).toEqual({ type: 'QUOTE', status: 'QUOTE_PENDING' });
  });

  it('job without a quote but with a signed agreement → agreement signed', () => {
    const doc = resolveApprovedDocument(null, signedAgreement);
    expect(doc).toEqual({ type: 'AGREEMENT', status: 'AGREEMENT_SIGNED' });
  });

  it('job without a quote with a pending agreement → agreement pending', () => {
    expect(resolveApprovedDocument(null, draftAgreement)?.status).toBe('AGREEMENT_PENDING');
    expect(resolveApprovedDocument(null, sentAgreement)?.status).toBe('AGREEMENT_PENDING');
  });

  it('job without quote and without agreement → no document (job still valid)', () => {
    expect(resolveApprovedDocument(null, null)).toBeNull();
    expect(approvedDocumentStatus(null, null)).toBe('MISSING');
  });

  it('never both: when a legacy job carries a quote AND an agreement, the quote wins', () => {
    const doc = resolveApprovedDocument(signedQuote, signedAgreement);
    expect(doc?.type).toBe('QUOTE');
    // The client is never asked for a second signature: the shown document is
    // the already-signed quote, not a signable agreement.
    expect(doc?.status).toBe('QUOTE_SIGNED');
  });
});

describe('canCreateAgreementForJob — creation guard', () => {
  it('refuses when the job already has an associated quote (even unsigned)', () => {
    expect(canCreateAgreementForJob(signedQuote, null)).toBe(false);
    expect(canCreateAgreementForJob(pendingQuote, null)).toBe(false);
  });

  it('refuses a second agreement', () => {
    expect(canCreateAgreementForJob(null, draftAgreement)).toBe(false);
  });

  it('allows an agreement on a job created without a quote', () => {
    expect(canCreateAgreementForJob(null, null)).toBe(true);
  });

  it('exposes the exact refusal wording in both languages', () => {
    expect(AGREEMENT_BLOCKED_BY_QUOTE_MESSAGE.en).toBe(
      'This job already has an associated quote. An agreement cannot be added because the quote serves as the approved contract for this job.',
    );
    expect(AGREEMENT_BLOCKED_BY_QUOTE_MESSAGE.fr).toBe(
      'Cette job possède déjà une soumission associée. Il est impossible d’ajouter un contrat, puisque la soumission sert déjà de document contractuel approuvé.',
    );
  });
});

// ── Source audit: the quote→agreement wiring must stay gone ───────────
const root = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

describe('source audit — no agreement can be attached to a quote anymore', () => {
  it('client API no longer creates or reads quote-linked agreements', () => {
    const api = read('src/lib/jobAgreementsApi.ts');
    expect(api).not.toContain('getJobAgreementByQuote');
    // createJobAgreement no longer accepts a quote_id payload field
    expect(api).not.toMatch(/quote_id\??:\s/);
  });

  it('quote pages carry no agreement UI (create button, card, portal block)', () => {
    for (const page of ['src/pages/QuoteNew.tsx', 'src/pages/QuoteDetails.tsx', 'src/pages/QuoteView.tsx']) {
      expect(read(page).toLowerCase()).not.toContain('agreement');
    }
  });

  it('quote → job conversion never creates an agreement', () => {
    const route = read('server/routes/quotes.ts');
    const convert = route.slice(route.indexOf("'/quotes/convert-to-job'"), route.indexOf("'/quotes/public/"));
    expect(convert.toLowerCase()).not.toContain('agreement');
  });

  it('the create modal is job-only', () => {
    const modal = read('src/components/agreements/AgreementCreateModal.tsx');
    expect(modal).not.toContain('quoteId');
    expect(modal).toMatch(/jobId:\s*string;/);
  });

  it('the DB migration blocks quote-linked agreements and agreements on quote-backed jobs', () => {
    const sql = read('supabase/migrations/20260733000000_agreements_job_only.sql');
    expect(sql).toContain('Agreements can no longer be attached to quotes.');
    expect(sql).toContain(AGREEMENT_BLOCKED_BY_QUOTE_MESSAGE.en);
    expect(sql).toContain('create trigger trg_job_agreements_job_only');
  });

  it('the job hub blocks agreement creation when a source quote exists', () => {
    const hub = read('src/pages/JobDetails.tsx');
    expect(hub).toContain('job && !sourceQuote');
    expect(hub).toContain('resolveApprovedDocument(sourceQuote, agreement)');
  });
});
