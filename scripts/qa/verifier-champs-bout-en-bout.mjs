/**
 * Champs personnalisés — comportement de bout en bout À L'ÉCRAN (staging).
 *
 *   node --env-file=.env.local scripts/qa/verifier-champs-bout-en-bout.mjs
 *   (API locale sur :3188 et Vite sur :5288 ; FRONTEND_URL_QA / API_URL_QA pour changer)
 *
 *   A. « Obligatoire » bloque la création d'un client ; rempli, la valeur est enregistrée.
 *   B. Modification sur les fiches client, job, devis, facture : saisie → sortie du champ
 *      → valeur relue EN BASE.
 *   C. Fenêtre « Nouveau devis » ouverte depuis une fiche client ; panneau du deal (pipeline).
 *   D. Téléphone (390 px) : le champ est visible et saisissable.
 * Tout ce qui est créé est retiré à la fin.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import puppeteer from 'puppeteer';

const BASE = (process.env.FRONTEND_URL_QA || 'http://localhost:5288').replace(/\/$/, '');
const API = (process.env.API_URL_QA || 'http://localhost:3188').replace(/\/$/, '');
const url = process.env.VITE_SUPABASE_URL;
if (!url?.includes(process.env.SUPABASE_PROJECT_REF) || url.includes(process.env.SUPABASE_PROJECT_REF_PROD)) throw new Error('staging seulement');
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const anon = createClient(url, process.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const { data: l } = await admin.auth.admin.generateLink({ type: 'magiclink', email: process.env.QA_COMPTE || 'willhebert30@gmail.com' });
const { data: s } = await anon.auth.verifyOtp({ token_hash: l.properties.hashed_token, type: 'magiclink' });
const { data: m } = await admin.from('memberships').select('org_id').eq('user_id', s.user.id).eq('status', 'active').limit(1).maybeSingle();
const org = m.org_id;
const jeton = { access_token: s.session.access_token, refresh_token: s.session.refresh_token, expires_at: s.session.expires_at, expires_in: s.session.expires_in, token_type: 'bearer', user: s.user };
const api = async (methode, chemin, corps) => {
  const r = await fetch(`${API}${chemin}`, { method: methode, headers: { Authorization: `Bearer ${jeton.access_token}`, 'x-org-id': org, 'Content-Type': 'application/json' }, body: corps ? JSON.stringify(corps) : undefined });
  return { status: r.status, j: await r.json().catch(() => null) };
};
await admin.from('org_features').upsert({ org_id: org, feature: 'custom_fields_v2', enabled: true }, { onConflict: 'org_id,feature' });

const suffixe = Date.now().toString(36);
const champs = {};
const creesChamps = [];
const creer = async (objet, corps) => {
  const r = await api('POST', '/api/custom-fields', { object_type: objet, field_type: 'number', ...corps });
  if (r.status !== 201) throw new Error(`champ ${objet} : ${r.status} ${JSON.stringify(r.j)}`);
  creesChamps.push(r.j.field.id);
  return r.j.field;
};
champs.clientRequis = await creer('client', { label: `QA requis ${suffixe}`, is_required: true });
for (const o of ['job', 'quote', 'invoice', 'deal']) champs[o] = await creer(o, { label: `QA ${o} ${suffixe}` });

const un = async (table, extra = (q) => q) => (await extra(admin.from(table).select('id').eq('org_id', org).is('deleted_at', null)).order('created_at', { ascending: false }).limit(1).maybeSingle()).data?.id;
const cibles = { client: await un('clients'), job: await un('jobs'), quote: await un('quotes'), invoice: await un('invoices', (q) => q.eq('status', 'draft')) };

const ok = [];
const ko = [];
const verifier = (nom, cond, detail = '') => (cond ? ok : ko).push(`${nom}${detail ? ` — ${detail}` : ''}`);
const dir = path.join(process.cwd(), 'qa-captures');
fs.mkdirSync(dir, { recursive: true });
const nav = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const erreurs = [];
const clientsCrees = [];
const valeurEnBase = async (objet, id, champ) => (await api('GET', `/api/custom-values/${objet}/${id}`)).j?.values?.[champ.id]?.value;

async function nouvellePage(largeur = 1440, hauteur = 1000) {
  const page = await nav.newPage();
  page.on('pageerror', (e) => erreurs.push(e.message));
  await page.setViewport({ width: largeur, height: hauteur });
  await page.evaluateOnNewDocument((t, o) => {
    localStorage.setItem('lume-auth-token', JSON.stringify(t)); localStorage.setItem('lume-active-org', o);
    localStorage.setItem('lume-language', 'fr'); localStorage.setItem('lume-setup-dismissed', '1');
    localStorage.setItem('lume.cookieConsent.v1', JSON.stringify({ analytics: false, marketing: false, preferences: false, decidedAt: new Date().toISOString(), docVersion: 'cookie-policy-2026-07-23' }));
  }, jeton, org);
  return page;
}
const attendreChamp = (page, libelle, delai = 20000) => page.waitForFunction((lab) => [...document.querySelectorAll('label')].some((x) => (x.textContent || '').includes(lab)), { timeout: delai }, libelle).then(() => true).catch(() => false);
const idDuChamp = (page, libelle) => page.evaluate((lab) => {
  const lb = [...document.querySelectorAll('label')].find((x) => (x.textContent || '').includes(lab));
  const el = lb && (document.getElementById(lb.htmlFor) || lb.parentElement?.querySelector('input'));
  if (el) el.scrollIntoView({ block: 'center' });
  return el ? (el.id || null) : null;
}, libelle);
const taper = async (page, libelle, valeur) => {
  const id = await idDuChamp(page, libelle);
  if (!id) return false;
  // Vider par la valeur elle-même (le triple clic ne sélectionne pas toujours, sur mobile surtout).
  await page.focus(`[id="${id}"]`);
  await page.evaluate((i) => { const el = document.getElementById(i); el.select?.(); }, id);
  await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');
  await page.type(`[id="${id}"]`, valeur);
  await page.keyboard.press('Tab'); // sortie du champ = enregistrement sur une fiche existante
  return true;
};
const cliquer = (page, motif) => page.evaluate((src) => {
  const re = new RegExp(src);
  const b = [...document.querySelectorAll('button')].find((x) => re.test((x.textContent || '').trim()));
  if (b) { b.click(); return true; }
  return false;
}, motif);
const texteVisible = (page, motif) => page.evaluate((src) => new RegExp(src).test(document.body.innerText), motif);

try {
  // ── A. Obligatoire ──────────────────────────────────────────────
  {
    const page = await nouvellePage();
    const courriel = `qa.requis.${suffixe}@exemple.invalid`;
    await page.goto(`${BASE}/clients/new`, { waitUntil: 'networkidle2', timeout: 60000 });
    await attendreChamp(page, champs.clientRequis.label);
    const remplir = (etiquette, v) => page.evaluate((lab, val) => {
      const lb = [...document.querySelectorAll('label')].find((x) => (x.textContent || '').trim().replace(/\s*\*$/, '') === lab);
      const el = lb && document.getElementById(lb.htmlFor);
      if (!el) return false;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, val);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }, etiquette, v);
    await remplir('Prénom', 'QA');
    await remplir('Nom de famille', `Requis ${suffixe}`);
    await remplir('Courriel', courriel);
    await cliquer(page, '^Enregistrer le c');
    await new Promise((r) => setTimeout(r, 2500));
    const { data: sans } = await admin.from('clients').select('id').eq('org_id', org).eq('email', courriel);
    const message = await texteVisible(page, `${champs.clientRequis.label}.*obligatoire`);
    verifier('A1. client SANS le champ obligatoire : création bloquée, message affiché', (sans ?? []).length === 0 && message, `${(sans ?? []).length} client(s) créé(s), message ${message ? 'vu' : 'absent'}`);
    await page.screenshot({ path: path.join(dir, 'bout-A1-requis-bloque.png') });
    await taper(page, champs.clientRequis.label, '7');
    await cliquer(page, '^Enregistrer le c');
    await new Promise((r) => setTimeout(r, 4000));
    const { data: avec } = await admin.from('clients').select('id').eq('org_id', org).eq('email', courriel);
    const cree = (avec ?? [])[0];
    if (cree) clientsCrees.push(cree.id);
    const v = cree ? await valeurEnBase('client', cree.id, champs.clientRequis) : undefined;
    verifier('A2. rempli : client créé et valeur enregistrée', !!cree && v === 7, `valeur ${JSON.stringify(v)}`);
    await page.close();
  }

  // ── B. Modification sur les fiches ──────────────────────────────
  const fiches = [
    ['client', `/clients/${cibles.client}`, champs.clientRequis, '11'],
    ['job', `/jobs/${cibles.job}`, champs.job, '12'],
    ['quote', `/quotes/${cibles.quote}`, champs.quote, '13'],
    ['invoice', `/invoices/${cibles.invoice}`, champs.invoice, '14'],
  ];
  for (const [objet, chemin, champ, valeur] of fiches) {
    const id = cibles[objet];
    if (!id) { ko.push(`B. ${objet} : aucune fiche de test`); continue; }
    const page = await nouvellePage();
    await page.goto(`${BASE}${chemin}`, { waitUntil: 'networkidle2', timeout: 60000 });
    const vu = await attendreChamp(page, champ.label);
    const tape = vu && await taper(page, champ.label, valeur);
    await new Promise((r) => setTimeout(r, 2500));
    const v = await valeurEnBase(objet, id, champ);
    verifier(`B. fiche ${objet} : saisie → enregistrée en base`, v === Number(valeur), `affiché ${vu}, saisi ${!!tape}, en base ${JSON.stringify(v)}`);
    await page.screenshot({ path: path.join(dir, `bout-B-${objet}.png`) });
    await page.close();
  }

  // ── C. Fenêtre devis depuis une fiche client ; panneau du deal ──
  {
    const page = await nouvellePage();
    await page.goto(`${BASE}/clients/${cibles.client}`, { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise((r) => setTimeout(r, 1500));
    // L'onglet « Devis » DE LA FICHE (pas le lien « Devis » de la barre latérale).
    await page.evaluate(() => {
      const zone = document.querySelector('main') || document.body;
      const b = [...zone.querySelectorAll('button, [role="tab"]')].find((x) => /^Devis\s*\d*$/.test((x.textContent || '').trim()) && !x.closest('nav, aside'));
      b?.click();
    });
    await new Promise((r) => setTimeout(r, 800));
    const ouvert = await page.evaluate(() => {
      const zone = document.querySelector('main') || document.body;
      const b = [...zone.querySelectorAll('button')].find((x) => /Nouveau devis/.test(x.textContent || '') && !x.closest('nav, aside'));
      if (b) { b.click(); return true; }
      return false;
    });
    const vu = ouvert && await attendreChamp(page, champs.quote.label, 12000);
    await page.screenshot({ path: path.join(dir, 'bout-C1-devis-depuis-client.png') });
    verifier('C1. fenêtre « Nouveau devis » depuis une fiche client : champ affiché', !!vu, `bouton ${ouvert ? 'trouvé' : 'INTROUVABLE'}`);
    await page.close();
  }
  {
    const page = await nouvellePage();
    await page.goto(`${BASE}/ventes`, { waitUntil: 'networkidle2', timeout: 60000 });
    // Le board se charge après la page : attendre une carte plutôt qu'un délai fixe.
    await page.waitForFunction(() => [...document.querySelectorAll('[role="button"][tabindex="0"]')].some((x) => x.style?.borderLeftWidth === '3px'), { timeout: 25000 }).catch(() => {});
    // Ouvre la première carte de deal, puis la section « Deal » de la fiche.
    const carte = await page.evaluate(() => {
      // Carte de deal : role=button, liseré gauche de 3 px (couleur de l'étape).
      const c = [...document.querySelectorAll('[role="button"][tabindex="0"]')].find((x) => x.style?.borderLeftWidth === '3px');
      if (c) { c.click(); return true; }
      return false;
    });
    await new Promise((r) => setTimeout(r, 1500));
    await cliquer(page, '^Deal$');
    const vu = await attendreChamp(page, champs.deal.label, 12000);
    await page.screenshot({ path: path.join(dir, 'bout-C2-deal.png') });
    verifier('C2. fiche d’un deal (pipeline) : champ affiché', vu, `carte ${carte ? 'ouverte' : 'introuvable'}`);
    await page.close();
  }

  // ── D. Téléphone ────────────────────────────────────────────────
  {
    const page = await nouvellePage(390, 844);
    await page.goto(`${BASE}/jobs/${cibles.job}`, { waitUntil: 'networkidle2', timeout: 60000 });
    const vu = await attendreChamp(page, champs.job.label);
    const tape = vu && await taper(page, champs.job.label, '21');
    await new Promise((r) => setTimeout(r, 2500));
    const v = await valeurEnBase('job', cibles.job, champs.job);
    const deborde = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    await page.screenshot({ path: path.join(dir, 'bout-D-mobile.png') });
    verifier('D. téléphone (390 px), fiche job : champ affiché, saisi, enregistré, sans débordement horizontal', v === 21 && !deborde, `en base ${JSON.stringify(v)}, débordement ${deborde}`);
    await page.close();
  }
} finally {
  await nav.close();
  for (const id of clientsCrees) { await admin.from('custom_field_values').delete().eq('client_id', id); await admin.from('clients').delete().eq('id', id); }
  await admin.from('custom_field_values').delete().in('field_id', creesChamps);
  await admin.from('custom_fields').delete().in('id', creesChamps);
}
for (const x of ok) console.log('  ✓', x);
for (const x of ko) console.log('  ✗', x);
console.log(`  erreurs navigateur : ${erreurs.length ? [...new Set(erreurs)].join(' | ') : 'aucune'}`);
console.log(`${ok.length}/${ok.length + ko.length} vérifications`);
process.exit(ko.length ? 1 : 0);
