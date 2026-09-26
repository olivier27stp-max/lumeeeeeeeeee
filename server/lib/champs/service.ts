/**
 * customFieldsService — LE seul chemin d'écriture des champs personnalisés.
 *
 * Routes (/api/custom-fields…), outils MCP/Lumi (list_custom_fields,
 * set_custom_field), automatisations (action « mettre à jour un champ »),
 * formulaires de demande (mapping réponse → champ) : tous passent ici.
 * Aucune route n'écrit dans les tables directement.
 *
 * Le client reçu est celui de l'appelant : à l'identité de l'utilisateur
 * (RLS appliquée) ou le client service (automatisations, formulaire
 * public). Dans les deux cas on filtre EXPLICITEMENT par org_id — la RLS
 * est la deuxième ceinture, pas la seule.
 *
 * La base valide et normalise tout (triggers) ; ce service valide AVANT
 * pour renvoyer un message clair, et orchestre ce que la base ne fait pas :
 * événements d'automatisation, variables de modèles, filtre de fonctionnalité.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  OBJETS, TYPES_CHAMP, TYPES_UNIQUES, TYPES_CHERCHABLES, conversionPermise, colonneEntite, variableModele,
  type ChampPerso, type ConfigChamp, type DossierChamp, type ObjetChamp, type OptionChamp, type TypeChamp,
  type ValeurChamp, type ValeurEnregistree,
} from '../../../src/lib/champs/types';
import { clesStandard } from '../../../src/lib/champs/standard';
import { preparerValeur, lireValeur, formaterValeur, ErreurValeur } from '../../../src/lib/champs/valeurs';
import type { Condition } from '../../../src/lib/champs/filtres';
import { eventBus } from '../eventBus';
import { logger } from '../logger';
import { champsDuModele, estIndustrieModele, type IndustrieModele } from '../../../src/lib/champs/modeles';

/** Drapeau de fonctionnalité (table org_features) — l'UI v2 et ses points d'entrée. */

export class ErreurChamps extends Error {
  constructor(message: string, public status = 400, public details?: unknown) {
    super(message);
    this.name = 'ErreurChamps';
  }
}

/** Erreur Postgres/PostgREST → message utilisateur + statut HTTP. */
function traduireErreur(error: { code?: string; message?: string; details?: string } | null, contexte: string): never {
  const code = error?.code ?? '';
  const msg = error?.message ?? 'erreur inconnue';
  if (code === '23505') throw new ErreurChamps(msg.includes('custom_fields_cle_uq') || msg.includes('clé')
    ? 'Cette clé est déjà utilisée ou réservée.'
    : msg.includes('custom_field_values_unique_uniq')
      ? 'Cette valeur existe déjà sur une autre fiche : le champ exige une valeur unique.'
      : msg.includes('custom_field_folders_nom_uniq') ? 'Un dossier porte déjà ce nom.' : 'Doublon refusé.', 409);
  if (code === '22023' || code === '23514' || code === '22P02' || code === '22007') throw new ErreurChamps(msg, 400);
  if (code === '42501') throw new ErreurChamps('Permission refusée.', 403);
  if (code === 'P0002') throw new ErreurChamps(msg, 404);
  if (code === '23503') throw new ErreurChamps(msg.includes('custom_field_values_field_fk')
    ? 'Ce champ porte encore des valeurs : archive-le, ou purge-le depuis son rapport d’impact.'
    : 'Référence introuvable (fiche, dossier ou option).', 409);
  if (code === '55006' || code === '40001') throw new ErreurChamps(msg, 409);
  logger.error(`[champs] ${contexte}`, { code, message: msg });
  throw new ErreurChamps(`Impossible de ${contexte}.`, 500);
}

export function estObjet(x: unknown): x is ObjetChamp {
  return typeof x === 'string' && (OBJETS as readonly string[]).includes(x);
}

// ─── Lecture des définitions ─────────────────────────────────────

