/**
 * Aides communes aux specs du lot « editeur » (structure de l'éditeur plein écran).
 * Rien ici ne touche au produit : préparation de données dans le bureau de test,
 * ouverture de l'éditeur, lecture de ce que l'écran affiche.
 */
import type { Locator, Page } from '@playwright/test';
import type { BrowserContext } from '@playwright/test';
import { capturesDe } from '../_outils/banc';
import { test as testDuBanc, expect as expectDuBanc, creerRegle, lireRegle, attendre, type Bureau, type LigneRegle, type Langue } from '../_outils/banc';

/**
 * RÉPONSE D'AUTH GARDÉE EN MÉMOIRE (poste et staging partagés par plusieurs sessions).
 *
 * Le banc réécrit déjà la réponse de `GET /auth/v1/user` (pour y fixer la langue) en la relisant sur
 * staging par `route.fetch()`, dont le délai est de 15 s. Quand staging rame, deux effets sans rapport
 * avec l'éditeur faisaient tomber les tests au hasard :
 *   · « TimeoutError: route.fetch » levé DANS le banc ;
 *   · le verrou d'auth de supabase-js tenu trop longtemps, donc « volé » (« Lock broken by another
 *     request with the 'steal' option »), après quoi l'app croit le compte sans bureau et tente d'en
 *     créer un (403 POST /orgs) — défaut réel de la coquille, consigné à part (constat EDITEUR-HL1).
 * Ici, la première réponse réelle de staging pour un compte est gardée et resservie telle quelle aux
 * appels suivants : même contenu, sans attente. Aucune attente de test n'est assouplie.
 */
const utilisateursConnus = new Map<string, Record<string, unknown>>();
function sujetDuJeton(entete: string | undefined): string | null {
  try {
    const charge = (entete ?? '').replace(/^Bearer /, '').split('.')[1];
    return (JSON.parse(Buffer.from(charge, 'base64url').toString('utf8')) as { sub?: string }).sub ?? null;
  } catch { return null; }
}
async function garderAuth(context: BrowserContext, langue: Langue): Promise<void> {
  await context.route('**/auth/v1/user**', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const avecLangue = (u: Record<string, unknown>) => ({ ...u, user_metadata: { ...((u.user_metadata as object | undefined) ?? {}), language: langue } });
    const sub = sujetDuJeton(route.request().headers().authorization);
    const connu = sub ? utilisateursConnus.get(sub) : undefined;
    if (connu) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(avecLangue(connu)) });
    const r = await route.fetch({ timeout: 120_000 });
    const j = await r.json().catch(() => null) as Record<string, unknown> | null;
    if (r.ok() && j && typeof j.id === 'string') utilisateursConnus.set(j.id, j);
    return route.fulfill({ response: r, json: j ? avecLangue(j) : {} });
  });
  // Le rafraîchissement du jeton ne se garde pas (il tourne à chaque appel) : même réécriture que le banc, délai plus long.
  await context.route('**/auth/v1/token**', async (route) => {
    const r = await route.fetch({ timeout: 120_000 });
    const j = await r.json().catch(() => null) as { user?: { user_metadata?: Record<string, unknown> } } | null;
    if (j?.user) j.user.user_metadata = { ...(j.user.user_metadata ?? {}), language: langue };
    return route.fulfill({ response: r, json: j ?? {} });
  });
}

export const test = testDuBanc.extend({
  context: async ({ context, langue }, use) => {
    await garderAuth(context, langue);
    await use(context);
  },
  autreOnglet: async ({ autreOnglet, langue }, use) => {
    await use(async (o = {}) => {
      const onglet = await autreOnglet(o);
      await garderAuth(onglet.context, o.langue ?? langue);
      return onglet;
    });
  },
});

/**
 * Le poste et la base de staging sont partagés par plusieurs sessions : une réponse du serveur peut
 * prendre plusieurs dizaines de secondes. Les attentes patientent donc plus longtemps que les 15 s du
 * banc — ce n'est PAS une reprise : une attente qui échoue échoue une fois, simplement plus tard.
 */
export const expect = expectDuBanc.configure({ timeout: 60_000 });
/** Délai d'un test du lot (même raison). */
export const DELAI_TEST = 420_000;


export const CAPTURES = capturesDe('editeur');

export type EtapeBase = Record<string, unknown> & { id: string; type: string };

export const texto = (id: string, corps: string, suivant: string | null = null, nom?: string): EtapeBase =>
  ({ id, type: 'action', action: { type: 'send_sms', config: { body: corps } }, suivant, ...(nom ? { nom } : {}) });
