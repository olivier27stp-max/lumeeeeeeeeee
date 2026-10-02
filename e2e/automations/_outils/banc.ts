/**
 * Banc des E2E de la section Automatisations.
 *
 *   import { test, expect } from '../_outils/banc';
 *
 * Ce que le banc apporte à chaque test :
 *  · `page` : un onglet DÉJÀ CONNECTÉ au bureau de test (option `compte` :
 *    propriétaire, admin, technicien ; option `langue`) — vraie session, par
 *    lien magique, jamais de mot de passe.
 *  · `moniteur` (automatique) : la console et le réseau sont écoutés pendant
 *    tout le test. Erreur de console, exception, promesse rejetée, requête
 *    qui n'aboutit pas, réponse 4xx ou 5xx : le test ÉCHOUE, même si toutes
 *    ses attentes passent. Un 4xx attendu (validation, refus de permission)
 *    se déclare : `moniteur.attendu(/…/, 'pourquoi')` — et le test doit alors
 *    vérifier le message montré à l'utilisateur.
 *  · `bureau` : les bureaux de test (A et B), leurs comptes, un client
 *    service_role pour VÉRIFIER en base ce que l'écran affirme.
 *  · `marque` : un préfixe unique ; toute règle dont le nom le contient est
 *    supprimée à la fin du test.
 *
 * Un jeu de bureaux PAR worker (`QA_AUTO_SUFFIXE`) : deux tests en parallèle
 * ne partagent ni liste, ni pause globale, ni langue des messages.
 * Tout tourne sur la PILE LOCALE (scripts/qa/automations-e2e/), en bac à sable : ni staging, ni
 * prod, et aucun envoi réel n'est possible.
 */
import { test as base, expect, type BrowserContext, type Page, type Route, type TestInfo } from '@playwright/test';
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

export { expect };

export type Compte = 'proprioA' | 'adminA' | 'techA' | 'proprioB';
export type Langue = 'fr' | 'en';

export interface Bureau {
  /** Client service_role (pile locale) : lectures de vérification et préparation de données. */
  admin: SupabaseClient;
  orgA: string;
  orgB: string;
  comptes: Record<Compte, { email: string; id: string; role: string }>;
  /** L'org du compte (B pour proprioB, A sinon). */
  orgDe: (c: Compte) => string;
}

const REF_PROD = 'bbzcuzqfgsdvjsymfwmr';
/** Staging est tombé deux fois sous ces tests (2026-10-01) : ils ne visent plus qu'une base locale. */
const ADRESSE_LOCALE = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/;
const URL_SB = () => process.env.VITE_SUPABASE_URL ?? '';
const ANON = () => process.env.VITE_SUPABASE_ANON_KEY ?? '';

const VERSION_TEMOINS = (() => {
  const src = readFileSync(join(process.cwd(), 'src/lib/consentApi.ts'), 'utf8');
  return src.match(/CURRENT_COOKIE_POLICY_VERSION\s*=\s*'([^']+)'/)?.[1] ?? '';
})();

/**
 * Dossier des captures d'un lot, HORS du dépôt (un fichier écrit dans le worktree ferait recharger Vite) :
 * `<E2E_SORTIES>/captures/<lot>`. Playwright crée le dossier à la première capture.
 */
export function capturesDe(lot: string): string {
  return join(resolve(process.env.E2E_SORTIES || join(tmpdir(), 'lume-e2e-automations')), 'captures', lot).replace(/\\/g, '/');
}

// ── Moniteur console + réseau ─────────────────────────────────────────────

export interface Probleme { genre: 'console' | 'exception' | 'reseau' | 'echec'; texte: string; page: string; infra: boolean }

/**
 * Une panne de l'ENVIRONNEMENT (base saturée, requête coupée, poste à court de tampons réseau),
 * pas une faute du produit. Le test échoue quand même — on ne peut rien conclure
 * d'une passe sur un environnement en panne — mais sous un autre nom, pour que
 * le rapport ne mélange pas « à corriger » et « à relancer ».
 */
