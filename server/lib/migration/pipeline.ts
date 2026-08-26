// Orchestration de l'analyse d'un fichier de migration : téléchargement depuis
// le bucket privé, analyse CSV, colonnes + correspondances suggérées, staging.
// Tout est asynchrone côté route (fire-and-forget) : les statuts du fichier
// (scanning → safe/rejected, parsing → parsed/failed) servent de progression.

import type { SupabaseClient } from '@supabase/supabase-js';
import { analyzeCsvBuffer, detectCategory, looksBinary, sniffIsPdf } from './analyzer';
import { entityForCategory, suggestMappings } from './mapping';
import { inferDateConvention, normalizeRow, type DateConvention } from './normalize';
import { logMigrationAudit, touchMigrationActivity } from './audit';
import { canTransition } from './state-machine';
import type { MigrationCategory, MigrationRow, MigrationStatus, TargetEntity } from './types';
import { MAX_STAGED_ROWS } from './types';

export const MIGRATION_BUCKET = 'migration-files';

const STAGING_BATCH = 500;

async function setMigrationStatus(admin: SupabaseClient, migration: { id: string; status: MigrationStatus }, to: MigrationStatus): Promise<void> {
  if (migration.status === to || !canTransition(migration.status, to)) return;
  const { error } = await admin
    .from('data_migrations')
    .update({ status: to })
    .eq('id', migration.id)
    .eq('status', migration.status); // garde optimiste : ne pas écraser un statut déjà avancé
  if (error) console.error('[migration-pipeline] status update failed:', error.message);
  else migration.status = to;
}

interface FileRow {
  id: string;
  migration_id: string;
  storage_path: string;
  original_name: string;
  kind: string;
  security_status: string;
  parse_status: string;
}

/**
 * Analyse (ou ré-analyse) un fichier. Ne lance jamais d'exception : tout échec
 * est enregistré dans migration_files.parse_error / security_status.
 */