const COLONNES_CHAMP = 'id, object_type, folder_id, key, label, placeholder, help_text, field_type, config, is_required, is_searchable, is_unique, position, created_at, updated_at, archived_at';

export async function listerChamps(
  db: SupabaseClient, orgId: string,
  opts: { objet?: ObjetChamp; inclureArchives?: boolean; ids?: string[] } = {},
): Promise<{ champs: ChampPerso[]; dossiers: DossierChamp[] }> {
  let q = db.from('custom_fields').select(COLONNES_CHAMP).eq('org_id', orgId)
    .order('object_type').order('position').order('created_at');
  if (opts.objet) q = q.eq('object_type', opts.objet);
  if (!opts.inclureArchives) q = q.is('archived_at', null);
  if (opts.ids) q = q.in('id', opts.ids.length ? opts.ids : ['00000000-0000-0000-0000-000000000000']);
  const { data: champs, error } = await q;
  if (error) traduireErreur(error, 'lire les champs personnalisés');

  const ids = (champs ?? []).map((c) => c.id as string);
  let options: (OptionChamp & { field_id: string })[] = [];
  if (ids.length) {
    const { data, error: eo } = await db.from('custom_field_options')
      .select('id, field_id, label, color, position, archived_at')
      .eq('org_id', orgId).in('field_id', ids).order('position');
    if (eo) traduireErreur(eo, 'lire les options');
    options = (data ?? []) as typeof options;
  }
  let dq = db.from('custom_field_folders').select('id, object_type, name, position, created_at')
    .eq('org_id', orgId).order('position').order('created_at');
  if (opts.objet) dq = dq.eq('object_type', opts.objet);
  const { data: dossiers, error: ed } = await dq;
  if (ed) traduireErreur(ed, 'lire les dossiers');

  return {
    champs: (champs ?? []).map((c) => ({
      ...(c as Omit<ChampPerso, 'options'>),
      config: (c.config ?? {}) as ConfigChamp,
      options: options.filter((o) => o.field_id === c.id).map(({ field_id: _f, ...o }) => o),
    })),
    dossiers: (dossiers ?? []) as DossierChamp[],
  };
}

async function unChamp(db: SupabaseClient, orgId: string, id: string, inclureArchives = true): Promise<ChampPerso> {
  const { champs } = await listerChamps(db, orgId, { ids: [id], inclureArchives });
  if (!champs[0]) throw new ErreurChamps('Champ personnalisé introuvable.', 404);
  return champs[0];
}

// ─── Écriture des définitions ────────────────────────────────────

export interface EntreeOption { id?: string; label: string; color?: string | null }
export interface EntreeChamp {
  object_type: ObjetChamp;
  label: string;
  field_type: TypeChamp;
  key?: string;
  folder_id?: string | null;
  placeholder?: string | null;
  help_text?: string | null;
  is_required?: boolean;
  is_searchable?: boolean;
  config?: ConfigChamp;
  options?: EntreeOption[];
}

function verifierEntree(e: Pick<EntreeChamp, 'object_type' | 'field_type' | 'key' | 'options' | 'config' | 'is_searchable'>) {
  if (!estObjet(e.object_type)) throw new ErreurChamps('Objet inconnu.');
  if (!(TYPES_CHAMP as readonly string[]).includes(e.field_type)) throw new ErreurChamps('Type de champ inconnu.');
  if (e.key && clesStandard(e.object_type).includes(e.key)) {
    throw new ErreurChamps(`« ${e.key} » est la clé d’un champ standard : choisis-en une autre.`, 409);
  }
  const avecOptions = e.field_type === 'dropdown_single' || e.field_type === 'dropdown_multi';
  if (avecOptions && (!e.options || e.options.length === 0)) throw new ErreurChamps('Une liste a besoin d’au moins une option.');
  if (!avecOptions && e.options && e.options.length > 0) throw new ErreurChamps('Seule une liste porte des options.');
  if (e.options) {
    const vus = new Set<string>();
    for (const o of e.options) {
      const l = o.label.trim().toLowerCase();
      if (!l) throw new ErreurChamps('Une option ne peut pas être vide.');
      if (vus.has(l)) throw new ErreurChamps(`L’option « ${o.label} » est en double.`);
      vus.add(l);
    }
  }
  if (e.is_searchable && !TYPES_CHERCHABLES.includes(e.field_type)) throw new ErreurChamps('Ce type de champ ne peut pas être cherchable.');
  const c = e.config ?? {};
  if (c.min != null && c.max != null && c.min > c.max) throw new ErreurChamps('Le minimum dépasse le maximum.');
}

