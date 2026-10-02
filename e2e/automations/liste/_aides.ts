/**
 * Aides communes aux specs de la LISTE des automatisations (`/automations`).
 *
 *  · `test` : le banc + une remise en état automatique après CHAQUE test de ce
 *    qui vaut pour tout le bureau (pause globale, langue des messages,
 *    dossiers, préréglages dépubliés) — un test rouge ne salit pas le suivant.
 *  · des sélecteurs d'utilisateur (ligne, toast, recherche) et des lectures
 *    de vérification en base.
 */
import type { Locator, Page, Route } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { capturesDe } from '../_outils/banc';
import {
  test as banc, expect as attenteDuBanc, creerRegle, attendre as attendreLecture, appelApi as appelApiDuBanc,
  type Bureau, type Compte, type LigneRegle,
} from '../_outils/banc';

/*
 * Le staging est partagé par plusieurs sessions : une lecture qui prend
 * d'habitude 100 ms en met parfois plus de 10 000. Une attente d'ÉTAT plus
 * longue (jamais un délai fixe) évite de prendre cette lenteur pour un défaut.
 */
export const expect = attenteDuBanc.configure({ timeout: 45_000 });
export { creerRegle };
export { lireRegle, reglesParNom, attendre, appelApi, clientDe, ouvrirListe } from '../_outils/banc';
export type { Bureau, LigneRegle };

export const CAPTURES = capturesDe('liste');

/** Remet le bureau dans son état d'origine : rien de ce qu'un test a changé ne survit. */
export async function remettreEnEtat(bureau: Bureau): Promise<void> {
  const orgs = [bureau.orgA, bureau.orgB];
  await bureau.admin.from('company_settings')
    .update({ default_language: 'fr', automations_paused: false, automations_paused_at: null, automations_paused_by: null })
    .in('org_id', orgs);
  await bureau.admin.from('automation_folders').delete().in('org_id', orgs);
  // Les préréglages semés à la création du bureau : publiés, vivants, à la racine.
  await bureau.admin.from('automation_rules')
    .update({ is_active: true, deleted_at: null, purged_at: null, folder_id: null })
    .in('org_id', orgs).eq('is_preset', true)
    .or('is_active.eq.false,deleted_at.not.is.null,purged_at.not.is.null,folder_id.not.is.null');
  // La capacité « Client inactif », activée par certains tests seulement (voir `activerClientInactif`).
  await bureau.admin.from('org_features').delete().in('org_id', orgs).eq('feature', DRAPEAU_CLIENT_INACTIF);
}

/*
 * « CLIENT INACTIF » VIT DERRIÈRE UN DRAPEAU D'ENTREPRISE.
 *
 * `org_features.auto_client_inactif` (server/lib/automations-drapeaux.ts) : sans lui, la route
 * `GET /api/automations/clients-inactifs/apercu` répond 404 « Capacité non activée. » et la
 * confirmation s'ouvre sans le nombre de clients. Un bureau de test naît SANS ce drapeau : le test
 * qui veut voir le décompte doit donc le poser lui-même. Le serveur garde les drapeaux 30 s en
 * mémoire : on attend que la ROUTE réponde 200 (un état), pas un délai.
 * Retiré après chaque test par `remettreEnEtat`.
 */
const DRAPEAU_CLIENT_INACTIF = 'auto_client_inactif';
export async function activerClientInactif(bureau: Bureau, baseURL: string, jeton: string): Promise<void> {
  const { error } = await bureau.admin.from('org_features')
    .upsert({ org_id: bureau.orgA, feature: DRAPEAU_CLIENT_INACTIF, enabled: true, metadata: { qa: 'lot liste' } }, { onConflict: 'org_id,feature' });
  if (error) throw new Error(`activerClientInactif : ${error.message}`);
  await attendreLecture(
    () => appelApiDuBanc(baseURL, jeton, bureau.orgA, 'GET', '/api/automations/clients-inactifs/apercu?mois=6'),
    (r) => r.status === 200, 60_000, 1_000,
  );
}

/**
 * Attend que le SERVEUR applique les droits qu'on vient d'écrire en base pour un membre.
 *
 * Les routes HTTP gardent les droits d'un membre 60 s en mémoire (server/lib/rbac.ts, `CACHE_TTL`) : écrits en
 * base à l'instant, ils ne valent côté serveur qu'à l'expiration de ce cache. Sans cette attente, le résultat d'un
 * test dépendait de ce que le test PRÉCÉDENT avait laissé en mémoire, et du temps écoulé depuis (vu au tri : vert
 * à la passe, rouge à la relance, pour le même code). On interroge deux routes en lecture seule, l'une gardée par
 * « voir » (`GET /folders`), l'autre par « modifier » (`GET /bureaux-cibles`), jusqu'à ce qu'elles répondent
 * comme les droits le veulent.
 */
