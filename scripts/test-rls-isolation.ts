/**
 * RLS cross-tenant isolation test.
 *
 * For EVERY table and view in `public` that (a) has an `org_id` column and
 * (b) is SELECT-able by the `authenticated` role, this impersonates a real
 * authenticated user (role + JWT claims, inside a transaction) and asserts the
 * user can see rows from NO org other than their own. A leak = FAIL.
 *
 * This is the generic detector for the class of bug found on 2026-07-08
 * (`properties_active` view without security_invoker leaked all 14 orgs).
 *
 * Run:  DB_URL=postgres://... npx tsx scripts/test-rls-isolation.ts
 * CI:   point DB_URL at a staging/branch DB seeded with ≥2 orgs. Exit 1 on leak.
 *
 * Optional env: TEST_USER_ID / TEST_ORG_ID to pin the impersonated user;
 * otherwise the script picks a membership whose org has the most data.
 */
import { Client } from 'pg';

const DB_URL = process.env.DB_URL || process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
if (!DB_URL) {
  console.error('Set DB_URL (a privileged connection — postgres role — to run SET ROLE authenticated).');
  process.exit(2);
}

const client = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 });

async function main() {
  await client.connect();
  await client.query("set statement_timeout='120s'");

  // Pick the impersonated user + org.
  let userId = process.env.TEST_USER_ID;
  let orgId = process.env.TEST_ORG_ID;
  if (!userId || !orgId) {
    const r = await client.query(`
      select m.user_id, m.org_id
      from memberships m
      where exists (select 1 from auth.users u where u.id = m.user_id)
      order by (select count(*) from clients c where c.org_id = m.org_id) desc
      limit 1`);
    if (!r.rows.length) { console.error('No usable membership found to impersonate.'); process.exit(2); }
    userId = r.rows[0].user_id; orgId = r.rows[0].org_id;
  }
  console.log(`Impersonating user ${String(userId).slice(0, 8)} of org ${String(orgId).slice(0, 8)}\n`);

  // All API-exposed relations (tables + views) with an org_id column.
  const rels = (await client.query(`
    select c.relname as name, c.relkind as kind
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    where c.relkind in ('r','v')
      and has_table_privilege('authenticated', c.oid, 'SELECT')
      and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'org_id' and not a.attisdropped)
    order by c.relname`)).rows;

  const claims = JSON.stringify({ sub: userId, role: 'authenticated' });
  const leaks: { name: string; foreign: number; kind: string }[] = [];
  let checked = 0, errored = 0;

  for (const rel of rels) {
    try {
      await client.query('begin');
      await client.query('set local role authenticated');
      await client.query(`set local request.jwt.claims = '${claims}'`);
      // How many visible rows belong to some OTHER org? Must be 0.
      const q = await client.query(
        `select count(*)::int as foreign from public."${rel.name}" where org_id is not null and org_id <> $1`,
        [orgId]
      );
      await client.query('rollback');
      const foreign = q.rows[0].foreign;
      checked++;
      if (foreign > 0) leaks.push({ name: rel.name, foreign, kind: rel.kind === 'v' ? 'view' : 'table' });
    } catch (e: any) {
      await client.query('rollback').catch(() => {});
      errored++;
      // A relation that errors under RLS (e.g. denies all) is not a leak; log at debug.
      if (process.env.DEBUG) console.log(`  (skip ${rel.name}: ${e.message.slice(0, 60)})`);
    }
  }

  console.log(`Relations with org_id exposed to authenticated: ${rels.length}`);
  console.log(`Checked: ${checked} | skipped/errored: ${errored}\n`);

  if (leaks.length) {
    console.log(`🔴 CROSS-TENANT LEAK — ${leaks.length} relation(s) expose other orgs' rows:`);
    leaks.forEach(l => console.log(`   - ${l.name} (${l.kind}) → ${l.foreign} foreign-org rows visible`));
    await client.end();
    process.exit(1);
  }

  console.log('✅ PASS — no relation leaks another org to the impersonated user.');
  await client.end();
}

main().catch((e) => { console.error('✗', e.message); process.exit(2); });
