/**
 * Bureaux de test SUPPLÉMENTAIRES, en PRODUCTION, pour l'évaluation de Lumi.
 * ─────────────────────────────────────────────────────────────────────────
 * Pourquoi : la garde quotidienne de dépense IA (15 % du plafond mensuel en un
 * jour) fait passer un bureau en palier « restreint » jusqu'à minuit. Une passe
 * de 220 demandes y consomme presque tout : une seule passe propre par bureau
 * et par jour. D'où des doublures du banc « ZZ QA Champs », vierges de dépense.
 *
 * Ce script crée (ou retrouve) chaque bureau et le met dans l'état où le seed
 * (seed-bureau-test.mts --org … --prefixe …) peut y écrire le jeu [EVAL] :
 *   comptes (4 propriétaires + 1 technicien, @lume-qa.test, sans courriel de
 *   confirmation), entreprise, bac à sable des envois, numéro texto fictif,
 *   réglages, catalogue de services, taxes du Québec et préréglages
 *   d'automatisation (les fonctions mêmes de l'app, pour retrouver l'état du
 *   banc d'origine), abonnement Autopilot à 0 $ sans aucun identifiant Stripe.
 *
 * PAR DÉFAUT IL N'ÉCRIT RIEN : il lit et dit ce qu'il ferait.
 *
 *   node --env-file=C:/Users/Rafba/lumeeeeeeeeee/.env.local --import tsx scripts/qa/lumi/bureaux-eval.mts              simulation
 *   … bureaux-eval.mts --appliquer                       crée ce qui manque dans les deux bureaux
 *   … bureaux-eval.mts --appliquer --seulement eval2     un seul bureau
 *
 * ORDRE DE SÛRETÉ (ne pas le changer) :
 *  1. le compte du premier propriétaire (l'entreprise a besoin d'un créateur) ;
 *  2. la ligne `orgs` ;
 *  3. TOUT DE SUITE son inscription au bac à sable (`orgs_envois_simules`, mode
 *     « succes »), relue pour preuve. Si elle échoue : ARRÊT, rien d'autre n'est créé ;
 *  4. une attente de 35 s quand l'inscription est neuve : le serveur de prod garde
 *     la liste du bac à sable 30 s en cache ;
 *  5. seulement alors : le numéro fictif (AVANT l'abonnement, pour qu'aucun achat de
 *     numéro ne puisse être tenté), les adhésions, les réglages, l'abonnement.
 *
 * Garde-fous : production seulement (c'est son objet) ; un compte retrouvé qui a
 * une adhésion dans un autre bureau fait tout arrêter ; aucune écriture hors des
 * deux bureaux (et de `auth.users` pour leurs comptes) ; aucune suppression ;
 * rien sur Stripe ; la table `plans` n'est que lue.
 * Idempotent : relancé, il retrouve l'entreprise par son nom et les comptes par
 * leur adresse, et ne refait que ce qui manque.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';
import { DOMAINE_COURRIEL, FUSEAU } from './jeu-eval.mts';
import { seedTaxPreset } from '../../../server/lib/seedOrgDefaults.ts';
import { seedOrgFromIndustry } from '../../../server/lib/industryPresets.ts';
import { PRESETS_ATTENDENT_AVIS, ensureAutomationPresets } from '../../../server/lib/automationPresetSeeder.ts';

export interface BureauEval { prefixe: string; nom: string; entreprise: string }
export const BUREAUX_EVAL: BureauEval[] = [
  { prefixe: 'eval2', nom: '[TEST] QA Lumi éval 2 — ne pas utiliser', entreprise: 'Lavage Rive-Sud (éval 2)' },
  { prefixe: 'eval3', nom: '[TEST] QA Lumi éval 3 — ne pas utiliser', entreprise: 'Lavage Rive-Sud (éval 3)' },
];
const NB_PROPRIETAIRES = 4;
export interface CompteEval { cle: string; courriel: string; nom: string; role: 'owner' | 'technician' }
export function comptesDe(b: BureauEval): CompteEval[] {
  return [
    ...Array.from({ length: NB_PROPRIETAIRES }, (_, i): CompteEval => ({ cle: `proprio${i + 1}`, courriel: `${b.prefixe}.proprio${i + 1}@${DOMAINE_COURRIEL}`, nom: `[EVAL] Propriétaire ${i + 1}`, role: 'owner' })),
    { cle: 'tech', courriel: `${b.prefixe}.tech@${DOMAINE_COURRIEL}`, nom: '[EVAL] Technicien', role: 'technician' },
  ];
}

/** Règles du pack de base que les cas d'évaluation nomment et supposent ACTIVES (comme dans le banc d'origine). */
const REGLES_SUPPOSEES_ACTIVES = ['thank_you_after_job', 'post_appointment_survey', 'cross_sell_30d', 'job_reminder_1d'];
/** Numéros texto fictifs (555-01xx) essayés dans cet ordre ; le premier que personne n'a en base est pris. */
const NUMEROS_CANDIDATS = [...Array.from({ length: 10 }, (_, i) => 190 + i), ...Array.from({ length: 88 }, (_, i) => 102 + i)].map((n) => `+15555550${n}`);
const RAISON_BAC = 'Bureau de test — évaluation de Lumi (scripts/qa/lumi/bureaux-eval.mts). À garder tant que le bureau existe.';
const ATTENTE_CACHE_MS = 35_000;

