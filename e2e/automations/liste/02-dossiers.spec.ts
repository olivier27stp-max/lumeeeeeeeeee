/**
 * LISTE — les dossiers.
 *
 * Ce que ce fichier prouve :
 *  · « Nouveau dossier » : saisie en ligne, Entrée / bouton « Créer » / Échap /
 *    « Annuler », nom vide, nom en double, double validation = un seul dossier ;
 *  · la barre de dossiers : « Tout », « Sans dossier », un dossier ouvert, son
 *    compteur ;
 *  · renommer (Entrée, perte de focus, Échap, doublon refusé) et supprimer un
 *    dossier (confirmation ; les automatisations reviennent à la racine et
 *    restent publiées) ;
 *  · ranger une automatisation dans un dossier, la remettre à la racine ;
 *  · ce que l'écran dit quand aucun dossier n'existe, ou quand leur lecture
 *    échoue.
 *
 * Chaque affirmation de l'écran est recoupée en base (`automation_folders`,
 * `automation_rules.folder_id`).
 */
import {
  test, expect, creerRegle, lireRegle, ouvrirListe, chercher, ligne, toast, boutonActions, nomsAffiches,
  creerDossierBase, dossiersBase, pastille,
} from './_aides';
import { randomBytes } from 'node:crypto';

const nomUnique = (prefixe: string) => `${prefixe} ${randomBytes(3).toString('hex')}`;

