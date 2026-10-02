/**
 * LISTE — le menu ⋮ d'une ligne et la corbeille.
 *
 * Ce que ce fichier prouve :
 *  · le menu ⋮ : ses items selon la ligne (personnelle, fournie, à la
 *    corbeille), et qu'il est réellement VISIBLE, y compris sur la dernière
 *    ligne ;
 *  · « Modifier » ouvre l'éditeur ;
 *  · « Dupliquer » crée une copie en brouillon, INDÉPENDANTE de l'original
 *    (modifier, publier, renommer ou supprimer l'une ne touche pas l'autre,
 *    vérifié en base) ;
 *  · « Supprimer » : confirmation, la ligne quitte la liste, arrive à la
 *    corbeille, n'est plus active en base et ses envois prévus sont annulés ;
 *  · corbeille : « Restaurer » (revient en brouillon) et « Supprimer
 *    définitivement » (ne revient plus, l'historique reste) ;
 *  · un refus ou une panne du serveur est dit à l'écran.
 */
import { randomUUID } from 'node:crypto';
import {
  test, expect, creerRegle, lireRegle, reglesParNom, ouvrirListe, chercher, ligne, toast, onglet, nomsAffiches, boutonActions,
  interrupteur, partVisible, attendre, appelApi, creerDossierBase, amenerALEcran, ETAPES_TEXTO, CAPTURES,
} from './_aides';

const SMS = (corps: string) => ({ type: 'send_sms', config: { body: corps } });

