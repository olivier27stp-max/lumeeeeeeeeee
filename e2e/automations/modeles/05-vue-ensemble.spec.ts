/**
 * Vue d'ensemble `/automations/apercu` — APR-001 à APR-004.
 *
 * Ce que ce fichier prouve : la sous-navigation mène où elle dit ; les trois
 * tuiles, la courbe des 7 semaines et le résumé des erreurs affichent ce que
 * la base contient (des règles et des journaux sont PRÉPARÉS en base, puis
 * comparés à l'écran) ; une lecture ratée n'est pas montrée comme « tout va
 * bien » ; un forfait sans automatisations est dit, avec un bouton qui marche.
 */
import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { estPrereglageRetire } from '../../../src/lib/automationCatalogue';
import { test, expect, creerRegle, appelApi, CAPTURES, type Bureau, type LigneRegle } from './aides';

// Poste et staging partagés par plusieurs passes : les chargements sont lents par moments.
test.describe.configure({ timeout: 240_000 });

const HEURE = 3_600_000;
const JOUR = 24 * HEURE;

async function ouvrirApercu(page: Page): Promise<void> {
  await page.goto('/automations/apercu');
  await expect(page.getByText(/^(Total des automatisations|Total workflows)$/)).toBeVisible({ timeout: 90_000 });
}

/** La valeur d'une tuile, par son libellé. */
const tuile = (page: Page, libelle: string) => page.getByText(libelle, { exact: true }).locator('xpath=following-sibling::p[1]');

/** Le bureau A repart sans aucun journal d'exécution : les chiffres attendus sont alors exacts. */
async function viderJournaux(bureau: Bureau): Promise<void> {
  const { error } = await bureau.admin.from('automation_execution_logs').delete().eq('org_id', bureau.orgA);
  if (error) throw new Error(`vidage des journaux : ${error.message}`);
}

interface Journal { entite: string; ilYA: number; succes: boolean; action?: string; erreur?: string; declencheur?: string }
async function journaliser(bureau: Bureau, regle: LigneRegle, lignes: Journal[]): Promise<void> {
  const { error } = await bureau.admin.from('automation_execution_logs').insert(lignes.map((l) => ({
    org_id: bureau.orgA, automation_rule_id: regle.id, trigger_event: l.declencheur ?? 'lead.created', entity_type: 'lead', entity_id: l.entite,
    action_type: l.action ?? 'send_sms', action_config: {}, result_success: l.succes, result_error: l.succes ? null : (l.erreur ?? 'Ce client n’a pas de numéro de téléphone'),
    created_at: new Date(Date.now() - l.ilYA).toISOString(),
  })));
  if (error) throw new Error(`préparation des journaux : ${error.message}`);
}

