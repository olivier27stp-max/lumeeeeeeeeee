#!/usr/bin/env node
/**
 * Compare la pile LOCALE à la PROD : fonctions (empreinte du corps), tables et colonnes, triggers, policies.
 * Lecture seule côté prod (API de gestion). Sert à savoir si un test local vaut pour la prod.
 *
 *   node --env-file=D:/lume-final/env.reel outils/comparer-schema.mjs
 */
import { execFileSync } from 'node:child_process';

const REF = process.env.SUPABASE_PROJECT_REF_PROD || 'bbzcuzqfgsdvjsymfwmr';
const jeton = process.env.SUPABASE_ACCESS_TOKEN;
if (!jeton) { console.error('SUPABASE_ACCESS_TOKEN requis'); process.exit(2); }

async function prod(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query/read-only`, {
    method: 'POST', headers: { Authorization: `Bearer ${jeton}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }),
  });
  if (!r.ok) throw new Error(`prod ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json();
}
function local(sql) {
  const t = execFileSync('docker', ['exec', '-i', '-u', 'postgres', 'lumefinal-db', 'psql', '-U', 'supabase_admin', '-d', 'postgres', '-tA', '-c', `select coalesce(json_agg(t), '[]'::json) from (${sql}) t`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(t);
}

const REQUETES = {
  fonctions: `select p.oid::regprocedure::text as k, md5(pg_get_functiondef(p.oid)) as h from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind = 'f'`,
  colonnes: `select table_name || '.' || column_name as k, md5(data_type || '|' || is_nullable || '|' || coalesce(column_default, '')) as h from information_schema.columns where table_schema = 'public'`,
  triggers: `select c.relname || '.' || t.tgname as k, md5(pg_get_triggerdef(t.oid)) as h from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and not t.tgisinternal`,
  policies: `select tablename || '.' || policyname as k, md5(coalesce(qual, '') || '|' || coalesce(with_check, '') || '|' || cmd || '|' || array_to_string(roles, ',')) as h from pg_policies where schemaname = 'public'`,
};

let ecarts = 0;
for (const [nom, sql] of Object.entries(REQUETES)) {
  const p = new Map((await prod(sql)).map((x) => [x.k, x.h]));
  const l = new Map(local(sql).map((x) => [x.k, x.h]));
  const absentes = [...p.keys()].filter((k) => !l.has(k)).sort();
  const enTrop = [...l.keys()].filter((k) => !p.has(k)).sort();
  const differentes = [...p.keys()].filter((k) => l.has(k) && l.get(k) !== p.get(k)).sort();
  ecarts += absentes.length + enTrop.length + differentes.length;
  console.log(`\n── ${nom} : prod ${p.size}, local ${l.size} — absentes en local ${absentes.length}, en trop ${enTrop.length}, différentes ${differentes.length}`);
  const montrer = (titre, liste) => { if (liste.length) console.log(`   ${titre} : ${liste.slice(0, 30).join(' ; ')}${liste.length > 30 ? ` … (+${liste.length - 30})` : ''}`); };
  montrer('absentes en local', absentes); montrer('en trop en local', enTrop); montrer('différentes', differentes);
}
console.log(`\n${ecarts} écart(s) au total.`);
