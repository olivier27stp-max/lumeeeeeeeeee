#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   Extrait de la PRODUCTION la définition SQL du module « migration
   de données » (15 tables) et écrit une migration rejouable.

   Ces tables existaient en prod mais dans AUCUN fichier du dépôt :
   créées hors du pipeline. Ce script les y réintroduit.

   LECTURE SEULE sur la prod — aucune écriture, aucune donnée copiée.

   Usage :
     node --env-file=.env.local scripts/qa/extraire-module-migration.mjs > sortie.sql
   ═══════════════════════════════════════════════════════════════ */

const JETON = process.env.SUPABASE_ACCESS_TOKEN;
const PROD = process.env.SUPABASE_PROJECT_REF_PROD;
if (!JETON || !PROD) { console.error('env manquantes'); process.exit(2); }

async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROD}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${JETON}`, 'Content-Type': 'application/json', 'User-Agent': 'curl/8.7.1' },
    body: JSON.stringify({ query: sql }),
  });
  if (r.status !== 201) throw new Error(`HTTP ${r.status} — ${(await r.text()).slice(0, 300)}`);
  return r.json();
}

// Guillemets simples SQL : on double les apostrophes internes.
const lit = (s) => "'" + String(s).replace(/'/g, "''") + "'";

const FILTRE = `(c.relname like 'migration\\_%' or c.relname = 'data_migrations')`;

const tables = (await q(
  `select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r' and ${FILTRE} order by 1`
)).map((r) => r.relname);

console.error(`${tables.length} tables trouvées en prod`);
if (!tables.length) { console.error('rien à extraire'); process.exit(1); }
const liste = tables.map((t) => lit(t)).join(',');

const cols = await q(`
  select c.relname as tbl, a.attname as col, format_type(a.atttypid,a.atttypmod) as typ,
         a.attnotnull as nn, pg_get_expr(d.adbin,d.adrelid) as defaut
  from pg_attribute a
  join pg_class c on c.oid=a.attrelid
  join pg_namespace n on n.oid=c.relnamespace
  left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
  where n.nspname='public' and c.relname in (${liste}) and a.attnum>0 and not a.attisdropped
  order by c.relname, a.attnum`);

const cons = await q(`
  select c.relname as tbl, con.conname as nom, pg_get_constraintdef(con.oid) as def,
         con.contype::text as typ
  from pg_constraint con
  join pg_class c on c.oid=con.conrelid
  join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname in (${liste})
  order by case con.contype when 'p' then 1 when 'u' then 2 when 'c' then 3 else 4 end, c.relname, con.conname`);

const idx = await q(`
  select tablename as tbl, indexname as nom, indexdef as def
  from pg_indexes where schemaname='public' and tablename in (${liste})
  order by tablename, indexname`);

const pols = await q(`
  select c.relname as tbl, pol.polname as nom,
         pg_get_expr(pol.polqual,pol.polrelid) as using_x,
         pg_get_expr(pol.polwithcheck,pol.polrelid) as check_x,
         pol.polcmd::text as cmd,
         (select string_agg(quote_ident(r.rolname), ', ') from pg_roles r where r.oid = any(pol.polroles)) as roles
  from pg_policy pol
  join pg_class c on c.oid=pol.polrelid
  join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname in (${liste})
  order by c.relname, pol.polname`);

const trgs = await q(`
  select c.relname as tbl, t.tgname as nom, pg_get_triggerdef(t.oid) as def
  from pg_trigger t
  join pg_class c on c.oid=t.tgrelid
  join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname in (${liste}) and not t.tgisinternal
  order by c.relname, t.tgname`);

const rls = await q(`
  select c.relname as tbl, c.relrowsecurity as active, c.relforcerowsecurity as forcee,
         obj_description(c.oid,'pg_class') as commentaire
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname in (${liste}) order by c.relname`);

const grants = await q(`
  select table_name as tbl, grantee, string_agg(distinct privilege_type, ', ') as privs
  from information_schema.role_table_grants
  where table_schema='public' and table_name in (${liste})
    and grantee in ('anon','authenticated','service_role')
  group by table_name, grantee order by table_name, grantee`);

const buckets = await q(`
  select id, name, public, file_size_limit, allowed_mime_types
  from storage.buckets where id like '%migration%'`);

const CMD = { r: 'all', a: 'insert', w: 'update', d: 'delete', s: 'select' };
const par = (t, arr) => arr.filter((x) => x.tbl === t);
const L = [];

L.push('-- ============================================================================');
L.push('-- Module « migration de données » — réalignement de staging sur la production');
L.push('-- ============================================================================');
L.push('-- Extrait de la PROD le 2026-09-01 par scripts/qa/extraire-module-migration.mjs');
L.push('--');
L.push(`-- Ces ${tables.length} tables existaient en production mais dans AUCUN fichier du dépôt :`);
L.push('-- elles avaient été créées hors du pipeline de migration (contraire à la règle 2');
L.push('-- du CLAUDE.md). Ce fichier les réintroduit dans l\'historique du projet ET les');
L.push('-- rejoue sur staging, pour que les deux environnements redeviennent identiques.');
L.push('--');
L.push('-- Idempotent : « if not exists » / « drop policy if exists » partout.');
L.push('-- STRUCTURE UNIQUEMENT — aucune donnée n\'est copiée.');
L.push('-- ============================================================================');
L.push('');
L.push('create extension if not exists vector;');
L.push('');

