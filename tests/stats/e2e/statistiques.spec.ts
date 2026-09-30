/**
 * E2E de /insights sur la stack locale : chiffres à l'écran = oracle SQL, chaque contrôle
 * cliqué, FR/EN, 3 largeurs, états (chargement, vide, erreur, sans permission), cache.
 */
import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';
import { STATS_LOCAL } from '../../../scripts/qa/stats-local.mjs';
import * as O from '../oracle';
import { COMPTES, capturePleinePage, connecter, fermerFenetres, kc, norm, ouvrirStatistiques } from './aides';

const T1 = 'a1000000-0000-4000-8000-000000000001';
const DOUZE_MOIS = { du: '2025-09-30', au: '2026-09-30' };
const YTD = { du: '2026-01-01', au: '2026-09-30' };

let db: pg.Client;
test.beforeAll(async () => { db = new pg.Client({ connectionString: STATS_LOCAL.dbUrl }); await db.connect(); });
test.afterAll(async () => { await db?.end(); });

const somme = (xs: Array<{ cents: number }>) => xs.reduce((a, x) => a + x.cents, 0);
/** Attend la fin de tous les squelettes de chargement. */
async function charge(page: Page) {
  await expect(page.locator('.animate-pulse')).toHaveCount(0, { timeout: 30_000 });
}

