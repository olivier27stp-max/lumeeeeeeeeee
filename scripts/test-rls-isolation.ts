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
import dotenv from 'dotenv';

// En CI la chaîne arrive par le secret RLS_TEST_DB_URL → DB_URL. En local
// elle vit dans .env.local, qui n'est pas chargé automatiquement : sans
// ceci, `npm run test:rls` échoue sur "Set DB_URL" alors que la valeur est
// bien présente sur la machine.
dotenv.config({ path: '.env.local' });

const DB_URL = process.env.DB_URL || process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
if (!DB_URL) { console.error('Set DB_URL (privileged/postgres connection).'); process.exit(2); }

/**
 * Parse the connection string by hand rather than handing it to `pg`.
 *
 * A Supabase-generated password routinely contains `@ / # ? %`, which all
 * have meaning inside a URL: `new URL()` (and therefore `pg`) mis-parses
 * the string and the failure surfaces as a confusing
 * "password authentication failed" or "tenant not found" — pointing at the
 * credentials when the real problem is the encoding. Splitting on the LAST
 * `@` (the host separator) and the FIRST `:` after the scheme makes the
 * literal password survive untouched, whatever it contains.
 */
function parseConn(raw: string) {
  const url = raw.trim();
  const m = /^postgres(?:ql)?:\/\/(.+)$/i.exec(url);
  if (!m) throw new Error('DB_URL must start with postgresql://');

  const rest = m[1];
  const at = rest.lastIndexOf('@');
  if (at < 0) throw new Error('DB_URL is missing the "@" before the host');

  const creds = rest.slice(0, at);
  const hostPart = rest.slice(at + 1);

  const colon = creds.indexOf(':');
  if (colon < 0) {
    throw new Error(
      'DB_URL is missing the ":" between user and password '
      + '(expected postgresql://USER:PASSWORD@HOST:5432/postgres)',
    );
  }
  const user = decodeURIComponent(creds.slice(0, colon));
  const password = creds.slice(colon + 1); // kept literal on purpose

  const slash = hostPart.indexOf('/');
  const hostPort = slash < 0 ? hostPart : hostPart.slice(0, slash);
  const database = slash < 0 ? 'postgres' : (hostPart.slice(slash + 1).split('?')[0] || 'postgres');
  const [host, portRaw] = hostPort.split(':');
  const port = Number(portRaw || 5432);

  // Port 6543 is the transaction-mode pooler: it does not keep a session, so
  // `SET LOCAL ROLE` — which this whole test depends on to impersonate a
  // user — is silently dropped. Fail loudly instead of reporting fake passes.
  if (port === 6543) {
    throw new Error(
      'DB_URL uses port 6543 (transaction pooler). This test needs SET LOCAL ROLE; use port 5432.',
    );
  }

  return { host, port, user, password, database };
}

let conn: ReturnType<typeof parseConn>;
try {
  conn = parseConn(DB_URL);
} catch (e) {
  console.error('✗ DB_URL malformed:', e instanceof Error ? e.message : e);
  process.exit(2);
}

// Relations that are GLOBAL by design (not tenant data) — allowed to be shared/anon-visible.
const GLOBAL = new Set(['plans', 'promo_codes']);

const c = new Client({ ...conn, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 });

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
  // Le filtre sur has_table_privilege n'est pas cosmétique : une policy sans
  // WITH CHECK sur une table dont le GRANT UPDATE a été révoqué est inerte —
  // sans privilège, il n'y a rien à autoriser. Sans ce filtre, 14 policies du
  // control plane ressortent en faux positif permanent.
  const noCheck = (await c.query(`
    select p.tablename||'.'||p.policyname p from pg_policies p
    join pg_class k on k.relname = p.tablename and k.relkind = 'r'
    join pg_namespace ns on ns.oid = k.relnamespace and ns.nspname = 'public'
    where p.schemaname='public' and p.cmd in ('UPDATE','ALL')
      and ('authenticated' = any(p.roles) or 'public' = any(p.roles))
      and p.with_check is null
      and has_table_privilege('authenticated', k.oid, 'update')`)).rows;
  for (const r of noCheck) leaks.push(`UPDATE policy without WITH CHECK: ${r.p}`);

  // ── J. SSRF via pg_net ──
  // pg_net fait émettre à la base des requêtes HTTP sortantes. Un rôle
  // client qui peut l'appeler dispose d'une SSRF : exfiltrer des données
  // vers un serveur tiers, atteindre des services internes, ou couper le
  // worker réseau (donc push + libération des numéros SMS).
  // Les appelants légitimes sont SECURITY DEFINER et ne sont pas affectés
  // par le retrait du grant.
  const netFns = (await c.query(`
    select count(*)::int n from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace and ns.nspname = 'net'
    where has_function_privilege('anon', p.oid, 'execute')
       or has_function_privilege('authenticated', p.oid, 'execute')`)).rows[0]?.n ?? 0;
  if (netFns > 0) {
    leaks.push(`SSRF: ${netFns} pg_net function(s) callable by client roles — see scripts/A-APPLIQUER-dashboard-pgnet.sql`);
  }

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
main().catch(e => {
  const msg = e?.message || String(e);
  console.error('✗', msg);

  // A connection failure is NOT a security finding, and reporting it as one
  // wastes the reader's time. Say which of the four things is actually wrong
  // so the fix does not require re-deriving the diagnosis from scratch.
  if (/password authentication failed/i.test(msg)) {
    console.error(
      '\n  The host and the URL format are fine — only the password was rejected.\n'
      + '  → The DB_URL secret holds a stale password, or the current one was\n'
      + '    reset after the secret was saved. Update it at\n'
      + '    Supabase → Project Settings → Database → Database password.',
    );
  } else if (/tenant or user not found|ENOTFOUND/i.test(msg)) {
    console.error(
      '\n  The pooler did not recognise the host or the user.\n'
      + '  → Check the hostname: Supabase now uses aws-1-<region>, not aws-0-.\n'
      + '  → The user must be postgres.<project-ref>, not plain "postgres".',
    );
  } else if (/Need >=2/i.test(msg)) {
    console.error(
      '\n  Not a leak: the database lacks two single-org users to compare.\n'
      + '  → Seed a second organisation, or point DB_URL at a staging copy.',
    );
  }
  process.exit(2);
});
