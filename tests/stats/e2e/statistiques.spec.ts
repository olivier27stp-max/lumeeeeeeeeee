/**
 * E2E de /insights sur la stack locale : chiffres à l'écran = oracle SQL, chaque contrôle cliqué
 * (filtres, période personnalisée, comparaison, export, détail, clavier), FR/EN, 3 largeurs,
 * états (chargement, vide, erreur, sans permission, téléphone), cache.
 */
import fs from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';
import { STATS_LOCAL } from '../../../scripts/qa/stats-local.mjs';
import * as O from '../oracle';
import { variation } from '../../../src/lib/statsFiltres';
import { COMPTES, capturePleinePage, connecter, fermerFenetres, kc, norm, ouvrirStatistiques } from './aides';

const T1 = 'a1000000-0000-4000-8000-000000000001';
const EQUIPE_A = 'a1000000-0000-4000-8000-00000000077a';
const VITRES = 'a1000000-0000-4000-8000-000000005001';
const ALICE = 'a1000000-0000-4000-8000-0000000c0001';
const TINA = 'a1000000-0000-4000-8000-0000000000a4';
const DOUZE_MOIS = { du: '2025-09-30', au: '2026-09-30' };
const YTD = { du: '2026-01-01', au: '2026-09-30' };

let db: pg.Client;
test.beforeAll(async () => { db = new pg.Client({ connectionString: STATS_LOCAL.dbUrl }); await db.connect(); });
test.afterAll(async () => { await db?.end(); });

const total = (xs: Array<{ cents: number }>) => xs.reduce((a, x) => a + x.cents, 0);
const heros = (page: Page) => page.locator('[data-cents]').first();
async function charge(page: Page) { await expect(page.locator('.animate-pulse')).toHaveCount(0, { timeout: 30_000 }); }
async function choisirPastille(page: Page, pastille: RegExp, option: RegExp) {
  await page.locator('button', { hasText: pastille }).first().click();
  await page.locator('button', { hasText: option }).last().click();
  await charge(page);
}
const detail = (page: Page) => page.locator('[data-total-cents]');

