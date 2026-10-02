/**
 * Données du lot « declencheurs » — préparées UNE fois par worker, dans les
 * bureaux de test du jeu (jamais ailleurs), et retrouvées telles quelles aux
 * lancements suivants (idempotent).
 *
 * Bureau A (sans drapeau, comme une entreprise ordinaire) :
 *  · un champ personnalisé de CHAQUE type sur la fiche client (libellés « QA … »),
 *    avec accents, émojis et caractères spéciaux dans les options ;
 *  · des champs sur le pipeline (date, nombre), la facture et le job ;
 *  · un client porteur d'étiquettes (suggestions du champ « étiquette ») ;
 *  · deux services au catalogue ;
 *  · le pipeline et ses étapes (créés par l'app à la première visite).
 *
 * Bureau B : les 4 drapeaux en rodage ACTIFS (`org_features`), pour éprouver
 * les 3 déclencheurs sous drapeau et la case « Arrêter si… » sans jamais
 * basculer un drapeau en cours de test (le serveur garde les drapeaux 30 s).
 *
 * Les champs sont créés par l'API de l'app (POST /api/custom-fields) avec le
 * jeton du propriétaire : c'est le chemin réel, pas une écriture en base.
 */
import type { Page } from '@playwright/test';
import { appelApi, attendre, sessionDe, expect, type Bureau, type Compte } from '../_outils/banc';

export const BASE = process.env.E2E_BASE || 'http://127.0.0.1:5191';

export interface ChampQa {
  id: string; key: string; label: string; field_type: string; object_type: string;
  options: Array<{ id: string; label: string }>;
  /** Options archivées (retirées de la liste par l'entreprise). */
  optionsArchivees: Array<{ id: string; label: string }>;
  /** Ce qui ORDONNE les champs à l'écran : `position`, puis date de création (`listerChamps`, côté serveur). */
  position: number;
  created_at: string;
}

export interface Donnees {
  /** Par clé (`qa_nombre`…). */
  champs: Record<string, ChampQa>;
  /** Tous les champs actifs du bureau A, dans l'ordre d'affichage (position, puis création). */
  liste: ChampQa[];
  pipeline: { id: string; name: string };
  /** Étapes NON archivées du pipeline, dans l'ordre. */
  etapes: Array<{ id: string; name_fr: string; name_en: string }>;
  etiquettes: string[];
  services: Array<{ id: string; name: string }>;
  membres: Array<{ user_id: string; full_name: string }>;
}

export const DRAPEAUX_B = ['auto_sortie_parcours', 'auto_consultation_documents', 'auto_paiement_echoue', 'auto_client_inactif'] as const;

/** Options volontairement pénibles : accent, émoji, guillemets, chevrons, esperluette. */
export const OPTIONS_LISTE = ['Été 🌞', 'Hiver', 'C’est « spécial » & <b>gras</b>'];
export const OPTIONS_MULTI = ['Vitres', 'Gouttières', 'Façade'];
export const ETIQUETTES = ['VIP', 'Ne pas relancer', 'Été 🌞 2026'];
export const SERVICES = ['QA Lavage de vitres', 'QA Gouttières & toiture'];

