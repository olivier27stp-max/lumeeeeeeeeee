/**
 * Dump (lecture seule) des definitions actuelles des fonctions de recherche
 * globale, pour verifier la derive avant de les modifier.
 *
 * USAGE  node --env-file=.env.local scripts/dump-search-fns.mjs          → staging
 *        node --env-file=.env.local scripts/dump-search-fns.mjs --prod   → prod
 */
const isProd = process.argv.includes('--prod');
const t = process.env.SUPABASE_ACCESS_TOKEN;
const r = isProd ? process.env.SUPABASE_PROJECT_REF_PROD : process.env.SUPABASE_PROJECT_REF;
if (!t || !r) { console.error('SUPABASE_ACCESS_TOKEN / project ref manquants dans .env.local'); process.exit(1); }

async function q(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${r}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const x = await res.text();
  if (!res.ok) throw new Error(x.slice(0, 300));
  return JSON.parse(x);
}

const rows = await q(`select p.proname, pg_get_functiondef(p.oid) as def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname='public'
    and p.proname in ('search_global','search_global_counts','search_global_by_type')
  order by p.proname`);

console.log(`Cible: ${isProd ? 'PROD' : 'staging'} (${r}) — ${rows.length} fonction(s)\n`);
for (const row of rows) {
  console.log(`===== ${row.proname} =====`);
  console.log(row.def);
  console.log('');
}
