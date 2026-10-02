/**
 * LISTE — « Copier vers d'autres bureaux » (menu ⋮ et sa modale).
 *
 * L'item n'existe que pour un compte qui a un AUTRE bureau de la même
 * entreprise, avec le droit d'y modifier les automatisations. Les deux
 * bureaux de test sont donc, le temps de ces tests seulement, réunis dans la
 * même entreprise et le propriétaire de A devient administrateur de B ; tout
 * est défait à la fin de chaque test.
 *
 * Ce que ce fichier prouve :
 *  · l'item apparaît (et seulement là où il faut) et ouvre la modale ;
 *  · les cases « bureaux » et « Garder les copies à jour », « Copier »,
 *    « Annuler » / « Fermer », ×, clic sur le fond ;
 *  · la copie existe VRAIMENT dans l'autre bureau, liée ou non, publiée ou en
 *    brouillon comme l'écran le dit ;
 *  · ce que la modale fait au clavier.
 */
import {
  test as base, expect, creerRegle, lireRegle, reglesParNom, ouvrirListe, chercher, ligne, toast, boutonActions, ETAPES_TEXTO, type Bureau,
} from './_aides';

interface Reunion { defaire: () => Promise<void>; nomB: string }

/** Réunit A et B dans la même entreprise ; rend de quoi tout défaire. */
async function reunirLesBureaux(bureau: Bureau): Promise<Reunion> {
  const { data: orgs } = await bureau.admin.from('orgs').select('id, company_group_id').in('id', [bureau.orgA, bureau.orgB]);
  const groupeA = orgs?.find((o) => o.id === bureau.orgA)?.company_group_id as string | null;
  const groupeB = orgs?.find((o) => o.id === bureau.orgB)?.company_group_id as string | null;
  const { data: avant } = await bureau.admin.from('memberships').select('user_id, org_id').in('org_id', [bureau.orgA, bureau.orgB]);
  const dejaLa = new Set((avant ?? []).map((m) => `${m.user_id}|${m.org_id}`));
  const { data: reglagesB } = await bureau.admin.from('company_settings').select('company_name').eq('org_id', bureau.orgB).single();

  const defaire = async () => {
    await bureau.admin.from('orgs').update({ company_group_id: groupeB }).eq('id', bureau.orgB);
    const { data: apres } = await bureau.admin.from('memberships').select('user_id, org_id').in('org_id', [bureau.orgA, bureau.orgB]);
    for (const m of apres ?? []) {
      if (!dejaLa.has(`${m.user_id}|${m.org_id}`)) await bureau.admin.from('memberships').delete().eq('user_id', m.user_id).eq('org_id', m.org_id);
    }
  };
  try {
    const { error: e1 } = await bureau.admin.from('orgs').update({ company_group_id: groupeA }).eq('id', bureau.orgB);
    if (e1) throw new Error(`réunir les bureaux : ${e1.message}`);
    const { error: e2 } = await bureau.admin.from('memberships')
      .upsert({ user_id: bureau.comptes.proprioA.id, org_id: bureau.orgB, role: 'admin', status: 'active', full_name: 'QA Proprio A' }, { onConflict: 'user_id,org_id' });
    if (e2) throw new Error(`adhésion au second bureau : ${e2.message}`);
  } catch (e) {
    await defaire();
    throw e;
  }
  return { defaire, nomB: String(reglagesB?.company_name ?? '') };
}

const test = base.extend<{ reunion: Reunion }>({
  reunion: async ({ bureau }, use) => {
    const r = await reunirLesBureaux(bureau);
    try { await use(r); } finally { await r.defaire(); }
  },
});

async function ouvrirModale(page: import('@playwright/test').Page, nom: string) {
  await boutonActions(page, nom).click();
  await page.getByRole('menuitem', { name: 'Copier vers d’autres bureaux' }).click();
  const modale = page.getByRole('dialog', { name: 'Copier vers d’autres bureaux' });
  await expect(modale).toBeVisible();
  return modale;
}

