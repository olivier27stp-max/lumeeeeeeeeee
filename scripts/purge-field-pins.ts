/**
 * One-off maintenance: soft-delete all field-sales pins/houses so the D2D map
 * starts clean. Soft delete only (deleted_at) — never hard delete (CLAUDE.md).
 *
 * Usage:
 *   npx tsx scripts/purge-field-pins.ts            # dry-run: counts only
 *   npx tsx scripts/purge-field-pins.ts --confirm  # actually soft-deletes
 */
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env.local' });
config(); // .env fallback

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY manquants dans .env.local');
  process.exit(1);
}
const admin = createClient(url, key, { auth: { persistSession: false } });

const confirm = process.argv.includes('--confirm');

async function main() {
  // Breakdown per org of active (non-deleted) houses + their pins
  const { data: houses, error } = await admin
    .from('field_house_profiles')
    .select('id, org_id')
    .is('deleted_at', null);
  if (error) throw error;

  const perOrg = new Map<string, number>();
  (houses ?? []).forEach((h) => perOrg.set(h.org_id, (perOrg.get(h.org_id) ?? 0) + 1));

  const { count: pinCount } = await admin
    .from('field_pins')
    .select('id', { count: 'exact', head: true });

  console.log('--- État actuel ---');
  console.log(`Maisons actives (field_house_profiles, deleted_at IS NULL): ${houses?.length ?? 0}`);
  perOrg.forEach((n, org) => console.log(`  org ${org}: ${n} maisons`));
  console.log(`Pins totaux (field_pins): ${pinCount ?? '?'}`);

  // Live rep positions — the source of "ghost" markers on the map
  const { data: locs } = await admin
    .from('tracking_live_locations')
    .select('user_id, tracking_status, recorded_at, latitude, longitude, session_id');
  console.log(`\nPositions de reps (tracking_live_locations): ${locs?.length ?? 0}`);
  for (const l of locs ?? []) {
    const age = Math.round((Date.now() - new Date(l.recorded_at).getTime()) / 60000);
    const { data: u } = await admin.auth.admin.getUserById(l.user_id);
    console.log(`  ${u?.user?.email ?? l.user_id} — statut=${l.tracking_status} — dernière position il y a ${age} min — (${l.latitude.toFixed(4)}, ${l.longitude.toFixed(4)}) — session=${l.session_id ? 'oui' : 'non'}`);
  }

  if (!confirm) {
    console.log('\nDRY-RUN — rien supprimé. Relance avec --confirm pour soft-deleter.');
    return;
  }

  const now = new Date().toISOString();
  const { data: updated, error: updErr } = await admin
    .from('field_house_profiles')
    .update({ deleted_at: now })
    .is('deleted_at', null)
    .select('id');
  if (updErr) throw updErr;
  console.log(`\n✔ ${updated?.length ?? 0} maisons soft-deleted (deleted_at=${now}).`);
  console.log('Les pins ne s\'afficheront plus sur la map (le GET /pins filtre deleted_at). Cache API: 20s max.');

  // Ghost rep markers: live locations stuck 'active'/'idle' whose app never
  // ended the session. Mark anything not refreshed in 10 min as offline.
  const freshSince = new Date(Date.now() - 10 * 60_000).toISOString();
  const { data: ghosts, error: ghostErr } = await admin
    .from('tracking_live_locations')
    .update({ tracking_status: 'offline', session_id: null })
    .in('tracking_status', ['active', 'idle'])
    .lt('recorded_at', freshSince)
    .select('user_id, recorded_at');
  if (ghostErr) console.error('tracking cleanup:', ghostErr.message);
  else if (ghosts?.length) {
    console.log(`✔ ${ghosts.length} position(s) de rep fantôme(s) marquée(s) offline:`);
    ghosts.forEach((g) => console.log(`   user ${g.user_id} — dernière position: ${g.recorded_at}`));
  } else {
    console.log('Aucune position de rep fantôme.');
  }
}

main().catch((e) => { console.error('ERREUR:', e?.message || e); process.exit(1); });
