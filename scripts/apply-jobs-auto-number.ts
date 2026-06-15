/**
 * Applique la migration 20260708000000_jobs_auto_number_per_org.sql
 *
 * Usage :
 *   1. Mets SUPABASE_DB_PASSWORD dans .env.local (ou exporte-le)
 *   2. npx tsx scripts/apply-jobs-auto-number.ts
 *
 * Idempotent : le SQL utilise IF NOT EXISTS / CREATE OR REPLACE / on conflict,
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
const MIGRATION = join(__dirname, '..', 'supabase', 'migrations', '20260708000000_jobs_auto_number_per_org.sql');

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
  console.log('\n--- Application de la migration job_number auto ---');
  await client.query(sql);
  console.log('Migration appliquée.');

  // Recharge le cache de schéma PostgREST (nouvelle table + colonne modifiée).
  await client.query(`NOTIFY pgrst, 'reload schema'`);

  // ── Vérifications ───────────────────────────────────────────────────────
  console.log('\n--- Vérification ---');
  const { rows: trig } = await client.query(
    `SELECT 1 FROM pg_trigger WHERE tgname = 'trg_jobs_zz_assign_number' AND NOT tgisinternal`
  );
  console.log('Trigger trg_jobs_zz_assign_number présent :', trig.length > 0);

  const { rows: counters } = await client.query(`SELECT count(*)::int AS c FROM public.org_job_counters`);
  console.log('Lignes dans org_job_counters :', counters[0].c);

  const { rows: nulls } = await client.query(
    `SELECT count(*)::int AS c FROM public.jobs WHERE job_number IS NULL OR btrim(job_number) = ''`
  );
  console.log('Jobs sans numéro restants (attendu 0) :', nulls[0].c);

  const { rows: sample } = await client.query(
    `SELECT org_id, count(*)::int AS jobs, count(DISTINCT job_number)::int AS distinct_numbers
     FROM public.jobs WHERE deleted_at IS NULL GROUP BY org_id ORDER BY jobs DESC LIMIT 5`
  );
  console.log('Échantillon par org (jobs vs numéros distincts) :');
  for (const r of sample) {
    const ok = r.jobs === r.distinct_numbers ? 'OK' : '⚠ doublons';
    console.log(`  org ${String(r.org_id).slice(0, 8)} : ${r.jobs} jobs, ${r.distinct_numbers} numéros distincts — ${ok}`);
  }

  await client.end();
  console.log('\nTerminé.');
}

run().catch((err) => { console.error(err); process.exit(1); });