test.describe('vue d’ensemble — navigation', () => {
  test('[APR-001][APR-002] la sous-navigation : « Vue d’ensemble » est la section courante ; « Automatisations » ouvre la liste, « Réglages globaux » les réglages', async ({ page }) => {
    await ouvrirApercu(page);
    // Depuis #870 la sous-navigation est faite de trois LIENS (SousNavigation.tsx) ; la section
    // courante est annoncée par aria-current="page", les deux autres ne le portent pas.
    const nav = page.getByRole('navigation', { name: 'Sections' });
    await expect(nav.getByRole('link')).toHaveText(['Automatisations', /^Vue d’ensemble\s*Bêta$/, 'Réglages globaux']);
    await expect(nav.getByRole('button')).toHaveCount(0);
    const courante = nav.getByRole('link', { name: /^Vue d’ensemble/ });
    await expect(courante).toHaveAttribute('aria-current', 'page');
    await expect(courante.getByText('Bêta', { exact: true })).toBeVisible();
    await expect(nav.locator('[aria-current]')).toHaveCount(1);
    await expect(nav.getByRole('link', { name: 'Automatisations', exact: true })).toHaveAttribute('href', '/automations');
    await expect(nav.getByRole('link', { name: 'Réglages globaux', exact: true })).toHaveAttribute('href', '/automations/reglages');
    await nav.getByRole('link', { name: 'Automatisations', exact: true }).click();
    await expect(page).toHaveURL(/\/automations$/);
    await expect(page.getByRole('heading', { name: 'Mes automatisations' })).toBeVisible();
    await page.goBack();
    await expect(page.getByText('Total des automatisations')).toBeVisible();
    await nav.getByRole('link', { name: 'Réglages globaux', exact: true }).click();
    await expect(page).toHaveURL(/\/automations\/reglages$/);
    await expect(page.getByRole('heading', { name: 'Réglages globaux' })).toBeVisible();
  });

  test('[APR-001][APR-002] au clavier : Tab atteint les deux boutons, Entrée navigue', async ({ page }) => {
    await ouvrirApercu(page);
    const nav = page.getByRole('navigation', { name: 'Sections' });
    // Les « boutons » du titre sont des liens depuis #870 : Tab passe de l'un au suivant, Entrée suit le lien.
    await nav.getByRole('link', { name: /^Vue d’ensemble/ }).focus();
    await page.keyboard.press('Tab');
    const reglages = nav.getByRole('link', { name: 'Réglages globaux', exact: true });
    await expect(reglages).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/automations\/reglages$/);
    await expect(page.getByRole('heading', { name: 'Réglages globaux', level: 1 })).toBeVisible();
    // Et dans l'autre sens : Maj+Tab deux fois depuis « Réglages globaux » atteint « Automatisations ».
    const nav2 = page.getByRole('navigation', { name: 'Sections' });
    await nav2.getByRole('link', { name: 'Réglages globaux', exact: true }).focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Shift+Tab');
    await expect(nav2.getByRole('link', { name: 'Automatisations', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/automations$/);
  });
});

test.describe('vue d’ensemble — les chiffres sont ceux de la base', () => {
  test('[APR-001] les tuiles « Total » et « Publiées » comptent les automatisations vivantes : ni la corbeille ni les supprimées définitivement', async ({ page, bureau, marque }) => {
    await creerRegle(bureau, bureau.orgA, { name: `${marque} publiée`, is_active: true });
    await creerRegle(bureau, bureau.orgA, { name: `${marque} brouillon`, is_active: false });
    await creerRegle(bureau, bureau.orgA, { name: `${marque} corbeille`, is_active: false, deleted_at: new Date().toISOString() });
    await creerRegle(bureau, bureau.orgA, { name: `${marque} purgée`, is_active: false, deleted_at: new Date().toISOString(), purged_at: new Date().toISOString() });
    // Depuis 098dd153 (2026-10-01), un préréglage RETIRÉ (« Estimate Follow-Up », déclencheur que plus rien
    // n'émet) n'est montré nulle part : ni dans la liste, ni dans ces tuiles (`estPrereglageRetire`,
    // src/lib/automationCatalogue.ts). La base le garde ; le compte attendu l'écarte donc, lui et lui seul.
    const { data: vivantes, error } = await bureau.admin.from('automation_rules').select('id, is_active, preset_key, trigger_event')
      .eq('org_id', bureau.orgA).is('deleted_at', null).is('purged_at', null);
    if (error) throw new Error(error.message);
    const montrees = (vivantes ?? []).filter((r) => !estPrereglageRetire(r as { preset_key: string | null; trigger_event: string | null }));
    expect((vivantes ?? []).length - montrees.length, 'préréglages retirés du bureau (0 ou 1)').toBeLessThanOrEqual(1);
    const total = montrees.length;
    const publiees = montrees.filter((r) => r.is_active).length;
    expect(total).toBeGreaterThanOrEqual(2);
    await ouvrirApercu(page);
    await expect(tuile(page, 'Total des automatisations')).toHaveText(String(total));
    await expect(tuile(page, 'Automatisations publiées')).toHaveText(String(publiees));
    // Au moins une automatisation vivante n'est pas publiée : les deux tuiles ne peuvent pas afficher le même nombre par hasard.
    expect(publiees).toBeLessThan(total);
  });

  test('[APR-003] déclenchements, courbe, croissance et erreurs : l’écran affiche ce qui a été préparé en base ; le bouton mène à « À vérifier »', async ({ page, bureau, marque }) => {
    await viderJournaux(bureau);
    const regle = await creerRegle(bureau, bureau.orgA, { name: `${marque} avec journaux`, is_active: true });
    const [e1, e2, e3, e4, e5, e6] = Array.from({ length: 6 }, () => randomUUID());
    await journaliser(bureau, regle, [
      // Cette semaine : 3 déclenchements (e1 a fait trois actions : il ne compte qu'une fois).
      { entite: e1, ilYA: HEURE, succes: true }, { entite: e1, ilYA: HEURE, succes: true, action: 'send_email' }, { entite: e1, ilYA: HEURE, succes: true, action: 'create_task' },
      { entite: e2, ilYA: HEURE, succes: true },
      { entite: e3, ilYA: 2 * JOUR, succes: false },
      // La semaine d'avant : 2 déclenchements, dont un échec trop vieux pour le résumé « 7 derniers jours ».
      { entite: e4, ilYA: 10 * JOUR, succes: true },
      { entite: e5, ilYA: 10 * JOUR, succes: false },
      // Il y a 60 jours : hors des 7 semaines.
      { entite: e6, ilYA: 60 * JOUR, succes: true },
    ]);
    await ouvrirApercu(page);
    await expect(tuile(page, 'Total des déclenchements')).toHaveText('5');
    await expect(page.getByRole('heading', { name: 'Déclenchements — 7 dernières semaines' })).toBeVisible();
    await expect(page.getByRole('img', { name: 'Déclenchements par semaine : 0, 0, 0, 0, 0, 2, 3' })).toBeVisible();
    await expect(page.getByText(/^Du .+ au .+ · Déclenchements : 3 · Croissance : \+50 %$/)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Résumé des erreurs' })).toBeVisible();
    await expect(page.getByText('1 envoi(s) ont échoué ces 7 derniers jours.')).toBeVisible();
    await page.screenshot({ path: `${CAPTURES}/apr-chiffres.png` });
    await page.getByRole('button', { name: 'Voir les automatisations à vérifier' }).click();
    await expect(page).toHaveURL(/\/automations\?onglet=verifier$/);
    await expect(page.getByRole('tab', { name: 'À vérifier (1)' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('checkbox', { name: `Cocher ${marque} avec journaux` })).toBeVisible();
    await expect(page.getByText(/1 échec(\(s\))? dans les 7 derniers jours/)).toBeVisible();
  });

  test('[APR-003] sans aucun échec : « Aucune erreur — toutes les automatisations tournent normalement. », et pas de bouton', async ({ page, bureau }) => {
    await viderJournaux(bureau);
    await ouvrirApercu(page);
    await expect(tuile(page, 'Total des déclenchements')).toHaveText('0');
    await expect(page.getByRole('img', { name: 'Déclenchements par semaine : 0, 0, 0, 0, 0, 0, 0' })).toBeVisible();
    await expect(page.getByText(/· Déclenchements : 0 · Croissance : —$/)).toBeVisible();
    await expect(page.getByText('Aucune erreur — toutes les automatisations tournent normalement.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Voir les automatisations à vérifier' })).toHaveCount(0);
  });

  test('[APR-003] le total de la vue d’ensemble est la somme des « Total déclenché » de la liste @defaut', async ({ page, bureau, marque, jetonDe, baseURL }) => {
    await viderJournaux(bureau);
    // Deux automatisations déclenchées par le MÊME prospect, le même jour.
    const a = await creerRegle(bureau, bureau.orgA, { name: `${marque} bienvenue`, is_active: true });
    const b = await creerRegle(bureau, bureau.orgA, { name: `${marque} suivi`, is_active: true });
    const prospect = randomUUID();
    await journaliser(bureau, a, [{ entite: prospect, ilYA: HEURE, succes: true }]);
    await journaliser(bureau, b, [{ entite: prospect, ilYA: HEURE, succes: true }]);
    const stats = await appelApi(baseURL!, await jetonDe('proprioA'), bureau.orgA, 'GET', '/api/automations/rules/stats');
    expect(stats.status).toBe(200);
    const parRegle = (stats.json as { par_regle: Record<string, { declenches: number }> }).par_regle;
    const somme = (parRegle[a.id]?.declenches ?? 0) + (parRegle[b.id]?.declenches ?? 0);
    expect(somme, 'la liste compte un déclenchement par automatisation').toBe(2);
    await ouvrirApercu(page);
    await page.screenshot({ path: `${CAPTURES}/apr-total-different-de-la-liste.png` });
    await expect(tuile(page, 'Total des déclenchements')).toHaveText(String(somme));
  });

  test('[APR-003] le résumé parle juste : « 1 envoi a échoué » au singulier, et pas « envoi » pour une tâche @defaut', async ({ page, bureau, marque }) => {
    await viderJournaux(bureau);
    const regle = await creerRegle(bureau, bureau.orgA, { name: `${marque} tâche en échec`, is_active: true });
    await journaliser(bureau, regle, [{ entite: randomUUID(), ilYA: HEURE, succes: false, action: 'create_task', erreur: 'Aucun responsable' }]);
    await ouvrirApercu(page);
    const phrase = page.getByText(/ces 7 derniers jours\.$/);
    await expect(phrase).toBeVisible();
    await page.screenshot({ path: `${CAPTURES}/apr-envoi-s-ont-echoue.png` });
    await expect(phrase).not.toContainText('(s)');
    await expect(phrase).not.toContainText('envoi');
  });
});

test.describe('vue d’ensemble — lectures ratées', () => {
  test('[APR-003] journaux d’erreurs illisibles : l’écran le dit (pas « Aucune erreur »)', async ({ page, moniteur }) => {
    moniteur.attendu(/500 GET .*automation_execution_logs.*result_success/, 'panne simulée par page.route');
    moniteur.attendu(/\[apercu\] journaux illisibles/, 'la page journalise l’échec');
    await page.route('**/rest/v1/automation_execution_logs**', (route) => (route.request().url().includes('result_success')
      ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'panne simulée' }) })
      : route.fallback()));
    await ouvrirApercu(page);
    await expect(page.getByText('Les erreurs n’ont pas pu être lues pour le moment. Réessayez dans un instant.')).toBeVisible();
    await expect(page.getByText(/Aucune erreur/)).toHaveCount(0);
  });

  test('[APR-001] automatisations illisibles : « — » dans les deux premières tuiles, pas « 0 »', async ({ page, moniteur }) => {
    moniteur.attendu(/500 GET .*\/rest\/v1\/automation_rules/, 'panne simulée par page.route');
    moniteur.attendu(/\[apercu\] règles illisibles/, 'la page journalise l’échec');
    await page.route('**/rest/v1/automation_rules**', (route) => (route.request().method() === 'GET'
      ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'panne simulée' }) })
      : route.fallback()));
    await ouvrirApercu(page);
    await expect(tuile(page, 'Total des automatisations')).toHaveText('—');
    await expect(tuile(page, 'Automatisations publiées')).toHaveText('—');
  });

  test('[APR-003] activité illisible : la tuile et la courbe le disent, au lieu d’afficher « 0 » comme s’il ne s’était rien passé @defaut', async ({ page, moniteur }) => {
    moniteur.attendu(/500 GET .*automation_execution_logs.*trigger_event/, 'panne simulée par page.route');
    moniteur.attendu(/\[apercu\] activité par semaine/, 'la lecture journalise l’échec');
    await page.route('**/rest/v1/automation_execution_logs**', (route) => (route.request().url().includes('trigger_event')
      ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'panne simulée' }) })
      : route.fallback()));
    await ouvrirApercu(page);
    await page.screenshot({ path: `${CAPTURES}/apr-activite-illisible-zero.png` });
    await expect(tuile(page, 'Total des déclenchements')).not.toHaveText('0');
  });

  test('[APR-001] pendant le chargement, une roue ; jamais de chiffres provisoires', async ({ page }) => {
    let lacher: () => void = () => undefined;
    const retenue = new Promise<void>((r) => { lacher = r; });
    await page.route('**/rest/v1/automation_rules**', async (route) => { if (route.request().method() === 'GET') await retenue; await route.fallback(); });
    await page.goto('/automations/apercu');
    await expect(page.getByRole('navigation', { name: 'Sections' })).toBeVisible({ timeout: 90_000 });
    await expect(page.getByText('Total des automatisations')).toHaveCount(0);
    lacher();
    await expect(page.getByText('Total des automatisations')).toBeVisible({ timeout: 60_000 });
  });
});

