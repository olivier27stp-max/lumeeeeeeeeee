/**
 * Connexion des tests du lot « modeles » — par le banc, ou en MODE ÉCONOME.
 *
 * ── Pourquoi un mode économe (E2E_MODELES_ECONOME=1) ────────────────────────
 *
 * Staging est partagé par plusieurs passes en parallèle. Mesuré le 2026-10-01 :
 * une requête sur deux dépasse 10 s par moments, « statement timeout » sur un
 * simple upsert, et plus d'un test sur deux tombait AVANT d'avoir touché
 * l'écran testé :
 *   · le banc refait tout le bureau de test à chaque démarrage de worker (donc
 *     après chaque échec) : « membership tech : canceling statement due to
 *     statement timeout » ;
 *   · il ouvre une session neuve par test (generateLink + verifyOtp), puis la
 *     page la rafraîchit et relit son profil à travers `route.fetch()` (15 s,
 *     sans reprise) : « route.fetch: Timeout », et la page, restée sans
 *     réponse, perd sa session (« Lock broken by another request with the
 *     'steal' option », puis POST /rest/v1/orgs en 403 : l'app croit le compte
 *     sans bureau).
 *
 * Ce mode ne change RIEN à ce qui est testé. Il retire seulement ces allers-
 * retours d'authentification, qui ne sont pas le sujet du lot :
 *   · le bureau de test est relu d'un fichier d'état, écrit par 00-jeu.spec.ts
 *     (qui passe, lui, par le banc tel quel) — la ceinture « les deux bureaux
 *     sont en bac à sable » est gardée ;
 *   · une session par compte est gardée ~15 min et réutilisée ; la page reçoit
 *     son profil et son « rafraîchissement » sans passer par le réseau.
 *
 * Sans la variable, tout passe par le banc, à l'identique (avec, seulement,
 * des délais plus longs sur ses deux routes d'authentification).
 */
import type { BrowserContext, Route } from '@playwright/test';
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test as banc, sessionDe, type Bureau, type Compte, type Langue } from '../_outils/banc';

const ECONOME = process.env.E2E_MODELES_ECONOME === '1';
const DOSSIER_ETAT = process.env.E2E_MODELES_ETAT || join(process.env.E2E_SORTIES || join(tmpdir(), 'lume-e2e-automations'), 'modeles-etat');
const REF_PROD = 'bbzcuzqfgsdvjsymfwmr';
const jeu = () => (process.env.E2E_JEU || 'e2e').replace(/[^a-z0-9-]/gi, '');

/** Ce que 00-jeu.spec.ts écrit : les identifiants du jeu de bureaux, sans aucun secret. */
export interface EtatJeu { url: string; jeu: string; orgA: string; orgB: string; comptes: Bureau['comptes'] }

export function fichierEtatJeu(): string {
  return join(DOSSIER_ETAT, `bureau-${jeu()}.json`);
}

export function ecrireEtatJeu(bureau: Bureau): void {
  mkdirSync(DOSSIER_ETAT, { recursive: true });
  const etat: EtatJeu = { url: process.env.VITE_SUPABASE_URL ?? '', jeu: jeu(), orgA: bureau.orgA, orgB: bureau.orgB, comptes: bureau.comptes };
  writeFileSync(fichierEtatJeu(), JSON.stringify(etat, null, 1));
}

async function bureauDepuisEtat(): Promise<Bureau> {
  const url = process.env.VITE_SUPABASE_URL ?? '';
  const cle = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!url || !cle || url.includes(REF_PROD)) throw new Error('REFUS : E2E des automatisations = STAGING seulement.');
  if (!existsSync(fichierEtatJeu())) {
    throw new Error(`Mode économe : ${fichierEtatJeu()} est absent. Lancer d’abord 00-jeu.spec.ts SANS E2E_MODELES_ECONOME.`);
  }
  const etat = JSON.parse(readFileSync(fichierEtatJeu(), 'utf8')) as EtatJeu;
  if (etat.url !== url) throw new Error('Mode économe : le fichier d’état vient d’une autre base.');
  const admin: SupabaseClient = createClient(url, cle, { auth: { persistSession: false, autoRefreshToken: false } });
  // Ceinture, comme le banc : les deux bureaux sont en bac à sable, sinon rien ne tourne.
  for (let essai = 0; ; essai += 1) {
    const { data, error } = await admin.from('orgs_envois_simules').select('org_id').in('org_id', [etat.orgA, etat.orgB]);
    if (!error) {
      if ((data ?? []).length !== 2) throw new Error('ARRÊT : un bureau de test n’est pas en bac à sable — aucun test ne tourne.');
      break;
    }
    if (essai >= 3) throw new Error(`bac à sable illisible : ${error.message}`);
  }
  return { admin, orgA: etat.orgA, orgB: etat.orgB, comptes: etat.comptes, orgDe: (c) => (c === 'proprioB' ? etat.orgB : etat.orgA) };
}

