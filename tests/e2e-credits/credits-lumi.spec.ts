/**
 * Crédits Lumi — E2E Playwright contre le VRAI site (lumecrm.net par défaut),
 * bureau de test « Grok Audit (TEST) ». LECTURE SEULE : rien n'est écrit en
 * base ; les états 80 % / 100 % / épuisé sont simulés côté navigateur en
 * interceptant /api/lumi/quota et /api/lumi/credits (aucun crédit consommé).
 *
 *   npx playwright test -c tests/e2e-credits/playwright.config.ts
 *
 * Projets : bureau (1440×900), iPad (1024×1366), téléphone (390×844).
 */
import { test, expect, type Page } from '@playwright/test';
import { nouvelleSession } from './global-setup';

type Etat = { inclus: boolean; total: number; utilises: number; restants: number; pourcentage: number; renouvellement_le: string; palier: string; avertissement: null | '80' | '100' };
const etat = (p: Partial<Etat>): Etat => ({ inclus: true, total: 1000, utilises: 258, restants: 742, pourcentage: 25, renouvellement_le: '2026-11-12', palier: 'normal', avertissement: null, ...p });

async function connecter(page: Page, langue: 'fr' | 'en') {
  // La langue du COMPTE (user_metadata) l'emporte sur la préférence locale :
  // on la fixe dans la session injectée — le vrai compte n'est pas touché.
  const stockageNeuf = await nouvelleSession();
  const jeton = JSON.parse(stockageNeuf['lume-auth-token']);
  jeton.user = { ...jeton.user, user_metadata: { ...(jeton.user?.user_metadata ?? {}), language: langue } };
  const stockage = { ...stockageNeuf, 'lume-auth-token': JSON.stringify(jeton), 'lume-language': langue };
  await page.addInitScript((s) => {
    for (const [k, v] of Object.entries(s as Record<string, string>)) localStorage.setItem(k, v);
  }, stockage);
  // /auth/v1/user renvoie l'utilisateur de la session, avec la langue voulue
  // (déterministe : pas d'aller-retour réseau qui pourrait remettre « fr »).
  await page.route('**/auth/v1/user**', (route) => route.fulfill({ json: jeton.user }));
  // Au chargement, l'app RAFRAÎCHIT le jeton : la session renvoyée par le
  // serveur porte la vraie langue du compte et écraserait celle du test.
  await page.route('**/auth/v1/token**', async (route) => {
    const r = await route.fetch();
    const j = await r.json().catch(() => null);
    if (j?.user) j.user.user_metadata = { ...(j.user.user_metadata ?? {}), language: langue };
    await route.fulfill({ response: r, json: j ?? {} });
  });
}

async function simulerCredits(page: Page, e: Etat) {
  await page.route('**/api/lumi/quota', (route) => route.fulfill({ json: { configured: true, credits: e } }));
  await page.route('**/api/lumi/credits', (route) => route.fulfill({ json: e }));
}

const texteSansDollarIa = async (page: Page) => {
  const t = await page.locator('body').innerText();
  // Aucun « X.XX $ » ni « $ » à côté des crédits dans les zones Lumi.
  return !/\d+[.,]\d\d\s?\$\s*\/|Budget IA|AI budget/i.test(t);
};