const PANNE_ENVIRONNEMENT = /statement timeout|canceling statement|57014|Failed to connect to database|upstream connect error|PGRST00[0-3]|(?:502|503|504) [A-Z]+ https?:\/\/[^ ]*supabase\.co|net::ERR_(?:CONNECTION|TIMED_OUT|NETWORK|NAME_NOT_RESOLVED|INTERNET|NO_BUFFER_SPACE)|NS_ERROR_NET_/i;
// « Lock broken by another request » n'est PAS dans cette liste : c'est le verrou
// de session de l'app (src/lib/supabase.ts), donc un défaut du produit à instruire.

export class Moniteur {
  readonly problemes: Probleme[] = [];
  private attendus: Array<{ motif: RegExp; raison: string; vu: number }> = [];
  private gele = false;
  constructor(private base: string) {}

  /** Déclare un problème ATTENDU par ce test (4xx de validation, panne simulée…). Doit arriver au moins une fois. */
  attendu(motif: RegExp, raison: string): void { this.attendus.push({ motif, raison, vu: 0 }); }

  /**
   * Cesse d'écouter. Appelé au début du ménage de fin de test : supprimer en
   * base une règle dont l'éditeur est encore ouvert fait échouer son
   * enregistrement automatique en vol — un bruit du banc, pas un défaut.
   */
  geler(): void { this.gele = true; }

  brancher(page: Page): void {
    const ici = () => page.url().replace(this.base, '') || '/';
    const noter = (genre: Probleme['genre'], texte: string) => {
      if (this.gele) return;
      const t = texte.slice(0, 600);
      const a = this.attendus.find((x) => x.motif.test(t));
      if (a) { a.vu += 1; return; }
      this.problemes.push({ genre, texte: t, page: ici(), infra: PANNE_ENVIRONNEMENT.test(t) });
    };
    page.on('console', (msg) => {
      const t = msg.text();
      // Le réseau est compté à part (ligne « reseau ») : pas deux fois.
      if (/Failed to load resource|Download the React DevTools|\[vite\]/i.test(t)) return;
      // Cloudflare pose un témoin tiers sur le domaine Supabase : Firefox le signale, l'app n'y peut rien.
      if (/Cookie “__cf_bm” has been rejected/.test(t)) return;
      if (msg.type() === 'error' || (msg.type() === 'warning' && /^Warning: /.test(t))) noter('console', `[${msg.type()}] ${t}`);
    });
    page.on('pageerror', (err) => noter('exception', String(err?.message ?? err)));
    page.on('response', (r) => {
      if (r.status() >= 400) noter('reseau', `${r.status()} ${r.request().method()} ${r.url().replace(this.base, '')}`);
    });
    page.on('requestfailed', (r) => {
      const raison = r.failure()?.errorText ?? '';
      // Une navigation annule les requêtes en vol : ce n'est pas un défaut.
      if (/ERR_ABORTED|NS_BINDING_ABORTED|cancell?ed|NS_ERROR_ABORT/i.test(raison)) return;
      noter('echec', `${r.method()} ${r.url().replace(this.base, '')} — ${raison}`);
    });
  }

  /** Les attendus déclarés qui ne sont JAMAIS arrivés (le test n'a pas provoqué ce qu'il prétend). */
  attendusNonVus(): string[] { return this.attendus.filter((a) => a.vu === 0).map((a) => `${a.motif} (${a.raison})`); }
}

// ── Sessions ──────────────────────────────────────────────────────────────

