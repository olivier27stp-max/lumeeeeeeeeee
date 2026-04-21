#!/usr/bin/env node
/**
 * check-deprecated-access.mjs
 *
 * Weekly check on tables marked DEPRECATED 2026-04-21 (30-day grace).
 * Queries each via PostgREST with HEAD + Prefer: count=exact to get a
 * row count without pulling data, and appends the results to
 * memory/audit_reports/deprecation_log.json.
 *
 * Run with: node scripts/check-deprecated-access.mjs
 * Scheduled DROP date: 2026-05-21. If any table shows growth in rows
 * between now and then, INVESTIGATE before dropping.
 *
 * Requires .env.local in the lume-crm root with:
 *   VITE_SUPABASE_URL=...
 *   SUPABASE_SERVICE_ROLE_KEY=...
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(ROOT, '..');

const DEPRECATED_TABLES = [
  'agent_chat_sessions',
  'ai_message_files',
  'sales_ai_recommendations',
  'archived_records',
  'object_permissions',
  'automation_executions',
  'availabilities',
  'budget_targets',
  'client_link_backfill_ambiguous',
  'currency_rates',
  'entity_comments',
  'entity_tags',
  'board_members',
  'director_creative_directions',
  'field_pin_templates',
  'field_rep_performance',
  'field_schedule_slots',
  'job_photos',
  'job_signatures',
  'location_logs',
  'invoice_sequences',
  'quote_sequences',
  'pipeline_stages',
  'rate_limit_buckets',
];

const LOG_PATH = path.join(REPO_ROOT, 'memory', 'audit_reports', 'deprecation_log.json');

function loadEnv() {
  const envPath = path.join(ROOT, '.env.local');
  const text = fs.readFileSync(envPath, 'utf8');
  const pick = (k) => {
    const m = text.match(new RegExp('^' + k + '\\s*=\\s*"?([^"\\n]+)', 'm'));
    return m ? m[1].trim() : undefined;
  };
  const url = pick('VITE_SUPABASE_URL');
  const key = pick('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  return { url, key };
}

async function countTable(url, key, table) {
  const endpoint = `${url}/rest/v1/${table}?select=*&limit=0`;
  const res = await fetch(endpoint, {
    method: 'HEAD',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Prefer: 'count=exact',
    },
  });
  if (res.status === 404) return { table, status: 'missing', count: null };
  if (!res.ok) return { table, status: `http_${res.status}`, count: null };
  const range = res.headers.get('content-range');
  const count = range && range.includes('/') ? Number(range.split('/')[1]) : null;
  return { table, status: 'ok', count: Number.isFinite(count) ? count : null };
}

async function main() {
  const { url, key } = loadEnv();
  const results = [];
  for (const t of DEPRECATED_TABLES) {
    try {
      results.push(await countTable(url, key, t));
    } catch (e) {
      results.push({ table: t, status: 'error', error: String(e?.message ?? e), count: null });
    }
  }
  const entry = { run_at: new Date().toISOString(), results };

  let existing = [];
  if (fs.existsSync(LOG_PATH)) {
    try { existing = JSON.parse(fs.readFileSync(LOG_PATH, 'utf8')); } catch { existing = []; }
    if (!Array.isArray(existing)) existing = [];
  }
  existing.push(entry);
  fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
  fs.writeFileSync(LOG_PATH, JSON.stringify(existing, null, 2));

  const nonZero = results.filter((r) => r.status === 'ok' && (r.count ?? 0) > 0);
  console.log(`Checked ${results.length} deprecated tables at ${entry.run_at}`);
  console.log(`Non-empty: ${nonZero.length}`);
  for (const r of nonZero) console.log(`  ${r.table}: ${r.count} rows`);
  const errors = results.filter((r) => r.status !== 'ok');
  if (errors.length) {
    console.log(`Errors/missing: ${errors.length}`);
    for (const r of errors) console.log(`  ${r.table}: ${r.status}`);
  }
  console.log(`Log appended to ${LOG_PATH}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
