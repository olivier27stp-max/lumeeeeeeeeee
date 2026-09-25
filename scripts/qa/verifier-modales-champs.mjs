/**
 * Champs personnalisés dans les fenêtres de CRÉATION, à l'écran (staging).
 *
 *   FRONTEND_URL=http://localhost:5288 API_URL=http://localhost:3188 \
 *     node --env-file=.env.local scripts/qa/verifier-modales-champs.mjs
 *
 * Crée un champ temporaire par objet (client, job, devis, opportunité,
 * facture), ouvre chaque fenêtre de création comme un utilisateur, vérifie
 * que le champ y est affiché et saisissable, capture, puis retire les champs.
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
const crees = [];
const libelles = {};
for (const objet of ['client', 'job', 'quote', 'deal', 'invoice']) {
  libelles[objet] = `QA modale ${objet} ${suffixe}`;
  const r = await api('POST', '/api/custom-fields', { object_type: objet, label: libelles[objet], field_type: 'number' });
  if (r.status !== 201) throw new Error(`champ ${objet} : ${r.status} ${JSON.stringify(r.j)}`);
  crees.push(r.j.field.id);
}

const ok = [];
const ko = [];
const dir = path.join(process.cwd(), 'qa-captures');
fs.mkdirSync(dir, { recursive: true });
const nav = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const erreurs = [];
try {
  const page = await nav.newPage();
  page.on('pageerror', (e) => erreurs.push(e.message));
  await page.setViewport({ width: 1440, height: 1000 });
  await page.evaluateOnNewDocument((t, o) => {
    localStorage.setItem('lume-auth-token', JSON.stringify(t));
    localStorage.setItem('lume-active-org', o);
    localStorage.setItem('lume-language', 'fr');
    localStorage.setItem('lume-setup-dismissed', '1');
    localStorage.setItem('lume.cookieConsent.v1', JSON.stringify({ analytics: false, marketing: false, preferences: false, decidedAt: new Date().toISOString(), docVersion: 'cookie-policy-2026-07-23' }));
  }, jeton, org);
  const cliquer = (motif) => page.evaluate((src) => {
    const re = new RegExp(src);
    const b = [...document.querySelectorAll('button, a')].find((x) => re.test((x.textContent || '').trim()));
    if (b) { b.click(); return (b.textContent || '').trim().slice(0, 40); }
    return null;
  }, motif);
  /** Le champ est-il affiché ET saisissable ? On tape une valeur pour le prouver. */
  const verifierChamp = async (nom, libelle, fichier) => {
    const trouve = await page.waitForFunction((lab) => [...document.querySelectorAll('label')].some((x) => (x.textContent || '').includes(lab)), { timeout: 20000 }, libelle).then(() => true).catch(() => false);
    let saisi = false;
    if (trouve) {
      saisi = await page.evaluate((lab) => {
        const l = [...document.querySelectorAll('label')].find((x) => (x.textContent || '').includes(lab));
        const champ = l && (document.getElementById(l.htmlFor) || l.parentElement?.querySelector('input'));
        if (!champ) return false;
        champ.scrollIntoView({ block: 'center' });
        const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        set.call(champ, '42');
        champ.dispatchEvent(new Event('input', { bubbles: true }));
        return champ.value === '42';
      }, libelle);
    }
    await new Promise((r) => setTimeout(r, 600));
    await page.screenshot({ path: path.join(dir, fichier) });
    (trouve && saisi ? ok : ko).push(`${nom} : champ ${trouve ? 'affiché' : 'ABSENT'}${trouve ? (saisi ? ', saisi (42)' : ', NON saisissable') : ''}`);
  };

  // Job : fenêtre ouverte depuis la liste des jobs.
  await page.goto(`${BASE}/jobs`, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 1500));
  const b1 = await cliquer('^(\\+\\s*)?Nouvelle job');
  if (!b1) ko.push('job : bouton « Nouvelle job » introuvable');
  else await verifierChamp('Job (fenêtre « Nouvelle job »)', libelles.job, 'modale-1-job.png');

  // Devis : page de création.
  await page.goto(`${BASE}/quotes/new`, { waitUntil: 'networkidle2', timeout: 60000 });
  await verifierChamp('Devis (page « Nouveau devis »)', libelles.quote, 'modale-2-devis.png');

  // Opportunité : fenêtre « Nouveau deal » du pipeline.
  await page.goto(`${BASE}/ventes`, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 2000));
  const b3 = await cliquer('^(\\+\\s*)?Nouveau deal$');
  if (!b3) ko.push('pipeline : bouton « Nouveau deal » introuvable');
  else await verifierChamp('Opportunité (fenêtre « Nouveau deal »)', libelles.deal, 'modale-3-deal.png');

  // Client : page de création.
  await page.goto(`${BASE}/clients/new`, { waitUntil: 'networkidle2', timeout: 60000 });
  await verifierChamp('Client (page « Nouveau client »)', libelles.client, 'modale-4-client.png');

  // Facture : l'éditeur montre les champs une fois le brouillon créé.
  await page.goto(`${BASE}/invoices/new`, { waitUntil: 'networkidle2', timeout: 60000 });
  await verifierChamp('Facture (éditeur « Nouvelle facture »)', libelles.invoice, 'modale-5-facture.png');
} finally {
  await nav.close();
  await admin.from('custom_field_values').delete().in('field_id', crees);
  await admin.from('custom_fields').delete().in('id', crees);
}
for (const x of ok) console.log('  ✓', x);
for (const x of ko) console.log('  ✗', x);
console.log(`  erreurs navigateur : ${erreurs.length ? erreurs.join(' | ') : 'aucune'}`);
console.log(`${ok.length}/${ok.length + ko.length} fenêtres de création`);
process.exit(ko.length ? 1 : 0);
