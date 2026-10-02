/**
 * Bibliothèque de modèles (Créer → « Partir d'un modèle ») — MOD-001 à MOD-029.
 *
 * Ce que ce fichier prouve : la fenêtre s'ouvre, se ferme par ses quatre chemins
 * (×, Échap, fond, création réussie) en rendant le focus au bouton « Créer » ;
 * le focus reste dedans ; chaque filtre, la recherche, le tri et les deux
 * affichages montrent exactement ce que le catalogue du serveur contient ;
 * l'aperçu d'un modèle dit ce qu'il fera ; « Utiliser ce modèle » crée UNE
 * copie en brouillon (même sur double clic) et ouvre l'éditeur ; les pannes
 * sont dites à l'écran.
 *
 * Le catalogue de référence est celui du serveur (server/lib/automationTemplates.ts) :
 * c'est lui que GET /api/automations/templates renvoie.
 */
import { MODELES_AUTOMATISATION } from '../../../server/lib/automationTemplates';
import { CATEGORIES_MODELES } from '../../../src/lib/automationTemplates';
import {
  test, expect, ouvrirListe, ouvrirBibliotheque, bibliotheque, carteModele, nombreAffiche, nomsAffiches,
  attendreEditeur, appelApi, CAPTURES,
} from './aides';

// Poste et staging partagés par plusieurs passes : les chargements sont lents par moments.
test.describe.configure({ timeout: 240_000 });

const MODELES = [...MODELES_AUTOMATISATION];
const TOTAL = MODELES.length;
const parCategorie = (cle: string) => MODELES.filter((m) => m.categorie === cle);
const libelleCategorie = (cle: string) => CATEGORIES_MODELES.find((c) => c.cle === cle)!.fr;
const sansAccents = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const triFr = (a: string, b: string) => a.localeCompare(b, 'fr');

