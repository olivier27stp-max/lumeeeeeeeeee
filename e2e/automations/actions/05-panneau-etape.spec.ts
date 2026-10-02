/**
 * Le panneau d'étape (carte de l'éditeur § 2.9 : EDT-100 à EDT-131, et le
 * dialogue EDT-164).
 *
 * Ce que le fichier prouve :
 *  · fermer (X, « Annuler ») : sans modification, le panneau se ferme ; avec, il
 *    demande confirmation, et rien n'est écrit si l'on renonce ;
 *  · les deux onglets : édition, statistiques (avec et sans chiffres) ;
 *  · « Nom de l'action » : sur la carte, dans le titre, en base ;
 *  · « Quoi faire » : seulement les actions compatibles, et changer d'action
 *    repart d'une configuration propre ;
 *  · « Supprimer » : confirmation, puis l'étape disparaît du parcours et de la base ;
 *  · « Enregistrer » : l'indicateur passe par « Modifié » puis « Enregistré » ;
 *  · les étapes « Attendre », « Condition », « Arrêter ici » et la note technique
 *    ont chacune leur panneau.
 */
import { test, expect } from './_aides';
import {
  CAPTURES, creerBrouillon, creerBrouillonAvecAction, ouvrirEditeur, panneauEtape, champ, boutonEnregistrer,
  attendreConfig, attendreEtapes, attendreEnregistre, finStable, carte, optionChoisie, etapesEnBase, configDe,
} from './_aides';
import type { Locator, Page } from '@playwright/test';

async function ouvrirEtape(page: Page, idRegle: string, titre: string): Promise<Locator> {
  await ouvrirEditeur(page, idRegle);
  await carte(page, titre).click();
  const p = panneauEtape(page);
  await expect(p).toBeVisible();
  return p;
}

const dialogue = (page: Page): Locator => page.getByRole('dialog');

test.describe('panneau d’étape — fermer', () => {
  test('[EDT-100][EDT-129] sans modification, « X » et « Annuler » ferment le panneau sans rien demander', async ({ page, bureau, marque }) => {
    const regle = await creerBrouillonAvecAction(bureau, marque, 'quote.sent', 'send_sms', { body: 'Bonjour [client_name]' });
    let p = await ouvrirEtape(page, regle.id, 'Envoyer un texto');
    await p.getByRole('button', { name: 'Fermer le panneau' }).click();
    await expect(p).toBeHidden();
    await expect(dialogue(page)).toHaveCount(0);

    await carte(page, 'Envoyer un texto').click();
    p = panneauEtape(page);
    await p.getByRole('button', { name: 'Annuler', exact: true }).click();
    await expect(p).toBeHidden();
    await expect(dialogue(page)).toHaveCount(0);
    await expect(page.getByText('Enregistré', { exact: true })).toBeVisible();
  });

  test('[EDT-100][EDT-129][EDT-164][EDT-154][EDT-155] avec une modification, fermer demande « Fermer sans enregistrer ? » ; « Annuler » garde la saisie, confirmer la jette et rien n’est écrit', async ({ page, bureau, marque }) => {
    const regle = await creerBrouillonAvecAction(bureau, marque, 'quote.sent', 'send_sms', { body: 'Bonjour [client_name]' });
    const p = await ouvrirEtape(page, regle.id, 'Envoyer un texto');
    const zone = champ(p, 'Texte du message', true);
    await zone.fill('Texte en cours de frappe');

    await p.getByRole('button', { name: 'Fermer le panneau' }).click();
    const d = dialogue(page);
    await expect(d.getByRole('heading', { name: 'Fermer sans enregistrer ?' })).toBeVisible();
    await expect(d.getByText('Les modifications de cette étape ne sont pas enregistrées : elles seront perdues.')).toBeVisible();
    await page.screenshot({ path: `${CAPTURES}/panneau-fermer-sans-enregistrer.png` });
    await d.getByRole('button', { name: 'Annuler', exact: true }).click();
    await expect(d).toBeHidden();
    await expect(zone).toHaveValue('Texte en cours de frappe');

    // Par « Annuler » du pied : même question ; cette fois on confirme.
    await p.getByRole('button', { name: 'Annuler', exact: true }).click();
    await dialogue(page).getByRole('button', { name: 'Fermer sans enregistrer', exact: true }).click();
    await expect(p).toBeHidden();
    await expect(carte(page, 'Envoyer un texto')).toContainText('Bonjour [client_name]');
    await expect(page.getByText('Enregistré', { exact: true })).toBeVisible();
    expect(configDe(await etapesEnBase(bureau, regle.id))).toEqual({ body: 'Bonjour [client_name]' });

    // Rouvrir : c'est bien l'ancien texte.
    await carte(page, 'Envoyer un texto').click();
    await expect(champ(panneauEtape(page), 'Texte du message', true)).toHaveValue('Bonjour [client_name]');
  });
});

