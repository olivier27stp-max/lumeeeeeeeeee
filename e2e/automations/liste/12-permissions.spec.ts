/**
 * LISTE — qui voit quoi.
 *
 * Ce que ce fichier prouve :
 *  · un administrateur a la liste complète et peut tout arrêter ;
 *  · un technicien (aucun droit sur les automatisations) n'a ni l'entrée de
 *    menu ni la page ;
 *  · un rôle « lecture seule » (voir sans modifier) : ce que l'écran lui
 *    montre, et où mènent les liens qu'on lui tend ;
 *  · le bureau voisin ne voit rien du bureau A.
 *
 * Les droits du technicien sont modifiés le temps d'un test puis remis.
 */
import {
  test, expect, creerRegle, ouvrirListe, chercher, ligne, toast, nomsAffiches, reglagesBureau, attendreDroitsServeur, type Bureau,
} from './_aides';

/** De quoi interroger le serveur COMME le technicien : son jeton et l'adresse de l'app. */
interface Serveur { baseURL: string; jeton: string }

async function avecDroits(bureau: Bureau, droits: Record<string, boolean>, serveur: Serveur, faire: () => Promise<void>): Promise<void> {
  const ou = { org_id: bureau.orgA, user_id: bureau.comptes.techA.id };
  const { data: avant } = await bureau.admin.from('memberships').select('permissions').match(ou).single();
  const { error } = await bureau.admin.from('memberships').update({ permissions: droits }).match(ou);
  if (error) throw new Error(`droits du technicien : ${error.message}`);
  try {
    // Le serveur garde les droits 60 s en mémoire : on attend qu'il applique ceux-ci avant d'ouvrir l'écran.
    await attendreDroitsServeur(serveur.baseURL, serveur.jeton, bureau.orgA, {
      voir: droits['automations.read'] === true, modifier: droits['automations.update'] === true,
    });
    await faire();
  } finally {
    await bureau.admin.from('memberships').update({ permissions: avant?.permissions ?? {} }).match(ou);
  }
}

/**
 * Déplie « Plus » dans le menu de gauche (Statistiques, Tâches, Automatisations) et attend qu'il le soit.
 * Le bouton « Plus » est toujours là ; ce qu'il montre dépend des droits.
 */
async function deplierPlus(page: import('@playwright/test').Page): Promise<void> {
  const menu = page.getByRole('navigation');
  const plus = menu.getByRole('button', { name: 'Plus', exact: true });
  await expect(plus).toBeVisible({ timeout: 90_000 });
  const avant = await menu.getByRole('button').count();
  await plus.click();
  // Déplié : la flèche du bouton a tourné (classe `-rotate-90`) ; les entrées permises, s'il y en a, suivent le bouton.
  await expect(plus.locator('svg')).toHaveClass(/-rotate-90/);
  expect(await menu.getByRole('button').count()).toBeGreaterThanOrEqual(avant);
}

