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
import { interfaceEnFrancais } from './champs/messages';
import { appelServeur } from './appelServeur';
import type { AutomationRule } from './automationRulesApi';
import type { DeclencheurCatalogue, ActionCatalogue } from './automationCatalogue';
import type { ModeleAutomatisation } from './automationTemplates';

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
    // La langue de l'INTERFACE : le serveur répond dans cette langue
    // (server/lib/automations-langue.ts — audit V2, A-09).
    'Accept-Language': interfaceEnFrancais() ? 'fr' : 'en',
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
 *
 * L'erreur porte aussi le STATUT (`status`) : l'éditeur doit distinguer « cette
 * automatisation n'existe plus » (404 — réessayer ne servira jamais à rien)
 * d'une panne passagère (audit du 2026-10-01).
 */
async function erreurDe(reponse: Response, repli: string): Promise<Error> {
  let message = repli;
  try {
    const corps = await reponse.json();
    if (corps?.error && typeof corps.error === 'string') message = corps.error;
  } catch {
    // Corps illisible : le repli dit déjà l'essentiel.
  }
  return Object.assign(new Error(message), { status: reponse.status });
}

export async function chargerAutomatisations(): Promise<{
  rules: AutomationRule[];
  catalogue: CatalogueAutomatisations;
}> {
  const reponse = await appelServeur('/api/automations/rules', { headers: await entetes() });
  if (!reponse.ok) throw await erreurDe(reponse, 'Impossible de charger les automatisations.');
  return reponse.json();
}

/**
 * Ce que l'éditeur affiche : SA règle, le catalogue, et les autres
 * automatisations publiées (id, nom) — sans télécharger toutes les règles
 * (PERF-2). `ruleId` null = une nouvelle automatisation.
 */
export async function chargerEditeur(ruleId: string | null): Promise<{
  rule: AutomationRule | null;
  catalogue: CatalogueAutomatisations;
  autres: Array<{ id: string; name: string }>;
}> {
  const url = ruleId ? `/api/automations/editeur?rule_id=${encodeURIComponent(ruleId)}` : '/api/automations/editeur';
  const reponse = await appelServeur(url, { headers: await entetes() });
  if (!reponse.ok) throw await erreurDe(reponse, 'Impossible de charger cette automatisation.');
  return reponse.json();
}