function configPour(type: TypeChamp, c: ConfigChamp = {}): ConfigChamp {
  // Seules les clés du type survivent : un vieux « decimals » n'a rien à faire sur une date.
  // `show_on_documents` vaut pour tous les types (devis / facture).
  // `masque_creation` aussi : retiré de la fenêtre de création (« Gérer les champs »).
  const doc: ConfigChamp = {
    ...(c.show_on_documents ? { show_on_documents: true } : {}),
    ...(c.masque_creation ? { masque_creation: true } : {}),
    ...(c.masque_fiche ? { masque_fiche: true } : {}),
  };
  if (type === 'number') return { decimals: c.decimals ?? null, min: c.min ?? null, max: c.max ?? null, ...doc };
  if (type === 'monetary') return { currency: (c.currency || 'CAD').toUpperCase(), ...doc };
  if (type === 'date') return { include_time: !!c.include_time, ...doc };
  return doc;
}

export async function creerChamp(db: SupabaseClient, orgId: string, e: EntreeChamp): Promise<ChampPerso> {
  verifierEntree(e);
  const { data, error } = await db.rpc('cf_creer_champ', {
    p_org: orgId, p_object: e.object_type, p_folder: e.folder_id ?? null,
    p_champ: {
      label: e.label.trim(), field_type: e.field_type, key: e.key ?? '',
      placeholder: e.placeholder ?? null, help_text: e.help_text ?? null,
      is_required: !!e.is_required, is_searchable: !!e.is_searchable,
      config: configPour(e.field_type, e.config), options: e.options ?? [],
    },
  });
  if (error) traduireErreur(error, 'créer le champ');
  return unChamp(db, orgId, data as string);
}

export interface PatchChamp {
  label?: string;
  placeholder?: string | null;
  help_text?: string | null;
  folder_id?: string | null;
  is_required?: boolean;
  field_type?: TypeChamp;
  config?: ConfigChamp;
  position?: number;
  options?: EntreeOption[];
}

export async function modifierChamp(db: SupabaseClient, orgId: string, id: string, p: PatchChamp): Promise<ChampPerso> {
  const avant = await unChamp(db, orgId, id);
  const type = p.field_type ?? avant.field_type;
  if (!conversionPermise(avant.field_type, type)) {
    throw new ErreurChamps(`Conversion ${avant.field_type} → ${type} refusée : seules les conversions sans perte sont permises.`);
  }
  if (p.options) verifierEntree({ object_type: avant.object_type, field_type: type, options: p.options });
  const maj: Record<string, unknown> = {};
  if (p.label !== undefined) maj.label = p.label.trim();
  if (p.placeholder !== undefined) maj.placeholder = p.placeholder || null;
  if (p.help_text !== undefined) maj.help_text = p.help_text || null;
  if (p.folder_id !== undefined) maj.folder_id = p.folder_id;
  if (p.is_required !== undefined) maj.is_required = p.is_required;
  if (p.position !== undefined) maj.position = p.position;
  if (p.field_type !== undefined && p.field_type !== avant.field_type) {
    maj.field_type = type;
    // Un champ unique qui devient multi-lignes perd son unicité (CHECK).
    if (avant.is_unique && !TYPES_UNIQUES.includes(type)) maj.is_unique = false;
    if (avant.is_searchable && !TYPES_CHERCHABLES.includes(type)) maj.is_searchable = false;
  }
  if (p.config !== undefined || maj.field_type) maj.config = configPour(type, { ...avant.config, ...(p.config ?? {}) });
  if (Object.keys(maj).length) {
    const { error } = await db.from('custom_fields').update(maj).eq('org_id', orgId).eq('id', id).select('id').single();
    if (error) traduireErreur(error, 'modifier le champ');
  }
  if (p.options) {
    const { error } = await db.rpc('cf_maj_options', { p_field: id, p_options: p.options });
    if (error) traduireErreur(error, 'modifier les options');
  }
  return unChamp(db, orgId, id);
}

