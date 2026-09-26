// Usage : FRONTEND_URL=http://localhost:5173 node --env-file=.env.local scripts/qa/ipad-pipelines-ghl.mjs <dossier-captures>
// Passage iPad (lecture seule) : chaque écran du Pipeline, trois formats.
// Signale : défilement horizontal de la PAGE, défilement horizontal DANS une
// carte (tableau qui déborde), options de menu non cliquables.
import puppeteer from 'puppeteer';
const BASE = process.env.FRONTEND_URL;
const OUT = process.argv[2];
const nav = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const page = await (await nav.createBrowserContext()).newPage();
await page.setViewport({ width: 1440, height: 900 });
const erreurs = [];
page.on('pageerror', (e) => erreurs.push('PAGEERROR ' + e.message));
page.on('console', (c) => { if (c.type() === 'error' && !/favicon|net::ERR|DevTools|404/i.test(c.text())) erreurs.push(c.text().slice(0, 160)); });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
await page.evaluateOnNewDocument(() => { localStorage.setItem('lume-language', 'fr'); });
await page.goto(`${BASE}/auth`, { waitUntil: 'networkidle2', timeout: 90000 }).catch(() => {});
await page.waitForSelector('input[type=email]', { timeout: 90000 });
await page.evaluate((m, d) => {
  const st = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  const e = document.querySelector('input[type=email]'); const q = document.querySelector('input[type=password]');
  st.call(e, m); e.dispatchEvent(new Event('input', { bubbles: true }));
  st.call(q, d); q.dispatchEvent(new Event('input', { bubbles: true }));
}, 'qa-pipeline@lume.test', 'QaPipeline1234!');
await page.focus('input[type=password]');
await page.keyboard.press('Enter');
await page.waitForFunction(() => !location.pathname.startsWith('/auth'), { timeout: 60000 }).catch(() => {});
await pause(2500);
await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /^tout refuser$/i.test(x.textContent.trim())); if (b) b.click(); });

const mesurer = (ecran) => page.evaluate((ecran) => {
  const pb = [];
  if (document.documentElement.scrollWidth > innerWidth + 2) pb.push(`${ecran} : la PAGE défile horizontalement (${document.documentElement.scrollWidth} > ${innerWidth})`);
  for (const el of document.querySelectorAll('*')) {
    const cs = getComputedStyle(el);
    if (!/(auto|scroll)/.test(cs.overflowX)) continue;
    if (el.scrollWidth > el.clientWidth + 4 && el.clientWidth > 0) {
      const t = (el.innerText || '').replace(/\s+/g, ' ').slice(0, 50);
      pb.push(`${ecran} : zone qui défile de côté (${el.scrollWidth - el.clientWidth}px caché) « ${t} »`);
    }
  }
  return pb;
}, ecran);
const menuOk = (ecran) => page.evaluate((ecran) => {
  const items = [...document.querySelectorAll('[role="menuitem"]')];
  const ko = items.filter((e) => {
    const r = e.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const d = document.elementFromPoint(x, y);
    return !(r.height > 0 && x > 0 && x < innerWidth && y > 0 && y < innerHeight && (d === e || e.contains(d)));
  }).map((e) => e.textContent.trim());
  return ko.length ? [`${ecran} : options de menu non cliquables : ${ko.join(', ')}`] : [];
}, ecran);
const cliquer = (sel) => page.evaluate((sel) => { const b = document.querySelector(sel); if (b) b.click(); return !!b; }, sel);

const FORMATS = [['ipad-portrait', 820, 1180], ['ipad-paysage', 1180, 820], ['ipadpro-portrait', 1024, 1366]];
const problemes = [];
for (const [nom, w, h] of FORMATS) {
  await page.setViewport({ width: w, height: h, isMobile: true, hasTouch: true });
  const aller = async (url) => { await page.goto(`${BASE}${url}`, { waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {}); await pause(2200); };

  await aller('/ventes');
  problemes.push(...await mesurer(`${nom} board`));
  await page.screenshot({ path: `${OUT}/${nom}-1-board.png` });

  await aller('/ventes?tab=reglages');
  problemes.push(...await mesurer(`${nom} liste`));
  await page.screenshot({ path: `${OUT}/${nom}-2-liste.png` });
  await cliquer('button[aria-label^="Actions pour"]');
  await pause(400);
  problemes.push(...await menuOk(`${nom} menu ⋮ liste`));
  await page.screenshot({ path: `${OUT}/${nom}-3-menu.png` });
  await page.keyboard.press('Escape');

  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /Créer un pipeline/.test(b.textContent))?.click());
  await pause(700);
  problemes.push(...await mesurer(`${nom} modal`));
  await page.screenshot({ path: `${OUT}/${nom}-4-modal.png` });
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Annuler')?.click());
  await pause(400);

  await cliquer('tbody tr td:nth-child(3) button');
  await pause(2200);
  problemes.push(...await mesurer(`${nom} détail`));
  await page.screenshot({ path: `${OUT}/${nom}-5-detail.png` });
  await cliquer('button[aria-label^="Actions pour l’étape"]');
  await pause(400);
  problemes.push(...await menuOk(`${nom} menu ⋮ étape`));
  await page.keyboard.press('Escape');
  await page.mouse.click(3, 3);

  await aller('/ventes?tab=previsions');
  problemes.push(...await mesurer(`${nom} prévisions`));
  await page.screenshot({ path: `${OUT}/${nom}-6-previsions.png`, fullPage: true });
}
console.log(problemes.length ? `PROBLÈMES (${problemes.length}) :\n` + problemes.join('\n') : 'Aucun défilement horizontal, menus cliquables partout.');
console.log(erreurs.length ? `\nERREURS (${erreurs.length}) :\n` + [...new Set(erreurs)].join('\n') : 'Aucune erreur console.');
await nav.close();
