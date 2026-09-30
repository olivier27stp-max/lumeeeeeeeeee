/**
 * Trajets planifiés de l'Agenda — calculés par le serveur (GET /api/agenda/trajets),
 * avec une matrice de route en cache. Remplace les appels Mapbox que le
 * navigateur faisait à chaque rendu (audit Agenda, 2026-09-30).
 *
 * Types recopiés de server/lib/trajets/journee.ts : `src/` n'importe jamais
 * un module de `server/` (tests/frontiere-serveur-client).
 */
import { supabase } from './supabase';

export interface TrajetRoute { secondes: number; metres: number; estime: boolean }
export type AlerteTrajet = 'chevauchement' | 'trajet_impossible';

export interface ArretTrajet {
  visitId: string;
  jobId: string | null;
  teamId: string | null;
  debut: string;
  fin: string;
  statut: string;
  titre: string;
  client: string | null;
  adresse: string | null;
  ordre: number;
  lat: number;
  lng: number;
  depuisPrecedent: TrajetRoute | null;
  alertes: AlerteTrajet[];
}

export interface TrajetEquipe {
  teamId: string | null;
  arrets: ArretTrajet[];
  totalMetres: number;
  totalSecondes: number;
  estime: boolean;
  alertes: number;
}

export interface VisiteACorriger {
  visitId: string; jobId: string | null; teamId: string | null;
  debut: string; fin: string; statut: string; titre: string; client: string | null; adresse: string | null;
}

export interface JourTrajets { jour: string; equipes: TrajetEquipe[]; aCorriger: VisiteACorriger[] }
export interface ReponseTrajets { fuseau: string; jours: JourTrajets[] }

export async function listerTrajets(p: { debut: string; fin: string; equipes: string[]; nonAssigne?: boolean }): Promise<ReponseTrajets> {
  const { data: s } = await supabase.auth.getSession();
  const jeton = s.session?.access_token;
  if (!jeton) throw new Error('Session expirée.');
  const params = new URLSearchParams({ debut: p.debut, fin: p.fin });
  const equipes = [...p.equipes, ...(p.nonAssigne ? ['non_assigne'] : [])];
  if (equipes.length) params.set('equipes', equipes.join(','));
  const res = await fetch(`/api/agenda/trajets?${params.toString()}`, { headers: { Authorization: `Bearer ${jeton}` } });
  const corps = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((corps as { error?: string })?.error || 'Impossible de calculer les trajets.');
  return corps as ReponseTrajets;
}