/** Une session NEUVE par lien magique. Client à part : après verifyOtp il agit comme l'utilisateur. */
export async function sessionDe(bureau: Bureau, compte: Compte): Promise<Session> {
  const email = bureau.comptes[compte].email;
  const { data: l, error } = await bureau.admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (error) throw new Error(`lien magique ${email} : ${error.message}`);
  const pub = createClient(URL_SB(), ANON(), { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: s, error: e2 } = await pub.auth.verifyOtp({ token_hash: l.properties.hashed_token, type: 'magiclink' });
  if (e2 || !s.session) throw new Error(`session ${email} : ${e2?.message}`);
  return s.session;
}

/** Injecte la session dans un contexte de navigateur, là où l'app la relit (`lume-auth-token`). */
export async function connecter(context: BrowserContext, bureau: Bureau, compte: Compte, langue: Langue, origine: string): Promise<Session> {
  const session = await sessionDe(bureau, compte);
  const user = { ...session.user, user_metadata: { ...(session.user.user_metadata ?? {}), language: langue } };
  const jeton = {
    access_token: session.access_token, refresh_token: session.refresh_token,
    expires_at: session.expires_at, expires_in: session.expires_in, token_type: 'bearer', user,
  };
  await context.addInitScript(({ jeton, org, langue, origine, version }) => {
    if (location.origin !== origine) return;
    // Une seule fois par onglet : l'app rafraîchit ensuite SON jeton.
    if (sessionStorage.getItem('e2e-init')) return;
    sessionStorage.setItem('e2e-init', '1');
    localStorage.setItem('lume-auth-token', JSON.stringify(jeton));
    localStorage.setItem('lume-active-org', org);
    localStorage.setItem('lume-language', langue);
    localStorage.setItem('lume.cookieConsent.v1', JSON.stringify({
      analytics: false, marketing: false, preferences: false, decidedAt: new Date().toISOString(), docVersion: version,
    }));
    localStorage.setItem('lume-setup-dismissed', '1');
  }, { jeton, org: bureau.orgDe(compte), langue, origine, version: VERSION_TEMOINS });
  // La langue du COMPTE l'emporte sur la préférence locale, et l'app relit le
  // compte au chargement : on la fixe dans les réponses d'auth, sans toucher
  // au vrai compte (deux tests en parallèle peuvent vouloir deux langues).
  /* Relais GARDÉ : `route.fetch()` sans délai laissait la requête en suspens
     quand l'auth répondait lentement (app bloquée sur son écran de chargement),
     et levait « Route is already handled » / « Target closed » quand l'onglet
     se fermait pendant l'appel. Délai borné, et repli sur la requête d'origine. */
  const relayer = async (route: Route, retoucher: (j: Record<string, unknown>) => void) => {
    try {
      const r = await route.fetch({ timeout: 25_000 });
      const j = (await r.json().catch(() => null)) as Record<string, unknown> | null;
      if (j && typeof j === 'object') retoucher(j);
      await route.fulfill({ response: r, json: j ?? {} });
    } catch {
      await route.continue().catch(() => undefined);
    }
  };
  const avecLangue = (m: unknown) => ({ ...((m as Record<string, unknown> | undefined) ?? {}), language: langue });
  await context.route('**/auth/v1/user**', async (route) => {
    if (route.request().method() !== 'GET') return route.continue().catch(() => undefined);
    await relayer(route, (j) => { j.user_metadata = avecLangue(j.user_metadata); });
  });
  await context.route('**/auth/v1/token**', async (route) => {
    await relayer(route, (j) => {
      const u = j.user as Record<string, unknown> | undefined;
      if (u) u.user_metadata = avecLangue(u.user_metadata);
    });
  });
  return session;
}

// ── Fixtures ──────────────────────────────────────────────────────────────

interface Options { compte: Compte; langue: Langue }
interface ParTest {
  moniteur: Moniteur;
  /** Préfixe unique des données créées par ce test ; ménage automatique à la fin. */
  marque: string;
  /** Ouvre un AUTRE onglet connecté (autre rôle, autre langue, second onglet du même compte). Fermé à la fin. */
  autreOnglet: (o?: { compte?: Compte; langue?: Langue }) => Promise<{ page: Page; context: BrowserContext; moniteur: Moniteur }>;
  /** Jeton d'accès du compte, pour un appel d'API DIRECT (sans passer par les boutons). */
  jetonDe: (compte: Compte) => Promise<string>;
}
interface ParWorker { bureau: Bureau }

async function echouerSiProblemes(m: Moniteur, testInfo: TestInfo, quoi: string): Promise<void> {
  const nonVus = m.attendusNonVus();
  if (m.problemes.length) {
    await testInfo.attach(`moniteur-${quoi}`, { body: JSON.stringify(m.problemes, null, 2), contentType: 'application/json' });
    const lignes = m.problemes.slice(0, 12).map((p) => `  · [${p.genre}] ${p.texte}  (sur ${p.page})`).join('\n');
    // Tout vient de l'environnement : à RELANCER, pas à corriger. Le rapport les compte à part.
    if (m.problemes.every((p) => p.infra)) {
      testInfo.annotations.push({ type: 'panne-environnement', description: m.problemes[0].texte.slice(0, 200) });
      throw new Error(`PANNE D’ENVIRONNEMENT (${quoi}) — ${m.problemes.length} erreur(s) d’infrastructure, test à relancer :\n${lignes}`);
    }
    throw new Error(`Le moniteur (${quoi}) a relevé ${m.problemes.length} problème(s) pendant le test :\n${lignes}`);
  }
  if (nonVus.length && testInfo.status === 'passed') {
    throw new Error(`Problème déclaré « attendu » mais jamais survenu (${quoi}) : ${nonVus.join(' ; ')}`);
  }
}

export const test = base.extend<Options & ParTest, ParWorker>({
  compte: ['proprioA', { option: true }],
  langue: ['fr', { option: true }],

  bureau: [async ({}, use, workerInfo) => {
    if (!URL_SB() || URL_SB().includes(REF_PROD) || !ADRESSE_LOCALE.test(URL_SB())) {
      throw new Error('REFUS : les E2E des automatisations tournent sur la pile LOCALE seulement (node scripts/qa/automations-e2e/lancer.mjs).');
    }
    // Un jeu de bureaux par worker ; E2E_JEU fixe le jeu (atelier : un jeu par agent).
    const jeu = (process.env.E2E_JEU || 'e2e') + (process.env.E2E_JEU && workerInfo.parallelIndex === 0 ? '' : String(workerInfo.parallelIndex));
    process.env.QA_AUTO_SUFFIXE = jeu;
    const { assurerBureauTest, adminStaging, COMPTES } = await import('../../../tests/automations-suite/harnais/bureau-test');

    /* Playwright recrée le worker après CHAQUE test tombé, donc ce fixture. Refaire toute la
       préparation du bureau (des dizaines de requêtes) à chaque échec a fait tomber staging le
       2026-10-01, chaque échec en provoquant d'autres. Le bureau préparé est retenu 45 min ;
       la ceinture « en bac à sable » est, elle, revérifiée à chaque fois. */
    const fichierCache = join(resolve(process.env.E2E_SORTIES || join(tmpdir(), 'lume-e2e-automations')), `bureau-${jeu}.json`);
    const enCache = (() => {
      try {
        const c = JSON.parse(readFileSync(fichierCache, 'utf8')) as { quand: number; url: string; orgA: string; orgB: string; comptes: Bureau['comptes'] };
        return Date.now() - c.quand < 45 * 60_000 && c.url === URL_SB() ? c : null;
      } catch { return null; }
    })();
    if (enCache) {
      const admin = adminStaging();
      const { data: bac, error } = await admin.from('orgs_envois_simules').select('org_id').in('org_id', [enCache.orgA, enCache.orgB]);
      if (error) throw new Error(`PANNE D’ENVIRONNEMENT : lecture du bac à sable impossible (${error.message}).`);
      if ((bac ?? []).length !== 2) throw new Error('ARRÊT : un bureau de test n’est pas en bac à sable — aucun test ne tourne.');
      await use({ admin, orgA: enCache.orgA, orgB: enCache.orgB, comptes: enCache.comptes, orgDe: (c) => (c === 'proprioB' ? enCache.orgB : enCache.orgA) });
      return;
    }

    const b = await assurerBureauTest();
    const admin = b.admin as SupabaseClient;

    // Un compte de rôle « admin » en plus du propriétaire et du technicien.
    const emailAdmin = COMPTES.proprioA.email.replace('proprio-a', 'admin-a');
    let idAdmin: string | undefined;
    const cree = await admin.auth.admin.createUser({
      email: emailAdmin, password: randomBytes(24).toString('base64url'), email_confirm: true, user_metadata: { full_name: 'QA Admin A' },
    });
    idAdmin = cree.data?.user?.id;
    if (!idAdmin) {
      const { data: lien, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email: emailAdmin });
      if (!lien?.user) throw new Error(`compte admin de test : ${cree.error?.message} / ${error?.message}`);
      idAdmin = lien.user.id;
    }
    const { error: eM } = await admin.from('memberships')
      .upsert({ user_id: idAdmin, org_id: b.orgA, role: 'admin', status: 'active', full_name: 'QA Admin A' }, { onConflict: 'user_id,org_id' });
    if (eM) throw new Error(`adhésion admin de test : ${eM.message}`);

    const ids = { ...b.users, adminA: idAdmin } as Record<Compte, string>;
    // La fenêtre de consentement de localisation capterait les clics.
    for (const id of Object.values(ids)) {
      await admin.from('profiles').update({ location_consent: false, location_consent_at: new Date().toISOString() }).eq('id', id);
    }
    // Ceinture : les deux bureaux sont bien en bac à sable, sinon rien ne tourne.
    const { data: bac } = await admin.from('orgs_envois_simules').select('org_id').in('org_id', [b.orgA, b.orgB]);
    if ((bac ?? []).length !== 2) throw new Error('ARRÊT : un bureau de test n’est pas en bac à sable — aucun test ne tourne.');

    const comptes = {
      proprioA: { email: COMPTES.proprioA.email, id: ids.proprioA, role: 'owner' },
      adminA: { email: emailAdmin, id: ids.adminA, role: 'admin' },
      techA: { email: COMPTES.techA.email, id: ids.techA, role: 'technician' },
      proprioB: { email: COMPTES.proprioB.email, id: ids.proprioB, role: 'owner' },
    };
    try {
      mkdirSync(dirname(fichierCache), { recursive: true });
      writeFileSync(fichierCache, JSON.stringify({ quand: Date.now(), url: URL_SB(), orgA: b.orgA, orgB: b.orgB, comptes }));
    } catch { /* pas de cache : la préparation sera refaite, rien de plus */ }
    await use({ admin, orgA: b.orgA, orgB: b.orgB, comptes, orgDe: (c) => (c === 'proprioB' ? b.orgB : b.orgA) });
  }, { scope: 'worker' }],

  context: async ({ context, bureau, compte, langue, baseURL }, use) => {
    await connecter(context, bureau, compte, langue, baseURL!);
    await use(context);
    // Un relais d'auth encore en vol à la fermeture levait « Route is already handled ».
    await context.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => undefined);
  },

  moniteur: [async ({ page, baseURL }, use, testInfo) => {
    const m = new Moniteur(baseURL!);
    m.brancher(page);
    await use(m);
    await echouerSiProblemes(m, testInfo, 'onglet principal');
  }, { auto: true }],

  marque: [async ({ bureau, page, moniteur }, use, testInfo) => {
    const m = `[E2E ${testInfo.title.match(/\[([A-Z]+-\d+[a-z]?)\]/)?.[1] ?? 'x'} ${randomBytes(3).toString('hex')}]`;
    const debut = new Date(Date.now() - 2_000).toISOString();
    await use(m);
    /* Avant le ménage : le moniteur cesse d'écouter et l'onglet quitte l'app.
       Supprimer une règle dont l'éditeur est encore ouvert faisait échouer son
       enregistrement automatique en vol (500), compté à tort comme une faute. */
    moniteur.geler();
    await page.goto('about:blank').catch(() => undefined);
    // Ménage, dans les bureaux de test seulement : les règles marquées, ET celles nées par l'écran
    // pendant ce test sans avoir été renommées (« Nouvelle automatisation », copies) — un worker
    // exécute ses tests l'un après l'autre dans SES bureaux : rien d'autre n'y naît en même temps.
    for (const org of [bureau.orgA, bureau.orgB]) {
      const [{ data: marquees }, { data: nees }] = await Promise.all([
        bureau.admin.from('automation_rules').select('id').eq('org_id', org).ilike('name', `%${m}%`),
        bureau.admin.from('automation_rules').select('id, name').eq('org_id', org).gte('created_at', debut)
          .or('name.ilike.Nouvelle automatisation%,name.ilike.New automation%,name.ilike.%(copie)%,name.ilike.%(copy)%'),
      ]);
      const ids = [...new Set([...(marquees ?? []), ...(nees ?? [])].map((r) => r.id as string))];
      if (!ids.length) continue;
      await bureau.admin.from('automation_scheduled_tasks').delete().in('automation_rule_id', ids);
      await bureau.admin.from('automation_execution_logs').delete().in('automation_rule_id', ids);
      await bureau.admin.from('automation_rules').delete().in('id', ids);
    }
    /* Le banc et la suite retrouvent leurs bureaux par leur NOM, et enregistrer Réglages › Entreprise
       renomme le bureau : un test qui le fait faisait tomber tous les suivants (« 0 bureau(x) … »,
       tri du 2026-10-01). Le nom d'origine est remis après chaque test — sans effet s'il n'a pas bougé. */
    const { NOM_ORG_A, NOM_ORG_B } = await import('../../../tests/automations-suite/harnais/bureau-test');
    for (const [id, nom] of [[bureau.orgA, NOM_ORG_A], [bureau.orgB, NOM_ORG_B]] as const) {
      await bureau.admin.from('orgs').update({ name: nom }).eq('id', id).neq('name', nom);
    }
    // Automatique : le ménage vaut aussi pour un test qui ne demande pas `marque`.
  }, { auto: true }],

  // Dépend de `marque` pour être défait AVANT lui : les autres onglets sont fermés (et leurs
  // moniteurs lus) avant que le ménage ne supprime ce qu'ils affichent.
  autreOnglet: async ({ browser, bureau, compte, langue, baseURL, contextOptions, marque: _marque }, use, testInfo) => {
    const ouverts: Array<{ context: BrowserContext; moniteur: Moniteur; nom: string }> = [];
    await use(async (o = {}) => {
      const context = await browser.newContext(contextOptions);
      await connecter(context, bureau, o.compte ?? compte, o.langue ?? langue, baseURL!);
      const page = await context.newPage();
      const moniteur = new Moniteur(baseURL!);
      moniteur.brancher(page);
      ouverts.push({ context, moniteur, nom: `autre onglet ${ouverts.length + 1} (${o.compte ?? compte})` });
      return { page, context, moniteur };
    });
    for (const x of ouverts) await x.context.close().catch(() => undefined);
    for (const x of ouverts) await echouerSiProblemes(x.moniteur, testInfo, x.nom);
  },

  jetonDe: async ({ bureau }, use) => {
    const cache = new Map<Compte, string>();
    await use(async (c) => {
      if (!cache.has(c)) cache.set(c, (await sessionDe(bureau, c)).access_token);
      return cache.get(c)!;
    });
  },
});

