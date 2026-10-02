/**
 * Éditeur — la barre du haut : retour, nom, annuler / refaire, indicateur d'enregistrement.
 *
 * Ce que ce fichier prouve :
 *  · « Mes automatisations » ramène à la liste et enregistre d'abord ce qui attend ;
 *  · le nom se modifie sur place (accents, émojis, très long, vide, Échap, perte de focus)
 *    et ce que l'écran affiche est ce que la base contient, y compris après rechargement ;
 *  · annuler / refaire rattrapent une modification du parcours (boutons, et Ctrl+Z — piste S-42) ;
 *  · l'indicateur « Modifié / Enregistrement… / Enregistré / N étape(s) à compléter » dit vrai.
 */
import { lireRegle } from '../_outils/banc';
import {
  test, expect, DELAI_TEST,
  CAPTURES, creerParcours, troisTextos, ouvrirEditeur, cartes, barre, carte, menuDeCarte, indicateur,
  attendreEnregistre, attendreRegle, corpsDuFil, dialogue, panneauEtape, tiroirActions,
} from './_aides';

test.describe.configure({ timeout: DELAI_TEST });

const champNom = (page: import('@playwright/test').Page) => page.getByLabel('Nom de l’automatisation');

test.describe('barre du haut — retour à la liste', () => {
  test('[EDT-004] « Mes automatisations » sans rien modifier : retour direct à la liste, la ligne y est', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} retour`, troisTextos());
    await ouvrirEditeur(page, r.id);
    await barre(page).getByRole('button', { name: 'Mes automatisations' }).click();
    await expect(page).toHaveURL(/\/automations$/);
    await expect(page.getByRole('heading', { name: 'Mes automatisations' })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(`${marque} retour`).first()).toBeVisible({ timeout: 30_000 });
    await expect(dialogue(page)).toHaveCount(0);
  });

  test('[EDT-004] « Mes automatisations » juste après une modification : elle est enregistrée AVANT de partir', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} retour modif`, troisTextos());
    await ouvrirEditeur(page, r.id);
    await carte(page, 'Texto BRAVO').click();
    await panneauEtape(page).getByLabel(/Texte du message/).fill('Texto BRAVO modifié');
    await panneauEtape(page).getByRole('button', { name: 'Enregistrer' }).click();
    await expect(indicateur(page)).toHaveText('Modifié');
    // Sans attendre les 3 s de l'enregistrement automatique.
    await barre(page).getByRole('button', { name: 'Mes automatisations' }).click();
    await expect(page).toHaveURL(/\/automations$/, { timeout: 30_000 });
    await expect(dialogue(page)).toHaveCount(0);
    expect(await corpsDuFil(bureau, r.id)).toEqual(['Texto ALPHA', 'Texto BRAVO modifié', 'Texto CHARLIE']);
  });
  test('[EDT-004] fenêtre étroite (600 px) : le bouton de retour garde un nom lisible par un lecteur d’écran (S-44) @defaut', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} étroit`, troisTextos());
    await page.setViewportSize({ width: 600, height: 800 });
    await ouvrirEditeur(page, r.id);
    await page.screenshot({ path: `${CAPTURES}/edt-004-600px.png` });
    // À cette largeur, le bouton n'a plus de nom : on ne peut l'atteindre que par sa place (premier bouton de la barre).
    const retour = page.locator('div.fixed.inset-0.z-50 > header button').first();
    await expect(retour).toBeVisible();
    const nom = await retour.evaluate((el) => (el.getAttribute('aria-label') || (el as HTMLElement).innerText || '').trim());
    expect(nom, 'sous 640 px le bouton n’est plus qu’une flèche sans nom : « bouton » pour un lecteur d’écran').not.toBe('');
  });
});

test.describe('barre du haut — renommer', () => {
  test('[EDT-005][EDT-006][EDT-007] renommer avec accents et émojis, Entrée : écran = base, relu identique après rechargement', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} avant`, troisTextos());
    await ouvrirEditeur(page, r.id);
    await barre(page).getByRole('button', { name: `${marque} avant` }).click();
    await expect(champNom(page)).toBeFocused();
    await expect(champNom(page)).toHaveValue(`${marque} avant`);
    const nouveau = `${marque} Été à Québec — relance « œuf » 🚀✅`;
    await champNom(page).fill(nouveau);
    await expect(indicateur(page)).toHaveText('Modifié');
    await page.keyboard.press('Enter');
    await expect(champNom(page)).toHaveCount(0);
    await expect(barre(page).getByRole('button', { name: nouveau })).toBeVisible();
    await attendreEnregistre(page);
    expect((await lireRegle(bureau, r.id))?.name).toBe(nouveau);
    // Renommer ne touche pas au parcours.
    expect(await corpsDuFil(bureau, r.id)).toEqual(['Texto ALPHA', 'Texto BRAVO', 'Texto CHARLIE']);
    await page.reload();
    await expect(barre(page).getByRole('button', { name: nouveau })).toBeVisible({ timeout: 90_000 });
  });

  test('[EDT-006] nom très long : la saisie s’arrête à 120 caractères, le nom tient dans la barre, la base a le même', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} long`, troisTextos());
    await ouvrirEditeur(page, r.id);
    await barre(page).getByRole('button', { name: `${marque} long` }).click();
    const tape = `${marque} ${'Très long nom d’automatisation '.repeat(8)}`;
    await champNom(page).fill('');
    await champNom(page).pressSequentially(tape, { delay: 0 });
    const garde = await champNom(page).inputValue();
    expect(garde.length).toBe(120);
    expect(garde).toBe(tape.slice(0, 120));
    await page.keyboard.press('Enter');
    await attendreEnregistre(page);
    expect((await lireRegle(bureau, r.id))?.name).toBe(garde);
    // Le nom ne pousse rien hors de l'écran : l'indicateur et le bouton de retour restent visibles.
    await page.screenshot({ path: `${CAPTURES}/edt-006-nom-long.png` });
    const boiteNom = await barre(page).getByRole('button', { name: garde }).boundingBox();
    const boiteIndic = await indicateur(page).boundingBox();
    const boiteRetour = await barre(page).getByRole('button', { name: 'Mes automatisations' }).boundingBox();
    expect(boiteNom && boiteIndic && boiteRetour).toBeTruthy();
    expect(boiteNom!.x).toBeGreaterThanOrEqual(boiteRetour!.x + boiteRetour!.width - 1);
    expect(boiteNom!.x + boiteNom!.width).toBeLessThanOrEqual(boiteIndic!.x + 1);
  });

  test('[EDT-006] nom vidé : l’ancien nom reste (écran et base) et le champ rouvert le montre @defaut', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} vide`, troisTextos());
    await ouvrirEditeur(page, r.id);
    await barre(page).getByRole('button', { name: `${marque} vide` }).click();
    await champNom(page).fill('');
    await page.keyboard.press('Enter');
    // L'écran retombe sur l'ancien nom…
    await expect(barre(page).getByRole('button', { name: `${marque} vide` })).toBeVisible();
    await attendreEnregistre(page);
    expect((await lireRegle(bureau, r.id))?.name).toBe(`${marque} vide`);
    // … et le champ rouvert doit montrer CE nom, pas un champ vide sous un titre plein.
    await barre(page).getByRole('button', { name: `${marque} vide` }).click();
    await expect(champNom(page), 'le titre affiche l’ancien nom mais le champ rouvert est vide : deux vérités à l’écran').toHaveValue(`${marque} vide`);
  });

  test('[EDT-008] Échap pendant le renommage ANNULE la saisie (S-17) @defaut', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} échap`, troisTextos());
    await ouvrirEditeur(page, r.id);
    await barre(page).getByRole('button', { name: `${marque} échap` }).click();
    await champNom(page).fill(`${marque} saisie abandonnée`);
    await page.keyboard.press('Escape');
    await expect(champNom(page)).toHaveCount(0);
    await expect(barre(page).getByRole('button', { name: `${marque} échap` }),
      'Échap a gardé la saisie au lieu de revenir à l’ancien nom').toBeVisible({ timeout: 5000 });
    // Laisser passer l'enregistrement automatique (3 s) s'il y en a un, puis relire la base.
    await expect(indicateur(page)).toHaveText('Enregistré', { timeout: 20_000 });
    expect((await lireRegle(bureau, r.id))?.name).toBe(`${marque} échap`);
  });

  test('[EDT-009] cliquer ailleurs ferme le champ et garde le nouveau nom, enregistré en base', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} flou`, troisTextos());
    await ouvrirEditeur(page, r.id);
    await barre(page).getByRole('button', { name: `${marque} flou` }).click();
    await champNom(page).fill(`${marque} flou renommé`);
    await page.getByRole('tab', { name: 'Parcours' }).focus();
    await expect(champNom(page)).toHaveCount(0);
    await expect(barre(page).getByRole('button', { name: `${marque} flou renommé` })).toBeVisible();
    await attendreEnregistre(page);
    expect((await lireRegle(bureau, r.id))?.name).toBe(`${marque} flou renommé`);
  });
});

