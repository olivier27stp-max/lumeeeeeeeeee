/**
 * verifier-ma-paie-tech.mjs — un technicien (ou un rep) voit sa carte
 * « Période de paie actuelle » dans Feuilles de temps ; un gestionnaire, non
 * (il a déjà la page Paie).
 *
 *   FRONTEND_URL=http://127.0.0.1:5174 node --env-file=.env.local scripts/qa/verifier-ma-paie-tech.mjs
 *
 * Staging seulement : passe temporairement le compte QA en technicien à
 * 25 $/h, puis remet tout.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import puppeteer from 'puppeteer';

const URL_SB = process.env.VITE_SUPABASE_URL;
const BASE = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
const COMPTE = process.env.QA_COMPTE || 'willhebert30@gmail.com';
if (process.env.SUPABASE_PROJECT_REF_PROD && URL_SB.includes(process.env.SUPABASE_PROJECT_REF_PROD)) {
  console.error('REFUS : ce banc écrit. La cible est la PRODUCTION.'); process.exit(2);
}
const admin = createClient(URL_SB, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const anon = createClient(URL_SB, process.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const resultats = [];
const ok = (nom, vrai, detail = '') => { resultats.push(!!vrai); console.log(`  ${vrai ? '✓' : '✗'} ${nom}${detail ? ' — ' + detail : ''}`); return !!vrai; };
const dodo = (ms) => new Promise((r) => setTimeout(r, ms));
const dir = path.join(process.cwd(), 'qa-captures'); fs.mkdirSync(dir, { recursive: true });

const { data: l } = await admin.auth.admin.generateLink({ type: 'magiclink', email: COMPTE });
const { data: s } = await anon.auth.verifyOtp({ token_hash: l.properties.hashed_token, type: 'magiclink' });
const { data: m } = await admin.from('memberships').select('org_id, role').eq('user_id', s.user.id).eq('status', 'active').limit(1).maybeSingle();
const orgId = m.org_id;
const jeton = { access_token: s.session.access_token, refresh_token: s.session.refresh_token, expires_at: s.session.expires_at, expires_in: s.session.expires_in, token_type: 'bearer', user: s.user };
const { data: tm } = await admin.from('team_members').select('id, role, compensation_mode, hourly_rate_cents').eq('org_id', orgId).eq('user_id', s.user.id).limit(1).maybeSingle();
console.log(`Org ${orgId.slice(0, 8)} — rôle membership ${m.role}, team_members ${tm.role}, mode ${tm.compensation_mode}`);

const nav = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
async function ouvrir() {
  const ctx = await nav.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  await page.evaluateOnNewDocument((t, o) => {
    localStorage.setItem('lume-auth-token', JSON.stringify(t)); localStorage.setItem('lume-active-org', o); localStorage.setItem('lume-language', 'fr');
    localStorage.setItem('lume.cookieConsent.v1', JSON.stringify({ analytics: false, marketing: false, preferences: false, decidedAt: new Date().toISOString(), docVersion: 'cookie-policy-2026-07-23' }));
    localStorage.setItem('lume-setup-dismissed', '1');
  }, jeton, orgId);
  await page.goto(BASE + '/timesheets', { waitUntil: 'networkidle2', timeout: 60000 });
  await dodo(2500);
  return page;
}

try {
  console.log('\n1. Gestionnaire (rôle actuel) — pas de carte, il a la page Paie');
  const p1 = await ouvrir();
  const t1 = await p1.evaluate(() => document.body.innerText);
  ok('page Feuilles de temps chargée', /Feuilles de temps/.test(t1));
  ok('aucune carte « Période de paie » pour le gestionnaire', !/Période de paie actuelle/.test(t1));
  await p1.browserContext().close();

  console.log('\n2. Technicien à 25 $/h — la carte apparaît');
  await admin.from('memberships').update({ role: 'technician' }).eq('user_id', s.user.id).eq('org_id', orgId);
  await admin.from('team_members').update({ role: 'technician', compensation_mode: 'hourly', hourly_rate_cents: 2500 }).eq('id', tm.id);
  const p2 = await ouvrir();
  const t2 = await p2.evaluate(() => document.body.innerText);
  ok('carte « Période de paie actuelle » présente', /Période de paie actuelle/.test(t2));
  ok('mode « Payé à l’heure » et 25,00 $/h', /Payé à l.heure/.test(t2) && /25,00\/h|\$25,00\/h/.test(t2));
  ok('tuiles Heures travaillées + Salaire horaire', /Heures travaillées/i.test(t2) && /Salaire horaire/i.test(t2));
  ok('pas de section commission pour un horaire sans commission', !/Commission à venir/i.test(t2));
  const carte = await p2.evaluateHandle(() => [...document.querySelectorAll('.glass-card')].find((e) => /Période de paie/i.test(e.innerText)));
  if (carte.asElement()) await carte.asElement().screenshot({ path: path.join(dir, 'ma-paie-tech.png') });
  await p2.browserContext().close();
} finally {
  await nav.close();
  await admin.from('memberships').update({ role: m.role }).eq('user_id', s.user.id).eq('org_id', orgId);
  await admin.from('team_members').update({ role: tm.role, compensation_mode: tm.compensation_mode, hourly_rate_cents: tm.hourly_rate_cents }).eq('id', tm.id);
  console.log(`\nRemis : rôle ${m.role}, mode ${tm.compensation_mode}, taux ${tm.hourly_rate_cents} ¢`);
}
const echecs = resultats.filter((r) => !r).length;
console.log(`\n${resultats.length - echecs}/${resultats.length} vérifications passent`);
process.exit(echecs ? 1 : 0);