test.describe('bibliothèque — ouverture, fermeture, clavier', () => {
  test('[MOD-001] × ferme la fenêtre, rend le focus à « Créer » et n’a rien créé', async ({ page, copies }) => {
    const fenetre = await ouvrirBibliotheque(page);
    expect(await nombreAffiche(fenetre)).toBe(TOTAL);
    await fenetre.getByRole('button', { name: 'Fermer', exact: true }).click();
    await expect(fenetre).toBeHidden();
    await expect(page.getByRole('button', { name: 'Créer', exact: true })).toBeFocused();
    expect(await copies.nouvelles()).toHaveLength(0);
  });

  test('[MOD-001] le catalogue affiché est celui que le serveur renvoie', async ({ page, bureau, jetonDe, baseURL }) => {
    const r = await appelApi(baseURL!, await jetonDe('proprioA'), bureau.orgA, 'GET', '/api/automations/templates');
    expect(r.status).toBe(200);
    const duServeur = (r.json as { modeles: Array<{ id: string; nom: { fr: string } }> }).modeles;
    expect(duServeur.map((m) => m.id).sort()).toEqual(MODELES.map((m) => m.id).sort());
    const fenetre = await ouvrirBibliotheque(page);
    expect((await nomsAffiches(fenetre)).sort(triFr)).toEqual(duServeur.map((m) => m.nom.fr).sort(triFr));
  });

  test('[MOD-002] Échap ferme la bibliothèque depuis la grille, et le focus revient sur « Créer »', async ({ page }) => {
    const fenetre = await ouvrirBibliotheque(page);
    await page.keyboard.press('Escape');
    await expect(fenetre).toBeHidden();
    await expect(page.getByRole('button', { name: 'Créer', exact: true })).toBeFocused();
  });

  test('[MOD-002] Échap depuis l’aperçu ferme toute la fenêtre ; rouverte, elle repart de la grille', async ({ page, copies }) => {
    const fenetre = await ouvrirBibliotheque(page);
    await carteModele(fenetre, 'Contrat signé').click();
    await expect(fenetre.getByRole('button', { name: 'Utiliser ce modèle', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(fenetre).toBeHidden();
    expect(await copies.nouvelles()).toHaveLength(0);
    await ouvrirBibliotheque(page, true);
    await expect(fenetre.getByRole('button', { name: 'Utiliser ce modèle', exact: true })).toBeHidden();
    expect(await nombreAffiche(fenetre)).toBe(TOTAL);
  });

  test('[MOD-003] un clic sur le fond ferme la fenêtre ; un clic dans la fenêtre ne la ferme pas', async ({ page }) => {
    const fenetre = await ouvrirBibliotheque(page);
    await fenetre.getByRole('heading', { name: 'Bibliothèque de modèles' }).click();
    await expect(fenetre).toBeVisible();
    await page.mouse.click(8, 450);
    await expect(fenetre).toBeHidden();
  });

  test('[MOD-004] Tab et Maj+Tab restent dans la fenêtre (piège de focus)', async ({ page }) => {
    const fenetre = await ouvrirBibliotheque(page);
    const dansLaFenetre = () => page.evaluate(() => {
      const d = document.querySelector('[role="dialog"]');
      const a = document.activeElement;
      return !!d && !!a && (d === a || d.contains(a));
    });
    // Un tour complet et plus : 43 cartes + les commandes ≈ 60 arrêts.
    const visites = new Set<string>();
    for (let i = 0; i < 70; i += 1) {
      await page.keyboard.press('Tab');
      expect(await dansLaFenetre(), `Tab n° ${i + 1} : le focus est sorti de la fenêtre`).toBe(true);
      visites.add(await page.evaluate(() => (document.activeElement?.getAttribute('aria-label') || document.activeElement?.textContent || '').trim().slice(0, 40)));
    }
    // Le tour passe par la fermeture, la recherche, le tri et les cartes.
    expect([...visites].join(' | ')).toContain('Fermer');
    expect([...visites].join(' | ')).toContain('Tous les modèles');
    for (let i = 0; i < 5; i += 1) {
      await page.keyboard.press('Shift+Tab');
      expect(await dansLaFenetre(), `Maj+Tab n° ${i + 1} : le focus est sorti de la fenêtre`).toBe(true);
    }
    await expect(fenetre).toBeVisible();
  });

  test('[MOD-004][MOD-024][MOD-029] tout le parcours au clavier : ouvrir un modèle, Entrée sur « Utiliser ce modèle »', async ({ page, copies }) => {
    const fenetre = await ouvrirBibliotheque(page);
    await carteModele(fenetre, 'Contrat signé').focus();
    await page.keyboard.press('Enter');
    await expect(fenetre.getByRole('heading', { name: 'Contrat signé' })).toBeVisible();
    await fenetre.getByRole('button', { name: 'Utiliser ce modèle', exact: true }).focus();
    await page.keyboard.press('Enter');
    await attendreEditeur(page);
    const creees = await copies.nouvelles();
    expect(creees.map((r) => r.name)).toEqual(['Contrat signé']);
  });

  test('[MOD-004] à l’aperçu d’un modèle, le focus est posé dans la fenêtre (pas perdu sur une carte disparue)', async ({ page }) => {
    const fenetre = await ouvrirBibliotheque(page);
    await carteModele(fenetre, 'Contrat signé').click();
    await expect(fenetre.getByRole('button', { name: 'Utiliser ce modèle', exact: true })).toBeVisible();
    // La carte cliquée n'existe plus : le focus doit être quelque part DANS la fenêtre,
    // sinon Tab repart du haut du document et le lecteur d'écran perd sa place.
    const ou = await page.evaluate(() => {
      const d = document.querySelector('[role="dialog"]');
      const a = document.activeElement;
      return a === document.body ? 'body' : d && a && (d === a || d.contains(a)) ? 'fenetre' : 'ailleurs';
    });
    expect(ou).toBe('fenetre');
  });
});

test.describe('bibliothèque — colonne de filtres', () => {
  test('[MOD-005] « Tous les modèles » décoche les catégories et rend toute la liste', async ({ page }) => {
    const fenetre = await ouvrirBibliotheque(page);
    const tous = fenetre.getByRole('button', { name: 'Tous les modèles', exact: true });
    await expect(tous).toHaveAttribute('aria-pressed', 'true');
    await fenetre.getByRole('checkbox', { name: /^Suivi de soumissions/ }).check();
    await expect(tous).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(() => nombreAffiche(fenetre)).toBe(parCategorie('soumissions').length);
    await tous.click();
    await expect(tous).toHaveAttribute('aria-pressed', 'true');
    await expect(fenetre.getByRole('checkbox', { name: /^Suivi de soumissions/ })).not.toBeChecked();
    await expect.poll(() => nombreAffiche(fenetre)).toBe(TOTAL);
  });

  test('[MOD-005] « Tous les modèles » n’a pas l’air actif pendant qu’une recherche filtre la liste', async ({ page }) => {
    const fenetre = await ouvrirBibliotheque(page);
    await fenetre.getByRole('searchbox', { name: 'Rechercher un modèle' }).fill('dépôt');
    await expect.poll(() => nombreAffiche(fenetre)).toBeLessThan(TOTAL);
    // La liste est filtrée : le bouton « Tous les modèles » ne devrait plus se dire enfoncé.
    await expect(fenetre.getByRole('button', { name: 'Tous les modèles', exact: true })).toHaveAttribute('aria-pressed', 'false');
  });

  test('[MOD-006] « Catégories » replie et déplie la liste des cases', async ({ page }) => {
    const fenetre = await ouvrirBibliotheque(page);
    const entete = fenetre.getByRole('button', { name: 'Catégories', exact: true });
    await expect(entete).toHaveAttribute('aria-expanded', 'true');
    await entete.click();
    await expect(entete).toHaveAttribute('aria-expanded', 'false');
    await expect(fenetre.getByRole('checkbox')).toHaveCount(0);
    await entete.click();
    await expect(entete).toHaveAttribute('aria-expanded', 'true');
    await expect(fenetre.getByRole('checkbox', { name: /^Suivi de soumissions/ })).toBeVisible();
  });

  const CASES: Array<[string, string]> = [
    ['MOD-007', 'soumissions'], ['MOD-008', 'bienvenue'], ['MOD-009', 'rendez_vous'], ['MOD-010', 'facturation'],
    ['MOD-011', 'apres_job'], ['MOD-012', 'relance_clients'], ['MOD-013', 'pipeline'],
  ];
  for (const [id, cle] of CASES) {
    test(`[${id}] la case « ${libelleCategorie(cle)} » ne garde que ses modèles, et son compteur dit vrai`, async ({ page }) => {
      const fenetre = await ouvrirBibliotheque(page);
      const attendus = parCategorie(cle);
      const libelle = libelleCategorie(cle);
      const afficherPlus = fenetre.getByRole('button', { name: 'Afficher plus', exact: true });
      const laCase = fenetre.getByRole('checkbox', { name: new RegExp(`^${libelle.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}`) });
      if (!(await laCase.isVisible())) await afficherPlus.click();
      // Le compteur à droite du libellé.
      await expect(fenetre.locator('label', { hasText: libelle })).toContainText(String(attendus.length));
      await laCase.check();
      await expect.poll(() => nombreAffiche(fenetre)).toBe(attendus.length);
      expect((await nomsAffiches(fenetre)).sort(triFr)).toEqual(attendus.map((m) => m.nom.fr).sort(triFr));
      await laCase.uncheck();
      await expect.poll(() => nombreAffiche(fenetre)).toBe(TOTAL);
    });
  }

  test('[MOD-007][MOD-010] deux cases cochées se cumulent', async ({ page }) => {
    const fenetre = await ouvrirBibliotheque(page);
    await fenetre.getByRole('checkbox', { name: /^Suivi de soumissions/ }).check();
    await fenetre.getByRole('checkbox', { name: /^Facturation et paiements/ }).check();
    await expect.poll(() => nombreAffiche(fenetre)).toBe(parCategorie('soumissions').length + parCategorie('facturation').length);
  });

  test('[MOD-014] « Afficher plus » montre les catégories suivantes, « Afficher moins » les replie', async ({ page }) => {
    const fenetre = await ouvrirBibliotheque(page);
    await expect(fenetre.getByRole('checkbox')).toHaveCount(5);
    await expect(fenetre.getByRole('checkbox', { name: /^Pipeline \/ leads/ })).toBeHidden();
    await fenetre.getByRole('button', { name: 'Afficher plus', exact: true }).click();
    await expect(fenetre.getByRole('checkbox')).toHaveCount(7);
    await expect(fenetre.getByRole('checkbox', { name: /^Pipeline \/ leads/ })).toBeVisible();
    await expect(fenetre.getByRole('checkbox', { name: /^Relance \/ réactivation de clients/ })).toBeVisible();
    await fenetre.getByRole('button', { name: 'Afficher moins', exact: true }).click();
    await expect(fenetre.getByRole('checkbox')).toHaveCount(5);
  });

  test('[MOD-014] une catégorie cochée puis repliée par « Afficher moins » reste visible quelque part', async ({ page }) => {
    const fenetre = await ouvrirBibliotheque(page);
    await fenetre.getByRole('button', { name: 'Afficher plus', exact: true }).click();
    await fenetre.getByRole('checkbox', { name: /^Pipeline \/ leads/ }).check();
    await expect.poll(() => nombreAffiche(fenetre)).toBe(parCategorie('pipeline').length);
    await fenetre.getByRole('button', { name: 'Afficher moins', exact: true }).click();
    // Le filtre s'applique toujours (la liste reste réduite) : la case cochée ne doit pas disparaître.
    await expect.poll(() => nombreAffiche(fenetre)).toBe(parCategorie('pipeline').length);
    await expect(fenetre.getByRole('checkbox', { name: /^Pipeline \/ leads/ })).toBeVisible();
  });
});

test.describe('bibliothèque — recherche, tri, affichage', () => {
  test('[MOD-015] la recherche trouve par nom, sans tenir compte des accents ni de la casse', async ({ page }) => {
    const fenetre = await ouvrirBibliotheque(page);
    const champ = fenetre.getByRole('searchbox', { name: 'Rechercher un modèle' });
    await expect(champ).toHaveAttribute('placeholder', 'Rechercher');
    const attendus = (q: string) => MODELES.filter((m) => sansAccents([m.nom.fr, m.description.fr, libelleCategorie(m.categorie)].join(' ')).includes(sansAccents(q)));
    for (const q of ['DEPOT', 'réengagement', 'anniversaire']) {
      await champ.fill(q);
      await expect.poll(() => nombreAffiche(fenetre), { message: `recherche « ${q} »` }).toBe(attendus(q).length);
      expect(attendus(q).length).toBeGreaterThan(0);
      expect((await nomsAffiches(fenetre)).sort(triFr)).toEqual(attendus(q).map((m) => m.nom.fr).sort(triFr));
    }
  });

  test('[MOD-015] la recherche porte aussi sur la description et sur le nom de la catégorie', async ({ page }) => {
    const fenetre = await ouvrirBibliotheque(page);
    const champ = fenetre.getByRole('searchbox', { name: 'Rechercher un modèle' });
    // « Gagné » n'apparaît que dans une description ; la description est affichée (tronquée) sur la carte.
    await champ.fill('lendemain');
    const parDescription = MODELES.filter((m) => sansAccents(`${m.nom.fr} ${m.description.fr}`).includes('lendemain'));
    await expect.poll(() => nombreAffiche(fenetre)).toBe(parDescription.length);
    await champ.fill('facturation et paiements');
    await expect.poll(() => nombreAffiche(fenetre)).toBe(parCategorie('facturation').length);
  });

  test('[MOD-015] la recherche se combine avec une catégorie cochée', async ({ page }) => {
    const fenetre = await ouvrirBibliotheque(page);
    await fenetre.getByRole('checkbox', { name: /^Facturation et paiements/ }).check();
    await fenetre.getByRole('searchbox', { name: 'Rechercher un modèle' }).fill('dépôt');
    const attendus = parCategorie('facturation').filter((m) => sansAccents(`${m.nom.fr} ${m.description.fr} ${libelleCategorie(m.categorie)}`).includes('depot'));
    await expect.poll(() => nombreAffiche(fenetre)).toBe(attendus.length);
  });

  test('[MOD-015] caractères spéciaux et texte très long dans la recherche : aucun plantage, « Aucun modèle trouvé »', async ({ page }) => {
    const fenetre = await ouvrirBibliotheque(page);
    const champ = fenetre.getByRole('searchbox', { name: 'Rechercher un modèle' });
    for (const q of ['<script>alert(1)</script>', '%_\\ [ ] ( * ) ? +', '😀 émoji', 'x'.repeat(2000)]) {
      await champ.fill(q);
      await expect(fenetre.getByText('Aucun modèle trouvé')).toBeVisible();
      await expect.poll(() => nombreAffiche(fenetre)).toBe(0);
    }
    await expect(champ).toHaveValue('x'.repeat(2000));
  });

  test('[MOD-027] « Aucun modèle trouvé » : « Réinitialiser les filtres » vide la recherche ET les catégories', async ({ page }) => {
    const fenetre = await ouvrirBibliotheque(page);
    await fenetre.getByRole('checkbox', { name: /^Suivi de soumissions/ }).check();
    await fenetre.getByRole('searchbox', { name: 'Rechercher un modèle' }).fill('zzz-introuvable');
    await expect(fenetre.getByText('Aucun modèle trouvé')).toBeVisible();
    await expect(fenetre.getByText('Affichage de 0 modèle', { exact: true })).toBeVisible();
    await fenetre.getByRole('button', { name: 'Réinitialiser les filtres', exact: true }).click();
    await expect(fenetre.getByRole('searchbox', { name: 'Rechercher un modèle' })).toHaveValue('');
    await expect(fenetre.getByRole('checkbox', { name: /^Suivi de soumissions/ })).not.toBeChecked();
    await expect.poll(() => nombreAffiche(fenetre)).toBe(TOTAL);
  });

  test('[MOD-016][MOD-017] tri par défaut « Plus récent » : les modèles ajoutés en dernier d’abord', async ({ page }) => {
    const fenetre = await ouvrirBibliotheque(page);
    const tri = fenetre.getByRole('combobox', { name: 'Trier' });
    await expect(tri).toHaveValue('recent');
    await expect(tri.locator('option')).toHaveText(['Plus récent', 'Nom (A–Z)', 'Nombre d’étapes']);
    const attendu = [...MODELES].sort((a, b) => b.ajoute_le.localeCompare(a.ajoute_le) || triFr(a.nom.fr, b.nom.fr)).map((m) => m.nom.fr);
    expect(await nomsAffiches(fenetre)).toEqual(attendu);
  });

  test('[MOD-018] tri « Nom (A–Z) » : ordre alphabétique français', async ({ page }) => {
    const fenetre = await ouvrirBibliotheque(page);
    await fenetre.getByRole('combobox', { name: 'Trier' }).selectOption({ label: 'Nom (A–Z)' });
    const attendu = MODELES.map((m) => m.nom.fr).sort(triFr);
    await expect.poll(() => nomsAffiches(fenetre)).toEqual(attendu);
  });

  test('[MOD-019] tri « Nombre d’étapes » : les plus longs d’abord, et le nombre affiché sur chaque carte est celui du catalogue', async ({ page }) => {
    const fenetre = await ouvrirBibliotheque(page);
    await fenetre.getByRole('combobox', { name: 'Trier' }).selectOption({ label: 'Nombre d’étapes' });
    const attendu = [...MODELES].sort((a, b) => b.nb_etapes - a.nb_etapes || triFr(a.nom.fr, b.nom.fr));
    await expect.poll(() => nomsAffiches(fenetre)).toEqual(attendu.map((m) => m.nom.fr));
    for (const m of attendu) {
      await expect(carteModele(fenetre, m.nom.fr)).toContainText(`${m.nb_etapes} ${m.nb_etapes > 1 ? 'étapes' : 'étape'}`);
    }
  });

  test('[MOD-020][MOD-021] grille ↔ liste : mêmes modèles, même ordre, bouton actif signalé', async ({ page }) => {
    const fenetre = await ouvrirBibliotheque(page);
    const grille = fenetre.getByRole('button', { name: 'Grille', exact: true });
    const liste = fenetre.getByRole('button', { name: 'Liste', exact: true });
    await expect(grille).toHaveAttribute('aria-pressed', 'true');
    await expect(liste).toHaveAttribute('aria-pressed', 'false');
    const enGrille = await nomsAffiches(fenetre);
    await liste.click();
    await expect(liste).toHaveAttribute('aria-pressed', 'true');
    await expect(grille).toHaveAttribute('aria-pressed', 'false');
    await expect(fenetre.getByRole('listitem')).toHaveCount(TOTAL);
    expect(await nomsAffiches(fenetre)).toEqual(enGrille);
    await grille.click();
    await expect(grille).toHaveAttribute('aria-pressed', 'true');
    await expect(fenetre.getByRole('listitem')).toHaveCount(0);
    expect(await nomsAffiches(fenetre)).toEqual(enGrille);
  });

  test('[MOD-025] en liste, une ligne ouvre l’aperçu du bon modèle', async ({ page }) => {
    const fenetre = await ouvrirBibliotheque(page);
    await fenetre.getByRole('button', { name: 'Liste', exact: true }).click();
    const m = MODELES.find((x) => x.id === 'payment_confirmation')!;
    const ligne = fenetre.getByRole('listitem').filter({ hasText: m.nom.fr });
    await expect(ligne).toContainText(m.description.fr);
    await expect(ligne).toContainText('Facturation et paiements');
    await ligne.getByRole('button').click();
    await expect(fenetre.getByRole('heading', { name: m.nom.fr, exact: true })).toBeVisible();
    await expect(fenetre.getByText(m.description.fr, { exact: true })).toBeVisible();
  });

  test('[MOD-001][MOD-016][MOD-021] rouverte, la fenêtre a oublié la recherche et les catégories — et aussi le tri et l’affichage @defaut', async ({ page }) => {
    const fenetre = await ouvrirBibliotheque(page);
    await fenetre.getByRole('checkbox', { name: /^Suivi de soumissions/ }).check();
    await fenetre.getByRole('searchbox', { name: 'Rechercher un modèle' }).fill('devis');
    await fenetre.getByRole('combobox', { name: 'Trier' }).selectOption({ label: 'Nom (A–Z)' });
    await fenetre.getByRole('button', { name: 'Liste', exact: true }).click();
    await fenetre.getByRole('button', { name: 'Fermer', exact: true }).click();
    await ouvrirBibliotheque(page, true);
    await expect(fenetre.getByRole('searchbox', { name: 'Rechercher un modèle' })).toHaveValue('');
    await expect(fenetre.getByRole('checkbox', { name: /^Suivi de soumissions/ })).not.toBeChecked();
    expect(await nombreAffiche(fenetre)).toBe(TOTAL);
    // Une remise à zéro à moitié : la recherche et les catégories repartent de zéro, le tri et l'affichage non.
    await expect(fenetre.getByRole('combobox', { name: 'Trier' })).toHaveValue('recent');
    await expect(fenetre.getByRole('button', { name: 'Grille', exact: true })).toHaveAttribute('aria-pressed', 'true');
  });
});

test.describe('bibliothèque — téléphone (< 768 px)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('[MOD-022][MOD-023] « Filtres » ouvre le panneau ; une case filtre et le bouton compte ; « Tous les modèles » remet à zéro sans fermer', async ({ page }) => {
    await ouvrirListe(page);
    const creer = page.getByRole('button', { name: 'Créer', exact: true });
    await creer.scrollIntoViewIfNeeded();
    await creer.click();
    await page.getByRole('menuitem', { name: /Partir d’un modèle/ }).click();
    const fenetre = bibliotheque(page);
    await expect(fenetre.getByText(/Affichage de \d+ modèles/)).toBeVisible({ timeout: 30_000 });
    // La colonne de gauche est masquée : pas de bouton « Catégories ».
    await expect(fenetre.getByRole('button', { name: 'Catégories', exact: true })).toBeHidden();
    const filtres = fenetre.getByRole('button', { name: /^Filtres/ });
    await expect(filtres).toHaveAttribute('aria-expanded', 'false');
    await filtres.click();
    await expect(filtres).toHaveAttribute('aria-expanded', 'true');
    await fenetre.getByRole('checkbox', { name: /^Rendez-vous et rappels/ }).check();
    await expect(filtres).toHaveText(/Filtres \(1\)/);
    await expect.poll(() => nombreAffiche(fenetre)).toBe(parCategorie('rendez_vous').length);
    await fenetre.getByRole('button', { name: 'Tous les modèles', exact: true }).click();
    await expect(filtres).toHaveText(/^Filtres$/);
    await expect(fenetre.getByRole('checkbox', { name: /^Rendez-vous et rappels/ })).not.toBeChecked();
    await expect(filtres).toHaveAttribute('aria-expanded', 'true');
    await expect.poll(() => nombreAffiche(fenetre)).toBe(TOTAL);
    await filtres.click();
    await expect(fenetre.getByRole('checkbox')).toHaveCount(0);
    // Rien ne déborde en largeur.
    const deborde = await page.evaluate(() => {
      const d = document.querySelector('[role="dialog"]');
      return !!d && d.scrollWidth > d.clientWidth + 1;
    });
    expect(deborde, 'la fenêtre défile horizontalement sur téléphone').toBe(false);
    await page.screenshot({ path: `${CAPTURES}/mod-022-telephone.png` });
  });
});

