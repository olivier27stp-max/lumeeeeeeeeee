/**
 * Vérifie que la carte de porte-à-porte alimente bien le pipeline de ventes.
 *
 * Passe par le VRAI chemin HTTP (routes Express + service_role), pas par le
 * SQL : c'est le seul moyen de prouver que le branchement des routes tient,
 * et pas seulement la fonction de base.
 *
 * Quatre faits à établir :
 *   1. une porte cognée « pas de réponse » n'entre PAS dans le pipeline ;
 *   2. la même porte passée à « lead » y entre, avec son rep et son pin ;
 *   3. un second passage ne crée pas de deuxième deal ;
 *   4. une porte créée directement en « vente » entre aussi.
 *
 * Tout ce qui est créé est supprimé à la fin, même en cas d'échec.
 *
 * Usage : npm run api:dev dans un terminal, puis
 *         node --env-file=.env.local scripts/qa/verifier-porte-a-porte.mjs
 */
import { createClient } from '@supabase/supabase-js';

const API = process.env.QA_API || 'http://localhost:3002';
const URL_SB = process.env.VITE_SUPABASE_URL;
const CLE_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const COMPTE = process.env.QA_COMPTE || 'willhebert30@gmail.com';

if (!URL_SB || !CLE_SERVICE) {
  console.error('VITE_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis (.env.local).');
  process.exit(2);
}
if (URL_SB.includes('bbzcuzqfgsdvjsymfwmr')) {
  console.error('Refus : ce script écrit des données de test, jamais sur la PROD.');
  process.exit(2);
}

const admin = createClient(URL_SB, CLE_SERVICE, { auth: { persistSession: false } });
const aNettoyer = { maisons: [], deals: [], clients: [] };
let reussis = 0;
let echoues = 0;

function verifier(nom, condition, detail = '') {
  if (condition) { reussis++; console.log(`  ✓ ${nom}`); }
  else { echoues++; console.log(`  ✗ ${nom}${detail ? ` — ${detail}` : ''}`); }
}

async function dealsDeLaPorte(orgId, houseId) {
  const { data } = await admin.from('deals')
    .select('id,source,pin_id,field_rep_id,stage_id')
    .eq('org_id', orgId).eq('external_id', `house:${houseId}`).is('deleted_at', null);
  return data ?? [];
}

