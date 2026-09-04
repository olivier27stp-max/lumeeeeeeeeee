// Import test (dry-run) et import final de la migration assistée.
// Principes non négociables :
//  - runDryRun n'écrit JAMAIS dans les tables actives du workspace ;
//  - l'import final est idempotent : chaque entité créée porte un id
//    déterministe (migration + ligne de staging + table) et un
//    migration_import_records — une reprise ne duplique rien ;
//  - le rollback ne touche QUE les entités créées par le lot (soft-delete),
//    jamais les dossiers fusionnés ni les données préexistantes.

import crypto from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { localToUtcIso, normalizeAddressKey } from './normalize';
import { sanitizeCellForDisplay } from './masks';
import type {
  DryRunReport,
  EntityCounts,
  MigrationRow,
  PostImportValidation,
  TargetEntity,
} from './types';

export const IMPORT_ORDER: TargetEntity[] = ['service', 'client', 'property', 'job', 'quote', 'visit', 'invoice'];

export const TABLE_BY_ENTITY: Record<string, string> = {
  service: 'predefined_services',
  client: 'clients',
  property: 'properties',
  job: 'jobs',
  quote: 'quotes',
  visit: 'schedule_events',
  invoice: 'invoices',
};

const CATEGORY_BY_ENTITY: Record<string, string> = {
  service: 'services',
  client: 'clients',
  property: 'properties',
  job: 'jobs',
  quote: 'quotes',
  visit: 'visits',
  invoice: 'invoices',
};

const CHUNK = 200;
const STAGING_PAGE = 1000;

