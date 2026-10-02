/**
 * Aides du lot « actions » : données du bureau de test (membres, étiquettes,
 * pipeline, services, champs personnalisés, une automatisation publiée à
 * démarrer) et gestes de l'éditeur (ouvrir, tiroir Actions, panneau d'étape).
 *
 * Rien ici ne touche au produit ni au banc : seulement le bureau A du jeu
 * `E2E_JEU=actions`, en bac à sable sur staging.
 */
import type { Locator, Page, Route } from '@playwright/test';
import {
  test as banc, expect, creerRegle, lireRegle, attendre, appelApi, sessionDe,
  type Bureau, type LigneRegle, type Langue,
} from '../_outils/banc';
import { mkdirSync } from 'node:fs';
import { capturesDe } from '../_outils/banc';

export const CAPTURES = capturesDe('actions');
mkdirSync(CAPTURES, { recursive: true });

const BASE = process.env.E2E_BASE || 'http://127.0.0.1:5191';

// ── Le `test` du lot ──────────────────────────────────────────────────────

/**
 * Le `test` du banc, avec deux précautions propres à ce lot (le banc lui-même
 * n'est pas modifié) :
 *
 *  · les réponses d'authentification Supabase sont relayées AVEC PATIENCE. Le
 *    banc les relaie par `route.fetch()` (15 s au plus) pour y fixer la langue
 *    du compte ; quand staging est chargé par plusieurs sessions, ce délai est
 *    dépassé, le relais lève, la requête reste en suspens et l'app reste sur
 *    « Chargement de l'espace… ». Ici : 90 s, et en dernier recours la requête
 *    continue telle quelle.
 *  · le délai d'un test passe à 5 minutes, pour la même raison (aucune attente
 *    fixe pour autant : tout attend un état).
 */
async function relayer(route: Route, langue: Langue, cible: 'user' | 'token'): Promise<void> {
  try {
    const r = await route.fetch({ timeout: 90_000 });
    const j = await r.json().catch(() => null);
    if (cible === 'user') {
      if (j && typeof j === 'object') j.user_metadata = { ...(j.user_metadata ?? {}), language: langue };
    } else if (j?.user) {
      j.user.user_metadata = { ...(j.user.user_metadata ?? {}), language: langue };
    }
    await route.fulfill({ response: r, json: j ?? {} });
  } catch {
    await route.continue().catch(() => undefined);
  }
}

export const test = banc.extend<{ patience: void }>({
  patience: [async ({ page, langue }, use, testInfo) => {
    testInfo.setTimeout(480_000);
    await page.route('**/auth/v1/user**', (route) => (route.request().method() !== 'GET' ? route.continue() : relayer(route, langue, 'user')));
    await page.route('**/auth/v1/token**', (route) => relayer(route, langue, 'token'));
    await use();
    await page.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => undefined);
  }, { auto: true }],
});
export { expect };

// ── Données du bureau ─────────────────────────────────────────────────────

export interface ChampQa { id: string; label: string; key: string; object_type: string; field_type: string; options: Array<{ id: string; label: string }> }
export interface Donnees {
  membres: { proprio: { id: string; nom: string }; admin: { id: string; nom: string }; tech: { id: string; nom: string } };
  etiquettes: string[];
  pipeline: { id: string; name: string };
  /** Étapes non archivées du pipeline par défaut, dans l'ordre. */
  etapes: Array<{ id: string; name_fr: string; name_en: string; role_systeme: string | null; kind: string }>;
  services: Array<{ id: string; name: string }>;
  /** Champs personnalisés créés pour le lot, par clé. */
  champs: Record<string, ChampQa>;
  /** Une automatisation PUBLIÉE du bureau, à choisir dans « Démarrer une automatisation ». */
  reglePubliee: { id: string; nom: string };
}