/** Une session par compte, gardée tant qu'il lui reste plus de 12 minutes (les jetons durent 30 min). */
async function sessionGardee(bureau: Bureau, compte: Compte): Promise<Session> {
  mkdirSync(DOSSIER_ETAT, { recursive: true });
  const fichier = join(DOSSIER_ETAT, `session-${jeu()}-${compte}.json`);
  if (existsSync(fichier)) {
    try {
      const s = JSON.parse(readFileSync(fichier, 'utf8')) as Session;
      if ((s.expires_at ?? 0) * 1000 - Date.now() > 12 * 60_000) return s;
    } catch { /* fichier abîmé : on en refait un */ }
  }
  for (let essai = 0; ; essai += 1) {
    try {
      const s = await sessionDe(bureau, compte);
      writeFileSync(fichier, JSON.stringify(s));
      return s;
    } catch (e) {
      if (essai >= 3) throw e;
      await new Promise((r) => { setTimeout(r, 1500); });
    }
  }
}

const VERSION_TEMOINS = (() => {
  const src = readFileSync(join(process.cwd(), 'src/lib/consentApi.ts'), 'utf8');
  return src.match(/CURRENT_COOKIE_POLICY_VERSION\s*=\s*'([^']+)'/)?.[1] ?? '';
})();

/** Même injection que `connecter()` du banc, avec une session gardée et sans aller-retour d'authentification dans la page. */
async function connecterSansReseau(context: BrowserContext, bureau: Bureau, compte: Compte, langue: Langue, origine: string): Promise<void> {
  const session = await sessionGardee(bureau, compte);
  const user = { ...session.user, user_metadata: { ...(session.user.user_metadata ?? {}), language: langue } };
  const jeton = () => ({
    access_token: session.access_token, refresh_token: session.refresh_token, expires_at: session.expires_at,
    expires_in: Math.max(60, Math.round((session.expires_at ?? 0) - Date.now() / 1000)), token_type: 'bearer', user,
  });
  await context.addInitScript(({ jeton: j, org, langue: l, origine: o, version }) => {
    if (location.origin !== o) return;
    // Une seule fois par onglet : l'app gère ensuite SON jeton.
    if (sessionStorage.getItem('e2e-init')) return;
    sessionStorage.setItem('e2e-init', '1');
    localStorage.setItem('lume-auth-token', JSON.stringify(j));
    localStorage.setItem('lume-active-org', org);
    localStorage.setItem('lume-language', l);
    localStorage.setItem('lume.cookieConsent.v1', JSON.stringify({
      analytics: false, marketing: false, preferences: false, decidedAt: new Date().toISOString(), docVersion: version,
    }));
    localStorage.setItem('lume-setup-dismissed', '1');
  }, { jeton: jeton(), org: bureau.orgDe(compte), langue, origine, version: VERSION_TEMOINS });
  await context.route('**/auth/v1/user**', (route) => (route.request().method() === 'GET'
    ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(user) })
    : route.continue()));
  await context.route('**/auth/v1/token**', (route) => (route.request().url().includes('grant_type=refresh_token')
    ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(jeton()) })
    : route.continue()));
}

/** Hors mode économe : les deux routes du banc, avec un délai long et deux nouvelles tentatives. */
async function routesPatientes(context: BrowserContext, langue: Langue): Promise<void> {
  const patient = async (route: Route, poserLangue: (j: Record<string, unknown>) => void) => {
    for (let essai = 0; ; essai += 1) {
      try {
        const r = await route.fetch({ timeout: 45_000 });
        const j = await r.json().catch(() => null) as Record<string, unknown> | null;
        if (j && typeof j === 'object') poserLangue(j);
        return await route.fulfill({ response: r, json: j ?? {} });
      } catch (e) {
        if (essai >= 2) throw e;
      }
    }
  };
  const avecLangue = (meta: unknown) => ({ ...((meta as Record<string, unknown> | null) ?? {}), language: langue });
  await context.route('**/auth/v1/user**', (route) => (route.request().method() !== 'GET'
    ? route.fallback()
    : patient(route, (j) => { j.user_metadata = avecLangue(j.user_metadata); })));
  await context.route('**/auth/v1/token**', (route) => patient(route, (j) => {
    const u = j.user as Record<string, unknown> | undefined;
    if (u) u.user_metadata = avecLangue(u.user_metadata);
  }));
}

/** Le `test` du banc, connecté selon le mode. */
export const base = ECONOME
  ? banc.extend<object, object>({
    // eslint-disable-next-line no-empty-pattern
    bureau: [async ({}, use) => { await use(await bureauDepuisEtat()); }, { scope: 'worker' }],
    context: async ({ browser, contextOptions, bureau, compte, langue, baseURL }, use) => {
      const context = await browser.newContext(contextOptions);
      // `!` : le projet fixe toujours baseURL (playwright.config.ts).
      await connecterSansReseau(context, bureau, compte, langue, baseURL!);
      await use(context);
      await context.close();
    },
  })
  : banc.extend<object, object>({
    context: async ({ context, langue }, use) => {
      await routesPatientes(context, langue);
      await use(context);
    },
  });
