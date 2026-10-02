/* ═══════════════════════════════════════════════════════════════
   API — ciblage, conflits, « Tester avec un client »
   (server/routes/automation-ciblage.ts).

     POST /api/automations/ciblage/apercu       « Touche X clients » + la liste
     GET  /api/automations/rules/:id/conflits   l'automatisation publiée qui fait la même chose
     POST /api/automations/rules/:id/tester     le parcours joué pour UN client, sans rien envoyer

   Lectures seulement : aucune de ces routes n'écrit.
   ═══════════════════════════════════════════════════════════════ */

import { supabase } from './supabase';
import { getCurrentOrgId } from './orgApi';
import { interfaceEnFrancais } from './champs/messages';
import { appelServeur } from './appelServeur';
import { messageDuServeur } from './messageDuServeur';
import type { Ciblage, CanalClient } from './automationCiblage';
import type { DemandeEssai, ResultatEssai } from './automationEssai';

export type { DemandeEssai, ResultatEssai, EtapeEssai, RenduEssai, IssueEssai, SurLeChemin } from './automationEssai';

async function entetes(): Promise<HeadersInit> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error(interfaceEnFrancais() ? 'Session expirée.' : 'Session expired.');
  const orgId = await getCurrentOrgId();
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    'Accept-Language': interfaceEnFrancais() ? 'fr' : 'en',
    ...(orgId ? { 'x-org-id': orgId } : {}),
  };
}

async function lire<T>(reponse: Response, repli: [fr: string, en: string]): Promise<T> {
  const corps: unknown = await reponse.json().catch(() => null);
  if (!reponse.ok) {
    throw Object.assign(new Error(messageDuServeur(corps) ?? repli[interfaceEnFrancais() ? 0 : 1]), { status: reponse.status });
  }
  return corps as T;
}

// ── « Touche X clients » ────────────────────────────────────

export type EmpechementApercu = 'stop_texto' | 'desabonne_courriel' | 'sans_telephone' | 'sans_courriel' | 'sans_avis';

export interface ApercuCiblageReponse {
  /** Clients du carnet qui correspondent au ciblage — pas « messages qui partiront ». */
  total: number;
  dont: { stop_texto: number; desabonnes_courriel: number; sans_telephone: number; sans_courriel: number; sans_avis: number };
  /** Les premiers clients touchés (au plus 20), parmi ceux que l'utilisateur a le droit de voir. */
  apercu: Array<{ id: string; nom: string; empechements: EmpechementApercu[] }>;
  /** Le carnet dépasse le plafond : le total ne compte que les `plafond` premières fiches. */
  tronque: boolean;
  plafond: number;
  carnet: number;
}

export interface DemandeApercuCiblage {
  ciblage: Ciblage;
  /** Les canaux par lesquels l'automatisation écrit au client. */
  canaux: CanalClient[];
  /** L'automatisation demande un avis : les clients « Aucune demande d'avis » sont comptés à part. */
  demande_avis: boolean;
}

export async function apercuCiblage(demande: DemandeApercuCiblage, signal?: AbortSignal): Promise<ApercuCiblageReponse> {
  const reponse = await appelServeur('/api/automations/ciblage/apercu', {
    method: 'POST', headers: await entetes(), body: JSON.stringify(demande), signal,
  });
  return lire(reponse, ['Compteur indisponible pour l’instant.', 'Counter unavailable right now.']);
}

// ── Conflits (avertissement de doublon) ─────────────────────

export interface ConflitReponse {
  regle_id: string;
  nom: string;
  canaux: CanalClient[];
  meme_message: boolean;
  /** La phrase à afficher, dans la langue de l'interface. */
  message: string;
}

/** Les automatisations publiées en conflit avec celle-ci. `lignes` : prêtes à afficher (les trois premières nommées). */
export async function conflitsDeLaRegle(id: string): Promise<{ conflits: ConflitReponse[]; lignes: string[] }> {
  const reponse = await appelServeur(`/api/automations/rules/${encodeURIComponent(id)}/conflits`, { headers: await entetes() });
  return lire(reponse, ['Impossible de vérifier les doublons.', 'Could not check for duplicates.']);
}

// ── « Tester avec un client » (contrat : src/lib/automationEssai.ts) ──

/** Joue le parcours pour UN client, étape par étape, SANS rien envoyer ni écrire. */
export async function testerAvecUnClient(id: string, demande: DemandeEssai): Promise<ResultatEssai> {
  const reponse = await appelServeur(`/api/automations/rules/${encodeURIComponent(id)}/tester`, {
    method: 'POST', headers: await entetes(), body: JSON.stringify(demande),
  });
  return lire(reponse, ['Impossible de préparer l’essai.', 'Could not prepare the test.']);
}
