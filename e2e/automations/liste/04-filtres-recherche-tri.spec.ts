/**
 * LISTE — recherche, filtres avancés et tris.
 *
 * Ce que ce fichier prouve :
 *  · la recherche : par nom affiché, sans tenir compte de la casse ; ce
 *    qu'elle fait des accents, des espaces et de la description ;
 *  · « Filtres avancés » : catégorie (chaque option), statut (chaque option),
 *    « Trier » (chaque option), et ce qui reste appliqué panneau fermé ;
 *  · le tri par chaque colonne : l'ordre est réellement le bon (accents,
 *    nombres, dates, chiffres), dans les deux sens, avec `aria-sort`.
 *
 * Les valeurs triées sont relues en base (dates, statut, déclenchements).
 */
import { randomUUID } from 'node:crypto';
import {
  test, expect, creerRegle, ouvrirListe, chercher, champRecherche, ligne, nomsAffiches, onglet, reglesAffichables, type Bureau,
} from './_aides';

/** Les préréglages de chaque catégorie (clé `preset_key`), tels que le produit les range. */
const CATEGORIES: Array<{ valeur: string; libelle: string; cles: string[] }> = [
  { valeur: 'Leads', libelle: 'Leads', cles: ['welcome_new_lead', 'lead_followup_1d', 'lead_followup_3d', 'stale_lead_7d', 'lead_followup_14d', 'lost_lead_reengagement'] },
  { valeur: 'Quotes', libelle: 'Devis', cles: ['quote_opened_notify', 'quote_opened_move_deal', 'quote_sent_move_deal', 'quote_approved_move_deal', 'quote_followup_1d', 'quote_followup_3d', 'quote_followup_7d', 'quote_followup_14d', 'quote_followup_21d', 'estimate_followup'] },
  { valeur: 'Jobs', libelle: 'Jobs et rendez-vous', cles: ['job_reminder_7d', 'job_reminder_1d', 'job_reminder_2h', 'appointment_confirmation', 'agreement_signed', 'no_show_followup'] },
  { valeur: 'Invoices', libelle: 'Factures', cles: ['invoice_sent_reminder_1d', 'invoice_sent_reminder_3d', 'invoice_sent_reminder_7d', 'invoice_sent_reminder_14d', 'invoice_sent_reminder_30d'] },
  { valeur: 'Payments', libelle: 'Paiements', cles: ['payment_confirmation', 'deposit_received', 'deposit_reminder', 'deposit_followup_2d'] },
  { valeur: 'Follow-up', libelle: 'Suivi', cles: ['thank_you_after_job', 'cross_sell_30d', 'reengagement_90d', 'post_appointment_survey'] },
  { valeur: 'Reviews', libelle: 'Avis', cles: ['google_review', 'review_reminder_7d'] },
  { valeur: 'Client', libelle: 'Engagement client', cles: ['client_anniversary', 'seasonal_reminder_6m'] },
];

async function voirTout(page: import('@playwright/test').Page): Promise<void> {
  await page.getByRole('combobox', { name: 'Lignes par page' }).selectOption('50');
}

async function ouvrirFiltres(page: import('@playwright/test').Page): Promise<void> {
  const bouton = page.getByRole('button', { name: 'Filtres avancés' });
  if ((await bouton.getAttribute('aria-expanded')) !== 'true') await bouton.click();
  await expect(page.getByRole('combobox', { name: 'Catégorie' })).toBeVisible();
}

async function declencher(bureau: Bureau, org: string, ruleId: string, fois: number): Promise<void> {
  const lignes = Array.from({ length: fois }, () => ({
    org_id: org, automation_rule_id: ruleId, trigger_event: 'lead.created', entity_type: 'lead', entity_id: randomUUID(),
    action_type: 'log_activity', result_success: true,
  }));
  const { error } = await bureau.admin.from('automation_execution_logs').insert(lignes);
  if (error) throw new Error(`declencher : ${error.message}`);
}