test.describe('le menu ⋮', () => {
  test('[LST-076] le menu d’une automatisation personnelle : Modifier, Dupliquer, Déplacer dans un dossier, Supprimer', async ({ page, bureau, marque }) => {
    const r = await creerRegle(bureau, bureau.orgA, { name: `${marque} perso` });
    await ouvrirListe(page);
    await chercher(page, marque);
    const bouton = boutonActions(page, r.name);
    await expect(bouton).toHaveAttribute('aria-haspopup', 'menu');
    await expect(bouton).toHaveAttribute('aria-expanded', 'false');
    await bouton.click();
    await expect(bouton).toHaveAttribute('aria-expanded', 'true');
    // Un bureau unique : pas de « Copier vers d'autres bureaux ».
    await expect(page.getByRole('menu').getByRole('menuitem')).toHaveText(['Modifier', 'Dupliquer', 'Déplacer dans un dossier', 'Supprimer']);
    await bouton.click();
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(bouton).toHaveAttribute('aria-expanded', 'false');
  });

  test('[LST-076][LST-083] une automatisation FOURNIE ne propose pas « Supprimer »', async ({ page }) => {
    await ouvrirListe(page);
    await chercher(page, 'Anniversaire client');
    await boutonActions(page, 'Anniversaire client').click();
    await expect(page.getByRole('menu').getByRole('menuitem')).toHaveText(['Modifier', 'Dupliquer', 'Déplacer dans un dossier']);
  });

  test('[LST-076] un seul menu ⋮ ouvert à la fois', async ({ page, bureau, marque }) => {
    const a = await creerRegle(bureau, bureau.orgA, { name: `${marque} A` });
    const b = await creerRegle(bureau, bureau.orgA, { name: `${marque} B` });
    await ouvrirListe(page);
    await chercher(page, marque);
    await expect.poll(() => nomsAffiches(page)).toEqual([a.name, b.name]);
    /*
     * Le menu d'une ligne est dessiné PAR-DESSUS la page (portail, ancré sous son bouton : Automations.tsx,
     * `createPortal`) : celui de A recouvre le bouton ⋮ de B, la ligne du dessous — on ne peut plus cliquer B
     * « à travers ». On ouvre donc B (en bas), puis A (au-dessus, à découvert).
     */
    await boutonActions(page, b.name).click();
    await expect(boutonActions(page, b.name)).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('menu')).toHaveCount(1);
    await boutonActions(page, a.name).click();
    await expect(page.getByRole('menu')).toHaveCount(1);
    await expect(boutonActions(page, b.name)).toHaveAttribute('aria-expanded', 'false');
    await expect(boutonActions(page, a.name)).toHaveAttribute('aria-expanded', 'true');
    // Le menu ouvert est bien celui de A : il est ancré sous SON bouton, pas sous celui de B.
    const menu = await page.getByRole('menu').boundingBox();
    const boutonA = await boutonActions(page, a.name).boundingBox();
    const boutonB = await boutonActions(page, b.name).boundingBox();
    expect(Math.abs((menu?.y ?? 0) - ((boutonA?.y ?? 0) + (boutonA?.height ?? 0)))).toBeLessThan(12);
    expect((menu?.y ?? 0)).toBeLessThan(boutonB?.y ?? 0);
  });

  test('[LST-076] S-07 : le menu ⋮ de la DERNIÈRE ligne est entièrement visible, sans défilement caché', async ({ page, bureau, marque }) => {
    const r = await creerRegle(bureau, bureau.orgA, { name: `${marque} seule ligne` });
    await creerDossierBase(bureau, bureau.orgA, `Dossier ${randomUUID().slice(0, 6)}`);
    await ouvrirListe(page);
    await chercher(page, marque);
    await expect.poll(() => nomsAffiches(page)).toEqual([r.name]);
    await boutonActions(page, r.name).click();
    const menu = page.getByRole('menu');
    await expect(menu).toBeAttached();
    await page.screenshot({ path: `${CAPTURES}/S-07-menu-derniere-ligne.png` });
    // Le menu est rogné par la carte du tableau (overflow) : on n'en voit qu'un liseré.
    expect(await partVisible(menu), 'part visible du menu ⋮').toBeGreaterThan(0.98);
    for (const item of await menu.getByRole('menuitem').all()) {
      expect(await partVisible(item), `part visible de « ${await item.innerText()} »`).toBeGreaterThan(0.98);
    }
  });

  test('[LST-076][LST-082] S-07 : sur une liste pleine, le sous-menu des dossiers de la dernière ligne est entièrement visible', async ({ page, bureau }) => {
    for (const n of ['A', 'B', 'C']) await creerDossierBase(bureau, bureau.orgA, `Dossier ${n} ${randomUUID().slice(0, 4)}`);
    await ouvrirListe(page);
    const noms = await nomsAffiches(page);
    expect(noms).toHaveLength(10);
    const dernier = noms[noms.length - 1];
    // La dernière ligne est sous le bas de la fenêtre : on l'y amène et on laisse le défilement se terminer AVANT
    // de cliquer — sinon l'événement « scroll », émis après le clic, referme le menu à peine ouvert (voir `amenerALEcran`).
    await amenerALEcran(boutonActions(page, dernier));
    await boutonActions(page, dernier).click();
    await expect(page.getByRole('menu')).toBeVisible();
    await page.getByRole('menuitem', { name: 'Déplacer dans un dossier' }).evaluate((el) => (el as HTMLElement).click());
    const menu = page.getByRole('menu');
    await page.screenshot({ path: `${CAPTURES}/S-07-sous-menu-derniere-ligne.png` });
    for (const item of await menu.getByRole('menuitem').all()) {
      expect(await partVisible(item), `part visible de « ${await item.innerText()} »`).toBeGreaterThan(0.98);
    }
  });

  test('[LST-077] « Modifier » ouvre l’éditeur de l’automatisation', async ({ page, bureau, marque }) => {
    const r = await creerRegle(bureau, bureau.orgA, { name: `${marque} a modifier` });
    await ouvrirListe(page);
    await chercher(page, marque);
    await boutonActions(page, r.name).click();
    await page.getByRole('menuitem', { name: 'Modifier' }).click();
    await expect(page).toHaveURL(new RegExp(`/automations/${r.id}$`));
    await expect(page.getByRole('button', { name: r.name, exact: true })).toBeVisible({ timeout: 60_000 });
  });
});

