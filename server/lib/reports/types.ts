/**
 * Rapports (Réglages → Rapports) — types partagés du registre.
 *
 * Un rapport = une définition déclarative (colonnes typées, filtres, tri par
 * défaut) + une source de lignes. Deux formes de source :
 *
 *  - `query`  : un builder PostgREST paginé côté base (listes volumineuses :
 *               factures, jobs, paiements…). Tri et pagination délégués à la
 *               base, enrichissement des libellés (client, membre…) après coup.
 *  - `memory` : toutes les lignes sont calculées en mémoire (agrégations :
 *               performance des vendeurs, soldes par client, taxes…). Tri et
 *               pagination faits ici. Réservé aux volumes bornés.
 *
 * Le moteur (engine.ts) rend les deux formes identiques pour la route : une
 * page JSON avec total + totaux, ou un flux CSV complet.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PermissionKey } from '../../../src/lib/permissions';
import type { TeamRole } from '../rbac';

export type Lang = 'fr' | 'en';
export type Bilingue = { fr: string; en: string };

export type ReportCategory = 'finances' | 'operations' | 'team' | 'clients' | 'field';

export const REPORT_CATEGORIES: Array<{ key: ReportCategory; label: Bilingue }> = [
  { key: 'finances', label: { fr: 'Finances', en: 'Finances' } },
  { key: 'operations', label: { fr: 'Opérations', en: 'Operations' } },
  { key: 'team', label: { fr: 'Équipe et ventes', en: 'Team and sales' } },
  { key: 'clients', label: { fr: 'Clients', en: 'Clients' } },
  { key: 'field', label: { fr: 'Terrain', en: 'Field' } },
];

/**
 * Type d'une colonne : pilote le formatage (écran et CSV) et l'alignement.
 *  - money    : cents entiers → « $1 234,56 » à l'écran, « 1234.56 » en CSV
 *  - date     : « YYYY-MM-DD » (date seule, sans fuseau)
 *  - datetime : timestamp → date + heure locale de l'org
 *  - hours    : nombre décimal d'heures (2 décimales)
 *  - percent  : 0..100 (1 décimale)
 *  - enum     : valeur brute traduite via `labels`
 */
export type ColumnType = 'text' | 'money' | 'date' | 'datetime' | 'integer' | 'number' | 'hours' | 'percent' | 'enum';

export interface ReportColumn {
  key: string;
  label: Bilingue;
  type: ColumnType;
  /** Colonne triable côté source (pour `query` : doit être une colonne réelle). */
  sortable?: boolean;
  /** Colonne DB à utiliser pour le tri quand elle diffère de `key`. */
  sortKey?: string;
  /** Somme affichée dans la ligne de totaux (money / integer / number / hours). */
  total?: 'sum';
  /** Libellés pour le type `enum`. */
  labels?: Record<string, Bilingue>;
  /** Largeur suggérée pour la grille (ex. '140px', '1.4fr'). */
  width?: string;
}

export interface FilterOption {
  value: string;
  label: Bilingue;
}

/**
 * Filtres exposés à l'écran. Le filtre de période (`from`/`to`) est implicite
 * quand `dateFilter` est défini sur le rapport ; les autres sont nommés.
 *  - select : liste fixe (`options`) ou dynamique (`source`)
 *  - search : texte libre
 */
export interface ReportFilter {
  key: string;
  label: Bilingue;
  type: 'select' | 'search';
  options?: FilterOption[];
  /** Options résolues à la demande (membres, équipes, tags…). */
  source?: 'members' | 'teams' | 'jobTags';
  /** Valeur par défaut ('all' si absente pour un select). */
  default?: string;
  placeholder?: Bilingue;
}

export interface DateFilterSpec {
  label: Bilingue;
  /** Préréglage appliqué par le front à l'ouverture. */
  default: 'thisMonth' | 'last30' | 'last90' | 'last12m' | 'thisYear' | 'all';
  /** Colonnes de date alternatives sélectionnables (clé = valeur du filtre `dateField`). */
  fields?: FilterOption[];
}

