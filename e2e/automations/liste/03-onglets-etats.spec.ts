/**
 * LISTE — les quatre onglets et les états de l'écran.
 *
 * Ce que ce fichier prouve :
 *  · « Toutes », « À vérifier », « Prêtes à publier », « Corbeille » montrent
 *    chacun ce qu'ils annoncent, et leurs compteurs sont ceux de la base ;
 *    (« Prêtes à publier » s'appelait « Modèles » jusqu'au commit 56f5f820 : ce
 *    mot désigne maintenant la seule bibliothèque du menu « Créer ») ;
 *  · `?onglet=` ouvre le bon onglet à l'arrivée ;
 *  · chargement, erreur de chargement (« Réessayer »), liste vide, corbeille
 *    vide, « À vérifier » avec et sans échec, vide après recherche ;
 *  · ce que l'écran dit quand une lecture secondaire échoue (échecs récents).
 */
import {
  test, expect, creerRegle, ouvrirListe, chercher, ligne, toast, onglet, nomsAffiches, interrupteur, creerEchec, compterRegles,
  reglesAffichables,
} from './_aides';

test.describe('les quatre onglets', () => {
  test('[LST-020][LST-021][LST-022][LST-023] chaque onglet montre ce qu’il annonce ; les compteurs sont ceux de la base', async ({ page, bureau, marque }) => {
    const vivante = `${marque} vivante`;
    const enEchec = `${marque} en echec`;
    const supprimee = `${marque} supprimee`;
    const modele = `${marque} modele depublie`;
    await creerRegle(bureau, bureau.orgA, { name: vivante });
    const rEchec = await creerRegle(bureau, bureau.orgA, { name: enEchec, is_active: true });
    const rSupprimee = await creerRegle(bureau, bureau.orgA, { name: supprimee, deleted_at: new Date().toISOString() });
    await creerRegle(bureau, bureau.orgA, { name: modele, is_preset: true, preset_key: `e2e_${Date.now()}`, is_active: false });
    await creerEchec(bureau, bureau.orgA, rEchec.id, 'No recipient phone');
    await creerEchec(bureau, bureau.orgA, rEchec.id, 'No recipient phone');
    // Un échec sur une règle à la corbeille ne la fait PAS remonter dans « À vérifier ».
    await creerEchec(bureau, bureau.orgA, rSupprimee.id, 'No recipient phone');

    await ouvrirListe(page);
    await expect(onglet(page, 'Toutes')).toHaveAttribute('aria-selected', 'true');
    // « Toutes » n'a pas de compteur ; les trois autres en ont un.
    await expect(onglet(page, 'Toutes')).toHaveText('Toutes');
    await expect(onglet(page, 'À vérifier')).toHaveText('À vérifier (1)');
    await expect(onglet(page, 'Prêtes à publier')).toHaveText('Prêtes à publier (1)');
    await expect(onglet(page, 'Corbeille')).toHaveText('Corbeille (1)');
    // Quatre onglets, dans cet ordre, et plus aucun ne s'appelle « Modèles ».
    await expect(page.getByRole('tab')).toHaveText(['Toutes', 'À vérifier (1)', 'Prêtes à publier (1)', 'Corbeille (1)']);

    await chercher(page, marque);
    await expect.poll(() => nomsAffiches(page)).toEqual([enEchec, vivante]);

    await onglet(page, 'À vérifier').click();
    await expect(onglet(page, 'À vérifier')).toHaveAttribute('aria-selected', 'true');
    await expect(onglet(page, 'Toutes')).toHaveAttribute('aria-selected', 'false');
    await expect.poll(() => nomsAffiches(page)).toEqual([enEchec]);
    await expect(ligne(page, enEchec)).toContainText('2 échec(s) dans les 7 derniers jours — Ce client n’a pas de numéro de téléphone.');
    // Jamais le message technique brut.
    await expect(ligne(page, enEchec)).not.toContainText('No recipient phone');

    await onglet(page, 'Prêtes à publier').click();
    await expect(onglet(page, 'Prêtes à publier')).toHaveAttribute('aria-selected', 'true');
    await expect.poll(() => nomsAffiches(page)).toEqual([modele]);
    await expect(ligne(page, modele).getByText('Brouillon', { exact: true })).toBeVisible();

    await onglet(page, 'Corbeille').click();
    await expect.poll(() => nomsAffiches(page)).toEqual([supprimee]);
    await expect(ligne(page, supprimee).getByText('Supprimée', { exact: true })).toBeVisible();
    await expect(interrupteur(page, supprimee)).toBeDisabled();

    await onglet(page, 'Toutes').click();
    await expect.poll(() => nomsAffiches(page)).toEqual([enEchec, vivante]);

    // Les compteurs, recoupés en base.
    const { count: nbCorbeille } = await bureau.admin.from('automation_rules').select('id', { count: 'exact', head: true })
      .eq('org_id', bureau.orgA).not('deleted_at', 'is', null).is('purged_at', null);
    const { count: nbModeles } = await bureau.admin.from('automation_rules').select('id', { count: 'exact', head: true })
      .eq('org_id', bureau.orgA).is('deleted_at', null).eq('is_preset', true).eq('is_active', false);
    expect(nbCorbeille).toBe(1);
    expect(nbModeles).toBe(1);
  });

  for (const [parametre, libelle] of [['verifier', 'À vérifier'], ['corbeille', 'Corbeille'], ['modeles', 'Prêtes à publier'], ['nimporte', 'Toutes']] as const) {
    test(`[LST-024] /automations?onglet=${parametre} ouvre l’onglet « ${libelle} »`, async ({ page }) => {
      await page.goto(`/automations?onglet=${parametre}`);
      await expect(page.getByRole('heading', { name: 'Mes automatisations' })).toBeVisible({ timeout: 90_000 });
      await expect(onglet(page, libelle)).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByRole('tab', { selected: true })).toHaveCount(1);
    });
  }

  test('[LST-023][LST-024] S-04 : l’onglet ouvert survit à un rechargement de la page @defaut', async ({ page }) => {
    await ouvrirListe(page);
    await onglet(page, 'Corbeille').click();
    await expect(onglet(page, 'Corbeille')).toHaveAttribute('aria-selected', 'true');
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Mes automatisations' })).toBeVisible({ timeout: 90_000 });
    // L'onglet n'est jamais écrit dans l'URL : F5 ramène sur « Toutes ».
    await expect(onglet(page, 'Corbeille')).toHaveAttribute('aria-selected', 'true');
  });

  test('[LST-020][LST-024] S-04 : arrivé par ?onglet=verifier, changer d’onglet met l’URL à jour @defaut', async ({ page }) => {
    await page.goto('/automations?onglet=verifier');
    await expect(onglet(page, 'À vérifier')).toHaveAttribute('aria-selected', 'true', { timeout: 90_000 });
    await onglet(page, 'Toutes').click();
    await expect(onglet(page, 'Toutes')).toHaveAttribute('aria-selected', 'true');
    // L'URL dit encore « verifier » : un rechargement ou un lien copié rouvre le mauvais onglet.
    await expect(page).not.toHaveURL(/onglet=verifier/);
  });

  test('[LST-020] S-51 : les onglets sont reliés à leur panneau (aria-controls / tabpanel)', async ({ page }) => {
    await ouvrirListe(page);
    await expect(page.getByRole('tabpanel')).toHaveCount(1);
    await expect(onglet(page, 'Toutes')).toHaveAttribute('aria-controls', /.+/);
  });
});

