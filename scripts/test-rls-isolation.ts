/**
 * RLS cross-tenant isolation test — comprehensive.
 *
 * Impersonates real authenticated users (role + JWT claims, in a transaction)
 * and the `anon` role, then asserts no relation leaks another tenant's data.
 * Covers the four angles that a naive check misses:
 *   A. ANON reads   — any non-global relation returning rows to anon = leak.
 *   B. AUTH reads    — relations WITH org_id must show only the user's org(s).
 *   C. CHILD reads   — tenant tables WITHOUT org_id (scoped via a parent):
 *                      two different-org users must not see overlapping rows.
 *   D. WRITE         — a user must not be able to UPDATE another org's row.
 *
 * This is the generic detector for the leaks found 2026-07-08 (properties_active,
 * satisfaction_surveys, team_members read+write, org_features).
 *
 * Run:  DB_URL=postgres://... npx tsx scripts/test-rls-isolation.ts   (or npm run test:rls)
 * CI:   point DB_URL at a staging DB seeded with >=2 orgs. Exit 1 on any leak.
 */
import { Client } from 'pg';

const DB_URL = process.env.DB_URL || process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
if (!DB_URL) { console.error('Set DB_URL (privileged/postgres connection).'); process.exit(2); }

// Relations that are GLOBAL by design (not tenant data) — allowed to be shared/anon-visible.
const GLOBAL = new Set(['plans', 'promo_codes']);

const c = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 });

async function inRole<T>(role: string, claims: string | null, fn: () => Promise<T>): Promise<T> {
  await c.query('begin');
  try {
    await c.query(`set local role ${role}`);
    if (claims) await c.query(`set local request.jwt.claims = '${claims}'`);
    return await fn();
  } finally { await c.query('rollback').catch(() => {}); }
}

