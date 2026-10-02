/**
 * Éditeur — créer une automatisation À PARTIR DE ZÉRO (liste → Créer → « Partir de zéro »).
 *
 * Ce que ce fichier prouve, base à l'appui à chaque étape :
 *  · à quel moment la ligne naît en base (jamais à l'ouverture, une seule fois ensuite) ;
 *  · l'indicateur d'enregistrement ne dit « Enregistré » que quand la base a ce que l'écran montre
 *    (constat reçu de la session f1, point 2) ;
 *  · après rechargement, puis réouverture depuis la liste, le parcours affiché est celui de la base ;
 *  · un brouillon jamais enregistré dit clairement ce qu'il ne peut pas encore faire
 *    (onglets Réglages / Historique / Journaux, Aperçu, Publier).
 */
import type { Page } from '@playwright/test';
import { ouvrirListe, lireRegle, type Bureau, type LigneRegle } from '../_outils/banc';
import {
  test, expect, DELAI_TEST,
  CAPTURES, cartes, barre, indicateur, attendreEnregistre, corpsDuFil, filEnBase, panneauEtape, tiroirActions, tiroirDeclencheurs, toasts, dialogue,
  carteDeclencheurVide, carte, aucuneEcriture, enregistrerPanneau,
} from './_aides';

test.describe.configure({ timeout: DELAI_TEST });

/** Les règles nées dans le bureau A depuis `depuis` (ISO). */
async function neesDepuis(bureau: Bureau, depuis: string): Promise<LigneRegle[]> {
  const { data, error } = await bureau.admin.from('automation_rules').select('*').eq('org_id', bureau.orgA).gte('created_at', depuis).order('created_at');
  if (error) throw new Error(error.message);
  return (data ?? []) as LigneRegle[];
}

async function partirDeZero(page: Page): Promise<void> {
  await ouvrirListe(page);
  await page.getByRole('button', { name: 'Créer', exact: true }).click();
  await page.getByRole('menuitem', { name: /Partir de zéro/ }).click();
  await expect(page).toHaveURL(/\/automations\/nouvelle$/);
  await expect(page.getByRole('tablist', { name: 'Sections' })).toBeVisible({ timeout: 90_000 });
}

let debut = '';
test.beforeEach(() => { debut = new Date().toISOString(); });
// Un brouillon né sans avoir été renommé s'appelle « Nouvelle automatisation » : la marque ne le retrouve pas.
test.afterEach(async ({ bureau }) => {
  if (!debut) return;
  const restes = (await neesDepuis(bureau, debut)).filter((r) => r.name === 'Nouvelle automatisation');
  if (restes.length) await bureau.admin.from('automation_rules').delete().in('id', restes.map((r) => r.id));
});