test.describe('dupliquer', () => {
  test('[LST-078] « Dupliquer » crée une copie en brouillon, identique, sans toucher à l’original', async ({ page, bureau, marque }) => {
    const dossier = await creerDossierBase(bureau, bureau.orgA, `Dossier ${randomUUID().slice(0, 6)}`);
    const original = await creerRegle(bureau, bureau.orgA, {
      name: `${marque} original`, description: 'Relance après devis', is_active: true, trigger_event: 'quote.sent',
      conditions: { source: 'web' }, delay_seconds: 0, actions: [], steps: ETAPES_TEXTO, settings: { une_fois_par_client_jours: 30 }, folder_id: dossier.id,
    });
    await ouvrirListe(page);
    await chercher(page, marque);
    await boutonActions(page, original.name).click();
    await page.getByRole('menuitem', { name: 'Dupliquer' }).click();
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(toast(page, 'Copie créée — elle est en brouillon')).toBeVisible();

    // On reste sur la liste, la copie y est, en brouillon.
    await expect(page).toHaveURL(/\/automations$/);
    const nomCopie = `${original.name} (copie)`;
    await expect.poll(() => nomsAffiches(page)).toEqual([original.name, nomCopie]);
    await expect(ligne(page, nomCopie).getByRole('cell').nth(2)).toHaveText('Brouillon');
    await expect(ligne(page, original.name).getByRole('cell').nth(2)).toHaveText('Publiée');

    const [o, c] = await reglesParNom(bureau, bureau.orgA, marque);
    expect(c.id).not.toBe(o.id);
    expect(c.name).toBe(nomCopie);
    expect(c.is_active).toBe(false);
    expect(c.is_preset).toBe(false);
    expect(c.preset_key).toBeNull();
    expect(c.deleted_at).toBeNull();
    expect({ t: c.trigger_event, c: c.conditions, d: c.delay_seconds, a: c.actions, s: c.steps, r: c.settings, desc: c.description })
      .toEqual({ t: o.trigger_event, c: o.conditions, d: o.delay_seconds, a: o.actions, s: o.steps, r: o.settings, desc: o.description });
    // L'original n'a pas bougé.
    expect({ a: o.is_active, n: o.name, f: o.folder_id, m: o.updated_at }).toEqual({ a: true, n: original.name, f: dossier.id, m: original.updated_at });
  });

  test('[LST-078] la copie est INDÉPENDANTE : la publier, la renommer, changer son message ou la supprimer ne touche pas l’original (et inversement)', async ({ page, bureau, marque, jetonDe, baseURL }) => {
    const original = await creerRegle(bureau, bureau.orgA, { name: `${marque} source`, actions: [SMS('Texte de départ.')] });
    await ouvrirListe(page);
    await chercher(page, marque);
    await boutonActions(page, original.name).click();
    await page.getByRole('menuitem', { name: 'Dupliquer' }).click();
    await expect(toast(page, 'Copie créée — elle est en brouillon')).toBeVisible();
    const nomCopie = `${original.name} (copie)`;
    await expect(ligne(page, nomCopie)).toBeVisible();
    const copie = (await reglesParNom(bureau, bureau.orgA, nomCopie))[0];
    const avant = await lireRegle(bureau, original.id);

    // 1. Changer le message de la COPIE, depuis la liste.
    await page.getByRole('button', { name: `Voir les messages de ${nomCopie}` }).click();
    await page.getByRole('table').getByRole('textbox').first().fill('Texte de la copie.');
    await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await expect(toast(page, 'Message enregistré')).toBeVisible();
    // 2. Publier la COPIE.
    await interrupteur(page, nomCopie).click();
    await expect(toast(page, 'Automatisation publiée')).toBeVisible();
    // 3. Renommer la COPIE (par la route que l'éditeur utilise).
    const jeton = await jetonDe('proprioA');
    const renom = await appelApi(String(baseURL), jeton, bureau.orgA, 'PATCH', `/api/automations/rules/${copie.id}`, { name: `${marque} copie renommee` });
    expect(renom.status).toBe(200);

    const o1 = await lireRegle(bureau, original.id);
    const c1 = await lireRegle(bureau, copie.id);
    expect(c1?.actions?.[0]?.config?.body).toBe('Texte de la copie.');
    expect(c1?.is_active).toBe(true);
    expect(c1?.name).toBe(`${marque} copie renommee`);
    // L'original : rien n'a changé, pas même sa date de modification.
    expect(o1).toEqual(avant);

    // 4. Supprimer l'ORIGINAL : la copie reste là, publiée.
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Mes automatisations' })).toBeVisible({ timeout: 60_000 });
    await chercher(page, marque);
    await boutonActions(page, original.name).click();
    await page.getByRole('menuitem', { name: 'Supprimer' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Supprimer', exact: true }).click();
    await expect(toast(page, 'Automatisation mise à la corbeille')).toBeVisible();
    await expect.poll(() => nomsAffiches(page)).toEqual([`${marque} copie renommee`]);
    const c2 = await lireRegle(bureau, copie.id);
    expect({ a: c2?.is_active, d: c2?.deleted_at, b: c2?.actions?.[0]?.config?.body }).toEqual({ a: true, d: null, b: 'Texte de la copie.' });
  });

  test('[LST-078] dupliquer une automatisation FOURNIE ouvre la copie dans l’éditeur ; la copie est personnelle', async ({ page, bureau, marque }) => {
    const modele = await creerRegle(bureau, bureau.orgA, { name: `${marque} fournie`, is_preset: true, preset_key: `e2e_${randomUUID().slice(0, 8)}`, is_active: true, actions: [SMS('Bonjour.')] });
    await ouvrirListe(page);
    await chercher(page, marque);
    await boutonActions(page, modele.name).click();
    await page.getByRole('menuitem', { name: 'Dupliquer' }).click();
    await expect(toast(page, 'Copie créée — elle est en brouillon')).toBeVisible();
    const copie = await attendre(async () => (await reglesParNom(bureau, bureau.orgA, `${modele.name} (copie)`))[0], (c) => !!c, 20_000);
    await expect(page).toHaveURL(new RegExp(`/automations/${copie.id}$`));
    expect({ p: copie.is_preset, k: copie.preset_key, a: copie.is_active }).toEqual({ p: false, k: null, a: false });
    // Le modèle fourni reste publié.
    expect((await lireRegle(bureau, modele.id))?.is_active).toBe(true);
  });

  test('[LST-078] S-19 : recliquer « Dupliquer » pendant que la copie se crée n’en crée pas une seconde @defaut', async ({ page, bureau, marque }) => {
    const r = await creerRegle(bureau, bureau.orgA, { name: `${marque} une seule copie` });
    let liberer: () => void = () => undefined;
    const barriere = new Promise<void>((ok) => { liberer = ok; });
    await page.route('**/api/automations/rules/*/duplicate', async (route) => { await barriere; await route.continue(); });
    await ouvrirListe(page);
    await chercher(page, marque);
    await boutonActions(page, r.name).click();
    await page.getByRole('menuitem', { name: 'Dupliquer' }).click();
    // La roue remplace ⋮… mais le bouton reste cliquable et le menu se rouvre.
    await boutonActions(page, r.name).click();
    const encore = page.getByRole('menuitem', { name: 'Dupliquer' });
    if (await encore.isVisible().catch(() => false)) await encore.click();
    liberer();
    await expect(toast(page, 'Copie créée — elle est en brouillon').first()).toBeVisible();
    await expect(ligne(page, `${r.name} (copie)`).first()).toBeVisible();
    await expect.poll(async () => (await reglesParNom(bureau, bureau.orgA, `${r.name} (copie)`)).length, { timeout: 15_000 }).toBe(1);
    await expect(ligne(page, `${r.name} (copie)`)).toHaveCount(1);
  });

  test('[LST-078] panne du serveur : « Dupliquer » le dit, et rien n’est créé', async ({ page, bureau, marque, moniteur }) => {
    const r = await creerRegle(bureau, bureau.orgA, { name: `${marque} panne` });
    moniteur.attendu(/500 POST \/api\/automations\/rules\/[0-9a-f-]+\/duplicate/, 'panne simulée de la duplication');
    await page.route('**/api/automations/rules/*/duplicate', (route) => route.fulfill({
      status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Impossible de dupliquer l\'automatisation.' }),
    }));
    await ouvrirListe(page);
    await chercher(page, marque);
    await boutonActions(page, r.name).click();
    await page.getByRole('menuitem', { name: 'Dupliquer' }).click();
    await expect(toast(page, 'Impossible de dupliquer l\'automatisation.')).toBeVisible();
    await expect(toast(page, 'Copie créée — elle est en brouillon')).toHaveCount(0);
    expect(await reglesParNom(bureau, bureau.orgA, marque)).toHaveLength(1);
    // La ligne redevient utilisable (plus de roue à la place de ⋮).
    await boutonActions(page, r.name).click();
    await expect(page.getByRole('menuitem', { name: 'Dupliquer' })).toBeVisible();
  });

  test('[LST-078] S-17 : après « Dupliquer », la liste ne disparaît pas le temps de se recharger @defaut', async ({ page, bureau, marque }) => {
    const r = await creerRegle(bureau, bureau.orgA, { name: `${marque} clignote` });
    await ouvrirListe(page);
    await chercher(page, marque);
    await page.evaluate(() => {
      const w = window as unknown as { tableauRetire?: boolean };
      w.tableauRetire = false;
      new MutationObserver(() => { if (!document.querySelector('table')) w.tableauRetire = true; })
        .observe(document.body, { childList: true, subtree: true });
    });
    await boutonActions(page, r.name).click();
    await page.getByRole('menuitem', { name: 'Dupliquer' }).click();
    await expect(ligne(page, `${r.name} (copie)`)).toBeVisible();
    // Chaque rechargement remplace TOUT le tableau par une roue : l'écran clignote, la position de lecture est perdue.
    expect(await page.evaluate(() => (window as unknown as { tableauRetire?: boolean }).tableauRetire)).toBe(false);
  });
});

