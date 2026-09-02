#!/usr/bin/env node
/* Compare le catalogue prod vs staging via la Management API.
   Ne remplace pas db:diff (qui compare les corps SQL), mais n'exige
   ni Docker ni mot de passe : il répond à « qu'est-ce qui MANQUE ». */

const JETON = process.env.SUPABASE_ACCESS_TOKEN;
const PROD = process.env.SUPABASE_PROJECT_REF_PROD;
const STG = process.env.SUPABASE_PROJECT_REF;
if (!JETON || !PROD || !STG) { console.error('env manquantes'); process.exit(2); }

async function q(ref, sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${JETON}`, 'Content-Type': 'application/json', 'User-Agent': 'curl/8.7.1' },
    body: JSON.stringify({ query: sql }),
  });
  if (r.status !== 201) throw new Error(`HTTP ${r.status} sur ${ref} — ${(await r.text()).slice(0,200)}`);
  return r.json();
}

// Chaque sonde renvoie une liste de clés textuelles comparables.
const SONDES = [
  ['tables', `select (c.relname || case when c.relkind='v' then ' (vue)' when c.relkind='m' then ' (vue mat.)' else '' end) as k
              from pg_class c join pg_namespace n on n.oid=c.relnamespace
              where n.nspname='public' and c.relkind in ('r','v','m','p') order by 1`],
  ['colonnes', `select c.relname||'.'||a.attname||' '||format_type(a.atttypid,a.atttypmod) as k
                from pg_attribute a join pg_class c on c.oid=a.attrelid
                join pg_namespace n on n.oid=c.relnamespace
                where n.nspname='public' and c.relkind in ('r','p') and a.attnum>0 and not a.attisdropped order by 1`],
  ['fonctions', `select p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' as k
                 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                 where n.nspname='public' order by 1`],
  ['policies', `select c.relname||' :: '||pol.polname as k
                from pg_policy pol join pg_class c on c.oid=pol.polrelid
                join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' order by 1`],
  ['triggers', `select c.relname||' :: '||t.tgname as k
                from pg_trigger t join pg_class c on c.oid=t.tgrelid
                join pg_namespace n on n.oid=c.relnamespace
                where n.nspname='public' and not t.tgisinternal order by 1`],
  ['index', `select indexname as k from pg_indexes where schemaname='public' order by 1`],
  ['contraintes', `select c.relname||' :: '||con.conname||' ('||con.contype::text||')' as k
                   from pg_constraint con join pg_class c on c.oid=con.conrelid
                   join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' order by 1`],
  ['extensions', `select extname||' '||extversion as k from pg_extension order by 1`],
  ['taches planifiees (cron)', `select jobname||' :: '||schedule as k from cron.job order by 1`],
  ['buckets storage', `select id||' (public='||public::text||')' as k from storage.buckets order by 1`],
  ['publication realtime', `select c.relname as k from pg_publication_tables pt
                            join pg_class c on c.relname=pt.tablename
                            join pg_namespace n on n.oid=c.relnamespace and n.nspname=pt.schemaname
                            where pt.pubname='supabase_realtime' and n.nspname='public' order by 1`],
];

const ecarts = [];

for (const [nom, sql] of SONDES) {
  let a, b;
  try {
    [a, b] = await Promise.all([q(PROD, sql), q(STG, sql)]);
  } catch (e) {
    console.log(`\n── ${nom} ──\n  non comparable : ${e.message}`);
    continue;
  }
  const sa = new Set((a || []).map(r => r.k));
  const sb = new Set((b || []).map(r => r.k));
  const manqueStg = [...sa].filter(x => !sb.has(x));
  const enTropStg = [...sb].filter(x => !sa.has(x));

  console.log(`\n── ${nom} ──  prod ${sa.size} · staging ${sb.size}`);
  if (!manqueStg.length && !enTropStg.length) { console.log('  identique'); continue; }
  if (manqueStg.length) {
    console.log(`  MANQUE en staging (${manqueStg.length}) :`);
    manqueStg.slice(0, 40).forEach(x => console.log('    - ' + x));
    if (manqueStg.length > 40) console.log(`    … et ${manqueStg.length - 40} autres`);
  }
  if (enTropStg.length) {
    console.log(`  EN TROP en staging (${enTropStg.length}) :`);
    enTropStg.slice(0, 40).forEach(x => console.log('    + ' + x));
    if (enTropStg.length > 40) console.log(`    … et ${enTropStg.length - 40} autres`);
  }
  ecarts.push({ nom, manque: manqueStg.length, enTrop: enTropStg.length });
}

console.log('\n' + '═'.repeat(60));
if (!ecarts.length) { console.log('Aucun écart. Staging est le miroir de la prod.\n'); process.exit(0); }
console.log('Écarts par catégorie :');
for (const e of ecarts) console.log(`  ${e.nom.padEnd(28)} manque ${e.manque}, en trop ${e.enTrop}`);
console.log('');
process.exit(1);
