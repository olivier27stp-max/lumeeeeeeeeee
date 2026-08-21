// Types et constantes partagés du système de migration assistée.
// Aucune dépendance : ce module est importable par les tests vitest sans mock.

export const MIGRATION_STATUSES = [
  'draft',
  'invitation_sent',
  'waiting_for_files',
  'files_uploaded',
  'parsing',
  'mapping',
  'human_review',
  'waiting_for_client',
  'ready_for_test',
  'testing',
  'test_review',
  'waiting_for_approval',
  'approved',
  'ready_for_final_import',
  'importing',
  'post_import_validation',
  'completed',
  'completed_with_warnings',
  'failed',
  'rolled_back',
  'cancelled',
] as const;
export type MigrationStatus = (typeof MIGRATION_STATUSES)[number];

export const TERMINAL_STATUSES: MigrationStatus[] = ['completed', 'completed_with_warnings', 'rolled_back', 'cancelled'];

/** Statuts pendant lesquels le portail client accepte encore des téléversements. */
export const UPLOAD_ALLOWED_STATUSES: MigrationStatus[] = [
  'invitation_sent',
  'waiting_for_files',
  'files_uploaded',
  'mapping',
  'human_review',
  'waiting_for_client',
  'test_review',
];

/** Statuts pendant lesquels le client peut proposer une correction de correspondance. */
export const CLIENT_MAPPING_EDIT_STATUSES: MigrationStatus[] = [
  'mapping',
  'human_review',
  'waiting_for_client',
  'test_review',
];

export const SOURCE_CRMS = [
  'jobber',
  'housecall_pro',
  'servicetitan',
  'gohighlevel',
  'quickbooks',
  'other',
  'custom_files',
] as const;
export type SourceCrm = (typeof SOURCE_CRMS)[number];

export const MIGRATION_CATEGORIES = [
  'clients',
  'properties',
  'services',
  'quotes',
  'jobs',
  'visits',
  'invoices',
  'payments',
  'notes',
  'attachments',
  'team_members',
  'custom_fields',
] as const;
export type MigrationCategory = (typeof MIGRATION_CATEGORIES)[number];

/**
 * Catégories réellement importables par l'import final v1. Les autres sont
 * détectées/comptées mais déclarées « non supportées » honnêtement dans l'UI.
 */
export const IMPORTABLE_CATEGORIES: MigrationCategory[] = [
  'services',
  'clients',
  'properties',
  'jobs',
  'visits',
  'invoices',
];

/** Entités cibles d'une correspondance colonne → champ Lume. */
export const TARGET_ENTITIES = [
  'client',
  'property',
  'service',
  'quote',
  'job',
  'visit',
  'invoice',
  'line_item',
  'payment',
] as const;
export type TargetEntity = (typeof TARGET_ENTITIES)[number];

export const DETECTED_TYPES = [
  'email',
  'phone',
  'date',
  'datetime',
  'money',
  'number',
  'postal_code',
  'address',
  'name',
  'status',
  'id',
  'boolean',
  'text',
] as const;
export type DetectedType = (typeof DETECTED_TYPES)[number];

export interface AnalyzedColumn {
  position: number;
  header: string;
  detectedType: DetectedType;
  emptyRatio: number; // 0..1
  samplesMasked: string[]; // valeurs TOUJOURS masquées, max 5
}

export interface AnalyzedFile {
  encoding: string; // 'utf-8' | 'utf-16le' | 'latin1'
  delimiter: string; // ',' | ';' | '\t' | '|'
  headers: string[];
  rowCount: number; // lignes de données (sans l'en-tête)
  columnCount: number;
  columns: AnalyzedColumn[];
  /** Lignes brutes (header → valeur), plafonnées par MAX_STAGED_ROWS. */
  rows: Record<string, string>[];
  warnings: string[];
  truncated: boolean;
}

export interface MappingSuggestion {
  columnPosition: number;
  header: string;
  targetEntity: TargetEntity | null;
  targetField: string | null;
  confidence: number; // 0..100
  reason: string;
  needsReview: boolean;
}

export interface FieldDef {
  field: string;
  labelFr: string;
  labelEn: string;
  types: DetectedType[]; // types de colonne compatibles
  synonyms: string[]; // en minuscules, fr + en
  required?: boolean;
}

export interface DuplicateMatch {
  stagingRecordId: string;
  existingTable: string;
  existingId: string;
  matchReasons: string[];
  score: number; // 0..100
}

export interface EntityCounts {
  wouldCreate: number;
  wouldMerge: number;
  ignored: number;
  errors: number;
  warnings: number;
}

export interface DryRunReport {
  version: number;
  generatedAt: string;
  byEntity: Partial<Record<TargetEntity, EntityCounts>>;
  totals: {
    sourceRows: number;
    wouldCreate: number;
    wouldMerge: number;
    ignored: number;
    blockingErrors: number;
    warnings: number;
    revenueCents: number;
  };
  duplicates: { pending: number; merge: number; createNew: number; skip: number; review: number };
  orphans: number;
  openIssues: number;
  notes: string[];
}

export interface PostImportValidation {
  outcome: 'passed' | 'passed_with_warnings' | 'review_required' | 'failed';
  checks: { name: string; expected: number; actual: number; ok: boolean }[];
  notes: string[];
}

/** Limites v1 (configurables via env plus tard si nécessaire). */
export const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25 Mo
export const MAX_FILES_PER_MIGRATION = 30;
export const MAX_STAGED_ROWS = 50_000; // par fichier
export const MASKED_SAMPLE_COUNT = 5;

export const DEFAULT_INVITE_TTL_HOURS = 48;
export const MAX_INVITE_FAILED_ATTEMPTS = 20;

/** Extensions/MIME acceptés v1. XLSX et ZIP sont refusés proprement. */
export const ACCEPTED_DATA_EXTENSIONS = ['csv'];
export const ACCEPTED_ARCHIVE_EXTENSIONS = ['pdf'];

export interface MigrationRow {
  id: string;
  org_id: string;
  source_crm: SourceCrm;
  status: MigrationStatus;
  categories: string[];
  priority: string;
  target_date: string | null;
  internal_notes: string | null;
  invited_user_id: string | null;
  invited_email: string | null;
  assigned_admin: string | null;
  assigned_assistant: string | null;
  freeze_start: string | null;
  freeze_end: string | null;
  freeze_confirmed_at: string | null;
  last_activity_at: string;
  completed_at: string | null;
  closed_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}