export async function attendreDroitsServeur(baseURL: string, jeton: string, org: string, droits: { voir: boolean; modifier: boolean }): Promise<void> {
  const etat = async () => {
    const [voir, modifier] = await Promise.all([
      appelApiDuBanc(baseURL, jeton, org, 'GET', '/api/automations/folders'),
      appelApiDuBanc(baseURL, jeton, org, 'GET', '/api/automations/bureaux-cibles'),
    ]);
    return { voir: voir.status, modifier: modifier.status };
  };
  const voulu = (permis: boolean, statut: number) => (permis ? statut === 200 : statut === 403);
  await attendreLecture(etat, (s) => voulu(droits.voir, s.voir) && voulu(droits.modifier, s.modifier), 90_000, 2_000);
}

/**
 * Un préréglage RETIRÉ de l'affichage (commit 098dd153) : `estimate_followup` tant qu'il attend
 * `estimate.sent`, que plus rien n'émet. Il reste en base (inerte) mais la liste ne le montre pas :
 * tout décompte « égal à la base » doit l'écarter.
 */
export const estRetire = (r: { preset_key?: unknown; trigger_event?: unknown }): boolean =>
  r.preset_key === 'estimate_followup' && r.trigger_event === 'estimate.sent';

export interface LigneAffichable { id: string; name: string; preset_key: string | null; trigger_event: string; is_active: boolean; is_preset: boolean; deleted_at: string | null }

/** Les automatisations que la LISTE peut montrer pour ce bureau, lues en base à l'instant (ni purgées, ni retirées). */
export async function reglesAffichables(bureau: Bureau, org: string): Promise<LigneAffichable[]> {
  const { data, error } = await bureau.admin.from('automation_rules')
    .select('id, name, preset_key, trigger_event, is_active, is_preset, deleted_at').eq('org_id', org).is('purged_at', null);
  if (error) throw new Error(`reglesAffichables : ${error.message}`);
  return ((data ?? []) as LigneAffichable[]).filter((r) => !estRetire(r));
}

/**
 * La couleur de fond d'un élément, en rouge / vert / bleu (0 à 255), quelle que soit la façon dont
 * le navigateur l'écrit (`rgb(…)`, `oklch(…)`, `color(srgb …)`) : on la PEINT sur un pixel et on le relit.
 */
export async function couleurDeFond(loc: Locator): Promise<[number, number, number]> {
  return loc.evaluate((el) => {
    const toile = document.createElement('canvas');
    toile.width = 1; toile.height = 1;
    const c = toile.getContext('2d');
    if (!c) throw new Error('canvas indisponible');
    c.fillStyle = getComputedStyle(el).backgroundColor;
    c.fillRect(0, 0, 1, 1);
    const [r, v, b] = c.getImageData(0, 0, 1, 1).data;
    return [r, v, b] as [number, number, number];
  });
}

/*
 * LE BUREAU DE TEST, RETROUVÉ SANS LE RECRÉER.
 *
 * Playwright relance un worker après CHAQUE test en échec, et la fixture
 * `bureau` du banc refait alors toute la préparation (une quinzaine
 * d'écritures : comptes, adhésions, forfait, numéro…). Sur le staging partagé,
 * ces écritures dépassent parfois le délai (« canceling statement due to
 * statement timeout ») et font échouer le test SUIVANT, qui n'y est pour rien.
 * Les tests marqués `@defaut` restent rouges par construction : chaque rouge
 * coûtait une préparation complète.
 *
 * Ici : les identifiants du jeu sont mémorisés (hors dépôt) après la première
 * préparation ; les fois suivantes, deux LECTURES suffisent — dont la ceinture
 * du banc : les deux bureaux doivent être en bac à sable, sinon rien ne tourne.
 */
/*
 * Le client de PRÉPARATION et de VÉRIFICATION (service_role) insiste.
 *
 * Staging est partagé : par à-coups, PostgREST répond 503 (« Could not query
 * the database for the schema cache. Retrying. ») ou annule une requête
 * (« canceling statement due to statement timeout », 57014). Ces pannes de
 * passage n'ont rien à voir avec l'écran testé ; sans cette insistance, c'est
 * la préparation des données qui faisait tomber le test. Seules les lectures
 * et écritures DU TEST insistent : les requêtes de la page, elles, restent
 * telles que l'utilisateur les vivrait, et le moniteur les voit.
 */