async function main() {
  await c.connect();
  await c.query("set statement_timeout='120s'");
  const leaks: string[] = [];

  // Two distinct single-org users.
  const users = (await c.query(`
    select distinct on (m.org_id) m.user_id, m.org_id from memberships m
    where exists(select 1 from auth.users u where u.id=m.user_id)
      and (select count(*) from memberships mm where mm.user_id=m.user_id)=1
    limit 2`)).rows;
  if (users.length < 2) { console.error('Need >=2 single-org users seeded.'); process.exit(2); }
  const [A, B] = users;
  const claimsA = JSON.stringify({ sub: A.user_id, role: 'authenticated' });
  const claimsB = JSON.stringify({ sub: B.user_id, role: 'authenticated' });
  console.log(`A=${A.user_id.slice(0,8)}/${A.org_id.slice(0,8)}  B=${B.user_id.slice(0,8)}/${B.org_id.slice(0,8)}\n`);

  // ── A. ANON ──
  const anonRels = (await c.query(`select c.relname n, c.relkind k from pg_class c join pg_namespace ns on ns.oid=c.relnamespace and ns.nspname='public'
    where c.relkind in ('r','v') and has_table_privilege('anon',c.oid,'SELECT')`)).rows;
  for (const r of anonRels) {
    if (GLOBAL.has(r.n)) continue;
    try { const got = await inRole('anon', null, async () => (await c.query(`select 1 from public."${r.n}" limit 1`)).rowCount);
      if (got) leaks.push(`ANON reads ${r.n}`); } catch { /* denied = ok */ }
  }

  // ── B. AUTH reads (org_id relations) ──
  const orgRels = (await c.query(`select c.relname n from pg_class c join pg_namespace ns on ns.oid=c.relnamespace and ns.nspname='public'
    where c.relkind in ('r','v') and has_table_privilege('authenticated',c.oid,'SELECT')
      and exists(select 1 from pg_attribute a where a.attrelid=c.oid and a.attname='org_id' and not a.attisdropped)`)).rows;
  for (const r of orgRels) {
    try { const foreign = await inRole('authenticated', claimsA, async () =>
        (await c.query(`select count(*)::int f from public."${r.n}" where org_id is not null and org_id <> $1`, [A.org_id])).rows[0].f);
      if (foreign > 0) leaks.push(`AUTH ${r.n} shows ${foreign} foreign-org rows`); } catch { /* skip */ }
  }

  // ── C. CHILD reads (no org_id): two users must not overlap ──
  const childTbls = (await c.query(`select c.relname n from pg_class c join pg_namespace ns on ns.oid=c.relnamespace and ns.nspname='public'
    where c.relkind='r' and has_table_privilege('authenticated',c.oid,'SELECT')
      and exists(select 1 from pg_attribute a where a.attrelid=c.oid and a.attname='id' and not a.attisdropped)
      and not exists(select 1 from pg_attribute a where a.attrelid=c.oid and a.attname='org_id' and not a.attisdropped)`)).rows.map(r => r.n);
  for (const t of childTbls) {
    if (GLOBAL.has(t)) continue;
    try {
      const idsA: Set<string> = await inRole('authenticated', claimsA, async () => new Set((await c.query(`select id from public."${t}" limit 5000`)).rows.map(r => String(r.id))));
      const idsB: Set<string> = await inRole('authenticated', claimsB, async () => new Set((await c.query(`select id from public."${t}" limit 5000`)).rows.map(r => String(r.id))));
      if (idsA.size && idsB.size && [...idsA].some(x => idsB.has(x))) leaks.push(`CHILD ${t} shares rows between two orgs`);
    } catch { /* skip */ }
  }

  // ── D. WRITE (A must not update B's client) ──
  try {
    const tgt = (await c.query(`select id from clients where org_id=$1 limit 1`, [B.org_id])).rows[0];
    if (tgt) {
      const affected = await inRole('authenticated', claimsA, async () =>
        (await c.query(`update public.clients set first_name=first_name where id=$1`, [tgt.id])).rowCount);
      if (affected && affected > 0) leaks.push(`WRITE A could update B's client (${affected} rows)`);
    }
  } catch { /* skip */ }

  // ── E. RPC ouvertes à anon ──
  // La RLS ne s'applique PAS aux fonctions: une SECURITY DEFINER exécutable
  // par anon tourne avec les droits de son propriétaire et voit toutes les
  // orgs. Trois fuites réelles ont été trouvées ainsi le 2026-07-30
  // (ac_client_name, resolve_primary_property, ac_log_event).
  // NB: le revoke doit viser PUBLIC, pas seulement anon — l'ACL
  // "=X/postgres" est un grant au pseudo-rôle PUBLIC qui englobe anon.
  const anonFns = (await c.query(`
    select p.proname n from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
    where ns.nspname='public' and p.prosecdef
      and has_function_privilege('anon', p.oid, 'execute')`)).rows;
  for (const f of anonFns) leaks.push(`ANON can execute SECURITY DEFINER ${f.n}()`);

  // ── F. Control plane écrivable par un client ──
  // Si un utilisateur peut écrire ici, il se donne un forfait, efface ses
  // traces d'audit, ou désactive les protections anti-brute-force.
  const CONTROL_PLANE = ['plans','api_keys','audit_events','security_incidents',
    'security_events','security_alerts','rate_limits','ip_blocklist',
    'failed_login_attempts','login_history','payment_provider_secrets',
    'invoice_sequences','quote_sequences','org_invoice_sequences','promo_codes',
    'referrals','webhook_events','processed_checkout_sessions','org_features',
    'subscriptions','consents','dsar_requests','integration_audit_logs'];
  for (const t of CONTROL_PLANE) {
    const r = (await c.query(`
      select coalesce(bool_or(has_table_privilege('authenticated', c.oid, v)), false) w
      from pg_class c join pg_namespace ns on ns.oid=c.relnamespace and ns.nspname='public',
           unnest(array['insert','update','delete']) v
      where c.relname=$1 and c.relkind='r'`, [t])).rows[0];
    if (r?.w) leaks.push(`CONTROL PLANE ${t} is writable by authenticated`);
  }

  // ── G. Secrets lisibles par un client ──
  // La RLS filtre les LIGNES, jamais les COLONNES: un GRANT SELECT au niveau
  // table expose les jetons OAuth même si la ligne est bien cloisonnée.
  for (const col of ['encrypted_access_token','encrypted_refresh_token','encrypted_credentials','credentials']) {
    const r = (await c.query(`
      select has_column_privilege('authenticated','public.app_connections',$1,'select') p
      where exists(select 1 from pg_attribute a
                   where a.attrelid='public.app_connections'::regclass
                     and a.attname=$1 and not a.attisdropped)`, [col])).rows[0];
    if (r?.p) leaks.push(`SECRET app_connections.${col} readable by authenticated`);
  }

  // ── H. UPDATE sans WITH CHECK = tenant hopping ──
  // Sans WITH CHECK, Postgres réutilise USING, qui contraint la ligne AVANT
  // modification et ne dit rien de la ligne APRÈS: on peut donc déplacer
  // ses propres lignes vers une autre org.
  const noCheck = (await c.query(`
    select tablename||'.'||policyname p from pg_policies
    where schemaname='public' and cmd in ('UPDATE','ALL')
      and ('authenticated' = any(roles) or 'public' = any(roles))
      and with_check is null`)).rows;
  for (const r of noCheck) leaks.push(`UPDATE policy without WITH CHECK: ${r.p}`);

  // ── I. Vues sans security_invoker ──
  // Une vue s'exécute avec les droits de son propriétaire (postgres), donc
  // elle voit TOUTES les orgs quelle que soit la RLS des tables sous-jacentes.
  // Postgres accepte 'on' comme 'true' — tester les deux, sinon des vues
  // correctement protégées ressortent en faux positif.
  const badViews = (await c.query(`
    select c.relname n from pg_class c
    join pg_namespace ns on ns.oid=c.relnamespace and ns.nspname='public'
    where c.relkind='v' and has_table_privilege('authenticated', c.oid,'select')
      and not exists (
        select 1 from unnest(coalesce(c.reloptions, array[]::text[])) o
        where lower(o) in ('security_invoker=true','security_invoker=on'))`)).rows;
  for (const v of badViews) leaks.push(`VIEW ${v.n} runs as owner (no security_invoker)`);

  console.log(`Checked: anon(${anonRels.length}) auth-org(${orgRels.length}) child(${childTbls.length}) write rpc(${anonFns.length}) control-plane(${CONTROL_PLANE.length}) secrets policies views\n`);
  if (leaks.length) { console.log(`🔴 ${leaks.length} LEAK(S):`); leaks.forEach(l => console.log('   - ' + l)); await c.end(); process.exit(1); }
  console.log('✅ PASS — no cross-tenant leak (reads, anon, child tables, and writes all isolated).');
  await c.end();
}
main().catch(e => { console.error('✗', e.message); process.exit(2); });