async function mettreEnAttente(bureau: Bureau, org: string, ruleId: string, fois: number): Promise<void> {
  // Des étapes « en attente » très loin dans le futur, sur une règle qui n'envoie rien : rien ne partira.
  const lignes = Array.from({ length: fois }, () => ({
    org_id: org, automation_rule_id: ruleId, entity_type: 'lead', entity_id: randomUUID(), action_config: {},
    execute_at: '2099-01-01T00:00:00Z', status: 'pending', execution_key: `e2e-${randomUUID()}`,
  }));
  const { error } = await bureau.admin.from('automation_scheduled_tasks').insert(lignes);
  if (error) throw new Error(`mettreEnAttente : ${error.message}`);
}

test.describe('recherche', () => {
  test('[LST-035] la recherche filtre par nom, sans tenir compte de la casse, et se vide', async ({ page, bureau, marque }) => {
    await creerRegle(bureau, bureau.orgA, { name: `${marque} Relance devis` });
    await creerRegle(bureau, bureau.orgA, { name: `${marque} Merci après visite` });
    await ouvrirListe(page);
    await chercher(page, marque);
    await expect.poll(() => nomsAffiches(page)).toEqual([`${marque} Merci après visite`, `${marque} Relance devis`]);
    await chercher(page, `${marque} RELANCE`.toUpperCase());
    await expect.poll(() => nomsAffiches(page)).toEqual([`${marque} Relance devis`]);
    await chercher(page, 'après visite');
    await expect.poll(() => nomsAffiches(page)).toEqual([`${marque} Merci après visite`]);
    await chercher(page, '');
    await expect.poll(async () => (await nomsAffiches(page)).length).toBe(10);
  });

  test('[LST-035] la recherche porte sur le nom AFFICHÉ (français) des automatisations fournies', async ({ page, bureau }) => {
    const { data } = await bureau.admin.from('automation_rules').select('name').eq('org_id', bureau.orgA).eq('preset_key', 'welcome_new_lead').single();
    await ouvrirListe(page);
    await voirTout(page);
    const affiches = await nomsAffiches(page);
    // Le nom stocké est anglais ; l'écran en montre la traduction.
    expect(affiches).not.toContain(data?.name);
    const nomFr = affiches.find((n) => /bienvenue/i.test(n));
    expect(nomFr, 'le préréglage de bienvenue est affiché en français').toBeTruthy();
    await chercher(page, String(nomFr));
    await expect.poll(() => nomsAffiches(page)).toEqual([nomFr]);
  });

  test('[LST-035] la recherche reste appliquée en changeant d’onglet', async ({ page, bureau, marque }) => {
    await creerRegle(bureau, bureau.orgA, { name: `${marque} vivante` });
    await creerRegle(bureau, bureau.orgA, { name: `${marque} jetee`, deleted_at: new Date().toISOString() });
    await ouvrirListe(page);
    await chercher(page, `${marque} `);
    await expect.poll(() => nomsAffiches(page)).toEqual([`${marque} vivante`]);
    await onglet(page, 'Corbeille').click();
    await expect(champRecherche(page)).toHaveValue(`${marque} `);
    await expect.poll(() => nomsAffiches(page)).toEqual([`${marque} jetee`]);
  });

  test('[LST-035] la recherche ignore les accents (« elan » trouve « Élan ») @defaut', async ({ page, bureau, marque }) => {
    await creerRegle(bureau, bureau.orgA, { name: `${marque} Élan d’été` });
    await ouvrirListe(page);
    await chercher(page, `${marque} elan d’ete`);
    await expect.poll(() => nomsAffiches(page), { timeout: 5_000 }).toEqual([`${marque} Élan d’été`]);
  });

  test('[LST-035] la recherche ignore les espaces en trop autour du texte @defaut', async ({ page, bureau, marque }) => {
    await creerRegle(bureau, bureau.orgA, { name: `${marque} Relance` });
    await ouvrirListe(page);
    await chercher(page, `  ${marque} Relance  `);
    await expect.poll(() => nomsAffiches(page), { timeout: 5_000 }).toEqual([`${marque} Relance`]);
  });

  test('[LST-035] S-41 : une ligne trouvée par la recherche montre le mot cherché @defaut', async ({ page, bureau, marque }) => {
    const mot = `motcache${Date.now()}`;
    await creerRegle(bureau, bureau.orgA, { name: `${marque} sans rapport`, description: `Description interne ${mot}` });
    await ouvrirListe(page);
    await chercher(page, mot);
    // La recherche fouille aussi la description, que la liste n'affiche nulle part.
    await expect.poll(() => nomsAffiches(page)).toEqual([`${marque} sans rapport`]);
    await expect(ligne(page, `${marque} sans rapport`)).toContainText(mot, { timeout: 5_000 });
  });

  test('[LST-035] S-41 : la recherche trouve aussi par le déclencheur affiché sous le nom @defaut', async ({ page, bureau, marque }) => {
    await creerRegle(bureau, bureau.orgA, { name: `${marque} x`, trigger_event: 'invoice.paid' });
    await ouvrirListe(page);
    await chercher(page, marque);
    await expect(ligne(page, `${marque} x`)).toContainText('Facture payée');
    // « Facture payée » est écrit sous le nom de la ligne ; le chercher ne la trouve pas.
    await chercher(page, 'Facture payée');
    await voirTout(page);
    await expect.poll(() => nomsAffiches(page), { timeout: 5_000 }).toContain(`${marque} x`);
  });
});

