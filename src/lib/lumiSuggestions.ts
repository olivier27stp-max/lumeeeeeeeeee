/**
 * Les questions de départ de Lumi, par rôle.
 *
 * Avant, les quatre boutons étaient codés en dur et TOUS financiers : un
 * technicien se faisait proposer « Quel est mon chiffre du mois ? », cliquait,
 * et récoltait un refus. On propose maintenant ce que la personne a vraiment
 * le droit de demander.
 *
 * ⚠️ Ceci n'est PAS une garde de sécurité — c'est de l'ergonomie. La vraie
 * barrière est côté serveur (`executerOutilGarde`), et elle reste seule maître :
 * même si l'interface proposait une action interdite, le serveur la refuserait.
 *
 * L'ordre compte : les suggestions les plus utiles à un gestionnaire sont en
 * tête, les opérationnelles ensuite. Chaque rôle reçoit LES QUATRE PREMIÈRES
 * qu'il peut utiliser — d'où des écrans différents sans liste par rôle à tenir.
 *
 * Copié tel quel dans `mobile/src/lib/lumiSuggestions.ts` (même règle que
 * permissions.ts : on copie, on n'importe pas entre les deux plateformes).
 */
import type { PermissionKey } from './permissions';

export interface SuggestionRole {
  /** Raccourci serveur (étage 0, 0 token). */
  action: string;
  params?: Record<string, string | number | boolean>;
  /** Droit exigé pour que la suggestion ait du sens. */
  permission: PermissionKey;
  fr: string;
  en: string;
}

export const SUGGESTIONS_LUMI: SuggestionRole[] = [
  // ── Gestion (propriétaire, admin) ──
  { action: 'revenu-mois', permission: 'financial.view_reports', fr: 'Quel est mon chiffre du mois ?', en: 'What is my revenue this month?' },
  { action: 'retards', permission: 'financial.view_invoices', fr: 'Quelles factures sont en retard ?', en: 'Which invoices are overdue?' },
  { action: 'top-clients', params: { limit: 5 }, permission: 'financial.view_reports', fr: 'Qui sont mes meilleurs clients ?', en: 'Who are my best clients?' },
  // ── Vente ──
  { action: 'devis-attente', permission: 'quotes.read', fr: 'Quels devis attendent une réponse ?', en: 'Which quotes are awaiting a reply?' },
  // ── Terrain (tout le monde) ──
  { action: 'agenda', params: { periode: 'demain' }, permission: 'jobs.read', fr: 'Prépare ma journée de demain', en: 'Prepare my day tomorrow' },
  { action: 'briefing', permission: 'jobs.read', fr: 'Fais-moi le survol de la journée', en: 'Give me the daily overview' },
  { action: 'taches', permission: 'jobs.read', fr: 'Quelles tâches me restent ?', en: 'What tasks do I have left?' },
  { action: 'ou-equipe', permission: 'gps.read', fr: 'Où est mon équipe en ce moment ?', en: 'Where is my team right now?' },
  { action: 'clients-total', permission: 'clients.read', fr: 'Combien de clients actifs ai-je ?', en: 'How many active clients do I have?' },
  { action: 'equipe', permission: 'team.read', fr: 'Qui fait partie de mon équipe ?', en: 'Who is on my team?' },
];

/** Les quatre premières suggestions que cette personne peut réellement utiliser. */
export function suggestionsPour(
  peut: (cle: PermissionKey) => boolean,
  langue: 'fr' | 'en',
  max = 4,
): { action: string; params?: Record<string, string | number | boolean>; label: string }[] {
  return SUGGESTIONS_LUMI.filter((s) => peut(s.permission))
    .slice(0, max)
    .map((s) => ({ action: s.action, ...(s.params ? { params: s.params } : {}), label: langue === 'fr' ? s.fr : s.en }));
}