test.describe('propriétaire, en français', () => {
  test.beforeEach(async ({ page }) => { await connecter(page, COMPTES.proprio, 'fr'); await ouvrirStatistiques(page); await charge(page); });

  test('les chiffres affichés sont ceux de l’oracle (12 derniers mois)', async ({ page }, info) => {
    test.skip(info.project.name !== 'bureau', 'valeurs vérifiées une fois ; la mise en page l’est sur les 3 largeurs');
    const encaisse = total(await O.encaisseParMois(db, T1, DOUZE_MOIS));
    await expect(heros(page)).toHaveAttribute('data-cents', String(encaisse));
    expect(norm(await heros(page).innerText())).toBe(norm(kc(encaisse, true)));
    await expect(page.getByText(/^sept\.$/).first()).toBeVisible();
    const main = norm(await page.locator('main').innerText());
    let pos = 0;
    for (const c of await O.topClients(db, T1, DOUZE_MOIS)) { const i = main.indexOf(c.nom, pos); expect(i, c.nom).toBeGreaterThanOrEqual(0); pos = i; }
    const ar = await O.aRecevoir(db, T1, '2026-09-30');
    expect(main).toContain(`${norm(kc(ar.solde, true))} À recevoir, à ce jour ${ar.enRetard} en retard`);
    const ent = await O.entonnoir(db, T1, DOUZE_MOIS);
    expect(main).toContain(`${ent.tauxPct} % leads convertis / leads créés`);
    const pip = await O.pipeline(db, T1, DOUZE_MOIS);
    expect(main).toContain(`${pip.tauxPct == null ? '—' : `${Math.round(pip.tauxPct)} %`} Taux de réussite des deals`);
    expect(main).toContain(`${norm(kc((await O.zones(db, T1, DOUZE_MOIS)).revenu, true))} Revenu réalisé`);
    expect(main).not.toMatch(/NaN|Infinity|∞|undefined|\bnull\b/);
  });

  test('filtres : équipe, technicien, service, client — combinables, dans l’URL, « non appliqué » affiché', async ({ page }, info) => {
    test.skip(info.project.name !== 'bureau');
    await choisirPastille(page, /^Équipe/, /^Équipe A$/);
    await expect(page).toHaveURL(new RegExp(`equipe=${EQUIPE_A}`));
    await expect(heros(page)).toHaveAttribute('data-cents', String(total(await O.encaisseParMois(db, T1, DOUZE_MOIS, { equipe: EQUIPE_A }))));
    await expect(page.getByText(/Filtre non appliqué ici : équipe/).first()).toBeVisible(); // entonnoir, rentabilité…
    await choisirPastille(page, /^Service/, /^Lavage de vitres$/);
    await expect(heros(page)).toHaveAttribute('data-cents', String(total(await O.encaisseParMois(db, T1, DOUZE_MOIS, { equipe: EQUIPE_A, service: VITRES }))));
    await page.getByRole('button', { name: /Retirer les filtres \(2\)/ }).click();
    await charge(page);
    await expect(heros(page)).toHaveAttribute('data-cents', String(total(await O.encaisseParMois(db, T1, DOUZE_MOIS))));
    await choisirPastille(page, /^Technicien/, /^Tina Technicienne$/);
    await expect(heros(page)).toHaveAttribute('data-cents', String(total(await O.encaisseParMois(db, T1, DOUZE_MOIS, { technicien: TINA }))));
    await page.getByRole('button', { name: /Retirer les filtres/ }).click();
    await page.getByLabel('Filtrer par client').fill('Alice');
    await page.getByRole('button', { name: /^Alice Tremblay$/ }).click();
    await charge(page);
    await expect(heros(page)).toHaveAttribute('data-cents', String(total(await O.encaisseParMois(db, T1, DOUZE_MOIS, { client: ALICE }))));
    await expect(page.getByText(/Client : Alice Tremblay/)).toBeVisible();
  });

  test('période personnalisée (URL partageable) et choix dans le menu', async ({ page }, info) => {
    test.skip(info.project.name !== 'bureau');
    await page.goto('/insights?periode=custom&du=2026-08-01&au=2026-08-31');
    await charge(page);
    await expect(heros(page)).toHaveAttribute('data-cents', '137970'); // août, le 31 à 23 h 50 compris
    await expect(page.getByText('2026-08-01 → 2026-08-31').first()).toBeVisible();
    await page.goto('/insights');
    await charge(page);
    await choisirPastille(page, /^Période/, /^Période personnalisée$/);
    await expect(page).toHaveURL(/periode=custom/);
    for (const nom of ['Cette année à ce jour', '2 dernières années', '3 dernières années', '12 dernières semaines', '12 derniers mois']) {
      await choisirPastille(page, /^Période/, new RegExp(`^${nom}$`));
      await expect(page.getByText('Impossible de charger ces chiffres.')).toHaveCount(0);
    }
    await choisirPastille(page, /^Période/, /^Cette année à ce jour$/);
    await expect(heros(page)).toHaveAttribute('data-cents', String(total(await O.encaisseParMois(db, T1, YTD))));
  });

  test('comparer à la période précédente : variations justes, jamais ∞', async ({ page }, info) => {
    test.skip(info.project.name !== 'bureau');
    await page.goto('/insights?periode=custom&du=2026-09-01&au=2026-09-30');
    await charge(page);
    await page.getByLabel('Comparer à la période précédente').check();
    await charge(page);
    await expect(page).toHaveURL(/comparer=1/);
    const attendu = variation(total(await O.encaisseParMois(db, T1, { du: '2026-09-01', au: '2026-09-30' })), total(await O.encaisseParMois(db, T1, { du: '2026-08-02', au: '2026-08-31' })), 'pct', true);
    await expect(page.locator('[data-variation]').first()).toHaveText(attendu!.texte);
    expect(norm(await page.locator('main').innerText())).not.toMatch(/∞|NaN|Infinity/);
  });

  test('« Voir le détail » : les lignes, leur total = le chiffre, un clic mène à la fiche', async ({ page }, info) => {
    test.skip(info.project.name !== 'bureau');
    const cents = await heros(page).getAttribute('data-cents');
    await page.getByRole('button', { name: 'Voir le détail' }).first().click();
    await expect(detail(page)).toHaveAttribute('data-total-cents', cents!);
    await page.keyboard.press('Escape');
    // Une part du beignet des services
    await page.getByRole('button', { name: /Lavage de vitres/ }).first().click();
    const vitres = (await O.revenuParService(db, T1, DOUZE_MOIS)).find((x) => x.nom === 'Lavage de vitres')!.cents;
    await expect(detail(page)).toHaveAttribute('data-total-cents', String(vitres));
    await page.keyboard.press('Escape');
    // À recevoir
    await page.getByRole('button', { name: /À recevoir, à ce jour/ }).click();
    await expect(detail(page)).toHaveAttribute('data-total-cents', String((await O.aRecevoir(db, T1, '2026-09-30')).solde));
    await detail(page).locator('a').first().click();
    await expect(page).toHaveURL(/\/invoices\//);
  });

  test('au clavier : parcourir le graphique et ouvrir le détail d’un mois', async ({ page }, info) => {
    test.skip(info.project.name !== 'bureau');
    await page.getByRole('button', { name: /Graphique du revenu/ }).focus();
    await page.keyboard.press('ArrowLeft'); // dernier point : septembre
    await page.keyboard.press('Enter');
    await expect(page.getByText(/Encaissé — septembre 2026/)).toBeVisible();
    const sept = (await O.encaisseParMois(db, T1, { du: '2026-09-01', au: '2026-09-30' }))[0].cents;
    await expect(detail(page)).toHaveAttribute('data-total-cents', String(sept));
  });

  test('export CSV : les chiffres de la page, période et filtres en tête', async ({ page }, info) => {
    test.skip(info.project.name !== 'bureau');
    const [telechargement] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Exporter \(CSV\)/ }).click()]);
    expect(telechargement.suggestedFilename()).toBe('statistiques_2025-09-30_2026-09-30.csv');
    const csv = fs.readFileSync((await telechargement.path())!, 'utf8');
    expect(csv).toContain('"Encaissé ($, taxes incluses)",4384.04'); // libellé avec virgule : entre guillemets (RFC 4180)
    expect(csv).toContain('À recevoir à ce jour ($),2399.51');
    expect(csv).toContain('"Revenu par service ($, avant taxes)",Lavage de vitres,1750.00');
  });

  test('mise en page : aucun défilement horizontal, aucun graphique coupé', async ({ page }) => {
    const largeur = page.viewportSize()!.width;
    expect(await page.evaluate(() => document.documentElement.scrollWidth), 'défilement horizontal').toBeLessThanOrEqual(largeur);
    const coupes = await page.locator('main svg').evaluateAll((svgs, w) => svgs.map((s) => s.getBoundingClientRect()).filter((r) => r.width > 40 && (r.right > w + 1 || r.left < -1)).length, largeur);
    expect(coupes, 'graphiques qui sortent de l’écran').toBe(0);
    await capturePleinePage(page, 'statistiques-fr.png', [page.locator('.leaflet-container')]);
  });
});

