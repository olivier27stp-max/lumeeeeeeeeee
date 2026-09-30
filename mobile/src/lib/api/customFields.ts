// Champs personnalisés v2 (modèle GoHighLevel) — miroir mobile de
// src/lib/champsPersoApi.ts du web.
//
// ⚠️ Cette API passait avant par PostgREST sur `custom_columns` /
// `custom_column_values`. Ces deux tables ont été déplacées dans le schéma
// `archive` par la refonte du 2026-09-26 : PostgREST répondait 404 et, comme
// supabase-js ne lève pas, la carte disparaissait sans un mot. Tout passe
// maintenant par le serveur (server/routes/custom-fields.ts), qui porte la
// validation par type, l'unicité, la normalisation, les permissions de la page
// Rôles et les événements d'automatisation. Le mobile ne doit rien décider.

import { ServerError, serverGet, serverPut } from './server';

export const OBJETS_CHAMPS = ['client', 'deal', 'job', 'quote', 'invoice', 'property'] as const;
export type ObjetChamp = (typeof OBJETS_CHAMPS)[number];

/** Miroir de l'enum SQL cf_field_type. */
export const TYPES_CHAMP = [
  'single_line', 'multi_line', 'number', 'monetary', 'date', 'dropdown_single', 'dropdown_multi',
  'checkbox', 'phone', 'email', 'url', 'file',
] as const;
export type TypeChamp = (typeof TYPES_CHAMP)[number];

export interface ConfigChamp {
  decimals?: number | null;
  min?: number | null;
  max?: number | null;
  /** monetary : devise ISO, CAD par défaut. */
  currency?: string;
  /** date : date seule (défaut) ou date + heure. */
  include_time?: boolean;
  /** Champ retiré de la fiche côté web — la valeur reste en base. */
  masque_fiche?: boolean;
  /** Champ retiré de la fenêtre de CRÉATION — il reste sur la fiche. */
  masque_creation?: boolean;
}

export interface OptionChamp {
  id: string;
  label: string;
  color: string | null;
  position: number;
  archived_at: string | null;
}

export interface DossierChamp {
  id: string;
  object_type: ObjetChamp;
  name: string;
  position: number;
}

export interface ChampPerso {
  id: string;
  object_type: ObjetChamp;
  folder_id: string | null;
  key: string;
  label: string;
  placeholder: string | null;
  help_text: string | null;
  field_type: TypeChamp;
  config: ConfigChamp;
  /** Pré-remplissage à la création (texte, nombre, date, libellé d'option). */
  default_value?: string | number | string[] | boolean | null;
  is_required: boolean;
  position: number;
  archived_at: string | null;
  options: OptionChamp[];
}

/**
 * Valeur « à plat », telle que l'API la rend et l'accepte :
 *   texte/téléphone/courriel/url → string · nombre → number · montant → cents
 *   date → 'AAAA-MM-JJ' (ISO si include_time) · liste simple → id d'option
 *   liste multiple → ids d'options[] · case à cocher → booléen
 */
export type ValeurChamp = string | number | boolean | string[] | null;

export interface ValeurEnregistree {
  field_id: string;
  value: ValeurChamp;
  version: number;
  updated_at: string;
}

export interface FicheChamps {
  fields: ChampPerso[];
  folders: DossierChamp[];
  values: Record<string, ValeurEnregistree>;
}

/** Définitions + valeurs d'une fiche, en un appel (comme le web). */
export function lireChampsEtValeurs(objet: ObjetChamp, id: string): Promise<FicheChamps> {
  return serverGet<FicheChamps>(`/custom-values/${objet}/${id}`);
}

export interface ResultatEcriture {
  field_id: string;
  ok: boolean;
  changed: boolean;
  /** true = quelqu'un a modifié le champ depuis la lecture (version périmée). */
  conflict?: boolean;
  version: number | null;
  /** Refus du serveur, déjà en clair. */
  erreur?: string;
}

/**
 * Écrit une ou plusieurs valeurs. Ne lève PAS pour un refus par champ : la
 * route répond 422 (refus) ou 409 (conflit de version) en mettant le verdict de
 * chaque champ dans le corps — on le rend tel quel à l'appelant, qui décide
 * quoi afficher. Seule une vraie panne (réseau, 401, 500) lève.
 */
export async function ecrireValeurs(
  objet: ObjetChamp,
  id: string,
  valeurs: { field_id: string; value: ValeurChamp; version?: number | null }[],
): Promise<ResultatEcriture[]> {
  try {
    const r = await serverPut<{ results: ResultatEcriture[] }>(`/custom-values/${objet}/${id}`, { values: valeurs });
    return r.results ?? [];
  } catch (e) {
    const resultats = (e as ServerError)?.data as { results?: ResultatEcriture[] } | undefined;
    if (resultats?.results) return resultats.results;
    throw e;
  }
}

/**
 * Champs à afficher sur une fiche, dans l'ordre du web.
 *
 * On NE filtre PAS `archived_at` ici : le serveur a déjà tranché, et sa règle
 * est plus fine qu'un simple « on cache les archivés » — un champ archivé reste
 * visible sur une fiche s'il y porte encore une valeur (sinon la valeur
 * disparaîtrait de l'écran tout en existant en base). On ne retire que ce que le
 * bureau a explicitement sorti de la fiche.
 */
export function champsVisibles(fiche: FicheChamps): ChampPerso[] {
  return fiche.fields.filter((c) => !c.config?.masque_fiche).sort((a, b) => a.position - b.position);
}

/** Options encore proposables (une option archivée reste lisible, pas choisissable). */
export function optionsActives(champ: ChampPerso): OptionChamp[] {
  return (champ.options ?? []).filter((o) => !o.archived_at).sort((a, b) => a.position - b.position);
}

/** Définitions seules, sans fiche — pour un formulaire de CRÉATION. */
export interface ListeChamps {
  fields: ChampPerso[];
  folders: DossierChamp[];
}

export function listerChamps(objet: ObjetChamp): Promise<ListeChamps> {
  return serverGet<ListeChamps>(`/custom-fields?object=${objet}`);
}

/**
 * Champs à afficher dans un formulaire de création : ni archivés, ni « masqués
 * à la création » (le bureau peut sortir un champ de cette fenêtre tout en le
 * gardant sur la fiche — c'est le cas des 10 champs de dépenses).
 */
export function champsDeCreation(fields: ChampPerso[]): ChampPerso[] {
  return fields
    .filter((c) => !c.archived_at && !c.config?.masque_creation)
    .sort((a, b) => a.position - b.position);
}

/** Une valeur est-elle vide, au sens du serveur ? */
export function valeurVide(v: ValeurChamp | undefined): boolean {
  return v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
}

/**
 * Valeur de départ d'un champ (« Set default value » du bureau). Le défaut est
 * stocké en LIBELLÉ pour les listes, alors que la saisie attend un id d'option :
 * on traduit ici, comme le web.
 */
export function valeurParDefaut(champ: ChampPerso): ValeurChamp {
  const d = champ.default_value;
  if (d === null || d === undefined) return null;
  const actives = optionsActives(champ);
  const idDe = (libelle: string) => actives.find((o) => o.label === libelle)?.id;
  if (champ.field_type === 'dropdown_multi') {
    return (Array.isArray(d) ? d : [String(d)]).map(idDe).filter((x): x is string => !!x);
  }
  if (champ.field_type === 'dropdown_single') {
    return idDe(Array.isArray(d) ? (d[0] ?? '') : String(d)) ?? null;
  }
  return Array.isArray(d) ? null : d;
}
