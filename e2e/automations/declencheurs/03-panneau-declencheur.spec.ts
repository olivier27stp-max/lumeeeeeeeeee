/**
 * Le panneau de réglage du déclencheur (EDT-064 à EDT-074) et ses champs
 * (EDT-076 choix, EDT-077 nombre, EDT-081 étape, EDT-082 champ date,
 * EDT-083 service, EDT-084 étiquette, EDT-066/067/107 « Champ modifié »).
 *
 * Ce que ce fichier prouve :
 *  · « Annuler » et la croix n'écrivent rien ; « Changer de déclencheur… » mène au tiroir ;
 *  · les listes sont remplies avec les données DU BUREAU (étapes du pipeline,
 *    champs date, services, étiquettes, champs personnalisés par objet) ;
 *  · chaque champ : vide, valide, invalide, trop long, accents, émojis, caractères spéciaux ;
 *  · « Champ personnalisé modifié » : chaque type de champ donne la forme que le moteur compare ;
 *  · changer de déclencheur ne doit PAS garder les réglages de l'ancien (S-02) ;
 *  · bureau aux drapeaux actifs : compteur de « Client inactif », case « Arrêter si… ».
 */
import type { Locator, Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { test, expect, creerRegle, lireRegle, appelApi } from '../_outils/banc';
import {
  BASE, donnees, ouvrirEditeur, carteDeclencheur, tiroirDeclencheurs, panneauDeclencheur, ouvrirTiroirDeclencheurs,
  ETAPE_NOTIF, ecritureRegle, compterEcritures, ouvrirPanneauDeclencheur, enregistrerPanneauDeclencheur,
  champParLibelle, valeurAffichee, optionsDe, ETIQUETTES, champsDuBureau, ecartAvecLOrdreDuBureau, etiquettesDuBureau,
} from './_donnees';
import { FILTRE_A, FILTRE_SANS } from './_catalogue';

test.afterEach(async ({ context }) => { await context.unrouteAll({ behavior: 'ignoreErrors' }); });

/**
 * Clique « Enregistrer » sur une saisie que le produit DEVRAIT refuser, et attend l'issue :
 * la réponse du serveur si une écriture part, ou `null` si le panneau l'a retenue de lui-même.
 */
async function tenterEnregistrement(page: Page): Promise<number | null> {
  const ecriture = page.waitForResponse(
    (s) => s.request().method() === 'PATCH' && /\/api\/automations\/rules\/[0-9a-f-]{36}$/.test(s.url()), { timeout: 8_000 },
  ).then((r) => r.status(), () => null);
  await panneauDeclencheur(page).getByRole('button', { name: 'Enregistrer', exact: true }).click();
  return ecriture;
}

/**
 * Le refus d'une saisie invalide, tel que le panneau du DÉCLENCHEUR le fait (règle tranchée le 2026-10-02) :
 * « Enregistrer » reste cliquable, le clic n'envoie RIEN au serveur, le panneau reste ouvert et dit quoi
 * corriger — `message` est la phrase exacte, borne comprise. Aucun 4xx n'est donc à déclarer au moniteur.
 */
async function attendreRefusDansLePanneau(page: Page, message: string): Promise<void> {
  const panneau = panneauDeclencheur(page);
  expect(await tenterEnregistrement(page), `« Enregistrer » cliqué : aucune écriture ne part (${message})`).toBeNull();
  await expect(panneau, 'le panneau reste ouvert sur la saisie refusée').toBeVisible();
  const refus = panneau.getByRole('alert');
  await expect(refus).toContainText('À corriger avant d’enregistrer :');
  await expect(refus).toContainText(message);
  await expect(page.getByText('Réglages enregistrés', { exact: true })).toHaveCount(0);
}

test.describe('panneau du déclencheur — fermer, annuler, changer, enregistrer', () => {
  test('[EDT-064][EDT-073] « Annuler » et la croix ferment le panneau sans rien écrire ; rouvert, il montre ce qui est enregistré', async ({ page, bureau, marque }) => {
    await donnees(bureau);
    const regle = await creerRegle(bureau, bureau.orgA, { name: `${marque} annuler`, trigger_event: 'client.tagged', conditions: { tag: 'VIP' }, steps: ETAPE_NOTIF });
    await ouvrirEditeur(page, regle.id);
    const ecritures = compterEcritures(page);

    for (const sortie of ['Annuler', 'Fermer'] as const) {
      const panneau = await ouvrirPanneauDeclencheur(page);
      const champ = champParLibelle(panneau, 'Quelle étiquette');
      await expect(champ).toHaveValue('VIP');
      await champ.fill('Saisie abandonnée');
      await panneau.getByRole('button', { name: sortie, exact: true }).click();
      await expect(panneau).toBeHidden();
      await expect(carteDeclencheur(page)).toContainText('Quelle étiquette : VIP');
    }
    expect(ecritures.liste).toEqual([]);
    expect((await lireRegle(bureau, regle.id))?.conditions).toEqual({ tag: 'VIP' });
    // Rouvert : la saisie abandonnée n'est pas restée dans le champ.
    const panneau = await ouvrirPanneauDeclencheur(page);
    await expect(champParLibelle(panneau, 'Quelle étiquette')).toHaveValue('VIP');
  });

  test('[EDT-064][EDT-073] fermer le panneau avec une saisie non enregistrée demande confirmation, comme le panneau d’étape @defaut', async ({ page, bureau, marque }) => {
    await donnees(bureau);
    const regle = await creerRegle(bureau, bureau.orgA, { name: `${marque} confirmer`, trigger_event: 'client.tagged', conditions: { tag: 'VIP' }, steps: ETAPE_NOTIF });
    await ouvrirEditeur(page, regle.id);
    const panneau = await ouvrirPanneauDeclencheur(page);
    await champParLibelle(panneau, 'Quelle étiquette').fill('Travail en cours 🌞');
    await panneau.getByRole('button', { name: 'Fermer', exact: true }).click();
    // Le panneau d'étape pose la question (« Fermer sans enregistrer ? ») ; celui du déclencheur doit faire de même.
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole('dialog')).toContainText('Fermer sans enregistrer ?');
  });

  test('[EDT-065] « Changer de déclencheur… » ferme le panneau et ouvre le tiroir ; refermer le tiroir ramène au canevas, sans rien écrire', async ({ page, bureau, marque }) => {
    await donnees(bureau);
    const regle = await creerRegle(bureau, bureau.orgA, { name: `${marque} changer`, trigger_event: 'client.tagged', conditions: { tag: 'VIP' }, steps: ETAPE_NOTIF });
    await ouvrirEditeur(page, regle.id);
    const ecritures = compterEcritures(page);
    const panneau = await ouvrirPanneauDeclencheur(page);
    await panneau.getByRole('button', { name: 'Changer de déclencheur…', exact: true }).click();
    await expect(panneau).toBeHidden();
    await expect(tiroirDeclencheurs(page)).toBeVisible();
    await tiroirDeclencheurs(page).getByRole('button', { name: 'Fermer', exact: true }).click();
    await expect(tiroirDeclencheurs(page)).toBeHidden();
    await expect(panneau).toBeHidden();
    expect(ecritures.liste).toEqual([]);
    expect((await lireRegle(bureau, regle.id))?.trigger_event).toBe('client.tagged');
  });

  test('[EDT-074] deux clics rapprochés sur « Enregistrer » = UNE seule écriture ; le bouton montre que ça enregistre @defaut', async ({ page, bureau, marque }) => {
    await donnees(bureau);
    const regle = await creerRegle(bureau, bureau.orgA, { name: `${marque} double clic`, trigger_event: 'client.tagged', conditions: {}, steps: ETAPE_NOTIF });
    await ouvrirEditeur(page, regle.id);
    const ecritures = compterEcritures(page);
    // L'enregistrement est retenu le temps d'observer le bouton et de recliquer.
    let relacher: () => void = () => undefined;
    const retenue = new Promise<void>((r) => { relacher = r; });
    await page.route(/\/api\/automations\/rules\/[0-9a-f-]{36}$/, async (route) => {
      if (route.request().method() === 'PATCH') await retenue;
      await route.continue();
    });
    const panneau = await ouvrirPanneauDeclencheur(page);
    await champParLibelle(panneau, 'Quelle étiquette').fill('VIP');
    const bouton = panneau.getByRole('button', { name: 'Enregistrer', exact: true });
    await bouton.click();
    try {
      // Pendant l'appel : le bouton est désactivé (ou annonce l'enregistrement) — on ne peut pas recliquer.
      await expect(bouton, 'le bouton est désactivé pendant l’enregistrement').toBeDisabled({ timeout: 3_000 });
    } finally {
      await bouton.click({ force: true }).catch(() => undefined);
      relacher();
    }
    await expect(panneau).toBeHidden();
    expect(ecritures.liste.filter((e) => e.startsWith('PATCH'))).toHaveLength(1);
  });
});

