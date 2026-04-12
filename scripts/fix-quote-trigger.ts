import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

async function fix() {
  // Fix quote_followup_1d: estimate.sent → quote.sent
  const { data, error } = await sb.from('automation_rules')
    .update({
      trigger_event: 'quote.sent',
      name: 'Quote Follow-Up — 1 Day After Sent',
      description: 'Follow up on a quote 1 day after sending it',
    })
    .eq('preset_key', 'quote_followup_1d')
    .eq('trigger_event', 'estimate.sent')
    .select('id, org_id, name, trigger_event');

  if (error) {
    console.log('ERROR:', error.message);
    return;
  }
  console.log(`✅ Fixed ${data?.length || 0} quote_followup_1d rows (estimate.sent → quote.sent)`);
  for (const r of data || []) {
    console.log(`   org=${(r as any).org_id.slice(0, 8)}... → trigger=${(r as any).trigger_event}`);
  }

  // Verify
  const { data: verify } = await sb.from('automation_rules')
    .select('preset_key, trigger_event, delay_seconds, is_active')
    .eq('preset_key', 'quote_followup_1d');

  console.log('\nVerification:');
  for (const r of verify || []) {
    console.log(`   ${(r as any).preset_key}: trigger=${(r as any).trigger_event}, delay=${(r as any).delay_seconds}s, active=${(r as any).is_active}`);
  }
}

fix().catch(e => console.error(e));
