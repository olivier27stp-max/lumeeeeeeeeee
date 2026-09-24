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
import { valeurCsv, valeurDepuisTexte } from './champs/valeurs';
import { messageChamps } from './champs/messages';
import type { IndustrieModele } from './champs/modeles';

export type { ChampPerso, DossierChamp, ObjetChamp, TypeChamp, ValeurChamp, ValeurEnregistree, Condition };

async function entetes(): Promise<HeadersInit> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error(messageChamps('Session expirée.'));
  const orgId = await getCurrentOrgId();
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    ...(orgId ? { 'x-org-id': orgId } : {}),
  };
}

/** Industrie de l'entreprise (inscription) si un modèle de champs existe pour elle. */
export async function lireIndustrie(): Promise<IndustrieModele | null> {
  return (await appel<{ industry: IndustrieModele | null }>('/api/custom-fields/templates', {}, 'Impossible de charger les champs.')).industry;
}

/** Crée les champs suggérés cochés (rejouable : les clés déjà prises sont sautées). */
export async function installerModele(industrie: IndustrieModele, ids: string[], langue: 'fr' | 'en') {
  return appel<{ crees: number; deja: number }>('/api/custom-fields/templates', {
    method: 'POST', body: JSON.stringify({ industry: industrie, ids, language: langue }),
  }, 'Impossible de créer le champ.');
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
    throw new ErreurApiChamps(messageChamps(message), reponse.status, corps);
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
  // Les refus par champ arrivent en français (serveur) : affichés dans la langue de l'interface.
  if (corps?.results) return corps.results.map((r) => (r.erreur ? { ...r, erreur: messageChamps(r.erreur) } : r));
  throw new Error(messageChamps(corps?.error || 'Impossible d’enregistrer.'));
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

/** En-tête normalisé : minuscules, sans accents ni ponctuation. */
const normEntete = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Colonnes d'un fichier importé qui correspondent à des champs personnalisés :
 * par libellé (« Superficie »), par clé (« superficie ») ou par variable
 * (« client_cf_superficie »). Vide si la fonction est coupée.
 */
export async function correspondancesImport(
  objets: ObjetChamp[], entetes: string[],
  /** Colonnes déjà lues comme champs standard (prénom, courriel…) : jamais réinterprétées. */
  ignorer: readonly number[] = [],
): Promise<Array<{ index: number; champ: ChampPerso }>> {
  const listes = await Promise.all(objets.map((o) => listerChamps(o)));
  if (!listes.some((l) => l.enabled)) return [];
  const champs = listes.flatMap((l) => l.fields).filter((c) => !c.archived_at);
  const res: Array<{ index: number; champ: ChampPerso }> = [];
  entetes.forEach((e, index) => {
    const n = normEntete(e);
    if (!n || ignorer.includes(index)) return;
    const champ = champs.find((c) => normEntete(c.label) === n || normEntete(c.key) === n || normEntete(`${c.object_type}_cf_${c.key}`) === n);
    if (champ) res.push({ index, champ });
  });
  return res;
}

/**
 * Écrit les champs personnalisés d'une ligne importée dans le pipeline :
 * champs d'opportunité sur le deal (s'il vient d'être créé), champs client
 * sur le client du deal. Renvoie les refus (message), jamais d'exception.
 */
export async function ecrireChampsImport(
  colonnes: Array<{ index: number; champ: ChampPerso }>, cellules: string[], dealId: string | null,
): Promise<string[]> {
  const refus: string[] = [];
  const valeurs = (objet: ObjetChamp) => colonnes
    .filter((c) => c.champ.object_type === objet)
    .map(({ index, champ }) => ({ field_id: champ.id, value: valeurDepuisTexte(champ, cellules[index] ?? '') }))
    .filter((v) => v.value !== null);
  try {
    if (dealId && valeurs('deal').length) {
      refus.push(...(await ecrireValeurs('deal', dealId, valeurs('deal'))).filter((r) => !r.ok).map((r) => r.erreur ?? messageChamps('refusé')));
    }
    if (dealId && valeurs('client').length) {
      const { data, error } = await supabase.from('deals').select('client_id').eq('id', dealId).maybeSingle();
      if (error) throw error;
      if (data?.client_id) {
        refus.push(...(await ecrireValeurs('client', data.client_id as string, valeurs('client'))).filter((r) => !r.ok).map((r) => r.erreur ?? messageChamps('refusé')));
      }
    }
  } catch (err) {
    console.error('[champsPersoApi] import : champs personnalisés', err);
    refus.push(err instanceof Error ? err.message : String(err));
  }
  return refus;
}