test.describe('panneau d’étape — onglets', () => {
  test('[EDT-101][EDT-102] deux onglets ; « Statistiques » sans passage dit qu’il n’y a encore rien', async ({ page, bureau, marque }) => {
    const regle = await creerBrouillonAvecAction(bureau, marque, 'quote.sent', 'send_sms', { body: 'Bonjour [client_name]' });
    const p = await ouvrirEtape(page, regle.id, 'Envoyer un texto');
    const edition = p.getByRole('tab', { name: 'Modifier l’action' });
    const stats = p.getByRole('tab', { name: 'Statistiques' });
    await expect(edition).toHaveAttribute('aria-selected', 'true');
    await expect(stats).toHaveAttribute('aria-selected', 'false');
    await stats.click();
    await expect(stats).toHaveAttribute('aria-selected', 'true');
    await expect(p.getByText('Aucun passage encore. Les chiffres apparaîtront après le premier déclenchement.')).toBeVisible();
    await expect(champ(p, 'Texte du message', true)).toBeHidden();
    await edition.click();
    await expect(champ(p, 'Texte du message', true)).toBeVisible();
  });

  test('[EDT-102][EDT-131] « Statistiques » avec des passages montre Réussis, Sautés, Échoués, En attente sur 60 jours', async ({ page, bureau, marque }) => {
    // État provoqué : la route des statistiques répond avec des chiffres pour l'étape e1.
    await page.route('**/api/automations/rules/stats**', async (route) => {
      const r = await route.fetch();
      const j = await r.json().catch(() => ({}));
      await route.fulfill({ response: r, json: { ...j, par_etape: { e1: { envoyes: 12, sautes: 3, echecs: 2, en_attente: 5 } } } });
    });
    const regle = await creerBrouillonAvecAction(bureau, marque, 'quote.sent', 'send_sms', { body: 'Bonjour [client_name]' });
    const p = await ouvrirEtape(page, regle.id, 'Envoyer un texto');
    await p.getByRole('tab', { name: 'Statistiques' }).click();
    await expect(p.getByText('60 derniers jours.')).toBeVisible();
    for (const [libelle, valeur] of [['Réussis', '12'], ['Sautés', '3'], ['Échoués', '2'], ['En attente', '5']] as const) {
      await expect(p.locator('div').filter({ hasText: new RegExp(`^${libelle}${valeur}$`) })).toBeVisible();
    }
    await page.screenshot({ path: `${CAPTURES}/panneau-statistiques.png` });
  });

  test('[EDT-101] l’onglet d’édition d’une attente ou d’une condition ne s’appelle pas « Modifier l’action » @defaut', async ({ page, bureau, marque }) => {
    const regle = await creerBrouillon(bureau, marque, 'lead.created', {
      steps: [
        { id: 'e1', type: 'attendre', delai_secondes: 86400, suivant: 'e2' },
        { id: 'e2', type: 'action', action: { type: 'create_task', config: { title: 'Rappeler [client_name]' } }, suivant: null },
      ],
    });
    const p = await ouvrirEtape(page, regle.id, 'Attendre');
    await expect(p.getByRole('heading', { level: 2 })).toHaveText('Attendre');
    await expect(p.getByRole('tab').first()).not.toHaveText('Modifier l’action');
  });
});