export async function archiverChamp(db: SupabaseClient, orgId: string, id: string, archive: boolean): Promise<ChampPerso> {
  const { error } = await db.from('custom_fields')
    .update({ archived_at: archive ? new Date().toISOString() : null })
    .eq('org_id', orgId).eq('id', id).select('id').single();
  if (error) traduireErreur(error, archive ? 'archiver le champ' : 'restaurer le champ');
  return unChamp(db, orgId, id);
}

export interface ImpactChamp {
  valeurs: number;
  automatisations: { id: string; name: string }[];
  modeles: { id: string; name: string }[];
  pipelines: { id: string; name: string }[];
  formulaires: { id: string; name: string }[];
}

export async function impactChamp(db: SupabaseClient, orgId: string, id: string): Promise<ImpactChamp> {
  await unChamp(db, orgId, id); // appartenance à l'org
  const { data, error } = await db.rpc('cf_impact_champ', { p_field: id });
  if (error) traduireErreur(error, 'mesurer l’impact');
  return data as ImpactChamp;
}

export async function purgerChamp(db: SupabaseClient, orgId: string, id: string, valeursConfirmees: number): Promise<ImpactChamp> {
  await unChamp(db, orgId, id);
  const { data, error } = await db.rpc('cf_purger_champ', { p_field: id, p_valeurs_confirmees: valeursConfirmees });
  if (error) traduireErreur(error, 'purger le champ');
  return data as ImpactChamp;
}

export async function majCherchables(db: SupabaseClient, orgId: string, objet: ObjetChamp, idsCherchables: string[]): Promise<void> {
  const { champs } = await listerChamps(db, orgId, { objet });
  const voulu = new Set(idsCherchables);
  for (const c of champs) {
    const cible = voulu.has(c.id) && TYPES_CHERCHABLES.includes(c.field_type);
    if (voulu.has(c.id) && !cible) throw new ErreurChamps(`« ${c.label} » ne peut pas être cherchable.`);
    if (c.is_searchable === cible) continue;
    const { error } = await db.from('custom_fields').update({ is_searchable: cible }).eq('org_id', orgId).eq('id', c.id);
    if (error) traduireErreur(error, 'modifier les champs cherchables');
  }
}

export async function majUnique(db: SupabaseClient, orgId: string, id: string, actif: boolean):
  Promise<{ ok: boolean; doublons: { value_normalized: string; nb: number; entites: string[] }[] }> {
  const champ = await unChamp(db, orgId, id);
  if (actif && !TYPES_UNIQUES.includes(champ.field_type)) throw new ErreurChamps(`« ${champ.label} » ne peut pas être unique.`);
  const { data, error } = await db.rpc('cf_activer_unique', { p_field: id, p_actif: actif });
  if (error) traduireErreur(error, 'modifier l’unicité');
  return data as { ok: boolean; doublons: { value_normalized: string; nb: number; entites: string[] }[] };
}

// ─── Dossiers ───────────────────────────────────────────────────

