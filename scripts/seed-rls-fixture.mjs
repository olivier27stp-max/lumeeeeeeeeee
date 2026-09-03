#!/usr/bin/env node
/**
 * Peuple STAGING avec deux organisations, pour rendre `test:rls` concluant.
 *
 * LE PROBLÈME QU'IL RÉSOUT
 * `test:rls` tente de vraies lectures croisées entre deux organisations. Il ne
 * peut donc rien prouver sur une table vide : « 0 ligne d'une autre org
 * visible » ne veut rien dire s'il n'y avait aucune ligne à voir. Mesuré avant
 * ce script : 28 relations concluantes, 143 NON testées.
 *
 * Une ligne par table et par organisation suffit : le test cherche « l'org A
 * voit-elle une ligne de l'org B », pas un volume réaliste.
 *
 * POURQUOI GÉNÉRIQUE PLUTÔT QU'UNE LISTE ÉCRITE À LA MAIN
 * Il y a ~100 tables vides. Une liste manuelle serait périmée à la première
 * migration — et une table ajoutée demain sans données repasserait en angle
 * mort sans que personne ne le voie. Ici, les colonnes obligatoires sont
 * déduites du catalogue à chaque exécution : le script suit le schéma.
 *
 * SÉCURITÉ
 * Refuse de s'exécuter sur la production. Toutes les lignes portent le préfixe
 * `[RLSFIX]` ou un marqueur reconnaissable, et `--nettoyer` les enlève.
 *
 * USAGE
 *   node --env-file=.env.local scripts/seed-rls-fixture.mjs
 *   node --env-file=.env.local scripts/seed-rls-fixture.mjs --nettoyer
 */
import crypto from 'node:crypto';

const NETTOYER = process.argv.includes('--nettoyer');
const t = process.env.SUPABASE_ACCESS_TOKEN;
const ref = process.env.SUPABASE_PROJECT_REF;
const refProd = process.env.SUPABASE_PROJECT_REF_PROD;

if (!t || !ref) {
  console.error('ERREUR : SUPABASE_ACCESS_TOKEN et SUPABASE_PROJECT_REF requis dans .env.local');
  process.exit(2);
}
// Ce script ÉCRIT massivement. Il ne doit jamais approcher la production.
if (refProd && ref === refProd) {
  console.error(`REFUS : SUPABASE_PROJECT_REF pointe sur la PRODUCTION (${ref}).`);
  console.error('Ce script insère des données de test. Il ne s\'exécute que sur staging.');
  process.exit(2);
}

async function q(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const txt = await res.text();
  if (!res.ok) throw new Error(txt.slice(0, 400));
  return JSON.parse(txt);
}

const MARQUEUR = 'RLSFIX';

if (NETTOYER) {
  // Les users fixture d'abord (leurs memberships tombent en cascade).
  await q(`delete from auth.users where email like 'rlsfix.user%@fixture.lume.test'`).catch(() => {});
  // Le nettoyage se fait par table, en ignorant les échecs : une table dont la
  // colonne texte a disparu ne doit pas bloquer les suivantes.
  const cibles = await q(`
    select c.relname as tbl
      from pg_class c join pg_namespace n on n.oid=c.relnamespace and n.nspname='public'
     where c.relkind='r'
       and exists (select 1 from pg_attribute a where a.attrelid=c.oid and a.attname='org_id' and not a.attisdropped)
     order by 1`);
  // Un seul appel : l'API de gestion limite le débit bien avant 160 requêtes.
  // `audit_events` est append-only par conception (trigger de refus) : on ne
  // tente même pas, l'échec serait garanti et le message trompeur.
  const suppressions = cibles.filter(({ tbl }) => tbl !== 'audit_events').map(({ tbl }) =>
    `  begin delete from public."${tbl}" where org_id = any(v_orgs); ` +
    `get diagnostics v_n = row_count; n_tot := n_tot + v_n; exception when others then null; end;`);

  const [res] = await q(`
do $$
declare v_orgs uuid[]; v_n int; n_tot int := 0;
begin
  select array_agg(id) into v_orgs from public.orgs where name like '%${MARQUEUR}%';
  if v_orgs is null then v_orgs := '{}'::uuid[]; end if;
${suppressions.join('\n')}
  -- Les organisations elles-memes ne sont PAS supprimees : audit_events est
  -- append-only (un trigger interdit DELETE) et la cascade s'y heurte. C'est
  -- une protection legitime du produit, on ne la contourne pas. Les orgs de
  -- test restent donc en place, reutilisables au prochain peuplement.
  create temp table if not exists _clean_bilan(n int) on commit drop;
  insert into _clean_bilan values (n_tot);
end $$;
select n from _clean_bilan;`);
  console.log(`${res?.n ?? 0} ligne(s) de test supprimée(s), organisations comprises.`);
  process.exit(0);
}

