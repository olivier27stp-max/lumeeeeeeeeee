/**
 * regeocode-active-pins.mjs — Re-géocode les pins actifs de la Vente Map avec
 * Google (rooftop) et corrige les positions imprécises héritées de Nominatim
 * (points de rue) ou des centroïdes Mapbox.
 *
 * Règles :
 *  - Seules les houses actives avec numéro civique sont traitées.
 *  - Les pins placés manuellement sur la carte (coordonnées à queue longue,
 *    issues d'un clic) ne sont JAMAIS déplacés.
 *  - Un résultat précis (rooftop/interpolated) à >15 m du point stocké
 *    déplace le pin ; ≤15 m on ne fait qu'estampiller les métadonnées.
 *  - Un résultat approximatif ne déplace le pin que si le point stocké est
 *    aberrant (>2 km), et le pin est marqué geocode_status='approximate'.
 *  - Les anciennes coordonnées sont conservées dans metadata.previous_lat/lng.
 *  - La job liée est réalignée si elle portait les mêmes coordonnées périmées.
 *
 * Usage : node scripts/regeocode-active-pins.mjs [--apply]   (dry-run sinon)
 */
import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

for (const p of ['.env.local', '/Users/olivierst-pierre/Downloads/lume-crm/.env.local']) {
  if (existsSync(p)) config({ path: p });
}

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const googleKey = process.env.GOOGLE_GEOCODING_API_KEY || process.env.VITE_GOOGLE_MAPS_API_KEY;
if (!url || !key || !googleKey) {
  console.error('VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY et une clé Google requis.');
  process.exit(1);
}
const admin = createClient(url, key);
const APPLY = process.argv.includes('--apply');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const decimals = (n) => (String(n).split('.')[1] ?? '').length;
const R = 6371000;
const toRad = (d) => (d * Math.PI) / 180;
function haversineMetres(lat1, lng1, lat2, lng2) {
  const a = Math.sin(toRad(lat2 - lat1) / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(toRad(lng2 - lng1) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

async function geocodeGoogle(address) {
  const res = await fetch(
    `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&region=ca&key=${encodeURIComponent(googleKey)}`,
  );
  if (!res.ok) return null;
  const top = (await res.json())?.results?.[0];
  const lat = Number(top?.geometry?.location?.lat);
  const lng = Number(top?.geometry?.location?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const locationType = String(top?.geometry?.location_type || '');
  const isAddress = (top?.types ?? []).some((t) => t === 'street_address' || t === 'premise' || t === 'subpremise');
  const precision = locationType === 'ROOFTOP' ? 'rooftop'
    : locationType === 'RANGE_INTERPOLATED' || isAddress ? 'interpolated'
    : 'approximate';
  return { lat, lng, precision, formatted: top?.formatted_address ?? null, place_id: top?.place_id ?? null };
}

const { data: houses, error } = await admin
  .from('field_house_profiles')
  .select('id, address, lat, lng, current_status, job_id, metadata')
  .is('deleted_at', null)
  .not('address', 'is', null);
if (error) { console.error(error.message); process.exit(1); }

let moved = 0, stamped = 0, flagged = 0, skipped = 0;
for (const h of houses ?? []) {
  const label = `${(h.address ?? '').slice(0, 55)} [${h.current_status}]`;
  if (!/^\d+\s/.test(h.address ?? '')) { skipped++; console.log(`SKIP  (pas de n° civique)     ${label}`); continue; }
  if (h.lat != null && (decimals(h.lat) > 7 || decimals(h.lng) > 7)) {
    skipped++; console.log(`SKIP  (placé manuellement)    ${label}`); continue;
  }

  const geo = await geocodeGoogle(h.address);
  await sleep(120);
  if (!geo) { skipped++; console.log(`SKIP  (géocodage échoué)      ${label}`); continue; }

  const dist = h.lat == null ? Infinity : Math.round(haversineMetres(h.lat, h.lng, geo.lat, geo.lng));
  const precise = geo.precision !== 'approximate';
  const shouldMove = h.lat == null || (precise && dist > 15) || (!precise && dist > 2000);

  const metadata = {
    ...(h.metadata || {}),
    geocode_status: precise ? 'resolved' : 'approximate',
    geocode_provider: 'google',
    geocode_precision: geo.precision,
    geocode_variant: h.address,
    geocoded_at: new Date().toISOString(),
    ...(shouldMove && h.lat != null ? { previous_lat: h.lat, previous_lng: h.lng } : {}),
  };
  const patch = shouldMove
    ? { lat: geo.lat, lng: geo.lng, place_id: geo.place_id, metadata, updated_at: new Date().toISOString() }
    : { metadata };

  if (shouldMove) { moved++; console.log(`MOVE  ${String(dist).padStart(6)} m ${geo.precision.padEnd(12)} ${label}`); }
  else if (precise) { stamped++; console.log(`OK    ${String(dist).padStart(6)} m ${geo.precision.padEnd(12)} ${label}`); }
  else { flagged++; console.log(`FLAG  ${String(dist).padStart(6)} m ${geo.precision.padEnd(12)} ${label}`); }

  if (!APPLY) continue;
  const { error: updErr } = await admin.from('field_house_profiles').update(patch).eq('id', h.id);
  if (updErr) { console.error(`  !! update house: ${updErr.message}`); continue; }

  // Job liée portant les mêmes coordonnées périmées → réaligner.
  if (shouldMove && h.job_id && h.lat != null) {
    const { data: job } = await admin.from('jobs').select('id, latitude, longitude').eq('id', h.job_id).maybeSingle();
    if (job?.latitude != null && haversineMetres(job.latitude, job.longitude, h.lat, h.lng) < 5) {
      const { error: jErr } = await admin.from('jobs')
        .update({ latitude: geo.lat, longitude: geo.lng, geocode_status: 'ok', geocoded_at: new Date().toISOString() })
        .eq('id', h.job_id);
      if (jErr) console.error(`  !! update job: ${jErr.message}`);
      else console.log(`  ↳ job ${h.job_id.slice(0, 8)} réalignée`);
    }
  }
}

console.log(`\n${APPLY ? 'APPLIQUÉ' : 'DRY-RUN'} — déplacés: ${moved}, confirmés: ${stamped}, approximatifs signalés: ${flagged}, ignorés: ${skipped}`);
