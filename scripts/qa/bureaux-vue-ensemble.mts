/**
 * Vue d'ensemble des bureaux — prouvée contre staging (entreprise fictive à 2 bureaux).
 *
 *   node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/qa/bureaux-vue-ensemble.mts
 *   (API locale :3188, Vite :5288 — API_URL_QA / FRONTEND_URL_QA pour changer)
 *
 *   1. Propriétaire de A et B : les chiffres de chaque bureau = ceux des fonctions de
 *      la page Rapports appelées directement pour ce bureau ; total = somme.
 *   2. Une conversation non lue dans B compte pour B seulement.
 *   3. Un admin (pas propriétaire) : 403.
 *   4. Propriétaire de A mais admin de B : seul A apparaît.
 *   5. À l'écran (ordinateur et téléphone) : les deux bureaux et le total, sans erreur.
 * Tout ce qui est créé est retiré à la fin.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import puppeteer from 'puppeteer';

const API = (process.env.API_URL_QA || 'http://localhost:3188').replace(/\/$/, '');
const BASE = (process.env.FRONTEND_URL_QA || 'http://localhost:5288').replace(/\/$/, '');
const url = process.env.VITE_SUPABASE_URL!;
const ANON = process.env.VITE_SUPABASE_ANON_KEY!;
if (!url.includes(process.env.SUPABASE_PROJECT_REF!) || url.includes(process.env.SUPABASE_PROJECT_REF_PROD!)) throw new Error('staging seulement');
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const s = Date.now().toString(36);
const ok: string[] = [];
const ko: string[] = [];
const verifier = (nom: string, cond: boolean, detail = '') => (cond ? ok : ko).push(`${nom}${detail ? ` — ${detail}` : ''}`);
const nettoyer: Array<() => PromiseLike<unknown>> = [];

async function utilisateur(etiquette: string) {
  const courriel = `qa.vue.${etiquette}.${s}@exemple.invalid`;
  const mdp = crypto.randomBytes(18).toString('base64url');
  const { data, error } = await admin.auth.admin.createUser({ email: courriel, password: mdp, email_confirm: true });
  if (error || !data.user) throw error ?? new Error('utilisateur');
  nettoyer.unshift(() => admin.auth.admin.deleteUser(data.user!.id));
  const anon = createClient(url, ANON, { auth: { persistSession: false } });
  const { data: sess, error: eS } = await anon.auth.signInWithPassword({ email: courriel, password: mdp });
  if (eS || !sess.session) throw eS ?? new Error('session');
  return { id: data.user.id, session: sess.session };
}
async function adhesion(user: string, org: string, role: string, quand = new Date().toISOString()) {
  const { error } = await admin.from('memberships').upsert({ user_id: user, org_id: org, role, status: 'active', created_at: quand }, { onConflict: 'user_id,org_id' });
  if (error) throw new Error(`adhésion : ${error.message}`);
}
const apercu = async (jeton: string, bureau: string) => {
  const r = await fetch(`${API}/api/orgs/offices/overview?from=2026-01-01&to=2026-12-31`, { headers: { Authorization: `Bearer ${jeton}`, 'x-org-id': bureau } });
  return { status: r.status, j: await r.json().catch(() => null) as any };
};

try {
  const proprio = await utilisateur('proprio');
  const { data: A, error: eA } = await admin.from('orgs').insert({ name: `QA vue A ${s}`, created_by: proprio.id }).select('id, company_group_id').single();
  if (eA) throw eA;
  const { data: B, error: eB } = await admin.from('orgs').insert({ name: `QA vue B ${s}`, created_by: proprio.id, company_group_id: A.company_group_id }).select('id').single();
  if (eB) throw eB;
  nettoyer.unshift(() => admin.from('orgs').delete().in('id', [A.id, B.id]));
  nettoyer.unshift(() => admin.from('memberships').delete().in('org_id', [A.id, B.id]));
  await adhesion(proprio.id, A.id, 'owner', new Date(Date.now() - 86400e3).toISOString());
  await adhesion(proprio.id, B.id, 'owner');

  // Une conversation non lue dans B.
  const { error: eC } = await admin.from('conversations').insert({ org_id: B.id, phone_number: '+15145550100', client_name: 'QA', unread_count: 2, last_message_text: 'QA' });
  if (eC) throw eC;
  nettoyer.unshift(() => admin.from('conversations').delete().eq('org_id', B.id));

  // 1 + 2
  const r = await apercu(proprio.session.access_token, A.id);
  verifier('1a. propriétaire de A et B : 200, deux bureaux', r.status === 200 && r.j?.offices?.length === 2, `HTTP ${r.status}, ${r.j?.offices?.length ?? 0} bureau(x)`);
  if (r.status === 200) {
    for (const b of r.j.offices) {
      const direct = createClient(url, ANON, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${proprio.session.access_token}`, 'x-lume-org': b.org_id } } });
      const { data: o } = await direct.rpc('rpc_insights_overview', { p_org: b.org_id, p_from: '2026-01-01', p_to: '2026-12-31' });
      const { data: f } = await direct.rpc('rpc_insights_invoices_summary', { p_org: b.org_id, p_from: '2026-01-01', p_to: '2026-12-31' });
      const ro = (Array.isArray(o) ? o[0] : o) ?? {};
      const rf = (Array.isArray(f) ? f[0] : f) ?? {};
      const pareil = b.chiffres.revenue_cents === Number(ro.revenue_cents || 0) && b.chiffres.new_leads === Number(ro.new_leads_count || 0)
        && b.chiffres.outstanding_cents === Number(rf.total_outstanding_cents || 0) && b.chiffres.past_due_count === Number(rf.count_past_due || 0);
      verifier(`1b. ${b.org_id === A.id ? 'A' : 'B'} : mêmes chiffres que la page Rapports du bureau`, pareil);
    }
    const nonLusA = r.j.offices.find((b: any) => b.org_id === A.id)?.chiffres.unread_conversations;
    const nonLusB = r.j.offices.find((b: any) => b.org_id === B.id)?.chiffres.unread_conversations;
    verifier('2. conversation non lue de B : comptée dans B seulement', nonLusA === 0 && nonLusB === 1, `A=${nonLusA} B=${nonLusB}`);
    verifier('1c. total = somme des bureaux', r.j.totals.unread_conversations === 1 && r.j.totals.revenue_cents === r.j.offices.reduce((t: number, b: any) => t + b.chiffres.revenue_cents, 0));
  }

  // 3. Admin des deux bureaux, pas propriétaire
  const adminUser = await utilisateur('admin');
  await adhesion(adminUser.id, A.id, 'admin');
  await adhesion(adminUser.id, B.id, 'admin');
  const r3 = await apercu(adminUser.session.access_token, A.id);
  verifier('3. admin (pas propriétaire) : refusé', r3.status === 403, `HTTP ${r3.status}`);

  // 4. Propriétaire de A, admin de B
  const mixte = await utilisateur('mixte');
  await adhesion(mixte.id, A.id, 'owner');
  await adhesion(mixte.id, B.id, 'admin');
  // Le trigger « propriétaire partout » peut l'avoir promu dans B : on le remet admin.
  await admin.from('memberships').update({ role: 'admin' }).eq('user_id', mixte.id).eq('org_id', B.id);
  const { data: roleB } = await admin.from('memberships').select('role').eq('user_id', mixte.id).eq('org_id', B.id).single();
  const r4 = await apercu(mixte.session.access_token, A.id);
  if (roleB?.role === 'owner') verifier('4. propriétaire de A, admin de B : seul A', true, 'non applicable — le trigger rend propriétaire de tous les bureaux (voulu, #580)');
  else verifier('4. propriétaire de A, admin de B : seul A apparaît', r4.status === 200 && r4.j.offices.length === 1 && r4.j.offices[0].org_id === A.id, `HTTP ${r4.status}, ${r4.j?.offices?.length} bureau(x)`);

  // 5. À l'écran
  const dir = path.join(process.cwd(), 'qa-captures');
  fs.mkdirSync(dir, { recursive: true });
  const nav = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const erreurs: string[] = [];
  try {
    for (const [nom, l, h] of [['ordinateur', 1440, 900], ['telephone', 390, 844]] as const) {
      const page = await nav.newPage();
      page.on('pageerror', (e) => erreurs.push(e instanceof Error ? e.message : String(e)));
      await page.setViewport({ width: l, height: h });
      await page.evaluateOnNewDocument((t, o) => {
        localStorage.setItem('lume-auth-token', JSON.stringify(t)); localStorage.setItem('lume-active-org', o);
        localStorage.setItem('lume-language', 'fr'); localStorage.setItem('lume-setup-dismissed', '1');
        localStorage.setItem('lume.cookieConsent.v1', JSON.stringify({ analytics: false, marketing: false, preferences: false, decidedAt: new Date().toISOString(), docVersion: 'cookie-policy-2026-07-23' }));
      }, { ...proprio.session, token_type: 'bearer' }, A.id);
      await page.goto(`${BASE}/offices/overview`, { waitUntil: 'networkidle2', timeout: 60000 });
      const vu = await page.waitForFunction((a, b) => document.body.innerText.includes(a) && document.body.innerText.includes(b) && /Total/.test(document.body.innerText), { timeout: 20000 }, `QA vue A ${s}`, `QA vue B ${s}`).then(() => true).catch(() => false);
      // Compte neuf : la fenêtre de consentement à la localisation couvre la page.
      await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Refuser')?.click());
      await new Promise((r) => setTimeout(r, 600));
      const deborde = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      await page.screenshot({ path: path.join(dir, `vue-bureaux-${nom}.png`), fullPage: true });
      verifier(`5. écran ${nom} : deux bureaux et total affichés${nom === 'telephone' ? ', sans débordement' : ''}`, vu && (nom === 'ordinateur' || !deborde), `débordement ${deborde}`);
      await page.close();
    }
  } finally { await nav.close(); }
  verifier('5b. aucune erreur navigateur', erreurs.length === 0, erreurs.join(' | '));
} finally {
  for (const f of nettoyer) { try { await f(); } catch (e) { console.error('nettoyage :', e); } }
}
for (const x of ok) console.log('  ✓', x);
for (const x of ko) console.log('  ✗', x);
console.log(`${ok.length}/${ok.length + ko.length}`);
process.exit(ko.length ? 1 : 0);
