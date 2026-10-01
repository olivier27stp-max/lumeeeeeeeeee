/**
 * Agent D — RELEVÉ de ce que les écrans de statistiques, d'historique et de journaux affichent
 * vraiment, au vrai navigateur, pour le jeu connu (tests/automations-finale/d/jeu-connu.ts).
 *
 *   node D:/lume-final/outils/serveurs.mjs D:/lume-final/wt-d 3494 5494      (en arrière-plan)
 *   QA_AUTO_SUFFIXE=d npx tsx --env-file=.env.local scripts/qa/finale/d/releve-ecrans.mts [fr|en] [A|B]
 *
 * N'affirme rien : écrit D:/lume-final/sorties/d/releve-<langue>-<bureau>.json et des captures.
 * Les preuves (rouges ou vertes) sont dans tests/automations-finale/d/ui/.
 */
import { chromium, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { assurerBureauTest, COMPTES } from '../../../../tests/automations-suite/harnais/bureau-test';

const langue = (process.argv[2] === 'en' ? 'en' : 'fr') as 'fr' | 'en';
const bureauVu = process.argv[3] === 'B' ? 'B' : 'A';
const BASE = process.env.QA_D_BASE || 'http://127.0.0.1:5494';
const SORTIES = 'D:/lume-final/sorties/d';
mkdirSync(SORTIES, { recursive: true });

const manifeste = JSON.parse(readFileSync(`${SORTIES}/jeu-connu.json`, 'utf8')) as {
  orgA: string; orgB: string; regles: Record<string, { id: string; nom: string; cle: string }>;
};

const b = await assurerBureauTest();
const email = bureauVu === 'A' ? COMPTES.proprioA.email : COMPTES.proprioB.email;
const org = bureauVu === 'A' ? b.orgA : b.orgB;

const url = process.env.VITE_SUPABASE_URL ?? '';
const anon = process.env.VITE_SUPABASE_ANON_KEY ?? '';
const { data: lien, error: eLien } = await b.admin.auth.admin.generateLink({ type: 'magiclink', email });
if (eLien) throw new Error(eLien.message);
const { data: s, error: eOtp } = await createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
  .auth.verifyOtp({ token_hash: lien.properties.hashed_token, type: 'magiclink' });
if (eOtp || !s.session) throw new Error(`session : ${eOtp?.message}`);
for (const id of Object.values(b.users)) {
  await b.admin.from('profiles').update({ location_consent: false, location_consent_at: new Date().toISOString() }).eq('id', id);
}

const versionTemoins = readFileSync('src/lib/consentApi.ts', 'utf8').match(/CURRENT_COOKIE_POLICY_VERSION\s*=\s*'([^']+)'/)?.[1] ?? '';
const navigateur = await chromium.launch({ headless: true });
const contexte = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: langue === 'en' ? 'en-CA' : 'fr-CA', timezoneId: 'America/Toronto' });
const jeton = { access_token: s.session.access_token, refresh_token: s.session.refresh_token, expires_at: s.session.expires_at, expires_in: s.session.expires_in, token_type: 'bearer', user: s.session.user };
await contexte.addInitScript(({ jeton, org, langue, origine, version }) => {
  if (location.origin !== origine) return;
  if (sessionStorage.getItem('qa-ui-init')) return;
  sessionStorage.setItem('qa-ui-init', '1');
  localStorage.setItem('lume-auth-token', JSON.stringify(jeton));
  localStorage.setItem('lume-active-org', org);
  localStorage.setItem('lume-language', langue);
  localStorage.setItem('lume.cookieConsent.v1', JSON.stringify({ analytics: false, marketing: false, preferences: false, decidedAt: new Date().toISOString(), docVersion: version }));
  localStorage.setItem('lume-setup-dismissed', '1');
}, { jeton, org, langue, origine: BASE, version: versionTemoins });

