/**
 * Seed tracking data AFTER the tracking migration is applied.
 * Run AFTER applying: supabase/migrations/20260505000000_browser_gps_tracking.sql
 * in the Supabase Dashboard SQL Editor.
 *
 * Run: node scripts/seed-tracking-data.cjs
 */
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const admin = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const ORG = '4d885f6c-e076-4ed9-ab09-23637dbee6cd';
const UID = 'e0cf4b92-c229-4785-a2e7-7081fae3e18e';

(async () => {
  console.log('\n=== SEED TRACKING DATA ===\n');

  // Check if tables exist
  const { error: check } = await admin.from('tracking_sessions').select('id').limit(1);
  if (check) { console.error('Tables missing! Apply the migration first:\n  supabase/migrations/20260505000000_browser_gps_tracking.sql'); process.exit(1); }

  // 1. Live location
  const { error: le } = await admin.from('tracking_live_locations').upsert({
    user_id: UID, org_id: ORG, latitude: 45.525, longitude: -73.555,
    accuracy_m: 12, heading: 90, speed_mps: 2.5, is_moving: true,
    tracking_status: 'active', recorded_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' });
  console.log(le ? `Live err: ${le.message}` : 'Live location set');

  // 2. Session
  const { data: sess, error: se } = await admin.from('tracking_sessions').insert({
    org_id: ORG, user_id: UID, source: 'web', status: 'active',
    started_at: new Date(Date.now() - 6 * 3600000).toISOString(), point_count: 30, total_distance_m: 5000,
  }).select('id').single();
  if (se) { console.log('Session err:', se.message); process.exit(1); }
  console.log('Session:', sess.id);

  // 3. Route points (30 points through Montreal)
  let lat = 45.515, lng = -73.575;
  for (let p = 0; p < 30; p++) {
    lat += (Math.random() - 0.4) * 0.005;
    lng += (Math.random() - 0.3) * 0.003;
    await admin.from('tracking_points').insert({
      org_id: ORG, session_id: sess.id, user_id: UID,
      latitude: lat, longitude: lng, accuracy_m: Math.random() * 15 + 5,
      heading: Math.random() * 360, speed_mps: Math.random() * 7 + 1, is_moving: true,
      recorded_at: new Date(Date.now() - (30 - p) * 600000).toISOString(),
    });
  }
  console.log('30 route points created');

  console.log('\n=== DONE ===\n');
})();
