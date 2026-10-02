/**
 * Éditeur — la pause globale du bureau (« Tout arrêter », posée depuis la liste).
 *
 * Ce que ce fichier prouve : quand le bureau a tout mis en pause, l'éditeur d'une automatisation
 * PUBLIÉE ne peut pas afficher « Publiée » en vert sans un mot — rien ne part (piste S-32).
 * La pause est posée en base pour le bureau de test, puis TOUJOURS levée en fin de test.
 */
import { ouvrirListe } from '../_outils/banc';
import {
  test, expect, DELAI_TEST, CAPTURES, creerParcours, troisTextos, ouvrirEditeur } from './_aides';

test.describe.configure({ timeout: DELAI_TEST });

test.describe('pause globale du bureau', () => {
  test.afterEach(async ({ bureau }) => {
    await bureau.admin.from('company_settings')
      .update({ automations_paused: false, automations_paused_at: null, automations_paused_by: null }).eq('org_id', bureau.orgA);
  });

  test('[EDT-018][EDT-019] bureau en pause : l’éditeur d’une automatisation publiée le signale (S-32)', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} pause globale`, troisTextos(), { is_active: true });
    const { data: pose, error } = await bureau.admin.from('company_settings')
      .update({ automations_paused: true, automations_paused_at: new Date().toISOString(), automations_paused_by: bureau.comptes.proprioA.id })
      .eq('org_id', bureau.orgA).select('org_id');
    expect(error).toBeNull();
    expect((pose ?? []).length, 'le bureau de test a bien une ligne company_settings').toBe(1);

    // Témoin : la liste, elle, le dit.
    await ouvrirListe(page);
    await expect(page.getByText('Vos automatisations sont en pause.')).toBeVisible({ timeout: 60_000 });

    await ouvrirEditeur(page, r.id);
    await expect(page.getByText('Publiée', { exact: true })).toBeVisible();
    await page.screenshot({ path: `${CAPTURES}/edt-s32-pause-globale.png` });
    await expect(page.locator('div.fixed.inset-0.z-50').getByText(/en pause|tout arrêt|suspendu/i).first(),
      '« Publiée » en vert alors que le bureau a tout mis en pause : rien ne dit que cette automatisation n’envoie plus rien').toBeVisible({ timeout: 4000 });
  });
});