test.describe('copier vers d’autres bureaux', () => {
  test('[LST-079] l’item apparaît pour une automatisation vivante, pas à la corbeille, et ouvre la modale', async ({ page, bureau, marque, reunion }) => {
    const r = await creerRegle(bureau, bureau.orgA, { name: `${marque} a copier` });
    const jetee = await creerRegle(bureau, bureau.orgA, { name: `${marque} jetee`, deleted_at: new Date().toISOString() });
    await ouvrirListe(page);
    await chercher(page, marque);
    await boutonActions(page, r.name).click();
    await expect(page.getByRole('menu').getByRole('menuitem')).toHaveText(['Modifier', 'Dupliquer', 'Copier vers d’autres bureaux', 'Déplacer dans un dossier', 'Supprimer']);
    await page.getByRole('menuitem', { name: 'Copier vers d’autres bureaux' }).click();
    await expect(page.getByRole('menu')).toHaveCount(0);
    const modale = page.getByRole('dialog', { name: 'Copier vers d’autres bureaux' });
    await expect(modale).toContainText(`« ${r.name} » : chaque copie envoie depuis le numéro et le courriel de son bureau.`);
    // Le bureau cible, par son nom d'entreprise ; coché d'office, copie liée d'office.
    await expect(modale.getByRole('group', { name: 'Bureaux' }).getByRole('checkbox')).toHaveCount(1);
    await expect(modale.getByRole('checkbox', { name: reunion.nomB })).toBeChecked();
    await expect(modale.getByRole('checkbox', { name: /Garder les copies à jour/ })).toBeChecked();
    await expect(modale).toContainText('Modifier celle-ci modifiera ses copies. Modifier une copie la détache.');
    await modale.getByRole('button', { name: 'Annuler' }).click();
    await expect(modale).toHaveCount(0);

    await page.goto('/automations?onglet=corbeille');
    await expect(ligne(page, jetee.name)).toBeVisible({ timeout: 90_000 });
    await boutonActions(page, jetee.name).click();
    await expect(page.getByRole('menuitem', { name: 'Copier vers d’autres bureaux' })).toHaveCount(0);
  });

  test('[LST-102][LST-098][LST-099] « Annuler », × et le fond ferment la modale sans rien copier', async ({ page, bureau, marque, reunion }) => {
    void reunion;
    const r = await creerRegle(bureau, bureau.orgA, { name: `${marque} pas copiee` });
    await ouvrirListe(page);
    await chercher(page, marque);
    let modale = await ouvrirModale(page, r.name);
    await modale.getByRole('button', { name: 'Annuler' }).click();
    await expect(modale).toHaveCount(0);
    modale = await ouvrirModale(page, r.name);
    await modale.getByRole('button', { name: 'Fermer' }).click();
    await expect(modale).toHaveCount(0);
    modale = await ouvrirModale(page, r.name);
    // Un clic dans la carte ne ferme pas ; un clic sur le fond, si.
    await modale.getByRole('heading').click();
    await expect(modale).toBeVisible();
    await page.mouse.click(20, 20);
    await expect(modale).toHaveCount(0);
    expect(await reglesParNom(bureau, bureau.orgB, marque)).toHaveLength(0);
  });

  test('[LST-100][LST-103] sans bureau coché, « Copier » est désactivé', async ({ page, bureau, marque, reunion }) => {
    const r = await creerRegle(bureau, bureau.orgA, { name: `${marque} cases` });
    await ouvrirListe(page);
    await chercher(page, marque);
    const modale = await ouvrirModale(page, r.name);
    const copier = modale.getByRole('button', { name: 'Copier', exact: true });
    await expect(copier).toBeEnabled();
    await modale.getByRole('checkbox', { name: reunion.nomB }).uncheck();
    await expect(copier).toBeDisabled();
    await modale.getByRole('checkbox', { name: reunion.nomB }).check();
    await expect(copier).toBeEnabled();
    await modale.getByRole('button', { name: 'Annuler' }).click();
  });

  test('[LST-101][LST-103] copie LIÉE d’un brouillon : « Copiée en brouillon », la copie existe dans l’autre bureau et suit l’original', async ({ page, bureau, marque, reunion, autreOnglet }) => {
    const r = await creerRegle(bureau, bureau.orgA, { name: `${marque} liee`, steps: ETAPES_TEXTO, actions: [], trigger_event: 'quote.sent' });
    await ouvrirListe(page);
    await chercher(page, marque);
    const modale = await ouvrirModale(page, r.name);
    await modale.getByRole('button', { name: 'Copier', exact: true }).click();
    const resultat = modale.getByRole('listitem');
    await expect(resultat).toHaveCount(1);
    await expect(resultat).toContainText(reunion.nomB);
    await expect(resultat).toContainText('Copiée en brouillon');
    // Après la copie : plus de « Copier », « Annuler » devient « Fermer ».
    await expect(modale.getByRole('button', { name: 'Copier', exact: true })).toHaveCount(0);
    await modale.getByRole('button', { name: 'Fermer' }).last().click();
    await expect(modale).toHaveCount(0);

    const copies = await reglesParNom(bureau, bureau.orgB, marque);
    expect(copies).toHaveLength(1);
    expect({ n: copies[0].name, a: copies[0].is_active, m: copies[0].modele_id, t: copies[0].trigger_event, s: copies[0].steps, p: copies[0].is_preset })
      .toEqual({ n: r.name, a: false, m: r.id, t: 'quote.sent', s: r.steps, p: false });
    // L'original n'est ni lié ni modifié.
    const o = await lireRegle(bureau, r.id);
    expect({ m: o?.modele_id ?? null, a: o?.is_active }).toEqual({ m: null, a: false });

    // Dans l'autre bureau, la copie se présente comme telle.
    const b = await autreOnglet({ compte: 'proprioB' });
    await b.page.goto('/automations');
    await expect(b.page.getByRole('heading', { name: 'Mes automatisations' })).toBeVisible({ timeout: 90_000 });
    await chercher(b.page, marque);
    await expect(ligne(b.page, r.name)).toContainText('Copie liée à un autre bureau');
    await expect(ligne(b.page, r.name).getByRole('cell').nth(2)).toHaveText('Brouillon');
  });

  test('[LST-103] copie d’une automatisation PUBLIÉE : « Copiée et publiée », active dans l’autre bureau', async ({ page, bureau, marque, reunion }) => {
    const r = await creerRegle(bureau, bureau.orgA, { name: `${marque} publiee`, steps: ETAPES_TEXTO, actions: [], is_active: true });
    await ouvrirListe(page);
    await chercher(page, marque);
    const modale = await ouvrirModale(page, r.name);
    await modale.getByRole('button', { name: 'Copier', exact: true }).click();
    await expect(modale.getByRole('listitem')).toContainText('Copiée et publiée');
    await expect(modale.getByRole('listitem')).toContainText(reunion.nomB);
    const copies = await reglesParNom(bureau, bureau.orgB, marque);
    expect(copies.map((c) => ({ a: c.is_active, m: c.modele_id }))).toEqual([{ a: true, m: r.id }]);
    await modale.getByRole('button', { name: 'Fermer' }).last().click();
  });

  test('[LST-101][LST-103] copie NON liée, puis recopie : « Existe déjà (non modifiée) » ; recopie liée : « Déjà là : mise à jour et liée »', async ({ page, bureau, marque, reunion }) => {
    void reunion;
    const r = await creerRegle(bureau, bureau.orgA, { name: `${marque} libre`, steps: ETAPES_TEXTO, actions: [] });
    await ouvrirListe(page);
    await chercher(page, marque);

    let modale = await ouvrirModale(page, r.name);
    await modale.getByRole('checkbox', { name: /Garder les copies à jour/ }).uncheck();
    await modale.getByRole('button', { name: 'Copier', exact: true }).click();
    await expect(modale.getByRole('listitem')).toContainText('Copiée en brouillon');
    await modale.getByRole('button', { name: 'Fermer' }).last().click();
    let copies = await reglesParNom(bureau, bureau.orgB, marque);
    expect(copies.map((c) => c.modele_id ?? null)).toEqual([null]);

    modale = await ouvrirModale(page, r.name);
    await modale.getByRole('checkbox', { name: /Garder les copies à jour/ }).uncheck();
    await modale.getByRole('button', { name: 'Copier', exact: true }).click();
    await expect(modale.getByRole('listitem')).toContainText('Existe déjà (non modifiée)');
    await modale.getByRole('button', { name: 'Fermer' }).last().click();
    expect(await reglesParNom(bureau, bureau.orgB, marque)).toHaveLength(1);

    modale = await ouvrirModale(page, r.name);
    await modale.getByRole('button', { name: 'Copier', exact: true }).click();
    await expect(modale.getByRole('listitem')).toContainText('Déjà là : mise à jour et liée');
    await modale.getByRole('button', { name: 'Fermer' }).last().click();
    copies = await reglesParNom(bureau, bureau.orgB, marque);
    expect(copies.map((c) => c.modele_id ?? null)).toEqual([r.id]);
  });

  test('[LST-103] panne du serveur : le message est montré, la modale reste sur le formulaire', async ({ page, bureau, marque, reunion, moniteur }) => {
    void reunion;
    const r = await creerRegle(bureau, bureau.orgA, { name: `${marque} panne` });
    moniteur.attendu(/500 POST \/api\/automations\/rules\/[0-9a-f-]+\/copier-bureaux/, 'panne simulée de la copie');
    moniteur.attendu(/copie vers bureaux échouée/, 'journal de la panne');
    await page.route('**/api/automations/rules/*/copier-bureaux', (route) => route.fulfill({
      status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Impossible de copier l’automatisation.' }),
    }));
    await ouvrirListe(page);
    await chercher(page, marque);
    const modale = await ouvrirModale(page, r.name);
    await modale.getByRole('button', { name: 'Copier', exact: true }).click();
    await expect(toast(page, 'Impossible de copier l’automatisation.')).toBeVisible();
    await expect(modale.getByRole('button', { name: 'Copier', exact: true })).toBeEnabled();
    await expect(modale.getByRole('listitem')).toHaveCount(0);
    expect(await reglesParNom(bureau, bureau.orgB, marque)).toHaveLength(0);
    await modale.getByRole('button', { name: 'Annuler' }).click();
  });

  test('[LST-098] S-11 : Échap ferme la modale @defaut', async ({ page, bureau, marque, reunion }) => {
    void reunion;
    const r = await creerRegle(bureau, bureau.orgA, { name: `${marque} echap` });
    await ouvrirListe(page);
    await chercher(page, marque);
    const modale = await ouvrirModale(page, r.name);
    await page.keyboard.press('Escape');
    await expect(modale).toHaveCount(0, { timeout: 5_000 });
  });

  test('[LST-100] S-11 : à l’ouverture, le focus est dans la modale @defaut', async ({ page, bureau, marque, reunion }) => {
    void reunion;
    const r = await creerRegle(bureau, bureau.orgA, { name: `${marque} focus` });
    await ouvrirListe(page);
    await chercher(page, marque);
    const modale = await ouvrirModale(page, r.name);
    // Le focus reste derrière, sur la page : au clavier, on tabule dans la liste, pas dans la fenêtre.
    await expect.poll(() => modale.evaluate((d) => d.contains(document.activeElement)), { timeout: 5_000 }).toBe(true);
  });

  test('[LST-099][LST-103] S-11 : pendant la copie, la modale ne se ferme pas par mégarde (le résultat serait perdu) @defaut', async ({ page, bureau, marque, reunion }) => {
    void reunion;
    const r = await creerRegle(bureau, bureau.orgA, { name: `${marque} en vol`, steps: ETAPES_TEXTO, actions: [] });
    let liberer: () => void = () => undefined;
    const barriere = new Promise<void>((ok) => { liberer = ok; });
    await page.route('**/api/automations/rules/*/copier-bureaux', async (route) => { await barriere; await route.continue(); });
    await ouvrirListe(page);
    await chercher(page, marque);
    const modale = await ouvrirModale(page, r.name);
    await modale.getByRole('button', { name: 'Copier', exact: true }).click();
    await expect(modale.getByRole('button', { name: 'Copier', exact: true })).toBeDisabled();
    try {
      // La copie est partie ; un clic sur le fond ferme tout, et le compte rendu par bureau ne sera jamais vu.
      await page.mouse.click(20, 20);
      await expect(modale).toBeVisible({ timeout: 3_000 });
    } finally {
      liberer();
      await expect.poll(async () => (await reglesParNom(bureau, bureau.orgB, marque)).length).toBe(1);
    }
  });
});

base.describe('un seul bureau', () => {
  base('[LST-079] sans autre bureau de la même entreprise, l’item « Copier vers d’autres bureaux » n’existe pas', async ({ page, bureau, marque }) => {
    const r = await creerRegle(bureau, bureau.orgA, { name: `${marque} seul` });
    const reponse = page.waitForResponse((x) => x.url().endsWith('/api/automations/bureaux-cibles'));
    await ouvrirListe(page);
    expect(((await (await reponse).json()) as { offices: unknown[] }).offices).toEqual([]);
    await chercher(page, marque);
    await boutonActions(page, r.name).click();
    await expect(page.getByRole('menuitem', { name: 'Dupliquer' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Copier vers d’autres bureaux' })).toHaveCount(0);
  });
});
