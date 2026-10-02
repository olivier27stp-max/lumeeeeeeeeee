/**
 * Éditeur — l'onglet « Historique » (les clients passés dans le parcours).
 *
 * Des tâches sont semées dans `automation_scheduled_tasks` pour une règle du bureau de test
 * (en attente, en cours, terminée, échouée, annulée). Ce fichier prouve que :
 *  · chacune apparaît avec le bon client, la bonne étape, le bon statut et les bonnes dates ;
 *  · le filtre de statut et le compteur « N ligne(s) » correspondent à la base ;
 *  · un échec est expliqué en français, jamais par le texte technique anglais ;
 *  · ce qui a plus de 60 jours ou appartient à une autre règle n'apparaît pas.
 */
import type { Page } from '@playwright/test';
import {
  test, expect, DELAI_TEST,
  CAPTURES, creerParcours, troisTextos, ouvrirEditeur, creerClient, supprimerClient, semerTaches, dateAffichee, sansEspacesSpeciales,
} from './_aides';

test.describe.configure({ timeout: DELAI_TEST });

async function ouvrirHistorique(page: Page, id: string): Promise<void> {
  await ouvrirEditeur(page, id);
  await page.getByRole('tab', { name: 'Historique' }).click();
  await expect(page.getByRole('heading', { name: 'Historique' })).toBeVisible();
}
const lignes = (page: Page) => page.locator('tbody tr');

