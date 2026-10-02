/**
 * Éditeur — écrans de chargement, d'erreur, d'introuvable, et LIENS DIRECTS.
 *
 * Ce que ce fichier prouve :
 *  · l'écran de chargement et l'écran d'échec (« Réessayer », « Mes automatisations ») ;
 *  · une adresse d'automatisation existante ouvre SON parcours ;
 *  · une adresse inexistante, mal formée ou purgée donne un message propre ;
 *  · une automatisation du bureau B n'est jamais montrée au propriétaire du bureau A ;
 *  · une automatisation à la corbeille ne s'ouvre pas comme une autre (piste S-15) ;
 *  · un rôle sans droit d'écriture est arrêté avant l'éditeur.
 */
import { lireRegle, appelApi } from '../_outils/banc';
import {
  test, expect, DELAI_TEST, CAPTURES, creerParcours, troisTextos, ouvrirEditeur, cartes, barre, carte, panneauEtape, toasts, ecranEditeur } from './_aides';

test.describe.configure({ timeout: DELAI_TEST });

test.describe('éditeur — chargement et échec de chargement', () => {
  test('[EDT-001] échec de chargement : message clair, « Réessayer » recharge l’automatisation', async ({ page, bureau, marque, moniteur }) => {
    const r = await creerParcours(bureau, `${marque} échec`, troisTextos());
    moniteur.attendu(/500 GET .*\/api\/automations\/editeur/, 'panne simulée du chargement');
    moniteur.attendu(/\[builder\] chargement échoué/, 'la panne simulée est journalisée par l’éditeur');
    let panne = true;
    let appels = 0;
    await page.route('**/api/automations/editeur**', async (route) => {
      if (!panne) return route.continue();
      appels += 1;
      return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Impossible de lire l’automatisation.' }) });
    });
    await page.goto(`/automations/${r.id}`);
    await expect(page.getByText('Impossible de charger cette automatisation pour le moment.')).toBeVisible({ timeout: 90_000 });
    // Trois essais avant d'abandonner (1,5 s puis 3 s) : un échec passager ne vide pas l'écran.
    // (4 en développement : le mode strict de React monte l'effet deux fois, le premier montage n'insiste pas.)
    expect(appels).toBeGreaterThanOrEqual(3);
    expect(appels).toBeLessThanOrEqual(4);
    await expect(page.getByRole('button', { name: 'Réessayer' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Mes automatisations' })).toBeVisible();
    await page.screenshot({ path: `${CAPTURES}/edt-001-echec-chargement.png` });

    panne = false;
    await page.getByRole('button', { name: 'Réessayer' }).click();
    await expect(page.getByRole('tablist', { name: 'Sections' })).toBeVisible({ timeout: 60_000 });
    expect(await cartes(page)).toEqual([
      'Envoyer un texto | Texto ALPHA', 'Envoyer un texto | Texto BRAVO', 'Envoyer un texto | Texto CHARLIE',
    ]);
  });

  test('[EDT-002] échec de chargement : « Mes automatisations » ramène à la liste', async ({ page, bureau, marque, moniteur }) => {
    const r = await creerParcours(bureau, `${marque} échec retour`, troisTextos());
    moniteur.attendu(/500 GET .*\/api\/automations\/editeur/, 'panne simulée du chargement');
    moniteur.attendu(/\[builder\] chargement échoué/, 'la panne simulée est journalisée par l’éditeur');
    await page.route('**/api/automations/editeur**', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Impossible de lire l’automatisation.' }) }));
    await page.goto(`/automations/${r.id}`);
    await expect(page.getByText('Impossible de charger cette automatisation pour le moment.')).toBeVisible({ timeout: 90_000 });
    await page.getByRole('button', { name: 'Mes automatisations' }).click();
    await expect(page).toHaveURL(/\/automations$/);
    await expect(page.getByRole('heading', { name: 'Mes automatisations' })).toBeVisible({ timeout: 60_000 });
  });

  test('[EDT-001] pendant le chargement, l’écran DIT qu’il charge (texte ou rôle « status »)', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} chargement`, troisTextos());
    let liberer: () => void = () => undefined;
    const attente = new Promise<void>((res) => { liberer = res; });
    await page.route('**/api/automations/editeur**', async (route) => { await attente; await route.continue(); });
    await page.goto(`/automations/${r.id}`);
    // L'écran plein écran de l'éditeur est là (la liste est masquée), mais que dit-il ?
    const ecran = page.locator('div.fixed.inset-0.z-50');
    await expect(ecran).toBeVisible({ timeout: 90_000 });
    await page.screenshot({ path: `${CAPTURES}/edt-e02-chargement.png` });
    const annonce = ecran.getByRole('status').or(ecran.getByText(/Chargement|Loading/i));
    try {
      await expect(annonce.first(), 'l’écran de chargement n’a ni texte ni rôle « status » : un lecteur d’écran ne dit rien').toBeVisible({ timeout: 3000 });
    } finally {
      liberer();
      await expect(page.getByRole('tablist', { name: 'Sections' })).toBeVisible({ timeout: 60_000 });
    }
  });
});

test.describe('éditeur — liens directs', () => {
  test('[EDT-037][EDT-032] l’adresse d’une automatisation existante ouvre SON parcours, identique à la base', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} lien direct`, troisTextos());
    await ouvrirEditeur(page, r.id);
    await expect(barre(page).getByRole('button', { name: `${marque} lien direct` })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Quand\s*Devis envoyé/ })).toBeVisible();
    expect(await cartes(page)).toEqual([
      'Envoyer un texto | Texto ALPHA', 'Envoyer un texto | Texto BRAVO', 'Envoyer un texto | Texto CHARLIE',
    ]);
    await expect(page.getByRole('switch', { name: 'Publier l’automatisation' })).toHaveAttribute('aria-checked', 'false');
    await expect(page.getByText('Brouillon', { exact: true })).toBeVisible();
  });

  test('[EDT-003] identifiant inexistant : « introuvable » + retour à la liste, sans erreur brute', async ({ page }) => {
    await page.goto('/automations/00000000-0000-4000-8000-000000000000');
    await expect(page.getByText('Cette automatisation est introuvable.')).toBeVisible({ timeout: 90_000 });
    await page.screenshot({ path: `${CAPTURES}/edt-003-introuvable.png` });
    await page.getByRole('button', { name: 'Mes automatisations' }).click();
    await expect(page).toHaveURL(/\/automations$/);
    await expect(page.getByRole('heading', { name: 'Mes automatisations' })).toBeVisible({ timeout: 60_000 });
  });

  test('[EDT-003] identifiant mal formé (/automations/abc) : « introuvable », pas de page blanche', async ({ page }) => {
    await page.goto('/automations/abc');
    await expect(page.getByText('Cette automatisation est introuvable.')).toBeVisible({ timeout: 90_000 });
    await expect(page.getByRole('button', { name: 'Mes automatisations' })).toBeVisible();
  });

  test('[EDT-003] automatisation supprimée définitivement : « introuvable », rien d’elle n’est affiché', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} purgée`, troisTextos(), {
      deleted_at: new Date().toISOString(), purged_at: new Date().toISOString(),
    });
    await page.goto(`/automations/${r.id}`);
    await expect(page.getByText('Cette automatisation est introuvable.')).toBeVisible({ timeout: 90_000 });
    await expect(page.getByText('Texto ALPHA')).toHaveCount(0);
    await expect(page.getByText(`${marque} purgée`)).toHaveCount(0);
  });

  test('[EDT-003] automatisation du bureau B ouverte par le propriétaire du bureau A : refus, rien de B ne s’affiche', async ({ page, bureau, marque, jetonDe, baseURL }) => {
    const rB = await creerParcours(bureau, `${marque} secret de B`, [
      { id: 'e1', type: 'action', action: { type: 'send_sms', config: { body: 'CONFIDENTIEL BUREAU B' } }, suivant: null },
    ], { org_id: bureau.orgB });
    const vuB: string[] = [];
    page.on('response', async (resp) => {
      if (!/\/api\/|\/rest\/v1\//.test(resp.url())) return;
      const corps = await resp.text().catch(() => '');
      if (corps.includes('CONFIDENTIEL BUREAU B') || corps.includes(rB.id)) vuB.push(resp.url());
    });
    await page.goto(`/automations/${rB.id}`);
    await expect(page.getByText('Cette automatisation est introuvable.')).toBeVisible({ timeout: 90_000 });
    await expect(page.getByText('CONFIDENTIEL BUREAU B')).toHaveCount(0);
    await expect(page.getByText(`${marque} secret de B`)).toHaveCount(0);
    expect(vuB, 'aucune réponse réseau ne doit porter la règle du bureau B').toEqual([]);

    // Sans passer par les boutons : la lecture, l'écriture et la publication directes sont refusées aussi.
    const jeton = await jetonDe('proprioA');
    const lecture = await appelApi(baseURL!, jeton, bureau.orgA, 'GET', `/api/automations/editeur?rule_id=${rB.id}`);
    expect((lecture.json as { rule: unknown }).rule).toBeNull();
    const ecriture = await appelApi(baseURL!, jeton, bureau.orgA, 'PATCH', `/api/automations/rules/${rB.id}`, { name: 'piraté' });
    expect(ecriture.status).toBe(404);
    const publication = await appelApi(baseURL!, jeton, bureau.orgA, 'POST', `/api/automations/rules/${rB.id}/publication`, { actif: true });
    expect([403, 404]).toContain(publication.status);
    const apres = await lireRegle(bureau, rB.id);
    expect(apres?.name).toBe(`${marque} secret de B`);
    expect(apres?.is_active).toBe(false);
  });

  /*
   * Depuis #859 (constat EDITEUR-01), une automatisation à la corbeille ne s'ouvre plus dans l'éditeur :
   * un écran dédié dit où elle est et offre « Restaurer » (AutomationBuilderPage.tsx, `if (regle.deleted_at)`).
   * Ni onglets, ni canevas, ni interrupteur : les trois tests ci-dessous attendaient l'ancien écran.
   */
  const ECRAN_CORBEILLE = 'Cette automatisation est à la corbeille : elle ne se déclenche plus et ne se modifie pas. Restaurez-la pour la retravailler — elle reviendra en brouillon.';

  test('[EDT-003] automatisation à la corbeille : l’éditeur DIT qu’elle est à la corbeille (S-15)', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} s15 affichage`, troisTextos(), { deleted_at: new Date().toISOString() });
    await page.goto(`/automations/${r.id}`);
    const ecran = ecranEditeur(page);
    await expect(ecran.getByText(ECRAN_CORBEILLE)).toBeVisible({ timeout: 90_000 });
    await page.screenshot({ path: `${CAPTURES}/edt-s15-corbeille.png` });
    // L'écran nomme l'automatisation et offre les deux sorties ; rien de l'éditeur n'est là.
    await expect(ecran.getByText(`${marque} s15 affichage`)).toBeVisible();
    await expect(ecran.getByRole('button', { name: 'Restaurer', exact: true })).toBeVisible();
    await expect(ecran.getByRole('button', { name: 'Mes automatisations' })).toBeVisible();
    await expect(page.getByRole('tablist', { name: 'Sections' })).toHaveCount(0);
    await expect(page.getByRole('switch', { name: 'Publier l’automatisation' })).toHaveCount(0);
    await expect(page.getByText('Texto ALPHA')).toHaveCount(0);
    await expect(page.getByText('Cette automatisation est introuvable.')).toHaveCount(0);
  });

  test('[EDT-003] automatisation à la corbeille : on ne peut pas la modifier depuis son adresse (S-15)', async ({ page, bureau, marque, jetonDe, baseURL }) => {
    const r = await creerParcours(bureau, `${marque} s15 modif`, troisTextos(), { deleted_at: new Date().toISOString() });
    await page.goto(`/automations/${r.id}`);
    await expect(ecranEditeur(page).getByText(ECRAN_CORBEILLE)).toBeVisible({ timeout: 90_000 });
    // Par l'écran : aucune carte à ouvrir, aucun panneau.
    await expect(carte(page, 'Texto BRAVO')).toHaveCount(0);
    await expect(panneauEtape(page)).toHaveCount(0);
    // Sans passer par l'écran (onglet resté ouvert, appel direct) : le serveur refuse, en français, et dit quoi faire.
    const ecriture = await appelApi(baseURL!, await jetonDe('proprioA'), bureau.orgA, 'PATCH', `/api/automations/rules/${r.id}`, {
      steps: [{ id: 'e1', type: 'action', action: { type: 'send_sms', config: { body: 'MODIFIÉ DANS LA CORBEILLE' } }, suivant: null }],
    });
    expect(ecriture.status).toBe(409);
    expect((ecriture.json as { error?: string }).error).toBe('Cette automatisation est à la corbeille : restaurez-la pour la modifier.');
    const apres = await lireRegle(bureau, r.id);
    expect(JSON.stringify(apres?.steps), 'le parcours d’une automatisation à la corbeille a été réécrit en base').not.toContain('MODIFIÉ DANS LA CORBEILLE');
    expect(apres?.updated_at).toBe(r.updated_at);
  });

  test('[EDT-018] automatisation à la corbeille : la publier est refusé avec un message en français', async ({ page, bureau, marque, jetonDe, baseURL }) => {
    const r = await creerParcours(bureau, `${marque} s15 publier`, troisTextos(), { deleted_at: new Date().toISOString() });
    await page.goto(`/automations/${r.id}`);
    const ecran = ecranEditeur(page);
    await expect(ecran.getByText(ECRAN_CORBEILLE)).toBeVisible({ timeout: 90_000 });
    // L'écran n'offre plus d'interrupteur : publier n'est possible que par un appel direct, que le serveur refuse.
    await expect(page.getByRole('switch', { name: 'Publier l’automatisation' })).toHaveCount(0);
    const publication = await appelApi(baseURL!, await jetonDe('proprioA'), bureau.orgA, 'POST', `/api/automations/rules/${r.id}/publication`, { actif: true });
    expect(publication.status).toBe(422);
    expect((publication.json as { error?: string }).error).toBe('Cette automatisation est à la corbeille : restaurez-la avant de la publier.');
    expect((await lireRegle(bureau, r.id))?.is_active).toBe(false);

    // « Restaurer » la rend à l'éditeur, EN BROUILLON : c'est le chemin que l'écran propose pour la publier.
    await ecran.getByRole('button', { name: 'Restaurer', exact: true }).click();
    await expect(toasts(page).filter({ hasText: 'Automatisation restaurée, en brouillon.' })).toBeVisible();
    await expect(page.getByRole('tablist', { name: 'Sections' })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('switch', { name: 'Publier l’automatisation' })).toHaveAttribute('aria-checked', 'false');
    expect(await cartes(page)).toEqual([
      'Envoyer un texto | Texto ALPHA', 'Envoyer un texto | Texto BRAVO', 'Envoyer un texto | Texto CHARLIE',
    ]);
    const restauree = await lireRegle(bureau, r.id);
    expect(restauree?.deleted_at).toBeNull();
    expect(restauree?.is_active).toBe(false);
  });
});

test.describe('éditeur — rôle sans droit d’écriture', () => {
  test.use({ compte: 'techA' });
  test('[EDT-003] un technicien qui ouvre l’adresse d’une automatisation est arrêté avant l’éditeur', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} tech`, troisTextos());
    await page.goto(`/automations/${r.id}`);
    await expect(page.getByText(/Accès restreint/)).toBeVisible({ timeout: 90_000 });
    await page.screenshot({ path: `${CAPTURES}/edt-e01-acces-restreint.png` });
    await expect(page.getByRole('tablist', { name: 'Sections' })).toHaveCount(0);
    await expect(page.getByText('Texto ALPHA')).toHaveCount(0);
  });
});
