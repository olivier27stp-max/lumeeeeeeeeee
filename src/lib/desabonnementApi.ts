/* ═══════════════════════════════════════════════════════════════
   Désabonnement par canal — ce que la fiche client affiche.

   Lecture seule : un désabonnement vient du CLIENT (STOP par texto, lien
   du courriel, page de préférences), jamais d'un clic dans l'app. La fiche
   montre l'état de chaque canal et l'historique du journal probant.

   `actif: false` = le drapeau `auto_desabonnement_canal` n'est pas activé
   pour l'entreprise : la fiche reste exactement comme avant.
   ═══════════════════════════════════════════════════════════════ */

import { supabase } from './supabase';
import { getCurrentOrgId } from './orgApi';

export interface EtatCanal {
  desabonne: boolean;
  depuis: string | null;
  source: string | null;
}

export interface LigneHistorique {
  canal: 'courriel' | 'texto';
  accorde: boolean;
  source: string | null;
  date: string;
}

export type EtatDesabonnement =
  | { actif: false }
  | { actif: true; courriel: EtatCanal; texto: EtatCanal; historique: LigneHistorique[] };

export async function lireDesabonnement(clientId: string): Promise<EtatDesabonnement> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Session expirée.');
  const orgId = await getCurrentOrgId();
  const res = await fetch(`/api/clients/${encodeURIComponent(clientId)}/desabonnement`, {
    headers: { Authorization: `Bearer ${token}`, ...(orgId ? { 'x-org-id': orgId } : {}) },
  });
  if (!res.ok) {
    const corps = await res.json().catch(() => ({}));
    throw new Error((corps as { error?: string }).error || `Erreur ${res.status}`);
  }
  return (await res.json()) as EtatDesabonnement;
}

/** La source d'un choix, en mots de l'écran. */
export function libelleSourceDesabonnement(source: string | null, fr: boolean): string {
  switch (source) {
    case 'texto-stop':
    case 'client_stop':
      return fr ? 'réponse STOP par texto' : 'STOP text reply';
    case 'texto-start':
      return fr ? 'réponse REPRENDRE par texto' : 'START text reply';
    case 'lien-courriel':
    case 'one-click unsubscribe':
      return fr ? 'lien du courriel' : 'email link';
    case 'list-unsubscribe header':
      return fr ? 'bouton de la messagerie' : 'mail app button';
    case 'page-preferences':
      return fr ? 'page de préférences' : 'preferences page';
    case 'crm-manual':
      return fr ? 'saisi dans la fiche' : 'entered on the profile';
    case 'fiche-client':
      return fr ? 'fiche client' : 'client profile';
    default:
      return source ?? (fr ? 'inconnue' : 'unknown');
  }
}
