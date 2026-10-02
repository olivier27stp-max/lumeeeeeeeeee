/* ═══════════════════════════════════════════════════════════════
   Agent F — ce que l'ÉCRAN montre des crédits Lumi (vrai navigateur).

   Chromium (Playwright) sur le Vite local (port 5496), connecté par lien
   magique comme les tests d'interface de la suite (harnais/navigateur.ts).

     QA_AUTO_SUFFIXE=f npx tsx --env-file=.env.local scripts/qa/finale/f/ecran.mts

   1. Bureau A : le compteur de la page Lumi = le solde en base.
   2. Bureau A : aucun montant en dollars d'IA sur la page Lumi, la liste des
      automatisations et l'éditeur ouvert sur « Construire avec Lumi ».
   3. Bureau B (crédits épuisés par credits.mts) : ce que lit la personne sur la
      page Lumi, puis en demandant une automatisation à Lumi dans l'éditeur.

   Captures et sortie HORS du dépôt : D:/lume-final/sorties/f-ecran-*.png et
   f-ecran.json (une capture dans le worktree relance Vite en boucle).
   ═══════════════════════════════════════════════════════════════ */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type BrowserContext, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { adminStaging, assurerBureauTest, COMPTES } from '../../../../tests/automations-suite/harnais/bureau-test';
import { exigerPileLocale, SORTIES, n } from './commun.mts';

exigerPileLocale();
const BASE = process.env.F_APP || 'http://127.0.0.1:5496';
const admin = adminStaging();
const { orgA, orgB } = await assurerBureauTest(admin);

const VERSION_TEMOINS = readFileSync(join(process.cwd(), 'src/lib/consentApi.ts'), 'utf8').match(/CURRENT_COOKIE_POLICY_VERSION\s*=\s*'([^']+)'/)?.[1] ?? '';

async function session(email: string) {
  const url = process.env.VITE_SUPABASE_URL!; const anon = process.env.VITE_SUPABASE_ANON_KEY!;
  const { data: l, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (error) throw new Error(`lien magique : ${error.message}`);
  const { data: s, error: e2 } = await createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } }).auth.verifyOtp({ token_hash: l.properties.hashed_token, type: 'magiclink' });
  if (e2 || !s.session) throw new Error(`session ${email} : ${e2?.message}`);
  return s.session;
}

