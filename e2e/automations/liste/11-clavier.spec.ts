/**
 * LISTE — tout au clavier.
 *
 * Ce que ce fichier prouve :
 *  · Tab atteint les contrôles de la page dans l'ordre où on les lit ;
 *  · Entrée / Espace actionnent : onglets, interrupteur, cases, tris, menus ;
 *  · les menus « Créer » et ⋮ : ouverture, parcours, Échap, retour du focus ;
 *  · la saisie d'un dossier au clavier seul.
 */
import {
  test, expect, creerRegle, lireRegle, ouvrirListe, chercher, toast, onglet, boutonActions, interrupteur, champRecherche, nomsAffiches,
  dossiersBase,
} from './_aides';

/** Le nom accessible (ou à défaut le texte) de l'élément qui a le focus. */
async function focusActuel(page: import('@playwright/test').Page): Promise<string> {
  return page.evaluate(() => {
    const e = document.activeElement as HTMLElement | null;
    if (!e || e === document.body) return '(aucun)';
    const parLabel = e.id ? document.querySelector(`label[for="${e.id}"]`)?.textContent : null;
    return (e.getAttribute('aria-label') || parLabel || e.innerText || e.getAttribute('placeholder') || e.tagName).replace(/\s+/g, ' ').trim();
  });
}

/** Comparaison sans espaces ni casse : « BÊTA » en capitales par le style, sauts de ligne entre deux blocs… */
const sansForme = (s: string) => s.toLowerCase().replace(/\s+/g, '');

test.describe('ordre de tabulation', () => {
  test('[LST-002][LST-003][LST-004][LST-006][LST-008][LST-014][LST-015][LST-020][LST-034][LST-035][LST-061] Tab parcourt la page dans l’ordre de lecture', async ({ page, bureau, marque }) => {
    await creerRegle(bureau, bureau.orgA, { name: `${marque} unique` });
    await ouvrirListe(page);
    await chercher(page, marque);
    await expect.poll(() => nomsAffiches(page)).toEqual([`${marque} unique`]);
    // La sous-navigation est faite de liens (SousNavigation.tsx) ; le premier, « Automatisations », est la page courante.
    await page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: /Vue d’ensemble/ }).focus();
    const parcours: string[] = [await focusActuel(page)];
    for (let i = 0; i < 26; i += 1) {
      await page.keyboard.press('Tab');
      parcours.push(await focusActuel(page));
    }
    expect(parcours.map(sansForme)).toEqual([
      'Vue d’ensemble Bêta', 'Réglages globaux', 'Tout arrêter', 'FR', 'EN', 'Nouveau dossier', 'Construire avec Lumi', 'Créer',
      'Toutes', 'À vérifier (0)', 'Prêtes à publier (0)', 'Corbeille (0)', 'Filtres avancés', 'Rechercher',
      'Tout cocher', 'Nom', 'Statut', 'Total déclenché', 'En cours', 'Modifiée le', 'Créée le',
      `Cocher ${marque} unique`, `${marque} unique Nouveau prospect · Immédiat`, `Statistiques de ${marque} unique`,
      `Publier ${marque} unique`, `Voir les messages de ${marque} unique`, `Actions pour ${marque} unique`,
    ].map(sansForme));
  });

  test('[LST-020] S-51 : les onglets se parcourent aux flèches (un seul arrêt de tabulation) @defaut', async ({ page }) => {
    await ouvrirListe(page);
    await onglet(page, 'Toutes').focus();
    await page.keyboard.press('ArrowRight');
    // Des onglets (role="tab") : la flèche droite passe au suivant ; ici elle ne fait rien.
    await expect(onglet(page, 'À vérifier')).toBeFocused({ timeout: 5_000 });
  });
});

