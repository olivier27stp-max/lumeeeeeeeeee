// Orchestration de l'analyse d'un fichier de migration : téléchargement depuis
// le bucket privé, analyse CSV, colonnes + correspondances suggérées, staging.
// Tout est asynchrone côté route (fire-and-forget) : les statuts du fichier
// (scanning → safe/rejected, parsing → parsed/failed) servent de progression.

import crypto from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { analyzeCsvBuffer, detectCategory, looksBinary, sniffIsPdf } from './analyzer';
import { entityForCategory, suggestMappings } from './mapping';
import { inferDateConvention, normalizeRow, type DateConvention } from './normalize';
import { logMigrationAudit, touchMigrationActivity } from './audit';
import { canTransition } from './state-machine';
import type { MigrationCategory, MigrationRow, MigrationStatus, TargetEntity } from './types';
import { MAX_FILES_PER_MIGRATION, MAX_FILE_SIZE_BYTES, MAX_STAGED_ROWS, MIGRATION_CATEGORIES, UPLOAD_ALLOWED_STATUSES } from './types';

export const MIGRATION_BUCKET = 'migration-files';

export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'fichier';
  return base.replace(/[^\w.\-()\s]/g, '_').slice(0, 80) || 'fichier';
}

export type ReceptionFichier =
  | { ok: true; file: Record<string, unknown> }
  | { ok: false; status: number; error: string; code: string };

/**
 * Réception d'un fichier de migration — même chemin pour le portail client et la console
 * (le 2026-09-22, la console ne savait que supprimer : impossible d'y remplacer un export
 * Jobber incomplet). Vérifie l'extension ET le contenu, la taille, le nombre de fichiers, le
 * doublon exact (sha256), stocke, enregistre, fait avancer le statut, journalise, puis lance
 * l'analyse en arrière-plan (progression dans migration_files.parse_status).
 */
/** Extensions Excel acceptées : converties en CSV (première feuille) avant l'analyse. */
export const EXCEL_EXTENSIONS = ['xlsx', 'xls'];
const MIME_BY_EXT: Record<string, string> = {
  csv: 'text/csv',
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
};

/** Signature réelle d'un classeur Excel : ZIP (« PK ») pour .xlsx, conteneur OLE pour .xls. */
export function sniffIsExcel(buf: Buffer, ext: string): boolean {
  if (ext === 'xlsx') return buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
  if (ext === 'xls') return buf.length >= 8 && buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0;
  return false;
}

/** Première feuille d'un classeur Excel → CSV UTF-8 (virgule), dates en ISO. */
export async function convertirExcelEnCsv(buf: Buffer): Promise<Buffer> {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: true, raw: false });
  const first = wb.SheetNames[0];
  if (!first) return Buffer.alloc(0);
  const csv = XLSX.utils.sheet_to_csv(wb.Sheets[first], { FS: ',', blankrows: false, dateNF: 'yyyy-mm-dd' });
  return Buffer.from(csv, 'utf8');
}

export function estCategorieValide(v: unknown): v is MigrationCategory {
  return typeof v === 'string' && (MIGRATION_CATEGORIES as readonly string[]).includes(v);
}