const CHAMPS_A: Array<{ object_type: string; key: string; label: string; field_type: string; config?: Record<string, unknown>; options?: Array<{ label: string }> }> = [
  { object_type: 'client', key: 'qa_texte', label: 'QA Texte', field_type: 'single_line' },
  { object_type: 'client', key: 'qa_paragraphe', label: 'QA Paragraphe', field_type: 'multi_line' },
  { object_type: 'client', key: 'qa_telephone', label: 'QA Téléphone', field_type: 'phone' },
  { object_type: 'client', key: 'qa_courriel', label: 'QA Courriel', field_type: 'email' },
  { object_type: 'client', key: 'qa_url', label: 'QA Site web', field_type: 'url' },
  { object_type: 'client', key: 'qa_nombre', label: 'QA Nombre', field_type: 'number', config: { decimals: 2 } },
  { object_type: 'client', key: 'qa_montant', label: 'QA Montant', field_type: 'monetary' },
  { object_type: 'client', key: 'qa_liste', label: 'QA Liste', field_type: 'dropdown_single', options: OPTIONS_LISTE.map((label) => ({ label })) },
  { object_type: 'client', key: 'qa_multi', label: 'QA Choix multiples', field_type: 'dropdown_multi', options: OPTIONS_MULTI.map((label) => ({ label })) },
  { object_type: 'client', key: 'qa_date', label: 'QA Date', field_type: 'date' },
  { object_type: 'client', key: 'qa_date_heure', label: 'QA Date et heure', field_type: 'date', config: { include_time: true } },
  { object_type: 'client', key: 'qa_case', label: 'QA Case', field_type: 'checkbox' },
  { object_type: 'client', key: 'qa_fichier', label: 'QA Fichier', field_type: 'file' },
  // Une liste dont une option a été ARCHIVÉE (« Retirée ») : elle ne doit plus être proposée.
  { object_type: 'client', key: 'qa_liste_archive', label: 'QA Liste à option retirée', field_type: 'dropdown_single', options: [{ label: 'Active' }, { label: 'Retirée' }] },
  { object_type: 'deal', key: 'qa_deal_date', label: 'QA Date de relance', field_type: 'date' },
  { object_type: 'deal', key: 'qa_deal_nombre', label: 'QA Nombre de fenêtres', field_type: 'number' },
  { object_type: 'invoice', key: 'qa_fact_texte', label: 'QA Bon de commande', field_type: 'single_line' },
];

let memo: Promise<Donnees> | null = null;

/** Les données du lot ; préparées au premier appel du worker. */
export function donnees(bureau: Bureau): Promise<Donnees> {
  memo ??= preparer(bureau);
  return memo;
}

async function lireChamps(bureau: Bureau, org: string): Promise<ChampQa[]> {
  const { data, error } = await bureau.admin.from('custom_fields')
    .select('id, key, label, field_type, object_type, archived_at, position, created_at').eq('org_id', org).is('archived_at', null)
    .order('position').order('created_at');
  if (error) throw new Error(`champs : ${error.message}`);
  const ids = (data ?? []).map((c) => c.id as string);
  const { data: opts, error: eo } = await bureau.admin.from('custom_field_options')
    .select('id, field_id, label, position, archived_at').in('field_id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']).order('position');
  if (eo) throw new Error(`options : ${eo.message}`);
  return (data ?? []).map((c) => ({
    id: c.id as string, key: c.key as string, label: c.label as string, field_type: c.field_type as string, object_type: c.object_type as string,
    options: (opts ?? []).filter((o) => o.field_id === c.id && !o.archived_at).map((o) => ({ id: o.id as string, label: o.label as string })),
    optionsArchivees: (opts ?? []).filter((o) => o.field_id === c.id && o.archived_at).map((o) => ({ id: o.id as string, label: o.label as string })),
    position: Number(c.position ?? 0), created_at: String(c.created_at ?? ''),
  }));
}

// ── Ce que le bureau contient MAINTENANT ──────────────────────────────────
//
// Un bureau de test sert à plusieurs lots (le lot « actions » y crée ses propres champs, étiquettes et
// services). Une attente écrite « les 3 dates de CE lot, et rien d'autre » casse dès qu'un autre lot est
// passé avant. Les listes de l'écran se comparent donc à ce que la BASE porte pour ce bureau au moment du
// test — tout ce qui s'y trouve, rien qui n'y soit pas —, et on vérifie à part que les données de ce lot
// en font partie.

/** Les champs actifs d'un bureau, relus en base à l'instant (jamais la copie gardée par `donnees()`). */
export function champsDuBureau(bureau: Bureau, org: string): Promise<ChampQa[]> {
  return lireChamps(bureau, org);
}

const microsecondes = (iso: string): number => {
  const fraction = (iso.match(/\.(\d+)/)?.[1] ?? '').padEnd(6, '0').slice(0, 6);
  return Math.floor(Date.parse(iso) / 1000) * 1_000_000 + Number(fraction);
};

