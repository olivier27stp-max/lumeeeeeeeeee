/**
 * Points d'entrée vers les automatisations, ailleurs dans l'app — carte §2 (EXT-001 à EXT-028).
 *
 * Pour le PROPRIÉTAIRE : chaque point d'entrée cliquable est cliqué et doit mener
 * au bon endroit (ou faire ce qu'il annonce, vérifié en base).
 * Pour le TECHNICIEN (aucun droit sur les automatisations) : aucun point d'entrée
 * qu'il peut atteindre ne doit le mener à une page d'erreur brute — au pire
 * l'écran « Accès restreint », dans la coquille de l'app.
 *
 * EXT-001 (barre latérale) est couvert par rôle dans 10-interface-roles.spec.ts.
 *
 * ⚠ ÉCRIT D'APRÈS LE CODE ET LA CARTE, JAMAIS EXÉCUTÉ (staging en panne le
 * 2026-10-01 pendant la tournée) : les sélecteurs viennent des libellés et des
 * rôles ARIA lus dans les sources citées ; ils sont à confirmer à la première passe.
 */
import { mkdirSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { test, expect, SORTIES_LOT } from './_roles';

const CAP = `${SORTIES_LOT}/captures`;
mkdirSync(CAP, { recursive: true });
const LONG = { timeout: 90_000 };

async function appPrete(page: Page): Promise<void> {
  await expect(page.getByRole('complementary').getByRole('button', { name: 'Accueil' })).toBeVisible(LONG);
}
async function listeOuverte(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/automations$/, LONG);
  await expect(page.getByRole('heading', { name: 'Mes automatisations', level: 1 })).toBeVisible(LONG);
}
/**
 * Ouvre l'aide et déplie l'article « Comment fonctionnent les automatisations ? ».
 * Depuis #385 (src/components/SupportDrawer.tsx) le bouton « Aide et support » ouvre d'abord l'assistant Lumi ;
 * les articles sont derrière « Parcourir l’aide ».
 */
async function ouvrirArticleAutomatisations(page: Page) {
  await page.getByRole('button', { name: 'Aide et support' }).click();
  const tiroir = page.getByRole('dialog', { name: 'Aide et support' });
  await expect(tiroir).toBeVisible(LONG);
  await tiroir.getByRole('button', { name: 'Parcourir l’aide' }).click();
  const question = tiroir.getByRole('button', { name: 'Comment fonctionnent les automatisations ?' });
  await expect(question).toBeVisible(LONG);
  await question.click();
  return question;
}

/** Ni page blanche, ni erreur brute : l'écran de refus de l'app, avec sa barre latérale. */
async function refusPropre(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Accès restreint' })).toBeVisible(LONG);
  await expect(page.getByRole('complementary').getByRole('button', { name: 'Accueil' })).toBeVisible();
  await expect(page.getByText(/Cannot GET|Unexpected Application Error|Something went wrong|404/)).toHaveCount(0);
}

// ════════════════════════════════════════════════════════════════════════════
// Propriétaire — chaque point d'entrée mène au bon endroit
// ════════════════════════════════════════════════════════════════════════════

