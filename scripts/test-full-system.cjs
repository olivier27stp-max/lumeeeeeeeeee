/**
 * Full System Integration Test
 * Tests: DB schema, quotes, pipeline, automations, workflow bridge
 */

const SB_TOKEN = 'sbp_7399ae07779c3e9783915aadabbd946caca53788';
const PROJECT = 'bbzcuzqfgsdvjsymfwmr';
const SUPABASE_URL = 'https://bbzcuzqfgsdvjsymfwmr.supabase.co';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJiemN1enFmZ3NkdmpzeW1md21yIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTM0NzA4MSwiZXhwIjoyMDg2OTIzMDgxfQ.s91KDFG3iz7q-WoaNYkyRHs6Y8YmC6F-o13qFcFvOec';
const API_URL = `https://api.supabase.com/v1/projects/${PROJECT}/database/query`;

let passed = 0;
let failed = 0;
const failures = [];

function ok(label) { passed++; console.log(`  \x1b[32m✓\x1b[0m ${label}`); }
function fail(label, reason) { failed++; failures.push({ label, reason }); console.log(`  \x1b[31m✗\x1b[0m ${label}: ${reason}`); }

async function sql(query) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${SB_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (res.status >= 400) throw new Error(`SQL failed: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

async function supaRest(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': options.prefer || 'return=representation',
      ...options.headers,
    },
    method: options.method || 'GET',
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await res.text();
  try { return { status: res.status, data: JSON.parse(text) }; }
  catch { return { status: res.status, data: text }; }
}

async function run() {
  console.log('\n\x1b[1m═══ LUME CRM — FULL SYSTEM TEST ═══\x1b[0m\n');

  // ════════════════════════════════════════
  // TEST 1: DB Schema Integrity
  // ════════════════════════════════════════
  console.log('\x1b[1m[1] DB Schema\x1b[0m');

  const tables = ['quotes', 'quote_line_items', 'quote_sections', 'quote_send_log',
    'quote_status_history', 'quote_attachments', 'quote_sequences',
    'jobs', 'schedule_events', 'leads', 'clients', 'pipeline_deals',
    'team_members', 'automation_rules', 'activity_log'];

  for (const table of tables) {
    try {
      const result = await sql(`SELECT count(*) as c FROM information_schema.tables WHERE table_name='${table}' AND table_schema='public'`);
      result[0].c > 0 ? ok(`Table ${table} exists`) : fail(`Table ${table}`, 'NOT FOUND');
    } catch (e) { fail(`Table ${table}`, e.message); }
  }

  // Check RPCs
  const rpcs = ['rpc_create_quote', 'rpc_recalculate_quote', 'rpc_create_job_with_optional_schedule',
    'rpc_schedule_job', 'rpc_unschedule_job', 'set_deal_stage'];
  for (const rpc of rpcs) {
    try {
      const result = await sql(`SELECT count(*) as c FROM information_schema.routines WHERE routine_name='${rpc}' AND routine_schema='public'`);
      result[0].c > 0 ? ok(`RPC ${rpc} exists`) : fail(`RPC ${rpc}`, 'NOT FOUND');
    } catch (e) { fail(`RPC ${rpc}`, e.message); }
  }

  // Check constraints
  try {
    const result = await sql(`SELECT conname FROM pg_constraint WHERE conname='jobs_status_check'`);
    result.length > 0 ? ok('jobs_status_check constraint exists') : fail('jobs_status_check', 'NOT FOUND');
  } catch (e) { fail('jobs_status_check', e.message); }

  try {
    const result = await sql(`SELECT conname FROM pg_constraint WHERE conname='leads_status_check'`);
    result.length > 0 ? ok('leads_status_check constraint exists') : fail('leads_status_check', 'NOT FOUND');
  } catch (e) { fail('leads_status_check', e.message); }

  try {
    const result = await sql(`SELECT conname FROM pg_constraint WHERE conname='pipeline_deals_stage_check'`);
    result.length > 0 ? ok('pipeline_deals_stage_check constraint exists') : fail('pipeline_deals_stage_check', 'NOT FOUND');
  } catch (e) { fail('pipeline_deals_stage_check', e.message); }

  // Check team_members.team_id FK
  try {
    const result = await sql(`SELECT column_name FROM information_schema.columns WHERE table_name='team_members' AND column_name='team_id'`);
    result.length > 0 ? ok('team_members.team_id column exists') : fail('team_members.team_id', 'NOT FOUND');
  } catch (e) { fail('team_members.team_id', e.message); }

  // Check jobs.address + start_at
  try {
    const result = await sql(`SELECT column_name FROM information_schema.columns WHERE table_name='jobs' AND column_name IN ('address', 'start_at') ORDER BY column_name`);
    result.length === 2 ? ok('jobs.address + jobs.start_at columns exist') : fail('jobs columns', `Found ${result.length}/2`);
  } catch (e) { fail('jobs columns', e.message); }

  // Check address sync trigger
  try {
    const result = await sql(`SELECT trigger_name FROM information_schema.triggers WHERE trigger_name='trg_jobs_sync_address'`);
    result.length > 0 ? ok('jobs address sync trigger exists') : fail('address sync trigger', 'NOT FOUND');
  } catch (e) { fail('address sync trigger', e.message); }

  // ════════════════════════════════════════
  // TEST 2: Data Integrity — Status Values
  // ════════════════════════════════════════
  console.log('\n\x1b[1m[2] Data Integrity\x1b[0m');

  try {
    const result = await sql(`SELECT DISTINCT status FROM public.jobs ORDER BY status`);
    const statuses = result.map(r => r.status);
    const valid = ['draft', 'scheduled', 'in_progress', 'completed', 'cancelled'];
    const invalid = statuses.filter(s => !valid.includes(s));
    invalid.length === 0
      ? ok(`Job statuses clean: [${statuses.join(', ')}]`)
      : fail('Job statuses', `Invalid: [${invalid.join(', ')}]`);
  } catch (e) { fail('Job statuses', e.message); }

  try {
    const result = await sql(`SELECT DISTINCT status FROM public.leads ORDER BY status`);
    const statuses = result.map(r => r.status);
    const valid = ['new', 'follow_up_1', 'follow_up_2', 'follow_up_3', 'closed', 'lost'];
    const invalid = statuses.filter(s => !valid.includes(s));
    invalid.length === 0
      ? ok(`Lead statuses clean: [${statuses.join(', ')}]`)
      : fail('Lead statuses', `Invalid: [${invalid.join(', ')}]`);
  } catch (e) { fail('Lead statuses', e.message); }

  try {
    const result = await sql(`SELECT DISTINCT stage FROM public.pipeline_deals ORDER BY stage`);
    const stages = result.map(r => r.stage);
    const valid = ['new', 'follow_up_1', 'follow_up_2', 'follow_up_3', 'closed', 'lost'];
    const invalid = stages.filter(s => !valid.includes(s));
    invalid.length === 0
      ? ok(`Pipeline stages clean: [${stages.join(', ')}]`)
      : fail('Pipeline stages', `Invalid: [${invalid.join(', ')}]`);
  } catch (e) { fail('Pipeline stages', e.message); }

  // ════════════════════════════════════════
  // TEST 3: Quote CRUD via Supabase REST
  // ════════════════════════════════════════
  console.log('\n\x1b[1m[3] Quote CRUD\x1b[0m');

  // Get an org_id to use
  let testOrgId;
  try {
    const result = await sql(`SELECT DISTINCT org_id FROM public.jobs LIMIT 1`);
    testOrgId = result[0]?.org_id;
    testOrgId ? ok(`Test org: ${testOrgId.slice(0, 8)}...`) : fail('No org found', 'Empty jobs table');
  } catch (e) { fail('Get org', e.message); }

  let testQuoteId;
  if (testOrgId) {
    // Create quote via SQL (bypasses RLS for test)
    try {
      const result = await sql(`
        INSERT INTO public.quotes (org_id, quote_number, title, status, context_type, created_by, currency)
        VALUES ('${testOrgId}', 'TEST-001', 'Integration Test Quote', 'action_required', 'lead',
                '${testOrgId}', 'CAD')
        RETURNING id
      `);
      if (result?.[0]?.id) {
        testQuoteId = result[0].id;
        ok(`Quote created: ${testQuoteId.slice(0, 8)}...`);
      } else {
        fail('Create quote', 'No id returned');
      }
    } catch (e) { fail('Create quote', e.message); }

    // Add line items (via SQL to bypass RLS — service_role REST can't match auth.uid() for test quotes)
    if (testQuoteId) {
      try {
        await sql(`INSERT INTO public.quote_line_items (quote_id, name, quantity, unit_price_cents, sort_order, item_type)
          VALUES ('${testQuoteId}', 'Test Service A', 2, 5000, 0, 'service'),
                 ('${testQuoteId}', 'Test Service B', 1, 3000, 1, 'service')`);
        await sql(`UPDATE public.quote_line_items SET is_optional = true WHERE quote_id = '${testQuoteId}' AND name = 'Test Service B'`);
        ok('Quote line items created (2 items, 1 optional)');
      } catch (e) { fail('Line items', e.message); }

      // Verify line total trigger fired
      try {
        const items = await sql(`SELECT name, total_cents FROM public.quote_line_items WHERE quote_id = '${testQuoteId}' ORDER BY sort_order`);
        const item1 = items.find(i => i.name === 'Test Service A');
        item1?.total_cents === 10000
          ? ok(`Line total trigger: 2 x 5000 = ${item1.total_cents} cents`)
          : fail('Line total trigger', `Expected 10000, got ${item1?.total_cents}`);
      } catch (e) { fail('Line total verify', e.message); }

      // Recalculate totals via RPC
      try {
        await sql(`SELECT public.rpc_recalculate_quote('${testQuoteId}')`);
        ok('rpc_recalculate_quote executed');

        const verifyData = await sql(`SELECT subtotal_cents, tax_cents, total_cents FROM public.quotes WHERE id = '${testQuoteId}'`);
        if (verifyData?.[0]) {
          const q = verifyData[0];
          q.subtotal_cents === 10000
            ? ok(`Subtotal correct: ${q.subtotal_cents} cents (excludes optional)`)
            : fail('Subtotal', `Expected 10000, got ${q.subtotal_cents}`);
          q.tax_cents === 1498
            ? ok(`Tax correct: ${q.tax_cents} cents (14.975%)`)
            : fail('Tax', `Expected 1498, got ${q.tax_cents}`);
          q.total_cents === 11498
            ? ok(`Total correct: ${q.total_cents} cents`)
            : fail('Total', `Expected 11498, got ${q.total_cents}`);
        }
      } catch (e) { fail('Recalculate', e.message); }

      // Add sections
      try {
        await sql(`INSERT INTO public.quote_sections (quote_id, section_type, title, content, sort_order, enabled)
          VALUES ('${testQuoteId}', 'introduction', 'Intro', 'Test intro', 0, true),
                 ('${testQuoteId}', 'contract_disclaimer', 'Disclaimer', 'Test disclaimer', 1, true)`);
        ok('Quote sections created');
      } catch (e) { fail('Sections', e.message); }

      // Status history
      try {
        await sql(`INSERT INTO public.quote_status_history (quote_id, old_status, new_status) VALUES ('${testQuoteId}', null, 'action_required')`);
        ok('Status history logged');
      } catch (e) { fail('Status history', e.message); }

      // Update status
      try {
        await sql(`UPDATE public.quotes SET status = 'sent', sent_via_email_at = now(), last_sent_channel = 'email' WHERE id = '${testQuoteId}'`);
        ok('Quote status updated to sent');
      } catch (e) { fail('Status update', e.message); }

      // Send log
      try {
        await sql(`INSERT INTO public.quote_send_log (quote_id, channel, recipient, delivery_status) VALUES ('${testQuoteId}', 'email', 'test@example.com', 'sent')`);
        ok('Send log created');
      } catch (e) { fail('Send log', e.message); }
    }
  }

  // ════════════════════════════════════════
  // TEST 4: Jobs → Schedule Events Flow
  // ════════════════════════════════════════
  console.log('\n\x1b[1m[4] Jobs → Schedule Events\x1b[0m');

  try {
    const result = await sql(`
      SELECT j.id, j.status, j.scheduled_at, se.id as event_id, se.start_at
      FROM public.jobs j
      LEFT JOIN public.schedule_events se ON se.job_id = j.id AND se.deleted_at IS NULL
      WHERE j.deleted_at IS NULL AND j.status = 'scheduled'
      LIMIT 5
    `);
    if (result.length > 0) {
      const withEvent = result.filter(r => r.event_id);
      const withoutEvent = result.filter(r => !r.event_id);
      ok(`Scheduled jobs: ${result.length} total, ${withEvent.length} with events, ${withoutEvent.length} without`);
      if (withoutEvent.length > 0) {
        fail('Orphan scheduled jobs', `${withoutEvent.length} scheduled jobs have NO schedule_event`);
      }
    } else {
      ok('No scheduled jobs to test (empty)');
    }
  } catch (e) { fail('Jobs→Schedule', e.message); }

  // Check v_schedule_calendar view works
  try {
    const result = await sql(`SELECT count(*) as c FROM information_schema.views WHERE table_name='v_schedule_calendar' AND table_schema='public'`);
    result[0].c > 0 ? ok('v_schedule_calendar view exists') : fail('v_schedule_calendar', 'NOT FOUND');
  } catch (e) { fail('v_schedule_calendar', e.message); }

  // ════════════════════════════════════════
  // TEST 5: Pipeline Deal Constraints
  // ════════════════════════════════════════
  console.log('\n\x1b[1m[5] Pipeline Constraints\x1b[0m');

  // Try inserting invalid stage — should fail
  if (testOrgId) {
    try {
      const res = await supaRest('pipeline_deals', {
        method: 'POST',
        body: {
          org_id: testOrgId,
          created_by: '00000000-0000-0000-0000-000000000000',
          stage: 'INVALID_STAGE',
          title: 'Test invalid stage',
          value: 0,
          job_id: null,
        },
      });
      res.status >= 400
        ? ok('Invalid stage rejected by constraint')
        : fail('Stage constraint', 'Should have rejected INVALID_STAGE');
    } catch (e) { ok('Invalid stage rejected (exception)'); }

    // Try invalid job status
    try {
      const res = await supaRest('jobs', {
        method: 'POST',
        body: {
          org_id: testOrgId,
          title: 'Test invalid status',
          status: 'BOGUS',
          created_by: '00000000-0000-0000-0000-000000000000',
        },
      });
      res.status >= 400
        ? ok('Invalid job status rejected by constraint')
        : fail('Job status constraint', 'Should have rejected BOGUS');
    } catch (e) { ok('Invalid job status rejected (exception)'); }
  }

  // ════════════════════════════════════════
  // TEST 6: Automation Presets
  // ════════════════════════════════════════
  console.log('\n\x1b[1m[6] Automation System\x1b[0m');

  try {
    const result = await sql(`SELECT count(*) as c FROM public.automation_rules`);
    ok(`Automation rules in DB: ${result[0].c}`);
  } catch (e) { fail('Automation rules', e.message); }

  try {
    const result = await sql(`SELECT count(*) as c FROM public.activity_log`);
    ok(`Activity log entries: ${result[0].c}`);
  } catch (e) { fail('Activity log', e.message); }

  // ════════════════════════════════════════
  // TEST 7: Cleanup test data
  // ════════════════════════════════════════
  console.log('\n\x1b[1m[7] Cleanup\x1b[0m');

  if (testQuoteId) {
    try {
      await sql(`DELETE FROM public.quote_send_log WHERE quote_id = '${testQuoteId}'`);
      await sql(`DELETE FROM public.quote_status_history WHERE quote_id = '${testQuoteId}'`);
      await sql(`DELETE FROM public.quote_sections WHERE quote_id = '${testQuoteId}'`);
      await sql(`DELETE FROM public.quote_line_items WHERE quote_id = '${testQuoteId}'`);
      await sql(`DELETE FROM public.quotes WHERE id = '${testQuoteId}'`);
      ok('Test quote data cleaned up');
    } catch (e) { fail('Cleanup', e.message); }
  }

  // ════════════════════════════════════════
  // RESULTS
  // ════════════════════════════════════════
  console.log('\n\x1b[1m═══ RESULTS ═══\x1b[0m');
  console.log(`  \x1b[32m${passed} passed\x1b[0m`);
  if (failed > 0) {
    console.log(`  \x1b[31m${failed} failed\x1b[0m`);
    console.log('\n  Failures:');
    for (const f of failures) {
      console.log(`    \x1b[31m✗\x1b[0m ${f.label}: ${f.reason}`);
    }
  }
  console.log('');

  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
