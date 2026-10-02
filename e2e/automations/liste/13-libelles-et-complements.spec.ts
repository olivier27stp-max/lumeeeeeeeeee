/**
 * LISTE — libellés, bandeaux et compléments.
 *
 * Ce que ce fichier prouve :
 *  · en français, aucun libellé anglais ni clé technique ne traîne dans la
 *    liste, ses onglets, ses menus et ses filtres ; et l'inverse en anglais ;
 *  · le bandeau « étapes texto sautées » suit la configuration du bureau ;
 *  · un préréglage semé deux fois : celui qui est publié ne devient pas
 *    invisible ;
 *  · l'interrupteur pendant l'envoi ; le bouton « Modifier » d'un courriel
 *    mène bien à l'éditeur de courriel ;
 *  · les anciennes adresses `/automations/hub` et `/automations/builder`.
 */
import {
  test, expect, creerRegle, lireRegle, ouvrirListe, chercher, ligne, toast, onglet, interrupteur, nomsAffiches, ETAPES_TEXTO,
} from './_aides';

test.describe('bandeau « étapes texto sautées »', () => {
  test('[LST-020] sans numéro texto, le bandeau prévient que les étapes texto sont sautées ; avec un numéro, pas de bandeau', async ({ page }) => {
    let configure = false;
    await page.route('**/api/automations/rules/stats', async (route) => {
      const r = await route.fetch({ timeout: 90_000 });
      const j = await r.json() as Record<string, unknown>;
      await route.fulfill({ response: r, json: { ...j, texto_configure: configure } });
    });
    await ouvrirListe(page);
    const bandeau = page.getByRole('status').filter({ hasText: 'Les étapes texto sont sautées tant qu’aucun numéro n’est configuré.' });
    await expect(bandeau).toBeVisible();
    configure = true;
    const stats = page.waitForResponse((r) => r.url().endsWith('/api/automations/rules/stats'));
    await page.reload();
    await stats;
    await expect(page.getByRole('table')).toBeVisible({ timeout: 90_000 });
    await expect(page.getByRole('row').nth(1).getByRole('cell').nth(3)).toHaveText(/^\d+$/);
    await expect(bandeau).toHaveCount(0);
  });
});

test.describe('préréglage semé en double', () => {
  /*
   * Le soupçon (« deux automatisations vivantes de même clé de préréglage : la liste ne garde que la première, la
   * publiée devient invisible ») ne peut pas se produire : la base REFUSE la seconde. Index unique
   * `idx_automation_rules_org_preset` sur (org_id, preset_key), posé par
   * supabase/migrations/20260401000000_dedup_automation_presets.sql et repris par la base de référence
   * (supabase/baseline/01_schema.sql). Le test affirme donc la garde elle-même : c'est elle qui protège la liste.
   */
  test('[LST-020][LST-073] deux automatisations de même clé de préréglage dans un bureau : la base refuse la seconde, la première reste seule et visible', async ({ page, bureau, marque }) => {
    const cle = `e2e_double_${Date.now()}`;
    const premiere = await creerRegle(bureau, bureau.orgA, { name: `${marque} A double brouillon`, is_preset: true, preset_key: cle, is_active: false });
    const { data: seconde, error } = await bureau.admin.from('automation_rules').insert({
      org_id: bureau.orgA, name: `${marque} B double publiee`, trigger_event: 'lead.created', conditions: {}, delay_seconds: 0,
      actions: [{ type: 'log_activity', config: {} }], is_preset: true, preset_key: cle, is_active: true,
    }).select('id, name').maybeSingle();
    expect(seconde).toBeNull();
    expect(error?.code, 'violation d’unicité').toBe('23505');
    expect(String(error?.message)).toContain('idx_automation_rules_org_preset');
    // La même clé reste permise dans l'AUTRE bureau : l'unicité vaut par bureau.
    const ailleurs = await creerRegle(bureau, bureau.orgB, { name: `${marque} C autre bureau`, is_preset: true, preset_key: cle, is_active: false });
    expect(ailleurs.id).not.toBe(premiere.id);
    const { data: enBase } = await bureau.admin.from('automation_rules').select('id').eq('org_id', bureau.orgA).eq('preset_key', cle);
    expect((enBase ?? []).map((r) => r.id)).toEqual([premiere.id]);

    // À l'écran : la seule qui existe est là, dans « Prêtes à publier » (fournie, pas encore publiée).
    await ouvrirListe(page);
    await chercher(page, marque);
    await onglet(page, 'Prêtes à publier').click();
    await expect.poll(() => nomsAffiches(page)).toEqual([premiere.name]);
  });
});

