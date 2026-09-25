/**
 * Boîte de réception unifiée — prouvée contre staging (entreprise fictive à 2 bureaux).
 *
 *   node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/qa/bureaux-boite-unifiee.mts
 *   (API locale :3188, Vite :5288 — API_URL_QA / FRONTEND_URL_QA pour changer)
 *
 *   1. Membre de A et B : les conversations des deux bureaux, chacune avec son bureau.
 *   2. Fil d'une conversation de B, depuis A actif (x-org-id = B) : lu ; « lu » remet B à 0.
 *   3. Membre de A seulement : B n'apparaît pas ; lire le fil de B = 403.
 *   4. Membre des deux mais messages.read retiré dans B (page Rôles) : B n'apparaît pas ; fil de B = 403.
 *   5. À l'écran (ordinateur et téléphone) : filtres par bureau, badge, le fil de B s'ouvre, sans erreur.
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
  const courriel = `qa.boite.${etiquette}.${s}@exemple.invalid`;
  const mdp = crypto.randomBytes(18).toString('base64url');
  const { data, error } = await admin.auth.admin.createUser({ email: courriel, password: mdp, email_confirm: true });
  if (error || !data.user) throw error ?? new Error('utilisateur');
  nettoyer.unshift(() => admin.auth.admin.deleteUser(data.user!.id));
  const anon = createClient(url, ANON, { auth: { persistSession: false } });
  const { data: sess, error: eS } = await anon.auth.signInWithPassword({ email: courriel, password: mdp });
  if (eS || !sess.session) throw eS ?? new Error('session');
  return { id: data.user.id, session: sess.session };
}
async function adhesion(user: string, org: string, role: string, extra: Record<string, unknown> = {}) {
  const { error } = await admin.from('memberships').upsert({ user_id: user, org_id: org, role, status: 'active', ...extra }, { onConflict: 'user_id,org_id' });
  if (error) throw new Error(`adhésion : ${error.message}`);
}
const api = async (jeton: string, bureau: string, chemin: string, method = 'GET') => {
  const r = await fetch(`${API}${chemin}`, { method, headers: { Authorization: `Bearer ${jeton}`, 'x-org-id': bureau } });
  return { status: r.status, j: await r.json().catch(() => null) as any };
};

try {
  const proprio = await utilisateur('proprio');
  const { data: A, error: eA } = await admin.from('orgs').insert({ name: `QA boite A ${s}`, created_by: proprio.id }).select('id, company_group_id').single();
  if (eA) throw eA;
  const { data: B, error: eB } = await admin.from('orgs').insert({ name: `QA boite B ${s}`, created_by: proprio.id, company_group_id: A.company_group_id }).select('id').single();
  if (eB) throw eB;
  nettoyer.unshift(() => admin.from('orgs').delete().in('id', [A.id, B.id]));
  nettoyer.unshift(() => admin.from('memberships').delete().in('org_id', [A.id, B.id]));
  await adhesion(proprio.id, A.id, 'owner', { created_at: new Date(Date.now() - 86400e3).toISOString() });
  await adhesion(proprio.id, B.id, 'owner');
  // Abonnement du groupe porté par A (sinon le paywall répond 402 partout).
  const { data: plan } = await admin.from('plans').select('id').eq('includes_sms', true).limit(1).single();
  const { data: abo, error: eAbo } = await admin.from('subscriptions').insert({ user_id: proprio.id, org_id: A.id, plan_id: plan!.id, status: 'active' }).select('id').single();
  if (eAbo) throw eAbo;
  nettoyer.unshift(() => admin.from('subscriptions').delete().eq('id', abo!.id));

  // Une conversation par bureau, celle de B non lue avec un message.
  const conv = async (org: string, tel: string, nom: string, nonLus: number, texte: string) => {
    const { data, error } = await admin.from('conversations').insert({ org_id: org, phone_number: tel, client_name: nom, unread_count: nonLus, last_message_text: texte, last_message_at: new Date().toISOString() }).select('id').single();
    if (error) throw error;
    const { error: eM } = await admin.from('messages').insert({ conversation_id: data.id, org_id: org, phone_number: tel, direction: 'inbound', message_text: texte, status: 'received' });
    if (eM) throw eM;
    return data.id as string;
  };
  nettoyer.unshift(() => admin.from('conversations').delete().in('org_id', [A.id, B.id]));
  nettoyer.unshift(() => admin.from('messages').delete().in('org_id', [A.id, B.id]));
  const convA = await conv(A.id, '+15145550101', `Client A ${s}`, 0, 'Bonjour bureau A');
  const convB = await conv(B.id, '+15145550102', `Client B ${s}`, 2, `Question pour B ${s}`);

  // 1
  const r1 = await api(proprio.session.access_token, A.id, '/api/messages/inbox');
  const ids = (r1.j?.conversations || []).map((c: any) => c.id);
  const bureauDe = (id: string) => r1.j?.conversations?.find((c: any) => c.id === id)?.office_name;
  verifier('1. membre de A et B : conversations des deux bureaux', r1.status === 200 && ids.includes(convA) && ids.includes(convB) && r1.j.offices.length === 2, `HTTP ${r1.status}, ${ids.length} conv.`);
  verifier('1b. chaque conversation porte son bureau', bureauDe(convA) === `QA boite A ${s}` && bureauDe(convB) === `QA boite B ${s}`, `${bureauDe(convA)} / ${bureauDe(convB)}`);

  // 2
  const r2 = await api(proprio.session.access_token, B.id, `/api/messages/conversations/${convB}/messages`);
  verifier('2. fil de B lu avec l’en-tête de B', r2.status === 200 && r2.j?.[0]?.message_text === `Question pour B ${s}`, `HTTP ${r2.status}`);
  const r2b = await api(proprio.session.access_token, A.id, `/api/messages/conversations/${convB}/messages`);
  verifier('2b. fil de B demandé avec l’en-tête de A : vide (jamais mélangé)', r2b.status === 200 && r2b.j?.length === 0, `HTTP ${r2b.status}, ${r2b.j?.length}`);
  const r2c = await api(proprio.session.access_token, B.id, `/api/messages/conversations/${convB}/read`, 'POST');
  const { data: apres } = await admin.from('conversations').select('unread_count').eq('id', convB).single();
  verifier('2c. « lu » remet la conversation de B à 0', r2c.status === 200 && apres?.unread_count === 0, `HTTP ${r2c.status}, non lus ${apres?.unread_count}`);
  await admin.from('conversations').update({ unread_count: 2 }).eq('id', convB);

  // 3
  const seulA = await utilisateur('seula');
  await adhesion(seulA.id, A.id, 'admin');
  const r3 = await api(seulA.session.access_token, A.id, '/api/messages/inbox');
  const ids3 = (r3.j?.conversations || []).map((c: any) => c.id);
  verifier('3. membre de A seulement : B absent', r3.status === 200 && ids3.includes(convA) && !ids3.includes(convB), `HTTP ${r3.status}`);
  const r3b = await api(seulA.session.access_token, B.id, `/api/messages/conversations/${convB}/messages`);
  verifier('3b. membre de A seulement : fil de B refusé', r3b.status === 403, `HTTP ${r3b.status}`);

  // 4
  const sansDroitB = await utilisateur('sansdroitb');
  await adhesion(sansDroitB.id, A.id, 'admin');
  await adhesion(sansDroitB.id, B.id, 'admin', { permissions: { 'messages.read': false } });
  const { data: roleB } = await admin.from('memberships').select('role, permissions').eq('user_id', sansDroitB.id).eq('org_id', B.id).single();
  const r4 = await api(sansDroitB.session.access_token, A.id, '/api/messages/inbox');
  const ids4 = (r4.j?.conversations || []).map((c: any) => c.id);
  verifier('4. messages.read retiré dans B : B absent de la boîte', r4.status === 200 && ids4.includes(convA) && !ids4.includes(convB), `HTTP ${r4.status}, rôle B ${roleB?.role}`);
  const r4b = await api(sansDroitB.session.access_token, B.id, `/api/messages/conversations/${convB}/messages`);
  verifier('4b. messages.read retiré dans B : fil de B refusé', r4b.status === 403, `HTTP ${r4b.status}`);

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
      await page.goto(`${BASE}/messages`, { waitUntil: 'networkidle2', timeout: 60000 });
      const vu = await page.waitForFunction((a, b) => document.body.innerText.includes(a) && document.body.innerText.includes(b) && document.body.innerText.includes('Tous les bureaux'), { timeout: 20000 }, `Client A ${s}`, `Client B ${s}`).then(() => true).catch(() => false);
      await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Refuser')?.click());
      await new Promise((r) => setTimeout(r, 400));
      // Filtre « B » : seule la conversation de B reste.
      await page.evaluate((n) => [...document.querySelectorAll('[role="group"] button')].find((b) => (b.textContent || '').startsWith(n))?.dispatchEvent(new MouseEvent('click', { bubbles: true })), `QA boite B ${s}`);
      const filtre = await page.waitForFunction((a, b) => !document.body.innerText.includes(a) && document.body.innerText.includes(b), { timeout: 5000 }, `Client A ${s}`, `Client B ${s}`).then(() => true).catch(() => false);
      // Ouvrir la conversation de B : le fil de B s'affiche.
      await page.evaluate((n) => [...document.querySelectorAll('button')].find((b) => (b.textContent || '').includes(n))?.dispatchEvent(new MouseEvent('click', { bubbles: true })), `Client B ${s}`);
      const fil = await page.waitForFunction((t) => [...document.querySelectorAll('p.whitespace-pre-wrap')].some((p) => p.textContent === t) && document.body.innerText.includes('via QA boite B'), { timeout: 15000 }, `Question pour B ${s}`).then(() => true).catch(() => false);
      let nonLus = -1;
      for (let i = 0; i < 20 && nonLus !== 0; i++) {
        nonLus = (await admin.from('conversations').select('unread_count').eq('id', convB).single()).data?.unread_count ?? -1;
        if (nonLus !== 0) await new Promise((r) => setTimeout(r, 500));
      }
      verifier(`5c. écran ${nom} : ouvrir la conversation de B depuis A la marque lue`, nonLus === 0, `non lus ${nonLus}`);
      await admin.from('conversations').update({ unread_count: 2 }).eq('id', convB);
      const deborde = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      await page.screenshot({ path: path.join(dir, `boite-unifiee-${nom}.png`) });
      verifier(`5. écran ${nom} : les deux bureaux, filtre, fil de B ouvert${nom === 'telephone' ? ', sans débordement' : ''}`, vu && filtre && fil && (nom === 'ordinateur' || !deborde), `liste ${vu}, filtre ${filtre}, fil ${fil}, débordement ${deborde}`);
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