test.describe('chargement et erreur de chargement', () => {
  test('[LST-020] chargement : l’en-tête et les onglets sont là, le tableau est remplacé par une roue, puis la liste arrive', async ({ page }) => {
    let liberer: () => void = () => undefined;
    const barriere = new Promise<void>((r) => { liberer = r; });
    await page.route('**/rest/v1/automation_rules?*', async (route) => { await barriere; await route.continue(); });
    await page.goto('/automations');
    await expect(page.getByRole('heading', { name: 'Mes automatisations' })).toBeVisible({ timeout: 90_000 });
    await expect(onglet(page, 'Toutes')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Créer', exact: true })).toBeVisible();
    await expect(page.getByRole('table')).toHaveCount(0);
    // Pendant le chargement, l'écran ne doit PAS affirmer qu'il n'y a rien.
    await expect(page.getByText('Aucune automatisation')).toHaveCount(0);
    await expect(page.locator('.section-card .animate-spin')).toBeVisible();
    liberer();
    await expect(page.getByRole('table')).toBeVisible();
    await expect(page.locator('.section-card .animate-spin')).toHaveCount(0);
  });

  test('[LST-020] chargement : la roue est annoncée aux lecteurs d’écran (role="status" ou texte) @defaut', async ({ page }) => {
    let liberer: () => void = () => undefined;
    const barriere = new Promise<void>((r) => { liberer = r; });
    await page.route('**/rest/v1/automation_rules?*', async (route) => { await barriere; await route.continue(); });
    await page.goto('/automations');
    await expect(page.getByRole('heading', { name: 'Mes automatisations' })).toBeVisible({ timeout: 90_000 });
    try {
      await expect(page.getByRole('main').getByRole('status').filter({ hasText: /Chargement/ })).toBeVisible({ timeout: 5_000 });
    } finally {
      liberer();
    }
  });

  test('[LST-020] la liste s’affiche dès que les automatisations sont lues, sans attendre les statistiques @defaut', async ({ page }) => {
    let liberer: () => void = () => undefined;
    const barriere = new Promise<void>((r) => { liberer = r; });
    await page.route('**/api/automations/rules/stats*', async (route) => { await barriere; await route.continue(); });
    const regles = page.waitForResponse((r) => r.url().includes('/rest/v1/automation_rules?') && r.request().method() === 'GET');
    await page.goto('/automations');
    await regles;
    try {
      // Les règles sont arrivées ; le tableau reste pourtant une roue tant que les échecs PUIS les statistiques
      // n'ont pas répondu (trois lectures à la suite). Les chiffres pourraient arriver après, dans leurs colonnes.
      await expect(page.getByRole('table')).toBeVisible({ timeout: 20_000 });
    } finally {
      liberer();
    }
  });

  test('[LST-060] panne de lecture : l’écran dit qu’il n’a pas pu charger et « Réessayer » recharge la liste', async ({ page, bureau, marque, moniteur }) => {
    await creerRegle(bureau, bureau.orgA, { name: `${marque} toujours la` });
    moniteur.attendu(/500 GET .*\/rest\/v1\/automation_rules/, 'panne simulée de la lecture des automatisations');
    moniteur.attendu(/Failed to load rules/, 'journal de la panne simulée');
    let enPanne = true;
    await page.route('**/rest/v1/automation_rules?*', (route) => (enPanne && route.request().method() === 'GET'
      ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'panne simulée' }) })
      : route.continue()));
    await page.goto('/automations');
    const alerte = page.getByRole('alert').filter({ hasText: 'Impossible de charger les automatisations pour le moment.' });
    await expect(alerte).toBeVisible({ timeout: 90_000 });
    await expect(alerte).toContainText('Rien n’a été supprimé : c’est la lecture qui a échoué.');
    await expect(toast(page, 'Impossible de charger les automatisations')).toBeVisible();
    // Surtout pas « Aucune automatisation » : elles existent, elles tournent.
    await expect(page.getByText('Aucune automatisation')).toHaveCount(0);
    await expect(page.getByRole('table')).toHaveCount(0);

    enPanne = false;
    await alerte.getByRole('button', { name: 'Réessayer' }).click();
    await expect(page.getByRole('table')).toBeVisible();
    await expect(alerte).toHaveCount(0);
    await chercher(page, marque);
    await expect(ligne(page, `${marque} toujours la`)).toBeVisible();
  });

  test('[LST-060] panne de lecture : les compteurs d’onglets ne prétendent pas « (0) » @defaut', async ({ page, bureau, marque, moniteur }) => {
    await creerRegle(bureau, bureau.orgA, { name: `${marque} a la corbeille`, deleted_at: new Date().toISOString() });
    moniteur.attendu(/500 GET .*\/rest\/v1\/automation_rules/, 'panne simulée de la lecture des automatisations');
    moniteur.attendu(/Failed to load rules/, 'journal de la panne simulée');
    await page.route('**/rest/v1/automation_rules?*', (route) => (route.request().method() === 'GET'
      ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'panne simulée' }) })
      : route.continue()));
    await page.goto('/automations');
    await expect(page.getByRole('alert').filter({ hasText: 'Impossible de charger' })).toBeVisible({ timeout: 90_000 });
    // La corbeille contient une automatisation : « Corbeille (0) » est faux tant que la lecture a échoué.
    await expect(onglet(page, 'Corbeille')).not.toHaveText('Corbeille (0)');
  });
});