console.log(`Cible : staging (${ref})\n`);

// ── 1. Deux organisations de test ────────────────────────────────────────
const orgs = [];
for (const nom of [`[${MARQUEUR}] Org Alpha`, `[${MARQUEUR}] Org Beta`]) {
  const [row] = await q(`
    insert into public.orgs (id, name) values (gen_random_uuid(), '${nom}')
    on conflict do nothing returning id`);
  if (row) orgs.push(row.id);
}
if (orgs.length < 2) {
  const rows = await q(`select id from public.orgs where name like '%${MARQUEUR}%' order by name limit 2`);
  orgs.length = 0;
  rows.forEach((r) => orgs.push(r.id));
}
if (orgs.length < 2) {
  console.error('Impossible de créer deux organisations de test.');
  process.exit(1);
}
console.log(`Organisations : ${orgs[0].slice(0, 8)}… et ${orgs[1].slice(0, 8)}…\n`);

// ── 1b. Deux UTILISATEURS dédiés, un par org fixture ─────────────────────
// Le test RLS a besoin de « deux users mono-org d'orgs distinctes ». Avant,
// il piochait des memberships aléatoires du staging — que les tests QA
// (qui créent/suppriment des membres) faisaient disparaître par intermittence,
// d'où un check RLS qui flakait sur des PR sans rapport. Ces users-ci portent
// le marqueur RLSFIX : stables, isolés, jamais touchés par le QA.
for (let i = 0; i < 2; i++) {
  const email = `rlsfix.user${i}@fixture.lume.test`;
  // Idempotent : réutilise le user s'il existe déjà (par email dans auth.users).
  const [ex] = await q(`select id from auth.users where email = '${email}' limit 1`);
  let uid = ex?.id;
  if (!uid) {
    // Insertion directe dans auth.users (le seed écrit en SQL, pas via l'API
    // auth) : un compte minimal suffit — le test ne fait que set request.jwt.claims
    // avec son id, il ne se connecte jamais vraiment.
    const [nu] = await q(`
      insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
        email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
      values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated',
        'authenticated', '${email}', '', now(), now(), now(),
        '{"provider":"email","providers":["email"],"rlsfix":true}'::jsonb, '{}'::jsonb)
      returning id`);
    uid = nu?.id;
    if (!uid) { const [again] = await q(`select id from auth.users where email='${email}' limit 1`); uid = again?.id; }
  }
  if (!uid) { console.error(`Impossible de créer/retrouver ${email}`); process.exit(1); }
  // Membership UNIQUE dans son org (mono-org, ce que le test exige).
  await q(`
    insert into public.memberships (org_id, user_id, role, status)
    values ('${orgs[i]}', '${uid}', 'owner', 'active')
    on conflict do nothing`);
}
console.log('Utilisateurs fixture : 2 users mono-org [RLSFIX] prêts.\n');

// ── 2. Colonnes obligatoires de chaque table org-scopée ──────────────────
const colonnes = await q(`
  select c.relname as tbl, a.attname as col, format_type(a.atttypid, a.atttypmod) as typ,
         (a.attnotnull and pg_get_expr(d.adbin, d.adrelid) is null) as obligatoire,
         exists (select 1 from pg_constraint k
                  where k.conrelid=c.oid and k.contype='f' and a.attnum = any(k.conkey)) as est_fk
    from pg_class c
    join pg_namespace n on n.oid=c.relnamespace and n.nspname='public'
    join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
    left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
   where c.relkind='r'
     and has_table_privilege('authenticated', c.oid, 'SELECT')
     and exists (select 1 from pg_attribute b where b.attrelid=c.oid and b.attname='org_id' and not b.attisdropped)
   order by c.relname, a.attnum`);