export async function creerDossier(
  db: SupabaseClient, orgId: string, objet: ObjetChamp, nom: string, champs: Omit<EntreeChamp, 'object_type' | 'folder_id'>[] = [],
): Promise<string> {
  for (const c of champs) verifierEntree({ ...c, object_type: objet });
  const { data, error } = await db.rpc('cf_creer_dossier', {
    p_org: orgId, p_object: objet, p_nom: nom.trim(),
    p_champs: champs.map((c) => ({
      label: c.label.trim(), field_type: c.field_type, key: c.key ?? '',
      placeholder: c.placeholder ?? null, help_text: c.help_text ?? null,
      is_required: !!c.is_required, config: configPour(c.field_type, c.config), options: c.options ?? [],
    })),
  });
  if (error) traduireErreur(error, 'créer le dossier');
  return data as string;
}

export async function renommerDossier(db: SupabaseClient, orgId: string, id: string, nom: string, position?: number) {
  const maj: Record<string, unknown> = { name: nom.trim() };
  if (position !== undefined) maj.position = position;
  const { error } = await db.from('custom_field_folders').update(maj).eq('org_id', orgId).eq('id', id).select('id').single();
  if (error) traduireErreur(error, 'renommer le dossier');
}

/** Supprimer un dossier ne supprime AUCUN champ : ils passent « Sans dossier » (FK set null). */
export async function supprimerDossier(db: SupabaseClient, orgId: string, id: string) {
  const { error } = await db.from('custom_field_folders').delete().eq('org_id', orgId).eq('id', id).select('id').single();
  if (error) traduireErreur(error, 'supprimer le dossier');
}

// ─── Valeurs ────────────────────────────────────────────────────

type LigneValeur = {
  id: string; field_id: string; version: number; updated_at: string;
  value_text: string | null; value_number: number | null; value_money_cents: number | null; value_currency: string | null;
  value_date: string | null; value_timestamp: string | null; value_option_id: string | null;
  client_id?: string | null; deal_id?: string | null; job_id?: string | null; quote_id?: string | null; invoice_id?: string | null;
};

const COLONNES_VALEUR = 'id, field_id, version, updated_at, value_text, value_number, value_money_cents, value_currency, value_date, value_timestamp, value_option_id';

/** Valeurs de plusieurs fiches d'un même objet : { entité → { champ → valeur } }. */
export async function lireValeursLot(
  db: SupabaseClient, orgId: string, objet: ObjetChamp, entites: string[], champs?: ChampPerso[],
): Promise<Record<string, Record<string, ValeurEnregistree>>> {
  const res: Record<string, Record<string, ValeurEnregistree>> = {};
  if (entites.length === 0) return res;
  const defs = champs ?? (await listerChamps(db, orgId, { objet, inclureArchives: true })).champs;
  const parId = new Map(defs.map((c) => [c.id, c]));
  const col = colonneEntite(objet);
  for (let i = 0; i < entites.length; i += 200) {
    const tranche = entites.slice(i, i + 200);
    const { data, error } = await db.from('custom_field_values').select(`${COLONNES_VALEUR}, ${col}`)
      .eq('org_id', orgId).eq('object_type', objet).in(col, tranche);
    if (error) traduireErreur(error, 'lire les valeurs');
    const lignes = (data ?? []) as unknown as LigneValeur[];
    const multiples = lignes.filter((l) => parId.get(l.field_id)?.field_type === 'dropdown_multi').map((l) => l.id);
    const optsParValeur = new Map<string, string[]>();
    if (multiples.length) {
      const { data: vo, error: evo } = await db.from('custom_field_value_options').select('value_id, option_id')
        .eq('org_id', orgId).in('value_id', multiples);
      if (evo) traduireErreur(evo, 'lire les options choisies');
      for (const r of vo ?? []) optsParValeur.set(r.value_id, [...(optsParValeur.get(r.value_id) ?? []), r.option_id]);
    }
    for (const l of lignes) {
      const def = parId.get(l.field_id);
      if (!def) continue;
      const entite = (l as Record<string, unknown>)[col] as string;
      (res[entite] ??= {})[l.field_id] = {
        field_id: l.field_id,
        value: lireValeur(def.field_type, l, optsParValeur.get(l.id) ?? []),
        version: l.version,
        updated_at: l.updated_at,
      };
    }
  }
  return res;
}