export const courriel = (id: string, objet: string, corps: string, suivant: string | null = null): EtapeBase =>
  ({ id, type: 'action', action: { type: 'send_email', config: { subject: objet, body: corps } }, suivant });
export const attente = (id: string, secondes: number, suivant: string | null = null): EtapeBase =>
  ({ id, type: 'attendre', delai_secondes: secondes, suivant });
export const tache = (id: string, titre: string, suivant: string | null = null): EtapeBase =>
  ({ id, type: 'action', action: { type: 'create_task', config: { title: titre } }, suivant });

/** Un parcours de trois textos A → B → C sur « Devis envoyé » : la base de la plupart des tests. */
export function troisTextos(): EtapeBase[] {
  return [texto('e1', 'Texto ALPHA', 'e2'), texto('e2', 'Texto BRAVO', 'e3'), texto('e3', 'Texto CHARLIE', null)];
}

/** Crée en base une règle « parcours » (format `steps`) dans le bureau A. */
export async function creerParcours(
  bureau: Bureau, nom: string, etapes: EtapeBase[], plus: Partial<LigneRegle> = {},
): Promise<LigneRegle> {
  const premiere = etapes.find((e) => e.type === 'action') as { action?: { type: string; config: Record<string, unknown> } } | undefined;
  return creerRegle(bureau, (plus.org_id as string | undefined) ?? bureau.orgA, {
    name: nom,
    trigger_event: 'quote.sent',
    actions: premiere?.action ? [premiere.action] : [{ type: 'send_sms', config: { body: 'x' } }],
    steps: etapes,
    ...plus,
  });
}

/** Ouvre l'éditeur d'une règle et attend que la barre du haut soit là. */
export async function ouvrirEditeur(page: Page, id: string): Promise<void> {
  await page.goto(`/automations/${id}`);
  await expect(page.getByRole('tablist', { name: 'Sections' })).toBeVisible({ timeout: 180_000 });
}

/** La barre du haut de l'éditeur (l'app a un autre <header> derrière, celui de la coquille). */
export function barre(page: Page): Locator {
  return page.locator('header').filter({ has: page.getByRole('button', { name: /Mes automatisations|My automations/ }) });
}

/**
 * L'indicateur d'enregistrement de la barre du haut (texte exact).
 * « Pas encore enregistrée » : une automatisation neuve (`/automations/nouvelle`) n'existe pas en base
 * avant sa première vraie sauvegarde (constat EDITEUR-02, corrigé par #859).
 */
export function indicateur(page: Page): Locator {
  return barre(page).getByText(/^(Enregistré|Modifié|Enregistrement…|Pas encore enregistrée|\d+ étape\(s\) à compléter|Saved|Edited|Saving…|Not saved yet|\d+ step\(s\) to complete)$/);
}

/**
 * La carte en pointillés du déclencheur, sur un canevas VIDE. Depuis #859 (constat EDITEUR-03) elle
 * dit « Quand », le déclencheur EN PLACE, puis « Cliquer pour choisir un autre déclencheur » — et plus
 * « Choisir le déclencheur » avec le déclencheur en petit dessous.
 */
export function carteDeclencheurVide(page: Page, declencheur: string | RegExp = /.+/): Locator {
  const nom = typeof declencheur === 'string' ? declencheur.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : declencheur.source;
  return page.getByRole('button', { name: new RegExp(`^Quand\\s*${nom}\\s*Cliquer pour choisir un autre déclencheur$`) });
}

/** Le titre du bandeau rouge des problèmes : le nombre est accordé depuis #859 (« 1 chose », « 2 choses »). */
export function titreBandeau(n: number, publiee = false): string {
  const choses = `${n} ${n > 1 ? 'choses' : 'chose'} à corriger`;
  return publiee ? `Publiée mais cassée : ${choses} — rien ne part correctement` : `${choses} avant de publier`;
}
/** N'importe quel titre de bandeau des problèmes, ancien libellé compris (pour affirmer son ABSENCE). */
export const TOUT_BANDEAU = /\d+ chose(s|\(s\))? à corriger/;

/** L'écran de l'éditeur (calque plein écran) : la coquille de l'app reste dans le DOM derrière lui. */
export const ecranEditeur = (page: Page): Locator => page.locator('div.fixed.inset-0.z-50');

/** Attend « Enregistré » dans la barre du haut. */
export async function attendreEnregistre(page: Page, delai = 120_000): Promise<void> {
  await expect(indicateur(page)).toHaveText(/^(Enregistré|Saved)$/, { timeout: delai });
}

