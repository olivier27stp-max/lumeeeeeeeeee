import { expect, type Page } from '@playwright/test';
import pg from 'pg';
import { API, ANON_KEY, DB_URL } from '../env-local';
import { MEMBRES, MOT_DE_PASSE } from '../fixture';
import { lireOracle, type Attendu } from '../comparer';

export const SEPT = { from: '2026-09-01', to: '2026-09-30' };

/** Espaces insécables (fr-CA) → espace simple, pour comparer des montants. */
export const norm = (s: string) => s.replace(/[\s  ]+/g, ' ').trim();
export const argent = (cents: number, lang: 'fr' | 'en') =>
  norm(new Intl.NumberFormat(lang === 'fr' ? 'fr-CA' : 'en-CA', { style: 'currency', currency: 'CAD', minimumFractionDigits: 2 }).format(cents / 100));

export async function oracle(): Promise<Attendu[]> {
  const db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  try { return await lireOracle(db); } finally { await db.end(); }
}

/**
 * Une session par utilisateur pour toute la suite : GoTrue limite les
 * connexions (~30 / 5 min en local) et chaque test se reconnectait par le
 * formulaire. La connexion par le formulaire garde son propre test.
 */
const sessions = new Map<string, unknown>();
async function sessionDe(userId: string) {
  if (!sessions.has(userId)) {
    const m = MEMBRES.find((x) => x.id === userId)!;
    const r = await fetch(`${API}/auth/v1/token?grant_type=password`, {
      method: 'POST', headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: m.courriel, password: MOT_DE_PASSE }),
    });
    if (!r.ok) throw new Error(`session ${m.courriel}: HTTP ${r.status}`);
    sessions.set(userId, await r.json());
  }
  return sessions.get(userId);
}

export async function connecter(page: Page, userId: string, langue: 'fr' | 'en' = 'fr') {
  const session = await sessionDe(userId);
  await page.addInitScript(([l, s]) => {
    try {
      localStorage.setItem('lume-language', l as string);
      localStorage.setItem('lume-auth-token', JSON.stringify(s));
    } catch { /* aperçu */ }
  }, [langue, session] as const);
  await preparerFenetres(page);
  await page.goto('/');
  await page.waitForURL((u) => !u.pathname.startsWith('/auth'), { timeout: 30_000 });
}

/** Connexion par le vrai formulaire (un seul test : la limite de GoTrue). */
export async function connecterParFormulaire(page: Page, userId: string, langue: 'fr' | 'en' = 'fr') {
  const m = MEMBRES.find((x) => x.id === userId)!;
  await page.addInitScript((l) => { try { localStorage.setItem('lume-language', l); } catch { /* aperçu */ } }, langue);
  await preparerFenetres(page);
  await page.goto('/auth');
  await page.locator('input[type="email"]').fill(m.courriel);
  await page.locator('input[type="password"]').fill(MOT_DE_PASSE);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL((u) => !u.pathname.startsWith('/auth'), { timeout: 30_000 });
}

async function preparerFenetres(page: Page) {
  // Fenêtres qui s'ouvrent quelques secondes après la connexion : on répond
  // comme un utilisateur prudent (« Refuser »), dès qu'elles apparaissent.
  // (Cette fenêtre n'a pas de nom accessible : on la reconnaît à son titre.)
  await page.addLocatorHandler(page.getByRole('dialog').filter({ hasText: /Partage de votre localisation|Location sharing/ }), async (d) => {
    await d.getByRole('button', { name: /^(Refuser|Decline)$/ }).click();
  });
  await page.addLocatorHandler(page.getByRole('dialog', { name: /Votre vie privée|Your privacy/ }), async (d) => {
    await d.getByRole('button', { name: /Tout refuser|Reject all/ }).click();
  });
}

export async function filtrerPeriode(page: Page, from: string, to: string, fr = true) {
  const debut = page.getByLabel(fr ? 'Date de début' : 'From date').first();
  const fin = page.getByLabel(fr ? 'Date de fin' : 'To date').first();
  await debut.fill(from);
  await fin.fill(to);
  await expect(page.getByText(fr ? /Chargement des commissions/ : /Loading commissions/)).toHaveCount(0);
}

/**
 * Aucun défilement horizontal de la page (règle de mise en page du projet),
 * ET chaque onglet atteignable : un conteneur en overflow caché masquait
 * l'onglet « Taux » à 390 px sans créer de défilement de page.
 */
export async function sansDefilementHorizontal(page: Page) {
  const debord = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(debord).toBeLessThanOrEqual(1);
  for (const nom of ["Vue d'ensemble", 'Représentants', 'Mes commissions', 'Taux']) {
    const onglet = page.getByRole('button', { name: nom, exact: true });
    if (await onglet.count() === 0) continue;
    await onglet.scrollIntoViewIfNeeded();
    const boite = await onglet.boundingBox();
    const largeur = page.viewportSize()!.width;
    expect(boite, `onglet ${nom}`).not.toBeNull();
    expect(boite!.x + boite!.width, `onglet ${nom} visible`).toBeLessThanOrEqual(largeur + 1);
    expect(boite!.x, `onglet ${nom} visible`).toBeGreaterThanOrEqual(-1);
  }
}

/** Attend la fin des chargements asynchrones qui déplacent la mise en page. */
export async function pageStable(page: Page) {
  const fr = (await page.evaluate(() => document.documentElement.lang)) !== 'en';
  await expect(page.getByText(fr ? /Chargement/ : /Loading/)).toHaveCount(0);
  const reps = page.getByLabel(fr ? 'Filtrer par représentant' : 'Sales rep filter');
  // Le filtre « représentant » n'existe que pour un gestionnaire, sur un onglet avec filtres.
  const aDesFiltres = await page.getByLabel(fr ? 'Filtrer par statut' : 'Status filter').count();
  const gestionnaire = await page.getByRole('button', { name: fr ? 'Taux' : 'Rates', exact: true }).count();
  if (aDesFiltres && gestionnaire) await expect(reps.first()).toBeVisible();
}

/** Éléments flottants à l'horaire variable (carte Configuration, bouton d'aide) : masqués des captures. */
export const masques = (page: Page) => [page.locator('nav'), page.getByText('Configuration').locator('xpath=ancestor::div[contains(@class,"fixed")][1]'), page.locator('.fixed.bottom-0, .fixed.bottom-4, .fixed.bottom-6')];
