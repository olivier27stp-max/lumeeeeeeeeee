/**
 * Banc du lot « rôles » : le banc commun + les rôles que la matrice exige.
 *
 *   import { test, expect } from './_roles';
 *
 * Ajoute, sans toucher au banc commun (`_outils/banc.ts`) :
 *  · `perso`  : les comptes vendeur / lecteur (`automations.read` seul) / éditeur
 *               (`read` + `update`, non admin) du bureau A — voir `_comptes.ts` ;
 *  · `jeton(role)` : un jeton d'accès pour n'importe lequel des sept rôles ;
 *  · `ongletDe(role)` : un onglet connecté sous ce rôle, avec son propre moniteur
 *               (console + réseau), fermé et contrôlé à la fin du test ;
 *  · `outils` : de quoi préparer et vérifier en base (service_role), décor compris ;
 *  · `api(...)` : appel d'API direct, avec ou sans jeton, sur le chemin EXACT donné.
 */
import type { BrowserContext, Page } from '@playwright/test';
import { test as banc, expect, connecter, Moniteur, type Bureau, type Compte, type Langue } from '../_outils/banc';
import { assurerComptesPerso, sessionParEmail, type CompteMessagerie, type ComptesPerso, type Role } from './_comptes';
import { assurerDecor, type Decor, type Outils } from './_routes';

export { expect };
export type { Role };
export * from './_comptes';

/** L'API Express, SANS le mandataire de Vite (qui réécrit certains chemins) : c'est elle que la production expose. */
// Pile locale (scripts/qa/automations-e2e/local.mjs) : le lanceur ne transmet pas `E2E_API`, mais il pose
// `QA_UI_PORT_API` — le port de l'API Express de la passe. Sans lui : l'API de l'atelier staging (3112).
export const API_DIRECTE = process.env.E2E_API
  || (process.env.QA_UI_PORT_API ? `http://127.0.0.1:${process.env.QA_UI_PORT_API}` : 'http://127.0.0.1:3112');

export interface Reponse { status: number; json: unknown; texte: string }

/** Appel direct. `jeton: null` = sans session. Le chemin part tel quel (barre finale, casse, %2F…). */
export async function api(base: string, jeton: string | null, org: string | null, methode: string, chemin: string, corps?: unknown, entetes: Record<string, string> = {}): Promise<Reponse> {
  const h: Record<string, string> = { 'Content-Type': 'application/json', 'x-requested-with': 'XMLHttpRequest', ...entetes };
  if (jeton) h.Authorization = `Bearer ${jeton}`;
  if (org) h['x-org-id'] = org;
  const r = await fetch(`${base}${chemin}`, { method: methode, headers: h, body: corps === undefined ? undefined : JSON.stringify(corps) });
  const texte = await r.text();
  let json: unknown = texte;
  try { json = JSON.parse(texte); } catch { /* corps non JSON */ }
  return { status: r.status, json, texte };
}

/** Le texte d'erreur d'une réponse (`{ error }`), ou ''. */
export function erreurDe(r: Reponse): string {
  const j = r.json as { error?: unknown } | null;
  return j && typeof j === 'object' && typeof j.error === 'string' ? j.error : '';
}

interface ParWorker {
  perso: ComptesPerso;
  decorA: Decor;
  cacheJetons: Map<Role, { jeton: string; pris: number }>;
}
interface ParTest {
  jeton: (role: Role) => Promise<string>;
  ongletDe: (role: Role | CompteMessagerie, o?: { langue?: Langue; mobile?: boolean }) => Promise<{ page: Page; context: BrowserContext; moniteur: Moniteur }>;
  outils: Outils;
  emailDe: (role: Role) => string;
}

const estBanc = (r: Role | CompteMessagerie): r is Compte => r === 'proprioA' || r === 'adminA' || r === 'techA' || r === 'proprioB';

