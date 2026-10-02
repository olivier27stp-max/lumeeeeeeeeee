/**
 * Éditeur — le tiroir de choix (« Déclencheurs » et « Actions »).
 *
 * Ce que ce fichier prouve :
 *  · il s'ouvre par les bons boutons, se ferme par la croix, sans rien écrire ;
 *  · la recherche filtre (sans accents ni casse) et dit quand rien ne correspond ;
 *  · choisir un déclencheur l'écrit en base et l'affiche ; un refus du serveur est expliqué et l'écran ne ment pas ;
 *  · choisir une action / une attente / une condition / un arrêt insère l'étape et ouvre son panneau ;
 *  · une action indisponible est grisée AVEC sa raison et ne fait rien.
 */
import { lireRegle } from '../_outils/banc';
import {
  test, expect, DELAI_TEST,
  CAPTURES, creerParcours, troisTextos, ouvrirEditeur, cartes, attendreRegle, panneauEtape, panneauDeclencheur,
  tiroirActions, tiroirDeclencheurs, toasts, indicateur, attendreEnregistre, filEnBase, carteDeclencheurVide,
  aucuneEcriture, enregistrerPanneau,
} from './_aides';

test.describe.configure({ timeout: DELAI_TEST });

/** Une règle enregistrée au canevas VIDE (comme un brouillon tout juste né). */
const vide = { steps: [], actions: [{ type: 'send_sms', config: { body: 'À compléter' } }] };

