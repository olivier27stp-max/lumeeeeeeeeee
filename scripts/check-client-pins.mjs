/**
 * check-client-pins.mjs — Vérifie que chaque client avec adresse a son pin
 * sur la Vente Map (field_house_profiles + field_pins).
 *
 * Usage : node scripts/check-client-pins.mjs
 */
import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

for (const p of ['.env.local', '/Users/olivierst-pierre/Downloads/lume-crm/.env.local']) {
  if (existsSync(p)) config({ path: p });
}

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('VITE_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis.'); process.exit(1); }
const admin = createClient(url, key);

const { count: total } = await admin.from('clients').select('id', { count: 'exact', head: true }).is('deleted_at', null);
const { count: withAddr } = await admin.from('clients').select('id', { count: 'exact', head: true })
  .is('deleted_at', null).not('address', 'is', null).neq('address', '');
console.log(`clients actifs : ${total}, avec adresse : ${withAddr}`);

const { data: houses, error: hErr } = await admin
  .from('field_house_profiles')
  .select('id, client_id, lead_id, lat, lng')
  .is('deleted_at', null);
if (hErr) { console.error('field_house_profiles:', hErr.message); process.exit(1); }

const linked = new Set();
let noCoords = 0;
for (const h of houses) {
  if (h.client_id) linked.add(h.client_id);
  if (h.lead_id) linked.add(h.lead_id);
  if (h.lat == null) noCoords++;
}

const { data: pins } = await admin.from('field_pins').select('house_id');
const pinnedHouses = new Set((pins ?? []).map((p) => p.house_id));
const housesSansPin = houses.filter((h) => !pinnedHouses.has(h.id));

console.log(`houses actives : ${houses.length}, sans coords : ${noCoords}, sans field_pins : ${housesSansPin.length}`);

const { data: clients } = await admin
  .from('clients')
  .select('id, first_name, last_name, address, status')
  .is('deleted_at', null)
  .not('address', 'is', null)
  .neq('address', '');
const missing = (clients ?? []).filter((c) => !linked.has(c.id));
console.log(`clients avec adresse SANS pin : ${missing.length}`);
for (const c of missing) {
  console.log(`  - ${`${c.first_name || ''} ${c.last_name || ''}`.trim() || c.id} [${c.status}] ${c.address}`);
}
process.exit(missing.length || housesSansPin.length ? 1 : 0);
