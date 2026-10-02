/**
 * Éditeur — dialogues de confirmation, gardes de sortie, et cohabitation des panneaux de droite.
 *
 * Ce que ce fichier prouve :
 *  · quitter avec du travail non enregistré : « Mes automatisations », bouton « Précédent » du
 *    navigateur, rechargement / fermeture d'onglet — on enregistre, ou on prévient, jamais de perte muette ;
 *  · fermer un panneau avec une saisie en cours : confirmation (pistes S-05 et S-06) ;
 *  · un seul panneau à droite à la fois (piste S-07) ;
 *  · le dialogue de confirmation : focus, Échap, clic à côté, boutons.
 */
import { lireRegle, ouvrirListe } from '../_outils/banc';
import {
  test, expect, DELAI_TEST,
  CAPTURES, creerParcours, troisTextos, ouvrirEditeur, cartes, carte, barre, indicateur, attendreEnregistre,
  corpsDuFil, dialogue, panneauEtape, panneauDeclencheur, tiroirActions, tiroirDeclencheurs, toasts,
} from './_aides';

test.describe.configure({ timeout: DELAI_TEST });

const texte = (page: import('@playwright/test').Page) => panneauEtape(page).getByLabel(/Texte du message/);

/** Ajoute une étape incomplète (« Ajouter une étiquette » sans étiquette) et referme son panneau. */
async function rendreIncomplet(page: import('@playwright/test').Page): Promise<void> {
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await tiroirActions(page).getByRole('button', { name: /^Ajouter une étiquette/ }).click();
  await panneauEtape(page).getByRole('button', { name: 'Fermer le panneau' }).click();
  await expect(indicateur(page)).toHaveText('1 étape(s) à compléter');
}

