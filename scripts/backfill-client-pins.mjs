/**
 * backfill-client-pins.mjs — Donne un pin Vente Map à tous les clients
 * existants qui ont une adresse mais aucune house/pin liée.
 *
 * Complète la migration 20260743000000_client_auto_field_pin.sql :
 *   - la migration crée le trigger (tout nouveau client → pin) + backfill SQL
 *     sans géocodage ;
 *   - ce script fait le même backfill AVEC géocodage immédiat
 *     (Mapbox → Google → Nominatim), puis géocode les houses restées sans
 *     coordonnées. Idempotent, relançable sans danger.
 *
 * Usage : node scripts/backfill-client-pins.mjs
 * Env   : VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 *         (../Downloads/lume-crm/.env.local ou .env.local)
 */
import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

for (const p of ['.env.local', '/Users/olivierst-pierre/Downloads/lume-crm/.env.local']) {
  if (existsSync(p)) config({ path: p });
}

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('VITE_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis.');
  process.exit(1);
}
const admin = createClient(url, key);

const STATUS_COLORS = {
  unknown: '#6b7280', no_answer: '#9ca3af', not_interested: '#ef4444',
  lead: '#A855F7', quote_sent: '#a855f7', sale: '#22c55e',
};

// Même mapping statut client → statut pin que sync_field_pin_from_client
// (20260746000000) : job assignée (active) → Vendu ; lead → Lead ; sinon
// unknown. Le lead_status ne pilote plus le pin — une quote ne le change jamais.
function pinStatusForClient(c) {
  if (c.status === 'active') return 'sale';
  if (c.status === 'lead') return 'lead';
  return 'unknown';
}