const APPLIQUER = process.argv.includes('--appliquer');
const SEULEMENT = (() => { const i = process.argv.indexOf('--seulement'); return i > -1 ? process.argv[i + 1] ?? '' : ''; })();

const REF = process.env.SUPABASE_PROJECT_REF_PROD ?? '';
const URL_PROD = process.env.SUPABASE_URL_PROD ?? '';
const CLE = process.env.SUPABASE_SERVICE_ROLE_KEY_PROD ?? '';
if (!REF || !URL_PROD || !CLE) throw new Error('SUPABASE_PROJECT_REF_PROD, SUPABASE_URL_PROD et SUPABASE_SERVICE_ROLE_KEY_PROD requis (--env-file=…/.env.local).');
if (!URL_PROD.includes(REF)) throw new Error('SUPABASE_URL_PROD ne correspond pas à SUPABASE_PROJECT_REF_PROD — refus.');
const admin: SupabaseClient = createClient(URL_PROD, CLE, { auth: { persistSession: false, autoRefreshToken: false } });

type Erreur = { message: string } | null;
async function lire<T>(p: PromiseLike<{ data: unknown; error: Erreur }>, quoi: string): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(`${quoi} : ${error.message}`);
  return data as T;
}
async function ecrire(p: PromiseLike<{ error: Erreur }>, quoi: string): Promise<void> {
  if (!APPLIQUER) throw new Error(`écriture hors --appliquer (${quoi}) — bogue du script, rien n'a été écrit.`);
  const { error } = await p;
  if (error) throw new Error(`${quoi} : ${error.message}`);
}
const dire = (signe: '+' | '=' | '~' | '!', texte: string): void => console.log(`  ${signe} ${texte}`);

