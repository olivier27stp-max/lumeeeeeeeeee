/**
 * Interface, par rôle — carte §1 (routes et gardes) et §5.2 (matrice des rôles).
 *
 * Pour chacun des six rôles du bureau A, dans un vrai navigateur :
 *   · ce que montre la barre latérale (l'entrée « Automatisations » sous « Plus ») ;
 *   · ce qui s'affiche sur `/automations`, `/automations/apercu`,
 *     `/automations/reglages`, `/automations/:id` et `/automations/nouvelle` ;
 *   · quand une garde refuse : le message est-il clair, en français (ou en
 *     anglais pour un compte anglais), avec une issue ?
 * Attendu, d'après les clés de permission des routes (src/App.tsx) :
 *   liste et vue d'ensemble = `automations.read` ; réglages et éditeur = `automations.update`.
 *
 * Soupçon S-01 : la route de la liste demande `read`, mais la page exige `update`.
 * Soupçon S-22 : `/automations/hub` et `/automations/builder` reviennent à la liste.
 */
import { mkdirSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { creerRegle } from '../_outils/banc';
import { test, expect, LIBELLE, SORTIES_LOT, type Role } from './_roles';

const CAP = `${SORTIES_LOT}/captures`;
mkdirSync(CAP, { recursive: true });

const LONG = { timeout: 90_000 };
const REFUS_TITRE = 'Accès restreint';
const REFUS_TEXTE = 'Vous n\'avez pas la permission de voir cette page. Contactez votre administrateur si vous croyez que c\'est une erreur.';

type Ecran = 'liste' | 'apercu' | 'reglages' | 'editeur' | 'nouvelle';

/** Ce qui prouve que l'écran est OUVERT (pas seulement que l'adresse a répondu). */
async function attendreOuvert(page: Page, ecran: Ecran, nomRegle: string): Promise<void> {
  if (ecran === 'liste') {
    await expect(page.getByRole('heading', { name: 'Mes automatisations', level: 1 })).toBeVisible(LONG);
    await expect(page.getByRole('table')).toBeVisible(LONG);
  } else if (ecran === 'apercu') {
    await expect(page.getByText('Total des automatisations')).toBeVisible(LONG);
    await expect(page.getByRole('heading', { name: /Déclenchements — 7 dernières semaines/ })).toBeVisible();
  } else if (ecran === 'reglages') {
    await expect(page.getByRole('heading', { name: 'Réglages globaux', level: 1 })).toBeVisible(LONG);
    await expect(page.getByRole('heading', { name: 'Adresses d’appel' })).toBeVisible(LONG);
  } else if (ecran === 'editeur') {
    await expect(page.getByRole('tab', { name: 'Parcours' })).toBeVisible(LONG);
    await expect(page.getByRole('button', { name: nomRegle })).toBeVisible(LONG);
  } else {
    await expect(page.getByRole('tab', { name: 'Parcours' })).toBeVisible(LONG);
    await expect(page.getByRole('button', { name: 'Nouvelle automatisation' })).toBeVisible(LONG);
  }
}

/** Ce qui prouve un REFUS propre : titre + phrase en français, dans la coquille de l'app (la barre latérale reste là). */
async function attendreRefus(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: REFUS_TITRE })).toBeVisible(LONG);
  await expect(page.getByText(REFUS_TEXTE)).toBeVisible();
  await expect(page.getByRole('complementary').getByRole('button', { name: 'Accueil' })).toBeVisible();
}

const ROUTES: Array<{ id: string; ecran: Ecran; chemin: (idRegle: string) => string; cle: 'read' | 'update' }> = [
  { id: 'RTE-01', ecran: 'liste', chemin: () => '/automations', cle: 'read' },
  { id: 'RTE-02', ecran: 'apercu', chemin: () => '/automations/apercu', cle: 'read' },
  { id: 'RTE-03', ecran: 'reglages', chemin: () => '/automations/reglages', cle: 'update' },
  { id: 'RTE-04', ecran: 'editeur', chemin: (id) => `/automations/${id}`, cle: 'update' },
  { id: 'RTE-05', ecran: 'nouvelle', chemin: () => '/automations/nouvelle', cle: 'update' },
];

