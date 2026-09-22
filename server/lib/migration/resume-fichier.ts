// Résumé d'un fichier téléversé, calculé dès l'analyse pour le formulaire « Importer vos
// données » du portail : « 500 clients détectés », doublons internes, lignes à corriger,
// identifiants manquants. Les nombres viennent des lignes réellement analysées, comptées en
// ÉLÉMENTS UNIQUES (une facture de 5 lignes de services = 1 facture), avec les mêmes clés
// fortes que l'import (planIntraDedupe) et la même normalisation (normalizeRow).

import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeRow } from './normalize';
import { planIntraDedupe, type StagingRow } from './importer';
import { entityForCategory, FIELD_CATALOG } from './mapping';
import type { MigrationCategory, TargetEntity } from './types';

export interface ResumeFichier {
  entity: TargetEntity | null;
  /** lignes de données analysées (plafond MAX_STAGED_ROWS) */
  rows: number;
  /** éléments distincts (lignes − doublons internes) */
  unique: number;
  internal_duplicates: number;
  /** lignes sans aucune valeur exploitable (valeurs illisibles) */
  invalid: number;
  /** motifs les plus fréquents des lignes invalides, ex. « invalid_money:total » */
  invalid_reasons: Array<{ reason: string; count: number }>;
  /** colonnes de ce fichier encore « À vérifier » */
  needs_review: number;
  /** champs obligatoires du catalogue sans colonne mappée (libellés FR) */
  required_missing: string[];
  /** vrai si au moins une colonne identifiante est mappée (sinon le compte = lignes, pas éléments) */
  identifiers_ok: boolean;
  /** libellés des colonnes identifiantes attendues, pour guider le client */
  identifier_labels: string[];
}

/** Champs qui permettent de reconnaître un même élément d'une ligne à l'autre. */
const IDENTIFIERS: Record<string, string[]> = {
  client: ['external_id', 'email', 'phone', 'full_name', 'first_name', 'last_name', 'company'],
  property: ['address'],
  billing_property: ['address', 'client_ref', 'client_email_ref', 'client_name_ref'],
  job: ['job_number', 'external_id'],
  quote: ['quote_number', 'external_id'],
  invoice: ['invoice_number', 'external_id'],
  visit: ['job_ref', 'start_at', 'start_date'],
  payment: ['external_id', 'reference', 'invoice_ref'],
  service: ['name'],
  tax_config: ['name'],
};

/** Partie pure : à partir des lignes brutes et des correspondances utilisables du fichier. */
export function resumerLignes(
  entity: TargetEntity,
  rows: Array<{ id: string; row_number: number; payload: Record<string, string> }>,
  fieldByHeader: Record<string, string>,
): Pick<ResumeFichier, 'rows' | 'unique' | 'internal_duplicates' | 'invalid' | 'invalid_reasons' | 'identifiers_ok' | 'required_missing' | 'identifier_labels'> {
  const mapped = new Set(Object.values(fieldByHeader));
  const staging: StagingRow[] = [];
  let invalid = 0;
  const reasons = new Map<string, number>();
  for (const r of rows) {
    const res = normalizeRow(entity, r.payload ?? {}, fieldByHeader);
    // `_unmapped` (colonnes non mappées gardées pour les notes) n'est pas une donnée exploitable
    const vide = Object.keys(res.normalized).filter((k) => !k.startsWith('_')).length === 0;
    if (vide && res.problems.length > 0) {
      invalid += 1;
      for (const p of res.problems) reasons.set(p, (reasons.get(p) ?? 0) + 1);
      continue;
    }
    if (vide) continue; // ligne sans donnée exploitable (souvent une ligne de totaux ou vide)
    staging.push({ id: r.id, row_number: r.row_number, entity_type: entity, external_id: res.relations.external_id ?? null, normalized: res.normalized, relations: res.relations, status: 'pending' } as StagingRow);
  }
  const plan = planIntraDedupe(entity, staging);
  const internal_duplicates = plan.siblingOf.size;
  const catalog = FIELD_CATALOG[entity] ?? [];
  const required_missing = catalog.filter((f) => f.required && !mapped.has(f.field)).map((f) => f.labelFr);
  const ids = IDENTIFIERS[entity] ?? [];
  const identifiers_ok = ids.length === 0 || ids.some((f) => mapped.has(f));
  const identifier_labels = ids.map((f) => catalog.find((c) => c.field === f)?.labelFr ?? f);
  return {
    rows: rows.length,
    unique: staging.length - internal_duplicates,
    internal_duplicates,
    invalid,
    invalid_reasons: [...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([reason, count]) => ({ reason, count })),
    identifiers_ok,
    required_missing,
    identifier_labels,
  };
}

const PAGE = 1000;

/** Résumé d'un fichier analysé : lit ses correspondances utilisables et ses lignes de staging. */
export async function resumerFichier(admin: SupabaseClient, migrationId: string, fileId: string): Promise<ResumeFichier | null> {
  const { data: file } = await admin
    .from('migration_files')
    .select('id, category_detected, parse_status')
    .eq('id', fileId)
    .eq('migration_id', migrationId)
    .is('deleted_at', null)
    .maybeSingle();
  if (!file) return null;
  const entity = entityForCategory((file.category_detected ?? null) as MigrationCategory | null);
  const vide: ResumeFichier = { entity, rows: 0, unique: 0, internal_duplicates: 0, invalid: 0, invalid_reasons: [], needs_review: 0, required_missing: [], identifiers_ok: false, identifier_labels: [] };
  if (!entity || file.parse_status !== 'parsed') return vide;

  const { data: mappings } = await admin
    .from('migration_field_mappings')
    .select('target_field, confidence, status, migration_file_columns(header)')
    .eq('file_id', fileId);
  const fieldByHeader: Record<string, string> = {};
  let needsReview = 0;
  for (const m of (mappings ?? []) as any[]) {
    if (m.status === 'needs_review') needsReview += 1;
    const header = m.migration_file_columns?.header as string | undefined;
    if (!header || !m.target_field) continue;
    // même règle que prepareStaging : confirmée/corrigée, ou suggérée à ≥ 70 %
    const usable = m.status === 'confirmed' || m.status === 'corrected' || (m.status === 'suggested' && m.confidence >= 70);
    if (usable) fieldByHeader[header] = m.target_field;
  }

  const rows: Array<{ id: string; row_number: number; payload: Record<string, string> }> = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await admin
      .from('migration_staging_records')
      .select('id, row_number, payload')
      .eq('file_id', fileId)
      .order('row_number', { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) { console.error('[migration-resume] staging fetch failed:', error.message); break; }
    if (!data || data.length === 0) break;
    rows.push(...(data as any[]));
    if (data.length < PAGE) break;
  }
  return { entity, ...resumerLignes(entity, rows, fieldByHeader), needs_review: needsReview };
}
