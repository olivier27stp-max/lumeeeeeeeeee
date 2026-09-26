// Usage : FRONTEND_URL=http://localhost:5173 node --env-file=.env.local scripts/qa/voir-pipelines-ghl.mjs <dossier-captures>
// Parcours NAVIGATEUR de l'onglet Pipelines (lecture seule). Vérifie que chaque option des menus ⋮ est
// réellement cliquable (le rognage par un tableau défilant ne se voit pas en jsdom).

// Parcours NAVIGATEUR de l'onglet Pipelines (lecture seule : on ouvre et on
// annule, on n'enregistre rien). Captures dans le dossier passé en argument.
import puppeteer from 'puppeteer';
const BASE = process.env.FRONTEND_URL;
const OUT = process.argv[2];
const COMPTE = 'qa-pipeline@lume.test', MDP = 'QaPipeline1234!';
const nav = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const page = await (await nav.createBrowserContext()).newPage();
await page.setViewport({ width: 1440, height: 900 });
const erreurs = [];
page.on('pageerror', (e) => erreurs.push('PAGEERROR ' + e.message));
page.on('console', (c) => { if (c.type() === 'error' && !/favicon|net::ERR|DevTools|404/i.test(c.text())) erreurs.push(c.text().slice(0, 200)); });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const cliquer = (re) => page.evaluate((src) => {
  const r = new RegExp(src);
  const b = [...document.querySelectorAll('button,[role="menuitem"],[role="tab"]')]
    .find((x) => r.test((x.getAttribute('aria-label') || '') + ' ' + (x.textContent || '').trim()));
  if (b) b.click();
  return !!b;
}, re.source);
const texte = () => page.evaluate(() => document.body.innerText);
const rouge = async (etape) => { if (/Une erreur est survenue|Une erreur inattendue/.test(await texte())) erreurs.push('ÉCRAN ROUGE à ' + etape); };
const photo = (nom) => page.screenshot({ path: `${OUT}/${nom}.png` });

// Chaque option est-elle VRAIMENT cliquable (pas rognée, pas masquée) ?
const optionsCliquables = () => page.evaluate(() => [...document.querySelectorAll('[role="menuitem"]')].map((e) => {
  const r = e.getBoundingClientRect();
  const x = r.left + r.width / 2, y = r.top + r.height / 2;
  const dessus = document.elementFromPoint(x, y);
  return { nom: e.textContent.trim(), ok: r.height > 0 && y > 0 && y < innerHeight && (dessus === e || e.contains(dessus)) };
}));
const etapes = [];
const ok = (n, c) => { etapes.push(`${c ? '✅' : '❌'} ${n}`); };

await page.evaluateOnNewDocument(() => { localStorage.setItem('lume-language', 'fr'); });
await page.goto(`${BASE}/auth`, { waitUntil: 'networkidle2', timeout: 90000 }).catch(() => {});
await page.waitForSelector('input[type=email]', { timeout: 90000 });
await pause(800);
await cliquer(/^\s*tout refuser$/i);
await pause(400);
await page.evaluate((m, d) => {
  const st = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  const e = document.querySelector('input[type=email]'); const q = document.querySelector('input[type=password]');
  st.call(e, m); e.dispatchEvent(new Event('input', { bubbles: true }));
  st.call(q, d); q.dispatchEvent(new Event('input', { bubbles: true }));
}, COMPTE, MDP);
await page.focus('input[type=password]');
await page.keyboard.press('Enter');
await page.waitForFunction(() => !location.pathname.startsWith('/auth'), { timeout: 60000 }).catch(() => {});
await pause(3000);
console.log('après connexion :', new URL(page.url()).pathname);
await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /^tout refuser$/i.test(x.textContent.trim())); if (b) b.click(); });
await pause(500);

await page.goto(`${BASE}/ventes?tab=reglages`, { waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {});
await pause(3000);
await rouge('liste');
const t1 = await texte();
ok('Liste : titre et sous-titre', t1.includes('Utilisez les pipelines pour suivre vos opportunités'));
ok('Liste : colonnes GHL', ['Nom du pipeline', 'Total d’étapes', 'Mis à jour le'].every((x) => t1.includes(x)));
ok('Liste : pagination', /Page 1 de 1/.test(t1));
await photo('1-liste');

const nom = await page.evaluate(() => document.querySelector('tbody tr td:nth-child(3) button')?.textContent?.trim());
await cliquer(new RegExp(`Actions pour ${nom}`));
await pause(400);
const menu = await page.evaluate(() => [...document.querySelectorAll('[role="menuitem"]')].map((e) => e.textContent.trim()));
ok(`Menu ⋮ : ${menu.join(' / ')}`, menu.length === 7 && menu[6] === 'Supprimer');
const cl = await optionsCliquables();
ok(`Menu ⋮ : les 7 options réellement cliquables (${cl.filter((c) => !c.ok).map((c) => c.nom).join(', ') || 'toutes'})`, cl.length === 7 && cl.every((c) => c.ok));
await photo('2-menu');
await page.keyboard.press('Escape');
await pause(300);

await cliquer(/Créer un pipeline/);
await pause(800);
await rouge('modal');
const t2 = await texte();
ok('Modal Créer : étapes par défaut', ['Nouveau lead', 'Contacté'].every((x) => t2.includes(x)) || await page.evaluate(() => [...document.querySelectorAll('input[id^="etape-nom-"]')].length === 6));
await photo('3-modal-creer');
await cliquer(/^\s*Annuler$/);
await pause(500);

await page.evaluate(() => document.querySelector('tbody tr td:nth-child(3) button')?.click());
await pause(2500);
await rouge('détail');
const t3 = await texte();
ok('Détail : onglets et cartes', ['Smart tags', 'Utiliser la probabilité par opportunité', 'Couleurs d’affichage du pipeline', 'Probabilité (%)'].every((x) => t3.includes(x)));
ok('Détail : URL partageable', page.url().includes('pipeline='));
await photo('4-detail');
const etapeNom = await page.evaluate(() => document.querySelector('button[aria-label^="Actions pour l’étape"]')?.getAttribute('aria-label'));
await cliquer(new RegExp(etapeNom));
await pause(400);
const cl2 = await optionsCliquables();
ok(`Menu d’une étape : Renommer et Supprimer cliquables`, cl2.length === 2 && cl2.every((c) => c.ok));
await photo('4b-menu-etape');
await page.keyboard.press('Escape');
await page.mouse.click(5, 5);
await pause(300);
await cliquer(/Smart tags/);
await pause(400);
ok('Smart tags : Bientôt', (await texte()).includes('Bientôt'));
await cliquer(/^\s*Étapes$/);
await pause(400);

// Format iPad
await page.setViewport({ width: 820, height: 1180 });
await pause(800);
await photo('5-detail-ipad');
const deborde = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
ok('iPad : pas de défilement horizontal de la page', !deborde);
await cliquer(/Retour à la liste des pipelines/);
await pause(1500);
await photo('6-liste-ipad');

console.log(etapes.join('\n'));
console.log(erreurs.length ? `\nERREURS (${erreurs.length}) :\n` + erreurs.join('\n') : '\nAucune erreur console, aucun écran rouge.');
await nav.close();