test.describe('bibliothèque — aperçu d’un modèle', () => {
  test('[MOD-024] une carte ouvre l’aperçu : catégorie, canaux, nom, description, déclencheur, étapes numérotées, textes', async ({ page }) => {
    const fenetre = await ouvrirBibliotheque(page);
    const m = MODELES.find((x) => x.id === 'pack_depot')!;
    const carte = carteModele(fenetre, m.nom.fr);
    await expect(carte).toContainText('Facturation et paiements');
    await expect(carte).toContainText(`${m.nb_etapes} étapes`);
    await carte.click();
    await expect(fenetre.getByRole('heading', { name: m.nom.fr, exact: true })).toBeVisible();
    await expect(fenetre.getByText(m.description.fr, { exact: true })).toBeVisible();
    await expect(fenetre.getByText('Devis accepté', { exact: true })).toBeVisible();
    await expect(fenetre.getByText('Aucune condition.')).toBeVisible();
    for (const canal of ['Texto', 'Courriel', 'Notification']) await expect(fenetre.getByRole('img', { name: canal }).first()).toBeVisible();
    const etapes = fenetre.getByRole('listitem');
    await expect(etapes).toHaveCount(m.nb_etapes);
    await expect(etapes.nth(0)).toHaveText(/^1\s*Attendre 1 heure$/);
    await expect(etapes.nth(1)).toContainText('Envoyer un courriel');
    await expect(etapes.nth(1)).toContainText('Dépôt requis pour réserver votre place');
    await expect(etapes.nth(3)).toHaveText(/^4\s*Attendre 2 jours$/);
    // Les variables sont en surbrillance, jamais remplacées par du vide.
    await expect(etapes.nth(2).locator('mark')).toHaveText(['[company_name]', '[quote_link]']);
    // Un courriel est montré comme du texte : aucune balise visible.
    await expect(fenetre).not.toContainText('<div');
    await expect(fenetre).not.toContainText('style=');
    await page.screenshot({ path: `${CAPTURES}/mod-024-apercu.png` });
  });

  test('[MOD-028] « Retour » revient à la liste telle qu’on l’avait laissée (recherche, catégorie, tri, affichage)', async ({ page, copies }) => {
    const fenetre = await ouvrirBibliotheque(page);
    await fenetre.getByRole('checkbox', { name: /^Facturation et paiements/ }).check();
    await fenetre.getByRole('searchbox', { name: 'Rechercher un modèle' }).fill('dépôt');
    await fenetre.getByRole('combobox', { name: 'Trier' }).selectOption({ label: 'Nom (A–Z)' });
    await fenetre.getByRole('button', { name: 'Liste', exact: true }).click();
    const avant = await nomsAffiches(fenetre);
    await fenetre.getByRole('listitem').first().getByRole('button').click();
    await expect(fenetre.getByRole('button', { name: 'Utiliser ce modèle', exact: true })).toBeVisible();
    await fenetre.getByRole('button', { name: 'Retour', exact: true }).click();
    await expect(fenetre.getByRole('button', { name: 'Utiliser ce modèle', exact: true })).toBeHidden();
    await expect(fenetre.getByRole('searchbox', { name: 'Rechercher un modèle' })).toHaveValue('dépôt');
    await expect(fenetre.getByRole('checkbox', { name: /^Facturation et paiements/ })).toBeChecked();
    await expect(fenetre.getByRole('combobox', { name: 'Trier' })).toHaveValue('nom');
    expect(await nomsAffiches(fenetre)).toEqual(avant);
    expect(await copies.nouvelles()).toHaveLength(0);
  });

  test('[MOD-024] l’aperçu montre TOUS les messages que la copie pourra envoyer, pas une seule branche', async ({ page }) => {
    // « Relance de devis » relance par texto OU par courriel selon le canal d'envoi du devis.
    const m = MODELES.find((x) => x.id === 'pack_relance_devis')!;
    const objets = (m.steps ?? []).flatMap((e) => (e.type === 'action' && e.action.type === 'send_email' ? [String(e.action.config.subject ?? '')] : [])).filter(Boolean);
    expect(objets.length, 'le modèle contient bien des courriels').toBeGreaterThan(0);
    const fenetre = await ouvrirBibliotheque(page);
    const carte = carteModele(fenetre, m.nom.fr);
    await carte.click();
    await expect(fenetre.getByRole('heading', { name: m.nom.fr, exact: true })).toBeVisible();
    await page.screenshot({ path: `${CAPTURES}/mod-024-relance-devis-une-branche.png`, fullPage: true });
    // L'icône « Courriel » doit figurer dans les canaux, et chaque objet de courriel dans l'aperçu.
    await expect.soft(fenetre.getByRole('img', { name: 'Courriel' }).first()).toBeVisible();
    for (const objet of objets) await expect.soft(fenetre.getByText(objet, { exact: true })).toBeVisible();
  });
});

