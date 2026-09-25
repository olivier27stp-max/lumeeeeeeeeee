#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   ISOLATION STRICTE ENTRE LES BUREAUX D'UN MÊME COMPTE.

   Le contrôle « fuite entre organisations » éprouve deux ENTREPRISES
   différentes. Celui-ci éprouve le cas qui a réellement mordu le
   2026-09-24 : UN compte membre de DEUX bureaux (Vision Lavage et
   Coquin lavage) qui, dans l'un, voyait les factures de l'autre.

   Il ouvre une vraie session pour ce compte, pose l'en-tête `x-org-id`
   du bureau A comme le fait le navigateur, puis tente de lire CHAQUE
   table portant un org_id en visant le bureau B. Toute ligne qui
   remonte est une fuite. Il vérifie aussi que current_org_id() suit
   l'en-tête, qu'un bureau non membre est refusé, et — si LUME_API_URL
   est fourni — que l'API répond 400 org_required sans en-tête.

   Usage : node --env-file=.env.local scripts/qa/isolation-bureaux.mjs
   Variables : VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY,
               SUPABASE_SERVICE_ROLE_KEY ; optionnel LUME_API_URL,
               QA_COMPTE (courriel du compte multi-bureaux à éprouver),
               SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF (liste
               exhaustive des tables via le catalogue).
   ═══════════════════════════════════════════════════════════════ */

import { createClient } from '@supabase/supabase-js';

const URL_ = process.env.VITE_SUPABASE_URL;
const ANON = process.env.VITE_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !ANON || !SERVICE) {
  console.error('VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY et SUPABASE_SERVICE_ROLE_KEY sont requis.');
  process.exit(2);
}
const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });

const fuites = [], ok = [], refus = [], avertissements = [];