const navigateur = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'] });
async function onglet(email: string, org: string): Promise<{ context: BrowserContext; page: Page; erreurs: string[] }> {
  const s = await session(email);
  const context = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-CA', timezoneId: 'America/Toronto' });
  const jeton = { access_token: s.access_token, refresh_token: s.refresh_token, expires_at: s.expires_at, expires_in: s.expires_in, token_type: 'bearer', user: s.user };
  await context.addInitScript(({ jeton, org, origine, version }) => {
    if (location.origin !== origine) return;
    if (sessionStorage.getItem('qa-ui-init')) return;
    sessionStorage.setItem('qa-ui-init', '1');
    localStorage.setItem('lume-auth-token', JSON.stringify(jeton));
    localStorage.setItem('lume-active-org', org);
    localStorage.setItem('lume-language', 'fr');
    localStorage.setItem('lume.cookieConsent.v1', JSON.stringify({ analytics: false, marketing: false, preferences: false, decidedAt: new Date().toISOString(), docVersion: version }));
    localStorage.setItem('lume-setup-dismissed', '1');
  }, { jeton, org, origine: BASE, version: VERSION_TEMOINS });
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  const erreurs: string[] = [];
  // La pile locale n'a pas de service temps réel : ses erreurs de WebSocket sont attendues. La clé (locale, jetable) portée par l'adresse est masquée.
  page.on('console', (m) => { if (m.type() === 'error') { const e = m.text().replace(/apikey=[^\s'"]+/g, 'apikey=<clé locale masquée>').slice(0, 160); if (!erreurs.includes(e)) erreurs.push(e); } });
  page.on('pageerror', (e) => erreurs.push(`pageerror: ${e.message.slice(0, 200)}`));
  return { context, page, erreurs };
}

/** Un montant d'argent à l'écran : « 12,50 $ », « $12.50 », « 3 ¢ », « cents », « dollars ». */
const ARGENT = /(?:\d[\d\s.,]*\s?\$|\$\s?\d[\d.,]*|\d[\d.,]*\s?¢|\b\d+\s?cents?\b|\bdollars?\b)/gi;
async function argentALEcran(page: Page): Promise<string[]> {
  const texte = await page.evaluate(() => document.body.innerText);
  const trouves: string[] = [];
  for (const m of texte.matchAll(ARGENT)) {
    const i = m.index ?? 0;
    trouves.push(texte.slice(Math.max(0, i - 60), i + m[0].length + 40).replace(/\s+/g, ' ').trim());
  }
  return [...new Set(trouves)];
}
const capture = (page: Page, nom: string) => page.screenshot({ path: `${SORTIES}/f-ecran-${nom}.png` }).catch(() => undefined);

const sortie: Record<string, unknown> = { quand: new Date().toISOString(), base: BASE };

/* ── 1 et 2. Bureau A ── */
{
  const { context, page, erreurs } = await onglet(COMPTES.proprioA.email, orgA);
  await page.goto(`${BASE}/lumi`, { waitUntil: 'domcontentloaded' });
  const barre = page.getByRole('progressbar').first();
  await barre.waitFor({ state: 'visible' });
  const [maintenant, max, valeurTexte] = await Promise.all([barre.getAttribute('aria-valuenow'), barre.getAttribute('aria-valuemax'), barre.getAttribute('aria-valuetext')]);
  const compteur = (await barre.locator('xpath=..').innerText()).replace(/\s+/g, ' ').trim();
  const { data: micro } = await admin.rpc('lumi_credits_utilises', { p_org: orgA });
  const { data: plan } = await admin.from('subscriptions').select('plans:plan_id (lumi_credits_mensuels)').eq('org_id', orgA).in('status', ['active', 'trialing']).maybeSingle();
  const total = n((plan as any)?.plans?.lumi_credits_mensuels);
  const restantsBase = Math.floor(Math.max(0, total * 1_000_000 - n(micro)) / 1_000_000);
  await capture(page, 'A-lumi');
  sortie.bureau_A_page_lumi = {
    compteur_a_l_ecran: compteur, restants_a_l_ecran: n(maintenant), total_a_l_ecran: n(max), texte_accessible: valeurTexte,
    base: { micro_credits_utilises: n(micro), total_du_forfait: total, restants_calcules: restantsBase },
    accord: n(maintenant) === restantsBase && n(max) === total,
    argent: await argentALEcran(page),
  };
  await page.goto(`${BASE}/automations`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading').first().waitFor({ state: 'visible' });
  await page.waitForTimeout(2_500);
  await capture(page, 'A-automatisations');
  sortie.bureau_A_liste_automatisations = { argent: await argentALEcran(page) };
  await page.goto(`${BASE}/automations/nouvelle?lumi=1`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /^Construire$/ }).waitFor({ state: 'visible' });
  await capture(page, 'A-editeur-lumi');
  const carte = await page.locator('textarea').first().locator('xpath=../..').innerText().catch(() => '');
  sortie.bureau_A_editeur_lumi = { texte_du_panneau: carte.replace(/\s+/g, ' ').slice(0, 400), argent: await argentALEcran(page) };
  sortie.bureau_A_erreurs_console = erreurs.slice(0, 10);
  await context.close();
}

/* ── 3. Bureau B, crédits épuisés ── */
{
  const { context, page, erreurs } = await onglet(COMPTES.proprioB.email, orgB);
  await page.goto(`${BASE}/lumi`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('progressbar').first().waitFor({ state: 'visible' });
  await page.waitForTimeout(1_500);
  const avis = await page.getByRole('status').allInnerTexts();
  const champ = page.locator('textarea, input[type="text"]').last();
  await capture(page, 'B-lumi-epuise');
  sortie.bureau_B_page_lumi = {
    compteur: (await page.getByRole('progressbar').first().locator('xpath=..').innerText()).replace(/\s+/g, ' ').trim(),
    avis: avis.map((a) => a.replace(/\s+/g, ' ').trim()).filter(Boolean),
    champ_de_saisie_desactive: await champ.isDisabled().catch(() => null),
    indication_du_champ: await champ.getAttribute('placeholder').catch(() => null),
    argent: await argentALEcran(page),
  };
  await page.goto(`${BASE}/automations/nouvelle?lumi=1`, { waitUntil: 'domcontentloaded' });
  const bouton = page.getByRole('button', { name: /^Construire$/ });
  await bouton.waitFor({ state: 'visible' });
  await page.locator('textarea').first().fill('Quand une facture est payée, envoie un texto de remerciement au client.');
  // Une fenêtre peut recouvrir l'éditeur (accueil d'un bureau neuf, etc.) : on note ce qu'elle dit, puis on la ferme.
  const fenetre = page.locator('.modal-overlay');
  if (await fenetre.count()) {
    await capture(page, 'B-editeur-fenetre');
    (sortie as Record<string, unknown>).bureau_B_fenetre_par_dessus_l_editeur = (await fenetre.first().innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 500);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
    if (await fenetre.count()) await fenetre.first().getByRole('button').first().click({ timeout: 3_000 }).catch(() => undefined);
    await page.waitForTimeout(600);
  }
  const reponse = page.waitForResponse((r) => r.url().includes('/api/automations/rules/generer'), { timeout: 60_000 });
  await bouton.click();
  const r = await reponse;
  await page.waitForTimeout(1_500);
  // Le refus s'affiche dans une bulle (sonner) : on lit toutes les bulles visibles.
  const bulles = await page.locator('[data-sonner-toast]').allInnerTexts();
  await capture(page, 'B-editeur-epuise');
  sortie.bureau_B_editeur = {
    statut_http: r.status(), corps: await r.json().catch(() => null),
    bulles: bulles.map((b) => b.replace(/\s+/g, ' ').trim()),
    adresse_apres: page.url().replace(BASE, ''),
    argent: await argentALEcran(page),
  };
  sortie.bureau_B_erreurs_console = erreurs.slice(0, 10);
  await context.close();
}

await navigateur.close();
writeFileSync(`${SORTIES}/f-ecran.json`, JSON.stringify(sortie, null, 1));
console.log(JSON.stringify(sortie, null, 1));
process.exit(0);
