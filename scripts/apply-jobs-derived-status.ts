/**
 * Applique la migration 20260714000000_jobs_derived_status.sql
 *
 * Usage :
 *   1. Mets SUPABASE_DB_PASSWORD dans .env.local (ou exporte-le)
 *   2. npx tsx scripts/apply-jobs-derived-status.ts
 *
 * Idempotent : le SQL utilise CREATE OR REPLACE / CREATE INDEX IF NOT EXISTS,
 * donc relançable sans danger.
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';

const { Client } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATION = join(__dirname, '..', 'supabase', 'migrations', '20260714000000_jobs_derived_status.sql');

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
  console.log('\n--- Application de la migration jobs derived_status ---');
  await client.query(sql);
  console.log('Migration appliquée.');

  await client.query(`NOTIFY pgrst, 'reload schema'`);

  // ── Vérifications ───────────────────────────────────────────────────────
  console.log('\n--- Vérification ---');
  const { rows: col } = await client.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_name = 'jobs_active' AND column_name = 'derived_status'`
  );
  console.log('Colonne jobs_active.derived_status présente :', col.length > 0);

  const { rows: dist } = await client.query(
    `SELECT derived_status, count(*)::int AS c
     FROM public.jobs_active GROUP BY derived_status ORDER BY c DESC`
  );
  console.log('Répartition des statuts dérivés :');
  for (const r of dist) console.log(`  ${r.derived_status ?? '(null)'} : ${r.c}`);

  await client.end();
  console.log('\nTerminé.');
}

run().catch((err) => { console.error(err); process.exit(1); });
