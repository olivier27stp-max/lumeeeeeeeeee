import { supabase } from './supabase';
import { getCurrentOrgIdOrThrow } from './orgApi';

/**
 * Carte au dossier d'un client (« payment on file ») — table
 * client_payment_profiles. Sauvegardée uniquement avec le consentement
 * explicite du client sur la page de paiement publique (Loi 25) ; retirable
 * en tout temps depuis le hub client.
 */
export interface ClientCardOnFile {
  id: string;
  client_id: string;
  card_brand: string | null;
  card_last4: string | null;
  card_exp_month: number | null;
  card_exp_year: number | null;
  consented_at: string | null;
}

export async function getClientCardOnFile(clientId: string): Promise<ClientCardOnFile | null> {
  const orgId = await getCurrentOrgIdOrThrow();
  const { data, error } = await supabase
    .from('client_payment_profiles')
    .select('id, client_id, card_brand, card_last4, card_exp_month, card_exp_year, consented_at')
    .eq('org_id', orgId)
    .eq('client_id', clientId)
    .is('deleted_at', null)
    .maybeSingle();
  // Table absente tant que la migration 20260802400000 n'est pas appliquée.
  if (error) return null;
  if (!data || !data.card_last4) return null;
  return data as ClientCardOnFile;
}

/** Retrait de la carte (droit de retrait Loi 25) — détache aussi chez Stripe. */
export async function removeClientCardOnFile(clientId: string): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('You need to be authenticated for this action.');

  const response = await fetch('/api/payments/card-on-file/remove', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ clientId }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body?.error || `Request failed (${response.status}).`);
  }
}
