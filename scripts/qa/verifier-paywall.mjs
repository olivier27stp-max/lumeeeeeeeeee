/**
 * verifier-paywall.mjs — le paywall côté SERVEUR, vérifié pour de vrai.
 *
 * Audit 2026-09-09 (C1) : la vérification d'abonnement ne vivait que dans
 * React. Ce script rejoue exactement l'attaque décrite : un compte sans
 * abonnement, un token Supabase valide, un appel direct à l'API.
 *
 *   node --env-file=.env.local scripts/qa/verifier-paywall.mjs
 *
 * Prérequis : l'API tourne (API_URL, défaut http://localhost:3002) et
 * .env.local pointe sur STAGING (le script refuse la prod). Il crée un
 * utilisateur + une org jetables, vérifie, pose un abonnement actif, revérifie,
 * puis nettoie tout.
 *
 * Attendu :
 *   - sans abonnement : /api/clients/search → 402 subscription_required
 *                       /api/billing/current → 200 (il faut pouvoir payer)
 *   - avec abonnement actif : /api/clients/search → 200
 */
import { createClient } from '@supabase/supabase-js';

const url = process.env.VITE_SUPABASE_URL;
const ref = process.env.SUPABASE_PROJECT_REF;
const refProd = process.env.SUPABASE_PROJECT_REF_PROD;
if (!url || !ref) throw new Error('VITE_SUPABASE_URL / SUPABASE_PROJECT_REF manquants');
if (!url.includes(ref) || (refProd && url.includes(refProd))) throw new Error('VITE_SUPABASE_URL ne pointe pas sur staging - abandon');

const API = process.env.API_URL || `http://localhost:${process.env.API_PORT || 3002}`;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const anon = createClient(url, process.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const email = `qa-paywall-${Date.now()}@example.test`;
const MDP = 'Xx-Paywall-1234!';
let userId, orgId, subId;
const resultats = [];
const ok = (nom, cond, detail = '') => { resultats.push({ nom, ok: !!cond, detail }); console.log(`${cond ? 'OK  ' : 'ECHEC'} ${nom} ${detail}`); };

async function appel(path, token) {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}`, 'x-org-id': orgId } });
  let body = null; try { body = await res.json(); } catch {}
  return { status: res.status, body };
}

try {
  const { data: created, error: e1 } = await admin.auth.admin.createUser({ email, password: MDP, email_confirm: true });
  if (e1) throw e1;
  userId = created.user.id;
  const { data: org, error: e2 } = await admin.from('orgs').insert({ name: `QA paywall ${Date.now()}`, created_by: userId }).select('id').single();
  if (e2) throw e2;
  orgId = org.id;
  const { error: e3 } = await admin.from('memberships').insert({ user_id: userId, org_id: orgId, role: 'owner' });
  if (e3) throw e3;

  const { data: session, error: e4 } = await anon.auth.signInWithPassword({ email, password: MDP });
  if (e4) throw e4;
  const token = session.session.access_token;

  // 1) Sans abonnement
  const r1 = await appel('/api/clients/search?q=a', token);
  ok('sans abonnement, /api/clients/search est refusé (402)', r1.status === 402 && r1.body?.error === 'subscription_required', `→ ${r1.status} ${JSON.stringify(r1.body)}`);
  const r2 = await appel('/api/billing/current', token);
  ok('sans abonnement, /api/billing/current reste ouvert (200)', r2.status === 200, `→ ${r2.status}`);
  const r3 = await appel('/api/me/is-beta-bypassed', token);
  ok('sans abonnement, /api/me/is-beta-bypassed reste ouvert (200)', r3.status === 200, `→ ${r3.status}`);

  // 2) Avec un abonnement actif
  const { data: plan } = await admin.from('plans').select('id').limit(1).maybeSingle();
  if (!plan) throw new Error('aucun plan en staging');
  const { data: sub, error: e5 } = await admin.from('subscriptions').insert({ user_id: userId, org_id: orgId, plan_id: plan.id, status: 'active' }).select('id').single();
  if (e5) throw e5;
  subId = sub.id;
  // Un refus est gardé 10 s en cache côté serveur.
  await new Promise((r) => setTimeout(r, 10_500));
  const r4 = await appel('/api/clients/search?q=a', token);
  ok('avec abonnement actif, /api/clients/search répond (200)', r4.status === 200, `→ ${r4.status}`);
} finally {
  if (subId) await admin.from('subscriptions').delete().eq('id', subId);
  if (orgId) { await admin.from('memberships').delete().eq('org_id', orgId); await admin.from('team_members').delete().eq('org_id', orgId); await admin.from('orgs').delete().eq('id', orgId); }
  if (userId) await admin.auth.admin.deleteUser(userId);
}

const echecs = resultats.filter((r) => !r.ok);
console.log(`\n${resultats.length - echecs.length}/${resultats.length} vérifications passées`);
process.exit(echecs.length ? 1 : 0);