test.describe('bibliothèque — « Utiliser ce modèle »', () => {
  test('[MOD-029] crée une copie en brouillon, le dit, et ouvre son éditeur', async ({ page, bureau, copies }) => {
    const fenetre = await ouvrirBibliotheque(page);
    await carteModele(fenetre, 'Contrat signé').click();
    await fenetre.getByRole('button', { name: 'Utiliser ce modèle', exact: true }).click();
    await expect(page.getByText('Automatisation créée en brouillon')).toBeVisible();
    await attendreEditeur(page);
    await expect(fenetre).toBeHidden();
    const [copie, ...autres] = await copies.nouvelles();
    expect(autres).toHaveLength(0);
    expect(page.url()).toContain(`/automations/${copie.id}`);
    expect(copie).toMatchObject({ org_id: bureau.orgA, name: 'Contrat signé', is_active: false, is_preset: false, preset_key: null, deleted_at: null });
    await expect(page.getByRole('button', { name: 'Contrat signé', exact: true })).toBeVisible();
    await expect(page.getByRole('switch', { name: 'Publier l’automatisation' })).toHaveAttribute('aria-checked', 'false');
    await expect(page.getByText('Brouillon', { exact: true })).toBeVisible();
    // De retour sur la liste, la copie y est, en brouillon.
    await page.getByRole('button', { name: 'Mes automatisations' }).click();
    await expect(page.getByRole('heading', { name: 'Mes automatisations' })).toBeVisible();
    await page.getByRole('textbox', { name: 'Rechercher', exact: true }).fill('Contrat signé');
    await expect(page.getByRole('switch', { name: 'Publier Contrat signé' })).toHaveCount(1);
  });

  test('[MOD-029] un double clic ne crée qu’une seule copie', async ({ page, copies }) => {
    const fenetre = await ouvrirBibliotheque(page);
    await carteModele(fenetre, 'Contrat signé').click();
    await fenetre.getByRole('button', { name: 'Utiliser ce modèle', exact: true }).dblclick();
    await attendreEditeur(page);
    expect((await copies.nouvelles()).map((r) => r.name)).toEqual(['Contrat signé']);
  });

  test('[MOD-029][MOD-028] pendant la création, « Retour » et « Utiliser ce modèle » sont désactivés et le bouton dit qu’il travaille', async ({ page, copies }) => {
    const fenetre = await ouvrirBibliotheque(page);
    await carteModele(fenetre, 'Contrat signé').click();
    let lacher: () => void = () => undefined;
    const retenue = new Promise<void>((r) => { lacher = r; });
    await page.route('**/api/automations/templates/utiliser', async (route) => { await retenue; await route.continue(); });
    const utiliser = fenetre.getByRole('button', { name: 'Utiliser ce modèle', exact: true });
    await utiliser.click();
    await expect(utiliser).toBeDisabled();
    await expect(utiliser).toHaveAttribute('aria-busy', 'true');
    await expect(fenetre.getByRole('button', { name: 'Retour', exact: true })).toBeDisabled();
    lacher();
    await attendreEditeur(page);
    expect(await copies.nouvelles()).toHaveLength(1);
  });

  test('[MOD-029][MOD-002] Échap pendant la création ne laisse pas partir l’utilisateur vers un éditeur qu’il n’attend plus @defaut', async ({ page, copies }) => {
    const fenetre = await ouvrirBibliotheque(page);
    await carteModele(fenetre, 'Contrat signé').click();
    let lacher: () => void = () => undefined;
    const retenue = new Promise<void>((r) => { lacher = r; });
    await page.route('**/api/automations/templates/utiliser', async (route) => { await retenue; await route.continue(); });
    await fenetre.getByRole('button', { name: 'Utiliser ce modèle', exact: true }).click();
    await expect(fenetre.getByRole('button', { name: 'Retour', exact: true })).toBeDisabled();
    await page.keyboard.press('Escape');
    // Attendu : la fenêtre reste ouverte tant que la création est en cours (comme ses deux boutons, désactivés).
    await expect(fenetre).toBeVisible();
    lacher();
    await attendreEditeur(page);
    expect(await copies.nouvelles()).toHaveLength(1);
  });

  test('[MOD-029] refus du serveur (rôle sans droit) : le message est affiché, la fenêtre reste ouverte, rien n’est créé', async ({ page, copies, moniteur }) => {
    moniteur.attendu(/403 POST .*templates\/utiliser/, 'refus simulé par page.route');
    moniteur.attendu(/\[bibliotheque-modeles\] utiliser/, 'le composant journalise l’échec');
    const fenetre = await ouvrirBibliotheque(page);
    await carteModele(fenetre, 'Contrat signé').click();
    await page.route('**/api/automations/templates/utiliser', (route) => route.fulfill({
      status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'Votre rôle ne permet pas de créer une automatisation.' }),
    }));
    await fenetre.getByRole('button', { name: 'Utiliser ce modèle', exact: true }).click();
    await expect(page.getByText('Votre rôle ne permet pas de créer une automatisation.')).toBeVisible();
    await expect(fenetre.getByRole('heading', { name: 'Contrat signé' })).toBeVisible();
    await expect(fenetre.getByRole('button', { name: 'Utiliser ce modèle', exact: true })).toBeEnabled();
    expect(await copies.nouvelles()).toHaveLength(0);
    // Réessayer après l'échec crée bien la copie (nouvelle clé d'idempotence).
    await page.unroute('**/api/automations/templates/utiliser');
    await fenetre.getByRole('button', { name: 'Utiliser ce modèle', exact: true }).click();
    await attendreEditeur(page);
    expect(await copies.nouvelles()).toHaveLength(1);
  });

  test('[MOD-029] coupure réseau pendant « Utiliser ce modèle » : un message en français, pas « Failed to fetch » @defaut', async ({ page, copies, moniteur }) => {
    moniteur.attendu(/POST .*templates\/utiliser — /, 'coupure simulée par page.route');
    moniteur.attendu(/\[bibliotheque-modeles\] utiliser/, 'le composant journalise l’échec');
    const fenetre = await ouvrirBibliotheque(page);
    await carteModele(fenetre, 'Contrat signé').click();
    await page.route('**/api/automations/templates/utiliser', (route) => route.abort('internetdisconnected'));
    await fenetre.getByRole('button', { name: 'Utiliser ce modèle', exact: true }).click();
    const toast = page.locator('[data-sonner-toast]').first();
    await expect(toast).toBeVisible();
    await page.screenshot({ path: `${CAPTURES}/mod-029-coupure-reseau.png` });
    await expect(toast).not.toContainText('Failed to fetch');
    await expect(toast).toContainText(/Connexion perdue|réseau|Impossible/);
    expect(await copies.nouvelles()).toHaveLength(0);
  });
});