test.describe('barre du haut — annuler / refaire', () => {
  test('[EDT-010][EDT-011] annuler puis refaire une suppression d’étape : l’écran et la base suivent', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} annuler`, troisTextos());
    await ouvrirEditeur(page, r.id);
    const annuler = barre(page).getByRole('button', { name: 'Annuler', exact: true });
    const refaire = barre(page).getByRole('button', { name: 'Refaire', exact: true });
    await expect(annuler).toBeDisabled();
    await expect(refaire).toBeDisabled();

    await menuDeCarte(page, 'Texto BRAVO').click();
    await page.getByRole('button', { name: 'Supprimer l’action' }).click();
    await dialogue(page).getByRole('button', { name: 'Supprimer' }).click();
    expect(await cartes(page)).toEqual(['Envoyer un texto | Texto ALPHA', 'Envoyer un texto | Texto CHARLIE']);
    await expect(annuler).toBeEnabled();
    await expect(refaire).toBeDisabled();
    await attendreEnregistre(page);
    expect(await corpsDuFil(bureau, r.id)).toEqual(['Texto ALPHA', 'Texto CHARLIE']);

    await annuler.click();
    await expect(indicateur(page)).toHaveText(/Modifié|Enregistrement…/);
    expect(await cartes(page)).toEqual(['Envoyer un texto | Texto ALPHA', 'Envoyer un texto | Texto BRAVO', 'Envoyer un texto | Texto CHARLIE']);
    await expect(annuler).toBeDisabled();
    await expect(refaire).toBeEnabled();
    await attendreEnregistre(page);
    expect(await corpsDuFil(bureau, r.id)).toEqual(['Texto ALPHA', 'Texto BRAVO', 'Texto CHARLIE']);

    await refaire.click();
    expect(await cartes(page)).toEqual(['Envoyer un texto | Texto ALPHA', 'Envoyer un texto | Texto CHARLIE']);
    await expect(refaire).toBeDisabled();
    await attendreEnregistre(page);
    expect(await corpsDuFil(bureau, r.id)).toEqual(['Texto ALPHA', 'Texto CHARLIE']);
  });

  test('[EDT-011] après « annuler », une nouvelle modification efface le « refaire »', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} futur`, troisTextos());
    await ouvrirEditeur(page, r.id);
    const annuler = barre(page).getByRole('button', { name: 'Annuler', exact: true });
    const refaire = barre(page).getByRole('button', { name: 'Refaire', exact: true });
    await menuDeCarte(page, 'Texto CHARLIE').click();
    await page.getByRole('button', { name: 'Supprimer l’action' }).click();
    await dialogue(page).getByRole('button', { name: 'Supprimer' }).click();
    await annuler.click();
    await expect(refaire).toBeEnabled();
    await menuDeCarte(page, 'Texto ALPHA').click();
    await page.getByRole('button', { name: 'Supprimer l’action' }).click();
    await dialogue(page).getByRole('button', { name: 'Supprimer' }).click();
    await expect(refaire).toBeDisabled();
    expect(await cartes(page)).toEqual(['Envoyer un texto | Texto BRAVO', 'Envoyer un texto | Texto CHARLIE']);
    await attendreEnregistre(page);
    expect(await corpsDuFil(bureau, r.id)).toEqual(['Texto BRAVO', 'Texto CHARLIE']);
  });

  test('[EDT-010] Ctrl+Z annule la dernière modification du parcours (S-42)', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} ctrlz`, troisTextos());
    await ouvrirEditeur(page, r.id);
    await menuDeCarte(page, 'Texto BRAVO').click();
    await page.getByRole('button', { name: 'Supprimer l’action' }).click();
    await dialogue(page).getByRole('button', { name: 'Supprimer' }).click();
    await expect(carte(page, 'Texto BRAVO')).toHaveCount(0);
    await page.locator('body').press('Control+z');
    await expect(carte(page, 'Texto BRAVO'), 'Ctrl+Z ne fait rien : seule la petite flèche de la barre annule').toBeVisible({ timeout: 4000 });
  });

  test('[EDT-010] annuler ne rattrape PAS un renommage : le bouton reste grisé après un simple changement de nom', async ({ page, bureau, marque }) => {
    // Documente la portée : la pile ne contient que le parcours (la carte le dit). On vérifie que l'écran est cohérent avec ça.
    const r = await creerParcours(bureau, `${marque} portée`, troisTextos());
    await ouvrirEditeur(page, r.id);
    await barre(page).getByRole('button', { name: `${marque} portée` }).click();
    await champNom(page).fill(`${marque} portée 2`);
    await page.keyboard.press('Enter');
    await expect(barre(page).getByRole('button', { name: 'Annuler', exact: true })).toBeDisabled();
    await attendreEnregistre(page);
    expect((await lireRegle(bureau, r.id))?.name).toBe(`${marque} portée 2`);
  });
});

test.describe('barre du haut — indicateur d’enregistrement', () => {
  test('[EDT-012] Modifié → Enregistrement… → Enregistré : « Enregistré » n’apparaît que quand la base a la modification', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} indicateur`, troisTextos());
    await ouvrirEditeur(page, r.id);
    await expect(indicateur(page)).toHaveText('Enregistré');
    // On retient la requête d'enregistrement pour observer l'état « en cours ».
    let liberer: () => void = () => undefined;
    const retenue = new Promise<void>((res) => { liberer = res; });
    await page.route(`**/api/automations/rules/${r.id}`, async (route) => {
      if (route.request().method() !== 'PATCH') return route.continue();
      await retenue;
      return route.continue();
    });
    await carte(page, 'Texto ALPHA').click();
    await panneauEtape(page).getByLabel(/Texte du message/).fill('Texto ALPHA v2');
    await panneauEtape(page).getByRole('button', { name: 'Enregistrer' }).click();
    await expect(indicateur(page)).toHaveText('Modifié');
    expect(await corpsDuFil(bureau, r.id)).toEqual(['Texto ALPHA', 'Texto BRAVO', 'Texto CHARLIE']);
    await expect(indicateur(page)).toHaveText('Enregistrement…', { timeout: 10_000 });
    // Pendant l'appel : la base n'a pas encore la modification, et l'écran ne prétend pas le contraire.
    expect(await corpsDuFil(bureau, r.id)).toEqual(['Texto ALPHA', 'Texto BRAVO', 'Texto CHARLIE']);
    liberer();
    await attendreEnregistre(page);
    expect(await corpsDuFil(bureau, r.id)).toEqual(['Texto ALPHA v2', 'Texto BRAVO', 'Texto CHARLIE']);
  });

  test('[EDT-012] une étape née incomplète : « 1 étape(s) à compléter », rien n’est écrit en base, le bandeau désigne l’étape', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} incomplet`, troisTextos());
    await ouvrirEditeur(page, r.id);
    await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
    await tiroirActions(page).getByRole('button', { name: /^Ajouter une étiquette/ }).click();
    await expect(indicateur(page)).toHaveText('1 étape(s) à compléter');
    await page.screenshot({ path: `${CAPTURES}/edt-012-incomplet.png` });
    // Le bandeau rouge nomme l'étape fautive (lien cliquable).
    await expect(page.getByRole('button', { name: /Ajouter une étiquette.*est vide/ })).toBeVisible();
    // Rien n'est parti en base tant que l'étape est incomplète — et l'écran ne dit pas « Enregistré ».
    await expect(indicateur(page)).not.toHaveText('Enregistré');
    const enBase = await lireRegle(bureau, r.id);
    expect((enBase?.steps ?? []).length).toBe(3);
    // Compléter l'étape relance l'enregistrement.
    await panneauEtape(page).getByLabel(/L’étiquette/).fill('vip');
    await panneauEtape(page).getByRole('button', { name: 'Enregistrer' }).click();
    await attendreEnregistre(page);
    const apres = await attendreRegle(bureau, r.id, (x) => (x.steps ?? []).length === 4);
    expect(JSON.stringify(apres.steps)).toContain('"etiquette":"vip"');
  });
});
