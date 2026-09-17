/**
 * verifier-reseaux-sociaux.mjs — la section « Réseaux sociaux » des
 * Paramètres de l'entreprise, de la saisie jusqu'aux pages publiques.
 *
 *   FRONTEND_URL=http://127.0.0.1:5174 node --env-file=.env.local scripts/qa/verifier-reseaux-sociaux.mjs
 *
 * 1. Saisie « instagram.com/x » sans protocole → enregistré en https://… ;
 * 2. rechargement : les valeurs reviennent ;
 * 3. un lien invalide bloque la sauvegarde (toast nommant le réseau) ;
 * 4. soumission / facture / contrat / paiement publics : les icônes sont là,
 *    avec les bonnes URL ; captures dans qa-captures/.
 * Remet la valeur d'origine à la fin.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import puppeteer from 'puppeteer';

const RACINE = process.cwd();
const BASE = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
const COMPTE = process.env.QA_COMPTE || 'willhebert30@gmail.com';
if (process.env.SUPABASE_PROJECT_REF_PROD && process.env.VITE_SUPABASE_URL.includes(process.env.SUPABASE_PROJECT_REF_PROD)) {
  console.error('REFUS : ce banc écrit des réglages. La cible est la PRODUCTION.'); process.exit(2);
}
const admin = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const anon = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const resultats = [];
const ok = (nom, vrai, detail = '') => { resultats.push({ nom, vrai: !!vrai }); console.log(`  ${vrai ? '✓' : '✗'} ${nom}${detail ? ' — ' + detail : ''}`); return !!vrai; };
const dodo = (ms) => new Promise((r) => setTimeout(r, ms));
const dir = path.join(RACINE, 'qa-captures'); fs.mkdirSync(dir, { recursive: true });

const { data: l } = await admin.auth.admin.generateLink({ type: 'magiclink', email: COMPTE });
const { data: s } = await anon.auth.verifyOtp({ token_hash: l.properties.hashed_token, type: 'magiclink' });
const { data: m } = await admin.from('memberships').select('org_id').eq('user_id', s.user.id).eq('status', 'active').limit(1).maybeSingle();
const orgId = m.org_id;
const jeton = { access_token: s.session.access_token, refresh_token: s.session.refresh_token, expires_at: s.session.expires_at, expires_in: s.session.expires_in, token_type: 'bearer', user: s.user };
const { data: avant } = await admin.from('company_settings').select('id, social_links').eq('org_id', orgId).maybeSingle();
console.log(`Organisation ${orgId} — valeur d'origine : ${JSON.stringify(avant?.social_links)}`);

const nav = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
async function pageConnectee() {
  const ctx = await nav.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluateOnNewDocument((t, o) => {
    localStorage.setItem('lume-auth-token', JSON.stringify(t)); localStorage.setItem('lume-active-org', o); localStorage.setItem('lume-language', 'fr');
    localStorage.setItem('lume.cookieConsent.v1', JSON.stringify({ analytics: false, marketing: false, preferences: false, decidedAt: new Date().toISOString(), docVersion: 'cookie-policy-2026-07-23' }));
    localStorage.setItem('lume-setup-dismissed', '1');
  }, jeton, orgId);
  return page;
}
const toasts = (page) => page.evaluate(() => [...document.querySelectorAll('[data-sonner-toast]')].map((e) => e.innerText.trim()));
async function cliquerEnregistrer(page) {
  const b = await page.evaluateHandle(() => [...document.querySelectorAll('button')].find((e) => /enregistrer|save/i.test(e.innerText) && !e.disabled));
  const el = b.asElement();
  if (!el) return false;
  await el.click(); await dodo(2500); return true;
}
const champ = (r) => `input[id$="-social-${r}"]`;
async function saisir(page, r, v) { await page.click(champ(r), { clickCount: 3 }); await page.keyboard.press('Backspace'); if (v) await page.type(champ(r), v); }

try {
  console.log('\n1. Paramètres de l’entreprise — la section existe et enregistre');
  const page = await pageConnectee();
  await page.goto(BASE + '/settings/company', { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForSelector(champ('instagram'), { timeout: 20000 });
  const nbChamps = await page.$$eval('input[id*="-social-"]', (els) => els.length);
  ok('six champs (Facebook, X, Instagram, Yelp, Angi, Google)', nbChamps === 6, `${nbChamps} champs`);
  const section = await page.evaluateHandle(() => document.querySelector('input[id$="-social-facebook"]').closest('.section-card'));
  await section.asElement().screenshot({ path: path.join(dir, 'reseaux-sociaux-section.png') });
  await saisir(page, 'instagram', 'www.instagram.com/visionlavage/');
  await saisir(page, 'facebook', 'https://www.facebook.com/visionlavage');
  await saisir(page, 'google_business', 'g.page/visionlavage');
  ok('le bouton Enregistrer est cliquable', await cliquerEnregistrer(page));
  const t1 = await toasts(page);
  ok('toast de succès', t1.some((t) => /enregistr/i.test(t)), t1.join(' | '));
  const { data: apres } = await admin.from('company_settings').select('social_links').eq('org_id', orgId).maybeSingle();
  ok('en base : Instagram normalisé en https://', apres?.social_links?.instagram === 'https://www.instagram.com/visionlavage/', JSON.stringify(apres?.social_links));
  ok('en base : Facebook conservé tel quel', apres?.social_links?.facebook === 'https://www.facebook.com/visionlavage');
  ok('en base : Google normalisé', apres?.social_links?.google_business === 'https://g.page/visionlavage');
  ok('en base : les champs vides ne sont pas stockés', !('x' in (apres?.social_links || {})) && !('yelp' in (apres?.social_links || {})));

  console.log('\n2. Rechargement — les valeurs reviennent');
  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForSelector(champ('instagram'), { timeout: 20000 });
  const relu = await page.$eval(champ('instagram'), (e) => e.value);
  ok('Instagram réaffiché avec https://', relu === 'https://www.instagram.com/visionlavage/', relu);

  console.log('\n3. Lien invalide — la sauvegarde est refusée');
  await saisir(page, 'x', 'pas une adresse');
  await cliquerEnregistrer(page);
  const t3 = await toasts(page);
  ok('toast « Lien X invalide »', t3.some((t) => /lien x invalide/i.test(t)), t3.join(' | '));
  const { data: intact } = await admin.from('company_settings').select('social_links').eq('org_id', orgId).maybeSingle();
  ok('rien n’a été écrit', !('x' in (intact?.social_links || {})));
  await page.browserContext().close();

  console.log('\n4. Pages publiques — les icônes apparaissent');
  const [q, inv, ctr, pr] = await Promise.all([
    admin.from('quotes').select('view_token').eq('org_id', orgId).is('deleted_at', null).not('view_token', 'is', null).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    admin.from('invoices').select('view_token').eq('org_id', orgId).is('deleted_at', null).not('view_token', 'is', null).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    admin.from('job_agreements').select('view_token').eq('org_id', orgId).is('deleted_at', null).not('view_token', 'is', null).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    admin.from('payment_requests').select('public_token').eq('org_id', orgId).is('deleted_at', null).in('status', ['pending', 'sent']).order('created_at', { ascending: false }).limit(1).maybeSingle(),
  ]);
  const pages = [
    ['soumission', q.data && `/quote/${q.data.view_token}`],
    ['facture', inv.data && `/invoice/${inv.data.view_token}`],
    ['contrat', ctr.data && `/contract/${ctr.data.view_token}`],
    ['paiement', pr.data && `/pay/${pr.data.public_token}`],
  ];
  for (const [nom, chemin] of pages) {
    if (!chemin) { ok(`${nom} : aucun document à ouvrir sur cette org`, false); continue; }
    const p = await (await nav.createBrowserContext()).newPage();
    await p.setViewport({ width: 1200, height: 900 });
    await p.goto(BASE + chemin, { waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {});
    await dodo(1500);
    const liens = await p.evaluate(() => [...document.querySelectorAll('nav[aria-label="Réseaux sociaux"] a')].map((a) => `${a.getAttribute('aria-label')}=${a.href}`));
    ok(`${nom} : 3 icônes au pied de page`, liens.length === 3, liens.join(', ') || `aucune (${chemin})`);
    const pied = await p.$('nav[aria-label="Réseaux sociaux"]');
    if (pied) { await pied.evaluate((e) => e.scrollIntoView()); await dodo(300); await p.screenshot({ path: path.join(dir, `reseaux-sociaux-${nom}.png`) }); }
    await p.browserContext().close();
  }
} finally {
  await nav.close();
  await admin.from('company_settings').update({ social_links: avant?.social_links ?? {} }).eq('id', avant.id);
  console.log(`\nValeur d'origine remise : ${JSON.stringify(avant?.social_links)}`);
}
const echecs = resultats.filter((r) => !r.vrai).length;
console.log(`\n${resultats.length - echecs}/${resultats.length} vérifications passent`);
process.exit(echecs ? 1 : 0);
