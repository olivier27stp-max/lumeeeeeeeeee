#!/usr/bin/env node
/**
 * Recopie les droits (GRANT) des fonctions et tables `public` de la PROD sur la stack locale
 * de l'audit Statistiques. Lecture seule en prod (catalogue, API Management).
 *
 *   node --env-file=.env.local scripts/qa/stats-acl-prod.mjs
 *
 * Pourquoi : la baseline appliquée par supabase_admin donne EXECUTE à anon sur tout
 * (droits par défaut d'un projet neuf, cf. supabase/baseline/README.md). Sans cette
 * recopie, les tests de sécurité verraient des fuites « anonymes » qui n'existent pas en prod.
 */
import pg from 'pg';
import { STATS_LOCAL } from './stats-local.mjs';

const REF = process.env.SUPABASE_PROJECT_REF_PROD;
const JETON = process.env.SUPABASE_ACCESS_TOKEN;
if (!REF || !JETON) { console.error('SUPABASE_PROJECT_REF_PROD et SUPABASE_ACCESS_TOKEN requis (.env.local)'); process.exit(2); }
const url = new URL(STATS_LOCAL.dbUrl);
if (!['localhost', '127.0.0.1'].includes(url.hostname)) { console.error('REFUS : cible non locale'); process.exit(2); }

const SQL = `
select 'revoke all on function public.'||quote_ident(p.proname)||'('||pg_get_function_identity_arguments(p.oid)||') from public, anon, authenticated, service_role;' ||
 coalesce((select string_agg('grant execute on function public.'||quote_ident(p.proname)||'('||pg_get_function_identity_arguments(p.oid)||') to '||r||';', ' ')
   from unnest(array['anon','authenticated','service_role']) r where has_function_privilege(r, p.oid, 'execute')), '') s
from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind in ('f','p')
union all
select 'revoke all on table public.'||quote_ident(c.relname)||' from anon, authenticated;' ||
 coalesce((select string_agg('grant '||priv||' on table public.'||quote_ident(c.relname)||' to '||r||';', ' ')
   from unnest(array['anon','authenticated']) r, unnest(array['select','insert','update','delete']) priv where has_table_privilege(r, c.oid, priv)), '')
from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','v','p')`;

const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
  method: 'POST', headers: { Authorization: `Bearer ${JETON}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: SQL }),
});
if (!r.ok) { console.error('catalogue prod :', r.status); process.exit(1); }
const lignes = await r.json();
const db = new pg.Client({ connectionString: STATS_LOCAL.dbUrl });
await db.connect();
let erreurs = 0;
for (const { s } of lignes) { try { await db.query(s); } catch { erreurs += 1; } } // objet absent en local : ignoré, compté
await db.end();
console.log(`${lignes.length} objets alignés sur la prod (${erreurs} absents en local)`);