test.describe('panneau d’étape — nom de l’action', () => {
  test('[EDT-103][EDT-130] le nom donné s’affiche sur la carte et dans le titre du panneau, est enregistré, et s’efface pour revenir au nom de l’action', async ({ page, bureau, marque }) => {
    const regle = await creerBrouillonAvecAction(bureau, marque, 'quote.sent', 'send_email', { subject: 'Objet', body: 'Corps' });
    const p = await ouvrirEtape(page, regle.id, 'Envoyer un courriel');
    const nom = p.getByLabel('Nom de l’action (facultatif)', { exact: true });
    await expect(nom).toHaveAttribute('placeholder', 'Envoyer un courriel');
    await expect(nom).toHaveAttribute('maxlength', '80');
    await expect(p.getByText('Ce qui s’affiche sur la carte. Utile quand le parcours envoie plusieurs courriels.')).toBeVisible();
    await nom.fill('Courriel de confirmation « été » 😀');
    await expect(p.getByRole('heading', { level: 2 })).toHaveText('Courriel de confirmation « été » 😀');
    await boutonEnregistrer(p).click();
    await expect(carte(page, 'Courriel de confirmation « été » 😀')).toBeVisible();
    const etapes = await attendreEtapes(bureau, regle.id, (e) => e[0]?.nom === 'Courriel de confirmation « été » 😀');
    expect(etapes[0]).toMatchObject({ id: 'e1', nom: 'Courriel de confirmation « été » 😀', action: { type: 'send_email', config: { subject: 'Objet', body: 'Corps' } } });
    await attendreEnregistre(page);

    await page.reload();
    await expect(carte(page, 'Courriel de confirmation « été » 😀')).toBeVisible({ timeout: 180_000 });
    await carte(page, 'Courriel de confirmation « été » 😀').click();
    const relu = panneauEtape(page);
    await expect(relu.getByLabel('Nom de l’action (facultatif)', { exact: true })).toHaveValue('Courriel de confirmation « été » 😀');
    // « Quoi faire » dit toujours quelle action c'est.
    expect(await optionChoisie(relu.getByLabel('Quoi faire *', { exact: true }))).toBe('Envoyer un courriel');

    await relu.getByLabel('Nom de l’action (facultatif)', { exact: true }).fill('');
    await expect(relu.getByRole('heading', { level: 2 })).toHaveText('Envoyer un courriel');
    await boutonEnregistrer(relu).click();
    await expect(carte(page, 'Envoyer un courriel')).toBeVisible();
    await attendreEtapes(bureau, regle.id, (e) => !e[0]?.nom);
    await attendreEnregistre(page);
  });
});

