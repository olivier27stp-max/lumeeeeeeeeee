/** Aides des E2E Statistiques : connexion par la vraie page /auth, horloge figée, formats. */
import { expect, type Locator, type Page } from '@playwright/test';

export const MDP = 'FixtureStats1234!';
export const COMPTES = {
  proprio: 'proprio@fixture.lume.test',
  admin: 'admin@fixture.lume.test',
  theo: 'theo@fixture.lume.test',
  remi: 'remi@fixture.lume.test',
  vide: 'proprio@vide.lume.test',
  volume: 'proprio@volume.lume.test',
} as const;

/** « Aujourd'hui » pour toute la suite : mercredi 30 septembre 2026, midi à Toronto. */
export const MAINTENANT = new Date('2026-09-30T16:00:00Z');

export async function connecter(page: Page, email: string, langue: 'fr' | 'en' = 'fr') {
  await page.clock.setFixedTime(MAINTENANT);
  await page.addInitScript((l) => { try { localStorage.setItem('lume-language', l); } catch { /* stockage refusé */ } }, langue);
  await page.goto('/auth');
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(MDP);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith('/auth'), { timeout: 30_000 });
}

/** Refuse, comme un utilisateur, le bandeau de témoins et la demande de localisation s'ils s'affichent. */
export async function fermerFenetres(page: Page) {
  for (const nom of [/^(Tout refuser|Reject all)$/, /^(Refuser|Decline)$/]) {
    const b = page.getByRole('button', { name: nom });
    if (await b.first().isVisible().catch(() => false)) await b.first().click();
  }
}

export async function ouvrirStatistiques(page: Page) {
  await page.goto('/insights');
  await expect(page.getByRole('heading', { name: /^(Statistiques|Statistics)$/ })).toBeVisible();
  await page.waitForTimeout(800);
  await fermerFenetres(page);
  await fermerFenetres(page);
}

/** Même formateur que la page (kc) : devise CAD compacte. */
export function kc(cents: number, fr: boolean): string {
  return new Intl.NumberFormat(fr ? 'fr-CA' : 'en-CA', { style: 'currency', currency: 'CAD', notation: 'compact', maximumFractionDigits: 1 }).format((cents || 0) / 100);
}
/** Espaces insécables → espaces ordinaires, pour comparer du texte rendu. */
export const norm = (s: string) => s.replace(/[  ]/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Capture de régression de TOUTE la page. Le contenu défile dans un conteneur interne
 * (div.absolute.inset-0.overflow-y-auto) : fullPage ne verrait que l'écran visible. On agrandit
 * la fenêtre à la hauteur du contenu le temps de la capture.
 */
export async function capturePleinePage(page: Page, nom: string, masque: Locator[] = []) {
  const avant = page.viewportSize()!;
  const hauteur = await page.evaluate(() => {
    const c = [...document.querySelectorAll<HTMLElement>('div.absolute.inset-0')].find((e) => getComputedStyle(e).overflowY === 'auto');
    return (c?.scrollHeight ?? document.documentElement.scrollHeight) + 60;
  });
  await page.setViewportSize({ width: avant.width, height: Math.min(hauteur, 12000) });
  await page.waitForTimeout(400);
  await expect(page).toHaveScreenshot(nom, { mask: masque, animations: 'disabled' });
  await page.setViewportSize(avant);
}
