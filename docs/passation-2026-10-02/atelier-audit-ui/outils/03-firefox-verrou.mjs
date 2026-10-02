// D'où vient l'exception « Navigator LockManager lock … immediately failed » sous Firefox ?
import { ouvrir } from './nav.mjs';

for (const essai of [1, 2, 3]) {
  const o = await ouvrir({ navigateur: 'firefox' });
  const piles = [];
  o.page.on('pageerror', (e) => piles.push({ message: e.message, nom: e.name, pile: (e.stack || '').split('\n').slice(0, 12).join('\n') }));
  await o.page.goto(`${o.base}/automations`, { waitUntil: 'domcontentloaded' });
  await o.page.getByRole('heading', { name: 'Mes automatisations' }).waitFor({ timeout: 90_000 });
  await o.page.waitForLoadState('networkidle').catch(() => undefined);
  await o.page.waitForTimeout(1500);
  console.log(`essai ${essai} : ${piles.length} exception(s)`);
  for (const p of piles) console.log(p.nom, '|', p.message, '\n', p.pile);
  await o.fermer();
}