/** UUID déterministe façon v5 (sha1), version/variant conformes RFC 4122. */
export function deterministicEntityId(migrationId: string, stagingRecordId: string, entityTable: string): string {
  const digest = crypto
    .createHash('sha1')
    .update(`lume-migration:${migrationId}:${stagingRecordId}:${entityTable}`)
    .digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// ---------------------------------------------------------------------------
// Aides internes

export interface StagingRow {
  id: string;
  file_id?: string;
  row_number: number;
  entity_type: string;
  external_id: string | null;
  normalized: Record<string, unknown> | null;
  relations: Record<string, string> | null;
  status: string;
}

interface DupDecision {
  decision: string;
  existingId: string;
  score: number;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function refKey(v: string): string {
  return v.trim().toLowerCase();
}

function fullNameOf(n: Record<string, unknown>): string {
  const name = `${str(n.first_name)} ${str(n.last_name)}`.trim() || str(n.company) || str(n.full_name);
  return refKey(name);
}

async function loadStaging(admin: SupabaseClient, migrationId: string, entity: TargetEntity, statuses: string[]): Promise<StagingRow[]> {
  const out: StagingRow[] = [];
  for (let offset = 0; ; offset += STAGING_PAGE) {
    const { data, error } = await admin
      .from('migration_staging_records')
      .select('id, file_id, row_number, entity_type, external_id, normalized, relations, status') // payload volontairement exclu : inutile à l'import, lourd à 50 k lignes
      .eq('migration_id', migrationId)
      .eq('entity_type', entity)
      .in('status', statuses)
      // Ordre SOURCE (fichier puis ligne) : le dossier « primaire » d'un
      // doublon interne doit être déterministe — trier par id (uuid aléatoire)
      // faisait gagner la mauvaise rangée une fois sur deux (bug round 8b :
      // la facture #501 à 1,15 $ fusionnait la vraie à 172,46 $).
      .order('file_id', { ascending: true })
      .order('row_number', { ascending: true })
      .range(offset, offset + STAGING_PAGE - 1);
    if (error) {
      console.error('[migration-importer] staging fetch failed:', error.message);
      break;
    }
    if (!data || data.length === 0) break;
    out.push(...(data as StagingRow[]));
    if (data.length < STAGING_PAGE) break;
  }
  return out;
}

/** Meilleure décision de doublon par ligne de staging (score le plus haut). */
async function loadDuplicateDecisions(admin: SupabaseClient, migrationId: string): Promise<Map<string, DupDecision>> {
  const map = new Map<string, DupDecision>();
  for (let offset = 0; ; offset += STAGING_PAGE) {
    const { data, error } = await admin
      .from('migration_duplicate_candidates')
      .select('staging_record_id, existing_id, decision, score')
      .eq('migration_id', migrationId)
      .order('score', { ascending: false })
      .range(offset, offset + STAGING_PAGE - 1);
    if (error) {
      console.error('[migration-importer] decisions fetch failed:', error.message);
      break;
    }
    if (!data || data.length === 0) break;
    for (const d of data as { staging_record_id: string; existing_id: string; decision: string; score: number }[]) {
      const current = map.get(d.staging_record_id);
      const decided = d.decision === 'merge' || d.decision === 'skip' || d.decision === 'create_new';
      const currentDecided = current && (current.decision === 'merge' || current.decision === 'skip' || current.decision === 'create_new');
      if (!current || (decided && !currentDecided)) {
        map.set(d.staging_record_id, { decision: d.decision, existingId: d.existing_id, score: d.score });
      }
    }
    if (data.length < STAGING_PAGE) break;
  }
  return map;
}

/** Clés de référence sous lesquelles une ligne peut être retrouvée par ses enfants. */
function refKeysOf(entity: TargetEntity, rec: StagingRow): string[] {
  const n = rec.normalized ?? {};
  const r = rec.relations ?? {};
  const keys: string[] = [];
  const push = (v: string) => {
    const k = refKey(v);
    if (k) keys.push(k);
  };
  if (rec.external_id) push(rec.external_id);
  if (r.external_id) push(r.external_id);
  if (entity === 'client') {
    push(str(n.email));
    const name = fullNameOf(n);
    if (name) keys.push(name);
  } else if (entity === 'property') {
    const addr = normalizeAddressKey(str(n.address));
    if (addr) keys.push(addr);
  } else if (entity === 'job') {
    // Le titre n'est PAS une clé : « Lavage de vitres » ×20 rattacherait les
    // visites/factures au mauvais job. Numéro et id externe seulement.
    push(str(n.job_number));
  } else if (entity === 'invoice') {
    push(str(n.invoice_number));
  }
  return Array.from(new Set(keys));
}

function lookupRef(map: Map<string, string>, raw: string | undefined, extra?: (v: string) => string): string | null {
  if (!raw) return null;
  const direct = map.get(refKey(raw));
  if (direct) return direct;
  if (extra) {
    const alt = map.get(extra(raw));
    if (alt) return alt;
  }
  return null;
}


// ---------------------------------------------------------------------------
// Doublons INTERNES au lot importé (même dossier exporté deux fois) et clés
// ambiguës (deux dossiers distincts partageant une clé de référence).

export interface IntraPlan {
  /** stagingId → stagingId du dossier primaire (même dossier en double). */
  siblingOf: Map<string, string>;
  /** Clés de référence portées par ≥2 dossiers DISTINCTS — jamais devinées. */
  ambiguousKeys: Set<string>;
}

function strongKeysOf(entity: TargetEntity, rec: StagingRow): string[] {
  const n = rec.normalized ?? {};
  const keys: string[] = [];
  if (entity === 'client') {
    const email = refKey(str(n.email));
    if (email) keys.push(`e:${email}`);
    const phone = str(n.phone_digits);
    if (phone.length >= 7) keys.push(`t:${phone.slice(-10)}`);
    const name = fullNameOf(n);
    const addr = normalizeAddressKey(str(n.address));
    if (name && addr) keys.push(`na:${name}|${addr}`);
  } else if (entity === 'property') {
    const addr = normalizeAddressKey(str(n.address));
    if (addr) keys.push(`a:${addr}`);
  } else if (entity === 'job') {
    const num = refKey(str(n.job_number));
    if (num) keys.push(`j:${num}`);
  } else if (entity === 'invoice') {
    const num = refKey(str(n.invoice_number));
    if (num) keys.push(`i:${num}`);
  } else if (entity === 'quote') {
    const num = refKey(str(n.quote_number));
    if (num) keys.push(`q:${num}`);
  } else if (entity === 'service') {
    const name = refKey(str(n.name));
    if (name) keys.push(`s:${name}`);
  }
  return keys;
}

export function planIntraDedupe(entity: TargetEntity, rows: StagingRow[]): IntraPlan {
  const siblingOf = new Map<string, string>();
  const primaryByKey = new Map<string, string>();
  const nameOwner = new Map<string, string>(); // nom seul → premier dossier distinct
  const ambiguousKeys = new Set<string>();

  for (const rec of rows) {
    const keys = strongKeysOf(entity, rec);
    let primary: string | null = null;
    for (const k of keys) {
      const seen = primaryByKey.get(k);
      if (seen) { primary = siblingOf.get(seen) ?? seen; break; }
    }
    if (primary) {
      siblingOf.set(rec.id, primary);
      for (const k of keys) if (!primaryByKey.has(k)) primaryByKey.set(k, primary);
      continue;
    }
    for (const k of keys) primaryByKey.set(k, rec.id);

    // homonymes : même nom complet porté par deux dossiers DISTINCTS
    if (entity === 'client') {
      const name = fullNameOf(rec.normalized ?? {});
      if (name) {
        const owner = nameOwner.get(name);
        if (owner && owner !== rec.id) ambiguousKeys.add(name);
        else nameOwner.set(name, rec.id);
      }
    }
  }
  return { siblingOf, ambiguousKeys };
}

// Contrainte prod jobs_status_check (20260429000000) :
// draft | scheduled | in_progress | completed | cancelled — rien d'autre.
function mapJobStatus(source: string): string {
  const s = source.toLowerCase();
  if (/(complet|done|closed|term|ferm|finish)/.test(s)) return 'completed';
  if (/(cancel|annul)/.test(s)) return 'cancelled';
  if (/(progress|en cours)/.test(s)) return 'in_progress';
  if (/draft|brouillon/.test(s)) return 'draft';
  return 'scheduled';
}

function mapInvoiceStatus(source: string, paidCents: number | null, totalCents: number | null): string {
  const s = source.toLowerCase();
  if (/(paid|pay[ée]e?)/.test(s) && !/(unpaid|impay|partial)/.test(s)) return 'paid';
  if (/partial/.test(s)) return 'partial';
  if (/draft|brouillon/.test(s)) return 'draft';
  if (paidCents !== null && totalCents !== null && totalCents > 0 && paidCents >= totalCents) return 'paid';
  return 'sent';
}

// Workflow quotes de Lume : draft / awaiting_response / changes_requested /
// approved / converted / archived (migration 20260713000000).
function mapQuoteStatus(source: string): string {
  const s = source.toLowerCase();
  if (/(convert)/.test(s)) return 'converted';
  if (/(approv|accept|won|sign)/.test(s)) return 'approved';
  if (/(chang|revis)/.test(s)) return 'changes_requested';
  if (/(sent|await|open|pending|envoy)/.test(s)) return 'awaiting_response';
  if (/(archiv|declin|lost|refus|expir|cancel|annul)/.test(s)) return 'archived';
  return 'draft';
}

function mapVisitStatus(source: string): string {
  const s = source.toLowerCase();
  if (/(complet|done|term)/.test(s)) return 'completed';
  if (/(cancel|annul)/.test(s)) return 'cancelled';
  return 'scheduled';
}

// Statuts sources « reconnus » : ceux qui matchent une règle de mapping OU un
// mot bénin qui tombe légitimement sur le défaut. Tout le reste est signalé au
// dry-run (audit S3 : une valeur inconnue tombait sur le défaut en silence).
const BENIGN_DEFAULT_RE = /(sched|plan|book|open|activ|new|nouveau|upcoming|venir|pending|attente|confirm)/;
const RECOGNIZED_STATUS_RES: Partial<Record<TargetEntity, RegExp[]>> = {
  job: [/(complet|done|closed|term|ferm|finish)/, /(cancel|annul)/, /(progress|en cours)/, /draft|brouillon/, BENIGN_DEFAULT_RE],
  invoice: [/(paid|pay[ée]e?)/, /partial/, /draft|brouillon/, /(sent|envoy|due|overdue|retard|unpaid|impay)/, BENIGN_DEFAULT_RE],
  quote: [/(convert)/, /(approv|accept|won|sign)/, /(chang|revis)/, /(sent|await|open|pending|envoy)/, /(archiv|declin|lost|refus|expir|cancel|annul)/, /draft|brouillon/],
  visit: [/(complet|done|term)/, /(cancel|annul)/, BENIGN_DEFAULT_RE],
};

export function statusRecognized(entity: TargetEntity, source: string): boolean {
  const res = RECOGNIZED_STATUS_RES[entity];
  if (!res) return true; // entité sans statut mappé : rien à signaler
  const s = source.toLowerCase();
  return res.some((re) => re.test(s));
}

/**
 * Bloc « champs non importés » ajouté aux notes du dossier (clients/jobs) :
 * les colonnes non mappées ne disparaissent jamais silencieusement (audit S3).
 * Valeurs passées par l'anti-injection de formules.
 */
export function unmappedNotesBlock(n: Record<string, unknown>): string {
  const unmapped = n._unmapped;
  if (!unmapped || typeof unmapped !== 'object') return '';
  const lines: string[] = [];
  for (const [header, value] of Object.entries(unmapped as Record<string, unknown>)) {
    if (typeof value !== 'string' || !value) continue;
    lines.push(`${sanitizeCellForDisplay(header)} : ${sanitizeCellForDisplay(value)}`);
    if (lines.length >= 12) break;
  }
  if (lines.length === 0) return '';
  const block = `Champs non importés (ancien CRM) :\n${lines.join('\n')}`;
  return block.length > 1500 ? `${block.slice(0, 1500)}…` : block;
}

function joinNotes(notes: string, block: string): string | null {
  const joined = [notes, block].filter(Boolean).join('\n\n');
  return joined || null;
}

export interface BuildContext {
  migration: MigrationRow;
  createdBy: string;
  clientIdByRef: Map<string, string>;
  propertyIdByRef: Map<string, string>;
  jobIdByRef: Map<string, string>;
  /** refKey(nom source) → user_id Lume (migration_staff_mappings). Absent/null = non assigné. */
  staffIdBySource?: Map<string, string>;
}

// NB: `reason` est déclaré sur les deux branches (undefined côté succès) car le
// tsconfig du repo n'active pas `strict` — sans strictNullChecks, TS ne
// narrowe pas l'union via `!built.ok` et l'accès à `reason` serait rejeté.
type BuildResult =
  | { ok: true; row: Record<string, unknown>; reason?: undefined }
  | { ok: false; row?: undefined; reason: 'orphan' | 'invalid' };

/** Construit la rangée à insérer dans la table active. Exportée pour les tests
 *  (pure) : les contraintes NOT NULL de prod y sont encodées. */
export function buildEntityRow(entity: TargetEntity, rec: StagingRow, ctx: BuildContext): BuildResult {
  const n = rec.normalized ?? {};
  const r = rec.relations ?? {};
  const orgId = ctx.migration.org_id;

  if (entity === 'service') {
    const name = str(n.name);
    if (!name) return { ok: false, reason: 'invalid' };
    return {
      ok: true,
      row: {
        org_id: orgId,
        name,
        description: str(n.description) || null,
        default_price_cents: num(n.price_cents),
        is_active: true,
      },
    };
  }

  if (entity === 'client') {
    const hasIdentity = str(n.first_name) || str(n.last_name) || str(n.company) || str(n.full_name) || str(n.email);
    if (!hasIdentity) return { ok: false, reason: 'invalid' };
    return {
      ok: true,
      row: {
        org_id: orgId,
        first_name: str(n.first_name) || null,
        last_name: str(n.last_name) || null,
        company: str(n.company) || null,
        email: str(n.email) || null,
        phone: str(n.phone) || null,
        address: str(n.address) || null,
        city: str(n.city) || null,
        province: str(n.province) || null,
        postal_code: str(n.postal_code) || null,
        notes: joinNotes(str(n.notes), unmappedNotesBlock(n)),
        lead_source: str(n.lead_source) || null,
        status: 'active',
        created_by: ctx.createdBy,
        // date d'origine préservée (fidélité historique) — clé ABSENTE sinon,
        // pour laisser agir le DEFAULT now() (jamais de null explicite)
        ...(str(n.created_date) ? { created_at: `${str(n.created_date)}T12:00:00` } : {}),
      },
    };
  }

  if (entity === 'property') {
    const address = str(n.address);
    if (!address) return { ok: false, reason: 'invalid' };
    const clientId = lookupRef(ctx.clientIdByRef, r.client_ref);
    if (!clientId) return { ok: false, reason: 'orphan' };
    return {
      ok: true,
      row: {
        org_id: orgId,
        client_id: clientId,
        address,
        city: str(n.city) || null,
        province: str(n.province) || null,
        postal_code: str(n.postal_code) || null,
        name: str(n.name) || null,
        is_primary: false,
        created_by: ctx.createdBy,
      },
    };
  }

  if (entity === 'job') {
    const clientId = lookupRef(ctx.clientIdByRef, r.client_ref);
    if (!clientId) return { ok: false, reason: 'orphan' };
    const propertyId = r.property_ref
      ? lookupRef(ctx.propertyIdByRef, r.property_ref, (v) => normalizeAddressKey(v))
      : null;
    const title = str(n.title) || str(n.description).slice(0, 120) || `Job importé ${str(n.job_number) || rec.external_id || `#${rec.row_number}`}`;
    // jobs.total_cents/subtotal_cents sont NOT NULL en prod : jamais de null
    // explicite (il court-circuite les DEFAULT). Leçon du test E2E 2026-08-24.
    const totalCents = num(n.total_cents) ?? 0;
    const startAt = str(n.start_at) || (str(n.start_date) ? `${str(n.start_date)}T00:00:00` : null);
    return {
      ok: true,
      row: {
        org_id: orgId,
        client_id: clientId,
        client_name: str(r.client_ref) || null, // colonne héritée affichée par le calendrier
        property_id: propertyId,
        title,
        description: str(n.description) || null,
        notes: joinNotes(str(n.notes), unmappedNotesBlock(n)),
        job_number: str(n.job_number) || null,
        status: mapJobStatus(str(n.status)),
        total_cents: totalCents,
        subtotal_cents: num(n.subtotal_cents) ?? totalCents,
        sale_date: str(n.sale_date) || str(n.created_date) || null,
        start_at: startAt,
        scheduled_at: startAt,
        // Décision propriétaire (audit 2026-08-25) : les jobs migrés ne
        // comptent JAMAIS au leaderboard (created_by = invité, pas le vendeur).
        show_on_leaderboard: false,
        salesperson_id: ctx.staffIdBySource?.get(refKey(str(n.salesperson))) ?? null,
        created_by: ctx.createdBy,
      },
    };
  }

  if (entity === 'quote') {
    const clientId = lookupRef(ctx.clientIdByRef, r.client_ref);
    if (!clientId) return { ok: false, reason: 'orphan' };
    const jobId = r.job_ref ? lookupRef(ctx.jobIdByRef, r.job_ref) : null;
    const subtotal = num(n.subtotal_cents);
    const tax = num(n.tax_cents);
    let total = num(n.total_cents);
    if (total === null && subtotal !== null) total = subtotal + (tax ?? 0);
    return {
      ok: true,
      row: {
        org_id: ctx.migration.org_id,
        client_id: clientId,
        job_id: jobId,
        quote_number: str(n.quote_number) || null,
        // quotes.title est NOT NULL en prod (leçon E2E round 8)
        title: str(n.title) || (str(n.quote_number) ? `Soumission ${str(n.quote_number)}` : 'Soumission importée'),
        status: mapQuoteStatus(str(n.status)),
        subtotal_cents: subtotal ?? total ?? 0,
        tax_cents: tax ?? 0,
        total_cents: total ?? 0,
        valid_until: str(n.valid_until) || null,
        notes: str(n.notes) || null,
        created_by: ctx.createdBy,
      },
    };
  }

  if (entity === 'visit') {
    const jobId = lookupRef(ctx.jobIdByRef, r.job_ref);
    if (!jobId) return { ok: false, reason: 'orphan' };
    const startAt = str(n.start_at);
    if (!startAt) return { ok: false, reason: 'invalid' };
    let endAt = str(n.end_at);
    if (!endAt || endAt <= startAt) {
      // convention « pas d'heure précise » : 00:00 → 23:59, sinon +1 h
      endAt = startAt.endsWith('T00:00:00')
        ? `${startAt.slice(0, 10)}T23:59:00`
        : new Date(new Date(`${startAt}Z`).getTime() + 60 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, '');
    }
    // Heure locale du bureau → UTC : l'app écrit toISOString() et relit en
    // local (scheduleApi). Un naïf inséré tel quel serait pris pour de l'UTC
    // → « rendez-vous à 9 h » affiché à 5 h (audit S2, fuseaux horaires).
    const startUtc = localToUtcIso(startAt) ?? startAt;
    const endUtc = localToUtcIso(endAt) ?? endAt;
    return {
      ok: true,
      row: {
        org_id: orgId,
        job_id: jobId,
        title: str(n.title) || 'Visite importée',
        start_at: startUtc,
        end_at: endUtc,
        start_time: startUtc,
        end_time: endUtc,
        status: mapVisitStatus(str(n.status)),
        notes: str(n.notes) || null,
        timezone: 'America/Toronto', // aligné sur DEFAULT_TIMEZONE de scheduleApi
        assigned_user: ctx.staffIdBySource?.get(refKey(str(n.assigned_to))) ?? null,
        created_by: ctx.createdBy,
      },
    };
  }

  if (entity === 'invoice') {
    const clientId = lookupRef(ctx.clientIdByRef, r.client_ref);
    if (!clientId) return { ok: false, reason: 'orphan' };
    const jobId = r.job_ref ? lookupRef(ctx.jobIdByRef, r.job_ref) : null;
    const subtotal = num(n.subtotal_cents);
    const tax = num(n.tax_cents);
    let total = num(n.total_cents);
    if (total === null && subtotal !== null) total = subtotal + (tax ?? 0);
    if (total === null) return { ok: false, reason: 'invalid' };
    const paid = num(n.paid_amount_cents);
    const balance = num(n.balance_cents);
    let status: string;
    let paidCents: number;
    if (balance !== null) {
      // Le solde exporté fait foi : paiements partiels fidèles au cent près.
      paidCents = Math.min(Math.max(total - balance, 0), total);
      status = balance <= 0 ? 'paid' : paidCents > 0 ? 'partial' : mapInvoiceStatus(str(n.status), paidCents, total);
    } else {
      status = mapInvoiceStatus(str(n.status), paid, total);
      paidCents = status === 'paid' ? total : paid ?? 0;
    }
    return {
      ok: true,
      row: {
        org_id: orgId,
        client_id: clientId,
        job_id: jobId,
        invoice_number: str(n.invoice_number) || null,
        status,
        issued_at: str(n.issued_date) ? `${str(n.issued_date)}T12:00:00` : null,
        due_date: str(n.due_date) || null,
        subtotal_cents: subtotal ?? total,
        tax_cents: tax ?? 0,
        total_cents: total,
        paid_cents: paidCents,
        balance_cents: Math.max(0, total - paidCents),
        notes: str(n.notes) || null,
        created_by: ctx.createdBy,
      },
    };
  }

  return { ok: false, reason: 'invalid' };
}

function emptyCounts(): EntityCounts {
  return { wouldCreate: 0, wouldMerge: 0, ignored: 0, errors: 0, warnings: 0 };
}

function entitiesForMigration(migration: MigrationRow): TargetEntity[] {
  const categories = new Set(migration.categories ?? []);
  return IMPORT_ORDER.filter((e) => categories.has(CATEGORY_BY_ENTITY[e]));
}


/** Charge la correspondance employés (migration_staff_mappings). Table absente = map vide. */
async function loadStaffMap(admin: SupabaseClient, migrationId: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const { data, error } = await admin
    .from('migration_staff_mappings')
    .select('source_key, user_id')
    .eq('migration_id', migrationId)
    .limit(500);
  if (error) {
    if (!/relation|schema cache|does not exist/i.test(error.message)) {
      console.error('[migration-importer] staff map load failed:', error.message);
    }
    return map;
  }
  for (const r of (data ?? []) as { source_key: string; user_id: string | null }[]) {
    if (r.user_id) map.set(r.source_key, r.user_id);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Dry-run — aucune écriture dans les tables actives

export async function runDryRun(admin: SupabaseClient, migration: MigrationRow): Promise<DryRunReport> {
  const decisions = await loadDuplicateDecisions(admin, migration.id);
  const staffIdBySource = await loadStaffMap(admin, migration.id);
  const entities = entitiesForMigration(migration);
  const byEntity: Partial<Record<TargetEntity, EntityCounts>> = {};
  const notes: string[] = [];
  let orphans = 0;
  let revenueCents = 0;
  let sourceRows = 0;

  const ctx: BuildContext = {
    migration,
    createdBy: migration.invited_user_id ?? migration.created_by,
    clientIdByRef: new Map(),
    propertyIdByRef: new Map(),
    jobIdByRef: new Map(),
  };

  let intraMerged = 0;
  const allAmbiguousKeys: string[] = [];
  const unknownStatuses = new Map<string, number>(); // `${entity}:${valeur}` → occurrences
  for (const entity of entities) {
    const counts = emptyCounts();
    byEntity[entity] = counts;
    const rows = await loadStaging(admin, migration.id, entity, ['ready', 'duplicate', 'orphan', 'imported', 'merged']);
    const { count: errCount } = await admin
      .from('migration_staging_records')
      .select('id', { count: 'exact', head: true })
      .eq('migration_id', migration.id)
      .eq('entity_type', entity)
      .eq('status', 'error');
    counts.errors = errCount ?? 0;
    sourceRows += rows.length + counts.errors;

    const intra = planIntraDedupe(entity, rows);
    for (const k of intra.ambiguousKeys) allAmbiguousKeys.push(`${entity}:${k}`);
    const targetByStagingId = new Map<string, string>();
    const mapByEntity =
      entity === 'client' ? ctx.clientIdByRef : entity === 'property' ? ctx.propertyIdByRef : entity === 'job' ? ctx.jobIdByRef : null;

    for (const rec of rows) {
      const decision = decisions.get(rec.id);
      const sourceStatus = str((rec.normalized ?? {}).status);
      if (sourceStatus && !statusRecognized(entity, sourceStatus)) {
        const key = `${entity}:${sourceStatus.toLowerCase().slice(0, 40)}`;
        unknownStatuses.set(key, (unknownStatuses.get(key) ?? 0) + 1);
      }
      const registerRefs = (targetId: string) => {
        targetByStagingId.set(rec.id, targetId);
        if (!mapByEntity) return;
        for (const key of refKeysOf(entity, rec)) {
          if (entity === 'client' && intra.ambiguousKeys.has(key)) continue; // homonymes : jamais devinés
          const existing = mapByEntity.get(key);
          if (existing === undefined) mapByEntity.set(key, targetId);
          else if (existing !== targetId) {
            // collision entre dossiers distincts → clé retirée, relations en revue
            mapByEntity.delete(key);
            allAmbiguousKeys.push(`${entity}:${key}`);
          }
        }
      };

      // doublon INTERNE au fichier : fusionné avec son dossier primaire
      const primaryId = intra.siblingOf.get(rec.id);
      if (primaryId && targetByStagingId.has(primaryId)) {
        counts.wouldMerge += 1;
        intraMerged += 1;
        registerRefs(targetByStagingId.get(primaryId)!);
        continue;
      }

      if (decision?.decision === 'skip') {
        counts.ignored += 1;
        registerRefs(decision.existingId);
        continue;
      }
      if (decision?.decision === 'merge') {
        counts.wouldMerge += 1;
        registerRefs(decision.existingId);
        continue;
      }
      if (decision && decision.decision !== 'create_new' && decision.score >= 90) {
        // doublon fort non tranché : averti au dry-run, bloqué à l'import final
        counts.warnings += 1;
      }

      const built = buildEntityRow(entity, rec, ctx);
      if (!built.ok) {
        if (built.reason === 'orphan') {
          orphans += 1;
          counts.ignored += 1;
        } else {
          counts.errors += 1;
        }
        continue;
      }
      counts.wouldCreate += 1;
      registerRefs(deterministicEntityId(migration.id, rec.id, TABLE_BY_ENTITY[entity]));
      if (entity === 'invoice') {
        const total = num((built.row as Record<string, unknown>).total_cents);
        if (total !== null) revenueCents += total;
      }
    }

    if (counts.wouldMerge > 0) notes.push(`${counts.wouldMerge} ${entity}(s) seront fusionnés (doublons internes ou dossiers existants).`);
    if (counts.errors > 0) notes.push(`${counts.errors} ligne(s) ${entity} en erreur (valeurs invalides) — voir les problèmes.`);
  }

  if (intraMerged > 0) notes.push(`${intraMerged} doublon(s) interne(s) aux fichiers fusionnés automatiquement (mêmes courriel/téléphone/numéro).`);
  if (allAmbiguousKeys.length > 0) {
    notes.push(`${allAmbiguousKeys.length} clé(s) de référence ambiguë(s) (ex. homonymes) — les dossiers liés sont exclus en attendant validation.`);
    const title = 'Références ambiguës détectées (homonymes ou numéros partagés)';
    const { data: existingIssue } = await admin
      .from('migration_issues')
      .select('id')
      .eq('migration_id', migration.id)
      .eq('type', 'ambiguous_relation')
      .is('resolved_at', null)
      .limit(1)
      .maybeSingle();
    if (!existingIssue) {
      const { error: issueErr } = await admin.from('migration_issues').insert({
        migration_id: migration.id,
        type: 'ambiguous_relation',
        severity: 'warning',
        title,
        details_masked: { keys: allAmbiguousKeys.slice(0, 20) },
        options: ['review'],
      });
      if (issueErr) console.error('[migration-importer] ambiguous issue insert failed:', issueErr.message);
    }
  }

  if (orphans > 0) notes.push(`${orphans} ligne(s) sans relation résoluble (ex. job sans client, homonymes) seront exclues.`);

  // Statuts sources non reconnus : la valeur par défaut s'appliquera — on le
  // dit AVANT l'import au lieu de coercer en silence (audit S3).
  if (unknownStatuses.size > 0) {
    const detail = Array.from(unknownStatuses.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([k, count]) => ({ value: k, count }));
    const total = Array.from(unknownStatuses.values()).reduce((a, b) => a + b, 0);
    notes.push(`${unknownStatuses.size} statut(s) source non reconnu(s) (${total} ligne(s)) — statut par défaut appliqué, voir les problèmes.`);
    const title = 'Statuts sources non reconnus — valeur par défaut appliquée';
    const { data: existingStatusIssue } = await admin
      .from('migration_issues')
      .select('id')
      .eq('migration_id', migration.id)
      .eq('type', 'unknown_status')
      .is('resolved_at', null)
      .limit(1)
      .maybeSingle();
    if (!existingStatusIssue) {
      const { error: statusIssueErr } = await admin.from('migration_issues').insert({
        migration_id: migration.id,
        type: 'unknown_status',
        severity: 'warning',
        title,
        details_masked: { statuses: detail }, // valeurs de statut = non-PII
        options: ['acknowledge'],
      });
      if (statusIssueErr) console.error('[migration-importer] unknown status issue insert failed:', statusIssueErr.message);
    }
  }

  const dupCounts = { pending: 0, merge: 0, createNew: 0, skip: 0, review: 0 };
  for (const d of decisions.values()) {
    if (d.decision === 'merge') dupCounts.merge += 1;
    else if (d.decision === 'create_new') dupCounts.createNew += 1;
    else if (d.decision === 'skip') dupCounts.skip += 1;
    else if (d.decision === 'review') dupCounts.review += 1;
    else dupCounts.pending += 1;
  }

  const { count: openIssues } = await admin
    .from('migration_issues')
    .select('id', { count: 'exact', head: true })
    .eq('migration_id', migration.id)
    .is('resolved_at', null);

  const totals = {
    sourceRows,
    wouldCreate: Object.values(byEntity).reduce((acc, c) => acc + (c?.wouldCreate ?? 0), 0),
    wouldMerge: Object.values(byEntity).reduce((acc, c) => acc + (c?.wouldMerge ?? 0), 0),
    ignored: Object.values(byEntity).reduce((acc, c) => acc + (c?.ignored ?? 0), 0),
    blockingErrors: Object.values(byEntity).reduce((acc, c) => acc + (c?.errors ?? 0), 0),
    warnings: Object.values(byEntity).reduce((acc, c) => acc + (c?.warnings ?? 0), 0),
    revenueCents,
  };

  // Taux d'échec anormal : dit en toutes lettres dans le rapport (audit S4) —
  // le blocage dur (> MAX_IMPORT_ERROR_RATIO) vit sur la route d'import final.
  if (totals.sourceRows > 0) {
    const failRatio = (totals.blockingErrors + orphans) / totals.sourceRows;
    if (failRatio > 0.1) {
      notes.unshift(
        `Attention : ${Math.round(failRatio * 100)} % des lignes seraient rejetées ou exclues — corrigez les fichiers avant d'approuver.`,
      );
    }
  }

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    byEntity,
    totals,
    duplicates: dupCounts,
    orphans,
    openIssues: openIssues ?? 0,
    notes,
  };
}

// ---------------------------------------------------------------------------
// Import final — idempotent, repris sans doublon

/** Au-delà de ce taux d'échec (erreurs + orphelins / lignes), l'import final
 *  est refusé : un fichier aussi cassé se corrige, il ne s'importe pas (audit S4). */
export const MAX_IMPORT_ERROR_RATIO = 0.25;

interface ImportRecordRow {
  batch_id: string;
  migration_id: string;
  staging_record_id: string;
  entity_table: string;
  entity_id: string;
  action: 'created' | 'merged' | 'skipped';
  /** Fusion enrichissante : valeurs d'origine des champs comblés (rollback fidèle). */
  previous_values?: Record<string, unknown> | null;
}

async function upsertImportRecords(admin: SupabaseClient, records: ImportRecordRow[]): Promise<void> {
  for (let i = 0; i < records.length; i += CHUNK) {
    const chunk = records.slice(i, i + CHUNK);
    const { error } = await admin
      .from('migration_import_records')
      .upsert(chunk, { onConflict: 'migration_id,staging_record_id,entity_table', ignoreDuplicates: true });
    if (error) {
      // colonne previous_values absente (SQL 20260903000000 pas appliqué) :
      // on n'échoue jamais le registre d'idempotence pour autant.
      if (/previous_values/i.test(error.message)) {
        const stripped = chunk.map(({ previous_values: _pv, ...rest }) => rest);
        const { error: retryErr } = await admin
          .from('migration_import_records')
          .upsert(stripped, { onConflict: 'migration_id,staging_record_id,entity_table', ignoreDuplicates: true });
        if (retryErr) console.error('[migration-importer] import_records upsert failed:', retryErr.message);
        else console.error('[migration-importer] previous_values ignoré — appliquez le SQL 20260903000000');
        continue;
      }
      console.error('[migration-importer] import_records upsert failed:', error.message);
    }
  }
}

/** Champs d'un client existant que la fusion peut COMBLER (jamais écraser). */
const ENRICHABLE_CLIENT_FIELDS = [
  'first_name', 'last_name', 'company', 'email', 'phone',
  'address', 'city', 'province', 'postal_code', 'lead_source',
] as const;

/**
 * Fusion enrichissante (clients) : les champs VIDES du dossier existant sont
 * comblés par la source ; les non-vides ne sont jamais touchés. Retourne, par
 * ligne de staging, les valeurs d'origine des champs modifiés (audit S5 :
 * « merge » jetait la ligne source entière). Idempotent : au 2e passage les
 * champs sont remplis, le patch est vide, rien ne bouge.
 */
async function enrichMergedClients(
  admin: SupabaseClient,
  ctx: BuildContext,
  targets: { rec: StagingRow; existingId: string }[],
): Promise<Map<string, Record<string, unknown>>> {
  const out = new Map<string, Record<string, unknown>>();
  if (targets.length === 0) return out;

  const ids = Array.from(new Set(targets.map((t) => t.existingId)));
  const existingById = new Map<string, Record<string, unknown>>();
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await admin
      .from('clients')
      .select('id, first_name, last_name, company, email, phone, address, city, province, postal_code, lead_source')
      .in('id', ids.slice(i, i + CHUNK))
      .eq('org_id', ctx.migration.org_id);
    if (error) {
      console.error('[migration-importer] enrich fetch failed:', error.message);
      return out;
    }
    for (const c of (data ?? []) as Record<string, unknown>[]) existingById.set(String(c.id), c);
  }

  for (const t of targets) {
    const existing = existingById.get(t.existingId);
    if (!existing) continue;
    const built = buildEntityRow('client', t.rec, ctx);
    if (!built.ok) continue;
    const patch: Record<string, unknown> = {};
    const prev: Record<string, unknown> = {};
    for (const f of ENRICHABLE_CLIENT_FIELDS) {
      const cur = existing[f];
      const incoming = (built.row as Record<string, unknown>)[f];
      const curEmpty = cur === null || cur === undefined || String(cur).trim() === '';
      if (curEmpty && typeof incoming === 'string' && incoming) {
        patch[f] = incoming;
        prev[f] = cur ?? null;
      }
    }
    if (Object.keys(patch).length === 0) continue;
    const { error } = await admin.from('clients').update(patch).eq('id', t.existingId).eq('org_id', ctx.migration.org_id);
    if (error) {
      console.error('[migration-importer] enrich update failed:', error.message);
      continue;
    }
    out.set(t.rec.id, prev);
    // deux lignes fusionnées vers le même dossier : la 2e voit les champs comblés
    existingById.set(t.existingId, { ...existing, ...patch });
  }
  return out;
}

async function setStagingStatus(admin: SupabaseClient, migrationId: string, ids: string[], status: string): Promise<void> {
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { error } = await admin
      .from('migration_staging_records')
      .update({ status })
      .eq('migration_id', migrationId)
      .in('id', ids.slice(i, i + CHUNK));
    if (error) console.error('[migration-importer] staging status update failed:', error.message);
  }
}

export async function runFinalImport(
  admin: SupabaseClient,
  migration: MigrationRow,
  batchId: string,
  actorId: string,
): Promise<DryRunReport> {
  const decisions = await loadDuplicateDecisions(admin, migration.id);
  const staffIdBySource = await loadStaffMap(admin, migration.id);
  const entities = entitiesForMigration(migration);

  // Reprise : ce qui a déjà été importé pour cette migration.
  const already = new Map<string, { entity_id: string; action: string; entity_table: string }>();
  for (let offset = 0; ; offset += STAGING_PAGE) {
    const { data, error } = await admin
      .from('migration_import_records')
      .select('staging_record_id, entity_id, action, entity_table')
      .eq('migration_id', migration.id)
      .range(offset, offset + STAGING_PAGE - 1);
    if (error) {
      console.error('[migration-importer] import_records fetch failed:', error.message);
      break;
    }
    if (!data || data.length === 0) break;
    for (const rec of data as { staging_record_id: string; entity_id: string; action: string; entity_table: string }[]) {
      already.set(`${rec.staging_record_id}|${rec.entity_table}`, rec);
    }
    if (data.length < STAGING_PAGE) break;
  }

  const ctx: BuildContext = {
    migration,
    createdBy: migration.invited_user_id ?? migration.created_by,
    clientIdByRef: new Map(),
    propertyIdByRef: new Map(),
    jobIdByRef: new Map(),
    staffIdBySource,
  };

  const byEntity: Partial<Record<TargetEntity, EntityCounts>> = {};
  const notes: string[] = [];
  let orphans = 0;
  let revenueCents = 0;
  let sourceRows = 0;

  for (const entity of entities) {
    const table = TABLE_BY_ENTITY[entity];
    const counts = emptyCounts();
    byEntity[entity] = counts;
    const rows = await loadStaging(admin, migration.id, entity, ['ready', 'duplicate', 'orphan', 'imported', 'merged']);
    sourceRows += rows.length;

    const toInsert: { rec: StagingRow; row: Record<string, unknown>; id: string }[] = [];
    const importRecords: ImportRecordRow[] = [];
    const enrichTargets: { rec: StagingRow; existingId: string }[] = [];
    const mergedIds: string[] = [];
    const ignoredIds: string[] = [];
    const orphanIds: string[] = [];
    const errorIds: string[] = [];

    const intra = planIntraDedupe(entity, rows);
    const targetByStagingId = new Map<string, string>();
    const siblings: StagingRow[] = [];
    const mapByEntity =
      entity === 'client' ? ctx.clientIdByRef : entity === 'property' ? ctx.propertyIdByRef : entity === 'job' ? ctx.jobIdByRef : null;

    const registerRefs = (rec: StagingRow, targetId: string) => {
      targetByStagingId.set(rec.id, targetId);
      if (!mapByEntity) return;
      for (const key of refKeysOf(entity, rec)) {
        if (entity === 'client' && intra.ambiguousKeys.has(key)) continue; // homonymes : jamais devinés
        const existing = mapByEntity.get(key);
        if (existing === undefined) mapByEntity.set(key, targetId);
        else if (existing !== targetId) mapByEntity.delete(key); // collision → relation en revue (orphan)
      }
    };

    for (const rec of rows) {
      // Reprise : déjà traité lors d'un passage précédent.
      const prior = already.get(`${rec.id}|${table}`);
      if (prior) {
        if (prior.action === 'created') counts.wouldCreate += 1;
        else if (prior.action === 'merged') counts.wouldMerge += 1;
        else counts.ignored += 1;
        registerRefs(rec, prior.entity_id);
        continue;
      }

      // Doublon INTERNE au fichier : traité après les insertions, fusionné
      // vers son dossier primaire (jamais créé en double).
      if (intra.siblingOf.has(rec.id)) {
        siblings.push(rec);
        continue;
      }

      const decision = decisions.get(rec.id);
      if (decision?.decision === 'skip') {
        counts.ignored += 1;
        ignoredIds.push(rec.id);
        importRecords.push({ batch_id: batchId, migration_id: migration.id, staging_record_id: rec.id, entity_table: table, entity_id: decision.existingId, action: 'skipped' });
        registerRefs(rec, decision.existingId);
        continue;
      }
      if (decision?.decision === 'merge') {
        counts.wouldMerge += 1;
        mergedIds.push(rec.id);
        importRecords.push({ batch_id: batchId, migration_id: migration.id, staging_record_id: rec.id, entity_table: table, entity_id: decision.existingId, action: 'merged' });
        registerRefs(rec, decision.existingId);
        if (entity === 'client') enrichTargets.push({ rec, existingId: decision.existingId });
        continue;
      }
      if (decision && decision.decision !== 'create_new' && decision.score >= 90) {
        // Doublon fort jamais tranché : on n'importe pas, on signale.
        counts.warnings += 1;
        counts.ignored += 1;
        ignoredIds.push(rec.id);
        continue;
      }

      const built = buildEntityRow(entity, rec, ctx);
      if (!built.ok) {
        if (built.reason === 'orphan') {
          orphans += 1;
          counts.ignored += 1;
          orphanIds.push(rec.id);
        } else {
          counts.errors += 1;
          errorIds.push(rec.id);
        }
        continue;
      }
      const id = deterministicEntityId(migration.id, rec.id, table);
      targetByStagingId.set(rec.id, id);
      toInsert.push({ rec, row: { id, ...built.row }, id });
    }

    // Insertion par lots, idempotente ; en cas d'échec de lot, repli par ligne
    // pour isoler la rangée fautive (ex. collision de numéro unique).
    const importedIds: string[] = [];
    for (let i = 0; i < toInsert.length; i += CHUNK) {
      const chunk = toInsert.slice(i, i + CHUNK);
      const { error } = await admin.from(table).upsert(chunk.map((c) => c.row), { onConflict: 'id', ignoreDuplicates: true });
      if (!error) {
        for (const c of chunk) {
          counts.wouldCreate += 1;
          importedIds.push(c.rec.id);
          importRecords.push({ batch_id: batchId, migration_id: migration.id, staging_record_id: c.rec.id, entity_table: table, entity_id: c.id, action: 'created' });
          registerRefs(c.rec, c.id);
          if (entity === 'invoice') {
            const total = num(c.row.total_cents);
            if (total !== null) revenueCents += total;
          }
        }
        continue;
      }
      console.error(`[migration-importer] chunk upsert failed on ${table}, retry per row:`, error.message);
      for (const c of chunk) {
        const { error: rowErr } = await admin.from(table).upsert([c.row], { onConflict: 'id', ignoreDuplicates: true });
        if (rowErr) {
          counts.errors += 1;
          errorIds.push(c.rec.id);
          const { error: markErr } = await admin
            .from('migration_staging_records')
            .update({ status: 'error', error: `import_failed:${rowErr.code ?? 'unknown'}` })
            .eq('id', c.rec.id);
          if (markErr) console.error('[migration-importer] staging error mark failed:', markErr.message);
        } else {
          counts.wouldCreate += 1;
          importedIds.push(c.rec.id);
          importRecords.push({ batch_id: batchId, migration_id: migration.id, staging_record_id: c.rec.id, entity_table: table, entity_id: c.id, action: 'created' });
          registerRefs(c.rec, c.id);
          if (entity === 'invoice') {
            const total = num(c.row.total_cents);
            if (total !== null) revenueCents += total;
          }
        }
      }
    }

    // Doublons internes : fusion vers le dossier primaire réellement importé.
    for (const rec of siblings) {
      const primaryId = intra.siblingOf.get(rec.id)!;
      const target = targetByStagingId.get(primaryId);
      if (!target || errorIds.includes(primaryId)) {
        counts.errors += 1;
        errorIds.push(rec.id);
        continue;
      }
      counts.wouldMerge += 1;
      mergedIds.push(rec.id);
      importRecords.push({ batch_id: batchId, migration_id: migration.id, staging_record_id: rec.id, entity_table: table, entity_id: target, action: 'merged' });
      registerRefs(rec, target);
    }

    // Fusion enrichissante (clients) : appliquer AVANT d'écrire le registre,
    // pour que previous_values parte dans la même écriture idempotente.
    if (enrichTargets.length > 0) {
      const prevByStagingId = await enrichMergedClients(admin, ctx, enrichTargets);
      for (const ir of importRecords) {
        const prev = prevByStagingId.get(ir.staging_record_id);
        if (prev) ir.previous_values = prev;
      }
    }

    await upsertImportRecords(admin, importRecords);
    await setStagingStatus(admin, migration.id, importedIds, 'imported');
    await setStagingStatus(admin, migration.id, mergedIds, 'merged');
    await setStagingStatus(admin, migration.id, ignoredIds, 'ignored');
    await setStagingStatus(admin, migration.id, orphanIds, 'orphan');

    if (counts.wouldMerge > 0) notes.push(`${counts.wouldMerge} ${entity}(s) fusionnés avec des dossiers existants.`);
    if (counts.errors > 0) notes.push(`${counts.errors} ligne(s) ${entity} rejetées à l'import — voir le staging.`);
  }

  if (orphans > 0) notes.push(`${orphans} ligne(s) exclues faute de relation (dossiers orphelins).`);

  const totals = {
    sourceRows,
    wouldCreate: Object.values(byEntity).reduce((acc, c) => acc + (c?.wouldCreate ?? 0), 0),
    wouldMerge: Object.values(byEntity).reduce((acc, c) => acc + (c?.wouldMerge ?? 0), 0),
    ignored: Object.values(byEntity).reduce((acc, c) => acc + (c?.ignored ?? 0), 0),
    blockingErrors: Object.values(byEntity).reduce((acc, c) => acc + (c?.errors ?? 0), 0),
    warnings: Object.values(byEntity).reduce((acc, c) => acc + (c?.warnings ?? 0), 0),
    revenueCents,
  };

  const { count: openIssues } = await admin
    .from('migration_issues')
    .select('id', { count: 'exact', head: true })
    .eq('migration_id', migration.id)
    .is('resolved_at', null);

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    byEntity,
    totals,
    duplicates: { pending: 0, merge: totals.wouldMerge, createNew: totals.wouldCreate, skip: totals.ignored, review: 0 },
    orphans,
    openIssues: openIssues ?? 0,
    notes,
  };
}


