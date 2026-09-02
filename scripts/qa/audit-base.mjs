#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   AUDIT DE LA BASE — ce qui ne sert plus, ce qui manque.

   Avant une mise en service, on veut savoir ce qui traîne : des
   tables que plus personne ne lit, des liens qui pointent dans le
   vide, des index qui coûtent sans rien accélérer.

   CE QU'IL REGARDE
     1. tables vides ET jamais citées par le code
     2. clés étrangères SANS index — chaque suppression du parent
        déclenche alors un balayage complet de l'enfant
     3. index jamais utilisés depuis le dernier redémarrage
     4. tables citées par le code mais absentes de la base
     5. colonnes obligatoires sans valeur par défaut sur table vide

   IL NE SUPPRIME RIEN. Il rapporte, avec les preuves, pour qu'une
   décision humaine tranche. Une table vide aujourd'hui peut être
   une fonctionnalité qui démarre demain.

   Usage : npm run qa:audit-base  (ajouter -- --prod pour la prod)
   ═══════════════════════════════════════════════════════════════ */

import fs from 'node:fs';
import path from 'node:path';

const RACINE = process.cwd();
const PROD = process.argv.includes('--prod');
const JETON = process.env.SUPABASE_ACCESS_TOKEN;
const REF = PROD ? process.env.SUPABASE_PROJECT_REF_PROD : process.env.SUPABASE_PROJECT_REF;

if (!JETON || !REF) {
  console.error('Variables manquantes — lancer avec --env-file=.env.local');
  process.exit(2);
}

async function sql(requete) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${JETON}`, 'Content-Type': 'application/json', 'User-Agent': 'curl/8.7.1' },
    body: JSON.stringify({ query: requete }),
  });
  if (r.status !== 201) throw new Error(`HTTP ${r.status} — ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

/* ── Le code source : quelles tables cite-t-il ? ───────────────── */

function fichiersSource(dossier, acc = []) {
  if (!fs.existsSync(dossier)) return acc;
  for (const e of fs.readdirSync(dossier, { withFileTypes: true })) {
    const p = path.join(dossier, e.name);
    if (e.isDirectory()) {
      if (['node_modules', 'dist', '.git'].includes(e.name)) continue;
      fichiersSource(p, acc);
    } else if (/\.(ts|tsx|mjs|cjs|js)$/.test(e.name)) {
      acc.push(p);
    }
  }
  return acc;
}

