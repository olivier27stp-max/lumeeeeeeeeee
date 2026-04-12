/**
 * Seed Field Sales Demo Data — v2 (fixed schema)
 * Run: node scripts/seed-field-sales-demo.cjs
 */
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const URL = process.env.VITE_SUPABASE_URL;
const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ORG = '4d885f6c-e076-4ed9-ab09-23637dbee6cd';

const admin = createClient(URL, SRK, { auth: { autoRefreshToken: false, persistSession: false } });

const STATUSES = ['unknown', 'no_answer', 'not_interested', 'lead', 'sale', 'callback', 'revisit'];
const FIRST_NAMES = ['Jean', 'Marie', 'Pierre', 'Sophie', 'Marc', 'Isabelle', 'Luc', 'Nathalie', 'Francois', 'Julie'];
const LAST_NAMES = ['Tremblay', 'Gagnon', 'Roy', 'Cote', 'Bouchard', 'Gauthier', 'Morin', 'Lavoie', 'Fortin', 'Gagne'];
const STREETS = ['rue Sainte-Catherine', 'boulevard Saint-Laurent', 'rue Sherbrooke', 'avenue du Parc', 'rue Notre-Dame', 'rue Saint-Denis', 'rue Beaubien', 'rue Masson', 'rue Ontario', 'avenue Papineau'];
const PIN_COLORS = { unknown: '#6b7280', no_answer: '#9ca3af', not_interested: '#ef4444', lead: '#3b82f6', sale: '#22c55e', callback: '#f59e0b', revisit: '#06b6d4', quote_sent: '#a855f7', do_not_knock: '#dc2626' };

function rand(a, b) { return Math.random() * (b - a) + a; }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

