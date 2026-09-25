/**
 * Assigner une conversation — prouvé contre staging (entreprise fictive à 2 bureaux).
 *
 *   node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/qa/bureaux-assignation.mts
 *   (API locale :3188, Vite :5288 — API_URL_QA / FRONTEND_URL_QA pour changer)
 *
 *   1. La boîte liste, par bureau, les personnes assignables (messages.read dans ce bureau).
 *   2. Assigner à un membre de A : enregistré ; désassigner : null.
 *   3. Assigner à quelqu'un du bureau B seulement : refusé (API), et la base le refuse aussi (clé étrangère).
 *   4. Assigner à un membre de A sans messages.read : refusé.
 *   5. Sans messages.send : assigner est refusé (403).
 *   6. À l'écran : choisir la personne dans le fil, badge sur la conversation, filtre « À moi ».
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

async function utilisateur(etiquette: string, nom: string) {
  const courriel = `qa.assign.${etiquette}.${s}@exemple.invalid`;
  const mdp = crypto.randomBytes(18).toString('base64url');
  const { data, error } = await admin.auth.admin.createUser({ email: courriel, password: mdp, email_confirm: true });
  if (error || !data.user) throw error ?? new Error('utilisateur');
  nettoyer.unshift(() => admin.auth.admin.deleteUser(data.user!.id));
  await admin.from('profiles').upsert({ id: data.user.id, full_name: nom });
  const anon = createClient(url, ANON, { auth: { persistSession: false } });
  const { data: sess, error: eS } = await anon.auth.signInWithPassword({ email: courriel, password: mdp });
  if (eS || !sess.session) throw eS ?? new Error('session');
  return { id: data.user.id, session: sess.session };
}
async function adhesion(user: string, org: string, role: string, extra: Record<string, unknown> = {}) {
  const { error } = await admin.from('memberships').upsert({ user_id: user, org_id: org, role, status: 'active', ...extra }, { onConflict: 'user_id,org_id' });
  if (error) throw new Error(`adhésion : ${error.message}`);
}
const api = async (jeton: string, bureau: string, chemin: string, method = 'GET', corps?: unknown) => {
  const r = await fetch(`${API}${chemin}`, {
    method,
    headers: { Authorization: `Bearer ${jeton}`, 'x-org-id': bureau, ...(corps ? { 'Content-Type': 'application/json' } : {}) },
    ...(corps ? { body: JSON.stringify(corps) } : {}),
  });
  return { status: r.status, j: await r.json().catch(() => null) as any };
};
const assigne = async (id: string) => (await admin.from('conversations').select('assigned_to').eq('id', id).single()).data?.assigned_to ?? null;

try {
  const proprio = await utilisateur('proprio', `Proprio ${s}`);
  const collegue = await utilisateur('collegue', `Collègue ${s}`);
  const deB = await utilisateur('deb', `Seulement B ${s}`);
  const sansLire = await utilisateur('sanslire', `Sans lire ${s}`);
  const sansEnvoyer = await utilisateur('sansenvoyer', `Sans envoyer ${s}`);
  const { data: A, error: eA } = await admin.from('orgs').insert({ name: `QA assign A ${s}`, created_by: proprio.id }).select('id, company_group_id').single();
  if (eA) throw eA;
  const { data: B, error: eB } = await admin.from('orgs').insert({ name: `QA assign B ${s}`, created_by: proprio.id, company_group_id: A.company_group_id }).select('id').single();
  if (eB) throw eB;
  nettoyer.unshift(() => admin.from('orgs').delete().in('id', [A.id, B.id]));
  nettoyer.unshift(() => admin.from('memberships').delete().in('org_id', [A.id, B.id]));
  await adhesion(proprio.id, A.id, 'owner', { created_at: new Date(Date.now() - 86400e3).toISOString() });
  await adhesion(proprio.id, B.id, 'owner');
  await adhesion(collegue.id, A.id, 'admin');
  await adhesion(deB.id, B.id, 'admin');
  await adhesion(sansLire.id, A.id, 'admin', { permissions: { 'messages.read': false } });
  await adhesion(sansEnvoyer.id, A.id, 'admin', { permissions: { 'messages.send': false } });
  const { data: plan } = await admin.from('plans').select('id').eq('includes_sms', true).limit(1).single();
  const { data: abo, error: eAbo } = await admin.from('subscriptions').insert({ user_id: proprio.id, org_id: A.id, plan_id: plan!.id, status: 'active' }).select('id').single();
  if (eAbo) throw eAbo;
  nettoyer.unshift(() => admin.from('subscriptions').delete().eq('id', abo!.id));

  const { data: conv, error: eC } = await admin.from('conversations').insert({ org_id: A.id, phone_number: '+15145550111', client_name: `Client assign ${s}`, unread_count: 0, last_message_text: 'Salut', last_message_at: new Date().toISOString() }).select('id').single();
  if (eC) throw eC;
  nettoyer.unshift(() => admin.from('conversations').delete().in('org_id', [A.id, B.id]));
  const jeton = proprio.session.access_token;
  const assigner = (tok: string, userId: string | null) => api(tok, A.id, `/api/messages/conversations/${conv.id}/assign`, 'PATCH', { assigned_to: userId });

  // 1
  const r1 = await api(jeton, A.id, '/api/messages/inbox');
  const membresA = (r1.j?.offices || []).find((o: any) => o.org_id === A.id)?.members?.map((m: any) => m.user_id) || [];
  verifier('1. personnes assignables de A : avec messages.read seulement',
    membresA.includes(proprio.id) && membresA.includes(collegue.id) && membresA.includes(sansEnvoyer.id) && !membresA.includes(sansLire.id) && !membresA.includes(deB.id),
    `${membresA.length} membre(s)`);

  // 2
  const r2 = await assigner(jeton, collegue.id);
  const a2 = await assigne(conv.id);
  const r2b = await assigner(jeton, null);
  const a2b = await assigne(conv.id);
  verifier('2. assigner puis désassigner', r2.status === 200 && a2 === collegue.id && r2b.status === 200 && a2b === null, `HTTP ${r2.status}/${r2b.status}`);

  // 3
  const r3 = await assigner(jeton, deB.id);
  const { error: eFk } = await admin.from('conversations').update({ assigned_to: deB.id }).eq('id', conv.id);
  verifier('3. quelqu’un du bureau B seulement : refusé par l’API et par la base', r3.status === 400 && (await assigne(conv.id)) === null && !!eFk,
    `HTTP ${r3.status}, base : ${eFk?.code ?? 'acceptée !'}`);

  // 4
  const r4 = await assigner(jeton, sansLire.id);
  verifier('4. membre de A sans messages.read : refusé', r4.status === 400 && (await assigne(conv.id)) === null, `HTTP ${r4.status}`);

  // 5
  const r5 = await assigner(sansEnvoyer.session.access_token, collegue.id);
  verifier('5. sans messages.send : refusé', r5.status === 403 && (await assigne(conv.id)) === null, `HTTP ${r5.status}`);

  // 6. À l'écran
  const dir = path.join(process.cwd(), 'qa-captures');
  fs.mkdirSync(dir, { recursive: true });
  const nav = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const erreurs: string[] = [];
  try {
    const page = await nav.newPage();
    page.on('pageerror', (e) => erreurs.push(e instanceof Error ? e.message : String(e)));
    await page.setViewport({ width: 1440, height: 900 });
    await page.evaluateOnNewDocument((t, o) => {
      localStorage.setItem('lume-auth-token', JSON.stringify(t)); localStorage.setItem('lume-active-org', o);
      localStorage.setItem('lume-language', 'fr'); localStorage.setItem('lume-setup-dismissed', '1');
      localStorage.setItem('lume.cookieConsent.v1', JSON.stringify({ analytics: false, marketing: false, preferences: false, decidedAt: new Date().toISOString(), docVersion: 'cookie-policy-2026-07-23' }));
    }, { ...proprio.session, token_type: 'bearer' }, A.id);
    await page.goto(`${BASE}/messages`, { waitUntil: 'networkidle2', timeout: 60000 });
    await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Refuser')?.click());
    const liste = await page.waitForFunction((n) => document.body.innerText.includes(n), { timeout: 20000 }, `Client assign ${s}`).then(() => true).catch(() => false);
    await page.evaluate((n) => ([...document.querySelectorAll('button')].find((b) => (b.textContent || '').includes(n)) as HTMLButtonElement | undefined)?.click(), `Client assign ${s}`);
    const choix = await page.waitForSelector('select[aria-label="Assigner la conversation"]', { timeout: 10000 }).then(() => true).catch(() => false);
    await page.select('select[aria-label="Assigner la conversation"]', proprio.id);
    let enBase: string | null = null;
    for (let i = 0; i < 20 && enBase !== proprio.id; i++) { enBase = await assigne(conv.id); if (enBase !== proprio.id) await new Promise((r) => setTimeout(r, 400)); }
    const badge = await page.waitForFunction(() => [...document.querySelectorAll('span')].some((sp) => sp.textContent === 'Moi'), { timeout: 5000 }).then(() => true).catch(() => false);
    await page.evaluate(() => ([...document.querySelectorAll('[role="group"] button')].find((b) => (b.textContent || '').startsWith('À moi')) as HTMLButtonElement | undefined)?.click());
    const filtre = await page.waitForFunction((n) => document.body.innerText.includes(n) && [...document.querySelectorAll('[role="group"] button')].some((b) => b.getAttribute('aria-pressed') === 'true' && (b.textContent || '').startsWith('À moi')), { timeout: 5000 }, `Client assign ${s}`).then(() => true).catch(() => false);
    await page.screenshot({ path: path.join(dir, 'assignation-ordinateur.png') });
    verifier('6. écran : choisir la personne, badge « Moi », filtre « À moi »', liste && choix && enBase === proprio.id && badge && filtre,
      `liste ${liste}, choix ${choix}, en base ${enBase === proprio.id}, badge ${badge}, filtre ${filtre}`);
    await page.close();
  } finally { await nav.close(); }
  verifier('6b. aucune erreur navigateur', erreurs.length === 0, erreurs.join(' | '));
} finally {
  for (const f of nettoyer) { try { await f(); } catch (e) { console.error('nettoyage :', e); } }
}
for (const x of ok) console.log('  ✓', x);
for (const x of ko) console.log('  ✗', x);
console.log(`${ok.length}/${ok.length + ko.length}`);
process.exit(ko.length ? 1 : 0);