export async function lireValeurs(db: SupabaseClient, orgId: string, objet: ObjetChamp, entite: string) {
  const { champs, dossiers } = await listerChamps(db, orgId, { objet, inclureArchives: true });
  const valeurs = (await lireValeursLot(db, orgId, objet, [entite], champs))[entite] ?? {};
  // Un champ archivé reste visible sur une fiche SEULEMENT s'il y porte une valeur.
  return { champs: champs.filter((c) => !c.archived_at || valeurs[c.id]), dossiers, valeurs };
}

export interface Ecriture { field_id: string; value: ValeurChamp; version?: number | null }
export interface ResultatEcriture { field_id: string; ok: boolean; changed: boolean; conflict?: boolean; version: number | null; erreur?: string }

/**
 * Écrit plusieurs valeurs d'UNE fiche. Chaque champ est indépendant : une
 * valeur invalide n'empêche pas les autres de s'enregistrer, et chaque
 * résultat dit ce qui s'est passé. Les champs obligatoires ne peuvent pas
 * être vidés.
 */
export async function ecrireValeurs(
  db: SupabaseClient, orgId: string, objet: ObjetChamp, entite: string, ecritures: Ecriture[],
  opts: { acteur?: string | null; source?: string } = {},
): Promise<ResultatEcriture[]> {
  if (ecritures.length === 0) return [];
  const { champs } = await listerChamps(db, orgId, { objet, ids: ecritures.map((e) => e.field_id) });
  const parId = new Map(champs.map((c) => [c.id, c]));
  const resultats: ResultatEcriture[] = [];
  for (const e of ecritures) {
    const champ = parId.get(e.field_id);
    if (!champ) { resultats.push({ field_id: e.field_id, ok: false, changed: false, version: null, erreur: 'Champ introuvable pour cet objet.' }); continue; }
    try {
      const prep = preparerValeur(champ, e.value);
      if (!prep.colonnes && champ.is_required) throw new ErreurValeur(`« ${champ.label} » est obligatoire.`);
      const { data, error } = await db.rpc('cf_ecrire_valeur', {
        p_field: champ.id, p_entity: entite, p_cols: prep.colonnes,
        p_options: champ.field_type === 'dropdown_multi' ? prep.options : null,
        p_version: e.version ?? null,
      });
      if (error) traduireErreur(error, `enregistrer « ${champ.label} »`);
      const r = data as { changed: boolean; conflict: boolean; version: number | null; old: Record<string, unknown> | null };
      if (r.conflict) {
        resultats.push({ field_id: champ.id, ok: false, changed: false, conflict: true, version: r.version,
          erreur: `« ${champ.label} » a été modifié entre-temps : recharge la fiche.` });
        continue;
      }
      resultats.push({ field_id: champ.id, ok: true, changed: r.changed, version: r.version });
      // Une écriture faite PAR une automatisation ne redéclenche pas les
      // automatisations (« quand X change → mettre X à jour » bouclerait).
      if (r.changed && opts.source !== 'automation') {
        const ancien = r.old ? lireValeur(champ.field_type, r.old, (r.old.options as string[] | undefined) ?? []) : null;
        void eventBus.emit('custom_field.changed', {
          orgId, entityType: objet === 'deal' ? 'deal' : objet, entityId: entite, actorId: opts.acteur ?? undefined,
          metadata: {
            field_id: champ.id, field_key: champ.key, field_label: champ.label, object_type: objet,
            old_value: ancien, new_value: e.value ?? null, source: opts.source ?? 'app',
          },
        }).catch((err: unknown) => logger.error('[champs] événement custom_field.changed', { message: String(err) }));
      }
    } catch (err) {
      if (err instanceof ErreurValeur || err instanceof ErreurChamps) {
        resultats.push({ field_id: champ.id, ok: false, changed: false, version: null, erreur: err.message });
      } else throw err;
    }
  }
  return resultats;
}

// ─── Filtres, tri, recherche ────────────────────────────────────