export async function analyzeMigrationFile(admin: SupabaseClient, migration: MigrationRow, fileId: string): Promise<void> {
  try {
    const { data: file, error: fileErr } = await admin
      .from('migration_files')
      .select('id, migration_id, storage_path, original_name, kind, security_status, parse_status')
      .eq('id', fileId)
      .eq('migration_id', migration.id)
      .is('deleted_at', null)
      .single<FileRow>();
    if (fileErr || !file) {
      console.error('[migration-pipeline] file not found:', fileErr?.message);
      return;
    }

    await admin.from('migration_files').update({ security_status: 'scanning', parse_status: 'parsing', parse_error: null }).eq('id', file.id);

    const { data: blob, error: dlErr } = await admin.storage.from(MIGRATION_BUCKET).download(file.storage_path);
    if (dlErr || !blob) {
      await admin.from('migration_files').update({ parse_status: 'failed', parse_error: 'download_failed' }).eq('id', file.id);
      return;
    }
    const buf = Buffer.from(await blob.arrayBuffer());

    // ── Contrôle de sécurité ────────────────────────────────────────────
    if (file.kind === 'archive') {
      const ok = sniffIsPdf(buf);
      await admin
        .from('migration_files')
        .update({ security_status: ok ? 'safe' : 'rejected', security_reason: ok ? null : 'not_a_pdf', parse_status: 'parsed' })
        .eq('id', file.id);
      await logMigrationAudit(admin, { migrationId: migration.id, action: 'file.scanned', target: `file:${file.id}`, meta: { kind: 'archive', ok } });
      return;
    }
    if (looksBinary(buf)) {
      await admin
        .from('migration_files')
        .update({ security_status: 'rejected', security_reason: 'binary_content', parse_status: 'failed', parse_error: 'binary_content' })
        .eq('id', file.id);
      await logMigrationAudit(admin, { migrationId: migration.id, action: 'file.rejected', target: `file:${file.id}`, meta: { reason: 'binary_content' } });
      return;
    }
    await admin.from('migration_files').update({ security_status: 'safe' }).eq('id', file.id);

    await setMigrationStatus(admin, migration, 'parsing');

    // ── Analyse CSV ─────────────────────────────────────────────────────
    const analyzed = analyzeCsvBuffer(buf);
    const category: MigrationCategory | null = detectCategory(file.original_name, analyzed.headers);

    // Ré-analyse : purger les artefacts précédents de CE fichier seulement.
    await admin.from('migration_staging_records').delete().eq('file_id', file.id);
    await admin.from('migration_field_mappings').delete().eq('file_id', file.id);
    await admin.from('migration_file_columns').delete().eq('file_id', file.id);

    if (analyzed.rowCount === 0) {
      await admin
        .from('migration_files')
        .update({
          parse_status: 'failed',
          parse_error: 'empty_file',
          encoding: analyzed.encoding,
          delimiter: analyzed.delimiter,
          row_count: 0,
          column_count: analyzed.columnCount,
          category_detected: category,
        })
        .eq('id', file.id);
      await admin.from('migration_issues').insert({
        migration_id: migration.id,
        type: 'empty_file',
        severity: 'error',
        title: `Fichier vide : ${file.original_name}`,
        details_masked: { file: file.original_name },
        client_visible: true,
      });
      return;
    }

    // ── Colonnes ────────────────────────────────────────────────────────
    const columnRows = analyzed.columns.map((c) => ({
      file_id: file.id,
      migration_id: migration.id,
      position: c.position,
      header: c.header,
      detected_type: c.detectedType,
      empty_ratio: Number(c.emptyRatio.toFixed(4)),
      samples_masked: c.samplesMasked,
    }));
    const { data: insertedCols, error: colErr } = await admin
      .from('migration_file_columns')
      .insert(columnRows)
      .select('id, position, header');
    if (colErr || !insertedCols) {
      await admin.from('migration_files').update({ parse_status: 'failed', parse_error: 'columns_insert_failed' }).eq('id', file.id);
      console.error('[migration-pipeline] columns insert failed:', colErr?.message);
      return;
    }
    const colIdByPosition = new Map<number, string>(insertedCols.map((c: { id: string; position: number }) => [c.position, c.id]));

    // ── Correspondances déterministes ───────────────────────────────────
    const suggestions = suggestMappings(category, analyzed.columns, file.original_name);
    const mappingRows = suggestions.map((s) => ({
      migration_id: migration.id,
      file_id: file.id,
      column_id: colIdByPosition.get(s.columnPosition),
      target_entity: s.targetEntity,
      target_field: s.targetField,
      confidence: s.confidence,
      reason: s.reason,
      status: s.needsReview ? 'needs_review' : 'suggested',
    })).filter((m) => !!m.column_id);
    if (mappingRows.length > 0) {
      const { error: mapErr } = await admin.from('migration_field_mappings').insert(mappingRows);
      if (mapErr) console.error('[migration-pipeline] mappings insert failed:', mapErr.message);
    }
    const ambiguous = suggestions.filter((s) => s.needsReview);
    if (ambiguous.length > 0) {
      const { error: issueErr } = await admin.from('migration_issues').insert(
        ambiguous.map((s) => ({
          migration_id: migration.id,
          type: 'ambiguous_column',
          severity: 'warning',
          entity_type: s.targetEntity,
          column_id: colIdByPosition.get(s.columnPosition) ?? null,
          title: `Colonne ambiguë : « ${s.header} » (${file.original_name})`,
          details_masked: { header: s.header, confidence: s.confidence, reason: s.reason },
          options: ['confirm', 'correct', 'reject'],
        })),
      );
      if (issueErr) console.error('[migration-pipeline] issues insert failed:', issueErr.message);
    }

    // ── Staging ─────────────────────────────────────────────────────────
    const entity = entityForCategory(category);
    if (!entity) {
      await admin.from('migration_issues').insert({
        migration_id: migration.id,
        type: 'unknown_category',
        severity: 'warning',
        title: `Catégorie non reconnue : ${file.original_name}`,
        details_masked: { file: file.original_name, headers: analyzed.headers.slice(0, 12) },
        options: ['assign_category', 'ignore_file'],
      });
    } else {
      const cappedRows = analyzed.rows.slice(0, MAX_STAGED_ROWS);
      for (let i = 0; i < cappedRows.length; i += STAGING_BATCH) {
        const batch = cappedRows.slice(i, i + STAGING_BATCH).map((row, j) => ({
          migration_id: migration.id,
          file_id: file.id,
          row_number: i + j + 1,
          entity_type: entity,
          external_id: extractExternalId(entity, row),
          payload: row,
          status: 'pending',
        }));
        const { error: stErr } = await admin.from('migration_staging_records').insert(batch);
        if (stErr) {
          console.error('[migration-pipeline] staging insert failed:', stErr.message);
          await admin.from('migration_files').update({ parse_status: 'failed', parse_error: 'staging_insert_failed' }).eq('id', file.id);
          return;
        }
      }
    }

    await admin
      .from('migration_files')
      .update({
        parse_status: 'parsed',
        encoding: analyzed.encoding,
        delimiter: analyzed.delimiter,
        row_count: analyzed.rowCount,
        column_count: analyzed.columnCount,
        category_detected: category,
        parse_error: analyzed.truncated ? 'truncated' : null,
      })
      .eq('id', file.id);

    await setMigrationStatus(admin, migration, 'mapping');
    await logMigrationAudit(admin, {
      migrationId: migration.id,
      action: 'file.parsed',
      target: `file:${file.id}`,
      meta: { rows: analyzed.rowCount, columns: analyzed.columnCount, category, truncated: analyzed.truncated },
    });
    await touchMigrationActivity(admin, migration.id);
  } catch (err: any) {
    console.error('[migration-pipeline] analyze failed:', err?.message || err);
    const { error } = await admin
      .from('migration_files')
      .update({ parse_status: 'failed', parse_error: 'internal_error' })
      .eq('id', fileId);
    if (error) console.error('[migration-pipeline] failure update failed:', error.message);
  }
}