test.describe('libellés', () => {
  const ANGLAIS = /\b(Delete|Deleted|Draft|Published|Search|Loading|Create|Edit|Duplicate|Failed|Cancel|Confirm|Settings|Workflows?|Templates?|Ready to publish|Publish|Restore|Move to|Select all|Previous|Next|Status|Name|Newest|Oldest|Immediate|after|before|step\(s\)|failure)\b/;

  test('[LST-020][LST-034][LST-015][LST-076] en français : aucun libellé anglais ni clé technique dans la liste, ses onglets, ses menus et ses filtres', async ({ page, bureau, marque }) => {
    await creerRegle(bureau, bureau.orgA, { name: `${marque} vivante`, is_active: true });
    await creerRegle(bureau, bureau.orgA, { name: `${marque} jetee`, deleted_at: new Date().toISOString() });
    await ouvrirListe(page);
    await page.getByRole('combobox', { name: 'Lignes par page' }).selectOption('50');
    const zone = page.getByRole('main');
    const textes: Record<string, string> = {};
    const relever = async (ou: string) => {
      // Les noms des automatisations de test (crochets, « E2E ») ne sont pas des libellés du produit.
      textes[ou] = (await zone.innerText()).split('\n').filter((l) => !l.includes('[E2E')).join('\n');
    };
    await page.getByRole('button', { name: 'Filtres avancés' }).click();
    await relever('toutes + filtres');
    await page.getByRole('button', { name: 'Créer', exact: true }).click();
    await relever('menu Créer');
    await page.getByRole('heading', { name: 'Mes automatisations' }).click();
    await expect(page.getByRole('tab')).toHaveCount(4);
    for (const o of ['À vérifier', 'Prêtes à publier', 'Corbeille']) { await onglet(page, o).click(); await relever(o); }
    await page.getByRole('button', { name: `Actions pour ${marque} jetee` }).click();
    await relever('menu corbeille');
    for (const [ou, texte] of Object.entries(textes)) {
      const anglais = texte.split('\n').filter((l) => ANGLAIS.test(l));
      expect(anglais, `libellés anglais dans « ${ou} »`).toEqual([]);
      // Une clé technique : deux mots collés par un point ou un tiret bas (« quote.sent », « client_first_name »).
      const cles = texte.split('\n').filter((l) => /\b[a-z]+[._][a-z_.]+\b/.test(l) && !/@|\.(test|com|ca)\b/.test(l));
      expect(cles, `clés techniques dans « ${ou} »`).toEqual([]);
    }
  });

  test.describe('interface en anglais', () => {
    test.use({ langue: 'en' });
    // Limites de mot « à la main » (lettres et chiffres Unicode) : `\b` ne voit ni le début d'« étape » ni la fin
    // d'un mot en « é » — le mot passait alors inaperçu.
    const FRANCAIS = /(?<![\p{L}\p{N}])(Brouillon|Publiée|Supprimée?|Rechercher|Toutes?|Aucune?|étapes?|après|avant|Immédiat|Modèles?|Prêtes|publier|Corbeille|Créer|Filtres|Dossier|Suivant|Précédent|Accueil|jours?|mois|Statut|Nom)(?![\p{L}\p{N}])/u;

    test('[LST-020][LST-034][LST-015] en anglais : aucun libellé français dans la liste, ses onglets et ses menus', async ({ page, bureau, marque }) => {
      await creerRegle(bureau, bureau.orgA, { name: `${marque} live`, is_active: true });
      await page.goto('/automations');
      await expect(page.getByRole('heading', { name: 'Workflows list' })).toBeVisible({ timeout: 90_000 });
      await expect(page.getByRole('table')).toBeVisible();
      await page.getByRole('combobox', { name: 'Rows per page' }).selectOption('50');
      const zone = page.getByRole('main');
      const textes: Record<string, string> = {};
      const relever = async (ou: string) => { textes[ou] = (await zone.innerText()).split('\n').filter((l) => !l.includes('[E2E')).join('\n'); };
      await page.getByRole('button', { name: 'Advanced filters' }).click();
      await relever('all + filters');
      await page.getByRole('button', { name: 'Create workflow' }).click();
      await relever('create menu');
      await page.getByRole('heading', { name: 'Workflows list' }).click();
      // « Ready to publish » (l'onglet s'appelait « Templates ») : commit 56f5f820.
      await expect(page.getByRole('tab')).toHaveText([/^All workflows$/, /^Needs review \(\d+\)$/, /^Ready to publish \(\d+\)$/, /^Deleted \(\d+\)$/]);
      for (const o of ['Needs review', 'Ready to publish', 'Deleted']) { await page.getByRole('tab', { name: new RegExp(`^${o}`) }).click(); await relever(o); }
      for (const [ou, texte] of Object.entries(textes)) {
        // Le nom de l'entreprise de test (« Nettoyage Test A ») est une donnée, pas un libellé.
        const francais = texte.split('\n').filter((l) => FRANCAIS.test(l) && !/Nettoyage Test/.test(l));
        expect(francais, `libellés français dans « ${ou} »`).toEqual([]);
      }
    });

    test('[LST-014][LST-017] S-35 : le même départ porte le même nom dans l’en-tête et dans le menu', async ({ page }) => {
      await page.goto('/automations');
      await expect(page.getByRole('heading', { name: 'Workflows list' })).toBeVisible({ timeout: 90_000 });
      await page.getByRole('button', { name: 'Create workflow' }).click();
      const dansLeMenu = (await page.getByRole('menuitem').nth(1).locator('span span').first().innerText()).trim();
      await page.getByRole('heading', { name: 'Workflows list' }).click();
      // « Build using AI » dans l'en-tête, « Build with Lumi » dans le menu : deux noms pour la même chose.
      await expect(page.getByRole('button', { name: dansLeMenu, exact: true })).toBeVisible({ timeout: 5_000 });
    });

    test('[LST-078] S-37 : en anglais, une panne du serveur est dite en anglais @defaut', async ({ page, bureau, marque, moniteur }) => {
      const r = await creerRegle(bureau, bureau.orgA, { name: `${marque} failing` });
      moniteur.attendu(/502 POST \/api\/automations\/rules\/[0-9a-f-]+\/duplicate/, 'panne simulée (passerelle) de la duplication');
      // Une passerelle en panne répond du HTML : le navigateur n'a que son message de repli.
      await page.route('**/api/automations/rules/*/duplicate', (route) => route.fulfill({ status: 502, contentType: 'text/html', body: '<html>Bad gateway</html>' }));
      await page.goto('/automations');
      await expect(page.getByRole('heading', { name: 'Workflows list' })).toBeVisible({ timeout: 90_000 });
      await page.getByRole('textbox', { name: 'Search', exact: true }).fill(marque);
      await page.getByRole('button', { name: `Actions for ${r.name}` }).click();
      await page.getByRole('menuitem', { name: 'Duplicate' }).click();
      const message = page.getByRole('region', { name: /Notifications/ }).getByRole('listitem').first();
      await expect(message).toBeVisible();
      // « Impossible de dupliquer l'automatisation. » : le repli n'existe qu'en français.
      await expect(message).not.toContainText(/Impossible|automatisation/i, { timeout: 5_000 });
    });
  });
});

