/**
 * Éditeur — clavier et focus (pistes S-42, S-43).
 *
 * Ce que ce fichier prouve :
 *  · tout l'éditeur se parcourt à la touche Tab, dans un ordre lisible, et Entrée / Espace activent
 *    cartes, « + », menu, onglets ;
 *  · Échap ferme ce qui est ouvert (tiroir, panneau, menu « ··· », aperçu) ;
 *  · à l'ouverture d'un panneau ou d'un tiroir, le focus y entre ; à la fermeture, il revient d'où il vient ;
 *  · les onglets se parcourent aux flèches, comme tout groupe d'onglets.
 */
import type { Page } from '@playwright/test';
import { lireRegle } from '../_outils/banc';
import {
  test, expect, DELAI_TEST,
  CAPTURES, creerParcours, troisTextos, ouvrirEditeur, cartes, carte, menuDeCarte, barre, attendreEnregistre,
  corpsDuFil, panneauEtape, tiroirActions, tiroirDeclencheurs, panneauDeclencheur,
} from './_aides';

test.describe.configure({ timeout: DELAI_TEST });

const nomDuFocus = (page: Page) => page.evaluate(() => {
  const el = document.activeElement as HTMLElement | null;
  if (!el || el === document.body) return '(aucun)';
  return (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || el.tagName).replace(/\s+/g, ' ').trim().slice(0, 60);
});
const focusDans = (page: Page, selecteur: string) => page.evaluate((s) => !!document.activeElement?.closest(s), selecteur);

