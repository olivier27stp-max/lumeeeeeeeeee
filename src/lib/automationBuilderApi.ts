/* ═══════════════════════════════════════════════════════════════
   API — automatisations personnalisées

   Créer, modifier, dupliquer et supprimer ses propres automatisations.

   Séparé de `automationRulesApi.ts`, qui lit et bascule les préréglages en
   écrivant directement dans PostgREST : ici tout passe par le serveur, parce
   qu'une automatisation enverra de vrais textos et courriels à des clients.
   Le serveur valide contre le catalogue, applique les gardes qui demandent de
   le lire (délai négatif réservé aux rendez-vous) et annule les envois déjà
   prévus quand une règle disparaît — trois choses qu'un `insert` depuis le
   navigateur ne ferait pas.
   ═══════════════════════════════════════════════════════════════ */

import { supabase } from './supabase';
import { getCurrentOrgId } from './orgApi';
import type { AutomationRule } from './automationRulesApi';
import type { DeclencheurCatalogue, ActionCatalogue } from './automationCatalogue';

export interface ActionAutomatisation {
  type: string;
  /**
   * Les champs de l'action, tous en TEXTE.
   *
   * Ouvert (`Record`) plutot que ferme sur trois cles : chaque action a les
   * SIENNES (`url` pour un webhook, `statut` pour un changement de statut),
   * et le catalogue en est la source de verite. C'est la validation serveur
   * qui ferme la porte — elle refuse toute cle absente du catalogue, y
   * compris un `to` qui reintroduirait un destinataire libre.
   */
  config: Record<string, string | undefined>;
}

export interface BrouillonAutomatisation {
  name: string;
  description?: string | null;
  trigger_event: string;
  conditions?: Record<string, unknown>;
  delay_seconds: number;
  actions: ActionAutomatisation[];
  /** Séquence. Absente = règle simple. */
  steps?: unknown[] | null;
  /** Réglages propres à la règle. */
  settings?: Record<string, unknown> | null;
  /** Dossier de rangement — `null` = à la racine. */
  folder_id?: string | null;
  is_active?: boolean;
}

export interface CatalogueAutomatisations {
  declencheurs: DeclencheurCatalogue[];
  actions: ActionCatalogue[];
}

/**
 * Entêtes d'une requête authentifiée.
 *
 * `x-org-id` porte l'office réellement sélectionné : un utilisateur peut être
 * membre de plusieurs offices, et sans cet entête le serveur retomberait sur
 * le premier — l'automatisation serait créée dans la mauvaise entreprise.
 */
async function entetes(): Promise<HeadersInit> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Session expirée.');
  const orgId = await getCurrentOrgId();
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    ...(orgId ? { 'x-org-id': orgId } : {}),
  };
}

/**
 * Le message d'erreur du serveur, ou un repli lisible.
 *
 * Le serveur répond en clair et en français (« ce déclencheur n'a pas de date
 * future… ») : c'est ce texte qu'il faut montrer, pas « HTTP 400 ». Si le
 * corps n'est pas du JSON — une passerelle qui renvoie du HTML, par exemple —
 * on retombe sur un message générique plutôt que d'afficher du balisage.
 */
async function erreurDe(reponse: Response, repli: string): Promise<Error> {
  try {
    const corps = await reponse.json();
    if (corps?.error && typeof corps.error === 'string') return new Error(corps.error);
  } catch {
    // Corps illisible : le repli dit déjà l'essentiel.
  }
  return new Error(repli);
}

export async function chargerAutomatisations(): Promise<{
  rules: AutomationRule[];
  catalogue: CatalogueAutomatisations;
}> {
  const reponse = await fetch('/api/automations/rules', { headers: await entetes() });
  if (!reponse.ok) throw await erreurDe(reponse, 'Impossible de charger les automatisations.');
  return reponse.json();
}

export async function creerAutomatisation(brouillon: BrouillonAutomatisation): Promise<AutomationRule> {
  const reponse = await fetch('/api/automations/rules', {
    method: 'POST',
    headers: await entetes(),
    body: JSON.stringify(brouillon),
  });
  if (!reponse.ok) throw await erreurDe(reponse, 'Impossible de créer l\'automatisation.');
  return reponse.json();
}

export async function modifierAutomatisation(
  id: string,
  patch: Partial<BrouillonAutomatisation>,
): Promise<AutomationRule> {
  const reponse = await fetch(`/api/automations/rules/${id}`, {
    method: 'PATCH',
    headers: await entetes(),
    body: JSON.stringify(patch),
  });
  if (!reponse.ok) throw await erreurDe(reponse, 'Impossible de modifier l\'automatisation.');
  return reponse.json();
}

export async function dupliquerAutomatisation(id: string): Promise<AutomationRule> {
  const reponse = await fetch(`/api/automations/rules/${id}/duplicate`, {
    method: 'POST',
    headers: await entetes(),
  });
  if (!reponse.ok) throw await erreurDe(reponse, 'Impossible de dupliquer l\'automatisation.');
  return reponse.json();
}

export async function supprimerAutomatisation(id: string): Promise<void> {
  const reponse = await fetch(`/api/automations/rules/${id}`, {
    method: 'DELETE',
    headers: await entetes(),
  });
  if (!reponse.ok) throw await erreurDe(reponse, 'Impossible de supprimer l\'automatisation.');
}

// ── Délais, en mots ─────────────────────────────────────────

/**
 * Le délai tel qu'on le saisit : un nombre et une unité, jamais des secondes.
 *
 * Personne ne pense « 259 200 secondes » — on pense « 3 jours ». La base, elle,
 * ne connaît que `delay_seconds`, alors la conversion vit ici, au seul endroit
 * où les deux se rencontrent.
 */
export type UniteDelai = 'minutes' | 'heures' | 'jours';

