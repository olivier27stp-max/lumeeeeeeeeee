/* ═══════════════════════════════════════════════════════════════
   Avis clients — exclusion par le champ personnalisé « noreview ».

   Chaque entreprise reçoit d'office un champ client « noreview » (case à
   cocher, cf_champs_base). Coché = le client ne reçoit ni la demande
   d'avis ni le rappel d'avis. Tous les autres clients la reçoivent.

   Une entreprise sans le champ (migration pas encore appliquée, champ
   archivé) n'exclut personne.
   ═══════════════════════════════════════════════════════════════ */

import type { SupabaseClient } from '@supabase/supabase-js';
import { NO_REVIEW_FIELD_KEY } from './reviews';

export const MOTIF_CLIENT_SANS_AVIS = 'Client marqué « noreview » : aucune demande d’avis';

/**
 * Le client a-t-il « noreview » coché ? LÈVE si la lecture échoue : mieux
 * vaut une action en reprise qu'une demande d'avis envoyée à un client qui
 * l'a refusée.
 */
export async function clientRefuseAvis(
  supabase: SupabaseClient,
  orgId: string,
  clientId: string | null | undefined,
): Promise<boolean> {
  if (!clientId) return false;

  const { data: champ, error: champError } = await supabase
    .from('custom_fields')
    .select('id')
    .eq('org_id', orgId)
    .eq('object_type', 'client')
    .eq('key', NO_REVIEW_FIELD_KEY)
    .is('archived_at', null)
    .limit(1)
    .maybeSingle();
  if (champError) throw new Error(`Lecture du champ ${NO_REVIEW_FIELD_KEY} impossible : ${champError.message}`);
  if (!champ) return false;

  const { data: valeur, error: valeurError } = await supabase
    .from('custom_field_values')
    .select('value_boolean')
    .eq('org_id', orgId)
    .eq('field_id', champ.id)
    .eq('client_id', clientId)
    .limit(1)
    .maybeSingle();
  if (valeurError) throw new Error(`Lecture de la valeur ${NO_REVIEW_FIELD_KEY} impossible : ${valeurError.message}`);
  return valeur?.value_boolean === true;
}

