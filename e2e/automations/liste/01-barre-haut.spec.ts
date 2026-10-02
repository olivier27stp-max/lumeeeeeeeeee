/**
 * LISTE — la barre du haut de `/automations`.
 *
 * Ce que ce fichier prouve :
 *  · la sous-navigation mène à la Vue d'ensemble et aux Réglages globaux ;
 *  · « Tout arrêter » demande confirmation, met VRAIMENT le bureau en pause
 *    (base), l'écran le dit partout (bandeau, étiquette de chaque ligne
 *    publiée), et « Reprendre » remet tout en marche ;
 *  · la bascule FR / EN des messages écrit le réglage du bureau et le relit ;
 *  · un rôle sans le droit d'administrateur reçoit une explication, pas un
 *    faux succès ;
 *  · « Construire avec Lumi » et les trois choix du menu « Créer » mènent où
 *    ils le disent, sans rien créer en base ;
 *  · l'écran « Fonctionnalité premium » d'un forfait sans automatisations.
 *
 * Les réglages qui valent pour tout le bureau (pause, langue) sont remis dans
 * leur état d'origine après chaque test (voir `_aides.ts`).
 */
import {
  test, expect, creerRegle, ouvrirListe, chercher, ligne, toast, boutonActions, compterRegles, reglagesBureau, attendre,
  attendreDroitsServeur,
} from './_aides';

test.describe('sous-navigation', () => {
  test('[LST-002] « Vue d’ensemble » ouvre /automations/apercu', async ({ page }) => {
    await ouvrirListe(page);
    // La sous-navigation est faite de LIENS (src/components/automations/SousNavigation.tsx) ; la pastille « Bêta » est dans le lien.
    const lien = page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: /Vue d’ensemble/ });
    await expect(lien).toContainText('Bêta');
    await expect(lien).toHaveAttribute('href', '/automations/apercu');
    await lien.click();
    await expect(page).toHaveURL(/\/automations\/apercu$/);
    await expect(page.getByText('Accès restreint')).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 2 }).first()).toBeVisible();
  });

  test('[LST-003] « Réglages globaux » ouvre /automations/reglages', async ({ page }) => {
    await ouvrirListe(page);
    const lien = page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: 'Réglages globaux' });
    await expect(lien).toHaveAttribute('href', '/automations/reglages');
    await lien.click();
    await expect(page).toHaveURL(/\/automations\/reglages$/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByText('Accès restreint')).toHaveCount(0);
  });

  test('[LST-002][LST-003] S-05 : la section courante est annoncée (aria-current) et les autres sont de vrais liens', async ({ page }) => {
    await ouvrirListe(page);
    const nav = page.getByRole('navigation', { name: 'Sections' });
    // Un lien s'ouvre dans un nouvel onglet (Ctrl+clic, clic milieu) ; un bouton, non.
    await expect(nav.getByRole('link', { name: /Vue d’ensemble/ })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Réglages globaux' })).toBeVisible();
    await expect(nav.locator('[aria-current="page"]')).toHaveText('Automatisations');
  });
});