test.describe('bibliothèque — chargement et panne', () => {
  test('[MOD-026] panne du catalogue : message clair, « Réessayer » recharge et la liste revient', async ({ page, moniteur }) => {
    moniteur.attendu(/500 GET .*\/api\/automations\/templates/, 'panne simulée par page.route');
    moniteur.attendu(/\[bibliotheque-modeles\] chargement/, 'le composant journalise l’échec');
    await ouvrirListe(page);
    let appels = 0;
    await page.route('**/api/automations/templates', (route) => {
      appels += 1;
      return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Impossible de lire les modèles pour le moment.' }) });
    });
    await page.getByRole('button', { name: 'Créer', exact: true }).click();
    await page.getByRole('menuitem', { name: /Partir d’un modèle/ }).click();
    const fenetre = bibliotheque(page);
    await expect(fenetre.getByText('Impossible de charger les modèles.')).toBeVisible();
    await expect(fenetre.getByText('Impossible de lire les modèles pour le moment.')).toBeVisible();
    await page.screenshot({ path: `${CAPTURES}/mod-026-panne.png` });
    const avant = appels;
    await fenetre.getByRole('button', { name: 'Réessayer', exact: true }).click();
    await expect.poll(() => appels).toBeGreaterThan(avant);
    await expect(fenetre.getByText('Impossible de charger les modèles.')).toBeVisible();
    await page.unroute('**/api/automations/templates');
    await fenetre.getByRole('button', { name: 'Réessayer', exact: true }).click();
    await expect(fenetre.getByText(/Affichage de \d+ modèles/)).toBeVisible();
    expect(await nombreAffiche(fenetre)).toBe(TOTAL);
    await expect(fenetre.getByText('Impossible de charger les modèles.')).toBeHidden();
  });

  test('[MOD-026] coupure réseau au chargement : la raison affichée est en français, pas « Failed to fetch » @defaut', async ({ page, moniteur }) => {
    moniteur.attendu(/GET .*\/api\/automations\/templates — /, 'coupure simulée par page.route');
    moniteur.attendu(/\[bibliotheque-modeles\] chargement/, 'le composant journalise l’échec');
    await ouvrirListe(page);
    await page.route('**/api/automations/templates', (route) => route.abort('internetdisconnected'));
    await page.getByRole('button', { name: 'Créer', exact: true }).click();
    await page.getByRole('menuitem', { name: /Partir d’un modèle/ }).click();
    const fenetre = bibliotheque(page);
    await expect(fenetre.getByText('Impossible de charger les modèles.')).toBeVisible();
    await page.screenshot({ path: `${CAPTURES}/mod-026-coupure-reseau.png` });
    await expect(fenetre).not.toContainText('Failed to fetch');
  });

  test('[MOD-026] pendant le chargement, la fenêtre montre des cartes d’attente, pas un écran vide', async ({ page }) => {
    await ouvrirListe(page);
    let lacher: () => void = () => undefined;
    const retenue = new Promise<void>((r) => { lacher = r; });
    await page.route('**/api/automations/templates', async (route) => { await retenue; await route.continue(); });
    await page.getByRole('button', { name: 'Créer', exact: true }).click();
    await page.getByRole('menuitem', { name: /Partir d’un modèle/ }).click();
    const fenetre = bibliotheque(page);
    await expect(fenetre.locator('[aria-busy="true"]')).toBeVisible();
    await expect(fenetre.locator('.animate-pulse')).toHaveCount(6);
    lacher();
    await expect(fenetre.getByText(/Affichage de \d+ modèles/)).toBeVisible();
    await expect(fenetre.locator('[aria-busy="true"]')).toHaveCount(0);
  });
});

