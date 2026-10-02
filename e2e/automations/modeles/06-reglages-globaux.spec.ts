/**
 * Réglages globaux `/automations/reglages` et « adresses d'appel » (webhooks
 * entrants) — REG-001 à REG-010.
 *
 * Ce que ce fichier prouve : la sous-navigation ; la carte « Langue des
 * messages » dit la langue réellement en vigueur et mène à l'endroit où on la
 * change ; pour les adresses d'appel, CHAQUE action change la base comme
 * l'écran l'annonce — créer, mettre en pause, reprendre, afficher / masquer,
 * copier (le presse-papiers reçoit l'URL affichée), régénérer (l'ancienne clé
 * n'existe plus), supprimer — et chaque panne est dite.
 *
 * L'adresse d'appel elle-même n'est JAMAIS appelée ici (un autre lot s'en charge).
 */
import type { Locator, Page } from '@playwright/test';
import { test, expect, ouvrirListe, remettreReglagesBureau, CAPTURES } from './aides';

// Poste et staging partagés par plusieurs passes : les chargements sont lents par moments.
test.describe.configure({ timeout: 240_000 });

async function ouvrirReglages(page: Page): Promise<void> {
  await page.goto('/automations/reglages');
  await expect(page.getByRole('button', { name: /^(Créer une adresse|Create an address)$/ })).toBeVisible({ timeout: 90_000 });
}

/** La carte d'un réglage, par son titre. */
const carte = (page: Page, titre: string): Locator => page.locator('section').filter({ has: page.getByRole('heading', { name: titre, exact: true }) });
const cartesAdresses = (page: Page): Locator => carte(page, 'Adresses d’appel');
/** Les lignes d'adresse : chacune contient son URL dans un bloc `code`. */
const lignes = (page: Page): Locator => cartesAdresses(page).locator('code').locator('xpath=ancestor::div[contains(@class,"rounded-lg")][1]');
const urlAffichee = (ligne: Locator): Locator => ligne.locator('code');
const origine = (page: Page) => new URL(page.url()).origin;

test.describe('réglages globaux — page et navigation', () => {
  test('[REG-001][REG-002] la sous-navigation : « Réglages globaux » est la section courante ; « Automatisations » ouvre la liste, « Vue d’ensemble » l’aperçu', async ({ page }) => {
    await ouvrirReglages(page);
    await expect(page.getByRole('heading', { name: 'Réglages globaux', level: 1 })).toBeVisible();
    // Depuis #870 la sous-navigation est faite de trois LIENS (SousNavigation.tsx) ; la section
    // courante est annoncée par aria-current="page", les deux autres ne le portent pas.
    const nav = page.getByRole('navigation', { name: 'Sections' });
    await expect(nav.getByRole('link')).toHaveText(['Automatisations', /^Vue d’ensemble\s*Bêta$/, 'Réglages globaux']);
    await expect(nav.getByRole('button')).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Réglages globaux', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(nav.locator('[aria-current]')).toHaveCount(1);
    await nav.getByRole('link', { name: /^Vue d’ensemble/ }).click();
    await expect(page).toHaveURL(/\/automations\/apercu$/);
    await expect(page.getByText('Total des automatisations')).toBeVisible({ timeout: 60_000 });
    await page.goBack();
    await expect(page.getByRole('heading', { name: 'Réglages globaux', level: 1 })).toBeVisible();
    await page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: 'Automatisations', exact: true }).click();
    await expect(page).toHaveURL(/\/automations$/);
    await expect(page.getByRole('heading', { name: 'Mes automatisations' })).toBeVisible();
  });

  test('[REG-001] les sept cartes sont là, chacune avec son explication ; aucune ne propose un interrupteur qui ne ferait rien', async ({ page }) => {
    await ouvrirReglages(page);
    for (const titre of ['Langue des messages', 'Notifications', 'Enregistrement automatique', 'Mettre en pause', 'Fenêtre d’envoi', 'Adresses d’appel', 'Lumi']) {
      await expect(carte(page, titre)).toBeVisible();
      await expect(carte(page, titre).locator('p').first()).not.toBeEmpty();
    }
    // Les cartes purement informatives n'ont aucun contrôle.
    for (const titre of ['Notifications', 'Enregistrement automatique', 'Mettre en pause', 'Fenêtre d’envoi', 'Lumi']) {
      await expect(carte(page, titre).getByRole('button')).toHaveCount(0);
      await expect(carte(page, titre).getByRole('switch')).toHaveCount(0);
    }
  });

  test('[REG-002] « Vue d’ensemble » porte la pastille « Bêta » ici comme sur les deux autres écrans', async ({ page }) => {
    await ouvrirReglages(page);
    await expect(page.getByRole('navigation', { name: 'Sections' }).getByText('Bêta')).toBeVisible({ timeout: 3_000 });
  });

  test('[REG-001] la carte « Mettre en pause » parle du bouton « Tout arrêter » de la liste @defaut', async ({ page }) => {
    // La liste offre « Tout arrêter » (pause de TOUTES les automatisations). La carte dit qu'on ne peut que les éteindre une à une.
    await ouvrirListe(page);
    await expect(page.getByRole('button', { name: 'Tout arrêter' })).toBeVisible();
    await ouvrirReglages(page);
    await expect(carte(page, 'Mettre en pause')).toContainText('chaque automatisation se met en pause individuellement');
    await expect(carte(page, 'Mettre en pause')).toContainText(/Tout arrêter/, { timeout: 3_000 });
  });
});

