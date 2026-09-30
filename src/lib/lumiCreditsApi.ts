/**
 * Crédits Lumi — client de /api/lumi/credits*.
 *
 * Depuis le 2026-09-30, l'usage IA de Lumi se compte en CRÉDITS, jamais en
 * dollars : Autopilot inclut un nombre de crédits par période mensuelle
 * (date de renouvellement propre à l'entreprise, fournie par le serveur),
 * sans report ni achat. Aucun montant en dollars d'IA ne doit s'afficher au
 * client — ce module ne transporte donc que des crédits.
 *
 * Le libellé « crédits Lumi » vit dans l'i18n (`lumiCredits.unit`) : une
 * seule clé, réutilisée partout, pour pouvoir le renommer d'un coup.
 */
import { supabase } from './supabase';
import { deviceTokenHeader } from './deviceToken';
import { bureauActifSync } from './orgApi';

const API_BASE = import.meta.env.VITE_API_URL || '';

async function authHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  let activeOrg = '';
  try { activeOrg = bureauActifSync() || ''; } catch { /* stockage indisponible */ }
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session?.access_token || ''}`,
    'x-org-id': activeOrg,
    ...deviceTokenHeader(),
  };
}

/** État des crédits de la période en cours (contrat serveur, 2026-09-30). */
export interface EtatCredits {
  /** Le forfait inclut Lumi. */
  inclus: boolean;
  /** Crédits de la période (ex. 1000). */
  total: number;
  /** Entier, arrondi vers le bas. */
  utilises: number;
  /** Entier ≥ 0, arrondi vers le bas. */
  restants: number;
  /** 0..100, entier (utilisés / total). */
  pourcentage: number;
  /** 'YYYY-MM-DD', date locale du bureau. */
  renouvellement_le: string;
  palier: 'normal' | 'econome' | 'restreint' | 'epuise';
  /** '80' = au moins 80 % utilisés ; '100' = épuisé. */
  avertissement: null | '80' | '100';
}

export interface HistoriqueCredits {
  periode_debut: string;
  renouvellement_le: string;
  /** Crédits avec une décimale. */
  par_jour: Array<{ jour: string; credits: number }>;
  /** null si l'utilisateur n'a pas la permission external_agent.admin. */
  par_utilisateur: null | Array<{ user_id: string; nom: string; credits: number }>;
}

export async function chargerCreditsLumi(): Promise<EtatCredits> {
  const res = await fetch(`${API_BASE}/api/lumi/credits`, { headers: await authHeaders() });
  if (!res.ok) throw new Error(`credits_http_${res.status}`);
  return res.json();
}

export async function chargerHistoriqueCreditsLumi(jours = 30): Promise<HistoriqueCredits> {
  const res = await fetch(`${API_BASE}/api/lumi/credits/historique?jours=${encodeURIComponent(String(jours))}`, { headers: await authHeaders() });
  if (!res.ok) throw new Error(`credits_historique_http_${res.status}`);
  return res.json();
}

// ── Affichage : mise en forme pure, partagée avec les pages publiques ──
export { remplir, majuscule, fmtCredits, fmtDateCredits, uniteCredits, creditsParMois, CREDITS_LUMI_AUTOPILOT } from './lumiCreditsFormat';