/** Crée le compte (aucun courriel envoyé) ou le retrouve ; refuse un compte qui appartient à un autre bureau. */
async function assurerCompte(c: CompteEval, orgId: string | null): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email: c.courriel, password: randomBytes(24).toString('base64url'), email_confirm: true, user_metadata: { full_name: c.nom },
  });
  let userId = data?.user?.id ?? null;
  if (userId) dire('+', `compte ${c.courriel} : créé`);
  else {
    // Déjà là (script relancé) : generateLink le retrouve sans rien envoyer.
    const lien = await admin.auth.admin.generateLink({ type: 'magiclink', email: c.courriel });
    userId = lien.data?.user?.id ?? null;
    if (!userId) throw new Error(`compte ${c.courriel} : ${error?.message ?? '?'} / ${lien.error?.message ?? '?'}`);
    dire('=', `compte ${c.courriel} : déjà là`);
  }
  const adhesions = await lire<Array<{ org_id: string }>>(admin.from('memberships').select('org_id').eq('user_id', userId), `adhésions de ${c.courriel}`);
  const ailleurs = adhesions.filter((a) => a.org_id !== orgId);
  if (ailleurs.length) throw new Error(`ARRÊT : ${c.courriel} a déjà une adhésion dans un autre bureau (${ailleurs.map((a) => a.org_id).join(', ')}). Les comptes d'évaluation doivent être neufs.`);
  return userId;
}

async function numeroLibre(): Promise<string> {
  const pris = new Set((await lire<Array<{ phone_number: string | null }>>(admin.from('communication_channels').select('phone_number').limit(5000), 'numéros déjà pris')).map((c) => c.phone_number));
  const libre = NUMEROS_CANDIDATS.find((n) => !pris.has(n));
  if (!libre) throw new Error('Plus aucun numéro fictif 555-01xx libre.');
  return libre;
}

interface Bilan { prefixe: string; nom: string; org: string | null; comptes: Record<string, string>; numero: string | null; bacASable: string | null }

