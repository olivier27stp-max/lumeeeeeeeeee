/**
 * Éditeur — l'onglet « Journaux » (ce que l'automatisation a exécuté).
 *
 * Des exécutions sont semées dans `automation_execution_logs` pour une règle du bureau de test
 * (réussies, échouées, sautées). Ce fichier prouve que :
 *  · chacune apparaît avec le bon client, la bonne action, le bon statut, la bonne date ;
 *  · une ligne se déplie (souris, Entrée, Espace) et montre ce qui est réellement parti ;
 *  · un échec est expliqué en français, jamais par le texte technique anglais ;
 *  · les filtres Action et Statut, et le compteur « N ligne(s) », correspondent à la base ;
 *  · au-delà de 200 lignes, l'écran dit qu'il n'affiche pas tout.
 */
import type { Page } from '@playwright/test';
import {
  test, expect, DELAI_TEST,
  CAPTURES, creerParcours, troisTextos, ouvrirEditeur, creerClient, supprimerClient, semerJournaux, dateAffichee, sansEspacesSpeciales,
  ecranEditeur, type JournalSeme,
} from './_aides';

test.describe.configure({ timeout: DELAI_TEST });

async function ouvrirJournaux(page: Page, id: string): Promise<void> {
  await ouvrirEditeur(page, id);
  await page.getByRole('tab', { name: 'Journaux' }).click();
  await expect(page.getByRole('heading', { name: 'Journaux d’exécution' })).toBeVisible();
}
/** Les lignes de journal (pas les lignes de détail dépliées). */
const lignes = (page: Page) => page.locator('tbody tr[role="button"]');

const SEMIS: JournalSeme[] = [
  { action_type: 'send_sms', result_success: true, result_data: { to: '+15555550142', body: 'Bonjour Camille, votre devis est prêt.' }, il_y_a_minutes: 10 },
  { action_type: 'send_email', result_success: true, result_data: { to: 'camille@lume-qa.test', subject: 'Votre devis', body: 'Bonjour Camille, voici votre devis.' }, il_y_a_minutes: 20 },
  { action_type: 'send_sms', result_success: false, result_error: 'No recipient phone', il_y_a_minutes: 30 },
  { action_type: 'send_sms', result_success: true, result_data: { saute: 'client désabonné des textos' }, il_y_a_minutes: 40 },
  { action_type: 'create_task', result_success: true, result_data: { title: 'Rappeler Camille' }, il_y_a_minutes: 50 },
  { action_type: 'send_email', result_success: false, result_error: 'Client email is injoignable (bounced)', il_y_a_minutes: 60 },
];

