/**
 * Bureaux — phase 0, prouvée contre staging avec une entreprise fictive à 2 bureaux.
 *
 *   node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/qa/bureaux-phase0.mts
 *   (API locale sur :3188 — API_URL_QA pour changer)
 *
 * Un propriétaire membre de A (son PLUS ANCIEN bureau) et de B :
 *   1. current_org_id() suit l'en-tête x-lume-org (et retombe sur A sans lui) ;
 *   2. convertir un devis de B en job crée le job DANS B (avant : dans A) ;
 *   3. B, sans abonnement, a droit aux SMS du forfait du groupe porté par A.
 * Tout ce qui est créé est retiré à la fin.
 */
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { orgPlanIncludesSms } from '../../server/lib/twilioProvisioning';

const API = (process.env.API_URL_QA || 'http://localhost:3188').replace(/\/$/, '');
const url = process.env.VITE_SUPABASE_URL!;
if (!url.includes(process.env.SUPABASE_PROJECT_REF!) || url.includes(process.env.SUPABASE_PROJECT_REF_PROD!)) throw new Error('staging seulement');
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const s = Date.now().toString(36);
const courriel = `qa.bureaux.${s}@exemple.invalid`;
const mdp = crypto.randomBytes(18).toString('base64url');
const ok: string[] = [];
const ko: string[] = [];
const verifier = (nom: string, cond: boolean, detail = '') => (cond ? ok : ko).push(`${nom}${detail ? ` — ${detail}` : ''}`);
const nettoyer: Array<() => PromiseLike<unknown>> = [];

const { data: cree, error: eUser } = await admin.auth.admin.createUser({ email: courriel, password: mdp, email_confirm: true });
if (eUser || !cree.user) throw eUser ?? new Error('utilisateur');
const uid = cree.user.id;
nettoyer.unshift(() => admin.auth.admin.deleteUser(uid));

try {
  const { data: A, error: eA } = await admin.from('orgs').insert({ name: `QA bureau A ${s}`, created_by: uid }).select('id, company_group_id').single();
  if (eA) throw eA;
  const { data: B, error: eB } = await admin.from('orgs').insert({ name: `QA bureau B ${s}`, created_by: uid, company_group_id: A.company_group_id }).select('id, company_group_id').single();
  if (eB) throw eB;
  nettoyer.unshift(() => admin.from('orgs').delete().in('id', [A.id, B.id]));
  // A = le plus ancien bureau de la personne.
  const hier = new Date(Date.now() - 86400e3).toISOString();
  for (const [org, quand] of [[A.id, hier], [B.id, new Date().toISOString()]] as const) {
    const { error } = await admin.from('memberships').upsert({ user_id: uid, org_id: org, role: 'owner', status: 'active', created_at: quand }, { onConflict: 'user_id,org_id' });
    if (error) throw new Error(`adhésion ${org === A.id ? 'A' : 'B'} : ${error.message}`);
  }
  await admin.from('memberships').update({ created_at: hier }).eq('user_id', uid).eq('org_id', A.id);
  nettoyer.unshift(() => admin.from('memberships').delete().eq('user_id', uid));

  const anon = createClient(url, process.env.VITE_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const { data: sess, error: eS } = await anon.auth.signInWithPassword({ email: courriel, password: mdp });
  if (eS || !sess.session) throw eS ?? new Error('session');
  const jeton = sess.session.access_token;

  // 1. current_org_id() et l'en-tête
  const cli = (bureau?: string) => createClient(url, process.env.VITE_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${jeton}`, ...(bureau ? { 'x-lume-org': bureau } : {}) } },
  });
  const sansEntete = (await cli().rpc('current_org_id')).data;
  const avecB = (await cli(B.id).rpc('current_org_id')).data;
  verifier('1a. sans en-tête, current_org_id() = le plus ancien bureau (A) — la cause du défaut', sansEntete === A.id, String(sansEntete === A.id ? 'A' : sansEntete));
  verifier('1b. avec x-lume-org = B, current_org_id() = B', avecB === B.id);

  // 2. Conversion devis → job depuis B, par la vraie API
  const { data: client } = await admin.from('clients').insert({ org_id: B.id, first_name: 'QA', last_name: `Bureau B ${s}`, created_by: uid }).select('id').single();
  const { data: devis, error: eD } = await admin.from('quotes').insert({
    org_id: B.id, client_id: client!.id, quote_number: `QA-${s}`, title: 'Devis bureau B', status: 'approved', created_by: uid,
  }).select('id').single();
  if (eD) throw eD;
  nettoyer.unshift(async () => {
    await admin.from('jobs').delete().eq('client_id', client!.id);
    await admin.from('quotes').delete().eq('id', devis!.id);
    await admin.from('clients').delete().eq('id', client!.id);
  });
  const r = await fetch(`${API}/api/quotes/convert-to-job`, {
    method: 'POST', headers: { Authorization: `Bearer ${jeton}`, 'x-org-id': B.id, 'Content-Type': 'application/json' },
    body: JSON.stringify({ quoteId: devis!.id }),
  });
  const corps = await r.json().catch(() => null) as { jobId?: string; error?: string } | null;
  if (r.ok && corps?.jobId) {
    const { data: job } = await admin.from('jobs').select('org_id').eq('id', corps.jobId).single();
    verifier('2. devis de B converti en job : le job est DANS B', job?.org_id === B.id, job?.org_id === A.id ? 'créé dans A (défaut présent)' : '');
  } else verifier('2. conversion devis → job depuis B', false, `HTTP ${r.status} ${corps?.error ?? ''}`);

  // 3. SMS : forfait porté par A, bureau B sans abonnement
  const { data: plan } = await admin.from('plans').select('id').eq('includes_sms', true).limit(1).single();
  const { data: sub, error: eSub } = await admin.from('subscriptions').insert({ user_id: uid, org_id: A.id, plan_id: plan!.id, status: 'active' }).select('id').single();
  if (eSub) throw eSub;
  nettoyer.unshift(() => admin.from('subscriptions').delete().eq('id', sub!.id));
  verifier('3a. bureau A (porte l’abonnement) : SMS permis', await orgPlanIncludesSms(A.id));
  verifier('3b. bureau B (sans abonnement, même groupe) : SMS permis', await orgPlanIncludesSms(B.id));
} finally {
  for (const f of nettoyer) { try { await f(); } catch (e) { console.error('nettoyage :', e); } }
}
for (const x of ok) console.log('  ✓', x);
for (const x of ko) console.log('  ✗', x);
console.log(`${ok.length}/${ok.length + ko.length}`);
process.exit(ko.length ? 1 : 0);
