/**
 * Banc de vérification au VRAI navigateur — agent T (modèles, messages, réglages globaux).
 *
 * Pile LOCALE seulement (refus sinon). Chaque scénario crée SA règle dans le
 * bureau A « (t) », ouvre l'éditeur avec une vraie session (lien magique),
 * fait le geste, et lit l'écran ET la base.
 *
 *   QA_AUTO_SUFFIXE=t npx tsx --env-file=.env.local scripts/qa/finale/t/verifier.mts <scénario…>
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Browser, type Locator, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { assurerBureauTest, adminStaging, COMPTES, type BureauTest } from '../../../../tests/automations-suite/harnais/bureau-test';

export const BASE = process.env.T_BASE || 'http://127.0.0.1:5498';

if (!String(process.env.VITE_SUPABASE_URL || '').includes('localhost')) {
  throw new Error('REFUS : ce banc ne sert que la pile LOCALE.');
}

export const admin: SupabaseClient = adminStaging();
let bureau: BureauTest | null = null;
export async function leBureau(): Promise<BureauTest> {
  if (!bureau) {
    bureau = await assurerBureauTest(admin);
    // La fenêtre de consentement de localisation capterait les clics.
    await admin.from('profiles').update({ location_consent: false, location_consent_at: new Date().toISOString() }).eq('id', bureau.users.proprioA);
  }
  return bureau;
}

const VERSION_TEMOINS = readFileSync(join(process.cwd(), 'src/lib/consentApi.ts'), 'utf8')
  .match(/CURRENT_COOKIE_POLICY_VERSION\s*=\s*'([^']+)'/)?.[1] ?? '';

let navigateur: Browser | null = null;
export async function fermer(): Promise<void> { await navigateur?.close().catch(() => undefined); navigateur = null; }

export async function ouvrirPage(langue: 'fr' | 'en' = 'fr'): Promise<Page> {
  const b = await leBureau();
  const url = process.env.VITE_SUPABASE_URL ?? '';
  const anon = process.env.VITE_SUPABASE_ANON_KEY ?? '';
  const { data: l, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email: COMPTES.proprioA.email });
  if (error) throw new Error(`lien magique : ${error.message}`);
  const { data: s, error: e2 } = await createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
    .auth.verifyOtp({ token_hash: l.properties.hashed_token, type: 'magiclink' });
  if (e2 || !s.session) throw new Error(`session : ${e2?.message}`);
  navigateur ??= await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'] });
  const context = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: langue === 'en' ? 'en-CA' : 'fr-CA', timezoneId: 'America/Toronto' });
  const jeton = {
    access_token: s.session.access_token, refresh_token: s.session.refresh_token,
    expires_at: s.session.expires_at, expires_in: s.session.expires_in, token_type: 'bearer', user: s.session.user,
  };
  await context.addInitScript(({ jeton, org, langue, origine, version }) => {
    if (location.origin !== origine) return;
    if (sessionStorage.getItem('qa-ui-init')) return;
    sessionStorage.setItem('qa-ui-init', '1');
    localStorage.setItem('lume-auth-token', JSON.stringify(jeton));
    localStorage.setItem('lume-active-org', org);
    localStorage.setItem('lume-language', langue);
    localStorage.setItem('lume.cookieConsent.v1', JSON.stringify({ analytics: false, marketing: false, preferences: false, decidedAt: new Date().toISOString(), docVersion: version }));
    localStorage.setItem('lume-setup-dismissed', '1');
  }, { jeton, org: b.orgA, langue, origine: BASE, version: VERSION_TEMOINS });
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  return page;
}

let compteur = 0;
/** Une règle neuve dans le bureau A (t), écrite en service_role. */
export async function creerRegle(over: Record<string, unknown>): Promise<{ id: string }> {
  const b = await leBureau();
  compteur += 1;
  const steps = (over.steps ?? null) as Array<{ type?: string; action?: unknown }> | null;
  const premiere = steps?.find((e) => e.type === 'action')?.action ?? { type: 'send_sms', config: { body: 'Bonjour' } };
  const { data, error } = await admin.from('automation_rules').insert({
    org_id: b.orgA, name: `T ${Date.now()}-${compteur}`, description: '', trigger_event: 'quote.sent', conditions: {},
    delay_seconds: 0, actions: [premiere], steps, is_active: false, is_preset: false,
    ...over,
  }).select('id').single();
  if (error) throw new Error(`création de la règle : ${error.message}`);
  return { id: String(data.id) };
}

export async function lireRegle(id: string): Promise<Record<string, unknown>> {
  const { data, error } = await admin.from('automation_rules').select('*').eq('id', id).single();
  if (error) throw new Error(`lecture : ${error.message}`);
  return data as Record<string, unknown>;
}

export async function ouvrirEditeur(page: Page, id: string): Promise<void> {
  await page.goto(`${BASE}/automations/${id}`);
  await page.getByRole('button', { name: /^(Quand|When)/ }).first().waitFor({ timeout: 120_000 });
}

export const panneau = (page: Page): Locator => page.getByRole('complementary', { name: /Modifier l’étape|Edit step/ });
export const tiroir = (page: Page): Locator => page.getByRole('complementary', { name: 'Actions' });
/** La carte d'une étape du canevas, par son titre. */
export const carte = (page: Page, titre: string): Locator => page.locator('div.w-\\[260px\\] > button').filter({ hasText: titre }).first();

export function verifier(condition: boolean, message: string): void {
  if (!condition) throw new Error(`ÉCHEC : ${message}`);
  console.log(`  ok — ${message}`);
}
export const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ── Gestes propres au lot « modèles » (liste, éditeur de courriel, réglages) ── */

export const CAPTURES = 'D:/lume-final/sorties/t';

/** La liste des automatisations, chargée. */
export async function ouvrirListe(page: Page, chemin = '/automations'): Promise<void> {
  await page.goto(`${BASE}${chemin}`);
  await page.getByRole('heading', { name: /Mes automatisations|Workflows list/ }).waitFor({ timeout: 120_000 });
}

/** Déplie le panneau « messages » de la ligne dont le nom contient `fragment`. */
export async function deplierMessages(page: Page, fragment: string): Promise<void> {
  await page.getByRole('textbox', { name: /^(Rechercher|Search)$/ }).fill(fragment);
  const chevron = page.getByRole('button', { name: /^(Voir les messages de|View messages of) / }).first();
  await chevron.waitFor();
  if ((await chevron.getAttribute('aria-expanded')) !== 'true') await chevron.click();
}

/** La fenêtre de l'éditeur de courriel. */
export const editeurCourriel = (page: Page): Locator => page
  .getByText(/^(Cliquez sur le texte pour le modifier|Click the text to edit it)$/)
  .locator('xpath=ancestor::div[contains(@class,"fixed")][1]');

/** Remet la langue des messages du bureau A en français. */
export async function langueDuBureau(langue: 'fr' | 'en'): Promise<void> {
  const b = await leBureau();
  const { error } = await admin.from('company_settings').update({ default_language: langue }).eq('org_id', b.orgA);
  if (error) throw new Error(`langue du bureau : ${error.message}`);
}

export async function supprimerRegle(id: string): Promise<void> {
  await admin.from('automation_scheduled_tasks').delete().eq('automation_rule_id', id);
  await admin.from('automation_execution_logs').delete().eq('automation_rule_id', id);
  await admin.from('automation_rules').delete().eq('id', id);
}