test.describe('onglet Historique', () => {
  test('[EDT-149] chaque tâche semée apparaît avec client, étape, statut, dates ; le compteur = la base', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} historique`, troisTextos());
    const autre = await creerParcours(bureau, `${marque} historique autre règle`, troisTextos());
    const client = await creerClient(bureau, 'Camille', `Tremblay ${marque}`);
    try {
      await semerTaches(bureau, r, client.id, [
        { status: 'pending', step_id: 'e2', type_action: 'send_sms', dans_minutes: 60 * 24 * 30 },
        { status: 'completed', step_id: 'e1', type_action: 'send_email', dans_minutes: -60, terminee_il_y_a_minutes: 59 },
        { status: 'failed', step_id: 'e1', type_action: 'send_sms', dans_minutes: -120, last_error: 'No recipient phone', attempts: 3 },
        { status: 'cancelled', step_id: 'e3', type_action: 'create_task', dans_minutes: -180, last_error: 'Automatisation supprimée' },
        { status: 'running', step_id: 'e2', type_action: 'request_review', dans_minutes: 60 * 24 * 31 },
        // Hors fenêtre : créée il y a 70 jours.
        { status: 'completed', step_id: 'e1', type_action: 'send_sms', dans_minutes: -60 * 24 * 70, creee_il_y_a_jours: 70 },
      ]);
      await semerTaches(bureau, autre, client.id, [{ status: 'completed', step_id: 'e1', type_action: 'send_sms', dans_minutes: -30 }]);

      await ouvrirHistorique(page, r.id);
      await expect(lignes(page)).toHaveCount(5, { timeout: 60_000 });
      await expect(page.getByText('5 ligne(s)')).toBeVisible();
      await expect(page.getByRole('columnheader')).toHaveText(['Client', 'Étape en cours', 'Statut', 'Prévu le', 'Terminé le']);
      await page.screenshot({ path: `${CAPTURES}/edt-149-historique.png` });

      const { data: base } = await bureau.admin.from('automation_scheduled_tasks')
        .select('status, execute_at, completed_at').eq('automation_rule_id', r.id)
        .gte('created_at', new Date(Date.now() - 60 * 86_400_000).toISOString()).order('execute_at', { ascending: false });
      expect((base ?? []).length).toBe(5);
      // Trié du plus loin dans le futur au plus ancien : même ordre que la base.
      const attendus = ['En cours', 'En attente', 'Terminé', 'Échoué', 'Annulé'];
      for (let i = 0; i < 5; i++) {
        const ligne = lignes(page).nth(i);
        await expect(ligne.locator('td').nth(0)).toHaveText(client.complet);
        await expect(ligne.locator('td').nth(2)).toContainText(attendus[i]);
        const prevu = sansEspacesSpeciales(await ligne.locator('td').nth(3).innerText());
        expect(prevu).toBe(dateAffichee((base ?? [])[i].execute_at as string));
        const termine = sansEspacesSpeciales(await ligne.locator('td').nth(4).innerText());
        expect(termine).toBe((base ?? [])[i].completed_at ? dateAffichee((base ?? [])[i].completed_at as string) : '—');
      }
      await expect(lignes(page).nth(0).locator('td').nth(1)).toContainText('Demande d’avis');
      await expect(lignes(page).nth(1).locator('td').nth(1)).toContainText('Texto');
      await expect(lignes(page).nth(2).locator('td').nth(1)).toContainText('Courriel');
      await expect(lignes(page).nth(4).locator('td').nth(1)).toContainText('Tâche');
      // L'échec connu est expliqué en français, avec le nombre de tentatives.
      await expect(lignes(page).nth(3)).toContainText('ce client n’a pas de numéro de téléphone');
      await expect(lignes(page).nth(3)).toContainText('3 tentatives');
      await expect(lignes(page).nth(3)).not.toContainText('No recipient phone');
      await expect(lignes(page).nth(4)).toContainText('l’automatisation a été supprimée');
    } finally {
      await supprimerClient(bureau, client.id);
    }
  });

  test('[EDT-148] le filtre de statut : chaque choix ne montre que ses lignes, le compteur suit', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} historique filtre`, troisTextos());
    const client = await creerClient(bureau, 'Louis', `Gagnon ${marque}`);
    try {
      await semerTaches(bureau, r, client.id, [
        { status: 'pending', step_id: 'e2', dans_minutes: 60 * 24 * 30 },
        { status: 'pending', step_id: 'e3', dans_minutes: 60 * 24 * 31 },
        { status: 'completed', step_id: 'e1', dans_minutes: -60, terminee_il_y_a_minutes: 59 },
        { status: 'failed', step_id: 'e1', dans_minutes: -120, last_error: 'No recipient phone' },
        { status: 'cancelled', step_id: 'e3', dans_minutes: -180 },
      ]);
      await ouvrirHistorique(page, r.id);
      const filtre = page.getByLabel('Statut');
      await expect(filtre.locator('option')).toHaveText(['Tous', 'En attente', 'Terminés', 'Échoués', 'Annulés']);
      await expect(lignes(page)).toHaveCount(5, { timeout: 60_000 });
      for (const [valeur, libelle, n] of [['pending', 'En attente', 2], ['completed', 'Terminé', 1], ['failed', 'Échoué', 1], ['cancelled', 'Annulé', 1]] as const) {
        await filtre.selectOption(valeur);
        await expect(lignes(page)).toHaveCount(n, { timeout: 60_000 });
        await expect(page.getByText(`${n} ligne(s)`)).toBeVisible();
        for (let i = 0; i < n; i++) await expect(lignes(page).nth(i).locator('td').nth(2)).toContainText(libelle);
      }
      await filtre.selectOption('all');
      await expect(lignes(page)).toHaveCount(5, { timeout: 60_000 });
    } finally {
      await supprimerClient(bureau, client.id);
    }
  });

  test('[EDT-148] une tâche « En cours » se retrouve par le filtre (S-34) @defaut', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} historique en cours`, troisTextos());
    const client = await creerClient(bureau, 'Maude', `Roy ${marque}`);
    try {
      await semerTaches(bureau, r, client.id, [
        { status: 'running', step_id: 'e2', dans_minutes: 60 * 24 * 30 },
        { status: 'completed', step_id: 'e1', dans_minutes: -60, terminee_il_y_a_minutes: 59 },
      ]);
      await ouvrirHistorique(page, r.id);
      await expect(lignes(page)).toHaveCount(2, { timeout: 60_000 });
      await expect(lignes(page).nth(0)).toContainText('En cours');
      const options = await page.getByLabel('Statut').locator('option').allTextContents();
      expect(options, 'le tableau affiche le statut « En cours » mais le filtre ne permet pas de le choisir').toContain('En cours');
    } finally {
      await supprimerClient(bureau, client.id);
    }
  });

  test('[EDT-149] un échec inconnu n’est jamais affiché en anglais technique @defaut', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} historique anglais`, troisTextos());
    const client = await creerClient(bureau, 'Noémie', `Côté ${marque}`);
    try {
      await semerTaches(bureau, r, client.id, [
        { status: 'failed', step_id: 'e1', dans_minutes: -60, last_error: 'TypeError: fetch failed (ECONNREFUSED 10.0.0.4:443)', attempts: 2 },
      ]);
      await ouvrirHistorique(page, r.id);
      await expect(lignes(page)).toHaveCount(1, { timeout: 60_000 });
      await page.screenshot({ path: `${CAPTURES}/edt-149-historique-erreur-anglaise.png` });
      await expect(lignes(page).nth(0)).toContainText('Échoué');
      await expect(lignes(page).nth(0), 'le texte technique anglais de l’erreur est affiché tel quel à l’entrepreneur').not.toContainText(/TypeError|ECONNREFUSED|fetch failed/);
    } finally {
      await supprimerClient(bureau, client.id);
    }
  });

  test('[EDT-149] la colonne « Étape en cours » nomme l’étape, sans identifiant technique « (e2) » (S-34) @defaut', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} historique étape`, troisTextos());
    const client = await creerClient(bureau, 'Élise', `Bouchard ${marque}`);
    try {
      await semerTaches(bureau, r, client.id, [
        { status: 'pending', step_id: 'e2', type_action: 'send_sms', dans_minutes: 60 * 24 * 30 },
        // Une attente en cours : la tâche ne porte pas de type d'action.
        { status: 'pending', step_id: 'e3', type_action: null, dans_minutes: 60 * 24 * 31 },
      ]);
      await ouvrirHistorique(page, r.id);
      await expect(lignes(page)).toHaveCount(2, { timeout: 60_000 });
      await page.screenshot({ path: `${CAPTURES}/edt-149-historique-etape.png` });
      const cellules = await lignes(page).locator('td:nth-child(2)').allInnerTexts();
      expect.soft(cellules.every((c) => c.replace(/\(e\d+\)/, '').trim().length > 0), `colonne « Étape en cours » vide pour une étape sans action : ${JSON.stringify(cellules)}`).toBe(true);
      expect(cellules.some((c) => /\(e\d+\)/.test(c)), `identifiant technique affiché : ${JSON.stringify(cellules)}`).toBe(false);
    } finally {
      await supprimerClient(bureau, client.id);
    }
  });

  test('[EDT-149] lecture impossible : « L’historique n’a pas pu être lu. », pas d’écran blanc', async ({ page, bureau, marque, moniteur }) => {
    const r = await creerParcours(bureau, `${marque} historique panne`, troisTextos());
    await ouvrirEditeur(page, r.id);
    moniteur.attendu(/500 GET .*\/rest\/v1\/automation_scheduled_tasks/, 'panne simulée de la lecture de l’historique');
    moniteur.attendu(/\[historique\] lecture échouée/, 'la panne simulée est journalisée');
    await page.route('**/rest/v1/automation_scheduled_tasks**', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'panne simulée' }) }));
    await page.getByRole('tab', { name: 'Historique' }).click();
    await expect(page.getByText('L’historique n’a pas pu être lu.')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText('panne simulée')).toHaveCount(0);
  });
});