test.describe('panneau d’étape — « Quoi faire »', () => {
  test('[EDT-104] le menu groupe par famille les seules actions compatibles avec le déclencheur ; changer d’action garde le texte et vide le reste', async ({ page, bureau, marque }) => {
    const regle = await creerBrouillonAvecAction(bureau, marque, 'invoice.sent', 'send_email', { subject: 'Objet du courriel', body: 'Le texte commun', from_name: 'Expéditeur' });
    const p = await ouvrirEtape(page, regle.id, 'Envoyer un courriel');
    const quoi = p.getByLabel('Quoi faire *', { exact: true });
    const groupes = await quoi.locator('optgroup').evaluateAll((gs) => gs.map((g) => ({
      famille: g.getAttribute('label'), actions: Array.from(g.querySelectorAll('option')).map((o) => (o.textContent ?? '').trim()),
    })));
    // « Facture envoyée » : ni rendez-vous, ni opportunité, ni devis ; Slack (indisponible) n'y est jamais.
    expect(groupes).toEqual([
      { famille: 'Communication', actions: ['Envoyer un courriel', 'Envoyer un texto', 'Notifier l’équipe', 'Demander un avis'] },
      { famille: 'Client', actions: ['Ajouter une étiquette', 'Retirer une étiquette', 'Modifier le client', 'Assigner un responsable', 'Ajouter une note', 'Mettre à jour un champ personnalisé'] },
      { famille: 'Travail', actions: ['Créer une tâche'] },
      { famille: 'Argent', actions: ['Envoyer la facture'] },
      { famille: 'Technique', actions: ['Appeler un webhook', 'Démarrer une automatisation', 'Arrêter une automatisation'] },
    ]);

    // Courriel → texto : le texte suit, l'objet et l'expéditeur n'ont plus lieu d'être.
    await quoi.selectOption({ label: 'Envoyer un texto' });
    await expect(p.getByRole('heading', { level: 2 })).toHaveText('Envoyer un texto');
    await expect(champ(p, 'Texte du message', true)).toHaveValue('Le texte commun');
    await expect(p.getByLabel('Objet *', { exact: true })).toHaveCount(0);
    await boutonEnregistrer(p).click();
    await expect(carte(page, 'Envoyer un texto')).toBeVisible();
    const etapes = await attendreConfig(bureau, regle.id, { body: 'Le texte commun' });
    expect(etapes[0]).toMatchObject({ action: { type: 'send_sms' } });
    await attendreEnregistre(page);
  });

  test('[EDT-104][EDT-126] passer d’un texto à un courriel : l’objet obligatoire est vide, le panneau le dit et propose un objet @defaut', async ({ page, bureau, marque }) => {
    const regle = await creerBrouillonAvecAction(bureau, marque, 'quote.sent', 'send_sms', { body: 'Le texte commun' });
    const p = await ouvrirEtape(page, regle.id, 'Envoyer un texto');
    await p.getByLabel('Quoi faire *', { exact: true }).selectOption({ label: 'Envoyer un courriel' });
    await expect(champ(p, 'Message', true)).toHaveValue('Le texte commun');
    // Attendu : comme une action ajoutée par le tiroir, l'objet reçoit son texte de départ — l'étape reste enregistrable.
    await expect.soft(champ(p, 'Objet', true)).toHaveValue('Un message de [company_name]');
    await expect(boutonEnregistrer(p)).toBeEnabled();
  });

  test('[EDT-104][EDT-126][ACT-17] une action devenue incompatible avec le déclencheur : le panneau le dit, refuse d’enregistrer, et « Quoi faire » n’affiche pas une autre action à sa place @defaut', async ({ page, bureau, marque }) => {
    // « Envoyer la facture » sur « Nouveau prospect » (déclencheur changé après coup).
    const regle = await creerBrouillonAvecAction(bureau, marque, 'lead.created', 'envoyer_facture', { body: 'Votre facture' });
    const p = await ouvrirEtape(page, regle.id, 'Envoyer la facture');
    await expect(p.getByRole('heading', { level: 2 })).toHaveText('Envoyer la facture');
    await expect(p.getByText('« Envoyer la facture » ne peut pas suivre ce déclencheur : choisissez-en une autre.')).toHaveCount(2);
    await expect(boutonEnregistrer(p)).toBeDisabled();
    await page.screenshot({ path: `${CAPTURES}/panneau-action-incompatible.png` });
    // Le menu ne doit pas montrer « Envoyer un courriel » alors que l'étape est « Envoyer la facture ».
    expect(await optionChoisie(p.getByLabel('Quoi faire *', { exact: true }))).not.toBe('Envoyer un courriel');
  });

  test('[ACT-05][CHA-14][EDT-104][EDT-126] une étape « Envoyer dans Slack » déjà présente : le panneau dit qu’elle n’est pas encore disponible et ne se laisse pas enregistrer comme si de rien n’était @defaut', async ({ page, bureau, marque }) => {
    const regle = await creerBrouillonAvecAction(bureau, marque, 'lead.created', 'envoyer_slack', { body: '[client_name] — suivi à faire' });
    await ouvrirEditeur(page, regle.id);
    // Le canevas, lui, le dit : bandeau rouge, cliquable.
    await expect(page.getByRole('button', { name: '« Envoyer dans Slack » : Bientôt : la connexion à votre Slack n’existe pas encore.' })).toBeVisible();
    await carte(page, 'Envoyer dans Slack').click();
    const p = panneauEtape(page);
    await expect(p.getByRole('heading', { level: 2 })).toHaveText('Envoyer dans Slack');
    await page.screenshot({ path: `${CAPTURES}/panneau-slack.png` });
    await expect.soft(p.getByText(/Bientôt : la connexion à votre Slack n’existe pas encore/)).toBeVisible({ timeout: 5_000 });
    await expect.soft(boutonEnregistrer(p)).toBeDisabled();
    expect.soft(await optionChoisie(p.getByLabel('Quoi faire *', { exact: true }))).not.toBe('Envoyer un courriel');
  });
});

