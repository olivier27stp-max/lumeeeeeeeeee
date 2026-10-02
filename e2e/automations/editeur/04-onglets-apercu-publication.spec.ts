/**
 * Éditeur — la deuxième barre : onglets, « Aperçu », interrupteur Brouillon / Publiée.
 *
 * Ce que ce fichier prouve :
 *  · les quatre onglets montrent chacun leur écran et rendent le canevas intact au retour ;
 *  · « Aperçu » montre ce qui partirait, sans rien envoyer, et se referme ;
 *  · publier demande confirmation, écrit `is_active` en base, et la LISTE (autre onglet, rechargée) suit ;
 *  · repasser en brouillon, annuler la confirmation, cliquer deux fois, refus du contrôle local ;
 *  · pendant l'appel, l'interrupteur montre qu'il travaille.
 */
import { lireRegle, ouvrirListe, envoisSimules } from '../_outils/banc';
import {
  test, expect, DELAI_TEST,
  CAPTURES, creerParcours, troisTextos, tache, ouvrirEditeur, cartes, carte, attendreRegle,
  corpsDuFil, dialogue, panneauEtape, toasts, indicateur, titreBandeau, creerClientJoignable, supprimerClient,
} from './_aides';

test.describe.configure({ timeout: DELAI_TEST });

const interrupteur = (page: import('@playwright/test').Page) => page.getByRole('switch', { name: 'Publier l’automatisation' });
/**
 * Le bouton « Aperçu » de la deuxième barre, par son nom EXACT : le bouton du nom de l'automatisation
 * (barre du haut) contient lui aussi « aperçu » quand la règle du test s'appelle « … aperçu … ».
 */
const boutonApercu = (page: import('@playwright/test').Page) => page.getByRole('button', { name: 'Aperçu', exact: true });