/** Lecture réessayée : la base de staging est partagée, une lecture peut expirer (« statement timeout »). */
async function lireAvecReprise<T>(quoi: string, lire: () => PromiseLike<{ data: T | null; error: { message: string } | null }>): Promise<T> {
  let derniere = '';
  for (let i = 0; i < 10; i++) {
    const { data, error } = await lire();
    if (!error && data !== null) return data;
    derniere = error?.message ?? 'aucune ligne';
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`${quoi} : ${derniere}`);
}

export const test = banc.extend<ParTest, ParWorker>({
  /*
   * Le `bureau` du banc commun est REMPLACÉ pour ce lot, sans toucher au banc.
   * Raison : le harnais (`assurerBureauTest` → `assurerOrg`) cherche le bureau par son nom sans regarder
   * l'erreur de la lecture ; quand la base de staging est saturée, la lecture expire et il CRÉE un second
   * bureau du même nom — puis un de plus à chaque passe (constaté le 2026-10-01 : quatre doublons).
   * Ici on ne crée JAMAIS de bureau : on retrouve le jeu existant, lectures réessayées, et on s'arrête
   * s'il n'y a pas exactement un bureau A et un bureau B, tous deux en bac à sable.
   */
  bureau: [async ({}, use, workerInfo) => {
    // Même règle que le banc : un jeu par agent (`E2E_JEU`), lu par le harnais à son import.
    process.env.QA_AUTO_SUFFIXE = (process.env.E2E_JEU || 'roles') + (workerInfo.parallelIndex === 0 ? '' : String(workerInfo.parallelIndex));
    const { adminStaging, COMPTES, NOM_ORG_A, NOM_ORG_B } = await import('../../../tests/automations-suite/harnais/bureau-test');
    const admin = adminStaging();
    const org = async (nom: string): Promise<string> => {
      const lignes = await lireAvecReprise(`bureau « ${nom} »`, () => admin.from('orgs').select('id').eq('name', nom).is('deleted_at', null));
      if (lignes.length !== 1) throw new Error(`ARRÊT : ${lignes.length} bureau(x) « ${nom} » (attendu : 1). Pile locale : node scripts/qa/automations-e2e/preparer-jeu-roles.mjs.`);
      return lignes[0].id as string;
    };
    const orgA = await org(NOM_ORG_A);
    const orgB = await org(NOM_ORG_B);
    const bac = await lireAvecReprise('bac à sable', () => admin.from('orgs_envois_simules').select('org_id').in('org_id', [orgA, orgB]));
    if (bac.length !== 2) throw new Error('ARRÊT : un bureau de test n’est pas en bac à sable — aucun test ne tourne.');
    const membres = await lireAvecReprise('adhésions', () => admin.from('memberships').select('user_id, org_id, role, full_name').in('org_id', [orgA, orgB]).eq('status', 'active'));
    const trouver = (o: string, role: string, nom: string): string => {
      const m = membres.find((x) => x.org_id === o && x.role === role && x.full_name === nom);
      if (!m) throw new Error(`ARRÊT : compte « ${nom} » (${role}) absent du jeu — lancer une fois le banc commun (00-banc.spec.ts) avec E2E_JEU=roles.`);
      return m.user_id as string;
    };
    const emailAdmin = COMPTES.proprioA.email.replace('proprio-a', 'admin-a');
    const comptes = {
      proprioA: { email: COMPTES.proprioA.email, id: trouver(orgA, 'owner', COMPTES.proprioA.nom), role: 'owner' },
      adminA: { email: emailAdmin, id: trouver(orgA, 'admin', 'QA Admin A'), role: 'admin' },
      techA: { email: COMPTES.techA.email, id: trouver(orgA, 'technician', COMPTES.techA.nom), role: 'technician' },
      proprioB: { email: COMPTES.proprioB.email, id: trouver(orgB, 'owner', COMPTES.proprioB.nom), role: 'owner' },
    };
    const b: Bureau = { admin, orgA, orgB, comptes, orgDe: (c) => (c === 'proprioB' ? orgB : orgA) };
    await use(b);
  }, { scope: 'worker' }],

  perso: [async ({ bureau }, use) => {
    await use(await assurerComptesPerso(bureau.admin, bureau.orgA, bureau.comptes.proprioA.email));
  }, { scope: 'worker' }],

  decorA: [async ({ bureau }, use) => {
    const d = await assurerDecor(bureau.admin, bureau.orgA, bureau.comptes.proprioA.id);
    // Un modèle du catalogue global (identifiant stable) pour « Utiliser ce modèle ».
    await use({ ...d, modele: 'quote_opened_notify' });
  }, { scope: 'worker' }],

  cacheJetons: [async ({}, use) => { await use(new Map()); }, { scope: 'worker' }],

  emailDe: async ({ bureau, perso }, use) => {
    await use((role) => (estBanc(role) ? bureau.comptes[role].email : perso[role].email));
  },

  jeton: async ({ bureau, emailDe, cacheJetons }, use) => {
    await use(async (role) => {
      const c = cacheJetons.get(role);
      // Sur staging un jeton vit 30 minutes : on le renouvelle après 12.
      if (c && Date.now() - c.pris < 12 * 60_000) return c.jeton;
      const s = await sessionParEmail(bureau.admin, emailDe(role));
      cacheJetons.set(role, { jeton: s.access_token, pris: Date.now() });
      return s.access_token;
    });
  },

  outils: async ({ bureau, marque, decorA }, use) => {
    await use({ admin: bureau.admin, orgA: bureau.orgA, orgB: bureau.orgB, idProprioA: bureau.comptes.proprioA.id, marque, decor: decorA });
  },

  ongletDe: async ({ browser, bureau, perso, baseURL, contextOptions }, use, testInfo) => {
    const ouverts: Array<{ context: BrowserContext; moniteur: Moniteur; nom: string }> = [];
    await use(async (role, o = {}) => {
      const context = await browser.newContext(contextOptions);
      if (estBanc(role)) {
        await connecter(context, bureau, role, o.langue ?? 'fr', baseURL!); // baseURL est fixé par la config
      } else {
        // `connecter` ne connaît que les comptes du banc : on lui présente le compte perso sous l'étiquette « techA ».
        const faux: Bureau = { ...bureau, comptes: { ...bureau.comptes, techA: { email: perso[role].email, id: perso[role].id, role: 'sales_rep' } } };
        await connecter(context, faux, 'techA', o.langue ?? 'fr', baseURL!);
      }
      const page = await context.newPage();
      const moniteur = new Moniteur(baseURL!);
      moniteur.brancher(page);
      ouverts.push({ context, moniteur, nom: `onglet ${role}` });
      return { page, context, moniteur };
    });
    for (const x of ouverts) await x.context.close().catch(() => undefined);
    for (const x of ouverts) {
      if (x.moniteur.problemes.length) {
        await testInfo.attach(`moniteur-${x.nom}`, { body: JSON.stringify(x.moniteur.problemes, null, 2), contentType: 'application/json' });
        const lignes = x.moniteur.problemes.slice(0, 12).map((p) => `  · [${p.genre}] ${p.texte}  (sur ${p.page})`).join('\n');
        throw new Error(`Le moniteur (${x.nom}) a relevé ${x.moniteur.problemes.length} problème(s) :\n${lignes}`);
      }
      const nonVus = x.moniteur.attendusNonVus();
      if (nonVus.length && testInfo.status === 'passed') throw new Error(`Problème déclaré « attendu » mais jamais survenu (${x.nom}) : ${nonVus.join(' ; ')}`);
    }
  },
});

/** Dossier des captures et relevés du lot (hors du dépôt). */
// Une passe qui fixe `E2E_SORTIES` (pile locale, tri) range ses relevés chez elle : les matrices de la passe
// staging (`sorties/roles/matrice-*.json`) ne sont pas écrasées.
export const SORTIES_LOT = process.env.E2E_SORTIES ? `${process.env.E2E_SORTIES.replace(/\\/g, '/')}/lot-roles` : 'lot-roles';
