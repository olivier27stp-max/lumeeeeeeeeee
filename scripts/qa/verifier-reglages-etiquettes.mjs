// Usage : FRONTEND_URL=http://localhost:5174 node --env-file=.env.local scripts/qa/verifier-reglages-etiquettes.mjs [dossier-captures]
//
// Réglages → Étiquettes + sélecteur de la fiche client (2026-09-28), dans un
// VRAI navigateur, contre STAGING (refuse la prod) :
//   créer une étiquette (couleur) → la poser sur un client depuis sa fiche →
//   la voir comptée dans Réglages → la renommer vers une existante (fusion) →
//   la supprimer. Données ZZSonde, supprimées à la fin.
import { createClient } from '@supabase/supabase-js';
import puppeteer from 'puppeteer';

const BASE = process.env.FRONTEND_URL || 'http://localhost:5173';
const OUT = process.argv[2] || null;
if (process.env.SUPABASE_PROJECT_REF === process.env.SUPABASE_PROJECT_REF_PROD) throw new Error('prod refusée');
const admin = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const attendre = async (cond, ms = 15000) => { const fin = Date.now() + ms; while (Date.now() < fin) { if (await cond()) return true; await pause(300); } return false; };
let ok = 0, ko = 0;
const verif = (n, c, d = '') => { c ? ok++ : ko++; console.log(`${c ? '✅' : '❌'} ${n}${d ? '  — ' + d : ''}`); };

const COMPTE = 'qa-pipeline@lume.test', MDP = 'QaPipeline1234!';
const { data: lien } = await admin.auth.admin.generateLink({ type: 'magiclink', email: COMPTE });
const uid = lien.user.id;
const { data: mb } = await admin.from('memberships').select('org_id').eq('user_id', uid).eq('status', 'active').limit(1).single();
const ORG = mb.org_id;
const A = 'ZZ-Sonde-Or', B = 'ZZ-Sonde-VIP';
let clientId = null;
const nav = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });

const saisir = (page, sel, v) => page.evaluate((s, val) => {
  const el = document.querySelector(s); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  set.call(el, val); el.dispatchEvent(new Event('input', { bubbles: true }));
}, sel, v);

