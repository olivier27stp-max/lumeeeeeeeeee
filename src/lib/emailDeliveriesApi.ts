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

/** Un envoi avec son suivi d'ouverture et de clic (plan courriels pro, 2026-09-17). */
export interface EnvoiCourriel extends LivraisonCourriel {
  subject: string | null;
  opened_at: string | null;
  open_count: number;
  clicked_at: string | null;
  click_count: number;
  last_clicked_url: string | null;
}

/**
 * Tous les envois d'une entité, le plus récent d'abord — via le serveur
 * (GET /api/email-deliveries, membre de l'org). Une erreur = liste vide,
 * journalisée : la ligne d'état disparaît, la page ne casse pas.
 */
export async function listerEnvois(entityType: string, entityId: string): Promise<EnvoiCourriel[]> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return [];
  const orgId = await getCurrentOrgIdOrThrow();
  const query = new URLSearchParams({ entity_type: entityType, entity_id: entityId });
  const res = await fetch(`/api/email-deliveries?${query}`, {
    headers: { Authorization: `Bearer ${token}`, 'x-org-id': orgId },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error('[emailDeliveries] liste des envois échouée', body?.error || res.status);
    return [];
  }
  return (body?.deliveries as EnvoiCourriel[] | undefined) ?? [];
}