test.describe('états vides', () => {
  test('[LST-023] corbeille vide : « La corbeille est vide »', async ({ page, bureau }) => {
    const { count } = await bureau.admin.from('automation_rules').select('id', { count: 'exact', head: true })
      .eq('org_id', bureau.orgA).not('deleted_at', 'is', null).is('purged_at', null);
    expect(count).toBe(0);
    await ouvrirListe(page);
    await onglet(page, 'Corbeille').click();
    await expect(onglet(page, 'Corbeille')).toHaveText('Corbeille (0)');
    await expect(page.getByText('La corbeille est vide')).toBeVisible();
    await expect.poll(() => nomsAffiches(page)).toEqual([]);
    // Le renvoi vers les automatisations prêtes à publier n'existe que dans « Toutes » (il s'appelait « Voir les modèles »).
    await expect(page.getByRole('button', { name: /Voir les (modèles|automatisations prêtes à publier)/ })).toHaveCount(0);
  });

  test('[LST-021] « À vérifier » sans échec : « Aucune erreur — tout roule »', async ({ page }) => {
    await ouvrirListe(page);
    await onglet(page, 'À vérifier').click();
    await expect(onglet(page, 'À vérifier')).toHaveText('À vérifier (0)');
    await expect(page.getByText('Aucune erreur — tout roule')).toBeVisible();
    await expect.poll(() => nomsAffiches(page)).toEqual([]);
  });

  test('[LST-021] « À vérifier » : une cause inconnue n’affiche que le compteur, jamais le message technique', async ({ page, bureau, marque }) => {
    const r = await creerRegle(bureau, bureau.orgA, { name: `${marque} cause inconnue`, is_active: true });
    await creerEchec(bureau, bureau.orgA, r.id, 'TypeError: cannot read properties of undefined (reading "x")');
    await page.goto('/automations?onglet=verifier');
    await expect(ligne(page, `${marque} cause inconnue`)).toBeVisible({ timeout: 90_000 });
    await expect(ligne(page, `${marque} cause inconnue`)).toContainText('1 échec(s) dans les 7 derniers jours');
    await expect(ligne(page, `${marque} cause inconnue`)).not.toContainText('TypeError');
  });

  test('[LST-021] S-26 : si la lecture des échecs échoue, « À vérifier » ne dit pas « tout roule » @defaut', async ({ page, bureau, marque, moniteur }) => {
    const r = await creerRegle(bureau, bureau.orgA, { name: `${marque} en echec`, is_active: true });
    await creerEchec(bureau, bureau.orgA, r.id, 'No recipient phone');
    moniteur.attendu(/500 GET .*\/rest\/v1\/automation_execution_logs/, 'panne simulée de la lecture des échecs');
    moniteur.attendu(/Failed to load automation failures/, 'journal de la panne simulée');
    await page.route('**/rest/v1/automation_execution_logs?*', (route) => route.fulfill({
      status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'panne simulée' }),
    }));
    await ouvrirListe(page);
    await expect(page.getByRole('table')).toBeVisible();
    await onglet(page, 'À vérifier').click();
    // Une automatisation échoue en ce moment : affirmer « tout roule » est faux.
    await expect(page.getByText('Aucune erreur — tout roule')).toHaveCount(0);
    await expect(onglet(page, 'À vérifier')).not.toHaveText('À vérifier (0)');
  });

  test('[LST-020] bureau sans aucune automatisation : l’écran le dit et « Créer » fonctionne', async ({ page, bureau }) => {
    // Un bureau naît avec ses préréglages : l'état « rien du tout » se prépare en rendant la lecture vide.
    await page.route('**/rest/v1/automation_rules?*', (route) => (route.request().method() === 'GET'
      ? route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
      : route.continue()));
    const avant = await compterRegles(bureau, bureau.orgA);
    await ouvrirListe(page);
    await expect(page.getByText('Aucune automatisation')).toBeVisible();
    await expect(onglet(page, 'Prêtes à publier')).toHaveText('Prêtes à publier (0)');
    // Rien à publier non plus : pas de renvoi vers un onglet vide.
    await expect(page.getByRole('button', { name: /Voir les (modèles|automatisations prêtes à publier)/ })).toHaveCount(0);
    // Pas de pagination fantôme.
    await expect(page.getByText('sur 1')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Suivant' })).toBeDisabled();
    // La création reste à portée : le menu « Créer » de l'en-tête.
    await page.getByRole('button', { name: 'Créer', exact: true }).click();
    await page.getByRole('menuitem', { name: /Partir de zéro/ }).click();
    await expect(page).toHaveURL(/\/automations\/nouvelle$/);
    expect(await compterRegles(bureau, bureau.orgA)).toBe(avant);
  });

  test('[LST-020] bureau sans aucune automatisation : l’état vide propose lui-même de créer @defaut', async ({ page }) => {
    await page.route('**/rest/v1/automation_rules?*', (route) => (route.request().method() === 'GET'
      ? route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
      : route.continue()));
    await ouvrirListe(page);
    const vide = page.getByRole('cell').filter({ hasText: 'Aucune automatisation' });
    await expect(vide).toBeVisible();
    // « Aucune automatisation », seul, ne dit ni pourquoi ni quoi faire.
    await expect(vide.getByRole('button', { name: /Créer|modèle/i })).toBeVisible({ timeout: 5_000 });
  });

  test('[LST-035] S-40 : une recherche sans résultat le dit, au lieu de « Aucune automatisation » @defaut', async ({ page }) => {
    await ouvrirListe(page);
    await chercher(page, 'zzz-aucune-ne-porte-ce-nom');
    await expect.poll(() => nomsAffiches(page)).toEqual([]);
    // Le bureau a 35 automatisations : « Aucune automatisation » est faux, c'est la recherche qui ne trouve rien.
    await expect(page.getByText('Aucune automatisation', { exact: true })).toHaveCount(0);
    await expect(page.getByText(/Aucun résultat|Aucune automatisation ne correspond/)).toBeVisible({ timeout: 5_000 });
  });
});

