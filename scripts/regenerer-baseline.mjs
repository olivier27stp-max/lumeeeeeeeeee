#!/usr/bin/env node
/**
 * Régénère supabase/baseline/ depuis la PROD (lecture seule).
 *
 *   node --env-file=.env.local scripts/regenerer-baseline.mjs
 *
 * Prérequis : Docker, SUPABASE_DB_PASSWORD (mot de passe Postgres PROD),
 * SUPABASE_PROJECT_REF_PROD et SUPABASE_ACCESS_TOKEN dans .env.local.
 *
 *   01_schema.sql      pg_dump --schema-only de public/app/archive, précédé des
 *                      extensions (le schéma en dépend : unaccent, pg_trgm,
 *                      btree_gist, vector… — les créer dans 02 venait trop tard) ;
 *                      débarrassé des lignes qu'un projet neuf refuse.
 *   02_post_schema.sql ce que pg_dump ne contient pas, lu dans le catalogue :
 *                      triggers sur auth.users, buckets, policies de storage,
 *                      publication temps réel, tâches pg_cron.
 *
 * Le mot de passe ne passe que par l'environnement du processus Docker.
 * Refuse d'écrire une tâche pg_cron qui ressemble à un secret.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const REF = process.env.SUPABASE_PROJECT_REF_PROD;
const MDP = process.env.SUPABASE_DB_PASSWORD;
const JETON = process.env.SUPABASE_ACCESS_TOKEN;
if (!REF || !MDP || !JETON) {
  console.error('ERREUR : SUPABASE_PROJECT_REF_PROD, SUPABASE_DB_PASSWORD et SUPABASE_ACCESS_TOKEN requis dans .env.local');
  process.exit(2);
}
const DOSSIER = path.resolve('supabase/baseline');
const HOTE = 'aws-1-ca-central-1.pooler.supabase.com';
const aujourdhui = new Date().toISOString().slice(0, 10);

async function requete(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${JETON}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  if (!r.ok) throw new Error(`requête catalogue : HTTP ${r.status} ${await r.text()}`);
  return r.json();
}
const lit = (v) => (v === null || v === undefined ? 'null' : `'${String(v).replace(/'/g, "''")}'`);

// ── Extensions (en tête de 01) ──────────────────────────────────────
const extensions = await requete(`select e.extname, n.nspname from pg_extension e join pg_namespace n on n.oid = e.extnamespace
  where e.extname <> 'plpgsql' order by e.extname`);
const blocExtensions = extensions
  .map((e) => `create extension if not exists ${e.extname.includes('-') ? `"${e.extname}"` : e.extname} with schema ${e.nspname};`)
  .join('\n');

// ── 01 : schéma ─────────────────────────────────────────────────────
const brut = path.join(DOSSIER, '01_schema.brut.sql');
const monte = spawnSync('cygpath', ['-m', DOSSIER], { encoding: 'utf8' });
const volume = monte.status === 0 ? monte.stdout.trim() : DOSSIER;
const dump = spawnSync('docker', ['run', '--rm', '-e', 'PGPASSWORD', '-v', `${volume}:/out`, 'postgres:17', 'pg_dump',
  '-h', HOTE, '-p', '5432', '-U', `postgres.${REF}`, '-d', 'postgres', '--schema-only', '--no-owner',
  '-n', 'public', '-n', 'app', '-n', 'archive', '-f', '/out/01_schema.brut.sql'],
{ env: { ...process.env, PGPASSWORD: MDP, MSYS_NO_PATHCONV: '1' }, encoding: 'utf8' });
if (dump.status !== 0) {
  console.error('ERREUR pg_dump :', (dump.stderr || '').split('\n').find((l) => /error/i.test(l)) || dump.status);
  process.exit(1);
}
const REFUSEES = ['ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin', 'CREATE SCHEMA public;', 'COMMENT ON SCHEMA public', '\\restrict', '\\unrestrict'];
const lignes = fs.readFileSync(brut, 'utf8').split('\n').filter((l) => !REFUSEES.some((p) => l.startsWith(p)));
fs.rmSync(brut);
fs.writeFileSync(path.join(DOSSIER, '01_schema.sql'), [
  '-- ============================================================================',
  `-- BASELINE 01 — schémas public, app, archive (pg_dump de la PROD, ${aujourdhui})`,
  '-- Généré par scripts/regenerer-baseline.mjs — ne pas modifier à la main.',
  '-- Les extensions viennent en tête : le schéma en dépend (index, types, recherche).',
  '-- ============================================================================',
  '',
  blocExtensions,
  '',
  ...lignes,
].join('\n'));

// ── 02 : hors pg_dump ───────────────────────────────────────────────
const triggersAuth = await requete(`select pg_get_triggerdef(t.oid) d from pg_trigger t
  where t.tgrelid = 'auth.users'::regclass and not t.tgisinternal order by t.tgname`);
const buckets = await requete(`select id, name, public, file_size_limit, allowed_mime_types from storage.buckets order by id`);
const politiques = await requete(`select policyname, cmd, roles::text roles, qual, with_check from pg_policies
  where schemaname = 'storage' and tablename = 'objects' order by policyname`);
const publication = await requete(`select tablename from pg_publication_tables
  where pubname = 'supabase_realtime' and schemaname = 'public' order by tablename`);
const taches = await requete(`select jobname, schedule, command, active from cron.job order by jobname`);

const SECRET = /(bearer|apikey|authorization|secret|password|eyJ[a-zA-Z0-9]{10,}|sk_(live|test)_)/i;
const douteuses = taches.filter((t) => SECRET.test(t.command));
if (douteuses.length) {
  console.error('ERREUR : tâche(s) pg_cron qui ressemblent à un secret, rien n’est écrit :', douteuses.map((t) => t.jobname).join(', '));
  process.exit(1);
}

const pourQui = (roles) => roles.replace(/[{}]/g, '').split(',').map((r) => r.trim()).join(', ');
const cmdPolitique = { SELECT: 'select', INSERT: 'insert', UPDATE: 'update', DELETE: 'delete', ALL: 'all' };
const deux = [
  '-- ============================================================================',
  `-- BASELINE 02 — tout ce que pg_dump ne contient PAS (catalogue de la PROD, ${aujourdhui})`,
  '-- Généré par scripts/regenerer-baseline.mjs — ne pas modifier à la main.',
  '-- Triggers sur auth.users, buckets de stockage + leurs policies, publication',
  '-- temps réel, tâches planifiées. Oublier ce fichier = un environnement qui a',
  "-- l'air correct mais où les fichiers, le temps réel et les jobs ne marchent pas.",
  '--',
  '-- À exécuter APRÈS 01_schema.sql (qui crée déjà les extensions).',
  '-- ============================================================================',
  '',
  '-- ── Triggers sur auth.users ──',
  ...triggersAuth.map((t) => `${t.d.replace(/^CREATE TRIGGER/, 'CREATE OR REPLACE TRIGGER')};`),
  '',
  '-- ── Buckets de stockage ──',
  ...buckets.map((b) => `insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values (${lit(b.id)}, ${lit(b.name)}, ${b.public}, ${b.file_size_limit ?? 'null'}, ${b.allowed_mime_types ? `array[${b.allowed_mime_types.map(lit).join(',')}]::text[]` : 'null'}) on conflict (id) do nothing;`),
  '',
  '-- ── Policies sur storage.objects ──',
  ...politiques.flatMap((p) => [
    `drop policy if exists "${p.policyname}" on storage.objects;`,
    `create policy "${p.policyname}" on storage.objects for ${cmdPolitique[p.cmd] ?? p.cmd.toLowerCase()} to ${pourQui(p.roles)}${p.qual ? ` using (${p.qual})` : ''}${p.with_check ? ` with check (${p.with_check})` : ''};`,
  ]),
  '',
  '-- ── Publication temps réel ──',
  'do $$',
  'declare t text;',
  'begin',
  `  foreach t in array array[${publication.map((p) => lit(p.tablename)).join(', ')}] loop`,
  '    if not exists (select 1 from pg_publication_tables',
  "                   where pubname='supabase_realtime' and schemaname='public' and tablename=t) then",
  "      execute format('alter publication supabase_realtime add table public.%I', t);",
  '    end if;',
  '  end loop;',
  'end $$;',
  '',
  '-- ── Tâches planifiées (pg_cron) ──',
  ...taches.map((t) => `select cron.schedule(${lit(t.jobname)}, ${lit(t.schedule)}, $c$${t.command.trim()}$c$);${t.active ? '' : `\nselect cron.alter_job((select jobid from cron.job where jobname = ${lit(t.jobname)}), active := false);`}`),
  '',
  '-- ── Secrets attendus par certaines fonctions (à créer manuellement) ──',
  "-- purge_old_location_data / trigger_sms_number_release lisent vault.decrypted_secrets",
  "-- ('cron_secret', 'app_base_url') et retombent silencieusement si absents.",
  '',
].join('\n');
fs.writeFileSync(path.join(DOSSIER, '02_post_schema.sql'), deux);

const txt = fs.readFileSync(path.join(DOSSIER, '01_schema.sql'), 'utf8');
const n = (re) => (txt.match(re) || []).length;
console.log(`01_schema.sql : ${n(/^CREATE TABLE /gm)} tables, ${n(/^CREATE VIEW /gm)} vues, ${n(/^CREATE FUNCTION /gm)} fonctions, ${n(/^CREATE POLICY /gm)} policies, ${n(/^CREATE TRIGGER /gm)} triggers, ${extensions.length} extensions`);
console.log(`02_post_schema.sql : ${triggersAuth.length} trigger(s) auth, ${buckets.length} buckets, ${politiques.length} policies de storage, ${publication.length} tables temps réel, ${taches.length} tâches pg_cron`);