test.describe('vue d’ensemble — forfait sans automatisations', () => {
  test('[APR-004] « Fonctionnalité premium » : la fenêtre de forfait s’ouvre d’office, « Voir les détails » la rouvre', async ({ page }) => {
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
    await page.goto('/automations/apercu');
    // « Fonctionnalité premium » est écrit DEUX fois quand la fenêtre de forfait est ouverte (la page, puis
    // l'en-tête de la fenêtre, plus bas dans le document) : on vise celui de la page, le premier.
    const premium = page.getByText('Fonctionnalité premium', { exact: true }).first();
    await expect(premium).toBeVisible({ timeout: 90_000 });
    await expect(premium.locator('xpath=following-sibling::p[1]')).toHaveText('Passez à un forfait supérieur pour accéder à cette section.');
    await expect(page.getByText('Total des automatisations')).toHaveCount(0);
    // La fenêtre de forfait (PlanUpgradeModal, hors lot) n'a ni rôle ni titre accessible : on la reconnaît à sa croix.
    const croix = page.getByRole('button', { name: /^(Close|Fermer)$/ });
    await expect(croix).toBeVisible();
    await page.screenshot({ path: `${CAPTURES}/apr-004-forfait.png` });
    await croix.click();
    await expect(croix).toBeHidden();
    await expect(premium).toBeVisible();
    await page.getByRole('button', { name: 'Voir les détails' }).click();
    await expect(croix).toBeVisible();
  });
});

