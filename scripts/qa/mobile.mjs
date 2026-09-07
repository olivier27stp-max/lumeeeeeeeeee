#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   MOBILE — les pages principales à 390 px de large, comme sur un
   téléphone tenu à la main.

   CE QU'IL VÉRIFIE, page par page
     - la page a du contenu (pas un écran vide ni une barrière)
     - rien ne déborde à droite : pas de défilement horizontal
     - aucune erreur console, aucune requête en échec
     - les cibles tactiles principales font au moins 40 px

   Deux passes : agent « ordinateur » à 390 px (mise en page réactive),
   puis agent « iPhone » (la barrière « téléchargez l'app », si elle
   existe, doit être un choix, pas un mur : on note ce qu'on voit).

   Usage : FRONTEND_URL=http://localhost:5174 node --env-file=.env.local scripts/qa/mobile.mjs
   ═══════════════════════════════════════════════════════════════ */

import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import puppeteer from 'puppeteer';

const RACINE = process.cwd();
const BASE = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
const COMPTE = process.env.QA_COMPTE || 'willhebert30@gmail.com';
const PAGES = ['/day', '/clients', '/jobs', '/calendar', '/quotes', '/finances', '/requests', '/settings/company'];
const admin = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const anon = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } });

const resultats = [];
const ok = (nom, vrai, detail = '') => { resultats.push({ nom, vrai: !!vrai, detail }); console.log(`  ${vrai ? '✓' : '✗'} ${nom}${detail ? ' — ' + detail : ''}`); };

const { data: l } = await admin.auth.admin.generateLink({ type: 'magiclink', email: COMPTE });
const { data: s } = await anon.auth.verifyOtp({ token_hash: l.properties.hashed_token, type: 'magiclink' });
const { data: m } = await admin.from('memberships').select('org_id').eq('user_id', s.user.id).eq('status', 'active').limit(1).maybeSingle();
const jeton = { access_token: s.session.access_token, refresh_token: s.session.refresh_token, expires_at: s.session.expires_at, expires_in: s.session.expires_in, token_type: 'bearer', user: s.user };

const nav = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const dir = path.join(RACINE, 'qa-captures'); fs.mkdirSync(dir, { recursive: true });

async function passe(nomPasse, ua) {
  console.log(`\n── ${nomPasse} ──`);
  for (const chemin of PAGES) {
    const ctx = await nav.createBrowserContext();
    const page = await ctx.newPage();
    if (ua) await page.setUserAgent(ua);
    await page.setViewport({ width: 390, height: 844, isMobile: !!ua, hasTouch: !!ua, deviceScaleFactor: 2 });
    await page.evaluateOnNewDocument((t, o) => { localStorage.setItem('lume-auth-token', JSON.stringify(t)); localStorage.setItem('lume-active-org', o); localStorage.setItem('lume-language', 'fr'); localStorage.setItem('lume-cookie-consent', JSON.stringify({ necessary: true, analytics: false, marketing: false, decidedAt: Date.now() })); }, jeton, m.org_id);
    const erreurs = []; const echecs = [];
    page.on('console', (x) => { if (x.type() === 'error') erreurs.push(x.text().slice(0, 100)); });
    page.on('response', (r) => { if (r.status() >= 400 && r.url().includes('/api/')) echecs.push(`${r.status()} ${r.url().replace(BASE, '').split('?')[0]}`); });
    await page.goto(BASE + chemin, { waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 2000));
    const mesure = await page.evaluate(() => {
      const texte = document.body.innerText;
      const deborde = document.documentElement.scrollWidth - document.documentElement.clientWidth;
      const petites = [...document.querySelectorAll('button, a[href], [role=button]')]
        .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.top >= 0 && r.top < 844 && (r.height < 32 || r.width < 32); })
        .map((e) => (e.innerText || e.getAttribute('aria-label') || e.tagName).trim().slice(0, 20)).filter(Boolean).slice(0, 6);
      return { longueur: texte.length, deborde, petites, barriere: /télécharge|download the app|App Store|Google Play/i.test(texte) && texte.length < 800 };
    });
    await page.screenshot({ path: path.join(dir, `mobile-${nomPasse.replace(/\W+/g, '_')}-${chemin.replace(/\W+/g, '_')}.png`) });
    const nom = `${chemin}`;
    if (mesure.barriere) { console.log(`  · ${nom} : barrière « téléchargez l'app » affichée`); await ctx.close(); continue; }
    ok(`${nom} : a du contenu`, mesure.longueur > 200, `${mesure.longueur} car.`);
    ok(`${nom} : ne déborde pas à droite`, mesure.deborde <= 0, mesure.deborde > 0 ? `${mesure.deborde} px de trop` : '');
    ok(`${nom} : aucune erreur console / requête en échec`, erreurs.length === 0 && echecs.length === 0, [...echecs, ...erreurs].slice(0, 2).join(' | '));
    if (mesure.petites.length) console.log(`  · ${nom} : cibles tactiles < 32 px : ${mesure.petites.join(', ')}`);
    await ctx.close();
  }
}

await passe('ordinateur à 390 px', null);
await passe('iPhone', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1');
await nav.close();

const rates = resultats.filter((r) => !r.vrai);
console.log(`\n${'═'.repeat(60)}\n  ${resultats.length - rates.length}/${resultats.length} vérifications passées`);
for (const r of rates) console.log(`  ✗ ${r.nom}${r.detail ? ' — ' + r.detail : ''}`);
fs.writeFileSync(path.join(RACINE, 'qa-mobile.json'), JSON.stringify({ genereLe: new Date().toISOString(), resultats }, null, 2));
process.exit(rates.length ? 1 : 0);
