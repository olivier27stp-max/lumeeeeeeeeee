/**
 * Capture de la page « Modèles de courriel » (/settings/email-templates).
 *
 * Vérifier soi-même le rendu plutôt que de demander à quelqu'un d'ouvrir
 * l'app : les tests disent que le code compile, pas que la page est utilisable.
 *
 *   FRONTEND_URL=http://localhost:5199 node --env-file=.env.local scripts/qa/capture-modeles-courriel.mjs
 *
 * Session : lien magique du compte QA (staging), jeton dans localStorage —
 * même procédé que capture-tiroir-aide.mjs. Sorties dans qa-captures/.
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
const jeton = {
  access_token: s.session.access_token, refresh_token: s.session.refresh_token,
  expires_at: s.session.expires_at, expires_in: s.session.expires_in,
  token_type: 'bearer', user: s.user,
};

const dir = path.join(process.cwd(), 'qa-captures');
fs.mkdirSync(dir, { recursive: true });

const nav = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const erreurs = [];

for (const vp of [
  { nom: 'ordinateur', width: 1440, height: 1200 },
  { nom: 'telephone', width: 390, height: 844, mobile: true },
]) {
  const ctx = await nav.createBrowserContext();
  const page = await ctx.newPage();
  // Une erreur de console pendant le rendu en dit plus qu'une capture vide.
  page.on('pageerror', (e) => erreurs.push(`${vp.nom} : ${e.message}`));
  page.on('console', (c) => { if (c.type() === 'error') erreurs.push(`${vp.nom} : ${c.text().slice(0, 200)}`); });
  page.on('requestfailed', (r) => erreurs.push(`${vp.nom} REQ-ECHEC : ${r.url().slice(0, 120)}`));
  page.on('response', (r) => { if (r.status() >= 400) erreurs.push(`${vp.nom} HTTP ${r.status()} : ${r.url().slice(0, 120)}`); });

  await page.setViewport({
    width: vp.width, height: vp.height,
    isMobile: !!vp.mobile, hasTouch: !!vp.mobile, deviceScaleFactor: 1,
  });
  await page.evaluateOnNewDocument((t, o) => {
    localStorage.setItem('lume-auth-token', JSON.stringify(t));
    localStorage.setItem('lume-active-org', o);
    localStorage.setItem('lume-language', 'fr');
    localStorage.setItem('lume.cookieConsent.v1', JSON.stringify({ analytics: false, marketing: false, preferences: false, decidedAt: new Date().toISOString(), docVersion: 'cookie-policy-2026-07-23' }));
    localStorage.setItem('lume-setup-dismissed', '1');
  }, jeton, m.org_id);

  await page.goto(`${BASE}/settings/email-templates`, { waitUntil: 'networkidle2', timeout: 90000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 2500));

  const vu = await page.evaluate(() => ({
    titre: document.querySelector('h1')?.textContent?.trim() || '(aucun h1)',
    groupes: [...document.querySelectorAll('h2')].map((h) => h.textContent.trim()),
    postes: document.querySelectorAll('li').length,
    boutonsModifier: [...document.querySelectorAll('button, a')].filter((b) => /Modifier/i.test(b.textContent)).length,
    url: location.pathname,
  }));
  console.log(`\n── ${vp.nom} ──`);
  console.log('url      :', vu.url);
  console.log('titre    :', vu.titre);
  console.log('groupes  :', vu.groupes.join(' | '));
  console.log('postes   :', vu.postes, '· boutons Modifier :', vu.boutonsModifier);

  await page.screenshot({ path: path.join(dir, `modeles-courriel-${vp.nom}.png`), fullPage: vp.nom === 'ordinateur' });

  // Ouvrir l'éditeur sur le premier poste modifiable : c'est là que la page
  // devient utile, et là qu'une régression passerait inaperçue.
  if (vp.nom === 'ordinateur') {
    const bouton = await page.$$('button');
    for (const b of bouton) {
      const txt = await page.evaluate((el) => el.textContent, b);
      if (/Modifier/i.test(txt)) {
        await b.click();
        await new Promise((r) => setTimeout(r, 1500));
        const ouvert = await page.evaluate(() => document.body.innerText.includes('Objet du courriel') || !!document.querySelector('[role="dialog"], .fixed.inset-0'));
        console.log('éditeur s’ouvre :', ouvert ? 'oui' : 'NON');
        await page.screenshot({ path: path.join(dir, 'modeles-courriel-editeur.png') });
        break;
      }
    }
  }

  await ctx.close();
}

await nav.close();
if (erreurs.length) {
  console.log('\n⚠️ erreurs console :');
  for (const e of [...new Set(erreurs)].slice(0, 8)) console.log('  ', e);
} else {
  console.log('\naucune erreur console');
}