test.describe('vue d’ensemble — anglais', () => {
  test.use({ langue: 'en' });

  test('[APR-001][APR-002][APR-003] tous les libellés sont en anglais', async ({ page, bureau, marque }) => {
    await viderJournaux(bureau);
    const regle = await creerRegle(bureau, bureau.orgA, { name: `${marque} failing`, is_active: true });
    await journaliser(bureau, regle, [{ entite: randomUUID(), ilYA: HEURE, succes: false }]);
    await ouvrirApercu(page);
    const nav = page.getByRole('navigation', { name: 'Sections' });
    // Trois liens depuis #870 (SousNavigation.tsx), la section courante en aria-current.
    await expect(nav.getByRole('link')).toHaveText(['Workflows', /^Overview\s*Beta$/, 'Global settings']);
    await expect(nav.getByRole('link', { name: /^Overview/ })).toHaveAttribute('aria-current', 'page');
    await expect(nav.getByRole('link', { name: /^Overview/ }).getByText('Beta', { exact: true })).toBeVisible();
    for (const libelle of ['Total workflows', 'Published workflows', 'Total enrollments']) await expect(page.getByText(libelle, { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Enrollments — last 7 weeks' })).toBeVisible();
    await expect(page.getByText(/^From .+ to .+ · Enrollments: 1 · Growth: —$/)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Error review summary' })).toBeVisible();
    await expect(page.getByText('1 send(s) failed in the last 7 days.')).toBeVisible();
    await page.getByRole('button', { name: 'See workflows needing review' }).click();
    await expect(page).toHaveURL(/\/automations\?onglet=verifier$/);
    await expect(page.getByRole('heading', { name: 'Workflows list' })).toBeVisible();
  });
});