// ── Aides de vérification en base ─────────────────────────────────────────

export interface LigneRegle {
  id: string; org_id: string; name: string; is_active: boolean; trigger_event: string;
  conditions: Record<string, unknown> | null; delay_seconds: number | null;
  actions: Array<{ type: string; config: Record<string, unknown> }> | null;
  steps: Array<Record<string, unknown>> | null;
  deleted_at: string | null; purged_at?: string | null; folder_id?: string | null; is_template?: boolean | null;
  [cle: string]: unknown;
}

/** Crée une règle directement en base (préparer un état), dans un bureau de test. */
export async function creerRegle(bureau: Bureau, org: string, ligne: Partial<LigneRegle> & { name: string }): Promise<LigneRegle> {
  if (org !== bureau.orgA && org !== bureau.orgB) throw new Error('REFUS : creerRegle() n’écrit que dans les bureaux de test.');
  const { data, error } = await bureau.admin.from('automation_rules').insert({
    org_id: org, trigger_event: 'lead.created', conditions: {}, delay_seconds: 0,
    actions: [{ type: 'log_activity', config: {} }], is_active: false, ...ligne,
  }).select('*').single();
  if (error) throw new Error(`creerRegle : ${error.message}`);
  return data as LigneRegle;
}

export async function lireRegle(bureau: Bureau, id: string): Promise<LigneRegle | null> {
  const { data, error } = await bureau.admin.from('automation_rules').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(`lireRegle : ${error.message}`);
  return (data as LigneRegle | null) ?? null;
}

