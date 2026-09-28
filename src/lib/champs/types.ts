/**
 * Champs personnalisés v2 — vocabulaire partagé (client ET serveur).
 *
 * Miroir des enums SQL `cf_object_type` / `cf_field_type`
 * (supabase/migrations/20260926100000_champs_personnalises_v2.sql).
 * Aucun import : ce fichier est lu par src/ et par server/.
 */

export const OBJETS = ['client', 'deal', 'job', 'quote', 'invoice', 'property'] as const;
export type ObjetChamp = (typeof OBJETS)[number];

export const TYPES_CHAMP = [
  'single_line', 'multi_line', 'number', 'monetary', 'date', 'dropdown_single', 'dropdown_multi',
  'checkbox', 'phone', 'email', 'url', 'file',
] as const;
export type TypeChamp = (typeof TYPES_CHAMP)[number];

/** Types sur lesquels l'unicité a un sens (CHECK custom_fields_unique_types). */
export const TYPES_UNIQUES: readonly TypeChamp[] = ['single_line', 'email', 'phone', 'number'];
/** Types qu'une recherche « contient » sait lire (value_normalized textuel). */
export const TYPES_CHERCHABLES: readonly TypeChamp[] = ['single_line', 'multi_line', 'email', 'phone', 'number', 'url'];

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
  /** Devis / facture : afficher sur le document du client (PDF, page publique). */
  show_on_documents?: boolean;
  /** Retiré de la fenêtre de création (« Gérer les champs ») — reste sur la fiche. */
  masque_creation?: boolean;
  /** Retiré de la fiche (« Gérer les champs » de la fiche) — la valeur reste en base. */
  masque_fiche?: boolean;
  /**
   * Place dans le formulaire : juste après la rangée de base dont c'est la 1re clé
   * (RANGEES_FORMULAIRE) ; absent = à la fin de la section de son dossier.
   */
  apres?: string | null;
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
  /** Section du formulaire (dossier système) ; null = dossier créé par l'entreprise. */
  cle_systeme?: string | null;
}

export interface ChampPerso {
  id: string;
  object_type: ObjetChamp;
  folder_id: string | null;
  key: string;
  label: string;
  placeholder: string | null;
  help_text: string | null;
  /** Pré-remplissage à la création (texte, nombre, date, libellé d'option). */
  default_value?: string | number | string[] | boolean | null;
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
/** Case à cocher : booléen (true = cochée). */
export type ValeurChamp = string | number | boolean | string[] | null;

export interface ValeurEnregistree {
  field_id: string;
  value: ValeurChamp;
  version: number;
  updated_at: string;
}

/** Colonne de l'entité dans custom_field_values. */
export function colonneEntite(objet: ObjetChamp): 'client_id' | 'deal_id' | 'job_id' | 'quote_id' | 'invoice_id' | 'property_id' {
  return `${objet}_id` as const;
}

/** Variable de modèle d'un champ : {client_cf_superficie}. Compatible avec les
 *  résolveurs existants ({var} et [var], noms \w+) sans les modifier. */
export function variableModele(objet: ObjetChamp, cle: string): string {
  return `${objet}_cf_${cle}`;
}

/** La variable telle qu'on l'écrit dans un courriel ou une automatisation (format GoHighLevel). */
export function variableAffichee(objet: ObjetChamp, cle: string): string {
  return `{{${objet}.${cle}}}`;
}

export const LIBELLES_OBJET: Record<ObjetChamp, { fr: string; en: string }> = {
  client: { fr: 'Client', en: 'Client' },
  deal: { fr: 'Pipeline', en: 'Pipeline' },
  job: { fr: 'Job', en: 'Job' },
  quote: { fr: 'Devis', en: 'Quote' },
  invoice: { fr: 'Facture', en: 'Invoice' },
  property: { fr: 'Propriété', en: 'Property' },
};

export const LIBELLES_TYPE: Record<TypeChamp, { fr: string; en: string }> = {
  single_line: { fr: 'Ligne simple', en: 'Single line' },
  multi_line: { fr: 'Paragraphe', en: 'Multi line' },
  number: { fr: 'Nombre', en: 'Number' },
  monetary: { fr: 'Monétaire', en: 'Monetary' },
  phone: { fr: 'Téléphone', en: 'Phone' },
  email: { fr: 'Courriel', en: 'Email' },
  date: { fr: 'Date', en: 'Date' },
  dropdown_single: { fr: 'Liste déroulante', en: 'Dropdown (single)' },
  dropdown_multi: { fr: 'Choix multiples', en: 'Dropdown (multiple)' },
  checkbox: { fr: 'Case à cocher', en: 'Checkbox' },
  url: { fr: 'URL', en: 'URL' },
  file: { fr: 'Fichier', en: 'File' },
};