test.describe('panneau du déclencheur — les listes viennent du bureau', () => {
  test('[EDT-072][EDT-082][DEC-25] « Date atteinte » : la liste offre les champs DATE du client et du pipeline du bureau, et eux seuls ; sans date choisie, le panneau et la carte le disent', async ({ page, bureau, marque }) => {
    await donnees(bureau);
    const regle = await creerRegle(bureau, bureau.orgA, { name: `${marque} date`, trigger_event: 'date.reached', conditions: {}, steps: ETAPE_NOTIF });
    await ouvrirEditeur(page, regle.id);
    await expect(carteDeclencheur(page)).toContainText('⚠ Quelle date surveiller à choisir');
    const panneau = await ouvrirPanneauDeclencheur(page);
    const date = champParLibelle(panneau, 'Quelle date surveiller');

    // Les champs date du bureau, relus en base à l'instant (un autre lot peut y avoir créé les siens) : fiche client
    // d'abord, pipeline ensuite, chacun dans l'ordre du bureau ; aucun autre type, aucun autre objet, rien d'étranger au bureau.
    const duBureau = await champsDuBureau(bureau, bureau.orgA);
    const dates = [...duBureau.filter((c) => c.object_type === 'client'), ...duBureau.filter((c) => c.object_type === 'deal')]
      .filter((c) => c.field_type === 'date');
    const attendues = dates.map((c) => `${c.object_type === 'client' ? 'Client' : 'Pipeline'} · ${c.label}`);
    // Les trois dates de ce lot en font partie, dans cet ordre.
    const DU_LOT = ['Client · QA Date', 'Client · QA Date et heure', 'Pipeline · QA Date de relance'];
    expect(attendues.filter((l) => DU_LOT.includes(l))).toEqual(DU_LOT);
    // Témoin : le bureau porte bien d'autres types de champs et d'autres objets — c'est eux que la liste écarte.
    expect(duBureau.some((c) => c.field_type !== 'date' && c.object_type === 'client')).toBe(true);
    expect(duBureau.some((c) => c.object_type !== 'client' && c.object_type !== 'deal')).toBe(true);
    await expect.poll(() => optionsDe(date)).toEqual(['— Choisir une date —', ...attendues]);
    await expect(panneau.getByText('Un champ date du client (fin de contrat, garantie) ou du pipeline (date de fermeture prévue — deals ouverts seulement).')).toBeVisible();

    // Sans date : l'avertissement dit quoi remplir. Il disparaît dès qu'une date est choisie.
    const alerte = panneau.getByText('Sans « Quelle date surveiller », l’automatisation ne partirait jamais.');
    await expect(alerte).toBeVisible();
    await date.selectOption({ label: 'Pipeline · QA Date de relance' });
    await expect(alerte).toBeHidden();
    await date.selectOption({ label: '— Choisir une date —' });
    await expect(alerte).toBeVisible();

    // Enregistrer vide reste permis (brouillon) : rien n'est inventé en base, et la carte garde son signal.
    await enregistrerPanneauDeclencheur(page);
    expect((await lireRegle(bureau, regle.id))?.conditions).toEqual({});
    await expect(carteDeclencheur(page)).toContainText('⚠ Quelle date surveiller à choisir');
  });

  test('[EDT-082][DEC-25] le champ date surveillé a été supprimé : la carte le dit', async ({ page, bureau, marque }) => {
    await donnees(bureau);
    const regle = await creerRegle(bureau, bureau.orgA, {
      name: `${marque} date supprimée`, trigger_event: 'date.reached', conditions: { champ_id: randomUUID(), jours_avant: 7 }, steps: ETAPE_NOTIF,
    });
    await ouvrirEditeur(page, regle.id);
    await expect(carteDeclencheur(page)).toContainText('champ supprimé');
    await expect(carteDeclencheur(page)).toContainText('Combien de jours avant : 7');
  });

  test('[EDT-082][EDT-072][DEC-25] le champ date surveillé a été supprimé : le PANNEAU le dit aussi (au lieu d’afficher « — Choisir une date — » sans un mot) @defaut', async ({ page, bureau, marque }) => {
    await donnees(bureau);
    const regle = await creerRegle(bureau, bureau.orgA, {
      name: `${marque} date supprimée panneau`, trigger_event: 'date.reached', conditions: { champ_id: randomUUID(), jours_avant: 7 }, steps: ETAPE_NOTIF,
    });
    await ouvrirEditeur(page, regle.id);
    const panneau = await ouvrirPanneauDeclencheur(page);
    await expect(champParLibelle(panneau, 'Combien de jours avant')).toHaveValue('7');
    // La règle porte un champ qui n'existe plus : elle ne partira jamais. Le panneau doit le dire
    // (message « n'existe plus », ou l'avertissement « Sans « Quelle date surveiller »… »).
    await expect(panneau.getByText(/n’existe plus|supprimé|Sans « Quelle date surveiller »/)).toBeVisible({ timeout: 5_000 });
  });

  test('[EDT-081][DEC-26] « Quelle étape » offre les étapes du pipeline du bureau, dans l’ordre, préfixées du nom du pipeline', async ({ page, bureau, marque }) => {
    const d = await donnees(bureau);
    const regle = await creerRegle(bureau, bureau.orgA, { name: `${marque} étapes`, trigger_event: 'deal.stage_entered', conditions: {}, steps: ETAPE_NOTIF });
    await ouvrirEditeur(page, regle.id);
    const panneau = await ouvrirPanneauDeclencheur(page);
    const etape = champParLibelle(panneau, 'Quelle étape');
    expect(d.etapes.length).toBeGreaterThanOrEqual(5);
    await expect.poll(() => optionsDe(etape)).toEqual(['— Toutes les étapes —', ...d.etapes.map((e) => `${d.pipeline.name} · ${e.name_fr}`)]);
    await expect(panneau.getByText('Laissez vide pour toutes les étapes, ou choisissez celle qui déclenche.')).toBeVisible();
    // Vide = toutes les étapes : rien en base, rien sous la carte.
    await enregistrerPanneauDeclencheur(page);
    expect((await lireRegle(bureau, regle.id))?.conditions).toEqual({});
  });

  test('[EDT-081][DEC-26] l’étape visée a été supprimée : la carte dit « étape supprimée » et le PANNEAU le signale (au lieu d’afficher « — Toutes les étapes — ») @defaut', async ({ page, bureau, marque }) => {
    await donnees(bureau);
    const regle = await creerRegle(bureau, bureau.orgA, {
      name: `${marque} étape supprimée`, trigger_event: 'deal.stage_entered', conditions: { stage_id: randomUUID() }, steps: ETAPE_NOTIF,
    });
    await ouvrirEditeur(page, regle.id);
    await expect(carteDeclencheur(page)).toContainText('étape supprimée');
    const panneau = await ouvrirPanneauDeclencheur(page);
    // En base, la règle vise une étape disparue : elle ne partira plus. Le menu ne doit pas faire croire « Toutes les étapes ».
    await expect(panneau.getByText(/n’existe plus|supprimée/)).toBeVisible({ timeout: 5_000 });
  });

  test('[EDT-083][DEC-02] « Contient le service » offre les services du catalogue du bureau', async ({ page, bureau, marque }) => {
    const d = await donnees(bureau);
    const regle = await creerRegle(bureau, bureau.orgA, { name: `${marque} services`, trigger_event: 'quote.viewed', conditions: { ouverture: 'premiere' }, steps: ETAPE_NOTIF });
    await ouvrirEditeur(page, regle.id);
    const panneau = await ouvrirPanneauDeclencheur(page);
    const { data: actifs } = await bureau.admin.from('predefined_services').select('name').eq('org_id', bureau.orgA).eq('is_active', true).order('sort_order').order('name');
    expect((actifs ?? []).map((s) => s.name)).toEqual(expect.arrayContaining(d.services.map((s) => s.name)));
    await expect.poll(() => optionsDe(champParLibelle(panneau, 'Contient le service')))
      .toEqual(['— N’importe quel service —', ...(actifs ?? []).map((s) => s.name as string)]);
    // Et les étapes du pipeline pour « L'opportunité est à l'étape ».
    await expect.poll(() => optionsDe(champParLibelle(panneau, 'L’opportunité est à l’étape')))
      .toEqual(['— Toutes les étapes —', ...d.etapes.map((e) => `${d.pipeline.name} · ${e.name_fr}`)]);
  });

  test('[EDT-084][DEC-18] les champs « étiquette » proposent les étiquettes du bureau ; vide ou espaces = pas de filtre ; accents, émojis et caractères spéciaux sont gardés tels quels', async ({ page, bureau, marque }) => {
    await donnees(bureau);
    const regle = await creerRegle(bureau, bureau.orgA, { name: `${marque} étiquettes`, trigger_event: 'client.tagged', conditions: {}, steps: ETAPE_NOTIF });
    await ouvrirEditeur(page, regle.id);
    let panneau = await ouvrirPanneauDeclencheur(page);

    // Suggestions : les étiquettes réellement posées sur les clients du bureau — toutes, triées, sans doublon, et aucune
    // qui n'y soit pas. Relues en base à l'instant : un autre lot peut y avoir posé les siennes (« VIP QA »…).
    const duBureau = await etiquettesDuBureau(bureau, bureau.orgA);
    expect(duBureau, 'les étiquettes de ce lot sont posées dans le bureau').toEqual(expect.arrayContaining(ETIQUETTES));
    for (const libelle of ['Quelle étiquette', FILTRE_A.fr, FILTRE_SANS.fr]) {
      const champ = champParLibelle(panneau, libelle);
      const liste = await champ.getAttribute('list');
      expect(liste, `« ${libelle} » a une liste de suggestions`).toBeTruthy();
      await expect.poll(() => page.locator(`[id="${liste}"] option`).evaluateAll((o) => o.map((x) => x.getAttribute('value'))), { timeout: 30_000 })
        .toEqual(duBureau);
    }

    // Espaces seuls = vide : aucune clé écrite.
    await champParLibelle(panneau, 'Quelle étiquette').fill('   ');
    await champParLibelle(panneau, FILTRE_A.fr).fill('');
    await enregistrerPanneauDeclencheur(page);
    expect((await lireRegle(bureau, regle.id))?.conditions).toEqual({});

    // Accents, émoji, guillemets, chevrons, esperluette, apostrophe : gardés tels quels, et redits tels quels.
    const penible = 'Été 🌞 « spécial » & <b>l’"ami"</b>';
    panneau = await ouvrirPanneauDeclencheur(page);
    await champParLibelle(panneau, 'Quelle étiquette').fill(penible);
    await champParLibelle(panneau, FILTRE_SANS.fr).fill('  Ne pas relancer  ');
    await enregistrerPanneauDeclencheur(page);
    // Les espaces autour sont retirés ; le reste est intact.
    expect((await lireRegle(bureau, regle.id))?.conditions).toEqual({ tag: penible, client_sans_etiquette: 'Ne pas relancer' });
    await expect(carteDeclencheur(page)).toContainText(`Quelle étiquette : ${penible}`);
    await expect(page.locator('b', { hasText: 'l’"ami"' })).toHaveCount(0);   // aucune balise interprétée

    await page.reload();
    await expect(carteDeclencheur(page)).toContainText(`Quelle étiquette : ${penible}`, { timeout: 90_000 });
    panneau = await ouvrirPanneauDeclencheur(page);
    await expect(champParLibelle(panneau, 'Quelle étiquette')).toHaveValue(penible);
    await expect(champParLibelle(panneau, FILTRE_SANS.fr)).toHaveValue('Ne pas relancer');
    await expect(champParLibelle(panneau, FILTRE_A.fr)).toHaveValue('');
  });

  test('[EDT-084] une étiquette ne peut pas dépasser ce que le serveur accepte (200 caractères) : la saisie est bornée @defaut', async ({ page, bureau, marque }) => {
    await donnees(bureau);
    const regle = await creerRegle(bureau, bureau.orgA, { name: `${marque} étiquette longue`, trigger_event: 'client.tagged', conditions: {}, steps: ETAPE_NOTIF });
    await ouvrirEditeur(page, regle.id);
    const panneau = await ouvrirPanneauDeclencheur(page);
    for (const libelle of ['Quelle étiquette', FILTRE_A.fr, FILTRE_SANS.fr]) {
      const max = Number(await champParLibelle(panneau, libelle).getAttribute('maxlength'));
      expect(max, `« ${libelle} » borne la saisie (attribut maxlength)`).toBeGreaterThan(0);
      expect(max).toBeLessThanOrEqual(200);
    }
  });

  test('[EDT-084][EDT-074] étiquette trop longue refusée par le serveur : le message dit quoi corriger, en français', async ({ page, bureau, marque, moniteur }) => {
    await donnees(bureau);
    moniteur.attendu(/400 PATCH \/api\/automations\/rules\//, 'étiquette de 250 caractères refusée par la validation');
    const regle = await creerRegle(bureau, bureau.orgA, { name: `${marque} refus serveur`, trigger_event: 'client.tagged', conditions: {}, steps: ETAPE_NOTIF });
    await ouvrirEditeur(page, regle.id);
    const panneau = await ouvrirPanneauDeclencheur(page);
    await champParLibelle(panneau, 'Quelle étiquette').fill('é'.repeat(250));
    const ecriture = ecritureRegle(page);
    await panneau.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    expect((await ecriture).status()).toBe(400);
    // Le panneau reste ouvert, rien n'est écrit…
    await expect(panneau).toBeVisible();
    expect((await lireRegle(bureau, regle.id))?.conditions).toEqual({});
    // … et le message est lisible par un entrepreneur : en français, il nomme la limite.
    const toast = page.locator('[data-sonner-toast]').last();
    await expect(toast).toBeVisible();
    const message = (await toast.innerText()).trim();
    expect(message, `message montré : « ${message} »`).toMatch(/200/);
    expect(message, `message montré : « ${message} »`).not.toMatch(/Too big|expected string|String must|characters?\b/i);
  });
});

test.describe('panneau du déclencheur — nombres et choix', () => {
  test('[EDT-077][DEC-02] montants : une valeur valide est gardée en NOMBRE ; vider le champ retire le filtre', async ({ page, bureau, marque }) => {
    await donnees(bureau);
    const regle = await creerRegle(bureau, bureau.orgA, { name: `${marque} montants`, trigger_event: 'quote.viewed', conditions: { ouverture: 'premiere' }, steps: ETAPE_NOTIF });
    await ouvrirEditeur(page, regle.id);
    let panneau = await ouvrirPanneauDeclencheur(page);
    // Une plage POSSIBLE (de 0 $ à 1 250,50 $) : l'inverse — minimum 1 250,50 $, maximum 0 $ — est une plage
    // impossible, que le panneau refuse depuis f6a70824 (c'est le test suivant).
    await champParLibelle(panneau, 'Montant minimum ($)').fill('0');
    await champParLibelle(panneau, 'Montant maximum ($)').fill('1250.50');
    await enregistrerPanneauDeclencheur(page);
    // 1250.50 → 1250.5 (nombre, pas la chaîne « 1250.50 ») ; 0 est une vraie borne, pas « vide ».
    expect((await lireRegle(bureau, regle.id))?.conditions).toEqual({ ouverture: 'premiere', montant__gte: 0, montant__lte: 1250.5 });
    panneau = await ouvrirPanneauDeclencheur(page);
    await expect(champParLibelle(panneau, 'Montant minimum ($)')).toHaveValue('0');
    await expect(champParLibelle(panneau, 'Montant maximum ($)')).toHaveValue('1250.5');
    await champParLibelle(panneau, 'Montant minimum ($)').fill('');
    await champParLibelle(panneau, 'Montant maximum ($)').fill('');
    await enregistrerPanneauDeclencheur(page);
    expect((await lireRegle(bureau, regle.id))?.conditions).toEqual({ ouverture: 'premiere' });
  });

  test('[EDT-077][DEC-02] montants incohérents (minimum négatif ; minimum plus grand que le maximum) : refusés avec une explication, pas enregistrés tels quels', async ({ page, bureau, marque }) => {
    await donnees(bureau);
    const regle = await creerRegle(bureau, bureau.orgA, { name: `${marque} montants faux`, trigger_event: 'quote.viewed', conditions: { ouverture: 'premiere' }, steps: ETAPE_NOTIF });
    await ouvrirEditeur(page, regle.id);
    const panneau = await ouvrirPanneauDeclencheur(page);
    const ecritures = compterEcritures(page);
    const enBase = async () => (await lireRegle(bureau, regle.id))?.conditions;
    // Minimum 5000 $ et maximum 100 $ : aucun devis ne peut satisfaire les deux — la règle ne partirait jamais.
    await champParLibelle(panneau, 'Montant minimum ($)').fill('5000');
    await champParLibelle(panneau, 'Montant maximum ($)').fill('100');
    await attendreRefusDansLePanneau(page, '« Montant minimum ($) » est plus grand que « Montant maximum ($) » : rien ne peut remplir les deux, l’automatisation ne partirait jamais.');
    expect(await enBase(), 'une plage impossible n’est pas enregistrée : la base est inchangée').toEqual({ ouverture: 'premiere' });
    // Un minimum négatif n'a pas plus de sens (l'attribut min=0 n'est qu'indicatif) : refusé, avec la borne.
    await champParLibelle(panneau, 'Montant minimum ($)').fill('-5');
    await champParLibelle(panneau, 'Montant maximum ($)').fill('');
    await attendreRefusDansLePanneau(page, '« Montant minimum ($) » doit être au moins 0.');
    await expect(panneau.getByRole('alert'), 'le refus de la plage est parti avec la plage').not.toContainText('plus grand que');
    expect(await enBase(), 'un minimum négatif n’est pas enregistré : la base est inchangée').toEqual({ ouverture: 'premiere' });
    // Un maximum négatif non plus.
    await champParLibelle(panneau, 'Montant minimum ($)').fill('');
    await champParLibelle(panneau, 'Montant maximum ($)').fill('-0.01');
    await attendreRefusDansLePanneau(page, '« Montant maximum ($) » doit être au moins 0.');
    expect(await enBase()).toEqual({ ouverture: 'premiere' });
    expect(ecritures.liste.map((e) => e.split(' ')[0]), 'aucune écriture n’est partie pendant les trois refus').toEqual([]);
    // La même plage remise à l'endroit : le refus disparaît, et l'enregistrement passe.
    await champParLibelle(panneau, 'Montant minimum ($)').fill('100');
    await champParLibelle(panneau, 'Montant maximum ($)').fill('5000');
    await expect(panneau.getByRole('alert')).toHaveCount(0);
    await enregistrerPanneauDeclencheur(page);
    expect(await enBase()).toEqual({ ouverture: 'premiere', montant__gte: 100, montant__lte: 5000 });
  });

  test('[EDT-077][DEC-25] « Combien de jours avant » : 0, négatif et positif dans les bornes sont gardés ; hors bornes (−365 à 365), la saisie est refusée', async ({ page, bureau, marque }) => {
    const d = await donnees(bureau);
    const regle = await creerRegle(bureau, bureau.orgA, {
      name: `${marque} jours avant`, trigger_event: 'date.reached', conditions: { champ_id: d.champs.qa_date.id }, steps: ETAPE_NOTIF,
    });
    await ouvrirEditeur(page, regle.id);
    for (const valide of [0, -7, 365]) {
      const panneau = await ouvrirPanneauDeclencheur(page);
      await champParLibelle(panneau, 'Combien de jours avant').fill(String(valide));
      await enregistrerPanneauDeclencheur(page);
      expect((await lireRegle(bureau, regle.id))?.conditions).toEqual({ champ_id: d.champs.qa_date.id, jours_avant: valide });
      await expect(carteDeclencheur(page)).toContainText(`Combien de jours avant : ${valide}`);
    }
    // Hors bornes : 9999 jours avant (27 ans) n'a aucun sens. La règle du produit : le PANNEAU refuse lui-même, avec la
    // borne dite en clair, AVANT tout envoi au serveur — « Enregistrer » reste cliquable, le refus est écrit dans le panneau.
    // Une demi-journée (2,5 jours) non plus : le balayage ne vise que des jours entiers.
    const panneau = await ouvrirPanneauDeclencheur(page);
    const ecritures = compterEcritures(page);
    for (const faux of ['9999', '-366', '2.5']) {
      await champParLibelle(panneau, 'Combien de jours avant').fill(faux);
      await attendreRefusDansLePanneau(page, '« Combien de jours avant » doit être un nombre entier, entre -365 et 365.');
      // Rien n'est écrit : la règle garde la dernière valeur valable.
      expect((await lireRegle(bureau, regle.id))?.conditions, `« ${faux} » jours avant n’est pas enregistré`).toEqual({ champ_id: d.champs.qa_date.id, jours_avant: 365 });
    }
    expect(ecritures.liste.map((e) => e.split(' ')[0]), 'aucune écriture ne part vers le serveur pour une valeur hors bornes').toEqual([]);
    // La borne elle-même (−365) est acceptée : le refus disparaît et l'enregistrement passe.
    await champParLibelle(panneau, 'Combien de jours avant').fill('-365');
    await expect(panneau.getByRole('alert')).toHaveCount(0);
    await enregistrerPanneauDeclencheur(page);
    expect((await lireRegle(bureau, regle.id))?.conditions).toEqual({ champ_id: d.champs.qa_date.id, jours_avant: -365 });
  });

  test('[EDT-076][DEC-02] « Quand déclencher » : l’option vide dit ce qu’elle fait (pas « — Inchangé — », qui ne veut rien dire pour un déclencheur)', async ({ page, bureau, marque }) => {
    await donnees(bureau);
    const regle = await creerRegle(bureau, bureau.orgA, { name: `${marque} option vide`, trigger_event: 'quote.viewed', conditions: { ouverture: 'premiere' }, steps: ETAPE_NOTIF });
    await ouvrirEditeur(page, regle.id);
    const panneau = await ouvrirPanneauDeclencheur(page);
    const options = await optionsDe(champParLibelle(panneau, 'Quand déclencher'));
    expect(options.slice(1)).toEqual(['Première ouverture seulement', 'Chaque ouverture']);
    // Choisir l'option vide retire le réglage : le moteur part alors à CHAQUE ouverture. Le libellé doit le dire.
    expect(options[0]).not.toBe('— Inchangé —');
  });
});

test.describe('panneau du déclencheur — « Champ personnalisé modifié »', () => {
  test('[EDT-066][DEC-28] « Quel champ » range les champs du bureau par objet (Client, Pipeline, Job, Devis, Facture) — jamais ceux d’une propriété ; sans champ : « N’importe quel champ »', async ({ page, bureau, marque }) => {
    await donnees(bureau);
    const regle = await creerRegle(bureau, bureau.orgA, { name: `${marque} quel champ`, trigger_event: 'custom_field.changed', conditions: {}, steps: ETAPE_NOTIF });
    await ouvrirEditeur(page, regle.id);
    await expect(carteDeclencheur(page)).toContainText('N’importe quel champ');
    const panneau = await ouvrirPanneauDeclencheur(page);
    const select = panneau.getByLabel(/^Quel champ/);
    await expect(panneau.getByText('Vide = n’importe quel champ, sur n’importe quelle fiche.')).toBeVisible();

    // Les champs du bureau, relus en base à l'instant : un groupe par objet, dans cet ordre ; dans chaque groupe,
    // TOUS les champs de l'objet et eux seuls, dans l'ordre du bureau (voir `ecartAvecLOrdreDuBureau` pour les égalités).
    const liste = await champsDuBureau(bureau, bureau.orgA);
    const OBJETS: Array<[string, string]> = [['client', 'Client'], ['deal', 'Pipeline'], ['job', 'Job'], ['quote', 'Devis'], ['invoice', 'Facture']];
    const attendu = OBJETS
      .map(([objet, libelle]) => ({ groupe: libelle, champs: liste.filter((c) => c.object_type === objet) }))
      .filter((g) => g.champs.length > 0);
    await expect.poll(async () => {
      const vus = await select.locator('optgroup').evaluateAll((gs) => gs.map((g) => ({
        groupe: g.getAttribute('label') ?? '', champs: Array.from(g.querySelectorAll('option')).map((o) => o.textContent ?? ''),
      })));
      const groupes = vus.map((g) => g.groupe).join(' | ');
      if (groupes !== attendu.map((g) => g.groupe).join(' | ')) return `groupes affichés : ${groupes}`;
      for (const [i, g] of vus.entries()) {
        const ecart = ecartAvecLOrdreDuBureau(g.champs, attendu[i].champs);
        if (ecart) return `groupe « ${g.groupe} » — ${ecart}`;
      }
      return null;
    }, { timeout: 30_000 }).toBeNull();
    expect(attendu.map((g) => g.groupe)).toEqual(['Client', 'Pipeline', 'Job', 'Devis', 'Facture']);
    // Les champs de ce lot y sont, sous le bon objet.
    expect(attendu[0].champs.map((c) => c.label)).toEqual(expect.arrayContaining(['QA Texte', 'QA Date', 'QA Case', 'QA Fichier']));
    expect(attendu[1].champs.map((c) => c.label)).toEqual(expect.arrayContaining(['QA Date de relance', 'QA Nombre de fenêtres']));
    expect(attendu[4].champs.map((c) => c.label)).toContain('QA Bon de commande');
    expect(liste.some((c) => c.object_type === 'property')).toBe(true);   // le bureau a bien des champs de propriété — non offerts
    expect(await optionsDe(select)).toContain('— Choisir un champ —');
  });

  /** Chaque type comparable : ce qu'on saisit → ce que la base doit porter (la valeur NORMALISÉE que le serveur émet). */
  const TYPES: Array<{
    cle: string; libelle: string; etiquette: RegExp;
    saisir: (c: Locator) => Promise<void>;
    enBase: (optionId: (label: string) => string | undefined) => unknown;
    relu: string; resume: string;
  }> = [
    { cle: 'qa_texte', libelle: 'QA Texte', etiquette: /^Quand il devient/, saisir: (c) => c.fill('Référence « spéciale » 🌞'), enBase: () => 'Référence « spéciale » 🌞', relu: 'Référence « spéciale » 🌞', resume: 'QA Texte → Référence « spéciale » 🌞' },
    { cle: 'qa_courriel', libelle: 'QA Courriel', etiquette: /^Quand il devient/, saisir: (c) => c.fill('client@lume-qa.test'), enBase: () => 'client@lume-qa.test', relu: 'client@lume-qa.test', resume: 'QA Courriel → client@lume-qa.test' },
    { cle: 'qa_url', libelle: 'QA Site web', etiquette: /^Quand il devient/, saisir: (c) => c.fill('https://exemple.lume-qa.test/a?b=1&c=é'), enBase: () => 'https://exemple.lume-qa.test/a?b=1&c=é', relu: 'https://exemple.lume-qa.test/a?b=1&c=é', resume: 'QA Site web → https://exemple.lume-qa.test/a?b=1&c=é' },
    { cle: 'qa_nombre', libelle: 'QA Nombre', etiquette: /^Quand il devient/, saisir: (c) => c.fill('12.5'), enBase: () => 12.5, relu: '12.5', resume: 'QA Nombre → 12.5' },
    { cle: 'qa_montant', libelle: 'QA Montant', etiquette: /^Quand il devient/, saisir: (c) => c.fill('45.50'), enBase: () => 4550, relu: '45.5', resume: 'QA Montant → 45.5' },
    { cle: 'qa_liste', libelle: 'QA Liste', etiquette: /^Quand il devient/, saisir: async (c) => { await c.selectOption({ label: 'Été 🌞' }); }, enBase: (o) => o('Été 🌞'), relu: 'Été 🌞', resume: 'QA Liste → Été 🌞' },
    { cle: 'qa_multi', libelle: 'QA Choix multiples', etiquette: /^Quand il contient/, saisir: async (c) => { await c.selectOption({ label: 'Gouttières' }); }, enBase: (o) => o('Gouttières'), relu: 'Gouttières', resume: 'QA Choix multiples → Gouttières' },
    { cle: 'qa_date', libelle: 'QA Date', etiquette: /^Quand il devient/, saisir: (c) => c.fill('2026-12-25'), enBase: () => '2026-12-25', relu: '2026-12-25', resume: 'QA Date → 2026-12-25' },
    { cle: 'qa_case', libelle: 'QA Case', etiquette: /^Quand il devient/, saisir: async (c) => { await c.selectOption({ label: 'Non (décochée)' }); }, enBase: () => false, relu: 'Non (décochée)', resume: 'QA Case → non' },
  ];

  for (const t of TYPES) {
    test(`[EDT-066][EDT-067][EDT-107][DEC-28] champ « ${t.libelle} » : « quand il devient… » est saisi selon son type, enregistré sous la forme que le moteur compare, et relu`, async ({ page, bureau, marque }) => {
      const d = await donnees(bureau);
      const champQa = d.champs[t.cle];
      const regle = await creerRegle(bureau, bureau.orgA, { name: `${marque} ${t.cle}`, trigger_event: 'custom_field.changed', conditions: {}, steps: ETAPE_NOTIF });
      await ouvrirEditeur(page, regle.id);
      let panneau = await ouvrirPanneauDeclencheur(page);
      await panneau.getByLabel(/^Quel champ/).selectOption({ label: t.libelle });
      const devient = panneau.getByLabel(t.etiquette);
      await expect(devient).toBeVisible();
      await expect(panneau.getByText('Fiche : Client. Vide = à chaque changement.')).toBeVisible();
      await t.saisir(devient);
      await enregistrerPanneauDeclencheur(page);

      const optionId = (label: string) => champQa.options.find((o) => o.label === label)?.id;
      const attendu = { field_id: { eq: champQa.id }, new_value: { eq: t.enBase(optionId) } };
      expect(attendu.new_value.eq).toBeDefined();
      expect((await lireRegle(bureau, regle.id))?.conditions).toEqual(attendu);
      await expect(carteDeclencheur(page)).toContainText(t.resume);

      await page.reload();
      await expect(carteDeclencheur(page)).toContainText(t.resume, { timeout: 90_000 });
      panneau = await ouvrirPanneauDeclencheur(page);
      await expect.poll(() => valeurAffichee(panneau.getByLabel(/^Quel champ/)), { timeout: 30_000 }).toBe(t.libelle);
      await expect.poll(() => valeurAffichee(panneau.getByLabel(t.etiquette)), { timeout: 30_000 }).toBe(t.relu);

      // Vider la valeur : « à chaque changement » — la clé new_value disparaît, le champ surveillé reste.
      const relu = panneau.getByLabel(t.etiquette);
      if (await relu.evaluate((el) => el instanceof HTMLSelectElement)) await relu.selectOption({ index: 0 });
      else await relu.fill('');
      await enregistrerPanneauDeclencheur(page);
      expect((await lireRegle(bureau, regle.id))?.conditions).toEqual({ field_id: { eq: champQa.id } });
      await expect(carteDeclencheur(page)).toContainText(t.libelle);
      await expect(carteDeclencheur(page)).not.toContainText('→');
    });
  }

  test('[EDT-067][DEC-28] paragraphe, téléphone, fichier et date avec heure ne se comparent pas : pas de « Quand il devient », le champ seul est enregistré', async ({ page, bureau, marque }) => {
    const d = await donnees(bureau);
    const regle = await creerRegle(bureau, bureau.orgA, { name: `${marque} non comparables`, trigger_event: 'custom_field.changed', conditions: {}, steps: ETAPE_NOTIF });
    await ouvrirEditeur(page, regle.id);
    const panneau = await ouvrirPanneauDeclencheur(page);
    for (const libelle of ['QA Paragraphe', 'QA Téléphone', 'QA Fichier', 'QA Date et heure']) {
      await panneau.getByLabel(/^Quel champ/).selectOption({ label: libelle });
      await expect(panneau.getByLabel(/^Quand il (devient|contient)/), `« ${libelle} » n’offre pas de valeur à comparer`).toHaveCount(0);
    }
    await enregistrerPanneauDeclencheur(page);
    expect((await lireRegle(bureau, regle.id))?.conditions).toEqual({ field_id: { eq: d.champs.qa_date_heure.id } });
    await expect(carteDeclencheur(page)).toContainText('QA Date et heure');
  });

  test('[EDT-066][EDT-067][DEC-28] le champ surveillé a été supprimé : la carte et le panneau le disent', async ({ page, bureau, marque }) => {
    await donnees(bureau);
    const regle = await creerRegle(bureau, bureau.orgA, {
      name: `${marque} champ supprimé`, trigger_event: 'custom_field.changed', conditions: { field_id: { eq: randomUUID() }, new_value: { eq: 'x' } }, steps: ETAPE_NOTIF,
    });
    await ouvrirEditeur(page, regle.id);
    await expect(carteDeclencheur(page)).toContainText('champ supprimé');
    const panneau = await ouvrirPanneauDeclencheur(page);
    await expect(panneau.getByText('Ce champ n’existe plus : choisissez-en un autre.')).toBeVisible();
  });
});

test.describe('changer de déclencheur — les réglages de l’ancien (S-02)', () => {
  test('[EDT-058][EDT-074][DEC-25] passer de « Date atteinte » réglée à « Devis envoyé » : les réglages de l’ancien déclencheur ne restent PAS dans la règle (invisibles, ils l’empêcheraient de partir)', async ({ page, bureau, marque }) => {
    const d = await donnees(bureau);
    const regle = await creerRegle(bureau, bureau.orgA, {
      name: `${marque} S-02`, trigger_event: 'date.reached', conditions: { champ_id: d.champs.qa_date.id, jours_avant: 7 }, steps: ETAPE_NOTIF,
    });
    await ouvrirEditeur(page, regle.id);
    await ouvrirTiroirDeclencheurs(page);
    const ecriture = ecritureRegle(page);
    await tiroirDeclencheurs(page).getByRole('button', { name: /^Devis envoyé/ }).click();
    expect((await ecriture).status()).toBe(200);
    await expect(carteDeclencheur(page)).toContainText('Devis envoyé');

    // À l'écran : plus aucune trace de la date. En base : `champ_id` et `jours_avant` doivent avoir disparu aussi —
    // le moteur compare CHAQUE clé de `conditions` à l'événement, et un devis envoyé n'a ni l'une ni l'autre.
    await expect(carteDeclencheur(page)).not.toContainText('QA Date');
    const apres = await lireRegle(bureau, regle.id);
    expect(apres?.trigger_event).toBe('quote.sent');
    expect(apres?.conditions ?? {}, 'réglages de l’ancien déclencheur restés en base').toEqual({});
  });

  test('[EDT-058][DEC-02] passer par « Devis ouvert par le client » puis choisir « Nouveau prospect » : le réglage posé d’office (« première ouverture ») ne reste pas dans la règle', async ({ page, bureau, marque }) => {
    await donnees(bureau);
    const regle = await creerRegle(bureau, bureau.orgA, { name: `${marque} S-02 défaut`, trigger_event: 'job.completed', conditions: {}, steps: ETAPE_NOTIF });
    await ouvrirEditeur(page, regle.id);
    for (const titre of ['Devis ouvert par le client', 'Nouveau prospect']) {
      await ouvrirTiroirDeclencheurs(page);
      const ecriture = ecritureRegle(page);
      await tiroirDeclencheurs(page).getByRole('button', { name: new RegExp(`^${titre}`) }).click();
      expect((await ecriture).status()).toBe(200);
      await expect(carteDeclencheur(page)).toContainText(titre);
    }
    const apres = await lireRegle(bureau, regle.id);
    expect(apres?.trigger_event).toBe('lead.created');
    // Un prospect qui entre n'a pas d'« ouverture » : la clé restée bloquerait la règle pour toujours, sans un mot à l'écran.
    expect(apres?.conditions ?? {}).toEqual({});
  });

  test('[EDT-074][DEC-18] « Enregistrer » dans le panneau du nouveau déclencheur ne réécrit pas les clés d’un ancien déclencheur @defaut', async ({ page, bureau, marque }) => {
    await donnees(bureau);
    // État laissé par un changement de déclencheur : « Étiquette ajoutée » qui porte encore les réglages de « Client inactif ».
    const regle = await creerRegle(bureau, bureau.orgA, {
      name: `${marque} S-02 panneau`, trigger_event: 'client.tagged', conditions: { mois: 6, max_par_heure: 25 }, steps: ETAPE_NOTIF,
    });
    await ouvrirEditeur(page, regle.id);
    const panneau = await ouvrirPanneauDeclencheur(page);
    // Rien de tout ça n'est visible dans le panneau…
    await expect(panneau.getByText(/mois|par heure/i)).toHaveCount(0);
    await champParLibelle(panneau, 'Quelle étiquette').fill('VIP');
    await enregistrerPanneauDeclencheur(page);
    // … donc rien de tout ça ne doit rester en base après un enregistrement.
    expect((await lireRegle(bureau, regle.id))?.conditions).toEqual({ tag: 'VIP' });
  });
});

/**
 * Le drapeau est POSÉ en base pour le bureau B, et — pour un drapeau qui ouvre un déclencheur — le serveur
 * l'APPLIQUE déjà (il garde les drapeaux d'un bureau 30 s en mémoire, tous ensemble : `donnees()` les pose puis
 * attend que le catalogue servi au bureau B porte les déclencheurs sous drapeau). Affirmé ici pour qu'un test
 * « sous drapeau » ne puisse pas passer ou tomber pour une raison de drapeau sans le dire.
 */
async function drapeauApplique(bureau: Parameters<typeof lireRegle>[0], jetonB: string, drapeau: string, declencheur?: string): Promise<void> {
  const { data, error } = await bureau.admin.from('org_features').select('enabled').eq('org_id', bureau.orgB).eq('feature', drapeau).maybeSingle();
  expect(error, `lecture du drapeau ${drapeau}`).toBeNull();
  expect(data?.enabled, `le drapeau ${drapeau} est posé (enabled) pour le bureau B`).toBe(true);
  if (!declencheur) return;
  const r = await appelApi(BASE, jetonB, bureau.orgB, 'GET', '/api/automations/editeur');
  expect(r.status).toBe(200);
  const offerts = ((r.json as { catalogue?: { declencheurs?: Array<{ cle: string }> } }).catalogue?.declencheurs ?? []).map((x) => x.cle);
  expect(offerts, `le serveur offre « ${declencheur} » au bureau B (drapeau ${drapeau} appliqué)`).toContain(declencheur);
}

test.describe('panneau du déclencheur — bureau aux drapeaux actifs', () => {
  test.use({ compte: 'proprioB' });

  test('[EDT-069][EDT-077][DEC-20] « Client inactif » : le compteur dit combien de clients correspondent aujourd’hui, suit le nombre de mois, et disparaît sans nombre valide', async ({ page, bureau, marque, jetonDe }) => {
    await donnees(bureau);
    const regle = await creerRegle(bureau, bureau.orgB, { name: `${marque} inactif`, trigger_event: 'client.inactive', conditions: { mois: 6, max_par_heure: 25 }, steps: ETAPE_NOTIF });
    await ouvrirEditeur(page, regle.id);
    const panneau = await ouvrirPanneauDeclencheur(page);
    const mois = champParLibelle(panneau, 'Aucun job terminé depuis (mois)');
    await expect(mois).toHaveValue('6');
    await expect(champParLibelle(panneau, 'Au plus, par heure')).toHaveValue('25');

    // Le compteur redit ce que le serveur calcule pour ce bureau.
    const jeton = await jetonDe('proprioB');
    const compter = async (m: number) => {
      const r = await appelApi(BASE, jeton, bureau.orgB, 'GET', `/api/automations/clients-inactifs/apercu?mois=${m}`);
      expect(r.status).toBe(200);
      return Number((r.json as { nombre?: number; count?: number; total?: number }).nombre ?? (r.json as { count?: number }).count ?? (r.json as { total?: number }).total);
    };
    const phrase = (n: number) => `${n} client${n > 1 ? 's' : ''} correspond${n > 1 ? 'ent' : ''} aujourd’hui.`;
    const n6 = await compter(6);
    expect(Number.isFinite(n6)).toBe(true);
    const compteur = panneau.getByRole('status');
    await expect(compteur).toHaveText(phrase(n6));
    await mois.fill('12');
    await expect(compteur).toHaveText(phrase(await compter(12)));
    // Champ vidé : obligatoire — l'avertissement le dit.
    await mois.fill('');
    await expect(panneau.getByText('Sans « Aucun job terminé depuis (mois) », l’automatisation ne partirait jamais.')).toBeVisible();
  });

  test('[EDT-077][DEC-20] « Client inactif » : 0 mois, 61 mois ou 2,5 mois sont refusés avec une explication (bornes annoncées : 1 à 60)', async ({ page, bureau, marque, jetonDe }) => {
    await donnees(bureau);
    await drapeauApplique(bureau, await jetonDe('proprioB'), 'auto_client_inactif', 'client.inactive');
    const regle = await creerRegle(bureau, bureau.orgB, { name: `${marque} inactif bornes`, trigger_event: 'client.inactive', conditions: { mois: 6, max_par_heure: 25 }, steps: ETAPE_NOTIF });
    await ouvrirEditeur(page, regle.id);
    const panneau = await ouvrirPanneauDeclencheur(page);
    const ecritures = compterEcritures(page);
    // 0 mois = « tous les clients, tout de suite » à l'écran, alors que le moteur prendra une autre valeur : à refuser.
    for (const faux of ['0', '61', '2.5']) {
      await champParLibelle(panneau, 'Aucun job terminé depuis (mois)').fill(faux);
      await attendreRefusDansLePanneau(page, '« Aucun job terminé depuis (mois) » doit être un nombre entier, entre 1 et 60.');
      expect((await lireRegle(bureau, regle.id))?.conditions, `« ${faux} » mois n’est pas enregistré : la base est inchangée`).toEqual({ mois: 6, max_par_heure: 25 });
    }
    // Le second nombre du panneau a ses bornes aussi (1 à 1000 par heure).
    await champParLibelle(panneau, 'Aucun job terminé depuis (mois)').fill('12');
    await champParLibelle(panneau, 'Au plus, par heure').fill('0');
    await attendreRefusDansLePanneau(page, '« Au plus, par heure » doit être un nombre entier, entre 1 et 1000.');
    expect((await lireRegle(bureau, regle.id))?.conditions).toEqual({ mois: 6, max_par_heure: 25 });
    expect(ecritures.liste.map((e) => e.split(' ')[0]), 'aucune écriture n’est partie pendant les refus').toEqual([]);
    // Les bornes elles-mêmes passent : 60 mois, 1 par heure.
    await champParLibelle(panneau, 'Aucun job terminé depuis (mois)').fill('60');
    await champParLibelle(panneau, 'Au plus, par heure').fill('1');
    await expect(panneau.getByRole('alert')).toHaveCount(0);
    await enregistrerPanneauDeclencheur(page);
    expect((await lireRegle(bureau, regle.id))?.conditions).toEqual({ mois: 60, max_par_heure: 1 });
  });

  const CASES: Array<{ titre: string; cle: string; libelle: string; cochee: boolean }> = [
    { titre: 'Devis envoyé', cle: 'quote.sent', libelle: 'Arrêter si la soumission est acceptée, refusée ou annulée', cochee: true },
    { titre: 'Facture envoyée', cle: 'invoice.sent', libelle: 'Arrêter si la facture est payée ou annulée', cochee: true },
    { titre: 'Facture en retard', cle: 'invoice.overdue', libelle: 'Arrêter si la facture est payée ou annulée', cochee: true },
    { titre: 'Rendez-vous planifié', cle: 'appointment.created', libelle: 'Arrêter si le rendez-vous est annulé', cochee: true },
    { titre: 'Opportunité entre dans une étape', cle: 'deal.stage_entered', libelle: 'Arrêter si l’opportunité change d’étape', cochee: false },
  ];

  test('[EDT-071] la case « Arrêter si… » : offerte sur les 5 déclencheurs concernés, avec son libellé et son état de départ ; absente ailleurs', async ({ page, bureau, marque }) => {
    test.setTimeout(240_000);
    await donnees(bureau);
    const regle = await creerRegle(bureau, bureau.orgB, { name: `${marque} cases`, trigger_event: 'job.completed', conditions: {}, steps: ETAPE_NOTIF });
    await ouvrirEditeur(page, regle.id);
    // « Job terminé » : pas de case.
    let panneau = await ouvrirPanneauDeclencheur(page);
    await expect(panneau.getByRole('checkbox')).toHaveCount(0);
    for (const c of CASES) {
      await ouvrirTiroirDeclencheurs(page);
      const ecriture = ecritureRegle(page);
      await tiroirDeclencheurs(page).getByRole('button', { name: new RegExp(`^${c.titre}`) }).click();
      expect((await ecriture).status()).toBe(200);
      await expect(carteDeclencheur(page)).toContainText(c.titre);
      panneau = await ouvrirPanneauDeclencheur(page);
      await expect(panneau.getByText(c.titre, { exact: true })).toBeVisible();
      const coche = panneau.getByRole('checkbox', { name: new RegExp(`^${c.libelle}`) });
      await expect(coche, `case de « ${c.titre} »`).toBeVisible();
      await expect(panneau.getByText('Vérifié avant chaque étape qui suit un délai. Le motif de l’arrêt apparaît dans l’historique.')).toBeVisible();
      expect(await coche.isChecked(), `état de départ de « ${c.libelle} »`).toBe(c.cochee);
    }
  });

  test('[EDT-071][EDT-074][DEC-06] décocher « Arrêter si la facture est payée ou annulée » s’enregistre (settings.arreter_si_resolu = false) et se relit décoché', async ({ page, bureau, marque }) => {
    await donnees(bureau);
    const regle = await creerRegle(bureau, bureau.orgB, { name: `${marque} décocher`, trigger_event: 'invoice.sent', conditions: {}, steps: ETAPE_NOTIF });
    await ouvrirEditeur(page, regle.id);
    let panneau = await ouvrirPanneauDeclencheur(page);
    const nom = /^Arrêter si la facture est payée ou annulée/;
    await expect(panneau.getByRole('checkbox', { name: nom })).toBeChecked();
    await panneau.getByRole('checkbox', { name: nom }).uncheck();
    await enregistrerPanneauDeclencheur(page);
    expect((await lireRegle(bureau, regle.id))?.settings).toEqual({ arreter_si_resolu: false });

    await page.reload();
    await expect(carteDeclencheur(page)).toContainText('Facture envoyée', { timeout: 90_000 });
    panneau = await ouvrirPanneauDeclencheur(page);
    await expect(panneau.getByRole('checkbox', { name: nom })).not.toBeChecked();
    // Recocher : true est écrit (pas seulement « absent »).
    await panneau.getByRole('checkbox', { name: nom }).check();
    await enregistrerPanneauDeclencheur(page);
    expect((await lireRegle(bureau, regle.id))?.settings).toEqual({ arreter_si_resolu: true });
  });

  test('[EDT-071][DEC-06] la case décochée le reste après un changement dans l’onglet « Réglages » (S-08)', async ({ page, bureau, marque, jetonDe }) => {
    await donnees(bureau);
    await drapeauApplique(bureau, await jetonDe('proprioB'), 'auto_sortie_parcours');
    const regle = await creerRegle(bureau, bureau.orgB, {
      name: `${marque} S-08`, trigger_event: 'invoice.sent', conditions: {}, settings: { arreter_si_resolu: false }, steps: ETAPE_NOTIF,
    });
    await ouvrirEditeur(page, regle.id);
    await page.getByRole('tab', { name: 'Réglages', exact: true }).click();
    const jours = page.getByRole('switch', { name: /Jours ouvrables seulement/ });
    await expect(jours).toBeVisible();
    const ecriture = ecritureRegle(page);
    await jours.click();
    expect((await ecriture).status()).toBe(200);
    const s = (await lireRegle(bureau, regle.id))?.settings as Record<string, unknown> | null;
    expect(s?.jours_ouvrables).toBe(true);
    // La case du déclencheur n'a pas été touchée : elle doit rester DÉCOCHÉE (false), pas redevenir « cochée par défaut ».
    expect(s?.arreter_si_resolu, 'settings.arreter_si_resolu après un changement dans Réglages').toBe(false);
    await page.getByRole('tab', { name: 'Parcours', exact: true }).click();
    const panneau = await ouvrirPanneauDeclencheur(page);
    // La case n'est offerte que si le drapeau est appliqué à l'écran : visible d'abord, décochée ensuite.
    const coche = panneau.getByRole('checkbox', { name: /^Arrêter si la facture est payée ou annulée/ });
    await expect(coche).toBeVisible();
    await expect(coche).not.toBeChecked();
    // Et l'autre sens : la case restée décochée s'enregistre encore telle quelle depuis le panneau (false, pas « absent »).
    await enregistrerPanneauDeclencheur(page);
    const apres = (await lireRegle(bureau, regle.id))?.settings as Record<string, unknown> | null;
    expect(apres?.arreter_si_resolu).toBe(false);
    expect(apres?.jours_ouvrables, 'le réglage de l’onglet « Réglages » n’est pas effacé par le panneau du déclencheur').toBe(true);
  });
});