/**
 * Les cartes d'étape du canevas, dans l'ordre d'affichage : « titre | détail ».
 * Sélecteur CSS faute de mieux : les cartes n'ont ni liste ni rôle qui les distingue des autres boutons.
 */
export async function cartes(page: Page): Promise<string[]> {
  return page.locator('div.relative > button.w-full.rounded-xl.text-left').evaluateAll((els) =>
    els.map((el) => Array.from(el.querySelectorAll('span.block')).map((s) => (s.textContent ?? '').trim()).join(' | ')));
}

/** La carte d'étape dont le nom accessible contient `texte`. */
export function carte(page: Page, texte: string | RegExp): Locator {
  return page.locator('div.relative > button.w-full.rounded-xl.text-left').filter({ hasText: texte });
}

/** Le bouton « ··· » de la carte dont le texte contient `texte`. */
export function menuDeCarte(page: Page, texte: string | RegExp): Locator {
  return carte(page, texte).locator('xpath=..').getByRole('button', { name: /^Options (de l’étape|for)/ });
}

export const panneauEtape = (page: Page): Locator => page.getByRole('complementary', { name: /Modifier l’étape|Edit step/ });
export const panneauDeclencheur = (page: Page): Locator => page.getByRole('complementary', { name: /Réglages du déclencheur|Trigger settings/ });
export const tiroirActions = (page: Page): Locator => page.getByRole('complementary', { name: 'Actions' });
export const tiroirDeclencheurs = (page: Page): Locator => page.getByRole('complementary', { name: /^(Déclencheurs|Triggers)$/ });
export const dialogue = (page: Page): Locator => page.getByRole('dialog');
export const toasts = (page: Page): Locator => page.getByRole('region', { name: /Notifications/ }).getByRole('listitem');

/** Les étapes en base, en suivant le fil depuis la tête (`steps[0]`). */
export async function filEnBase(bureau: Bureau, id: string): Promise<Array<Record<string, unknown>>> {
  const r = await lireRegle(bureau, id);
  const etapes = (r?.steps ?? []) as Array<Record<string, unknown>>;
  const parId = new Map(etapes.map((e) => [String(e.id), e]));
  const fil: Array<Record<string, unknown>> = [];
  let c = etapes[0];
  const vues = new Set<string>();
  while (c && !vues.has(String(c.id))) {
    vues.add(String(c.id));
    fil.push(c);
    const suite = (c.type === 'si' ? c.alors : c.suivant) as string | null | undefined;
    c = suite ? parId.get(suite) as Record<string, unknown> : undefined as never;
  }
  return fil;
}

/** Le texte (body) de chaque étape du fil en base — pour comparer l'ORDRE avec l'écran. */
export async function corpsDuFil(bureau: Bureau, id: string): Promise<string[]> {
  return (await filEnBase(bureau, id)).map((e) => {
    if (e.type !== 'action') return `(${String(e.type)})`;
    const cfg = ((e.action as { config?: Record<string, unknown> })?.config ?? {});
    return String(cfg.body ?? cfg.title ?? '');
  });
}

/** Attend qu'une règle en base satisfasse une condition. */
export async function attendreRegle(bureau: Bureau, id: string, ok: (r: LigneRegle) => boolean, delai = 120_000): Promise<LigneRegle> {
  const r = await attendre(() => lireRegle(bureau, id), (x) => !!x && ok(x), delai);
  return r as LigneRegle;
}

/**
 * Un client fictif dans le bureau de test (sans courriel ni téléphone : rien à envoyer), pour nommer
 * les lignes des journaux. À supprimer avec `supprimerClient` en fin de test.
 */
export async function creerClient(bureau: Bureau, prenom: string, nom: string, org?: string): Promise<{ id: string; complet: string }> {
  const { data, error } = await bureau.admin.from('clients').insert({
    org_id: org ?? bureau.orgA, created_by: bureau.comptes.proprioA.id, first_name: prenom, last_name: nom, status: 'lead',
  }).select('id').single();
  if (error || !data) throw new Error(`creerClient : ${error?.message}`);
  return { id: data.id as string, complet: `${prenom} ${nom}` };
}
/**
 * Un client fictif AVEC une adresse courriel (domaine réservé `.test`) : « Aperçu » prend pour exemple le
 * client le plus récent du bureau qui en a une (server/routes/automation-test.ts) — sans lui, l'aperçu dit
 * « Ajoutez un client avec une adresse courriel… » et ne montre aucune étape. Le créer dans le test évite de
 * dépendre de ce qu'un autre lot a laissé dans le bureau. Le bureau est en bac à sable : rien ne lui est envoyé.
 */
