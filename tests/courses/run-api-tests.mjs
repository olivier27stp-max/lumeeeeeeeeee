/**
 * End-to-end API tests for Courses + Platform Admin
 * Run with: node tests/courses/run-api-tests.mjs
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://bbzcuzqfgsdvjsymfwmr.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJiemN1enFmZ3NkdmpzeW1md21yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEzNDcwODEsImV4cCI6MjA4NjkyMzA4MX0.MgCfwDCipQ4pFiJ0KmC0nwuCgXJHEv_1glBHC50tGeA';
const SVC_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJiemN1enFmZ3NkdmpzeW1md21yIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTM0NzA4MSwiZXhwIjoyMDg2OTIzMDgxfQ.s91KDFG3iz7q-WoaNYkyRHs6Y8YmC6F-o13qFcFvOec';
const API = 'http://localhost:3002/api';

let passed = 0;
let failed = 0;

async function run() {
  const svc = createClient(SUPABASE_URL, SVC_KEY);

  // Get a user to test with
  const { data: users } = await svc.auth.admin.listUsers({ perPage: 1 });
  if (!users?.users?.length) { console.log('ERROR: No users found'); return; }
  const user = users.users[0];
  console.log(`Test user: ${user.email} (${user.id})`);

  // Get their membership
  const { data: mem } = await svc.from('memberships').select('org_id, role').eq('user_id', user.id).limit(1).maybeSingle();
  console.log(`Membership: org=${mem?.org_id}, role=${mem?.role}`);

  // Generate a session
  const { data: session, error: sessErr } = await svc.auth.admin.generateLink({ type: 'magiclink', email: user.email });
  if (sessErr) { console.log('Session error:', sessErr.message); return; }

  const client = createClient(SUPABASE_URL, ANON_KEY);
  const tokenHash = new URL(session.properties.action_link).searchParams.get('token');
  const { data: verified, error: verErr } = await client.auth.verifyOtp({ token_hash: tokenHash, type: 'magiclink' });
  if (verErr) { console.log('Verify error:', verErr.message); return; }

  const accessToken = verified.session?.access_token;
  if (!accessToken) { console.log('ERROR: No access token'); return; }
  console.log('Auth OK');
  console.log('========================================');

  const headers = { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' };

  async function test(name, url, opts = {}) {
    try {
      const res = await fetch(url, { headers, ...opts });
      const body = await res.json();
      const status = res.status;
      if (res.ok) {
        const summary = Array.isArray(body) ? `${body.length} items` : JSON.stringify(body).substring(0, 120);
        console.log(`  PASS [${status}] ${name} → ${summary}`);
        passed++;
      } else {
        console.log(`  FAIL [${status}] ${name} → ${body.error || JSON.stringify(body)}`);
        failed++;
      }
      return { ok: res.ok, body, status };
    } catch (e) {
      console.log(`  FAIL [ERR] ${name} → ${e.message}`);
      failed++;
      return { ok: false, body: null, status: 0 };
    }
  }

  // ═══ COURSES ═══
  console.log('\n── COURSES LIST & META ──');
  await test('GET /courses', `${API}/courses`);
  await test('GET /courses/my-role', `${API}/courses/my-role`);
  await test('GET /courses/org-members', `${API}/courses/org-members`);
  await test('GET /courses/progress/summary', `${API}/courses/progress/summary`);

  console.log('\n── COURSE CRUD ──');
  const created = await test('POST /courses (create)', `${API}/courses`, {
    method: 'POST',
    body: JSON.stringify({ title: '__api_test_course__', description: 'Automated test' })
  });

  if (!created.ok) {
    console.log('\n  Cannot continue without a course. Aborting.');
    printSummary();
    return;
  }

  const courseId = created.body.id;
  await test('GET /courses/:id', `${API}/courses/${courseId}`);
  await test('PATCH /courses/:id', `${API}/courses/${courseId}`, {
    method: 'PATCH',
    body: JSON.stringify({ title: '__api_test_updated__', status: 'published' })
  });

  console.log('\n── MODULE CRUD ──');
  const mod = await test('POST module', `${API}/courses/${courseId}/modules`, {
    method: 'POST', body: JSON.stringify({ title: 'Test Module' })
  });

  if (mod.ok) {
    const moduleId = mod.body.id;
    await test('PATCH module', `${API}/courses/modules/${moduleId}`, {
      method: 'PATCH', body: JSON.stringify({ title: 'Updated Module' })
    });

    console.log('\n── LESSON CRUD ──');
    const lesson = await test('POST lesson', `${API}/courses/modules/${moduleId}/lessons`, {
      method: 'POST', body: JSON.stringify({ title: 'Test Lesson', content_type: 'text' })
    });

    if (lesson.ok) {
      const lessonId = lesson.body.id;
      await test('PATCH lesson', `${API}/courses/lessons/${lessonId}`, {
        method: 'PATCH', body: JSON.stringify({ title: 'Updated Lesson', text_content: '<p>Hello</p>' })
      });

      const dup = await test('POST lesson/duplicate', `${API}/courses/lessons/${lessonId}/duplicate`, { method: 'POST' });
      if (dup.ok) {
        await test('PUT lessons/reorder', `${API}/courses/modules/${moduleId}/lessons/reorder`, {
          method: 'PUT', body: JSON.stringify({ order: [dup.body.id, lessonId] })
        });
        await test('DELETE dup lesson', `${API}/courses/lessons/${dup.body.id}`, { method: 'DELETE' });
      }

      console.log('\n── PROGRESS ──');
      await test('POST progress (complete)', `${API}/courses/progress`, {
        method: 'POST', body: JSON.stringify({ course_id: courseId, lesson_id: lessonId, completed: true })
      });
      await test('GET progress', `${API}/courses/${courseId}/progress`);
      await test('POST progress (uncomplete)', `${API}/courses/progress`, {
        method: 'POST', body: JSON.stringify({ course_id: courseId, lesson_id: lessonId, completed: false })
      });

      await test('DELETE lesson', `${API}/courses/lessons/${lessonId}`, { method: 'DELETE' });
    }

    await test('DELETE module', `${API}/courses/modules/${mod.body.id}`, { method: 'DELETE' });
  }

  console.log('\n── DUPLICATE & TEAM ──');
  const dupCourse = await test('POST course/duplicate', `${API}/courses/${courseId}/duplicate`, { method: 'POST' });
  await test('GET team-progress', `${API}/courses/${courseId}/team-progress`);

  console.log('\n── CLEANUP ──');
  if (dupCourse.ok) await test('DELETE dup course', `${API}/courses/${dupCourse.body.id}`, { method: 'DELETE' });
  await test('DELETE course', `${API}/courses/${courseId}`, { method: 'DELETE' });

  // ═══ PLATFORM ADMIN ═══
  console.log('\n── PLATFORM ADMIN ──');
  await test('GET /platform-admin/business', `${API.replace('/api', '')}/api/platform-admin/business`);
  await test('GET /platform-admin/revenue-series', `${API.replace('/api', '')}/api/platform-admin/revenue-series?days=30`);
  await test('GET /platform-admin/growth-series', `${API.replace('/api', '')}/api/platform-admin/growth-series`);

  printSummary();
}

function printSummary() {
  console.log('\n========================================');
  console.log(`RESULTS: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  if (failed === 0) console.log('ALL TESTS PASSED');
  else console.log(`${failed} TESTS FAILED`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