/** Ids des fiches qui satisfont TOUTES les conditions (moteur SQL cf_filtrer). */
export async function filtrer(
  db: SupabaseClient, orgId: string, objet: ObjetChamp, conditions: Condition[], ids?: string[],
): Promise<string[]> {
  if (conditions.length === 0) return ids ?? [];
  const { data, error } = await db.rpc('cf_filtrer', {
    p_org: orgId, p_object: objet, p_conditions: conditions, p_ids: ids ?? null,
  });
  if (error) traduireErreur(error, 'filtrer');
  return ((data ?? []) as unknown[]).map((x) => (typeof x === 'string' ? x : String((x as Record<string, unknown>).cf_filtrer ?? x)));
}

export async function rechercher(db: SupabaseClient, orgId: string, q: string, limite = 20) {
  const { data, error } = await db.rpc('cf_rechercher', { p_org: orgId, p_q: q, p_limit: limite });
  if (error) traduireErreur(error, 'chercher dans les champs personnalisés');
  return (data ?? []) as { object_type: ObjetChamp; entity_id: string; field_id: string; field_label: string; value_text: string }[];
}

// ─── Variables de modèles ───────────────────────────────────────

/**
 * {client_cf_<clé>}, {deal_cf_<clé>}, {job_cf_<clé>}… formatées pour
 * l'humain (montant « 1 250,00 $ », date « 24 septembre 2026 »). Les
 * résolveurs existants ({var} et [var], noms \w+) les lisent sans changement.
 * Un champ vide donne une chaîne vide, comme toute variable inconnue.
 */
export async function variablesChamps(
  db: SupabaseClient, orgId: string, refs: Partial<Record<ObjetChamp, string | null | undefined>>, langue: 'fr' | 'en' = 'fr',
): Promise<Record<string, string>> {
  const vars: Record<string, string> = {};
  const objets = (Object.keys(refs) as ObjetChamp[]).filter((o) => estObjet(o) && refs[o]);
  if (objets.length === 0) return vars;
  const { champs } = await listerChamps(db, orgId, {});
  const { data: cs } = await db.from('company_settings').select('timezone').eq('org_id', orgId).maybeSingle();
  const fuseau = (cs?.timezone as string | undefined) || 'America/Toronto';
  for (const objet of objets) {
    const defs = champs.filter((c) => c.object_type === objet);
    if (defs.length === 0) continue;
    const valeurs = (await lireValeursLot(db, orgId, objet, [refs[objet] as string], defs))[refs[objet] as string] ?? {};
    for (const c of defs) {
      vars[variableModele(objet, c.key)] = formaterValeur(c, valeurs[c.id]?.value ?? null, langue, fuseau);
    }
  }
  return vars;
}

// ─── Cartes du pipeline ─────────────────────────────────────────

/** Champs d'opportunité affichés sur les cartes d'un pipeline, dans l'ordre. */
export async function lireCartesPipeline(db: SupabaseClient, orgId: string, pipelineId: string): Promise<string[]> {
  const { data, error } = await db.from('custom_field_pipeline_cards').select('field_id, position')
    .eq('org_id', orgId).eq('pipeline_id', pipelineId).order('position');
  if (error) traduireErreur(error, 'lire l’affichage des cartes');
  return (data ?? []).map((r) => r.field_id as string);
}

/** Remplace la liste (6 au plus, champs d'opportunité actifs de l'org). */
export async function majCartesPipeline(db: SupabaseClient, orgId: string, pipelineId: string, champIds: string[]): Promise<void> {
  const uniques = [...new Set(champIds)];
  if (uniques.length) {
    const { champs } = await listerChamps(db, orgId, { objet: 'deal', ids: uniques });
    if (champs.length !== uniques.length) throw new ErreurChamps('Un des champs n’est pas un champ d’opportunité actif.');
  }
  const { error: ed } = await db.from('custom_field_pipeline_cards').delete().eq('org_id', orgId).eq('pipeline_id', pipelineId);
  if (ed) traduireErreur(ed, 'modifier l’affichage des cartes');
  if (uniques.length) {
    const { error } = await db.from('custom_field_pipeline_cards').insert(
      uniques.map((field_id, position) => ({ org_id: orgId, pipeline_id: pipelineId, field_id, position })),
    );
    if (error) traduireErreur(error, 'modifier l’affichage des cartes');
  }
}

