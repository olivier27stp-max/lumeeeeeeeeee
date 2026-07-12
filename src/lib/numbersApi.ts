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
  /** Prochain numéro de client, ex. « 27 » — null si la migration n'est pas appliquée */
  client: string | null;
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
      client: typeof d.client === 'string' ? d.client : null,
    };
  } catch {
    return null;
  }
}

/** Entités qui portent un numéro séquentiel par org. */
export type NumberedEntity = 'job' | 'quote' | 'invoice' | 'client';

const ENTITY_TABLES: Record<NumberedEntity, { table: string; column: string; softDeleteFilter: boolean }> = {
  job: { table: 'jobs', column: 'job_number', softDeleteFilter: true },
  quote: { table: 'quotes', column: 'quote_number', softDeleteFilter: true },
  // La contrainte unique des factures inclut les soft-deleted : pas de filtre.
  invoice: { table: 'invoices', column: 'invoice_number', softDeleteFilter: false },
  client: { table: 'clients', column: 'client_number', softDeleteFilter: true },
};

/**
 * Vérifie si un numéro est déjà pris dans l'org courante (warning doublon).
 * `digits` = partie numérique saisie. La RLS limite la requête à l'org.
 * Les factures sont comparées sur leur suffixe numérique (prefix configurable
 * via company_settings.invoice_prefix). En cas d'échec de la vérification,
 * retourne false : la validation serveur (rpc_update_entity_number / RPCs de
 * création) tranche au save.
 */
export async function isEntityNumberTaken(
  entity: NumberedEntity,
  digits: string,
  excludeId?: string
): Promise<boolean> {
  try {
    const { table, column, softDeleteFilter } = ENTITY_TABLES[entity];
    let query = supabase.from(table).select('id').limit(1);
    if (entity === 'invoice') {
      query = query.like(column, `%${digits.padStart(6, '0')}`);
    } else {
      query = query.eq(column, digits);
    }
    if (softDeleteFilter) query = query.is('deleted_at', null);
    if (excludeId) query = query.neq('id', excludeId);
    const { data } = await query.maybeSingle();
    return Boolean(data?.id);
  } catch {
    return false;
  }
}

/**
 * Change le numéro d'une entité depuis sa page hub. Validation serveur
 * (numérique, ≤ prochain disponible, pas de doublon) + avance du compteur de
 * l'org, le tout atomique. Retourne le numéro stocké (formaté pour les
 * factures). Lève l'erreur serveur telle quelle en cas de refus.
 */
export async function updateEntityNumber(
  entity: NumberedEntity,
  id: string,
  digits: string
): Promise<string> {
  const { data, error } = await supabase.rpc('rpc_update_entity_number', {
    p_entity: entity,
    p_id: id,
    p_number: digits,
  });
  if (error) throw error;
  if (typeof data === 'string' && data) return data;
  // Filet : la RPC retourne toujours la valeur stockée; on reconstruit au cas où.
  return entity === 'invoice' ? `INV-${digits.padStart(6, '0')}` : digits;
}
