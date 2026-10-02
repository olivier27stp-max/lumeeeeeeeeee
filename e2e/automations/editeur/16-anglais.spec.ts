/**
 * Éditeur — l'interface en ANGLAIS.
 *
 * Ce que ce fichier prouve : chaque zone de structure de l'éditeur (barre, onglets, canevas, menu « ··· »,
 * tiroirs, dialogues, Réglages, Historique, Journaux) a ses libellés en anglais, et aucun texte français
 * ne traîne (repéré par ses accents et ses guillemets, le contenu des données de test étant sans accent).
 */
import type { Page } from '@playwright/test';
import { lireRegle } from '../_outils/banc';
import {
  test, expect, DELAI_TEST, CAPTURES, creerParcours, texto, ouvrirEditeur, cartes, creerClient, supprimerClient, semerJournaux, semerTaches,
  dialogue, toasts, attendreRegle,
} from './_aides';

test.describe.configure({ timeout: DELAI_TEST });
test.use({ langue: 'en' });

/** Le texte visible de l'éditeur (le calque plein écran), sans les données de test. */
async function texteEditeur(page: Page): Promise<string> {
  return page.locator('div.fixed.inset-0.z-50').first().innerText();
}
/** Les morceaux de texte qui trahissent du français : lettres accentuées, guillemets français, « h » d'heure. */
function francais(texte: string): string[] {
  return [...new Set(texte.split('\n').map((l) => l.trim()).filter((l) => /[éèêàâçùûîôœÉÈÀÇ«»]/.test(l.replace(/Québec/g, 'Quebec'))))];
}
const etapes = () => [texto('e1', 'Hello ALPHA', 'e2'), texto('e2', 'Hello BRAVO', 'e3'), texto('e3', 'Hello CHARLIE', null)];

