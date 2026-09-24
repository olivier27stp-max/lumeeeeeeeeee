/**
 * Champs personnalisés v2 — de bout en bout, À L'ÉCRAN (staging).
 *
 *   FRONTEND_URL=http://localhost:5288 API_URL=http://localhost:3188 \
 *     node --env-file=.env.local scripts/qa/capture-champs-perso.mjs
 *
 * 1. Active le drapeau `custom_fields_v2` sur l'org du compte QA (staging).
 * 2. Par la VRAIE API (jeton de l'utilisateur) : un dossier d'opportunité
 *    avec 3 champs, un champ client, l'affichage des cartes, des valeurs sur
 *    un deal — ce qui prouve le chemin serveur complet.
 * 3. Captures : Réglages → Champs personnalisés (ordinateur + téléphone),
 *    la modale de création (grille puis configuration), le board du
 *    pipeline, la fiche d'un deal. Erreurs de console et HTTP ≥ 400 listées.
 * Sorties dans qa-captures/champs-*.png. Réexécutable (réutilise ce qui existe).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import puppeteer from 'puppeteer';

const BASE = (process.env.FRONTEND_URL || 'http://localhost:5288').replace(/\/$/, '');
const API = (process.env.API_URL || 'http://localhost:3188').replace(/\/$/, '');
const COMPTE = process.env.QA_COMPTE || 'willhebert30@gmail.com';
const url = process.env.VITE_SUPABASE_URL;
if (!url?.includes(process.env.SUPABASE_PROJECT_REF) || url.includes(process.env.SUPABASE_PROJECT_REF_PROD)) {
  throw new Error('VITE_SUPABASE_URL ne pointe pas sur staging - abandon');
}

const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const anon = createClient(url, process.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const { data: l } = await admin.auth.admin.generateLink({ type: 'magiclink', email: COMPTE });
const { data: s } = await anon.auth.verifyOtp({ token_hash: l.properties.hashed_token, type: 'magiclink' });
const { data: m } = await admin.from('memberships').select('org_id').eq('user_id', s.user.id).eq('status', 'active').limit(1).maybeSingle();
const org = m.org_id;
const jeton = {
  access_token: s.session.access_token, refresh_token: s.session.refresh_token,
  expires_at: s.session.expires_at, expires_in: s.session.expires_in, token_type: 'bearer', user: s.user,
};

// 1. Drapeau
await admin.from('org_features').upsert({ org_id: org, feature: 'custom_fields_v2', enabled: true }, { onConflict: 'org_id,feature' });

// 2. Données par l'API
const api = async (methode, chemin, corps) => {
  const r = await fetch(`${API}${chemin}`, {
    method: methode,
    headers: { Authorization: `Bearer ${jeton.access_token}`, 'x-org-id': org, 'Content-Type': 'application/json' },
    body: corps ? JSON.stringify(corps) : undefined,
  });
  const j = await r.json().catch(() => null);
  return { status: r.status, j };
};
const journal = [];
let { j: liste } = await api('GET', '/api/custom-fields');
if (!liste.fields.some((f) => f.key === 'superficie')) {
  const r = await api('POST', '/api/custom-field-folders', {
    object_type: 'deal', name: 'Terrain',
    fields: [
      { label: 'Superficie', field_type: 'number', config: { decimals: 0, min: 0 } },
      { label: 'Type de surface', field_type: 'dropdown_single', options: [{ label: 'Asphalte', color: '#475569' }, { label: 'Pavé uni', color: '#b45309' }, { label: 'Gravier', color: '#65a30d' }] },
      { label: 'Date de visite', field_type: 'date' },
    ],
  });
  journal.push(`dossier + 3 champs (lot) → HTTP ${r.status}`);
}
if (!liste.fields.some((f) => f.key === 'courriel_facturation')) {
  const r = await api('POST', '/api/custom-fields', { object_type: 'client', label: 'Courriel facturation', field_type: 'email', is_searchable: true });
  journal.push(`champ client → HTTP ${r.status}`);
}
({ j: liste } = await api('GET', '/api/custom-fields?object=deal'));
const par = (cle) => liste.fields.find((f) => f.key === cle);
const { data: deal } = await admin.from('deals').select('id, pipeline_id, client_id').eq('org_id', org).is('deleted_at', null).limit(1).maybeSingle();
const cartes = await api('PUT', `/api/custom-fields/pipeline-cards/${deal.pipeline_id}`, { field_ids: [par('superficie').id, par('type_de_surface').id] });
journal.push(`cartes du pipeline → HTTP ${cartes.status}`);
const lecture = await api('GET', `/api/custom-values/deal/${deal.id}`);
const version = (id) => lecture.j.values?.[id]?.version ?? null;
const ecriture = await api('PUT', `/api/custom-values/deal/${deal.id}`, { values: [
  { field_id: par('superficie').id, value: 2400, version: version(par('superficie').id) },
  { field_id: par('type_de_surface').id, value: par('type_de_surface').options[1].id, version: version(par('type_de_surface').id) },
  { field_id: par('date_de_visite').id, value: '2026-09-20', version: version(par('date_de_visite').id) },
] });
journal.push(`valeurs du deal → HTTP ${ecriture.status} ${JSON.stringify(ecriture.j?.results?.map((r) => r.ok))}`);
const refus = await api('PUT', `/api/custom-values/deal/${deal.id}`, { values: [{ field_id: par('superficie').id, value: -5 }] });
journal.push(`valeur hors bornes → HTTP ${refus.status} « ${refus.j?.results?.[0]?.erreur} »`);
const filtre = await api('POST', '/api/custom-fields/filter', { object_type: 'deal', conditions: [{ field_id: par('superficie').id, op: 'gt', value: 2000 }] });
journal.push(`filtre superficie > 2000 → HTTP ${filtre.status}, ${filtre.j?.ids?.length} deal(s), contient le deal : ${filtre.j?.ids?.includes(deal.id)}`);

// 3. Captures
const dir = path.join(process.cwd(), 'qa-captures');
fs.mkdirSync(dir, { recursive: true });
const nav = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const erreurs = [];
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function ouvrir(vp) {
  const ctx = await nav.createBrowserContext();
  const page = await ctx.newPage();
  page.on('pageerror', (e) => erreurs.push(`${vp.nom} : ${e.message}`));
  page.on('console', (c) => { if (c.type() === 'error') erreurs.push(`${vp.nom} console : ${c.text().slice(0, 200)}`); });
  page.on('response', (r) => { if (r.status() >= 400 && r.url().includes('/api/')) erreurs.push(`${vp.nom} HTTP ${r.status()} : ${r.url().slice(0, 140)}`); });
  await page.setViewport({ width: vp.width, height: vp.height, isMobile: !!vp.mobile, hasTouch: !!vp.mobile, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument((t, o) => {
    localStorage.setItem('lume-auth-token', JSON.stringify(t));
    localStorage.setItem('lume-active-org', o);
    localStorage.setItem('lume-language', 'fr');
    localStorage.setItem('lume.cookieConsent.v1', JSON.stringify({ analytics: false, marketing: false, preferences: false, decidedAt: new Date().toISOString(), docVersion: 'cookie-policy-2026-07-23' }));
    localStorage.setItem('lume-setup-dismissed', '1');
  }, jeton, org);
  return page;
}
const cliquerTexte = async (page, texte) => page.evaluate((t) => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.trim().includes(t));
  if (b) { b.click(); return true; }
  return false;
}, texte);

const bureau = await ouvrir({ nom: 'ordinateur', width: 1440, height: 1000 });
await bureau.goto(`${BASE}/settings/custom-fields`, { waitUntil: 'networkidle2', timeout: 60000 });
await pause(1500);
await bureau.screenshot({ path: path.join(dir, 'champs-1-reglages.png'), fullPage: true });
await cliquerTexte(bureau, 'Nouveau champ');
await pause(800);
await bureau.screenshot({ path: path.join(dir, 'champs-2-grille-types.png') });
await cliquerTexte(bureau, 'Liste (un choix)');
await pause(800);
await bureau.screenshot({ path: path.join(dir, 'champs-3-configuration.png') });
await bureau.keyboard.press('Escape');
await bureau.goto(`${BASE}/ventes`, { waitUntil: 'networkidle2', timeout: 60000 });
await pause(2500);
await bureau.screenshot({ path: path.join(dir, 'champs-4-pipeline.png') });
await cliquerTexte(bureau, 'Filtres');
await pause(800);
await bureau.screenshot({ path: path.join(dir, 'champs-5-filtres.png') });
await bureau.goto(`${BASE}/clients/${deal.client_id}`, { waitUntil: 'networkidle2', timeout: 60000 });
await pause(2000);
await bureau.screenshot({ path: path.join(dir, 'champs-6-fiche-client.png'), fullPage: true });

const tel = await ouvrir({ nom: 'telephone', width: 390, height: 844, mobile: true });
await tel.goto(`${BASE}/settings/custom-fields`, { waitUntil: 'networkidle2', timeout: 60000 });
await pause(1500);
await tel.screenshot({ path: path.join(dir, 'champs-7-telephone.png'), fullPage: true });

await nav.close();
console.log('── API ──'); for (const x of journal) console.log(' ', x);
console.log('── Erreurs navigateur ──'); console.log(erreurs.length ? erreurs.join('\n') : '  aucune');
console.log(`deal=${deal.id}`);