/** Repère un identifiant externe probable dans la ligne brute. */
function extractExternalId(entity: TargetEntity, row: Record<string, string>): string | null {
  const wanted: Record<string, string[]> = {
    client: ['client id', 'customer id', 'contact id', 'id'],
    job: ['job number', 'job #', 'job id', 'work order', 'no de job', 'id'],
    invoice: ['invoice number', 'invoice #', 'invoice no', 'no de facture', 'numero de facture', 'id'],
    quote: ['quote number', 'quote #', 'estimate number', 'no de soumission', 'id'],
    visit: ['visit id', 'appointment id', 'id'],
    property: ['property id', 'location id', 'id'],
    service: ['item id', 'product id', 'id'],
    line_item: ['id'],
    payment: ['payment id', 'reference', 'id'],
  };
  const keys = wanted[entity] ?? ['id'];
  for (const [header, value] of Object.entries(row)) {
    const h = header.toLowerCase().trim();
    if (keys.includes(h) && value && value.trim()) return value.trim().slice(0, 120);
  }
  return null;
}

/**
 * Applique les correspondances confirmées aux lignes de staging : calcule
 * normalized + relations, marque ready/error. Retourne le nombre traité.
 */
export async function prepareStaging(admin: SupabaseClient, migration: MigrationRow): Promise<{ prepared: number; errors: number }> {
  // 1) correspondances utilisables par fichier : header → target_field
  const { data: mappings, error: mapErr } = await admin
    .from('migration_field_mappings')
    .select('file_id, target_entity, target_field, confidence, status, migration_file_columns(header)')
    .eq('migration_id', migration.id);
  if (mapErr || !mappings) {
    console.error('[migration-pipeline] mappings fetch failed:', mapErr?.message);
    return { prepared: 0, errors: 0 };
  }
  const fieldByHeaderByFile = new Map<string, Record<string, string>>();
  for (const m of mappings as any[]) {
    const header: string | undefined = m.migration_file_columns?.header;
    if (!header || !m.target_field) continue;
    const usable = m.status === 'confirmed' || m.status === 'corrected' || (m.status === 'suggested' && m.confidence >= 70);
    if (!usable) continue;
    const bucket = fieldByHeaderByFile.get(m.file_id) ?? {};
    bucket[header] = m.target_field;
    fieldByHeaderByFile.set(m.file_id, bucket);
  }

  // ── Inférence de la convention de date PAR COLONNE (MM/JJ vs JJ/MM) ──
  // Décider valeur par valeur rend une colonne incohérente ; on scanne un
  // échantillon de chaque colonne de date et on fige la convention du fichier.
  const DATE_TARGETS = new Set(['created_date', 'sale_date', 'start_date', 'end_date', 'issued_date', 'due_date', 'valid_until', 'date']);
  const samplesByFileField = new Map<string, string[]>();
  for (let offset = 0; ; offset += STAGING_BATCH) {
    const { data: rows, error } = await admin
      .from('migration_staging_records')
      .select('file_id, payload')
      .eq('migration_id', migration.id)
      .order('id', { ascending: true })
      .range(offset, offset + STAGING_BATCH - 1);
    if (error || !rows || rows.length === 0) break;
    for (const r of rows as { file_id: string; payload: Record<string, string> | null }[]) {
      const fieldByHeader = fieldByHeaderByFile.get(r.file_id) ?? {};
      for (const [header, field] of Object.entries(fieldByHeader)) {
        if (!DATE_TARGETS.has(field)) continue;
        const value = (r.payload ?? {})[header];
        if (!value) continue;
        const key = `${r.file_id}|${field}`;
        const arr = samplesByFileField.get(key) ?? [];
        if (arr.length < 500) arr.push(value);
        samplesByFileField.set(key, arr);
      }
    }
    if (rows.length < STAGING_BATCH) break;
  }
  const conventionByFileField = new Map<string, DateConvention>();
  for (const [key, values] of samplesByFileField) {
    const inferred = inferDateConvention(values);
    if (inferred === 'dmy') conventionByFileField.set(key, 'dmy');
    if (inferred === 'ambiguous' || inferred === 'mixed') {
      const [fileId, field] = key.split('|');
      const title = inferred === 'mixed'
        ? `Dates incohérentes dans la colonne « ${field} » (MM/JJ et JJ/MM mélangés)`
        : `Format de date ambigu pour « ${field} » — convention MM/JJ appliquée, à valider`;
      const { data: existing } = await admin
        .from('migration_issues')
        .select('id')
        .eq('migration_id', migration.id)
        .eq('type', 'date_format')
        .eq('title', title)
        .is('resolved_at', null)
        .limit(1)
        .maybeSingle();
      if (!existing) {
        const { error: issueErr } = await admin.from('migration_issues').insert({
          migration_id: migration.id,
          type: 'date_format',
          severity: inferred === 'mixed' ? 'error' : 'warning',
          title,
          details_masked: { file_id: fileId, field, inferred },
          options: ['confirm_mdy', 'confirm_dmy'],
        });
        if (issueErr) console.error('[migration-pipeline] date issue insert failed:', issueErr.message);
      }
    }
  }

  let prepared = 0;
  let errors = 0;
  const PAGE = STAGING_BATCH;
  // pagination par lot sur les lignes non encore normalisées ou à rafraîchir
  for (let offset = 0; ; offset += PAGE) {
    const { data: rows, error: rowErr } = await admin
      .from('migration_staging_records')
      .select('id, file_id, row_number, entity_type, external_id, payload, migration_id')
      .eq('migration_id', migration.id)
      .in('status', ['pending', 'ready', 'error', 'orphan', 'duplicate'])
      .order('id', { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (rowErr) {
      console.error('[migration-pipeline] staging fetch failed:', rowErr.message);
      break;
    }
    if (!rows || rows.length === 0) break;

    const updates = rows.map((r: any) => {
      const fieldByHeader = fieldByHeaderByFile.get(r.file_id) ?? {};
      const conventions: Record<string, DateConvention> = {};
      for (const field of Object.values(fieldByHeader)) {
        const hinted = conventionByFileField.get(`${r.file_id}|${field}`);
        if (hinted) conventions[field] = hinted;
      }
      const res = normalizeRow(r.entity_type, r.payload ?? {}, fieldByHeader, conventions);
      const hasBlocking = res.problems.length > 0 && Object.keys(res.normalized).length === 0;
      if (hasBlocking) errors += 1;
      else prepared += 1;
      return {
        id: r.id,
        migration_id: r.migration_id,
        file_id: r.file_id,
        row_number: r.row_number,
        entity_type: r.entity_type,
        external_id: r.external_id,
        payload: r.payload,
        normalized: res.normalized,
        relations: res.relations,
        status: hasBlocking ? 'error' : 'ready',
        error: res.problems.length > 0 ? res.problems.slice(0, 10).join(';') : null,
      };
    });
    const { error: upErr } = await admin.from('migration_staging_records').upsert(updates, { onConflict: 'id' });
    if (upErr) console.error('[migration-pipeline] staging normalize upsert failed:', upErr.message);
    if (rows.length < PAGE) break;
  }
  return { prepared, errors };
}