async function main() {
  console.log('\n=== SEED FIELD SALES DEMO DATA v2 ===\n');

  // Get user
  const { data: mem } = await admin.from('memberships').select('user_id').eq('org_id', ORG).limit(1).single();
  if (!mem) { console.error('No user found'); process.exit(1); }
  const UID = mem.user_id;
  console.log(`User: ${UID}\n`);

  // ── 1. Territories ──
  const territories = [
    { name: 'Plateau Mont-Royal', color: '#3b82f6', coords: [[-73.58,45.52],[-73.56,45.52],[-73.56,45.54],[-73.58,45.54],[-73.58,45.52]] },
    { name: 'Rosemont',          color: '#22c55e', coords: [[-73.56,45.54],[-73.54,45.54],[-73.54,45.56],[-73.56,45.56],[-73.56,45.54]] },
    { name: 'Ville-Marie',       color: '#a855f7', coords: [[-73.58,45.50],[-73.55,45.50],[-73.55,45.52],[-73.58,45.52],[-73.58,45.50]] },
  ];
  const terIds = [];
  for (const t of territories) {
    const { data, error } = await admin.from('field_territories').insert({
      org_id: ORG, name: t.name, color: t.color,
      polygon_geojson: { type: 'Polygon', coordinates: [t.coords] },
      assigned_user_id: UID,
    }).select('id').single();
    if (error) { console.warn(`  Territory ${t.name}: ${error.message}`); continue; }
    terIds.push({ id: data.id, ...t });
    console.log(`  Territory: ${t.name}`);
  }

  // ── 2. 40 Pins ──
  console.log('\nCreating 40 pins...');
  let pinCount = 0;
  for (let i = 0; i < 40; i++) {
    const fn = pick(FIRST_NAMES), ln = pick(LAST_NAMES);
    const status = pick(STATUSES);
    const num = Math.floor(rand(100, 9999));
    const address = `${num} ${pick(STREETS)}, Montreal, QC`;
    const lat = rand(45.50, 45.56), lng = rand(-73.58, -73.54);

    // Find territory
    let terId = null;
    for (const t of terIds) {
      const [minLng, minLat] = t.coords[0];
      const [maxLng, maxLat] = t.coords[2];
      if (lat >= minLat && lat <= maxLat && lng >= minLng && lng <= maxLng) { terId = t.id; break; }
    }

    const { data: house, error } = await admin.from('field_house_profiles').insert({
      org_id: ORG, address, address_normalized: address.toLowerCase(),
      lat, lng, current_status: status, territory_id: terId,
      assigned_user_id: UID, visit_count: Math.floor(rand(0, 5)),
      last_activity_at: new Date(Date.now() - rand(0, 7 * 86400000)).toISOString(),
      metadata: { customer_name: `${fn} ${ln}`, customer_phone: `+1514${Math.floor(rand(1000000,9999999))}`, customer_email: `${fn.toLowerCase()}.${ln.toLowerCase()}@gmail.com` },
    }).select('id').single();

    if (error) { console.warn(`  Pin ${i}: ${error.message}`); continue; }

    await admin.from('field_pins').insert({
      org_id: ORG, house_id: house.id, lat, lng, status,
      pin_color: PIN_COLORS[status] || '#6b7280', has_note: Math.random() > 0.5,
    });

    // 1-3 events
    for (let j = 0; j < Math.floor(rand(1, 4)); j++) {
      await admin.from('field_house_events').insert({
        org_id: ORG, house_id: house.id, user_id: UID,
        event_type: pick(['knock', 'no_answer', 'lead', 'note', 'callback', 'sale']),
        note_text: j === 0 ? pick(['Spoke with homeowner', 'Left flyer', 'Interested in quote', 'Not home', 'Will call back', 'Signed contract']) : null,
        metadata: {}, created_at: new Date(Date.now() - rand(0, 5 * 86400000)).toISOString(),
      });
    }
    pinCount++;
    process.stdout.write('.');
  }
  console.log(` ${pinCount} done`);

  // ── 3. Daily stats (7 days) ──
  console.log('\nCreating daily stats...');
  for (let d = 0; d < 7; d++) {
    const date = new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
    const knocks = Math.floor(rand(5, 25));
    await admin.from('field_daily_stats').upsert({
      org_id: ORG, user_id: UID, date, knocks,
      leads: Math.floor(rand(1, knocks * 0.3 + 1)),
      sales: Math.floor(rand(0, knocks * 0.1 + 1)),
      callbacks: Math.floor(rand(0, 5)),
      no_answers: Math.floor(rand(2, 10)),
      not_interested: Math.floor(rand(1, 5)),
      notes: Math.floor(rand(0, 3)),
    }, { onConflict: 'org_id,user_id,date' });
  }
  console.log('  7 days done');

  // ── 4. Live tracking location ──
  console.log('\nCreating live location...');
  await admin.from('tracking_live_locations').upsert({
    user_id: UID, org_id: ORG,
    latitude: 45.525, longitude: -73.555,
    accuracy_m: 12, heading: 90, speed_mps: 2.5,
    is_moving: true, tracking_status: 'active',
    recorded_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' });
  console.log('  Live location set (active)');

  // ── 5. Route history (30 points) ──
  console.log('\nCreating route history...');
  const { data: sess } = await admin.from('tracking_sessions').insert({
    org_id: ORG, user_id: UID, source: 'web', status: 'active',
    started_at: new Date(Date.now() - 6 * 3600000).toISOString(),
    point_count: 30, total_distance_m: 5000,
  }).select('id').single();

  if (sess) {
    let rLat = 45.515, rLng = -73.575;
    for (let p = 0; p < 30; p++) {
      rLat += rand(-0.002, 0.003); rLng += rand(-0.001, 0.002);
      await admin.from('tracking_points').insert({
        org_id: ORG, session_id: sess.id, user_id: UID,
        latitude: rLat, longitude: rLng,
        accuracy_m: rand(5, 20), heading: rand(0, 360), speed_mps: rand(1, 8),
        is_moving: true, recorded_at: new Date(Date.now() - (30 - p) * 600000).toISOString(),
      });
    }
    console.log('  30 route points done');
  }

  console.log('\n=== SEED COMPLETE ===');
  console.log(`  ${terIds.length} territories`);
  console.log(`  ${pinCount} pins`);
  console.log(`  7 days stats`);
  console.log(`  1 live location + 30 route points`);
  console.log('\nRefresh http://localhost:5173/field-sales !\n');
}

main().catch(console.error);
