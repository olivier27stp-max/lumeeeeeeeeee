/**
 * LISTE — cases à cocher et actions en lot.
 *
 * Ce que ce fichier prouve :
 *  · cocher une ligne, « Tout cocher » (la page visible), « Tout décocher » ;
 *    la sélection ne survit à aucun changement de vue ;
 *  · « Publier (n) » et « Repasser en brouillon (n) » : le n annoncé est celui
 *    qui est réellement touché, la base suit, les refus sont nommés ;
 *  · « Supprimer (n) » : confirmation, corbeille, les automatisations fournies
 *    sont épargnées ;
 *  · dans la corbeille : « Restaurer (n) » et « Supprimer définitivement (n) » ;
 *  · pendant un lot, la barre est désarmée.
 */
import { randomUUID } from 'node:crypto';
import { capturesDe } from '../_outils/banc';
import {
  test, expect, creerRegle, lireRegle, ouvrirListe, chercher, ligne, toast, onglet, nomsAffiches, attendre, activerClientInactif,
  ETAPES_TEXTO,
} from './_aides';

const cocher = (page: import('@playwright/test').Page, nom: string) => page.getByRole('checkbox', { name: `Cocher ${nom}`, exact: true });

test.describe('sélection', () => {
  test('[LST-069][LST-059] cocher une ligne fait apparaître la barre de lot ; « Tout décocher » la retire', async ({ page, bureau, marque }) => {
    const a = await creerRegle(bureau, bureau.orgA, { name: `${marque} A` });
    const b = await creerRegle(bureau, bureau.orgA, { name: `${marque} B`, is_active: true });
    await ouvrirListe(page);
    await chercher(page, marque);
    await expect(page.getByText(/sélectionnée\(s\)/)).toHaveCount(0);
    await cocher(page, a.name).check();
    await expect(page.getByText('1 sélectionnée(s)')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Publier (1)' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Repasser en brouillon (0)' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Supprimer (1)' })).toBeVisible();
    await cocher(page, b.name).check();
    await expect(page.getByText('2 sélectionnée(s)')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Publier (1)' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Repasser en brouillon (1)' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Supprimer (2)' })).toBeVisible();
    await cocher(page, a.name).uncheck();
    await expect(page.getByText('1 sélectionnée(s)')).toBeVisible();

    await page.getByRole('button', { name: 'Tout décocher' }).click();
    await expect(page.getByText(/sélectionnée\(s\)/)).toHaveCount(0);
    await expect(cocher(page, b.name)).not.toBeChecked();
  });

  test('[LST-061] « Tout cocher » coche la page affichée, et la décoche au second clic', async ({ page, bureau, marque }) => {
    for (const n of ['A', 'B', 'C']) await creerRegle(bureau, bureau.orgA, { name: `${marque} ${n}` });
    await ouvrirListe(page);
    await chercher(page, marque);
    const tout = page.getByRole('checkbox', { name: 'Tout cocher' });
    await expect(tout).not.toBeChecked();
    await tout.check();
    await expect(page.getByText('3 sélectionnée(s)')).toBeVisible();
    for (const n of ['A', 'B', 'C']) await expect(cocher(page, `${marque} ${n}`)).toBeChecked();
    // Une ligne décochée : « Tout cocher » n'est plus coché.
    await cocher(page, `${marque} B`).uncheck();
    await expect(tout).not.toBeChecked();
    await expect(page.getByText('2 sélectionnée(s)')).toBeVisible();
    await tout.check();
    await expect(page.getByText('3 sélectionnée(s)')).toBeVisible();
    await tout.uncheck();
    await expect(page.getByText(/sélectionnée\(s\)/)).toHaveCount(0);
  });

  test('[LST-061] « Tout cocher » partiellement cochée montre l’état intermédiaire @defaut', async ({ page, bureau, marque }) => {
    for (const n of ['A', 'B']) await creerRegle(bureau, bureau.orgA, { name: `${marque} ${n}` });
    await ouvrirListe(page);
    await chercher(page, marque);
    await cocher(page, `${marque} A`).check();
    // Une case « tout » avec une partie des lignes cochées se montre d'ordinaire en état intermédiaire (tiret).
    await expect.poll(() => page.getByRole('checkbox', { name: 'Tout cocher' }).evaluate((e) => (e as HTMLInputElement).indeterminate), { timeout: 5_000 }).toBe(true);
  });

  test('[LST-069] la sélection ne survit ni à un changement d’onglet, ni à une recherche, ni à un filtre', async ({ page, bureau, marque }) => {
    const a = await creerRegle(bureau, bureau.orgA, { name: `${marque} A` });
    await creerRegle(bureau, bureau.orgA, { name: `${marque} B`, deleted_at: new Date().toISOString() });
    await ouvrirListe(page);
    await chercher(page, marque);
    await cocher(page, a.name).check();
    await onglet(page, 'Corbeille').click();
    await expect(page.getByText(/sélectionnée\(s\)/)).toHaveCount(0);
    await onglet(page, 'Toutes').click();
    await expect(cocher(page, a.name)).not.toBeChecked();

    await cocher(page, a.name).check();
    await chercher(page, `${marque} A`);
    await expect(page.getByText(/sélectionnée\(s\)/)).toHaveCount(0);
    await expect(cocher(page, a.name)).not.toBeChecked();

    await cocher(page, a.name).check();
    await page.getByRole('button', { name: 'Filtres avancés' }).click();
    await page.getByRole('combobox', { name: 'Statut' }).selectOption({ label: 'Brouillon' });
    await expect(page.getByText(/sélectionnée\(s\)/)).toHaveCount(0);
  });

  test('[LST-069] S-20 : cocher une ligne ne fait pas descendre le tableau sous la souris @defaut', async ({ page, bureau, marque }) => {
    const a = await creerRegle(bureau, bureau.orgA, { name: `${marque} A` });
    await creerRegle(bureau, bureau.orgA, { name: `${marque} B` });
    await ouvrirListe(page);
    await chercher(page, marque);
    const avant = await cocher(page, a.name).boundingBox();
    await cocher(page, a.name).check();
    await expect(page.getByText('1 sélectionnée(s)')).toBeVisible();
    const apres = await cocher(page, a.name).boundingBox();
    // La barre de lot s'insère AU-DESSUS du tableau : toutes les lignes descendent, le clic suivant tombe ailleurs.
    expect(Math.round((apres?.y ?? 0) - (avant?.y ?? 0))).toBe(0);
  });
});

test.describe('publier et dépublier en lot', () => {
  test('[LST-054] « Publier (n) » publie les brouillons cochés : toast, statuts, base', async ({ page, bureau, marque }) => {
    const a = await creerRegle(bureau, bureau.orgA, { name: `${marque} A`, steps: ETAPES_TEXTO, actions: [] });
    const b = await creerRegle(bureau, bureau.orgA, { name: `${marque} B`, steps: ETAPES_TEXTO, actions: [] });
    const c = await creerRegle(bureau, bureau.orgA, { name: `${marque} C deja publiee`, steps: ETAPES_TEXTO, actions: [], is_active: true });
    const d = await creerRegle(bureau, bureau.orgA, { name: `${marque} D pas cochee`, steps: ETAPES_TEXTO, actions: [] });
    await ouvrirListe(page);
    await chercher(page, marque);
    for (const r of [a, b, c]) await cocher(page, r.name).check();
    await page.getByRole('button', { name: 'Publier (2)' }).click();
    await expect(toast(page, '2 automatisation(s) publiée(s)')).toBeVisible();
    await expect(page.getByText(/sélectionnée\(s\)/)).toHaveCount(0);
    for (const r of [a, b, c]) await expect(ligne(page, r.name).getByRole('cell').nth(2)).toHaveText('Publiée');
    await expect(ligne(page, d.name).getByRole('cell').nth(2)).toHaveText('Brouillon');
    for (const r of [a, b, c]) expect((await lireRegle(bureau, r.id))?.is_active).toBe(true);
    expect((await lireRegle(bureau, d.id))?.is_active).toBe(false);
  });

  test('[LST-055] « Repasser en brouillon (n) » dépublie les publiées cochées', async ({ page, bureau, marque }) => {
    const a = await creerRegle(bureau, bureau.orgA, { name: `${marque} A`, steps: ETAPES_TEXTO, actions: [], is_active: true });
    const b = await creerRegle(bureau, bureau.orgA, { name: `${marque} B`, steps: ETAPES_TEXTO, actions: [], is_active: true });
    const c = await creerRegle(bureau, bureau.orgA, { name: `${marque} C brouillon`, steps: ETAPES_TEXTO, actions: [] });
    await ouvrirListe(page);
    await chercher(page, marque);
    await page.getByRole('checkbox', { name: 'Tout cocher' }).check();
    await page.getByRole('button', { name: 'Repasser en brouillon (2)' }).click();
    await expect(toast(page, '2 automatisation(s) repassée(s) en brouillon')).toBeVisible();
    for (const r of [a, b, c]) {
      await expect(ligne(page, r.name).getByRole('cell').nth(2)).toHaveText('Brouillon');
      expect((await lireRegle(bureau, r.id))?.is_active).toBe(false);
    }
  });

  test('[LST-054] un parcours impubliable est refusé et NOMMÉ ; les autres sont publiés', async ({ page, bureau, marque }) => {
    const ok = await creerRegle(bureau, bureau.orgA, { name: `${marque} A complete`, steps: ETAPES_TEXTO, actions: [] });
    const vide = await creerRegle(bureau, bureau.orgA, { name: `${marque} B vide`, steps: [], actions: [] });
    await ouvrirListe(page);
    await chercher(page, marque);
    await page.getByRole('checkbox', { name: 'Tout cocher' }).check();
    await page.getByRole('button', { name: 'Publier (2)' }).click();
    await expect(toast(page, '1 automatisation(s) publiée(s)')).toBeVisible();
    await expect(toast(page, new RegExp(`« ${vide.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} » — Publication refusée : .+`))).toBeVisible();
    await expect(ligne(page, ok.name).getByRole('cell').nth(2)).toHaveText('Publiée');
    await expect(ligne(page, vide.name).getByRole('cell').nth(2)).toHaveText('Brouillon');
    expect((await lireRegle(bureau, ok.id))?.is_active).toBe(true);
    expect((await lireRegle(bureau, vide.id))?.is_active).toBe(false);
  });

  test('[LST-054] S-25 : deux refus sont lisibles, un par ligne @defaut', async ({ page, bureau, marque }) => {
    const v1 = await creerRegle(bureau, bureau.orgA, { name: `${marque} A vide`, steps: [], actions: [] });
    const v2 = await creerRegle(bureau, bureau.orgA, { name: `${marque} B vide`, steps: [], actions: [] });
    await ouvrirListe(page);
    await chercher(page, marque);
    await page.getByRole('checkbox', { name: 'Tout cocher' }).check();
    await page.getByRole('button', { name: 'Publier (2)' }).click();
    const refus = toast(page, /Publication refusée/).first();
    await expect(refus).toBeVisible();
    await page.screenshot({ path: `${capturesDe('liste')}/S-25-refus-en-lot.png` });
    // Les deux refus sont joints par un saut de ligne que le toast n'affiche pas : tout tient sur une ligne continue.
    const hauteurs = await refus.evaluate((el) => {
      const s = getComputedStyle(el);
      return { blancs: s.whiteSpace, texte: el.textContent ?? '' };
    });
    expect(hauteurs.texte).toContain(v1.name);
    expect(hauteurs.texte).toContain(v2.name);
    expect(hauteurs.blancs).toMatch(/pre/);
  });

  test('[LST-054][LST-055] S-21 : « Publier (0) » et « Repasser en brouillon (0) » sont désactivés @defaut', async ({ page, bureau, marque }) => {
    const a = await creerRegle(bureau, bureau.orgA, { name: `${marque} A publiee`, is_active: true });
    await ouvrirListe(page);
    await chercher(page, marque);
    await cocher(page, a.name).check();
    // Rien à publier : le bouton est pourtant actif, et son clic vide la sélection sans un mot.
    await expect(page.getByRole('button', { name: 'Publier (0)' })).toBeDisabled({ timeout: 5_000 });
  });

  test('[LST-054] S-22 : publier « Client inactif » en lot pose la même confirmation que l’interrupteur @defaut', async ({ page, bureau, marque, jetonDe, baseURL }) => {
    // Même préparation que pour l'interrupteur (05-lignes) : la capacité est active, le décompte possible.
    await activerClientInactif(bureau, String(baseURL), await jetonDe('proprioA'));
    const r = await creerRegle(bureau, bureau.orgA, { name: `${marque} inactifs`, trigger_event: 'client.inactive', conditions: { mois: 6 }, steps: ETAPES_TEXTO, actions: [] });
    await ouvrirListe(page);
    await chercher(page, marque);
    await cocher(page, r.name).check();
    await page.getByRole('button', { name: 'Publier (1)' }).click();
    // L'interrupteur de la ligne annonce combien de clients seront contactés et demande confirmation ; le lot publie d'un coup.
    await expect(page.getByRole('dialog', { name: 'Activer « Client inactif » ?' })).toBeVisible({ timeout: 8_000 });
  });

  test('[LST-054][LST-059] pendant un lot, la barre est désarmée (pas de double envoi)', async ({ page, bureau, marque }) => {
    const a = await creerRegle(bureau, bureau.orgA, { name: `${marque} A`, steps: ETAPES_TEXTO, actions: [] });
    let liberer: () => void = () => undefined;
    const barriere = new Promise<void>((ok) => { liberer = ok; });
    const envois: string[] = [];
    await page.route('**/api/automations/rules/publication', async (route) => { envois.push(route.request().postData() ?? ''); await barriere; await route.continue(); });
    await ouvrirListe(page);
    await chercher(page, marque);
    await cocher(page, a.name).check();
    await page.getByRole('button', { name: 'Publier (1)' }).click();
    await expect(page.getByRole('button', { name: 'Publier (1)' })).toBeDisabled();
    await expect(page.getByRole('button', { name: /^Repasser en brouillon/ })).toBeDisabled();
    await expect(page.getByRole('button', { name: /^Supprimer \(/ })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Tout décocher' })).toBeDisabled();
    liberer();
    await expect(toast(page, '1 automatisation(s) publiée(s)')).toBeVisible();
    expect(envois).toHaveLength(1);
    expect(JSON.parse(envois[0])).toEqual({ ids: [a.id], actif: true });
  });
});

test.describe('supprimer en lot', () => {
  test('[LST-056][LST-093][LST-094] « Supprimer (n) » : confirmation, corbeille, base ; les fournies cochées sont épargnées', async ({ page, bureau, marque }) => {
    const a = await creerRegle(bureau, bureau.orgA, { name: `${marque} A`, is_active: true });
    const b = await creerRegle(bureau, bureau.orgA, { name: `${marque} B` });
    const fournie = await creerRegle(bureau, bureau.orgA, { name: `${marque} C fournie`, is_preset: true, preset_key: `e2e_${randomUUID().slice(0, 8)}`, is_active: true });
    await ouvrirListe(page);
    await chercher(page, marque);
    await page.getByRole('checkbox', { name: 'Tout cocher' }).check();
    await expect(page.getByText('3 sélectionnée(s)')).toBeVisible();
    // Le bouton annonce 2 : la fournie ne se supprime pas.
    await page.getByRole('button', { name: 'Supprimer (2)' }).click();
    const dialogue = page.getByRole('dialog', { name: 'Supprimer 2 automatisation(s) ?' });
    await expect(dialogue).toContainText('Elles partent à la corbeille : elles cessent de se déclencher et les envois déjà prévus sont annulés. Tu pourras les restaurer.');
    await dialogue.getByRole('button', { name: 'Annuler' }).click();
    await expect(page.getByText('3 sélectionnée(s)')).toBeVisible();
    expect((await lireRegle(bureau, a.id))?.deleted_at).toBeNull();

    await page.getByRole('button', { name: 'Supprimer (2)' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Supprimer', exact: true }).click();
    await expect(toast(page, '2 automatisation(s) à la corbeille')).toBeVisible();
    await expect.poll(() => nomsAffiches(page)).toEqual([fournie.name]);
    await expect(onglet(page, 'Corbeille')).toHaveText('Corbeille (2)');
    for (const r of [a, b]) {
      const l = await lireRegle(bureau, r.id);
      expect(l?.deleted_at).not.toBeNull();
      expect(l?.is_active).toBe(false);
    }
    const f = await lireRegle(bureau, fournie.id);
    expect({ d: f?.deleted_at, a: f?.is_active }).toEqual({ d: null, a: true });
  });

  test('[LST-056] seules des automatisations fournies cochées : « Un modèle ne se supprime pas. »', async ({ page, bureau, marque }) => {
    const fournie = await creerRegle(bureau, bureau.orgA, { name: `${marque} fournie`, is_preset: true, preset_key: `e2e_${randomUUID().slice(0, 8)}`, is_active: true });
    await ouvrirListe(page);
    await chercher(page, marque);
    await cocher(page, fournie.name).check();
    await page.getByRole('button', { name: 'Supprimer (0)' }).click();
    await expect(toast(page, 'Un modèle ne se supprime pas.')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect((await lireRegle(bureau, fournie.id))?.deleted_at).toBeNull();
  });
});

test.describe('corbeille en lot', () => {
  test('[LST-057] « Restaurer (n) » : les lignes quittent la corbeille et reviennent en brouillon', async ({ page, bureau, marque }) => {
    const quand = new Date().toISOString();
    const a = await creerRegle(bureau, bureau.orgA, { name: `${marque} A`, deleted_at: quand });
    const b = await creerRegle(bureau, bureau.orgA, { name: `${marque} B`, deleted_at: quand });
    const c = await creerRegle(bureau, bureau.orgA, { name: `${marque} C reste`, deleted_at: quand });
    await page.goto('/automations?onglet=corbeille');
    await expect(ligne(page, a.name)).toBeVisible({ timeout: 90_000 });
    await chercher(page, marque);
    await cocher(page, a.name).check();
    await cocher(page, b.name).check();
    // Dans la corbeille, la barre n'offre que restaurer et supprimer définitivement.
    await expect(page.getByRole('button', { name: /^Publier/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Supprimer définitivement (2)' })).toBeVisible();
    await page.getByRole('button', { name: 'Restaurer (2)' }).click();
    await expect(toast(page, '2 automatisation(s) restaurée(s) en brouillon')).toBeVisible();
    await expect.poll(() => nomsAffiches(page)).toEqual([c.name]);
    for (const r of [a, b]) {
      const l = await lireRegle(bureau, r.id);
      expect({ d: l?.deleted_at, a: l?.is_active }).toEqual({ d: null, a: false });
    }
    expect((await lireRegle(bureau, c.id))?.deleted_at).not.toBeNull();
    await onglet(page, 'Toutes').click();
    await expect.poll(() => nomsAffiches(page)).toEqual([a.name, b.name]);
  });

  test('[LST-058][LST-093][LST-094] « Supprimer définitivement (n) » : confirmation, puis les lignes ne reviennent plus', async ({ page, bureau, marque }) => {
    const quand = new Date().toISOString();
    const a = await creerRegle(bureau, bureau.orgA, { name: `${marque} A`, deleted_at: quand });
    const b = await creerRegle(bureau, bureau.orgA, { name: `${marque} B`, deleted_at: quand });
    await page.goto('/automations?onglet=corbeille');
    await expect(ligne(page, a.name)).toBeVisible({ timeout: 90_000 });
    await chercher(page, marque);
    await page.getByRole('checkbox', { name: 'Tout cocher' }).check();
    await page.getByRole('button', { name: 'Supprimer définitivement (2)' }).click();
    const dialogue = page.getByRole('dialog', { name: 'Supprimer définitivement 2 automatisation(s) ?' });
    await expect(dialogue).toContainText('Elles disparaissent de la corbeille et ne pourront plus être restaurées. L’historique des messages déjà envoyés est conservé.');
    await dialogue.getByRole('button', { name: 'Annuler' }).click();
    expect((await lireRegle(bureau, a.id))?.purged_at ?? null).toBeNull();

    await page.getByRole('button', { name: 'Supprimer définitivement (2)' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Supprimer définitivement' }).click();
    await expect(toast(page, '2 automatisation(s) supprimée(s) définitivement')).toBeVisible();
    await expect.poll(() => nomsAffiches(page)).toEqual([]);
    for (const r of [a, b]) await attendre(async () => (await lireRegle(bureau, r.id))?.purged_at ?? null, (v) => v !== null, 10_000);
  });

  test('[LST-057] un échec dans le lot est NOMMÉ, les autres lignes sont traitées', async ({ page, bureau, marque, moniteur }) => {
    const quand = new Date().toISOString();
    const a = await creerRegle(bureau, bureau.orgA, { name: `${marque} A`, deleted_at: quand });
    const b = await creerRegle(bureau, bureau.orgA, { name: `${marque} B`, deleted_at: quand });
    moniteur.attendu(/500 POST \/api\/automations\/rules\/[0-9a-f-]+\/restaurer/, 'panne simulée sur une des deux restaurations');
    moniteur.attendu(/\[automations\] action en lot échouée/, 'journal de la panne');
    await page.route(`**/api/automations/rules/${b.id}/restaurer`, (route) => route.fulfill({
      status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Impossible de restaurer l’automatisation.' }),
    }));
    await page.goto('/automations?onglet=corbeille');
    await expect(ligne(page, a.name)).toBeVisible({ timeout: 90_000 });
    await chercher(page, marque);
    await page.getByRole('checkbox', { name: 'Tout cocher' }).check();
    await page.getByRole('button', { name: 'Restaurer (2)' }).click();
    await expect(toast(page, '1 automatisation(s) restaurée(s) en brouillon')).toBeVisible();
    await expect(toast(page, `Échec sur : ${b.name}`)).toBeVisible();
    await expect.poll(() => nomsAffiches(page)).toEqual([b.name]);
    expect((await lireRegle(bureau, a.id))?.deleted_at).toBeNull();
    expect((await lireRegle(bureau, b.id))?.deleted_at).not.toBeNull();
  });
});
