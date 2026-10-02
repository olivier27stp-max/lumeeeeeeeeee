/**
 * Publier une automatisation dont le DÉCLENCHEUR est incomplet, et la
 * cohérence déclencheur ↔ actions au moment de publier (S-09).
 *
 * Ce que ce fichier prouve :
 *  · un réglage obligatoire manquant (« Date atteinte » sans date, « Client
 *    inactif » sans nombre de mois) bloque la publication — à l'écran ET par
 *    l'API —, avec un message qui dit QUOI corriger ; rien n'est publié ;
 *  · une fois le réglage rempli, la publication passe ;
 *  · ce que l'éditeur laisse bâtir doit pouvoir se publier, et ce qui ne peut
 *    pas marcher ne doit pas être offert (compatibilité déclencheur ↔ action).
 */
import type { Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { test, expect, creerRegle, lireRegle, appelApi, attendre } from '../_outils/banc';
import {
  BASE, donnees, ouvrirEditeur, carteDeclencheur, panneauDeclencheur, ETAPE_NOTIF, ouvrirPanneauDeclencheur,
  enregistrerPanneauDeclencheur, champParLibelle,
} from './_donnees';

test.afterEach(async ({ context }) => { await context.unrouteAll({ behavior: 'ignoreErrors' }); });

const interrupteur = (page: Page) => page.getByRole('switch', { name: 'Publier l’automatisation' });
// Depuis #859, le bandeau accorde le nombre : « 1 chose à corriger… », « 2 choses à corriger… » (plus de « chose(s) »).
const TITRE_BANDEAU = /^\d+ choses? à corriger avant de publier$/;
const bandeau = (page: Page) => page.getByText(TITRE_BANDEAU).locator('xpath=..');
const dialogue = (page: Page) => page.getByRole('dialog');
const MSG_DATE = '« Date atteinte » : « Quelle date surveiller » doit être rempli, sinon l’automatisation ne partirait jamais.';

/** Les appels de publication partis pendant le test. */
function compterPublications(page: Page): string[] {
  const liste: string[] = [];
  page.on('request', (q) => { if (/\/publication$/.test(q.url())) liste.push(q.postData() ?? ''); });
  return liste;
}

test.describe('publier avec un déclencheur incomplet', () => {
  test('[EDT-018][EDT-072][DEC-25] « Date atteinte » sans date choisie : le bandeau l’annonce, l’interrupteur refuse en disant quoi corriger, rien n’est publié', async ({ page, bureau, marque }) => {
    await donnees(bureau);
    const regle = await creerRegle(bureau, bureau.orgA, { name: `${marque} pub date`, trigger_event: 'date.reached', conditions: {}, steps: ETAPE_NOTIF });
    await ouvrirEditeur(page, regle.id);
    const publications = compterPublications(page);

    // Avant même de cliquer : le bandeau rouge dit ce qui manque.
    await expect(page.getByText('1 chose à corriger avant de publier', { exact: true })).toBeVisible();
    await expect(bandeau(page)).toContainText(MSG_DATE);
    await expect(carteDeclencheur(page)).toContainText('⚠ Quelle date surveiller à choisir');
    await expect(interrupteur(page)).toHaveAttribute('aria-checked', 'false');

    await interrupteur(page).click();
    // Le refus : un message d'erreur qui nomme le déclencheur ET le champ à remplir ; pas de question « Publier ? ».
    const toast = page.locator('[data-sonner-toast]').filter({ hasText: 'Quelle date surveiller' });
    await expect(toast).toBeVisible();
    await expect(toast).toContainText(MSG_DATE);
    await expect(dialogue(page)).toHaveCount(0);
    await expect(interrupteur(page)).toHaveAttribute('aria-checked', 'false');
    await expect(page.getByText('Brouillon', { exact: true })).toBeVisible();
    expect(publications, 'aucun appel de publication n’est parti').toEqual([]);
    expect((await lireRegle(bureau, regle.id))?.is_active).toBe(false);
  });

  test('[EDT-018][DEC-25] par l’API aussi, « Date atteinte » sans date est refusée (422) avec le même message ; rien n’est publié', async ({ bureau, marque, jetonDe }) => {
    const regle = await creerRegle(bureau, bureau.orgA, { name: `${marque} pub api`, trigger_event: 'date.reached', conditions: { jours_avant: 7 }, steps: ETAPE_NOTIF });
    const r = await appelApi(BASE, await jetonDe('proprioA'), bureau.orgA, 'POST', `/api/automations/rules/${regle.id}/publication`, { actif: true });
    expect(r.status).toBe(422);
    expect((r.json as { error?: string }).error).toBe(`Publication refusée : ${MSG_DATE}`);
    expect((await lireRegle(bureau, regle.id))?.is_active).toBe(false);
  });

  test('[EDT-018][EDT-022][DEC-25] dans le bandeau, le problème du déclencheur se clique et ouvre ses réglages (comme un problème d’étape ouvre l’étape) @defaut', async ({ page, bureau, marque }) => {
    await donnees(bureau);
    const regle = await creerRegle(bureau, bureau.orgA, { name: `${marque} pub clic`, trigger_event: 'date.reached', conditions: {}, steps: ETAPE_NOTIF });
    await ouvrirEditeur(page, regle.id);
    await expect(bandeau(page)).toContainText(MSG_DATE);
    // « Une erreur qu'on peut cliquer se corrige » : le message du déclencheur doit mener à son panneau.
    await bandeau(page).getByRole('button', { name: MSG_DATE }).click({ timeout: 5_000 });
    await expect(panneauDeclencheur(page)).toBeVisible();
  });

  test('[EDT-018][EDT-074][DEC-25] une fois la date choisie, le bandeau disparaît et la publication passe (question, confirmation, « Publiée », base à jour)', async ({ page, bureau, marque }) => {
    const d = await donnees(bureau);
    const regle = await creerRegle(bureau, bureau.orgA, { name: `${marque} pub ok`, trigger_event: 'date.reached', conditions: {}, steps: ETAPE_NOTIF });
    await ouvrirEditeur(page, regle.id);
    await expect(bandeau(page)).toContainText(MSG_DATE);
    const panneau = await ouvrirPanneauDeclencheur(page);
    await champParLibelle(panneau, 'Quelle date surveiller').selectOption({ label: 'Client · QA Date' });
    await enregistrerPanneauDeclencheur(page);
    await expect(page.getByText(/à corriger avant de publier/)).toHaveCount(0);

    await interrupteur(page).click();
    await expect(dialogue(page)).toBeVisible();
    await expect(dialogue(page)).toContainText('Publier cette automatisation ?');
    // Le parcours ne fait que du travail interne : la question le dit, sans promettre de « vrais messages ».
    await expect(dialogue(page)).toContainText('Elle se déclenchera dès le prochain événement — pour du travail interne seulement.');
    await expect(dialogue(page)).toContainText('⚠ Aucun message ne part au client : cette automatisation ne fait que du travail interne.');
    await dialogue(page).getByRole('button', { name: 'Publier', exact: true }).click();
    await expect(page.getByText('Automatisation publiée')).toBeVisible();
    await expect(interrupteur(page)).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByText('Publiée', { exact: true })).toBeVisible();
    const ligne = await attendre(() => lireRegle(bureau, regle.id), (r) => r?.is_active === true);
    expect(ligne?.conditions).toEqual({ champ_id: d.champs.qa_date.id });

    // Retour en brouillon (rien n'a pu partir : bureau en bac à sable, et « Date atteinte » ne part que par le balayage quotidien).
    await interrupteur(page).click();
    await expect(page.getByText('Repassée en brouillon')).toBeVisible();
    expect((await attendre(() => lireRegle(bureau, regle.id), (r) => r?.is_active === false))?.is_active).toBe(false);
  });

  test('[EDT-018][EDT-082][DEC-25] « Date atteinte » sur un champ date SUPPRIMÉ : la publication est refusée (la règle ne partirait jamais)', async ({ page, bureau, marque }) => {
    await donnees(bureau);
    const regle = await creerRegle(bureau, bureau.orgA, {
      name: `${marque} pub champ mort`, trigger_event: 'date.reached', conditions: { champ_id: randomUUID(), jours_avant: 7 }, steps: ETAPE_NOTIF,
    });
    await ouvrirEditeur(page, regle.id);
    await expect(carteDeclencheur(page)).toContainText('champ supprimé');
    await interrupteur(page).click();
    try {
      // La carte dit « champ supprimé » : publier doit être refusé, pas proposé.
      await expect(page.locator('[data-sonner-toast]').filter({ hasText: /date|champ/i })).toBeVisible({ timeout: 6_000 });
      await expect(dialogue(page)).toHaveCount(0);
    } finally {
      const annuler = dialogue(page).getByRole('button', { name: 'Annuler', exact: true });
      if (await annuler.isVisible().catch(() => false)) await annuler.click();
    }
    expect((await lireRegle(bureau, regle.id))?.is_active).toBe(false);
  });
});

