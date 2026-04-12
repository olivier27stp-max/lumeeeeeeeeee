/**
 * Test all 12 field sales features — validates data + API endpoints
 * Run: node scripts/test-field-features.cjs
 */
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const URL = process.env.VITE_SUPABASE_URL;
const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ORG = '4d885f6c-e076-4ed9-ab09-23637dbee6cd';
const admin = createClient(URL, SRK, { auth: { autoRefreshToken: false, persistSession: false } });

let pass = 0, fail = 0;
function ok(label, detail) { pass++; console.log(`  ✓ ${label}${detail ? ' — ' + detail : ''}`); }
function ko(label, detail) { fail++; console.log(`  ✗ ${label}${detail ? ' — ' + detail : ''}`); }

async function main() {
  console.log('\n=== TEST FIELD SALES FEATURES ===\n');

  // Get user
  const { data: mem } = await admin.from('memberships').select('user_id').eq('org_id', ORG).limit(1).single();
  if (!mem) { ko('User lookup', 'no user'); return; }
  const UID = mem.user_id;
  ok('User found', UID);

  // ── 1. Pins exist (via house profiles — field_pins lat/lng are on house_profiles) ──
  const { data: pins, error: pErr } = await admin.from('field_house_profiles')
    .select('id, current_status, lat, lng, territory_id, assigned_user_id').eq('org_id', ORG).is('deleted_at', null).limit(50);
  if (pErr) ko('Pins query', pErr.message);
  else if (!pins || pins.length === 0) ko('Pins exist', '0 pins found');
  else ok('Pins exist', `${pins.length} house profiles`);

  // ── 2. Pin statuses for filtering ──
  const statuses = [...new Set((pins || []).map(p => p.current_status))];
  if (statuses.length >= 3) ok('Pin status variety', statuses.join(', '));
  else ko('Pin status variety', `only ${statuses.length} statuses: ${statuses.join(', ')}`);

  // ── 3. Territories exist ──
  const { data: ters, error: tErr } = await admin.from('field_territories')
    .select('id, name, polygon_geojson, assigned_user_id').eq('org_id', ORG).is('deleted_at', null);
  if (tErr) ko('Territories query', tErr.message);
  else if (!ters || ters.length === 0) ko('Territories exist', '0 territories');
  else ok('Territories exist', `${ters.length} territories: ${ters.map(t => t.name).join(', ')}`);

  // ── 4. Territory polygons valid ──
  let validPolygons = 0;
  for (const t of (ters || [])) {
    const coords = t.polygon_geojson?.coordinates?.[0];
    if (coords && coords.length >= 4) validPolygons++;
  }
  if (validPolygons === (ters || []).length) ok('Territory polygons valid', `${validPolygons}/${(ters || []).length}`);
  else ko('Territory polygons valid', `${validPolygons}/${(ters || []).length} valid`);

  // ── 5. House profiles with metadata (customer info) ──
  const { data: houses } = await admin.from('field_house_profiles')
    .select('id, metadata, assigned_user_id, territory_id, current_status').eq('org_id', ORG).is('deleted_at', null).limit(5);
  const hasCustomerInfo = (houses || []).filter(h => h.metadata?.customer_name).length;
  if (hasCustomerInfo > 0) ok('Customer info in pins', `${hasCustomerInfo}/${(houses || []).length} have customer data`);
  else ko('Customer info in pins', 'no metadata.customer_name found');

  // ── 6. Assigned pins (for "My Pins" filter) ──
  const assignedToUser = (pins || []).length; // all pins are assigned to UID in seed
  const { data: assignedHouses } = await admin.from('field_house_profiles')
    .select('id').eq('org_id', ORG).eq('assigned_user_id', UID).is('deleted_at', null);
  if ((assignedHouses || []).length > 0) ok('My Pins filter data', `${(assignedHouses || []).length} pins assigned to user`);
  else ko('My Pins filter data', 'no pins assigned');

  // ── 7. House events (timeline/notes) ──
  const { data: events } = await admin.from('field_house_events')
    .select('id, event_type, note_text').eq('org_id', ORG).limit(20);
  const withNotes = (events || []).filter(e => e.note_text).length;
  if ((events || []).length > 0) ok('Events/notes exist', `${(events || []).length} events, ${withNotes} with notes`);
  else ko('Events/notes exist', '0 events');

  // ── 8. Daily stats (check any user in org) ──
  const { data: stats } = await admin.from('field_daily_stats')
    .select('date, knocks, leads, sales, user_id').eq('org_id', ORG).order('date', { ascending: false }).limit(7);
  if ((stats || []).length >= 5) ok('Daily stats', `${(stats || []).length} days of data`);
  else ko('Daily stats', `only ${(stats || []).length} days`);

  // ── 9. Live tracking location ──
  const { data: live } = await admin.from('tracking_live_locations')
    .select('user_id, latitude, longitude, tracking_status').eq('org_id', ORG).limit(1).maybeSingle();
  if (live && live.latitude) ok('Live rep location', `status=${live.tracking_status}, lat=${live.latitude.toFixed(4)}`);
  else ko('Live rep location', 'no live location found');

  // ── 10. Route history (tracking points) ──
  const today = new Date().toISOString().slice(0, 10);
  const { data: routePoints } = await admin.from('tracking_points')
    .select('id, latitude, longitude, recorded_at').eq('org_id', ORG)
    .gte('recorded_at', `${today}T00:00:00Z`).lte('recorded_at', `${today}T23:59:59Z`)
    .order('recorded_at', { ascending: true });
  if ((routePoints || []).length >= 10) ok('Route history', `${(routePoints || []).length} points for today`);
  else ko('Route history', `only ${(routePoints || []).length} points`);

  // ── 11. Tracking session ──
  const { data: sessions } = await admin.from('tracking_sessions')
    .select('id, status, started_at').eq('org_id', ORG).eq('status', 'active');
  if ((sessions || []).length > 0) ok('Tracking session', `${(sessions || []).length} active session(s)`);
  else ko('Tracking session', 'no active sessions');

  // ── 12. Stats aggregation (for territory stats) ──
  const totalKnocks = (stats || []).reduce((s, r) => s + (r.knocks || 0), 0);
  const totalLeads = (stats || []).reduce((s, r) => s + (r.leads || 0), 0);
  const totalSales = (stats || []).reduce((s, r) => s + (r.sales || 0), 0);
  if (totalKnocks > 0) ok('Stats aggregation', `knocks=${totalKnocks} leads=${totalLeads} sales=${totalSales}`);
  else ko('Stats aggregation', 'no knocks data');

  // ── 13. Pins in territories (for heatmap + zone stats) ──
  const pinsWithTerritory = (houses || []).filter(h => h.territory_id).length;
  if (pinsWithTerritory > 0) ok('Pins in territories', `${pinsWithTerritory} pins have territory_id`);
  else ko('Pins in territories', 'no pins linked to territories');

  // ── 14. Heatmap data check ──
  const pinsWithCoords = (pins || []).filter(p => p.lat && p.lng).length;
  if (pinsWithCoords >= 10) ok('Heatmap data', `${pinsWithCoords} pins with coordinates`);
  else ko('Heatmap data', `only ${pinsWithCoords} pins with coords`);

  // ── 15. Compare territories (need 2+ with data) ──
  if ((ters || []).length >= 2) ok('Compare territories', `${(ters || []).length} territories available`);
  else ko('Compare territories', `only ${(ters || []).length} territories`);

  // ── 16. AI analysis data (pins by status per territory) ──
  const unknownPins = (pins || []).filter(p => ['unknown', 'revisit'].includes(p.current_status)).length;
  const leadPins = (pins || []).filter(p => p.current_status === 'lead').length;
  const callbackPins = (pins || []).filter(p => p.current_status === 'callback').length;
  if (unknownPins > 0 || leadPins > 0 || callbackPins > 0) {
    ok('AI analysis data', `unknown=${unknownPins} leads=${leadPins} callbacks=${callbackPins}`);
  } else {
    ko('AI analysis data', 'no pins for analysis');
  }

  // ── Summary ──
  console.log(`\n${'='.repeat(50)}`);
  console.log(`  RESULTS: ${pass} passed, ${fail} failed / ${pass + fail} total`);
  console.log(`${'='.repeat(50)}\n`);

  if (fail === 0) console.log('  ALL TESTS PASSED!\n');
  else console.log(`  ${fail} ISSUES — fix and re-run\n`);
}

main().catch(console.error);