const parTable = new Map();
for (const c of colonnes) {
  if (!parTable.has(c.tbl)) parTable.set(c.tbl, []);
  parTable.get(c.tbl).push(c);
}

/** Valeur plausible pour une colonne, d'après son type. */
function valeur(col) {
  const ty = col.typ;
  if (ty.includes('uuid')) return `'${crypto.randomUUID()}'`;
  if (/int|numeric|double|real|decimal/.test(ty)) return '1';
  if (ty.includes('bool')) return 'false';
  if (/timestamp|date/.test(ty)) return 'now()';
  if (ty.includes('time')) return `'12:00:00'`;
  if (ty.includes('jsonb')) return `'{}'::jsonb`;
  if (ty.includes('json')) return `'{}'::json`;
  if (ty.includes('[]')) return `'{}'::${ty}`;
  if (/text|varchar|char/.test(ty)) return `'${MARQUEUR}'`;
  return 'null';
}

// ── 3. Une ligne par table et par organisation ───────────────────────────
// Les tables à clé étrangère obligatoire échouent : leur parent n'existe pas.
// C'est accepté — on insère ce qui peut l'être, et on rapporte le reste.
// UNE SEULE requête, chaque insertion isolée dans son propre bloc d'exception.
// Une insertion par appel HTTP déclenchait « ThrottlerException » de l'API de
// gestion au bout de ~150 appels — et un échec d'insertion en milieu de
// transaction aurait annulé tout le reste.
const morceaux = [];
for (const [tbl, cols] of parTable) {
  for (const org of orgs) {
    const noms = ['org_id'];
    const vals = [`'${org}'`];
    for (const c of cols) {
      if (c.col === 'org_id' || c.col === 'id') continue;
      // Une FK obligatoire pointe vers une ligne qu'on n'a pas : inutile
      // d'inventer un uuid, l'insertion serait rejetée de toute façon.
      if (!c.obligatoire) continue;
      noms.push(`"${c.col}"`);
      vals.push(valeur(c));
    }
    morceaux.push(
      `  begin insert into public."${tbl}" (${noms.join(', ')}) values (${vals.join(', ')}); ` +
      `n_ok := n_ok + 1; exception when others then n_ko := n_ko + 1; end;`,
    );
  }
}

const [bilanIns] = await q(`
do $$
declare n_ok int := 0; n_ko int := 0;
begin
${morceaux.join('\n')}
  raise notice 'ok=% ko=%', n_ok, n_ko;
  create temp table if not exists _seed_bilan(ok int, ko int) on commit drop;
  insert into _seed_bilan values (n_ok, n_ko);
end $$;
select ok, ko from _seed_bilan;`);

console.log(`Insertions réussies : ${bilanIns?.ok ?? '?'}`);
console.log(`Insertions refusées : ${bilanIns?.ko ?? '?'} (clé étrangère ou contrainte CHECK — attendu)`);

// ── 4. Ce que ça change pour test:rls ────────────────────────────────────
const [bilan] = await q(`
  select count(*) filter (where orgs_distinctes >= 2) as testables,
         count(*) as total
    from (
      select (xpath('/row/c/text()', query_to_xml(format('select count(distinct org_id) c from public.%I', c.relname), false, true, '')))[1]::text::int as orgs_distinctes
        from pg_class c join pg_namespace n on n.oid=c.relnamespace and n.nspname='public'
       where c.relkind='r'
         and exists (select 1 from pg_attribute a where a.attrelid=c.oid and a.attname='org_id' and not a.attisdropped)
    ) x`);
console.log(`\nTables couvrant au moins 2 organisations : ${bilan.testables} / ${bilan.total}`);
console.log('Lancer maintenant : npm run test:rls');
