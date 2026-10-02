/**
 * Éditeur — le canevas : édition du parcours par les cartes, les « + » et le menu « ··· ».
 *
 * Ce que ce fichier prouve, écran ET base à chaque fois :
 *  · ajouter une étape en tête, au milieu, à la fin (les trois chemins : « + », « Ajouter ») ;
 *  · supprimer en tête, au milieu, en fin : la suite reste reliée ;
 *  · dupliquer, « Supprimer à partir d'ici », annuler une suppression ;
 *  · les branches d'une condition et leurs « + » ; la suppression d'une condition (piste S-12) ;
 *  · « Arrêter ici » inséré au milieu (piste S-12) ; la limite de 30 étapes ;
 *  · le menu « ··· » : contenu selon le type d'étape, fermeture, position (piste S-39).
 */
import { lireRegle } from '../_outils/banc';
import {
  test, expect, DELAI_TEST,
  CAPTURES, creerParcours, troisTextos, texto, attente, ouvrirEditeur, cartes, carte, menuDeCarte,
  attendreEnregistre, corpsDuFil, filEnBase, dialogue, panneauEtape, tiroirActions, toasts, indicateur, type EtapeBase,
} from './_aides';

test.describe.configure({ timeout: DELAI_TEST });

const plus = (page: import('@playwright/test').Page) => page.getByRole('button', { name: 'Ajouter une étape ici' });
const TROIS = ['Envoyer un texto | Texto ALPHA', 'Envoyer un texto | Texto BRAVO', 'Envoyer un texto | Texto CHARLIE'];

/** Texto → attente 2 j → condition (oui : texto + arrêt ; non : texto). */
function parcoursAvecBranches(): EtapeBase[] {
  return [
    texto('e1', 'Texto ALPHA', 'e2'),
    attente('e2', 172800, 'e3'),
    { id: 'e3', type: 'si', conditions: { statut: 'envoye' }, alors: 'e4', sinon: 'e5' },
    texto('e4', 'Texto OUI', 'e6'),
    texto('e5', 'Texto NON', null),
    { id: 'e6', type: 'arreter' },
  ];
}