test.describe('onglet Journaux', () => {
  test('[EDT-152] chaque exécution semée apparaît : client, action, statut, raison en français, date ; compteur = base', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} journaux`, troisTextos());
    const autre = await creerParcours(bureau, `${marque} journaux autre règle`, troisTextos());
    const client = await creerClient(bureau, 'Camille', `Tremblay ${marque}`);
    try {
      await semerJournaux(bureau, r, client.id, [
        ...SEMIS,
        // Hors fenêtre de 60 jours.
        { action_type: 'send_sms', result_success: true, result_data: { body: 'vieux' }, il_y_a_minutes: 70 * 24 * 60 },
      ]);
      await semerJournaux(bureau, autre, client.id, [{ action_type: 'send_sms', result_success: true, il_y_a_minutes: 5 }]);
      await ouvrirJournaux(page, r.id);
      await expect(lignes(page)).toHaveCount(6, { timeout: 60_000 });
      await expect(page.getByText('6 ligne(s)')).toBeVisible();
      await expect(page.getByRole('columnheader')).toHaveText(['Client', 'Action', 'Statut', 'Exécuté le']);
      await page.screenshot({ path: `${CAPTURES}/edt-152-journaux.png` });
      const { data: base } = await bureau.admin.from('automation_execution_logs').select('action_type, result_success, created_at')
        .eq('automation_rule_id', r.id).gte('created_at', new Date(Date.now() - 60 * 86_400_000).toISOString()).order('created_at', { ascending: false });
      expect((base ?? []).length).toBe(6);
      const actions = ['Texto', 'Courriel', 'Texto', 'Texto', 'Tâche', 'Courriel'];
      const statuts = ['Terminé', 'Terminé', 'Échoué', 'Sauté', 'Terminé', 'Échoué'];
      for (let i = 0; i < 6; i++) {
        const cellules = lignes(page).nth(i).locator('td');
        await expect(cellules.nth(0)).toHaveText(client.complet);
        await expect(cellules.nth(1)).toHaveText(actions[i]);
        await expect(cellules.nth(2)).toContainText(statuts[i]);
        expect(sansEspacesSpeciales(await cellules.nth(3).innerText())).toBe(dateAffichee((base ?? [])[i].created_at as string));
      }
      // Les raisons, en français.
      await expect(lignes(page).nth(2)).toContainText('ce client n’a pas de numéro de téléphone');
      await expect(lignes(page).nth(2)).not.toContainText('No recipient phone');
      await expect(lignes(page).nth(3)).toContainText('client désabonné des textos');
      await expect(lignes(page).nth(5)).toContainText('l’adresse courriel de ce client est injoignable');
    } finally {
      await supprimerClient(bureau, client.id);
    }
  });

  test('[EDT-152] cliquer une ligne la déplie : destinataire, objet, message réellement partis ; recliquer la replie', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} journaux dépli`, troisTextos());
    const client = await creerClient(bureau, 'Camille', `Roy ${marque}`);
    try {
      await semerJournaux(bureau, r, client.id, [...SEMIS.slice(0, 2), { action_type: 'send_sms', result_success: false, result_error: 'No recipient phone', il_y_a_minutes: 30 }]);
      await ouvrirJournaux(page, r.id);
      await expect(lignes(page)).toHaveCount(3, { timeout: 60_000 });
      const courriel = lignes(page).nth(1);
      await expect(courriel).toHaveAttribute('aria-expanded', 'false');
      await courriel.click();
      await expect(courriel).toHaveAttribute('aria-expanded', 'true');
      const detail = page.locator('tbody tr').filter({ has: page.locator('dl') });
      await expect(detail).toHaveCount(1);
      await expect(detail.getByText('Destinataire')).toBeVisible();
      await expect(detail.getByText('camille@lume-qa.test')).toBeVisible();
      await expect(detail.getByText('Objet', { exact: true })).toBeVisible();
      await expect(detail.getByText('Votre devis', { exact: true })).toBeVisible();
      await expect(detail.getByText('Bonjour Camille, voici votre devis.')).toBeVisible();
      await page.screenshot({ path: `${CAPTURES}/edt-152-journal-deplie.png` });
      // Une seule ligne dépliée à la fois.
      await lignes(page).nth(0).click();
      await expect(lignes(page).nth(0)).toHaveAttribute('aria-expanded', 'true');
      await expect(courriel).toHaveAttribute('aria-expanded', 'false');
      await expect(page.locator('tbody tr').filter({ has: page.locator('dl') }).getByText('+15555550142')).toBeVisible();
      await lignes(page).nth(0).click();
      await expect(lignes(page).nth(0)).toHaveAttribute('aria-expanded', 'false');
      await expect(page.locator('tbody dl')).toHaveCount(0);
      // Une exécution sans contenu gardé : c'est dit.
      await lignes(page).nth(2).click();
      await expect(page.getByText('Le contenu de cet envoi n’a pas été conservé (exécution antérieure au journal détaillé).')).toBeVisible();
    } finally {
      await supprimerClient(bureau, client.id);
    }
  });

  test('[EDT-153] au clavier : la ligne prend le focus, Entrée la déplie, Espace la replie', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} journaux clavier`, troisTextos());
    const client = await creerClient(bureau, 'Camille', `Gagnon ${marque}`);
    try {
      await semerJournaux(bureau, r, client.id, SEMIS.slice(0, 2));
      await ouvrirJournaux(page, r.id);
      await expect(lignes(page)).toHaveCount(2, { timeout: 60_000 });
      await page.getByLabel('Statut').focus();
      await page.keyboard.press('Tab');
      await expect(lignes(page).nth(0)).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(lignes(page).nth(0)).toHaveAttribute('aria-expanded', 'true');
      await expect(page.locator('tbody dl').getByText('Bonjour Camille, votre devis est prêt.')).toBeVisible();
      await page.keyboard.press('Space');
      await expect(lignes(page).nth(0)).toHaveAttribute('aria-expanded', 'false');
      await page.keyboard.press('Tab');
      await expect(lignes(page).nth(1)).toBeFocused();
    } finally {
      await supprimerClient(bureau, client.id);
    }
  });

  test('[EDT-150][EDT-151] filtres Action et Statut : chaque combinaison ne montre que ses lignes, le compteur suit la base', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} journaux filtres`, troisTextos());
    const client = await creerClient(bureau, 'Camille', `Côté ${marque}`);
    try {
      await semerJournaux(bureau, r, client.id, SEMIS);
      await ouvrirJournaux(page, r.id);
      await expect(lignes(page)).toHaveCount(6, { timeout: 60_000 });
      const action = page.getByLabel('Action');
      const statut = page.getByLabel('Statut');
      await expect(statut.locator('option')).toHaveText(['Tous les statuts', 'Réussis', 'Échoués']);
      await expect(action.locator('option')).toHaveText(['Toutes les actions', 'Texto', 'Courriel', 'Tâche']);

      await statut.selectOption('echec');
      await expect(lignes(page)).toHaveCount(2, { timeout: 60_000 });
      await expect(page.getByText('2 ligne(s)')).toBeVisible();
      for (let i = 0; i < 2; i++) await expect(lignes(page).nth(i).locator('td').nth(2)).toContainText('Échoué');

      await statut.selectOption('all');
      await expect(lignes(page)).toHaveCount(6, { timeout: 60_000 });
      await action.selectOption('send_email');
      await expect(lignes(page)).toHaveCount(2, { timeout: 60_000 });
      for (let i = 0; i < 2; i++) await expect(lignes(page).nth(i).locator('td').nth(1)).toHaveText('Courriel');
      await statut.selectOption('echec');
      await expect(lignes(page)).toHaveCount(1, { timeout: 60_000 });
      await expect(page.getByText('1 ligne(s)')).toBeVisible();
      await statut.selectOption('all');
      await action.selectOption('all');
      await expect(lignes(page)).toHaveCount(6, { timeout: 60_000 });
    } finally {
      await supprimerClient(bureau, client.id);
    }
  });

  test('[EDT-150] après avoir filtré sur une action, on peut en choisir une AUTRE directement (S-33) @defaut', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} journaux menu réduit`, troisTextos());
    const client = await creerClient(bureau, 'Camille', `Lavoie ${marque}`);
    try {
      await semerJournaux(bureau, r, client.id, SEMIS);
      await ouvrirJournaux(page, r.id);
      await expect(lignes(page)).toHaveCount(6, { timeout: 60_000 });
      await page.getByLabel('Action').selectOption('send_email');
      await expect(lignes(page)).toHaveCount(2, { timeout: 60_000 });
      const options = await page.getByLabel('Action').locator('option').allTextContents();
      expect(options, 'une fois filtré sur « Courriel », le menu ne propose plus « Texto » ni « Tâche » : il faut repasser par « Toutes les actions »')
        .toEqual(['Toutes les actions', 'Texto', 'Courriel', 'Tâche']);
    } finally {
      await supprimerClient(bureau, client.id);
    }
  });

  test('[EDT-151] le filtre « Réussis » ne montre pas les envois SAUTÉS (constat f1-4) @defaut', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} journaux sautés`, troisTextos());
    const client = await creerClient(bureau, 'Camille', `Fortin ${marque}`);
    try {
      await semerJournaux(bureau, r, client.id, SEMIS);
      await ouvrirJournaux(page, r.id);
      await expect(lignes(page)).toHaveCount(6, { timeout: 60_000 });
      await page.getByLabel('Statut').selectOption('succes');
      await expect(lignes(page).first()).toBeVisible({ timeout: 60_000 });
      await expect(page.getByText(/^[34] ligne\(s\)$/)).toBeVisible({ timeout: 60_000 });
      await page.screenshot({ path: `${CAPTURES}/edt-151-reussis-avec-sautes.png` });
      const statuts = await lignes(page).locator('td:nth-child(3)').allInnerTexts();
      expect(statuts.filter((s) => s.includes('Sauté')), 'sous « Réussis », une ligne « Sauté » : un envoi qui n’est pas parti compte comme réussi').toEqual([]);
    } finally {
      await supprimerClient(bureau, client.id);
    }
  });

  test('[EDT-152] un échec inconnu n’est jamais affiché en anglais technique @defaut', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} journaux anglais`, troisTextos());
    const client = await creerClient(bureau, 'Camille', `Morin ${marque}`);
    try {
      await semerJournaux(bureau, r, client.id, [
        { action_type: 'send_email', result_success: false, result_error: 'TypeError: Cannot read properties of undefined (reading \'email\')', il_y_a_minutes: 5 },
        { action_type: 'webhook', result_success: false, result_error: 'Request failed with status code 502', il_y_a_minutes: 6 },
      ]);
      await ouvrirJournaux(page, r.id);
      await expect(lignes(page)).toHaveCount(2, { timeout: 60_000 });
      await page.screenshot({ path: `${CAPTURES}/edt-152-journal-erreur-anglaise.png` });
      const textes = (await lignes(page).allInnerTexts()).join(' | ');
      expect(textes, 'le texte technique anglais de l’erreur est affiché tel quel à l’entrepreneur').not.toMatch(/TypeError|Cannot read properties|Request failed|status code/);
    } finally {
      await supprimerClient(bureau, client.id);
    }
  });

  test('[EDT-150][EDT-152] toutes les actions du catalogue ont un nom français dans les journaux (S-33) @defaut', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} journaux libellés`, troisTextos());
    const client = await creerClient(bureau, 'Camille', `Pelletier ${marque}`);
    try {
      await semerJournaux(bureau, r, client.id, [
        { action_type: 'ajouter_etiquette', result_success: true, result_data: { etiquette: 'vip' }, il_y_a_minutes: 5 },
        { action_type: 'update_custom_field', result_success: true, result_data: { field_id: 'x', value: '12' }, il_y_a_minutes: 6 },
        { action_type: 'envoyer_facture', result_success: true, result_data: { to: 'camille@lume-qa.test' }, il_y_a_minutes: 7 },
        { action_type: 'webhook', result_success: true, result_data: { status: 200 }, il_y_a_minutes: 8 },
      ]);
      await ouvrirJournaux(page, r.id);
      await expect(lignes(page)).toHaveCount(4, { timeout: 60_000 });
      await page.screenshot({ path: `${CAPTURES}/edt-152-journal-cles-brutes.png` });
      const actions = await lignes(page).locator('td:nth-child(2)').allInnerTexts();
      expect(actions, 'la clé technique de l’action est affichée telle quelle (sans accents, en anglais)')
        .toEqual(['Ajouter une étiquette', 'Mettre à jour un champ personnalisé', 'Envoyer la facture', 'Appeler un webhook']);
    } finally {
      await supprimerClient(bureau, client.id);
    }
  });

  test('[EDT-152] plus de 200 exécutions : l’écran dit qu’il n’affiche pas tout, ou permet d’aller plus loin (S-33) @defaut', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} journaux 230`, troisTextos());
    const client = await creerClient(bureau, 'Camille', `Gauthier ${marque}`);
    try {
      await semerJournaux(bureau, r, client.id, Array.from({ length: 230 }, (_, i): JournalSeme => ({
        action_type: 'send_sms', result_success: i % 7 !== 0, result_error: i % 7 === 0 ? 'No recipient phone' : null,
        result_data: { body: `Message ${i}` }, il_y_a_minutes: i + 1,
      })));
      const { count } = await bureau.admin.from('automation_execution_logs').select('id', { count: 'exact', head: true }).eq('automation_rule_id', r.id);
      expect(count).toBe(230);
      await ouvrirJournaux(page, r.id);
      await expect(lignes(page)).toHaveCount(200, { timeout: 90_000 });
      await page.screenshot({ path: `${CAPTURES}/edt-152-journaux-200.png` });
      const compteur = await page.getByText(/ligne\(s\)$/).innerText();
      /* Cherché DANS l'éditeur seulement : la barre latérale de l'app, restée dans le DOM derrière le calque,
         a un bouton « Plus » (rubrique du menu) que l'ancien sélecteur prenait pour « voir plus » — le test
         passait à vide (passe du 2026-10-01) alors que l'écran ne dit rien. */
      const editeur = ecranEditeur(page);
      const suite = editeur.getByRole('button', { name: /suivant|plus|charger|page/i }).or(editeur.getByText(/200 (plus récentes|premières|dernières)|sur 230|affichées/i));
      expect(compteur === '230 ligne(s)' || await suite.first().isVisible(),
        `la base a 230 exécutions, l’écran dit « ${compteur} » sans rien indiquer : les 30 plus anciennes sont inatteignables`).toBe(true);
    } finally {
      await supprimerClient(bureau, client.id);
    }
  });

  test('[EDT-152] lecture impossible : « Les journaux n’ont pas pu être lus. », et on peut réessayer sans recharger la page @defaut', async ({ page, bureau, marque, moniteur }) => {
    const r = await creerParcours(bureau, `${marque} journaux panne`, troisTextos());
    await ouvrirEditeur(page, r.id);
    moniteur.attendu(/500 GET .*\/rest\/v1\/automation_execution_logs/, 'panne simulée de la lecture des journaux');
    moniteur.attendu(/\[journaux\] lecture échouée/, 'la panne simulée est journalisée');
    await page.route('**/rest/v1/automation_execution_logs**', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'panne simulée' }) }));
    await page.getByRole('tab', { name: 'Journaux' }).click();
    await expect(page.getByText('Les journaux n’ont pas pu être lus.')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText('panne simulée')).toHaveCount(0);
    await page.screenshot({ path: `${CAPTURES}/edt-152-journaux-panne.png` });
    await expect(page.getByRole('button', { name: /Réessayer|Actualiser|Rafraîchir/ }),
      'aucun bouton pour relire après une panne passagère : il faut changer d’onglet ou recharger').toBeVisible({ timeout: 3000 });
  });
});
