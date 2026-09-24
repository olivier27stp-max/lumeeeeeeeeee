/* ═══════════════════════════════════════════════════════════════
   API — champs personnalisés v2 (modèle GoHighLevel)

   Tout passe par le serveur (server/routes/custom-fields.ts →
   customFieldsService) : validation par type, normalisation, unicité,
   événements d'automatisation. Aucune écriture directe dans PostgREST.
   Même idiome que automationBuilderApi : Bearer + x-org-id, et le message
   d'erreur du serveur (en clair, en français) est celui qu'on montre.
   ═══════════════════════════════════════════════════════════════ */

import { supabase } from './supabase';
import { getCurrentOrgId } from './orgApi';
import type {
  ChampPerso, ConfigChamp, DossierChamp, ObjetChamp, TypeChamp, ValeurChamp, ValeurEnregistree,
} from './champs/types';
import type { ChampStandard } from './champs/standard';
import type { Condition } from './champs/filtres';
import { valeurCsv } from './champs/valeurs';

export type { ChampPerso, DossierChamp, ObjetChamp, TypeChamp, ValeurChamp, ValeurEnregistree, Condition };

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

/** Erreur du serveur, avec son corps (doublons, impact…) quand il y en a un. */
export class ErreurApiChamps extends Error {
  constructor(message: string, public status: number, public corps: Record<string, unknown> | null) {
    super(message);
    this.name = 'ErreurApiChamps';
  }
}

async function appel<T>(chemin: string, init: RequestInit = {}, repli = 'Action impossible.'): Promise<T> {
  const reponse = await fetch(chemin, { ...init, headers: await entetes() });
  let corps: Record<string, unknown> | null = null;
  try { corps = await reponse.json(); } catch { corps = null; }
  if (!reponse.ok) {
    const message = typeof corps?.error === 'string' ? corps.error : repli;
    throw new ErreurApiChamps(message, reponse.status, corps);
  }
  return corps as T;
}

// ── Définitions ─────────────────────────────────────────────────

export interface ListeChamps {
  enabled: boolean;
  fields: ChampPerso[];
  folders: DossierChamp[];
  standard: Record<ObjetChamp, ChampStandard[]>;
}

export function listerChamps(objet?: ObjetChamp, inclureArchives = false): Promise<ListeChamps> {
  const q = new URLSearchParams();
  if (objet) q.set('object', objet);
  if (inclureArchives) q.set('include_archived', '1');
  return appel<ListeChamps>(`/api/custom-fields?${q}`, {}, 'Impossible de charger les champs.');
}

export interface EntreeOption { id?: string; label: string; color?: string | null }
export interface EntreeChamp {
  label: string;
  field_type: TypeChamp;
  key?: string;
  placeholder?: string | null;
  help_text?: string | null;
  is_required?: boolean;
  is_searchable?: boolean;
  config?: ConfigChamp;
  options?: EntreeOption[];
}

export async function creerChamp(objet: ObjetChamp, e: EntreeChamp & { folder_id?: string | null }): Promise<ChampPerso> {
  const r = await appel<{ field: ChampPerso }>('/api/custom-fields', {
    method: 'POST', body: JSON.stringify({ ...e, object_type: objet }),
  }, 'Impossible de créer le champ.');
  return r.field;
}

export async function modifierChamp(
  id: string,
  patch: Partial<Omit<EntreeChamp, 'key' | 'is_searchable'>> & { folder_id?: string | null; position?: number },
): Promise<ChampPerso> {
  const r = await appel<{ field: ChampPerso }>(`/api/custom-fields/${id}`, {
    method: 'PATCH', body: JSON.stringify(patch),
  }, 'Impossible de modifier le champ.');
  return r.field;
}

export async function archiverChamp(id: string, archive = true): Promise<ChampPerso> {
  const r = await appel<{ field: ChampPerso }>(`/api/custom-fields/${id}/archive`, {
    method: 'POST', body: JSON.stringify({ archive }),
  }, archive ? 'Impossible d’archiver le champ.' : 'Impossible de restaurer le champ.');
  return r.field;
}

export interface ImpactChamp {
  valeurs: number;
  automatisations: { id: string; name: string }[];
  modeles: { id: string; name: string }[];
  pipelines: { id: string; name: string }[];
  formulaires: { id: string; name: string }[];
}

export async function impactChamp(id: string): Promise<ImpactChamp> {
  return (await appel<{ impact: ImpactChamp }>(`/api/custom-fields/${id}/impact`, {}, 'Impossible de mesurer l’impact.')).impact;
}

export async function purgerChamp(id: string, valeursConfirmees: number): Promise<void> {
  await appel(`/api/custom-fields/${id}`, {
    method: 'DELETE', body: JSON.stringify({ valeurs_confirmees: valeursConfirmees }),
  }, 'Impossible de supprimer le champ.');
}

export async function majCherchables(objet: ObjetChamp, ids: string[]): Promise<void> {
  await appel('/api/custom-fields/searchable', {
    method: 'PUT', body: JSON.stringify({ object_type: objet, field_ids: ids }),
  }, 'Impossible d’enregistrer les champs cherchables.');
}

export interface Doublon { value_normalized: string; nb: number; entites: string[] }

/** Renvoie les doublons qui bloquent (liste vide = activé). */
export async function majUnique(fieldId: string, unique: boolean): Promise<Doublon[]> {
  try {
    await appel('/api/custom-fields/unique', {
      method: 'PUT', body: JSON.stringify({ field_id: fieldId, unique }),
    }, 'Impossible de modifier l’unicité.');
    return [];
  } catch (err) {
    if (err instanceof ErreurApiChamps && err.status === 409 && Array.isArray(err.corps?.doublons)) {
      return err.corps!.doublons as Doublon[];
    }
    throw err;
  }
}