test.describe('canevas — ajouter une étape', () => {
  test('[EDT-033] « + » en tête : la nouvelle étape devient la première, la suite est reliée (écran + base)', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} tête`, troisTextos());
    await ouvrirEditeur(page, r.id);
    await expect(plus(page)).toHaveCount(4);
    await plus(page).nth(0).click();
    await tiroirActions(page).getByRole('button', { name: /^Attendre/ }).click();
    await expect(panneauEtape(page)).toBeVisible();
    await panneauEtape(page).getByRole('button', { name: 'Enregistrer' }).click();
    expect(await cartes(page)).toEqual(['Attendre | 1 jour(s)', ...TROIS]);
    await attendreEnregistre(page);
    const fil = await filEnBase(bureau, r.id);
    expect(fil.map((e) => e.type)).toEqual(['attendre', 'action', 'action', 'action']);
    expect(fil[0].suivant).toBe('e1');
    expect(fil[0].delai_secondes).toBe(86400);
    expect((await lireRegle(bureau, r.id))?.steps?.length).toBe(4);
  });

  test('[EDT-034] « + » AU MILIEU (entre la 1re et la 2e carte) : insérée à cet endroit, rien ne se détache', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} milieu`, troisTextos());
    await ouvrirEditeur(page, r.id);
    await plus(page).nth(1).click();
    await tiroirActions(page).getByRole('button', { name: /^Créer une tâche/ }).click();
    await expect(panneauEtape(page).getByRole('heading', { name: 'Créer une tâche' })).toBeVisible();
    await panneauEtape(page).getByRole('button', { name: 'Enregistrer' }).click();
    expect(await cartes(page)).toEqual([TROIS[0], 'Créer une tâche | Rappeler [client_name]', TROIS[1], TROIS[2]]);
    await attendreEnregistre(page);
    expect(await corpsDuFil(bureau, r.id)).toEqual(['Texto ALPHA', 'Rappeler [client_name]', 'Texto BRAVO', 'Texto CHARLIE']);
    // Relu après rechargement : même ordre.
    await page.reload();
    await expect(carte(page, 'Texto ALPHA')).toBeVisible({ timeout: 90_000 });
    expect(await cartes(page)).toEqual([TROIS[0], 'Créer une tâche | Rappeler [client_name]', TROIS[1], TROIS[2]]);
  });

  test('[EDT-043] « Ajouter » (en haut à droite) ajoute à la FIN du parcours', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} fin`, troisTextos());
    await ouvrirEditeur(page, r.id);
    await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
    await tiroirActions(page).getByRole('button', { name: /^Envoyer un texto/ }).click();
    await panneauEtape(page).getByLabel(/Texte du message/).fill('Texto DELTA');
    await panneauEtape(page).getByRole('button', { name: 'Enregistrer' }).click();
    expect(await cartes(page)).toEqual([...TROIS, 'Envoyer un texto | Texto DELTA']);
    await attendreEnregistre(page);
    expect(await corpsDuFil(bureau, r.id)).toEqual(['Texto ALPHA', 'Texto BRAVO', 'Texto CHARLIE', 'Texto DELTA']);
  });

  test('[EDT-034] le dernier « + » (après la dernière carte) ajoute aussi à la fin', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} dernier plus`, troisTextos());
    await ouvrirEditeur(page, r.id);
    await plus(page).nth(3).click();
    await tiroirActions(page).getByRole('button', { name: /^Demander un avis/ }).click();
    await panneauEtape(page).getByRole('button', { name: 'Enregistrer' }).click();
    const vues = await cartes(page);
    expect(vues.slice(0, 3)).toEqual(TROIS);
    expect(vues[3]).toMatch(/^Demander un avis/);
    await attendreEnregistre(page);
    const fil = await filEnBase(bureau, r.id);
    expect(fil.length).toBe(4);
    expect((fil[3].action as { type: string }).type).toBe('request_review');
  });

  test('[EDT-059] au-delà de 30 étapes : l’ajout est refusé AVANT, avec la raison (T-04)', async ({ page, bureau, marque }) => {
    const trente = Array.from({ length: 30 }, (_, i) => texto(`e${i + 1}`, `Texto ${i + 1}`, i < 29 ? `e${i + 2}` : null));
    const r = await creerParcours(bureau, `${marque} trente`, trente);
    await ouvrirEditeur(page, r.id);
    expect((await cartes(page)).length).toBe(30);
    await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
    await tiroirActions(page).getByRole('button', { name: /^Envoyer un texto/ }).click();
    await expect(toasts(page).filter({ hasText: 'Un parcours compte au plus 30 étapes. Retirez-en une avant d’ajouter.' })).toBeVisible();
    expect((await cartes(page)).length).toBe(30);
    await expect(tiroirActions(page)).toHaveCount(0);
    // Dupliquer : même garde (T-05).
    await menuDeCarte(page, 'Texto 30').click();
    await page.getByRole('button', { name: 'Dupliquer l’action', exact: true }).click();
    await expect(toasts(page).filter({ hasText: 'Un parcours compte au plus 30 étapes. Retirez-en une avant de dupliquer.' })).toBeVisible();
    expect((await cartes(page)).length).toBe(30);
    await expect(indicateur(page)).toHaveText('Enregistré');
    expect((await lireRegle(bureau, r.id))?.steps?.length).toBe(30);
  });
});