/**
 * `vus` (libellés, dans l'ordre de l'écran) est-il EXACTEMENT la liste `champs`, dans l'ordre du bureau ?
 * Rend `null` si oui, sinon la phrase qui dit l'écart.
 *
 * L'ordre du bureau = `position`, puis date de création (la règle de `listerChamps`). Deux champs à
 * égalité sur les DEUX n'ont PAS d'ordre défini entre eux — c'est le cas des champs « métier » d'un bureau,
 * nés dans la même transaction avec une position PAR DOSSIER (« Référé par », « Code d'accès » et « Courriel
 * de facturation » sont tous trois en position 0, à la même microseconde) : la base les rend dans l'ordre
 * qu'elle veut, et pas forcément le même d'une requête à l'autre. On exige donc : ces champs-là, tous,
 * aucun autre, et jamais un champ affiché avant un autre que la règle place devant lui.
 */
export function ecartAvecLOrdreDuBureau(vus: string[], champs: ChampQa[]): string | null {
  const parLibelle = new Map(champs.map((c) => [c.label, c]));
  if (parLibelle.size !== champs.length) return `deux champs du bureau portent le même libellé : ${champs.map((c) => c.label).join(' | ')}`;
  const enTrop = vus.filter((l) => !parLibelle.has(l));
  const manquants = champs.map((c) => c.label).filter((l) => !vus.includes(l));
  if (enTrop.length || manquants.length || vus.length !== champs.length) {
    return `affichés mais absents du bureau : [${enTrop.join(' | ')}] ; dans le bureau mais pas affichés : [${manquants.join(' | ')}] ; ${vus.length} affichés pour ${champs.length} attendus`;
  }
  for (let i = 1; i < vus.length; i++) {
    const a = parLibelle.get(vus[i - 1]) as ChampQa;
    const b = parLibelle.get(vus[i]) as ChampQa;
    const apres = a.position > b.position || (a.position === b.position && microsecondes(a.created_at) > microsecondes(b.created_at));
    if (apres) return `« ${a.label} » (position ${a.position}) est affiché avant « ${b.label} » (position ${b.position}), que l’ordre du bureau place devant`;
  }
  return null;
}

/**
 * Les étiquettes posées sur les clients d'un bureau, comme l'éditeur les propose : sans doublon, triées
 * (`chargerEtiquettes` lit `client_tags`, que la RLS borne aux clients des bureaux du compte).
 */
export async function etiquettesDuBureau(bureau: Bureau, org: string): Promise<string[]> {
  const { data, error } = await bureau.admin.from('client_tags').select('tag, clients!inner(org_id)').eq('clients.org_id', org).limit(5000);
  if (error) throw new Error(`étiquettes du bureau : ${error.message}`);
  return [...new Set((data ?? []).map((t) => String(t.tag)).filter(Boolean))].sort();
}

/**
 * Tous les NOMS que le bureau a lui-même écrits et que l'éditeur réaffiche tels quels (champs, options,
 * services, pipelines, étapes, étiquettes) — les plus longs d'abord. Sert à séparer, dans un écran, le
 * texte FIXE de l'interface (à juger) des données du bureau (écrites dans la langue de l'entreprise).
 */