test.describe('création à partir de zéro', () => {
  test('[EDT-029][EDT-031] ouvrir « Partir de zéro » ne crée RIEN en base ; repartir non plus', async ({ page, bureau }) => {
    await partirDeZero(page);
    await expect(barre(page).getByRole('button', { name: 'Nouvelle automatisation' })).toBeVisible();
    // La carte en pointillés nomme le déclencheur posé d'office et invite à en changer (#859, EDITEUR-03).
    await expect(carteDeclencheurVide(page, 'Devis envoyé')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Ajouter une première étape' })).toBeVisible();
    await expect(page.getByText('FIN', { exact: true })).toBeVisible();
    await expect(page.getByText('Brouillon', { exact: true })).toBeVisible();
    expect(await neesDepuis(bureau, debut)).toEqual([]);
    await barre(page).getByRole('button', { name: 'Mes automatisations' }).click();
    await expect(page).toHaveURL(/\/automations$/);
    await expect(dialogue(page)).toHaveCount(0);
    expect(await neesDepuis(bureau, debut), 'aucun brouillon orphelin après un aller-retour').toEqual([]);
  });

  test('[EDT-012] sur une automatisation jamais enregistrée, l’indicateur ne dit pas « Enregistré » (constat f1-2)', async ({ page, bureau }) => {
    await partirDeZero(page);
    expect(await neesDepuis(bureau, debut)).toEqual([]);
    await page.screenshot({ path: `${CAPTURES}/edt-012-nouvelle-enregistre.png` });
    // Depuis #859 : « Pas encore enregistrée » tant qu'aucune ligne n'existe en base.
    await expect(indicateur(page), 'l’écran affirme « Enregistré » alors qu’aucune ligne n’existe en base').toHaveText('Pas encore enregistrée', { timeout: 3000 });
    await expect(barre(page).getByText('Enregistré', { exact: true })).toHaveCount(0);
    expect(await neesDepuis(bureau, debut)).toEqual([]);
  });

  test('[EDT-029] la carte du déclencheur ne dit pas « Choisir » quand un déclencheur est déjà inscrit dessous (constat f1-2)', async ({ page }) => {
    await partirDeZero(page);
    // Depuis #859 : « Quand », le déclencheur en place, puis l'invitation à en changer.
    const carteDeclencheur = carteDeclencheurVide(page, 'Devis envoyé');
    await expect(carteDeclencheur).toBeVisible();
    await expect(carteDeclencheur).toContainText('Cliquer pour choisir un autre déclencheur');
    await expect(page.getByText(/Choisir le déclencheur/), '« Choisir le déclencheur » alors que « Devis envoyé » est déjà choisi : faut-il choisir ou non ?').toHaveCount(0, { timeout: 3000 });
    // L'invitation dit vrai : un clic ouvre le tiroir des déclencheurs.
    await carteDeclencheur.click();
    await expect(tiroirDeclencheurs(page)).toBeVisible();
  });

  test('[EDT-031][EDT-059][EDT-012] première étape : la ligne naît à ce moment-là, une seule fois, et « Enregistré » dit vrai', async ({ page, bureau, marque }) => {
    await partirDeZero(page);
    // Ouvrir le tiroir n'est pas une modification : toujours rien en base.
    await page.getByRole('button', { name: 'Ajouter une première étape' }).click();
    await expect(tiroirActions(page)).toBeVisible();
    expect(await neesDepuis(bureau, debut)).toEqual([]);

    await tiroirActions(page).getByRole('button', { name: /^Envoyer un texto/ }).click();
    await expect(panneauEtape(page)).toBeVisible();
    /* Choisir une étape dans le tiroir n'est pas non plus une modification (3b739958, triage actions ligne 1) :
       elle n'entre dans le parcours qu'à « Enregistrer » de son panneau. Tant que ce n'est pas fait, rien ne
       part au serveur, l'adresse reste /nouvelle et l'indicateur dit toujours « Pas encore enregistrée ». */
    await aucuneEcriture(page);
    await expect(page).toHaveURL(/\/automations\/nouvelle$/);
    await expect(indicateur(page)).toHaveText('Pas encore enregistrée');
    expect(await neesDepuis(bureau, debut)).toEqual([]);

    // « Enregistrer » du panneau : c'est LÀ que l'étape entre dans le parcours, et que la ligne naît.
    await enregistrerPanneau(page);
    await expect(indicateur(page)).toHaveText(/Modifié|Enregistrement…|Enregistré/);
    // La naissance : l'adresse passe de /nouvelle à l'identifiant réel, sans rechargement.
    await expect(page).toHaveURL(/\/automations\/[0-9a-f]{8}-[0-9a-f-]{27}$/, { timeout: 120_000 });
    const id = page.url().split('/').pop() as string;
    await attendreEnregistre(page);
    let nees = await neesDepuis(bureau, debut);
    expect(nees.map((r) => r.id)).toEqual([id]);
    expect(nees[0].name).toBe('Nouvelle automatisation');
    expect(nees[0].is_active).toBe(false);
    expect(nees[0].trigger_event).toBe('quote.sent');
    expect(await corpsDuFil(bureau, id)).toEqual(['Bonjour [client_name], c’est [company_name]. Merci !']);

    // Modifier le texte de l'étape puis renommer : toujours la MÊME ligne.
    await carte(page, 'Bonjour [client_name]').click();
    await panneauEtape(page).getByLabel(/Texte du message/).fill('Merci pour votre confiance, [client_name].');
    await panneauEtape(page).getByRole('button', { name: 'Enregistrer' }).click();
    await expect(indicateur(page)).toHaveText('Modifié');
    await attendreEnregistre(page);
    expect(await corpsDuFil(bureau, id)).toEqual(['Merci pour votre confiance, [client_name].']);
    await barre(page).getByRole('button', { name: 'Nouvelle automatisation' }).click();
    await page.getByLabel('Nom de l’automatisation').fill(`${marque} née de zéro`);
    await page.keyboard.press('Enter');
    await attendreEnregistre(page);
    nees = await neesDepuis(bureau, debut);
    expect(nees.map((r) => [r.id, r.name])).toEqual([[id, `${marque} née de zéro`]]);
  });

  test('[EDT-037][EDT-032] relecture : après rechargement puis réouverture depuis la liste, l’écran = la base, carte par carte', async ({ page, bureau, marque }) => {
    await partirDeZero(page);
    // Trois étapes : texto, attente de 1 jour, courriel.
    await page.getByRole('button', { name: 'Ajouter une première étape' }).click();
    await tiroirActions(page).getByRole('button', { name: /^Envoyer un texto/ }).click();
    await panneauEtape(page).getByLabel(/Texte du message/).fill('Premier texto');
    await panneauEtape(page).getByRole('button', { name: 'Enregistrer' }).click();
    await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
    await tiroirActions(page).getByRole('button', { name: /^Envoyer un courriel/ }).click();
    await panneauEtape(page).getByLabel(/^Objet/).fill('Objet du courriel');
    await panneauEtape(page).getByRole('button', { name: 'Enregistrer' }).click();
    // L'attente s'insère ENTRE les deux (une attente en fin de parcours est refusée par le serveur : voir 12-enregistrement).
    await page.getByRole('button', { name: 'Ajouter une étape ici' }).nth(1).click();
    await tiroirActions(page).getByRole('button', { name: /^Attendre/ }).click();
    await panneauEtape(page).getByRole('button', { name: 'Enregistrer' }).click();
    await barre(page).getByRole('button', { name: 'Nouvelle automatisation' }).click();
    await page.getByLabel('Nom de l’automatisation').fill(`${marque} relecture`);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/automations\/[0-9a-f]{8}-/, { timeout: 120_000 });
    await attendreEnregistre(page);
    const id = page.url().split('/').pop() as string;
    const avant = await cartes(page);
    expect(avant.length).toBe(3);
    expect(avant[0]).toBe('Envoyer un texto | Premier texto');
    expect(avant[1]).toBe('Attendre | 1 jour(s)');
    expect(avant[2]).toMatch(/^Envoyer un courriel \| /);

    // La base : le même fil, dans le même ordre.
    const base = await lireRegle(bureau, id);
    const etapes = (base?.steps ?? []) as Array<Record<string, unknown>>;
    const fil = await filEnBase(bureau, id);
    expect(etapes.length).toBe(3);
    expect(fil.map((e) => e.type)).toEqual(['action', 'attendre', 'action']);
    expect(fil[2].suivant ?? null).toBeNull();
    expect(fil[1].delai_secondes).toBe(86400);
    expect((fil[0].action as { type: string; config: Record<string, string> }).config.body).toBe('Premier texto');
    expect((fil[2].action as { type: string; config: Record<string, string> }).config.subject).toBe('Objet du courriel');

    await page.reload();
    await expect(page.getByRole('tablist', { name: 'Sections' })).toBeVisible({ timeout: 90_000 });
    await expect(barre(page).getByRole('button', { name: `${marque} relecture` })).toBeVisible();
    expect(await cartes(page)).toEqual(avant);
    await expect(indicateur(page)).toHaveText('Enregistré');

    await barre(page).getByRole('button', { name: 'Mes automatisations' }).click();
    await expect(page.getByRole('heading', { name: 'Mes automatisations' })).toBeVisible({ timeout: 60_000 });
    await page.getByText(`${marque} relecture`).first().click();
    await expect(page).toHaveURL(new RegExp(`/automations/${id}$`), { timeout: 120_000 });
    await expect(page.getByRole('tablist', { name: 'Sections' })).toBeVisible({ timeout: 90_000 });
    expect(await cartes(page)).toEqual(avant);
    await expect(page.getByRole('button', { name: /^Quand\s*Devis envoyé/ })).toBeVisible();
    // Rien n'a été réécrit par la simple relecture.
    expect((await lireRegle(bureau, id))?.updated_at).toBe(base?.updated_at);
  });

  test('[EDT-006] renommer une automatisation jamais enregistrée la crée : une seule ligne, parcours vide, brouillon', async ({ page, bureau, marque }) => {
    await partirDeZero(page);
    await barre(page).getByRole('button', { name: 'Nouvelle automatisation' }).click();
    await page.getByLabel('Nom de l’automatisation').fill(`${marque} nom seul`);
    await page.keyboard.press('Enter');
    await expect(indicateur(page)).toHaveText('Modifié');
    expect(await neesDepuis(bureau, debut), 'pendant « Modifié », rien n’est encore en base').toEqual([]);
    await expect(page).toHaveURL(/\/automations\/[0-9a-f]{8}-/, { timeout: 120_000 });
    await attendreEnregistre(page);
    const nees = await neesDepuis(bureau, debut);
    expect(nees.length).toBe(1);
    expect(nees[0].name).toBe(`${marque} nom seul`);
    expect(nees[0].is_active).toBe(false);
    expect(nees[0].steps ?? []).toEqual([]);
    // L'écran reste un canevas vide.
    await expect(page.getByRole('button', { name: 'Ajouter une première étape' })).toBeVisible();
    // Rechargé : même écran vide, même nom.
    await page.reload();
    await expect(barre(page).getByRole('button', { name: `${marque} nom seul` })).toBeVisible({ timeout: 90_000 });
    await expect(page.getByRole('button', { name: 'Ajouter une première étape' })).toBeVisible();
    await page.screenshot({ path: `${CAPTURES}/edt-nouvelle-nom-seul-rechargee.png` });
  });

  test('[EDT-014][EDT-015][EDT-016] onglets Réglages / Historique / Journaux d’un brouillon jamais enregistré : message clair, pas d’erreur', async ({ page, bureau }) => {
    await partirDeZero(page);
    for (const onglet of ['Réglages', 'Historique', 'Journaux']) {
      await page.getByRole('tab', { name: onglet }).click();
      await expect(page.getByRole('tab', { name: onglet })).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByText('Cette automatisation n’est pas encore enregistrée : ajoutez une première étape.')).toBeVisible();
    }
    await page.getByRole('tab', { name: 'Parcours' }).click();
    await expect(page.getByRole('button', { name: 'Ajouter une première étape' })).toBeVisible();
    expect(await neesDepuis(bureau, debut)).toEqual([]);
  });

  test('[EDT-017] « Aperçu » sur un brouillon jamais enregistré : message d’information, rien en base', async ({ page, bureau }) => {
    await partirDeZero(page);
    await page.getByRole('button', { name: 'Aperçu', exact: true }).click();
    await expect(toasts(page).filter({ hasText: 'Ajoutez une première étape : il n’y a encore rien à prévisualiser.' })).toBeVisible();
    expect(await neesDepuis(bureau, debut)).toEqual([]);
  });

  test('[EDT-018] « Publier » un brouillon vide : refus expliqué, interrupteur inchangé, rien en base', async ({ page, bureau }) => {
    await partirDeZero(page);
    await page.getByRole('switch', { name: 'Publier l’automatisation' }).click();
    await expect(toasts(page).filter({ hasText: 'Ajoutez au moins une étape : pour l’instant, cette automatisation ne fait rien.' })).toBeVisible();
    await expect(dialogue(page)).toHaveCount(0);
    await expect(page.getByRole('switch', { name: 'Publier l’automatisation' })).toHaveAttribute('aria-checked', 'false');
    expect(await neesDepuis(bureau, debut)).toEqual([]);
  });

  test('[EDT-012] deux modifications coup sur coup sur une nouvelle automatisation : UNE seule ligne en base', async ({ page, bureau, marque }) => {
    await partirDeZero(page);
    await barre(page).getByRole('button', { name: 'Nouvelle automatisation' }).click();
    await page.getByLabel('Nom de l’automatisation').fill(`${marque} doublon`);
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Ajouter une première étape' }).click();
    await tiroirActions(page).getByRole('button', { name: /^Envoyer un texto/ }).click();
    await panneauEtape(page).getByRole('button', { name: 'Enregistrer' }).click();
    await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
    await tiroirActions(page).getByRole('button', { name: /^Créer une tâche/ }).click();
    await panneauEtape(page).getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page).toHaveURL(/\/automations\/[0-9a-f]{8}-/, { timeout: 120_000 });
    await attendreEnregistre(page);
    const nees = await neesDepuis(bureau, debut);
    expect(nees.map((r) => r.name)).toEqual([`${marque} doublon`]);
    expect(await corpsDuFil(bureau, nees[0].id)).toEqual(['Bonjour [client_name], c’est [company_name]. Merci !', 'Rappeler [client_name]']);
    expect(await cartes(page)).toEqual([
      'Envoyer un texto | Bonjour [client_name], c’est [company_name]. Merci !',
      'Créer une tâche | Rappeler [client_name]',
    ]);
  });
});