test.describe('canevas — supprimer une étape', () => {
  for (const cas of [
    { ou: 'en tête', cible: 'Texto ALPHA', reste: [TROIS[1], TROIS[2]], fil: ['Texto BRAVO', 'Texto CHARLIE'] },
    { ou: 'au milieu', cible: 'Texto BRAVO', reste: [TROIS[0], TROIS[2]], fil: ['Texto ALPHA', 'Texto CHARLIE'] },
    { ou: 'en fin', cible: 'Texto CHARLIE', reste: [TROIS[0], TROIS[1]], fil: ['Texto ALPHA', 'Texto BRAVO'] },
  ]) {
    test(`[EDT-042][EDT-047][EDT-159] supprimer l’étape ${cas.ou} : la suite reste reliée, aucune étape orpheline en base`, async ({ page, bureau, marque }) => {
      const r = await creerParcours(bureau, `${marque} suppr ${cas.ou}`, troisTextos());
      await ouvrirEditeur(page, r.id);
      await menuDeCarte(page, cas.cible).click();
      await page.getByRole('button', { name: 'Supprimer l’action', exact: true }).click();
      await expect(dialogue(page).getByRole('heading', { name: 'Supprimer cette étape ?' })).toBeVisible();
      await expect(dialogue(page)).toContainText('Ce qui venait après reste dans le parcours et se rebranche tout seul.');
      await dialogue(page).getByRole('button', { name: 'Supprimer' }).click();
      expect(await cartes(page)).toEqual(cas.reste);
      await attendreEnregistre(page);
      expect(await corpsDuFil(bureau, r.id)).toEqual(cas.fil);
      const base = await lireRegle(bureau, r.id);
      expect(base?.steps?.length, 'aucune étape orpheline').toBe(2);
      await page.reload();
      await expect(carte(page, cas.fil[0])).toBeVisible({ timeout: 90_000 });
      expect(await cartes(page)).toEqual(cas.reste);
    });
  }

  test('[EDT-047][EDT-154] « Annuler » dans la confirmation de suppression : rien n’est retiré', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} suppr annulée`, troisTextos());
    await ouvrirEditeur(page, r.id);
    await menuDeCarte(page, 'Texto BRAVO').click();
    await page.getByRole('button', { name: 'Supprimer l’action', exact: true }).click();
    await dialogue(page).getByRole('button', { name: 'Annuler' }).click();
    expect(await cartes(page)).toEqual(TROIS);
    await expect(indicateur(page)).toHaveText('Enregistré');
    expect((await lireRegle(bureau, r.id))?.updated_at).toBe(r.updated_at);
  });

  test('[EDT-054][EDT-158] « Supprimer à partir d’ici » : le dialogue annonce le bon nombre, l’étape et sa suite partent', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} depuis`, troisTextos());
    await ouvrirEditeur(page, r.id);
    await menuDeCarte(page, 'Texto BRAVO').click();
    await page.getByRole('button', { name: 'Supprimer à partir d’ici', exact: true }).click();
    await expect(dialogue(page).getByRole('heading', { name: 'Supprimer 2 étape(s) ?' })).toBeVisible();
    await expect(dialogue(page)).toContainText('Cette étape et tout ce qui la suit seront retirés du parcours.');
    await dialogue(page).getByRole('button', { name: 'Supprimer' }).click();
    expect(await cartes(page)).toEqual([TROIS[0]]);
    await attendreEnregistre(page);
    expect(await corpsDuFil(bureau, r.id)).toEqual(['Texto ALPHA']);
    expect((await lireRegle(bureau, r.id))?.steps?.length).toBe(1);
  });

  test('[EDT-054] « Supprimer à partir d’ici » sur une condition : les DEUX branches partent, rien d’orphelin', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} depuis condition`, [
      texto('e1', 'Texto ALPHA', 'e3'),
      { id: 'e3', type: 'si', conditions: { statut: 'envoye' }, alors: 'e4', sinon: 'e5' },
      texto('e4', 'Texto OUI', 'e6'),
      texto('e5', 'Texto NON', null),
      { id: 'e6', type: 'arreter' },
    ]);
    await ouvrirEditeur(page, r.id);
    await menuDeCarte(page, 'Si…').click();
    await page.getByRole('button', { name: 'Supprimer à partir d’ici', exact: true }).click();
    await expect(dialogue(page).getByRole('heading', { name: 'Supprimer 4 étape(s) ?' })).toBeVisible();
    await dialogue(page).getByRole('button', { name: 'Supprimer' }).click();
    expect(await cartes(page)).toEqual(['Envoyer un texto | Texto ALPHA']);
    await attendreEnregistre(page);
    const etapes = ((await lireRegle(bureau, r.id))?.steps ?? []) as Array<Record<string, unknown>>;
    expect(etapes.map((e) => e.id)).toEqual(['e1']);
    expect(etapes[0].suivant ?? null).toBeNull();
  });
});

test.describe('canevas — dupliquer, modifier, menu « ··· »', () => {
  test('[EDT-045] « Dupliquer l’action » : la copie est juste après l’originale, son panneau s’ouvre, la base suit', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} dupliquer`, [
      texto('e1', 'Texto ALPHA', 'e2'), texto('e2', 'Texto BRAVO', 'e3', 'Relance 1'), texto('e3', 'Texto CHARLIE', null),
    ]);
    await ouvrirEditeur(page, r.id);
    await menuDeCarte(page, 'Texto BRAVO').click();
    await page.getByRole('button', { name: 'Dupliquer l’action', exact: true }).click();
    expect(await cartes(page)).toEqual([
      'Envoyer un texto | Texto ALPHA', 'Relance 1 | Texto BRAVO', 'Relance 1 (copie) | Texto BRAVO', 'Envoyer un texto | Texto CHARLIE',
    ]);
    await expect(panneauEtape(page).getByLabel(/Nom de l’action/)).toHaveValue('Relance 1 (copie)');
    await expect(panneauEtape(page).getByLabel(/Texte du message/)).toHaveValue('Texto BRAVO');
    await attendreEnregistre(page);
    const fil = await filEnBase(bureau, r.id);
    expect(fil.map((e) => e.nom ?? null)).toEqual([null, 'Relance 1', 'Relance 1 (copie)', null]);
    expect(await corpsDuFil(bureau, r.id)).toEqual(['Texto ALPHA', 'Texto BRAVO', 'Texto BRAVO', 'Texto CHARLIE']);
    // La copie est indépendante : la modifier ne touche pas l'originale.
    await panneauEtape(page).getByLabel(/Texte du message/).fill('Texto BRAVO copie modifiée');
    await panneauEtape(page).getByRole('button', { name: 'Enregistrer' }).click();
    await attendreEnregistre(page);
    expect(await corpsDuFil(bureau, r.id)).toEqual(['Texto ALPHA', 'Texto BRAVO', 'Texto BRAVO copie modifiée', 'Texto CHARLIE']);
  });

  test('[EDT-046] « Modifier l’action » ouvre le panneau de CETTE étape', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} modifier`, troisTextos());
    await ouvrirEditeur(page, r.id);
    await menuDeCarte(page, 'Texto CHARLIE').click();
    await page.getByRole('button', { name: 'Modifier l’action', exact: true }).click();
    await expect(panneauEtape(page).getByLabel(/Texte du message/)).toHaveValue('Texto CHARLIE');
    await expect(carte(page, 'Texto CHARLIE')).toHaveAttribute('aria-current', 'step');
    // Le menu s'est refermé.
    await expect(page.getByRole('button', { name: 'Supprimer à partir d’ici', exact: true })).toHaveCount(0);
  });

  test('[EDT-042][EDT-044] le menu « ··· » : 4 choix pour une action, 3 pour une attente (pas de « Dupliquer »), fermé par un clic à côté', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} menu`, parcoursAvecBranches());
    await ouvrirEditeur(page, r.id);
    await menuDeCarte(page, 'Texto ALPHA').click();
    for (const libelle of ['Dupliquer l’action', 'Modifier l’action', 'Supprimer l’action', 'Supprimer à partir d’ici']) {
      await expect(page.getByRole('button', { name: libelle, exact: true })).toBeVisible();
    }
    await page.getByRole('button', { name: 'Fermer le menu' }).click({ position: { x: 30, y: 300 } });
    await expect(page.getByRole('button', { name: 'Supprimer à partir d’ici', exact: true })).toHaveCount(0);

    await menuDeCarte(page, 'Attendre').click();
    await expect(page.getByRole('button', { name: 'Modifier l’étape', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Supprimer l’étape', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Supprimer à partir d’ici', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Dupliquer/ })).toHaveCount(0);
    await page.getByRole('button', { name: 'Fermer le menu' }).click({ position: { x: 30, y: 300 } });
    // Rien n'a été modifié en ouvrant et fermant des menus.
    await expect(indicateur(page)).toHaveText('Enregistré');
    expect((await lireRegle(bureau, r.id))?.updated_at).toBe(r.updated_at);
  });

  test('[EDT-042] le menu « ··· » s’ouvre À CÔTÉ de la carte cliquée (S-39) @defaut', async ({ page, bureau, marque }) => {
    const six = Array.from({ length: 6 }, (_, i) => texto(`e${i + 1}`, `Texto ${i + 1}`, i < 5 ? `e${i + 2}` : null));
    const r = await creerParcours(bureau, `${marque} menu position`, six);
    await ouvrirEditeur(page, r.id);
    await carte(page, 'Texto 5').scrollIntoViewIfNeeded();
    const bouton = menuDeCarte(page, 'Texto 5');
    await bouton.click();
    const item = page.getByRole('button', { name: 'Supprimer à partir d’ici', exact: true });
    await expect(item).toBeVisible();
    await page.screenshot({ path: `${CAPTURES}/edt-042-menu-loin-de-la-carte.png` });
    const b = await bouton.boundingBox();
    const m = await page.getByRole('button', { name: 'Dupliquer l’action', exact: true }).boundingBox();
    expect(b && m).toBeTruthy();
    const ecartVertical = Math.abs((m!.y) - (b!.y + b!.height));
    await page.getByRole('button', { name: 'Fermer le menu' }).click({ position: { x: 30, y: 300 } });
    expect(ecartVertical, `le menu s’ouvre à ${Math.round(ecartVertical)} px de la carte : rien ne dit à quelle étape il se rapporte`).toBeLessThan(120);
  });

  test('[EDT-042] le menu « ··· » n’offre aucun moyen de DÉPLACER une étape (réordonner = supprimer et recréer)', async ({ page, bureau, marque }) => {
    // Constat documenté, pas une régression : ce test fixe l'état actuel (4 choix, cartes non glissables).
    const r = await creerParcours(bureau, `${marque} réordonner`, troisTextos());
    await ouvrirEditeur(page, r.id);
    await expect(carte(page, 'Texto BRAVO')).not.toHaveAttribute('draggable', 'true');
    await menuDeCarte(page, 'Texto BRAVO').click();
    /* Le MENU, et lui seul : « Déplacer le canevas » (l'outil main, en bas à gauche) porte aussi le mot
       « Déplacer » et n'a rien à voir avec l'ordre des étapes. Les choix du menu sont exactement ces quatre. */
    const menu = page.getByRole('button', { name: 'Dupliquer l’action', exact: true }).locator('xpath=..');
    await expect(menu.getByRole('button')).toHaveText(['Dupliquer l’action', 'Modifier l’action', 'Supprimer l’action', 'Supprimer à partir d’ici']);
    await expect(menu.getByRole('button', { name: /Déplacer|Monter|Descendre|Move/ })).toHaveCount(0);
    // Hors du menu : le seul « Déplacer » de l'écran est l'outil main du canevas.
    await expect(page.getByRole('button', { name: /Déplacer|Monter|Descendre|Move/ })).toHaveCount(1);
    await expect(page.getByRole('button', { name: /Déplacer|Monter|Descendre|Move/ })).toHaveAttribute('aria-label', 'Déplacer le canevas');
    await page.getByRole('button', { name: 'Fermer le menu' }).click({ position: { x: 30, y: 300 } });
  });
});

