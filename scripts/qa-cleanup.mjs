/**
 * QA CLEANUP — Remove all test data created by qa-seed.mjs
 * Identifies test data by [QA] prefix in names/titles.
 * Run: node scripts/qa-cleanup.mjs
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ORG_ID = process.env.QA_ORG_ID;
const token = process.env.SUPABASE_MANAGEMENT_TOKEN;
const projectRef = process.env.SUPABASE_PROJECT_REF;

if (!SUPABASE_URL || !SUPABASE_KEY || !ORG_ID || !token || !projectRef) {
  console.error(
    'Missing env vars. Required:\n' +
    '  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, QA_ORG_ID,\n' +
    '  SUPABASE_MANAGEMENT_TOKEN, SUPABASE_PROJECT_REF',
  );
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

async function runSQL(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  return { status: res.status, ok: res.status === 201 };
}

async function main() {
  console.log('═══ QA CLEANUP — Removing test data ═══\n');

  const steps = [
    { label: 'Specific notes', sql: `DELETE FROM specific_notes WHERE org_id = '${ORG_ID}' AND text LIKE '[QA]%';` },
    { label: 'Payments', sql: `DELETE FROM payments WHERE org_id = '${ORG_ID}' AND EXISTS (SELECT 1 FROM invoices i WHERE i.id = payments.invoice_id AND i.subject LIKE '[QA]%') OR (payments.org_id = '${ORG_ID}' AND payments.invoice_id IS NULL AND payments.provider = 'manual');` },
    { label: 'Invoice items (cascade)', sql: `DELETE FROM invoices WHERE org_id = '${ORG_ID}' AND subject LIKE '[QA]%';` },
    { label: 'Schedule events (cascade via jobs)', sql: `SELECT 1;` },
    { label: 'Job line items (cascade via jobs)', sql: `SELECT 1;` },
    { label: 'Jobs', sql: `DELETE FROM jobs WHERE org_id = '${ORG_ID}' AND title LIKE '[QA]%';` },
    { label: 'Quote sections (cascade)', sql: `SELECT 1;` },
    { label: 'Quote line items (cascade)', sql: `SELECT 1;` },
    { label: 'Quotes', sql: `DELETE FROM quotes WHERE org_id = '${ORG_ID}' AND title LIKE '[QA]%';` },
    { label: 'Leads', sql: `DELETE FROM leads WHERE org_id = '${ORG_ID}' AND first_name LIKE '[QA]%';` },
    { label: 'Clients', sql: `DELETE FROM clients WHERE org_id = '${ORG_ID}' AND first_name LIKE '[QA]%';` },
  ];

  for (const step of steps) {
    if (step.sql === 'SELECT 1;') { console.log(`  ${step.label}: handled by CASCADE`); continue; }
    const { ok, status } = await runSQL(step.sql);
    console.log(`  ${step.label}: ${ok ? 'OK' : 'FAILED (' + status + ')'}`);
  }

  console.log('\n═══ CLEANUP COMPLETE ═══');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