try {
  const { data: c, error } = await admin.from('clients').insert({
    org_id: ORG, first_name: 'ZZSonde', last_name: 'Etiquettes', status: 'lead', created_by: uid, email: 'zzsonde.etiq@example.invalid',
  }).select('id').single();
  if (error) throw error; clientId = c.id;
  // B existe déjà au catalogue et sur un client : cible de la fusion.
  await admin.from('tags').insert({ org_id: ORG, name: B, color_hex: '#ef4444' });

  const page = await nav.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  if (process.env.QA_DEBUG) page.on('console', (m) => { if (/etiquette|confirmer|rror/i.test(m.text())) console.log('   [page]', m.text().slice(0, 200)); });
  await page.evaluateOnNewDocument((o) => { localStorage.setItem('lume-language', 'fr'); localStorage.setItem('lume-active-org', o); }, ORG);
  await page.goto(`${BASE}/auth`, { waitUntil: 'networkidle2', timeout: 90000 }).catch(() => {});
  await page.waitForSelector('input[type=email]', { timeout: 90000 });
  await saisir(page, 'input[type=email]', COMPTE);
  await saisir(page, 'input[type=password]', MDP);
  await page.focus('input[type=password]'); await page.keyboard.press('Enter');
  await page.waitForFunction(() => !location.pathname.startsWith('/auth'), { timeout: 60000 }).catch(() => {});
  await pause(2500);
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /^tout refuser$/i.test(x.textContent.trim())); if (b) b.click(); });

  // ── 1. Créer A dans Réglages ──
  await page.goto(`${BASE}/settings/tags`, { waitUntil: 'networkidle2', timeout: 90000 }).catch(() => {});
  await page.waitForFunction(() => /Nouvelle étiquette/.test(document.body.innerText), { timeout: 45000 }).catch(() => {});
  verif('Réglages → Étiquettes s’affiche (entrée du menu + page)', await page.evaluate(() => /Nouvelle étiquette/.test(document.body.innerText) && [...document.querySelectorAll('a, button')].some((x) => x.textContent.trim() === 'Étiquettes')));
  const idNom = await page.evaluate(() => [...document.querySelectorAll('label')].find((l) => l.textContent.trim() === 'Nouvelle étiquette')?.htmlFor);
  await saisir(page, `input[id="${idNom}"]`, A);
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Créer')?.click());
  await attendre(async () => !!(await admin.from('tags').select('id').eq('org_id', ORG).eq('name', A).maybeSingle()).data);
  verif('« Créer » ajoute l’étiquette au catalogue', !!(await admin.from('tags').select('id').eq('org_id', ORG).eq('name', A).maybeSingle()).data);
  await page.waitForFunction((n) => document.body.innerText.includes(n), { timeout: 10000 }, A).catch(() => {});
  if (OUT) await page.screenshot({ path: `${OUT}/reglages-etiquettes.png` });

  // ── 2. La poser sur le client depuis sa fiche ──
  await page.goto(`${BASE}/clients/${clientId}`, { waitUntil: 'networkidle2', timeout: 90000 }).catch(() => {});
  await page.waitForFunction(() => /ZZSonde/.test(document.body.innerText), { timeout: 45000 }).catch(() => {});
  await pause(1500);
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Étiquette')?.click());
  await page.waitForSelector('input[aria-label="Ajouter une étiquette"]', { timeout: 10000 }).catch(() => {});
  await page.type('input[aria-label="Ajouter une étiquette"]', 'ZZ-Sonde-O');
  await pause(500);
  const propositions = await page.evaluate(() => [...document.querySelectorAll('[role="option"]')].map((o) => o.textContent.trim()));
  verif('la fiche client suggère l’étiquette existante', propositions.includes(A), propositions.join(' | '));
  await page.keyboard.press('Enter');
  await attendre(async () => ((await admin.from('client_tags').select('tag').eq('client_id', clientId)).data ?? []).some((r) => r.tag === A));
  verif('l’étiquette est posée sur le client', ((await admin.from('client_tags').select('tag').eq('client_id', clientId)).data ?? []).some((r) => r.tag === A));
  await pause(800);
  if (OUT) await page.screenshot({ path: `${OUT}/fiche-client-etiquette.png` });

  // ── 3. Comptée dans Réglages, puis fusion A → B ──
  await page.goto(`${BASE}/settings/tags`, { waitUntil: 'networkidle2', timeout: 90000 }).catch(() => {});
  await page.waitForFunction((n) => document.body.innerText.includes(n), { timeout: 30000 }, A).catch(() => {});
  const ligneA = await page.evaluate((n) => [...document.querySelectorAll('li')].find((l) => l.textContent.includes(n) && !l.textContent.includes('VIP'))?.textContent ?? '', A);
  verif('Réglages compte le client', /1 client/.test(ligneA), ligneA.trim());
  await page.evaluate((n) => document.querySelector(`button[aria-label="Renommer ${n}"]`)?.click(), A);
  await page.waitForSelector(`input[aria-label="Nouveau nom pour ${A}"]`, { timeout: 5000 });
  await saisir(page, `input[aria-label="Nouveau nom pour ${A}"]`, B.toLowerCase());
  if (process.env.QA_DEBUG) console.log('   valeur saisie :', await page.evaluate((n) => document.querySelector(`input[aria-label="Nouveau nom pour ${n}"]`)?.value, A));
  await page.focus(`input[aria-label="Nouveau nom pour ${A}"]`); await page.keyboard.press('Enter');
  if (process.env.QA_DEBUG) { await pause(1000); console.log('   dialogues :', await page.evaluate(() => [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].map((d) => d.textContent.slice(0, 120)))); }
  await page.waitForFunction(() => /Fusionner les étiquettes/.test(document.body.innerText), { timeout: 8000 }).catch(() => {});
  if (OUT) await page.screenshot({ path: `${OUT}/apres-renommer.png` });
  verif('renommer vers une étiquette existante propose de FUSIONNER', await page.evaluate(() => /Fusionner les étiquettes/.test(document.body.innerText)));
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Fusionner')?.click());
  await attendre(async () => ((await admin.from('client_tags').select('tag').eq('client_id', clientId)).data ?? []).some((r) => r.tag === B));
  const apres = ((await admin.from('client_tags').select('tag').eq('client_id', clientId)).data ?? []).map((r) => r.tag);
  verif('après fusion : le client porte B, plus A', apres.includes(B) && !apres.includes(A), apres.join(','));
  verif('… et A a quitté le catalogue', !(await admin.from('tags').select('id').eq('org_id', ORG).eq('name', A).maybeSingle()).data);

  // ── 4. Supprimer B ──
  await page.waitForFunction((n) => !!document.querySelector(`button[aria-label="Supprimer ${n}"]`), { timeout: 10000 }, B).catch(() => {});
  await page.evaluate((n) => document.querySelector(`button[aria-label="Supprimer ${n}"]`)?.click(), B);
  await page.waitForFunction(() => /Aucun client n’est supprimé/.test(document.body.innerText), { timeout: 8000 }).catch(() => {});
  verif('supprimer annonce le nombre de clients touchés', await page.evaluate(() => /retirée de 1 client/.test(document.body.innerText)));
  await page.evaluate(() => [...document.querySelectorAll('button')].filter((b) => b.textContent.trim() === 'Supprimer').pop()?.click());
  await attendre(async () => ((await admin.from('client_tags').select('tag').eq('client_id', clientId)).data ?? []).length === 0);
  verif('supprimée : retirée du client et du catalogue, le client existe toujours',
    ((await admin.from('client_tags').select('tag').eq('client_id', clientId)).data ?? []).length === 0
    && !(await admin.from('tags').select('id').eq('org_id', ORG).eq('name', B).maybeSingle()).data
    && !!(await admin.from('clients').select('id').eq('id', clientId).maybeSingle()).data);
} catch (e) {
  ko++; console.log('💥', e.message ?? e);
} finally {
  await nav.close();
  await admin.from('tags').delete().eq('org_id', ORG).in('name', [A, B]);
  if (clientId) {
    await admin.from('client_tags').delete().eq('client_id', clientId);
    await admin.from('domain_events').delete().eq('entity_id', clientId);
    await admin.from('activity_log').delete().eq('related_entity_id', clientId);
    await admin.from('clients').delete().eq('id', clientId);
  }
  console.log(`\n${ok} ✅  ${ko} ❌   — nettoyage fait`);
}
