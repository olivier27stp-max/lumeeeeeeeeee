/**
 * Applique la migration 20260713000000_quotes_status_workflow.sql
 *
 * Usage :
 *   1. Mets SUPABASE_DB_PASSWORD dans .env.local (ou exporte-le)
 *   2. npx tsx scripts/apply-quotes-status-workflow.ts
 *
 * Idempotent : le SQL utilise IF NOT EXISTS / CREATE OR REPLACE et des
 * UPDATE ciblés sur les anciens statuts, donc relançable sans danger.
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';

const { Client } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATION = join(__dirname, '..', 'supabase', 'migrations', '20260713000000_quotes_status_workflow.sql');

async function run() {
  const password = process.env.SUPABASE_DB_PASSWORD;
  if (!password) {
    console.error('SUPABASE_DB_PASSWORD requis. Mets-le dans .env.local ou exporte-le avant de lancer.');
    process.exit(1);
  }

  const client = new Client({
    host: process.env.SUPABASE_DB_HOST || 'db.bbzcuzqfgsdvjsymfwmr.supabase.co',
    port: Number(process.env.SUPABASE_DB_PORT || 5432),
    database: process.env.SUPABASE_DB_NAME || 'postgres',
    user: process.env.SUPABASE_DB_USER || 'postgres',
    password,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  console.log('Connecté à la base.');

  const sql = readFileSync(MIGRATION, 'utf8');
  console.log('\n--- Application de la migration quotes status workflow ---');
  await client.query(sql);
  console.log('Migration appliquée.');

  // Recharge le cache de schéma PostgREST (colonnes + défaut modifiés).
  await client.query(`NOTIFY pgrst, 'reload schema'`);

  // ── Vérifications ───────────────────────────────────────────────────────
  console.log('\n--- Vérification ---');
  const { rows: legacy } = await client.query(
    `SELECT count(*)::int AS c FROM public.quotes WHERE status IN ('action_required', 'sent')`
  );
  console.log('Quotes restantes en action_required/sent (attendu 0) :', legacy[0].c);

  const { rows: dist } = await client.query(
    `SELECT status, count(*)::int AS c FROM public.quotes GROUP BY status ORDER BY c DESC`
  );
  console.log('Répartition des statuts :');
  for (const r of dist) console.log(`  ${r.status} : ${r.c}`);

  const { rows: cols } = await client.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'quotes' AND column_name IN ('changes_requested_at', 'archived_at')
     ORDER BY column_name`
  );
  console.log('Nouvelles colonnes présentes :', cols.map((r) => r.column_name));

  const { rows: def } = await client.query(
    `SELECT column_default FROM information_schema.columns
     WHERE table_name = 'quotes' AND column_name = 'status'`
  );
  console.log("Défaut de status (attendu 'draft') :", def[0]?.column_default);

  await client.end();
  console.log('\nTerminé.');
}

run().catch((err) => { console.error(err); process.exit(1); });
