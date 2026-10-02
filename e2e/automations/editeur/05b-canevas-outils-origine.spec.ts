/**
 * Éditeur — le canevas : outils (main, zoom, recadrage), canevas vide, bandeau des problèmes,
 * et parcours au FORMAT D'ORIGINE (lecture seule, conversion).
 *
 * Ce que ce fichier prouve :
 *  · la main déplace le canevas, le zoom va de 40 % à 160 % par pas de 10, « Recadrer » remet 100 % ;
 *  · le canevas vide offre ses trois boutons et chacun ouvre le bon panneau ;
 *  · le bandeau rouge liste ce qui empêche de publier et ouvre l'étape fautive ;
 *  · un parcours au format d'origine s'affiche tel qu'il tourne, sans bouton d'édition, et se convertit
 *    (bouton, clic sur une carte, confirmation si publiée) — ou dit pourquoi il ne se convertit pas.
 */
import type { Page } from '@playwright/test';
import { creerRegle, lireRegle } from '../_outils/banc';
import {
  test, expect, DELAI_TEST,
  CAPTURES, creerParcours, troisTextos, texto, ouvrirEditeur, cartes, carte, attendreRegle, dialogue,
  panneauEtape, panneauDeclencheur, tiroirActions, tiroirDeclencheurs, toasts, indicateur,
  carteDeclencheurVide, titreBandeau, TOUT_BANDEAU,
} from './_aides';

test.describe.configure({ timeout: DELAI_TEST });

const plan = (page: Page) => page.locator('div.min-h-full.py-10');
const transformation = (page: Page) => plan(page).evaluate((el) => (el as HTMLElement).style.transform);
const zoomAffiche = (page: Page) => page.getByText(/^\d+%$/);

