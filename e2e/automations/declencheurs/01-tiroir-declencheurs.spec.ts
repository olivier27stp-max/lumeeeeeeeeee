/**
 * Le tiroir « Déclencheurs » et ses deux portes d'entrée (carte « Quand » d'un
 * parcours garni, « Choisir le déclencheur » d'un canevas vide).
 *
 * Ce que ce fichier prouve :
 *  · le tiroir offre exactement le catalogue attendu, famille par famille,
 *    dans l'ordre — 25 déclencheurs pour un bureau sans drapeau, 28 quand les
 *    drapeaux en rodage sont actifs (les 3 de plus : « Paiement échoué »,
 *    « Facture consultée par le client », « Client inactif ») ;
 *  · la recherche (accents, casse, aide, aucun résultat), la fermeture ;
 *  · choisir un déclencheur sur une automatisation neuve la fait naître en base ;
 *  · deux choix rapprochés : c'est le DERNIER qui doit rester ;
 *  · un déclencheur que le bureau n'a plus (drapeau coupé) ne s'affiche pas en clé technique.
 */
import { test, expect, creerRegle, lireRegle, reglesParNom, attendre } from '../_outils/banc';
import { DECLENCHEURS_ATTENDUS, FAMILLES, SANS_DRAPEAU, SOUS_DRAPEAU, MOTIF_CLE_TECHNIQUE } from './_catalogue';
import { donnees, ouvrirEditeur, carteDeclencheur, tiroirDeclencheurs, panneauDeclencheur, ouvrirTiroirDeclencheurs } from './_donnees';

test.afterEach(async ({ context }) => { await context.unrouteAll({ behavior: 'ignoreErrors' }); });

const ETAPE = [{ id: 'e1', type: 'action', action: { type: 'create_notification', config: { title: 'Suivi QA' } }, suivant: null }];

/** Le contenu du tiroir : familles dans l'ordre, et sous chacune les titres dans l'ordre. */
async function contenuDuTiroir(page: import('@playwright/test').Page) {
  return tiroirDeclencheurs(page).locator('section').evaluateAll((sections) => sections.map((s) => ({
    famille: s.querySelector('h3')?.textContent?.trim() ?? '',
    items: Array.from(s.querySelectorAll('li button')).map((b) => ({
      titre: b.querySelector('span > span')?.textContent?.trim() ?? '',
      aide: b.querySelectorAll('span > span')[1]?.textContent?.trim() ?? '',
      desactive: (b as HTMLButtonElement).disabled,
    })),
  })));
}

function attenduPourFamilles(liste: typeof DECLENCHEURS_ATTENDUS, langue: 'fr' | 'en') {
  return FAMILLES
    .map((f) => ({
      famille: f[langue],
      items: liste.filter((d) => d.famille === f.cle).map((d) => ({ titre: d[langue], aide: langue === 'fr' ? d.aide_fr : d.aide_en, desactive: false })),
    }))
    .filter((g) => g.items.length > 0);
}