// ─── Modèles par métier ─────────────────────────────────────────

/** Industrie de l'entreprise (choisie à l'inscription) si elle a un modèle. */
export async function industrieDe(db: SupabaseClient, orgId: string): Promise<IndustrieModele | null> {
  const { data } = await db.from('company_settings').select('industry').eq('org_id', orgId).maybeSingle();
  const industrie: unknown = data?.industry;
  return estIndustrieModele(industrie) ? industrie : null;
}

/**
 * Crée les champs suggérés pour un métier. Rejouable : un champ dont la clé
 * existe déjà sur l'objet (même archivé) est sauté, jamais dupliqué ni
 * modifié. Libellés dans la langue de l'entreprise par défaut.
 */
export async function installerModele(
  db: SupabaseClient, orgId: string, industrie: IndustrieModele,
  opts: { ids?: string[]; langue?: 'fr' | 'en' } = {},
): Promise<{ crees: number; deja: number }> {
  let langue = opts.langue;
  if (!langue) {
    const { data: cs } = await db.from('company_settings').select('default_language').eq('org_id', orgId).maybeSingle();
    langue = cs?.default_language === 'en' ? 'en' : 'fr';
  }
  const { champs } = await listerChamps(db, orgId, { inclureArchives: true });
  const pris = new Set(champs.map((c) => `${c.object_type}:${c.key}`));
  let crees = 0;
  let deja = 0;
  for (const { modele, objet } of champsDuModele(industrie, opts.ids)) {
    if (pris.has(`${objet}:${modele.key}`)) { deja++; continue; }
    await creerChamp(db, orgId, {
      object_type: objet, key: modele.key, label: modele[langue], field_type: modele.field_type,
      config: modele.document && (objet === 'quote' || objet === 'invoice') ? { show_on_documents: true } : {},
      options: modele.options?.map((o) => ({ label: o[langue!], color: o.color ?? null })),
    });
    pris.add(`${objet}:${modele.key}`);
    crees++;
  }
  return { crees, deja };
}

// ─── Documents du client (devis, facture) ───────────────────────

export interface ChampDocument { label: string; valeur: string }

/**
 * Les champs à montrer sur un devis ou une facture (option
 * `show_on_documents`), formatés dans la langue et le fuseau de
 * l'entreprise. Vide si la fonction est coupée ou si rien n'est coché.
 * Utilisé par les pages publiques (/quote/…, /invoice/…) : client service,
 * org imposée par le document lui-même.
 */
export async function champsPourDocument(
  db: SupabaseClient, orgId: string, objet: 'quote' | 'invoice', entite: string,
): Promise<ChampDocument[]> {
  try {
    const { champs } = await listerChamps(db, orgId, { objet });
    const visibles = champs.filter((c) => c.config.show_on_documents);
    if (visibles.length === 0) return [];
    const [valeurs, { data: cs }] = await Promise.all([
      lireValeursLot(db, orgId, objet, [entite], visibles),
      db.from('company_settings').select('timezone, default_language').eq('org_id', orgId).maybeSingle(),
    ]);
    const langue = cs?.default_language === 'en' ? 'en' : 'fr';
    const fuseau = (cs?.timezone as string | undefined) || 'America/Toronto';
    return visibles
      .map((c) => ({ label: c.label, valeur: formaterValeur(c, valeurs[entite]?.[c.id]?.value ?? null, langue, fuseau) }))
      .filter((x) => x.valeur !== '');
  } catch (err) {
    // Jamais au point de casser la page que le client ouvre.
    logger.error('[champs] champs du document illisibles', { objet, message: String(err) });
    return [];
  }
}