test.describe('canevas — main, zoom, recadrage', () => {
  test('[EDT-049][EDT-050][EDT-051][EDT-052] zoom : +10 % par clic jusqu’à 160 %, −10 % jusqu’à 40 %, « Recadrer » revient à 100 %', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} zoom`, troisTextos());
    await ouvrirEditeur(page, r.id);
    await expect(zoomAffiche(page)).toHaveText('100%');
    const largeur = async () => (await carte(page, 'Texto ALPHA').boundingBox())!.width;
    const base = await largeur();
    await page.getByRole('button', { name: 'Agrandir', exact: true }).click();
    await expect(zoomAffiche(page)).toHaveText('110%');
    expect(Math.round(await largeur())).toBe(Math.round(base * 1.1));
    for (let i = 0; i < 8; i++) await page.getByRole('button', { name: 'Agrandir', exact: true }).click();
    await expect(zoomAffiche(page)).toHaveText('160%');
    for (let i = 0; i < 15; i++) await page.getByRole('button', { name: 'Réduire', exact: true }).click();
    await expect(zoomAffiche(page)).toHaveText('40%');
    expect(Math.round(await largeur())).toBe(Math.round(base * 0.4));
    // À 40 %, une carte reste cliquable et ouvre son panneau.
    await carte(page, 'Texto BRAVO').click();
    await expect(panneauEtape(page).getByLabel(/Texte du message/)).toHaveValue('Texto BRAVO');
    await panneauEtape(page).getByRole('button', { name: 'Fermer le panneau' }).click();
    await page.getByRole('button', { name: 'Recadrer', exact: true }).click();
    await expect(zoomAffiche(page)).toHaveText('100%');
    expect(await transformation(page)).toBe('translate(0px, 0px) scale(1)');
    // Le zoom est un réglage d'affichage : rien n'est écrit.
    await expect(indicateur(page)).toHaveText('Enregistré');
    expect((await lireRegle(bureau, r.id))?.updated_at).toBe(r.updated_at);
  });

  test('[EDT-048][EDT-021][EDT-052] la main : activée, un glisser déplace le canevas ; désactivée, il ne bouge pas ; « Recadrer » le ramène', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} main`, troisTextos());
    await ouvrirEditeur(page, r.id);
    const main = page.getByRole('button', { name: 'Déplacer le canevas' });
    await expect(main).toHaveAttribute('aria-pressed', 'false');
    const glisser = async () => {
      await page.mouse.move(250, 500);
      await page.mouse.down();
      await page.mouse.move(330, 560, { steps: 5 });
      await page.mouse.up();
    };
    await glisser();
    expect(await transformation(page)).toBe('translate(0px, 0px) scale(1)');
    await main.click();
    await expect(main).toHaveAttribute('aria-pressed', 'true');
    await glisser();
    expect(await transformation(page)).toBe('translate(80px, 60px) scale(1)');
    await page.getByRole('button', { name: 'Recadrer', exact: true }).click();
    expect(await transformation(page)).toBe('translate(0px, 0px) scale(1)');
    await main.click();
    await expect(main).toHaveAttribute('aria-pressed', 'false');
  });

  test('[EDT-021] avec la main active, glisser en partant d’une carte déplace le canevas SANS ouvrir la carte (S-45) @defaut', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} main carte`, troisTextos());
    await ouvrirEditeur(page, r.id);
    await page.getByRole('button', { name: 'Déplacer le canevas' }).click();
    const b = (await carte(page, 'Texto BRAVO').boundingBox())!;
    await page.mouse.move(b.x + 60, b.y + 20);
    await page.mouse.down();
    await page.mouse.move(b.x + 100, b.y + 40, { steps: 5 });
    await page.mouse.up();
    expect(await transformation(page)).toBe('translate(40px, 20px) scale(1)');
    await expect(panneauEtape(page), 'le glisser a déplacé le canevas ET ouvert le panneau de la carte').toHaveCount(0, { timeout: 2000 });
  });

  test('[EDT-052] « Recadrer » ramène le parcours à l’écran quand on l’a perdu de vue', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} recadrer`, troisTextos());
    await ouvrirEditeur(page, r.id);
    await page.getByRole('button', { name: 'Déplacer le canevas' }).click();
    for (let i = 0; i < 3; i++) {
      await page.mouse.move(300, 300);
      await page.mouse.down();
      await page.mouse.move(300, 850, { steps: 4 });
      await page.mouse.up();
    }
    await expect(carte(page, 'Texto ALPHA')).not.toBeInViewport();
    await page.getByRole('button', { name: 'Recadrer', exact: true }).click();
    await expect(carte(page, 'Texto ALPHA')).toBeInViewport();
  });
});

