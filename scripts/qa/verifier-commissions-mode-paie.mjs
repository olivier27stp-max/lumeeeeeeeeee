/**
 * verifier-commissions-mode-paie.mjs — la page Commissions relie la fiche
 * Équipe (mode de paie, taux horaire, plan) et la paie de la période :
 * à l'heure, à commission ou les deux, le membre voit tout au même endroit.
 *
 *   FRONTEND_URL=http://127.0.0.1:5174 node --env-file=.env.local scripts/qa/verifier-commissions-mode-paie.mjs
 *
 * Staging seulement. Écrit le mode/taux du compte QA puis les remet.
 * Express (3002) et Vite doivent tourner.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import puppeteer from 'puppeteer';

const URL_SB = process.env.VITE_SUPABASE_URL;
const API = (process.env.API_URL || 'http://localhost:3002').replace(/\/$/, '');
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
const { data: m } = await admin.from('memberships').select('org_id').eq('user_id', s.user.id).eq('status', 'active').limit(1).maybeSingle();
const orgId = m.org_id;
const entetes = { Authorization: `Bearer ${s.session.access_token}`, 'x-org-id': orgId };
const jeton = { access_token: s.session.access_token, refresh_token: s.session.refresh_token, expires_at: s.session.expires_at, expires_in: s.session.expires_in, token_type: 'bearer', user: s.user };

const { data: moi } = await admin.from('team_members').select('id, first_name, compensation_mode, hourly_rate_cents, labour_cost_hourly').eq('org_id', orgId).eq('user_id', s.user.id).limit(1).maybeSingle();
console.log(`Org ${orgId.slice(0, 8)} — ${moi.first_name} : mode ${moi.compensation_mode}, taux ${moi.hourly_rate_cents} ¢`);

async function periode() {
  const r = await fetch(`${API}/api/payroll/current-period`, { headers: entetes });
  const j = await r.json();
  if (!r.ok) throw new Error(`${r.status} ${JSON.stringify(j).slice(0, 200)}`);
  return j;
}
const setMode = (mode, rate) => admin.from('team_members').update({ compensation_mode: mode, hourly_rate_cents: rate }).eq('id', moi.id);

let nav = null;
try {
  console.log('\n1. API current-period — mode « horaire », 25 $/h');
  await setMode('hourly', 2500);
  const h = await periode();
  ok('pay.compensation_mode = hourly', h.pay?.compensation_mode === 'hourly', JSON.stringify(h.pay));
  ok('pay.hourly_rate_cents = 2500', h.pay?.hourly_rate_cents === 2500);
  ok('pay.gross_cents = heures × taux', h.pay?.gross_cents === Math.round(h.hours * 2500), `${h.hours} h → ${h.pay?.gross_cents} ¢`);
  ok('pas d’alerte de plan en mode horaire', h.pay?.commission_plan_missing === false);

  console.log('\n2. API current-period — mode « commission » sans plan');
  await setMode('commission', 0);
  const c = await periode();
  ok('pay.compensation_mode = commission', c.pay?.compensation_mode === 'commission');
  ok('alerte : aucun plan de commission', c.pay?.commission_plan_missing === true);

  console.log('\n3. API current-period — mode « horaire + commission »');
  await setMode('both', 3000);
  const b = await periode();
  ok('pay.compensation_mode = both', b.pay?.compensation_mode === 'both');
  ok('taux 30 $/h conservé', b.pay?.hourly_rate_cents === 3000);
  ok('alerte de plan présente (aucune règle sur staging)', b.pay?.commission_plan_missing === true);

  console.log('\n4. Page Commissions (mode « horaire + commission ») — captures');
  nav = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await nav.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  await page.evaluateOnNewDocument((t, o) => {
    localStorage.setItem('lume-auth-token', JSON.stringify(t)); localStorage.setItem('lume-active-org', o); localStorage.setItem('lume-language', 'fr');
    localStorage.setItem('lume.cookieConsent.v1', JSON.stringify({ analytics: false, marketing: false, preferences: false, decidedAt: new Date().toISOString(), docVersion: 'cookie-policy-2026-07-23' }));
    localStorage.setItem('lume-setup-dismissed', '1');
  }, jeton, orgId);
  await page.goto(BASE + '/commissions', { waitUntil: 'networkidle2', timeout: 60000 });
  await dodo(1500);
  // Onglet « Mes commissions » : la carte de paie du membre connecté.
  const cliquerOnglet = async (re) => {
    const h = await page.evaluateHandle((src) => [...document.querySelectorAll('button, a, [role=tab]')].find((e) => new RegExp(src, 'i').test(e.innerText.trim())), re);
    const el = h.asElement(); if (!el) return false; await el.click(); await dodo(1500); return true;
  };
  ok('onglet « Mes commissions » trouvé', await cliquerOnglet('^(Mes commissions|Ma commission|My commissions?)$'));
  const texte = await page.evaluate(() => document.body.innerText);
  ok('la carte affiche « Horaire + commission »', /Horaire \+ commission/.test(texte));
  ok('la carte affiche « Salaire horaire » et « Commission à venir »', /Salaire horaire/i.test(texte) && /Commission à venir/i.test(texte));
  ok('la carte affiche « Total prévu sur la prochaine paie »', /Total prévu sur la prochaine paie/.test(texte));
  ok('la carte affiche l’alerte « Aucun plan de commission »', /Aucun plan de commission/.test(texte));
  const carte = await page.evaluateHandle(() => [...document.querySelectorAll('.glass-card')].find((e) => /Période de paie/i.test(e.innerText)));
  if (carte.asElement()) await carte.asElement().screenshot({ path: path.join(dir, 'commissions-carte-paie.png') });

  ok('onglet « Taux » trouvé', await cliquerOnglet('^(Taux|Rates|Plans?)$'));
  const texteTaux = await page.evaluate(() => document.body.innerText);
  ok('colonnes « Mode de paie » et « Taux horaire » présentes', /Mode de paie/.test(texteTaux) && /Taux horaire/.test(texteTaux));
  ok('mon mode « Horaire + commission » et 30,00 $/h affichés', /Horaire \+ commission/.test(texteTaux) && /30,00 \$\/h/.test(texteTaux));
  ok('alerte « Aucun plan » sur ma ligne', /Aucun plan : aucune commission ne sera calculée/.test(texteTaux));
  await page.screenshot({ path: path.join(dir, 'commissions-onglet-taux.png'), fullPage: true });
} finally {
  if (nav) await nav.close();
  await admin.from('team_members').update({ compensation_mode: moi.compensation_mode, hourly_rate_cents: moi.hourly_rate_cents }).eq('id', moi.id);
  console.log(`\nRemis : ${moi.first_name} en mode ${moi.compensation_mode}, taux ${moi.hourly_rate_cents} ¢`);
}
const echecs = resultats.filter((r) => !r).length;
console.log(`\n${resultats.length - echecs}/${resultats.length} vérifications passent`);
process.exit(echecs ? 1 : 0);