test.describe('bibliothèque — anglais', () => {
  test.use({ langue: 'en' });

  test('[MOD-001][MOD-005][MOD-015][MOD-016][MOD-028][MOD-029] tous les libellés de la fenêtre sont en anglais', async ({ page }) => {
    await page.goto('/automations');
    await expect(page.getByRole('heading', { name: 'Workflows list' })).toBeVisible({ timeout: 90_000 });
    await page.getByRole('button', { name: 'Create workflow' }).click();
    await page.getByRole('menuitem', { name: /Start from a template/ }).click();
    const fenetre = page.getByRole('dialog', { name: 'Template library' });
    await expect(fenetre.getByText(`Showing ${TOTAL} templates`)).toBeVisible({ timeout: 30_000 });
    await expect(fenetre.getByRole('button', { name: 'All templates', exact: true })).toBeVisible();
    await expect(fenetre.getByRole('button', { name: 'Categories', exact: true })).toBeVisible();
    await expect(fenetre.getByRole('button', { name: 'Show more', exact: true })).toBeVisible();
    await expect(fenetre.getByRole('searchbox', { name: 'Search templates' })).toHaveAttribute('placeholder', 'Search');
    await expect(fenetre.getByRole('combobox', { name: 'Sort' }).locator('option')).toHaveText(['Most recent', 'Name (A–Z)', 'Number of steps']);
    await expect(fenetre.getByRole('button', { name: 'Grid', exact: true })).toBeVisible();
    await expect(fenetre.getByRole('button', { name: 'List', exact: true })).toBeVisible();
    await expect(fenetre.getByRole('button', { name: 'Close', exact: true })).toBeVisible();
    expect((await nomsAffiches(fenetre)).sort()).toEqual(MODELES.map((m) => m.nom.en).sort());
    await fenetre.getByRole('searchbox', { name: 'Search templates' }).fill('zzz');
    await expect(fenetre.getByText('No templates found')).toBeVisible();
    await fenetre.getByRole('button', { name: 'Reset filters', exact: true }).click();
    await carteModele(fenetre, 'Contract signed').click();
    await expect(fenetre.getByText('Trigger', { exact: true })).toBeVisible();
    await expect(fenetre.getByText('No conditions.')).toBeVisible();
    await expect(fenetre.getByRole('button', { name: 'Back', exact: true })).toBeVisible();
    await expect(fenetre.getByRole('button', { name: 'Use this template', exact: true })).toBeVisible();
  });

  test('[MOD-026] en anglais, la raison d’une panne du catalogue est en anglais @defaut', async ({ page, moniteur }) => {
    moniteur.attendu(/502 GET .*\/api\/automations\/templates/, 'panne simulée par page.route (passerelle, corps non JSON)');
    moniteur.attendu(/\[bibliotheque-modeles\] chargement/, 'le composant journalise l’échec');
    await page.goto('/automations');
    await expect(page.getByRole('heading', { name: 'Workflows list' })).toBeVisible({ timeout: 90_000 });
    await page.route('**/api/automations/templates', (route) => route.fulfill({ status: 502, contentType: 'text/html', body: '<html>Bad gateway</html>' }));
    await page.getByRole('button', { name: 'Create workflow' }).click();
    await page.getByRole('menuitem', { name: /Start from a template/ }).click();
    const fenetre = page.getByRole('dialog', { name: 'Template library' });
    await expect(fenetre.getByText('Could not load the templates.')).toBeVisible();
    await page.screenshot({ path: `${CAPTURES}/mod-026-panne-anglais.png` });
    await expect(fenetre).not.toContainText('Impossible de charger les modèles.');
  });
});

