/* ═══════════════════════════════════════════════════════════════
   Branding d'entreprise pour les pages publiques.

   Railway déploie automatiquement sur main, mais les migrations sont
   manuelles : entre les deux, le code tourne contre un schéma plus
   ancien. Avec PostgREST, une seule colonne inexistante fait échouer
   TOUTE la requête — et supabase-js ne lève jamais d'exception. Le
   contrat s'affichait donc sans nom d'entreprise, sans logo et sans
   adresse, sans la moindre erreur nulle part.

   On redemande donc sans la colonne récente plutôt que de tout perdre.
   ═══════════════════════════════════════════════════════════════ */

import { SupabaseClient } from '@supabase/supabase-js';

/** Colonnes ajoutées après coup — retirées si la base ne les a pas encore. */
const COLONNES_RECENTES = ['brand_color'];

/**
 * Lit company_settings en tolérant un schéma en retard sur le code.
 *
 * @param colonnes Liste complète souhaitée, colonnes récentes incluses.
 * @returns La ligne, ou null si l'org n'a pas de réglages.
 */
export async function getCompanyBranding(
  admin: SupabaseClient,
  orgId: string,
  colonnes: string,
): Promise<Record<string, any> | null> {
  const { data, error } = await admin
    .from('company_settings')
    .select(colonnes)
    .eq('org_id', orgId)
    .maybeSingle();

  if (!error) return (data as Record<string, any>) ?? null;

  // 42703 = undefined_column. Tout autre échec est un vrai problème.
  const manquante = COLONNES_RECENTES.find((c) => colonnes.includes(c) && error.message?.includes(c));
  if (error.code !== '42703' || !manquante) {
    console.error('[companyBranding] lecture impossible', { org_id: orgId, code: error.code, message: error.message });
    return null;
  }

  console.warn(
    `[companyBranding] colonne "${manquante}" absente de la base — migration non appliquée. ` +
      'Le branding est servi sans elle.',
  );
  const repli = colonnes
    .split(',')
    .map((c) => c.trim())
    .filter((c) => c !== manquante)
    .join(', ');
  const { data: secours } = await admin
    .from('company_settings')
    .select(repli)
    .eq('org_id', orgId)
    .maybeSingle();
  return (secours as Record<string, any>) ?? null;
}
