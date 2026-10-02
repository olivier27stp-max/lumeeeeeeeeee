/**
 * Agent S — MESURE (pas une preuve) : combien d'appels à `/api/automations/rules/*` un écran fait en s'ouvrant,
 * puis en restant ouvert 70 s. La limite de lecture est de 300 par minute et par utilisateur
 * (`regleLectureLimiter`, server/index.ts) ; les preuves, qui enchaînent des dizaines d'écrans sous le même
 * compte, la touchent. Un écran seul doit en rester très loin.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { writeFileSync } from 'node:fs';
import { ouvrirOnglet, fermerNavigateur } from '../../../automations-suite/harnais/navigateur';
import { lireManifeste } from '../jeu-connu';

afterAll(async () => { await fermerNavigateur(); });

describe('S — mesure des appels de lecture par écran', () => {
  it('liste, Vue d’ensemble, Activité, éditeur (Historique, Journaux) : à l’ouverture, puis sur 70 s', async () => {
    const jeu = lireManifeste();
    const o = await ouvrirOnglet({ langue: 'fr' });
    const mesures: Record<string, { ouverture: number; en70s: number; detail: Record<string, number> }> = {};
    try {
      let appels: string[] = [];
      o.page.on('request', (r) => {
        const u = new URL(r.url());
        if (u.pathname.startsWith('/api/automations/rules') && r.method() === 'GET') appels.push(u.pathname.replace(/[0-9a-f-]{36}/g, ':id'));
      });
      const mesurer = async (nom: string, ouvrir: () => Promise<void>) => {
        appels = [];
        await ouvrir();
        await o.page.waitForTimeout(5_000);
        const ouverture = appels.length;
        await o.page.waitForTimeout(65_000);
        const detail: Record<string, number> = {};
        for (const a of appels) detail[a] = (detail[a] ?? 0) + 1;
        mesures[nom] = { ouverture, en70s: appels.length, detail };
      };
      await mesurer('liste', async () => { await o.page.goto(`${o.base}/automations`); await o.page.locator('table tbody tr').first().waitFor(); });
      await mesurer('apercu', async () => { await o.page.goto(`${o.base}/automations/apercu`); await o.page.locator('[role="img"]').first().waitFor(); });
      await mesurer('activite', async () => { await o.page.goto(`${o.base}/automations/activite`); await o.page.locator('table tbody tr').first().waitFor(); });
      await mesurer('editeur-historique', async () => {
        await o.page.goto(`${o.base}/automations/${jeu.regles.S.id}`);
        await o.page.getByRole('tab', { name: 'Historique', exact: true }).click();
        await o.page.locator('table tbody tr').first().waitFor();
      });
      writeFileSync(`${process.env.QA_UI_SORTIES || 'D:/lume-final/sorties/s'}/mesure-appels.json`, JSON.stringify(mesures, null, 1));
      for (const [nom, m] of Object.entries(mesures)) expect(m.en70s, `${nom} : ${JSON.stringify(m.detail)}`).toBeLessThan(30);
    } finally { await o.fermer(); }
  }, 400_000);
});