export async function creerAutomatisation(brouillon: BrouillonAutomatisation): Promise<AutomationRule> {
  const reponse = await appelServeur('/api/automations/rules', {
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
  const reponse = await appelServeur(`/api/automations/rules/${id}`, {
    method: 'PATCH',
    headers: await entetes(),
    body: JSON.stringify(patch),
  });
  if (!reponse.ok) throw await erreurDe(reponse, 'Impossible de modifier l\'automatisation.');
  return reponse.json();
}

/**
 * Publier (`true`) ou repasser en brouillon (`false`) — par le serveur, qui
 * refuse un parcours cassé et NOMME les problèmes dans le message d'erreur
 * (audit M8). Plus aucune écriture directe du statut depuis le navigateur.
 */
export async function changerPublication(id: string, actif: boolean): Promise<void> {
  const reponse = await appelServeur(`/api/automations/rules/${id}/publication`, {
    method: 'POST',
    headers: await entetes(),
    body: JSON.stringify({ actif }),
  });
  if (!reponse.ok) throw await erreurDe(reponse, 'Impossible de changer le statut de l’automatisation.');
}

export interface ResultatPublicationLot {
  id: string;
  ok: boolean;
  erreur?: string;
}

/** Le même contrôle, pour plusieurs automatisations d'un coup (barre de lot). */
export async function changerPublicationEnLot(ids: string[], actif: boolean): Promise<ResultatPublicationLot[]> {
  const reponse = await appelServeur('/api/automations/rules/publication', {
    method: 'POST',
    headers: await entetes(),
    body: JSON.stringify({ ids, actif }),
  });
  if (!reponse.ok) throw await erreurDe(reponse, 'Impossible de changer le statut des automatisations.');
  const corps = await reponse.json() as { resultats?: ResultatPublicationLot[] };
  return corps.resultats ?? [];
}

/** Chiffres d'une automatisation sur 60 jours — voir server/routes/automation-stats.ts. */
export interface StatsRegle {
  declenches: number;
  en_cours: number;
  envoyes: number;
  /** Étapes sautées (pas de numéro, pas de courriel…) : ni envoi ni échec. */
  sautes: number;
  echecs: number;
  /** Motif en français de la dernière étape sautée (affiché tel quel). */
  dernier_saut: string | null;
}

export interface StatsEtape {
  envoyes: number;
  sautes: number;
  echecs: number;
  en_attente: number;
}

/**
 * Les statistiques, par UNE route agrégée : par automatisation, et par
 * étape quand `ruleId` est donné.
 */
export async function chargerStatistiques(ruleId?: string | null): Promise<{
  par_regle: Record<string, StatsRegle>;
  par_etape: Record<string, StatsEtape> | null;
  /** Le bureau a-t-il un numéro texto ? `null` = inconnu. */
  texto_configure?: boolean | null;
}> {
  const url = ruleId ? `/api/automations/rules/stats?rule_id=${encodeURIComponent(ruleId)}` : '/api/automations/rules/stats';
  const reponse = await appelServeur(url, { headers: await entetes() });
  if (!reponse.ok) throw await erreurDe(reponse, 'Impossible de lire les statistiques.');
  return reponse.json();
}

export async function dupliquerAutomatisation(id: string): Promise<AutomationRule> {
  const reponse = await appelServeur(`/api/automations/rules/${id}/duplicate`, {
    method: 'POST',
    headers: await entetes(),
  });
  if (!reponse.ok) throw await erreurDe(reponse, 'Impossible de dupliquer l\'automatisation.');
  return reponse.json();
}

// ─── Bibliothèque de modèles ─────────────────────────────────────────
/** Le catalogue global (lecture seule) : ouvrir la bibliothèque n'écrit rien. */
export async function fetchModelesAutomatisation(): Promise<ModeleAutomatisation[]> {
  const reponse = await fetch('/api/automations/templates', { headers: await entetes() });
  if (!reponse.ok) throw await erreurDe(reponse, 'Impossible de charger les modèles.');
  const corps = (await reponse.json()) as { modeles: ModeleAutomatisation[] };
  return corps.modeles;
}

/**
 * « Utiliser ce modèle » : crée UNE automatisation en brouillon. Seul
 * l'identifiant du modèle part ; l'entreprise est celle de la session. La clé
 * d'idempotence fait qu'un double clic ne crée qu'une copie.
 */
export async function utiliserModele(templateId: string, cleIdempotence: string): Promise<AutomationRule> {
  const reponse = await fetch('/api/automations/templates/utiliser', {
    method: 'POST',
    headers: { ...(await entetes()), 'Idempotency-Key': cleIdempotence },
    body: JSON.stringify({ templateId }),
  });
  if (!reponse.ok) throw await erreurDe(reponse, 'Impossible de créer l’automatisation.');
  return reponse.json();
}

// ─── Copier vers d'autres bureaux ───────────────────────────────────
export interface BureauCible { org_id: string; name: string }
export interface ResultatCopie {
  org_id: string;
  name: string;
  statut: 'copiee' | 'mise_a_jour' | 'preset_mis_a_jour' | 'existe_deja' | 'sans_droit' | 'echec';
  active?: boolean;
  a_revoir?: string[];
  rule_id?: string;
  erreur?: string;
}

/** Bureaux de l'entreprise (hors bureau actif) où l'on peut modifier les automatisations. */
export async function chargerBureauxCibles(): Promise<BureauCible[]> {
  const reponse = await appelServeur('/api/automations/bureaux-cibles', { headers: await entetes() });
  if (!reponse.ok) throw await erreurDe(reponse, 'Impossible de lister vos bureaux.');
  return (await reponse.json()).offices;
}

/** `lier` : les copies suivent cette automatisation (défaut). */
export async function copierVersBureaux(id: string, orgIds: string[], lier = true): Promise<ResultatCopie[]> {
  const reponse = await appelServeur(`/api/automations/rules/${id}/copier-bureaux`, {
    method: 'POST',
    headers: await entetes(),
    body: JSON.stringify({ org_ids: orgIds, lier }),
  });
  if (!reponse.ok) throw await erreurDe(reponse, 'Impossible de copier l’automatisation.');
  return (await reponse.json()).results;
}

export async function supprimerAutomatisation(id: string): Promise<void> {
  const reponse = await appelServeur(`/api/automations/rules/${id}`, {
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
  /** Coût de CETTE génération, en cents (null si inconnu). */
  cout_cents?: number | null;
  /**
   * Une deuxième automatisation sur un AUTRE déclencheur (ex. « quand le
   * client répond, envoie mon lien Calendly »). L'éditeur la crée à part,
   * en brouillon.
   */
  autre?: {
    nom: string;
    trigger_event: string;
    resume: string;
    steps: unknown[];
    une_fois_par_client_jours?: number;
  } | null;
}

/**
 * Demande à Lumi de construire un parcours à partir d'une phrase.
 *
 * Il PROPOSE : rien n'est enregistré. Ce qui revient est dessiné dans le
 * canevas, et c'est l'utilisateur qui décide de le garder — la règle du
 * projet veut qu'une écriture ne soit jamais exécutée par l'orchestrateur.
 */
export async function genererParcoursAvecLumi(
  demande: string,
  langue: 'fr' | 'en',
  /**
   * Ce que Lumi doit savoir pour MODIFIER au lieu de tout refaire :
   * les échanges précédents et le parcours à l'écran.
   *
   * Sans eux, « change le délai à 7 jours » reconstruisait tout depuis
   * cette seule phrase — QA du 2026-09-25 (P1-6, P1-7).
   */
  contexte?: {
    echanges?: Array<{ role: 'user' | 'assistant'; content: string }>;
    parcoursActuel?: { trigger_event?: string; steps?: unknown[] } | null;
    /** L'automatisation ouverte : le serveur y garde la conversation. */
    ruleId?: string | null;
  },
): Promise<ParcoursPropose> {
  const reponse = await appelServeur('/api/automations/rules/generer', {
    method: 'POST',
    headers: await entetes(),
    body: JSON.stringify({
      demande,
      langue,
      echanges: contexte?.echanges,
      parcours_actuel: contexte?.parcoursActuel ?? null,
      rule_id: contexte?.ruleId ?? null,
    }),
  });
  if (!reponse.ok) {
    // `brouillon_retire` : le serveur a retiré le brouillon vide né de cet envoi.
    const corps = await reponse.clone().json().catch(() => null) as { brouillon_retire?: boolean } | null;
    const erreur = await erreurDe(reponse, 'Lumi n’a pas pu construire ce parcours.');
    if (corps?.brouillon_retire) (erreur as Error & { brouillonRetire?: boolean }).brouillonRetire = true;
    throw erreur;
  }
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
  const r = await appelServeur('/api/automations/folders', { headers: await entetes() });
  if (!r.ok) throw await erreurDe(r, 'Impossible de lire les dossiers.');
  return r.json();
}

export async function creerDossier(name: string): Promise<DossierAutomatisation> {
  const r = await appelServeur('/api/automations/folders', {
    method: 'POST', headers: await entetes(), body: JSON.stringify({ name }),
  });
  if (!r.ok) throw await erreurDe(r, 'Impossible de créer le dossier.');
  return r.json();
}

export async function renommerDossier(id: string, name: string): Promise<DossierAutomatisation> {
  const r = await appelServeur(`/api/automations/folders/${id}`, {
    method: 'PATCH', headers: await entetes(), body: JSON.stringify({ name }),
  });
  if (!r.ok) throw await erreurDe(r, 'Impossible de renommer le dossier.');
  return r.json();
}

/** Supprime le dossier — ses automatisations reviennent à la racine. */
export async function supprimerDossier(id: string): Promise<void> {
  const r = await appelServeur(`/api/automations/folders/${id}`, {
    method: 'DELETE', headers: await entetes(),
  });
  if (!r.ok) throw await erreurDe(r, 'Impossible de supprimer le dossier.');
}

/** Range une automatisation dans un dossier — `null` la remet à la racine. */
export async function rangerDansDossier(ruleId: string, folderId: string | null): Promise<void> {
  await modifierAutomatisation(ruleId, { folder_id: folderId });
}

// ── Aperçu (« Tester ») ─────────────────────────────────────

export interface ApercuAutomatisation {
  client?: { nom: string; email: string | null; telephone: string | null };
  apercu: Array<{ action: string; nom: string | null; rendu: Record<string, string> }>;
  message?: string;
}

/**
 * Ce qui partirait, et à qui — sans rien envoyer.
 *
 * Le serveur prend un vrai client de l'organisation et résout les variables
 * comme le moteur le ferait. Un texte écrit avec une variable qui n'existe
 * pas donne « Bonjour , » : ça saute aux yeux dans un aperçu, jamais dans
 * un éditeur.
 */
export async function apercuAutomatisation(id: string): Promise<ApercuAutomatisation> {
  const r = await appelServeur(`/api/automations/rules/${id}/apercu`, {
    method: 'POST', headers: await entetes(),
  });
  if (!r.ok) throw await erreurDe(r, "Impossible de préparer l'aperçu.");
  return r.json();
}

/**
 * Sort une automatisation de la corbeille.
 *
 * Elle revient en BROUILLON, jamais publiée : restaurer ne doit pas
 * relancer des envois à l'insu de qui restaure.
 */
export async function restaurerAutomatisation(id: string): Promise<AutomationRule> {
  const r = await appelServeur(`/api/automations/rules/${id}/restaurer`, {
    method: 'POST', headers: await entetes(),
  });
  if (!r.ok) throw await erreurDe(r, "Impossible de restaurer l'automatisation.");
  return r.json();
}

/**
 * Vide une ligne de la corbeille : l'automatisation ne se restaure plus et
 * disparaît des listes. Son historique d'envois est conservé (preuve de ce
 * qui a été envoyé aux clients).
 */
export async function supprimerDefinitivementAutomatisation(id: string): Promise<void> {
  const r = await appelServeur(`/api/automations/rules/${id}/definitivement`, {
    method: 'DELETE', headers: await entetes(),
  });
  if (!r.ok) throw await erreurDe(r, 'Impossible de supprimer définitivement l’automatisation.');
}