for (const t of tables) {
  L.push(`-- ── ${t} ${'─'.repeat(Math.max(3, 58 - t.length))}`);
  const cs = par(t, cols).map((c) => {
    let s = `  "${c.col}" ${c.typ}`;
    if (c.defaut) s += ` default ${c.defaut}`;
    if (c.nn) s += ' not null';
    return s;
  });
  L.push(`create table if not exists public.${t} (`);
  L.push(cs.join(',\n'));
  L.push(');');
  L.push('');
}

L.push('-- ── Contraintes ──────────────────────────────────────────────────');
L.push('do $$ begin');
for (const c of cons) {
  L.push(`  if not exists (select 1 from pg_constraint where conname=${lit(c.nom)} and conrelid='public.${c.tbl}'::regclass) then`);
  L.push(`    alter table public.${c.tbl} add constraint "${c.nom}" ${c.def};`);
  L.push('  end if;');
}
L.push('end $$;');
L.push('');

L.push('-- ── Index ────────────────────────────────────────────────────────');
for (const i of idx) {
  // Les index portés par une contrainte (clé primaire, unicité) sont déjà créés ci-dessus.
  if (cons.some((c) => c.nom === i.nom)) continue;
  L.push(
    i.def
      .replace(/^CREATE INDEX /i, 'create index if not exists ')
      .replace(/^CREATE UNIQUE INDEX /i, 'create unique index if not exists ') + ';'
  );
}
L.push('');

L.push('-- ── Protection des accès (RLS) ───────────────────────────────────');
for (const r of rls) {
  if (r.active) L.push(`alter table public.${r.tbl} enable row level security;`);
  if (r.forcee) L.push(`alter table public.${r.tbl} force row level security;`);
}
L.push('');

for (const p of pols) {
  L.push(`drop policy if exists "${p.nom}" on public.${p.tbl};`);
  let s = `create policy "${p.nom}" on public.${p.tbl} as permissive for ${CMD[p.cmd] || 'all'}`;
  if (p.roles) s += ` to ${p.roles}`;
  if (p.using_x) s += `\n  using (${p.using_x})`;
  if (p.check_x) s += `\n  with check (${p.check_x})`;
  L.push(s + ';');
}
L.push('');

L.push('-- ── Privilèges ───────────────────────────────────────────────────');
for (const g of grants) {
  L.push(`grant ${g.privs.toLowerCase()} on public.${g.tbl} to ${g.grantee};`);
}
L.push('');

L.push('-- ── Déclencheurs ─────────────────────────────────────────────────');
L.push('do $$ begin');
for (const t of trgs) {
  L.push(`  if not exists (select 1 from pg_trigger where tgname=${lit(t.nom)} and tgrelid='public.${t.tbl}'::regclass) then`);
  L.push(`    execute ${lit(t.def)};`);
  L.push('  end if;');
}
L.push('end $$;');
L.push('');

if (buckets.length) {
  L.push('-- ── Dossier de fichiers ──────────────────────────────────────────');
  for (const b of buckets) {
    const mimes = b.allowed_mime_types
      ? `array[${b.allowed_mime_types.map((m) => lit(m)).join(',')}]::text[]`
      : 'null';
    L.push('insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)');
    L.push(`  values (${lit(b.id)}, ${lit(b.name)}, ${b.public}, ${b.file_size_limit ?? 'null'}, ${mimes})`);
    L.push('  on conflict (id) do nothing;');
  }
  L.push('');
}

const avecCom = rls.filter((r) => r.commentaire);
if (avecCom.length) {
  L.push('-- ── Commentaires ─────────────────────────────────────────────────');
  for (const r of avecCom) L.push(`comment on table public.${r.tbl} is ${lit(r.commentaire)};`);
  L.push('');
}

L.push('-- ── Vérification ─────────────────────────────────────────────────');
L.push('do $$ declare n int; begin');
L.push("  select count(*) into n from pg_class c join pg_namespace ns on ns.oid=c.relnamespace");
L.push(`   where ns.nspname='public' and c.relkind='r' and ${FILTRE};`);
L.push(`  if n <> ${tables.length} then raise exception 'Attendu ${tables.length} tables, trouvé %', n; end if;`);
L.push(`  raise notice 'Module de migration : ${tables.length} tables en place.';`);
L.push('end $$;');

console.log(L.join('\n'));
console.error(
  `colonnes:${cols.length} contraintes:${cons.length} index:${idx.length} ` +
  `policies:${pols.length} triggers:${trgs.length} grants:${grants.length} buckets:${buckets.length}`
);