const page: Page = await contexte.newPage();
page.setDefaultTimeout(30_000);
const erreursConsole: string[] = [];
// Sans les adresses (elles portent la clé publique de la pile) ; le temps réel n'existe pas sur la pile locale.
page.on('console', (m) => { if (m.type() === 'error' && !/WebSocket|realtime/.test(m.text())) erreursConsole.push(m.text().replace(/https?:\/\/\S+/g, '<adresse>').slice(0, 300)); });
const appels: Array<{ methode: string; url: string; statut: number }> = [];
page.on('response', (r) => {
  const u = r.url();
  if (/\/api\/|\/rest\/v1\//.test(u)) appels.push({ methode: r.request().method(), url: u.replace(/^https?:\/\/[^/]+/, '').slice(0, 400), statut: r.status() });
});

const releve: Record<string, unknown> = { langue, bureau: bureauVu, quand: new Date().toISOString() };
const capture = (nom: string) => page.screenshot({ path: `${SORTIES}/${nom}-${langue}-${bureauVu}.png`, fullPage: true }).catch(() => undefined);
const texte = async (selecteur: string) => (await page.locator(selecteur).allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());

// ── 1. La liste ─────────────────────────────────────────────────────────────
appels.length = 0;
await page.goto(`${BASE}/automations`);
await page.locator('table tbody tr').first().waitFor();
await page.waitForLoadState('networkidle').catch(() => undefined);
// Le jeu seul, sur une page : recherche par préfixe, 50 lignes par page.
await page.locator('#rech-automations').fill('[QA-D jeu]');
if (await page.locator('#par-page').count()) await page.locator('#par-page').selectOption('50');
await page.waitForTimeout(500);
releve.liste_onglets = await texte('[role="tab"]');
releve.liste_entetes = await texte('table thead th');
const lignes: Record<string, unknown> = {};
for (const r of Object.values(manifeste.regles)) {
  const ligne = page.locator('table tbody tr').filter({ hasText: r.nom }).first();
  if (!(await ligne.count())) { lignes[r.cle] = 'ABSENTE'; continue; }
  const cellules = (await ligne.locator('td').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
  await ligne.getByRole('button', { name: /Statistiques de|Stats for/ }).click();
  const panneau = (await ligne.locator('xpath=following-sibling::tr[1]').innerText()).replace(/\s+/g, ' ').trim();
  await ligne.getByRole('button', { name: /Statistiques de|Stats for/ }).click();
  lignes[r.cle] = { cellules, panneau };
}
releve.liste_lignes = lignes;
releve.liste_bandeaux = await texte('[role="status"]');
releve.liste_appels = [...appels];
await capture('liste');

// Onglet « À vérifier »
const aVerifier = page.getByRole('tab', { name: /À vérifier|Needs review/ });
if (await aVerifier.count()) {
  await aVerifier.click();
  await page.waitForTimeout(400);
  releve.a_verifier_lignes = (await texte('table tbody tr')).filter((t) => t.includes('[QA-D'));
  await capture('a-verifier');
}

// ── 2. La vue d'ensemble ────────────────────────────────────────────────────
appels.length = 0;
await page.goto(`${BASE}/automations/apercu`);
await page.locator('.section-card').first().waitFor();
await page.waitForLoadState('networkidle').catch(() => undefined);
await page.waitForTimeout(800);
releve.apercu_tuiles = await texte('.section-card');
releve.apercu_courbe = await page.locator('[role="img"]').first().getAttribute('aria-label').catch(() => null);
releve.apercu_appels = [...appels];
await capture('apercu');

// ── 3. L'éditeur : Historique et Journaux de chaque règle du jeu ────────────
const editeur: Record<string, unknown> = {};
for (const r of Object.values(manifeste.regles)) {
  appels.length = 0;
  await page.goto(`${BASE}/automations/${r.id}`);
  const ongletH = page.getByRole('tab', { name: /^(Historique|Enrollment history)$/ });
  // Un autre bureau n'a pas cette règle : on relève ce que l'écran dit, et on passe.
  const ouvert = await ongletH.waitFor({ timeout: 12_000 }).then(() => true, () => false);
  if (!ouvert) {
    editeur[r.cle] = { introuvable: (await page.locator('body').innerText()).replace(/\s+/g, ' ').trim().slice(0, 300), appels: appels.filter((a) => /automation/.test(a.url)) };
    continue;
  }
  await page.waitForLoadState('networkidle').catch(() => undefined);
  const entete = (await page.locator('header').first().innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
  await ongletH.click();
  await page.getByRole('heading', { name: /^(Historique|Enrollment history)$/ }).waitFor();
  await page.locator('.section-card .animate-spin').waitFor({ state: 'detached' }).catch(() => undefined);
  const historique = {
    compteur: (await texte('span.ml-auto')).join(' | '),
    entetes: await texte('table thead th'),
    lignes: await texte('table tbody tr'),
    vide: await texte('.section-card p'),
    filtres: await page.locator('select').evaluateAll((els) => els.map((e) => ({ id: e.id, options: [...(e as HTMLSelectElement).options].map((o) => o.textContent) }))),
    liens: await page.locator('table a').count(),
  };
  if (r.cle === 'E' || r.cle === 'P' || r.cle === 'H') await capture(`historique-${r.cle}`);
  await page.getByRole('tab', { name: /^(Journaux|Execution logs)$/ }).click();
  await page.getByRole('heading', { name: /Journaux d’exécution|Execution logs/ }).waitFor();
  await page.locator('.section-card .animate-spin').waitFor({ state: 'detached' }).catch(() => undefined);
  const journaux: Record<string, unknown> = {
    compteur: (await texte('span.ml-auto')).join(' | '),
    entetes: await texte('table thead th'),
    lignes: await texte('table tbody tr'),
    vide: await texte('.section-card p'),
    filtres: await page.locator('select').evaluateAll((els) => els.map((e) => ({ id: e.id, options: [...(e as HTMLSelectElement).options].map((o) => o.textContent) }))),
    liens: await page.locator('table a').count(),
  };
  // La première ligne dépliée : le détail technique offert.
  const premiere = page.locator('table tbody tr[role="button"]').first();
  if (await premiere.count()) {
    await premiere.click();
    journaux.detail_premiere_ligne = (await page.locator('table tbody tr').nth(1).innerText()).replace(/\s+/g, ' ').trim();
  }
  // Les filtres de statut, un par un.
  const statut = page.locator('select').nth(1);
  const parStatut: Record<string, string[]> = {};
  for (const v of ['succes', 'echec']) {
    await statut.selectOption(v);
    await page.locator('.section-card .animate-spin').waitFor({ state: 'detached' }).catch(() => undefined);
    await page.waitForTimeout(300);
    parStatut[v] = await texte('table tbody tr');
  }
  journaux.par_statut = parStatut;
  if (['S', 'E', 'K', 'F4', 'T'].includes(r.cle)) await capture(`journaux-${r.cle}`);
  editeur[r.cle] = { entete, historique, journaux, appels: [...appels] };
}
releve.editeur = editeur;
releve.erreurs_console = erreursConsole;

writeFileSync(`${SORTIES}/releve-${langue}-${bureauVu}.json`, JSON.stringify(releve, null, 1));
console.log(`relevé écrit : ${SORTIES}/releve-${langue}-${bureauVu}.json`);
await navigateur.close();