test.describe('onglets de l’éditeur', () => {
  test('[EDT-013][EDT-014][EDT-015][EDT-016] chaque onglet montre son écran ; le retour à « Parcours » rend le canevas intact', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} onglets`, troisTextos());
    await ouvrirEditeur(page, r.id);
    const onglets = page.getByRole('tablist', { name: 'Sections' }).getByRole('tab');
    await expect(onglets).toHaveText(['Parcours', 'Réglages', 'Historique', 'Journaux']);
    await expect(page.getByRole('tab', { name: 'Parcours' })).toHaveAttribute('aria-selected', 'true');

    await page.getByRole('tab', { name: 'Réglages' }).click();
    await expect(page.getByRole('tab', { name: 'Réglages' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tab', { name: 'Parcours' })).toHaveAttribute('aria-selected', 'false');
    await expect(page.getByRole('heading', { name: 'Réglages de cette automatisation' })).toBeVisible();
    await expect(carte(page, 'Texto ALPHA')).toHaveCount(0);

    await page.getByRole('tab', { name: 'Historique' }).click();
    await expect(page.getByRole('heading', { name: 'Historique' })).toBeVisible();
    await expect(page.getByText('Aucune inscription.')).toBeVisible();
    await expect(page.getByText('Disponible sur les 60 derniers jours.')).toBeVisible();

    await page.getByRole('tab', { name: 'Journaux' }).click();
    await expect(page.getByRole('heading', { name: 'Journaux d’exécution' })).toBeVisible();
    await expect(page.getByText('Aucun journal.')).toBeVisible();

    await page.getByRole('tab', { name: 'Parcours' }).click();
    expect(await cartes(page)).toEqual(['Envoyer un texto | Texto ALPHA', 'Envoyer un texto | Texto BRAVO', 'Envoyer un texto | Texto CHARLIE']);
    // Se promener dans les onglets n'écrit rien.
    await expect(indicateur(page)).toHaveText('Enregistré');
    expect((await lireRegle(bureau, r.id))?.updated_at).toBe(r.updated_at);
  });
});

test.describe('aperçu', () => {
  test('[EDT-017][EDT-055] « Aperçu » montre chaque étape qui partirait, dit que rien n’est envoyé, et se referme', async ({ page, bureau, marque }) => {
    const depuis = new Date().toISOString();
    const r = await creerParcours(bureau, `${marque} aperçu`, troisTextos());
    // L'aperçu se calcule sur un VRAI client du bureau, le plus récent qui a un courriel : le test pose le sien.
    const client = await creerClientJoignable(bureau, 'Camille', `Lapointe ${marque}`);
    try {
      await ouvrirEditeur(page, r.id);
      await boutonApercu(page).click();
      await expect(page.getByRole('heading', { name: 'Ce qui partirait' })).toBeVisible();
      await expect(page.getByText('Aperçu seulement — rien n’est envoyé.')).toBeVisible();
      // L'aperçu dit sur QUI il est calculé.
      await expect(page.getByText(`Exemple avec ${client.complet} · ${client.email} · rien n’est envoyé`)).toBeVisible();
      await page.screenshot({ path: `${CAPTURES}/edt-017-apercu.png` });
      const elements = page.getByRole('listitem').filter({ hasText: /Texto (ALPHA|BRAVO|CHARLIE)/ });
      await expect(elements).toHaveCount(3);
      await expect(elements.nth(0)).toContainText('Texto ALPHA');
      await expect(elements.nth(1)).toContainText('Texto BRAVO');
      await expect(elements.nth(2)).toContainText('Texto CHARLIE');
      await page.getByRole('button', { name: 'Fermer l’aperçu' }).click();
      await expect(page.getByRole('heading', { name: 'Ce qui partirait' })).toHaveCount(0);
      // Rien n'est parti, pas même dans le bac à sable.
      expect(await envoisSimules(bureau, bureau.orgA, depuis)).toEqual([]);
      expect((await lireRegle(bureau, r.id))?.is_active).toBe(false);
    } finally {
      await supprimerClient(bureau, client.id);
    }
  });

  test('[EDT-017] « Aperçu » juste après une modification : il montre la version à l’écran (enregistrée d’abord)', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} aperçu frais`, troisTextos());
    const client = await creerClientJoignable(bureau, 'Camille', `Bergeron ${marque}`);
    try {
      await ouvrirEditeur(page, r.id);
      await carte(page, 'Texto CHARLIE').click();
      await panneauEtape(page).getByLabel(/Texte du message/).fill('Texto CHARLIE tout neuf');
      await panneauEtape(page).getByRole('button', { name: 'Enregistrer' }).click();
      await boutonApercu(page).click();
      await expect(page.getByRole('heading', { name: 'Ce qui partirait' })).toBeVisible();
      await expect(page.getByRole('listitem').filter({ hasText: 'Texto CHARLIE tout neuf' })).toBeVisible();
      await expect(indicateur(page)).toHaveText('Enregistré');
      expect(await corpsDuFil(bureau, r.id)).toEqual(['Texto ALPHA', 'Texto BRAVO', 'Texto CHARLIE tout neuf']);
    } finally {
      await supprimerClient(bureau, client.id);
    }
  });

  test('[EDT-017] pendant la préparation, « Aperçu » est désactivé ET cela se voit (S-28) @defaut', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} aperçu lent`, troisTextos());
    await ouvrirEditeur(page, r.id);
    let liberer: () => void = () => undefined;
    const retenue = new Promise<void>((res) => { liberer = res; });
    await page.route('**/api/automations/rules/*/apercu', async (route) => { await retenue; await route.continue(); });
    const bouton = boutonApercu(page);
    const avant = await bouton.evaluate((el) => getComputedStyle(el).opacity + '|' + getComputedStyle(el).cursor);
    await bouton.click();
    await expect(bouton).toBeDisabled();
    const pendant = await bouton.evaluate((el) => getComputedStyle(el).opacity + '|' + getComputedStyle(el).cursor);
    await page.screenshot({ path: `${CAPTURES}/edt-017-apercu-en-cours.png` });
    liberer();
    await expect(page.getByRole('heading', { name: 'Ce qui partirait' })).toBeVisible();
    expect(pendant, 'le bouton est désactivé sans aucun changement visible (ni grisé, ni roue)').not.toBe(avant);
  });

  test('[EDT-017] « Aperçu » avec une étape incomplète : on dit de compléter, aucun aperçu périmé', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} aperçu incomplet`, [
      { id: 'e1', type: 'action', action: { type: 'send_sms', config: { body: 'Texto ALPHA' } }, suivant: 'e2' },
      { id: 'e2', type: 'action', action: { type: 'send_sms', config: { body: 'Texto BRAVO' } }, suivant: 'e3' },
      { id: 'e3', type: 'action', action: { type: 'ajouter_etiquette', config: {} }, suivant: null },
    ]);
    await ouvrirEditeur(page, r.id);
    // L'état « incomplet » naît d'une modification : on en fait une.
    await carte(page, 'Texto ALPHA').click();
    await panneauEtape(page).getByLabel(/Texte du message/).fill('Texto ALPHA bis');
    await panneauEtape(page).getByRole('button', { name: 'Enregistrer' }).click();
    await expect(indicateur(page)).toHaveText('1 étape(s) à compléter');
    await boutonApercu(page).click();
    await expect(toasts(page).filter({ hasText: 'Complétez les étapes en cours pour voir l’aperçu à jour.' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Ce qui partirait' })).toHaveCount(0);
  });
});