test.describe('canevas vide (règle enregistrée sans étape)', () => {
  const vide = { steps: [], actions: [{ type: 'send_sms', config: { body: 'À compléter' } }] };

  test('[EDT-029][EDT-030][EDT-031][EDT-043] les boutons du canevas vide ouvrent chacun le bon panneau', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} vide`, [], vide);
    await ouvrirEditeur(page, r.id);
    /* Depuis #859, un canevas vide et NON publié n'accueille plus son auteur par l'alerte rouge
       « 1 chose à corriger — ajoutez au moins une étape » (AutomationBuilderPage.tsx : le bandeau
       exige `regle.is_active || etapesAffichees.length > 0`). Le canevas le dit (« Ajouter une première
       étape »), et « Publier » le rappelle si on essaie — vérifié juste dessous. */
    await expect(page.getByRole('button', { name: 'Ajouter une première étape' })).toBeVisible();
    await expect(page.getByText(TOUT_BANDEAU)).toHaveCount(0);
    await expect(page.getByText('Ajoutez au moins une étape : pour l’instant, cette automatisation ne fait rien.')).toHaveCount(0);
    await page.getByRole('switch', { name: 'Publier l’automatisation' }).click();
    await expect(toasts(page).filter({ hasText: 'Ajoutez au moins une étape : pour l’instant, cette automatisation ne fait rien.' })).toBeVisible();
    await expect(dialogue(page)).toHaveCount(0);
    await expect(page.getByRole('switch', { name: 'Publier l’automatisation' })).toHaveAttribute('aria-checked', 'false');
    expect((await lireRegle(bureau, r.id))?.is_active).toBe(false);

    await expect(page.getByText('ou', { exact: true })).toBeVisible();
    await expect(page.getByText('FIN', { exact: true })).toBeVisible();
    // L'action provisoire « À compléter » n'est jamais montrée comme une étape.
    await expect(page.getByText('À compléter')).toHaveCount(0);

    // La carte du déclencheur (depuis #859 : « Quand », le déclencheur en place, l'invitation à en changer).
    await expect(page.getByText(/Choisir le déclencheur/)).toHaveCount(0);
    await carteDeclencheurVide(page, 'Devis envoyé').click();
    await expect(tiroirDeclencheurs(page)).toBeVisible();
    await tiroirDeclencheurs(page).getByRole('button', { name: 'Fermer' }).click();

    await page.getByRole('button', { name: 'Régler le déclencheur' }).click();
    await expect(panneauDeclencheur(page)).toBeVisible();
    await panneauDeclencheur(page).getByRole('button', { name: 'Annuler' }).click();

    await page.getByRole('button', { name: 'Ajouter une première étape' }).click();
    await expect(tiroirActions(page)).toBeVisible();
    await tiroirActions(page).getByRole('button', { name: 'Fermer' }).click();

    await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
    await expect(tiroirActions(page)).toBeVisible();
    await tiroirActions(page).getByRole('button', { name: /^Envoyer un texto/ }).click();
    await panneauEtape(page).getByRole('button', { name: 'Enregistrer' }).click();
    expect((await cartes(page)).length).toBe(1);
    // Une étape complète : toujours aucun bandeau (ni l'ancien libellé « chose(s) », ni le nouveau).
    await expect(page.getByText(TOUT_BANDEAU)).toHaveCount(0);
    await attendreRegle(bureau, r.id, (x) => (x.steps ?? []).length === 1, 90_000);
  });
});

test.describe('bandeau des problèmes', () => {
  test('[EDT-022] brouillon : le bandeau liste chaque problème ; cliquer un problème ouvre l’étape fautive', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} bandeau`, [
      texto('e1', 'Texto ALPHA', 'e2'),
      { id: 'e2', type: 'action', action: { type: 'ajouter_etiquette', config: {} }, suivant: 'e3' },
      { id: 'e3', type: 'action', action: { type: 'webhook', config: {} }, suivant: null },
    ]);
    await ouvrirEditeur(page, r.id);
    await expect(page.getByText(titreBandeau(2), { exact: true })).toBeVisible();
    await page.screenshot({ path: `${CAPTURES}/edt-022-bandeau.png` });
    const lienEtiquette = page.getByRole('button', { name: /Ajouter une étiquette.*L’étiquette.*est vide/ });
    const lienWebhook = page.getByRole('button', { name: /Appeler un webhook.*L’adresse.*est vide/ });
    await expect(lienEtiquette).toBeVisible();
    await expect(lienWebhook).toBeVisible();
    await lienWebhook.click();
    await expect(panneauEtape(page).getByRole('heading', { name: 'Appeler un webhook' })).toBeVisible();
    await panneauEtape(page).getByRole('button', { name: 'Fermer le panneau' }).click();
    await lienEtiquette.click();
    await expect(panneauEtape(page).getByRole('heading', { name: 'Ajouter une étiquette' })).toBeVisible();
    // Corriger l'étape retire SON problème du bandeau.
    await panneauEtape(page).getByLabel(/L’étiquette/).fill('vip');
    await panneauEtape(page).getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByText(titreBandeau(1), { exact: true })).toBeVisible();
    await expect(lienEtiquette).toHaveCount(0);
  });

  test('[EDT-022] publiée et cassée : le bandeau le dit sans détour', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} publiée cassée`, [
      texto('e1', 'Texto ALPHA', 'e2'),
      { id: 'e2', type: 'action', action: { type: 'ajouter_etiquette', config: {} }, suivant: null },
    ], { is_active: true });
    await ouvrirEditeur(page, r.id);
    await expect(page.getByText(titreBandeau(1, true), { exact: true })).toBeVisible();
    // Jamais « avant de publier » sur une automatisation qui l'est déjà.
    await expect(page.getByText(/à corriger avant de publier/)).toHaveCount(0);
    await expect(page.getByText('Publiée', { exact: true })).toBeVisible();
    await page.screenshot({ path: `${CAPTURES}/edt-022-publiee-cassee.png` });
  });
});

test.describe('carte « Quand »', () => {
  test('[EDT-032] la carte « Quand » nomme TOUJOURS le déclencheur en clair, jamais sa clé technique (S-37)', async ({ page, bureau, marque }) => {
    // « Paiement échoué » est réservé aux entreprises qui ont la capacité : sans elle, que montre la carte d'une règle qui le porte ?
    const r = await creerParcours(bureau, `${marque} clé brute`, troisTextos(), { trigger_event: 'payment.failed' });
    await ouvrirEditeur(page, r.id);
    await page.screenshot({ path: `${CAPTURES}/edt-s37-cle-brute.png` });
    const quand = page.getByRole('button', { name: /^Quand/ });
    await expect(quand).toBeVisible();
    await expect(quand, 'la carte affiche la clé technique « payment.failed »').not.toContainText('payment.failed', { timeout: 3000 });
  });
});

test.describe('parcours au format d’origine', () => {
  const origine = (actions: Array<{ type: string; config: Record<string, unknown> }>) => ({ steps: null, actions, delay_seconds: 3600 });
  const deuxActions = [
    { type: 'send_sms', config: { body: 'Texto d’origine' } },
    { type: 'create_task', config: { title: 'Tâche d’origine' } },
  ];

  test('[EDT-028][EDT-032] brouillon au format d’origine : affiché tel qu’il tourne, sans « + », « ··· » ni « Ajouter » ; « Convertir » le rend modifiable', async ({ page, bureau, marque }) => {
    const r = await creerRegle(bureau, bureau.orgA, { name: `${marque} origine`, trigger_event: 'quote.sent', ...origine(deuxActions) });
    await ouvrirEditeur(page, r.id);
    await expect(page.getByText('Parcours au format d’origine')).toBeVisible();
    await expect(page.getByText('Cette automatisation fonctionne normalement. Cliquez sur une étape pour la modifier : le parcours sera converti, les envois ne changent pas.')).toBeVisible();
    await page.screenshot({ path: `${CAPTURES}/edt-028-format-origine.png` });
    const avant = await cartes(page);
    expect(avant).toEqual(['Attendre | 1 heure(s)', 'Envoyer un texto | Texto d’origine', 'Créer une tâche | Tâche d’origine']);
    await expect(page.getByRole('button', { name: 'Ajouter une étape ici' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Options de l’étape/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Ajouter', exact: true })).toHaveCount(0);
    // La carte « Quand » reste réglable.
    await page.getByRole('button', { name: /^Quand\s*Devis envoyé/ }).click();
    await expect(panneauDeclencheur(page)).toBeVisible();
    await panneauDeclencheur(page).getByRole('button', { name: 'Annuler' }).click();

    await page.getByRole('button', { name: 'Convertir en parcours modifiable' }).click();
    await expect(toasts(page).filter({ hasText: 'Parcours converti — il est modifiable' })).toBeVisible({ timeout: 60_000 });
    await expect(dialogue(page)).toHaveCount(0);
    await expect(page.getByText('Parcours au format d’origine')).toHaveCount(0);
    expect(await cartes(page)).toEqual(avant);
    await expect(page.getByRole('button', { name: 'Ajouter', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Options de l’étape/ })).toHaveCount(3);
    const base = await attendreRegle(bureau, r.id, (x) => (x.steps ?? []).length === 3, 60_000);
    expect((base.steps ?? []).map((e) => e.type)).toEqual(['attendre', 'action', 'action']);
    expect(base.is_active).toBe(false);
  });

  test('[EDT-041] brouillon au format d’origine : cliquer une carte convertit sans question et ouvre CETTE étape', async ({ page, bureau, marque }) => {
    const r = await creerRegle(bureau, bureau.orgA, { name: `${marque} origine clic`, trigger_event: 'quote.sent', ...origine(deuxActions) });
    await ouvrirEditeur(page, r.id);
    await carte(page, 'Tâche d’origine').click();
    await expect(toasts(page).filter({ hasText: 'Parcours converti — il est modifiable' })).toBeVisible({ timeout: 60_000 });
    await expect(panneauEtape(page).getByRole('heading', { name: 'Créer une tâche' })).toBeVisible();
    await expect(panneauEtape(page).getByLabel(/Titre de la tâche/)).toHaveValue('Tâche d’origine');
    await attendreRegle(bureau, r.id, (x) => (x.steps ?? []).length === 3, 60_000);
  });

  test('[EDT-028][EDT-162] publiée au format d’origine : la conversion demande confirmation ; « Annuler » ne change rien, « Convertir » garde la publication', async ({ page, bureau, marque }) => {
    const r = await creerRegle(bureau, bureau.orgA, { name: `${marque} origine publiée`, trigger_event: 'quote.sent', is_active: true, ...origine(deuxActions) });
    await ouvrirEditeur(page, r.id);
    await page.getByRole('button', { name: 'Convertir en parcours modifiable' }).click();
    await expect(dialogue(page).getByRole('heading', { name: 'Convertir ce parcours ?' })).toBeVisible();
    await expect(dialogue(page)).toContainText('Les 3 étapes affichées deviendront modifiables dans le canevas. L\'automatisation continue de fonctionner pendant et après : les envois ne changent pas.');
    await dialogue(page).getByRole('button', { name: 'Annuler' }).click();
    await expect(page.getByText('Parcours au format d’origine')).toBeVisible();
    expect((await lireRegle(bureau, r.id))?.steps ?? null).toBeNull();

    await page.getByRole('button', { name: 'Convertir en parcours modifiable' }).click();
    await dialogue(page).getByRole('button', { name: 'Convertir' }).click();
    await expect(toasts(page).filter({ hasText: 'Parcours converti — il est modifiable' })).toBeVisible({ timeout: 60_000 });
    const base = await attendreRegle(bureau, r.id, (x) => (x.steps ?? []).length === 3, 60_000);
    expect(base.is_active).toBe(true);
    await expect(page.getByText('Publiée', { exact: true })).toBeVisible();
  });

  test('[EDT-041] format d’origine NON convertible (étape technique) : c’est dit, pas de bouton, le clic sur une carte l’explique', async ({ page, bureau, marque }) => {
    const r = await creerRegle(bureau, bureau.orgA, {
      name: `${marque} origine figée`, trigger_event: 'quote.sent',
      ...origine([{ type: 'send_sms', config: { body: 'Texto d’origine' } }, { type: 'update_status', config: { status: 'contacted' } }]),
    });
    await ouvrirEditeur(page, r.id);
    await expect(page.getByText('Parcours au format d’origine')).toBeVisible();
    await expect(page.getByText('Ce parcours contient une étape technique qui ne se convertit pas : il reste en lecture seule pour ne rien perdre.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Convertir en parcours modifiable' })).toHaveCount(0);
    await page.screenshot({ path: `${CAPTURES}/edt-041-origine-non-convertible.png` });
    await carte(page, 'Texto d’origine').click();
    await expect(toasts(page).filter({ hasText: 'Ce parcours contient une étape d’un ancien format qui ne se convertit pas : il reste en lecture seule.' })).toBeVisible();
    await expect(panneauEtape(page)).toHaveCount(0);
    expect((await lireRegle(bureau, r.id))?.updated_at).toBe(r.updated_at);
  });

  test('[EDT-041] le bandeau d’un parcours non convertible ne dit pas « Cliquez sur une étape pour la modifier » @defaut', async ({ page, bureau, marque }) => {
    const r = await creerRegle(bureau, bureau.orgA, {
      name: `${marque} origine contradiction`, trigger_event: 'quote.sent',
      ...origine([{ type: 'send_sms', config: { body: 'Texto d’origine' } }, { type: 'update_status', config: { status: 'contacted' } }]),
    });
    await ouvrirEditeur(page, r.id);
    await expect(page.getByText('Ce parcours contient une étape technique qui ne se convertit pas')).toBeVisible();
    await expect(page.getByText(/Cliquez sur une étape pour la modifier/),
      'le même bandeau invite à cliquer une étape pour la modifier ET dit que le parcours reste en lecture seule').toHaveCount(0, { timeout: 2000 });
  });

  /*
   * AJOUTÉ au tri du 2026-10-01 (défaut trouvé en instruisant 12-enregistrement « casser une automatisation
   * PUBLIÉE ») : « Convertir » n'écrit que `steps` — `actions` garde l'ancien message. Dès que `steps`
   * redevient vide, l'éditeur ET le serveur relisent la règle comme « au format d'origine » : l'étape qu'on
   * vient de supprimer est de retour, en lecture seule, et (règle publiée) continue de partir aux clients.
   * CORRIGÉ par 4e29c110 (revérifié le 2026-10-02 : vert, marqueur retiré).
   */
  test('[EDT-047][EDT-028] parcours converti du format d’origine : supprimer la dernière étape la retire vraiment (elle ne revient pas en « format d’origine »)', async ({ page, bureau, marque }) => {
    const r = await creerRegle(bureau, bureau.orgA, {
      name: `${marque} convertie vidée`, trigger_event: 'quote.sent',
      steps: null, delay_seconds: 0, actions: [{ type: 'send_sms', config: { body: 'Texto d’origine' } }],
    });
    await ouvrirEditeur(page, r.id);
    await page.getByRole('button', { name: 'Convertir en parcours modifiable' }).click();
    await expect(toasts(page).filter({ hasText: 'Parcours converti — il est modifiable' })).toBeVisible({ timeout: 60_000 });
    expect(await cartes(page)).toEqual(['Envoyer un texto | Texto d’origine']);
    await attendreRegle(bureau, r.id, (x) => (x.steps ?? []).length === 1, 60_000);

    await page.getByRole('button', { name: /^Options de l’étape/ }).click();
    await page.getByRole('button', { name: 'Supprimer l’action', exact: true }).click();
    await expect(dialogue(page).getByRole('heading', { name: 'Supprimer cette étape ?' })).toBeVisible();
    await dialogue(page).getByRole('button', { name: 'Supprimer' }).click();
    await expect(dialogue(page)).toHaveCount(0);
    // La suppression est enregistrée (la base n'a plus d'étape)…
    await attendreRegle(bureau, r.id, (x) => (x.steps ?? []).length === 0, 60_000);
    await page.screenshot({ path: `${CAPTURES}/edt-047-convertie-derniere-etape.png` });
    // … et l'écran doit montrer un canevas VIDE, pas l'étape supprimée revenue sous un autre habit.
    const vues = await cartes(page);
    const origineRevenu = await page.getByText('Parcours au format d’origine').isVisible();
    expect(origineRevenu || vues.length > 0,
      `l’étape supprimée est revenue (${vues.join(' / ')}) sous « Parcours au format d’origine », en lecture seule : on ne peut pas vider un parcours converti, et la règle enverrait encore ce texto`).toBe(false);
    await expect(page.getByRole('button', { name: 'Ajouter une première étape' })).toBeVisible();
  });
});