test.describe('créer un dossier', () => {
  test('[LST-008][LST-009][LST-012] « Nouveau dossier » ouvre un champ ; « Créer » crée le dossier et la barre apparaît', async ({ page, bureau }) => {
    const nom = nomUnique('Relances été');
    await ouvrirListe(page);
    // Sans dossier, pas de barre de dossiers.
    await expect(page.getByRole('button', { name: 'Sans dossier' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Nouveau dossier' }).click();
    const champ = page.getByRole('textbox', { name: 'Nom du dossier' });
    await expect(champ).toBeFocused();
    await expect(champ).toHaveAttribute('maxlength', '60');
    await expect(page.getByRole('button', { name: 'Nouveau dossier' })).toHaveCount(0);
    await champ.fill(nom);
    // « Créer » du dossier : celui qui suit le champ (l'autre « Créer » est le menu de l'en-tête).
    await page.getByRole('button', { name: 'Créer', exact: true }).first().click();

    await expect(toast(page, `Dossier « ${nom} » créé`)).toBeVisible();
    await expect(champ).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Nouveau dossier' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Tout', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'Sans dossier' })).toHaveAttribute('aria-pressed', 'false');
    // La pastille du dossier et son compteur (0 automatisation).
    await expect(pastille(page, nom, 0)).toBeVisible();

    expect((await dossiersBase(bureau, bureau.orgA)).map((d) => d.name)).toEqual([nom]);
    expect(await dossiersBase(bureau, bureau.orgB)).toEqual([]);

    await page.reload();
    await expect(pastille(page, nom, 0)).toBeVisible({ timeout: 60_000 });
  });

  test('[LST-010] Entrée crée le dossier ; une double frappe n’en crée qu’un', async ({ page, bureau }) => {
    const nom = nomUnique('Avis');
    await ouvrirListe(page);
    await page.getByRole('button', { name: 'Nouveau dossier' }).click();
    const champ = page.getByRole('textbox', { name: 'Nom du dossier' });
    await champ.fill(nom);
    // Deux Entrée coup sur coup, sans attendre : la seconde arrive pendant que la création est en vol.
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await expect(toast(page, `Dossier « ${nom} » créé`)).toBeVisible();
    await expect(toast(page, 'Un dossier porte déjà ce nom.')).toHaveCount(0);
    await expect(pastille(page, nom, 0)).toHaveCount(1);
    expect((await dossiersBase(bureau, bureau.orgA)).filter((d) => d.name === nom)).toHaveLength(1);
  });

  test('[LST-011] Échap ferme la saisie sans rien créer, et le champ est vide à la réouverture', async ({ page, bureau }) => {
    await ouvrirListe(page);
    await page.getByRole('button', { name: 'Nouveau dossier' }).click();
    const champ = page.getByRole('textbox', { name: 'Nom du dossier' });
    await champ.fill('À ne pas créer');
    await champ.press('Escape');
    await expect(champ).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Nouveau dossier' })).toBeVisible();
    await page.getByRole('button', { name: 'Nouveau dossier' }).click();
    await expect(page.getByRole('textbox', { name: 'Nom du dossier' })).toHaveValue('');
    expect(await dossiersBase(bureau, bureau.orgA)).toEqual([]);
  });

  test('[LST-013] « Annuler » ferme la saisie sans rien créer', async ({ page, bureau }) => {
    await ouvrirListe(page);
    await page.getByRole('button', { name: 'Nouveau dossier' }).click();
    await page.getByRole('textbox', { name: 'Nom du dossier' }).fill('À ne pas créer');
    await page.getByRole('button', { name: 'Annuler', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Nom du dossier' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Nouveau dossier' })).toBeVisible();
    expect(await dossiersBase(bureau, bureau.orgA)).toEqual([]);
  });

  test('[LST-010][LST-012] un nom vide ou fait d’espaces ne crée rien', async ({ page, bureau }) => {
    await ouvrirListe(page);
    await page.getByRole('button', { name: 'Nouveau dossier' }).click();
    await page.getByRole('textbox', { name: 'Nom du dossier' }).fill('   ');
    await page.getByRole('button', { name: 'Créer', exact: true }).first().click();
    await expect(page.getByRole('textbox', { name: 'Nom du dossier' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Nouveau dossier' })).toBeVisible();
    expect(await dossiersBase(bureau, bureau.orgA)).toEqual([]);
  });

  test('[LST-010] un nom déjà pris est refusé avec une explication ; la saisie reste ouverte pour corriger', async ({ page, bureau, moniteur }) => {
    const nom = nomUnique('Doublon');
    await creerDossierBase(bureau, bureau.orgA, nom);
    moniteur.attendu(/409 POST \/api\/automations\/folders/, 'nom de dossier déjà pris');
    await ouvrirListe(page);
    await page.getByRole('button', { name: 'Nouveau dossier' }).click();
    const champ = page.getByRole('textbox', { name: 'Nom du dossier' });
    // La casse ne compte pas : « doublon » = « Doublon ».
    await champ.fill(nom.toUpperCase());
    await champ.press('Enter');
    await expect(toast(page, 'Un dossier porte déjà ce nom.')).toBeVisible();
    await expect(champ).toBeVisible();
    await expect(champ).toHaveValue(nom.toUpperCase());
    expect(await dossiersBase(bureau, bureau.orgA)).toHaveLength(1);
  });
});

test.describe('ouvrir un dossier', () => {
  test('[LST-025][LST-026][LST-027] « Tout », « Sans dossier » et un dossier filtrent la liste ; le compteur est juste', async ({ page, bureau, marque }) => {
    const dossier = await creerDossierBase(bureau, bureau.orgA, nomUnique('Devis'));
    const dedans = await creerRegle(bureau, bureau.orgA, { name: `${marque} rangee`, folder_id: dossier.id });
    await creerRegle(bureau, bureau.orgA, { name: `${marque} racine` });
    // Une règle à la corbeille ne compte pas dans le dossier.
    await creerRegle(bureau, bureau.orgA, { name: `${marque} supprimee`, folder_id: dossier.id, deleted_at: new Date().toISOString() });
    await ouvrirListe(page);
    await chercher(page, marque);
    await expect.poll(() => nomsAffiches(page)).toEqual([`${marque} racine`, `${marque} rangee`]);

    const duDossier = pastille(page, dossier.name, 1);
    await duDossier.click();
    await expect(duDossier).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'Tout', exact: true })).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(() => nomsAffiches(page)).toEqual([`${marque} rangee`]);

    await page.getByRole('button', { name: 'Sans dossier' }).click();
    await expect(page.getByRole('button', { name: 'Sans dossier' })).toHaveAttribute('aria-pressed', 'true');
    await expect(duDossier).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(() => nomsAffiches(page)).toEqual([`${marque} racine`]);

    await page.getByRole('button', { name: 'Tout', exact: true }).click();
    await expect.poll(() => nomsAffiches(page)).toEqual([`${marque} racine`, `${marque} rangee`]);
    expect((await lireRegle(bureau, dedans.id))?.folder_id).toBe(dossier.id);
  });

  test('[LST-027] S-43 : le fil d’Ariane indique le dossier ouvert et permet d’en sortir @defaut', async ({ page, bureau }) => {
    const dossier = await creerDossierBase(bureau, bureau.orgA, nomUnique('Factures'));
    await ouvrirListe(page);
    await pastille(page, dossier.name, 0).click();
    // Le fil reste « Accueil », texte fixe : il ne dit pas où l'on est et ne ramène nulle part.
    const fil = page.getByRole('navigation', { name: /Fil d’Ariane|fil d'ariane/i });
    await expect(fil).toContainText('Accueil');
    await expect(fil).toContainText(dossier.name);
  });

  test('[LST-027] un dossier vide ouvert dit qu’il est vide, sans proposer « Voir les automatisations prêtes à publier »', async ({ page, bureau }) => {
    const dossier = await creerDossierBase(bureau, bureau.orgA, nomUnique('Vide'));
    await ouvrirListe(page);
    await pastille(page, dossier.name, 0).click();
    await expect(page.getByText('Aucune automatisation')).toBeVisible();
    await expect.poll(() => nomsAffiches(page)).toEqual([]);
    // Aucun préréglage dépublié dans ce bureau : rien à proposer (le bouton s'appelait « Voir les modèles »).
    await expect(page.getByRole('button', { name: /Voir les (modèles|automatisations prêtes à publier)/ })).toHaveCount(0);
  });
});

test.describe('renommer un dossier', () => {
  test('[LST-028][LST-029][LST-030] le crayon ouvre un champ pré-rempli ; Entrée renomme, une seule requête', async ({ page, bureau }) => {
    const dossier = await creerDossierBase(bureau, bureau.orgA, nomUnique('Ancien nom'));
    const nouveau = nomUnique('Nouveau nom');
    await ouvrirListe(page);
    const requetes: string[] = [];
    page.on('request', (r) => { if (r.method() === 'PATCH' && r.url().includes('/api/automations/folders/')) requetes.push(r.url()); });

    await page.getByRole('button', { name: `Renommer le dossier ${dossier.name}` }).click();
    const champ = page.getByRole('textbox', { name: `Nouveau nom du dossier ${dossier.name}` });
    await expect(champ).toBeFocused();
    await expect(champ).toHaveValue(dossier.name);
    await expect(champ).toHaveAttribute('maxlength', '60');
    await champ.fill(nouveau);
    await champ.press('Enter');

    await expect(pastille(page, nouveau, 0)).toBeVisible();
    await expect.poll(async () => (await dossiersBase(bureau, bureau.orgA)).map((d) => d.name)).toEqual([nouveau]);
    // S-15 : Entrée puis disparition du champ ne doit pas envoyer deux renommages.
    expect(requetes).toHaveLength(1);

    await page.reload();
    await expect(pastille(page, nouveau, 0)).toBeVisible({ timeout: 60_000 });
  });

  test('[LST-031] Échap annule le renommage : aucune requête, nom inchangé', async ({ page, bureau }) => {
    const dossier = await creerDossierBase(bureau, bureau.orgA, nomUnique('Stable'));
    await ouvrirListe(page);
    const requetes: string[] = [];
    page.on('request', (r) => { if (r.method() === 'PATCH' && r.url().includes('/api/automations/folders/')) requetes.push(r.url()); });
    await page.getByRole('button', { name: `Renommer le dossier ${dossier.name}` }).click();
    const champ = page.getByRole('textbox', { name: `Nouveau nom du dossier ${dossier.name}` });
    await champ.fill('Nom abandonné');
    await champ.press('Escape');
    await expect(champ).toHaveCount(0);
    await expect(pastille(page, dossier.name, 0)).toBeVisible();
    // On laisse à un éventuel renommage parasite le temps de partir : on attend une autre écriture, visible.
    await page.getByRole('button', { name: 'Nouveau dossier' }).click();
    await expect(page.getByRole('textbox', { name: 'Nom du dossier' })).toBeFocused();
    expect(requetes).toHaveLength(0);
    expect((await dossiersBase(bureau, bureau.orgA)).map((d) => d.name)).toEqual([dossier.name]);
  });

  test('[LST-032] cliquer ailleurs (perte de focus) enregistre le nouveau nom', async ({ page, bureau }) => {
    const dossier = await creerDossierBase(bureau, bureau.orgA, nomUnique('Avant'));
    const nouveau = nomUnique('Après');
    await ouvrirListe(page);
    await page.getByRole('button', { name: `Renommer le dossier ${dossier.name}` }).click();
    await page.getByRole('textbox', { name: `Nouveau nom du dossier ${dossier.name}` }).fill(nouveau);
    await page.getByRole('heading', { name: 'Mes automatisations' }).click();
    await expect(pastille(page, nouveau, 0)).toBeVisible();
    await expect.poll(async () => (await dossiersBase(bureau, bureau.orgA)).map((d) => d.name)).toEqual([nouveau]);
  });

  test('[LST-030] renommer vers un nom déjà pris est refusé : l’ancien nom revient, avec l’explication', async ({ page, bureau, moniteur }) => {
    const a = await creerDossierBase(bureau, bureau.orgA, nomUnique('Alpha'));
    const b = await creerDossierBase(bureau, bureau.orgA, nomUnique('Bravo'));
    moniteur.attendu(/409 PATCH \/api\/automations\/folders\//, 'nom de dossier déjà pris');
    await ouvrirListe(page);
    await page.getByRole('button', { name: `Renommer le dossier ${b.name}` }).click();
    const champ = page.getByRole('textbox', { name: `Nouveau nom du dossier ${b.name}` });
    await champ.fill(a.name);
    await champ.press('Enter');
    await expect(toast(page, 'Un dossier porte déjà ce nom.')).toBeVisible();
    await expect(pastille(page, b.name, 0)).toBeVisible();
    await expect(pastille(page, a.name, 0)).toHaveCount(1);
    expect((await dossiersBase(bureau, bureau.orgA)).map((d) => d.name).sort()).toEqual([a.name, b.name].sort());
  });

  test('[LST-030] vider le nom abandonne le renommage', async ({ page, bureau }) => {
    const dossier = await creerDossierBase(bureau, bureau.orgA, nomUnique('Gardé'));
    await ouvrirListe(page);
    await page.getByRole('button', { name: `Renommer le dossier ${dossier.name}` }).click();
    const champ = page.getByRole('textbox', { name: `Nouveau nom du dossier ${dossier.name}` });
    await champ.fill('');
    await champ.press('Enter');
    await expect(pastille(page, dossier.name, 0)).toBeVisible();
    expect((await dossiersBase(bureau, bureau.orgA)).map((d) => d.name)).toEqual([dossier.name]);
  });
});

test.describe('supprimer un dossier', () => {
  test('[LST-033][LST-093][LST-094] confirmation ; « Annuler » garde tout ; « Supprimer » remet les automatisations à la racine, toujours publiées', async ({ page, bureau, marque }) => {
    const dossier = await creerDossierBase(bureau, bureau.orgA, nomUnique('À retirer'));
    const regle = await creerRegle(bureau, bureau.orgA, { name: `${marque} dans le dossier`, folder_id: dossier.id, is_active: true });
    await ouvrirListe(page);
    await pastille(page, dossier.name, 1).click();
    await expect.poll(() => nomsAffiches(page)).toEqual([`${marque} dans le dossier`]);

    await page.getByRole('button', { name: `Supprimer le dossier ${dossier.name}` }).click();
    const dialogue = page.getByRole('dialog', { name: `Supprimer le dossier « ${dossier.name} » ?` });
    await expect(dialogue).toContainText('Les automatisations qu’il contient reviennent à la racine et continuent de tourner. Rien n’est supprimé.');
    await dialogue.getByRole('button', { name: 'Annuler' }).click();
    await expect(dialogue).toHaveCount(0);
    expect(await dossiersBase(bureau, bureau.orgA)).toHaveLength(1);

    await page.getByRole('button', { name: `Supprimer le dossier ${dossier.name}` }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Supprimer', exact: true }).click();

    // Plus de dossier : la barre disparaît, on revient sur « tout », la règle est toujours là.
    await expect(page.getByRole('button', { name: `Supprimer le dossier ${dossier.name}` })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Sans dossier' })).toHaveCount(0);
    await chercher(page, marque);
    await expect(ligne(page, `${marque} dans le dossier`).getByText('Publiée', { exact: true })).toBeVisible();

    expect(await dossiersBase(bureau, bureau.orgA)).toEqual([]);
    const apres = await lireRegle(bureau, regle.id);
    expect(apres?.folder_id).toBeNull();
    expect(apres?.is_active).toBe(true);
    expect(apres?.deleted_at).toBeNull();
  });

  test('[LST-033] supprimer un dossier confirme à l’écran ce qui vient d’être fait @defaut', async ({ page, bureau }) => {
    const dossier = await creerDossierBase(bureau, bureau.orgA, nomUnique('Muet'));
    await ouvrirListe(page);
    await page.getByRole('button', { name: `Supprimer le dossier ${dossier.name}` }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Supprimer', exact: true }).click();
    await expect(page.getByRole('button', { name: `Supprimer le dossier ${dossier.name}` })).toHaveCount(0);
    // Créer un dossier dit « Dossier créé » ; le supprimer ne dit rien.
    await expect(toast(page, /Dossier .*supprimé/)).toBeVisible({ timeout: 5_000 });
  });
});

test.describe('ranger une automatisation', () => {
  test('[LST-080] sans aucun dossier, « Déplacer dans un dossier » invite à en créer un et ouvre la saisie', async ({ page, bureau, marque }) => {
    await creerRegle(bureau, bureau.orgA, { name: `${marque} a ranger` });
    await ouvrirListe(page);
    await chercher(page, marque);
    await boutonActions(page, `${marque} a ranger`).click();
    await page.getByRole('menuitem', { name: 'Déplacer dans un dossier' }).click();
    await expect(toast(page, 'Créez d’abord un dossier.')).toBeVisible();
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'Nom du dossier' })).toBeFocused();
  });

  test('[LST-080][LST-082][LST-081] ranger dans un dossier puis remettre à la racine : toasts, compteur, base', async ({ page, bureau, marque }) => {
    const d1 = await creerDossierBase(bureau, bureau.orgA, nomUnique('Classeur A'));
    const d2 = await creerDossierBase(bureau, bureau.orgA, nomUnique('Classeur B'));
    const regle = await creerRegle(bureau, bureau.orgA, { name: `${marque} mobile`, is_active: true });
    const nom = `${marque} mobile`;
    await ouvrirListe(page);
    await chercher(page, marque);

    await boutonActions(page, nom).click();
    const menu = page.getByRole('menu');
    await menu.getByRole('menuitem', { name: 'Déplacer dans un dossier' }).click();
    // À la racine : pas de « Remettre à la racine », les deux dossiers sont proposés.
    await expect(menu.getByRole('menuitem', { name: '↑ Remettre à la racine' })).toHaveCount(0);
    await expect(menu.getByRole('menuitem', { name: d2.name })).toBeVisible();
    await menu.getByRole('menuitem', { name: d1.name }).click();
    await expect(toast(page, 'Rangée dans le dossier')).toBeVisible();
    await expect(pastille(page, d1.name, 1)).toBeVisible();
    await expect.poll(async () => (await lireRegle(bureau, regle.id))?.folder_id).toBe(d1.id);
    // Ranger ne change rien d'autre.
    expect((await lireRegle(bureau, regle.id))?.is_active).toBe(true);

    // Dans son dossier : celui-ci n'est plus proposé, « Remettre à la racine » apparaît.
    await chercher(page, marque);
    await boutonActions(page, nom).click();
    await menu.getByRole('menuitem', { name: 'Déplacer dans un dossier' }).click();
    await expect(menu.getByRole('menuitem', { name: d1.name })).toHaveCount(0);
    await expect(menu.getByRole('menuitem', { name: d2.name })).toBeVisible();
    await menu.getByRole('menuitem', { name: '↑ Remettre à la racine' }).click();
    await expect(toast(page, 'Remise à la racine')).toBeVisible();
    await expect(pastille(page, d1.name, 0)).toBeVisible();
    await expect.poll(async () => (await lireRegle(bureau, regle.id))?.folder_id).toBeNull();
  });

  test('[LST-080] S-10 : le sous-menu des dossiers est replié quand on rouvre le menu ⋮', async ({ page, bureau, marque }) => {
    const d = await creerDossierBase(bureau, bureau.orgA, nomUnique('Classeur'));
    await creerRegle(bureau, bureau.orgA, { name: `${marque} x` });
    await ouvrirListe(page);
    await chercher(page, marque);
    await boutonActions(page, `${marque} x`).click();
    await page.getByRole('menuitem', { name: 'Déplacer dans un dossier' }).click();
    await expect(page.getByRole('menuitem', { name: d.name })).toBeVisible();
    await page.getByRole('heading', { name: 'Mes automatisations' }).click();
    await expect(page.getByRole('menu')).toHaveCount(0);
    await boutonActions(page, `${marque} x`).click();
    await expect(page.getByRole('menuitem', { name: 'Déplacer dans un dossier' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: d.name })).toHaveCount(0);
  });

  test('[LST-080] S-28 : si la lecture des dossiers échoue, l’écran ne prétend pas qu’il n’y en a aucun @defaut', async ({ page, bureau, marque, moniteur }) => {
    await creerDossierBase(bureau, bureau.orgA, nomUnique('Existe'));
    await creerRegle(bureau, bureau.orgA, { name: `${marque} x` });
    moniteur.attendu(/500 GET \/api\/automations\/folders/, 'panne simulée de la lecture des dossiers');
    moniteur.attendu(/\[automations\] dossiers/, 'journal de la panne simulée');
    await page.route('**/api/automations/folders', (r) => (r.request().method() === 'GET'
      ? r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Impossible de lire les dossiers.' }) })
      : r.continue()));
    await ouvrirListe(page);
    await chercher(page, marque);
    await boutonActions(page, `${marque} x`).click();
    await page.getByRole('menuitem', { name: 'Déplacer dans un dossier' }).click();
    // L'écran dit que la lecture a échoué… (attendu D'ABORD : l'attente négative qui suit, seule, passerait à vide
    // avant même que l'écran ait réagi au clic.)
    await expect(page.getByText(/Impossible de lire les dossiers/)).toBeVisible({ timeout: 8_000 });
    // …et ne prétend pas « Créez d'abord un dossier. » : il en existe un, c'est sa lecture qui a échoué.
    await expect(toast(page, 'Créez d’abord un dossier.')).toHaveCount(0);
  });
});