test.describe('compléments', () => {
  test('[LST-073] pendant l’envoi, l’interrupteur montre déjà le nouvel état et qu’il travaille ; rien n’est annoncé d’avance', async ({ page, bureau, marque }) => {
    const r = await creerRegle(bureau, bureau.orgA, { name: `${marque} en vol`, steps: ETAPES_TEXTO, actions: [] });
    let liberer: () => void = () => undefined;
    const barriere = new Promise<void>((ok) => { liberer = ok; });
    await page.route('**/api/automations/rules/*/publication', async (route) => { await barriere; await route.continue(); });
    await ouvrirListe(page);
    await chercher(page, marque);
    await interrupteur(page, r.name).click();
    await expect(interrupteur(page, r.name)).toHaveAttribute('aria-checked', 'true');
    await expect(interrupteur(page, r.name)).toHaveAttribute('aria-busy', 'true');
    await expect(ligne(page, r.name).getByRole('cell').nth(2)).toHaveText('Publiée');
    // La base, elle, n'a pas encore changé — et aucun succès n'est annoncé d'avance.
    expect((await lireRegle(bureau, r.id))?.is_active).toBe(false);
    await expect(toast(page, 'Automatisation publiée')).toHaveCount(0);
    liberer();
    await expect(toast(page, 'Automatisation publiée')).toBeVisible();
    await expect(interrupteur(page, r.name)).not.toHaveAttribute('aria-busy', 'true');
    expect((await lireRegle(bureau, r.id))?.is_active).toBe(true);
  });

  test('[LST-075] ancien format : « Modifier » du courriel ouvre l’éditeur de courriel, « Fermer » revient à la liste', async ({ page, bureau, marque }) => {
    const r = await creerRegle(bureau, bureau.orgA, { name: `${marque} courriel`, actions: [{ type: 'send_email', config: { subject: 'Merci de votre visite', body: '<p>Bonjour,</p><p>Merci.</p>' } }] });
    await ouvrirListe(page);
    await chercher(page, marque);
    await page.getByRole('button', { name: `Voir les messages de ${r.name}` }).click();
    await expect(page.getByText('Merci de votre visite')).toBeVisible();
    await page.getByRole('button', { name: 'Modifier', exact: true }).click();
    await expect(page.getByText('Cliquez sur le texte pour le modifier')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Aperçu réel' })).toBeVisible();
    // Deux boutons s'appellent « Fermer » dans l'éditeur de courriel : la croix de l'en-tête (nom accessible seul)
    // et le bouton du pied, qui porte le mot. C'est celui-là qu'on clique.
    await expect(page.getByRole('button', { name: 'Fermer', exact: true })).toHaveCount(2);
    await page.getByRole('button', { name: 'Fermer', exact: true }).filter({ hasText: 'Fermer' }).click();
    await expect(page.getByText('Cliquez sur le texte pour le modifier')).toHaveCount(0);
    await expect(page.getByRole('button', { name: `Voir les messages de ${r.name}` })).toHaveAttribute('aria-expanded', 'true');
    // Rien n'a été écrit.
    expect((await lireRegle(bureau, r.id))?.actions?.[0]?.config).toEqual({ subject: 'Merci de votre visite', body: '<p>Bonjour,</p><p>Merci.</p>' });
  });

  for (const ancienne of ['hub', 'builder']) {
    test(`[LST-020] l’ancienne adresse /automations/${ancienne} ramène à la liste`, async ({ page }) => {
      await page.goto(`/automations/${ancienne}`);
      await expect(page.getByRole('heading', { name: 'Mes automatisations' })).toBeVisible({ timeout: 90_000 });
      await expect(page).toHaveURL(/\/automations$/);
    });
  }
});
