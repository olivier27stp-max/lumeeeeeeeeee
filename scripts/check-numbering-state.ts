/**
 * check-numbering-state.ts — vérifie (lecture seule) que le lot de migrations
 * de numérotation appliqué par Olivier est bien en place en prod.
 */
import { config } from 'dotenv';
import { existsSync } from 'fs';
config({ path: '.env.local' });
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  const alt = `${process.env.HOME}/Downloads/lume-crm/.env.local`;
  if (existsSync(alt)) config({ path: alt });
}

import { createClient } from '@supabase/supabase-js';

const admin = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

function verdict(label: string, error: { code?: string; message?: string } | null) {
  const missing = error && (
    error.code === 'PGRST202' || error.code === '42883' || error.code === '42P01' ||
    error.code === '42703' || /not exist|not found|schema cache/i.test(error.message || '')
  );
  console.log(`${label}: ${missing ? 'ABSENT' : 'ok'}${error && !missing ? ` (err runtime attendue: ${error.message})` : ''}`);
}

(async () => {
  const a = await admin.from('company_settings').select('invoice_prefix').limit(3);
  verdict('colonne invoice_prefix', a.error);
  if (!a.error) console.log('  valeurs prefix:', JSON.stringify((a.data || []).map(r => r.invoice_prefix)));

  const b = await admin.from('org_job_counters').select('org_id').limit(1);
  verdict('table org_job_counters', b.error);

  const c = await admin.from('clients').select('client_number').not('client_number', 'is', null).limit(3);
  verdict('colonne clients.client_number', c.error);
  if (!c.error) console.log('  exemples client_number:', (c.data || []).map(r => r.client_number).join(', ') || '(aucun)');

  // Fonctions : un appel service-role sans org lève l'erreur métier si la
  // fonction existe, ou PGRST202 si elle est absente.
  const d = await admin.rpc('rpc_peek_next_numbers');
  verdict('fonction rpc_peek_next_numbers', d.error);

  const e = await admin.rpc('org_smallest_free_number', { p_org: '00000000-0000-0000-0000-000000000000', p_entity: 'job' });
  verdict('fonction org_smallest_free_number (20260732)', e.error);
  if (!e.error) console.log('  plus petit libre (org fictive):', e.data);

  const f = await admin.from('invoices').select('invoice_number').order('created_at', { ascending: false }).limit(5);
  if (!f.error) console.log('derniers invoice_number:', (f.data || []).map(r => r.invoice_number).join(', ') || '(aucune facture)');

  const g = await admin.from('invoices').select('id').not('invoice_number', 'is', null).ilike('invoice_number', '%INV%').limit(1);
  if (!g.error) console.log('factures encore préfixées INV:', (g.data || []).length === 0 ? 'aucune' : 'IL EN RESTE');
})();
