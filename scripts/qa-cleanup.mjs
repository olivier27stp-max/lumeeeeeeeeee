/**
 * QA CLEANUP — Remove all test data created by qa-seed.mjs
 * Identifies test data by [QA] prefix in names/titles.
 * Run: node scripts/qa-cleanup.mjs
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://bbzcuzqfgsdvjsymfwmr.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJiemN1enFmZ3NkdmpzeW1md21yIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTM0NzA4MSwiZXhwIjoyMDg2OTIzMDgxfQ.s91KDFG3iz7q-WoaNYkyRHs6Y8YmC6F-o13qFcFvOec';

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
const ORG_ID = '4d885f6c-e076-4ed9-ab09-23637dbee6cd';
const token = 'sbp_70d8ff687c60f2afeb73c8c6d4f59725d3cda70e';
const projectRef = 'bbzcuzqfgsdvjsymfwmr';

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