/** Les champs personnalisés du lot : plusieurs types, plusieurs objets. */
const CHAMPS_A_CREER: Array<{ object_type: string; key: string; label: string; field_type: string; options?: Array<{ label: string }> }> = [
  { object_type: 'client', key: 'qa_fin_garantie', label: 'Fin de garantie QA', field_type: 'date' },
  { object_type: 'client', key: 'qa_type_client', label: 'Type de client QA', field_type: 'dropdown_single', options: [{ label: 'Résidentiel' }, { label: 'Commercial' }] },
  { object_type: 'client', key: 'qa_interets', label: 'Intérêts QA', field_type: 'dropdown_multi', options: [{ label: 'Vitres' }, { label: 'Gouttières' }, { label: 'Lavage à pression' }] },
  { object_type: 'client', key: 'qa_nb_employes', label: 'Nombre d’employés QA', field_type: 'number' },
  { object_type: 'client', key: 'qa_budget', label: 'Budget annuel QA', field_type: 'monetary' },
  { object_type: 'client', key: 'qa_infolettre', label: 'Infolettre QA', field_type: 'checkbox' },
  { object_type: 'client', key: 'qa_remarques', label: 'Remarques QA', field_type: 'multi_line' },
  { object_type: 'client', key: 'qa_surnom', label: 'Surnom QA', field_type: 'single_line' },
  { object_type: 'deal', key: 'qa_fermeture', label: 'Fermeture prévue QA', field_type: 'date' },
  { object_type: 'deal', key: 'qa_origine', label: 'Origine QA', field_type: 'single_line' },
  { object_type: 'invoice', key: 'qa_bon_commande', label: 'Bon de commande QA', field_type: 'single_line' },
];

export const ETIQUETTES_QA = ['Ne pas relancer QA', 'VIP QA'];
export const SERVICES_QA = ['Lavage de vitres QA', 'Nettoyage de gouttières QA'];
export const NOM_REGLE_PUBLIEE = 'QA actions — cible à démarrer (ne pas supprimer)';

let cache: Promise<Donnees> | null = null;

/** Prépare (une fois par processus, idempotent) les données du bureau A. */
export function donnees(bureau: Bureau): Promise<Donnees> {
  cache ??= preparer(bureau).catch((e) => { cache = null; throw e; });
  return cache;
}

