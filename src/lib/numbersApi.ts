import { supabase } from './supabase';

export interface NextNumbers {
  /** Prochain numéro de job, ex. « 13 » */
  job: string | null;
  /** Prochain numéro de soumission, ex. « 8 » */
  quote: string | null;
  /** Prochain numéro de facture formaté, ex. « INV-000042 » */
  invoice: string | null;
  /** Partie numérique du prochain numéro de facture, ex. 42 */
  invoiceSeq: number | null;
}

/**
 * Aperçu des prochains numéros disponibles (job, soumission, facture) pour
 * l'org courante, SANS consommer les séquences. Sert à pré-remplir le champ
 * « # » des formulaires de création et à valider un numéro modifié.
 *
 * Retourne null si la RPC n'est pas encore déployée (migration non
 * appliquée) : les formulaires retombent alors sur l'attribution auto.
 */
export async function peekNextNumbers(): Promise<NextNumbers | null> {
  try {
    const { data, error } = await supabase.rpc('rpc_peek_next_numbers');
    if (error || !data) return null;
    const d = data as Record<string, unknown>;
    const seq = Number(d.invoice_seq);
    return {
      job: typeof d.job === 'string' ? d.job : null,
      quote: typeof d.quote === 'string' ? d.quote : null,
      invoice: typeof d.invoice === 'string' ? d.invoice : null,
      invoiceSeq: Number.isFinite(seq) ? seq : null,
    };
  } catch {
    return null;
  }
}
