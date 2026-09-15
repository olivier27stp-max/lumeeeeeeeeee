/**
 * Capture du tiroir d'aide (Lumi dans l'app) — pour vérifier soi-même le rendu
 * après un changement d'interface, sans demander à Rafba d'ouvrir l'app.
 *
 *   FRONTEND_URL=http://localhost:5199 node --env-file=.env.local scripts/qa/capture-tiroir-aide.mjs
 *
 * Session : lien magique du compte QA (staging), jeton posé dans localStorage
 * comme dans boutons-atteignables.mjs. Captures dans qa-captures/tiroir-aide-*.png.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import puppeteer from 'puppeteer';

const BASE = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
const COMPTE = process.env.QA_COMPTE || 'willhebert30@gmail.com';
const admin = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const anon = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const { data: l } = await admin.auth.admin.generateLink({ type: 'magiclink', email: COMPTE });
const { data: s } = await anon.auth.verifyOtp({ token_hash: l.properties.hashed_token, type: 'magiclink' });
const { data: m } = await admin.from('memberships').select('org_id').eq('user_id', s.user.id).eq('status', 'active').limit(1).maybeSingle();
const jeton = { access_token: s.session.access_token, refresh_token: s.session.refresh_token, expires_at: s.session.expires_at, expires_in: s.session.expires_in, token_type: 'bearer', user: s.user };

const dir = path.join(process.cwd(), 'qa-captures'); fs.mkdirSync(dir, { recursive: true });
const nav = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
for (const vp of [{ nom: 'ordinateur', width: 1440, height: 900 }, { nom: 'telephone', width: 390, height: 844, mobile: true }]) {
  const ctx = await nav.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: vp.width, height: vp.height, isMobile: !!vp.mobile, hasTouch: !!vp.mobile, deviceScaleFactor: vp.mobile ? 2 : 1 });
  await page.evaluateOnNewDocument((t, o) => {
    localStorage.setItem('lume-auth-token', JSON.stringify(t)); localStorage.setItem('lume-active-org', o); localStorage.setItem('lume-language', 'fr');
    localStorage.setItem('lume.cookieConsent.v1', JSON.stringify({ analytics: false, marketing: false, preferences: false, decidedAt: new Date().toISOString(), docVersion: 'cookie-policy-2026-07-23' }));
    localStorage.setItem('lume-setup-dismissed', '1');
  }, jeton, m.org_id);
  await page.goto(BASE + '/clients', { waitUntil: 'networkidle2', timeout: 90000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 1500));
  const fab = await page.$('button[aria-label="Aide et support"]');
  if (!fab) { console.log(`${vp.nom} : bouton d'aide introuvable`); await page.screenshot({ path: path.join(dir, `tiroir-aide-${vp.nom}-sans-fab.png`) }); await ctx.close(); continue; }
  await fab.click();
  await new Promise((r) => setTimeout(r, 1800));
  const f1 = path.join(dir, `tiroir-aide-${vp.nom}.png`);
  await page.screenshot({ path: f1 });
  console.log(`${vp.nom} : ${f1}`);
  // Vue « Parcourir l'aide »
  const parcourir = await page.$$('button');
  for (const b of parcourir) { const t = await page.evaluate((el) => el.textContent || '', b); if (/Parcourir l.aide/.test(t)) { await b.click(); break; } }
  await new Promise((r) => setTimeout(r, 800));
  const f2 = path.join(dir, `tiroir-aide-${vp.nom}-articles.png`);
  await page.screenshot({ path: f2 });
  console.log(`${vp.nom} (articles) : ${f2}`);
  await ctx.close();
}
await nav.close();
