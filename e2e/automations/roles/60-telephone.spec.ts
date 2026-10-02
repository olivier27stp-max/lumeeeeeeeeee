/**
 * Téléphone — la « porte mobile » (carte §1.3).
 *
 * Sur un VRAI téléphone (agent utilisateur de téléphone ET largeur < 768 px),
 * `/automations` et ses sous-routes sont remplacées par une page d'attente :
 * l'app de bureau ne s'ouvre pas. Ce fichier prouve ce que l'utilisateur voit
 * exactement (message, issue proposée), et la contre-épreuve : la même largeur
 * avec un agent utilisateur d'ordinateur (fenêtre rétrécie) sert l'app normalement.
 *
 * Les tests fixent eux-mêmes l'agent utilisateur et la largeur (`test.use`) : la
 * porte dépend des deux (`src/lib/mobileGate.ts` : agent utilisateur de
 * téléphone ET `innerWidth < 768`). Ils tournent donc tels quels dans le projet
 * de référence `bureau` — c'est là qu'ils sont jugés — et, parce qu'ils portent
 * `@matrice`, dans les projets de la matrice aussi (`mobile` = Pixel 5, etc.),
 * où leur `test.use` l'emporte sur l'agent utilisateur du projet.
 * Vérifié sur la pile locale le 2026-10-01 : mêmes résultats dans `bureau` et `mobile`.
 */
import { mkdirSync } from 'node:fs';
import { test, expect, SORTIES_LOT } from './_roles';

const CAP = `${SORTIES_LOT}/captures`;
mkdirSync(CAP, { recursive: true });

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';

const ROUTES = ['/automations', '/automations/apercu', '/automations/reglages', '/automations/nouvelle'];

test.describe('téléphone (iPhone, 375 px)', () => {
  test.use({ userAgent: IPHONE, viewport: { width: 375, height: 812 } });

  test('[MOB-01] sur un téléphone, /automations et ses sous-routes sont remplacées par la porte mobile : message clair, aucune app de bureau @matrice', async ({ page }) => {
    for (const route of ROUTES) {
      await page.goto(route);
      await expect(page.getByRole('heading', { level: 1 }), `porte sur ${route}`).toHaveText(/Le bureau sur l.ordi\.\s*Le terrain dans l.app\./);
      await expect(page.getByText('Votre CRM travaille mieux sur un grand écran.')).toBeVisible();
      // L'adresse reste celle demandée : la porte REMPLACE la page, elle ne redirige pas.
      expect(new URL(page.url()).pathname).toBe(route);
      // Rien de l'app de bureau n'est monté derrière.
      await expect(page.getByRole('heading', { name: 'Mes automatisations' })).toHaveCount(0);
      await expect(page.getByRole('navigation')).toHaveCount(0);
    }
    await page.screenshot({ path: `${CAP}/MOB-01-porte-iphone.png`, fullPage: true });
  });

  test('[MOB-02] l’issue proposée par la porte : « retrouvez tout sur lumecrm.net depuis votre ordinateur » — un texte, aucun bouton mort @matrice', async ({ page }) => {
    await page.goto('/automations');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    // Tant qu'aucune application n'est publiée, la page le dit franchement et renvoie à l'ordinateur.
    await expect(page.getByText('Elle arrive bientôt.')).toBeVisible();
    await expect(page.getByText(/D.ici là, retrouvez tout sur\s*lumecrm\.net\s*depuis votre ordinateur\./)).toBeVisible();
    // Aucun bouton « Télécharger l'application » tant que les liens de magasin n'existent pas : pas de bouton qui ne mène nulle part.
    await expect(page.getByRole('link', { name: /Télécharger/ })).toHaveCount(0);
    await expect(page.getByRole('button')).toHaveCount(0);
    // Le logo porte un texte de remplacement.
    await expect(page.getByRole('img', { name: 'Lume' })).toBeVisible();
  });
});

test.describe('téléphone (Android, 412 px), compte en anglais', () => {
  test.use({ userAgent: ANDROID, viewport: { width: 412, height: 915 }, langue: 'en' });

  test('[MOB-03][S-20] la porte mobile parle la langue du compte (anglais) @matrice @defaut', async ({ page }) => {
    await page.goto('/automations');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.screenshot({ path: `${CAP}/MOB-03-porte-android-en.png`, fullPage: true });
    // Attendu : un compte en anglais ne lit pas « Le bureau sur l'ordi. »
    await expect(page.getByRole('heading', { level: 1 }), 'la porte est écrite en français seulement, codée en dur').not.toHaveText(/Le bureau sur l.ordi/);
  });
});

test.describe('fenêtre d’ordinateur rétrécie (375 px, agent utilisateur d’ordinateur)', () => {
  test.use({ viewport: { width: 375, height: 812 }, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36' });

  test('[MOB-04] contre-épreuve : même largeur, agent utilisateur d’ordinateur → la liste des automatisations est servie, pas la porte @matrice', async ({ page }) => {
    await page.goto('/automations');
    await expect(page.getByRole('heading', { name: 'Mes automatisations' })).toBeVisible({ timeout: 90_000 });
    await expect(page.getByText('Votre CRM travaille mieux sur un grand écran.')).toHaveCount(0);
    await page.screenshot({ path: `${CAP}/MOB-04-etroit-ordinateur.png`, fullPage: false });
    // Aucun débordement horizontal de la page : rien n'est coupé hors de l'écran.
    const deborde = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(deborde, 'la page ne déborde pas horizontalement à 375 px').toBeLessThanOrEqual(1);
  });
});

test.describe('page publique /apercu-mobile', () => {
  test('[MOB-05] /apercu-mobile montre la même porte à la demande, même sur un grand écran @matrice', async ({ page }) => {
    await page.goto('/apercu-mobile');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Le bureau sur l.ordi\.\s*Le terrain dans l.app\./);
  });
});