test.describe('gardes de sortie', () => {
  test('[EDT-163][EDT-154][EDT-155] « Mes automatisations » avec une étape incomplète : « Quitter sans enregistrer ? » — Annuler reste, Quitter part', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} quitter incomplet`, troisTextos());
    await ouvrirEditeur(page, r.id);
    await rendreIncomplet(page);
    await barre(page).getByRole('button', { name: 'Mes automatisations' }).click();
    await expect(dialogue(page).getByRole('heading', { name: 'Quitter sans enregistrer ?' })).toBeVisible();
    await expect(dialogue(page)).toContainText('Une étape est incomplète, donc le parcours n’a pas pu être enregistré. Si vous quittez maintenant, ces modifications seront perdues.');
    await page.screenshot({ path: `${CAPTURES}/edt-163-quitter-sans-enregistrer.png` });
    await dialogue(page).getByRole('button', { name: 'Annuler' }).click();
    await expect(page).toHaveURL(new RegExp(`/automations/${r.id}$`));
    expect((await cartes(page)).length).toBe(4);

    await barre(page).getByRole('button', { name: 'Mes automatisations' }).click();
    await dialogue(page).getByRole('button', { name: 'Quitter' }).click();
    await expect(page).toHaveURL(/\/automations$/);
    // Ce qui était annoncé comme perdu l'est : la base a toujours les 3 étapes d'origine.
    expect(await corpsDuFil(bureau, r.id)).toEqual(['Texto ALPHA', 'Texto BRAVO', 'Texto CHARLIE']);
    expect((await lireRegle(bureau, r.id))?.steps?.length).toBe(3);
  });

  test('[EDT-163] « Mes automatisations » quand le serveur refuse l’enregistrement : on prévient avant de partir', async ({ page, bureau, marque, moniteur }) => {
    const r = await creerParcours(bureau, `${marque} quitter refus`, troisTextos());
    await ouvrirEditeur(page, r.id);
    moniteur.attendu(/500 PATCH .*\/api\/automations\/rules\//, 'panne simulée de l’enregistrement à la sortie');
    moniteur.attendu(/enregistrement à la sortie impossible/, 'la panne simulée est journalisée');
    await page.route(`**/api/automations/rules/${r.id}`, (route) => (route.request().method() === 'PATCH'
      ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Impossible de modifier l\'automatisation.' }) })
      : route.continue()));
    await carte(page, 'Texto BRAVO').click();
    await texte(page).fill('Texto BRAVO jamais enregistré');
    await panneauEtape(page).getByRole('button', { name: 'Enregistrer' }).click();
    await barre(page).getByRole('button', { name: 'Mes automatisations' }).click();
    await expect(dialogue(page).getByRole('heading', { name: 'Quitter sans enregistrer ?' })).toBeVisible({ timeout: 30_000 });
    await expect(dialogue(page)).toContainText('Vos dernières modifications ne sont pas encore enregistrées. Si vous quittez maintenant, elles seront perdues.');
    await dialogue(page).getByRole('button', { name: 'Annuler' }).click();
    await expect(page).toHaveURL(new RegExp(`/automations/${r.id}$`));
    await expect(carte(page, 'Texto BRAVO jamais enregistré')).toBeVisible();
  });

  test('[EDT-165] recharger / fermer l’onglet avec une modification en attente : le navigateur demande confirmation', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} beforeunload`, troisTextos());
    await ouvrirEditeur(page, r.id);
    // Sans modification : aucune question.
    const vus: string[] = [];
    page.on('dialog', async (d) => { vus.push(d.type()); await d.accept(); });
    await page.reload();
    await expect(page.getByRole('tablist', { name: 'Sections' })).toBeVisible({ timeout: 90_000 });
    expect(vus).toEqual([]);
    // Avec une étape incomplète (rien n'a pu être enregistré) : question.
    await rendreIncomplet(page);
    await page.reload();
    await expect(page.getByRole('tablist', { name: 'Sections' })).toBeVisible({ timeout: 90_000 });
    expect(vus).toEqual(['beforeunload']);
    expect((await lireRegle(bureau, r.id))?.steps?.length).toBe(3);
  });

  test('[EDT-166] bouton « Précédent » du navigateur juste après une modification : elle est enregistrée en partant', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} précédent`, troisTextos());
    await ouvrirListe(page);
    await page.getByText(`${marque} précédent`).first().click();
    await expect(page.getByRole('tablist', { name: 'Sections' })).toBeVisible({ timeout: 90_000 });
    await carte(page, 'Texto BRAVO').click();
    await texte(page).fill('Texto BRAVO avant de reculer');
    await panneauEtape(page).getByRole('button', { name: 'Enregistrer' }).click();
    await expect(indicateur(page)).toHaveText('Modifié');
    await page.goBack();
    await expect(page).toHaveURL(/\/automations$/);
    await expect.poll(() => corpsDuFil(bureau, r.id), { timeout: 60_000 }).toEqual(['Texto ALPHA', 'Texto BRAVO avant de reculer', 'Texto CHARLIE']);
  });

  test('[EDT-166] bouton « Précédent » avec une étape incomplète : le travail perdu est DIT (toast), la base est intacte', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} précédent incomplet`, troisTextos());
    await ouvrirListe(page);
    await page.getByText(`${marque} précédent incomplet`).first().click();
    await expect(page.getByRole('tablist', { name: 'Sections' })).toBeVisible({ timeout: 90_000 });
    await rendreIncomplet(page);
    await page.goBack();
    await expect(page).toHaveURL(/\/automations$/);
    await expect(toasts(page).filter({ hasText: 'Automatisation quittée sans enregistrer : une étape était incomplète.' })).toBeVisible();
    expect((await lireRegle(bureau, r.id))?.steps?.length).toBe(3);
  });

  test('[EDT-166] bouton « Précédent » avec une étape incomplète : on demande AVANT de perdre le travail @defaut', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} précédent question`, troisTextos());
    await ouvrirListe(page);
    await page.getByText(`${marque} précédent question`).first().click();
    await expect(page.getByRole('tablist', { name: 'Sections' })).toBeVisible({ timeout: 90_000 });
    // Du vrai travail : un texto réécrit, puis une étape laissée incomplète.
    await carte(page, 'Texto BRAVO').click();
    await texte(page).fill('Texto BRAVO réécrit longuement');
    await panneauEtape(page).getByRole('button', { name: 'Enregistrer' }).click();
    await rendreIncomplet(page);
    await page.goBack();
    await page.screenshot({ path: `${CAPTURES}/edt-166-precedent-incomplet.png` });
    const question = dialogue(page).getByRole('heading', { name: 'Quitter sans enregistrer ?' });
    const sauve = (await corpsDuFil(bureau, r.id)).includes('Texto BRAVO réécrit longuement');
    expect((await question.isVisible()) || sauve,
      'le bouton « Précédent » a quitté l’éditeur : le texto réécrit ET l’étape ajoutée sont perdus, un toast le dit après coup').toBe(true);
  });
});

test.describe('panneau d’étape — saisie en cours', () => {
  test('[EDT-164][EDT-154][EDT-155] fermer le panneau (croix, « Annuler ») avec une saisie en cours : « Fermer sans enregistrer ? »', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} fermer panneau`, troisTextos());
    await ouvrirEditeur(page, r.id);
    await carte(page, 'Texto BRAVO').click();
    // Sans modification : fermeture directe.
    await panneauEtape(page).getByRole('button', { name: 'Fermer le panneau' }).click();
    await expect(panneauEtape(page)).toHaveCount(0);
    await expect(dialogue(page)).toHaveCount(0);

    await carte(page, 'Texto BRAVO').click();
    await texte(page).fill('Texto BRAVO en cours de saisie');
    await panneauEtape(page).getByRole('button', { name: 'Fermer le panneau' }).click();
    await expect(dialogue(page).getByRole('heading', { name: 'Fermer sans enregistrer ?' })).toBeVisible();
    await expect(dialogue(page)).toContainText('Les modifications de cette étape ne sont pas enregistrées : elles seront perdues.');
    await dialogue(page).getByRole('button', { name: 'Annuler' }).click();
    await expect(texte(page)).toHaveValue('Texto BRAVO en cours de saisie');

    await panneauEtape(page).getByRole('button', { name: 'Annuler' }).click();
    await expect(dialogue(page).getByRole('heading', { name: 'Fermer sans enregistrer ?' })).toBeVisible();
    await dialogue(page).getByRole('button', { name: 'Fermer sans enregistrer' }).click();
    await expect(panneauEtape(page)).toHaveCount(0);
    expect(await cartes(page)).toEqual(['Envoyer un texto | Texto ALPHA', 'Envoyer un texto | Texto BRAVO', 'Envoyer un texto | Texto CHARLIE']);
    await expect(indicateur(page)).toHaveText('Enregistré');
    expect((await lireRegle(bureau, r.id))?.updated_at).toBe(r.updated_at);
  });

  test('[EDT-160][EDT-037] cliquer une AUTRE carte avec une saisie en cours : « Changer d’étape sans enregistrer ? »', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} changer étape`, troisTextos());
    await ouvrirEditeur(page, r.id);
    await carte(page, 'Texto BRAVO').click();
    await texte(page).fill('Texto BRAVO en cours de saisie');
    await carte(page, 'Texto CHARLIE').click();
    await expect(dialogue(page).getByRole('heading', { name: 'Changer d’étape sans enregistrer ?' })).toBeVisible();
    await expect(dialogue(page)).toContainText('Les modifications de l’étape ouverte ne sont pas enregistrées : elles seront perdues.');
    await dialogue(page).getByRole('button', { name: 'Annuler' }).click();
    await expect(texte(page)).toHaveValue('Texto BRAVO en cours de saisie');
    await carte(page, 'Texto CHARLIE').click();
    await dialogue(page).getByRole('button', { name: 'Changer d’étape' }).click();
    await expect(texte(page)).toHaveValue('Texto CHARLIE');
    // Sans saisie en cours : on passe d'une carte à l'autre sans question.
    await carte(page, 'Texto ALPHA').click();
    await expect(dialogue(page)).toHaveCount(0);
    await expect(texte(page)).toHaveValue('Texto ALPHA');
    expect((await lireRegle(bureau, r.id))?.updated_at).toBe(r.updated_at);
  });

  // `defaut` : le cas reste un défaut ouvert. Le « + » est corrigé depuis #870 (un seul panneau à droite :
  // `quandPanneauLibre` pose la question avant d'ouvrir le tiroir) ; l'onglet et « Dupliquer » ne le sont pas.
  for (const cas of [
    { nom: 'cliquer un « + » puis refermer le tiroir', defaut: false, geste: async (page: import('@playwright/test').Page) => {
      await page.getByRole('button', { name: 'Ajouter une étape ici' }).nth(0).click();
      if (await tiroirActions(page).isVisible()) await tiroirActions(page).getByRole('button', { name: 'Fermer' }).click();
    } },
    { nom: 'aller sur l’onglet « Réglages » et revenir', defaut: true, geste: async (page: import('@playwright/test').Page) => {
      await page.getByRole('tab', { name: 'Réglages' }).click();
      if (!(await dialogue(page).isVisible())) await page.getByRole('tab', { name: 'Parcours' }).click();
    } },
    { nom: 'dupliquer une autre carte', defaut: true, geste: async (page: import('@playwright/test').Page) => {
      await page.getByRole('button', { name: /^Options de l’étape/ }).nth(0).click();
      await page.getByRole('button', { name: 'Dupliquer l’action', exact: true }).click();
    } },
  ]) {
    test(`[EDT-164] saisie en cours dans un panneau d’étape, puis ${cas.nom} : la saisie n’est pas jetée sans question (S-05)${cas.defaut ? ' @defaut' : ''}`, async ({ page, bureau, marque }) => {
      const r = await creerParcours(bureau, `${marque} s05`, troisTextos());
      await ouvrirEditeur(page, r.id);
      await carte(page, 'Texto BRAVO').click();
      await texte(page).fill('Long message rédigé avec soin, pas encore enregistré');
      await cas.geste(page);
      await page.screenshot({ path: `${CAPTURES}/edt-s05-${cas.nom.replace(/[^a-z]+/gi, '-').slice(0, 30)}.png` });
      const question = await dialogue(page).isVisible();
      const gardee = (await panneauEtape(page).isVisible()) && (await texte(page).count()) > 0
        && (await texte(page).inputValue()) === 'Long message rédigé avec soin, pas encore enregistré';
      expect(question || gardee, 'le texte tapé a disparu sans aucune question').toBe(true);
    });
  }
});

test.describe('panneau du déclencheur et cohabitation des panneaux', () => {
  test('[EDT-032] la carte « Quand » ouvre le panneau du déclencheur ; sa croix et « Annuler » le ferment sans rien écrire', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} quand`, troisTextos());
    await ouvrirEditeur(page, r.id);
    await page.getByRole('button', { name: /^Quand\s*Devis envoyé/ }).click();
    await expect(panneauDeclencheur(page)).toBeVisible();
    await expect(panneauDeclencheur(page)).toContainText('Devis envoyé');
    await panneauDeclencheur(page).getByRole('button', { name: 'Fermer' }).click();
    await expect(panneauDeclencheur(page)).toHaveCount(0);
    await page.getByRole('button', { name: /^Quand\s*Devis envoyé/ }).click();
    await panneauDeclencheur(page).getByRole('button', { name: 'Annuler' }).click();
    await expect(panneauDeclencheur(page)).toHaveCount(0);
    expect((await lireRegle(bureau, r.id))?.updated_at).toBe(r.updated_at);
  });

  test('[EDT-032] un déclencheur sans réglage (« Appel reçu de l’extérieur ») : la carte « Quand » ouvre directement le tiroir des déclencheurs', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} quand sans réglage`, troisTextos(), { trigger_event: 'webhook.received' });
    await ouvrirEditeur(page, r.id);
    await page.getByRole('button', { name: /^Quand\s*Appel reçu de l’extérieur/ }).click();
    await expect(tiroirDeclencheurs(page)).toBeVisible();
    await expect(panneauDeclencheur(page)).toHaveCount(0);
  });

  test('[EDT-032] fermer le panneau du déclencheur avec une saisie en cours : on demande avant de la jeter (S-06) @defaut', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} s06`, troisTextos());
    await ouvrirEditeur(page, r.id);
    await page.getByRole('button', { name: /^Quand\s*Devis envoyé/ }).click();
    await panneauDeclencheur(page).getByLabel(/Seulement si le client a l’étiquette/).fill('clients-vip');
    await panneauDeclencheur(page).getByRole('button', { name: 'Fermer' }).click();
    await page.screenshot({ path: `${CAPTURES}/edt-s06-panneau-declencheur.png` });
    const question = await dialogue(page).isVisible();
    const encoreLa = await panneauDeclencheur(page).isVisible();
    expect(question || encoreLa, 'le filtre saisi est jeté sans question (le panneau d’étape, lui, demande)').toBe(true);
  });

  test('[EDT-032][EDT-037] un seul panneau à droite : ouvrir « Quand » pendant qu’une étape est ouverte ne les empile pas (S-07)', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} s07 deux panneaux`, troisTextos());
    await ouvrirEditeur(page, r.id);
    await carte(page, 'Texto BRAVO').click();
    await expect(panneauEtape(page)).toBeVisible();
    await page.getByRole('button', { name: /^Quand\s*Devis envoyé/ }).click();
    await expect(panneauDeclencheur(page)).toBeVisible();
    await page.screenshot({ path: `${CAPTURES}/edt-s07-deux-panneaux.png` });
    await expect(panneauEtape(page), 'deux panneaux de 380 px côte à côte : le canevas n’a plus que la moitié de l’écran').toHaveCount(0, { timeout: 3000 });
  });

  test('[EDT-034] « + » cliqué pendant que le panneau du déclencheur est ouvert : le tiroir des actions s’affiche (S-07)', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} s07 plus muet`, troisTextos());
    await ouvrirEditeur(page, r.id);
    await page.getByRole('button', { name: /^Quand\s*Devis envoyé/ }).click();
    await expect(panneauDeclencheur(page)).toBeVisible();
    await page.getByRole('button', { name: 'Ajouter une étape ici' }).nth(1).click();
    await page.screenshot({ path: `${CAPTURES}/edt-s07-plus-sans-effet.png` });
    await expect(tiroirActions(page), 'le « + » ne montre rien tant que le panneau du déclencheur est ouvert').toBeVisible({ timeout: 3000 });
  });
});

