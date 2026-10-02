// Preuve : l'erreur « Blocked script execution in 'about:srcdoc' » vient-elle du produit
// (le HTML du courriel) ou de l'outil de test (Playwright qui évalue dans l'iframe sandbox="") ?
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire('D:/lume-uiaudit/wt/package.json');
const { chromium } = require('@playwright/test');
const html = readFileSync('D:/lume-uiaudit/sorties/modeles/explo-courriel-apercu.html', 'utf8');
const b = await chromium.launch();
for (const avecInit of [false, true]) {
  const ctx = await b.newContext();
  if (avecInit) await ctx.addInitScript(() => { window.__x = 1; });
  if (process.argv[2] === 'trace') await ctx.tracing.start({ snapshots: true, screenshots: true });
  const p = await ctx.newPage();
  const erreurs = [];
  p.on('console', (m) => { if (m.type() === 'error') erreurs.push(m.text()); });
  await p.goto('http://127.0.0.1:5183/robots.txt');
  await p.evaluate((h) => {
    const f = document.createElement('iframe'); f.setAttribute('sandbox', ''); f.srcdoc = h; document.body.appendChild(f);
    return new Promise((r) => { f.onload = () => r(); });
  }, html);
  await p.waitForTimeout(400);
  console.log('trace =', process.argv[2] === 'trace', '| addInitScript =', avecInit, '→ erreurs console au seul affichage :', erreurs);
  const avant = erreurs.length;
  await p.frameLocator('iframe').locator('body').waitFor({ timeout: 3000 }).catch((e) => console.log('  frameLocator :', String(e.message).slice(0, 80)));
  await p.waitForTimeout(400);
  console.log('  erreurs ajoutées par frameLocator :', erreurs.slice(avant));
  await ctx.close();
}
await b.close();