test.describe('propriétaire — navigation vers les automatisations', () => {
  test('[EXT-002] palette de commandes (Ctrl+K) : « autom » propose la commande et Entrée ouvre la liste', async ({ page }) => {
    await page.goto('/');
    await appPrete(page);
    await page.keyboard.press('Control+k');
    const saisie = page.getByRole('textbox', { name: 'Chercher ou executer une commande...' });
    await expect(saisie).toBeVisible();
    await saisie.fill('autom');
    const commande = page.getByRole('button', { name: /^Automati(sati)?ons$/ });
    await expect(commande).toBeVisible();
    await page.screenshot({ path: `${CAP}/EXT-002-palette.png` });
    await commande.click();
    await listeOuverte(page);
  });

  test('[EXT-002][S-10] palette de commandes : la commande est libellée en français dans une interface en français, et « automatisations » la trouve @defaut', async ({ page }) => {
    await page.goto('/');
    await appPrete(page);
    await page.keyboard.press('Control+k');
    const saisie = page.getByRole('textbox', { name: 'Chercher ou executer une commande...' });
    await saisie.fill('automatisations');
    // src/components/CommandPalette.tsx:103 — libellé « Automations » codé en dur, mots-clés « automations workflows » :
    // le mot français ne correspond ni au libellé ni aux mots-clés.
    await expect(page.getByRole('button', { name: 'Automatisations', exact: true }), 'la palette doit proposer « Automatisations » quand on tape le mot français').toBeVisible({ timeout: 10_000 });
  });

  test('[EXT-003] recherche globale : « automations » + Entrée ouvre la liste', async ({ page }) => {
    await page.goto('/');
    await appPrete(page);
    const recherche = page.getByRole('combobox', { name: 'Recherche globale' });
    await recherche.click();
    await recherche.fill('automations');
    await recherche.press('Enter');
    await listeOuverte(page);
  });

  test('[EXT-003][S-10] recherche globale : « automatisations » (français) mène aussi à la liste, et la suggestion est en français @defaut', async ({ page }) => {
    await page.goto('/');
    await appPrete(page);
    const recherche = page.getByRole('combobox', { name: 'Recherche globale' });
    await recherche.click();
    await recherche.fill('automatisations');
    // src/lib/searchParsing.ts:65 — alias « workflows », « automations » seulement ; libellé « Open automations » en anglais.
    await expect.soft(page.getByRole('option', { name: /Open automations/ }), 'une suggestion en anglais (« Open automations ») ne doit pas apparaître dans une interface en français').toHaveCount(0);
    await recherche.press('Enter');
    await expect(page, 'le mot français doit ouvrir les automatisations, pas une recherche de texte').toHaveURL(/\/automations$/, { timeout: 20_000 });
  });

  test('[EXT-004] Réglages › menu de gauche › « Automatisations » ouvre la liste', async ({ page }) => {
    await page.goto('/settings');
    await appPrete(page);
    // Deux boutons portent ce nom (barre latérale si « Plus » est ouvert, menu des réglages) : on vise celui du contenu.
    await page.getByRole('main').getByRole('button', { name: 'Automatisations', exact: true }).click();
    await listeOuverte(page);
  });

  test('[EXT-005] Réglages › Lume Payments › « Reçu automatique au client » : le lien « Automatisations » ouvre la liste', async ({ page }) => {
    await page.goto('/settings/payments');
    await appPrete(page);
    await expect(page.getByText('Reçu automatique au client')).toBeVisible(LONG);
    await expect(page.getByText('Règle « facture payée » des automatisations.')).toBeVisible();
    await page.getByRole('main').getByRole('link', { name: 'Automatisations' }).click();
    await listeOuverte(page);
  });

  test('[EXT-005][S-16] ce lien navigue DANS l’app, sans recharger toute la page @defaut', async ({ page }) => {
    await page.goto('/settings/payments');
    await appPrete(page);
    await expect(page.getByText('Reçu automatique au client')).toBeVisible(LONG);
    // Témoin posé dans la page : il disparaît si le document est rechargé (<a href> au lieu d'un <Link>, PaymentSettings.tsx:203).
    await page.evaluate(() => { (window as unknown as { __e2eTemoin?: boolean }).__e2eTemoin = true; });
    await page.getByRole('main').getByRole('link', { name: 'Automatisations' }).click();
    await listeOuverte(page);
    const garde = await page.evaluate(() => (window as unknown as { __e2eTemoin?: boolean }).__e2eTemoin === true);
    expect(garde, 'le clic a rechargé toute l’application (perte de l’état, écran de chargement) au lieu d’une navigation interne').toBe(true);
  });

  test('[EXT-006] Réglages › Modèles de courriel › « Les relances automatiques » : la carte compte les relances et ouvre la liste', async ({ page, bureau }) => {
    await page.goto('/settings/email-templates');
    await appPrete(page);
    await expect(page.getByRole('heading', { name: 'Les relances automatiques' })).toBeVisible(LONG);
    const carte = page.getByRole('link', { name: /relances automatiques/ });
    await expect(carte).toContainText('Soumissions, factures, rendez-vous, avis — chacune avec son délai');
    // Le nombre annoncé doit être un vrai nombre, cohérent avec la base (règles vivantes qui envoient un courriel).
    const texte = (await carte.innerText()).replace(/\s+/g, ' ');
    const n = Number(texte.match(/(\d+) relances automatiques/)?.[1] ?? NaN);
    expect(Number.isFinite(n), `nombre lisible dans « ${texte} »`).toBe(true);
    const { count } = await bureau.admin.from('automation_rules').select('id', { count: 'exact', head: true }).eq('org_id', bureau.orgA).is('deleted_at', null);
    expect(n, 'pas plus de relances annoncées que de règles vivantes dans le bureau').toBeLessThanOrEqual(count ?? 0);
    await carte.click();
    await listeOuverte(page);
  });

  test('[EXT-006][S-20] cette section est traduite pour un compte en anglais @defaut', async ({ ongletDe }) => {
    const { page } = await ongletDe('proprioA', { langue: 'en' });
    await page.goto('/settings/email-templates');
    await expect(page.getByRole('complementary')).toBeVisible(LONG);
    // La section doit être RENDUE avant qu'on y cherche du français : lu pendant le chargement de la page, « aucun texte
    // français » passait à tort (vert trompeur à la passe locale du 2026-10-01). La carte porte un repère stable
    // (`data-visite="relances"`, src/pages/settings/EmailTemplatesSettings.tsx).
    await expect(page.locator('[data-visite="relances"]')).toBeVisible(LONG);
    // src/pages/settings/EmailTemplatesSettings.tsx:407-427 — titres et textes en français seulement.
    await expect(page.getByText('Les relances automatiques'), 'texte français codé en dur dans une interface en anglais').toHaveCount(0);
    await expect(page.locator('[data-visite="relances"]'), 'la carte des relances est en français dans une interface en anglais').not.toContainText(/relances automatiques|chacune avec son délai/);
  });

  test('[EXT-007] Réglages › Messagerie SMS › « Textos automatiques » : l’interrupteur d’une règle la dépublie puis la republie (écran + base)', async ({ page, bureau }) => {
    test.setTimeout(240_000);
    await page.goto('/settings/messaging');
    await appPrete(page);
    await expect(page.getByText('Textos automatiques')).toBeVisible(LONG);
    await expect(page.getByText(/Ce que Lume texte à vos clients, quand, et avec quels mots\. \d+ automatisations? actives?\./)).toBeVisible();
    // La règle « Confirmation de rendez-vous » (préréglage appointment_confirmation) porte un texto.
    const { data: regle } = await bureau.admin.from('automation_rules').select('id, is_active').eq('org_id', bureau.orgA).eq('preset_key', 'appointment_confirmation').maybeSingle();
    expect(regle, 'préréglage présent dans le bureau').not.toBeNull();
    const ligne = page.locator('div.bg-surface-card', { hasText: 'Confirmation de rendez-vous' }).first();
    const bascule = ligne.getByRole('switch');
    const avant = regle!.is_active as boolean; // vérifié non nul juste au-dessus
    await expect(bascule).toHaveAttribute('aria-checked', String(avant));
    try {
      await bascule.click();
      await expect(bascule).toHaveAttribute('aria-checked', String(!avant));
      await expect.poll(async () => (await bureau.admin.from('automation_rules').select('is_active').eq('id', regle!.id).maybeSingle()).data?.is_active, { timeout: 30_000 }).toBe(!avant);
      await page.reload();
      await expect(page.getByText('Textos automatiques')).toBeVisible(LONG);
      await expect(page.locator('div.bg-surface-card', { hasText: 'Confirmation de rendez-vous' }).first().getByRole('switch')).toHaveAttribute('aria-checked', String(!avant));
    } finally {
      await bureau.admin.from('automation_rules').update({ is_active: avant }).eq('id', regle!.id);
    }
  });

  test('[EXT-007] « Textos automatiques » : chaque interrupteur porte un nom accessible (la règle qu’il commande) @defaut', async ({ page }) => {
    await page.goto('/settings/messaging');
    await appPrete(page);
    await expect(page.getByText('Textos automatiques')).toBeVisible(LONG);
    const bascules = page.getByRole('switch');
    await expect(bascules.first()).toBeVisible();
    // src/pages/SettingsMessaging.tsx:529-538 — <button role="switch"> sans aria-label ni texte.
    const sansNom = await bascules.evaluateAll((els) => els.filter((e) => !(e.getAttribute('aria-label') || e.getAttribute('aria-labelledby') || (e.textContent ?? '').trim())).length);
    expect(sansNom, 'interrupteurs sans nom : un lecteur d’écran annonce « interrupteur » sans dire lequel').toBe(0);
  });

  test('[EXT-008] Réglages › Avis clients › « Automatisations liées » : les deux règles d’avis, leur interrupteur, et le lien vers la Messagerie SMS', async ({ page }) => {
    await page.goto('/settings/reviews');
    await appPrete(page);
    await expect(page.getByRole('heading', { name: 'Automatisations liées' })).toBeVisible(LONG);
    const section = page.locator('div.section-card', { has: page.getByRole('heading', { name: 'Automatisations liées' }) });
    await expect(section.getByText('Demande d’avis')).toBeVisible();
    await expect(section.getByRole('switch').first()).toBeVisible();
    await section.getByRole('link', { name: 'Réglages → Messagerie SMS' }).click();
    await expect(page).toHaveURL(/\/settings\/messaging$/);
    await expect(page.getByText('Textos automatiques')).toBeVisible(LONG);
  });

  test('[EXT-009] Réglages › Entreprise › « Langue de vos clients » : le choix s’enregistre et les Réglages globaux des automatisations l’affichent', async ({ page, bureau }) => {
    test.setTimeout(240_000);
    await page.goto('/settings/company');
    await appPrete(page);
    await expect(page.getByRole('heading', { name: 'Langue de vos clients' })).toBeVisible(LONG);
    const carte = page.locator('div.section-card', { has: page.getByRole('heading', { name: 'Langue de vos clients' }) });
    await expect(carte.getByRole('button', { name: 'Français' })).toHaveAttribute('aria-pressed', 'true');
    // Enregistrer cette page recopie le nom de l'entreprise dans `orgs.name` (server/routes/billing.ts : `update({ name:
    // payload.company_name })`) : le bureau « [TEST] … A (roles) » devenait « Nettoyage Test A », et TOUS les tests suivants
    // tombaient sur « 0 bureau(x) » (le banc retrouve ses bureaux par leur nom). On note le nom et on le rend.
    const { data: avantNom } = await bureau.admin.from('orgs').select('name').eq('id', bureau.orgA).maybeSingle();
    const nomDuBureau = String(avantNom?.name ?? '');
    expect(nomDuBureau, 'le bureau de test porte son nom de jeu avant le test').toMatch(/^\[TEST\] QA Automatisations A/);
    const rendreLeNom = async () => { await bureau.admin.from('orgs').update({ name: nomDuBureau }).eq('id', bureau.orgA); };
    try {
      await carte.getByRole('button', { name: 'English' }).click();
      await expect(carte.getByRole('button', { name: 'English' })).toHaveAttribute('aria-pressed', 'true');
      // La page a une barre d'enregistrement : on enregistre si elle le demande.
      const enregistrer = page.getByRole('button', { name: /^Enregistrer/ }).first();
      if (await enregistrer.isVisible().catch(() => false)) await enregistrer.click();
      await expect.poll(async () => (await bureau.admin.from('company_settings').select('default_language').eq('org_id', bureau.orgA).maybeSingle()).data?.default_language, { timeout: 30_000 }).toBe('en');
      await rendreLeNom(); // tout de suite : un échec plus bas ne doit pas laisser le bureau renommé
      await page.goto('/automations/reglages');
      await expect(page.getByRole('heading', { name: 'Langue des messages' })).toBeVisible(LONG);
      await expect(page.getByText('English', { exact: true })).toBeVisible();
      // … et le bouton « Changer dans les réglages » ramène ici.
      await page.getByRole('button', { name: 'Changer dans les réglages' }).click();
      await expect(page).toHaveURL(/\/settings\/company$/);
    } finally {
      await bureau.admin.from('company_settings').update({ default_language: 'fr' }).eq('org_id', bureau.orgA);
      await rendreLeNom();
    }
  });

  test('[EXT-012] Pipeline › réglages d’un pipeline › détail d’une étape › « Ouvrir les automatisations »', async ({ page, bureau }) => {
    // Les étapes portent `name_fr` / `name_en` (pas de colonne `name` : la lecture d'origine échouait en 42703, erreur avalée).
    const { data: etape, error: eEtape } = await bureau.admin.from('pipeline_stages').select('pipeline_id, name_fr').eq('org_id', bureau.orgA).is('archived_at', null).order('position').limit(1).maybeSingle();
    expect(eEtape?.message ?? null, 'lecture des étapes du pipeline').toBeNull();
    expect(etape, 'le bureau de test a un pipeline de ventes (semé à la création du bureau)').not.toBeNull();
    await page.goto(`/ventes?tab=reglages&pipeline=${etape!.pipeline_id}`); // vérifié non nul juste au-dessus
    await appPrete(page);
    await page.getByRole('button', { name: /^Détails de « / }).first().click();
    await page.getByRole('link', { name: 'Ouvrir les automatisations' }).click();
    await listeOuverte(page);
  });

  test('[EXT-016] fiche client › retirer une étiquette prévient le moteur (« Étiquette retirée ») — écran, appel et journal d’activité', async ({ page, bureau, decorA, moniteur }) => {
    test.setTimeout(240_000);
    const compter = async () => (await bureau.admin.from('activity_log').select('id', { count: 'exact', head: true }).eq('org_id', bureau.orgA).eq('event_type', 'client_untagged').eq('entity_id', decorA.client)).count ?? 0;
    const avant = await compter();
    void moniteur;
    try {
      await page.goto(`/clients/${decorA.client}`);
      await appPrete(page);
      const appel = page.waitForResponse((r) => r.url().includes('/api/automations/events/client-untagged') && r.request().method() === 'POST', { timeout: 60_000 });
      await page.getByRole('button', { name: `Retirer l’étiquette ${decorA.etiquette}` }).click();
      expect((await appel).status(), 'le serveur accepte l’annonce').toBe(200);
      await expect(page.getByRole('button', { name: `Retirer l’étiquette ${decorA.etiquette}` })).toHaveCount(0);
      const { count } = await bureau.admin.from('client_tags').select('id', { count: 'exact', head: true }).eq('client_id', decorA.client).eq('tag', decorA.etiquette);
      expect(count, 'l’étiquette est retirée en base').toBe(0);
      await expect.poll(compter, { timeout: 30_000 }).toBeGreaterThan(avant);
    } finally {
      // Le décor retrouve son étiquette pour les autres tests.
      const { data } = await bureau.admin.from('client_tags').select('id').eq('client_id', decorA.client).eq('tag', decorA.etiquette).maybeSingle();
      if (!data) await bureau.admin.from('client_tags').insert({ client_id: decorA.client, tag: decorA.etiquette });
    }
  });

  test('[EXT-020][EXT-021] aide : l’article « Comment fonctionnent les automatisations ? » s’ouvre et « Aller à la page → » mène à la liste', async ({ page }) => {
    await page.goto('/');
    await appPrete(page);
    const question = await ouvrirArticleAutomatisations(page);
    await expect(question).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByText(/Dans Automatisations, chaque règle/)).toBeVisible();
    await page.getByRole('button', { name: 'Aller à la page →' }).click();
    await listeOuverte(page);
    // Le tiroir d'aide se referme en menant à la page.
    await expect(page.getByRole('dialog', { name: 'Aide et support' })).toHaveCount(0);
  });

  test('[EXT-020][S-11] l’article d’aide ne contredit pas l’écran : il ne dit pas « Rien ne se supprime » alors que la liste a une corbeille @defaut', async ({ page }) => {
    await page.goto('/automations');
    await expect(page.getByRole('heading', { name: 'Mes automatisations', level: 1 })).toBeVisible(LONG);
    // L'écran : un onglet « Corbeille ».
    await expect(page.getByRole('tab', { name: /^Corbeille/ })).toBeVisible();
    const question = await ouvrirArticleAutomatisations(page);
    // L'article est bien déplié (sinon « aucun texte fautif » ne prouverait rien).
    await expect(question).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByText(/Dans Automatisations, chaque règle/)).toBeVisible();
    // L'aide (src/components/supportArticles.ts:126) : « Rien ne se supprime : une règle inutile se met en pause. »
    await expect(page.getByText(/Rien ne se supprime/), 'l’aide affirme que rien ne se supprime ; l’écran a une corbeille et une suppression définitive').toHaveCount(0, { timeout: 15_000 });
  });

  test('[EXT-024] bandeau « données importées non activées » : il annonce que les automatisations sont gelées et l’explique', async ({ ongletDe, bureau }) => {
    test.setTimeout(240_000);
    // Mise en situation dans le bureau de test B seulement, puis remise en état.
    const { data: avant } = await bureau.admin.from('org_features').select('enabled, metadata').eq('org_id', bureau.orgB).eq('feature', 'communications_gelees').maybeSingle();
    await bureau.admin.from('org_features').upsert({ org_id: bureau.orgB, feature: 'communications_gelees', enabled: true, metadata: { gele_le: new Date().toISOString() } }, { onConflict: 'org_id,feature' });
    try {
      const { page } = await ongletDe('proprioB');
      await page.goto('/automations');
      await expect(page.getByText('Vos données importées ne sont pas encore activées.')).toBeVisible(LONG);
      await page.getByRole('button', { name: 'Plus d’infos' }).click();
      const modale = page.getByRole('dialog');
      await expect(modale).toContainText('Les automatisations ne sont pas activées tant que les données n’ont pas été activées dans Migrations.');
      await page.screenshot({ path: `${CAP}/EXT-024-bandeau-gel.png` });
      await modale.getByRole('button', { name: 'Compris' }).click();
      await expect(modale).toHaveCount(0);
    } finally {
      if (avant) await bureau.admin.from('org_features').update({ enabled: avant.enabled, metadata: avant.metadata }).eq('org_id', bureau.orgB).eq('feature', 'communications_gelees');
      else await bureau.admin.from('org_features').delete().eq('org_id', bureau.orgB).eq('feature', 'communications_gelees');
    }
  });

  test('[EXT-025][S-19] centre d’activités : une notification « Échec d’envoi » d’automatisation est lisible, et la cliquer mène à l’automatisation fautive @defaut', async ({ page, bureau, marque }) => {
    test.setTimeout(240_000);
    const titre = `Échec d'envoi — ${marque} Relance de devis`;
    const { data: n, error } = await bureau.admin.from('notifications').insert({
      org_id: bureau.orgA, type: 'automation_failed', title: titre,
      body: 'Le texto n’est pas parti et ne partira pas : ce client n’a pas de numéro de téléphone.', is_read: false,
    }).select('id').single();
    if (error || !n) throw new Error(`notification de test : ${error?.message}`);
    try {
      await page.goto('/');
      await appPrete(page);
      // La cloche n'a qu'un `title` (src/App.tsx) : dès qu'une notification est non lue, sa pastille (« 1 ») devient
      // son nom accessible et « Centre d'activités » ne la désigne plus par son rôle — on la vise par son titre.
      await page.getByTitle("Centre d'activités").click();
      await expect(page.getByRole('heading', { name: "Centre d'activités" })).toBeVisible();
      const ligne = page.getByText(titre);
      await expect(ligne, 'la notification d’échec apparaît dans le centre d’activités').toBeVisible(LONG);
      await page.screenshot({ path: `${CAP}/EXT-025-notification-echec.png` });
      await ligne.click();
      // Attendu : arriver sur les automatisations (la liste ou la règle). La notification ne porte aujourd'hui aucun lien
      // (server/lib/automationEngine.ts:1505-1531 : ni entity_type ni entity_id utiles à la navigation).
      await expect(page, 'cliquer la notification d’échec ne mène nulle part').toHaveURL(/\/automations/, { timeout: 15_000 });
    } finally {
      await bureau.admin.from('notifications').delete().eq('id', n.id);
    }
  });

  test('[EXT-026] onboarding : un bureau neuf reçoit ses automatisations fournies, et le propriétaire les voit dans la liste', async ({ page, bureau }) => {
    // Le bureau de test est né par la même porte que tout bureau (insertion dans `orgs` → trigger de semis).
    const { data } = await bureau.admin.from('automation_rules').select('id, name, preset_key, is_active').eq('org_id', bureau.orgA).eq('is_preset', true).is('deleted_at', null);
    expect((data ?? []).length, 'préréglages semés à la création du bureau').toBeGreaterThan(20);
    expect(new Set((data ?? []).map((r) => r.preset_key)).size, 'aucun préréglage en double').toBe((data ?? []).length);
    await page.goto('/automations');
    await expect(page.getByRole('heading', { name: 'Mes automatisations', level: 1 })).toBeVisible(LONG);
    await expect(page.getByRole('table').getByText('Confirmation de rendez-vous')).toBeVisible(LONG);
  });

  test('[EXT-027] site public : Fonctionnalités › « Automatisations » mène à la section #automation', async ({ browser, baseURL }) => {
    const context = await browser.newContext({ locale: 'fr-CA' });
    const page = await context.newPage();
    try {
      await page.goto(`${baseURL}/features#automation`);
      await expect(page.locator('#automation')).toBeVisible(LONG);
      await expect(page.locator('#automation')).toContainText('Automatisations');
      await expect(page.locator('#automation')).toBeInViewport();
    } finally { await context.close(); }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Technicien — aucun point d'entrée ne mène à une erreur brute
// ════════════════════════════════════════════════════════════════════════════

test.describe('technicien — points d’entrée offerts à un rôle sans droit', () => {
  test('[EXT-002][S-16] palette de commandes : la commande « Automatisations » n’est pas proposée à un rôle qui ne peut pas l’ouvrir @defaut', async ({ ongletDe }) => {
    const { page } = await ongletDe('techA');
    await page.goto('/');
    await appPrete(page);
    await page.keyboard.press('Control+k');
    const saisie = page.getByRole('textbox', { name: 'Chercher ou executer une commande...' });
    await saisie.fill('autom');
    // Factures, Paiements et Insights sont filtrés selon le rôle (CommandPalette.tsx) ; « Automations » ne l'est pas.
    await expect(page.getByRole('button', { name: /^Automati(sati)?ons$/ }), 'commande offerte à un technicien : elle mène à « Accès restreint »').toHaveCount(0, { timeout: 10_000 });
  });

  test('[EXT-002] palette de commandes : si le technicien la choisit, il tombe sur le refus propre de l’app, pas sur une erreur', async ({ ongletDe }) => {
    const { page } = await ongletDe('techA');
    await page.goto('/');
    await appPrete(page);
    await page.keyboard.press('Control+k');
    const saisie = page.getByRole('textbox', { name: 'Chercher ou executer une commande...' });
    await saisie.fill('autom');
    await page.getByRole('button', { name: /^Automati(sati)?ons$/ }).click();
    await expect(page).toHaveURL(/\/automations$/);
    await refusPropre(page);
  });

  test('[EXT-003] recherche globale : « automations » + Entrée mène le technicien au refus propre', async ({ ongletDe }) => {
    const { page } = await ongletDe('techA');
    await page.goto('/');
    await appPrete(page);
    const recherche = page.getByRole('combobox', { name: 'Recherche globale' });
    await recherche.click();
    await recherche.fill('automations');
    await recherche.press('Enter');
    await expect(page).toHaveURL(/\/automations$/);
    await refusPropre(page);
  });

  test('[EXT-004][S-16] Réglages › menu : « Automatisations » n’est pas proposé à un rôle qui ne peut pas l’ouvrir @defaut', async ({ ongletDe }) => {
    const { page } = await ongletDe('techA');
    await page.goto('/settings');
    await appPrete(page);
    await expect(page.getByRole('main').getByRole('button', { name: 'Messagerie SMS' })).toBeVisible(LONG);
    await expect(page.getByRole('main').getByRole('button', { name: 'Automatisations', exact: true }), 'entrée offerte sans filtre de permission (SettingsLayout.tsx:95)').toHaveCount(0);
  });

  test('[EXT-004] Réglages › menu : si le technicien clique « Automatisations », il obtient le refus propre', async ({ ongletDe }) => {
    const { page } = await ongletDe('techA');
    await page.goto('/settings');
    await appPrete(page);
    await page.getByRole('main').getByRole('button', { name: 'Automatisations', exact: true }).click();
    await expect(page).toHaveURL(/\/automations$/);
    await refusPropre(page);
  });

  /* Réécrit le 2026-10-01 après la première exécution (pile locale). La spec, écrite d'après le code, supposait que
     la section « Textos automatiques » s'affichait pour un technicien. Elle ne s'affiche que si le numéro du bureau a
     été lu (`{channel?.phone_number && <AutomationSmsSection />}`, src/pages/SettingsMessaging.tsx), et
     `GET /api/communications/channels` exige `integrations.read` : le technicien voit donc, à la place, le texte
     technique « Permission denied: integrations.read ». Deux situations, deux attentes :
       1. le technicien tel quel : ni message faux, ni refus technique en anglais à l'écran ;
       2. un membre qui a `integrations.read` sans `automations.read` (compte `vendeurSmsA`) : la section s'affiche,
          et c'est là que le message faux du constat S-12 peut apparaître. */
  test('[EXT-007][S-12] Réglages › Messagerie SMS : un rôle sans droit sur les automatisations ne lit ni un refus technique en anglais, ni « Aucune automatisation SMS configurée » alors que le bureau en a @defaut', async ({ ongletDe, bureau }) => {
    test.setTimeout(240_000);
    const { count } = await bureau.admin.from('automation_rules').select('id', { count: 'exact', head: true }).eq('org_id', bureau.orgA).eq('is_active', true).is('deleted_at', null);
    expect(count ?? 0, 'le bureau a des automatisations publiées').toBeGreaterThan(0);
    const fauxMessage = 'Aucune automatisation SMS configurée pour cette organisation.';

    // ── 1. Le technicien (aucune surcharge) ──
    const tech = await ongletDe('techA');
    tech.moniteur.attendu(/403 GET \/api\/communications\/channels/, 'le technicien n’a pas integrations.read : le serveur refuse de lui rendre le numéro du bureau — le message montré est vérifié ci-dessous');
    await tech.page.goto('/settings/messaging');
    await appPrete(tech.page);
    await expect(tech.page.getByRole('heading', { name: 'Messagerie SMS', level: 1 })).toBeVisible(LONG);
    // La page a fini de charger quand la carte « Votre numéro » a tranché (numéro, ou erreur de chargement).
    const carteNumero = tech.page.locator('div.glass-card', { hasText: 'Votre numéro' }).first();
    await expect(carteNumero).toBeVisible(LONG);
    await expect(carteNumero.getByText(/Permission denied|ne permet pas|\+1/).first()).toBeVisible(LONG);
    await expect.soft(tech.page.getByText(fauxMessage), 'technicien : message faux, le bureau a des automatisations').toHaveCount(0);
    await expect.soft(tech.page.getByText(/Permission denied|integrations\.read/), 'technicien : un refus technique en anglais (« Permission denied: integrations.read ») est affiché tel quel, alors que le serveur fournit la phrase « Votre rôle ne permet pas cette action. »').toHaveCount(0);

    // ── 2. Un membre qui voit la section sans pouvoir lire les automatisations ──
    const vendeur = await ongletDe('vendeurSmsA');
    await vendeur.page.goto('/settings/messaging');
    await appPrete(vendeur.page);
    await expect(vendeur.page.getByText('Textos automatiques')).toBeVisible(LONG);
    // La section a fini de charger : soit des interrupteurs, soit le message « aucune ».
    await expect(vendeur.page.getByRole('switch').first().or(vendeur.page.getByText(fauxMessage))).toBeVisible(LONG);
    // La liste vient de la RLS `automations.read` → vide pour lui, et l'écran en conclut à tort que le bureau n'en a pas.
    await expect.soft(vendeur.page.getByText(fauxMessage), 'message faux : le bureau a des automatisations, c’est le rôle qui ne peut pas les lire').toHaveCount(0);
  });

  /* DÉFAUT constaté à la première exécution (pile locale, 2026-10-01) : la fiche client OFFRE au technicien de retirer
     une étiquette, et le retrait s'écrit pour de bon (`client_tags` : la RLS laisse tout membre du bureau insérer et
     supprimer — sonde du tri du 2026-10-01 : DELETE 1 ligne, INSERT 1 ligne), alors
     que le rôle n'a ni `clients.update` ni `leads.update`. L'annonce au moteur, elle, est refusée (403 « Permission
     denied: clients.update or leads.update ») : les automatisations « Étiquette retirée » ne partent pas, sans rien
     dire à l'écran. Le test affirme l'attendu et reste rouge. */
  test('[EXT-016] le technicien n’a pas le droit d’annoncer une étiquette : la fiche client ne lui offre pas de retirer une étiquette @defaut', async ({ ongletDe, decorA }) => {
    const { page } = await ongletDe('techA');
    await page.goto(`/clients/${decorA.client}`);
    await appPrete(page);
    await expect(page.getByText('Décor-Rôles').first()).toBeVisible(LONG);
    // L'étiquette du décor est bien affichée (sinon « aucun bouton » ne prouverait rien)…
    await expect(page.getByText(decorA.etiquette, { exact: true }).first()).toBeVisible(LONG);
    // … mais sans le bouton pour la retirer.
    await expect(page.getByRole('button', { name: `Retirer l’étiquette ${decorA.etiquette}` })).toHaveCount(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Membre en lecture seule — un interrupteur offert doit dire pourquoi il refuse
// ════════════════════════════════════════════════════════════════════════════

test.describe('membre en lecture seule — Réglages › Messagerie SMS', () => {
  test('[EXT-007][S-12][S-08] l’interrupteur d’une règle, refusé par le serveur, explique le refus en français au lieu de revenir en arrière sans un mot @defaut', async ({ ongletDe, bureau }) => {
    test.setTimeout(240_000);
    const { data: regle } = await bureau.admin.from('automation_rules').select('id, is_active').eq('org_id', bureau.orgA).eq('preset_key', 'appointment_confirmation').maybeSingle();
    expect(regle).not.toBeNull();
    // `lecteurSmsA` = lecture seule des automatisations + `integrations.read` : sans cette seconde clé, le numéro du
    // bureau n'est pas lu et la section « Textos automatiques » ne s'affiche pas du tout (voir _comptes.ts).
    const { page, moniteur } = await ongletDe('lecteurSmsA');
    moniteur.attendu(/403 POST .*\/api\/automations\/rules\/.*\/publication/, 'le membre en lecture seule n’a pas automations.update : le serveur refuse la publication');
    await page.goto('/settings/messaging');
    await appPrete(page);
    await expect(page.getByText('Textos automatiques')).toBeVisible(LONG);
    const bascule = page.locator('div.bg-surface-card', { hasText: 'Confirmation de rendez-vous' }).first().getByRole('switch');
    await expect(bascule).toBeVisible(LONG);
    const avant = String(regle!.is_active); // vérifié non nul juste au-dessus
    const reponse = page.waitForResponse((r) => r.url().includes('/publication') && r.request().method() === 'POST', { timeout: 60_000 });
    await bascule.click();
    expect((await reponse).status()).toBe(403);
    // L'interrupteur revient à son état : rien n'a changé en base.
    await expect(bascule).toHaveAttribute('aria-checked', avant);
    const { data: apres } = await bureau.admin.from('automation_rules').select('is_active').eq('id', regle!.id).maybeSingle();
    expect(String(apres?.is_active)).toBe(avant);
    // Attendu : un message visible, en français. Aujourd'hui `handleToggle` avale l'erreur (SettingsMessaging.tsx:482-490).
    const toast = page.getByRole('region', { name: /Notifications/ }).getByRole('listitem');
    await expect(toast.first(), 'aucun message : l’interrupteur revient en arrière sans explication').toBeVisible({ timeout: 10_000 });
    await expect(toast.first()).not.toContainText(/Permission denied|automations\.update/);
  });
});