test.describe('tiroir des déclencheurs — bureau sans drapeau', () => {
  test('[EDT-032][EDT-058][EDT-063] la carte « Quand » mène au tiroir, qui offre les 25 déclencheurs sans drapeau, par famille et dans l’ordre — et aucun des 3 sous drapeau', async ({ page, bureau, marque }) => {
    await donnees(bureau);
    const regle = await creerRegle(bureau, bureau.orgA, { name: `${marque} tiroir`, trigger_event: 'webhook.received', steps: ETAPE });
    await ouvrirEditeur(page, regle.id);

    // « Appel reçu de l'extérieur » n'a aucun réglage : la carte ouvre directement le tiroir.
    await carteDeclencheur(page).click();
    const tiroir = tiroirDeclencheurs(page);
    await expect(tiroir).toBeVisible();
    await expect(tiroir.getByRole('heading', { name: 'Déclencheurs', exact: true })).toBeVisible();
    await expect(tiroir.getByText('Ce qui met l’automatisation en route')).toBeVisible();

    const vu = await contenuDuTiroir(page);
    expect(vu).toEqual(attenduPourFamilles(SANS_DRAPEAU, 'fr'));
    expect(vu.flatMap((g) => g.items)).toHaveLength(25);

    // Les 3 déclencheurs sous drapeau ne sont PAS offerts à ce bureau (aucune ligne org_features).
    const { data: drapeaux } = await bureau.admin.from('org_features').select('feature, enabled').eq('org_id', bureau.orgA)
      .in('feature', SOUS_DRAPEAU.map((d) => d.drapeau as string));
    expect((drapeaux ?? []).filter((f) => f.enabled)).toEqual([]);
    for (const d of SOUS_DRAPEAU) await expect(tiroir.getByText(d.fr, { exact: true })).toHaveCount(0);

    // Aucun item grisé : le catalogue n'a pas de déclencheur « Bientôt disponible ».
    await expect(tiroir.locator('li button:disabled')).toHaveCount(0);
    // Aucune clé technique à l'écran.
    expect(await tiroir.innerText()).not.toMatch(MOTIF_CLE_TECHNIQUE);
  });

  test('[EDT-057] la recherche filtre sur le titre ET l’aide, sans tenir compte des accents ni de la casse ; « rien ne correspond » le dit', async ({ page, bureau, marque }) => {
    await donnees(bureau);
    const regle = await creerRegle(bureau, bureau.orgA, { name: `${marque} recherche`, trigger_event: 'webhook.received', steps: ETAPE });
    await ouvrirEditeur(page, regle.id);
    await carteDeclencheur(page).click();
    const tiroir = tiroirDeclencheurs(page);
    const recherche = tiroir.getByRole('searchbox', { name: 'Rechercher dans Déclencheurs' });
    await expect(recherche).toBeVisible();
    await expect(recherche).toHaveAttribute('placeholder', 'Rechercher…');

    // Sans accent, en majuscules : « ETIQUETTE » trouve les deux « Étiquette … ».
    await recherche.fill('ETIQUETTE');
    expect((await contenuDuTiroir(page)).flatMap((g) => g.items.map((i) => i.titre))).toEqual(['Étiquette ajoutée', 'Étiquette retirée']);
    // Dans l'aide : « Zapier » n'est que dans l'aide de « Appel reçu de l'extérieur ».
    await recherche.fill('zapier');
    expect((await contenuDuTiroir(page)).flatMap((g) => g.items.map((i) => i.titre))).toEqual(['Appel reçu de l’extérieur']);
    // Les familles vides disparaissent : il ne reste que « Clients et prospects ».
    expect((await contenuDuTiroir(page)).map((g) => g.famille)).toEqual(['Clients et prospects']);
    // Émojis, caractères spéciaux, texte très long : pas d'erreur, « rien ne correspond ».
    for (const saisie of ['🌞', '<script>alert(1)</script>', '%_\\', 'x'.repeat(600)]) {
      await recherche.fill(saisie);
      await expect(tiroir.getByText('Rien ne correspond à cette recherche.')).toBeVisible();
      await expect(tiroir.locator('li')).toHaveCount(0);
    }
    // Des espaces seuls ne filtrent rien ; vider rend la liste entière.
    await recherche.fill('   ');
    expect((await contenuDuTiroir(page)).flatMap((g) => g.items)).toHaveLength(25);
    await recherche.fill('');
    expect((await contenuDuTiroir(page)).flatMap((g) => g.items)).toHaveLength(25);
  });

  test('[EDT-057] à l’ouverture du tiroir, le curseur est dans la recherche (on tape tout de suite)', async ({ page, bureau, marque }) => {
    await donnees(bureau);
    const regle = await creerRegle(bureau, bureau.orgA, { name: `${marque} focus`, trigger_event: 'webhook.received', steps: ETAPE });
    await ouvrirEditeur(page, regle.id);
    await carteDeclencheur(page).click();
    const recherche = tiroirDeclencheurs(page).getByRole('searchbox', { name: 'Rechercher dans Déclencheurs' });
    await expect(recherche).toBeVisible();
    // 25 déclencheurs à parcourir : la recherche est LE moyen d'aller vite, elle doit avoir le focus.
    await expect(recherche).toBeFocused();
  });

  test('[EDT-056] « Fermer » referme le tiroir sans rien changer', async ({ page, bureau, marque }) => {
    await donnees(bureau);
    const regle = await creerRegle(bureau, bureau.orgA, { name: `${marque} fermer`, trigger_event: 'webhook.received', steps: ETAPE });
    await ouvrirEditeur(page, regle.id);
    await carteDeclencheur(page).click();
    const tiroir = tiroirDeclencheurs(page);
    await expect(tiroir).toBeVisible();
    await tiroir.getByRole('button', { name: 'Fermer', exact: true }).click();
    await expect(tiroir).toBeHidden();
    await expect(carteDeclencheur(page)).toContainText('Appel reçu de l’extérieur');
    expect((await lireRegle(bureau, regle.id))?.trigger_event).toBe('webhook.received');
  });

  test('[EDT-056] Échap referme le tiroir (ouvert par erreur, on en sort au clavier)', async ({ page, bureau, marque }) => {
    await donnees(bureau);
    const regle = await creerRegle(bureau, bureau.orgA, { name: `${marque} échap`, trigger_event: 'webhook.received', steps: ETAPE });
    await ouvrirEditeur(page, regle.id);
    await carteDeclencheur(page).click();
    const tiroir = tiroirDeclencheurs(page);
    await expect(tiroir).toBeVisible();
    await tiroir.getByRole('searchbox').focus();
    await page.keyboard.press('Escape');
    await expect(tiroir).toBeHidden({ timeout: 5000 });
  });

  test('[EDT-058] rechoisir le déclencheur déjà en place ferme le tiroir sans rien écrire', async ({ page, bureau, marque }) => {
    await donnees(bureau);
    const regle = await creerRegle(bureau, bureau.orgA, {
      name: `${marque} même`, trigger_event: 'client.tagged', conditions: { tag: 'VIP' }, steps: ETAPE,
    });
    await ouvrirEditeur(page, regle.id);
    const ecritures: string[] = [];
    page.on('request', (q) => { if (q.method() !== 'GET' && /\/api\/automations\/rules/.test(q.url())) ecritures.push(`${q.method()} ${q.url()}`); });
    await ouvrirTiroirDeclencheurs(page);
    await tiroirDeclencheurs(page).getByRole('button', { name: /^Étiquette ajoutée/ }).click();
    await expect(tiroirDeclencheurs(page)).toBeHidden();
    await expect(carteDeclencheur(page)).toContainText('Étiquette ajoutée');
    await expect(carteDeclencheur(page)).toContainText('Quelle étiquette : VIP');
    expect(ecritures).toEqual([]);
    const apres = await lireRegle(bureau, regle.id);
    expect(apres?.conditions).toEqual({ tag: 'VIP' });
    expect(apres?.updated_at).toBe(regle.updated_at);
  });

  test('[EDT-029][EDT-030][EDT-058] canevas vide : la carte « Quand » en pointillés dit le déclencheur en place et ouvre le tiroir ; le choix fait naître l’automatisation en base avec CE déclencheur ; « Régler le déclencheur » ouvre ses réglages', async ({ page, bureau }) => {
    await donnees(bureau);
    // Pas de `marque` dans le nom ici (l'automatisation naît avec son nom par défaut) : ménage à la main.
    const avant = new Set((await reglesParNom(bureau, bureau.orgA, 'Nouvelle automatisation')).map((r) => r.id));
    let creee: string | null = null;
    try {
      await page.goto('/automations/nouvelle');
      // Depuis #859 (EDITEUR-03) : la carte ne dit plus « Choisir le déclencheur » avec le déclencheur en petit dessous
      // (on croyait qu'aucun n'était choisi) — elle dit « Quand », le déclencheur EN PLACE, puis l'invitation à en changer.
      const choisir = page.getByRole('button', { name: 'Quand Devis envoyé Cliquer pour choisir un autre déclencheur', exact: true });
      await expect(choisir).toBeVisible({ timeout: 90_000 });
      await expect(page.getByRole('button', { name: /^Choisir le déclencheur/ })).toHaveCount(0);
      // Rien n'existe encore en base : l'écran le dit (EDITEUR-02), au lieu d'afficher « Enregistré ».
      await expect(page.getByText('Pas encore enregistrée', { exact: true })).toBeVisible();
      await choisir.click();
      const tiroir = tiroirDeclencheurs(page);
      await expect(tiroir).toBeVisible();

      const creation = page.waitForResponse((s) => s.request().method() === 'POST' && /\/api\/automations\/rules$/.test(s.url()), { timeout: 60_000 });
      await tiroir.getByRole('button', { name: /^Opportunité qui dort/ }).click();
      const rep = await creation;
      expect(rep.ok(), `création : ${rep.status()}`).toBe(true);
      await expect(tiroir).toBeHidden();
      await expect(page).toHaveURL(/\/automations\/[0-9a-f-]{36}$/);
      creee = page.url().split('/').pop() ?? null;
      expect(creee).toBeTruthy();
      await expect(page.getByRole('button', { name: 'Quand Opportunité qui dort Cliquer pour choisir un autre déclencheur', exact: true })).toBeVisible();

      const ligne = await lireRegle(bureau, creee as string);
      expect(ligne?.org_id).toBe(bureau.orgA);
      expect(ligne?.trigger_event).toBe('deal.stage_idle');
      expect(ligne?.conditions ?? {}).toEqual({});
      expect(ligne?.is_active).toBe(false);
      // Une seule ligne est née (pas de doublon).
      const apres = (await reglesParNom(bureau, bureau.orgA, 'Nouvelle automatisation')).filter((r) => !avant.has(r.id));
      expect(apres.map((r) => r.id)).toEqual([creee]);

      // Le bouton de réglage est offert sur le canevas vide, et ouvre le panneau du bon déclencheur.
      const regler = page.getByRole('button', { name: 'Régler le déclencheur', exact: true });
      await expect(regler).toBeVisible();
      await regler.click();
      const panneau = panneauDeclencheur(page);
      await expect(panneau).toBeVisible();
      await expect(panneau.getByText('Opportunité qui dort', { exact: true })).toBeVisible();
      await expect(panneau.getByLabel(/^Quelle étape/)).toBeVisible();
    } finally {
      const aSupprimer = (await reglesParNom(bureau, bureau.orgA, 'Nouvelle automatisation')).filter((r) => !avant.has(r.id)).map((r) => r.id);
      if (aSupprimer.length) await bureau.admin.from('automation_rules').delete().in('id', aSupprimer).eq('org_id', bureau.orgA);
    }
  });

  test('[EDT-058] pendant que le changement de déclencheur s’enregistre, l’écran le dit (pas l’ancien déclencheur affiché comme si de rien n’était)', async ({ page, bureau, marque }) => {
    await donnees(bureau);
    const regle = await creerRegle(bureau, bureau.orgA, { name: `${marque} en cours`, trigger_event: 'webhook.received', steps: ETAPE });
    await ouvrirEditeur(page, regle.id);
    // L'enregistrement est retenu : on observe l'écran PENDANT l'appel.
    let relacher: () => void = () => undefined;
    const retenue = new Promise<void>((r) => { relacher = r; });
    await page.route(/\/api\/automations\/rules\/[0-9a-f-]{36}$/, async (route) => {
      if (route.request().method() === 'PATCH') await retenue;
      await route.continue();
    });
    await carteDeclencheur(page).click();
    await tiroirDeclencheurs(page).getByRole('button', { name: /^Facture payée/ }).click();
    await expect(tiroirDeclencheurs(page)).toBeHidden();
    try {
      // L'utilisateur vient de choisir « Facture payée » : soit la carte le montre déjà, soit un état
      // « Enregistrement… » est visible. Montrer l'ANCIEN déclencheur avec « Enregistré » le trompe.
      const carte = carteDeclencheur(page);
      const enCours = page.getByText('Enregistrement…');
      await expect(async () => {
        const montreLeNouveau = (await carte.innerText()).includes('Facture payée');
        expect(montreLeNouveau || await enCours.isVisible(), 'la carte montre le nouveau déclencheur, ou un état « en cours » est visible').toBe(true);
      }).toPass({ timeout: 5_000 });
    } finally {
      relacher();
    }
    await expect(carteDeclencheur(page)).toContainText('Facture payée');
    await attendre(() => lireRegle(bureau, regle.id), (r) => r?.trigger_event === 'invoice.paid');
  });

  test('[EDT-058] deux choix rapprochés (le premier envoi traîne) : c’est le DERNIER déclencheur choisi qui reste, à l’écran comme en base', async ({ page, bureau, marque }) => {
    await donnees(bureau);
    const regle = await creerRegle(bureau, bureau.orgA, { name: `${marque} course`, trigger_event: 'webhook.received', steps: ETAPE });
    await ouvrirEditeur(page, regle.id);
    // Panne simulée : le PREMIER enregistrement traîne (réseau lent) — il est retenu jusqu'après le second choix,
    // plutôt qu'un délai fixe : le second choix tombe toujours pendant que le premier est en vol.
    let premier = true;
    let relacher: () => void = () => undefined;
    const retenue = new Promise<void>((r) => { relacher = r; });
    await page.route(/\/api\/automations\/rules\/[0-9a-f-]{36}$/, async (route) => {
      if (route.request().method() === 'PATCH' && premier) {
        premier = false;
        await retenue;
      }
      await route.continue();
    });
    const reponses: number[] = [];
    page.on('response', (s) => { if (s.request().method() === 'PATCH' && /\/api\/automations\/rules\//.test(s.url())) reponses.push(s.status()); });

    try {
      await carteDeclencheur(page).click();
      await tiroirDeclencheurs(page).getByRole('button', { name: /^Facture payée/ }).click();   // 1er choix (erreur de clic)
      // Depuis #870 (declencheurs-03), la carte montre TOUT DE SUITE « Facture payée » : un clic dessus ouvre donc
      // ses réglages, plus le tiroir — on repasse par « Changer de déclencheur… », comme le ferait l'utilisateur.
      await expect(carteDeclencheur(page)).toContainText('Facture payée');
      await ouvrirTiroirDeclencheurs(page);
      expect(reponses, 'le premier enregistrement est encore en vol au moment du second choix').toEqual([]);
      await tiroirDeclencheurs(page).getByRole('button', { name: /^Job terminé/ }).click();      // 2e choix : le bon
      // Si le second enregistrement part EN PARALLÈLE du premier (le défaut d'origine), on le laisse aboutir d'abord :
      // le premier arrive alors en dernier au serveur, et c'est lui qui gagnerait. Sinon (un seul envoi en vol), on relâche.
      await expect.poll(() => reponses.length, { timeout: 2_000 }).toBe(1).catch(() => undefined);
    } finally {
      relacher();
    }
    await expect.poll(() => reponses.length, { timeout: 30_000 }).toBe(2);

    // Le dernier geste de l'utilisateur est « Job terminé ».
    await expect(carteDeclencheur(page)).toContainText('Job terminé');
    expect((await lireRegle(bureau, regle.id))?.trigger_event).toBe('job.completed');
  });

  test('[EDT-032] un déclencheur que le bureau n’a pas (drapeau coupé) garde son NOM sur la carte « Quand », jamais sa clé technique', async ({ page, bureau, marque }) => {
    await donnees(bureau);
    // Une règle née quand le drapeau était actif (ou posée par un modèle) : « Paiement échoué ».
    const regle = await creerRegle(bureau, bureau.orgA, { name: `${marque} drapeau coupé`, trigger_event: 'payment.failed', steps: ETAPE });
    await ouvrirEditeur(page, regle.id);
    const carte = carteDeclencheur(page);
    await expect(carte).not.toContainText('payment.failed');
    await expect(carte).toContainText('Paiement échoué');
  });
});

test.describe('tiroir des déclencheurs — bureau aux drapeaux actifs', () => {
  test.use({ compte: 'proprioB' });

  test('[EDT-058] avec les drapeaux actifs, le tiroir offre les 28 déclencheurs : les 3 de plus sont rangés dans leur famille', async ({ page, bureau, marque }) => {
    await donnees(bureau);
    const { data: drapeaux } = await bureau.admin.from('org_features').select('feature, enabled').eq('org_id', bureau.orgB)
      .in('feature', SOUS_DRAPEAU.map((d) => d.drapeau as string));
    expect((drapeaux ?? []).filter((f) => f.enabled).map((f) => f.feature).sort())
      .toEqual(['auto_client_inactif', 'auto_consultation_documents', 'auto_paiement_echoue']);

    const regle = await creerRegle(bureau, bureau.orgB, { name: `${marque} tiroir B`, trigger_event: 'webhook.received', steps: ETAPE });
    await ouvrirEditeur(page, regle.id);
    await carteDeclencheur(page).click();
    await expect(tiroirDeclencheurs(page)).toBeVisible();
    const vu = await contenuDuTiroir(page);
    expect(vu).toEqual(attenduPourFamilles(DECLENCHEURS_ATTENDUS, 'fr'));
    expect(vu.flatMap((g) => g.items)).toHaveLength(28);
  });
});
