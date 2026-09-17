/**
 * verifier-paie-plan-commission.mjs — la page Paie signale un rep payé à
 * commission qui n'a ni plan assigné ni plan par défaut.
 *
 *   node --env-file=.env.local scripts/qa/verifier-paie-plan-commission.mjs
 *
 * Staging seulement (écrit compensation_mode sur un membre de l'org QA, puis
 * le remet). Express doit tourner (API_URL, défaut http://localhost:3002).
 */
import { createClient } from '@supabase/supabase-js';

const URL_SB = process.env.VITE_SUPABASE_URL;
const API = (process.env.API_URL || 'http://localhost:3002').replace(/\/$/, '');
const COMPTE = process.env.QA_COMPTE || 'willhebert30@gmail.com';
if (process.env.SUPABASE_PROJECT_REF_PROD && URL_SB.includes(process.env.SUPABASE_PROJECT_REF_PROD)) {
  console.error('REFUS : ce banc écrit. La cible est la PRODUCTION.'); process.exit(2);
}
const admin = createClient(URL_SB, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const anon = createClient(URL_SB, process.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const resultats = [];
const ok = (nom, vrai, detail = '') => { resultats.push(!!vrai); console.log(`  ${vrai ? '✓' : '✗'} ${nom}${detail ? ' — ' + detail : ''}`); return !!vrai; };

const { data: l } = await admin.auth.admin.generateLink({ type: 'magiclink', email: COMPTE });
const { data: s } = await anon.auth.verifyOtp({ token_hash: l.properties.hashed_token, type: 'magiclink' });
const { data: m } = await admin.from('memberships').select('org_id').eq('user_id', s.user.id).eq('status', 'active').limit(1).maybeSingle();
const orgId = m.org_id;
const entetes = { Authorization: `Bearer ${s.session.access_token}`, 'x-org-id': orgId };

const { data: membre } = await admin.from('team_members').select('id, user_id, first_name, compensation_mode').eq('org_id', orgId).eq('status', 'active').not('user_id', 'is', null).order('created_at').limit(1).maybeSingle();
const { data: reglages } = await admin.from('commission_settings').select('default_rule_id').eq('org_id', orgId).maybeSingle();
console.log(`Org ${orgId.slice(0, 8)} — membre test : ${membre.first_name} (mode ${membre.compensation_mode}), plan par défaut : ${reglages?.default_rule_id || 'aucun'}`);

async function ligne() {
  const r = await fetch(`${API}/api/payroll/period-summary`, { headers: entetes });
  const j = await r.json();
  if (!r.ok) throw new Error(`${r.status} ${JSON.stringify(j).slice(0, 200)}`);
  return (j.rows || []).find((x) => x.user_id === membre.user_id) || null;
}

try {
  console.log('\n1. Mode « commission » sans aucun plan → alerte');
  await admin.from('team_members').update({ compensation_mode: 'commission' }).eq('id', membre.id);
  const r1 = await ligne();
  ok('la ligne de paie existe', !!r1);
  ok('commission_plan_missing = true', r1?.commission_plan_missing === true, JSON.stringify({ commission_plan_missing: r1?.commission_plan_missing }));

  console.log('\n2. Mode « horaire » → pas d’alerte');
  await admin.from('team_members').update({ compensation_mode: 'hourly' }).eq('id', membre.id);
  const r2 = await ligne();
  ok('commission_plan_missing = false', r2?.commission_plan_missing === false, JSON.stringify({ commission_plan_missing: r2?.commission_plan_missing }));

  console.log('\n3. Mode « horaire + commission » avec une règle assignée → pas d’alerte');
  await admin.from('team_members').update({ compensation_mode: 'both' }).eq('id', membre.id);
  const { data: regle, error: eR } = await admin.from('fs_commission_rules')
    .insert({ org_id: orgId, name: '[QA] plan temporaire', type: 'percentage', percentage: 5, is_active: true, assigned_user_ids: [membre.user_id] })
    .select('id').single();
  if (eR) throw eR;
  try {
    const r3 = await ligne();
    ok('commission_plan_missing = false avec règle assignée', r3?.commission_plan_missing === false, JSON.stringify({ commission_plan_missing: r3?.commission_plan_missing }));
  } finally {
    await admin.from('fs_commission_rules').delete().eq('id', regle.id);
  }
} finally {
  await admin.from('team_members').update({ compensation_mode: membre.compensation_mode }).eq('id', membre.id);
  console.log(`\nRemis : ${membre.first_name} en mode ${membre.compensation_mode}, règle temporaire supprimée`);
}
const echecs = resultats.filter((r) => !r).length;
console.log(`\n${resultats.length - echecs}/${resultats.length} vérifications passent`);
process.exit(echecs ? 1 : 0);