test.describe('supprimer', () => {
  test('[LST-083][LST-093] « Supprimer » demande confirmation ; « Annuler » ne supprime rien', async ({ page, bureau, marque }) => {
    const r = await creerRegle(bureau, bureau.orgA, { name: `${marque} a garder`, is_active: true });
    await ouvrirListe(page);
    await chercher(page, marque);
    await boutonActions(page, r.name).click();
    await page.getByRole('menuitem', { name: 'Supprimer' }).click();
    const dialogue = page.getByRole('dialog', { name: 'Supprimer cette automatisation ?' });
    await expect(dialogue).toContainText(`« ${r.name} » part à la corbeille : elle cesse de se déclencher et les envois déjà prévus sont annulés. Tu pourras la restaurer.`);
    await dialogue.getByRole('button', { name: 'Annuler' }).click();
    await expect(dialogue).toHaveCount(0);
    await expect(ligne(page, r.name)).toBeVisible();
    const b = await lireRegle(bureau, r.id);
    expect({ d: b?.deleted_at, a: b?.is_active }).toEqual({ d: null, a: true });
  });

  test('[LST-083][LST-094] supprimer : la ligne quitte « Toutes », arrive à la corbeille, n’est plus active, ses envois prévus sont annulés', async ({ page, bureau, marque }) => {
    const r = await creerRegle(bureau, bureau.orgA, { name: `${marque} a supprimer`, is_active: true });
    const autre = await creerRegle(bureau, bureau.orgA, { name: `${marque} voisine`, is_active: true });
    const { data: tache } = await bureau.admin.from('automation_scheduled_tasks').insert({
      org_id: bureau.orgA, automation_rule_id: r.id, entity_type: 'lead', entity_id: randomUUID(), action_config: {},
      execute_at: '2099-01-01T00:00:00Z', status: 'pending', execution_key: `e2e-${randomUUID()}`,
    }).select('id').single();
    await ouvrirListe(page);
    await chercher(page, marque);
    await expect(onglet(page, 'Corbeille')).toHaveText('Corbeille (0)');

    await boutonActions(page, r.name).click();
    await page.getByRole('menuitem', { name: 'Supprimer' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Supprimer', exact: true }).click();
    await expect(toast(page, 'Automatisation mise à la corbeille')).toBeVisible();
    await expect.poll(() => nomsAffiches(page)).toEqual([autre.name]);
    await expect(onglet(page, 'Corbeille')).toHaveText('Corbeille (1)');

    const b = await lireRegle(bureau, r.id);
    expect(b?.deleted_at).not.toBeNull();
    expect(b?.purged_at ?? null).toBeNull();
    expect(b?.is_active).toBe(false);
    const { data: t } = await bureau.admin.from('automation_scheduled_tasks').select('status, last_error').eq('id', tache?.id).single();
    expect(t).toEqual({ status: 'cancelled', last_error: 'Automatisation supprimée' });
    // La voisine n'a rien subi.
    expect((await lireRegle(bureau, autre.id))?.is_active).toBe(true);

    await onglet(page, 'Corbeille').click();
    await expect.poll(() => nomsAffiches(page)).toEqual([r.name]);
    await expect(ligne(page, r.name).getByRole('cell').nth(2)).toHaveText('Supprimée');

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Mes automatisations' })).toBeVisible({ timeout: 60_000 });
    await chercher(page, marque);
    await expect.poll(() => nomsAffiches(page)).toEqual([autre.name]);
  });

  test('[LST-083] le serveur refuse de supprimer : le message est montré et la ligne reste', async ({ page, bureau, marque, moniteur }) => {
    const r = await creerRegle(bureau, bureau.orgA, { name: `${marque} refus` });
    moniteur.attendu(/500 DELETE \/api\/automations\/rules\//, 'panne simulée de la suppression');
    await page.route('**/api/automations/rules/*', (route) => (route.request().method() === 'DELETE'
      ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Impossible d\'annuler les envois déjà prévus.' }) })
      : route.continue()));
    await ouvrirListe(page);
    await chercher(page, marque);
    await boutonActions(page, r.name).click();
    await page.getByRole('menuitem', { name: 'Supprimer' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Supprimer', exact: true }).click();
    await expect(toast(page, 'Impossible d\'annuler les envois déjà prévus.')).toBeVisible();
    await expect(toast(page, 'Automatisation mise à la corbeille')).toHaveCount(0);
    await expect(ligne(page, r.name)).toBeVisible();
    expect((await lireRegle(bureau, r.id))?.deleted_at).toBeNull();
  });
});

test.describe('corbeille', () => {
  test('[LST-076][LST-084][LST-085] à la corbeille, le menu ⋮ ne propose que « Restaurer » et « Supprimer définitivement »', async ({ page, bureau, marque }) => {
    const r = await creerRegle(bureau, bureau.orgA, { name: `${marque} jetee`, deleted_at: new Date().toISOString() });
    await page.goto('/automations?onglet=corbeille');
    await expect(ligne(page, r.name)).toBeVisible({ timeout: 90_000 });
    await boutonActions(page, r.name).click();
    await expect(page.getByRole('menu').getByRole('menuitem')).toHaveText(['Restaurer', 'Supprimer définitivement']);
  });

  test('[LST-084] « Restaurer » : la ligne quitte la corbeille et revient en BROUILLON, même si elle était publiée', async ({ page, bureau, marque }) => {
    const r = await creerRegle(bureau, bureau.orgA, { name: `${marque} a restaurer`, is_active: true, steps: ETAPES_TEXTO, actions: [] });
    await ouvrirListe(page);
    await chercher(page, marque);
    await boutonActions(page, r.name).click();
    await page.getByRole('menuitem', { name: 'Supprimer' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Supprimer', exact: true }).click();
    await expect(toast(page, 'Automatisation mise à la corbeille')).toBeVisible();

    await onglet(page, 'Corbeille').click();
    await boutonActions(page, r.name).click();
    await page.getByRole('menuitem', { name: 'Restaurer' }).click();
    await expect(toast(page, 'Automatisation restaurée — elle est en brouillon')).toBeVisible();
    await expect.poll(() => nomsAffiches(page)).toEqual([]);
    await expect(onglet(page, 'Corbeille')).toHaveText('Corbeille (0)');
    const b = await lireRegle(bureau, r.id);
    expect({ d: b?.deleted_at, a: b?.is_active }).toEqual({ d: null, a: false });

    await onglet(page, 'Toutes').click();
    await expect.poll(() => nomsAffiches(page)).toEqual([r.name]);
    await expect(ligne(page, r.name).getByRole('cell').nth(2)).toHaveText('Brouillon');
    await expect(interrupteur(page, r.name)).toBeEnabled();
  });

  test('[LST-085][LST-093][LST-094] « Supprimer définitivement » : confirmation ; la ligne disparaît partout ; l’historique d’envois est conservé', async ({ page, bureau, marque }) => {
    const r = await creerRegle(bureau, bureau.orgA, { name: `${marque} a purger`, deleted_at: new Date().toISOString() });
    await bureau.admin.from('automation_execution_logs').insert({
      org_id: bureau.orgA, automation_rule_id: r.id, trigger_event: 'lead.created', entity_type: 'lead', entity_id: randomUUID(),
      action_type: 'send_sms', result_success: true,
    });
    await page.goto('/automations?onglet=corbeille');
    await expect(ligne(page, r.name)).toBeVisible({ timeout: 90_000 });

    await boutonActions(page, r.name).click();
    await page.getByRole('menuitem', { name: 'Supprimer définitivement' }).click();
    const dialogue = page.getByRole('dialog', { name: 'Supprimer définitivement ?' });
    await expect(dialogue).toContainText(`« ${r.name} » disparaît de la corbeille et ne pourra plus être restaurée. L’historique des messages déjà envoyés est conservé.`);
    await dialogue.getByRole('button', { name: 'Annuler' }).click();
    await expect(ligne(page, r.name)).toBeVisible();
    expect((await lireRegle(bureau, r.id))?.purged_at ?? null).toBeNull();

    await boutonActions(page, r.name).click();
    await page.getByRole('menuitem', { name: 'Supprimer définitivement' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Supprimer définitivement' }).click();
    await expect(toast(page, 'Automatisation supprimée définitivement')).toBeVisible();
    await expect(page.getByText('La corbeille est vide')).toBeVisible();
    await expect(onglet(page, 'Corbeille')).toHaveText('Corbeille (0)');

    const b = await lireRegle(bureau, r.id);
    expect(b?.purged_at).not.toBeNull();
    expect(b?.is_active).toBe(false);
    const { count } = await bureau.admin.from('automation_execution_logs').select('id', { count: 'exact', head: true }).eq('automation_rule_id', r.id);
    expect(count).toBe(1);

    // Nulle part après rechargement.
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Mes automatisations' })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('tab')).toHaveCount(4);
    for (const o of ['Toutes', 'Corbeille', 'Prêtes à publier', 'À vérifier']) {
      await onglet(page, o).click();
      await chercher(page, marque);
      await expect.poll(() => nomsAffiches(page)).toEqual([]);
    }
  });

  test('[LST-070] S-06 : à la corbeille, le nom n’ouvre pas l’éditeur d’une automatisation supprimée', async ({ page, bureau, marque }) => {
    const r = await creerRegle(bureau, bureau.orgA, { name: `${marque} supprimee`, deleted_at: new Date().toISOString() });
    await page.goto('/automations?onglet=corbeille');
    await expect(ligne(page, r.name)).toBeVisible({ timeout: 90_000 });
    await ligne(page, r.name).getByRole('cell').nth(1).getByRole('button').click();
    // L'adresse de l'éditeur s'ouvre, mais PAS l'éditeur : ni canevas ni panneaux, l'écran dit où est
    // l'automatisation et offre de la restaurer (AutomationBuilderPage.tsx, « À LA CORBEILLE », #859).
    await expect(page).toHaveURL(new RegExp(`/automations/${r.id}$`));
    await expect(page.getByText('Cette automatisation est à la corbeille : elle ne se déclenche plus et ne se modifie pas.')).toBeVisible({ timeout: 60_000 });
    await page.screenshot({ path: `${CAPTURES}/S-06-editeur-automatisation-supprimee.png` });
    await expect(page.getByRole('button', { name: 'Restaurer', exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Parcours' })).toHaveCount(0);
    await expect(page.getByRole('switch')).toHaveCount(0);
  });

  test('[LST-075] S-06 : à la corbeille, les messages ne sont pas modifiables @defaut', async ({ page, bureau, marque }) => {
    const r = await creerRegle(bureau, bureau.orgA, { name: `${marque} supprimee`, deleted_at: new Date().toISOString(), actions: [SMS('Texte figé.')] });
    await page.goto('/automations?onglet=corbeille');
    await expect(ligne(page, r.name)).toBeVisible({ timeout: 90_000 });
    await page.getByRole('button', { name: `Voir les messages de ${r.name}` }).click();
    const zone = page.getByRole('table').getByRole('textbox').first();
    await expect(zone).toBeVisible();
    // Modifier le texto d'une automatisation supprimée n'a aucun sens : le champ devrait être en lecture seule.
    await expect(zone).not.toBeEditable({ timeout: 5_000 });
  });
});