test.describe('dialogue de confirmation', () => {
  test('[EDT-154][EDT-155][EDT-156][EDT-157] focus sur « Annuler », Échap et clic à côté répondent non, le bouton rouge répond oui', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} dialogue`, troisTextos());
    await ouvrirEditeur(page, r.id);
    const ouvrir = async () => {
      await page.getByRole('button', { name: /^Options de l’étape/ }).nth(1).click();
      await page.getByRole('button', { name: 'Supprimer l’action', exact: true }).click();
      await expect(dialogue(page)).toBeVisible();
    };
    await ouvrir();
    await expect(dialogue(page)).toHaveAttribute('aria-modal', 'true');
    await expect(dialogue(page).getByRole('button', { name: 'Annuler' })).toBeFocused();
    // Entrée sur « Annuler » (focus initial) ne supprime rien.
    await page.keyboard.press('Enter');
    await expect(dialogue(page)).toHaveCount(0);
    expect((await cartes(page)).length).toBe(3);

    await ouvrir();
    await page.keyboard.press('Escape');
    await expect(dialogue(page)).toHaveCount(0);
    expect((await cartes(page)).length).toBe(3);

    await ouvrir();
    await page.mouse.click(15, 500);
    await expect(dialogue(page)).toHaveCount(0);
    expect((await cartes(page)).length).toBe(3);
    expect((await lireRegle(bureau, r.id))?.updated_at).toBe(r.updated_at);

    await ouvrir();
    await page.keyboard.press('Tab');
    await expect(dialogue(page).getByRole('button', { name: 'Supprimer' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(dialogue(page)).toHaveCount(0);
    expect(await cartes(page)).toEqual(['Envoyer un texto | Texto ALPHA', 'Envoyer un texto | Texto CHARLIE']);
    await attendreEnregistre(page);
    expect(await corpsDuFil(bureau, r.id)).toEqual(['Texto ALPHA', 'Texto CHARLIE']);
  });

  test('[EDT-154] le dialogue garde le focus : Tab ne sort pas vers l’éditeur derrière @defaut', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} dialogue piège`, troisTextos());
    await ouvrirEditeur(page, r.id);
    await page.getByRole('button', { name: /^Options de l’étape/ }).nth(1).click();
    await page.getByRole('button', { name: 'Supprimer l’action', exact: true }).click();
    await expect(dialogue(page).getByRole('button', { name: 'Annuler' })).toBeFocused();
    const dehors: string[] = [];
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('Tab');
      const dans = await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));
      if (!dans) dehors.push(await page.evaluate(() => (document.activeElement?.getAttribute('aria-label') || document.activeElement?.textContent || document.activeElement?.tagName || '').trim().slice(0, 40)));
    }
    await page.keyboard.press('Escape');
    expect(dehors, 'la touche Tab quitte le dialogue et atteint les boutons de l’éditeur masqué derrière').toEqual([]);
  });
});