async function preparer(bureau: Bureau): Promise<Donnees> {
  const a = bureau.admin;
  const org = bureau.orgA;
  const dire = (quoi: string, erreur: { message: string } | null) => { if (erreur) throw new Error(`préparation — ${quoi} : ${erreur.message}`); };

  // Restes d'une passe interrompue : les règles marquées « [E2E … » de plus de 30 minutes (ce bureau seulement).
  {
    const limite = new Date(Date.now() - 30 * 60_000).toISOString();
    const { data: restes } = await a.from('automation_rules').select('id').eq('org_id', org).like('name', '[E2E %').lt('created_at', limite);
    const ids = (restes ?? []).map((r) => String(r.id));
    if (ids.length) {
      await a.from('automation_scheduled_tasks').delete().in('automation_rule_id', ids);
      await a.from('automation_execution_logs').delete().in('automation_rule_id', ids);
      await a.from('automation_rules').delete().in('id', ids);
    }
  }

  // Drapeau « Type d'envoi » (CHA-06, CHA-08) : sans lui, ces deux champs n'existent pas à l'écran.
  {
    const { data, error } = await a.from('org_features').select('id, enabled').eq('org_id', org).eq('feature', 'auto_desabonnement_canal').maybeSingle();
    dire('drapeau (lecture)', error);
    if (!data) dire('drapeau (création)', (await a.from('org_features').insert({ org_id: org, feature: 'auto_desabonnement_canal', enabled: true })).error);
    else if (!data.enabled) dire('drapeau (activation)', (await a.from('org_features').update({ enabled: true }).eq('id', data.id)).error);
  }

  // Membres : les noms tels que le menu doit les montrer.
  const { data: membres, error: eM } = await a.from('memberships').select('user_id, full_name').eq('org_id', org).eq('status', 'active');
  dire('membres', eM);
  const nomDe = (id: string) => String((membres ?? []).find((m) => m.user_id === id)?.full_name ?? '');

  // Un client fictif et ses étiquettes (les suggestions viennent de `client_tags`).
  {
    const email = 'client-etiquettes-actions@lume-qa.test';
    let { data: client } = await a.from('clients').select('id').eq('org_id', org).eq('email', email).is('deleted_at', null).maybeSingle();
    if (!client) {
      const cree = await a.from('clients').insert({ org_id: org, first_name: 'Client', last_name: 'Étiquettes QA', email, status: 'active', created_by: bureau.comptes.proprioA.id }).select('id').single();
      dire('client', cree.error);
      client = cree.data;
    }
    const { data: deja } = await a.from('client_tags').select('tag').eq('client_id', client!.id);
    const presents = new Set((deja ?? []).map((t) => String(t.tag)));
    for (const tag of ETIQUETTES_QA) {
      if (!presents.has(tag)) dire(`étiquette ${tag}`, (await a.from('client_tags').insert({ client_id: client!.id, tag })).error);
    }
  }

  // Services du catalogue.
  {
    const { data: deja } = await a.from('predefined_services').select('name').eq('org_id', org);
    const presents = new Set((deja ?? []).map((s) => String(s.name)));
    for (const name of SERVICES_QA) {
      if (!presents.has(name)) dire(`service ${name}`, (await a.from('predefined_services').insert({ org_id: org, name, is_active: true, default_price_cents: 12000 })).error);
    }
  }
  const { data: services, error: eS } = await a.from('predefined_services').select('id, name').eq('org_id', org).in('name', SERVICES_QA).order('name');
  dire('services', eS);

  // Pipeline et étapes : celui que le bureau a déjà (semé à la création).
  const { data: pipeline, error: eP } = await a.from('pipelines_ventes').select('id, name').eq('org_id', org).is('archived_at', null).order('position').limit(1).maybeSingle();
  dire('pipeline', eP);
  if (!pipeline) throw new Error('préparation — le bureau de test n’a aucun pipeline de ventes.');
  const { data: etapes, error: eE } = await a.from('pipeline_stages').select('id, name_fr, name_en, role_systeme, kind, position')
    .eq('pipeline_id', pipeline.id).is('archived_at', null).order('position');
  dire('étapes', eE);

  // Champs personnalisés : par l'API (la même porte que l'écran Paramètres).
  const { data: existants, error: eC } = await a.from('custom_fields').select('id, key, object_type').eq('org_id', org).is('archived_at', null);
  dire('champs (lecture)', eC);
  const manquants = CHAMPS_A_CREER.filter((c) => !(existants ?? []).some((x) => x.key === c.key && x.object_type === c.object_type));
  if (manquants.length) {
    const jeton = (await sessionDe(bureau, 'proprioA')).access_token;
    for (const c of manquants) {
      const r = await appelApi(BASE, jeton, org, 'POST', '/api/custom-fields', { ...c, sur_formulaire: false });
      if (r.status !== 201) throw new Error(`préparation — champ ${c.key} : ${r.status} ${JSON.stringify(r.json).slice(0, 300)}`);
    }
  }
  const { data: champsBase, error: eC2 } = await a.from('custom_fields').select('id, key, label, object_type, field_type').eq('org_id', org).is('archived_at', null);
  dire('champs', eC2);
  const { data: options, error: eO } = await a.from('custom_field_options').select('id, field_id, label, position').eq('org_id', org).is('archived_at', null).order('position');
  dire('options', eO);
  const champs: Record<string, ChampQa> = {};
  for (const c of champsBase ?? []) {
    champs[String(c.key)] = {
      id: String(c.id), key: String(c.key), label: String(c.label), object_type: String(c.object_type), field_type: String(c.field_type),
      options: (options ?? []).filter((o) => o.field_id === c.id).map((o) => ({ id: String(o.id), label: String(o.label) })),
    };
  }

  // Une automatisation publiée, interne (une tâche), sur un déclencheur que les tests ne provoquent jamais.
  let { data: cible } = await a.from('automation_rules').select('id, name').eq('org_id', org).eq('name', NOM_REGLE_PUBLIEE).is('deleted_at', null).maybeSingle();
  if (!cible) {
    const cree = await a.from('automation_rules').insert({
      org_id: org, name: NOM_REGLE_PUBLIEE, trigger_event: 'client.untagged', conditions: {}, delay_seconds: 0, is_active: true,
      actions: [{ type: 'create_task', config: { title: 'Tâche QA (cible à démarrer)' } }],
      steps: [{ id: 'e1', type: 'action', action: { type: 'create_task', config: { title: 'Tâche QA (cible à démarrer)' } }, suivant: null }],
    }).select('id, name').single();
    dire('règle publiée', cree.error);
    cible = cree.data;
  }

  const c = bureau.comptes;
  return {
    membres: {
      proprio: { id: c.proprioA.id, nom: nomDe(c.proprioA.id) },
      admin: { id: c.adminA.id, nom: nomDe(c.adminA.id) },
      tech: { id: c.techA.id, nom: nomDe(c.techA.id) },
    },
    etiquettes: ETIQUETTES_QA,
    pipeline: { id: String(pipeline.id), name: String(pipeline.name) },
    etapes: (etapes ?? []).map((e) => ({ id: String(e.id), name_fr: String(e.name_fr), name_en: String(e.name_en), role_systeme: (e.role_systeme as string | null) ?? null, kind: String(e.kind) })),
    services: (services ?? []).map((s) => ({ id: String(s.id), name: String(s.name) })),
    champs,
    reglePubliee: { id: String(cible!.id), nom: String(cible!.name) },
  };
}

