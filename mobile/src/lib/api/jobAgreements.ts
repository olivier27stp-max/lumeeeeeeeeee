// Ententes de travail — portage de src/lib/jobAgreementsApi.ts (web).
//
// C'est le document que le client accepte : accès à la propriété, GARANTIE de
// 7 jours, état des surfaces, annulation, responsabilité. Créé depuis la fiche
// du job puis envoyé au client, qui le signe sur sa page publique — exactement
// le flux du web.
// Refusé par un déclencheur de la base quand le job porte déjà une soumission :
// dans ce cas c'est la soumission approuvée qui fait office de contrat.

import { supabase } from '../supabase';
import { tr } from '@/lib/i18n';

export type AgreementStatus = 'draft' | 'sent' | 'signed';

export interface JobAgreement {
  id: string;
  job_id: string | null;
  client_id: string | null;
  require_signature: boolean;
  terms: string;
  status: AgreementStatus;
  view_token: string | null;
  sent_at: string | null;
  signer_name: string | null;
  signature_data: string | null;
  signed_at: string | null;
  created_at: string | null;
}

const COLS =
  'id, job_id, client_id, require_signature, terms, status, view_token, sent_at, signer_name, signature_data, signed_at, created_at';

/** Conditions par défaut — texte identique au web (jobAgreementsApi). */
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

/** L'entente la plus récente d'un job, ou null. */
export async function getJobAgreement(jobId: string): Promise<JobAgreement | null> {
  if (!jobId) return null;
  const { data, error } = await supabase
    .from('job_agreements')
    .select(COLS)
    .eq('job_id', jobId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as JobAgreement | null) ?? null;
}

/** Le job porte-t-il déjà une soumission ? Le cas échéant la base refuse
 *  l'entente — autant le dire avant plutôt que de laisser planter. */
export async function jobHasQuote(jobId: string): Promise<boolean> {
  const { data } = await supabase
    .from('quotes')
    .select('id')
    .eq('job_id', jobId)
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle();
  return !!data;
}

export async function createJobAgreement(input: {
  orgId: string;
  jobId: string;
  clientId?: string | null;
  requireSignature?: boolean;
  terms?: string;
  /** Logo affiché sur le contrat — celui de l'entreprise par défaut. */
  logoUrl?: string | null;
  language: 'en' | 'fr';
}): Promise<JobAgreement> {
  if (await jobHasQuote(input.jobId)) {
    throw new Error(tr().mobileErrors.agreementBlockedByQuote);
  }
  const { data: userData } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('job_agreements')
    .insert({
      org_id: input.orgId,
      job_id: input.jobId,
      client_id: input.clientId || null,
      created_by: userData?.user?.id ?? null,
      require_signature: input.requireSignature ?? true,
      terms: input.terms || DEFAULT_AGREEMENT_TERMS[input.language],
      logo_url: input.logoUrl || null,
      status: 'draft',
    })
    .select(COLS)
    .single();
  if (error) throw new Error(error.message);
  return data as JobAgreement;
}

export async function updateAgreementTerms(id: string, terms: string): Promise<void> {
  const { error } = await supabase.from('job_agreements').update({ terms }).eq('id', id);
  if (error) throw new Error(error.message);
}
