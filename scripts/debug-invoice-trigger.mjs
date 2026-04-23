import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
config({ path: '.env.local' });

const admin = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// Does the trigger exist?
const { data: triggers, error } = await admin.rpc('try_advisory_lock', { p_key: 999 });

// We need a raw SQL query... use the apply-sql helper path
// Easier: try to query information_schema via REST proxy
const sql = `select tgname, tgtype, proname
  from pg_trigger t
  join pg_proc p on t.tgfoid = p.oid
  where tgrelid = 'public.invoices'::regclass
    and not tgisinternal
  order by tgname;`;

// Admin has no direct sql access via REST; use pg REST RPC if one exists
// Alternative: look at what UPDATE actually does by watching columns
const uid = 'test-' + Date.now();
const { data: org } = await admin.from('orgs').insert({ name: uid }).select('id').single();
const { data: user } = await admin.auth.admin.createUser({
  email: uid + '@t.l', password: 'Abcd1234!@x', email_confirm: true,
});

// Need a client first
const { data: cl } = await admin.from('clients').insert({
  org_id: org.id, first_name: 'T', last_name: 'T', created_by: user.user.id, status: 'active',
}).select('id').single();

const { data: inv, error: invErr } = await admin.from('invoices').insert({
  org_id: org.id, client_id: cl.id, status: 'draft', total_cents: 10000, balance_cents: 10000,
  paid_cents: 0, currency: 'CAD', invoice_number: 'TR-' + Date.now(),
  created_by: user.user.id,
}).select('id, status, total_cents, balance_cents').single();
console.log('invoice created:', invErr?.message || JSON.stringify(inv));

// Mark paid
const markPaid = await admin.from('invoices').update({
  status: 'paid', paid_cents: 10000, balance_cents: 0,
}).eq('id', inv.id).select().single();
console.log('after mark-paid:', markPaid.error?.message || `status=${markPaid.data.status} total=${markPaid.data.total_cents} balance=${markPaid.data.balance_cents}`);

// Now try to mutate total (trigger should block)
const mutate = await admin.from('invoices').update({
  total_cents: 99999,
}).eq('id', inv.id).select().single();
console.log('after mutate paid invoice:');
console.log('  error:', mutate.error?.message);
console.log('  errcode:', mutate.error?.code);
console.log('  data:', JSON.stringify(mutate.data));

// ALSO try via a user JWT — service_role might bypass trigger?
// Check pg_trigger tgenabled for service_role bypass
// Note: BEFORE UPDATE triggers FIRE for ALL roles including service_role.
// If they fire but don't raise, something else is wrong.

// Let's check what happens when we force trigger-firing column-level change
console.log('\nNow test with minimal changes to only total_cents:');
const mutate2 = await admin.from('invoices').update({
  total_cents: 88888,
}).eq('id', inv.id).select('id, total_cents').single();
console.log('mutate2:', JSON.stringify(mutate2.data || mutate2.error));

// Cleanup
await admin.from('invoices').delete().eq('id', inv.id);
await admin.from('clients').delete().eq('id', cl.id);
await admin.from('orgs').delete().eq('id', org.id);
await admin.auth.admin.deleteUser(user.user.id);
console.log('\ncleanup done');