test.describe('propriétaire, en français', () => {
  test.beforeEach(async ({ page }) => { await connecter(page, COMPTES.proprio, 'fr'); await ouvrirStatistiques(page); await charge(page); });

  test('les chiffres affichés sont ceux de l’oracle (12 derniers mois)', async ({ page }, info) => {
    test.skip(info.project.name !== 'bureau', 'valeurs vérifiées une fois ; la mise en page l’est sur les 3 largeurs');
    // Revenu : total exact au cent (data-cents), libellé compact, et le dernier mois s'appelle septembre.
    const encaisse = somme(await O.encaisseParMois(db, T1, DOUZE_MOIS));
    await expect(page.locator('[data-cents]').first()).toHaveAttribute('data-cents', String(encaisse));
    expect(norm(await page.locator('[data-cents]').first().innerText())).toBe(norm(kc(encaisse, true)));
    await expect(page.getByText(/^sept\.$/).first()).toBeVisible();

    const main = norm(await page.locator('main').innerText());
    // Top clients : les 5 qui ont le plus rapporté, dans l'ordre.
    const top = (await O.valeurClients(db, T1)).slice(0, 5).map((c) => c.nom);
    let pos = 0;
    for (const nom of top) { const i = main.indexOf(nom, pos); expect(i, nom).toBeGreaterThanOrEqual(0); pos = i; }
    // Trésorerie.
    const ar = await O.aRecevoir(db, T1, '2026-09-30');
    expect(main).toContain(`${norm(kc(ar.solde, true))} À recevoir ${ar.enRetard} en retard`);
    const delai = await O.delaiPaiement(db, T1, DOUZE_MOIS);
    expect(main).toContain(`${Math.round(delai ?? 0)} j Délai de paiement`);
    // Conversion.
    const conv = await O.conversionLeads(db, T1, DOUZE_MOIS);
    expect(main).toContain(`${Math.round(conv.taux * 100)} % leads convertis / créés`);
    const pipe = await O.pipeline(db, T1, DOUZE_MOIS);
    expect(main).toContain(`${pipe.tauxPct == null ? '—' : `${Math.round(pipe.tauxPct)} %`} Taux de réussite`);
    // Zones.
    const z = await O.zones(db, T1, DOUZE_MOIS);
    expect(main).toContain(`${norm(kc(z.revenu, true))} Revenu réalisé`);
    // Aucun texte cassé.
    expect(main).not.toMatch(/NaN|Infinity|∞|undefined|\bnull\b/);
  });

  test('le filtre de période change TOUTES les cartes, et les chiffres suivent l’oracle', async ({ page }, info) => {
    test.skip(info.project.name !== 'bureau');
    await page.locator('button', { hasText: /^12 derniers mois$/ }).first().click();
    await page.locator('button', { hasText: /^Cette année à ce jour$/ }).first().click();
    await charge(page);
    await expect(page.locator('button', { hasText: /^12 derniers mois$/ })).toHaveCount(0);
    expect(await page.locator('button', { hasText: /^Cette année à ce jour$/ }).count()).toBeGreaterThanOrEqual(9);
    await expect(page.locator('[data-cents]').first()).toHaveAttribute('data-cents', String(somme(await O.encaisseParMois(db, T1, YTD))));
    const main = norm(await page.locator('main').innerText());
    const conv = await O.conversionLeads(db, T1, YTD);
    expect(main).toContain(`${Math.round(conv.taux * 100)} % leads convertis / créés`);
    // Chaque période du menu fonctionne (aucune n'affiche d'erreur).
    for (const nom of ['2 dernières années', '3 dernières années', '12 dernières semaines', '12 derniers mois']) {
      await page.locator('button', { hasText: /^(Cette année à ce jour|\d+ derni\S+ \S+)$/ }).first().click();
      await page.locator('button', { hasText: new RegExp(`^${nom}$`) }).first().click();
      await charge(page);
      await expect(page.getByText('Impossible de charger ces chiffres.')).toHaveCount(0);
    }
  });

  test('au clavier, le sélecteur de période d’une carte s’ouvre sans quitter la page', async ({ page }, info) => {
    test.skip(info.project.name !== 'bureau');
    // Le VRAI <button> du sélecteur de la carte Revenu (la carte elle-même est un role="button" qui le contient).
    const selecteur = page.locator('button', { hasText: /^12 derniers mois$/ }).nth(1);
    await selecteur.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/insights$/);
    await expect(page.locator('button', { hasText: /^2 dernières années$/ }).first()).toBeVisible();
  });

  test('chaque carte cliquable mène à sa page', async ({ page }, info) => {
    test.skip(info.project.name !== 'bureau');
    const cibles: Array<[RegExp, RegExp]> = [
      [/^Revenu par service$/i, /\/finances/], [/^Modes de paiement$/i, /\/payments|\/finances\?tab=paiements/], [/^Valeur moyenne d'un job$/i, /\/jobs/],
      [/^Classement par revenu$/i, /\/leaderboard/], [/^Taux de complétion$/i, /\/leaderboard/], [/^Top clients par revenu$/i, /\/clients/],
      [/^Fidélité & valeur client$/i, /\/clients/], [/^Entonnoir des leads$/i, /\/pipeline/], [/^À recevoir$/, /\/invoices/],
    ];
    for (const [titre, url] of cibles) {
      await page.getByText(titre).first().click();
      await expect(page, String(titre)).toHaveURL(url);
      await ouvrirStatistiques(page); await charge(page);
    }
  });

  test('infobulle du graphique de revenu : le mois et le montant au cent près', async ({ page }, info) => {
    test.skip(info.project.name !== 'bureau');
    const zone = page.locator('.cursor-crosshair').first();
    const b = (await zone.boundingBox())!;
    await page.mouse.move(b.x + b.width - 2, b.y + b.height / 2);
    const sept = (await O.encaisseParMois(db, T1, { du: '2026-09-01', au: '2026-09-30' }))[0].cents;
    const attendu = new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD', minimumFractionDigits: 2 }).format(sept / 100);
    const bulle = norm(await page.locator('.pointer-events-none.whitespace-nowrap').first().innerText());
    expect(bulle).toContain('SEPT.');
    expect(bulle).toContain(norm(attendu));
  });

  test('survol du beignet : le centre montre le détail du segment', async ({ page }, info) => {
    test.skip(info.project.name !== 'bureau');
    const ligne = page.locator('text=Lavage de vitres').first();
    await ligne.hover();
    await expect(page.getByText(/% du total/).first()).toBeVisible();
  });

  test('mise en page : aucun défilement horizontal, aucun graphique coupé', async ({ page }, info) => {
    const largeur = page.viewportSize()!.width;
    const scroll = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scroll, 'défilement horizontal de la page').toBeLessThanOrEqual(largeur);
    const coupes = await page.locator('main svg').evaluateAll((svgs, w) => svgs
      .map((s) => s.getBoundingClientRect())
      .filter((r) => r.width > 40 && (r.right > w + 1 || r.left < -1)).length, largeur);
    expect(coupes, 'graphiques qui sortent de l’écran').toBe(0);
    await capturePleinePage(page, 'statistiques-fr.png', [page.locator('.leaflet-container')]);
  });
});