export async function receptionnerFichierMigration(
  admin: SupabaseClient,
  migration: MigrationRow,
  input: { buf: Buffer; name: string; uploadedBy: string; actorRole: 'client' | 'platform_admin'; categoryDeclared?: MigrationCategory | null },
): Promise<ReceptionFichier> {
  if (!UPLOAD_ALLOWED_STATUSES.includes(migration.status)) {
    return { ok: false, status: 409, error: 'Le téléversement n\'est plus permis à cette étape.', code: 'upload_closed' };
  }
  const name = sanitizeFileName(input.name);
  const ext = (name.split('.').pop() ?? '').toLowerCase();
  if (!['csv', 'pdf', ...EXCEL_EXTENSIONS].includes(ext)) {
    return { ok: false, status: 415, error: 'Format non pris en charge. Utilisez des fichiers CSV ou Excel (.xlsx, .xls) pour les données, PDF pour les archives.', code: 'unsupported_type' };
  }
  const buf = input.buf;
  if (buf.length === 0) return { ok: false, status: 400, error: 'Fichier vide.', code: 'empty' };
  if (buf.length > MAX_FILE_SIZE_BYTES) return { ok: false, status: 413, error: 'Fichier trop volumineux (max 25 Mo).', code: 'too_large' };

  // Vérification du contenu réel (jamais l'extension seule).
  const kind = ext === 'pdf' ? 'archive' : 'data';
  if (kind === 'archive' && !sniffIsPdf(buf)) return { ok: false, status: 415, error: 'Ce fichier n\'est pas un PDF valide.', code: 'not_pdf' };
  if (EXCEL_EXTENSIONS.includes(ext) && !sniffIsExcel(buf, ext)) return { ok: false, status: 415, error: 'Ce fichier n\'est pas un classeur Excel valide.', code: 'not_excel' };
  if (ext === 'csv' && looksBinary(buf)) return { ok: false, status: 415, error: 'Ce fichier ne semble pas être un CSV texte valide.', code: 'binary' };

  const { count: fileCount } = await admin.from('migration_files').select('id', { count: 'exact', head: true }).eq('migration_id', migration.id).is('deleted_at', null);
  if ((fileCount ?? 0) >= MAX_FILES_PER_MIGRATION) {
    return { ok: false, status: 409, error: `Limite de ${MAX_FILES_PER_MIGRATION} fichiers atteinte.`, code: 'too_many_files' };
  }

  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  const { data: dup } = await admin.from('migration_files').select('id, original_name').eq('migration_id', migration.id).eq('sha256', sha256).is('deleted_at', null).maybeSingle();
  if (dup) return { ok: false, status: 409, error: `Ce fichier a déjà été téléversé (${dup.original_name}).`, code: 'duplicate_file' };

  const fileId = crypto.randomUUID();
  const storagePath = `${migration.org_id}/${migration.id}/${fileId}/${name}`;
  const mime = MIME_BY_EXT[ext] ?? 'text/csv';
  const { error: upErr } = await admin.storage.from(MIGRATION_BUCKET).upload(storagePath, buf, { contentType: mime, upsert: false });
  if (upErr) throw upErr;

  const { data: fileRow, error: insErr } = await admin
    .from('migration_files')
    .insert({ id: fileId, migration_id: migration.id, storage_path: storagePath, original_name: name, mime_type: mime, size_bytes: buf.length, sha256, kind, uploaded_by: input.uploadedBy })
    .select('id, original_name, mime_type, size_bytes, kind, security_status, parse_status, created_at')
    .single();
  if (insErr) throw insErr;

  if (migration.status === 'waiting_for_files') {
    const { error } = await admin.from('data_migrations').update({ status: 'files_uploaded' }).eq('id', migration.id).eq('status', 'waiting_for_files');
    if (error) console.error('[migration-pipeline] upload transition failed:', error.message);
    else migration.status = 'files_uploaded';
  }

  // La catégorie déclarée par le client (zone de dépôt du formulaire) est journalisée : l'analyse
  // et toute ré-analyse la relisent (pas de colonne dédiée sur migration_files).
  await logMigrationAudit(admin, { migrationId: migration.id, action: 'file.upload', actorId: input.uploadedBy, actorRole: input.actorRole, target: `file:${fileId}`, meta: { name, size_bytes: buf.length, kind, category_declared: input.categoryDeclared ?? null } });
  await touchMigrationActivity(admin, migration.id);

  // Analyse asynchrone — la progression vit dans migration_files.parse_status.
  void analyzeMigrationFile(admin, migration, fileId, { categoryDeclared: input.categoryDeclared ?? null }).catch((err) => console.error('[migration-pipeline] analyze failed:', err));

  return { ok: true, file: fileRow as Record<string, unknown> };
}

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
/** Dernière catégorie déclarée pour un fichier (dépôt sous une zone du formulaire, ou correction). */
export async function lireCategorieDeclaree(admin: SupabaseClient, migrationId: string, fileId: string): Promise<MigrationCategory | null> {
  const { data } = await admin
    .from('migration_audit_logs')
    .select('meta, created_at')
    .eq('migration_id', migrationId)
    .eq('target', `file:${fileId}`)
    .in('action', ['file.upload', 'file.category'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const v = (data?.meta as { category_declared?: unknown } | null)?.category_declared;
  return estCategorieValide(v) ? v : null;
}

/** Catégorie déclarée par fichier, pour toute une migration (listes du portail et de la console). */
export async function categoriesDeclareesParFichier(admin: SupabaseClient, migrationId: string): Promise<Record<string, MigrationCategory>> {
  const { data } = await admin
    .from('migration_audit_logs')
    .select('target, meta, created_at')
    .eq('migration_id', migrationId)
    .in('action', ['file.upload', 'file.category'])
    .order('created_at', { ascending: true })
    .limit(2000);
  const out: Record<string, MigrationCategory> = {};
  for (const l of data ?? []) {
    const id = String((l as any).target ?? '').replace(/^file:/, '');
    const v = ((l as any).meta as { category_declared?: unknown } | null)?.category_declared;
    if (id && estCategorieValide(v)) out[id] = v; // le plus récent gagne (ordre croissant)
  }
  return out;
}

export async function analyzeMigrationFile(admin: SupabaseClient, migration: MigrationRow, fileId: string, opts: { categoryDeclared?: MigrationCategory | null } = {}): Promise<void> {
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
    let buf = Buffer.from(await blob.arrayBuffer());
    const ext = (file.original_name.split('.').pop() ?? '').toLowerCase();

    // ── Excel : première feuille convertie en CSV avant tout le reste ──
    if (file.kind === 'data' && EXCEL_EXTENSIONS.includes(ext)) {
      if (!sniffIsExcel(buf, ext)) {
        await admin.from('migration_files').update({ security_status: 'rejected', security_reason: 'not_excel', parse_status: 'failed', parse_error: 'not_excel' }).eq('id', file.id);
        return;
      }
      try {
        buf = await convertirExcelEnCsv(buf);
      } catch (err) {
        console.error('[migration-pipeline] excel conversion failed:', err);
        await admin.from('migration_files').update({ parse_status: 'failed', parse_error: 'excel_unreadable' }).eq('id', file.id);
        return;
      }
    }

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
    const analyzed = await analyzeCsvBuffer(buf);
    const detected: MigrationCategory | null = detectCategory(file.original_name, analyzed.headers);
    // La zone du formulaire où le client a déposé le fichier fait foi ; la détection sert d'alerte.
    const declared = opts.categoryDeclared === undefined ? await lireCategorieDeclaree(admin, migration.id, file.id) : opts.categoryDeclared;
    const category: MigrationCategory | null = declared ?? detected;

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

    // ── Avertissements structurels du fichier (audit S1) ───────────────
    const structuralIssues: { type: string; title: string }[] = [];
    if (analyzed.warnings.includes('duplicate_headers')) {
      structuralIssues.push({
        type: 'duplicate_headers',
        title: `En-têtes en double dans ${file.original_name} — colonnes renommées « (2) », à vérifier au mapping`,
      });
    }
    if (analyzed.warnings.includes('missing_header_row')) {
      structuralIssues.push({
        type: 'missing_header_row',
        title: `${file.original_name} semble sans ligne d'en-tête (la 1re ligne ressemble à des données) — ajoutez des en-têtes puis re-téléversez`,
      });
    }
    for (const si of structuralIssues) {
      const { data: existing } = await admin
        .from('migration_issues')
        .select('id')
        .eq('migration_id', migration.id)
        .eq('type', si.type)
        .eq('title', si.title)
        .is('resolved_at', null)
        .limit(1)
        .maybeSingle();
      if (!existing) {
        const { error: siErr } = await admin.from('migration_issues').insert({
          migration_id: migration.id,
          type: si.type,
          severity: 'warning',
          title: si.title,
          details_masked: { file: file.original_name },
          client_visible: true,
          options: ['acknowledge'],
        });
        if (siErr) console.error('[migration-pipeline] structural issue insert failed:', siErr.message);
      }
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

    // ── Désaccord entre la zone de dépôt et le contenu : dit au client, jamais tranché en silence ──
    await admin.from('migration_issues').update({ resolved_at: new Date().toISOString(), resolution: 'fichier ré-analysé' })
      .eq('migration_id', migration.id).eq('type', 'category_mismatch').is('resolved_at', null).contains('details_masked', { file_id: file.id });
    if (declared && detected && detected !== declared && !(declared === 'recurring_jobs' && detected === 'jobs')) {
      await admin.from('migration_issues').insert({
        migration_id: migration.id,
        type: 'category_mismatch',
        severity: 'warning',
        title: `${file.original_name} : déposé sous « ${declared} », mais ses colonnes ressemblent à « ${detected} »`,
        details_masked: { file_id: file.id, file: file.original_name, declared, detected, headers: analyzed.headers.slice(0, 12) },
        options: ['keep_declared', 'use_detected'],
        client_visible: true,
      });
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
    tax_config: ['tax id', 'tax code', 'code', 'id'],
    client: ['client id', 'customer id', 'contact id', 'id'],
    job: ['job number', 'job #', 'job id', 'work order', 'no de job', 'id'],
    invoice: ['invoice number', 'invoice #', 'invoice no', 'no de facture', 'numero de facture', 'id'],
    quote: ['quote number', 'quote #', 'estimate number', 'no de soumission', 'id'],
    visit: ['visit id', 'appointment id', 'id'],
    property: ['property id', 'location id', 'id'],
    billing_property: ['billing address id', 'address id', 'id'],
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
  // Fichiers déposés sous « Plans de service récurrents » : leurs jobs sont marqués récurrents.
  const { data: fichiersRecurrents } = await admin
    .from('migration_files')
    .select('id')
    .eq('migration_id', migration.id)
    .eq('category_detected', 'recurring_jobs')
    .is('deleted_at', null);
  const recurrents = new Set((fichiersRecurrents ?? []).map((f: { id: string }) => f.id));
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

  // Réponses HUMAINES aux issues date_format : la décision du client
  // (client_answer) ou de l'admin (resolution) fait toujours foi sur
  // l'inférence. Angle mort corrigé (audit S2) : ces options étaient écrites
  // mais jamais lues — le client répondait « JJ/MM » et MM/JJ s'appliquait.
  const answeredKeys = new Set<string>();
  const { data: dateAnswers, error: ansErr } = await admin
    .from('migration_issues')
    .select('details_masked, client_answer, resolution')
    .eq('migration_id', migration.id)
    .eq('type', 'date_format');
  if (ansErr) console.error('[migration-pipeline] date answers fetch failed:', ansErr.message);
  for (const issue of (dateAnswers ?? []) as { details_masked: Record<string, unknown> | null; client_answer: string | null; resolution: string | null }[]) {
    const d = issue.details_masked ?? {};
    const fileId = typeof d.file_id === 'string' ? d.file_id : '';
    const field = typeof d.field === 'string' ? d.field : '';
    if (!fileId || !field) continue;
    const answer = `${issue.resolution ?? ''} ${issue.client_answer ?? ''}`.toLowerCase();
    const chosen: DateConvention | null = /dmy|jj\/mm|jj-mm/.test(answer) ? 'dmy' : /mdy|mm\/jj|mm-jj/.test(answer) ? 'mdy' : null;
    if (!chosen) continue;
    const key = `${fileId}|${field}`;
    conventionByFileField.set(key, chosen);
    answeredKeys.add(key);
  }

  for (const [key, values] of samplesByFileField) {
    if (answeredKeys.has(key)) continue; // décision humaine déjà rendue
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
      if (r.entity_type === 'job' && recurrents.has(r.file_id)) res.normalized.job_type = 'recurring';
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
