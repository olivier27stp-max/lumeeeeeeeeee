/**
 * Publier une automatisation dont une action est incomplète, incompatible ou
 * indisponible (carte de l'éditeur § 5.2, pistes S-09 et S-10).
 *
 * Ce que le fichier prouve :
 *  · le refus est dit AVANT (bandeau rouge sur le canevas, carte bordée de rouge)
 *    et AU CLIC (message qui nomme l'action et le champ, étape fautive ouverte) ;
 *  · rien n'est publié, ni à l'écran ni en base ;
 *  · le serveur refuse la même chose avec le même texte, pour qui passerait
 *    à côté de l'écran ;
 *  · ce que le tiroir a laissé ajouter n'est pas refusé ensuite (S-09) ;
 *  · « Déplacer l'opportunité → Une étape précise » se règle dans un menu des
 *    étapes du pipeline, pas en tapant un identifiant (S-10).
 */
import { test, expect } from './_aides';
import { appelApi, lireRegle } from '../_outils/banc';
import {
  CAPTURES, donnees, creerBrouillon, creerBrouillonAvecAction, ouvrirEditeur, ouvrirTiroir, itemTiroir, panneauEtape, champ,
  boutonEnregistrer, attendreConfig, attendreEnregistre, carte, optionChoisie,
  ajouterAction, ecrituresVers, laisserPasserLEnregistrementAuto,
} from './_aides';
import type { Locator, Page } from '@playwright/test';

const BASE = process.env.E2E_BASE || 'http://127.0.0.1:5191';
const interrupteur = (page: Page): Locator => page.getByRole('switch', { name: 'Publier l’automatisation' });
const toasts = (page: Page): Locator => page.getByRole('region', { name: /Notifications/ }).getByRole('listitem');
/** Le titre du bandeau rouge du canevas, quel que soit le nombre : « 1 chose à corriger… », « 3 choses à corriger… ». */
const BANDEAU_A_CORRIGER = /^\d+ choses? à corriger avant de publier$/;