test.describe('administrateur', () => {
  test.use({ compte: 'adminA' });

  test('[LST-020][LST-004][LST-005] un administrateur voit la liste et peut tout arrêter puis reprendre', async ({ page, bureau, marque }) => {
    await creerRegle(bureau, bureau.orgA, { name: `${marque} visible`, is_active: true });
    await ouvrirListe(page);
    await chercher(page, marque);
    await expect(ligne(page, `${marque} visible`)).toBeVisible();
    await page.getByRole('button', { name: 'Tout arrêter' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Tout arrêter' }).click();
    await expect(toast(page, 'Automatisations en pause.')).toBeVisible();
    const etat = await reglagesBureau(bureau, bureau.orgA);
    expect(etat.automations_paused).toBe(true);
    expect(etat.automations_paused_by).toBe(bureau.comptes.adminA.id);
    await page.getByRole('button', { name: 'Reprendre' }).click();
    await expect(toast(page, 'Automatisations reprises.')).toBeVisible();
    expect((await reglagesBureau(bureau, bureau.orgA)).automations_paused).toBe(false);
  });
});

test.describe('technicien', () => {
  test.use({ compte: 'techA' });

  test('[LST-020] sans droit sur les automatisations : pas d’entrée de menu, et la page répond « Accès restreint »', async ({ page }) => {
    await page.goto('/automations');
    await expect(page.getByRole('heading', { name: 'Accès restreint' })).toBeVisible({ timeout: 90_000 });
    await expect(page.getByText('Vous n\'avez pas la permission de voir cette page.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Mes automatisations' })).toHaveCount(0);
    // L'entrée « Automatisations » vit sous « Plus », replié par défaut (src/App.tsx, `moreNavItems`) : on le déplie
    // avant d'affirmer qu'elle n'y est pas — menu replié, l'attente passerait pour n'importe quel rôle.
    await deplierPlus(page);
    await expect(page.getByRole('navigation').getByRole('button', { name: 'Automatisations', exact: true })).toHaveCount(0);
  });

  test('[LST-020] S-01 : en lecture seule, l’entrée de menu « Automatisations » ne mène pas à « Accès restreint » @defaut', async ({ page, bureau, jetonDe, baseURL }) => {
    await avecDroits(bureau, { 'automations.read': true }, { baseURL: String(baseURL), jeton: await jetonDe('techA') }, async () => {
      await page.goto('/');
      await deplierPlus(page);
      const entree = page.getByRole('navigation').getByRole('button', { name: 'Automatisations', exact: true });
      await expect(entree).toBeVisible({ timeout: 90_000 });
      await entree.click();
      await expect(page).toHaveURL(/\/automations$/);
      // On lui montre la porte, puis on la lui ferme : la route demande « voir », la page exige « modifier ».
      // L'attente POSITIVE d'abord : « pas d'Accès restreint », seule, passe tant que la page n'a encore rien affiché.
      await expect(page.getByRole('heading', { name: 'Mes automatisations' }).or(page.getByRole('heading', { name: 'Accès restreint' }))).toBeVisible({ timeout: 30_000 });
      await expect(page.getByRole('heading', { name: 'Accès restreint' })).toHaveCount(0, { timeout: 5_000 });
      await expect(page.getByRole('heading', { name: 'Mes automatisations' })).toBeVisible();
    });
  });

  test('[LST-002][LST-003] S-01 : en lecture seule, la Vue d’ensemble est ouverte mais ses deux onglets voisins mènent à « Accès restreint » @defaut', async ({ page, bureau, jetonDe, baseURL }) => {
    await avecDroits(bureau, { 'automations.read': true }, { baseURL: String(baseURL), jeton: await jetonDe('techA') }, async () => {
      await page.goto('/automations/apercu');
      const nav = page.getByRole('navigation', { name: 'Sections' });
      await expect(nav).toBeVisible({ timeout: 90_000 });
      await expect(page.getByRole('heading', { name: 'Accès restreint' })).toHaveCount(0);
      // La sous-navigation est faite de liens (SousNavigation.tsx).
      await nav.getByRole('link', { name: /^(Automatisations|Workflows)$/ }).click();
      await expect(page).toHaveURL(/\/automations$/);
      // L'attente POSITIVE d'abord (voir le test précédent) : on attend que la page ait rendu son verdict.
      await expect(page.getByRole('heading', { name: 'Mes automatisations' }).or(page.getByRole('heading', { name: 'Accès restreint' }))).toBeVisible({ timeout: 30_000 });
      await expect(page.getByRole('heading', { name: 'Accès restreint' })).toHaveCount(0, { timeout: 5_000 });
      await expect(page.getByRole('heading', { name: 'Mes automatisations' })).toBeVisible();
    });
  });

  test('[LST-073][LST-083] avec « modifier les automatisations », le technicien publie et supprime ; la base suit', async ({ page, bureau, marque, jetonDe, baseURL }) => {
    const r = await creerRegle(bureau, bureau.orgA, { name: `${marque} par le technicien`, actions: [], steps: [{ id: 'e1', type: 'action', action: { type: 'send_sms', config: { body: 'Bonjour.' } } }] });
    await avecDroits(bureau, { 'automations.read': true, 'automations.update': true }, { baseURL: String(baseURL), jeton: await jetonDe('techA') }, async () => {
      await ouvrirListe(page);
      await chercher(page, marque);
      await page.getByRole('switch', { name: `Publier ${r.name}` }).click();
      await expect(toast(page, 'Automatisation publiée')).toBeVisible();
      await page.getByRole('button', { name: `Actions pour ${r.name}` }).click();
      await page.getByRole('menuitem', { name: 'Supprimer' }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Supprimer', exact: true }).click();
      await expect(toast(page, 'Automatisation mise à la corbeille')).toBeVisible();
      const { data } = await bureau.admin.from('automation_rules').select('is_active, deleted_at').eq('id', r.id).single();
      expect(data?.is_active).toBe(false);
      expect(data?.deleted_at).not.toBeNull();
    });
  });
});

test.describe('bureau voisin', () => {
  test.use({ compte: 'proprioB' });

  test('[LST-020][LST-035] le bureau B ne voit aucune automatisation du bureau A', async ({ page, bureau, marque }) => {
    await creerRegle(bureau, bureau.orgA, { name: `${marque} du bureau A` });
    await creerRegle(bureau, bureau.orgB, { name: `${marque} du bureau B` });
    await ouvrirListe(page);
    await chercher(page, marque);
    await expect.poll(() => nomsAffiches(page)).toEqual([`${marque} du bureau B`]);
  });
});