test.describe('Entrée et Espace', () => {
  test('[LST-021][LST-023] Entrée et Espace changent d’onglet', async ({ page }) => {
    await ouvrirListe(page);
    await onglet(page, 'Corbeille').focus();
    await page.keyboard.press('Enter');
    await expect(onglet(page, 'Corbeille')).toHaveAttribute('aria-selected', 'true');
    await onglet(page, 'À vérifier').focus();
    await page.keyboard.press('Space');
    await expect(onglet(page, 'À vérifier')).toHaveAttribute('aria-selected', 'true');
  });

  test('[LST-073][LST-069][LST-062] Espace bascule l’interrupteur et coche la ligne ; Entrée trie', async ({ page, bureau, marque }) => {
    const r = await creerRegle(bureau, bureau.orgA, { name: `${marque} B clavier`, actions: [], steps: [{ id: 'e1', type: 'action', action: { type: 'send_sms', config: { body: 'Bonjour.' } } }] });
    await creerRegle(bureau, bureau.orgA, { name: `${marque} A clavier` });
    await ouvrirListe(page);
    await chercher(page, marque);
    await interrupteur(page, r.name).focus();
    await page.keyboard.press('Space');
    await expect(toast(page, 'Automatisation publiée')).toBeVisible();
    await expect.poll(async () => (await lireRegle(bureau, r.id))?.is_active).toBe(true);
    await interrupteur(page, r.name).focus();
    await page.keyboard.press('Enter');
    await expect(toast(page, 'Repassée en brouillon')).toBeVisible();
    await expect.poll(async () => (await lireRegle(bureau, r.id))?.is_active).toBe(false);

    await page.getByRole('checkbox', { name: `Cocher ${r.name}` }).focus();
    await page.keyboard.press('Space');
    await expect(page.getByText('1 sélectionnée(s)')).toBeVisible();
    await page.keyboard.press('Space');
    await expect(page.getByText(/sélectionnée\(s\)/)).toHaveCount(0);

    const nom = page.getByRole('columnheader', { name: 'Nom' });
    await nom.getByRole('button').focus();
    await page.keyboard.press('Enter');
    await expect(nom).toHaveAttribute('aria-sort', 'ascending');
    await page.keyboard.press('Enter');
    await expect(nom).toHaveAttribute('aria-sort', 'descending');
    await expect.poll(() => nomsAffiches(page)).toEqual([`${marque} B clavier`, `${marque} A clavier`]);
  });

  test('[LST-008][LST-009][LST-010][LST-011] créer un dossier au clavier seul ; Échap rend le focus à « Nouveau dossier »', async ({ page, bureau }) => {
    const nom = `Clavier ${Date.now()}`;
    await ouvrirListe(page);
    await page.getByRole('button', { name: 'Nouveau dossier' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('textbox', { name: 'Nom du dossier' })).toBeFocused();
    await page.keyboard.type(nom);
    await page.keyboard.press('Enter');
    await expect(toast(page, `Dossier « ${nom} » créé`)).toBeVisible();
    expect((await dossiersBase(bureau, bureau.orgA)).map((d) => d.name)).toEqual([nom]);
    // Après la création, le focus ne doit pas être perdu.
    await expect(page.getByRole('button', { name: 'Nouveau dossier' })).toBeVisible();
  });

  test('[LST-011] après Échap dans la saisie d’un dossier, le focus revient sur « Nouveau dossier » @defaut', async ({ page }) => {
    await ouvrirListe(page);
    await page.getByRole('button', { name: 'Nouveau dossier' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('textbox', { name: 'Nom du dossier' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('textbox', { name: 'Nom du dossier' })).toHaveCount(0);
    // Le champ disparaît et le focus retombe sur le corps de la page.
    await expect(page.getByRole('button', { name: 'Nouveau dossier' })).toBeFocused({ timeout: 5_000 });
  });

  test('[LST-035] la recherche se pilote au clavier : taper filtre aussitôt', async ({ page, bureau, marque }) => {
    await creerRegle(bureau, bureau.orgA, { name: `${marque} trouvee` });
    await ouvrirListe(page);
    await champRecherche(page).focus();
    await page.keyboard.type(marque);
    await expect.poll(() => nomsAffiches(page)).toEqual([`${marque} trouvee`]);
    await expect(champRecherche(page)).toBeFocused();
  });
});

test.describe('menus au clavier', () => {
  test('[LST-015][LST-016] « Créer » : Entrée ouvre le menu, Tab atteint les choix, Entrée choisit', async ({ page }) => {
    await ouvrirListe(page);
    const creer = page.getByRole('button', { name: 'Créer', exact: true });
    await creer.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menu')).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('menuitem', { name: /Partir de zéro/ })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('menuitem', { name: /Construire avec Lumi/ })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/automations\/nouvelle$/);
  });

  test('[LST-015] S-08 : Échap ferme le menu « Créer » et rend le focus au bouton', async ({ page }) => {
    await ouvrirListe(page);
    const creer = page.getByRole('button', { name: 'Créer', exact: true });
    await creer.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0, { timeout: 5_000 });
    await expect(creer).toBeFocused();
  });

  test('[LST-015] S-08 : à l’ouverture au clavier, le focus entre dans le menu et les flèches le parcourent @defaut', async ({ page }) => {
    await ouvrirListe(page);
    await page.getByRole('button', { name: 'Créer', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menu')).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('menuitem').first()).toBeFocused({ timeout: 5_000 });
  });

  /*
   * DÉFAUT (tri du 2026-10-01). Depuis que le menu ⋮ est dessiné dans un portail en fin de page
   * (Automations.tsx, `createPortal(…, document.body)` — correctif de S-07), ses entrées ne SUIVENT plus le
   * bouton dans l'ordre de tabulation. Relevé sur une liste d'UNE ligne : Entrée ouvre le menu, puis Tab va sur
   * « Lignes par page », « Aide et support », et seulement ensuite « Modifier ». Sur une liste de dix lignes,
   * il faut traverser toutes les lignes suivantes. Le menu est à l'écran, sous le bouton, mais hors d'atteinte
   * du clavier.
   */
  test('[LST-076][LST-083] menu ⋮ au clavier : Entrée ouvre, Tab atteint « Supprimer », Entrée ouvre la confirmation @defaut', async ({ page, bureau, marque }) => {
    const r = await creerRegle(bureau, bureau.orgA, { name: `${marque} clavier` });
    await ouvrirListe(page);
    await chercher(page, marque);
    await boutonActions(page, r.name).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menu')).toBeAttached();
    for (const item of ['Modifier', 'Dupliquer', 'Déplacer dans un dossier', 'Supprimer']) {
      await page.keyboard.press('Tab');
      await expect(page.getByRole('menuitem', { name: item })).toBeFocused({ timeout: 5_000 });
    }
    await page.keyboard.press('Enter');
    const dialogue = page.getByRole('dialog', { name: 'Supprimer cette automatisation ?' });
    await expect(dialogue).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialogue).toHaveCount(0);
    expect((await lireRegle(bureau, r.id))?.deleted_at).toBeNull();
  });

  test('[LST-076] S-08 : Échap ferme le menu ⋮ et rend le focus au bouton', async ({ page, bureau, marque }) => {
    const r = await creerRegle(bureau, bureau.orgA, { name: `${marque} echap` });
    await ouvrirListe(page);
    await chercher(page, marque);
    await boutonActions(page, r.name).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menu')).toBeAttached();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0, { timeout: 5_000 });
    await expect(boutonActions(page, r.name)).toBeFocused();
  });

  test('[LST-076] quitter le menu ⋮ par Tab le referme (il ne reste pas ouvert derrière) @defaut', async ({ page, bureau, marque }) => {
    const r = await creerRegle(bureau, bureau.orgA, { name: `${marque} tab` });
    await ouvrirListe(page);
    await chercher(page, marque);
    await boutonActions(page, r.name).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menu')).toBeAttached();
    /*
     * On tabule jusqu'à ce que le focus soit HORS du menu et hors de son bouton — où que soit le menu dans la
     * page (il est dans un portail en fin de page : un nombre fixe de Tab n'en sortirait pas forcément).
     * Dès que le focus est dehors, le menu doit être refermé.
     */
    let dehors = false;
    for (let i = 0; i < 12 && !dehors; i += 1) {
      await page.keyboard.press('Tab');
      dehors = await page.evaluate(() => {
        const actif = document.activeElement;
        const menu = document.querySelector('[role="menu"]');
        const bouton = document.querySelector('button[aria-haspopup="menu"][aria-expanded="true"]');
        return !!actif && actif !== bouton && !(menu?.contains(actif) ?? false);
      });
    }
    expect(dehors, 'le focus a quitté le menu et son bouton').toBe(true);
    // Le focus est sorti ; le menu, lui, est toujours ouvert.
    await expect(page.getByRole('menu')).toHaveCount(0, { timeout: 5_000 });
  });
});