test.describe('filtres avancés', () => {
  test('[LST-034] « Filtres avancés » ouvre et referme le panneau ; les filtres restent appliqués panneau fermé', async ({ page, bureau, marque }) => {
    await creerRegle(bureau, bureau.orgA, { name: `${marque} publiee`, is_active: true });
    await creerRegle(bureau, bureau.orgA, { name: `${marque} brouillon` });
    await ouvrirListe(page);
    await chercher(page, marque);
    const bouton = page.getByRole('button', { name: 'Filtres avancés' });
    await expect(bouton).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('combobox', { name: 'Catégorie' })).toHaveCount(0);
    await bouton.click();
    await expect(bouton).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('combobox', { name: 'Catégorie' })).toHaveValue('all');
    await expect(page.getByRole('combobox', { name: 'Statut' })).toHaveValue('all');
    await expect(page.getByRole('combobox', { name: 'Trier' })).toHaveValue('defaut');

    await page.getByRole('combobox', { name: 'Statut' }).selectOption({ label: 'Brouillon' });
    await expect.poll(() => nomsAffiches(page)).toEqual([`${marque} brouillon`]);
    await bouton.click();
    await expect(page.getByRole('combobox', { name: 'Statut' })).toHaveCount(0);
    await expect.poll(() => nomsAffiches(page)).toEqual([`${marque} brouillon`]);
    // Rouvert, le panneau montre toujours le filtre en place.
    await bouton.click();
    await expect(page.getByRole('combobox', { name: 'Statut' })).toHaveValue('brouillon');
  });

  test('[LST-034] S-40 : panneau fermé, le bouton signale qu’un filtre est actif @defaut', async ({ page }) => {
    await ouvrirListe(page);
    const bouton = page.getByRole('button', { name: /Filtres avancés/ });
    await bouton.click();
    await page.getByRole('combobox', { name: 'Statut' }).selectOption({ label: 'Brouillon' });
    await bouton.click();
    await expect(page.getByText('Aucune automatisation')).toBeVisible();
    // La liste est vide à cause d'un filtre invisible : rien ne le rappelle.
    await expect(bouton).toHaveText(/Filtres avancés\s*\(?1\)?|1 filtre/, { timeout: 5_000 });
  });

  test('[LST-036][LST-037][LST-038][LST-039][LST-040][LST-041][LST-042][LST-043][LST-044][LST-045] catégorie : les options, et chacune ne montre que ses automatisations', async ({ page, bureau }) => {
    // Lu en base à l'instant, sans le préréglage retiré de l'affichage (`estimate_followup` sur `estimate.sent`,
    // commit 098dd153) : il est toujours en base, publié, mais la liste ne le montre plus.
    const vivantes = (await reglesAffichables(bureau, bureau.orgA)).filter((r) => !r.deleted_at);
    const cles = new Set(vivantes.filter((r) => r.is_preset && r.is_active).map((p) => String(p.preset_key)));
    const perso = vivantes.filter((r) => !r.is_preset).length;
    const { data: retire } = await bureau.admin.from('automation_rules').select('name')
      .eq('org_id', bureau.orgA).eq('preset_key', 'estimate_followup').eq('trigger_event', 'estimate.sent').is('deleted_at', null);

    await ouvrirListe(page);
    await voirTout(page);
    const total = (await nomsAffiches(page)).length;
    // « Toutes » = ce que la base porte de vivant, publié ou personnel — et rien d'autre.
    expect(total).toBe(cles.size + perso);
    expect(cles.has('estimate_followup'), 'le préréglage retiré n’est pas compté').toBe(false);
    for (const r of retire ?? []) expect(await nomsAffiches(page)).not.toContain(r.name);
    await ouvrirFiltres(page);
    const categorie = page.getByRole('combobox', { name: 'Catégorie' });
    await expect(categorie.getByRole('option')).toHaveText(['Toutes', ...CATEGORIES.map((c) => c.libelle)]);

    let somme = 0;
    for (const c of CATEGORIES) {
      await categorie.selectOption({ label: c.libelle });
      await expect(categorie).toHaveValue(c.valeur);
      const attendu = c.cles.filter((k) => cles.has(k)).length + (c.valeur === 'Follow-up' ? perso : 0);
      await expect.poll(async () => (await nomsAffiches(page)).length, { message: `catégorie ${c.libelle}` }).toBe(attendu);
      somme += attendu;
    }
    // Chaque automatisation est dans UNE catégorie : la somme redonne le tout.
    expect(somme).toBe(total);
    await categorie.selectOption({ label: 'Toutes' });
    await expect.poll(async () => (await nomsAffiches(page)).length).toBe(total);
  });

  test('[LST-039][LST-043] S-39 : une automatisation de devis créée par l’utilisateur est rangée dans « Devis », pas dans « Suivi » @defaut', async ({ page, bureau, marque }) => {
    await creerRegle(bureau, bureau.orgA, { name: `${marque} relance de devis maison`, trigger_event: 'quote.sent' });
    await ouvrirListe(page);
    await chercher(page, marque);
    await expect(ligne(page, `${marque} relance de devis maison`)).toContainText('Devis envoyé');
    await ouvrirFiltres(page);
    await page.getByRole('combobox', { name: 'Catégorie' }).selectOption({ label: 'Devis' });
    await expect.poll(() => nomsAffiches(page), { timeout: 5_000 }).toEqual([`${marque} relance de devis maison`]);
  });

  test('[LST-046][LST-047][LST-048][LST-049] statut : Tous / Publiée / Brouillon, recoupé en base', async ({ page, bureau, marque }) => {
    const publiee = await creerRegle(bureau, bureau.orgA, { name: `${marque} A publiee`, is_active: true });
    const brouillon = await creerRegle(bureau, bureau.orgA, { name: `${marque} B brouillon`, is_active: false });
    await ouvrirListe(page);
    await chercher(page, marque);
    await ouvrirFiltres(page);
    const statut = page.getByRole('combobox', { name: 'Statut' });
    await expect(statut.getByRole('option')).toHaveText(['Tous', 'Publiée', 'Brouillon']);

    await statut.selectOption({ label: 'Publiée' });
    await expect.poll(() => nomsAffiches(page)).toEqual([publiee.name]);
    await expect(ligne(page, publiee.name).getByText('Publiée', { exact: true })).toBeVisible();
    await statut.selectOption({ label: 'Brouillon' });
    await expect.poll(() => nomsAffiches(page)).toEqual([brouillon.name]);
    await expect(ligne(page, brouillon.name).getByText('Brouillon', { exact: true })).toBeVisible();
    await statut.selectOption({ label: 'Tous' });
    await expect.poll(() => nomsAffiches(page)).toEqual([publiee.name, brouillon.name]);

    // Sans recherche : « Publiée » = exactement les règles vivantes actives du bureau (hors modèles dépubliés).
    await chercher(page, '');
    await voirTout(page);
    await statut.selectOption({ label: 'Publiée' });
    // Lu en base à l'instant ; le préréglage retiré de l'affichage (098dd153) est publié en base mais n'est pas montré.
    const publiees = (await reglesAffichables(bureau, bureau.orgA)).filter((r) => r.is_active && !r.deleted_at);
    expect(publiees.length).toBeGreaterThan(10);
    await expect.poll(async () => (await nomsAffiches(page)).length).toBe(publiees.length);
  });

  test('[LST-050][LST-051][LST-052][LST-053] « Trier » : par défaut, plus récentes, plus anciennes', async ({ page, bureau, marque }) => {
    await creerRegle(bureau, bureau.orgA, { name: `${marque} B milieu`, created_at: '2026-03-10T15:00:00Z' });
    await creerRegle(bureau, bureau.orgA, { name: `${marque} A recente`, created_at: '2026-06-20T15:00:00Z' });
    await creerRegle(bureau, bureau.orgA, { name: `${marque} C ancienne`, created_at: '2025-12-01T15:00:00Z' });
    await ouvrirListe(page);
    await chercher(page, marque);
    await ouvrirFiltres(page);
    const trier = page.getByRole('combobox', { name: 'Trier' });
    await expect(trier.getByRole('option')).toHaveText(['Ordre par défaut', 'Créées le plus récemment', 'Créées le plus anciennement']);
    await expect.poll(() => nomsAffiches(page)).toEqual([`${marque} A recente`, `${marque} B milieu`, `${marque} C ancienne`]);
    await trier.selectOption({ label: 'Créées le plus récemment' });
    await expect.poll(() => nomsAffiches(page)).toEqual([`${marque} A recente`, `${marque} B milieu`, `${marque} C ancienne`]);
    await trier.selectOption({ label: 'Créées le plus anciennement' });
    await expect.poll(() => nomsAffiches(page)).toEqual([`${marque} C ancienne`, `${marque} B milieu`, `${marque} A recente`]);
    await trier.selectOption({ label: 'Ordre par défaut' });
    await expect.poll(() => nomsAffiches(page)).toEqual([`${marque} A recente`, `${marque} B milieu`, `${marque} C ancienne`]);
    // Les dates affichées sont celles de la base.
    await expect(ligne(page, `${marque} C ancienne`)).toContainText('1 déc. 2025');
    await expect(ligne(page, `${marque} A recente`)).toContainText('20 juin 2026');
  });

  test('[LST-050][LST-062] S-42 : après un clic sur un en-tête, « Trier » ne prétend plus imposer son ordre @defaut', async ({ page, bureau, marque }) => {
    await creerRegle(bureau, bureau.orgA, { name: `${marque} A`, created_at: '2025-01-01T15:00:00Z' });
    await creerRegle(bureau, bureau.orgA, { name: `${marque} B`, created_at: '2026-01-01T15:00:00Z' });
    await ouvrirListe(page);
    await chercher(page, marque);
    await ouvrirFiltres(page);
    const trier = page.getByRole('combobox', { name: 'Trier' });
    await trier.selectOption({ label: 'Créées le plus récemment' });
    await expect.poll(() => nomsAffiches(page)).toEqual([`${marque} B`, `${marque} A`]);
    await page.getByRole('columnheader', { name: 'Nom' }).getByRole('button').click();
    await expect.poll(() => nomsAffiches(page)).toEqual([`${marque} A`, `${marque} B`]);
    // La liste est triée par nom, mais le menu affiche toujours « Créées le plus récemment ».
    await expect(trier).not.toHaveValue('recent', { timeout: 5_000 });
  });
});