// ── Règles ────────────────────────────────────────────────────────────────

export interface EtapeBase { id: string; type: string; [cle: string]: unknown }

/** Un brouillon VIDE (canevas à dessiner), sur le déclencheur voulu. */
export function creerBrouillon(bureau: Bureau, marque: string, declencheur: string, plus: Partial<LigneRegle> = {}): Promise<LigneRegle> {
  return creerRegle(bureau, bureau.orgA, {
    name: `${marque} ${declencheur}`,
    trigger_event: declencheur,
    // L'action provisoire que l'éditeur pose lui-même à la création : parcours vide.
    actions: [{ type: 'send_sms', config: { body: 'À compléter' } }],
    steps: [],
    ...plus,
  });
}

/** Un brouillon qui porte déjà UNE action (étape `e1`). */
export function creerBrouillonAvecAction(
  bureau: Bureau, marque: string, declencheur: string, type: string, config: Record<string, unknown>, plus: Partial<LigneRegle> = {},
): Promise<LigneRegle> {
  return creerBrouillon(bureau, marque, declencheur, {
    steps: [{ id: 'e1', type: 'action', action: { type, config }, suivant: null }],
    ...plus,
  });
}

/** Les étapes enregistrées d'une règle. */
export async function etapesEnBase(bureau: Bureau, id: string): Promise<EtapeBase[]> {
  const r = await lireRegle(bureau, id);
  return ((r?.steps ?? []) as EtapeBase[]);
}

/** La configuration enregistrée de l'action d'une étape (par défaut la première). */
export function configDe(etapes: EtapeBase[], idEtape?: string): Record<string, unknown> | null {
  const e = idEtape ? etapes.find((x) => x.id === idEtape) : etapes[0];
  const action = e?.action as { config?: Record<string, unknown> } | undefined;
  return action?.config ?? null;
}

/** Attend que la base porte exactement ces étapes (l'enregistrement automatique part 3 s après la dernière modification). */
export async function attendreEtapes(bureau: Bureau, id: string, ok: (e: EtapeBase[]) => boolean, delaiMs = 150_000): Promise<EtapeBase[]> {
  return attendre(() => etapesEnBase(bureau, id), ok, delaiMs, 500);
}

/** Compare deux configurations sans tenir compte de l'ordre des clés. */
function memeConfig(a: Record<string, unknown> | null, b: Record<string, unknown>): boolean {
  if (!a) return false;
  const tri = (o: Record<string, unknown>) => JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k]]));
  return tri(a) === tri(b);
}

/**
 * Attend que l'étape porte EXACTEMENT cette configuration en base.
 * (Une action choisie dans le tiroir est d'abord enregistrée avec ses valeurs
 * de départ, 3 s plus tard ; ce qu'on saisit ensuite suit à l'enregistrement
 * de l'étape.) En cas d'écart, l'erreur montre la dernière valeur lue.
 */
export async function attendreConfig(bureau: Bureau, id: string, config: Record<string, unknown>, idEtape = 'e1', delaiMs = 150_000): Promise<EtapeBase[]> {
  return attendre(() => etapesEnBase(bureau, id), (e) => memeConfig(configDe(e, idEtape), config), delaiMs, 500);
}

// ── Gestes de l'éditeur ───────────────────────────────────────────────────

