/**
 * Éditeur — l'onglet « Réglages » d'une automatisation.
 *
 * Ce que ce fichier prouve, pour CHAQUE interrupteur et chaque menu :
 *  · le changement est enregistré tout de suite dans `settings` (base), avec l'indicateur de l'onglet ;
 *  · après rechargement, l'écran relit exactement la base ;
 *  · revenir à la valeur par défaut retire la clé (et `settings` redevient vide) ;
 *  · un refus du serveur est dit, et l'écran revient à ce que la base contient ;
 *  · changer un réglage ne détruit pas les autres clés de `settings` (piste S-08 : `arreter_si_resolu: false`).
 */
import type { Page } from '@playwright/test';
import { lireRegle } from '../_outils/banc';
import {
  test, expect, DELAI_TEST, CAPTURES, creerParcours, troisTextos, ouvrirEditeur, attendreRegle, toasts, corpsDuFil } from './_aides';

test.describe.configure({ timeout: DELAI_TEST });

async function ouvrirReglages(page: Page, id: string): Promise<void> {
  await ouvrirEditeur(page, id);
  await page.getByRole('tab', { name: 'Réglages' }).click();
  await expect(page.getByRole('heading', { name: 'Réglages de cette automatisation' })).toBeVisible();
}
const etat = (page: Page) => page.getByText(/^(Enregistré|Enregistrement…)$/).last();
const inter = (page: Page, nom: string) => page.getByRole('switch', { name: nom });
const reglages = async (bureau: Parameters<typeof lireRegle>[0], id: string) => ((await lireRegle(bureau, id))?.settings ?? null) as Record<string, unknown> | null;

