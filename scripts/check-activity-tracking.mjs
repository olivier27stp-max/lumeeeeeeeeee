/**
 * check-activity-tracking.mjs — Vérifie que les triggers du centre
 * d'activités (migrations 20260747 + 20260748) sont en place en prod :
 *   1. colonnes notifications.entity_type / read_at / actor_name ;
 *   2. test bout-en-bout : insertion d'une note de test → événement
 *      note_created (ambiant, avec acteur), suppression → note_deleted,
 *      puis nettoyage complet (note + les 2 notifications de test).
 *
 * Usage : node scripts/check-activity-tracking.mjs
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

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let ok = true;
const fail = (msg) => { ok = false; console.error(`❌ ${msg}`); };
const pass = (msg) => console.log(`✅ ${msg}`);

// ── 1. Colonnes ─────────────────────────────────────────────
{
  const { error } = await admin.from('notifications')
    .select('id, entity_type, read_at, actor_name').limit(1);
  if (error) fail(`colonnes notifications manquantes : ${error.message}`);
  else pass('colonnes notifications OK (entity_type, read_at, actor_name)');
}

// ── 2. Test bout-en-bout via activity_notes ─────────────────
const { data: client } = await admin.from('clients')
  .select('id, org_id, first_name, last_name')
  .is('deleted_at', null).not('first_name', 'is', null)
  .order('created_at', { ascending: false }).limit(1).maybeSingle();
if (!client) { fail('aucun client trouvé pour le test'); process.exit(1); }

const { data: member } = await admin.from('memberships')
  .select('user_id').eq('org_id', client.org_id).limit(1).maybeSingle();
const { data: profile } = member
  ? await admin.from('profiles').select('full_name').eq('id', member.user_id).maybeSingle()
  : { data: null };

const { data: note, error: noteErr } = await admin.from('activity_notes').insert({
  org_id: client.org_id,
  entity_type: 'client',
  entity_id: client.id,
  body: 'Test tracking centre d\'activités — supprimé automatiquement',
  actor_id: member?.user_id || null,
}).select('id').single();
if (noteErr) { fail(`insertion note de test : ${noteErr.message}`); process.exit(1); }

await sleep(700);
const { data: created } = await admin.from('notifications')
  .select('id, type, title, body, is_read, read_at, actor_name, link')
  .eq('type', 'note_created').eq('reference_id', note.id).maybeSingle();

if (!created) {
  fail('note_created ABSENT — le trigger ac_track_activity_notes ne tourne pas (migration 47 appliquée ?)');
} else {
  pass(`note_created émis — body: « ${created.body} »`);
  if (created.is_read === true && created.read_at) pass('événement ambiant : is_read=true + read_at rempli');
  else fail(`événement ambiant attendu, reçu is_read=${created.is_read}, read_at=${created.read_at}`);
  const expected = (profile?.full_name || '').trim();
  if (expected && created.actor_name === expected) pass(`actor_name = « ${created.actor_name} » (migration 48 OK)`);
  else if (created.actor_name) pass(`actor_name rempli : « ${created.actor_name} »`);
  else fail('actor_name vide — migration 48 appliquée ? (profiles.full_name vide pour ce membre ?)');
  if (created.link === `/clients/${client.id}`) pass('link vers le client OK');
}

// Suppression (hard) → note_deleted
await admin.from('activity_notes').delete().eq('id', note.id);
await sleep(700);
const { data: deleted } = await admin.from('notifications')
  .select('id, type, is_read')
  .eq('type', 'note_deleted').eq('reference_id', note.id).maybeSingle();
if (!deleted) fail('note_deleted ABSENT après suppression');
else pass('note_deleted émis à la suppression');

// ── 3. Nettoyage des notifications de test ──────────────────
const ids = [created?.id, deleted?.id].filter(Boolean);
if (ids.length) {
  await admin.from('notifications').delete().in('id', ids);
  pass(`nettoyage : ${ids.length} notification(s) de test supprimée(s)`);
}

// ── 4. Aperçu des derniers événements réels ─────────────────
const { data: recent } = await admin.from('notifications')
  .select('type, title, actor_name, created_at')
  .in('type', ['quote_created','quote_updated','quote_sent','quote_approved','invoice_created','invoice_sent','invoice_paid','payment_received','payment_failed','note_created'])
  .order('created_at', { ascending: false }).limit(5);
console.log('\nDerniers événements trackés en prod :');
for (const n of recent || []) {
  console.log(`  · [${n.type}] ${n.title}${n.actor_name ? ` — acteur: ${n.actor_name}` : ''} (${n.created_at})`);
}
if (!recent?.length) console.log('  (aucun encore — normal si aucune mutation depuis l\'application des migrations)');

console.log(ok ? '\n🎉 Tracking du centre d\'activités : tout est fonctionnel.' : '\n⚠️ Des vérifications ont échoué — voir ci-dessus.');
process.exit(ok ? 0 : 1);