/** Session réelle (lien magique), avec l'en-tête x-org-id demandé. */
async function session(courriel) {
  const anon = createClient(URL_, ANON, { auth: { persistSession: false } });
  const { data: lien, error: e1 } = await admin.auth.admin.generateLink({ type: 'magiclink', email: courriel });
  if (e1) throw new Error(`lien refusé pour ${courriel} : ${e1.message}`);
  const { data: s, error: e2 } = await anon.auth.verifyOtp({ token_hash: lien.properties.hashed_token, type: 'magiclink' });
  if (e2) throw new Error(`session refusée pour ${courriel} : ${e2.message}`);
  const jeton = s.session.access_token;
  const avecBureau = (org) => createClient(URL_, ANON, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${jeton}`, ...(org ? { 'x-org-id': org } : {}) } },
  });
  return { jeton, avecBureau };
}

/** Tables du schéma public portant org_id (catalogue si possible, sinon liste connue). */
async function tablesAvecOrgId() {
  const token = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_PROJECT_REF;
  if (token && ref) {
    try {
      const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: `select c.table_name from information_schema.columns c join information_schema.tables t on t.table_schema=c.table_schema and t.table_name=c.table_name where c.table_schema='public' and c.column_name='org_id' and t.table_type='BASE TABLE' order by 1` }),
      });
      const j = await r.json();
      if (Array.isArray(j) && j.length) return j.map((x) => x.table_name);
      avertissements.push(`catalogue indisponible (${r.status}) — liste connue utilisée`);
    } catch (e) {
      avertissements.push(`catalogue indisponible (${e.message}) — liste connue utilisée`);
    }
  }
  const connues = [
    'clients', 'jobs', 'schedule_events', 'invoices', 'invoice_items', 'quotes', 'quote_line_items', 'payments',
    'pipeline_deals', 'deals', 'requests', 'form_submissions', 'tasks', 'properties', 'job_line_items',
    'conversations', 'messages', 'notifications', 'activity_log', 'teams', 'team_members', 'time_entries',
    'email_templates', 'invoice_templates', 'job_templates', 'job_recurrence_rules', 'automation_rules',
    'tax_configs', 'tax_groups', 'specific_notes', 'job_agreements', 'service_contracts', 'field_pins',
    'field_house_profiles', 'tracking_sessions', 'gps_providers', 'geofences', 'payment_requests',
  ];
  const existantes = [];
  for (const t of connues) {
    const { error } = await admin.from(t).select('org_id', { head: true, count: 'exact' }).limit(1);
    if (!error) existantes.push(t);
  }
  return existantes;
}

(async () => {
  console.log('\n═══ Isolation entre bureaux d’un même compte ═══\n');

  // 1. Un compte membre d'au moins deux bureaux.
  const { data: mem } = await admin.from('memberships').select('user_id, org_id').range(0, 9999);
  const parUser = {};
  for (const m of mem || []) (parUser[m.user_id] ||= new Set()).add(m.org_id);
  let utilisateurs = [];
  try { const { data } = await admin.auth.admin.listUsers({ perPage: 500 }); utilisateurs = data?.users || []; } catch { /* repli ci-dessous */ }
  const courrielDe = (id) => (utilisateurs.find((u) => u.id === id) || {}).email;

  let cible = null;
  if (process.env.QA_COMPTE) {
    const u = utilisateurs.find((x) => x.email === process.env.QA_COMPTE);
    if (u && (parUser[u.id]?.size ?? 0) >= 2) cible = { user: u.id, mail: u.email, orgs: [...parUser[u.id]] };
    else console.error(`QA_COMPTE ${process.env.QA_COMPTE} introuvable ou membre d'un seul bureau.`);
  }
  if (!cible) {
    const candidats = Object.entries(parUser).filter(([, s]) => s.size >= 2).map(([user, s]) => ({ user, mail: courrielDe(user), orgs: [...s] })).filter((c) => c.mail);
    if (!candidats.length) { console.error('Aucun compte membre de deux bureaux avec un courriel : rien à éprouver.'); process.exit(2); }
    // Celui dont les bureaux ont le plus de clients (le cas Vision Lavage / Coquin lavage).
    for (const c of candidats) {
      c.poids = 0;
      for (const o of c.orgs) { const { count } = await admin.from('clients').select('*', { count: 'exact', head: true }).eq('org_id', o); c.poids += count || 0; }
    }
    candidats.sort((a, b) => b.poids - a.poids);
    cible = candidats[0];
  }

  const nomOrg = async (id) => {
    const { data } = await admin.from('company_settings').select('company_name').eq('org_id', id).maybeSingle();
    return data?.company_name || id.slice(0, 8);
  };
  const [A, B] = cible.orgs;
  console.log(`  Compte éprouvé : ${cible.mail}`);
  console.log(`  Bureau A (sélectionné) : ${await nomOrg(A)}  ${A}`);
  console.log(`  Bureau B (à cacher)    : ${await nomOrg(B)}  ${B}\n`);

  const { jeton, avecBureau } = await session(cible.mail);
  const cA = avecBureau(A);
  const cB = avecBureau(B);
  const sansEnTete = avecBureau(null);

  // 2. current_org_id() suit l'en-tête.
  const { data: orgVuA, error: eA } = await cA.rpc('current_org_id');
  const { data: orgVuB, error: eB } = await cB.rpc('current_org_id');
  if (eA || eB) refus.push(`current_org_id : ${(eA || eB).message}`);
  else {
    if (orgVuA === A) ok.push('current_org_id() = A avec x-org-id=A'); else fuites.push(`current_org_id() renvoie ${orgVuA} avec x-org-id=A (attendu ${A})`);
    if (orgVuB === B) ok.push('current_org_id() = B avec x-org-id=B'); else fuites.push(`current_org_id() renvoie ${orgVuB} avec x-org-id=B (attendu ${B})`);
  }
  console.log(`  current_org_id()  x-org-id=A → ${orgVuA === A ? '✓ A' : '✗ ' + orgVuA}   x-org-id=B → ${orgVuB === B ? '✓ B' : '✗ ' + orgVuB}`);

  // 3. Un bureau NON membre dans l'en-tête ne donne rien.
  const inconnu = '00000000-0000-4000-8000-000000000000';
  const { data: orgVuX } = await avecBureau(inconnu).rpc('current_org_id');
  if (orgVuX === inconnu) fuites.push('current_org_id() accepte un bureau non membre'); else ok.push('bureau non membre ignoré par current_org_id()');
  const { data: clientsX } = await avecBureau(inconnu).from('clients').select('id').limit(1);
  if ((clientsX || []).length) fuites.push('clients lisibles avec un x-org-id non membre'); else ok.push('aucun client avec un x-org-id non membre');

  // 4. Chaque table : avec x-org-id=A, viser B → 0 ligne ; viser A → lisible.
  const tables = await tablesAvecOrgId();
  console.log(`\n  ${tables.length} table(s) portant un org_id à éprouver (x-org-id=A, cible B)\n`);
  for (const t of tables) {
    const { count: reelB } = await admin.from(t).select('*', { count: 'exact', head: true }).eq('org_id', B);
    const { count: reelA } = await admin.from(t).select('*', { count: 'exact', head: true }).eq('org_id', A);
    const { data, error } = await cA.from(t).select('org_id').eq('org_id', B).limit(5);
    if (error) { refus.push(`${t} — ${error.code || ''} ${error.message.slice(0, 60)}`); console.log(`  · ${t.padEnd(30)} refus (${error.code || 'err'})`); continue; }
    const vues = (data || []).length;
    // Sans filtre côté client (le cas d'une page qui oublie son .eq) : rien de B ne doit passer.
    const { data: brut } = await cA.from(t).select('org_id').limit(200);
    const brutB = (brut || []).filter((r) => r.org_id === B).length;
    if (vues > 0 || brutB > 0) {
      fuites.push(`${t} : ${vues} ligne(s) de B visibles (filtre B) / ${brutB} (sans filtre) depuis A`);
      console.log(`  ✗ ${t.padEnd(30)} FUITE — filtre B : ${vues}, sans filtre : ${brutB} (B en a ${reelB})`);
    } else {
      ok.push(t);
      console.log(`  ✓ ${t.padEnd(30)} étanche${reelB ? ` (B en a ${reelB}, A en voit 0` : ' (B en a 0'}${reelA ? `, A voit ses ${reelA})` : ')'}`);
    }
  }

  // 5. Sans en-tête : comportement d'un compte mobile (membership seule) — noté, pas une fuite.
  const { data: sans } = await sansEnTete.from('clients').select('org_id').limit(200);
  const orgsVues = new Set((sans || []).map((r) => r.org_id));
  console.log(`\n  Sans x-org-id : clients de ${orgsVues.size} bureau(x) visibles (attendu : les bureaux du compte, filtrés par l'app)`);

  // 6. L'API : sans en-tête, un compte multi-bureaux reçoit 400 org_required.
  if (process.env.LUME_API_URL) {
    const base = process.env.LUME_API_URL.replace(/\/$/, '');
    const r1 = await fetch(`${base}/api/notifications/unread-count`, { headers: { Authorization: `Bearer ${jeton}` } });
    const r2 = await fetch(`${base}/api/notifications/unread-count`, { headers: { Authorization: `Bearer ${jeton}`, 'x-org-id': A } });
    const r3 = await fetch(`${base}/api/notifications/unread-count`, { headers: { Authorization: `Bearer ${jeton}`, 'x-org-id': inconnu } });
    console.log(`\n  API sans en-tête → ${r1.status} (attendu 400) ; avec A → ${r2.status} (attendu 200) ; bureau non membre → ${r3.status} (attendu 403)`);
    if (r1.status !== 400) fuites.push(`API sans x-org-id répond ${r1.status} au lieu de 400`); else ok.push('API 400 org_required sans en-tête');
    if (r2.status !== 200) refus.push(`API avec x-org-id=A répond ${r2.status}`);
    if (r3.status !== 403) fuites.push(`API avec un bureau non membre répond ${r3.status} au lieu de 403`); else ok.push('API 403 bureau non membre');
  } else {
    avertissements.push('LUME_API_URL absent : le contrôle 400/403 de l’API n’a pas été exécuté');
  }

  console.log('\n════════════════════════════════════════════════════════════');
  console.log(`  Contrôles étanches  ${ok.length}`);
  console.log(`  Refus explicites    ${refus.length}`);
  console.log(`  Avertissements      ${avertissements.length}`);
  console.log(`  FUITES              ${fuites.length}`);
  for (const a of avertissements) console.log(`    ! ${a}`);
  for (const f of fuites) console.log(`    ✗ ${f}`);
  console.log('');
  process.exit(fuites.length ? 1 : 0);
})().catch((e) => { console.error('Échec du contrôle :', e.message); process.exit(2); });