export interface ReportContext {
  /** Client Supabase porteur du JWT de l'utilisateur : la RLS s'applique. */
  user: SupabaseClient;
  /** Client service-role : réservé aux résolutions de libellés et aux tables sans RLS lisible. */
  service: SupabaseClient;
  orgId: string;
  userId: string;
  role: TeamRole;
  /** owner / admin : voit tout ; sinon les sources service-role se restreignent à soi. */
  isAdmin: boolean;
  lang: Lang;
  /** Date du jour dans le fuseau de l'org (YYYY-MM-DD). */
  today: string;
}

export interface ReportQuery {
  /** Bornes de période (YYYY-MM-DD), inclusives. Absentes = pas de filtre. */
  from?: string;
  to?: string;
  /** Colonne de date choisie (voir DateFilterSpec.fields). */
  dateField?: string;
  /** Valeurs des filtres nommés (clé → valeur). */
  filters: Record<string, string>;
  sort: { key: string; dir: 'asc' | 'desc' };
}

export type Row = Record<string, unknown>;

export interface PageResult {
  rows: Row[];
  /** Nombre total de lignes correspondant aux filtres (null si inconnu). */
  total: number | null;
}

export interface QuerySource {
  kind: 'query';
  /**
   * Construit la requête PostgREST filtrée (sans range ni order). Le moteur
   * ajoute `count: 'exact'`, le tri et la pagination.
   */
  build: (ctx: ReportContext, q: ReportQuery) => any;
  /** Transforme une ligne brute en ligne de rapport (sans les libellés). */
  map: (raw: Row, ctx: ReportContext) => Row;
  /** Enrichit un lot de lignes (noms de clients, membres, numéros de job…). */
  enrich?: (rows: Row[], ctx: ReportContext) => Promise<void>;
}

export interface MemorySource {
  kind: 'memory';
  /** Charge et calcule TOUTES les lignes (déjà filtrées). Tri/pagination par le moteur. */
  loadAll: (ctx: ReportContext, q: ReportQuery) => Promise<Row[]>;
}

export interface ReportDefinition {
  id: string;
  category: ReportCategory;
  title: Bilingue;
  description: Bilingue;
  /** Permission de consultation (l'export exige en plus financial.export_data). */
  permission: PermissionKey;
  columns: ReportColumn[];
  filters: ReportFilter[];
  dateFilter?: DateFilterSpec;
  defaultSort: { key: string; dir: 'asc' | 'desc' };
  source: QuerySource | MemorySource;
  /** Rapport « lien » : ouvre une page existante au lieu d'un tableau. */
  link?: string;
}

/** Vue publique d'une définition (sans la source). */
export interface ReportDefinitionPublic {
  id: string;
  category: ReportCategory;
  title: Bilingue;
  description: Bilingue;
  columns: ReportColumn[];
  filters: Array<ReportFilter & { options: FilterOption[] }>;
  dateFilter: DateFilterSpec | null;
  defaultSort: { key: string; dir: 'asc' | 'desc' };
  link: string | null;
}

/** Plafond d'export : au-delà, on refuse explicitement (jamais de troncature silencieuse). */
export const EXPORT_MAX_ROWS = 50_000;
/**
 * Plafond du PDF : un PDF de rapport se lit et s'imprime ; au-delà de ce
 * nombre de lignes il devient un pavé de centaines de pages — on oriente
 * vers Excel/CSV plutôt que de le produire.
 */
export const PDF_MAX_ROWS = 5_000;
/** Taille des lots lus à la base (limite PostgREST par requête). */
export const BATCH_SIZE = 1000;
/** Au-delà de ce nombre de lignes, la ligne de totaux n'est pas calculée à l'écran. */
export const TOTALS_MAX_ROWS = 20_000;