test.describe('bibliothèque — vocabulaire', () => {
  test('[MOD-001] l’onglet de la liste et la bibliothèque ne portent pas le même nom (« Modèles ») pour deux choses différentes', async ({ page }) => {
    // Piste S-34 : l'onglet « Modèles » liste les automatisations FOURNIES non publiées (on les modifie en place) ;
    // la « Bibliothèque de modèles » crée une COPIE en brouillon. Deux gestes différents, un seul mot.
    const fenetre = await ouvrirBibliotheque(page);
    await expect(fenetre.getByRole('heading', { name: 'Bibliothèque de modèles' })).toBeVisible();
    await fenetre.getByRole('button', { name: 'Fermer', exact: true }).click();
    await page.screenshot({ path: `${CAPTURES}/mod-001-deux-modeles.png` });
    // Depuis 56f5f820 l'onglet de la liste s'appelle « Prêtes à publier » : on vérifie qu'il est LÀ sous ce nom,
    // pour que l'absence de « Modèles » ne soit pas constatée sur une barre d'onglets pas encore affichée.
    await expect(page.getByRole('tab', { name: /^Prêtes à publier/ })).toBeVisible();
    await expect(page.getByRole('tab', { name: /^Modèles/ })).toHaveCount(0, { timeout: 3_000 });
  });
});