test.describe('propriétaire, en anglais', () => {
  test('formats en-CA et aucune chaîne française', async ({ page }, info) => {
    await connecter(page, COMPTES.proprio, 'en');
    await ouvrirStatistiques(page); await charge(page);
    const main = norm(await page.locator('main').innerText());
    for (const titre of ['Revenue', 'Breakdown', 'Payment methods', 'Teams', 'Lead conversion', 'Cash flow', 'Profitability by job']) {
      expect(main.toLowerCase()).toContain(titre.toLowerCase()); // les titres sont en majuscules CSS
    }
    const encaisse = somme(await O.encaisseParMois(db, T1, DOUZE_MOIS));
    expect(norm(await page.locator('[data-cents]').first().innerText())).toBe(norm(kc(encaisse, false)));
    for (const fr of ['Aucune donnée', 'Réessayer', 'moy.', 'Comptant', 'Carte', 'Virement', 'Autre', 'derniers mois', 'en retard', 'Délai']) {
      expect(main, `« ${fr} » non traduit`).not.toContain(fr);
    }
    expect(main).not.toMatch(/NaN|Infinity|∞|undefined/);
    if (info.project.name === 'bureau') await capturePleinePage(page, 'statistiques-en.png', [page.locator('.leaflet-container')]);
  });

  test('en français, aucune chaîne anglaise dans les cartes', async ({ page }, info) => {
    test.skip(info.project.name !== 'bureau');
    await connecter(page, COMPTES.proprio, 'fr');
    await ouvrirStatistiques(page); await charge(page);
    const main = norm(await page.locator('main').innerText());
    for (const en of ['No data', 'Card', 'Cash', 'Cheque', 'e-Transfer', 'Other', 'Retry', 'avg', 'past due']) {
      expect(main, `« ${en} » non traduit`).not.toMatch(new RegExp(`\\b${en}\\b`));
    }
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
    await expect(page).toHaveScreenshot('statistiques-erreur.png', { clip: { x: 0, y: 0, width: 1440, height: 700 }, animations: 'disabled' });
    await page.unroute('**/rest/v1/rpc/rpc_insights_revenue_series*');
    await page.getByRole('button', { name: 'Réessayer' }).first().click();
    await expect(page.locator('[data-cents]').first()).toBeVisible();
  });

  test('entreprise vide : des zéros et des « aucune donnée », jamais NaN ni ∞', async ({ page }, info) => {
    await connecter(page, COMPTES.vide, 'en');
    await ouvrirStatistiques(page); await charge(page);
    const main = norm(await page.locator('main').innerText());
    expect(main).not.toMatch(/NaN|Infinity|∞|undefined/);
    await expect(page.locator('[data-cents]').first()).toHaveAttribute('data-cents', '0');
    if (info.project.name === 'bureau') await capturePleinePage(page, 'statistiques-vide.png', [page.locator('.leaflet-container')]);
  });

  test('technicien : pas de chiffres de l’entreprise, et aucune requête de stats envoyée', async ({ page }, info) => {
    test.skip(info.project.name !== 'bureau');
    const appels: string[] = [];
    page.on('request', (r) => { if (/rpc_insights_|rentabilite_jobs/.test(r.url())) appels.push(r.url()); });
    await connecter(page, COMPTES.theo);
    await page.goto('/insights');
    await page.waitForTimeout(3000);
    await fermerFenetres(page);
    const texte = norm(await page.locator('body').innerText());
    expect(texte).not.toMatch(/À recevoir|Revenu par service|Top clients/);
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
    const avant = Number(await page.locator('[data-cents]').first().getAttribute('data-cents'));
    const id = 'a1000000-0000-4000-8000-0000000b9999';
    await db.query('delete from public.payments where id = $1', [id]);
    await db.query(`insert into public.payments (id, org_id, client_id, amount_cents, method, status, provider, payment_date, paid_at, created_by)
      values ($1, $2, 'a1000000-0000-4000-8000-0000000c0001', 12345, 'cash', 'succeeded', 'manual', now(), now(), 'a1000000-0000-4000-8000-0000000000a1')`, [id, T1]);
    try {
      // Navigation INTERNE (pas de rechargement) : la carte mène à /clients, puis Retour.
      await page.getByText(/^Top clients par revenu$/i).first().click();
      await expect(page).toHaveURL(/\/clients/);
      await expect(page.getByRole('heading', { name: /^Statistiques$/ })).toHaveCount(0); // la page est bien démontée
      await page.goBack();
      await expect(page.locator('[data-cents]').first()).toHaveAttribute('data-cents', String(avant + 12345), { timeout: 20_000 });
    } finally {
      await db.query('delete from public.payments where id = $1', [id]);
    }
  });
});