const fetchTenace: typeof fetch = async (entree, init) => {
  let derniere: Response | null = null;
  let erreur: unknown = null;
  for (let essai = 0; essai < 7; essai += 1) {
    if (essai > 0) await new Promise((r) => setTimeout(r, 1500 * essai));
    try {
      const reponse = await fetch(entree, init);
      if (reponse.status < 500) return reponse;
      const corps = await reponse.clone().text().catch(() => '');
      const passagere = reponse.status === 502 || reponse.status === 503 || reponse.status === 504
        || /57014|statement timeout|schema cache|PGRST00[0-3]/.test(corps);
      if (!passagere) return reponse;
      derniere = reponse;
    } catch (e) {
      erreur = e;
    }
  }
  if (derniere) return derniere;
  throw erreur instanceof Error ? erreur : new Error(String(erreur));
};

interface Memo { url: string; jeu: string; orgA: string; orgB: string; comptes: Bureau['comptes'] }
const REF_PROD = 'bbzcuzqfgsdvjsymfwmr';

async function preparerBureau(jeu: string): Promise<Bureau> {
  const url = process.env.VITE_SUPABASE_URL ?? '';
  const cle = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!url || !cle || url.includes(REF_PROD)) throw new Error('REFUS : E2E des automatisations = STAGING seulement.');
  const dossier = resolve(process.env.E2E_SORTIES || join(tmpdir(), 'lume-e2e-automations'));
  const fichier = join(dossier, `bureau-${jeu}.json`);
  const admin: SupabaseClient = createClient(url, cle, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetchTenace } });
  const rendre = (m: Memo): Bureau => ({ admin, orgA: m.orgA, orgB: m.orgB, comptes: m.comptes, orgDe: (c: Compte) => (c === 'proprioB' ? m.orgB : m.orgA) });

  if (existsSync(fichier)) {
    try {
      const m = JSON.parse(readFileSync(fichier, 'utf8')) as Memo;
      if (m.url === url && m.jeu === jeu) {
        const [bac, adhesions] = await Promise.all([
          admin.from('orgs_envois_simules').select('org_id').in('org_id', [m.orgA, m.orgB]),
          admin.from('memberships').select('user_id, org_id, role, status').in('org_id', [m.orgA, m.orgB]),
        ]);
        const a = (u: string, o: string, r: string) => (adhesions.data ?? []).some((x) => x.user_id === u && x.org_id === o && x.role === r && x.status === 'active');
        const complet = a(m.comptes.proprioA.id, m.orgA, 'owner') && a(m.comptes.adminA.id, m.orgA, 'admin')
          && a(m.comptes.techA.id, m.orgA, 'technician') && a(m.comptes.proprioB.id, m.orgB, 'owner');
        if ((bac.data ?? []).length === 2 && complet) return rendre(m);
      }
    } catch { /* mémo illisible : on refait la préparation complète */ }
  }

  // Préparation complète — la même que la fixture `bureau` du banc.
  process.env.QA_AUTO_SUFFIXE = jeu;
  const { assurerBureauTest, COMPTES } = await import('../../../tests/automations-suite/harnais/bureau-test');
  const b = await assurerBureauTest();
  const emailAdmin = COMPTES.proprioA.email.replace('proprio-a', 'admin-a');
  const cree = await admin.auth.admin.createUser({
    email: emailAdmin, password: randomBytes(24).toString('base64url'), email_confirm: true, user_metadata: { full_name: 'QA Admin A' },
  });
  let idAdmin = cree.data?.user?.id;
  if (!idAdmin) {
    const { data: lien, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email: emailAdmin });
    if (!lien?.user) throw new Error(`compte admin de test : ${cree.error?.message} / ${error?.message}`);
    idAdmin = lien.user.id;
  }
  const { error: eM } = await admin.from('memberships')
    .upsert({ user_id: idAdmin, org_id: b.orgA, role: 'admin', status: 'active', full_name: 'QA Admin A' }, { onConflict: 'user_id,org_id' });
  if (eM) throw new Error(`adhésion admin de test : ${eM.message}`);
  const ids = { ...b.users, adminA: idAdmin } as Record<Compte, string>;
  for (const id of Object.values(ids)) {
    await admin.from('profiles').update({ location_consent: false, location_consent_at: new Date().toISOString() }).eq('id', id);
  }
  const { data: bac } = await admin.from('orgs_envois_simules').select('org_id').in('org_id', [b.orgA, b.orgB]);
  if ((bac ?? []).length !== 2) throw new Error('ARRÊT : un bureau de test n’est pas en bac à sable — aucun test ne tourne.');
  const memo: Memo = {
    url, jeu, orgA: b.orgA, orgB: b.orgB,
    comptes: {
      proprioA: { email: COMPTES.proprioA.email, id: ids.proprioA, role: 'owner' },
      adminA: { email: emailAdmin, id: ids.adminA, role: 'admin' },
      techA: { email: COMPTES.techA.email, id: ids.techA, role: 'technician' },
      proprioB: { email: COMPTES.proprioB.email, id: ids.proprioB, role: 'owner' },
    },
  };
  mkdirSync(dossier, { recursive: true });
  writeFileSync(fichier, JSON.stringify(memo, null, 1));
  return rendre(memo);
}