test.describe('panneau d’étape — supprimer, enregistrer', () => {
  test('[EDT-128][EDT-159] « Supprimer » demande confirmation ; « Annuler » garde l’étape, « Supprimer » la retire du canevas et de la base', async ({ page, bureau, marque }) => {
    const regle = await creerBrouillon(bureau, marque, 'lead.created', {
      steps: [
        { id: 'e1', type: 'action', action: { type: 'create_task', config: { title: 'Première tâche' } }, suivant: 'e2' },
        { id: 'e2', type: 'action', action: { type: 'ajouter_note', config: { body: 'Une note' } }, suivant: null },
      ],
    });
    const p = await ouvrirEtape(page, regle.id, 'Créer une tâche');
    await p.getByRole('button', { name: 'Supprimer', exact: true }).click();
    const d = dialogue(page);
    await expect(d.getByRole('heading', { name: 'Supprimer cette étape ?' })).toBeVisible();
    await expect(d.getByText('Ce qui venait après reste dans le parcours et se rebranche tout seul.')).toBeVisible();
    await d.getByRole('button', { name: 'Annuler', exact: true }).click();
    await expect(p).toBeVisible();
    await expect(carte(page, 'Créer une tâche')).toBeVisible();

    await p.getByRole('button', { name: 'Supprimer', exact: true }).click();
    await dialogue(page).getByRole('button', { name: 'Supprimer', exact: true }).click();
    await expect(p).toBeHidden();
    await expect(carte(page, 'Créer une tâche')).toHaveCount(0);
    await expect(carte(page, 'Ajouter une note')).toBeVisible();
    const etapes = await attendreEtapes(bureau, regle.id, (e) => e.length === 1);
    expect(etapes).toEqual([{ id: 'e2', type: 'action', action: { type: 'ajouter_note', config: { body: 'Une note' } }, suivant: null }]);
    await attendreEnregistre(page);
  });

  test('[EDT-130][EDT-012] « Enregistrer » ferme le panneau ; l’indicateur passe à « Modifié » puis « Enregistré », et la base suit', async ({ page, bureau, marque }) => {
    const regle = await creerBrouillonAvecAction(bureau, marque, 'note.added', 'ajouter_note', { body: 'Avant' });
    const p = await ouvrirEtape(page, regle.id, 'Ajouter une note');
    await expect(page.getByText('Enregistré', { exact: true })).toBeVisible();
    await champ(p, 'La note', true).fill('Après');
    // Tant que l'étape n'est pas enregistrée, le parcours n'est pas « modifié ».
    await expect(page.getByText('Enregistré', { exact: true })).toBeVisible();
    await boutonEnregistrer(p).click();
    await expect(p).toBeHidden();
    await expect(page.getByText('Modifié', { exact: true })).toBeVisible();
    await expect(carte(page, 'Ajouter une note')).toContainText('Après');
    await attendreConfig(bureau, regle.id, { body: 'Après' });
    await attendreEnregistre(page);
  });
});