export async function creerClientJoignable(bureau: Bureau, prenom: string, nom: string): Promise<{ id: string; complet: string; email: string }> {
  const email = `apercu-${Math.random().toString(36).slice(2, 10)}@lume-qa.test`;
  const { data, error } = await bureau.admin.from('clients').insert({
    org_id: bureau.orgA, created_by: bureau.comptes.proprioA.id, first_name: prenom, last_name: nom, status: 'lead', email,
  }).select('id').single();
  if (error || !data) throw new Error(`creerClientJoignable : ${error?.message}`);
  return { id: data.id as string, complet: `${prenom} ${nom}`, email };
}
export async function supprimerClient(bureau: Bureau, id: string): Promise<void> {
  await bureau.admin.from('automation_scheduled_tasks').delete().eq('entity_id', id);
  await bureau.admin.from('automation_execution_logs').delete().eq('entity_id', id);
  await bureau.admin.from('clients').delete().eq('id', id);
}

export interface JournalSeme {
  action_type: string; result_success: boolean; result_error?: string | null;
  result_data?: Record<string, unknown> | null; il_y_a_minutes?: number; entity_type?: string; entity_id?: string;
}
/** Sème des lignes dans `automation_execution_logs` pour une règle du bureau de test. */
export async function semerJournaux(bureau: Bureau, regle: LigneRegle, clientId: string, lignes: JournalSeme[]): Promise<void> {
  const maintenant = Date.now();
  const aInserer = lignes.map((l, i) => ({
    org_id: regle.org_id, automation_rule_id: regle.id, trigger_event: regle.trigger_event,
    entity_type: l.entity_type ?? 'client', entity_id: l.entity_id ?? clientId,
    action_type: l.action_type, action_config: {}, result_success: l.result_success,
    result_error: l.result_error ?? null, result_data: l.result_data ?? null, duration_ms: 120,
    created_at: new Date(maintenant - (l.il_y_a_minutes ?? (i + 1) * 10) * 60_000).toISOString(),
    execution_key: `e2e:${regle.id}:${i}:${Math.random().toString(36).slice(2)}`,
  }));
  for (let i = 0; i < aInserer.length; i += 100) {
    const { error } = await bureau.admin.from('automation_execution_logs').insert(aInserer.slice(i, i + 100));
    if (error) throw new Error(`semerJournaux : ${error.message}`);
  }
}

export interface TacheSemee {
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'; step_id?: string | null;
  type_action?: string | null; last_error?: string | null; attempts?: number;
  /** Décalage de `execute_at` par rapport à maintenant, en minutes (négatif = passé). */
  dans_minutes: number; terminee_il_y_a_minutes?: number; creee_il_y_a_jours?: number;
}
/** Sème des lignes dans `automation_scheduled_tasks`. Les tâches « en attente » sont posées loin dans le futur. */
export async function semerTaches(bureau: Bureau, regle: LigneRegle, clientId: string, taches: TacheSemee[]): Promise<void> {
  const maintenant = Date.now();
  const aInserer = taches.map((t, i) => ({
    org_id: regle.org_id, automation_rule_id: regle.id, entity_type: 'client', entity_id: clientId,
    action_config: t.type_action === null ? {} : { type: t.type_action ?? 'send_sms', config: { body: 'x' } },
    execute_at: new Date(maintenant + t.dans_minutes * 60_000).toISOString(),
    status: t.status, attempts: t.attempts ?? (t.status === 'pending' ? 0 : 1), last_error: t.last_error ?? null,
    step_id: t.step_id ?? null,
    completed_at: t.terminee_il_y_a_minutes === undefined ? null : new Date(maintenant - t.terminee_il_y_a_minutes * 60_000).toISOString(),
    created_at: new Date(maintenant - (t.creee_il_y_a_jours ?? 0) * 86_400_000 - (i + 1) * 1000).toISOString(),
    execution_key: `e2e:${regle.id}:${i}:${Math.random().toString(36).slice(2)}`,
  }));
  const { error } = await bureau.admin.from('automation_scheduled_tasks').insert(aInserer);
  if (error) throw new Error(`semerTaches : ${error.message}`);
}

/** La date telle que l'éditeur l'écrit (fr-CA, heure de Montréal), espaces normalisées. */
export function dateAffichee(iso: string): string {
  return new Date(iso).toLocaleString('fr-CA', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'America/Montreal',
  }).replace(/\s+/g, ' ');
}
export const sansEspacesSpeciales = (t: string): string => t.replace(/\s+/g, ' ').trim();