/** Le compte tel que l'auth le renvoie, lu une fois par worker. */
const comptesLus = new Map<string, { user_metadata?: Record<string, unknown> } & Record<string, unknown>>();
async function compteDe(bureau: Bureau, compte: Compte): Promise<{ user_metadata?: Record<string, unknown> } & Record<string, unknown>> {
  const id = bureau.comptes[compte].id;
  const connu = comptesLus.get(id);
  if (connu) return connu;
  const { data, error } = await bureau.admin.auth.admin.getUserById(id);
  if (error || !data.user) throw new Error(`lecture du compte ${compte} : ${error?.message}`);
  const lu = data.user as unknown as { user_metadata?: Record<string, unknown> } & Record<string, unknown>;
  comptesLus.set(id, lu);
  return lu;
}

/** Les automatisations « [E2E … » laissées par un test interrompu, et l'état global du bureau. */
async function menageDesRestes(bureau: Bureau): Promise<void> {
  for (const org of [bureau.orgA, bureau.orgB]) {
    const { data } = await bureau.admin.from('automation_rules').select('id').eq('org_id', org).ilike('name', '[E2E %');
    const ids = (data ?? []).map((r) => r.id as string);
    for (let i = 0; i < ids.length; i += 100) {
      const lot = ids.slice(i, i + 100);
      await bureau.admin.from('automation_scheduled_tasks').delete().in('automation_rule_id', lot);
      await bureau.admin.from('automation_execution_logs').delete().in('automation_rule_id', lot);
      await bureau.admin.from('automation_rules').delete().in('id', lot);
    }
  }
  await remettreEnEtat(bureau);
}

export const test = banc.extend<{ remiseEnEtat: void; delaiLarge: void }, { bureau: Bureau }>({
  // Staging répond parfois en plus de 15 s : un clic attend son bouton plus longtemps (jamais un délai fixe).
  actionTimeout: 60_000,
  navigationTimeout: 120_000,

  bureau: [async ({}, use, workerInfo) => {
    // Même nom de jeu que le banc : E2E_JEU, sinon « e2e » + numéro du worker.
    const jeu = (process.env.E2E_JEU || 'e2e') + (process.env.E2E_JEU && workerInfo.parallelIndex === 0 ? '' : String(workerInfo.parallelIndex));
    const bureau = await preparerBureau(jeu);
    // Un test interrompu (arrêt du lancement, délai dépassé) n'a pas fait son ménage : on repart propre.
    await menageDesRestes(bureau);
    await use(bureau);
  }, { scope: 'worker' }],

  /*
   * LA LECTURE DU COMPTE, RÉPONDUE SUR PLACE.
   *
   * Le banc réécrit la langue du compte dans chaque réponse d'auth par
   * `route.fetch()` (aller-retour par Node, limité à 15 s). Quand l'auth de
   * staging est lente — et elle l'est par à-coups, le poste étant partagé —
   * deux choses arrivent, sans rapport avec ce que le test vérifie :
   *  · le test tombe sur « route.fetch: Timeout 15000ms » ;
   *  · `GET /auth/v1/user` garde le verrou de session du SDK plus de 5 s, la
   *    requête suivante le lui VOLE (« Lock broken by another request with
   *    the 'steal' option »), la session est perdue pour ce chargement et
   *    l'app, croyant le compte sans bureau, tente d'en créer un (403).
   *
   * Ici, `GET /auth/v1/user` reçoit tout de suite le compte, lu une fois par
   * worker (avec la langue demandée, comme le fait le banc) : plus aucun
   * aller-retour vers l'auth pendant le chargement de la page. Le
   * rafraîchissement du jeton, lui, reste réel.
   */
  context: async ({ context, bureau, compte, langue }, use) => {
    await context.unroute('**/auth/v1/user**');
    await context.unroute('**/auth/v1/token**');
    const utilisateur = await compteDe(bureau, compte);
    await context.route('**/auth/v1/user**', async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...utilisateur, user_metadata: { ...(utilisateur.user_metadata ?? {}), language: langue } }) });
    });
    if (langue !== 'fr') {
      await context.route('**/auth/v1/token**', async (route: Route) => {
        const r = await route.fetch({ timeout: 90_000 });
        const j = await r.json().catch(() => null) as { user?: { user_metadata?: Record<string, unknown> } } | null;
        if (j?.user) j.user.user_metadata = { ...(j.user.user_metadata ?? {}), language: langue };
        await route.fulfill({ response: r, json: j ?? {} });
      });
    }
    await use(context);
  },

  delaiLarge: [async ({}, use, testInfo) => {
    testInfo.setTimeout(300_000);
    await use();
  }, { auto: true }],

  remiseEnEtat: [async ({ bureau }, use) => {
    await use();
    await remettreEnEtat(bureau);
  }, { auto: true }],
});

