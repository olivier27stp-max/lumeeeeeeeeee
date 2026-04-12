import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const sb = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

async function run() {
  console.log('📦 Creating unique index if not exists...');

  // Check if index exists by trying a dummy upsert approach
  // We'll just run the seed function directly since ON CONFLICT DO NOTHING handles dupes

  // First create the unique index
  const { error: idxErr } = await sb.rpc('exec_sql', {
    sql: `CREATE UNIQUE INDEX IF NOT EXISTS automation_rules_org_preset_key ON public.automation_rules (org_id, preset_key) WHERE preset_key IS NOT NULL;`
  });

  if (idxErr) {
    // Index might already exist or RPC might not exist — try direct approach
    console.log('⚠️  Could not create index via RPC, trying seed directly...');
  } else {
    console.log('✅ Index created/verified');
  }

  // Get all orgs
  const { data: orgs } = await sb.from('orgs').select('id, name');
  if (!orgs || orgs.length === 0) {
    console.log('❌ No orgs found');
    return;
  }

  for (const org of orgs) {
    console.log(`\n🔧 Seeding org: ${org.name} (${org.id.slice(0, 8)}...)`);

    const { data: result, error } = await sb.rpc('seed_automation_presets', { p_org_id: org.id });
    if (error) {
      console.log(`  ❌ Seed failed: ${error.message}`);
      continue;
    }

    // Count presets
    const { data: presets } = await sb.from('automation_rules')
      .select('preset_key, name, trigger_event, delay_seconds, is_active')
      .eq('org_id', org.id)
      .eq('is_preset', true)
      .order('preset_key');

    console.log(`  ✅ ${presets?.length || 0} presets total:`);
    for (const p of presets || []) {
      const delay = (p as any).delay_seconds;
      const delayStr = delay === 0 ? 'immediate'
        : delay < 0 ? `${Math.abs(delay) / 3600}h before`
        : delay < 86400 ? `${delay / 3600}h after`
        : `${delay / 86400}d after`;
      const status = (p as any).is_active ? '🟢' : '⚪';
      console.log(`     ${status} ${(p as any).preset_key} → ${(p as any).trigger_event} (${delayStr})`);
    }
  }
}

run().catch(e => console.error(e));
