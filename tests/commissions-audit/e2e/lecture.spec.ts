/**
 * Lecture seule — rejoué sur bureau, iPad et téléphone (largeur).
 * Chaque chiffre affiché est comparé à l'ORACLE SQL, pas au moteur.
 */
import { test, expect } from '@playwright/test';
import { ORG, U, f } from '../fixture';
import { SEPT, argent, norm, oracle, connecter, connecterParFormulaire, filtrerPeriode, sansDefilementHorizontal, pageStable, masques } from './outils';
import type { Attendu } from '../comparer';

let attendus: Attendu[] = [];
test.beforeAll(async () => { attendus = await oracle(); });

// RF2 (facture refaite) n'est commissionnée qu'après la migration M1 : tant
// qu'elle n'est pas appliquée, l'écran a 150,00 $ de moins que l'oracle pour Fred.
const RF2 = () => attendus.find((a) => a.invoice_id === f('RF2').id);
const sept = (rep?: string) => attendus
  .filter((a) => a.org_id === ORG.A && a.mois === '2026-09' && a.etat === 'active' && (!rep || a.user_id === rep))
  .reduce((s, a) => s + a.montant_cents, 0);
const septSansM1 = () => sept() - (RF2()?.montant_cents ?? 0);

const MOTS_ANGLAIS = ['Pending', 'Approved', 'Reversed', 'Loading', 'Commission entries', 'Deal amount', 'Upcoming payouts', 'Unknown', 'Sales_rep', 'Owner', 'Technician'];
const MOTS_FRANCAIS = ['En attente', 'Approuvé', 'Versé', 'Reversé', 'Chargement', 'Représentants', 'Prochains versements', 'Gagnée le'];

test.describe('propriétaire — FR', () => {
  test.beforeEach(async ({ page }) => {
    await connecter(page, U.olivia, 'fr');
    await page.goto('/commissions');
    await filtrerPeriode(page, SEPT.from, SEPT.to);
  });

  test('vue d’ensemble : total et KPI = oracle, format « 1 234,56 $ »', async ({ page }) => {
    const texte = norm(await page.locator('main').innerText());
    expect(texte).toContain(argent(septSansM1(), 'fr'));
    // L'ancien format était « $1 235 » : « $ » collé devant le nombre.
    expect(texte, 'le « $ » ne se met jamais devant en français').not.toMatch(/\$\d/);
    // Rien n'est versé en septembre (les versements de la fixture sont en août).
    expect(texte).toContain(argent(0, 'fr'));
    for (const mot of MOTS_ANGLAIS) expect(texte, `chaîne non traduite : ${mot}`).not.toContain(mot);
    await sansDefilementHorizontal(page);
    await pageStable(page); await expect(page).toHaveScreenshot('vue-ensemble-fr.png', { fullPage: true, mask: masques(page) });
  });

  test('filtre statut « Versé » : aucune entrée en septembre', async ({ page }) => {
    await page.getByLabel('Filtrer par statut').first().selectOption('paid');
    await expect(page.getByText('Aucune entrée de commission')).toBeVisible();
  });

  test('filtre représentant : seulement Rita, total = oracle Rita', async ({ page }) => {
    await page.getByLabel('Filtrer par représentant').first().selectOption({ label: 'Rita Pourcent' });
    await expect(page.getByText(/Chargement des commissions/)).toHaveCount(0);
    expect(norm(await page.locator('main').innerText())).toContain(argent(sept(U.rita), 'fr'));
    // Le tableau (pas le menu déroulant, qui liste tout le monde) : Rita seulement.
    const tableau = norm(await page.locator('table').first().innerText());
    expect(tableau).toContain('Rita Pourcent');
    expect(tableau).not.toContain('Tina Palier');
  });

  test('onglet Représentants : totaux par rep = oracle, drilldown et retour', async ({ page }) => {
    await page.getByRole('button', { name: 'Représentants', exact: true }).click();
    await filtrerPeriode(page, SEPT.from, SEPT.to);
    // Tableau « Représentants » : ses lignes sont des <tr role="button"> (cliquables).
    const ligne = page.locator('tr[role="button"]', { hasText: 'Tina Palier' });
    await expect(ligne).toBeVisible();
    expect(norm(await ligne.innerText())).toContain(argent(sept(U.tina), 'fr'));
    await ligne.getByRole('button').first().click();
    await expect(page.getByText('Commissions de Tina Palier')).toBeVisible();
    await page.getByRole('button', { name: /Retour aux représentants/ }).click();
    await expect(page.locator('tr[role="button"]', { hasText: 'Tina Palier' })).toBeVisible();
    await sansDefilementHorizontal(page);
    await pageStable(page); await expect(page).toHaveScreenshot('representants-fr.png', { fullPage: true, mask: masques(page) });
  });

  test('onglet « Mes commissions » : seulement les miennes (avant : toute l’équipe)', async ({ page }) => {
    await page.getByRole('button', { name: 'Mes commissions', exact: true }).click();
    await filtrerPeriode(page, SEPT.from, SEPT.to);
    await expect(page.getByText('Aucune vente conclue sur la période sélectionnée')).toBeVisible();
  });

  test('onglet Taux : plans par membre', async ({ page }) => {
    await page.getByRole('button', { name: 'Taux', exact: true }).click();
    await expect(page.getByText('Plan de commission par membre')).toBeVisible();
    await expect(page.getByLabel('Plan de commission de Rita Pourcent')).toHaveValue(/.+/);
    // Seule Nora (mode commission, aucun plan) est avertie ; Sara touche une
    // part du split de Sam (avant : avertie à tort « aucune commission »).
    await expect(page.getByText('Aucun plan : aucune commission ne sera calculée')).toHaveCount(1);
    await expect(page.getByRole('row', { name: /Nora SansPlan/ })).toContainText('Aucun plan');
    await expect(page.getByRole('row', { name: /Sara Duo/ })).toContainText('Part de split : 50 %');
    const texteTaux = norm(await page.locator('main').innerText());
    for (const mot of MOTS_ANGLAIS) expect(texteTaux, `chaîne non traduite : ${mot}`).not.toContain(mot);
    await sansDefilementHorizontal(page);
    await pageStable(page); await expect(page).toHaveScreenshot('taux-fr.png', { fullPage: true, mask: masques(page) });
  });

  test('frontière : 31 août 23 h 30 Toronto apparaît en août', async ({ page }) => {
    await filtrerPeriode(page, '2026-08-01', '2026-08-31');
    await expect(page.getByText(/FX-I6/).first()).toBeVisible();
  });
});