// ── Dossiers ────────────────────────────────────────────────────

export async function creerDossier(objet: ObjetChamp, nom: string, champs: EntreeChamp[] = []): Promise<string> {
  return (await appel<{ id: string }>('/api/custom-field-folders', {
    method: 'POST', body: JSON.stringify({ object_type: objet, name: nom, fields: champs }),
  }, 'Impossible de créer le dossier.')).id;
}

export async function renommerDossier(id: string, nom: string): Promise<void> {
  await appel(`/api/custom-field-folders/${id}`, { method: 'PATCH', body: JSON.stringify({ name: nom }) },
    'Impossible de renommer le dossier.');
}

export async function supprimerDossier(id: string): Promise<void> {
  await appel(`/api/custom-field-folders/${id}`, { method: 'DELETE' }, 'Impossible de supprimer le dossier.');
}

// ── Valeurs ─────────────────────────────────────────────────────

export interface FicheChamps {
  fields: ChampPerso[];
  folders: DossierChamp[];
  values: Record<string, ValeurEnregistree>;
}

export function lireValeurs(objet: ObjetChamp, id: string): Promise<FicheChamps> {
  return appel<FicheChamps>(`/api/custom-values/${objet}/${id}`, {}, 'Impossible de charger les champs.');
}

export async function lireValeursLot(objet: ObjetChamp, ids: string[]): Promise<Record<string, Record<string, ValeurEnregistree>>> {
  if (ids.length === 0) return {};
  return (await appel<{ values: Record<string, Record<string, ValeurEnregistree>> }>(`/api/custom-values/${objet}/batch`, {
    method: 'POST', body: JSON.stringify({ ids }),
  }, 'Impossible de charger les champs.')).values;
}

export interface ResultatEcriture { field_id: string; ok: boolean; changed: boolean; conflict?: boolean; version: number | null; erreur?: string }

/** Écrit une ou plusieurs valeurs. Ne lève pas pour un refus par champ : lis `ok`/`erreur`. */
export async function ecrireValeurs(
  objet: ObjetChamp, id: string, valeurs: { field_id: string; value: ValeurChamp; version?: number | null }[],
): Promise<ResultatEcriture[]> {
  const reponse = await fetch(`/api/custom-values/${objet}/${id}`, {
    method: 'PUT', headers: await entetes(), body: JSON.stringify({ values: valeurs }),
  });
  const corps = await reponse.json().catch(() => null) as { results?: ResultatEcriture[]; error?: string } | null;
  if (corps?.results) return corps.results;
  throw new Error(corps?.error || 'Impossible d’enregistrer.');
}

// ── Filtres, cartes ─────────────────────────────────────────────

export async function filtrerParChamps(objet: ObjetChamp, conditions: Condition[], ids?: string[]): Promise<string[]> {
  return (await appel<{ ids: string[] }>('/api/custom-fields/filter', {
    method: 'POST', body: JSON.stringify({ object_type: objet, conditions, ids: ids ?? null }),
  }, 'Impossible de filtrer.')).ids;
}

export async function lireCartesPipeline(pipelineId: string): Promise<string[]> {
  return (await appel<{ field_ids: string[] }>(`/api/custom-fields/pipeline-cards/${pipelineId}`, {},
    'Impossible de charger l’affichage des cartes.')).field_ids;
}

export async function majCartesPipeline(pipelineId: string, fieldIds: string[]): Promise<void> {
  await appel(`/api/custom-fields/pipeline-cards/${pipelineId}`, {
    method: 'PUT', body: JSON.stringify({ field_ids: fieldIds }),
  }, 'Impossible d’enregistrer l’affichage des cartes.');
}

/** Fuseau de l'entreprise (company_settings.timezone), America/Toronto par défaut. */
export async function lireFuseau(): Promise<string> {
  const orgId = await getCurrentOrgId();
  if (!orgId) return 'America/Toronto';
  const { data, error } = await supabase.from('company_settings').select('timezone').eq('org_id', orgId).maybeSingle();
  if (error) console.error('[champsPersoApi] fuseau illisible', error.message);
  return (data?.timezone as string | undefined) || 'America/Toronto';
}

/**
 * Colonnes de champs personnalisés pour un export CSV : en-têtes (libellés)
 * et, par fiche, les valeurs dans le même ordre. Vide si le drapeau
 * `custom_fields_v2` est coupé ou si l'objet n'a aucun champ : l'export
 * sort alors exactement comme avant.
 */
export async function colonnesChampsCsv(
  objet: ObjetChamp, ids: string[], fr: boolean,
): Promise<{ entetes: string[]; valeurs: (id: string) => string[] }> {
  const vide = { entetes: [] as string[], valeurs: () => [] as string[] };
  if (ids.length === 0) return vide;
  const liste = await listerChamps(objet);
  if (!liste.enabled || liste.fields.length === 0) return vide;
  const toutes: Record<string, Record<string, ValeurEnregistree>> = {};
  for (let i = 0; i < ids.length; i += 2000) Object.assign(toutes, await lireValeursLot(objet, ids.slice(i, i + 2000)));
  return {
    entetes: liste.fields.map((c) => c.label),
    valeurs: (id) => liste.fields.map((c) => valeurCsv(c, toutes[id]?.[c.id]?.value, fr)),
  };
}