test.describe('publication depuis l’éditeur', () => {
  test('[EDT-018][EDT-019][EDT-161][EDT-155] publier puis repasser en brouillon : confirmation, base, et la LISTE (autre onglet) suit', async ({ page, bureau, marque, autreOnglet }) => {
    const nom = `${marque} publication`;
    const r = await creerParcours(bureau, nom, troisTextos());
    const liste = await autreOnglet();
    await ouvrirListe(liste.page);
    await expect(liste.page.getByRole('switch', { name: `Publier ${nom}` })).toHaveAttribute('aria-checked', 'false', { timeout: 30_000 });

    await ouvrirEditeur(page, r.id);
    await expect(interrupteur(page)).toHaveAttribute('aria-checked', 'false');
    await expect(page.getByText('Brouillon', { exact: true })).toBeVisible();
    await interrupteur(page).click();
    await expect(dialogue(page)).toBeVisible();
    await expect(dialogue(page).getByRole('heading', { name: 'Publier cette automatisation ?' })).toBeVisible();
    await expect(dialogue(page)).toContainText('Elle commencera à envoyer de vrais messages à vos clients dès le prochain déclenchement.');
    await page.screenshot({ path: `${CAPTURES}/edt-161-confirmation-publier.png` });
    // Tant que la confirmation n'est pas donnée, rien n'est publié.
    expect((await lireRegle(bureau, r.id))?.is_active).toBe(false);
    await dialogue(page).getByRole('button', { name: 'Publier' }).click();
    await expect(toasts(page).filter({ hasText: 'Automatisation publiée' })).toBeVisible();
    await expect(interrupteur(page)).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByText('Publiée', { exact: true })).toBeVisible();
    await attendreRegle(bureau, r.id, (x) => x.is_active === true);

    await liste.page.reload();
    await expect(liste.page.getByRole('switch', { name: `Repasser ${nom} en brouillon` })).toHaveAttribute('aria-checked', 'true', { timeout: 90_000 });

    // Retour en brouillon : pas de confirmation, la base suit, la liste aussi.
    await interrupteur(page).click();
    await expect(toasts(page).filter({ hasText: 'Repassée en brouillon' })).toBeVisible();
    await expect(dialogue(page)).toHaveCount(0);
    await expect(interrupteur(page)).toHaveAttribute('aria-checked', 'false');
    await expect(page.getByText('Brouillon', { exact: true })).toBeVisible();
    await attendreRegle(bureau, r.id, (x) => x.is_active === false);
    await liste.page.reload();
    await expect(liste.page.getByRole('switch', { name: `Publier ${nom}` })).toHaveAttribute('aria-checked', 'false', { timeout: 90_000 });
    // Publier / dépublier ne touche pas au parcours.
    expect(await corpsDuFil(bureau, r.id)).toEqual(['Texto ALPHA', 'Texto BRAVO', 'Texto CHARLIE']);
  });

  test('[EDT-018] publiée depuis la LISTE : l’éditeur rouvert l’affiche « Publiée » (synchronisation dans l’autre sens)', async ({ page, bureau, marque }) => {
    const nom = `${marque} depuis la liste`;
    const r = await creerParcours(bureau, nom, troisTextos());
    await ouvrirListe(page);
    await page.getByRole('switch', { name: `Publier ${nom}` }).click();
    // La liste peut demander confirmation ; on l'accepte si elle la pose.
    const confirmation = dialogue(page).getByRole('button', { name: 'Publier' });
    await expect(confirmation.or(toasts(page).filter({ hasText: 'Automatisation publiée' })).first()).toBeVisible();
    if (await confirmation.isVisible()) await confirmation.click();
    await attendreRegle(bureau, r.id, (x) => x.is_active === true);
    await ouvrirEditeur(page, r.id);
    await expect(interrupteur(page)).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByText('Publiée', { exact: true })).toBeVisible();
  });

  test('[EDT-154][EDT-156][EDT-157] la confirmation de publication s’annule par « Annuler », Échap et clic à côté : rien n’est publié', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} annulations`, troisTextos());
    await ouvrirEditeur(page, r.id);
    await interrupteur(page).click();
    // Le focus est sur « Annuler » : Entrée ne publie pas par accident.
    await expect(dialogue(page).getByRole('button', { name: 'Annuler' })).toBeFocused();
    await dialogue(page).getByRole('button', { name: 'Annuler' }).click();
    await expect(dialogue(page)).toHaveCount(0);
    await expect(interrupteur(page)).toHaveAttribute('aria-checked', 'false');

    await interrupteur(page).click();
    await expect(dialogue(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialogue(page)).toHaveCount(0);
    await expect(interrupteur(page)).toHaveAttribute('aria-checked', 'false');

    await interrupteur(page).click();
    await expect(dialogue(page)).toBeVisible();
    await page.mouse.click(20, 400);
    await expect(dialogue(page)).toHaveCount(0);
    await expect(interrupteur(page)).toHaveAttribute('aria-checked', 'false');
    await expect(page.getByText('Brouillon', { exact: true })).toBeVisible();
    expect((await lireRegle(bureau, r.id))?.is_active).toBe(false);
    await expect(toasts(page).filter({ hasText: 'Automatisation publiée' })).toHaveCount(0);
  });

  test('[EDT-018] double-clic sur l’interrupteur : la confirmation reste à l’écran (elle ne clignote pas pour disparaître) @defaut', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} double clic`, troisTextos());
    await ouvrirEditeur(page, r.id);
    await interrupteur(page).dblclick();
    await page.screenshot({ path: `${CAPTURES}/edt-018-double-clic.png` });
    // Attendu : soit la confirmation est là, soit c'est publié. Pas « rien ».
    const publie = toasts(page).filter({ hasText: 'Automatisation publiée' });
    await expect(dialogue(page).or(publie).first(), 'le 2e clic du double-clic tombe sur le voile et referme la confirmation : rien ne se passe').toBeVisible({ timeout: 4000 });
    expect((await lireRegle(bureau, r.id))?.is_active).toBe(false);
  });

  test('[EDT-018] pendant l’appel de publication, l’interrupteur montre qu’il travaille ; un seul appel part', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} en cours`, troisTextos());
    await ouvrirEditeur(page, r.id);
    let liberer: () => void = () => undefined;
    const retenue = new Promise<void>((res) => { liberer = res; });
    let appels = 0;
    await page.route(`**/api/automations/rules/${r.id}/publication`, async (route) => { appels += 1; await retenue; await route.continue(); });
    await interrupteur(page).click();
    await dialogue(page).getByRole('button', { name: 'Publier' }).click();
    await expect(interrupteur(page)).toHaveAttribute('aria-busy', 'true');
    // L'écran anticipe (vert) mais la base n'a pas encore changé : la roue le dit.
    await page.screenshot({ path: `${CAPTURES}/edt-018-publication-en-cours.png` });
    expect((await lireRegle(bureau, r.id))?.is_active).toBe(false);
    await expect(toasts(page).filter({ hasText: 'Automatisation publiée' })).toHaveCount(0);
    liberer();
    await expect(toasts(page).filter({ hasText: 'Automatisation publiée' })).toBeVisible();
    await expect(interrupteur(page)).not.toHaveAttribute('aria-busy', 'true');
    await attendreRegle(bureau, r.id, (x) => x.is_active === true);
    expect(appels).toBe(1);
  });

  test('[EDT-018][EDT-161] publier juste après une modification : la version publiée est celle de l’écran', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} publier frais`, troisTextos());
    await ouvrirEditeur(page, r.id);
    await carte(page, 'Texto ALPHA').click();
    await panneauEtape(page).getByLabel(/Texte du message/).fill('Texto ALPHA publié');
    await panneauEtape(page).getByRole('button', { name: 'Enregistrer' }).click();
    await interrupteur(page).click();
    await dialogue(page).getByRole('button', { name: 'Publier' }).click();
    await expect(toasts(page).filter({ hasText: 'Automatisation publiée' })).toBeVisible();
    const apres = await attendreRegle(bureau, r.id, (x) => x.is_active === true);
    expect(JSON.stringify(apres.steps)).toContain('Texto ALPHA publié');
    await expect(indicateur(page)).toHaveText('Enregistré');
  });

  test('[EDT-161] parcours sans message au client : la confirmation le dit (travail interne) et avertit', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} interne`, [tache('e1', 'Rappeler le client')]);
    await ouvrirEditeur(page, r.id);
    await interrupteur(page).click();
    await expect(dialogue(page)).toContainText('Elle se déclenchera dès le prochain événement — pour du travail interne seulement.');
    await expect(dialogue(page)).toContainText('Aucun message ne part au client : cette automatisation ne fait que du travail interne.');
    await expect(dialogue(page)).not.toContainText('de vrais messages à vos clients');
    await dialogue(page).getByRole('button', { name: 'Annuler' }).click();
    expect((await lireRegle(bureau, r.id))?.is_active).toBe(false);
  });

  test('[EDT-018][EDT-022] publier un parcours avec une étape incomplète : refus expliqué, l’étape fautive s’ouvre, rien n’est publié', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} bloquant`, [
      { id: 'e1', type: 'action', action: { type: 'send_sms', config: { body: 'Texto ALPHA' } }, suivant: 'e2' },
      { id: 'e2', type: 'action', action: { type: 'ajouter_etiquette', config: {} }, suivant: null },
    ]);
    await ouvrirEditeur(page, r.id);
    await expect(page.getByText(titreBandeau(1), { exact: true })).toBeVisible();
    await interrupteur(page).click();
    await expect(toasts(page).filter({ hasText: /Ajouter une étiquette.*L’étiquette.*est vide/ })).toBeVisible();
    await expect(dialogue(page)).toHaveCount(0);
    await expect(panneauEtape(page).getByRole('heading', { name: 'Ajouter une étiquette' })).toBeVisible();
    await expect(interrupteur(page)).toHaveAttribute('aria-checked', 'false');
    expect((await lireRegle(bureau, r.id))?.is_active).toBe(false);
  });
});
