/**
 * Create 2 isolated test orgs + users via service_role, issue JWTs, and
 * make real HTTP calls against the running backend on port 3099 to
 * verify RLS cross-org isolation.
 *
 * Cleans up everything at the end.
 *
 * Usage: node scripts/test-api-fixtures.mjs
 */
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';
import { readFileSync } from 'node:fs';

// Ensure .env.local is loaded
import { config } from 'dotenv';
config({ path: '.env.local' });

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.VITE_SUPABASE_ANON_KEY;
const API = 'http://localhost:3099';

if (!SUPABASE_URL || !SERVICE_ROLE || !ANON) {
  console.error('Missing env vars');
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

const PREFIX = 'lume-test-' + Date.now() + '-';

function logStep(s) { console.log('\n━━━ ' + s + ' ━━━'); }
function ok(msg) { console.log('  ✓ ' + msg); }
function fail(msg, detail) { console.log('  ✗ ' + msg + (detail ? '\n    ' + detail : '')); }
function info(msg) { console.log('  · ' + msg); }

async function http(method, path, token, body) {
  const headers = { 'Content-Type': 'application/json', 'X-Requested-With': 'curl' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(API + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, body: json ?? text };
}

const cleanup = [];

async function main() {
  logStep('Setup: create 2 test orgs + users');

  // Create 2 users
  const userA = await admin.auth.admin.createUser({
    email: PREFIX + 'a@test.local',
    password: 'Abcd1234!@test',
    email_confirm: true,
  });
  if (userA.error) throw userA.error;
  ok('user A created: ' + userA.data.user.id);
  cleanup.push(async () => admin.auth.admin.deleteUser(userA.data.user.id));

  const userB = await admin.auth.admin.createUser({
    email: PREFIX + 'b@test.local',
    password: 'Abcd1234!@test',
    email_confirm: true,
  });
  if (userB.error) throw userB.error;
  ok('user B created: ' + userB.data.user.id);
  cleanup.push(async () => admin.auth.admin.deleteUser(userB.data.user.id));

  // Create 2 orgs
  const orgA = await admin.from('orgs').insert({ name: PREFIX + 'orgA', slug: PREFIX + 'a' }).select('id').single();
  if (orgA.error) throw orgA.error;
  ok('org A created: ' + orgA.data.id);
  cleanup.push(async () => admin.from('orgs').delete().eq('id', orgA.data.id));

  const orgB = await admin.from('orgs').insert({ name: PREFIX + 'orgB', slug: PREFIX + 'b' }).select('id').single();
  if (orgB.error) throw orgB.error;
  ok('org B created: ' + orgB.data.id);
  cleanup.push(async () => admin.from('orgs').delete().eq('id', orgB.data.id));

  // Memberships
  await admin.from('memberships').insert([
    { user_id: userA.data.user.id, org_id: orgA.data.id, role: 'owner' },
    { user_id: userB.data.user.id, org_id: orgB.data.id, role: 'owner' },
  ]);
  ok('memberships created');

  // Seed: 1 client in each org
  const clA = await admin.from('clients').insert({
    org_id: orgA.data.id, first_name: 'Alice', last_name: 'A', email: 'alice@a.test', status: 'active',
  }).select('id').single();
  if (clA.error) throw clA.error;
  info('orgA client: ' + clA.data.id);
  cleanup.push(async () => admin.from('clients').delete().eq('id', clA.data.id));

  const clB = await admin.from('clients').insert({
    org_id: orgB.data.id, first_name: 'Bob', last_name: 'B', email: 'bob@b.test', status: 'active',
  }).select('id').single();
  if (clB.error) throw clB.error;
  info('orgB client: ' + clB.data.id);
  cleanup.push(async () => admin.from('clients').delete().eq('id', clB.data.id));

  // Sign in both users to get JWTs (via anon client)
  const anonA = createClient(SUPABASE_URL, ANON, { auth: { persistSession: false } });
  const signinA = await anonA.auth.signInWithPassword({
    email: PREFIX + 'a@test.local', password: 'Abcd1234!@test',
  });
  if (signinA.error) throw signinA.error;
  const tokenA = signinA.data.session.access_token;
  ok('user A signed in, JWT len=' + tokenA.length);

  const anonB = createClient(SUPABASE_URL, ANON, { auth: { persistSession: false } });
  const signinB = await anonB.auth.signInWithPassword({
    email: PREFIX + 'b@test.local', password: 'Abcd1234!@test',
  });
  if (signinB.error) throw signinB.error;
  const tokenB = signinB.data.session.access_token;
  ok('user B signed in, JWT len=' + tokenB.length);

  // ─── Tests ────────────────────────────────────────────────────

  logStep('Test 1: GET /api/clients/search — user A sees only orgA clients');
  const r1 = await http('GET', '/api/clients/search?q=Alice', tokenA);
  if (r1.status === 200) {
    const items = r1.body.items || r1.body || [];
    const ids = items.map(c => c.id);
    if (ids.includes(clA.data.id) && !ids.includes(clB.data.id)) ok('A sees own client, not B');
    else fail('A should see own client only', JSON.stringify(ids));
  } else fail('search failed', r1.status + ' ' + JSON.stringify(r1.body));

  logStep('Test 2: GET /api/clients/search — user B sees only orgB clients');
  const r2 = await http('GET', '/api/clients/search?q=Bob', tokenB);
  if (r2.status === 200) {
    const items = r2.body.items || r2.body || [];
    const ids = items.map(c => c.id);
    if (ids.includes(clB.data.id) && !ids.includes(clA.data.id)) ok('B sees own client, not A');
    else fail('B should see own client only', JSON.stringify(ids));
  } else fail('search failed', r2.status + ' ' + JSON.stringify(r2.body));

  logStep('Test 3: Cross-org leak — A queries B client by UUID');
  // Try to fetch B's client directly via POST /clients/by-ids
  const r3 = await http('POST', '/api/clients/by-ids', tokenA, { ids: [clB.data.id] });
  if (r3.status === 200) {
    const found = (r3.body.items || r3.body || []).some(c => c.id === clB.data.id);
    if (!found) ok('RLS blocks cross-org fetch by ID');
    else fail('LEAK: A got B client by ID', JSON.stringify(r3.body));
  } else info('by-ids returned ' + r3.status + ' (may be protected differently)');

  logStep('Test 4: Auth middleware — missing Bearer token');
  const r4 = await http('GET', '/api/clients/search?q=x', null);
  if (r4.status === 401) ok('unauthed GET blocked with 401');
  else fail('expected 401, got ' + r4.status);

  logStep('Test 5: Invalid Bearer token');
  const r5 = await http('GET', '/api/clients/search?q=x', 'obviously-not-a-jwt');
  if (r5.status === 401) ok('invalid JWT rejected with 401');
  else fail('expected 401, got ' + r5.status);

  logStep('Test 6: Zod validation — POST /api/leads/create without full_name');
  const r6 = await http('POST', '/api/leads/create', tokenA, { notes: 'missing required fields' });
  if (r6.status === 400) ok('Zod rejected missing required field');
  else fail('expected 400, got ' + r6.status + ' ' + JSON.stringify(r6.body));

  logStep('Test 7: Create lead happy path');
  const r7 = await http('POST', '/api/leads/create', tokenA, {
    full_name: PREFIX + 'TestLead',
    email: 'lead@a.test',
    value: 1000,
  });
  if (r7.status === 200 || r7.status === 201) {
    ok('lead created: ' + (r7.body?.lead?.id || r7.body?.id || 'ok'));
    const leadId = r7.body?.lead?.id || r7.body?.id;
    if (leadId) cleanup.push(async () => admin.from('leads').delete().eq('id', leadId));
  } else fail('lead create failed: ' + r7.status + ' ' + JSON.stringify(r7.body));

  logStep('Test 8: SMS opt-out — insert then verify sending blocked');
  const testPhone = '+15555550199';
  await admin.from('sms_opt_outs').insert({ org_id: orgA.data.id, phone: testPhone, reason: 'test' });
  cleanup.push(async () => admin.from('sms_opt_outs').delete().eq('org_id', orgA.data.id).eq('phone', testPhone));
  const r8 = await http('POST', '/api/messages/send', tokenA, {
    phone_number: testPhone, message_text: 'should be blocked',
  });
  if (r8.status === 409 && r8.body?.code === 'sms_opted_out') ok('SMS send blocked by opt-out (409)');
  else if (r8.status === 503) info('Twilio not configured — skipping (service not available)');
  else fail('expected 409 sms_opted_out, got ' + r8.status + ' ' + JSON.stringify(r8.body).slice(0, 200));

  logStep('Test 9: Invoice numbering RPC — per-org sequence');
  const { data: n1, error: e1 } = await admin.rpc('claim_next_invoice_number', { p_org: orgA.data.id });
  const { data: n2, error: e2 } = await admin.rpc('claim_next_invoice_number', { p_org: orgA.data.id });
  const { data: n3, error: e3 } = await admin.rpc('claim_next_invoice_number', { p_org: orgB.data.id });
  if (e1 || e2 || e3) fail('RPC error', JSON.stringify(e1 || e2 || e3));
  else if (Number(n2) === Number(n1) + 1 && Number(n3) >= 1) {
    ok('sequence per-org works: orgA=' + n1 + '→' + n2 + ', orgB=' + n3);
  } else fail('sequence mismatch', 'a1=' + n1 + ' a2=' + n2 + ' b=' + n3);

  logStep('Test 10: Advisory lock RPC — try + release');
  const { data: l1 } = await admin.rpc('try_advisory_lock', { p_key: 9999999 });
  const { data: l2 } = await admin.rpc('try_advisory_lock', { p_key: 9999999 });
  const { data: u1 } = await admin.rpc('release_advisory_lock', { p_key: 9999999 });
  info('Lock acquire a=' + l1 + ' b=' + l2 + ' release=' + u1);
  if (l1 === true) ok('advisory lock acquired + released');
  else fail('advisory lock first try should be true, got ' + l1);

  logStep('Test 11: is_sms_opted_out RPC');
  const { data: optedA } = await admin.rpc('is_sms_opted_out', { p_org: orgA.data.id, p_phone: testPhone });
  const { data: optedB } = await admin.rpc('is_sms_opted_out', { p_org: orgB.data.id, p_phone: testPhone });
  if (optedA === true && optedB === false) ok('opt-out scoped per-org correctly');
  else fail('opt-out check wrong', 'a=' + optedA + ' b=' + optedB);

  logStep('Test 12: normalize_phone RPC');
  const { data: norm1 } = await admin.rpc('normalize_phone', { p_phone: '(555) 555-0100' });
  const { data: norm2 } = await admin.rpc('normalize_phone', { p_phone: '15555550100' });
  const { data: norm3 } = await admin.rpc('normalize_phone', { p_phone: null });
  if (norm1 === '+15555550100' && norm2 === '+15555550100' && norm3 === null) {
    ok('phone normalization works');
  } else fail('normalization wrong', JSON.stringify({ norm1, norm2, norm3 }));
}

main()
  .catch((err) => { console.error('\nFATAL:', err); })
  .finally(async () => {
    console.log('\n━━━ Cleanup ━━━');
    for (const fn of cleanup.reverse()) {
      try { await fn(); } catch (e) { console.log('  · cleanup failed:', e?.message); }
    }
    console.log('  ✓ cleanup done');
    process.exit(0);
  });