async function main() {
  const sonde = await fetch(`${API}/api/health`, { signal: AbortSignal.timeout(4000) }).catch(() => null);
  if (!sonde) {
    console.error(`Le serveur ne répond pas sur ${API}. Démarrer « npm run api:dev ».`);
    process.exit(2);
  }

  const { data: lien } = await admin.auth.admin.generateLink({ type: 'magiclink', email: COMPTE });
  const anon = createClient(URL_SB, process.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data: sess } = await anon.auth.verifyOtp({
    token_hash: lien.properties.hashed_token, type: 'magiclink',
  });
  const jeton = sess?.session?.access_token;
  const userId = sess?.session?.user?.id;
  if (!jeton) { console.error('Session impossible pour ' + COMPTE); process.exit(2); }

  const { data: membre } = await admin.from('memberships')
    .select('org_id').eq('user_id', userId).limit(1).maybeSingle();
  const orgId = membre.org_id;

  const entetes = { 'Content-Type': 'application/json', Authorization: `Bearer ${jeton}` };
  const marque = Date.now();

  // ── 1. Une porte muette ne doit PAS entrer dans le pipeline ──────────
  console.log('\n1. Une porte sans réponse reste sur la carte');
  const r1 = await fetch(`${API}/api/field-sales/houses`, {
    method: 'POST', headers: entetes,
    body: JSON.stringify({
      address: `1 rue Muette ${marque}, Montréal`, lat: 45.51, lng: -73.56,
      status: 'no_answer',
      customer_name: `Porte Muette ${marque}`, customer_phone: `514555${String(marque).slice(-4)}`,
    }),
  });
  const m1 = await r1.json();
  if (m1?.id) aNettoyer.maisons.push(m1.id);
  verifier('la porte est créée', !!m1?.id, JSON.stringify(m1).slice(0, 160));
  verifier('aucun deal créé', (await dealsDeLaPorte(orgId, m1.id)).length === 0);

  // ── 2. La même porte devient un prospect ────────────────────────────
  console.log('\n2. La même porte passe à « lead »');
  const r2 = await fetch(`${API}/api/field-sales/houses/${m1.id}/events`, {
    method: 'POST', headers: entetes,
    body: JSON.stringify({ event_type: 'lead', note_text: 'Intéressé, à rappeler' }),
  });
  verifier("l'événement est accepté", r2.ok, `HTTP ${r2.status}`);
  const apres = await dealsDeLaPorte(orgId, m1.id);
  verifier('un deal est créé', apres.length === 1, `${apres.length} deal(s)`);
  if (apres[0]) {
    aNettoyer.deals.push(apres[0].id);
    verifier('la source est « d2d »', apres[0].source === 'd2d', apres[0].source);
    verifier('le pin est attribué', !!apres[0].pin_id);
    verifier('le rep est crédité', apres[0].field_rep_id === userId);
    const { data: etape } = await admin.from('pipeline_stages')
      .select('kind,position').eq('id', apres[0].stage_id).maybeSingle();
    verifier("il arrive dans une étape ouverte", etape?.kind === 'open', etape?.kind);
  }

  // ── 3. Repasser par là ne duplique pas ──────────────────────────────
  console.log('\n3. Un second passage ne crée pas de doublon');
  await fetch(`${API}/api/field-sales/houses/${m1.id}/events`, {
    method: 'POST', headers: entetes, body: JSON.stringify({ event_type: 'callback' }),
  });
  await fetch(`${API}/api/field-sales/houses/${m1.id}/events`, {
    method: 'POST', headers: entetes, body: JSON.stringify({ event_type: 'lead' }),
  });
  const encore = await dealsDeLaPorte(orgId, m1.id);
  verifier('toujours un seul deal', encore.length === 1, `${encore.length} deal(s)`);

  // ── 4. Une porte créée directement en vente ─────────────────────────
  console.log('\n4. Une porte créée directement en « vente »');
  const r4 = await fetch(`${API}/api/field-sales/houses`, {
    method: 'POST', headers: entetes,
    body: JSON.stringify({
      address: `2 rue Vendue ${marque}, Montréal`, lat: 45.52, lng: -73.57,
      status: 'sale',
      customer_name: `Porte Vendue ${marque}`, customer_phone: `514556${String(marque).slice(-4)}`,
    }),
  });
  const m4 = await r4.json();
  if (m4?.id) aNettoyer.maisons.push(m4.id);
  if (m4?.client_id) aNettoyer.clients.push(m4.client_id);
  const d4 = await dealsDeLaPorte(orgId, m4.id);
  d4.forEach((d) => aNettoyer.deals.push(d.id));
  verifier('un deal est créé', d4.length === 1, `${d4.length} deal(s)`);
  verifier('la réponse porte le deal_id', !!m4?.deal_id, JSON.stringify(m4?.deal_id));

  console.log(`\n${reussis} réussis, ${echoues} échoués.`);
  return echoues === 0 ? 0 : 1;
}

async function nettoyer() {
  for (const id of aNettoyer.deals) await admin.from('deals').delete().eq('id', id);
  for (const id of aNettoyer.maisons) {
    await admin.from('field_pins').delete().eq('house_id', id);
    await admin.from('field_house_events').delete().eq('house_id', id);
    await admin.from('field_pin_entity_links').delete().eq('house_id', id);
    await admin.from('field_house_profiles').delete().eq('id', id);
  }
  for (const id of aNettoyer.clients) await admin.from('clients').delete().eq('id', id);
  console.log('Nettoyage fait.');
}

let code = 1;
try { code = await main(); }
catch (e) { console.error('Échec :', e?.message ?? e); code = 1; }
finally { await nettoyer().catch((e) => console.error('Nettoyage incomplet :', e?.message)); }
process.exit(code);