export async function reglesParNom(bureau: Bureau, org: string, fragment: string): Promise<LigneRegle[]> {
  const { data, error } = await bureau.admin.from('automation_rules').select('*').eq('org_id', org).ilike('name', `%${fragment}%`).order('created_at');
  if (error) throw new Error(`reglesParNom : ${error.message}`);
  return (data ?? []) as LigneRegle[];
}

/** Les envois que le bac à sable a retenus (textos, courriels, webhooks) pour ce bureau depuis `depuis` (ISO). */
export async function envoisSimules(bureau: Bureau, org: string, depuis: string) {
  const { data, error } = await bureau.admin.from('envois_simules')
    .select('id, canal, destinataire, sujet, corps, meta, created_at')
    .eq('org_id', org).gte('created_at', depuis).neq('destinataire', 'horloge://mesure').order('created_at');
  if (error) throw new Error(`envoisSimules : ${error.message}`);
  return data ?? [];
}

/** Attend qu'une lecture satisfasse une condition — jamais de délai fixe. */
export async function attendre<T>(lire: () => Promise<T>, ok: (v: T) => boolean, delaiMs = 20_000, pasMs = 300): Promise<T> {
  const fin = Date.now() + delaiMs;
  for (;;) {
    const v = await lire();
    if (ok(v)) return v;
    if (Date.now() > fin) throw new Error(`attendre : délai de ${delaiMs} ms dépassé ; dernière valeur : ${JSON.stringify(v)?.slice(0, 400)}`);
    await new Promise((r) => setTimeout(r, pasMs));
  }
}

