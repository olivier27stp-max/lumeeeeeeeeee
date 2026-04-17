/**
 * Multi-tenant isolation test
 * Tests that data from Org A is NOT visible to Org B users
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://bbzcuzqfgsdvjsymfwmr.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJiemN1enFmZ3NkdmpzeW1md21yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEzNDcwODEsImV4cCI6MjA4NjkyMzA4MX0.MgCfwDCipQ4pFiJ0KmC0nwuCgXJHEv_1glBHC50tGeA';
const SVC_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJiemN1enFmZ3NkdmpzeW1md21yIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTM0NzA4MSwiZXhwIjoyMDg2OTIzMDgxfQ.s91KDFG3iz7q-WoaNYkyRHs6Y8YmC6F-o13qFcFvOec';
const API = 'http://localhost:3002/api';

const SVC = createClient(SUPABASE_URL, SVC_KEY);

let passed = 0;
let failed = 0;

function check(name, condition) {
  if (condition) { console.log(`  PASS ${name}`); passed++; }
  else { console.log(`  FAIL ${name}`); failed++; }
}

async function getToken(email) {
  const { data: link } = await SVC.auth.admin.generateLink({ type: 'magiclink', email });
  const hash = new URL(link.properties.action_link).searchParams.get('token');
  const client = createClient(SUPABASE_URL, ANON_KEY);
  const { data } = await client.auth.verifyOtp({ token_hash: hash, type: 'magiclink' });
  return data.session.access_token;
}

async function apiFetch(token, url, opts = {}) {
  const h = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const res = await fetch(url, { headers: h, ...opts });
  return { status: res.status, ok: res.ok, body: await res.json() };
}

async function run() {
  // ── Setup: identify users in different orgs ──
  const { data: mems } = await SVC.from('memberships').select('user_id, org_id, role');

  // User in org A only (1d933f27 = admin in 4d885f6c)
  const orgA = '4d885f6c-e076-4ed9-ab09-23637dbee6cd';
  const orgB = 'e0cf4b92-c229-4785-a2e7-7081fae3e18e';

  // Find a user ONLY in org A
  const userAOnly = mems.find(m => m.org_id === orgA && !mems.some(m2 => m2.user_id === m.user_id && m2.org_id === orgB));

  if (!userAOnly) {
    console.log('No user exclusive to org A. Creating one...');
    // Use existing admin user dev@lumecrm.test which is only in orgA
  }

  // Get user emails
  const { data: userA } = await SVC.auth.admin.getUserById('1d933f27-d02b-43ef-b6db-b8a2b9985463');
  // Find user only in org B
  const userBOnly = mems.find(m => m.org_id === orgB && !mems.some(m2 => m2.user_id === m.user_id && m2.org_id === orgA));

  // Always create a dedicated test user for org B to ensure isolation
  const testEmail = `isolation-test-${Date.now()}@lumecrm.test`;
  const { data: newUser, error: ue } = await SVC.auth.admin.createUser({
    email: testEmail,
    password: 'TestIsolation123!',
    email_confirm: true,
  });
  if (ue) { console.log('Cannot create test user:', ue.message); process.exit(1); }
  await SVC.from('memberships').insert({ user_id: newUser.user.id, org_id: orgB, role: 'owner' });
  console.log(`Created isolated user: ${testEmail} in org B`);
  var userBEmail = testEmail;
  var userBId = newUser.user.id;
  var cleanupUserB = true;

  console.log(`\nOrg A: ${orgA}`);
  console.log(`Org B: ${orgB}`);
  console.log(`User A (admin, org A only): ${userA.user.email}`);
  console.log(`User B (owner, org B only): ${userBEmail}`);
  console.log('========================================\n');

  // Get tokens
  const tokenA = await getToken(userA.user.email);
  const tokenB = await getToken(userBEmail);

  // ═══ TEST 1: User A creates a course in Org A ═══
  console.log('── TEST: Course isolation ──');
  const createRes = await apiFetch(tokenA, `${API}/courses`, {
    method: 'POST', body: JSON.stringify({ title: '__isolation_test_orgA__' })
  });
  check('User A can create course in Org A', createRes.ok);
  const courseAId = createRes.body?.id;

  if (courseAId) {
    // ═══ TEST 2: User B should NOT see Org A's course ═══
    const listB = await apiFetch(tokenB, `${API}/courses`);
    check('User B list returns OK', listB.ok);
    const seesOrgACourse = (listB.body || []).some(c => c.id === courseAId);
    check('User B does NOT see Org A course', !seesOrgACourse);

    // ═══ TEST 3: User B cannot GET Org A's course directly ═══
    const getB = await apiFetch(tokenB, `${API}/courses/${courseAId}`);
    check('User B cannot GET Org A course (403 or 404)', !getB.ok);

    // ═══ TEST 4: User B cannot UPDATE Org A's course ═══
    const patchB = await apiFetch(tokenB, `${API}/courses/${courseAId}`, {
      method: 'PATCH', body: JSON.stringify({ title: 'HACKED' })
    });
    check('User B cannot PATCH Org A course', !patchB.ok);

    // ═══ TEST 5: User B cannot DELETE Org A's course ═══
    const delB = await apiFetch(tokenB, `${API}/courses/${courseAId}`, { method: 'DELETE' });
    check('User B cannot DELETE Org A course', !delB.ok);

    // ═══ TEST 6: User B cannot add module to Org A's course ═══
    const modB = await apiFetch(tokenB, `${API}/courses/${courseAId}/modules`, {
      method: 'POST', body: JSON.stringify({ title: 'HACKED MODULE' })
    });
    check('User B cannot add module to Org A course', !modB.ok);

    // Verify course wasn't tampered with
    const verifyA = await apiFetch(tokenA, `${API}/courses/${courseAId}`);
    check('Course title unchanged (not hacked)', verifyA.body?.title === '__isolation_test_orgA__');

    // Cleanup
    await apiFetch(tokenA, `${API}/courses/${courseAId}`, { method: 'DELETE' });
  }

  // ═══ TEST 7: User B creates in Org B, User A can't see ═══
  console.log('\n── TEST: Reverse isolation ──');
  const createB = await apiFetch(tokenB, `${API}/courses`, {
    method: 'POST', body: JSON.stringify({ title: '__isolation_test_orgB__' })
  });
  check('User B can create course in Org B', createB.ok);

  if (createB.ok) {
    const courseBId = createB.body.id;
    const listA = await apiFetch(tokenA, `${API}/courses`);
    const seesOrgBCourse = (listA.body || []).some(c => c.id === courseBId);
    check('User A does NOT see Org B course', !seesOrgBCourse);

    const getA = await apiFetch(tokenA, `${API}/courses/${courseBId}`);
    check('User A cannot GET Org B course', !getA.ok);

    // Cleanup
    await apiFetch(tokenB, `${API}/courses/${courseBId}`, { method: 'DELETE' });
  }

  // ═══ TEST 8: Org members endpoint isolation ═══
  console.log('\n── TEST: Org members isolation ──');
  const membersA = await apiFetch(tokenA, `${API}/courses/org-members`);
  const membersB = await apiFetch(tokenB, `${API}/courses/org-members`);
  check('Org A members list OK', membersA.ok);
  check('Org B members list OK', membersB.ok);
  if (membersA.ok && membersB.ok) {
    const aIds = new Set((membersA.body || []).map(m => m.user_id));
    const bIds = new Set((membersB.body || []).map(m => m.user_id));
    check('User B not in Org A members', !aIds.has(userBId));
    check('User A not in Org B members', !bIds.has('1d933f27-d02b-43ef-b6db-b8a2b9985463'));
  }

  // ═══ TEST 9: Role check isolation ═══
  console.log('\n── TEST: Role isolation ──');
  const roleA = await apiFetch(tokenA, `${API}/courses/my-role`);
  const roleB = await apiFetch(tokenB, `${API}/courses/my-role`);
  check('User A role is admin', roleA.body?.role === 'admin');
  check('User B role is owner', roleB.body?.role === 'owner');

  // Cleanup test user if we created one
  if (cleanupUserB) {
    await SVC.from('memberships').delete().eq('user_id', userBId);
    await SVC.auth.admin.deleteUser(userBId);
    console.log('\nCleaned up test user B');
  }

  console.log('\n========================================');
  console.log(`RESULTS: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  if (failed === 0) console.log('ALL ISOLATION TESTS PASSED');
  else console.log(`${failed} ISOLATION TESTS FAILED`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
