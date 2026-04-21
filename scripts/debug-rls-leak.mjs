/**
 * Debug the RLS leak found in E2E test:
 * user B can SELECT user A's client/quote via Supabase REST directly.
 */
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { randomUUID } from 'node:crypto';
config({ path: '.env.local' });

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.VITE_SUPABASE_ANON_KEY;
const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

const PREFIX = 'rls-debug-' + Date.now() + '-';
const cleanup = [];

async function main() {
  // Minimal setup
  const uA = await admin.auth.admin.createUser({ email: PREFIX + 'a@t.l', password: 'Abcd1234!@x', email_confirm: true });
  const uB = await admin.auth.admin.createUser({ email: PREFIX + 'b@t.l', password: 'Abcd1234!@x', email_confirm: true });
  const oA = await admin.from('orgs').insert({ name: PREFIX + 'A' }).select('id').single();
  const oB = await admin.from('orgs').insert({ name: PREFIX + 'B' }).select('id').single();
  cleanup.push(
    () => admin.auth.admin.deleteUser(uA.data.user.id),
    () => admin.auth.admin.deleteUser(uB.data.user.id),
    () => admin.from('orgs').delete().eq('id', oA.data.id),
    () => admin.from('orgs').delete().eq('id', oB.data.id),
  );
  await admin.from('memberships').insert([
    { user_id: uA.data.user.id, org_id: oA.data.id, role: 'owner' },
    { user_id: uB.data.user.id, org_id: oB.data.id, role: 'owner' },
  ]);

  const clA = await admin.from('clients').insert({
    org_id: oA.data.id, first_name: 'Alice', last_name: 'A', status: 'active', created_by: uA.data.user.id,
  }).select('id, org_id').single();
  cleanup.push(() => admin.from('clients').delete().eq('id', clA.data.id));

  console.log('Setup: orgA=' + oA.data.id.slice(0, 8), 'orgB=' + oB.data.id.slice(0, 8));
  console.log('       userA=' + uA.data.user.id.slice(0, 8), 'userB=' + uB.data.user.id.slice(0, 8));
  console.log('       clientA.id=' + clA.data.id + ' clientA.org=' + clA.data.org_id.slice(0, 8));

  // Sign in B
  const anon = createClient(SUPABASE_URL, ANON, { auth: { persistSession: false } });
  const si = await anon.auth.signInWithPassword({ email: PREFIX + 'b@t.l', password: 'Abcd1234!@x' });
  const tokenB = si.data.session.access_token;

  const bClient = createClient(SUPABASE_URL, ANON, {
    auth: { persistSession: false },
    global: { headers: { Authorization: 'Bearer ' + tokenB } },
  });

  // --- RLS diagnostic ---

  console.log('\n--- Test 1: B reads clients WHERE id = clA.id');
  const r1 = await bClient.from('clients').select('id, org_id, first_name').eq('id', clA.data.id);
  console.log('  status:', r1.status, '| count:', r1.data?.length, '| rows:', JSON.stringify(r1.data));

  console.log('\n--- Test 2: B reads clients no filter (should be empty)');
  const r2 = await bClient.from('clients').select('id, org_id').limit(5);
  console.log('  count:', r2.data?.length, '| rows:', JSON.stringify(r2.data));

  console.log('\n--- Test 3: B calls has_org_membership(userB, orgA) — should be FALSE');
  const r3 = await admin.rpc('has_org_membership', { p_user: uB.data.user.id, p_org: oA.data.id });
  console.log('  has_org_membership =', r3.data);

  console.log('\n--- Test 4: what memberships rows exist for userB?');
  const r4 = await admin.from('memberships').select('*').eq('user_id', uB.data.user.id);
  console.log('  memberships:', JSON.stringify(r4.data));

  console.log('\n--- Test 5: Is there an "org_members" table?');
  const r5 = await admin.rpc('has_org_membership', { p_user: uB.data.user.id, p_org: oA.data.id });
  console.log('  (re-call) =', r5.data);

  console.log('\n--- Test 6: pg_policies on clients');
  const r6 = await admin.rpc('try_advisory_lock', { p_key: 1 }); // just to confirm admin works
  // Query pg_policies via a raw select would need a custom RPC; skip.

  console.log('\n--- Test 7: RLS status on clients table');
  const { data: policies } = await admin.from('clients').select('id').limit(0); // no-op to open connection
  void policies;

  // Can we discover what's happening? Look at all policies via information_schema proxy
  // We can use the rest SQL directly via pg_rest? Let's call a custom RPC instead
  // Easier: list via admin + pg_catalog through a view if accessible
  console.log('\n--- Test 8: Force test — B tries to read A client via raw fetch to /rest/v1/clients');
  const url = SUPABASE_URL + '/rest/v1/clients?id=eq.' + clA.data.id + '&select=id,org_id,first_name';
  const res = await fetch(url, {
    headers: {
      Authorization: 'Bearer ' + tokenB,
      apikey: ANON,
      Accept: 'application/json',
    },
  });
  console.log('  HTTP:', res.status, '| body:', (await res.text()).slice(0, 300));

  console.log('\n--- Test 9: check for views that might bypass RLS');
  // Try clients_active (RLS-ed view)
  const r9 = await bClient.from('clients_active').select('id, org_id').eq('id', clA.data.id);
  console.log('  clients_active count:', r9.data?.length, '| err:', r9.error?.code);
}

main()
  .catch(err => console.error('FATAL:', err))
  .finally(async () => {
    for (const fn of cleanup.reverse()) try { await fn(); } catch {}
    console.log('\ncleanup done');
  });
