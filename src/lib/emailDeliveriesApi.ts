/**
 * Sort des courriels transactionnels (table email_deliveries, lecture RLS).
 * Audit QA prod 2026-09-09, n°8.
 */
import { supabase } from './supabase';
import { getCurrentOrgIdOrThrow } from './orgApi';

export type StatutLivraison = 'sent' | 'delivered' | 'delayed' | 'bounced' | 'complained' | 'failed';

export interface LivraisonCourriel {
  id: string;
  to_email: string;
  status: StatutLivraison;
  error: string | null;
  created_at: string;
  updated_at: string;
}

/** Dernier courriel envoyé pour cette entité (facture, devis, contrat), ou null. */
export async function derniereLivraison(entityType: string, entityId: string): Promise<LivraisonCourriel | null> {
  const orgId = await getCurrentOrgIdOrThrow();
  const { data, error } = await supabase
    .from('email_deliveries')
    .select('id, to_email, status, error, created_at, updated_at')
    .eq('org_id', orgId)
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    // Table absente sur un environnement pas encore migré : pas de badge, pas de bruit.
    console.error('[emailDeliveries] lecture échouée', error.message);
    return null;
  }
  return (data as LivraisonCourriel | null) ?? null;
}