test('propriétaire — EN : « $1,234.56 », aucune chaîne française', async ({ page }) => {
  await connecter(page, U.olivia, 'en');
  await page.goto('/commissions');
  await filtrerPeriode(page, SEPT.from, SEPT.to, false);
  const texte = norm(await page.locator('main').innerText());
  expect(texte).toContain(argent(septSansM1(), 'en'));
  for (const mot of MOTS_FRANCAIS) expect(texte, `chaîne non traduite : ${mot}`).not.toContain(mot);
  await pageStable(page); await expect(page).toHaveScreenshot('vue-ensemble-en.png', { fullPage: true, mask: masques(page) });
});

test('représentant : ses commissions seulement, aucune action, total = oracle', async ({ page }) => {
  // Seul test qui passe par le vrai formulaire de connexion.
  await connecterParFormulaire(page, U.rita, 'fr');
  await page.goto('/commissions');
  await filtrerPeriode(page, SEPT.from, SEPT.to);
  await expect(page.getByRole('heading', { name: 'Mes commissions' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: "Vue d'ensemble" })).toHaveCount(0);
  const texte = norm(await page.locator('main').innerText());
  expect(texte).toContain(argent(sept(U.rita), 'fr'));
  expect(texte).not.toContain('Tina');
  await expect(page.getByRole('button', { name: /Verser|Approuver|Reverser/ })).toHaveCount(0);
  await pageStable(page); await expect(page).toHaveScreenshot('representant-fr.png', { fullPage: true, mask: masques(page) });
});

test('technicien : aucun montant, accès refusé', async ({ page }) => {
  await connecter(page, U.theo, 'fr');
  await page.goto('/commissions');
  // Attendre l'issue réelle (refus affiché ou redirection), pas un réseau calme :
  // « Chargement de l'espace… » peut durer au-delà.
  await expect(async () => {
    const texte = norm(await page.locator('body').innerText());
    expect(page.url().includes('/commissions') ? texte : 'redirigé').toMatch(/Accès refusé|permission|redirigé/i);
  }).toPass({ timeout: 30_000 });
  expect(norm(await page.locator('body').innerText())).not.toMatch(/\d+,\d{2} \$/);
});

test('tenant vide : zéro partout, message vide', async ({ page }) => {
  await connecter(page, U.carl, 'fr');
  await page.goto('/commissions');
  await filtrerPeriode(page, SEPT.from, SEPT.to);
  await expect(page.getByText('Aucune entrée de commission').first()).toBeVisible();
  expect(norm(await page.locator('main').innerText())).toContain(argent(0, 'fr'));
  await pageStable(page); await expect(page).toHaveScreenshot('vide-fr.png', { fullPage: true, mask: masques(page) });
});

test('états : chargement puis erreur d’API affichée', async ({ page }) => {
  await connecter(page, U.olivia, 'fr');
  // Un seul intercepteur : d'abord lent (état « chargement »), puis en panne.
  let panne = false;
  await page.route('**/api/commissions?*', async (r) => {
    if (panne) return r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"Panne simulée"}' });
    await new Promise((ok) => setTimeout(ok, 1500));
    await r.continue().catch(() => { /* page déjà partie */ });
  });
  await page.goto('/commissions');
  await expect(page.getByText(/Chargement des commissions/)).toBeVisible();
  await expect(page.getByText(/Chargement des commissions/)).toHaveCount(0);
  panne = true;
  await page.getByLabel('Date de début').first().fill('2026-07-01');
  await expect(page.getByText('Panne simulée')).toBeVisible();
  await pageStable(page); await expect(page).toHaveScreenshot('erreur-fr.png', { fullPage: true, mask: masques(page) });
});

test('téléphone (UA mobile) : la porte mobile s’affiche — par conception', async ({ browser }, info) => {
  test.skip(info.project.name !== 'lecture-telephone');
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148', isMobile: true });
  const page = await ctx.newPage();
  await page.goto('/commissions');
  await page.waitForLoadState('networkidle');
  await pageStable(page); await expect(page).toHaveScreenshot('porte-mobile.png', { fullPage: true });
  await ctx.close();
});
