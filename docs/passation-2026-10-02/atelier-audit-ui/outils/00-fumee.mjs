// Fumée : l'app locale s'ouvre-t-elle, connectée au bureau de test, dans les 3 navigateurs ?
import { ouvrir, inventaire, capture, etat } from './nav.mjs';

console.log('bureaux :', etat().orgA, etat().orgB);
for (const navigateur of ['chromium', 'webkit', 'firefox']) {
  const o = await ouvrir({ navigateur });
  try {
    await o.page.goto(`${o.base}/automations`, { waitUntil: 'domcontentloaded' });
    await o.page.getByRole('heading', { name: 'Mes automatisations' }).waitFor({ timeout: 90_000 });
    await o.page.waitForLoadState('networkidle').catch(() => undefined);
    const inv = await inventaire(o.page);
    const c = await capture(o.page, `fumee-${navigateur}`);
    console.log(navigateur, '→', inv.elements.length, 'éléments interactifs ; console', o.m.console.length, '; exceptions', o.m.exceptions.length, '; réseau >=400', o.m.reseau.length, '; échecs', o.m.echecs.length, ';', c);
    for (const x of [...o.m.console.slice(0, 3), ...o.m.exceptions.slice(0, 3), ...o.m.reseau.slice(0, 5), ...o.m.echecs.slice(0, 3)]) console.log('   ', JSON.stringify(x).slice(0, 260));
  } catch (e) {
    console.log(navigateur, 'ÉCHEC', String(e).slice(0, 300), await capture(o.page, `fumee-${navigateur}-echec`));
  } finally { await o.fermer(); }
}