test.describe('tri par colonne', () => {
  test('[LST-062] Nom : ordre alphabétique français (accents, majuscules), puis inverse, avec aria-sort', async ({ page, bureau, marque }) => {
    for (const n of ['Zèbre', 'élan', 'Eau', 'abeille', 'Écho']) await creerRegle(bureau, bureau.orgA, { name: `${marque} ${n}` });
    await ouvrirListe(page);
    await chercher(page, marque);
    const entete = page.getByRole('columnheader', { name: 'Nom' });
    await expect(entete).toHaveAttribute('aria-sort', 'none');
    await entete.getByRole('button').click();
    await expect(entete).toHaveAttribute('aria-sort', 'ascending');
    await expect.poll(() => nomsAffiches(page)).toEqual(['abeille', 'Eau', 'Écho', 'élan', 'Zèbre'].map((n) => `${marque} ${n}`));
    await entete.getByRole('button').click();
    await expect(entete).toHaveAttribute('aria-sort', 'descending');
    await expect.poll(() => nomsAffiches(page)).toEqual(['Zèbre', 'élan', 'Écho', 'Eau', 'abeille'].map((n) => `${marque} ${n}`));
    // Un seul en-tête porte le tri.
    await expect(page.locator('th[aria-sort="ascending"], th[aria-sort="descending"]')).toHaveCount(1);
  });

  test('[LST-062] Nom : les nombres sont triés comme des nombres (2 avant 10)', async ({ page, bureau, marque }) => {
    for (const n of ['10 relances', '2 relances', '1 relance']) await creerRegle(bureau, bureau.orgA, { name: `${marque} ${n}` });
    await ouvrirListe(page);
    await chercher(page, marque);
    await page.getByRole('columnheader', { name: 'Nom' }).getByRole('button').click();
    await expect.poll(() => nomsAffiches(page), { timeout: 5_000 }).toEqual(['1 relance', '2 relances', '10 relances'].map((n) => `${marque} ${n}`));
  });

  test('[LST-062][LST-051] sans tri choisi, la liste est dans l’ordre alphabétique des noms AFFICHÉS', async ({ page, bureau }) => {
    await ouvrirListe(page);
    await page.getByRole('combobox', { name: 'Lignes par page' }).selectOption('50');
    const affiches = await nomsAffiches(page);
    expect(affiches.length).toBeGreaterThan(10);
    /*
     * L'ordre par défaut suit le nom AFFICHÉ (français), plus le nom stocké (anglais) — et, depuis le même correctif
     * (src/pages/Automations.tsx, `parNomAffiche`), les nombres s'y lisent comme des nombres : « 3 jours » avant
     * « 14 jours », sans tenir compte des accents ni de la casse. C'est cet ordre-là qu'on exige, calculé par le
     * navigateur de l'utilisateur.
     */
    const attendu = await page.evaluate((noms) => [...noms].sort((a, b) => a.localeCompare(b, 'fr-CA', { sensitivity: 'base', numeric: true })), affiches);
    expect(affiches).toEqual(attendu);
    // Preuve que ce n'est PAS l'ordre des noms stockés : au moins un préréglage porte en base un autre nom (anglais).
    const { data: stockes } = await bureau.admin.from('automation_rules').select('name').eq('org_id', bureau.orgA).eq('is_preset', true).is('deleted_at', null);
    expect((stockes ?? []).some((r) => !affiches.includes(String(r.name))), 'des noms stockés diffèrent des noms affichés').toBe(true);
    // Et l'ordre « des nombres » se voit vraiment : une relance à 3 jours passe avant celle à 14 jours.
    const paires = affiches.filter((n) => /\b3 jours\b/.test(n)).map((n) => [n, n.replace(/\b3 jours\b/, '14 jours')] as const).filter(([, n14]) => affiches.includes(n14));
    expect(paires.length, 'au moins une paire « 3 jours » / « 14 jours » dans les automatisations fournies').toBeGreaterThan(0);
    for (const [n3, n14] of paires) expect(affiches.indexOf(n3), `« ${n3} » avant « ${n14} »`).toBeLessThan(affiches.indexOf(n14));
  });

  test('[LST-063] Statut : brouillons puis publiées, puis l’inverse ; à égalité, par nom', async ({ page, bureau, marque }) => {
    await creerRegle(bureau, bureau.orgA, { name: `${marque} A publiee`, is_active: true });
    await creerRegle(bureau, bureau.orgA, { name: `${marque} B brouillon` });
    await creerRegle(bureau, bureau.orgA, { name: `${marque} C publiee`, is_active: true });
    await creerRegle(bureau, bureau.orgA, { name: `${marque} D brouillon` });
    await ouvrirListe(page);
    await chercher(page, marque);
    const entete = page.getByRole('columnheader', { name: 'Statut' });
    await entete.getByRole('button').click();
    await expect(entete).toHaveAttribute('aria-sort', 'ascending');
    await expect.poll(() => nomsAffiches(page)).toEqual(['B brouillon', 'D brouillon', 'A publiee', 'C publiee'].map((n) => `${marque} ${n}`));
    await entete.getByRole('button').click();
    await expect(entete).toHaveAttribute('aria-sort', 'descending');
    await expect.poll(() => nomsAffiches(page)).toEqual(['A publiee', 'C publiee', 'B brouillon', 'D brouillon'].map((n) => `${marque} ${n}`));
  });

  test('[LST-064][LST-065] Total déclenché et En cours : les chiffres sont ceux de la base, triés comme des nombres', async ({ page, bureau, marque }) => {
    const a = await creerRegle(bureau, bureau.orgA, { name: `${marque} A` });
    const b = await creerRegle(bureau, bureau.orgA, { name: `${marque} B` });
    const c = await creerRegle(bureau, bureau.orgA, { name: `${marque} C` });
    // A : 2 déclenchements ; B : 12 (dont 3 en cours) ; C : 0.
    await declencher(bureau, bureau.orgA, a.id, 2);
    await declencher(bureau, bureau.orgA, b.id, 9);
    await mettreEnAttente(bureau, bureau.orgA, b.id, 3);
    await mettreEnAttente(bureau, bureau.orgA, a.id, 1);
    await ouvrirListe(page);
    await chercher(page, marque);
    const cellules = (nom: string) => ligne(page, nom).getByRole('cell');
    await expect(cellules(a.name).nth(3)).toHaveText('3');
    await expect(cellules(a.name).nth(4)).toHaveText('1');
    await expect(cellules(b.name).nth(3)).toHaveText('12');
    await expect(cellules(b.name).nth(4)).toHaveText('3');
    await expect(cellules(c.name).nth(3)).toHaveText('0');
    await expect(cellules(c.name).nth(4)).toHaveText('0');

    const total = page.getByRole('columnheader', { name: 'Total déclenché' });
    await total.getByRole('button').click();
    await expect(total).toHaveAttribute('aria-sort', 'ascending');
    // 0 < 3 < 12 : un tri de texte donnerait 0, 12, 3.
    await expect.poll(() => nomsAffiches(page)).toEqual([c.name, a.name, b.name]);
    await total.getByRole('button').click();
    await expect.poll(() => nomsAffiches(page)).toEqual([b.name, a.name, c.name]);

    const enCours = page.getByRole('columnheader', { name: 'En cours' });
    await enCours.getByRole('button').click();
    await expect(enCours).toHaveAttribute('aria-sort', 'ascending');
    await expect(total).toHaveAttribute('aria-sort', 'none');
    await expect.poll(() => nomsAffiches(page)).toEqual([c.name, a.name, b.name]);
    await enCours.getByRole('button').click();
    await expect.poll(() => nomsAffiches(page)).toEqual([b.name, a.name, c.name]);
  });

  test('[LST-066][LST-067] Modifiée le et Créée le : ordre chronologique réel, dates affichées = base', async ({ page, bureau, marque }) => {
    await creerRegle(bureau, bureau.orgA, { name: `${marque} A`, created_at: '2026-02-01T15:00:00Z', updated_at: '2026-09-09T15:00:00Z' });
    await creerRegle(bureau, bureau.orgA, { name: `${marque} B`, created_at: '2025-11-30T15:00:00Z', updated_at: '2026-09-10T15:00:00Z' });
    await creerRegle(bureau, bureau.orgA, { name: `${marque} C`, created_at: '2026-01-15T15:00:00Z', updated_at: '2026-08-02T15:00:00Z' });
    const enBase = Object.fromEntries((await bureau.admin.from('automation_rules').select('name, created_at, updated_at')
      .eq('org_id', bureau.orgA).ilike('name', `%${marque}%`)).data?.map((r) => [r.name, r]) ?? []);
    await ouvrirListe(page);
    await chercher(page, marque);
    // La date telle que le navigateur de l'utilisateur l'écrit (fuseau de Montréal), calculée depuis la base.
    const jour = (iso: string) => page.evaluate((i) => new Date(i).toLocaleDateString('fr-CA', { day: 'numeric', month: 'short', year: 'numeric' }), iso);
    for (const n of ['A', 'B', 'C']) {
      const r = enBase[`${marque} ${n}`];
      await expect(ligne(page, `${marque} ${n}`).getByRole('cell').nth(5)).toHaveText(await jour(r.updated_at));
      await expect(ligne(page, `${marque} ${n}`).getByRole('cell').nth(6)).toHaveText(await jour(r.created_at));
    }
    await expect(ligne(page, `${marque} B`).getByRole('cell').nth(6)).toHaveText(/30 nov\.? 2025/);
    const parModif = ['A', 'B', 'C'].sort((x, y) => Date.parse(enBase[`${marque} ${x}`].updated_at) - Date.parse(enBase[`${marque} ${y}`].updated_at)).map((n) => `${marque} ${n}`);

    const modifiee = page.getByRole('columnheader', { name: 'Modifiée le' });
    await modifiee.getByRole('button').click();
    await expect(modifiee).toHaveAttribute('aria-sort', 'ascending');
    await expect.poll(() => nomsAffiches(page)).toEqual(parModif);
    await modifiee.getByRole('button').click();
    await expect.poll(() => nomsAffiches(page)).toEqual([...parModif].reverse());

    const creee = page.getByRole('columnheader', { name: 'Créée le' });
    await creee.getByRole('button').click();
    await expect(creee).toHaveAttribute('aria-sort', 'ascending');
    // 30 nov. 2025 < 15 janv. 2026 < 1 févr. 2026 : un tri sur le texte affiché mettrait « 1 févr. » en premier.
    await expect.poll(() => nomsAffiches(page)).toEqual([`${marque} B`, `${marque} C`, `${marque} A`]);
    await creee.getByRole('button').click();
    await expect.poll(() => nomsAffiches(page)).toEqual([`${marque} A`, `${marque} C`, `${marque} B`]);
  });

  test('[LST-062] S-42 : on peut revenir à l’ordre par défaut après avoir trié par colonne @defaut', async ({ page, bureau, marque }) => {
    await creerRegle(bureau, bureau.orgA, { name: `${marque} A`, is_active: true });
    await creerRegle(bureau, bureau.orgA, { name: `${marque} B` });
    await ouvrirListe(page);
    await chercher(page, marque);
    const entete = page.getByRole('columnheader', { name: 'Statut' });
    await entete.getByRole('button').click();
    await entete.getByRole('button').click();
    // Un troisième clic devrait lever le tri (aucun tri → ascendant → descendant → aucun tri).
    await entete.getByRole('button').click();
    await expect(entete).toHaveAttribute('aria-sort', 'none', { timeout: 5_000 });
  });

  test('[LST-066][LST-067] S-49 : à 900 px de large, les colonnes de dates sont masquées et le reste du tableau reste utilisable', async ({ page, bureau, marque }) => {
    const r = await creerRegle(bureau, bureau.orgA, { name: `${marque} A` });
    await page.setViewportSize({ width: 900, height: 900 });
    await ouvrirListe(page);
    await chercher(page, marque);
    await expect(ligne(page, r.name)).toBeVisible();
    // Sous 1024 px : « Modifiée le » et « Créée le » disparaissent (et leur tri avec elles).
    await expect(page.getByRole('columnheader', { name: 'Créée le' })).toBeHidden();
    await expect(page.getByRole('columnheader', { name: 'Modifiée le' })).toBeHidden();
    // Le tableau défile dans sa carte : les actions de la ligne restent atteignables.
    await page.getByRole('button', { name: `Actions pour ${r.name}` }).click();
    await expect(page.getByRole('menuitem', { name: 'Modifier' })).toBeAttached();
  });
});
