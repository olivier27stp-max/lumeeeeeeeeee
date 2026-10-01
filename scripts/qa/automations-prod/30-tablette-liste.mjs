// Vrai site, tablette : mesure sur lumecrm.net si l'interrupteur et le menu « ⋮ » de la liste sont À L'ÉCRAN
// sur un iPad (paysage 1024, portrait 768), WebKit. LECTURE SEULE.
//   --simuler : applique d'abord, dans la page, la mise en page du correctif (avant son déploiement) pour la
//               mesurer sur les vraies données ; sans l'option : mesure le site tel qu'il est.
import { ouvrir, capture } from './outils.mjs';

const simuler = process.argv.includes('--simuler');
const IPAD = 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
let ok = 0; let total = 0;
for (const [nom, viewport] of [['ipad-paysage', { width: 1024, height: 768 }], ['ipad-portrait', { width: 768, height: 1024 }], ['ipad-pro-paysage', { width: 1366, height: 1024 }]]) {
  total += 1;
  const o = await ouvrir({ navigateur: 'webkit', viewport, tactile: true, userAgent: IPAD, delai: 30_000 });
  const { page } = o;
  try {
    await page.goto('https://lumecrm.net/automations', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /^Actions pour / }).first().waitFor({ timeout: 60_000 });
    await o.temoins();
    await page.waitForTimeout(1000);
    if (simuler) {
      await page.evaluate(() => {
        const table = document.querySelector('table');
        table.classList.remove('min-w-[980px]');
        table.style.minWidth = '440px';
        const cacher = (indices) => { for (const tr of table.querySelectorAll('thead tr, tbody tr')) { const c = tr.children; if (c.length < 9) continue; for (const i of indices) c[i].style.display = 'none'; } };
        if (innerWidth < 1024) cacher([3, 4]);
        if (innerWidth < 1280) cacher([5, 6]);
      });
      await page.waitForTimeout(400);
    }
    const mesure = await page.evaluate(() => {
      const dans = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.left >= 0 && r.right <= innerWidth + 1; };
      const boutons = [...document.querySelectorAll('tbody button')];
      const parNom = (motif) => boutons.filter((b) => motif.test(b.getAttribute('aria-label') || ''));
      const etat = (liste) => ({ total: liste.length, aLEcran: liste.filter(dans).length });
      const nom = document.querySelector('tbody tr td:nth-child(2)')?.getBoundingClientRect();
      const table = document.querySelector('table').getBoundingClientRect();
      const zone = document.querySelector('table').parentElement.getBoundingClientRect();
      return {
        interrupteurs: etat(parNom(/^(Publier|Repasser) /)), messages: etat(parNom(/^Voir les messages de /)), menus: etat(parNom(/^Actions pour /)),
        stats: etat(parNom(/^Statistiques de /)), largeurNom: Math.round(nom?.width ?? 0), table: Math.round(table.width), zone: Math.round(zone.width),
        enTetes: [...document.querySelectorAll('thead th')].filter((th) => th.getBoundingClientRect().width > 0).map((th) => (th.textContent || '').trim() || '·'),
      };
    });
    await capture(page, `p8-${nom}${simuler ? '-simule' : ''}`);
    const tout = ['interrupteurs', 'messages', 'menus', 'stats'].every((k) => mesure[k].total > 0 && mesure[k].aLEcran === mesure[k].total);
    const defile = mesure.table > mesure.zone + 1;
    if (tout && !defile && mesure.largeurNom >= 170) ok += 1;
    console.log(`${tout && !defile && mesure.largeurNom >= 170 ? '✓' : '✗'} ${nom} ${viewport.width}×${viewport.height} — interrupteurs ${mesure.interrupteurs.aLEcran}/${mesure.interrupteurs.total}, messages ${mesure.messages.aLEcran}/${mesure.messages.total}, menus ⋮ ${mesure.menus.aLEcran}/${mesure.menus.total}, stats ${mesure.stats.aLEcran}/${mesure.stats.total} ; tableau ${mesure.table} px dans ${mesure.zone} px ; colonne Nom ${mesure.largeurNom} px ; en-têtes : ${mesure.enTetes.join(' | ')}`);
  } catch (e) {
    console.log(`✗ ${nom} : ${String(e).split('\n')[0].slice(0, 240)}`);
  } finally { await o.fermer(); }
}
console.log(`BILAN${simuler ? ' (correctif simulé)' : ''} : ${ok}/${total}`);