const ONGLET_PARCOURS = /^(Parcours|Builder)$/;

export async function ouvrirEditeur(page: Page, id: string): Promise<void> {
  await page.goto(`/automations/${id}`);
  await expect(page.getByRole('tab', { name: ONGLET_PARCOURS })).toBeVisible({ timeout: 180_000 });
}

export const tiroirActions = (page: Page): Locator => page.getByRole('complementary', { name: 'Actions', exact: true });
export const panneauEtape = (page: Page): Locator => page.getByRole('complementary', { name: /^(Modifier l’étape|Edit step)$/ });
export const panneauDeclencheur = (page: Page): Locator => page.getByRole('complementary', { name: /^(Régler le déclencheur|Configure the trigger|Réglages du déclencheur|Trigger settings)/ });

const echapper = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** L'item du tiroir dont le TITRE est exactement celui-ci (le nom accessible = titre + aide). */
export function itemTiroir(page: Page, titre: string): Locator {
  return tiroirActions(page).getByRole('listitem').filter({ has: page.locator('span.block', { hasText: new RegExp(`^${echapper(titre)}$`) }) }).getByRole('button');
}

/** Ouvre le tiroir Actions par le bouton « Ajouter » (fin du parcours). */
export async function ouvrirTiroir(page: Page, en = false): Promise<Locator> {
  await page.getByRole('button', { name: en ? 'Add' : 'Ajouter', exact: true }).click();
  const t = tiroirActions(page);
  await expect(t).toBeVisible();
  return t;
}

/** Ajoute une action par le tiroir : son panneau s'ouvre. */
export async function ajouterAction(page: Page, titre: string, en = false): Promise<Locator> {
  await ouvrirTiroir(page, en);
  await itemTiroir(page, titre).click();
  const p = panneauEtape(page);
  await expect(p).toBeVisible();
  return p;
}

/** Un champ du panneau par son libellé de catalogue (« * » si obligatoire, « (facultatif) » sinon). */
export function champ(p: Locator, libelle: string, obligatoire: boolean, en = false): Locator {
  return p.getByLabel(`${libelle}${obligatoire ? ' *' : en ? ' (optional)' : ' (facultatif)'}`, { exact: true });
}

/** Le bouton « Enregistrer » du pied du panneau. */
export const boutonEnregistrer = (p: Locator, en = false): Locator => p.getByRole('button', { name: en ? 'Save action' : 'Enregistrer', exact: true });

/** L'indicateur de la barre du haut. */
export async function attendreEnregistre(page: Page, en = false): Promise<void> {
  await expect(page.getByText(en ? 'Saved' : 'Enregistré', { exact: true })).toBeVisible({ timeout: 150_000 });
}

/**
 * Fin de test propre : le canevas n'a plus rien en attente d'enregistrement
 * (« Enregistré », ou « N étape(s) à compléter » qui suspend l'enregistrement).
 * Sans cela, le ménage du banc supprime la règle pendant qu'un enregistrement
 * automatique part encore, et le serveur répond 500 sur une règle disparue.
 */
export async function finStable(page: Page): Promise<void> {
  await expect(page.getByText(/^(Enregistré|Saved|\d+ étape\(s\) à compléter|\d+ step\(s\) to complete)$/)).toBeVisible({ timeout: 150_000 });
}

/**
 * Fin d'un test qui laisse VOLONTAIREMENT le parcours refusé par le serveur
 * (l'enregistrement automatique réessaie alors sans fin) : on quitte la page,
 * en acceptant l'alerte « modifications non enregistrées » du navigateur, pour
 * qu'aucune reprise ne parte pendant le ménage du banc.
 */
export async function quitterSansEnregistrer(page: Page): Promise<void> {
  page.once('dialog', (d) => { void d.accept(); });
  await page.goto('about:blank');
}

/** La carte d'une étape sur le canevas, par son titre. */
export function carte(page: Page, titre: string): Locator {
  return page.getByRole('button', { name: new RegExp(`^${echapper(titre)}`) }).and(page.locator('button.w-full.rounded-xl'));
}

/** Le texte de l'option sélectionnée d'un menu. */
export async function optionChoisie(select: Locator): Promise<string> {
  return (await select.locator('option:checked').innerText()).trim();
}
