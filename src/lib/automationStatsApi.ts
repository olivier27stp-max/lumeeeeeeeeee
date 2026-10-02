/* ═══════════════════════════════════════════════════════════════
   Statistiques des automatisations — les appels du front.

   UNE source pour tous les écrans (la liste, la Vue d'ensemble, l'Activité
   du bureau, les onglets de l'éditeur) : les routes de
   `server/routes/automation-stats.ts`, qui comptent EN BASE. Avant, chaque
   écran lisait PostgREST depuis le navigateur et comptait lui-même, sur les
   200 ou 1 000 premières lignes (constats D-01, D-02, D-09, D-15).
   L'Historique, les Journaux et les modifications : `automationJournauxApi.ts`.
   ═══════════════════════════════════════════════════════════════ */

import { supabase } from './supabase';
import { getCurrentOrgId } from './orgApi';
import { appelServeur } from './appelServeur';
import { interfaceEnFrancais } from './champs/messages';
import { messageDuServeur } from './messageDuServeur';
import { PERIODE_DEFAUT, periodeValide, type PeriodeJours } from './automationIssues';
import type { GroupeMotif } from './automationMotifs';

// ── La période choisie, retenue d'un écran à l'autre ────────

const CLE_PERIODE = 'lume-automations-periode';

/** La période choisie sur ce navigateur (préférence d'affichage), ou celle par défaut. */
export function lirePeriodeChoisie(): PeriodeJours {
  try {
    return periodeValide(localStorage.getItem(CLE_PERIODE)) ?? PERIODE_DEFAUT;
  } catch {
    // Stockage bloqué (mode privé) : la période par défaut.
    return PERIODE_DEFAUT;
  }
}

export function retenirPeriode(jours: PeriodeJours): void {
  try {
    localStorage.setItem(CLE_PERIODE, String(jours));
  } catch {
    // Stockage bloqué : la période vaut pour cet écran seulement.
  }
}

// ── Ce que le serveur rend ──────────────────────────────────

export interface Periode {
  jours: number;
  fuseau: string;
  depuis: string;
  premier_jour: string;
  dernier_jour: string;
}

export interface Compteurs {
  declenchees: number;
  envoyees: number;
  actions: number;
  echouees: number;
  ignorees: number;
  annulees: number;
  reportees: number;
  en_cours: number;
  ignorees_par_groupe: Partial<Record<GroupeMotif, number>>;
  ignorees_par_code: Record<string, number>;
  reportees_par_code: Record<string, number>;
}

export interface StatsRegle extends Compteurs {
  dernier_echec: { quand: string; action_type: string; erreur: string | null } | null;
  dernier_ignore: { quand: string; action_type: string; issue: string; detail: string | null } | null;
}

export interface JourStats {
  jour: string;
  declenchees: number;
  envoyees: number;
  echouees: number;
  ignorees: number;
}

export interface Statistiques {
  periode: Periode;
  par_regle: Record<string, StatsRegle>;
  total: Compteurs;
  par_jour: JourStats[];
  /** Le bureau a-t-il un numéro texto ? `null` = inconnu. */
  texto_configure?: boolean | null;
}

// ── Appels ──────────────────────────────────────────────────

async function entetes(): Promise<HeadersInit> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error(interfaceEnFrancais() ? 'Session expirée.' : 'Session expired.');
  const orgId = await getCurrentOrgId();
  return {
    Authorization: `Bearer ${token}`,
    'Accept-Language': interfaceEnFrancais() ? 'fr' : 'en',
    ...(orgId ? { 'x-org-id': orgId } : {}),
  };
}

/** Un GET sur une route du serveur, avec la session et le bureau courants. Lève avec la phrase du serveur. */
export async function lireRoute<T>(chemin: string, parametres: Record<string, string | number | null | undefined>, repli: string): Promise<T> {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(parametres)) {
    if (v !== null && v !== undefined && v !== '') q.set(k, String(v));
  }
  const suite = q.toString();
  const reponse = await appelServeur(`${chemin}${suite ? `?${suite}` : ''}`, { headers: await entetes() });
  if (!reponse.ok) {
    let message = repli;
    try {
      message = messageDuServeur(await reponse.json()) ?? repli;
    } catch {
      // Corps illisible : le repli dit déjà l'essentiel.
    }
    throw Object.assign(new Error(message), { status: reponse.status });
  }
  return reponse.json() as Promise<T>;
}

/** Les chiffres du bureau sur une période : par automatisation, au total, et jour par jour. */
export function chargerStatistiquesBureau(jours: PeriodeJours): Promise<Statistiques> {
  return lireRoute<Statistiques>('/api/automations/rules/stats', { jours },
    interfaceEnFrancais() ? 'Impossible de lire les statistiques.' : 'Could not read the statistics.');
}