test.describe('propriétaire, en anglais', () => {
  test('formats en-CA et aucune chaîne française', async ({ page }, info) => {
    await connecter(page, COMPTES.proprio, 'en');
    await ouvrirStatistiques(page); await charge(page);
    const main = norm(await page.locator('main').innerText()).toLowerCase();
    for (const titre of ['revenue', 'breakdown', 'payment methods', 'jobs & teams', 'sales', 'cash flow', 'profitability by job', 'view details', 'export (csv)']) expect(main).toContain(titre);
    expect(norm(await heros(page).innerText())).toBe(norm(kc(total(await O.encaisseParMois(db, T1, DOUZE_MOIS)), false)));
    for (const fr of ['aucune donnée', 'réessayer', 'moy.', 'comptant', 'virement', 'derniers mois', 'en retard', 'délai', 'voir le détail', 'période']) expect(main, `« ${fr} » non traduit`).not.toContain(fr);
    expect(main).not.toMatch(/nan|infinity|∞|undefined/);
    if (info.project.name === 'bureau') await capturePleinePage(page, 'statistiques-en.png', [page.locator('.leaflet-container')]);
  });

  test('en français, aucune chaîne anglaise dans les cartes', async ({ page }, info) => {
    test.skip(info.project.name !== 'bureau');
    await connecter(page, COMPTES.proprio, 'fr');
    await ouvrirStatistiques(page); await charge(page);
    const main = norm(await page.locator('main').innerText());
    for (const en of ['No data', 'Card', 'Cash', 'Cheque', 'e-Transfer', 'Other', 'Retry', 'avg', 'past due', 'View details']) expect(main, `« ${en} » non traduit`).not.toMatch(new RegExp(`\\b${en}\\b`));
  });
});