test.describe('page Lumi', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 1440) < 768, 'sur téléphone, le CRM affiche la porte « app mobile »');

  test('FR : compteur réel « X / 1 000 crédits Lumi · renouvellement le … », barre accessible, aucun $', async ({ page }) => {
    await connecter(page, 'fr');
    await page.goto('/lumi');
    const compteur = page.getByText(/\/ 1\s000 crédits Lumi/);
    await expect(compteur).toBeVisible();
    await expect(page.getByText(/renouvellement le \d{1,2}/)).toBeVisible();
    const barre = page.getByRole('progressbar');
    await expect(barre).toHaveAttribute('aria-valuemax', '1000');
    expect(await texteSansDollarIa(page)).toBe(true);
  });

  test('EN : « X / 1,000 Lumi credits · renews … »', async ({ page }) => {
    await connecter(page, 'en');
    await page.goto('/lumi');
    await expect(page.getByText(/\/ 1,000 Lumi credits/)).toBeVisible();
    await expect(page.getByText(/renews [A-Z][a-z]{2} \d{1,2}/)).toBeVisible();
  });

  test('80 % : avertissement visible (FR)', async ({ page }) => {
    await connecter(page, 'fr');
    await simulerCredits(page, etat({ utilises: 850, restants: 150, pourcentage: 85, palier: 'econome', avertissement: '80' }));
    await page.goto('/lumi');
    await expect(page.getByText(/Il te reste 150 crédits Lumi jusqu’au 12 nov/)).toBeVisible();
  });

  test('100 % / épuisé : message, saisie désactivée, le reste de Lume marche (FR et EN)', async ({ page }) => {
    await connecter(page, 'fr');
    await simulerCredits(page, etat({ utilises: 1000, restants: 0, pourcentage: 100, palier: 'epuise', avertissement: '100' }));
    await page.goto('/lumi');
    await expect(page.getByText(/Tes crédits Lumi sont épuisés jusqu’au 12 nov/)).toBeVisible();
    await expect(page.getByRole('textbox').first()).toBeDisabled();
    // Le reste de l'application reste accessible.
    await page.goto('/clients');
    await expect(page).toHaveURL(/\/clients/);
  });

  test('100 % en anglais', async ({ page }) => {
    await connecter(page, 'en');
    await simulerCredits(page, etat({ utilises: 1000, restants: 0, pourcentage: 100, palier: 'epuise', avertissement: '100' }));
    await page.goto('/lumi');
    await expect(page.getByText(/Your Lumi credits are used up until Nov 12/)).toBeVisible();
  });
});

test.describe('Paramètres › Facturation', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 1440) < 768, 'sur téléphone, le CRM affiche la porte « app mobile »');

  test('section « Crédits Lumi » : restants, renouvellement, historique — sans $', async ({ page }) => {
    await connecter(page, 'fr');
    await page.goto('/settings/billing');
    const section = page.getByRole('region', { name: /Crédits Lumi/ }).or(page.locator('section', { hasText: 'Crédits Lumi' })).first();
    await expect(section).toBeVisible();
    await expect(section.getByText(/restants/)).toBeVisible();
    await expect(section.getByText(/Renouvellement le/)).toBeVisible();
    await expect(section.getByText(/30 derniers jours/)).toBeVisible();
    expect(await section.innerText()).not.toMatch(/\$/);
  });
});

test.describe('site public', () => {
  // Sur téléphone, la porte mobile couvre aussi /pricing (comportement antérieur, hors crédits).
  test.skip(({ isMobile }) => !!isMobile, 'porte mobile sur téléphone');
  test('page de prix : « 1 000 crédits Lumi / mois », jamais « Illimité » pour Lumi', async ({ browser }) => {
    const ctx = await browser.newContext({ locale: 'fr-CA' });   // visiteur non connecté
    const page = await ctx.newPage();
    await page.goto('/pricing');
    await expect(page.getByText('1 000 crédits Lumi / mois').first()).toBeVisible();
    expect(await page.locator('body').innerText()).not.toMatch(/Illimité|Quota mensuel/);
    await ctx.close();
  });
});

test.describe('téléphone', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 1440) >= 768, 'téléphone seulement');
  test('le CRM renvoie vers l’app mobile (la page Lumi n’y est pas servie)', async ({ page }) => {
    await connecter(page, 'fr');
    await page.goto('/lumi');
    await expect(page.getByText(/app/i).first()).toBeVisible();
    await expect(page.getByRole('progressbar')).toHaveCount(0);
  });
});