test.describe('éditeur en anglais', () => {
  test('[EDT-004][EDT-010][EDT-011][EDT-012][EDT-013][EDT-017][EDT-019][EDT-043][EDT-048] barre, onglets et canevas : tout est en anglais', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} english`, etapes());
    await ouvrirEditeur(page, r.id);
    await expect(page.getByRole('button', { name: 'My automations' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Redo' })).toBeVisible();
    await expect(page.getByText('Saved', { exact: true })).toBeVisible();
    await expect(page.getByRole('tablist').getByRole('tab')).toHaveText(['Builder', 'Settings', 'Enrollment history', 'Execution logs']);
    await expect(page.getByRole('button', { name: 'Preview' })).toBeVisible();
    await expect(page.getByRole('switch', { name: 'Publish the automation' })).toBeVisible();
    await expect(page.getByText('Draft', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /^When\s*Quote sent/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add', exact: true })).toBeVisible();
    for (const nom of ['Pan the canvas', 'Zoom in', 'Zoom out', 'Fit to screen']) await expect(page.getByRole('button', { name: nom })).toBeVisible();
    expect(await cartes(page)).toEqual(['Send a text message | Hello ALPHA', 'Send a text message | Hello BRAVO', 'Send a text message | Hello CHARLIE']);
    await page.screenshot({ path: `${CAPTURES}/edt-en-parcours.png` });
    expect(francais(await texteEditeur(page)), 'texte français dans l’éditeur en anglais').toEqual([]);
  });

  test('[EDT-042][EDT-045][EDT-047][EDT-054][EDT-056][EDT-057][EDT-159] menu « ··· », tiroir des actions, dialogue de suppression : en anglais', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} english menu`, etapes());
    await ouvrirEditeur(page, r.id);
    await page.getByRole('button', { name: /^Options for/ }).nth(1).click();
    for (const nom of ['Duplicate action', 'Edit action', 'Delete action', 'Delete from here']) await expect(page.getByRole('button', { name: nom, exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Delete action', exact: true }).click();
    await expect(dialogue(page).getByRole('heading', { name: 'Delete this step?' })).toBeVisible();
    await expect(dialogue(page)).toContainText('What came after stays in the journey and reconnects on its own.');
    await expect(dialogue(page).getByRole('button', { name: 'Cancel' })).toBeVisible();
    await expect(dialogue(page).getByRole('button', { name: 'Delete' })).toBeVisible();
    expect(francais(await dialogue(page).innerText())).toEqual([]);
    await dialogue(page).getByRole('button', { name: 'Cancel' }).click();

    await page.getByRole('button', { name: 'Add', exact: true }).click();
    const tiroir = page.getByRole('complementary', { name: 'Actions' });
    await expect(tiroir.getByText('What the automation will do')).toBeVisible();
    await expect(tiroir.getByRole('searchbox', { name: 'Search Actions' })).toBeVisible();
    for (const famille of ['Communication', 'Client', 'Work', 'Sales', 'Money', 'Technical', 'Journey']) {
      await expect(tiroir.getByRole('heading', { name: famille, exact: true })).toBeVisible();
    }
    await page.screenshot({ path: `${CAPTURES}/edt-en-tiroir.png` });
    expect(francais(await tiroir.innerText()), 'texte français dans le tiroir des actions en anglais').toEqual([]);
    await tiroir.getByRole('searchbox').fill('zzzz');
    await expect(tiroir.getByText('Nothing matches that search.')).toBeVisible();
    await tiroir.getByRole('button', { name: 'Close' }).click();
    expect((await lireRegle(bureau, r.id))?.updated_at).toBe(r.updated_at);
  });

  test('[EDT-018][EDT-161] publier en anglais : confirmation et toasts en anglais', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} english publish`, etapes());
    await ouvrirEditeur(page, r.id);
    await page.getByRole('switch', { name: 'Publish the automation' }).click();
    await expect(dialogue(page).getByRole('heading', { name: 'Publish this automation?' })).toBeVisible();
    await expect(dialogue(page)).toContainText('It will start sending real messages to your clients at the next trigger.');
    expect(francais(await dialogue(page).innerText())).toEqual([]);
    await dialogue(page).getByRole('button', { name: 'Publish' }).click();
    await expect(toasts(page).filter({ hasText: 'Automation published' })).toBeVisible();
    await expect(page.getByText('Published', { exact: true })).toBeVisible();
    await attendreRegle(bureau, r.id, (x) => x.is_active === true);
    await page.getByRole('switch', { name: 'Publish the automation' }).click();
    await expect(toasts(page).filter({ hasText: 'Back to draft' })).toBeVisible();
    await attendreRegle(bureau, r.id, (x) => x.is_active === false);
  });

  test('[EDT-140][EDT-141][EDT-143][EDT-144][EDT-146][EDT-147] onglet Settings : libellés, menus et heures en anglais (S-36) @defaut', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} english settings`, etapes(), { settings: { fenetre: { debut: 9, fin: 18 } } });
    await ouvrirEditeur(page, r.id);
    await page.getByRole('tab', { name: 'Settings' }).click();
    await expect(page.getByRole('heading', { name: 'This automation’s settings' })).toBeVisible();
    for (const nom of ['Allow re-entry', 'Stop on response', 'Business days only']) await expect(page.getByRole('switch', { name: nom })).toBeVisible();
    await expect(page.getByLabel('Once per client every…').locator('option')).toHaveText(['No limit', '1 day', '3 days', '7 days', '14 days', '30 days', '90 days']);
    await page.screenshot({ path: `${CAPTURES}/edt-en-settings.png` });
    expect(francais(await texteEditeur(page)), 'texte français dans l’onglet Settings').toEqual([]);
    // Les heures : un anglophone n'écrit pas « 9 h », et « Back to 8 – 20 » ne dit pas de quoi on parle.
    const heures = await page.getByLabel('From', { exact: true }).locator('option').allTextContents();
    expect(heures.filter((h) => /^\d+ h$/.test(h)), `heures au format français dans l’interface anglaise : ${heures.slice(0, 3).join(', ')}…`).toEqual([]);
  });

  test('[EDT-148][EDT-149][EDT-150][EDT-151][EDT-152] onglets Enrollment history et Execution logs : colonnes, filtres, statuts et raisons en anglais (S-34) @defaut', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} english logs`, etapes());
    const client = await creerClient(bureau, 'Camille', `Smith ${marque}`);
    try {
      await semerTaches(bureau, r, client.id, [
        { status: 'pending', step_id: 'e2', dans_minutes: 60 * 24 * 30 },
        { status: 'failed', step_id: 'e1', dans_minutes: -60, last_error: 'No recipient phone', attempts: 2 },
      ]);
      await semerJournaux(bureau, r, client.id, [
        { action_type: 'send_sms', result_success: true, result_data: { to: '+15555550142', body: 'Hello Camille' }, il_y_a_minutes: 5 },
        { action_type: 'send_sms', result_success: true, result_data: { saute: 'client désabonné des textos' }, il_y_a_minutes: 6 },
        { action_type: 'send_email', result_success: false, result_error: 'No recipient email', il_y_a_minutes: 7 },
      ]);
      await ouvrirEditeur(page, r.id);
      await page.getByRole('tab', { name: 'Enrollment history' }).click();
      await expect(page.getByRole('columnheader')).toHaveText(['Contact', 'Current action', 'Status', 'Next execution', 'Completed on']);
      await expect(page.locator('tbody tr')).toHaveCount(2);
      await expect(page.locator('tbody tr').nth(1)).toContainText('this client has no phone number');
      await expect(page.locator('tbody tr').nth(1)).toContainText('2 attempts');
      const historique = await texteEditeur(page);
      const optionsHistorique = await page.getByLabel('Status').locator('option').allTextContents();

      await page.getByRole('tab', { name: 'Execution logs' }).click();
      await expect(page.getByRole('columnheader')).toHaveText(['Contact', 'Action', 'Status', 'Executed on']);
      await expect(page.locator('tbody tr[role="button"]')).toHaveCount(3);
      await expect(page.getByLabel('Status').locator('option')).toHaveText(['All statuses', 'Succeeded', 'Failed']);
      await expect(page.locator('tbody tr[role="button"]').nth(2)).toContainText('this client has no email address');
      await page.screenshot({ path: `${CAPTURES}/edt-en-logs.png` });
      const journaux = await texteEditeur(page);
      expect.soft(francais(historique), 'texte français dans Enrollment history').toEqual([]);
      expect.soft(francais(journaux), 'texte français dans Execution logs (motif du saut écrit en français par le moteur)').toEqual([]);
      expect(optionsHistorique[0], 'le filtre de STATUT s’intitule « All events »').toBe('All statuses');
    } finally {
      await supprimerClient(bureau, client.id);
    }
  });
});
