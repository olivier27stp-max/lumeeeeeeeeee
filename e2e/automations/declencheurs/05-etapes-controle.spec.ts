/**
 * Les étapes de contrôle du parcours : ATTENDRE (3 modes × 3 unités),
 * SI / SINON (les 6 signes des conditions en texte, les conditions de champs),
 * ARRÊTER — EDT-060 à 062, EDT-118 à 125, EDT-127.
 *
 * Ce que ce fichier prouve :
 *  · chaque mode et chaque unité d'attente s'enregistre sous la forme que le
 *    serveur valide et que le moteur lit (`delai_secondes`, `mode`,
 *    `secondes_avant`), et se relit à l'identique ;
 *  · chaque signe (`=`, `!=`, `>`, `>=`, `<`, `<=`) donne la forme attendue, et
 *    l'évaluateur DU MOTEUR (`evaluateConditions`) la juge correctement ;
 *  · ce que l'écran laisse enregistrer mais que le moteur ignore ou refuse.
 *
 * La ré-entrée et la fenêtre horaire ne se règlent pas ici : elles vivent dans
 * l'onglet « Réglages » de l'automatisation (hors de ce lot).
 */
import type { Locator, Page } from '@playwright/test';
import { test, expect, creerRegle, lireRegle, appelApi, attendre } from '../_outils/banc';
import { evaluateConditions } from '../../../server/lib/automationEngine';
import {
  BASE, donnees, ouvrirEditeur, ETAPE_NOTIF, ecritureRegle, valeurAffichee, optionsDe, champsDuBureau, ecartAvecLOrdreDuBureau,
} from './_donnees';

test.afterEach(async ({ context }) => { await context.unrouteAll({ behavior: 'ignoreErrors' }); });

const NOTIF = ETAPE_NOTIF[0];
const panneauEtape = (page: Page) => page.getByRole('complementary', { name: 'Modifier l’étape' });
const tiroirActions = (page: Page) => page.getByRole('complementary', { name: 'Actions', exact: true });
const etat = (page: Page) => page.getByText('Enregistré', { exact: true });

/** « Enregistrer » du panneau d'étape, puis l'enregistrement automatique du parcours (3 s plus tard). */
async function enregistrerEtape(page: Page): Promise<void> {
  const ecriture = ecritureRegle(page);
  await panneauEtape(page).getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(panneauEtape(page)).toBeHidden();
  expect((await ecriture).status(), 'le parcours est accepté par le serveur').toBe(200);
  await expect(etat(page)).toBeVisible({ timeout: 30_000 });
}

/** Les étapes en base, une fois que la lecture satisfait `ok`. */
async function etapesEnBase(bureau: Parameters<typeof lireRegle>[0], id: string, ok: (steps: Array<Record<string, unknown>>) => boolean) {
  const r = await attendre(() => lireRegle(bureau, id), (x) => ok((x?.steps ?? []) as Array<Record<string, unknown>>), 40_000, 500);
  return (r?.steps ?? []) as Array<Record<string, unknown>>;
}

const evenement = (metadata: Record<string, unknown>) => ({ type: 'quote.sent', orgId: 'o', entityType: 'quote', entityId: 'e', metadata }) as Parameters<typeof evaluateConditions>[1];

// ── Ajouter une étape de contrôle depuis le tiroir ────────────────────────