/** Appel d'API DIRECT avec le jeton d'un compte (contrôle des permissions sans passer par les boutons). */
export async function appelApi(baseURL: string, jeton: string, org: string, methode: string, chemin: string, corps?: unknown): Promise<{ status: number; json: unknown }> {
  const r = await fetch(`${baseURL}${chemin}`, {
    method: methode,
    headers: {
      Authorization: `Bearer ${jeton}`, 'x-org-id': org, 'Content-Type': 'application/json', 'x-requested-with': 'XMLHttpRequest',
    },
    body: corps === undefined ? undefined : JSON.stringify(corps),
  });
  const texte = await r.text();
  let json: unknown = texte;
  try { json = JSON.parse(texte); } catch { /* corps non JSON */ }
  return { status: r.status, json };
}

/** Client supabase-js agissant COMME le compte (la RLS s'applique) — pour les lectures / écritures directes. */
export function clientDe(jeton: string): SupabaseClient {
  return createClient(URL_SB(), ANON(), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${jeton}` } },
  });
}

/** Ouvre la liste et attend la fin du chargement. */
export async function ouvrirListe(page: Page): Promise<void> {
  await page.goto('/automations');
  await page.getByRole('heading', { name: /Mes automatisations|Workflows list/ }).waitFor({ timeout: 90_000 });
  await page.locator('table, [data-etat-vide]').first().waitFor({ timeout: 30_000 }).catch(() => undefined);
}