test.describe('« Tout arrêter » et « Reprendre »', () => {
  test('[LST-004][LST-093] « Tout arrêter » demande confirmation ; « Annuler » ne change rien', async ({ page, bureau }) => {
    await ouvrirListe(page);
    await page.getByRole('button', { name: 'Tout arrêter' }).click();
    const dialogue = page.getByRole('dialog', { name: 'Arrêter toutes vos automatisations ?' });
    await expect(dialogue).toBeVisible();
    await expect(dialogue).toContainText('Plus aucun courriel ni texto ne partira automatiquement, et aucune tâche ne sera créée.');
    await expect(dialogue).toContainText('Ce qui est déjà prévu est CONSERVÉ');
    await dialogue.getByRole('button', { name: 'Annuler' }).click();
    await expect(dialogue).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Tout arrêter' })).toBeVisible();
    await expect(page.getByText('Vos automatisations sont en pause.')).toHaveCount(0);
    expect((await reglagesBureau(bureau, bureau.orgA)).automations_paused).toBe(false);
  });

  test('[LST-004][LST-005][LST-094] arrêter puis reprendre : bandeau, étiquette des lignes, base, rechargement', async ({ page, bureau, marque }) => {
    await creerRegle(bureau, bureau.orgA, { name: `${marque} publiee`, is_active: true });
    await creerRegle(bureau, bureau.orgA, { name: `${marque} brouillon`, is_active: false });
    await ouvrirListe(page);
    await chercher(page, marque);
    await expect(ligne(page, `${marque} publiee`).getByText('Publiée', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Tout arrêter' }).click();
    const dialogue = page.getByRole('dialog', { name: 'Arrêter toutes vos automatisations ?' });
    await dialogue.getByRole('button', { name: 'Tout arrêter' }).click();
    await expect(toast(page, 'Automatisations en pause.')).toBeVisible();

    // L'écran : bandeau rouge, plus de lien « Tout arrêter », chaque ligne publiée le dit.
    await expect(page.getByText('Vos automatisations sont en pause.')).toBeVisible();
    await expect(page.getByText('Aucun courriel ni texto ne part. Ce qui était prévu est conservé.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Tout arrêter' })).toHaveCount(0);
    await expect(ligne(page, `${marque} publiee`).getByText('Publiée · en pause', { exact: true })).toBeVisible();
    await expect(ligne(page, `${marque} brouillon`).getByText('Brouillon', { exact: true })).toBeVisible();

    // La base : en pause, depuis quand, par qui.
    const enPause = await reglagesBureau(bureau, bureau.orgA);
    expect(enPause.automations_paused).toBe(true);
    expect(enPause.automations_paused_at).not.toBeNull();
    expect(enPause.automations_paused_by).toBe(bureau.comptes.proprioA.id);
    // Le bureau voisin n'est pas touché.
    expect((await reglagesBureau(bureau, bureau.orgB)).automations_paused).toBe(false);

    // Après rechargement, l'écran dit toujours la vérité.
    await page.reload();
    await expect(page.getByText('Vos automatisations sont en pause.')).toBeVisible({ timeout: 60_000 });
    await chercher(page, marque);
    await expect(ligne(page, `${marque} publiee`).getByText('Publiée · en pause', { exact: true })).toBeVisible();

    // Reprendre : sans confirmation.
    await page.getByRole('button', { name: 'Reprendre' }).click();
    await expect(toast(page, 'Automatisations reprises.')).toBeVisible();
    await expect(page.getByText('Vos automatisations sont en pause.')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Tout arrêter' })).toBeVisible();
    await expect(ligne(page, `${marque} publiee`).getByText('Publiée', { exact: true })).toBeVisible();
    const repris = await reglagesBureau(bureau, bureau.orgA);
    expect(repris.automations_paused).toBe(false);
    expect(repris.automations_paused_at).toBeNull();
    expect(repris.automations_paused_by).toBeNull();
  });

  test('[LST-004] des clics répétés sur « Tout arrêter » ne lancent jamais deux arrêts : une seule requête après confirmation', async ({ page, bureau }) => {
    await ouvrirListe(page);
    const demandes: string[] = [];
    page.on('request', (r) => { if (r.method() === 'POST' && r.url().endsWith('/api/automations/pause')) demandes.push(r.url()); });
    await page.getByRole('button', { name: 'Tout arrêter' }).dblclick();
    // Un double clic ne confirme jamais à la place de l'utilisateur : la confirmation est posée, UNE fois, et attend
    // (elle ne s'annule plus sous le second clic : src/components/automations/confirmerSansDoubleClic.ts).
    const dialogue = page.getByRole('dialog', { name: 'Arrêter toutes vos automatisations ?' });
    await expect(dialogue).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(1);
    expect(demandes).toHaveLength(0);
    expect((await reglagesBureau(bureau, bureau.orgA)).automations_paused).toBe(false);

    await dialogue.getByRole('button', { name: 'Tout arrêter' }).click();
    await expect(toast(page, 'Automatisations en pause.')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(demandes).toHaveLength(1);
    expect((await reglagesBureau(bureau, bureau.orgA)).automations_paused).toBe(true);
  });

  test('[LST-004][LST-096] un double clic sur « Tout arrêter » laisse la confirmation à l’écran', async ({ page }) => {
    await ouvrirListe(page);
    await page.getByRole('button', { name: 'Tout arrêter' }).dblclick();
    // Le premier clic ouvre le dialogue, le second tombe sur son fond et l'annule : à l'écran, « rien ne se passe ».
    await expect(page.getByRole('dialog', { name: 'Arrêter toutes vos automatisations ?' })).toBeVisible({ timeout: 5_000 });
  });

  test('[LST-004] S-27 : si l’état de pause est illisible, l’écran le dit au lieu de faire disparaître « Tout arrêter »', async ({ page, moniteur }) => {
    moniteur.attendu(/500 GET \/api\/automations\/pause/, 'panne simulée de la lecture de la pause');
    // La panne est aussi consignée dans la console (BandeauPause.tsx) : attendu, puisqu'on la provoque.
    moniteur.attendu(/\[BandeauPause\] état de la pause illisible/, 'journal de la panne simulée');
    let enPanne = true;
    await page.route('**/api/automations/pause', (r) => (enPanne && r.request().method() === 'GET'
      ? r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Impossible de lire l’état des automatisations.' }) })
      : r.continue()));
    await ouvrirListe(page);
    await expect(page.getByRole('table')).toBeVisible();
    // Le bouton d'urgence ne disparaît pas sans un mot : l'écran dit qu'il ne sait pas, et l'arrêt reste sous la main.
    const etat = page.getByRole('status').filter({ hasText: 'Impossible de savoir si vos automatisations sont en pause pour le moment.' });
    await expect(etat).toBeVisible();
    await expect(etat.getByRole('button', { name: 'Tout arrêter' })).toBeEnabled();
    // Aucune affirmation dans un sens ou dans l'autre tant que l'état est inconnu.
    await expect(page.getByText('Vos automatisations sont en pause.')).toHaveCount(0);
    // « Réessayer » relit l'état : la lecture rétablie, l'écran redevient normal.
    enPanne = false;
    await etat.getByRole('button', { name: 'Réessayer' }).click();
    await expect(etat).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Tout arrêter' })).toBeVisible();
  });
});

test.describe('langue des messages FR / EN', () => {
  test('[LST-006][LST-007] EN puis FR : toast, base, relecture après rechargement', async ({ page, bureau }) => {
    await ouvrirListe(page);
    const fr = page.getByRole('button', { name: 'FR', exact: true });
    const en = page.getByRole('button', { name: 'EN', exact: true });
    await expect(page.getByText('Messages en', { exact: true })).toBeVisible();
    // Le bouton actif est le bouton sombre (aucun attribut d'état : voir le test d'accessibilité).
    await expect(fr).toHaveClass(/bg-text-primary/);
    await expect(en).not.toHaveClass(/bg-text-primary/);

    await en.click();
    await expect(toast(page, 'Messages en anglais')).toBeVisible();
    await expect(en).toHaveClass(/bg-text-primary/);
    expect((await reglagesBureau(bureau, bureau.orgA)).default_language).toBe('en');
    expect((await reglagesBureau(bureau, bureau.orgB)).default_language).toBe('fr');

    await page.reload();
    await expect(page.getByRole('button', { name: 'EN', exact: true })).toHaveClass(/bg-text-primary/, { timeout: 60_000 });
    // L'interface, elle, reste en français : seule la langue des MESSAGES a changé.
    await expect(page.getByRole('heading', { name: 'Mes automatisations' })).toBeVisible();

    await page.getByRole('button', { name: 'FR', exact: true }).click();
    await expect(toast(page, 'Messages en français')).toBeVisible();
    await expect(page.getByRole('button', { name: 'FR', exact: true })).toHaveClass(/bg-text-primary/);
    expect((await reglagesBureau(bureau, bureau.orgA)).default_language).toBe('fr');
  });

  test('[LST-006] cliquer la langue déjà active ne fait rien (ni requête, ni toast)', async ({ page, bureau }) => {
    await ouvrirListe(page);
    const ecritures: string[] = [];
    page.on('request', (r) => { if (r.method() === 'PATCH' && r.url().includes('/rest/v1/company_settings')) ecritures.push(r.url()); });
    await page.getByRole('button', { name: 'FR', exact: true }).click();
    await page.getByRole('button', { name: 'EN', exact: true }).click();
    await expect(toast(page, 'Messages en anglais')).toBeVisible();
    expect(ecritures).toHaveLength(1);
    await expect(toast(page, 'Messages en français')).toHaveCount(0);
    expect((await reglagesBureau(bureau, bureau.orgA)).default_language).toBe('en');
  });

  test('[LST-006][LST-007] pendant l’enregistrement, les deux boutons sont désactivés (pas de double écriture)', async ({ page, bureau }) => {
    let liberer: () => void = () => undefined;
    const barriere = new Promise<void>((ok) => { liberer = ok; });
    const ecritures: string[] = [];
    await page.route('**/rest/v1/company_settings?*', async (route) => {
      if (route.request().method() !== 'PATCH') return route.continue();
      ecritures.push(route.request().postData() ?? '');
      await barriere;
      await route.continue();
    });
    await ouvrirListe(page);
    const fr = page.getByRole('button', { name: 'FR', exact: true });
    const en = page.getByRole('button', { name: 'EN', exact: true });
    await en.click();
    await expect(en).toBeDisabled();
    await expect(fr).toBeDisabled();
    // Aucun succès annoncé avant la réponse du serveur.
    await expect(toast(page, 'Messages en anglais')).toHaveCount(0);
    liberer();
    await expect(toast(page, 'Messages en anglais')).toBeVisible();
    await expect(en).toBeEnabled();
    expect(ecritures).toHaveLength(1);
    expect(JSON.parse(ecritures[0])).toEqual({ default_language: 'en' });
    expect((await reglagesBureau(bureau, bureau.orgA)).default_language).toBe('en');
  });

  test('[LST-006] S-31 : si la langue du bureau est illisible, l’écran ne surligne pas « FR » par défaut', async ({ page, bureau, moniteur }) => {
    await bureau.admin.from('company_settings').update({ default_language: 'en' }).eq('org_id', bureau.orgA);
    moniteur.attendu(/500 GET .*\/rest\/v1\/company_settings\?select=default_language/, 'panne simulée de la lecture de la langue');
    // La panne est aussi consignée dans la console (Automations.tsx) : attendu, puisqu'on la provoque.
    moniteur.attendu(/\[automations\] langue des messages illisible/, 'journal de la panne simulée');
    await page.route('**/rest/v1/company_settings?select=default_language*', (route) => route.fulfill({
      status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'panne simulée' }),
    }));
    await ouvrirListe(page);
    await expect(page.getByRole('table')).toBeVisible();
    // Le bureau écrit à ses clients en ANGLAIS, et l'écran n'en sait rien : il le dit, et ne surligne AUCUNE langue.
    await expect(page.getByRole('status').filter({ hasText: 'Langue actuelle inconnue' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'FR', exact: true })).not.toHaveClass(/bg-text-primary/, { timeout: 5_000 });
    await expect(page.getByRole('button', { name: 'FR', exact: true })).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByRole('button', { name: 'EN', exact: true })).not.toHaveClass(/bg-text-primary/);
    await expect(page.getByRole('button', { name: 'EN', exact: true })).toHaveAttribute('aria-pressed', 'false');
  });

  test('[LST-006][LST-007] S-51 : les boutons FR / EN exposent leur état (aria-pressed) et leur groupe', async ({ page }) => {
    await ouvrirListe(page);
    await expect(page.getByRole('button', { name: 'FR', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'EN', exact: true })).toHaveAttribute('aria-pressed', 'false');
    // Pour un lecteur d'écran, « FR » seul ne dit pas de quoi il s'agit.
    await expect(page.getByRole('group', { name: /Messages en|Langue des messages/ })).toBeVisible();
  });
});

