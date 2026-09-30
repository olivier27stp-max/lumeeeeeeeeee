/**
 * Où mène une fiche de Lumi, sur mobile.
 *
 * Le serveur compose des liens pour le WEB (`server/lib/lumi/fiches.ts`) :
 * /clients/:id · /jobs/:id · /quotes/:id · /invoices/:id · /tasks. Trois
 * d'entre eux ont un écran mobile, deux n'en ont pas.
 *
 * Règle retenue : un lien qui n'a pas de destination native n'est PAS affiché.
 * Un bouton « Ouvrir » qui ne mène nulle part est pire que pas de bouton.
 * (Créer les écrans Devis/Facture dépasse le mandat Lumi.)
 */
import { router } from 'expo-router';

import type { FicheLumi } from '../api/lumi';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** La route mobile pour cette fiche, ou null si l'app n'a pas d'écran pour ça. */
export function routeMobile(f: FicheLumi): string | null {
  if (f.type === 'task') return '/(app)/tasks';
  if (!UUID.test(f.id)) return null;
  switch (f.type) {
    // Un prospect EST une ligne de `clients` : même écran (voir lib/api/leads.ts).
    case 'client':
    case 'lead':
      return `/(app)/clients/${f.id}`;
    case 'job':
      return `/(app)/jobs/${f.id}`;
    // Le mobile n'a pas d'écran de devis ni de facture (seulement /new et /send).
    case 'quote':
    case 'invoice':
      return null;
    default:
      return null;
  }
}

export function ouvrable(f: FicheLumi): boolean {
  return routeMobile(f) !== null;
}

export function ouvrirFiche(f: FicheLumi): void {
  const r = routeMobile(f);
  if (r) router.push(r as never);
}

/** Page du CRM où vérifier ce qu'un outil a consulté (ligne « Sources »), côté mobile. */
export const SOURCES_OUTILS: Record<string, { route: string; fr: string; en: string }> = {
  search_clients: { route: '/(app)/clients', fr: 'Clients', en: 'Clients' },
  search_leads: { route: '/(app)/leads', fr: 'Prospects', en: 'Leads' },
  list_jobs: { route: '/(app)/(tabs)/schedule', fr: 'Horaire', en: 'Schedule' },
  get_job: { route: '/(app)/(tabs)/schedule', fr: 'Horaire', en: 'Schedule' },
  query_schedule: { route: '/(app)/(tabs)/schedule', fr: 'Horaire', en: 'Schedule' },
  find_dates_in_location: { route: '/(app)/(tabs)/schedule', fr: 'Horaire', en: 'Schedule' },
  get_day_route: { route: '/(app)/schedule', fr: 'Tournée', en: 'Route' },
  get_team: { route: '/(app)/manage-team', fr: 'Équipe', en: 'Team' },
  get_morning_briefing: { route: '/(app)/(tabs)', fr: 'Accueil', en: 'Home' },
  // Pas de Finances ni de Devis sur mobile : list_quotes, list_invoices,
  // get_overdue_payments, get_revenue_summary et get_financial_overview n'ont
  // pas d'écran où renvoyer. On les omet plutôt que de mentir sur la source.
};