test.describe('réglages globaux — langue des messages', () => {
  test('[REG-003] la carte affiche la langue en vigueur (base) ; « Changer dans les réglages » mène à Paramètres entreprise, où le réglage est bien là', async ({ page, bureau }) => {
    try {
      await ouvrirReglages(page);
      await expect(carte(page, 'Langue des messages').getByText('Français', { exact: true })).toBeVisible();
      await bureau.admin.from('company_settings').update({ default_language: 'en' }).eq('org_id', bureau.orgA);
      await page.reload();
      await expect(page.getByRole('button', { name: 'Créer une adresse' })).toBeVisible({ timeout: 90_000 });
      await expect(carte(page, 'Langue des messages').getByText('English', { exact: true })).toBeVisible();
      await carte(page, 'Langue des messages').getByRole('button', { name: 'Changer dans les réglages' }).click();
      await expect(page).toHaveURL(/\/settings\/company$/);
      await expect(page.getByRole('heading', { name: 'Langue de vos clients' })).toBeVisible({ timeout: 60_000 });
      await expect(page.getByRole('button', { name: 'English', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByRole('button', { name: 'Français', exact: true })).toHaveAttribute('aria-pressed', 'false');
    } finally {
      await remettreReglagesBureau(bureau);
    }
  });

  test('[REG-003] la langue changée depuis la liste (FR / EN) se lit aussitôt dans la carte', async ({ page, bureau }) => {
    try {
      await ouvrirListe(page);
      await page.getByRole('button', { name: 'EN', exact: true }).click();
      await expect(page.getByText('Messages en anglais')).toBeVisible();
      await expect.poll(async () => (await bureau.admin.from('company_settings').select('default_language').eq('org_id', bureau.orgA).single()).data?.default_language).toBe('en');
      // « Réglages globaux » est un lien de la sous-navigation depuis #870.
      await page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: 'Réglages globaux', exact: true }).click();
      await expect(page).toHaveURL(/\/automations\/reglages$/);
      await expect(carte(page, 'Langue des messages').getByText('English', { exact: true })).toBeVisible({ timeout: 60_000 });
    } finally {
      await remettreReglagesBureau(bureau);
    }
  });

  test('[REG-003] la carte dit que la langue se règle « une fois » dans Paramètres : la liste n’offre donc pas un second endroit pour la changer @defaut', async ({ page }) => {
    await ouvrirReglages(page);
    await expect(carte(page, 'Langue des messages')).toContainText('définie une fois pour toute l’entreprise dans Paramètres');
    await ouvrirListe(page);
    await page.screenshot({ path: `${CAPTURES}/reg-003-deux-endroits.png` });
    // Deux endroits, deux discours : la liste a son propre sélecteur « Messages en FR / EN ».
    await expect(page.getByRole('button', { name: 'EN', exact: true })).toHaveCount(0, { timeout: 3_000 });
  });

  test('[REG-003] langue illisible : la carte ne prétend pas « Français »', async ({ page, bureau, moniteur }) => {
    moniteur.attendu(/500 GET .*company_settings.*default_language/, 'panne simulée par page.route');
    // Depuis #870 la page ne se tait plus sur cette panne : elle la journalise (AutomationsReglages.tsx,
    // `console.error('[automations/reglages] langue des messages illisible', …)`), comme la vue d'ensemble.
    moniteur.attendu(/\[automations\/reglages\] langue des messages illisible/, 'la page journalise l’échec');
    try {
      await bureau.admin.from('company_settings').update({ default_language: 'en' }).eq('org_id', bureau.orgA);
      await page.route('**/rest/v1/company_settings**', (route) => (route.request().url().includes('select=default_language')
        ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'panne simulée' }) })
        : route.fallback()));
      await ouvrirReglages(page);
      await page.screenshot({ path: `${CAPTURES}/reg-003-langue-illisible.png` });
      // Le bureau écrit en anglais ; la lecture a échoué : afficher « Français » est faux.
      await expect(carte(page, 'Langue des messages').getByText('Français', { exact: true })).toHaveCount(0);
      // Ni l'une ni l'autre langue n'est affirmée : la carte dit qu'elle n'a pas pu lire, et garde le chemin pour la changer.
      await expect(carte(page, 'Langue des messages').getByText('English', { exact: true })).toHaveCount(0);
      await expect(carte(page, 'Langue des messages').getByRole('status')).toHaveText('Impossible de lire la langue pour le moment.');
      await expect(carte(page, 'Langue des messages').getByRole('button', { name: 'Changer dans les réglages' })).toBeVisible();
    } finally {
      await remettreReglagesBureau(bureau);
    }
  });
});