test.describe('« Toutes » vide et « Voir les automatisations prêtes à publier »', () => {
  test.use({ compte: 'proprioB' });

  test('[LST-068] tous les préréglages dépubliés : « Toutes » est vide, « Voir les automatisations prêtes à publier » ouvre l’onglet « Prêtes à publier »', async ({ page, bureau }) => {
    await bureau.admin.from('automation_rules').update({ is_active: false }).eq('org_id', bureau.orgB).eq('is_preset', true);
    // Ce que la liste peut montrer, lu en base à l'instant : sans le préréglage retiré de l'affichage (098dd153).
    const affichables = (await reglesAffichables(bureau, bureau.orgB)).filter((r) => !r.deleted_at);
    const nbModeles = affichables.filter((r) => r.is_preset && !r.is_active).length;
    expect(affichables.filter((r) => !r.is_preset)).toHaveLength(0);
    expect(nbModeles).toBeGreaterThan(10);

    await ouvrirListe(page);
    await expect(page.getByText('Aucune automatisation')).toBeVisible();
    await expect(onglet(page, 'Prêtes à publier')).toHaveText(`Prêtes à publier (${nbModeles})`);
    await expect(page.getByRole('button', { name: 'Voir les modèles' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Voir les automatisations prêtes à publier' }).click();
    await expect(onglet(page, 'Prêtes à publier')).toHaveAttribute('aria-selected', 'true');
    // 10 par page par défaut : la première page est pleine, toutes en brouillon.
    await expect.poll(async () => (await nomsAffiches(page)).length).toBe(10);
    await expect(page.getByRole('row').filter({ hasText: 'Publiée' })).toHaveCount(0);
    await expect(page.getByText(`sur ${Math.ceil(nbModeles / 10)}`)).toBeVisible();
  });
});
