// Passe prod, tablette : l'avatar « Mon profil » de la barre du haut tient-il à l'écran sur un iPad en portrait ?
// LECTURE SEULE. --simuler applique dans la page la mise en page du correctif avant son déploiement.
import { ouvrir, capture } from '../nav-prod.mjs';
const simuler = process.argv.includes('--simuler');
const IPAD = 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
let ok = 0; let total = 0;
for (const [nom, viewport] of [['ipad-portrait', { width: 768, height: 1024 }], ['ipad-paysage', { width: 1024, height: 768 }]]) {
  total += 1;
  const o = await ouvrir({ navigateur: 'webkit', viewport, tactile: true, userAgent: IPAD, delai: 30_000 });
  const { page } = o;
  try {
    await page.goto('https://lumecrm.net/automations', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /^Actions pour / }).first().waitFor({ timeout: 60_000 });
    await o.temoins();
    await page.waitForTimeout(800);
    if (simuler) {
      await page.evaluate(() => {
        const recherche = document.querySelector('header input')?.closest('div.relative.w-48, div[class*="md:w-56"]');
        if (recherche && innerWidth < 1024) recherche.style.width = '12rem';
        const bureau = document.querySelector('header > div.relative');
        if (bureau) bureau.style.minWidth = '0';
      });
      await page.waitForTimeout(400);
    }
    const m = await page.evaluate(() => {
      const entete = document.querySelector('header');
      const droite = (el) => Math.round(el.getBoundingClientRect().right);
      const tous = [...entete.querySelectorAll('button, input, a')].filter((el) => el.getBoundingClientRect().width > 0);
      const hors = tous.filter((el) => droite(el) > innerWidth + 1).map((el) => `${el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('placeholder') || el.textContent.trim().slice(0, 20)} (droite=${droite(el)})`);
      return { largeur: innerWidth, hors, entete: Math.round(entete.scrollWidth), visible: Math.round(entete.clientWidth) };
    });
    await capture(page, `p9-${nom}${simuler ? '-simule' : ''}`);
    const bon = m.hors.length === 0 && m.entete <= m.visible + 1;
    if (bon) ok += 1;
    console.log(`${bon ? '✓' : '✗'} ${nom} ${viewport.width} px — barre du haut ${m.entete} px dans ${m.visible} px ; hors écran : ${m.hors.join(' | ') || 'rien'}`);
  } catch (e) { console.log(`✗ ${nom} : ${String(e).split('\n')[0].slice(0, 200)}`); }
  finally { await o.fermer(); }
}
console.log(`BILAN${simuler ? ' (correctif simulé)' : ''} : ${ok}/${total}`);