test.describe('publier avec un déclencheur incomplet — bureau aux drapeaux actifs', () => {
  test.use({ compte: 'proprioB' });

  test('[EDT-018][EDT-072][DEC-20] « Client inactif » sans nombre de mois : bandeau, refus qui dit quoi remplir, rien n’est publié', async ({ page, bureau, marque }) => {
    await donnees(bureau);
    const regle = await creerRegle(bureau, bureau.orgB, { name: `${marque} pub inactif`, trigger_event: 'client.inactive', conditions: { max_par_heure: 25 }, steps: ETAPE_NOTIF });
    await ouvrirEditeur(page, regle.id);
    const publications = compterPublications(page);
    const message = '« Client inactif » : « Aucun job terminé depuis (mois) » doit être rempli, sinon l’automatisation ne partirait jamais.';
    await expect(bandeau(page)).toContainText(message);
    await expect(carteDeclencheur(page)).toContainText('⚠ Aucun job terminé depuis (mois) à choisir');
    await interrupteur(page).click();
    await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'Aucun job terminé depuis (mois)' })).toContainText(message);
    await expect(dialogue(page)).toHaveCount(0);
    expect(publications).toEqual([]);
    expect((await lireRegle(bureau, regle.id))?.is_active).toBe(false);
  });
});