test.describe('publication — action incomplète', () => {
  test('[EDT-018][EDT-022][CHA-38][EDT-126] un webhook sans adresse : annoncé sur le canevas, refusé au clic avec le nom de l’action et du champ, l’étape s’ouvre, rien n’est publié', async ({ page, bureau, marque }) => {
    const regle = await creerBrouillon(bureau, marque, 'lead.created', {
      steps: [
        { id: 'e1', type: 'action', action: { type: 'send_sms', config: { body: 'Bonjour [client_name]' } }, suivant: 'e2' },
        { id: 'e2', type: 'action', action: { type: 'webhook', config: {} }, suivant: null },
      ],
    });
    await ouvrirEditeur(page, regle.id);

    // Avant tout clic : le bandeau dit quoi corriger, et où (accordé au nombre depuis #859 : « 1 chose », « 3 choses »).
    await expect(page.getByText('1 chose à corriger avant de publier', { exact: true })).toBeVisible();
    const lien = page.getByRole('button', { name: '« Appeler un webhook » : « L’adresse » est vide.' });
    await expect(lien).toBeVisible();
    await page.screenshot({ path: `${CAPTURES}/publication-incomplete-bandeau.png` });

    // Au clic sur l'interrupteur : refus expliqué, l'étape fautive s'ouvre, aucune confirmation.
    await expect(interrupteur(page)).toHaveAttribute('aria-checked', 'false');
    await interrupteur(page).click();
    await expect(toasts(page).filter({ hasText: '« Appeler un webhook » : « L’adresse » est vide.' })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const p = panneauEtape(page);
    await expect(p.getByRole('heading', { level: 2 })).toHaveText('Appeler un webhook');
    await expect(p.getByText('« L’adresse » est vide.')).toHaveCount(2);
    await expect(interrupteur(page)).toHaveAttribute('aria-checked', 'false');
    await expect(page.getByText('Brouillon', { exact: true })).toBeVisible();
    expect((await lireRegle(bureau, regle.id))?.is_active).toBe(false);

    // Corrigé : le bandeau disparaît.
    await champ(p, 'L’adresse', true).fill('https://crochets.lume-qa.test/entrant');
    await boutonEnregistrer(p).click();
    await expect(page.getByText(BANDEAU_A_CORRIGER)).toHaveCount(0);
    await attendreConfig(bureau, regle.id, { url: 'https://crochets.lume-qa.test/entrant' }, 'e2');
    await attendreEnregistre(page);
  });

  test('[EDT-022][EDT-018] le lien du bandeau ouvre l’étape fautive ; plusieurs problèmes : le message du clic dit combien il en reste', async ({ page, bureau, marque }) => {
    const regle = await creerBrouillon(bureau, marque, 'lead.created', {
      steps: [
        { id: 'e1', type: 'action', action: { type: 'ajouter_etiquette', config: {} }, suivant: 'e2' },
        { id: 'e2', type: 'action', action: { type: 'create_task', config: {} }, suivant: 'e3' },
        { id: 'e3', type: 'action', action: { type: 'demarrer_automatisation', config: {} }, suivant: null },
      ],
    });
    await ouvrirEditeur(page, regle.id);
    await expect(page.getByText('3 choses à corriger avant de publier', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '« Créer une tâche » : « Titre de la tâche » est vide.' }).click();
    await expect(panneauEtape(page).getByRole('heading', { level: 2 })).toHaveText('Créer une tâche');
    await panneauEtape(page).getByRole('button', { name: 'Fermer le panneau' }).click();

    await interrupteur(page).click();
    await expect(toasts(page).filter({ hasText: '« Ajouter une étiquette » : « L’étiquette » est vide. (2 autre(s) à corriger)' })).toBeVisible();
    await expect(panneauEtape(page).getByRole('heading', { level: 2 })).toHaveText('Ajouter une étiquette');
    expect((await lireRegle(bureau, regle.id))?.is_active).toBe(false);
  });

  test('[EDT-018][CHA-38] le serveur refuse la même publication avec le même texte (appel direct, sans passer par l’écran)', async ({ bureau, marque, jetonDe, baseURL }) => {
    const regle = await creerBrouillon(bureau, marque, 'lead.created', {
      steps: [
        { id: 'e1', type: 'action', action: { type: 'webhook', config: {} }, suivant: 'e2' },
        { id: 'e2', type: 'action', action: { type: 'envoyer_facture', config: {} }, suivant: 'e3' },
        { id: 'e3', type: 'action', action: { type: 'envoyer_slack', config: { body: 'x' } }, suivant: null },
      ],
    });
    const r = await appelApi(baseURL ?? BASE, await jetonDe('proprioA'), bureau.orgA, 'POST', `/api/automations/rules/${regle.id}/publication`, { actif: true });
    expect(r.status).toBe(422);
    const corps = r.json as { error: string; problemes: string[] };
    expect(corps.problemes).toEqual([
      '« Appeler un webhook » : « L’adresse » est vide.',
      '« Envoyer la facture » ne peut pas suivre ce déclencheur.',
      '« Envoyer dans Slack » : Bientôt : la connexion à votre Slack n’existe pas encore.',
    ]);
    expect(corps.error).toBe(`Publication refusée : ${corps.problemes.join(' · ')}`);
    expect((await lireRegle(bureau, regle.id))?.is_active).toBe(false);
  });
});

test.describe('publication — action incompatible ou indisponible', () => {
  test('[EDT-018][EDT-022][ACT-17] « Envoyer la facture » sur « Nouveau prospect » : refusé au clic, l’étape s’ouvre et dit de choisir une autre action', async ({ page, bureau, marque }) => {
    const regle = await creerBrouillonAvecAction(bureau, marque, 'lead.created', 'envoyer_facture', { body: 'Votre facture' });
    await ouvrirEditeur(page, regle.id);
    await expect(page.getByRole('button', { name: '« Envoyer la facture » ne peut pas suivre ce déclencheur.' })).toBeVisible();
    await interrupteur(page).click();
    await expect(toasts(page).filter({ hasText: '« Envoyer la facture » ne peut pas suivre ce déclencheur.' })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const p = panneauEtape(page);
    await expect(p.getByText('« Envoyer la facture » ne peut pas suivre ce déclencheur : choisissez-en une autre.')).toHaveCount(2);
    await page.screenshot({ path: `${CAPTURES}/publication-incompatible.png` });
    expect((await lireRegle(bureau, regle.id))?.is_active).toBe(false);
  });

  test('[EDT-018][ACT-05][CHA-14] « Envoyer dans Slack » : refusé au clic, avec la raison', async ({ page, bureau, marque }) => {
    const regle = await creerBrouillonAvecAction(bureau, marque, 'lead.created', 'envoyer_slack', { body: '[client_name] — suivi à faire' });
    await ouvrirEditeur(page, regle.id);
    await interrupteur(page).click();
    await expect(toasts(page).filter({ hasText: '« Envoyer dans Slack » : Bientôt : la connexion à votre Slack n’existe pas encore.' })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect((await lireRegle(bureau, regle.id))?.is_active).toBe(false);
  });

  test('[ACT-16][CHA-35][EDT-059][EDT-018] « Date atteinte » sur un champ du pipeline : une action que le tiroir a laissé ajouter n’est pas ensuite déclarée impossible à publier (S-09)', async ({ page, bureau, marque }) => {
    const d = await donnees(bureau);
    const regle = await creerBrouillonAvecAction(bureau, marque, 'date.reached', 'send_sms', { body: 'Bonjour [client_name]' }, {
      conditions: { champ_id: d.champs.qa_fermeture.id, jours_avant: 7 },
    });
    await ouvrirEditeur(page, regle.id);
    // Le tiroir offre « Assigner l'opportunité » (le champ surveillé est un champ du pipeline).
    await ouvrirTiroir(page);
    await expect(itemTiroir(page, 'Assigner l’opportunité')).toBeEnabled();
    await itemTiroir(page, 'Assigner l’opportunité').click();
    const p = panneauEtape(page);
    await champ(p, 'Le membre', false).selectOption({ label: d.membres.tech.nom });
    // Le panneau n'y trouve rien à redire…
    await expect(boutonEnregistrer(p)).toBeEnabled();
    await boutonEnregistrer(p).click();
    await attendreConfig(bureau, regle.id, { membre_id: d.membres.tech.id }, 'e2');
    await attendreEnregistre(page);
    await page.screenshot({ path: `${CAPTURES}/publication-s09-date-pipeline.png` });
    // … donc le canevas non plus : pas de bandeau rouge qui dise le contraire.
    await expect(page.getByText(BANDEAU_A_CORRIGER)).toHaveCount(0);
    await expect(page.getByRole('button', { name: '« Assigner l’opportunité » ne peut pas suivre ce déclencheur.' })).toHaveCount(0);
  });
});

test.describe('publication — automatisation déjà publiée', () => {
  test('[EDT-059][EDT-130][ACT-02][CHA-07] sur une automatisation PUBLIÉE, une action choisie dans le tiroir n’est pas mise en ligne avec son texte de départ tant que son panneau n’est pas enregistré', async ({ page, bureau, marque }) => {
    // Publiée, interne (une tâche), sur un déclencheur que rien ne provoque ici.
    const regle = await creerBrouillonAvecAction(bureau, marque, 'client.untagged', 'create_task', { title: 'Tâche existante' }, { is_active: true });
    await ouvrirEditeur(page, regle.id);
    await expect(interrupteur(page)).toHaveAttribute('aria-checked', 'true');
    await ouvrirTiroir(page);
    // On guette l'enregistrement automatique qui suivrait le choix (il part 3 s après une modification du parcours).
    const enregistrement = page.waitForRequest((r) => r.method() === 'PATCH' && r.url().includes(`/api/automations/rules/${regle.id}`), { timeout: 20_000 }).catch(() => null);
    await itemTiroir(page, 'Envoyer un texto').click();
    const p = panneauEtape(page);
    await expect(champ(p, 'Texte du message', true)).toHaveValue('Bonjour [client_name], c’est [company_name]. Merci !');
    // L'utilisateur n'a encore rien validé : le panneau est ouvert, « Enregistrer » n'a pas été cliqué.
    const parti = await enregistrement;
    if (parti) await attendreEnregistre(page);
    await page.screenshot({ path: `${CAPTURES}/publication-publiee-action-par-defaut.png` });
    const enBase = ((await lireRegle(bureau, regle.id))?.steps ?? []) as Array<{ id: string }>;
    expect(enBase.map((e) => e.id), 'le texto de départ est déjà dans le parcours EN LIGNE alors que son panneau n’a pas été enregistré').toEqual(['e1']);
  });

  /*
   * Le même défaut, regardé de plus près (ligne 1 du tri, correctif 3b739958) : pendant que le panneau de l'étape
   * choisie reste ouvert, la LIGNE de la règle ne change pas du tout (ni parcours, ni actions, ni date de
   * modification) et aucune écriture ne part ; fermer le panneau sans enregistrer demande confirmation, et l'étape
   * n'existe alors nulle part — ni sur le canevas, ni en base, ni après rechargement.
   */
  test('[EDT-059][EDT-130][EDT-129][ACT-02] publiée : une action choisie dans le tiroir puis laissée 5 s ne change rien en base ; fermer son panneau sans enregistrer la fait disparaître de partout', async ({ page, bureau, marque }) => {
    const regle = await creerBrouillonAvecAction(bureau, marque, 'client.untagged', 'create_task', { title: 'Tâche existante' }, { is_active: true });
    const ligne = async () => {
      const r = await lireRegle(bureau, regle.id);
      return { steps: r?.steps, actions: r?.actions, is_active: r?.is_active, updated_at: r?.updated_at, conditions: r?.conditions, name: r?.name };
    };
    const ecritures = ecrituresVers(page, regle.id);
    await ouvrirEditeur(page, regle.id);
    await expect(interrupteur(page)).toHaveAttribute('aria-checked', 'true');
    const avant = await ligne();
    expect(avant.is_active).toBe(true);

    // Choisir « Envoyer un texto » : sa carte et son panneau apparaissent ; on ne touche à rien d'autre.
    const p = await ajouterAction(page, 'Envoyer un texto');
    await expect(champ(p, 'Texte du message', true)).toHaveValue('Bonjour [client_name], c’est [company_name]. Merci !');
    await expect(carte(page, 'Envoyer un texto')).toBeVisible();
    await laisserPasserLEnregistrementAuto(page);
    expect(ecritures, 'écritures parties alors que « Enregistrer » n’a pas été cliqué').toEqual([]);
    expect(await ligne(), 'la ligne de la règle PUBLIÉE, panneau ouvert et non enregistré').toEqual(avant);
    await expect(interrupteur(page)).toHaveAttribute('aria-checked', 'true');

    // Fermer le panneau : la question dit ce qui se passe ; « Annuler » garde l'étape en cours d'ajout.
    await p.getByRole('button', { name: 'Fermer le panneau' }).click();
    const d = page.getByRole('dialog');
    await expect(d.getByRole('heading', { name: 'Fermer sans ajouter cette étape ?' })).toBeVisible();
    await expect(d.getByText('Cette étape n’a pas été enregistrée : elle ne sera pas ajoutée au parcours.')).toBeVisible();
    await page.screenshot({ path: `${CAPTURES}/publication-publiee-fermer-sans-ajouter.png` });
    await d.getByRole('button', { name: 'Annuler', exact: true }).click();
    await expect(d).toBeHidden();
    await expect(p).toBeVisible();
    await expect(carte(page, 'Envoyer un texto')).toBeVisible();

    // Confirmer : le panneau se ferme, la carte disparaît du canevas, rien n'a été écrit.
    await p.getByRole('button', { name: 'Fermer le panneau' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Ne pas l’ajouter', exact: true }).click();
    await expect(p).toBeHidden();
    await expect(carte(page, 'Envoyer un texto')).toHaveCount(0);
    await expect(carte(page, 'Créer une tâche')).toBeVisible();
    await laisserPasserLEnregistrementAuto(page);
    expect(ecritures, 'écritures parties après l’abandon de l’étape').toEqual([]);
    expect(await ligne(), 'la ligne de la règle après l’abandon').toEqual(avant);

    // Après rechargement : une seule étape, celle d'avant.
    await page.reload();
    await expect(carte(page, 'Créer une tâche')).toBeVisible({ timeout: 180_000 });
    await expect(carte(page, 'Envoyer un texto')).toHaveCount(0);
    await expect(interrupteur(page)).toHaveAttribute('aria-checked', 'true');
    expect(await ligne(), 'la ligne de la règle après rechargement').toEqual(avant);
  });
});

test.describe('publication — « Déplacer l’opportunité → Une étape précise » (S-10)', () => {
  test('[CHA-33][CHA-32][ACT-14][EDT-081] « L’étape visée » est un menu des étapes du pipeline, pas un champ où taper un identifiant', async ({ page, bureau, marque }) => {
    const d = await donnees(bureau);
    const regle = await creerBrouillonAvecAction(bureau, marque, 'quote.sent', 'move_deal_stage', { cible: 'etape' });
    await ouvrirEditeur(page, regle.id);
    await carte(page, 'Déplacer l’opportunité').click();
    const p = panneauEtape(page);
    expect(await optionChoisie(champ(p, 'Vers', false))).toBe('Une étape précise');
    const visee = champ(p, 'L’étape visée', true);
    await expect(visee).toBeVisible();
    await page.screenshot({ path: `${CAPTURES}/publication-s10-etape-visee.png` });
    // Attendu : un menu qui nomme les étapes du bureau (« Pipeline de ventes · Contacté »…).
    expect(await visee.evaluate((el) => el.tagName), 'le contrôle de « L’étape visée »').toBe('SELECT');
    await expect(visee.locator('option')).toContainText([`${d.pipeline.name} · ${d.etapes[1].name_fr}`]);
  });

  test('[CHA-33][ACT-14][EDT-018] un nom d’étape tapé en clair (« Gagné ») n’est pas un identifiant : la publication est refusée, avec la raison @defaut', async ({ page, bureau, marque }) => {
    const regle = await creerBrouillon(bureau, marque, 'quote.sent', {
      steps: [
        { id: 'e1', type: 'action', action: { type: 'send_sms', config: { body: 'Bonjour [client_name]' } }, suivant: 'e2' },
        { id: 'e2', type: 'action', action: { type: 'move_deal_stage', config: { cible: 'etape', stage_id: 'Gagné' } }, suivant: null },
      ],
    });
    await ouvrirEditeur(page, regle.id);
    await interrupteur(page).click();
    // Attendu : un refus qui nomme l'étape ; surtout pas la confirmation « Publier cette automatisation ? ».
    const confirmation = page.getByRole('dialog').filter({ hasText: 'Publier cette automatisation ?' });
    const refus = toasts(page).filter({ hasText: /L’étape visée|étape/ });
    await expect(refus.or(confirmation).first()).toBeVisible();
    const proposeDePublier = await confirmation.isVisible();
    if (proposeDePublier) {
      await page.screenshot({ path: `${CAPTURES}/publication-s10-gagne-accepte.png` });
      // On ne publie pas : on referme la confirmation.
      await confirmation.getByRole('button', { name: 'Annuler', exact: true }).click();
    }
    expect(proposeDePublier, 'la publication d’une étape visée « Gagné » (texte libre) est proposée au lieu d’être refusée').toBe(false);
    expect((await lireRegle(bureau, regle.id))?.is_active).toBe(false);
  });
});
