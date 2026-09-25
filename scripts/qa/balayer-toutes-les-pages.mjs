/**
 * balayer-toutes-les-pages.mjs — aucune page ne doit montrer l'écran rouge.
 *
 *   node --env-file=.env.local scripts/qa/balayer-toutes-les-pages.mjs
 *
 * POURQUOI CE SCRIPT. « Une erreur est survenue » est apparue en production
 * sur presque toutes les pages, à deux reprises le 2026-09-25 : d'abord des
 * modules lazy périmés après déploiement, puis une chaîne optionnelle
 * incomplète (`a?.b.c` ne protège que `a`). Les tests unitaires passaient
 * dans les deux cas — ils ne montent pas les pages pour de vrai.
 *
 * Ici on ouvre un vrai navigateur, on se connecte, et on visite les 17 pages
 * DEUX FOIS. Le second passage compte autant que le premier : une erreur qui
 * n'arrive qu'au retour sur une page déjà vue (état gardé, effet rejoué) ne
 * se voit pas au premier. On finit par des allers-retours rapides, qui
 * reproduisent ce que fait quelqu'un de pressé.
 *
 * Ce qu'on mesure : l'écran rouge de l'ErrorBoundary — ce que voit
 * l'utilisateur — et les erreurs JavaScript de la console.
 *
 * Cible : le serveur de dev par défaut (FRONTEND_URL). Aucune écriture :
 * on ne fait que naviguer.
 */
import { createClient } from '@supabase/supabase-js';
import puppeteer from 'puppeteer';

const BASE = process.env.FRONTEND_URL || 'http://localhost:5266';
const COMPTE = process.env.QA_COMPTE || 'qa-pipeline@lume.test';
const MDP = process.env.QA_MDP || 'QaPipeline1234!';

const admin = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: lien } = await admin.auth.admin.generateLink({ type: 'magiclink', email: COMPTE });
const { data: membre } = await admin.from('memberships')
  .select('org_id').eq('user_id', lien.user.id).eq('status', 'active').limit(1).maybeSingle();

const PAGES = [
  '/dashboard', '/clients', '/requests', '/ventes', '/quotes', '/finances',
  '/jobs', '/calendar', '/messages', '/tasks', '/automations', '/insights',
  '/settings', '/leaderboard', '/commissions', '/field-sales', '/timesheets',
];

const nav = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const page = await (await nav.createBrowserContext()).newPage();
await page.setViewport({ width: 1440, height: 900 });

const erreurs = [];
let ou = 'demarrage';
const note = (t) => {
  // Le bruit qui ne vient pas du produit : ressources absentes en dev,
  // extensions, favicon.
  if (/favicon|net::ERR|404 \(\)|Download the React DevTools/i.test(t)) return;
  erreurs.push(`[${ou}] ${t.slice(0, 150)}`);
};
page.on('pageerror', (e) => note('PAGEERROR ' + e.message));
page.on('console', (c) => { if (c.type() === 'error') note(c.text()); });

await page.evaluateOnNewDocument((o) => {
  localStorage.setItem('lume-active-org', o);
  localStorage.setItem('lume-language', 'fr');
}, membre.org_id);

// ── Connexion ──
await page.goto(`${BASE}/auth`, { waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {});
await new Promise((r) => setTimeout(r, 1500));
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => /^tout refuser$/i.test(x.textContent.trim()));
  if (b) b.click();
});
await new Promise((r) => setTimeout(r, 800));
await page.evaluate((m, d) => {
  const st = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  const e = document.querySelector('input[type=email]');
  const q = document.querySelector('input[type=password]');
  st.call(e, m); e.dispatchEvent(new Event('input', { bubbles: true }));
  st.call(q, d); q.dispatchEvent(new Event('input', { bubbles: true }));
}, COMPTE, MDP);
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => /^se connecter$/i.test(x.textContent.trim()));
  if (b) b.click();
});
await new Promise((r) => setTimeout(r, 5000));

const ecransRouges = [];

async function visiter(chemin, tour) {
  ou = `${chemin} (tour ${tour})`;
  await page.goto(`${BASE}${chemin}`, { waitUntil: 'networkidle2', timeout: 45000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 1600));
  const t = await page.evaluate(() => document.body.innerText || '');
  // L'écran rouge de l'ErrorBoundary : ce que voit vraiment l'utilisateur.
  if (/Une erreur est survenue|Une erreur inattendue/i.test(t)) {
    const detail = (t.match(/Une erreur[^]{0,160}/) || [''])[0].replace(/\s+/g, ' ');
    ecransRouges.push(`${chemin} (tour ${tour}) → ${detail.slice(0, 150)}`);
  }
}

// ── Deux passages complets ──
for (const tour of [1, 2]) {
  for (const p of PAGES) await visiter(p, tour);
}

// ── Allers-retours rapides entre deux pages ──
ou = 'va-et-vient';
for (let i = 0; i < 6; i++) {
  await page.goto(`${BASE}/ventes`, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 400));
  await page.goto(`${BASE}/clients`, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 400));
}
await new Promise((r) => setTimeout(r, 2000));
const tFinal = await page.evaluate(() => document.body.innerText || '');
if (/Une erreur est survenue|Une erreur inattendue/i.test(tFinal)) {
  ecransRouges.push('va-et-vient rapide → écran rouge');
}

console.log(`\n${'='.repeat(56)}`);
console.log(`ÉCRANS ROUGES : ${ecransRouges.length}`);
ecransRouges.forEach((e) => console.log('  ✗ ' + e));
const uniques = [...new Set(erreurs)];
console.log(`\nERREURS JS UNIQUES : ${uniques.length}`);
uniques.slice(0, 14).forEach((e) => console.log('  - ' + e));
await nav.close();