test.describe('compatibilité déclencheur ↔ actions (S-09)', () => {
  test('[EDT-018][DEC-25] « Date atteinte » sur un champ date du PIPELINE + « Assigner l’opportunité » : ce que le tiroir et le panneau acceptent se publie (pas de bandeau rouge contradictoire)', async ({ page, bureau, marque }) => {
    const d = await donnees(bureau);
    const regle = await creerRegle(bureau, bureau.orgA, {
      name: `${marque} S-09 pipeline`, trigger_event: 'date.reached', conditions: { champ_id: d.champs.qa_deal_date.id, jours_avant: 3 },
      steps: [{ id: 'e1', type: 'action', action: { type: 'assigner_deal', config: { membre_id: bureau.comptes.proprioA.id } }, suivant: null }],
    });
    await ouvrirEditeur(page, regle.id);
    await expect(carteDeclencheur(page)).toContainText('Pipeline · QA Date de relance');

    // Le tiroir d'actions OFFRE « Assigner l'opportunité » (la date surveillée est celle d'une opportunité)…
    await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
    const tiroir = page.getByRole('complementary', { name: 'Actions', exact: true });
    await expect(tiroir.getByRole('button', { name: /^Assigner l’opportunité/ })).toBeEnabled();
    await tiroir.getByRole('button', { name: 'Fermer', exact: true }).click();
    // … et le panneau de l'étape ne lui reproche rien.
    await page.getByRole('button', { name: /^Assigner l’opportunité/ }).click();
    const etape = page.getByRole('complementary', { name: 'Modifier l’étape' });
    await expect(etape.getByRole('button', { name: 'Enregistrer', exact: true })).toBeEnabled();
    await expect(etape.getByText(/ne peut pas suivre ce déclencheur/)).toHaveCount(0);
    await etape.getByRole('button', { name: 'Annuler', exact: true }).click();

    // Donc : aucun bandeau rouge, et l'interrupteur propose de publier.
    await expect.soft(page.getByText(/ne peut pas suivre ce déclencheur/), 'bandeau contradictoire').toHaveCount(0);
    await interrupteur(page).click();
    try {
      await expect(dialogue(page)).toContainText('Publier cette automatisation ?', { timeout: 6_000 });
    } finally {
      const annuler = dialogue(page).getByRole('button', { name: 'Annuler', exact: true });
      if (await annuler.isVisible().catch(() => false)) await annuler.click();
    }
  });

  test('[EDT-018][DEC-25] le serveur accepte de publier « Date atteinte » (champ du pipeline) + « Assigner l’opportunité » : c’est bien une opportunité que ce déclencheur fait arriver', async ({ bureau, marque, jetonDe }) => {
    const d = await donnees(bureau);
    const regle = await creerRegle(bureau, bureau.orgA, {
      name: `${marque} S-09 api`, trigger_event: 'date.reached', conditions: { champ_id: d.champs.qa_deal_date.id, jours_avant: 3 },
      steps: [{ id: 'e1', type: 'action', action: { type: 'assigner_deal', config: { membre_id: bureau.comptes.proprioA.id } }, suivant: null }],
    });
    const r = await appelApi(BASE, await jetonDe('proprioA'), bureau.orgA, 'POST', `/api/automations/rules/${regle.id}/publication`, { actif: true });
    expect(r.status, `réponse : ${JSON.stringify(r.json).slice(0, 200)}`).toBe(200);
  });

  test('[DEC-24] « Appel reçu de l’extérieur » n’apporte ni facture, ni devis, ni rendez-vous, ni opportunité : les actions qui en ont besoin sont grisées, avec la raison', async ({ page, bureau, marque }) => {
    await donnees(bureau);
    const regle = await creerRegle(bureau, bureau.orgA, { name: `${marque} S-09 webhook`, trigger_event: 'webhook.received', conditions: {}, steps: ETAPE_NOTIF });
    await ouvrirEditeur(page, regle.id);
    await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
    const tiroir = page.getByRole('complementary', { name: 'Actions', exact: true });
    await expect(tiroir).toBeVisible();
    // Témoin : une action sans contrainte reste offerte.
    await expect(tiroir.getByRole('button', { name: /^Envoyer un texto/ })).toBeEnabled();
    for (const action of ['Envoyer la facture', 'Envoyer le devis', 'Changer le statut du rendez-vous', 'Déplacer l’opportunité', 'Modifier l’opportunité', 'Assigner l’opportunité']) {
      const item = tiroir.getByRole('button', { name: new RegExp(`^${action}`) });
      await expect.soft(item, `« ${action} » après un appel de l’extérieur`).toBeDisabled();
      // « avec la raison » : elle est écrite sous le nom de l'action, à la place de son aide.
      await expect.soft(item, `la raison écrite sous « ${action} »`).toContainText('Ne va pas avec ce déclencheur');
    }
  });
});