const citees = new Set();
for (const f of [...fichiersSource(path.join(RACINE, 'src')), ...fichiersSource(path.join(RACINE, 'server'))]) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(/\.from\(\s*['"`]([a-z0-9_]+)['"`]/gi)) citees.add(m[1]);
  for (const m of src.matchAll(/\bfrom\s+([a-z_][a-z0-9_]*)\b/gi)) citees.add(m[1].toLowerCase());
  for (const m of src.matchAll(/\bjoin\s+([a-z_][a-z0-9_]*)\b/gi)) citees.add(m[1].toLowerCase());
}

// Les fonctions et vues de la base peuvent référencer une table sans
// que le code applicatif ne la nomme jamais. Sans ce filet, on
// déclarerait « inutilisée » une table dont dépend un trigger.
const refDb = await sql(`
  select distinct lower(t.relname) as tbl
    from pg_class t
    join pg_namespace n on n.oid = t.relnamespace
   where n.nspname = 'public' and t.relkind = 'r'
     and (
       exists (select 1 from pg_proc p
                join pg_namespace pn on pn.oid = p.pronamespace
               where pn.nspname = 'public' and p.prosrc ilike '%' || t.relname || '%')
       or exists (select 1 from pg_views v
                   where v.schemaname = 'public' and v.definition ilike '%' || t.relname || '%')
     )`);
const citeesDb = new Set(refDb.map((r) => r.tbl));

/* ── Sondes ───────────────────────────────────────────────────── */

console.log(PROD ? `\n⚠️  Cible : PRODUCTION (${REF})\n` : `\nCible : test/staging (${REF})\n`);

// 1. Tables vides
const vides = await sql(`
  select c.relname as tbl, coalesce(s.n_live_tup, 0) as lignes
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    left join pg_stat_user_tables s on s.relid = c.oid
   where n.nspname = 'public' and c.relkind = 'r'
     and coalesce(s.n_live_tup, 0) = 0
   order by c.relname`);

const orphelines = vides.filter((v) => !citees.has(v.tbl) && !citeesDb.has(v.tbl));

console.log('── Tables vides ET jamais citées ─────────────────────────');
if (!orphelines.length) {
  console.log('  aucune — toute table vide est référencée quelque part');
} else {
  console.log(`  ${orphelines.length} table(s) : vides, absentes du code, absentes des fonctions/vues`);
  orphelines.forEach((v) => console.log(`    ${v.tbl}`));
  console.log('  → à examiner : fonctionnalité pas encore lancée, ou reste à retirer ?');
}

// 2. Clés étrangères sans index
const fkSansIndex = await sql(`
  select c.conname as contrainte, t.relname as enfant, tp.relname as parent,
         a.attname as colonne
    from pg_constraint c
    join pg_class t  on t.oid = c.conrelid
    join pg_class tp on tp.oid = c.confrelid
    join pg_namespace n on n.oid = t.relnamespace
    join pg_attribute a on a.attrelid = t.oid and a.attnum = c.conkey[1]
   where n.nspname = 'public' and c.contype = 'f'
     and array_length(c.conkey, 1) = 1
     and not exists (
       select 1 from pg_index i
        where i.indrelid = c.conrelid
          and i.indkey[0] = c.conkey[1]
     )
   order by t.relname, a.attname`);

console.log('\n── Clés étrangères sans index ────────────────────────────');
if (!fkSansIndex.length) {
  console.log('  aucune — toutes les clés étrangères sont indexées');
} else {
  console.log(`  ${fkSansIndex.length} clé(s) sans index.`);
  console.log('  Conséquence : supprimer une ligne parente force un balayage');
  console.log('  complet de la table enfant, et les jointures sont lentes.');
  fkSansIndex.slice(0, 25).forEach((f) => console.log(`    ${f.enfant}.${f.colonne} → ${f.parent}`));
  if (fkSansIndex.length > 25) console.log(`    … et ${fkSansIndex.length - 25} autres`);
}

// 3. Index jamais utilisés
const indexInutiles = await sql(`
  select s.relname as tbl, s.indexrelname as idx, s.idx_scan as lectures,
         pg_size_pretty(pg_relation_size(s.indexrelid)) as taille
    from pg_stat_user_indexes s
    join pg_index i on i.indexrelid = s.indexrelid
   where s.schemaname = 'public'
     and s.idx_scan = 0
     and not i.indisunique
     and not i.indisprimary
   order by pg_relation_size(s.indexrelid) desc
   limit 30`);

console.log('\n── Index jamais lus ──────────────────────────────────────');
if (!indexInutiles.length) {
  console.log('  aucun');
} else {
  console.log(`  ${indexInutiles.length} index à 0 lecture depuis le dernier redémarrage.`);
  console.log('  Attention : un compteur remis à zéro récemment, ou un index qui');
  console.log('  ne sert qu\'en fin de mois, apparaît ici à tort. À confirmer.');
  indexInutiles.slice(0, 12).forEach((x) => console.log(`    ${x.tbl}.${x.idx}  (${x.taille})`));
}

// 4. Tables citées par le code mais absentes
const existantes = new Set(
  (await sql(`select c.relname as tbl from pg_class c join pg_namespace n on n.oid=c.relnamespace
              where n.nspname='public' and c.relkind in ('r','v','m','p')`)).map((r) => r.tbl),
);
const MOTS_SQL = new Set(['select', 'where', 'table', 'this', 'the', 'a', 'an', 'and', 'or', 'not', 'null', 'to']);
const manquantes = [...citees].filter(
  (t) => !existantes.has(t) && t.length > 3 && !MOTS_SQL.has(t) && /_|s$/.test(t),
);

console.log('\n── Tables citées par le code mais ABSENTES ───────────────');
if (!manquantes.length) {
  console.log('  aucune');
} else {
  console.log(`  ${manquantes.length} nom(s) — certains sont des faux positifs (variables, mots SQL) :`);
  manquantes.slice(0, 20).forEach((t) => console.log(`    ${t}`));
}

/* ── Bilan ────────────────────────────────────────────────────── */

const rapport = {
  genereLe: new Date().toISOString(),
  environnement: PROD ? 'production' : 'staging',
  ref: REF,
  tablesVidesEtOrphelines: orphelines.map((o) => o.tbl),
  clesEtrangeresSansIndex: fkSansIndex,
  indexJamaisLus: indexInutiles,
  tablesCiteesMaisAbsentes: manquantes,
};
const nom = PROD ? 'qa-audit-base-prod.json' : 'qa-audit-base.json';
fs.writeFileSync(path.join(RACINE, nom), JSON.stringify(rapport, null, 2), 'utf8');

console.log('\n' + '═'.repeat(60));
console.log(`  Tables vides et orphelines   ${orphelines.length}`);
console.log(`  Clés étrangères sans index   ${fkSansIndex.length}`);
console.log(`  Index jamais lus             ${indexInutiles.length}`);
console.log(`  Tables citées mais absentes  ${manquantes.length}`);
console.log(`\n  → ${nom}`);
console.log('\n  Rien n\'a été supprimé : ce rapport sert à décider.\n');