test.describe('rôle sans droit d’administrateur (automations.update seulement)', () => {
  test.use({ compte: 'techA' });

  test('[LST-004][LST-006] le refus du serveur est expliqué et rien ne change en base', async ({ page, bureau, moniteur, jetonDe, baseURL }) => {
    const { data: avant } = await bureau.admin.from('memberships').select('permissions')
      .eq('org_id', bureau.orgA).eq('user_id', bureau.comptes.techA.id).single();
    await bureau.admin.from('memberships').update({ permissions: { 'automations.read': true, 'automations.update': true } })
      .eq('org_id', bureau.orgA).eq('user_id', bureau.comptes.techA.id);
    try {
      // Le serveur garde les droits d'un membre 60 s en mémoire : on attend qu'il applique ceux-ci (voir `attendreDroitsServeur`).
      await attendreDroitsServeur(String(baseURL), await jetonDe('techA'), bureau.orgA, { voir: true, modifier: true });
      moniteur.attendu(/403 POST \/api\/automations\/pause/, 'la pause globale est réservée à un administrateur');
      moniteur.attendu(/\[automations\] langue des messages/, 'journal du refus de changer la langue');
      moniteur.attendu(/\[BandeauPause\] bascule de la pause/, 'journal du refus de la pause');
      await ouvrirListe(page);
      await expect(page.getByRole('table')).toBeVisible();

      // Langue : la RLS ne laisse rien écrire, l'écran doit le dire.
      await page.getByRole('button', { name: 'EN', exact: true }).click();
      await expect(toast(page, 'Seul un administrateur peut changer la langue des messages. Rien n’a été modifié.')).toBeVisible();
      await expect(page.getByRole('button', { name: 'FR', exact: true })).toHaveClass(/bg-text-primary/);
      expect((await reglagesBureau(bureau, bureau.orgA)).default_language).toBe('fr');

      // Pause : idem.
      await page.getByRole('button', { name: 'Tout arrêter' }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Tout arrêter' }).click();
      await expect(toast(page, 'Seul un administrateur peut arrêter les automatisations. Rien n’a été arrêté.')).toBeVisible();
      await expect(page.getByText('Vos automatisations sont en pause.')).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Tout arrêter' })).toBeVisible();
      expect((await reglagesBureau(bureau, bureau.orgA)).automations_paused).toBe(false);
    } finally {
      await bureau.admin.from('memberships').update({ permissions: avant?.permissions ?? null })
        .eq('org_id', bureau.orgA).eq('user_id', bureau.comptes.techA.id);
    }
  });
});

test.describe('« Construire avec Lumi » et le menu « Créer »', () => {
  test('[LST-014] « Construire avec Lumi » ouvre l’éditeur côté Lumi, sans rien créer en base', async ({ page, bureau }) => {
    const avant = await compterRegles(bureau, bureau.orgA);
    await ouvrirListe(page);
    await page.getByRole('button', { name: 'Construire avec Lumi' }).click();
    await expect(page).toHaveURL(/\/automations\/nouvelle\?lumi=1$/);
    await expect(page.getByText('Décris ton automatisation à Lumi')).toBeVisible({ timeout: 60_000 });
    expect(await compterRegles(bureau, bureau.orgA)).toBe(avant);
  });

  test('[LST-015] « Créer » ouvre un menu de trois choix, et le referme au second clic', async ({ page }) => {
    await ouvrirListe(page);
    const creer = page.getByRole('button', { name: 'Créer', exact: true });
    await expect(creer).toHaveAttribute('aria-haspopup', 'menu');
    await expect(creer).toHaveAttribute('aria-expanded', 'false');
    await creer.click();
    await expect(creer).toHaveAttribute('aria-expanded', 'true');
    const menu = page.getByRole('menu');
    await expect(menu.getByRole('menuitem')).toHaveCount(3);
    await expect(menu.getByRole('menuitem').nth(0)).toHaveText(/Partir de zéro\s*Un parcours vide, à construire\./);
    await expect(menu.getByRole('menuitem').nth(1)).toHaveText(/Construire avec Lumi\s*Décris ce que tu veux, Lumi le monte\. Inclus dans Autopilot\./);
    await expect(menu.getByRole('menuitem').nth(2)).toHaveText(/Partir d’un modèle\s*Une bibliothèque de modèles prêts à l’emploi\./);
    await creer.click();
    await expect(menu).toHaveCount(0);
    await expect(creer).toHaveAttribute('aria-expanded', 'false');
  });

  test('[LST-016] « Partir de zéro » ouvre un éditeur vide, sans rien créer en base', async ({ page, bureau }) => {
    const avant = await compterRegles(bureau, bureau.orgA);
    await ouvrirListe(page);
    await page.getByRole('button', { name: 'Créer', exact: true }).click();
    await page.getByRole('menuitem', { name: /Partir de zéro/ }).click();
    await expect(page).toHaveURL(/\/automations\/nouvelle$/);
    await expect(page.getByRole('tab', { name: 'Parcours' })).toBeVisible({ timeout: 60_000 });
    expect(await compterRegles(bureau, bureau.orgA)).toBe(avant);
  });

  test('[LST-017] « Construire avec Lumi » (menu) ouvre l’éditeur côté Lumi', async ({ page, bureau }) => {
    const avant = await compterRegles(bureau, bureau.orgA);
    await ouvrirListe(page);
    await page.getByRole('button', { name: 'Créer', exact: true }).click();
    await page.getByRole('menuitem', { name: /Construire avec Lumi/ }).click();
    await expect(page).toHaveURL(/\/automations\/nouvelle\?lumi=1$/);
    await expect(page.getByText('Décris ton automatisation à Lumi')).toBeVisible({ timeout: 60_000 });
    expect(await compterRegles(bureau, bureau.orgA)).toBe(avant);
  });

  test('[LST-018] « Partir d’un modèle » ouvre la bibliothèque ; Échap la ferme et rend le focus à « Créer »', async ({ page, bureau }) => {
    const avant = await compterRegles(bureau, bureau.orgA);
    await ouvrirListe(page);
    const creer = page.getByRole('button', { name: 'Créer', exact: true });
    await creer.click();
    await page.getByRole('menuitem', { name: /Partir d’un modèle/ }).click();
    await expect(page.getByRole('menu')).toHaveCount(0);
    const bibliotheque = page.getByRole('dialog');
    await expect(bibliotheque).toBeVisible();
    await expect(bibliotheque).toContainText(/modèle/i);
    // On reste sur la liste : rien n'est créé tant qu'aucun modèle n'est choisi.
    await expect(page).toHaveURL(/\/automations$/);
    await page.keyboard.press('Escape');
    await expect(bibliotheque).toHaveCount(0);
    await expect(creer).toBeFocused();
    expect(await compterRegles(bureau, bureau.orgA)).toBe(avant);
  });

  test('[LST-019] un clic ailleurs ferme le menu « Créer » comme le menu ⋮ d’une ligne', async ({ page, bureau, marque }) => {
    await creerRegle(bureau, bureau.orgA, { name: `${marque} a` });
    await ouvrirListe(page);
    await chercher(page, marque);
    await page.getByRole('button', { name: 'Créer', exact: true }).click();
    await expect(page.getByRole('menu')).toBeVisible();
    await page.getByRole('heading', { name: 'Mes automatisations' }).click();
    await expect(page.getByRole('menu')).toHaveCount(0);

    await boutonActions(page, `${marque} a`).click();
    await expect(page.getByRole('menu')).toBeVisible();
    await page.getByRole('heading', { name: 'Mes automatisations' }).click();
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(boutonActions(page, `${marque} a`)).toHaveAttribute('aria-expanded', 'false');
  });

  test('[LST-015][LST-076] S-09 : ouvrir « Créer » referme le menu ⋮ resté ouvert (un seul menu à la fois)', async ({ page, bureau, marque }) => {
    await creerRegle(bureau, bureau.orgA, { name: `${marque} a` });
    await ouvrirListe(page);
    await chercher(page, marque);
    await boutonActions(page, `${marque} a`).click();
    await expect(page.getByRole('menu')).toHaveCount(1);
    await page.getByRole('button', { name: 'Créer', exact: true }).click();
    await expect(page.getByRole('menuitem', { name: /Partir de zéro/ })).toBeVisible();
    await expect(page.getByRole('menu')).toHaveCount(1);
  });
});

test.describe('forfait sans automatisations', () => {
  test('[LST-001] « Fonctionnalité premium » : la fenêtre de forfait s’ouvre seule, « Voir les détails » la rouvre', async ({ page }) => {
    // Le forfait du bureau de test inclut les automatisations : on rend la réponse
    // de facturation telle qu'elle serait pour un forfait qui ne les inclut pas.
    await page.route('**/api/billing/current', async (route) => {
      const r = await route.fetch({ timeout: 90_000 });
      const j = await r.json() as { subscription: { plans?: Record<string, unknown>; plan_id?: string } | null; feature_overrides?: Record<string, boolean> };
      if (j.subscription?.plans) { j.subscription.plans.includes_automations = false; j.subscription.plans.slug = 'starter'; }
      if (j.feature_overrides) delete j.feature_overrides.includes_automations;
      await route.fulfill({ response: r, json: j });
    });
    await page.goto('/automations');
    await expect(page.getByText('Fonctionnalité premium').first()).toBeVisible({ timeout: 90_000 });
    await expect(page.getByText('Passez à un forfait supérieur pour accéder à cette section.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Mes automatisations' })).toHaveCount(0);
    // La fenêtre de forfait s'est ouverte d'elle-même. Sa croix s'appelle « Fermer » en français
    // (PlanUpgradeModal.tsx, #870 — elle disait « Close » dans les deux langues).
    const fermer = page.getByRole('button', { name: 'Fermer', exact: true });
    await expect(fermer).toBeVisible();
    await expect(page.getByRole('button', { name: 'Close' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Automatisations', level: 2 })).toBeVisible();
    await fermer.click();
    await expect(fermer).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Automatisations', level: 2 })).toHaveCount(0);
    await page.getByRole('button', { name: 'Voir les détails' }).click();
    await expect(page.getByRole('button', { name: 'Fermer', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Automatisations', level: 2 })).toBeVisible();
  });
});

test('[LST-014] attendre : le compte de règles reste stable après un aller-retour vers l’éditeur vide', async ({ page, bureau }) => {
  const avant = await compterRegles(bureau, bureau.orgA);
  await ouvrirListe(page);
  await page.getByRole('button', { name: 'Construire avec Lumi' }).click();
  await expect(page).toHaveURL(/nouvelle\?lumi=1$/);
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Mes automatisations' })).toBeVisible({ timeout: 60_000 });
  await attendre(() => compterRegles(bureau, bureau.orgA), (n) => n === avant, 5_000);
});