test.describe('états', () => {
  test('chargement : squelettes visibles tant que les chiffres arrivent', async ({ page }, info) => {
    test.skip(info.project.name !== 'bureau');
    await connecter(page, COMPTES.proprio);
    await page.route('**/rest/v1/rpc/rpc_insights_revenue_series*', async (r) => { await new Promise((ok) => setTimeout(ok, 3000)); await r.continue(); });
    await page.goto('/insights');
    await expect(page.locator('.animate-pulse').first()).toBeVisible();
    await fermerFenetres(page);
    await expect(page).toHaveScreenshot('statistiques-chargement.png', { mask: [page.locator('.leaflet-container')], animations: 'disabled' });
    await charge(page);
  });

  test('erreur de l’API : la carte le dit, et « Réessayer » la recharge', async ({ page }, info) => {
    test.skip(info.project.name !== 'bureau');
    await connecter(page, COMPTES.proprio);
    await page.route('**/rest/v1/rpc/rpc_insights_revenue_series*', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"panne simulée"}' }));
    await ouvrirStatistiques(page);
    await expect(page.getByText('Impossible de charger ces chiffres.').first()).toBeVisible({ timeout: 30_000 });
    await expect(page).toHaveScreenshot('statistiques-erreur.png', { clip: { x: 0, y: 0, width: 1440, height: 760 }, animations: 'disabled' });
    await page.unroute('**/rest/v1/rpc/rpc_insights_revenue_series*');
    await page.getByRole('button', { name: 'Réessayer' }).first().click();
    await expect(heros(page)).toBeVisible();
  });

  test('entreprise vide : des zéros et des « aucune donnée », jamais NaN ni ∞', async ({ page }, info) => {
    await connecter(page, COMPTES.vide, 'en');
    await ouvrirStatistiques(page); await charge(page);
    expect(norm(await page.locator('main').innerText())).not.toMatch(/NaN|Infinity|∞|undefined/);
    await expect(heros(page)).toHaveAttribute('data-cents', '0');
    if (info.project.name === 'bureau') await capturePleinePage(page, 'statistiques-vide.png', [page.locator('.leaflet-container')]);
  });

  test('technicien : pas de chiffres de l’entreprise, et aucune requête de stats envoyée', async ({ page }, info) => {
    test.skip(info.project.name !== 'bureau');
    const appels: string[] = [];
    page.on('request', (r) => { if (/rpc_insights_|rentabilite_jobs|\/api\/profitability/.test(r.url())) appels.push(r.url()); });
    await connecter(page, COMPTES.theo);
    await page.goto('/insights');
    await page.waitForTimeout(3000);
    await fermerFenetres(page);
    expect(norm(await page.locator('body').innerText())).not.toMatch(/À recevoir|Revenu par service|Top clients/);
    expect(appels).toEqual([]);
    await expect(page).toHaveScreenshot('statistiques-technicien.png', { animations: 'disabled' });
  });

  test('téléphone (UA mobile) : la porte « application » remplace le CRM', async ({ browser }, info) => {
    test.skip(info.project.name !== 'bureau');
    const ctx = await browser.newContext({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36', viewport: { width: 390, height: 844 }, timezoneId: 'America/Toronto' });
    const page = await ctx.newPage();
    await page.goto('/insights');
    await page.waitForTimeout(2500);
    expect(norm(await page.locator('body').innerText())).not.toMatch(/Revenu par service|À recevoir/);
    await ctx.close();
  });
});

test.describe('cache', () => {
  test('un paiement créé ailleurs apparaît en revenant sur la page', async ({ page }, info) => {
    test.skip(info.project.name !== 'bureau');
    await connecter(page, COMPTES.proprio);
    await ouvrirStatistiques(page); await charge(page);
    const avant = Number(await heros(page).getAttribute('data-cents'));
    const id = 'a1000000-0000-4000-8000-0000000b9999';
    await db.query('delete from public.payments where id = $1', [id]);
    await db.query(`insert into public.payments (id, org_id, client_id, amount_cents, method, status, provider, payment_date, paid_at, created_by)
      values ($1, $2, 'a1000000-0000-4000-8000-0000000c0001', 12345, 'cash', 'succeeded', 'manual', now(), now(), 'a1000000-0000-4000-8000-0000000000a1')`, [id, T1]);
    try {
      // Navigation INTERNE : le détail d'un client mène à sa fiche, puis Retour.
      await page.getByRole('button', { name: /Alice Tremblay/ }).first().click();
      await detail(page).locator('a').first().click();
      await expect(page).toHaveURL(/\/(invoices|finances)/);
      await expect(page.getByRole('heading', { name: /^Statistiques$/ })).toHaveCount(0);
      await page.goBack();
      await expect(heros(page)).toHaveAttribute('data-cents', String(avant + 12345), { timeout: 20_000 });
    } finally {
      await db.query('delete from public.payments where id = $1', [id]);
    }
  });
});