// ── Géocodage : mêmes variantes progressives que server/lib/fieldPinSync.ts ──
function addressVariants(address) {
  const parts = address.split(',').map((p) => p.trim()).filter(Boolean);
  const variants = [parts.join(', ')];
  const noUnit = parts.filter((p) => !/^(apt|app|unit|suite|ste|bureau|local|#)\b/i.test(p));
  if (noUnit.length && noUnit.length !== parts.length) variants.push(noUnit.join(', '));
  if (parts.length >= 4) variants.push([parts[0], ...parts.slice(-3)].join(', '));
  if (parts.length >= 3) variants.push(parts.slice(-3).join(', '));
  return [...new Set(variants)].slice(0, 4);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mapboxToken = process.env.MAPBOX_GEOCODING_TOKEN || process.env.VITE_MAPBOX_TOKEN || '';
const googleKey = process.env.GOOGLE_GEOCODING_API_KEY || process.env.VITE_GOOGLE_MAPS_API_KEY || '';

async function geocodeOnce(q) {
  if (mapboxToken) {
    try {
      const res = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?limit=1&types=address,place,postcode,locality,neighborhood&access_token=${encodeURIComponent(mapboxToken)}`,
      );
      if (res.ok) {
        const center = (await res.json())?.features?.[0]?.center;
        if (Array.isArray(center) && center.length >= 2) return { lat: Number(center[1]), lng: Number(center[0]) };
      }
    } catch { /* provider suivant */ }
  }
  if (googleKey) {
    try {
      const res = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(q)}&key=${encodeURIComponent(googleKey)}`,
      );
      if (res.ok) {
        const loc = (await res.json())?.results?.[0]?.geometry?.location;
        if (loc && Number.isFinite(loc.lat) && Number.isFinite(loc.lng)) return { lat: loc.lat, lng: loc.lng };
      }
    } catch { /* provider suivant */ }
  }
  try {
    await sleep(1100); // rate limit Nominatim: 1 req/s
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`,
      { headers: { 'User-Agent': 'LUME-CRM-Geocoder/1.0', Accept: 'application/json' } },
    );
    if (res.ok) {
      const top = (await res.json())?.[0];
      const lat = Number(top?.lat), lng = Number(top?.lon);
      if (Number.isFinite(lat) && Number.isFinite(lng) && (lat || lng)) return { lat, lng };
    }
  } catch { /* échec total */ }
  return null;
}

async function geocode(address) {
  for (const variant of addressVariants(address)) {
    const geo = await geocodeOnce(variant);
    if (geo) return geo;
  }
  return null;
}

// ── Chargement de l'état ──
const { data: houses, error: hErr } = await admin
  .from('field_house_profiles')
  .select('id, org_id, address, address_normalized, lat, lng, client_id, lead_id, assigned_user_id')
  .is('deleted_at', null);
if (hErr) { console.error('field_house_profiles:', hErr.message); process.exit(1); }

const linkedClientIds = new Set();
const houseByAddr = new Map(); // `${org_id}|${address_normalized}` → house
for (const h of houses) {
  if (h.client_id) linkedClientIds.add(h.client_id);
  if (h.lead_id) linkedClientIds.add(h.lead_id);
  if (h.address_normalized) houseByAddr.set(`${h.org_id}|${h.address_normalized}`, h);
}

const { data: memberships } = await admin.from('memberships').select('org_id, user_id, role');
const rank = { owner: 0, admin: 1 };
const fallbackUserByOrg = new Map();
for (const m of memberships ?? []) {
  const cur = fallbackUserByOrg.get(m.org_id);
  if (!cur || (rank[m.role] ?? 2) < (rank[cur.role] ?? 2)) fallbackUserByOrg.set(m.org_id, m);
}

const { data: clients, error: cErr } = await admin
  .from('clients')
  .select('id, org_id, first_name, last_name, phone, email, address, latitude, longitude, status, lead_status, created_by')
  .is('deleted_at', null)
  .not('address', 'is', null)
  .neq('address', '');
if (cErr) { console.error('clients:', cErr.message); process.exit(1); }

const now = () => new Date().toISOString();
let created = 0, adopted = 0, geocoded = 0, noCoords = 0, skipped = 0, failed = 0;

async function ensurePinAndLink(house, client, pinStatus) {
  const userId = client.created_by || house.assigned_user_id || fallbackUserByOrg.get(client.org_id)?.user_id || null;
  if (userId) {
    const { data: pin } = await admin.from('field_pins').select('id').eq('house_id', house.id).maybeSingle();
    if (!pin?.id) {
      const { error } = await admin.from('field_pins').insert({
        org_id: client.org_id, house_id: house.id, user_id: userId,
        status: pinStatus, pin_color: STATUS_COLORS[pinStatus] || STATUS_COLORS.unknown,
      });
      if (error) console.error(`  pin insert (${client.id}):`, error.message);
    }
  } else {
    console.warn(`  aucun user pour le pin de ${client.id} (org ${client.org_id})`);
  }
  await admin.from('field_pin_entity_links').upsert(
    { org_id: client.org_id, house_id: house.id, entity_type: 'client', entity_id: client.id, linked_at: now() },
    { onConflict: 'org_id,house_id,entity_type,entity_id' },
  );
}

// ── Passe 1 : clients avec adresse sans house liée ──
for (const client of clients) {
  if (linkedClientIds.has(client.id)) { skipped++; continue; }
  const label = `${client.first_name || ''} ${client.last_name || ''}`.trim() || client.id.slice(0, 8);
  const address = client.address.trim();
  const addrNorm = address.toLowerCase();
  const pinStatus = pinStatusForClient(client);

  try {
    const existing = houseByAddr.get(`${client.org_id}|${addrNorm}`);
    if (existing) {
      // House déjà présente à cette adresse → adopter (mêmes sémantiques que
      // upsertLeadPinForClient : on ne vole pas le client_id d'un autre)
      if (!existing.client_id && !existing.lead_id) {
        await admin.from('field_house_profiles')
          .update({ client_id: client.id, last_activity_at: now(), updated_at: now() })
          .eq('id', existing.id);
        existing.client_id = client.id;
      }
      await ensurePinAndLink(existing, client, pinStatus);
      adopted++;
      console.log(`≈ ${label} — house existante adoptée (${address})`);
      continue;
    }

    let lat = client.latitude, lng = client.longitude;
    if (lat == null || lng == null) {
      const geo = await geocode(address);
      if (geo) { lat = geo.lat; lng = geo.lng; geocoded++; }
      else { lat = null; lng = null; noCoords++; }
    }

    const { data: house, error } = await admin
      .from('field_house_profiles')
      .insert({
        org_id: client.org_id,
        address,
        address_normalized: addrNorm,
        lat, lng,
        current_status: pinStatus,
        client_id: client.id,
        assigned_user_id: client.created_by || fallbackUserByOrg.get(client.org_id)?.user_id || null,
        visit_count: 0,
        last_activity_at: now(),
        metadata: {
          source: 'crm_client_backfill',
          customer_name: label,
          customer_phone: client.phone || null,
          customer_email: client.email || null,
          ...(lat == null ? { geocode_status: 'pending' } : {}),
        },
      })
      .select('id, org_id, assigned_user_id, client_id')
      .single();
    if (error || !house) { failed++; console.error(`✗ ${label} — house insert:`, error?.message); continue; }

    houseByAddr.set(`${client.org_id}|${addrNorm}`, house);
    await ensurePinAndLink(house, client, pinStatus);
    created++;
    console.log(`✓ ${label} — pin créé${lat == null ? ' (géocodage en attente)' : ''} (${address})`);
  } catch (err) {
    failed++;
    console.error(`✗ ${label} —`, err?.message);
  }
}

// ── Passe 2 : houses liées à un client mais sans coordonnées ──
const { data: pending } = await admin
  .from('field_house_profiles')
  .select('id, address, metadata')
  .is('deleted_at', null)
  .is('lat', null);
for (const house of pending ?? []) {
  if (!house.address) continue;
  const geo = await geocode(house.address);
  if (!geo) continue;
  await admin.from('field_house_profiles').update({
    lat: geo.lat, lng: geo.lng,
    metadata: { ...(house.metadata || {}), geocode_status: 'resolved' },
    updated_at: now(),
  }).eq('id', house.id);
  geocoded++;
  console.log(`✓ géocodage réparé — ${house.address}`);
}

console.log(`\nRésumé : ${created} pin(s) créé(s), ${adopted} house(s) adoptée(s), ${geocoded} géocodage(s), ${noCoords} sans coords (cron de réparation), ${skipped} déjà liés, ${failed} échec(s).`);