test.describe('tiroir « Actions » — famille « Parcours »', () => {
  test('[EDT-060][EDT-061][EDT-062] « Attendre », « Condition » et « Arrêter ici » s’ajoutent depuis le tiroir, avec leurs réglages de départ, et s’enregistrent', async ({ page, bureau, marque }) => {
    test.setTimeout(240_000);
    await donnees(bureau);
    const regle = await creerRegle(bureau, bureau.orgA, { name: `${marque} ajouts`, trigger_event: 'lead.created', conditions: {}, steps: ETAPE_NOTIF });
    await ouvrirEditeur(page, regle.id);
    const plus = page.getByRole('button', { name: 'Ajouter une étape ici' });

    // La famille « Parcours » du tiroir : les trois étapes de contrôle, avec leur aide.
    await plus.first().click();
    const tiroir = tiroirActions(page);
    await expect(tiroir).toBeVisible();
    const famille = tiroir.locator('section').filter({ has: page.getByRole('heading', { name: 'Parcours', exact: true }) });
    await expect(famille.getByRole('button')).toHaveText([
      /^Attendre\s*Met le parcours en pause avant la suite\.$/,
      /^Condition\s*Sépare le parcours en deux chemins\.$/,
      /^Arrêter ici\s*Le client sort du parcours\.$/,
    ]);

    // 1. Attendre, en tête : 1 jour, « Simplement ce délai ».
    await famille.getByRole('button', { name: /^Attendre/ }).click();
    const panneau = panneauEtape(page);
    await expect(panneau.getByRole('heading', { name: 'Attendre', exact: true })).toBeVisible();
    await expect(panneau.getByLabel('Attendre *')).toHaveValue('1');
    expect(await valeurAffichee(panneau.getByLabel('Unité de temps'))).toBe('jours');
    expect(await valeurAffichee(panneau.getByLabel('Ce qu’on attend'))).toBe('Simplement ce délai');
    await enregistrerEtape(page);
    await expect(page.getByRole('button', { name: 'Attendre 1 jour(s)', exact: true })).toBeVisible();
    let steps = await etapesEnBase(bureau, regle.id, (s) => s.length === 2);
    const attente = steps.find((e) => e.type === 'attendre');
    expect(attente).toEqual({ id: attente?.id, type: 'attendre', delai_secondes: 86400, suivant: 'e1' });
    expect(steps[0]).toBe(attente);   // insérée EN TÊTE

    // 2. Condition, après l'attente : la suite passe sous « si oui ».
    await plus.nth(1).click();
    await tiroirActions(page).getByRole('button', { name: /^Condition/ }).click();
    await expect(panneau.getByRole('heading', { name: 'Condition', exact: true })).toBeVisible();
    await expect(panneau.getByLabel('Conditions')).toHaveValue('');
    await enregistrerEtape(page);
    await expect(page.getByRole('button', { name: 'Si… 0 condition(s)', exact: true })).toBeVisible();
    steps = await etapesEnBase(bureau, regle.id, (s) => s.length === 3);
    const si = steps.find((e) => e.type === 'si');
    expect(si).toEqual({ id: si?.id, type: 'si', conditions: {}, alors: 'e1', sinon: null });
    expect(steps.find((e) => e.type === 'attendre')?.suivant).toBe(si?.id);

    // 3. Arrêter ici, dans la branche « si non » : rien à configurer.
    await page.getByText('si non', { exact: true }).locator('xpath=..').getByRole('button', { name: 'Ajouter une étape ici' }).click();
    await tiroirActions(page).getByRole('button', { name: /^Arrêter ici/ }).click();
    await expect(panneau.getByRole('heading', { name: 'Arrêter ici', exact: true })).toBeVisible();
    await expect(panneau.getByText('Rien à configurer. Le client sort du parcours en arrivant ici.')).toBeVisible();
    await expect(panneau.locator('input, select, textarea')).toHaveCount(0);
    await enregistrerEtape(page);
    steps = await etapesEnBase(bureau, regle.id, (s) => s.length === 4);
    const arret = steps.find((e) => e.type === 'arreter');
    expect(arret).toEqual({ id: arret?.id, type: 'arreter' });
    expect(steps.find((e) => e.type === 'si')?.sinon).toBe(arret?.id);

    // Rechargé : les trois cartes sont là, dans le bon ordre.
    await page.reload();
    await expect(page.getByRole('button', { name: 'Attendre 1 jour(s)', exact: true })).toBeVisible({ timeout: 90_000 });
    await expect(page.getByRole('button', { name: 'Si… 0 condition(s)', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Arrêter ici', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Arrêter ici', exact: true }).click();
    await expect(panneauEtape(page).getByText('Rien à configurer. Le client sort du parcours en arrivant ici.')).toBeVisible();
  });
});

// ── Attendre : 3 modes × 3 unités ─────────────────────────────────────────

const UNITES = [
  { unite: 'minutes', n: 45, secondes: 2700, carte: '45 minute(s)' },
  { unite: 'heures', n: 5, secondes: 18000, carte: '5 heure(s)' },
  { unite: 'jours', n: 3, secondes: 259200, carte: '3 jour(s)' },
] as const;

async function reglerAttente(page: Page, carte: Locator, o: { n: number; unite: string; mode?: string }): Promise<void> {
  await carte.click();
  const panneau = panneauEtape(page);
  await expect(panneau.getByRole('heading', { name: 'Attendre', exact: true })).toBeVisible();
  if (o.mode) await panneau.getByLabel('Ce qu’on attend').selectOption({ label: o.mode });
  await panneau.getByLabel('Unité de temps').selectOption({ label: o.unite });
  await panneau.getByLabel('Attendre *').fill(String(o.n));
  await expect(panneau.getByLabel('Attendre *')).toHaveValue(String(o.n));
  expect(await valeurAffichee(panneau.getByLabel('Unité de temps'))).toBe(o.unite);
  await panneau.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(panneau).toBeHidden();
}

const TROIS_ATTENTES = [
  { id: 'a1', type: 'attendre', delai_secondes: 86400, suivant: 'a2' },
  { id: 'a2', type: 'attendre', delai_secondes: 86400, suivant: 'a3' },
  { id: 'a3', type: 'attendre', delai_secondes: 86400, suivant: 'e1' },
  NOTIF,
];

test.describe('étape « Attendre »', () => {
  test('[EDT-118][EDT-119][EDT-120] mode « Simplement ce délai » en minutes, heures et jours : enregistré en secondes, relu dans l’unité saisie', async ({ page, bureau, marque }) => {
    test.setTimeout(240_000);
    await donnees(bureau);
    const regle = await creerRegle(bureau, bureau.orgA, { name: `${marque} délai`, trigger_event: 'lead.created', conditions: {}, steps: TROIS_ATTENTES });
    await ouvrirEditeur(page, regle.id);
    const cartes = page.getByRole('button', { name: /^Attendre / });
    await expect(cartes).toHaveCount(3);

    // Sur « Nouveau prospect », l'attente « avant le rendez-vous » n'est PAS offerte.
    await cartes.nth(0).click();
    const panneau = panneauEtape(page);
    expect(await optionsDe(panneau.getByLabel('Ce qu’on attend'))).toEqual(['Simplement ce délai', 'La réponse du client (au plus ce délai)']);
    expect(await optionsDe(panneau.getByLabel('Unité de temps'))).toEqual(['minutes', 'heures', 'jours']);
    await expect(panneau.getByText('Le parcours continue une fois le délai écoulé, quoi qu’il arrive.')).toBeVisible();
    await panneau.getByRole('button', { name: 'Annuler', exact: true }).click();
    await expect(panneau).toBeHidden();

    for (const [i, u] of UNITES.entries()) await reglerAttente(page, cartes.nth(i), u);
    await expect(cartes).toHaveText(UNITES.map((u) => new RegExp(`^Attendre\\s*${u.carte.replace(/[()]/g, '\\$&')}$`)));

    const steps = await etapesEnBase(bureau, regle.id, (s) => s[2]?.delai_secondes === 259200);
    expect(steps).toEqual([
      { id: 'a1', type: 'attendre', delai_secondes: 2700, suivant: 'a2' },
      { id: 'a2', type: 'attendre', delai_secondes: 18000, suivant: 'a3' },
      { id: 'a3', type: 'attendre', delai_secondes: 259200, suivant: 'e1' },
      NOTIF,
    ]);
    await expect(etat(page)).toBeVisible({ timeout: 30_000 });

    await page.reload();
    await expect(cartes).toHaveCount(3, { timeout: 90_000 });
    for (const [i, u] of UNITES.entries()) {
      await cartes.nth(i).click();
      await expect(panneau.getByLabel('Attendre *')).toHaveValue(String(u.n));
      expect(await valeurAffichee(panneau.getByLabel('Unité de temps'))).toBe(u.unite);
      expect(await valeurAffichee(panneau.getByLabel('Ce qu’on attend'))).toBe('Simplement ce délai');
      await panneau.getByRole('button', { name: 'Annuler', exact: true }).click();
      await expect(panneau).toBeHidden();
    }
  });

  test('[EDT-118][EDT-119][EDT-120] mode « La réponse du client (au plus ce délai) » en minutes, heures et jours : `mode: reponse` enregistré avec le délai, relu tel quel', async ({ page, bureau, marque }) => {
    test.setTimeout(240_000);
    await donnees(bureau);
    const regle = await creerRegle(bureau, bureau.orgA, { name: `${marque} réponse`, trigger_event: 'quote.sent', conditions: {}, steps: TROIS_ATTENTES });
    await ouvrirEditeur(page, regle.id);
    const cartes = page.getByRole('button', { name: /^Attendre / });
    await expect(cartes).toHaveCount(3);
    const MODE = 'La réponse du client (au plus ce délai)';
    for (const [i, u] of UNITES.entries()) await reglerAttente(page, cartes.nth(i), { ...u, mode: MODE });

    const steps = await etapesEnBase(bureau, regle.id, (s) => s[2]?.delai_secondes === 259200 && s[2]?.mode === 'reponse');
    expect(steps).toEqual([
      { id: 'a1', type: 'attendre', delai_secondes: 2700, suivant: 'a2', mode: 'reponse' },
      { id: 'a2', type: 'attendre', delai_secondes: 18000, suivant: 'a3', mode: 'reponse' },
      { id: 'a3', type: 'attendre', delai_secondes: 259200, suivant: 'e1', mode: 'reponse' },
      NOTIF,
    ]);
    await expect(etat(page)).toBeVisible({ timeout: 30_000 });

    await page.reload();
    await expect(cartes).toHaveCount(3, { timeout: 90_000 });
    const panneau = panneauEtape(page);
    for (const [i, u] of UNITES.entries()) {
      await cartes.nth(i).click();
      await expect(panneau.getByLabel('Attendre *')).toHaveValue(String(u.n));
      expect(await valeurAffichee(panneau.getByLabel('Unité de temps'))).toBe(u.unite);
      expect(await valeurAffichee(panneau.getByLabel('Ce qu’on attend'))).toBe(MODE);
      await expect(panneau.getByText('S’il répond, le parcours s’arrête ici. Sinon, la suite part une fois le délai écoulé.')).toBeVisible();
      await panneau.getByRole('button', { name: 'Annuler', exact: true }).click();
      await expect(panneau).toBeHidden();
    }
  });

  test('[EDT-120] sur la carte, une attente « réponse du client » se distingue d’une attente simple @defaut', async ({ page, bureau, marque }) => {
    await donnees(bureau);
    const regle = await creerRegle(bureau, bureau.orgA, {
      name: `${marque} carte réponse`, trigger_event: 'quote.sent', conditions: {},
      steps: [{ id: 'a1', type: 'attendre', delai_secondes: 259200, mode: 'reponse', suivant: 'e1' }, NOTIF],
    });
    await ouvrirEditeur(page, regle.id);
    const carte = page.getByRole('button', { name: /^Attendre / });
    await expect(carte).toBeVisible();
    // « Attendre 3 jour(s) » ne dit pas que le parcours S'ARRÊTE si le client répond : la carte doit le montrer.
    await expect(carte).toContainText(/réponse|répond/i);
  });

  test('[EDT-118][EDT-119][EDT-120][DEC-11] mode « Ce délai AVANT le rendez-vous » (offert sur « Rendez-vous planifié » seulement), en heures et en jours : `secondes_avant` enregistré, relu, redit sur la carte', async ({ page, bureau, marque }) => {
    test.setTimeout(240_000);
    await donnees(bureau);
    const regle = await creerRegle(bureau, bureau.orgA, {
      name: `${marque} avant`, trigger_event: 'appointment.created', conditions: {},
      steps: [
        { id: 'a1', type: 'attendre', delai_secondes: 86400, suivant: 'e1' },
        { ...NOTIF, suivant: 'a2' },
        { id: 'a2', type: 'attendre', delai_secondes: 86400, suivant: 'e2' },
        { ...NOTIF, id: 'e2' },
      ],
    });
    await ouvrirEditeur(page, regle.id);
    const cartes = page.getByRole('button', { name: /^Attendre / });
    await expect(cartes).toHaveCount(2);
    const MODE = 'Ce délai AVANT le rendez-vous';
    const panneau = panneauEtape(page);
    await cartes.nth(0).click();
    expect(await optionsDe(panneau.getByLabel('Ce qu’on attend'))).toEqual(['Simplement ce délai', 'La réponse du client (au plus ce délai)', MODE]);
    await panneau.getByRole('button', { name: 'Annuler', exact: true }).click();

    await reglerAttente(page, cartes.nth(0), { n: 2, unite: 'jours', mode: MODE });
    await reglerAttente(page, cartes.nth(1), { n: 5, unite: 'heures', mode: MODE });
    await expect(cartes).toHaveText([/^Attendre\s*2 jour\(s\) avant le rendez-vous$/, /^Attendre\s*5 heure\(s\) avant le rendez-vous$/]);

    const steps = await etapesEnBase(bureau, regle.id, (s) => s[2]?.mode === 'avant_date');
    expect(steps[0]).toEqual({ id: 'a1', type: 'attendre', delai_secondes: 0, suivant: 'e1', mode: 'avant_date', secondes_avant: 172800 });
    expect(steps[2]).toEqual({ id: 'a2', type: 'attendre', delai_secondes: 0, suivant: 'e2', mode: 'avant_date', secondes_avant: 18000 });
    await expect(etat(page)).toBeVisible({ timeout: 30_000 });

    await page.reload();
    await expect(cartes).toHaveText([/^Attendre\s*2 jour\(s\) avant le rendez-vous$/, /^Attendre\s*5 heure\(s\) avant le rendez-vous$/], { timeout: 90_000 });
    for (const [i, u] of [{ n: 2, unite: 'jours' }, { n: 5, unite: 'heures' }].entries()) {
      await cartes.nth(i).click();
      await expect(panneau.getByLabel('Attendre *')).toHaveValue(String(u.n));
      expect(await valeurAffichee(panneau.getByLabel('Unité de temps'))).toBe(u.unite);
      expect(await valeurAffichee(panneau.getByLabel('Ce qu’on attend'))).toBe(MODE);
      await expect(panneau.getByText('Le rappel part ce délai avant le rendez-vous. Rendez-vous déplacé : le rappel suit. Moment déjà passé : ce rappel est sauté.')).toBeVisible();
      await panneau.getByRole('button', { name: 'Annuler', exact: true }).click();
      await expect(panneau).toBeHidden();
    }
  });

  test('[EDT-118][EDT-119][EDT-120][DEC-11] « 45 minutes AVANT le rendez-vous » : la carte redit 45 minutes (pas « 1 heure(s) ») @defaut', async ({ page, bureau, marque }) => {
    await donnees(bureau);
    const regle = await creerRegle(bureau, bureau.orgA, {
      name: `${marque} avant minutes`, trigger_event: 'appointment.created', conditions: {},
      steps: [{ id: 'a1', type: 'attendre', delai_secondes: 86400, suivant: 'e1' }, NOTIF],
    });
    await ouvrirEditeur(page, regle.id);
    const carte = page.getByRole('button', { name: /^Attendre / });
    await reglerAttente(page, carte, { n: 45, unite: 'minutes', mode: 'Ce délai AVANT le rendez-vous' });
    const steps = await etapesEnBase(bureau, regle.id, (s) => s[0]?.mode === 'avant_date');
    expect(steps[0]).toEqual({ id: 'a1', type: 'attendre', delai_secondes: 0, suivant: 'e1', mode: 'avant_date', secondes_avant: 2700 });
    await expect(carte).toHaveText(/^Attendre\s*45 minute\(s\) avant le rendez-vous$/);
  });

  test('[EDT-118][EDT-119] effacer le nombre puis en taper un autre garde l’unité choisie (3 jours → 5 jours, pas 5 minutes)', async ({ page, bureau, marque }) => {
    await donnees(bureau);
    const regle = await creerRegle(bureau, bureau.orgA, {
      name: `${marque} S-18 effacer`, trigger_event: 'lead.created', conditions: {},
      steps: [{ id: 'a1', type: 'attendre', delai_secondes: 259200, suivant: 'e1' }, NOTIF],
    });
    await ouvrirEditeur(page, regle.id);
    await page.getByRole('button', { name: 'Attendre 3 jour(s)', exact: true }).click();
    const panneau = panneauEtape(page);
    const nombre = panneau.getByLabel('Attendre *');
    await expect(nombre).toHaveValue('3');
    // Geste réel : cliquer dans le champ, effacer le 3, taper 5.
    await nombre.click();
    await nombre.press('End');
    await nombre.press('Backspace');
    await nombre.pressSequentially('5');
    expect.soft(await nombre.inputValue()).toBe('5');
    expect.soft(await valeurAffichee(panneau.getByLabel('Unité de temps')), 'l’unité après avoir retapé le nombre').toBe('jours');
    await panneau.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    const steps = await etapesEnBase(bureau, regle.id, (s) => s[0]?.delai_secondes !== 259200);
    expect(steps[0]?.delai_secondes, '5 jours = 432 000 s (5 minutes = 300 s)').toBe(432000);
  });

  test('[EDT-119] l’unité choisie reste celle qu’on a choisie : à 0, « jours » reste « jours » ; « 24 heures » ne devient pas « 1 jours »', async ({ page, bureau, marque }) => {
    await donnees(bureau);
    const regle = await creerRegle(bureau, bureau.orgA, {
      name: `${marque} S-18 unité`, trigger_event: 'lead.created', conditions: {},
      steps: [{ id: 'a1', type: 'attendre', delai_secondes: 0, suivant: 'a2' }, { id: 'a2', type: 'attendre', delai_secondes: 3600, suivant: 'e1' }, NOTIF],
    });
    await ouvrirEditeur(page, regle.id);
    const panneau = panneauEtape(page);
    const unite = panneau.getByLabel('Unité de temps');
    // À 0 : choisir « jours » avant de taper le nombre.
    await page.getByRole('button', { name: 'Attendre tout de suite', exact: true }).click();
    await unite.selectOption({ label: 'jours' });
    expect.soft(await valeurAffichee(unite), 'à 0, après avoir choisi « jours »').toBe('jours');
    await panneau.getByRole('button', { name: 'Annuler', exact: true }).click();
    const confirmer = page.getByRole('dialog').getByRole('button', { name: 'Fermer sans enregistrer' });
    if (await confirmer.isVisible().catch(() => false)) await confirmer.click();
    await expect(panneau).toBeHidden();
    // 1 heure → 24 heures : le nombre et l'unité restent ceux qu'on a saisis.
    await page.getByRole('button', { name: 'Attendre 1 heure(s)', exact: true }).click();
    expect(await valeurAffichee(unite)).toBe('heures');
    await panneau.getByLabel('Attendre *').fill('24');
    expect.soft(await panneau.getByLabel('Attendre *').inputValue(), 'le nombre après avoir tapé 24 (heures)').toBe('24');
    expect.soft(await valeurAffichee(unite), 'l’unité après avoir tapé 24 (heures)').toBe('heures');
  });

  test('[EDT-118] une attente plus longue que ce que le serveur accepte (366 jours ; 30 jours avant un rendez-vous) est refusée DANS le panneau, avec la limite', async ({ page, bureau, marque }) => {
    await donnees(bureau);
    const regle = await creerRegle(bureau, bureau.orgA, {
      name: `${marque} trop long`, trigger_event: 'appointment.created', conditions: {},
      steps: [{ id: 'a1', type: 'attendre', delai_secondes: 86400, suivant: 'e1' }, NOTIF],
    });
    await ouvrirEditeur(page, regle.id);
    await page.getByRole('button', { name: 'Attendre 1 jour(s)', exact: true }).click();
    const panneau = panneauEtape(page);
    const bouton = panneau.getByRole('button', { name: 'Enregistrer', exact: true });
    // La limite est écrite DEUX fois dans le panneau (59ed48b5) : dans la liste des choses à corriger, et à côté
    // du bouton. L'attente d'origine cherchait « un » texte par un motif large : avec deux, le localisateur strict
    // tombait alors que le panneau fait ce qu'on lui demande. On exige maintenant la phrase EXACTE, visible.
    const limiteDite = async (phrase: string) => {
      await expect.soft(panneau.getByText(phrase, { exact: true }).first(), `le panneau dit la limite : « ${phrase} »`).toBeVisible({ timeout: 3_000 });
    };
    const UN_AN = 'Une attente ne peut pas dépasser 366 jours (un an).';
    const TRENTE_JOURS = 'On peut envoyer au plus 30 jours avant le rendez-vous.';
    await panneau.getByLabel('Attendre *').fill('400');
    // 400 jours : le serveur refusera le parcours entier. Le panneau doit l'empêcher ici, et dire la limite.
    expect.soft(await bouton.isDisabled(), '« Enregistrer » avec 400 jours').toBe(true);
    await limiteDite(UN_AN);
    // La borne elle-même : 366 jours passent, 367 non.
    await panneau.getByLabel('Attendre *').fill('366');
    await expect.soft(bouton, '« Enregistrer » avec 366 jours (la limite)').toBeEnabled();
    await expect.soft(panneau.getByText(UN_AN, { exact: true })).toHaveCount(0);
    await panneau.getByLabel('Attendre *').fill('367');
    await expect.soft(bouton, '« Enregistrer » avec 367 jours').toBeDisabled();
    await panneau.getByLabel('Ce qu’on attend').selectOption({ label: 'Ce délai AVANT le rendez-vous' });
    await panneau.getByLabel('Attendre *').fill('45');
    expect.soft(await bouton.isDisabled(), '« Enregistrer » avec 45 jours avant le rendez-vous').toBe(true);
    await limiteDite(TRENTE_JOURS);
    await panneau.getByLabel('Attendre *').fill('30');
    await expect.soft(bouton, '« Enregistrer » avec 30 jours avant le rendez-vous (la limite)').toBeEnabled();
    await expect.soft(panneau.getByText(TRENTE_JOURS, { exact: true })).toHaveCount(0);
    await panneau.getByLabel('Attendre *').fill('31');
    await expect.soft(bouton, '« Enregistrer » avec 31 jours avant le rendez-vous').toBeDisabled();
    // Rien n'a été écrit pendant ces refus : l'étape en base est celle d'origine.
    expect((await lireRegle(bureau, regle.id))?.steps).toEqual([{ id: 'a1', type: 'attendre', delai_secondes: 86400, suivant: 'e1' }, NOTIF]);
  });

  test('[EDT-118] le refus du serveur pour une attente trop longue est écrit en français', async ({ bureau, marque, jetonDe }) => {
    const regle = await creerRegle(bureau, bureau.orgA, { name: `${marque} refus attente`, trigger_event: 'appointment.created', conditions: {}, steps: ETAPE_NOTIF });
    const jeton = await jetonDe('proprioA');
    const trop = await appelApi(BASE, jeton, bureau.orgA, 'PATCH', `/api/automations/rules/${regle.id}`, {
      steps: [{ id: 'a1', type: 'attendre', delai_secondes: 400 * 86400, suivant: 'e1' }, NOTIF],
    });
    const avant = await appelApi(BASE, jeton, bureau.orgA, 'PATCH', `/api/automations/rules/${regle.id}`, {
      steps: [{ id: 'a1', type: 'attendre', delai_secondes: 0, mode: 'avant_date', secondes_avant: 45 * 86400, suivant: 'e1' }, NOTIF],
    });
    // Le serveur refuse bien (c'est le message qui pèche) : il finit tel quel dans un toast de l'éditeur.
    expect(trop.status).toBe(400);
    expect(avant.status).toBe(400);
    const messages = [trop, avant].map((r) => String((r.json as { error?: string }).error ?? ''));
    for (const m of messages) expect.soft(m, `message du serveur : « ${m} »`).not.toMatch(/Cannot wait|At most|before\b/i);
    expect((await lireRegle(bureau, regle.id))?.steps).toEqual(ETAPE_NOTIF);
  });

  test('[EDT-118] l’aide « jamais entre 20 h et 8 h » suit la fenêtre d’envoi réglée pour CETTE automatisation @defaut', async ({ page, bureau, marque }) => {
    await donnees(bureau);
    const regle = await creerRegle(bureau, bureau.orgA, {
      name: `${marque} fenêtre`, trigger_event: 'lead.created', conditions: {}, settings: { fenetre: { debut: 9, fin: 17 } },
      steps: [{ id: 'a1', type: 'attendre', delai_secondes: 86400, suivant: 'e1' }, NOTIF],
    });
    await ouvrirEditeur(page, regle.id);
    await page.getByRole('button', { name: 'Attendre 1 jour(s)', exact: true }).click();
    const panneau = panneauEtape(page);
    await expect(panneau.getByLabel('Attendre *')).toBeVisible();
    // Fenêtre réglée à 9 h – 17 h (onglet Réglages) : dire « entre 20 h et 8 h » est faux pour cette automatisation.
    await expect(panneau.getByText(/entre 17 h et 9 h/)).toBeVisible({ timeout: 5_000 });
  });
});

// ── Si / sinon ────────────────────────────────────────────────────────────

const REGLE_SI = (conditions: Record<string, unknown> = {}) => [{ id: 's1', type: 'si', conditions, alors: 'e1', sinon: null }, NOTIF];
const lignes = (texte: string) => texte.split('\n').map((l) => l.trim()).filter(Boolean).sort();

test.describe('étape « Si… » — conditions en texte', () => {
  test('[EDT-121][EDT-122][EDT-123][EDT-124] les quatre exemples cliquables ajoutent leur ligne à la fin de la zone « Conditions »', async ({ page, bureau, marque }) => {
    await donnees(bureau);
    const regle = await creerRegle(bureau, bureau.orgA, { name: `${marque} exemples`, trigger_event: 'quote.sent', conditions: {}, steps: REGLE_SI() });
    await ouvrirEditeur(page, regle.id);
    await page.getByRole('button', { name: /^Si…/ }).click();
    const panneau = panneauEtape(page);
    const zone = panneau.getByLabel('Conditions');
    await expect(zone).toHaveValue('');
    const exemples = ['statut =', 'source =', 'total_cents >', 'created_at >='];
    for (const e of exemples) await expect(panneau.getByRole('button', { name: e, exact: true })).toBeVisible();
    await panneau.getByRole('button', { name: 'statut =', exact: true }).click();
    await expect(zone).toHaveValue('statut = ');
    await zone.pressSequentially('envoye');
    await panneau.getByRole('button', { name: 'total_cents >', exact: true }).click();
    await expect(zone).toHaveValue('statut = envoye\ntotal_cents > ');
    await zone.pressSequentially('500000');
    await panneau.getByRole('button', { name: 'source =', exact: true }).click();
    await panneau.getByRole('button', { name: 'created_at >=', exact: true }).click();
    await expect(zone).toHaveValue('statut = envoye\ntotal_cents > 500000\nsource = \ncreated_at >= ');
    // Les deux dernières lignes n'ont pas encore de valeur. Depuis df770cbc elles ne sont plus jetées en silence à
    // l'enregistrement (c'était le défaut 05:470) : chacune est SIGNALÉE, et « Enregistrer » est retenu.
    const bouton = panneau.getByRole('button', { name: 'Enregistrer', exact: true });
    const alerte = panneau.getByRole('alert');
    await expect(alerte).toContainText('Ligne illisible « source = » : il manque la valeur.');
    await expect(alerte).toContainText('Ligne illisible « created_at >= » : il manque la valeur.');
    await expect(alerte, 'les deux lignes complètes ne sont pas signalées').not.toContainText(/statut|total_cents/);
    await expect(bouton).toBeDisabled();
    expect((await lireRegle(bureau, regle.id))?.steps, 'rien n’est écrit tant que des lignes sont illisibles').toEqual(REGLE_SI());
    // On complète, comme un utilisateur : la dernière ligne d'abord (le curseur est à la fin de la zone)…
    await zone.pressSequentially('2026-06-01');
    await expect(zone).toHaveValue('statut = envoye\ntotal_cents > 500000\nsource = \ncreated_at >= 2026-06-01');
    await expect(alerte).not.toContainText('created_at');
    await expect(bouton, 'une ligne reste sans valeur : toujours retenu').toBeDisabled();
    // … puis la troisième : flèche vers le haut, fin de ligne.
    await zone.press('ArrowUp');
    await zone.press('End');
    await zone.pressSequentially('web');
    await expect(zone).toHaveValue('statut = envoye\ntotal_cents > 500000\nsource = web\ncreated_at >= 2026-06-01');
    await expect(alerte).toHaveCount(0);
    await expect(bouton).toBeEnabled();
    await enregistrerEtape(page);
    const steps = await etapesEnBase(bureau, regle.id, (s) => Object.keys((s[0]?.conditions ?? {}) as object).length > 0);
    expect(steps[0]?.conditions).toEqual({ statut: 'envoye', total_cents: { gt: 500000 }, source: 'web', created_at: { gte: '2026-06-01' } });
    await expect(page.getByRole('button', { name: 'Si… 4 condition(s)', exact: true })).toBeVisible();
  });

  test('[EDT-125] les six signes ( =  !=  >  >=  <  <= ) et l’intervalle : enregistrés dans la forme que le moteur évalue, relus ligne pour ligne', async ({ page, bureau, marque }) => {
    await donnees(bureau);
    const regle = await creerRegle(bureau, bureau.orgA, { name: `${marque} signes`, trigger_event: 'quote.sent', conditions: {}, steps: REGLE_SI() });
    await ouvrirEditeur(page, regle.id);
    await page.getByRole('button', { name: /^Si…/ }).click();
    const panneau = panneauEtape(page);
    const saisie = [
      'statut = envoyé',            // =   (accent)
      'source != web',              // !=
      'total_cents > 500000',       // >
      'created_at >= 2026-06-01',   // >=  (date)
      'jours < 30',                 // <
      'score <= 4.5',               // <=  (décimale)
      'montant >= 1000',            // intervalle : deux lignes sur la même clé
      'montant < 5000',
    ].join('\n');
    await panneau.getByLabel('Conditions').fill(saisie);
    await enregistrerEtape(page);

    const attendu = {
      statut: 'envoyé',
      source: { neq: 'web' },
      total_cents: { gt: 500000 },
      created_at: { gte: '2026-06-01' },
      jours: { lt: 30 },
      score: { lte: 4.5 },
      montant: { gte: 1000, lt: 5000 },
    };
    const steps = await etapesEnBase(bureau, regle.id, (s) => Object.keys((s[0]?.conditions ?? {}) as object).length > 0);
    expect(steps[0]).toEqual({ id: 's1', type: 'si', conditions: attendu, alors: 'e1', sinon: null });
    await expect(page.getByRole('button', { name: 'Si… 7 condition(s)', exact: true })).toBeVisible();

    // ── Le moteur : la forme enregistrée est jugée comme l'écran le laisse entendre. ──
    const conditions = steps[0]?.conditions as Record<string, unknown>;
    const quiPasse = { statut: 'envoyé', source: 'facebook', total_cents: 500001, created_at: '2026-06-01T10:00:00Z', jours: 29, score: 4.5, montant: 1000 };
    expect(evaluateConditions(conditions, evenement(quiPasse)), 'tout est vrai → « si oui »').toBe(true);
    const unFaux: Array<[string, unknown]> = [
      ['statut', 'brouillon'], ['source', 'web'], ['total_cents', 500000], ['created_at', '2026-05-31T23:59:59Z'], ['jours', 30], ['score', 4.6], ['montant', 5000], ['montant', 999],
    ];
    for (const [cle, v] of unFaux) {
      expect.soft(evaluateConditions(conditions, evenement({ ...quiPasse, [cle]: v })), `moteur — ${cle} = ${JSON.stringify(v)} doit faire « si non »`).toBe(false);
    }

    // ── Relu : les mêmes lignes (l'ordre des clés est celui de la base). ──
    await page.reload();
    await expect(page.getByRole('button', { name: 'Si… 7 condition(s)', exact: true })).toBeVisible({ timeout: 90_000 });
    await page.getByRole('button', { name: /^Si…/ }).click();
    await expect.poll(async () => lignes(await panneauEtape(page).getByLabel('Conditions').inputValue())).toEqual(lignes(saisie));
  });

  test('[EDT-125] une ligne mal écrite (sans signe, sans valeur) est SIGNALÉE — pas jetée en silence', async ({ page, bureau, marque }) => {
    await donnees(bureau);
    const regle = await creerRegle(bureau, bureau.orgA, { name: `${marque} S-20`, trigger_event: 'quote.sent', conditions: {}, steps: REGLE_SI() });
    await ouvrirEditeur(page, regle.id);
    await page.getByRole('button', { name: /^Si…/ }).click();
    const panneau = panneauEtape(page);
    await panneau.getByLabel('Conditions').fill('montant 5000\nstatut =');
    // « montant 5000 » ne veut rien dire pour le moteur : sans message, la condition part VIDE et le parcours
    // suit toujours « si oui ». Le panneau doit dire quelle ligne il ne comprend pas, ou refuser d'enregistrer.
    const bouton = panneau.getByRole('button', { name: 'Enregistrer', exact: true });
    const alerte = panneau.getByText(/ligne|incompl|pas comprise|invalide|signe/i).filter({ hasNotText: 'Une ligne par condition' });
    await expect(async () => {
      expect((await bouton.isDisabled()) || (await alerte.count()) > 0, 'ligne illisible signalée, ou enregistrement retenu').toBe(true);
    }).toPass({ timeout: 5_000 });
  });

  test('[EDT-125] plus de conditions ou des valeurs plus longues que ce que le serveur accepte (10 clés, 200 caractères) : refusé DANS le panneau @defaut', async ({ page, bureau, marque }) => {
    await donnees(bureau);
    const regle = await creerRegle(bureau, bureau.orgA, { name: `${marque} limites si`, trigger_event: 'quote.sent', conditions: {}, steps: REGLE_SI() });
    await ouvrirEditeur(page, regle.id);
    await page.getByRole('button', { name: /^Si…/ }).click();
    const panneau = panneauEtape(page);
    const bouton = panneau.getByRole('button', { name: 'Enregistrer', exact: true });
    // 11 conditions : le serveur en accepte 10 (« Too many conditions (10 max). »).
    await panneau.getByLabel('Conditions').fill(Array.from({ length: 11 }, (_, i) => `cle${i + 1} = v`).join('\n'));
    expect.soft(await bouton.isDisabled(), '« Enregistrer » avec 11 conditions').toBe(true);
    // Une valeur de 300 caractères : le serveur en accepte 200.
    await panneau.getByLabel('Conditions').fill(`note = ${'é'.repeat(300)}`);
    expect.soft(await bouton.isDisabled(), '« Enregistrer » avec une valeur de 300 caractères').toBe(true);
  });

  test('[EDT-125] une condition « est l’un de » (in / not_in) posée par Lumi ou un modèle s’affiche dans le panneau, et survit à une modification', async ({ page, bureau, marque }) => {
    await donnees(bureau);
    const conditions = { source: { in: ['web', 'facebook'] }, statut: { not_in: ['perdu'] } };
    // Le serveur ACCEPTE cette forme, et le moteur la juge.
    expect(evaluateConditions(conditions, evenement({ source: 'facebook', statut: 'envoye' }))).toBe(true);
    expect(evaluateConditions(conditions, evenement({ source: 'appel', statut: 'envoye' }))).toBe(false);
    const regle = await creerRegle(bureau, bureau.orgA, { name: `${marque} S-21`, trigger_event: 'quote.sent', conditions: {}, steps: REGLE_SI(conditions) });
    await ouvrirEditeur(page, regle.id);
    await expect(page.getByRole('button', { name: 'Si… 2 condition(s)', exact: true })).toBeVisible();
    await page.getByRole('button', { name: /^Si…/ }).click();
    const panneau = panneauEtape(page);
    const zone = panneau.getByLabel('Conditions');
    // La carte annonce 2 conditions ; le panneau doit les montrer.
    expect.soft(await zone.inputValue(), 'la zone « Conditions » montre les conditions existantes').toMatch(/source/);
    // … chacune sur sa ligne, écrite en clair (l'ordre des lignes est celui des clés en base).
    expect.soft(lignes(await zone.inputValue())).toEqual(['source est l’un de web, facebook', 'statut n’est aucun de perdu']);
    // Ajouter une condition ne doit pas effacer celles d'origine. Le geste d'un utilisateur qui AJOUTE : cliquer dans
    // la zone, aller à la fin, passer à la ligne, taper. (Avant : le test tapait sans se placer — le curseur d'une zone
    // jamais cliquée est au DÉBUT, le texte se collait devant « source est l'un de… » et donnait une ligne illisible.)
    await zone.click();
    await zone.press('ControlOrMeta+End');
    await zone.press('Enter');
    await zone.pressSequentially('montant > 100');
    expect(lignes(await zone.inputValue())).toEqual(['montant > 100', 'source est l’un de web, facebook', 'statut n’est aucun de perdu']);
    await expect(panneau.getByRole('alert'), 'aucune ligne n’est signalée illisible').toHaveCount(0);
    await enregistrerEtape(page);
    const steps = await etapesEnBase(bureau, regle.id, (s) => 'montant' in ((s[0]?.conditions ?? {}) as object) || !('source' in ((s[0]?.conditions ?? {}) as object)));
    expect(steps[0]?.conditions).toMatchObject(conditions);
    // Champ par champ (l'ordre des clés d'un jsonb ne compte pas) : les deux conditions d'origine sont INTACTES —
    // mêmes opérateurs, mêmes valeurs, dans le même ordre, toujours des listes — et la troisième est ajoutée, en nombre.
    const apres = (steps[0]?.conditions ?? {}) as Record<string, unknown>;
    expect(Object.keys(apres).sort()).toEqual(['montant', 'source', 'statut']);
    expect(apres.source).toEqual({ in: ['web', 'facebook'] });
    expect(apres.statut).toEqual({ not_in: ['perdu'] });
    expect(apres.montant).toEqual({ gt: 100 });
    // Le reste de l'étape n'a pas bougé, et le moteur juge toujours les conditions d'origine.
    expect(steps[0]).toEqual({ id: 's1', type: 'si', conditions: apres, alors: 'e1', sinon: null });
    expect(evaluateConditions(apres, evenement({ source: 'facebook', statut: 'envoye', montant: 101 }))).toBe(true);
    expect(evaluateConditions(apres, evenement({ source: 'appel', statut: 'envoye', montant: 101 }))).toBe(false);
    expect(evaluateConditions(apres, evenement({ source: 'web', statut: 'perdu', montant: 101 }))).toBe(false);
    await expect(page.getByRole('button', { name: 'Si… 3 condition(s)', exact: true })).toBeVisible();
    // Rechargé : les trois lignes se relisent.
    await page.reload();
    await expect(page.getByRole('button', { name: 'Si… 3 condition(s)', exact: true })).toBeVisible({ timeout: 90_000 });
    await page.getByRole('button', { name: /^Si…/ }).click();
    await expect.poll(async () => lignes(await panneauEtape(page).getByLabel('Conditions').inputValue()))
      .toEqual(['montant > 100', 'source est l’un de web, facebook', 'statut n’est aucun de perdu']);
  });
});

test.describe('étape « Si… » — conditions sur les champs personnalisés', () => {
  test('[EDT-127][EDT-087][EDT-088] une condition de champ s’ajoute à côté des conditions en texte, s’enregistre sous `champs_perso`, se relit ; retoucher le texte ne l’efface pas', async ({ page, bureau, marque }) => {
    test.setTimeout(240_000);
    const d = await donnees(bureau);
    const regle = await creerRegle(bureau, bureau.orgA, { name: `${marque} si champs`, trigger_event: 'lead.created', conditions: {}, steps: REGLE_SI({ source: 'web' }) });
    await ouvrirEditeur(page, regle.id);
    await page.getByRole('button', { name: /^Si…/ }).click();
    const panneau = panneauEtape(page);
    await expect(panneau.getByText('… et si les champs personnalisés sont :')).toBeVisible();
    await panneau.getByRole('button', { name: 'Ajouter une condition' }).click();
    // Les champs offerts sont ceux de la fiche que le déclencheur fait arriver (le client) : tous, eux seuls, dans
    // l'ordre du bureau — relus en base à l'instant (un autre lot peut y avoir créé les siens).
    const duClient = (await champsDuBureau(bureau, bureau.orgA)).filter((c) => c.object_type === 'client');
    expect(duClient.map((c) => c.label)).toEqual(expect.arrayContaining(['QA Texte', 'QA Nombre', 'QA Liste', 'QA Date', 'QA Case', 'QA Fichier']));
    expect(ecartAvecLOrdreDuBureau(await optionsDe(panneau.getByLabel('Champ', { exact: true })), duClient)).toBeNull();
    await panneau.getByLabel('Champ', { exact: true }).selectOption({ label: 'QA Nombre' });
    await panneau.getByLabel('Opérateur').selectOption({ label: 'plus grand que' });
    await panneau.getByLabel('Valeur', { exact: true }).fill('20');
    // Une deuxième, laissée incomplète : retirée à l'enregistrement.
    await panneau.getByRole('button', { name: 'Ajouter une condition' }).click();
    await panneau.getByLabel('Champ', { exact: true }).nth(1).selectOption({ label: 'QA Texte' });
    // Retoucher le texte après coup ne doit pas effacer la condition de champ.
    await panneau.getByLabel('Conditions').fill('source = web\nstatut != perdu');
    await expect(panneau.getByLabel('Champ', { exact: true })).toHaveCount(2);
    await enregistrerEtape(page);

    const steps = await etapesEnBase(bureau, regle.id, (s) => 'champs_perso' in ((s[0]?.conditions ?? {}) as object));
    const conditions = steps[0]?.conditions as { champs_perso: Array<Record<string, unknown>> } & Record<string, unknown>;
    expect({ ...conditions, champs_perso: conditions.champs_perso.map((c) => Object.fromEntries(Object.entries(c).filter(([, v]) => v !== null))) }).toEqual({
      source: 'web', statut: { neq: 'perdu' }, champs_perso: [{ field_id: d.champs.qa_nombre.id, op: 'gt', value: 20 }],
    });

    await page.reload();
    await expect(page.getByRole('button', { name: /^Si…/ })).toBeVisible({ timeout: 90_000 });
    await page.getByRole('button', { name: /^Si…/ }).click();
    await expect(panneauEtape(page).getByLabel('Champ', { exact: true })).toHaveCount(1);
    expect(await valeurAffichee(panneauEtape(page).getByLabel('Champ', { exact: true }))).toBe('QA Nombre');
    expect(await valeurAffichee(panneauEtape(page).getByLabel('Opérateur'))).toBe('plus grand que');
    await expect(panneauEtape(page).getByLabel('Valeur', { exact: true })).toHaveValue('20');
    expect(lignes(await panneauEtape(page).getByLabel('Conditions').inputValue())).toEqual(['source = web', 'statut != perdu']);
  });

  test('[EDT-127] sur un déclencheur dont la fiche n’a pas de champs (rendez-vous), l’étape « Si… » n’offre pas de conditions de champs', async ({ page, bureau, marque }) => {
    await donnees(bureau);
    const regle = await creerRegle(bureau, bureau.orgA, { name: `${marque} si rdv`, trigger_event: 'appointment.created', conditions: {}, steps: REGLE_SI({ statut: 'x' }) });
    await ouvrirEditeur(page, regle.id);
    await page.getByRole('button', { name: /^Si…/ }).click();
    const panneau = panneauEtape(page);
    await expect(panneau.getByLabel('Conditions')).toHaveValue('statut = x');
    await expect(panneau.getByText('… et si les champs personnalisés sont :')).toHaveCount(0);
    await expect(panneau.getByRole('button', { name: 'Ajouter une condition' })).toHaveCount(0);
  });
});