test.describe('adresses d’appel — créer, afficher, copier', () => {
  test('[REG-004] liste vide, puis « Créer une adresse » : message de succès, adresse complète affichée une fois, ligne en base à l’identique', async ({ page, bureau, adresses }) => {
    await ouvrirReglages(page);
    await expect(cartesAdresses(page).getByText('Aucune adresse pour l’instant. Créez-en une, puis collez-la dans votre formulaire, Zapier ou Facebook Leads.')).toBeVisible();
    await expect(lignes(page)).toHaveCount(0);
    await page.getByRole('button', { name: 'Créer une adresse' }).click();
    await expect(page.getByText('Adresse créée.')).toBeVisible();
    await expect(lignes(page)).toHaveCount(1);
    const [enBase, ...autres] = await adresses.lire();
    expect(autres).toHaveLength(0);
    expect(enBase).toMatchObject({ org_id: bureau.orgA, name: 'Formulaire de mon site', enabled: true, deleted_at: null, created_by: bureau.comptes.proprioA.id });
    expect(enBase.api_key).toMatch(/^[0-9a-f]{64}$/);
    const ligne = lignes(page).first();
    await expect(ligne.getByText('Formulaire de mon site')).toBeVisible();
    await expect(urlAffichee(ligne)).toHaveText(`${origine(page)}/api/hooks/${enBase.api_key}`);
    await expect(ligne.getByRole('button', { name: 'Active', exact: true })).toBeVisible();
    await expect(ligne.getByText('Copiez-la maintenant : elle ne sera plus affichée.')).toBeVisible();
    await expect(cartesAdresses(page).getByText(/Aucune adresse pour l’instant/)).toHaveCount(0);
  });

  test('[REG-004] pendant la création, le bouton est désactivé : un double clic ne crée qu’une adresse', async ({ page, adresses }) => {
    await ouvrirReglages(page);
    let lacher: () => void = () => undefined;
    const retenue = new Promise<void>((r) => { lacher = r; });
    await page.route('**/api/automations/webhooks', async (route) => { if (route.request().method() === 'POST') await retenue; await route.fallback(); });
    const creer = page.getByRole('button', { name: 'Créer une adresse' });
    await creer.click();
    await expect(creer).toBeDisabled();
    lacher();
    await expect(page.getByText('Adresse créée.')).toBeVisible();
    await expect(creer).toBeEnabled();
    expect(await adresses.lire()).toHaveLength(1);
  });

  test('[REG-004] refus du serveur à la création : la raison donnée par le serveur est affichée @defaut', async ({ page, adresses, moniteur }) => {
    moniteur.attendu(/403 POST .*\/api\/automations\/webhooks/, 'refus simulé par page.route');
    await ouvrirReglages(page);
    await page.route('**/api/automations/webhooks', (route) => (route.request().method() === 'POST'
      ? route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'Votre rôle ne permet pas de créer une adresse d’appel.' }) })
      : route.fallback()));
    await page.getByRole('button', { name: 'Créer une adresse' }).click();
    const toast = page.locator('[data-sonner-toast]').first();
    await expect(toast).toBeVisible();
    await page.screenshot({ path: `${CAPTURES}/reg-004-refus-sans-raison.png` });
    expect(await adresses.lire()).toHaveLength(0);
    await expect(lignes(page)).toHaveCount(0);
    await expect(toast).toContainText('Votre rôle ne permet pas de créer une adresse d’appel.');
  });

  test('[REG-004] trois adresses créées se distinguent par leur nom (ou peuvent être renommées) @defaut', async ({ page, adresses }) => {
    await ouvrirReglages(page);
    const creer = page.getByRole('button', { name: 'Créer une adresse' });
    for (let i = 1; i <= 3; i += 1) {
      await creer.click();
      await expect(lignes(page)).toHaveCount(i);
      await expect(creer).toBeEnabled();
    }
    await page.screenshot({ path: `${CAPTURES}/reg-004-trois-adresses-meme-nom.png`, fullPage: true });
    const noms = (await adresses.lire()).map((a) => a.name);
    expect(noms).toHaveLength(3);
    // Site, Zapier, Facebook Leads : trois lignes « Formulaire de mon site » sont indiscernables.
    expect(new Set(noms).size, `noms : ${noms.join(' | ')}`).toBe(3);
  });

  test('[REG-007] l’œil masque puis réaffiche l’adresse complète ; masquée, seuls les 4 derniers caractères se lisent', async ({ page, adresses }) => {
    await ouvrirReglages(page);
    await page.getByRole('button', { name: 'Créer une adresse' }).click();
    await expect(lignes(page)).toHaveCount(1);
    const [a] = await adresses.lire();
    const ligne = lignes(page).first();
    const complete = `${origine(page)}/api/hooks/${a.api_key}`;
    const masquee = `${origine(page)}/api/hooks/••••${a.api_key.slice(-4)}`;
    await expect(urlAffichee(ligne)).toHaveText(complete);
    await ligne.getByRole('button', { name: 'Masquer l’adresse' }).click();
    await expect(urlAffichee(ligne)).toHaveText(masquee);
    await expect(ligne).not.toContainText(a.api_key);
    await ligne.getByRole('button', { name: 'Afficher l’adresse' }).click();
    await expect(urlAffichee(ligne)).toHaveText(complete);
    await expect(ligne.getByRole('button', { name: 'Masquer l’adresse' })).toBeVisible();
  });

  test('[REG-008] « Copier » met dans le presse-papiers exactement l’adresse affichée (même masquée), et le confirme d’une coche', async ({ page, context, adresses }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await ouvrirReglages(page);
    await page.getByRole('button', { name: 'Créer une adresse' }).click();
    await expect(lignes(page)).toHaveCount(1);
    const [a] = await adresses.lire();
    const ligne = lignes(page).first();
    const complete = `${origine(page)}/api/hooks/${a.api_key}`;
    await expect(urlAffichee(ligne)).toHaveText(complete);
    const copier = ligne.getByRole('button', { name: 'Copier l’adresse' });
    await copier.click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(complete);
    await expect(copier.locator('svg.text-success')).toBeVisible();
    // Masquée, la copie donne toujours l'adresse complète.
    await page.evaluate(() => navigator.clipboard.writeText(''));
    await ligne.getByRole('button', { name: 'Masquer l’adresse' }).click();
    await copier.click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(complete);
    // La coche redevient l'icône de copie.
    await expect(copier.locator('svg.text-success')).toHaveCount(0, { timeout: 10_000 });
  });

  test('[REG-008] presse-papiers refusé : l’adresse est dévoilée et l’écran dit de la sélectionner', async ({ page, adresses }) => {
    await adresses.lire();
    await ouvrirReglages(page);
    await page.getByRole('button', { name: 'Créer une adresse' }).click();
    await expect(lignes(page)).toHaveCount(1);
    const [a] = await adresses.lire();
    const ligne = lignes(page).first();
    await ligne.getByRole('button', { name: 'Masquer l’adresse' }).click();
    await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('refusé')) } }); });
    await ligne.getByRole('button', { name: 'Copier l’adresse' }).click();
    await expect(page.getByText('Copie impossible : sélectionnez l’adresse affichée.')).toBeVisible();
    await expect(urlAffichee(ligne)).toHaveText(`${origine(page)}/api/hooks/${a.api_key}`);
  });
});

