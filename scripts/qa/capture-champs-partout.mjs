/**
 * Champs personnalisés — les pages de l'app, À L'ÉCRAN (staging).
 *
 *   FRONTEND_URL=http://localhost:5288 API_URL=http://localhost:3188 \
 *     node --env-file=.env.local scripts/qa/capture-champs-partout.mjs
 *
 * Prépare par la vraie API (compte QA) un champ client et un champ devis
 * « afficher sur le document », pose des valeurs, puis capture : liste des
 * clients (colonne + panneau « Champs » avec un filtre), création d'un
 * client, listes jobs et factures, page publique d'une soumission.
 * Sorties : qa-captures/partout-*.png ; erreurs de console et HTTP ≥ 400 listées.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import puppeteer from 'puppeteer';

const BASE = (process.env.FRONTEND_URL || 'http://localhost:5288').replace(/\/$/, '');
const API = (process.env.API_URL || 'http://localhost:3188').replace(/\/$/, '');
const COMPTE = process.env.QA_COMPTE || 'willhebert30@gmail.com';
const url = process.env.VITE_SUPABASE_URL;
if (!url?.includes(process.env.SUPABASE_PROJECT_REF) || url.includes(process.env.SUPABASE_PROJECT_REF_PROD)) throw new Error('staging seulement');

const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const anon = createClient(url, process.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const { data: l } = await admin.auth.admin.generateLink({ type: 'magiclink', email: COMPTE });
const { data: s } = await anon.auth.verifyOtp({ token_hash: l.properties.hashed_token, type: 'magiclink' });
const { data: m } = await admin.from('memberships').select('org_id').eq('user_id', s.user.id).eq('status', 'active').limit(1).maybeSingle();
const org = m.org_id;
const jeton = { access_token: s.session.access_token, refresh_token: s.session.refresh_token, expires_at: s.session.expires_at, expires_in: s.session.expires_in, token_type: 'bearer', user: s.user };
await admin.from('org_features').upsert({ org_id: org, feature: 'custom_fields_v2', enabled: true }, { onConflict: 'org_id,feature' });

const api = async (methode, chemin, corps) => {
  const r = await fetch(`${API}${chemin}`, { method: methode, headers: { Authorization: `Bearer ${jeton.access_token}`, 'x-org-id': org, 'Content-Type': 'application/json' }, body: corps ? JSON.stringify(corps) : undefined });
  return { status: r.status, j: await r.json().catch(() => null) };
};
const journal = [];
let { j: tous } = await api('GET', '/api/custom-fields');
const trouver = (objet, cle) => tous.fields.find((f) => f.object_type === objet && f.key === cle);
if (!trouver('client', 'type_de_batiment')) {
  const r = await api('POST', '/api/custom-fields', { object_type: 'client', label: 'Type de bâtiment', field_type: 'dropdown_single', options: [{ label: 'Résidentiel', color: '#2563eb' }, { label: 'Commercial', color: '#d97706' }] });
  journal.push(`champ client liste → ${r.status}`);
}
if (!trouver('quote', 'nombre_de_fenetres')) {
  const r = await api('POST', '/api/custom-fields', { object_type: 'quote', label: 'Nombre de fenêtres', field_type: 'number', config: { show_on_documents: true } });
  journal.push(`champ devis « sur le document » → ${r.status} (config ${JSON.stringify(r.j?.field?.config)})`);
}
({ j: tous } = await api('GET', '/api/custom-fields'));
const typeBat = trouver('client', 'type_de_batiment');
const fenetres = trouver('quote', 'nombre_de_fenetres');

const { data: clients } = await admin.from('clients').select('id').eq('org_id', org).is('deleted_at', null).order('created_at', { ascending: false }).limit(3);
for (const [i, c] of clients.entries()) {
  const r = await api('PUT', `/api/custom-values/client/${c.id}`, { values: [{ field_id: typeBat.id, value: typeBat.options[i % 2].id }] });
  journal.push(`valeur client ${i + 1} → ${r.status}`);
}
const { data: devis } = await admin.from('quotes').select('id, view_token').eq('org_id', org).is('deleted_at', null).not('view_token', 'is', null).limit(1).maybeSingle();
if (devis) {
  const r = await api('PUT', `/api/custom-values/quote/${devis.id}`, { values: [{ field_id: fenetres.id, value: 14 }] });
  journal.push(`valeur devis → ${r.status}`);
  const pub = await fetch(`${API}/api/quotes/public/${devis.view_token}`).then((x) => x.json());
  journal.push(`page publique du devis : custom_fields = ${JSON.stringify(pub.custom_fields)}`);
}
// Le filtre de liste, côté base, comme l'écran l'enverrait.
const f = await api('POST', '/api/custom-fields/filter', { object_type: 'client', conditions: [{ field_id: typeBat.id, op: 'any_of', value: [typeBat.options[1].id] }] });
journal.push(`filtre « Commercial » → ${f.status}, ${f.j?.ids?.length} client(s)`);

const dir = path.join(process.cwd(), 'qa-captures');
fs.mkdirSync(dir, { recursive: true });
const nav = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const erreurs = [];
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const ctx = await nav.createBrowserContext();
const page = await ctx.newPage();
page.on('pageerror', (e) => erreurs.push(`page : ${e.message}`));
page.on('console', (c) => { if (c.type() === 'error') erreurs.push(`console : ${c.text().slice(0, 200)}`); });
page.on('response', (r) => { if (r.status() >= 400 && r.url().includes('/api/')) erreurs.push(`HTTP ${r.status()} : ${r.url().slice(0, 140)}`); });
await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
await page.evaluateOnNewDocument((t, o, col) => {
  localStorage.setItem('lume-auth-token', JSON.stringify(t));
  localStorage.setItem('lume-active-org', o);
  localStorage.setItem('lume-language', 'fr');
  localStorage.setItem('lume.cookieConsent.v1', JSON.stringify({ analytics: false, marketing: false, preferences: false, decidedAt: new Date().toISOString(), docVersion: 'cookie-policy-2026-07-23' }));
  localStorage.setItem('lume-setup-dismissed', '1');
  localStorage.setItem('lume.champs.colonnes.client', JSON.stringify([col]));
}, jeton, org, typeBat.id);
const cliquer = (texte) => page.evaluate((t) => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.trim().startsWith(t)); if (b) { b.click(); return true; } return false; }, texte);

await page.goto(`${BASE}/clients`, { waitUntil: 'networkidle2', timeout: 60000 }); await pause(2000);
await page.screenshot({ path: path.join(dir, 'partout-1-clients-colonne.png') });
await cliquer('Champs'); await pause(600);
await cliquer('Ajouter une condition'); await pause(600);
await page.screenshot({ path: path.join(dir, 'partout-2-clients-panneau.png') });
await page.goto(`${BASE}/clients/new`, { waitUntil: 'networkidle2', timeout: 60000 }); await pause(1500);
await page.screenshot({ path: path.join(dir, 'partout-3-nouveau-client.png'), fullPage: true });
await page.goto(`${BASE}/jobs`, { waitUntil: 'networkidle2', timeout: 60000 }); await pause(1500);
await page.screenshot({ path: path.join(dir, 'partout-4-jobs.png') });
await page.goto(`${BASE}/invoices`, { waitUntil: 'networkidle2', timeout: 60000 }); await pause(1500);
await page.screenshot({ path: path.join(dir, 'partout-5-factures.png') });
if (devis) {
  await page.goto(`${BASE}/quote/${devis.view_token}`, { waitUntil: 'networkidle2', timeout: 60000 }); await pause(2000);
  await page.screenshot({ path: path.join(dir, 'partout-6-devis-public.png'), fullPage: true });
}
await nav.close();
console.log('── API ──'); for (const x of journal) console.log(' ', x);
console.log('── Erreurs navigateur ──'); console.log(erreurs.length ? erreurs.join('\n') : '  aucune');