test.describe('onglet Réglages', () => {
  test('[EDT-140] à l’ouverture : tout est aux valeurs par défaut, « Enregistré », `settings` vide en base', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} réglages défaut`, troisTextos());
    await ouvrirReglages(page, r.id);
    for (const nom of ['Laisser le client repasser', 'Arrêter si le client répond', 'Jours ouvrables seulement']) {
      await expect(inter(page, nom)).toHaveAttribute('aria-checked', 'false');
    }
    await expect(page.getByLabel('Une fois par client tous les…')).toHaveValue('0');
    await expect(page.getByLabel('De', { exact: true })).toHaveValue('8');
    await expect(page.getByLabel('à', { exact: true })).toHaveValue('20');
    await expect(page.getByRole('button', { name: 'Revenir à 8 h – 20 h' })).toHaveCount(0);
    await expect(etat(page)).toHaveText('Enregistré');
    await page.screenshot({ path: `${CAPTURES}/edt-140-reglages.png` });
    expect(await reglages(bureau, r.id)).toBeNull();
  });

  for (const cas of [
    { id: 'EDT-141', nom: 'Laisser le client repasser', cle: 'reentree' },
    { id: 'EDT-142', nom: 'Arrêter si le client répond', cle: 'arret_sur_reponse' },
    { id: 'EDT-147', nom: 'Jours ouvrables seulement', cle: 'jours_ouvrables' },
  ]) {
    test(`[${cas.id}][EDT-140] « ${cas.nom} » : activé → base, relu après rechargement, désactivé → clé retirée`, async ({ page, bureau, marque }) => {
      const r = await creerParcours(bureau, `${marque} ${cas.cle}`, troisTextos());
      await ouvrirReglages(page, r.id);
      await inter(page, cas.nom).click();
      await expect(inter(page, cas.nom)).toHaveAttribute('aria-checked', 'true');
      await expect(etat(page)).toHaveText('Enregistré', { timeout: 60_000 });
      await attendreRegle(bureau, r.id, (x) => (x.settings as Record<string, unknown> | null)?.[cas.cle] === true, 60_000);
      expect(await reglages(bureau, r.id)).toEqual({ [cas.cle]: true });

      await page.reload();
      await expect(page.getByRole('tablist', { name: 'Sections' })).toBeVisible({ timeout: 90_000 });
      await page.getByRole('tab', { name: 'Réglages' }).click();
      await expect(inter(page, cas.nom)).toHaveAttribute('aria-checked', 'true');

      await inter(page, cas.nom).click();
      await expect(inter(page, cas.nom)).toHaveAttribute('aria-checked', 'false');
      await attendreRegle(bureau, r.id, (x) => x.settings === null, 60_000);
      // Les réglages ne touchent ni au parcours ni à la publication.
      expect(await corpsDuFil(bureau, r.id)).toEqual(['Texto ALPHA', 'Texto BRAVO', 'Texto CHARLIE']);
      expect((await lireRegle(bureau, r.id))?.is_active).toBe(false);
    });
  }

  test('[EDT-143] « Une fois par client tous les… » : chaque choix du menu s’écrit en base ; « Pas de limite » retire la clé', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} passages`, troisTextos());
    await ouvrirReglages(page, r.id);
    const menu = page.getByLabel('Une fois par client tous les…');
    await expect(menu.locator('option')).toHaveText(['Pas de limite', '1 jour', '3 jours', '7 jours', '14 jours', '30 jours', '90 jours']);
    for (const jours of [1, 7, 90]) {
      await menu.selectOption(String(jours));
      await attendreRegle(bureau, r.id, (x) => (x.settings as Record<string, unknown> | null)?.delai_entre_passages_jours === jours, 60_000);
    }
    await page.reload();
    await expect(page.getByRole('tablist', { name: 'Sections' })).toBeVisible({ timeout: 90_000 });
    await page.getByRole('tab', { name: 'Réglages' }).click();
    await expect(page.getByLabel('Une fois par client tous les…')).toHaveValue('90');
    await page.getByLabel('Une fois par client tous les…').selectOption('0');
    await attendreRegle(bureau, r.id, (x) => x.settings === null, 60_000);
  });

  test('[EDT-144][EDT-145][EDT-146] fenêtre d’envoi : début, fin, heures impossibles grisées, retour à 8 h – 20 h', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} fenêtre`, troisTextos());
    await ouvrirReglages(page, r.id);
    const de = page.getByLabel('De', { exact: true });
    const a = page.getByLabel('à', { exact: true });
    await expect(de.locator('option').first()).toHaveText('7 h');
    await expect(de.locator('option').last()).toHaveText('21 h');
    await expect(a.locator('option').first()).toHaveText('8 h');
    await expect(a.locator('option').last()).toHaveText('22 h');
    // Par défaut 8 h – 20 h : « De » ne peut pas dépasser 19 h, « à » ne peut pas descendre sous 9 h.
    await expect(de.locator('option[value="20"]')).toBeDisabled();
    await expect(de.locator('option[value="19"]')).toBeEnabled();
    await expect(a.locator('option[value="8"]')).toBeDisabled();
    await expect(a.locator('option[value="9"]')).toBeEnabled();

    /* Comparaison CHAMP PAR CHAMP : la base range les clés d'un `jsonb` à sa façon (« fin » avant « debut »),
       et comparer deux textes JSON attendait un ordre que rien ne garantit — le test ne voyait jamais
       l'enregistrement, pourtant fait. La fenêtre doit porter ces deux clés, et elles seules. */
    const fenetreEst = (x: Record<string, unknown>, debut: number, fin: number): boolean => {
      const f = (x.settings as { fenetre?: Record<string, unknown> } | null)?.fenetre;
      return !!f && f.debut === debut && f.fin === fin && Object.keys(f).length === 2;
    };
    await de.selectOption('10');
    await attendreRegle(bureau, r.id, (x) => fenetreEst(x, 10, 20), 60_000);
    expect(await reglages(bureau, r.id)).toEqual({ fenetre: { debut: 10, fin: 20 } });
    await a.selectOption('17');
    await attendreRegle(bureau, r.id, (x) => fenetreEst(x, 10, 17), 60_000);
    expect(await reglages(bureau, r.id)).toEqual({ fenetre: { debut: 10, fin: 17 } });
    await expect(de.locator('option[value="17"]')).toBeDisabled();
    await expect(a.locator('option[value="10"]')).toBeDisabled();

    await page.reload();
    await expect(page.getByRole('tablist', { name: 'Sections' })).toBeVisible({ timeout: 90_000 });
    await page.getByRole('tab', { name: 'Réglages' }).click();
    await expect(page.getByLabel('De', { exact: true })).toHaveValue('10');
    await expect(page.getByLabel('à', { exact: true })).toHaveValue('17');

    await page.getByRole('button', { name: 'Revenir à 8 h – 20 h' }).click();
    await expect(page.getByLabel('De', { exact: true })).toHaveValue('8');
    await expect(page.getByLabel('à', { exact: true })).toHaveValue('20');
    await expect(page.getByRole('button', { name: 'Revenir à 8 h – 20 h' })).toHaveCount(0);
    await attendreRegle(bureau, r.id, (x) => x.settings === null, 60_000);
  });

  test('[EDT-141][EDT-142][EDT-143][EDT-147] plusieurs réglages changés coup sur coup : la base finit avec TOUS, relus identiques', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} rafale`, troisTextos());
    await ouvrirReglages(page, r.id);
    await inter(page, 'Laisser le client repasser').click();
    await inter(page, 'Arrêter si le client répond').click();
    await page.getByLabel('Une fois par client tous les…').selectOption('14');
    await page.getByLabel('De', { exact: true }).selectOption('9');
    await inter(page, 'Jours ouvrables seulement').click();
    const voulu = { reentree: true, arret_sur_reponse: true, delai_entre_passages_jours: 14, fenetre: { debut: 9, fin: 20 }, jours_ouvrables: true };
    await attendreRegle(bureau, r.id, (x) => JSON.stringify(x.settings) !== 'null' && Object.keys(x.settings as object).length === 5, 90_000);
    expect(await reglages(bureau, r.id)).toEqual(voulu);
    await expect(etat(page)).toHaveText('Enregistré', { timeout: 60_000 });
    // Aller-retour par un autre onglet, puis rechargement : toujours les mêmes valeurs.
    await page.getByRole('tab', { name: 'Parcours' }).click();
    await page.getByRole('tab', { name: 'Réglages' }).click();
    await expect(inter(page, 'Laisser le client repasser')).toHaveAttribute('aria-checked', 'true');
    await page.reload();
    await expect(page.getByRole('tablist', { name: 'Sections' })).toBeVisible({ timeout: 90_000 });
    await page.getByRole('tab', { name: 'Réglages' }).click();
    await expect(inter(page, 'Laisser le client repasser')).toHaveAttribute('aria-checked', 'true');
    await expect(inter(page, 'Arrêter si le client répond')).toHaveAttribute('aria-checked', 'true');
    await expect(inter(page, 'Jours ouvrables seulement')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByLabel('Une fois par client tous les…')).toHaveValue('14');
    await expect(page.getByLabel('De', { exact: true })).toHaveValue('9');
    await expect(page.getByLabel('à', { exact: true })).toHaveValue('20');
    expect(await reglages(bureau, r.id)).toEqual(voulu);
  });

  test('[EDT-141] refus du serveur : le message est montré, l’interrupteur revient à ce que la base contient', async ({ page, bureau, marque, moniteur }) => {
    const r = await creerParcours(bureau, `${marque} réglage refusé`, troisTextos());
    await ouvrirReglages(page, r.id);
    moniteur.attendu(/500 PATCH .*\/api\/automations\/rules\//, 'panne simulée à l’enregistrement d’un réglage');
    moniteur.attendu(/\[OngletReglages\] réglages non enregistrés/, 'la panne simulée est journalisée');
    await page.route(`**/api/automations/rules/${r.id}`, (route) => (route.request().method() === 'PATCH'
      ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Impossible de modifier l\'automatisation.' }) })
      : route.continue()));
    await inter(page, 'Laisser le client repasser').click();
    await expect(toasts(page).filter({ hasText: 'Impossible de modifier l\'automatisation.' })).toBeVisible({ timeout: 30_000 });
    await expect(inter(page, 'Laisser le client repasser')).toHaveAttribute('aria-checked', 'false');
    expect(await reglages(bureau, r.id)).toBeNull();
  });

  test('[EDT-147] changer un réglage ne détruit pas `arreter_si_resolu: false` posé par le panneau du déclencheur (S-08)', async ({ page, bureau, marque }) => {
    // « Ne PAS arrêter quand le devis est accepté » : choix explicite de l'utilisateur, stocké à `false`.
    const r = await creerParcours(bureau, `${marque} s08`, troisTextos(), { settings: { arreter_si_resolu: false } });
    await ouvrirReglages(page, r.id);
    await inter(page, 'Jours ouvrables seulement').click();
    await attendreRegle(bureau, r.id, (x) => (x.settings as Record<string, unknown> | null)?.jours_ouvrables === true, 60_000);
    const apres = await reglages(bureau, r.id);
    expect(apres, 'basculer « Jours ouvrables » a effacé `arreter_si_resolu: false` : la sortie automatique redevient active sans que personne l’ait demandé')
      .toEqual({ arreter_si_resolu: false, jours_ouvrables: true });
  });

  test('[EDT-141] changer un réglage garde les autres clés VRAIES de `settings` (arreter_si_resolu: true)', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} garde clés`, troisTextos(), { settings: { arreter_si_resolu: true, reentree: true } });
    await ouvrirReglages(page, r.id);
    await expect(inter(page, 'Laisser le client repasser')).toHaveAttribute('aria-checked', 'true');
    await inter(page, 'Laisser le client repasser').click();
    await attendreRegle(bureau, r.id, (x) => (x.settings as Record<string, unknown> | null)?.reentree === undefined, 60_000);
    expect(await reglages(bureau, r.id)).toEqual({ arreter_si_resolu: true });
  });
});