/**
 * Purge les notifications du fil d'activité générées par les triggers
 * (20260747000000) lors de l'insertion massive des entités importées.
 * Décision audit 2026-08-25 : l'historique migré ne doit pas inonder le fil.
 * Ne touche qu'aux notifications dont reference_id ∈ entités créées par le lot.
 */
export async function purgeImportActivityNoise(
  admin: SupabaseClient,
  migration: MigrationRow,
  batchId: string,
): Promise<number> {
  let purged = 0;
  const ids: string[] = [];
  for (let offset = 0; ; offset += STAGING_PAGE) {
    const { data, error } = await admin
      .from('migration_import_records')
      .select('entity_id')
      .eq('batch_id', batchId)
      .eq('action', 'created')
      .range(offset, offset + STAGING_PAGE - 1);
    if (error) {
      console.error('[migration-importer] noise purge fetch failed:', error.message);
      break;
    }
    if (!data || data.length === 0) break;
    for (const r of data as { entity_id: string }[]) ids.push(r.entity_id);
    if (data.length < STAGING_PAGE) break;
  }
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await admin
      .from('notifications')
      .delete()
      .eq('org_id', migration.org_id)
      .in('reference_id', ids.slice(i, i + CHUNK))
      .select('id');
    if (error) console.error('[migration-importer] noise purge delete failed:', error.message);
    else purged += (data ?? []).length;
  }
  return purged;
}