test.describe('canevas — conditions, branches, arrêt', () => {
  test('[EDT-038][EDT-039][EDT-040][EDT-037] les cartes disent ce que chaque étape fait (attente, condition, arrêt, branches)', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} branches`, parcoursAvecBranches());
    await ouvrirEditeur(page, r.id);
    expect(await cartes(page)).toEqual([
      'Envoyer un texto | Texto ALPHA', 'Attendre | 2 jour(s)', 'Si… | 1 condition(s)',
      'Envoyer un texto | Texto OUI', 'Arrêter ici', 'Envoyer un texto | Texto NON',
    ]);
    await expect(page.getByText('si oui', { exact: true })).toBeVisible();
    await expect(page.getByText('si non', { exact: true })).toBeVisible();
    await page.screenshot({ path: `${CAPTURES}/edt-039-branches.png`, fullPage: false });
    // Pas de « + » après « Arrêter ici » : 1 (tête) + 1 (après ALPHA) + 1 (après attente) + 2 (branches) + 1 (après OUI) + 1 (après NON).
    await expect(plus(page)).toHaveCount(7);
    // Chaque carte ouvre SON panneau.
    await carte(page, 'Attendre').click();
    await expect(panneauEtape(page).getByRole('heading', { name: 'Attendre' })).toBeVisible();
    await panneauEtape(page).getByRole('button', { name: 'Annuler' }).click();
    await carte(page, 'Arrêter ici').click();
    await expect(panneauEtape(page).getByText('Rien à configurer. Le client sort du parcours en arrivant ici.')).toBeVisible();
    await panneauEtape(page).getByRole('button', { name: 'Annuler' }).click();
    await carte(page, 'Si…').click();
    await expect(panneauEtape(page).getByLabel('Conditions')).toBeVisible();
  });

  test('[EDT-035][EDT-036] les « + » des branches « si oui » et « si non » ajoutent dans LA bonne branche', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} plus branches`, [
      texto('e1', 'Texto ALPHA', 'e2'),
      { id: 'e2', type: 'si', conditions: { statut: 'envoye' }, alors: null, sinon: null },
    ]);
    await ouvrirEditeur(page, r.id);
    // « + » : 0 = tête, 1 = après ALPHA, 2 = si oui, 3 = si non.
    await expect(plus(page)).toHaveCount(4);
    await plus(page).nth(3).click();
    await tiroirActions(page).getByRole('button', { name: /^Envoyer un texto/ }).click();
    await panneauEtape(page).getByLabel(/Texte du message/).fill('Texto dans NON');
    await panneauEtape(page).getByRole('button', { name: 'Enregistrer' }).click();
    await plus(page).nth(2).click();
    await tiroirActions(page).getByRole('button', { name: /^Envoyer un texto/ }).click();
    await panneauEtape(page).getByLabel(/Texte du message/).fill('Texto dans OUI');
    await panneauEtape(page).getByRole('button', { name: 'Enregistrer' }).click();
    expect(await cartes(page)).toEqual([
      'Envoyer un texto | Texto ALPHA', 'Si… | 1 condition(s)', 'Envoyer un texto | Texto dans OUI', 'Envoyer un texto | Texto dans NON',
    ]);
    await attendreEnregistre(page);
    const base = await lireRegle(bureau, r.id);
    const etapes = (base?.steps ?? []) as Array<Record<string, unknown>>;
    const si = etapes.find((e) => e.type === 'si') as Record<string, string>;
    const corps = (id: string) => ((etapes.find((e) => e.id === id)?.action as { config: { body: string } }).config.body);
    expect(corps(si.alors)).toBe('Texto dans OUI');
    expect(corps(si.sinon)).toBe('Texto dans NON');
  });

  test('[EDT-061] insérer une « Condition » au milieu : la suite passe sous « si oui », rien ne disparaît', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} condition milieu`, troisTextos());
    await ouvrirEditeur(page, r.id);
    await plus(page).nth(1).click();
    await tiroirActions(page).getByRole('button', { name: /^Condition/ }).click();
    await panneauEtape(page).getByRole('button', { name: 'Annuler' }).click();
    expect(await cartes(page)).toEqual([TROIS[0], 'Si… | 0 condition(s)', TROIS[1], TROIS[2]]);
    await attendreEnregistre(page);
    const etapes = ((await lireRegle(bureau, r.id))?.steps ?? []) as Array<Record<string, unknown>>;
    const si = etapes.find((e) => e.type === 'si') as Record<string, unknown>;
    expect(si.alors).toBe('e2');
    expect(si.sinon ?? null).toBeNull();
    expect(etapes.length).toBe(4);
  });

  test('[EDT-047] supprimer une condition dont la branche « si non » contient une étape : aucune étape ne reste cachée en base (S-12) @defaut', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} condition supprimée`, parcoursAvecBranches());
    await ouvrirEditeur(page, r.id);
    await menuDeCarte(page, 'Si…').click();
    await page.getByRole('button', { name: 'Supprimer l’étape', exact: true }).click();
    await expect(dialogue(page)).toContainText('Ce qui venait après reste dans le parcours et se rebranche tout seul.');
    await dialogue(page).getByRole('button', { name: 'Supprimer' }).click();
    await page.screenshot({ path: `${CAPTURES}/edt-s12-condition-supprimee.png` });
    const vues = await cartes(page);
    await attendreEnregistre(page);
    const etapes = ((await lireRegle(bureau, r.id))?.steps ?? []) as Array<Record<string, unknown>>;
    const fil = await filEnBase(bureau, r.id);
    // Le dialogue promet que « ce qui venait après reste et se rebranche » : toute étape gardée en base doit être à l'écran.
    expect(vues.some((v) => v.includes('Texto NON')) || !JSON.stringify(etapes).includes('Texto NON'),
      `« Texto NON » (branche si non) n’est plus à l’écran (${vues.join(' / ')}) mais reste dans steps en base`).toBe(true);
    expect(etapes.length, 'des étapes existent en base sans être reliées au parcours').toBe(fil.length);
  });

  test('[EDT-062] insérer « Arrêter ici » au milieu : la suite ne disparaît pas sans prévenir (S-12) @defaut', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} arrêt milieu`, troisTextos());
    await ouvrirEditeur(page, r.id);
    await plus(page).nth(1).click();
    await tiroirActions(page).getByRole('button', { name: /^Arrêter ici/ }).click();
    await page.screenshot({ path: `${CAPTURES}/edt-s12-arret-au-milieu.png` });
    const vues = await cartes(page);
    const prevenu = await dialogue(page).or(toasts(page).filter({ hasText: /suite|après|disparaî|retir/i })).first().isVisible();
    expect(prevenu || vues.some((v) => v.includes('Texto BRAVO')),
      `« Texto BRAVO » et « Texto CHARLIE » ont disparu du canevas (${vues.join(' / ')}) sans question ni message`).toBe(true);
  });

  test('[EDT-037][EDT-038] chaque carte dit ce qu’elle fera, même sans texte de message (S-38) @defaut', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} cartes muettes`, [
      { id: 'e1', type: 'action', action: { type: 'ajouter_etiquette', config: { etiquette: 'client-vip' } }, suivant: 'e2' },
      { id: 'e2', type: 'attendre', delai_secondes: 172800, mode: 'reponse', suivant: 'e3' },
      { id: 'e3', type: 'action', action: { type: 'webhook', config: { url: 'https://exemple.lume-qa.test/crochet' } }, suivant: null },
    ]);
    await ouvrirEditeur(page, r.id);
    await page.screenshot({ path: `${CAPTURES}/edt-s38-cartes-muettes.png` });
    const vues = await cartes(page);
    expect(vues.length).toBe(3);
    expect.soft(vues[0], 'la carte « Ajouter une étiquette » ne dit pas LAQUELLE').toContain('client-vip');
    expect.soft(vues[1], 'une attente « de la réponse du client » s’affiche comme une attente simple').toMatch(/réponse/i);
    expect(vues[2], 'la carte « Appeler un webhook » ne montre pas l’adresse appelée').toContain('exemple.lume-qa.test');
  });

  test('[EDT-037] une boucle dans le parcours (données abîmées) : le canevas l’affiche sans planter', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} boucle`, [texto('e1', 'Texto ALPHA', 'e2'), texto('e2', 'Texto BRAVO', 'e1')]);
    await ouvrirEditeur(page, r.id);
    await expect(page.getByText('Le parcours revient ici : à corriger avant d’enregistrer.')).toBeVisible();
    expect(await cartes(page)).toEqual(['Envoyer un texto | Texto ALPHA', 'Envoyer un texto | Texto BRAVO']);
  });
});