async function assurerBureau(b: BureauEval): Promise<Bilan> {
  console.log(`\n${b.nom}`);
  const comptes = comptesDe(b);
  const bilan: Bilan = { prefixe: b.prefixe, nom: b.nom, org: null, comptes: {}, numero: null, bacASable: null };

  const existantes = await lire<Array<{ id: string; created_by: string | null; automations_initialisees_le: string | null }>>(
    admin.from('orgs').select('id, created_by, automations_initialisees_le').eq('name', b.nom).is('deleted_at', null), 'entreprise');
  if (existantes.length > 1) throw new Error(`ARRÊT : ${existantes.length} entreprises portent le nom « ${b.nom} ».`);
  let orgId = existantes[0]?.id ?? null;

  if (!APPLIQUER) {
    if (!orgId) { dire('+', `entreprise à créer, avec ${comptes.length} comptes : ${comptes.map((c) => c.courriel).join(', ')}`); return bilan; }
    bilan.org = orgId;
    const bac = await lire<{ mode: string } | null>(admin.from('orgs_envois_simules').select('mode').eq('org_id', orgId).maybeSingle(), 'bac à sable');
    bilan.bacASable = bac?.mode ?? null;
    dire(bac ? '=' : '!', `entreprise ${orgId} : ${bac ? `au bac à sable (${bac.mode})` : 'PAS au bac à sable — --appliquer l’y inscrit avant toute autre écriture'}`);
    const membres = await lire<Array<{ user_id: string; role: string; full_name: string | null }>>(admin.from('memberships').select('user_id, role, full_name').eq('org_id', orgId), 'adhésions');
    for (const c of comptes) dire(membres.some((m) => m.full_name === c.nom && m.role === c.role) ? '=' : '+', `${c.courriel} (${c.role})`);
    const canal = await lire<{ phone_number: string | null } | null>(admin.from('communication_channels').select('phone_number').eq('org_id', orgId).eq('channel_type', 'sms').maybeSingle(), 'numéro');
    bilan.numero = canal?.phone_number ?? null;
    return bilan;
  }

  // 1. Le créateur de l'entreprise. Un créateur NEUF par bureau : le déclencheur assign_org_company_group
  //    range dans le même groupe deux entreprises du même créateur, et leurs propriétaires se propagent.
  const premier = comptes[0];
  bilan.comptes[premier.courriel] = await assurerCompte(premier, orgId);

  // 2. L'entreprise.
  if (!orgId) {
    const cree = await lire<{ id: string }>(admin.from('orgs').insert({ name: b.nom, created_by: bilan.comptes[premier.courriel], employee_count: '1-5' }).select('id').single(), `entreprise ${b.nom}`);
    orgId = cree.id;
    dire('+', `entreprise créée : ${orgId}`);
  } else dire('=', `entreprise déjà là : ${orgId}`);
  bilan.org = orgId;

  // 3. AVANT tout le reste : l'entreprise n'envoie plus rien.
  let bac = await lire<{ mode: string } | null>(admin.from('orgs_envois_simules').select('mode').eq('org_id', orgId).maybeSingle(), 'bac à sable');
  const inscriptionNeuve = !bac;
  if (!bac) {
    const { error } = await admin.from('orgs_envois_simules').insert({ org_id: orgId, mode: 'succes', raison: RAISON_BAC });
    if (error) throw new Error(`ARRÊT : inscription au bac à sable impossible pour ${orgId} (${error.message}). Rien d'autre n'a été créé dans cette entreprise.`);
    bac = await lire<{ mode: string } | null>(admin.from('orgs_envois_simules').select('mode').eq('org_id', orgId).maybeSingle(), 'bac à sable (relecture)');
  }
  if (!bac) throw new Error(`ARRÊT : ${orgId} n'est pas au bac à sable après inscription. Rien d'autre n'a été créé dans cette entreprise.`);
  if (bac.mode !== 'succes') throw new Error(`ARRÊT : ${orgId} est au bac à sable en mode « ${bac.mode} », « succes » attendu — à regarder à la main.`);
  bilan.bacASable = bac.mode;
  dire(inscriptionNeuve ? '+' : '=', `bac à sable des envois : ${bac.mode}`);
  if (inscriptionNeuve) {
    console.log(`    attente de ${ATTENTE_CACHE_MS / 1000} s (le serveur de prod garde la liste du bac à sable 30 s en cache)`);
    await new Promise((ok) => setTimeout(ok, ATTENTE_CACHE_MS));
  }

  // 4. Le numéro texto fictif, AVANT l'abonnement.
  const canal = await lire<{ id: string; phone_number: string | null } | null>(
    admin.from('communication_channels').select('id, phone_number').eq('org_id', orgId).eq('channel_type', 'sms').maybeSingle(), 'numéro du bureau');
  if (canal) { bilan.numero = canal.phone_number; dire('=', `numéro texto fictif : ${canal.phone_number}`); } else {
    const numero = await numeroLibre();
    await ecrire(admin.from('communication_channels').insert({
      org_id: orgId, channel_type: 'sms', provider: 'twilio', phone_number: numero, is_default: true, status: 'active',
      metadata: { fictif: true, note: 'Numéro 555-01xx fictif — bac à sable (évaluation de Lumi)' },
    }), 'numéro du bureau');
    bilan.numero = numero;
    dire('+', `numéro texto fictif : ${numero}`);
  }

  // 5. Les comptes et leurs adhésions (le premier propriétaire d'abord : le seed signe ses fiches avec lui).
  for (const c of comptes) {
    const userId = bilan.comptes[c.courriel] ?? await assurerCompte(c, orgId);
    bilan.comptes[c.courriel] = userId;
    const adhesion = await lire<{ role: string; status: string } | null>(admin.from('memberships').select('role, status').eq('org_id', orgId).eq('user_id', userId).maybeSingle(), `adhésion ${c.courriel}`);
    if (adhesion) { dire(adhesion.role === c.role && adhesion.status === 'active' ? '=' : '!', `adhésion ${c.courriel} : ${adhesion.role}, ${adhesion.status}`); continue; }
    // lumi_briefing coupé : pas de briefing du matin (ni conversation ni notification) dans un bureau de mesure.
    await ecrire(admin.from('memberships').insert({ user_id: userId, org_id: orgId, role: c.role, status: 'active', language: 'fr', full_name: c.nom, lumi_briefing: false }), `adhésion ${c.courriel}`);
    dire('+', `adhésion ${c.courriel} : ${c.role}`);
  }

  // 6. Réglages de l'entreprise (fuseau du jeu de données), puis catalogue de services et taxes du
  //    Québec par les fonctions mêmes de l'app — ce que le banc d'origine a reçu à son installation.
  const reglages = await lire<{ id: string } | null>(admin.from('company_settings').select('id').eq('org_id', orgId).maybeSingle(), 'réglages');
  if (reglages) dire('=', 'réglages de l’entreprise'); else {
    await ecrire(admin.from('company_settings').insert({
      org_id: orgId, company_name: b.entreprise, email: `bureau-${b.prefixe}@${DOMAINE_COURRIEL}`, phone: bilan.numero ?? '',
      street1: '123 rue du Test', postal_code: 'J4K 1A1', city: 'Longueuil', province: 'QC', country: 'CA', timezone: FUSEAU, default_language: 'fr',
      industry: 'window_cleaning', currency: 'CAD', setup_completed: true,
    }), 'réglages');
    dire('+', `réglages de l’entreprise (fuseau ${FUSEAU})`);
  }
  const services = await lire<Array<{ id: string }>>(admin.from('predefined_services').select('id').eq('org_id', orgId).limit(1), 'services');
  if (services.length) dire('=', 'catalogue de services'); else {
    await seedOrgFromIndustry(admin, orgId, 'window_cleaning');
    const n = (await lire<Array<{ id: string }>>(admin.from('predefined_services').select('id').eq('org_id', orgId), 'services')).length;
    dire(n ? '+' : '!', `catalogue de services (lavage de vitres) : ${n} services`);
  }
  const taxes = await seedTaxPreset(admin, orgId, 'QC', true);
  dire(taxes.created ? '+' : '=', 'taxes du Québec (TPS + TVQ), groupe par défaut');

  // 7. L'abonnement Autopilot à 0 $ : aucun identifiant Stripe, la table plans n'est que lue.
  const abo = await lire<Array<{ id: string }>>(admin.from('subscriptions').select('id').eq('org_id', orgId).in('status', ['active', 'trialing']).limit(1), 'abonnement');
  if (abo.length) dire('=', 'abonnement actif'); else {
    const plan = await lire<{ id: string }>(admin.from('plans').select('id').eq('slug', 'autopilot').single(), 'forfait autopilot');
    await ecrire(admin.from('subscriptions').insert({
      org_id: orgId, user_id: bilan.comptes[premier.courriel], plan_id: plan.id, status: 'active', interval: 'monthly', currency: 'CAD', amount_cents: 0,
      current_period_end: new Date(Date.now() + 365 * 86_400_000).toISOString(),
    }), 'abonnement');
    dire('+', 'abonnement Autopilot actif, 0 $, sans Stripe');
  }

  // 8. Les automatisations : le déclencheur de création de l'entreprise (seed_automation_presets) a posé
  //    35 préréglages, tous publiés. Le banc d'origine, lui, est une entreprise « installée » :
  //    (a) le filet de l'app (ensureAutomationPresets, SANS activateAll) y a ajouté ce que le déclencheur
  //        ne pose pas — les 4 préréglages « devis → deal » (publiés) et les 5 parcours du pack (en
  //        brouillon) — et corrigé les conditions de « paiement reçu / dépôt reçu » ;
  //    (b) les demandes d'avis sont en brouillon tant que les avis ne sont pas activés avec un lien
  //        (publiées, elles échouent à chaque job terminée) — la règle même de l'app à la création ;
  //    (c) l'entreprise est marquée « installée » : sinon le premier passage d'un compte par l'accueil
  //        de l'app (seedOrgComplete) republierait le pack et mettrait le reste en brouillon, en pleine mesure ;
  //    (d) les règles que les cas nomment doivent être actives, comme dans le banc d'origine, sinon
  //        « mets en pause X » échoue pour une raison de données. Rien ne part : bac à sable.
  const filet = await ensureAutomationPresets(admin, orgId);
  dire(filet.inserted || filet.repaired ? '+' : '=', `préréglages d’automatisation complétés par le filet de l’app : ${filet.inserted} ajoutés, ${filet.repaired} corrigés`);
  const avis = await lire<{ review_enabled: boolean | null } | null>(admin.from('company_settings').select('review_enabled').eq('org_id', orgId).maybeSingle(), 'réglage des avis');
  if (avis?.review_enabled !== true) {
    const eteintes = await lire<Array<{ id: string }>>(
      admin.from('automation_rules').update({ is_active: false }).eq('org_id', orgId).eq('is_active', true).in('preset_key', [...PRESETS_ATTENDENT_AVIS]).select('id'), 'demandes d’avis en brouillon');
    dire(eteintes.length ? '~' : '=', `demandes d’avis en brouillon (avis non activés) : ${eteintes.length} règles éteintes`);
  }
  if (!existantes[0]?.automations_initialisees_le) {
    await ecrire(admin.from('orgs').update({ automations_initialisees_le: new Date().toISOString() }).eq('id', orgId).is('automations_initialisees_le', null), 'entreprise marquée installée');
    dire('~', 'entreprise marquée « installée » (ses automatisations ne seront plus réinitialisées)');
  }
  const regles = await lire<Array<{ id: string; preset_key: string; name: string; is_active: boolean }>>(
    admin.from('automation_rules').select('id, preset_key, name, is_active').eq('org_id', orgId).in('preset_key', REGLES_SUPPOSEES_ACTIVES).is('deleted_at', null), 'règles nommées par les cas');
  for (const cle of REGLES_SUPPOSEES_ACTIVES) {
    const r = regles.find((x) => x.preset_key === cle);
    if (!r) { dire('!', `règle « ${cle} » ABSENTE : le déclencheur de création ne l’a pas posée — les cas qui la nomment échoueront.`); continue; }
    if (r.is_active) { dire('=', `règle « ${r.name} » : active`); continue; }
    await ecrire(admin.from('automation_rules').update({ is_active: true }).eq('id', r.id).eq('org_id', orgId), `règle ${cle}`);
    dire('~', `règle « ${r.name} » : activée (comme dans le banc d’origine)`);
  }
  return bilan;
}