const DROITS: Record<Exclude<Role, 'proprioB'>, { read: boolean; update: boolean }> = {
  proprioA: { read: true, update: true },
  adminA: { read: true, update: true },
  editeurA: { read: true, update: true },
  lecteurA: { read: true, update: false },
  vendeurA: { read: false, update: false },
  techA: { read: false, update: false },
};

test.describe('routes du client, par rôle', () => {
  for (const role of Object.keys(DROITS) as Array<Exclude<Role, 'proprioB'>>) {
    // Le membre « read seul » est refusé sur la liste que sa permission devrait ouvrir (S-01) : test rouge.
    const defaut = role === 'lecteurA' ? ' @defaut' : '';
    test(`[RTE-01][RTE-02][RTE-03][RTE-04][RTE-05]${role === 'lecteurA' ? '[S-01]' : ''} ${LIBELLE[role]} : chaque écran s’ouvre ou se refuse selon ses permissions, avec un refus clair en français${defaut}`, async ({ ongletDe, bureau, marque }) => {
      test.setTimeout(600_000);
      const nom = `${marque} règle du bureau`;
      const regle = await creerRegle(bureau, bureau.orgA, { name: nom });
      const { page, moniteur } = await ongletDe(role);
      // Pour un rôle refusé, le serveur répond 403 aux lectures que la page tente quand même : attendu ET vérifié ci-dessous par l'écran de refus.
      if (role === 'lecteurA') moniteur.attendu(/403 .*\/api\/automations\//, 'S-01 : la liste se monte derrière la garde et appelle des routes réservées à automations.update');
      for (const r of ROUTES) {
        await page.goto(r.chemin(regle.id));
        const autorise = DROITS[role][r.cle];
        if (autorise) {
          // expect.soft n'existe pas pour une suite d'attentes : on capture l'échec pour continuer les autres écrans.
          const erreur = await attendreOuvert(page, r.ecran, nom).then(() => null, (e: unknown) => e as Error);
          if (erreur) await page.screenshot({ path: `${CAP}/${r.id}-${role}-inattendu.png` });
          expect.soft(erreur === null, `${r.id} ${r.chemin(':id')} : ${LIBELLE[role]} a automations.${r.cle} — l'écran doit s'ouvrir. ${erreur ? `Observé : ${(await page.getByRole('heading').allInnerTexts()).join(' | ') || 'aucun titre'}` : ''}`).toBe(true);
        } else {
          const erreur = await attendreRefus(page).then(() => null, (e: unknown) => e as Error);
          if (erreur) await page.screenshot({ path: `${CAP}/${r.id}-${role}-inattendu.png` });
          expect.soft(erreur === null, `${r.id} ${r.chemin(':id')} : ${LIBELLE[role]} n'a pas automations.${r.cle} — refus « ${REFUS_TITRE} » attendu. ${erreur ? erreur.message.split('\n')[0] : ''}`).toBe(true);
          // Rien de la page protégée n'est rendu derrière le refus.
          await expect.soft(page.getByRole('heading', { name: 'Mes automatisations' })).toHaveCount(0);
          await expect.soft(page.getByText(nom)).toHaveCount(0);
        }
      }
      await page.screenshot({ path: `${CAP}/RTE-${role}-dernier-ecran.png` });
    });
  }
});

test.describe('barre latérale, par rôle', () => {
  for (const role of Object.keys(DROITS) as Array<Exclude<Role, 'proprioB'>>) {
    const voit = DROITS[role].read;
    const defaut = role === 'lecteurA' ? ' @defaut' : '';
    test(`[EXT-001]${role === 'lecteurA' ? '[S-01]' : ''} ${LIBELLE[role]} : l’entrée « Automatisations » du menu « Plus » est ${voit ? 'visible et mène à une page utilisable' : 'absente'}${defaut}`, async ({ ongletDe }) => {
      test.setTimeout(300_000);
      const { page, moniteur } = await ongletDe(role);
      if (role === 'lecteurA') moniteur.attendu(/403 .*\/api\/automations\//, 'S-01 : la liste se monte derrière la garde');
      await page.goto('/');
      const menu = page.getByRole('complementary').getByRole('navigation');
      await expect(menu.getByRole('button', { name: 'Accueil' })).toBeVisible(LONG);
      const entree = menu.getByRole('button', { name: 'Automatisations', exact: true });
      // « Plus » est replié par défaut hors des pages qu'il contient.
      const plus = menu.getByRole('button', { name: 'Plus', exact: true });
      if (voit) {
        await expect(plus).toBeVisible(LONG);
        if (!(await entree.isVisible())) await plus.click();
        await expect(entree).toBeVisible();
        await entree.click();
        await expect(page).toHaveURL(/\/automations$/);
        // La page d'arrivée doit servir à quelque chose : pas un « Accès restreint » après avoir offert l'entrée.
        // On attend d'abord que la page ait TRANCHÉ (liste, vue d'ensemble ou refus) : « aucun refus » lu pendant le
        // chargement des permissions passait à tort, et l'échec ne tombait que 90 s plus tard sur le titre absent.
        const arrivee = page.getByRole('heading', { name: 'Mes automatisations', level: 1 }).or(page.getByText('Total des automatisations'));
        await expect(arrivee.or(page.getByRole('heading', { name: REFUS_TITRE })).first()).toBeVisible(LONG);
        await expect(page.getByRole('heading', { name: REFUS_TITRE }), 'le menu a offert « Automatisations » : la page ne doit pas répondre « Accès restreint »').toHaveCount(0);
        await expect(arrivee).toBeVisible(LONG);
      } else {
        // Le groupe « Plus » peut exister pour d'autres entrées (Tâches) : on l'ouvre s'il est là.
        if (await plus.isVisible()) await plus.click();
        await expect(entree).toHaveCount(0);
      }
    });
  }
});

test.describe('S-01 — membre en lecture seule', () => {
  test('[S-01] vue d’ensemble : aucun bouton offert à un membre en lecture seule ne mène à « Accès restreint » @defaut', async ({ ongletDe }) => {
    test.setTimeout(300_000);
    const { page, moniteur } = await ongletDe('lecteurA');
    moniteur.attendu(/403 .*\/api\/automations\//, 'S-01 : la liste se monte derrière la garde');
    await page.goto('/automations/apercu');
    await expect(page.getByText('Total des automatisations')).toBeVisible(LONG);
    const sections = page.getByRole('navigation', { name: 'Sections' });
    // Les deux autres onglets de la sous-navigation sont offerts… Depuis #870 ce sont des LIENS
    // (src/components/automations/SousNavigation.tsx : un seul composant pour les trois pages, <Link>), plus des boutons.
    for (const nom of ['Automatisations', 'Réglages globaux']) {
      await expect(sections.getByRole('link', { name: nom, exact: true })).toBeVisible();
    }
    // … « Automatisations » (route en `read`) doit mener à une page utilisable.
    await sections.getByRole('link', { name: 'Automatisations', exact: true }).click();
    await expect(page).toHaveURL(/\/automations$/);
    // La page doit avoir TRANCHÉ (liste ou refus) avant qu'on lise « aucun refus » : lu pendant le chargement, il passait à tort.
    const refus = page.getByRole('heading', { name: REFUS_TITRE });
    await expect(page.getByRole('heading', { name: 'Mes automatisations', level: 1 }).or(refus).first()).toBeVisible(LONG);
    await page.screenshot({ path: `${CAP}/S-01-lecteur-liste.png` });
    await expect.soft(refus, 'onglet « Automatisations » → « Accès restreint »').toHaveCount(0);
    // … et « Réglages globaux » (route en `update`) ne devrait pas être proposé à qui ne peut pas l'ouvrir.
    await page.goto('/automations/apercu');
    await expect(page.getByText('Total des automatisations')).toBeVisible(LONG);
    await page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: 'Réglages globaux', exact: true }).click();
    await expect(page).toHaveURL(/\/automations\/reglages$/);
    await expect(page.getByRole('heading', { name: 'Réglages globaux', level: 1 }).or(refus).first()).toBeVisible(LONG);
    await expect.soft(refus, 'onglet « Réglages globaux » → « Accès restreint »').toHaveCount(0);
  });

  test('[S-01] le membre en lecture seule LIT les règles par l’API (200) : seule la page liste le lui refuse', async ({ jeton, bureau, baseURL }) => {
    const r = await fetch(`${baseURL}/api/automations/rules`, { headers: { Authorization: `Bearer ${await jeton('lecteurA')}`, 'x-org-id': bureau.orgA } });
    expect(r.status).toBe(200);
    const j = await r.json() as { rules: unknown[] };
    expect(j.rules.length, 'les automatisations du bureau lui sont servies').toBeGreaterThan(0);
  });
});

test.describe('refus, langue et issue', () => {
  test('[RTE-08] technicien, compte en anglais : le refus est en anglais (« Access Restricted »), sans français qui traîne', async ({ ongletDe }) => {
    const { page } = await ongletDe('techA', { langue: 'en' });
    await page.goto('/automations');
    await expect(page.getByRole('heading', { name: 'Access Restricted' })).toBeVisible(LONG);
    await expect(page.getByText('You don\'t have permission to view this page. Contact your administrator if you believe this is an error.')).toBeVisible();
    await expect(page.getByText(REFUS_TITRE)).toHaveCount(0);
    await page.screenshot({ path: `${CAP}/RTE-08-refus-anglais.png` });
  });

  test('[RTE-08] technicien : depuis l’écran de refus, la barre latérale reste utilisable (retour à l’accueil)', async ({ ongletDe }) => {
    const { page } = await ongletDe('techA');
    await page.goto('/automations/reglages');
    await attendreRefus(page);
    await page.screenshot({ path: `${CAP}/RTE-08-refus-francais.png` });
    await page.getByRole('complementary').getByRole('button', { name: 'Accueil' }).click();
    // L'accueil de l'app est `/day` (src/App.tsx : entrée « Accueil » → path '/day', et « / » y redirige — commit 40527874).
    await expect(page).toHaveURL(/\/day$/);
    await expect(page.getByRole('heading', { name: REFUS_TITRE })).toHaveCount(0);
    // … et l'accueil s'ouvre vraiment pour lui : la barre latérale est toujours là, sans écran de refus.
    await expect(page.getByRole('complementary').getByRole('button', { name: 'Accueil' })).toBeVisible();
  });

  test('[RTE-08] l’écran de refus propose lui-même une issue (bouton ou lien), pas seulement « contactez votre administrateur » @defaut', async ({ ongletDe }) => {
    const { page } = await ongletDe('techA');
    await page.goto('/automations');
    await attendreRefus(page);
    // Attendu : dans le panneau de refus, un bouton « Retour » / « Accueil » — aujourd'hui il n'y a que du texte.
    const panneau = page.getByRole('main').locator('div', { has: page.getByRole('heading', { name: REFUS_TITRE }) }).last();
    await expect(panneau.getByRole('button').or(panneau.getByRole('link')), 'le panneau « Accès restreint » ne contient ni bouton ni lien').not.toHaveCount(0);
  });
});

test.describe('anciennes adresses et session', () => {
  test('[RTE-06][RTE-07][S-22] /automations/hub et /automations/builder ramènent à la liste (pas l’éditeur sur un identifiant « hub »)', async ({ page }) => {
    for (const chemin of ['/automations/hub', '/automations/builder']) {
      await page.goto(chemin);
      await expect(page).toHaveURL(/\/automations$/, LONG);
      await expect(page.getByRole('heading', { name: 'Mes automatisations', level: 1 })).toBeVisible(LONG);
      await expect(page.getByRole('tab', { name: 'Parcours' })).toHaveCount(0);
    }
  });

  test('[RTE-10] hors session, /automations renvoie à la connexion en gardant la destination (`next`)', async ({ browser, baseURL }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await page.goto(`${baseURL}/automations/apercu`);
      await expect(page).toHaveURL(/\/auth\?next=(%2F|\/)automations(%2F|\/)apercu/, LONG);
      await expect(page.getByRole('heading', { name: 'Mes automatisations' })).toHaveCount(0);
    } finally { await context.close(); }
  });

  test('[RTE-11] le bouton d’aide flottant est présent sur la liste et retiré dans l’éditeur plein écran', async ({ page, bureau, marque }) => {
    const regle = await creerRegle(bureau, bureau.orgA, { name: `${marque} aide` });
    await page.goto('/automations');
    await expect(page.getByRole('heading', { name: 'Mes automatisations', level: 1 })).toBeVisible(LONG);
    await expect(page.getByRole('button', { name: 'Aide et support' })).toBeVisible();
    await page.goto(`/automations/${regle.id}`);
    await expect(page.getByRole('tab', { name: 'Parcours' })).toBeVisible(LONG);
    await expect(page.getByRole('button', { name: 'Aide et support' })).toHaveCount(0);
  });
});
