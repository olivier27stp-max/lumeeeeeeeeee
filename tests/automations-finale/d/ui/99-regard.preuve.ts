/**
 * Agent S — un REGARD sur les écrans (pas une preuve) : captures et textes, pour relire à l'œil
 * ce que le navigateur affiche en français et en anglais. Sorties : D:/lume-final/sorties/s/.
 *
 *   QA_AUTO_SUFFIXE=d QA_UI_PORT_API=3494 QA_UI_PORT_VITE=5494 QA_UI_SORTIES=D:/lume-final/sorties/s \
 *     npx vitest run --maxWorkers=2 --config tests/automations-finale/d/vitest.config.ts --project ui \
 *     tests/automations-finale/d/ui/99-regard.preuve.ts
 */
import { describe, it, beforeAll, afterAll } from 'vitest';
import { writeFileSync } from 'node:fs';
import { ouvrirOnglet, fermerNavigateur, capturer, type Onglet } from '../../../automations-suite/harnais/navigateur';
import { lireManifeste, type Manifeste } from '../jeu-connu';

const SORTIES = process.env.QA_UI_SORTIES || 'D:/lume-final/sorties/s';
let jeu: Manifeste;
const propre = (t: string | null | undefined) => String(t ?? '').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();

beforeAll(() => { jeu = lireManifeste(); });
afterAll(async () => { await fermerNavigateur(); });

async function regarder(o: Onglet, langue: string): Promise<void> {
  const textes: Record<string, string> = {};
  const voir = async (nom: string) => {
    await o.page.waitForTimeout(600);
    await capturer(o.page, `s-${langue}-${nom}`);
    textes[nom] = propre(await o.page.locator('main, body').first().innerText());
  };
  await o.page.goto(`${o.base}/automations`);
  await o.page.locator('#rech-automations').waitFor();
  await o.page.locator('table tbody tr').first().waitFor();
  await o.page.locator('#rech-automations').fill('[QA-D jeu]');
  await o.page.locator('#par-page').selectOption('50');
  await voir('liste');
  for (const cle of ['E', 'T', 'H']) {
    await o.page.locator('table tbody tr').filter({ hasText: jeu.regles[cle].nom }).first().locator('button[aria-expanded]').first().click();
    await voir(`liste-panneau-${cle}`);
    await o.page.locator('table tbody tr').filter({ hasText: jeu.regles[cle].nom }).first().locator('button[aria-expanded]').first().click();
  }
  await o.page.goto(`${o.base}/automations/apercu`);
  await o.page.locator('[role="img"]').first().waitFor();
  await voir('apercu');
  await o.page.goto(`${o.base}/automations/activite`);
  await o.page.locator('table tbody tr').first().waitFor();
  await voir('activite-historique');
  await o.page.locator('table tbody tr[role="button"]').first().click();
  await voir('activite-historique-deplie');
  await o.page.goto(`${o.base}/automations/activite?vue=journaux`);
  await o.page.locator('table tbody tr').first().waitFor();
  await voir('activite-journaux');
  for (const cle of ['E', 'P', 'K']) {
    await o.page.goto(`${o.base}/automations/${jeu.regles[cle].id}`);
    await o.page.getByRole('tab').nth(2).click();
    await o.page.locator('table tbody tr').first().waitFor();
    await voir(`editeur-historique-${cle}`);
    await o.page.locator('table tbody tr[role="button"]').first().click();
    await voir(`editeur-historique-${cle}-deplie`);
    await o.page.getByRole('tab').nth(3).click();
    await o.page.locator('table tbody tr').first().waitFor();
    await o.page.locator('table tbody tr[role="button"]').first().click();
    await voir(`editeur-journaux-${cle}-deplie`);
  }
  writeFileSync(`${SORTIES}/regard-${langue}.json`, JSON.stringify({ textes, erreurs: o.erreurs }, null, 1));
}

describe('S — regard sur les écrans', () => {
  it('français', async () => {
    const o = await ouvrirOnglet({ langue: 'fr' });
    try { await regarder(o, 'fr'); } finally { await o.fermer(); }
  });
  it('anglais', async () => {
    const o = await ouvrirOnglet({ langue: 'en' });
    try { await regarder(o, 'en'); } finally { await o.fermer(); }
  });
});
