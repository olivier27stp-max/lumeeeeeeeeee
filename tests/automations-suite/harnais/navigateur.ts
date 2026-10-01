/**
 * Outils des tests d'interface (projet vitest `ui`) : un VRAI Chromium
 * (Playwright) sur le Vite local, connecté avec une VRAIE session du compte de
 * test (magic link → verifyOtp), injectée là où l'app la relit
 * (`lume-auth-token`, cf. src/lib/supabase.ts `storageKey`).
 *
 * Tout ce que ces tests affirment se vérifie DEUX fois : à l'écran, et dans la
 * ligne `automation_rules` lue en service_role — ce qui est sauvegardé doit
 * être exactement ce qui est affiché.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { expect, inject } from 'vitest';
import { adminStaging } from './bureau-test';

export const admin: SupabaseClient = adminStaging();

/** La version de la politique de témoins que l'app attend (sinon le bandeau capte les clics). */
const VERSION_TEMOINS = (() => {
  const src = readFileSync(join(process.cwd(), 'src/lib/consentApi.ts'), 'utf8');
  return src.match(/CURRENT_COOKIE_POLICY_VERSION\s*=\s*'([^']+)'/)?.[1] ?? '';
})();

/** Une session complète (jeton d'accès + rafraîchissement + utilisateur). */
export async function sessionComplete(email: string): Promise<Session> {
  const url = process.env.VITE_SUPABASE_URL ?? '';
  const anon = process.env.VITE_SUPABASE_ANON_KEY ?? '';
  const { data: l, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (error) throw new Error(`lien magique : ${error.message}`);
  const { data: s, error: e2 } = await createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
    .auth.verifyOtp({ token_hash: l.properties.hashed_token, type: 'magiclink' });
  if (e2 || !s.session) throw new Error(`session ${email} : ${e2?.message}`);
  return s.session;
}

let navigateur: Browser | null = null;
async function chromiumPartage(): Promise<Browser> {
  if (navigateur?.isConnected()) return navigateur;
  navigateur = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'] });
  return navigateur;
}
export async function fermerNavigateur(): Promise<void> {
  await navigateur?.close().catch(() => undefined);
  navigateur = null;
}

export interface Onglet {
  context: BrowserContext;
  page: Page;
  base: string;
  /** Erreurs de la console et exceptions de la page, pour les diagnostics. */
  erreurs: string[];
  fermer: () => Promise<void>;
}

export interface OptionsOnglet {
  langue?: 'fr' | 'en';
  viewport?: { width: number; height: number };
  userAgent?: string;
  email?: string;
  org?: string;
}

/** Un onglet connecté au bureau A de test. */
export async function ouvrirOnglet(o: OptionsOnglet = {}): Promise<Onglet> {
  const base = inject('uiBase');
  const session = await sessionComplete(o.email ?? inject('uiProprioA'));
  const org = o.org ?? inject('uiOrgA');
  const b = await chromiumPartage();
  const context = await b.newContext({
    viewport: o.viewport ?? { width: 1440, height: 900 },
    locale: o.langue === 'en' ? 'en-CA' : 'fr-CA',
    timezoneId: 'America/Toronto',
    ...(o.userAgent ? { userAgent: o.userAgent } : {}),
  });
  const jeton = {
    access_token: session.access_token, refresh_token: session.refresh_token,
    expires_at: session.expires_at, expires_in: session.expires_in,
    token_type: 'bearer', user: session.user,
  };
  await context.addInitScript(({ jeton, org, langue, origine, version }) => {
    if (location.origin !== origine) return;
    // Une seule fois par onglet : l'app peut ensuite rafraîchir SON jeton.
    if (sessionStorage.getItem('qa-ui-init')) return;
    sessionStorage.setItem('qa-ui-init', '1');
    localStorage.setItem('lume-auth-token', JSON.stringify(jeton));
    localStorage.setItem('lume-active-org', org);
    localStorage.setItem('lume-language', langue);
    localStorage.setItem('lume.cookieConsent.v1', JSON.stringify({
      analytics: false, marketing: false, preferences: false, decidedAt: new Date().toISOString(), docVersion: version,
    }));
    localStorage.setItem('lume-setup-dismissed', '1');
  }, { jeton, org, langue: o.langue ?? 'fr', origine: base, version: VERSION_TEMOINS });
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  const erreurs: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') erreurs.push(m.text().slice(0, 300)); });
  page.on('pageerror', (e) => erreurs.push(`pageerror: ${e.message.slice(0, 300)}`));
  return { context, page, base, erreurs, fermer: () => context.close().catch(() => undefined) };
}

/** Capture d'écran HORS du dépôt (QA_UI_SORTIES). */
export async function capturer(page: Page, nom: string): Promise<string> {
  const chemin = join(inject('uiSorties'), `${nom.replace(/[^a-z0-9-]+/gi, '_').slice(0, 80)}.png`);
  await page.screenshot({ path: chemin, fullPage: false }).catch(() => undefined);
  return chemin;
}

/**
 * Enveloppe d'un test d'interface : sur échec, capture l'écran et joint les
 * erreurs de la console au message — un test rouge doit se diagnostiquer sans
 * le relancer.
 */
export async function avecCapture(onglet: Onglet, nom: string, corps: () => Promise<void>): Promise<void> {
  try {
    await corps();
  } catch (e) {
    const chemin = await capturer(onglet.page, nom);
    const detail = onglet.erreurs.slice(-8).join('\n  ');
    if (e instanceof Error) e.message += `\n  capture : ${chemin}${detail ? `\n  console :\n  ${detail}` : ''}`;
    throw e;
  }
}

export interface LigneRegle {
  id: string; org_id: string; name: string; trigger_event: string;
  conditions: Record<string, unknown> | null; delay_seconds: number;
  actions: Array<{ type: string; config: Record<string, unknown> }>;
  steps: Array<Record<string, unknown>> | null; settings: Record<string, unknown> | null;
  is_active: boolean; is_preset: boolean; deleted_at: string | null; purged_at: string | null;
  folder_id: string | null; updated_at: string; created_at: string;
}

/** La ligne `automation_rules` telle qu'en base (service_role). */
export async function lireRegle(id: string): Promise<LigneRegle> {
  const { data, error } = await admin.from('automation_rules').select('*').eq('id', id).single();
  if (error) throw new Error(`lecture de la règle ${id} : ${error.message}`);
  return data as LigneRegle;
}

export async function reglesParNom(org: string, fragment: string): Promise<LigneRegle[]> {
  const { data, error } = await admin.from('automation_rules').select('*').eq('org_id', org).ilike('name', `%${fragment}%`).order('created_at');
  if (error) throw new Error(error.message);
  return (data ?? []) as LigneRegle[];
}

/** Crée une règle directement en base (montage d'un test). */
export async function creerRegle(org: string, ligne: Partial<LigneRegle> & { name: string }): Promise<LigneRegle> {
  const { data, error } = await admin.from('automation_rules').insert({
    org_id: org, trigger_event: 'quote.sent', delay_seconds: 0, is_active: false, conditions: {},
    actions: [{ type: 'create_notification', config: { title: 'QA' } }],
    ...ligne,
  }).select('*').single();
  if (error) throw new Error(`montage de la règle : ${error.message}`);
  return data as LigneRegle;
}

/**
 * Ménage : toute règle portant la marque sort du jeu — dépubliée, à la
 * corbeille et purgée (plus aucune liste ne la montre, le moteur l'ignore).
 * Les tâches encore en file pour ces règles sont annulées.
 */
export async function nettoyer(org: string, marqueTexte: string): Promise<void> {
  const regles = await reglesParNom(org, marqueTexte);
  if (!regles.length) return;
  const ids = regles.map((r) => r.id);
  await admin.from('automation_scheduled_tasks').update({ status: 'cancelled' }).in('automation_rule_id', ids).eq('status', 'pending');
  const maintenant = new Date().toISOString();
  const { error } = await admin.from('automation_rules')
    .update({ is_active: false, deleted_at: maintenant, purged_at: maintenant })
    .in('id', ids);
  if (error) throw new Error(`ménage : ${error.message}`);
}

/** Marque unique d'un test (préfixe « QA-UI »). */
export function marqueUi(sujet: string): string {
  return `[QA-UI ${sujet} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}]`;
}

/** Ferme les toasts et attend qu'un toast contenant `texte` apparaisse. */
export async function attendreToast(page: Page, texte: string | RegExp, delai = 15_000): Promise<string> {
  const toast = page.locator('[data-sonner-toast]').filter({ hasText: texte }).first();
  await toast.waitFor({ state: 'visible', timeout: delai });
  return (await toast.textContent()) ?? '';
}

/** Confirme la boîte `confirmer()` (ConfirmDialog) par son bouton. */
export async function confirmerDialogue(page: Page, libelle: string | RegExp): Promise<void> {
  const d = page.getByRole('dialog');
  await d.waitFor({ state: 'visible' });
  await d.getByRole('button', { name: libelle }).click();
  await d.waitFor({ state: 'hidden' });
}

/**
 * Assertions d'écran qui ATTENDENT (les matchers de Playwright Test ne vivent
 * pas dans l'`expect` de vitest) : chacune sonde jusqu'à `delai`.
 */
export function voir(l: Locator, delai = 15_000) {
  const sonde = <T>(f: () => Promise<T>) => expect.poll(f, { timeout: delai });
  return {
    visible: () => sonde(() => l.first().isVisible()).toBe(true),
    absent: () => sonde(() => l.count()).toBe(0),
    attribut: (nom: string, valeur: string) => sonde(() => l.getAttribute(nom)).toBe(valeur),
    grise: () => sonde(() => l.isDisabled()).toBe(true),
    valeur: (v: string) => sonde(() => l.inputValue()).toBe(v),
    contient: (t: string) => sonde(async () => (await l.textContent()) ?? '').toContain(t),
  };
}