test.describe('panneau d’étape — attendre', () => {
  test('[EDT-118][EDT-119][EDT-120] nombre, unité et « Ce qu’on attend » sont enregistrés ; la carte et le panneau les redisent', async ({ page, bureau, marque }) => {
    const regle = await creerBrouillon(bureau, marque, 'lead.created', {
      steps: [
        { id: 'e1', type: 'attendre', delai_secondes: 86400, suivant: 'e2' },
        { id: 'e2', type: 'action', action: { type: 'create_task', config: { title: 'Rappeler [client_name]' } }, suivant: null },
      ],
    });
    const p = await ouvrirEtape(page, regle.id, 'Attendre');
    const nombre = p.getByLabel('Attendre *', { exact: true });
    const unite = p.getByLabel('Unité de temps');
    const mode = p.getByLabel('Ce qu’on attend', { exact: true });
    await expect(nombre).toHaveValue('1');
    await expect(unite).toHaveValue('jours');
    expect(await unite.locator('option').allInnerTexts()).toEqual(['minutes', 'heures', 'jours']);
    // Hors « Rendez-vous planifié », pas d'attente « avant le rendez-vous ».
    expect(await mode.locator('option').allInnerTexts()).toEqual(['Simplement ce délai', 'La réponse du client (au plus ce délai)']);
    await expect(p.getByText('Les messages ne partent jamais entre 20 h et 8 h, même si l’attente se termine la nuit.')).toBeVisible();
    await expect(p.getByText('Le parcours continue une fois le délai écoulé, quoi qu’il arrive.')).toBeVisible();

    await unite.selectOption('heures');
    await nombre.fill('3');
    await mode.selectOption({ label: 'La réponse du client (au plus ce délai)' });
    await expect(p.getByText('S’il répond, le parcours s’arrête ici. Sinon, la suite part une fois le délai écoulé.')).toBeVisible();
    await boutonEnregistrer(p).click();
    await expect(carte(page, 'Attendre')).toContainText('3 heure(s)');
    const etapes = await attendreEtapes(bureau, regle.id, (e) => e[0]?.delai_secondes === 10800 && e[0]?.mode === 'reponse');
    expect(etapes[0]).toEqual({ id: 'e1', type: 'attendre', delai_secondes: 10800, mode: 'reponse', suivant: 'e2' });
    await attendreEnregistre(page);

    await page.reload();
    await expect(carte(page, 'Attendre')).toBeVisible({ timeout: 180_000 });
    await carte(page, 'Attendre').click();
    const relu = panneauEtape(page);
    await expect(relu.getByLabel('Attendre *', { exact: true })).toHaveValue('3');
    await expect(relu.getByLabel('Unité de temps')).toHaveValue('heures');
    expect(await optionChoisie(relu.getByLabel('Ce qu’on attend', { exact: true }))).toBe('La réponse du client (au plus ce délai)');
  });

  test('[EDT-120] sur « Rendez-vous planifié », l’attente « Ce délai AVANT le rendez-vous » est offerte et enregistrée', async ({ page, bureau, marque }) => {
    const regle = await creerBrouillon(bureau, marque, 'appointment.created', {
      steps: [
        { id: 'e1', type: 'attendre', delai_secondes: 86400, suivant: 'e2' },
        { id: 'e2', type: 'action', action: { type: 'send_sms', config: { body: 'Rappel : rendez-vous le [appointment_date]' } }, suivant: null },
      ],
    });
    const p = await ouvrirEtape(page, regle.id, 'Attendre');
    const mode = p.getByLabel('Ce qu’on attend', { exact: true });
    await mode.selectOption({ label: 'Ce délai AVANT le rendez-vous' });
    await expect(p.getByText('Le rappel part ce délai avant le rendez-vous. Rendez-vous déplacé : le rappel suit. Moment déjà passé : ce rappel est sauté.')).toBeVisible();
    await p.getByLabel('Attendre *', { exact: true }).fill('2');
    await boutonEnregistrer(p).click();
    await expect(carte(page, 'Attendre')).toContainText('2 jour(s) avant le rendez-vous');
    const etapes = await attendreEtapes(bureau, regle.id, (e) => e[0]?.mode === 'avant_date');
    expect(etapes[0]).toMatchObject({ id: 'e1', type: 'attendre', mode: 'avant_date', secondes_avant: 172800, delai_secondes: 0, suivant: 'e2' });
    await attendreEnregistre(page);
  });

  test('[EDT-118][EDT-119] retaper le nombre garde l’unité choisie (3 jours → effacer → 5 = 5 jours) @defaut', async ({ page, bureau, marque }) => {
    const regle = await creerBrouillon(bureau, marque, 'lead.created', {
      steps: [
        { id: 'e1', type: 'attendre', delai_secondes: 259200, suivant: 'e2' },
        { id: 'e2', type: 'action', action: { type: 'create_task', config: { title: 'Rappeler [client_name]' } }, suivant: null },
      ],
    });
    const p = await ouvrirEtape(page, regle.id, 'Attendre');
    const nombre = p.getByLabel('Attendre *', { exact: true });
    await expect(nombre).toHaveValue('3');
    await expect(p.getByLabel('Unité de temps')).toHaveValue('jours');
    // Comme au clavier : on efface le 3, on tape 5.
    await nombre.click();
    await nombre.press('ControlOrMeta+a');
    await nombre.press('Backspace');
    await page.keyboard.type('5');
    await expect.soft(p.getByLabel('Unité de temps'), 'l’unité reste « jours »').toHaveValue('jours');
    await expect.soft(nombre).toHaveValue('5');
  });

  test('[EDT-118][EDT-126] une attente au-delà du plafond (plus d’un an) est refusée dans le panneau, avec la limite @defaut', async ({ page, bureau, marque }) => {
    const regle = await creerBrouillon(bureau, marque, 'lead.created', {
      steps: [
        { id: 'e1', type: 'attendre', delai_secondes: 86400, suivant: 'e2' },
        { id: 'e2', type: 'action', action: { type: 'create_task', config: { title: 'Rappeler [client_name]' } }, suivant: null },
      ],
    });
    const p = await ouvrirEtape(page, regle.id, 'Attendre');
    await p.getByLabel('Attendre *', { exact: true }).fill('900');
    await expect(p.getByLabel('Unité de temps')).toHaveValue('jours');
    // Le serveur refuse au-delà de 366 jours : le panneau doit le dire avant.
    await expect(boutonEnregistrer(p)).toBeDisabled();
  });
});