test.describe('tiroir « Déclencheurs »', () => {
  // La carte en pointillés ne s'appelle plus « Choisir le déclencheur » (#859, EDITEUR-03) : voir `carteDeclencheurVide`.
  test('[EDT-029][EDT-056][EDT-057] il s’ouvre depuis la carte du déclencheur (canevas vide), cherche sans accents, se ferme sans rien écrire', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} tiroir décl`, [], vide);
    await ouvrirEditeur(page, r.id);
    await carteDeclencheurVide(page, 'Devis envoyé').click();
    const tiroir = tiroirDeclencheurs(page);
    await expect(tiroir.getByRole('heading', { name: 'Déclencheurs' })).toBeVisible();
    await expect(tiroir.getByText('Ce qui met l’automatisation en route')).toBeVisible();
    for (const famille of ['Devis', 'Factures', 'Rendez-vous', 'Jobs', 'Clients et prospects', 'Pipeline de ventes']) {
      await expect(tiroir.getByRole('heading', { name: famille, exact: true })).toBeVisible();
    }
    await page.screenshot({ path: `${CAPTURES}/edt-058-tiroir-declencheurs.png` });
    const recherche = tiroir.getByRole('searchbox', { name: 'Rechercher dans Déclencheurs' });
    await recherche.fill('ETIQUETTE AJOUTEE');
    await expect(tiroir.getByRole('listitem')).toHaveCount(1);
    await expect(tiroir.getByRole('button', { name: /^Étiquette ajoutée/ })).toBeVisible();
    await recherche.fill('zzzz');
    await expect(tiroir.getByText('Rien ne correspond à cette recherche.')).toBeVisible();
    await expect(tiroir.getByRole('listitem')).toHaveCount(0);
    await recherche.fill('');
    await expect(tiroir.getByRole('button', { name: /^Devis envoyé/ })).toBeVisible();
    await tiroir.getByRole('button', { name: 'Fermer' }).click();
    await expect(tiroir).toHaveCount(0);
    await expect(indicateur(page)).toHaveText('Enregistré');
    expect((await lireRegle(bureau, r.id))?.updated_at).toBe(r.updated_at);
  });

  test('[EDT-058] choisir un déclencheur : la carte le montre, la base l’a, relu identique après rechargement', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} choisir décl`, [], vide);
    await ouvrirEditeur(page, r.id);
    await carteDeclencheurVide(page, 'Devis envoyé').click();
    await tiroirDeclencheurs(page).getByRole('button', { name: /^Facture envoyée/ }).click();
    await expect(tiroirDeclencheurs(page)).toHaveCount(0);
    // La carte nomme le nouveau déclencheur — et plus l'ancien.
    await expect(carteDeclencheurVide(page, 'Facture envoyée')).toBeVisible({ timeout: 60_000 });
    await expect(carteDeclencheurVide(page, 'Devis envoyé')).toHaveCount(0);
    await attendreRegle(bureau, r.id, (x) => x.trigger_event === 'invoice.sent', 60_000);
    await page.reload();
    await expect(carteDeclencheurVide(page, 'Facture envoyée')).toBeVisible({ timeout: 90_000 });
  });

  test('[EDT-058] rechoisir le MÊME déclencheur ferme le tiroir sans rien écrire', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} même décl`, [], vide);
    await ouvrirEditeur(page, r.id);
    await carteDeclencheurVide(page, 'Devis envoyé').click();
    await tiroirDeclencheurs(page).getByRole('button', { name: /^Devis envoyé/ }).click();
    await expect(tiroirDeclencheurs(page)).toHaveCount(0);
    await expect(toasts(page)).toHaveCount(0);
    expect((await lireRegle(bureau, r.id))?.updated_at).toBe(r.updated_at);
  });

  test('[EDT-058] sur un parcours garni, « Quand » → « Changer de déclencheur… » ouvre le tiroir ; le nouveau déclencheur s’affiche sur la carte', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} changer décl`, troisTextos());
    await ouvrirEditeur(page, r.id);
    await page.getByRole('button', { name: /^Quand\s*Devis envoyé/ }).click();
    await panneauDeclencheur(page).getByRole('button', { name: 'Changer de déclencheur…' }).click();
    await expect(panneauDeclencheur(page)).toHaveCount(0);
    await tiroirDeclencheurs(page).getByRole('button', { name: /^Devis accepté/ }).click();
    await expect(page.getByRole('button', { name: /^Quand\s*Devis accepté/ })).toBeVisible({ timeout: 60_000 });
    await attendreRegle(bureau, r.id, (x) => x.trigger_event === 'quote.approved', 60_000);
    // Le parcours n'a pas bougé.
    expect((await filEnBase(bureau, r.id)).length).toBe(3);
  });

  test('[EDT-058] changement de déclencheur refusé par le serveur (automatisation fournie) : message en français, la carte garde l’ancien', async ({ page, bureau, marque, moniteur }) => {
    const r = await creerParcours(bureau, `${marque} fournie`, troisTextos(), { is_preset: true });
    await ouvrirEditeur(page, r.id);
    moniteur.attendu(/400 PATCH .*\/api\/automations\/rules\//, 'le serveur refuse de changer le déclencheur d’une automatisation fournie');
    await page.getByRole('button', { name: /^Quand\s*Devis envoyé/ }).click();
    await panneauDeclencheur(page).getByRole('button', { name: 'Changer de déclencheur…' }).click();
    await tiroirDeclencheurs(page).getByRole('button', { name: /^Devis accepté/ }).click();
    await expect(toasts(page).filter({ hasText: 'Le déclencheur d\'une automatisation fournie ne se change pas. Dupliquez-la pour en faire une à vous.' })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('button', { name: /^Quand\s*Devis envoyé/ })).toBeVisible();
    expect((await lireRegle(bureau, r.id))?.trigger_event).toBe('quote.sent');
  });

  test('[EDT-057] à l’ouverture du tiroir, le curseur est dans la recherche (S-43)', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} focus tiroir`, [], vide);
    await ouvrirEditeur(page, r.id);
    await carteDeclencheurVide(page, 'Devis envoyé').click();
    await expect(tiroirDeclencheurs(page).getByRole('searchbox'), 'le tiroir s’ouvre sans y placer le curseur : il faut cliquer avant de pouvoir chercher').toBeFocused({ timeout: 3000 });
  });
});

test.describe('tiroir « Actions »', () => {
  test('[EDT-031][EDT-056][EDT-057] il s’ouvre depuis « Ajouter une première étape », range les actions par famille, cherche, se ferme', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} tiroir actions`, [], vide);
    await ouvrirEditeur(page, r.id);
    await page.getByRole('button', { name: 'Ajouter une première étape' }).click();
    const tiroir = tiroirActions(page);
    await expect(tiroir.getByText('Ce que l’automatisation fera')).toBeVisible();
    for (const famille of ['Communication', 'Client', 'Travail', 'Ventes', 'Argent', 'Technique', 'Parcours']) {
      await expect(tiroir.getByRole('heading', { name: famille, exact: true })).toBeVisible();
    }
    const recherche = tiroir.getByRole('searchbox', { name: 'Rechercher dans Actions' });
    await recherche.fill('etiquette');
    await expect(tiroir.getByRole('button', { name: /^Ajouter une étiquette/ })).toBeVisible();
    await expect(tiroir.getByRole('button', { name: /^Retirer une étiquette/ })).toBeVisible();
    await expect(tiroir.getByRole('button', { name: /^Envoyer un texto/ })).toHaveCount(0);
    await recherche.fill('introuvable-xyz');
    await expect(tiroir.getByText('Rien ne correspond à cette recherche.')).toBeVisible();
    await tiroir.getByRole('button', { name: 'Fermer' }).click();
    await expect(tiroir).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Ajouter une première étape' })).toBeVisible();
    expect((await lireRegle(bureau, r.id))?.updated_at).toBe(r.updated_at);
  });

  test('[EDT-063] action indisponible ou incompatible : grisée, la raison est écrite, cliquer ne fait rien', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} indisponibles`, [], vide);
    await ouvrirEditeur(page, r.id);
    await page.getByRole('button', { name: 'Ajouter une première étape' }).click();
    const tiroir = tiroirActions(page);
    const slack = tiroir.getByRole('button', { name: /^Envoyer dans Slack/ });
    await expect(slack).toBeDisabled();
    await expect(slack).toContainText('Bientôt : la connexion à votre Slack n’existe pas encore.');
    // « Devis envoyé » : une facture n'existe pas encore, un rendez-vous non plus.
    for (const nom of [/^Envoyer la facture/, /^Changer le statut du rendez-vous/, /^Modifier l’opportunité/]) {
      await expect(tiroir.getByRole('button', { name: nom })).toBeDisabled();
      await expect(tiroir.getByRole('button', { name: nom })).toContainText('Ne va pas avec ce déclencheur');
    }
    // Compatible avec un devis :
    await expect(tiroir.getByRole('button', { name: /^Envoyer le devis/ })).toBeEnabled();
    await expect(tiroir.getByRole('button', { name: /^Déplacer l’opportunité/ })).toBeEnabled();
    await page.screenshot({ path: `${CAPTURES}/edt-063-actions-grisees.png` });
    await slack.click({ force: true });
    await expect(panneauEtape(page)).toHaveCount(0);
    await expect(tiroir).toBeVisible();
    await expect(indicateur(page)).toHaveText('Enregistré');
  });

  test('[EDT-059] choisir une action : l’étape apparaît sur le canevas, son panneau s’ouvre, pré-remplie et enregistrable', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} choisir action`, [], vide);
    await ouvrirEditeur(page, r.id);
    await page.getByRole('button', { name: 'Ajouter une première étape' }).click();
    await tiroirActions(page).getByRole('button', { name: /^Envoyer un courriel/ }).click();
    await expect(tiroirActions(page)).toHaveCount(0);
    await expect(panneauEtape(page).getByRole('heading', { name: 'Envoyer un courriel' })).toBeVisible();
    await expect(panneauEtape(page).getByLabel(/^Objet/)).toHaveValue('Un message de [company_name]');
    expect((await cartes(page)).length).toBe(1);
    // Montrée sur le canevas, mais pas encore dans le parcours (3b739958) : rien ne part avant « Enregistrer » du panneau.
    await aucuneEcriture(page);
    await expect(indicateur(page)).toHaveText('Enregistré');
    expect((await lireRegle(bureau, r.id))?.updated_at).toBe(r.updated_at);
    await enregistrerPanneau(page);
    await attendreEnregistre(page);
    const fil = await filEnBase(bureau, r.id);
    expect(fil.length).toBe(1);
    expect((fil[0].action as { type: string; config: Record<string, string> }).type).toBe('send_email');
    expect((fil[0].action as { type: string; config: Record<string, string> }).config.subject).toBe('Un message de [company_name]');
  });

  test('[EDT-060][EDT-061][EDT-062] « Attendre », « Condition », « Arrêter ici » : chacune crée la bonne étape (écran + base)', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} logique`, [
      { id: 'e1', type: 'action', action: { type: 'send_sms', config: { body: 'Texto ALPHA' } }, suivant: null },
    ]);
    await ouvrirEditeur(page, r.id);
    const tiroir = tiroirActions(page);
    // L'attente va EN TÊTE : une attente en fin de parcours est refusée par le serveur (voir 12-enregistrement, S-04).
    await page.getByRole('button', { name: 'Ajouter une étape ici' }).nth(0).click();
    await expect(tiroir.getByRole('button', { name: /^Attendre/ })).toContainText('Met le parcours en pause avant la suite.');
    await expect(tiroir.getByRole('button', { name: /^Condition/ })).toContainText('Sépare le parcours en deux chemins.');
    await expect(tiroir.getByRole('button', { name: /^Arrêter ici/ })).toContainText('Le client sort du parcours.');
    /* Chaque étape est ENREGISTRÉE dans son panneau : depuis 3b739958 c'est ce clic qui la fait entrer dans le
       parcours (avant, le test refermait le panneau par « Annuler » et l'étape, déjà insérée, restait). */
    await tiroir.getByRole('button', { name: /^Attendre/ }).click();
    await expect(panneauEtape(page).getByRole('heading', { name: 'Attendre' })).toBeVisible();
    await enregistrerPanneau(page);

    await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
    await tiroir.getByRole('button', { name: /^Condition/ }).click();
    await expect(panneauEtape(page).getByLabel('Conditions')).toBeVisible();
    await enregistrerPanneau(page);

    // « Ajouter » vise la fin du chemin principal : sous « si oui ».
    await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
    await tiroir.getByRole('button', { name: /^Arrêter ici/ }).click();
    await expect(panneauEtape(page).getByText('Rien à configurer. Le client sort du parcours en arrivant ici.')).toBeVisible();
    await enregistrerPanneau(page);
    expect(await cartes(page)).toEqual(['Attendre | 1 jour(s)', 'Envoyer un texto | Texto ALPHA', 'Si… | 0 condition(s)', 'Arrêter ici']);
    await attendreEnregistre(page);
    const etapes = ((await lireRegle(bureau, r.id))?.steps ?? []) as Array<Record<string, unknown>>;
    expect(etapes.map((e) => e.type).sort()).toEqual(['action', 'arreter', 'attendre', 'si']);
    const si = etapes.find((e) => e.type === 'si') as Record<string, unknown>;
    expect(etapes.find((e) => e.id === si.alors)?.type).toBe('arreter');
  });
});