const bureaux = BUREAUX_EVAL.filter((b) => !SEULEMENT || b.prefixe === SEULEMENT);
if (!bureaux.length) throw new Error(`--seulement : ${BUREAUX_EVAL.map((b) => b.prefixe).join(' ou ')} attendu.`);
console.log(`${APPLIQUER ? 'ÉCRITURE' : 'SIMULATION (aucune écriture)'} — production (${REF}).`);
const bilans: Bilan[] = [];
for (const b of bureaux) bilans.push(await assurerBureau(b));

console.log('\nBilan :');
console.log(JSON.stringify(bilans, null, 1));
const ENV = '--env-file=C:/Users/Rafba/lumeeeeeeeeee/.env.local';
for (const b of bilans.filter((x) => x.org)) {
  console.log(`\n# ${b.nom}`);
  console.log(`node ${ENV} --import tsx scripts/qa/lumi/seed-bureau-test.mts --org ${b.org} --prefixe ${b.prefixe} --appliquer`);
  console.log(`npx tsx evals/lumi/preparer.mts --fixture evals/lumi/fixture-${b.prefixe}.json --sortie evals/lumi/cas-resolus-${b.prefixe}`);
  console.log(`npx tsx evals/lumi/repartir.mts --source evals/lumi/cas-resolus-${b.prefixe}/proprietaire --lots ${NB_PROPRIETAIRES}`);
}
if (!APPLIQUER) console.log('\nRien n’a été écrit. Pour écrire : relancer avec --appliquer.');
process.exit(0);
