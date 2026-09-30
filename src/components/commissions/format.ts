import { formatMoneyFromCents } from '../../lib/invoicesApi';
import type { FsCommissionEntry } from '../../types';

/**
 * Formats de la page Commissions (audit 2026-09-30). Avant : quatre
 * formateurs maison — « $ » en préfixe en français, dollars ARRONDIS dans les
 * KPI (1 234,56 $ affiché « $1 235 »), `en-US` au lieu de `en-CA`.
 */
export const localeDe = (fr: boolean) => (fr ? 'fr-CA' : 'en-CA');

/** Montant en dollars (colonne `amount`) → « 1 234,56 $ » / « $1,234.56 ». */
export function fmtArgent(dollars: number | string | null | undefined, fr: boolean): string {
  return formatMoneyFromCents(Math.round(Number(dollars || 0) * 100), 'CAD', localeDe(fr));
}

export function fmtCents(cents: number | null | undefined, fr: boolean): string {
  return formatMoneyFromCents(Number(cents || 0), 'CAD', localeDe(fr));
}

/** Date d'une commission, dans le fuseau de l'entreprise quand il est connu. */
export function fmtDateCommission(iso: string | null | undefined, fr: boolean, timeZone?: string, avecAnnee = true): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(localeDe(fr), {
    month: 'short', day: 'numeric', ...(avecAnnee ? { year: 'numeric' } : {}), ...(timeZone ? { timeZone } : {}),
  });
}

/** Libellé de la vente : facture, job, client — plus la description technique. */
export function libelleVente(e: FsCommissionEntry, fr: boolean): string {
  const x = e as FsCommissionEntry & { invoice_number?: string | null; job_number?: string | null; job_title?: string | null; client_name?: string | null };
  const morceaux = [
    x.invoice_number ? `${fr ? 'Facture' : 'Invoice'} #${x.invoice_number}` : null,
    !x.invoice_number && (x.job_number || x.job_title) ? `Job ${x.job_number ? `#${x.job_number}` : ''} ${x.job_title ?? ''}`.trim() : null,
    x.client_name,
  ].filter(Boolean);
  if (morceaux.length) return morceaux.join(' — ');
  return fr ? 'Vente' : 'Sale';
}

/** Estimation projetée à la création du job (aucune facture payée). */
export const estEstimation = (e: Pick<FsCommissionEntry, 'status'> & { invoice_id?: string | null }) => !e.invoice_id && e.status === 'pending';

/** Commission versée dont la facture a été remboursée depuis. */
export const rembourseeApresVersement = (e: FsCommissionEntry & { reverse_reason?: string | null }) =>
  !!e.reverse_reason && e.status !== 'reversed';

/** Libellé d'un statut, y compris l'estimation. */
export function libelleStatut(e: FsCommissionEntry & { invoice_id?: string | null }, fr: boolean): string {
  if (estEstimation(e)) return fr ? 'Estimation' : 'Estimate';
  const fr_ = { pending: 'En attente', approved: 'Approuvé', paid: 'Versé', reversed: 'Reversé' } as Record<string, string>;
  const en_ = { pending: 'Pending', approved: 'Approved', paid: 'Paid', reversed: 'Reversed' } as Record<string, string>;
  return (fr ? fr_ : en_)[e.status] ?? e.status;
}
