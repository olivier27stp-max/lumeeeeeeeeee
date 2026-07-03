/**
 * Applique la migration 20260703200000_request_pipeline_map_pin_sync.sql
 *
 * Usage :
 *   1. Mets SUPABASE_DB_PASSWORD dans .env.local (ou exporte-le)
 *   2. npx tsx scripts/apply-request-pipeline-map.ts
 *
 * Idempotent : IF NOT EXISTS / CREATE OR REPLACE / DROP IF EXISTS partout,
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
const MIGRATION = join(__dirname, '..', 'supabase', 'migrations', '20260703200000_request_pipeline_map_pin_sync.sql');

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
  console.log('\n--- Application de la migration request → pipeline + map pin ---');
  await client.query(sql);
  console.log('Migration appliquée.');

  // ── Vérifications ────────────────────────────────────────────────────────
  const { rows: viewCheck } = await client.query(
    `select count(*)::int as n from information_schema.views where table_schema = 'public' and table_name = 'pipeline_deals_visible'`,
  );
  console.log(`Vue pipeline_deals_visible : ${viewCheck[0].n === 1 ? 'OK' : 'MANQUANTE'}`);

  const { rows: stages } = await client.query(
    `select stage, count(*)::int as n from public.pipeline_deals group by stage order by n desc`,
  );
  console.log('Stages en base :', stages);

  const { rows: trigCheck } = await client.query(
    `select count(*)::int as n from pg_trigger where tgname = 'trg_clients_sync_field_pin'`,
  );
  console.log(`Trigger trg_clients_sync_field_pin : ${trigCheck[0].n >= 1 ? 'OK' : 'MANQUANT'}`);

  await client.end();
  console.log('\nTerminé.');
}

run().catch((err) => {
  console.error('Échec :', err.message);
  process.exit(1);
});