test.describe('clavier — parcourir et activer', () => {
  test('[EDT-004][EDT-005][EDT-013][EDT-017][EDT-018] ordre de tabulation de la barre : retour, nom, annuler/refaire, onglets, aperçu, publier', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} tab barre`, troisTextos());
    await ouvrirEditeur(page, r.id);
    // Une modification pour que « Annuler » soit atteignable.
    await menuDeCarte(page, 'Texto CHARLIE').click();
    await page.getByRole('button', { name: 'Supprimer l’action', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Supprimer' }).click();
    await attendreEnregistre(page);
    await barre(page).getByRole('button', { name: 'Mes automatisations' }).focus();
    const ordre: string[] = [await nomDuFocus(page)];
    for (let i = 0; i < 8; i++) { await page.keyboard.press('Tab'); ordre.push(await nomDuFocus(page)); }
    expect(ordre).toEqual([
      'Mes automatisations', `${marque} tab barre`, 'Annuler', 'Parcours', 'Réglages', 'Historique', 'Journaux', 'Aperçu', 'Publier l’automatisation',
    ]);
  });

  test('[EDT-037][EDT-042][EDT-033][EDT-014] au clavier : Entrée sur une carte ouvre son panneau, sur « ··· » le menu, sur « + » le tiroir, sur un onglet son écran', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} entrée`, troisTextos());
    await ouvrirEditeur(page, r.id);
    await carte(page, 'Texto BRAVO').focus();
    await page.keyboard.press('Enter');
    await expect(panneauEtape(page).getByLabel(/Texte du message/)).toHaveValue('Texto BRAVO');
    await panneauEtape(page).getByRole('button', { name: 'Fermer le panneau' }).focus();
    await page.keyboard.press('Enter');
    await expect(panneauEtape(page)).toHaveCount(0);

    await menuDeCarte(page, 'Texto BRAVO').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Dupliquer l’action', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Fermer le menu' }).click({ position: { x: 30, y: 300 } });

    await page.getByRole('button', { name: 'Ajouter une étape ici' }).nth(1).focus();
    await page.keyboard.press('Space');
    await expect(tiroirActions(page)).toBeVisible();
    await tiroirActions(page).getByRole('button', { name: 'Fermer' }).focus();
    await page.keyboard.press('Enter');
    await expect(tiroirActions(page)).toHaveCount(0);

    await page.getByRole('tab', { name: 'Réglages' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Réglages de cette automatisation' })).toBeVisible();
    expect((await lireRegle(bureau, r.id))?.updated_at).toBe(r.updated_at);
  });

  test('[EDT-059] ajouter une étape SANS souris : « Ajouter » → Tab jusqu’à l’action → Entrée → Tab jusqu’à « Enregistrer » → Entrée', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} sans souris`, troisTextos());
    await ouvrirEditeur(page, r.id);
    await page.getByRole('button', { name: 'Ajouter', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(tiroirActions(page)).toBeVisible();
    // Le tiroir est après le canevas dans l'ordre de tabulation : on compte les Tab qu'il faut pour y entrer.
    let tabs = 0;
    while (!(await focusDans(page, 'aside[aria-label="Actions"]')) && tabs < 40) { await page.keyboard.press('Tab'); tabs += 1; }
    expect(await focusDans(page, 'aside[aria-label="Actions"]'), 'le tiroir n’est pas atteignable à la touche Tab').toBe(true);
    test.info().annotations.push({ type: 'tabs-pour-atteindre-le-tiroir', description: String(tabs) });
    for (let i = 0; i < 30 && !(await nomDuFocus(page)).startsWith('Envoyer un texto'); i++) await page.keyboard.press('Tab');
    expect(await nomDuFocus(page)).toMatch(/^Envoyer un texto/);
    await page.keyboard.press('Enter');
    await expect(panneauEtape(page)).toBeVisible();
    for (let i = 0; i < 80 && (await nomDuFocus(page)) !== 'Enregistrer'; i++) await page.keyboard.press('Tab');
    expect(await focusDans(page, 'aside[aria-label="Modifier l’étape"]')).toBe(true);
    await page.keyboard.press('Enter');
    await expect(panneauEtape(page)).toHaveCount(0);
    expect((await cartes(page)).length).toBe(4);
    await attendreEnregistre(page);
    expect((await corpsDuFil(bureau, r.id)).length).toBe(4);
  });
});

test.describe('clavier — Échap', () => {
  // `defaut` : le cas reste un défaut ouvert. Les deux tiroirs se ferment à Échap depuis #870
  // (TiroirChoix.tsx) ; les panneaux, le menu « ··· » et l'aperçu n'écoutent toujours pas la touche.
  for (const cas of [
    { quoi: 'le tiroir des actions', id: 'EDT-056', defaut: false, ouvrir: async (page: Page) => { await page.getByRole('button', { name: 'Ajouter', exact: true }).click(); }, cible: (page: Page) => tiroirActions(page) },
    { quoi: 'le tiroir des déclencheurs', id: 'EDT-056', defaut: false, ouvrir: async (page: Page) => {
      await page.getByRole('button', { name: /^Quand\s*Devis envoyé/ }).click();
      await panneauDeclencheur(page).getByRole('button', { name: 'Changer de déclencheur…' }).click();
    }, cible: (page: Page) => tiroirDeclencheurs(page) },
    { quoi: 'le panneau d’étape (sans saisie en cours)', id: 'EDT-037', defaut: true, ouvrir: async (page: Page) => { await carte(page, 'Texto BRAVO').click(); }, cible: (page: Page) => panneauEtape(page) },
    { quoi: 'le panneau du déclencheur', id: 'EDT-032', defaut: true, ouvrir: async (page: Page) => { await page.getByRole('button', { name: /^Quand\s*Devis envoyé/ }).click(); }, cible: (page: Page) => panneauDeclencheur(page) },
    { quoi: 'le menu « ··· »', id: 'EDT-044', defaut: true, ouvrir: async (page: Page) => { await menuDeCarte(page, 'Texto BRAVO').click(); }, cible: (page: Page) => page.getByRole('button', { name: 'Supprimer à partir d’ici', exact: true }) },
    { quoi: 'l’aperçu', id: 'EDT-055', defaut: true, ouvrir: async (page: Page) => { await page.getByRole('button', { name: 'Aperçu', exact: true }).click(); }, cible: (page: Page) => page.getByRole('heading', { name: 'Ce qui partirait' }) },
  ]) {
    test(`[${cas.id}] Échap ferme ${cas.quoi} (S-42)${cas.defaut ? ' @defaut' : ''}`, async ({ page, bureau, marque }) => {
      const r = await creerParcours(bureau, `${marque} échap`, troisTextos());
      await ouvrirEditeur(page, r.id);
      await cas.ouvrir(page);
      await expect(cas.cible(page)).toBeVisible({ timeout: 60_000 });
      await page.keyboard.press('Escape');
      await expect(cas.cible(page), `Échap ne ferme pas ${cas.quoi} : il faut viser la croix à la souris`).toHaveCount(0, { timeout: 3000 });
    });
  }
});

test.describe('clavier — focus à l’ouverture et à la fermeture', () => {
  test('[EDT-037] ouvrir une étape place le focus DANS son panneau (S-43) @defaut', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} focus panneau`, troisTextos());
    await ouvrirEditeur(page, r.id);
    await carte(page, 'Texto BRAVO').focus();
    await page.keyboard.press('Enter');
    await expect(panneauEtape(page)).toBeVisible();
    await page.screenshot({ path: `${CAPTURES}/edt-s43-focus-panneau.png` });
    const dans = await focusDans(page, 'aside[aria-label="Modifier l’étape"]');
    let tabs = 0;
    while (!(await focusDans(page, 'aside[aria-label="Modifier l’étape"]')) && tabs < 60) { await page.keyboard.press('Tab'); tabs += 1; }
    expect(dans, `le focus reste sur la carte : il faut ${tabs} appuis sur Tab (toutes les cartes, « + », « ··· », zoom…) pour atteindre le panneau qui vient de s’ouvrir`).toBe(true);
  });

  test('[EDT-100][EDT-037] fermer le panneau d’étape rend le focus à la carte (S-43) @defaut', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} focus retour`, troisTextos());
    await ouvrirEditeur(page, r.id);
    await carte(page, 'Texto BRAVO').click();
    await panneauEtape(page).getByRole('button', { name: 'Fermer le panneau' }).click();
    await expect(panneauEtape(page)).toHaveCount(0);
    const ou = await nomDuFocus(page);
    expect(ou, `après la fermeture, le focus est sur « ${ou} » : au clavier on repart du début de la page`).toMatch(/Texto BRAVO/);
  });

  test('[EDT-013][EDT-014][EDT-015][EDT-016] les onglets se parcourent aux flèches gauche / droite (S-43) @defaut', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} flèches`, troisTextos());
    await ouvrirEditeur(page, r.id);
    await page.getByRole('tab', { name: 'Parcours' }).focus();
    await page.keyboard.press('ArrowRight');
    const ou = await nomDuFocus(page);
    expect(ou, 'role="tab" sans la navigation aux flèches qu’annonce ce rôle').toBe('Réglages');
  });

  test('[EDT-055] l’aperçu est annoncé comme un dialogue et retient le focus (S-43) @defaut', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} aperçu dialogue`, troisTextos());
    await ouvrirEditeur(page, r.id);
    // Nom EXACT : le bouton du nom de la règle (« … aperçu dialogue ») contient lui aussi « aperçu ».
    await page.getByRole('button', { name: 'Aperçu', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Ce qui partirait' })).toBeVisible({ timeout: 60_000 });
    const dialogues = await page.getByRole('dialog').count();
    await page.getByRole('button', { name: 'Fermer l’aperçu' }).click();
    expect(dialogues, 'l’aperçu recouvre le canevas mais n’a ni rôle « dialog » ni piège à focus : Tab continue dans les cartes masquées').toBe(1);
  });
});
