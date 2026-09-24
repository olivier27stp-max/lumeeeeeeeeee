/**
 * Champs personnalisés v2 — vocabulaire partagé (client ET serveur).
 *
 * Miroir des enums SQL `cf_object_type` / `cf_field_type`
 * (supabase/migrations/20260926100000_champs_personnalises_v2.sql).
 * Aucun import : ce fichier est lu par src/ et par server/.
 */

export const OBJETS = ['client', 'deal', 'job', 'quote', 'invoice'] as const;
export type ObjetChamp = (typeof OBJETS)[number];

export const TYPES_CHAMP = [
  'single_line', 'multi_line', 'number', 'monetary', 'phone', 'email',
  'date', 'dropdown_single', 'dropdown_multi',
] as const;
export type TypeChamp = (typeof TYPES_CHAMP)[number];

/** Types sur lesquels l'unicité a un sens (CHECK custom_fields_unique_types). */
export const TYPES_UNIQUES: readonly TypeChamp[] = ['single_line', 'email', 'phone', 'number'];
/** Types qu'une recherche « contient » sait lire (value_normalized textuel). */
export const TYPES_CHERCHABLES: readonly TypeChamp[] = ['single_line', 'multi_line', 'email', 'phone', 'number'];

/** Conversions permises (trigger cf_champ_avant_ecriture). */
export const CONVERSIONS_SURES: ReadonlyArray<readonly [TypeChamp, TypeChamp]> = [
  ['single_line', 'multi_line'],
  ['multi_line', 'single_line'],
  ['number', 'monetary'],
  ['dropdown_single', 'dropdown_multi'],
];
export function conversionPermise(de: TypeChamp, vers: TypeChamp): boolean {
  return de === vers || CONVERSIONS_SURES.some(([a, b]) => a === de && b === vers);
}

export interface ConfigChamp {
  /** number : décimales (0 à 6), bornes. */
  decimals?: number | null;
  min?: number | null;
  max?: number | null;
  /** monetary : devise ISO, CAD par défaut. */
  currency?: string;
  /** date : date seule (défaut) ou date + heure. */
  include_time?: boolean;
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
  created_at: string;
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
  is_required: boolean;
  is_searchable: boolean;
  is_unique: boolean;
  position: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  options: OptionChamp[];
}

/**
 * Valeur « à plat », telle que l'API la rend et l'accepte :
 *   texte/téléphone/courriel → string · nombre → number · montant → cents (number)
 *   date → 'AAAA-MM-JJ' · date+heure → ISO · liste simple → id d'option
 *   liste multiple → ids d'options[]
 */
export type ValeurChamp = string | number | string[] | null;

export interface ValeurEnregistree {
  field_id: string;
  value: ValeurChamp;
  version: number;
  updated_at: string;
}

/** Colonne de l'entité dans custom_field_values. */
export function colonneEntite(objet: ObjetChamp): 'client_id' | 'deal_id' | 'job_id' | 'quote_id' | 'invoice_id' {
  return `${objet}_id` as const;
}

/** Variable de modèle d'un champ : {client_cf_superficie}. Compatible avec les
 *  résolveurs existants ({var} et [var], noms \w+) sans les modifier. */
export function variableModele(objet: ObjetChamp, cle: string): string {
  return `${objet}_cf_${cle}`;
}

export const LIBELLES_OBJET: Record<ObjetChamp, { fr: string; en: string }> = {
  client: { fr: 'Client', en: 'Client' },
  deal: { fr: 'Opportunité', en: 'Opportunity' },
  job: { fr: 'Job', en: 'Job' },
  quote: { fr: 'Devis', en: 'Quote' },
  invoice: { fr: 'Facture', en: 'Invoice' },
};

export const LIBELLES_TYPE: Record<TypeChamp, { fr: string; en: string }> = {
  single_line: { fr: 'Une ligne', en: 'Single line' },
  multi_line: { fr: 'Plusieurs lignes', en: 'Multi line' },
  number: { fr: 'Nombre', en: 'Number' },
  monetary: { fr: 'Montant', en: 'Monetary' },
  phone: { fr: 'Téléphone', en: 'Phone' },
  email: { fr: 'Courriel', en: 'Email' },
  date: { fr: 'Date', en: 'Date' },
  dropdown_single: { fr: 'Liste (un choix)', en: 'Dropdown (single)' },
  dropdown_multi: { fr: 'Liste (plusieurs choix)', en: 'Dropdown (multiple)' },
};