test.describe('panneau d’étape — condition, arrêt, note technique', () => {
  test('[EDT-121][EDT-122][EDT-123][EDT-124][EDT-125][EDT-039] les exemples écrivent dans « Conditions » ; le texte saisi devient les conditions enregistrées, relues à l’identique', async ({ page, bureau, marque }) => {
    const regle = await creerBrouillon(bureau, marque, 'quote.sent', {
      steps: [
        { id: 'e1', type: 'si', conditions: {}, alors: 'e2', sinon: null },
        { id: 'e2', type: 'action', action: { type: 'create_task', config: { title: 'Rappeler [client_name]' } }, suivant: null },
      ],
    });
    const p = await ouvrirEtape(page, regle.id, 'Si…');
    await expect(p.getByRole('heading', { level: 2 })).toHaveText('Condition');
    const zone = p.getByLabel('Conditions', { exact: true });
    for (const exemple of ['statut =', 'source =', 'total_cents >', 'created_at >=']) {
      await expect(p.getByRole('button', { name: exemple, exact: true })).toBeVisible();
    }
    await p.getByRole('button', { name: 'statut =', exact: true }).click();
    await expect(zone).toHaveValue('statut = ');
    await zone.fill('statut = envoye\ntotal_cents > 500');
    await p.getByRole('button', { name: 'source =', exact: true }).click();
    await expect(zone).toHaveValue('statut = envoye\ntotal_cents > 500\nsource = ');
    await zone.fill('statut = envoye\ntotal_cents > 500');
    await boutonEnregistrer(p).click();
    await expect(carte(page, 'Si…')).toContainText('2 condition(s)');
    const etapes = await attendreEtapes(bureau, regle.id, (e) => Object.keys((e[0]?.conditions ?? {}) as object).length === 2);
    expect(etapes[0].conditions).toEqual({ statut: 'envoye', total_cents: { gt: 500 } });
    await attendreEnregistre(page);
    await carte(page, 'Si…').click();
    await expect(panneauEtape(page).getByLabel('Conditions', { exact: true })).toHaveValue('statut = envoye\ntotal_cents > 500');
  });

  test('[EDT-127][EDT-099] sur un déclencheur dont la fiche a des champs personnalisés, la condition offre « … et si les champs personnalisés sont : »', async ({ page, bureau, marque }) => {
    const regle = await creerBrouillon(bureau, marque, 'lead.created', {
      steps: [
        { id: 'e1', type: 'si', conditions: { source: 'web' }, alors: 'e2', sinon: null },
        { id: 'e2', type: 'action', action: { type: 'create_task', config: { title: 'Rappeler [client_name]' } }, suivant: null },
      ],
    });
    const p = await ouvrirEtape(page, regle.id, 'Si…');
    await expect(p.getByLabel('Conditions', { exact: true })).toHaveValue('source = web');
    await expect(p.getByText('… et si les champs personnalisés sont :')).toBeVisible();
    await p.getByRole('button', { name: 'Ajouter une condition' }).click();
    await expect(p.getByRole('button', { name: 'Retirer la condition' })).toBeVisible();
    // Une ligne incomplète n'empêche pas d'enregistrer : elle est retirée.
    await boutonEnregistrer(p).click();
    await expect(p).toBeHidden();
    await finStable(page);
    expect((await etapesEnBase(bureau, regle.id))[0].conditions).toEqual({ source: 'web' });
  });

  test('[EDT-101][EDT-037] la note technique « Note dans l’historique » n’a rien à régler et le dit', async ({ page, bureau, marque }) => {
    const regle = await creerBrouillon(bureau, marque, 'lead.created', {
      steps: [
        { id: 'e1', type: 'action', action: { type: 'create_task', config: { title: 'Rappeler [client_name]' } }, suivant: 'e2' },
        { id: 'e2', type: 'action', action: { type: 'log_activity', config: { event_type: 'lead_followup' } }, suivant: null },
      ],
    });
    const p = await ouvrirEtape(page, regle.id, 'Note dans l’historique');
    await expect(p.getByRole('heading', { level: 2 })).toHaveText('Note dans l’historique');
    await expect(p.getByText('Étape technique : Lume inscrit ce moment dans l’historique du client. Il n’y a rien à régler ; vous pouvez la supprimer si vous n’en voulez pas.')).toBeVisible();
    await expect(p.getByLabel('Quoi faire *', { exact: true })).toHaveCount(0);
    await expect(p.getByRole('button', { name: 'Supprimer', exact: true })).toBeVisible();
  });
});