// ---------------------------------------------------------------------------
// Rollback — uniquement les entités créées par le lot

export async function rollbackFinalBatch(
  admin: SupabaseClient,
  batchId: string,
  actorId: string,
): Promise<{ softDeleted: number; deactivated: number; restored: number }> {
  let softDeleted = 0;
  let deactivated = 0;
  let restored = 0;

  const byTable = new Map<string, string[]>();
  for (let offset = 0; ; offset += STAGING_PAGE) {
    const { data, error } = await admin
      .from('migration_import_records')
      .select('entity_table, entity_id, action')
      .eq('batch_id', batchId)
      .eq('action', 'created')
      .range(offset, offset + STAGING_PAGE - 1);
    if (error) {
      console.error('[migration-importer] rollback fetch failed:', error.message);
      break;
    }
    if (!data || data.length === 0) break;
    for (const rec of data as { entity_table: string; entity_id: string }[]) {
      const arr = byTable.get(rec.entity_table) ?? [];
      arr.push(rec.entity_id);
      byTable.set(rec.entity_table, arr);
    }
    if (data.length < STAGING_PAGE) break;
  }

  for (const [table, ids] of byTable) {
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK);
      if (table === 'predefined_services') {
        const { data, error } = await admin.from(table).update({ is_active: false }).in('id', chunk).select('id');
        if (error) console.error('[migration-importer] rollback deactivate failed:', error.message);
        else deactivated += (data ?? []).length;
      } else {
        const patch: Record<string, unknown> = { deleted_at: new Date().toISOString() };
        if (table === 'clients' || table === 'jobs' || table === 'invoices') patch.deleted_by = actorId;
        const { data, error } = await admin.from(table).update(patch).in('id', chunk).is('deleted_at', null).select('id');
        if (error) console.error('[migration-importer] rollback soft-delete failed:', error.message);
        else softDeleted += (data ?? []).length;
      }
    }
  }

  // Fusions enrichissantes : restaurer les valeurs d'origine des champs
  // comblés (previous_values). Les dossiers fusionnés eux-mêmes ne sont
  // jamais supprimés — ils préexistaient à l'import.
  for (let offset = 0; ; offset += STAGING_PAGE) {
    const { data, error } = await admin
      .from('migration_import_records')
      .select('entity_table, entity_id, previous_values')
      .eq('batch_id', batchId)
      .eq('action', 'merged')
      .not('previous_values', 'is', null)
      .range(offset, offset + STAGING_PAGE - 1);
    if (error) {
      // colonne absente (SQL 20260903000000 pas appliqué) : rien à restaurer
      if (!/previous_values/i.test(error.message)) {
        console.error('[migration-importer] rollback merged fetch failed:', error.message);
      }
      break;
    }
    if (!data || data.length === 0) break;
    for (const rec of data as { entity_table: string; entity_id: string; previous_values: Record<string, unknown> | null }[]) {
      if (!rec.previous_values || Object.keys(rec.previous_values).length === 0) continue;
      const { error: restoreErr } = await admin.from(rec.entity_table).update(rec.previous_values).eq('id', rec.entity_id);
      if (restoreErr) console.error('[migration-importer] rollback restore failed:', restoreErr.message);
      else restored += 1;
    }
    if (data.length < STAGING_PAGE) break;
  }

  const { error: batchErr } = await admin
    .from('migration_import_batches')
    .update({ status: 'rolled_back', rolled_back_at: new Date().toISOString(), rolled_back_by: actorId })
    .eq('id', batchId);
  if (batchErr) console.error('[migration-importer] batch rollback mark failed:', batchErr.message);

  return { softDeleted, deactivated, restored };
}