export async function nomsDesDonneesDuBureau(bureau: Bureau, org: string): Promise<string[]> {
  const { admin } = bureau;
  const lire = async (quoi: string, q: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<Array<Record<string, unknown>>> => {
    const { data, error } = await q;
    if (error) throw new Error(`${quoi} : ${error.message}`);
    return (data ?? []) as Array<Record<string, unknown>>;
  };
  const champs = await lire('champs', admin.from('custom_fields').select('id, label').eq('org_id', org));
  const ids = champs.map((c) => String(c.id));
  const options = ids.length ? await lire('options', admin.from('custom_field_options').select('label').in('field_id', ids)) : [];
  const services = await lire('services', admin.from('predefined_services').select('name').eq('org_id', org));
  const pipelines = await lire('pipelines', admin.from('pipelines_ventes').select('id, name').eq('org_id', org));
  const idsPipelines = pipelines.map((p) => String(p.id));
  const etapes = idsPipelines.length ? await lire('étapes', admin.from('pipeline_stages').select('name_fr, name_en').in('pipeline_id', idsPipelines)) : [];
  const noms = [
    ...champs.map((c) => c.label), ...options.map((o) => o.label), ...services.map((s) => s.name),
    ...pipelines.map((p) => p.name), ...etapes.flatMap((e) => [e.name_fr, e.name_en]),
    ...(await etiquettesDuBureau(bureau, org)),
  ].map((n) => String(n ?? '').trim()).filter(Boolean);
  return [...new Set(noms)].sort((a, b) => b.length - a.length);
}

/** `texte` sans les noms des données du bureau (voir `nomsDesDonneesDuBureau`) : il ne reste que le texte fixe. */
export function sansLesDonnees(texte: string, noms: string[]): string {
  let t = texte;
  for (const n of noms) t = t.split(n).join('');
  return t;
}

async function preparer(bureau: Bureau): Promise<Donnees> {
  const { admin, orgA, orgB } = bureau;
  const jeton = (await sessionDe(bureau, 'proprioA')).access_token;

  // ── Champs personnalisés (API réelle) ──
  let existants = await lireChamps(bureau, orgA);
  for (const c of CHAMPS_A) {
    if (existants.some((x) => x.key === c.key && x.object_type === c.object_type)) continue;
    const r = await appelApi(BASE, jeton, orgA, 'POST', '/api/custom-fields', c);
    if (r.status !== 201) throw new Error(`création du champ ${c.key} : ${r.status} ${JSON.stringify(r.json).slice(0, 300)}`);
  }
  existants = await lireChamps(bureau, orgA);
  // L'option « Retirée » est archivée (comme le ferait l'entreprise dans Paramètres → Champs personnalisés).
  const aArchiver = existants.find((x) => x.key === 'qa_liste_archive')?.options.find((o) => o.label === 'Retirée');
  if (aArchiver) {
    const { error } = await admin.from('custom_field_options').update({ archived_at: new Date().toISOString() }).eq('id', aArchiver.id);
    if (error) throw new Error(`archivage de l'option : ${error.message}`);
    existants = await lireChamps(bureau, orgA);
  }
  const champs: Record<string, ChampQa> = {};
  for (const c of existants) champs[c.key] = c;
  for (const c of CHAMPS_A) if (!champs[c.key]) throw new Error(`champ ${c.key} absent après création`);

  // ── Un client porteur d'étiquettes ──
  const { data: client0 } = await admin.from('clients').select('id').eq('org_id', orgA).eq('email', 'qa-etiquettes@lume-qa.test').is('deleted_at', null).maybeSingle();
  let clientId = client0?.id as string | undefined;
  if (!clientId) {
    const { data, error } = await admin.from('clients').insert({
      org_id: orgA, first_name: 'QA', last_name: 'Étiquettes', email: 'qa-etiquettes@lume-qa.test', phone: '+15555550142', status: 'active',
      created_by: bureau.comptes.proprioA.id,
    }).select('id').single();
    if (error) throw new Error(`client d'étiquettes : ${error.message}`);
    clientId = data.id as string;
  }
  const { data: tags } = await admin.from('client_tags').select('tag').eq('client_id', clientId);
  const poses = new Set((tags ?? []).map((t) => t.tag as string));
  for (const tag of ETIQUETTES) {
    if (poses.has(tag)) continue;
    const { error } = await admin.from('client_tags').insert({ client_id: clientId, tag });
    if (error) throw new Error(`étiquette ${tag} : ${error.message}`);
  }

  // ── Deux services au catalogue ──
  const { data: s0 } = await admin.from('predefined_services').select('id, name').eq('org_id', orgA).in('name', SERVICES);
  for (const name of SERVICES) {
    if ((s0 ?? []).some((s) => s.name === name)) continue;
    const { error } = await admin.from('predefined_services').insert({ org_id: orgA, name, default_price_cents: 15000, is_active: true });
    if (error) throw new Error(`service ${name} : ${error.message}`);
  }
  const { data: services } = await admin.from('predefined_services').select('id, name').eq('org_id', orgA).in('name', SERVICES).order('name');

  // ── Pipeline et étapes (créés par l'app) ──
  const { data: pipelines, error: ep } = await admin.from('pipelines_ventes').select('id, name').eq('org_id', orgA).is('archived_at', null).order('position').limit(1);
  if (ep || !pipelines?.length) throw new Error(`pipeline du bureau A introuvable (${ep?.message ?? 'aucun'}) — ouvrir une fois /pipeline avec le compte du bureau.`);
  const { data: etapes, error: ee } = await admin.from('pipeline_stages').select('id, name_fr, name_en, position, archived_at')
    .eq('pipeline_id', pipelines[0].id).is('archived_at', null).order('position');
  if (ee || !etapes?.length) throw new Error(`étapes du pipeline : ${ee?.message ?? 'aucune'}`);

  const { data: membres } = await admin.from('memberships').select('user_id, full_name').eq('org_id', orgA).eq('status', 'active');

  // ── Bureau B : les drapeaux en rodage, actifs ──
  const { data: f0 } = await admin.from('org_features').select('feature, enabled').eq('org_id', orgB).in('feature', [...DRAPEAUX_B]);
  for (const feature of DRAPEAUX_B) {
    const ligne = (f0 ?? []).find((f) => f.feature === feature);
    if (ligne?.enabled) continue;
    const { error } = ligne
      ? await admin.from('org_features').update({ enabled: true }).eq('org_id', orgB).eq('feature', feature)
      : await admin.from('org_features').insert({ org_id: orgB, feature, enabled: true, metadata: { qa: 'lot declencheurs' } });
    if (error) throw new Error(`drapeau ${feature} : ${error.message}`);
  }
  // Le serveur garde les drapeaux 30 s : on attend qu'il OFFRE les 3 déclencheurs au bureau B.
  const jetonB = (await sessionDe(bureau, 'proprioB')).access_token;
  await attendre(
    async () => {
      const r = await appelApi(BASE, jetonB, orgB, 'GET', '/api/automations/editeur');
      const cat = (r.json as { catalogue?: { declencheurs?: Array<{ cle: string }> } })?.catalogue?.declencheurs ?? [];
      return cat.map((d) => d.cle);
    },
    (cles) => ['payment.failed', 'invoice.viewed', 'client.inactive'].every((c) => cles.includes(c)),
    60_000, 1500,
  );

  return {
    champs,
    liste: existants,
    pipeline: { id: pipelines[0].id as string, name: pipelines[0].name as string },
    etapes: etapes.map((e) => ({ id: e.id as string, name_fr: e.name_fr as string, name_en: e.name_en as string })),
    etiquettes: ETIQUETTES,
    services: (services ?? []).map((s) => ({ id: s.id as string, name: s.name as string })),
    membres: (membres ?? []).map((m) => ({ user_id: m.user_id as string, full_name: m.full_name as string })),
  };
}

// ── Gestes communs de l'éditeur ───────────────────────────────────────────

/** Ouvre l'éditeur d'une règle et attend le canevas. */
export async function ouvrirEditeur(page: Page, id: string): Promise<void> {
  await page.goto(`/automations/${id}`);
  await expect(page.getByRole('tab', { name: /^(Parcours|Builder)$/ })).toBeVisible({ timeout: 90_000 });
  await expect(carteDeclencheur(page)).toBeVisible({ timeout: 30_000 });
}

/**
 * Le point d'entrée du déclencheur sur le canevas : la carte « Quand » d'un
 * parcours garni, ou « Choisir le déclencheur » d'un canevas vide.
 */
export function carteDeclencheur(page: Page) {
  return page.getByRole('button', { name: /^(Quand|When|Choisir le déclencheur|Pick the trigger)/ }).first();
}

export const tiroirDeclencheurs = (page: Page) => page.getByRole('complementary', { name: /^(Déclencheurs|Triggers)$/ });
export const panneauDeclencheur = (page: Page) => page.getByRole('complementary', { name: /^(Réglages du déclencheur|Trigger settings)$/ });

/** Ouvre le tiroir des déclencheurs, d'où qu'on parte (canevas vide ou garni, panneau ouvert ou non). */
export async function ouvrirTiroirDeclencheurs(page: Page): Promise<void> {
  if (await tiroirDeclencheurs(page).isVisible()) return;
  if (!(await panneauDeclencheur(page).isVisible())) {
    await carteDeclencheur(page).click();
    await expect(tiroirDeclencheurs(page).or(panneauDeclencheur(page))).toBeVisible();
  }
  if (await panneauDeclencheur(page).isVisible()) {
    await panneauDeclencheur(page).getByRole('button', { name: /^(Changer de déclencheur…|Change trigger…)$/ }).click();
  }
  await expect(tiroirDeclencheurs(page)).toBeVisible();
}

/** Clique un déclencheur du tiroir par son titre exact (le nom accessible du bouton = titre + aide). */
export async function choisirDeclencheur(page: Page, titre: string, aide: string): Promise<void> {
  await ouvrirTiroirDeclencheurs(page);
  await tiroirDeclencheurs(page).getByRole('button', { name: `${titre} ${aide}`, exact: true }).click();
  await expect(tiroirDeclencheurs(page)).toBeHidden();
}

/** Compte utilisé → jeton, pour un appel d'API direct depuis un hook. */
export async function jetonDuCompte(bureau: Bureau, compte: Compte): Promise<string> {
  return (await sessionDe(bureau, compte)).access_token;
}

// ── Aides partagées par les specs du lot ──────────────────────────────────

/** Une étape valable après n'importe quel déclencheur (travail interne, aucun envoi). */
export const ETAPE_NOTIF = [{ id: 'e1', type: 'action', action: { type: 'create_notification', config: { title: 'Suivi QA' } }, suivant: null }];

const URL_REGLE = /\/api\/automations\/rules\/[0-9a-f-]{36}$/;

/** La prochaine écriture (PATCH) de la règle ouverte. À créer AVANT le geste qui la provoque. */
export function ecritureRegle(page: Page) {
  return page.waitForResponse((s) => s.request().method() === 'PATCH' && URL_REGLE.test(s.url()), { timeout: 60_000 });
}

/** Compte les écritures (hors lecture) envoyées sur les règles pendant le test. */
export function compterEcritures(page: Page): { liste: string[] } {
  const c = { liste: [] as string[] };
  page.on('request', (q) => { if (q.method() !== 'GET' && /\/api\/automations\/rules/.test(q.url())) c.liste.push(`${q.method()} ${q.postData() ?? ''}`); });
  return c;
}

/** Ouvre le panneau de réglage du déclencheur par la carte « Quand ». */
export async function ouvrirPanneauDeclencheur(page: Page) {
  const panneau = panneauDeclencheur(page);
  if (!(await panneau.isVisible())) await carteDeclencheur(page).click();
  await expect(panneau).toBeVisible();
  return panneau;
}

/** « Enregistrer » du panneau du déclencheur : attend l'écriture, le toast et la fermeture. */
export async function enregistrerPanneauDeclencheur(page: Page): Promise<void> {
  const panneau = panneauDeclencheur(page);
  const ecriture = ecritureRegle(page);
  await panneau.getByRole('button', { name: /^(Enregistrer|Save)$/ }).click();
  expect((await ecriture).status(), 'le serveur accepte les réglages').toBe(200);
  await expect(page.getByText(/^(Réglages enregistrés|Settings saved)$/).first()).toBeVisible();
  await expect(panneau).toBeHidden();
}

/** Le contrôle d'un champ par le DÉBUT de son étiquette (suivie de « * » ou de « (facultatif) »). */
export function champParLibelle(conteneur: import('@playwright/test').Locator, libelle: string) {
  const motif = new RegExp(`^${libelle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( \\*| \\((facultatif|optional)\\))$`);
  return conteneur.getByLabel(motif);
}

/** Ce que le contrôle MONTRE : le texte de l'option choisie d'un menu, la valeur d'un champ. */
export async function valeurAffichee(c: import('@playwright/test').Locator): Promise<string> {
  return c.evaluate((el) => (el instanceof HTMLSelectElement ? (el.selectedOptions[0]?.textContent ?? '') : (el as HTMLInputElement).value));
}

/** Les textes des options d'un menu, dans l'ordre. */
export async function optionsDe(c: import('@playwright/test').Locator): Promise<string[]> {
  return c.locator('option').evaluateAll((els) => els.map((e) => e.textContent ?? ''));
}