/** Le champ de recherche de la liste (pas la recherche globale de l'en-tête). */
export const champRecherche = (page: Page): Locator => page.getByRole('textbox', { name: /^(Rechercher|Search)$/ });

/** Tape dans la recherche de la liste : ne restent que les lignes du test. */
export async function chercher(page: Page, texte: string): Promise<void> {
  await champRecherche(page).fill(texte);
}

/** La ligne du tableau dont l'automatisation s'appelle exactement `nom`. */
export const ligne = (page: Page, nom: string): Locator =>
  page.getByRole('row').filter({ has: page.getByRole('checkbox', { name: `Cocher ${nom}`, exact: true }) });

/** Les lignes d'automatisation affichées (sans l'en-tête, sans les panneaux dépliés). */
export const lignesAffichees = (page: Page): Locator =>
  page.getByRole('row').filter({ has: page.getByRole('checkbox', { name: /^Cocher / }) });

/** Les noms affichés, dans l'ordre de l'écran. */
export async function nomsAffiches(page: Page): Promise<string[]> {
  const libelles = await page.getByRole('checkbox', { name: /^Cocher / }).evaluateAll(
    (els) => els.map((e) => (e.getAttribute('aria-label') ?? '').replace(/^Cocher /, '')),
  );
  return libelles;
}

/** Un toast (sonner) portant ce texte. */
export const toast = (page: Page, texte: string | RegExp): Locator =>
  page.getByRole('region', { name: /Notifications/ }).getByText(texte);

/**
 * La pastille d'un dossier dans la barre de dossiers : son nom suivi de son compteur.
 * (Le compteur est collé au nom dans le nom accessible : « Devis3 » ou « Devis 3 ».)
 */
export const pastille = (page: Page, nom: string, combien: number): Locator =>
  page.getByRole('button', { name: new RegExp(`^${echapper(nom)}\\s*${combien}$`) });

/**
 * Amène un élément dans la fenêtre et attend que le DÉFILEMENT SOIT TERMINÉ (plus aucun événement « scroll »).
 *
 * Le menu ⋮ d'une ligne se referme au moindre défilement (il est ancré à la fenêtre : Automations.tsx,
 * `auDefilement`). Quand Playwright doit faire défiler la page pour cliquer un bouton, l'événement « scroll » de
 * ce défilement est émis APRÈS le clic (relevé au tri : clic à 1 409 ms, scroll à 1 457 ms, 5 fois sur 6) et
 * referme le menu à peine ouvert. Un utilisateur, lui, a fini de faire défiler avant de cliquer : on fait pareil.
 */
export async function amenerALEcran(loc: Locator): Promise<void> {
  await loc.evaluate((el) => new Promise<void>((fini) => {
    let dernier = 0;
    let rendus = 0;
    const note = () => { dernier = performance.now(); rendus = 0; };
    window.addEventListener('scroll', note, true);
    const avant = el.getBoundingClientRect().top;
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    const aBouge = Math.abs(el.getBoundingClientRect().top - avant) > 0.5;
    const debut = performance.now();
    const guetter = () => {
      rendus += 1;
      // Rien n'a bougé : rien à attendre. Sinon : l'événement est arrivé, puis quatre rendus sans autre défilement.
      const calme = !aBouge || (dernier > 0 && rendus >= 4);
      if (calme || performance.now() - debut > 5_000) { window.removeEventListener('scroll', note, true); fini(); return; }
      requestAnimationFrame(guetter);
    };
    requestAnimationFrame(guetter);
  }));
}