test.describe('adresses d’appel — mettre en pause, reprendre', () => {
  test('[REG-005] « Active » ↔ « En pause » : la base suit, et l’état se relit après rechargement', async ({ page, adresses }) => {
    const a = await adresses.creer();
    await ouvrirReglages(page);
    const ligne = lignes(page).first();
    const lireEtat = async () => (await adresses.lire()).find((x) => x.id === a.id)?.enabled;
    await ligne.getByRole('button', { name: 'Active', exact: true }).click();
    await expect(ligne.getByRole('button', { name: 'En pause', exact: true })).toBeVisible();
    await expect.poll(lireEtat).toBe(false);
    await page.reload();
    await expect(lignes(page).first().getByRole('button', { name: 'En pause', exact: true })).toBeVisible({ timeout: 90_000 });
    await lignes(page).first().getByRole('button', { name: 'En pause', exact: true }).click();
    await expect(lignes(page).first().getByRole('button', { name: 'Active', exact: true })).toBeVisible();
    await expect.poll(lireEtat).toBe(true);
    // La clé n'a pas changé : mettre en pause n'est pas régénérer.
    expect((await adresses.lire())[0].api_key).toBe(a.api_key);
  });

  test('[REG-005] panne à la bascule : l’état affiché revient en arrière et l’échec est dit', async ({ page, adresses, moniteur }) => {
    moniteur.attendu(/500 PATCH .*\/api\/automations\/webhooks\//, 'panne simulée par page.route');
    const a = await adresses.creer();
    await ouvrirReglages(page);
    await page.route('**/api/automations/webhooks/*', (route) => (route.request().method() === 'PATCH'
      ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Impossible de modifier l’adresse d’appel.' }) })
      : route.fallback()));
    const ligne = lignes(page).first();
    await ligne.getByRole('button', { name: 'Active', exact: true }).click();
    await expect(page.getByText('Changement non enregistré.')).toBeVisible();
    await expect(ligne.getByRole('button', { name: 'Active', exact: true })).toBeVisible();
    expect((await adresses.lire()).find((x) => x.id === a.id)?.enabled).toBe(true);
  });

  test('[REG-005] deux clics rapprochés : ce que l’écran affiche à la fin est ce que la base contient @defaut', async ({ page, adresses }) => {
    const a = await adresses.creer();
    await ouvrirReglages(page);
    const ligne = lignes(page).first();
    // Le premier appel (mise en pause) traîne ; le second (reprise) passe devant lui.
    let lacher: () => void = () => undefined;
    const retenue = new Promise<void>((r) => { lacher = r; });
    let n = 0;
    await page.route('**/api/automations/webhooks/*', async (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback();
      n += 1;
      if (n === 1) await retenue;
      return route.continue();
    });
    const reponseA = (enabled: boolean) => page.waitForResponse((r) => r.request().method() === 'PATCH'
      && r.url().includes('/api/automations/webhooks/') && r.request().postDataJSON()?.enabled === enabled);
    const lireEtat = async () => (await adresses.lire()).find((x) => x.id === a.id)?.enabled;
    await ligne.getByRole('button', { name: 'Active', exact: true }).click();
    const reprise = reponseA(true);
    await ligne.getByRole('button', { name: 'En pause', exact: true }).click();
    await reprise;
    // La reprise (2e clic) est écrite ; la mise en pause, en retard, arrive ensuite et l'écrase.
    const pause = reponseA(false);
    lacher();
    await pause;
    await page.screenshot({ path: `${CAPTURES}/reg-005-ecran-et-base-divergent.png` });
    const affiche = (await ligne.getByRole('button', { name: /^(Active|En pause)$/ }).innerText()) === 'Active';
    expect(affiche, `l’écran affiche « ${affiche ? 'Active' : 'En pause'} », la base contient enabled=${await lireEtat()}`).toBe(await lireEtat());
  });

  test('[REG-005] le bouton d’état dit son rôle à un lecteur d’écran (interrupteur ou « aria-pressed ») @defaut', async ({ page, adresses }) => {
    await adresses.creer();
    await ouvrirReglages(page);
    const bouton = lignes(page).first().getByRole('button', { name: 'Active', exact: true });
    await expect(bouton).toBeVisible();
    // « Active » sur fond vert ressemble à une étiquette : rien ne dit qu'un clic met l'adresse en pause.
    const semantique = await bouton.evaluate((el) => el.getAttribute('aria-pressed') ?? el.getAttribute('aria-checked') ?? el.getAttribute('aria-label') ?? el.getAttribute('title'));
    expect(semantique).not.toBeNull();
  });
});

test.describe('adresses d’appel — régénérer', () => {
  test('[REG-009] après rechargement, l’adresse n’est plus lisible : seuls les 4 derniers caractères, et un bouton « Régénérer »', async ({ page, adresses }) => {
    const a = await adresses.creer();
    await ouvrirReglages(page);
    const ligne = lignes(page).first();
    await expect(urlAffichee(ligne)).toHaveText(`${origine(page)}/api/hooks/••••${a.api_key.slice(-4)}`);
    await expect(page.getByRole('main')).not.toContainText(a.api_key);
    await expect(ligne.getByRole('button', { name: 'Régénérer' })).toBeVisible();
    await expect(ligne.getByRole('button', { name: /Afficher l’adresse|Masquer l’adresse|Copier l’adresse/ })).toHaveCount(0);
    await expect(ligne.getByText('Copiez-la maintenant')).toHaveCount(0);
  });

  test('[REG-009] « Régénérer » : la confirmation dit la conséquence ; « Annuler » ne change rien ; confirmer affiche une NOUVELLE adresse et l’ancienne clé n’existe plus', async ({ page, bureau, adresses }) => {
    const a = await adresses.creer();
    await ouvrirReglages(page);
    const ligne = lignes(page).first();
    await ligne.getByRole('button', { name: 'Régénérer' }).click();
    await expect(page.getByText('Régénérer cette adresse ?')).toBeVisible();
    await expect(page.getByText('Une nouvelle adresse sera créée et affichée une seule fois. L’ancienne cessera immédiatement de déclencher vos automatisations : il faudra coller la nouvelle chez votre fournisseur.')).toBeVisible();
    await page.getByRole('button', { name: 'Annuler', exact: true }).click();
    await expect(page.getByText('Régénérer cette adresse ?')).toBeHidden();
    expect((await adresses.lire())[0].api_key).toBe(a.api_key);
    await ligne.getByRole('button', { name: 'Régénérer' }).click();
    await page.getByRole('button', { name: 'Régénérer', exact: true }).last().click();
    await expect(page.getByText('Nouvelle adresse : copiez-la maintenant, elle ne sera plus affichée.')).toBeVisible();
    const [apres, ...autres] = await adresses.lire();
    expect(autres).toHaveLength(0);
    expect(apres.id).toBe(a.id);
    expect(apres.api_key).toMatch(/^[0-9a-f]{64}$/);
    expect(apres.api_key).not.toBe(a.api_key);
    expect(apres).toMatchObject({ enabled: true, deleted_at: null, name: a.name });
    await expect(urlAffichee(ligne)).toHaveText(`${origine(page)}/api/hooks/${apres.api_key}`);
    await expect(ligne.getByText('Copiez-la maintenant : elle ne sera plus affichée.')).toBeVisible();
    await expect(ligne.getByRole('button', { name: 'Copier l’adresse' })).toBeVisible();
    // L'ancienne adresse est invalide : plus aucune ligne ne porte l'ancienne clé, dans aucun bureau.
    const { data: restes } = await bureau.admin.from('automation_webhooks').select('id').eq('api_key', a.api_key);
    expect(restes ?? []).toHaveLength(0);
  });

  test('[REG-009] panne à la régénération : le message du serveur est affiché, la clé n’a pas changé', async ({ page, adresses, moniteur }) => {
    moniteur.attendu(/500 POST .*\/regenerer/, 'panne simulée par page.route');
    moniteur.attendu(/\[AdressesDAppel\] régénération/, 'le composant journalise l’échec');
    const a = await adresses.creer();
    await ouvrirReglages(page);
    await page.route('**/api/automations/webhooks/*/regenerer', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Impossible de régénérer l’adresse d’appel.' }) }));
    const ligne = lignes(page).first();
    await ligne.getByRole('button', { name: 'Régénérer' }).click();
    await page.getByRole('button', { name: 'Régénérer', exact: true }).last().click();
    await expect(page.getByText('Impossible de régénérer l’adresse d’appel.')).toBeVisible();
    expect((await adresses.lire())[0].api_key).toBe(a.api_key);
    await expect(urlAffichee(ligne)).toHaveText(`${origine(page)}/api/hooks/••••${a.api_key.slice(-4)}`);
  });

  test('[REG-009] une adresse EN PAUSE régénérée reste en pause, et l’écran le montre', async ({ page, adresses }) => {
    const a = await adresses.creer('Formulaire de mon site', false);
    await ouvrirReglages(page);
    const ligne = lignes(page).first();
    await expect(ligne.getByRole('button', { name: 'En pause', exact: true })).toBeVisible();
    await ligne.getByRole('button', { name: 'Régénérer' }).click();
    await page.getByRole('button', { name: 'Régénérer', exact: true }).last().click();
    await expect(page.getByText(/Nouvelle adresse/)).toBeVisible();
    const [apres] = await adresses.lire();
    expect(apres.api_key).not.toBe(a.api_key);
    expect(apres.enabled).toBe(false);
    await expect(ligne.getByRole('button', { name: 'En pause', exact: true })).toBeVisible();
  });
});

test.describe('adresses d’appel — supprimer', () => {
  test('[REG-006] la corbeille demande confirmation en disant la conséquence ; « Annuler » garde l’adresse ; « Supprimer » la retire de l’écran et de la base', async ({ page, adresses }) => {
    const a = await adresses.creer();
    const b = await adresses.creer();
    await ouvrirReglages(page);
    await expect(lignes(page)).toHaveCount(2);
    await lignes(page).first().getByRole('button', { name: 'Supprimer Formulaire de mon site' }).click();
    await expect(page.getByText('Supprimer cette adresse ?')).toBeVisible();
    await expect(page.getByText('Le service branché sur cette adresse cessera de déclencher vos automatisations. Cette adresse ne pourra pas être réutilisée.')).toBeVisible();
    await page.getByRole('button', { name: 'Annuler', exact: true }).click();
    await expect(lignes(page)).toHaveCount(2);
    expect((await adresses.lire()).every((x) => x.deleted_at === null)).toBe(true);
    await lignes(page).first().getByRole('button', { name: 'Supprimer Formulaire de mon site' }).click();
    await page.getByRole('button', { name: 'Supprimer', exact: true }).click();
    await expect(lignes(page)).toHaveCount(1);
    await expect.poll(async () => (await adresses.lire()).find((x) => x.id === a.id)?.deleted_at ?? null).not.toBeNull();
    const enBase = await adresses.lire();
    expect(enBase.find((x) => x.id === a.id)).toMatchObject({ enabled: false });
    expect(enBase.find((x) => x.id === b.id)).toMatchObject({ enabled: true, deleted_at: null });
    // C'est bien la PREMIÈRE qui est partie : celle qui reste porte la clé de la seconde.
    await expect(urlAffichee(lignes(page).first())).toHaveText(`${origine(page)}/api/hooks/••••${b.api_key.slice(-4)}`);
    await page.reload();
    await expect(lignes(page)).toHaveCount(1, { timeout: 90_000 });
  });

  test('[REG-006] panne à la suppression : l’adresse revient à l’écran, l’échec est dit, la base n’a pas bougé', async ({ page, adresses, moniteur }) => {
    moniteur.attendu(/500 DELETE .*\/api\/automations\/webhooks\//, 'panne simulée par page.route');
    const a = await adresses.creer();
    await ouvrirReglages(page);
    await page.route('**/api/automations/webhooks/*', (route) => (route.request().method() === 'DELETE'
      ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Impossible de supprimer l’adresse d’appel.' }) })
      : route.fallback()));
    await lignes(page).first().getByRole('button', { name: 'Supprimer Formulaire de mon site' }).click();
    await page.getByRole('button', { name: 'Supprimer', exact: true }).click();
    await expect(page.getByText('Suppression impossible.')).toBeVisible();
    await expect(lignes(page)).toHaveCount(1);
    expect((await adresses.lire()).find((x) => x.id === a.id)).toMatchObject({ deleted_at: null, enabled: true });
  });

  test('[REG-006] clavier : dans la confirmation, Échap annule ; le focus est sur « Annuler » (Entrée ne supprime pas)', async ({ page, adresses }) => {
    await adresses.creer();
    await ouvrirReglages(page);
    const corbeille = lignes(page).first().getByRole('button', { name: 'Supprimer Formulaire de mon site' });
    await corbeille.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Supprimer cette adresse ?')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Annuler', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Supprimer cette adresse ?')).toBeHidden();
    await expect(lignes(page)).toHaveCount(1);
    await corbeille.click();
    await page.keyboard.press('Escape');
    await expect(page.getByText('Supprimer cette adresse ?')).toBeHidden();
    await expect(lignes(page)).toHaveCount(1);
    expect((await adresses.lire())[0].deleted_at).toBeNull();
  });
});

test.describe('adresses d’appel — lectures ratées, forfait', () => {
  test('[REG-004] adresses illisibles : l’écran ne dit pas « Aucune adresse pour l’instant » alors qu’il en existe @defaut', async ({ page, adresses, moniteur }) => {
    moniteur.attendu(/500 GET .*\/api\/automations\/webhooks/, 'panne simulée par page.route');
    await adresses.creer();
    await page.route('**/api/automations/webhooks', (route) => (route.request().method() === 'GET'
      ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Impossible de lire vos adresses d’appel.' }) })
      : route.fallback()));
    await ouvrirReglages(page);
    await expect(page.getByText('Impossible de lire vos adresses d’appel.')).toBeVisible();
    await page.screenshot({ path: `${CAPTURES}/reg-004-illisible-dit-aucune.png`, fullPage: true });
    await expect(cartesAdresses(page).getByText(/Aucune adresse pour l’instant/)).toHaveCount(0);
  });

  test('[REG-010] forfait sans automatisations : « Fonctionnalité premium », la fenêtre de forfait s’ouvre d’office, « Voir les détails » la rouvre', async ({ page }) => {
    await page.route('**/api/billing/current', async (route) => {
      const r = await route.fetch();
      const j = await r.json();
      const sans = (p: Record<string, unknown> | null | undefined) => (p ? { ...p, includes_automations: false } : p);
      if (j?.subscription) j.subscription = { ...j.subscription, plans: sans(j.subscription.plans) };
      await route.fulfill({ response: r, json: j });
    });
    await page.route('**/api/billing/plans', async (route) => {
      const r = await route.fetch();
      const j = await r.json();
      const sans = (p: Record<string, unknown>) => ({ ...p, includes_automations: p.slug === 'autopilot' ? false : p.includes_automations });
      await route.fulfill({ response: r, json: Array.isArray(j) ? j.map(sans) : { ...j, plans: (j.plans ?? []).map(sans) } });
    });
    await page.goto('/automations/reglages');
    // « Fonctionnalité premium » est écrit DEUX fois quand la fenêtre de forfait est ouverte (la page, puis
    // l'en-tête de la fenêtre, plus bas dans le document) : selon l'instant, l'attente en voyait un ou deux.
    // On vise celui de la page, le premier.
    const premium = page.getByText('Fonctionnalité premium', { exact: true }).first();
    await expect(premium).toBeVisible({ timeout: 90_000 });
    await expect(premium.locator('xpath=following-sibling::p[1]')).toHaveText('Passez à un forfait supérieur pour accéder à cette section.');
    await expect(page.getByRole('button', { name: 'Créer une adresse' })).toHaveCount(0);
    // La fenêtre de forfait (PlanUpgradeModal, hors lot) n'a ni rôle ni titre accessible : on la reconnaît à sa croix.
    const croix = page.getByRole('button', { name: /^(Close|Fermer)$/ });
    await expect(croix).toBeVisible();
    await croix.click();
    await expect(croix).toBeHidden();
    await expect(premium).toBeVisible();
    await page.getByRole('button', { name: 'Voir les détails' }).click();
    await expect(croix).toBeVisible();
  });
});

test.describe('réglages globaux — anglais', () => {
  test.use({ langue: 'en' });

  test('[REG-001][REG-002][REG-003][REG-004][REG-005][REG-006][REG-007][REG-008][REG-009] tous les libellés sont en anglais', async ({ page, adresses }) => {
    await adresses.creer('My website form');
    await ouvrirReglages(page);
    await expect(page.getByRole('heading', { name: 'Global workflow settings', level: 1 })).toBeVisible();
    const nav = page.getByRole('navigation', { name: 'Sections' });
    // Trois liens depuis #870 (SousNavigation.tsx), la section courante en aria-current.
    await expect(nav.getByRole('link')).toHaveText(['Workflows', /^Overview\s*Beta$/, 'Global settings']);
    await expect(nav.getByRole('link', { name: 'Global settings', exact: true })).toHaveAttribute('aria-current', 'page');
    for (const titre of ['Message language', 'Notifications', 'Auto save', 'Pause workflows', 'Send window', 'Incoming addresses', 'Workflow AI']) await expect(carte(page, titre)).toBeVisible();
    await expect(carte(page, 'Message language').getByText('Français', { exact: true })).toBeVisible();
    await expect(carte(page, 'Message language').getByRole('button', { name: 'Change it in settings' })).toBeVisible();
    const adr = carte(page, 'Incoming addresses');
    const ligne = adr.locator('code').locator('xpath=ancestor::div[contains(@class,"rounded-lg")][1]').first();
    await expect(ligne.getByRole('button', { name: 'Active', exact: true })).toBeVisible();
    await expect(ligne.getByRole('button', { name: 'Delete My website form' })).toBeVisible();
    await ligne.getByRole('button', { name: 'Regenerate' }).click();
    await expect(page.getByText('Regenerate this address?')).toBeVisible();
    await page.getByRole('button', { name: 'Regenerate', exact: true }).last().click();
    await expect(page.getByText('New address: copy it now, it will not be shown again.')).toBeVisible();
    await expect(ligne.getByRole('button', { name: 'Hide address' })).toBeVisible();
    await expect(ligne.getByRole('button', { name: 'Copy address' })).toBeVisible();
    await expect(ligne.getByText('Copy it now: it will not be shown again.')).toBeVisible();
    await ligne.getByRole('button', { name: 'Active', exact: true }).click();
    await expect(ligne.getByRole('button', { name: 'Paused', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Create an address' }).click();
    await expect(adr.locator('code')).toHaveCount(2);
    expect((await adresses.lire()).map((a) => a.name)).toEqual(['My website form', 'My website form']);
  });

  test('[REG-004][REG-006] (anglais) un seul mot pour la même chose : « address », pas « endpoint » par endroits @defaut', async ({ page, adresses }) => {
    await adresses.creer('My website form');
    await ouvrirReglages(page);
    await expect(carte(page, 'Incoming addresses').getByRole('button', { name: 'Create an address' })).toBeVisible();
    await page.getByRole('button', { name: 'Create an address' }).click();
    const toast = page.locator('[data-sonner-toast]').first();
    await expect(toast).toBeVisible();
    await expect.soft(toast).not.toContainText(/endpoint/i);
    await page.getByRole('button', { name: 'Delete My website form' }).first().click();
    await page.screenshot({ path: `${CAPTURES}/reg-anglais-endpoint-address.png` });
    await expect.soft(page.getByText(/Delete this endpoint\?/)).toHaveCount(0);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  });
});
