/* ═══════════════════════════════════════════════════════════════
   Lien de réservation (page publique /reserver/:token) et aperçu du
   déclencheur « Client inactif » (drapeau `auto_client_inactif`).
   Voir server/routes/reservation.ts.
   ═══════════════════════════════════════════════════════════════ */

import { supabase } from './supabase';
import { getCurrentOrgId } from './orgApi';

const API_BASE = import.meta.env.VITE_API_URL || '';

export interface DemandeReservation {
  entreprise: { nom: string; logo: string | null; couleur: string | null; langue: 'fr' | 'en'; telephone: string | null; courriel: string | null };
  client: { prenom: string; nom: string; courriel: string; telephone: string; adresse: string };
  services_passes: string[];
}

/** Erreur lisible ; `code` = 'expire' | 'inconnu' pour l'écran. */
export class ErreurReservation extends Error {
  constructor(message: string, public code: string) { super(message); }
}

async function lireReponse<T>(res: Response): Promise<T> {
  const corps = await res.json().catch(() => ({}));
  if (!res.ok) throw new ErreurReservation((corps as { error?: string }).error || `HTTP ${res.status}`, (corps as { code?: string }).code || 'erreur');
  return corps as T;
}

export async function lireReservation(jeton: string): Promise<DemandeReservation> {
  return lireReponse(await fetch(`${API_BASE}/api/reservation/${encodeURIComponent(jeton)}`));
}

export async function envoyerReservation(jeton: string, demande: {
  prenom: string; nom: string; courriel: string; telephone: string; adresse: string; services: string[]; message: string;
}): Promise<void> {
  await lireReponse(await fetch(`${API_BASE}/api/reservation/${encodeURIComponent(jeton)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(demande),
  }));
}

/** « X clients correspondent aujourd'hui » pour un seuil en mois. */
export async function apercuClientsInactifs(mois: number): Promise<number> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Session expirée.');
  const orgId = await getCurrentOrgId();
  const res = await fetch(`/api/automations/clients-inactifs/apercu?mois=${encodeURIComponent(String(mois))}`, {
    headers: { Authorization: `Bearer ${token}`, ...(orgId ? { 'x-org-id': orgId } : {}) },
  });
  const r = await lireReponse<{ nombre: number }>(res);
  return r.nombre;
}
