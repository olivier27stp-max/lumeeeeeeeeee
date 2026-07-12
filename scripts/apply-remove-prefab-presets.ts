/**
 * apply-remove-prefab-presets.ts — soft-delete the 3 auto-seeded prefab quote
 * presets (Classic Blue / Detailed Red / Modern Bold) in every org.
 *
 * Same effect as supabase/migrations/20260730000000_remove_prefab_quote_presets.sql.
 * Matches name + the exact seeded description so user-created or renamed
 * presets are never touched.
 *
 * Usage: npx tsx scripts/apply-remove-prefab-presets.ts
 * Env: VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (.env.local)
 */
import { config } from 'dotenv';
import { existsSync } from 'fs';
config({ path: '.env.local' });
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  // Fallback: the machine keeps the service keys in the old checkout's env file.
  const alt = `${process.env.HOME}/Downloads/lume-crm/.env.local`;
  if (existsSync(alt)) config({ path: alt });
}

import { createClient } from '@supabase/supabase-js';

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}
const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

const PREFABS = [
  { name: 'Classic Blue', description: 'Professional navy blue layout with clean corporate styling.' },
  { name: 'Detailed Red', description: 'Detailed estimate with full cost breakdown, signature line, and service information.' },
  { name: 'Modern Bold', description: 'Vibrant contemporary design with bold orange accents and modern styling.' },
];

async function run() {
  for (const p of PREFABS) {
    const { data, error } = await admin
      .from('quote_templates')
      .update({ deleted_at: new Date().toISOString() })
      .eq('name', p.name)
      .eq('description', p.description)
      .is('deleted_at', null)
      .select('id, org_id');
    if (error) {
      console.error(`FAILED ${p.name}:`, error.message);
      process.exit(1);
    }
    console.log(`soft-deleted "${p.name}": ${data?.length ?? 0} row(s)`);
  }

  const { data: remaining, error } = await admin
    .from('quote_templates')
    .select('id, org_id, name, description')
    .is('deleted_at', null);
  if (error) {
    console.error('verify failed:', error.message);
    process.exit(1);
  }
  console.log(`remaining active presets (user-created): ${remaining?.length ?? 0}`);
  for (const r of remaining || []) {
    console.log(`  - "${r.name}" — ${r.description || '(no description)'} (org ${r.org_id})`);
  }
}

run();
