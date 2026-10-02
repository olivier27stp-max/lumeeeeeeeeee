/**
 * Agent S — lot « liste » (`D:/lume-uiaudit/sorties/triage/liste.md`) : ce que jsdom ne peut PAS prouver,
 * mesuré au vrai navigateur. jsdom ne calcule ni mise en page ni ordre de tabulation réel.
 *
 *   QA_AUTO_SUFFIXE=d QA_UI_PORT_API=3494 QA_UI_PORT_VITE=5494 \
 *     npx vitest run --maxWorkers=2 --config tests/automations-finale/d/vitest.config.ts --project ui \
 *     tests/automations-finale/d/ui/60-liste-lot.preuve.ts
 */
import { describe, it, expect, afterAll } from 'vitest';
import { ouvrirOnglet, fermerNavigateur, type Onglet } from '../../../automations-suite/harnais/navigateur';

afterAll(async () => { await fermerNavigateur(); });

async function ouvrirListe(o: Onglet): Promise<void> {
  await o.page.goto(`${o.base}/automations`);
  await o.page.locator('#rech-automations').waitFor();
  await o.page.locator('table tbody tr input[type="checkbox"]').first().waitFor();
}
/** Les chiffres sont arrivés : la colonne « Déclenchées » ne dit plus « … ». */
async function chiffresArrives(o: Onglet): Promise<void> {
  await expect.poll(async () => (await o.page.locator('table tbody tr').first().locator('td').nth(3).innerText()).trim(), { timeout: 20_000 }).toMatch(/^\d+$/);
}
const hautDe = async (o: Onglet, selecteur: string) => Math.round((await o.page.locator(selecteur).first().boundingBox())?.y ?? -1);

describe('S — lot « liste » : la mise en page au vrai navigateur', () => {
  for (const [nom, viewport] of [['bureau 1440 × 900', { width: 1440, height: 900 }], ['tablette 1024 × 800', { width: 1024, height: 800 }]] as const) {
    it(`[07-lot:97] ${nom} : cocher une ligne, puis toute la page, ne déplace pas le tableau d’un pixel`, async () => {
      const o = await ouvrirOnglet({ langue: 'fr', viewport });
      try {
        await ouvrirListe(o);
        await chiffresArrives(o);
        const avant = { tableau: await hautDe(o, 'table'), case1: await hautDe(o, 'table tbody tr input[type="checkbox"]') };
        await o.page.locator('table tbody tr input[type="checkbox"]').first().check();
        await o.page.getByText('1 sélectionnée(s)').waitFor();
        expect({ tableau: await hautDe(o, 'table'), case1: await hautDe(o, 'table tbody tr input[type="checkbox"]') }).toEqual(avant);
        await o.page.getByRole('checkbox', { name: 'Tout cocher' }).check();
        await o.page.getByText(/^\d+ sélectionnée\(s\)/).waitFor();
        expect({ tableau: await hautDe(o, 'table'), case1: await hautDe(o, 'table tbody tr input[type="checkbox"]') }).toEqual(avant);
        // La barre tient dans sa rangée : même hauteur de rangée, sélection ou non.
        const rangee = await o.page.locator('[data-rangee-lot]').boundingBox();
        expect(Math.round(rangee?.height ?? 0)).toBe(48);
        await o.page.getByRole('button', { name: 'Tout décocher' }).scrollIntoViewIfNeeded();
        await o.page.getByRole('button', { name: 'Tout décocher' }).click();
        expect(await o.page.getByText(/sélectionnée\(s\)/).count()).toBe(0);
        expect({ tableau: await hautDe(o, 'table'), case1: await hautDe(o, 'table tbody tr input[type="checkbox"]') }).toEqual(avant);
      } finally { await o.fermer(); }
    });
  }

  it('[03-onglets-etats:143] à la deuxième visite, l’arrivée des chiffres (et du bandeau « étapes texto sautées ») ne déplace pas le tableau', async () => {
    const o = await ouvrirOnglet({ langue: 'fr' });
    try {
      // Première visite : le bureau apprend s'il a un numéro texto (retenu pour les suivantes).
      await ouvrirListe(o);
      await chiffresArrives(o);
      // Deuxième visite, chiffres retenus 1,5 s : le tableau est mesuré AVANT leur arrivée, puis après.
      await o.page.route('**/api/automations/rules/stats*', async (r) => { await new Promise((ok) => setTimeout(ok, 1500)); await r.continue(); });
      await o.page.reload();
      await o.page.locator('table tbody tr input[type="checkbox"]').first().waitFor();
      expect((await o.page.locator('table tbody tr').first().locator('td').nth(3).innerText()).trim()).toBe('…');
      const avant = await hautDe(o, 'table');
      await chiffresArrives(o);
      expect(await hautDe(o, 'table')).toBe(avant);
    } finally { await o.fermer(); }
  });

  it('[11-clavier:178, :209] menu ⋮ : Entrée l’ouvre, Tab va de « Modifier » à la dernière entrée, un Tab de plus le referme et passe à ce qui suit le bouton', async () => {
    const o = await ouvrirOnglet({ langue: 'fr' });
    try {
      await ouvrirListe(o);
      const bouton = o.page.locator('table tbody button[aria-haspopup="menu"]').first();
      await bouton.focus();
      await o.page.keyboard.press('Enter');
      await o.page.getByRole('menu').waitFor();
      const entrees = await o.page.getByRole('menuitem').allInnerTexts();
      expect(entrees[0]).toBe('Modifier');
      for (const attendu of entrees) {
        await o.page.keyboard.press('Tab');
        expect((await o.page.evaluate(() => (document.activeElement as HTMLElement | null)?.innerText ?? '')).trim()).toBe(attendu.trim());
      }
      await o.page.keyboard.press('Tab');
      await o.page.getByRole('menu').waitFor({ state: 'detached' });
      // Le focus n'est ni perdu, ni resté sur le bouton : il est passé à l'élément SUIVANT de la page.
      const ou = await o.page.evaluate(() => {
        const a = document.activeElement as HTMLElement | null;
        return { corps: a === document.body, bouton: a?.getAttribute('aria-haspopup') === 'menu', dansLeTableau: !!a?.closest('table, [role="tabpanel"]') };
      });
      expect(ou).toEqual({ corps: false, bouton: false, dansLeTableau: true });
    } finally { await o.fermer(); }
  });

  it('[11-clavier:50] onglets : un seul arrêt de tabulation, les flèches passent de l’un à l’autre et l’adresse suit', async () => {
    const o = await ouvrirOnglet({ langue: 'fr' });
    try {
      await ouvrirListe(o);
      await o.page.getByRole('tab', { name: 'Toutes' }).focus();
      await o.page.keyboard.press('ArrowRight');
      expect(await o.page.evaluate(() => document.activeElement?.textContent ?? '')).toMatch(/^À vérifier/);
      expect(o.page.url()).toContain('onglet=verifier');
      await o.page.keyboard.press('Tab');
      // Tab QUITTE les onglets (il ne va pas sur « Prêtes à publier ») : un seul arrêt de tabulation.
      expect(await o.page.evaluate(() => document.activeElement?.getAttribute('role'))).not.toBe('tab');
    } finally { await o.fermer(); }
  });
});