// ---------------------------------------------------------------------------
// Validation post-import

export async function runPostImportValidation(
  admin: SupabaseClient,
  migration: MigrationRow,
  batchId: string,
): Promise<PostImportValidation> {
  const checks: PostImportValidation['checks'] = [];
  const notes: string[] = [];

  const entities = entitiesForMigration(migration);

  // 1) Aucune ligne de staging en erreur d'import : un échec massif d'une
  //    catégorie ne doit JAMAIS aboutir à un statut « terminé » silencieux
  //    (angle mort attrapé par le test E2E du 2026-08-24 : 28 jobs rejetés,
  //    statut completed quand même).
  const { count: stagingErrors } = await admin
    .from('migration_staging_records')
    .select('id', { count: 'exact', head: true })
    .eq('migration_id', migration.id)
    .eq('status', 'error');
  checks.push({ name: 'staging_errors', expected: 0, actual: stagingErrors ?? 0, ok: (stagingErrors ?? 0) === 0 });

  // 2) Le réel doit correspondre au rapport APPROUVÉ par le client.
  const { data: approval } = await admin
    .from('migration_approvals')
    .select('report')
    .eq('migration_id', migration.id)
    .eq('decision', 'approved')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const approvedByEntity = (approval?.report as DryRunReport | null)?.byEntity ?? null;
  for (const entity of entities) {
    const table = TABLE_BY_ENTITY[entity];
    const [{ count: expected }, { count: actual }] = await Promise.all([
      admin
        .from('migration_staging_records')
        .select('id', { count: 'exact', head: true })
        .eq('migration_id', migration.id)
        .eq('entity_type', entity)
        .in('status', ['imported', 'merged']),
      admin
        .from('migration_import_records')
        .select('id', { count: 'exact', head: true })
        .eq('migration_id', migration.id)
        .eq('entity_table', table)
        .in('action', ['created', 'merged']),
    ]);
    checks.push({ name: `count:${entity}`, expected: expected ?? 0, actual: actual ?? 0, ok: (expected ?? 0) === (actual ?? 0) });

    if (approvedByEntity && approvedByEntity[entity]) {
      const promised = (approvedByEntity[entity]?.wouldCreate ?? 0) + (approvedByEntity[entity]?.wouldMerge ?? 0);
      checks.push({ name: `approved:${entity}`, expected: promised, actual: actual ?? 0, ok: promised === (actual ?? 0) });
    }
  }

  // Relations : aucun job/facture créé ne doit rester sans client.
  for (const table of ['jobs', 'invoices']) {
    const ids: string[] = [];
    const { data } = await admin
      .from('migration_import_records')
      .select('entity_id')
      .eq('batch_id', batchId)
      .eq('entity_table', table)
      .eq('action', 'created')
      .limit(5000);
    for (const rec of (data ?? []) as { entity_id: string }[]) ids.push(rec.entity_id);
    let missing = 0;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const { count } = await admin
        .from(table)
        .select('id', { count: 'exact', head: true })
        .in('id', ids.slice(i, i + CHUNK))
        .is('client_id', null);
      missing += count ?? 0;
    }
    checks.push({ name: `relation:${table}.client_id`, expected: 0, actual: missing, ok: missing === 0 });
  }

  // Somme monétaire : les factures réellement créées doivent totaliser
  // exactement les revenus du rapport approuvé par le client (au cent près).
  const approvedRevenue = (approval?.report as DryRunReport | null)?.totals?.revenueCents;
  if (typeof approvedRevenue === 'number') {
    const invoiceIds: string[] = [];
    for (let offset = 0; ; offset += STAGING_PAGE) {
      const { data } = await admin
        .from('migration_import_records')
        .select('entity_id')
        .eq('migration_id', migration.id)
        .eq('entity_table', 'invoices')
        .eq('action', 'created')
        .range(offset, offset + STAGING_PAGE - 1);
      if (!data || data.length === 0) break;
      for (const r of data as { entity_id: string }[]) invoiceIds.push(r.entity_id);
      if (data.length < STAGING_PAGE) break;
    }
    let actualCents = 0;
    for (let i = 0; i < invoiceIds.length; i += CHUNK) {
      const { data } = await admin
        .from('invoices')
        .select('total_cents')
        .in('id', invoiceIds.slice(i, i + CHUNK));
      for (const r of (data ?? []) as { total_cents: number | null }[]) actualCents += r.total_cents ?? 0;
    }
    checks.push({ name: 'money:invoices_total_cents', expected: approvedRevenue, actual: actualCents, ok: approvedRevenue === actualCents });
  }

  const failed = checks.filter((c) => !c.ok);
  let outcome: PostImportValidation['outcome'] = 'passed';
  if (failed.length > 0) {
    const severe = failed.some((c) => {
      const base = Math.max(1, c.expected);
      return Math.abs(c.expected - c.actual) / base > 0.02;
    });
    outcome = severe ? 'review_required' : 'passed_with_warnings';
    notes.push(`${failed.length} vérification(s) en écart — voir le détail.`);
  }
  return { outcome, checks, notes };
}