/** Le menu ⋮ d'une ligne. */
export const boutonActions = (page: Page, nom: string): Locator =>
  page.getByRole('button', { name: `Actions pour ${nom}`, exact: true });

export const interrupteur = (page: Page, nom: string): Locator =>
  page.getByRole('switch', { name: new RegExp(`^(Publier ${echapper(nom)}|Repasser ${echapper(nom)} en brouillon)$`) });

export function echapper(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/** L'onglet de la liste (« Toutes », « À vérifier (2) »…). */
export const onglet = (page: Page, debut: string): Locator =>
  page.getByRole('tab', { name: new RegExp(`^${echapper(debut)}( \\(\\d+\\))?$`) });

/**
 * Part VISIBLE d'un élément (0 à 1), une fois rogné par la fenêtre et par tous
 * ses ancêtres qui coupent ce qui dépasse (`overflow` autre que `visible`).
 * 1 = entièrement visible ; 0 = l'utilisateur ne le voit pas.
 */
export async function partVisible(loc: Locator): Promise<number> {
  return loc.evaluate((el) => {
    const r = el.getBoundingClientRect();
    let g = Math.max(r.left, 0), h = Math.max(r.top, 0), d = Math.min(r.right, innerWidth), b = Math.min(r.bottom, innerHeight);
    for (let p = el.parentElement; p; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (/(hidden|auto|scroll|clip)/.test(`${s.overflowX} ${s.overflowY}`)) {
        const c = p.getBoundingClientRect();
        g = Math.max(g, c.left); h = Math.max(h, c.top); d = Math.min(d, c.right); b = Math.min(b, c.bottom);
      }
    }
    const aire = Math.max(0, d - g) * Math.max(0, b - h);
    return r.width * r.height > 0 ? aire / (r.width * r.height) : 0;
  });
}

/** Nombre de règles du bureau (toutes, corbeille comprise) — pour prouver qu'un geste n'a RIEN créé. */
export async function compterRegles(bureau: Bureau, org: string): Promise<number> {
  const { count, error } = await bureau.admin.from('automation_rules').select('id', { count: 'exact', head: true }).eq('org_id', org);
  if (error) throw new Error(`compterRegles : ${error.message}`);
  return count ?? 0;
}

export async function reglagesBureau(bureau: Bureau, org: string): Promise<{ default_language: string | null; automations_paused: boolean | null; automations_paused_at: string | null; automations_paused_by: string | null }> {
  const { data, error } = await bureau.admin.from('company_settings')
    .select('default_language, automations_paused, automations_paused_at, automations_paused_by').eq('org_id', org).single();
  if (error) throw new Error(`reglagesBureau : ${error.message}`);
  return data;
}

export async function creerDossierBase(bureau: Bureau, org: string, name: string): Promise<{ id: string; name: string }> {
  const { data, error } = await bureau.admin.from('automation_folders').insert({ org_id: org, name }).select('id, name').single();
  if (error) throw new Error(`creerDossierBase : ${error.message}`);
  return data as { id: string; name: string };
}

export async function dossiersBase(bureau: Bureau, org: string): Promise<Array<{ id: string; name: string }>> {
  const { data, error } = await bureau.admin.from('automation_folders').select('id, name').eq('org_id', org).order('name');
  if (error) throw new Error(`dossiersBase : ${error.message}`);
  return (data ?? []) as Array<{ id: string; name: string }>;
}

/** Un échec d'exécution récent, pour l'onglet « À vérifier ». */
export async function creerEchec(bureau: Bureau, org: string, ruleId: string, erreur: string): Promise<void> {
  const { error } = await bureau.admin.from('automation_execution_logs').insert({
    org_id: org, automation_rule_id: ruleId, trigger_event: 'lead.created', action_type: 'send_sms',
    result_success: false, result_error: erreur, entity_type: 'lead', entity_id: randomUUID(),
  });
  if (error) throw new Error(`creerEchec : ${error.message}`);
}

/** Un parcours (nouveau format `steps`) publiable : un texto. */
export const ETAPES_TEXTO = [
  { id: 'e1', type: 'action', action: { type: 'send_sms', config: { body: 'Bonjour [client_first_name], merci de votre confiance.' } } },
];