const SECONDES: Record<UniteDelai, number> = {
  minutes: 60,
  heures: 3600,
  jours: 86400,
};

export function enSecondes(valeur: number, unite: UniteDelai, avant: boolean): number {
  const brut = Math.round(valeur * SECONDES[unite]);
  return avant ? -brut : brut;
}

/**
 * L'inverse : des secondes vers le couple (valeur, unité) le plus lisible.
 *
 * On choisit la plus grande unité qui tombe juste — 7200 s devient « 2 heures »
 * et non « 120 minutes ». Un reste, et on descend d'un cran, pour ne jamais
 * afficher un arrondi qui ferait mentir le formulaire.
 */
export function depuisSecondes(secondes: number): { valeur: number; unite: UniteDelai; avant: boolean } {
  const avant = secondes < 0;
  const abs = Math.abs(secondes);
  if (abs === 0) return { valeur: 0, unite: 'minutes', avant: false };
  if (abs % SECONDES.jours === 0) return { valeur: abs / SECONDES.jours, unite: 'jours', avant };
  if (abs % SECONDES.heures === 0) return { valeur: abs / SECONDES.heures, unite: 'heures', avant };
  return { valeur: Math.round(abs / SECONDES.minutes), unite: 'minutes', avant };
}

// ── Lumi construit le parcours ──────────────────────────────

export interface ParcoursPropose {
  nom: string;
  trigger_event: string;
  resume: string;
  steps: unknown[];
}

/**
 * Demande à Lumi de construire un parcours à partir d'une phrase.
 *
 * Il PROPOSE : rien n'est enregistré. Ce qui revient est dessiné dans le
 * canevas, et c'est l'utilisateur qui décide de le garder — la règle du
 * projet veut qu'une écriture ne soit jamais exécutée par l'orchestrateur.
 */
export async function genererParcoursAvecLumi(demande: string, langue: 'fr' | 'en'): Promise<ParcoursPropose> {
  const reponse = await fetch('/api/automations/rules/generer', {
    method: 'POST',
    headers: await entetes(),
    body: JSON.stringify({ demande, langue }),
  });
  if (!reponse.ok) throw await erreurDe(reponse, 'Lumi n’a pas pu construire ce parcours.');
  return reponse.json();
}

/**
 * Les membres de l'organisation, pour les champs « assigner a ».
 *
 * Lu directement en PostgREST : c'est une lecture, protegee par la RLS de
 * `memberships` — passer par le serveur n'ajouterait rien.
 */
export async function chargerMembres(): Promise<Array<{ user_id: string; nom: string }>> {
  const orgId = await getCurrentOrgId();
  if (!orgId) return [];
  const { data, error } = await supabase
    .from('memberships')
    .select('user_id, full_name')
    .eq('org_id', orgId)
    .eq('status', 'active');
  if (error || !data) return [];
  return data
    .map((m) => ({
      user_id: String(m.user_id),
      // `full_name` peut etre vide sur un membre invite qui n'a pas encore
      // complete son profil : on ne montre jamais un identifiant technique,
      // donc un repli lisible plutot qu'un UUID dans un menu.
      nom: String(m.full_name || '').trim() || 'Membre sans nom',
    }))
    .sort((a, b) => a.nom.localeCompare(b.nom));
}

/**
 * Les etiquettes deja utilisees, proposees en autocompletion.
 *
 * `client_tags` est la table vivante — `clients.tags` existe en base mais
 * n'est ecrite nulle part dans le produit (verifie le 2026-09-24).
 */
export async function chargerEtiquettes(): Promise<string[]> {
  const { data, error } = await supabase
    .from('client_tags')
    .select('tag')
    .limit(500);
  if (error || !data) return [];
  return Array.from(new Set(data.map((t) => String(t.tag)).filter(Boolean))).sort();
}

// ── Dossiers ────────────────────────────────────────────────

export interface DossierAutomatisation {
  id: string;
  name: string;
  position: number;
  created_at: string;
}

/**
 * Les dossiers de l'organisation.
 *
 * Par le serveur et pas en PostgREST direct : la création doit renvoyer un
 * message clair sur le doublon de nom (l'index unique répond « 23505 »,
 * que personne ne sait lire).
 */
export async function chargerDossiers(): Promise<DossierAutomatisation[]> {
  const r = await fetch('/api/automations/folders', { headers: await entetes() });
  if (!r.ok) throw await erreurDe(r, 'Impossible de lire les dossiers.');
  return r.json();
}

export async function creerDossier(name: string): Promise<DossierAutomatisation> {
  const r = await fetch('/api/automations/folders', {
    method: 'POST', headers: await entetes(), body: JSON.stringify({ name }),
  });
  if (!r.ok) throw await erreurDe(r, 'Impossible de créer le dossier.');
  return r.json();
}

export async function renommerDossier(id: string, name: string): Promise<DossierAutomatisation> {
  const r = await fetch(`/api/automations/folders/${id}`, {
    method: 'PATCH', headers: await entetes(), body: JSON.stringify({ name }),
  });
  if (!r.ok) throw await erreurDe(r, 'Impossible de renommer le dossier.');
  return r.json();
}

/** Supprime le dossier — ses automatisations reviennent à la racine. */
export async function supprimerDossier(id: string): Promise<void> {
  const r = await fetch(`/api/automations/folders/${id}`, {
    method: 'DELETE', headers: await entetes(),
  });
  if (!r.ok) throw await erreurDe(r, 'Impossible de supprimer le dossier.');
}

/** Range une automatisation dans un dossier — `null` la remet à la racine. */
export async function rangerDansDossier(ruleId: string, folderId: string | null): Promise<void> {
  await modifierAutomatisation(ruleId, { folder_id: folderId });
}
