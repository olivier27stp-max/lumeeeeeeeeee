/**
 * Seed du bureau de test de la PRODUCTION pour l'évaluation de Lumi.
 * ─────────────────────────────────────────────────────────────────────────
 * Écrit dans « ZZ QA Champs (banc de test) » le jeu de données fictif décrit
 * dans jeu-eval.mts (clients, jobs, visites, devis, factures, paiements,
 * équipe, heures, commissions, dépenses), puis relit la base et écrit la fiche
 * des faits `evals/lumi/fixture.json`.
 *
 * Un AUTRE bureau d'évaluation (créé par bureaux-eval.mts) : `--org <id> --prefixe eval2`.
 * Le préfixe donne à ce bureau ses propres comptes (`eval2.prenom.nom@lume-qa.test`),
 * ses propres identifiants de fiches (dérivés de l'org) et sa fiche des faits
 * (`evals/lumi/fixture-eval2.json`). Le banc d'origine n'est pas touché.
 *
 * PAR DÉFAUT IL N'ÉCRIT RIEN : il lit le bureau et dit ce qu'il ferait.
 *
 *   node --env-file=<chemin>/.env.local --import tsx scripts/qa/lumi/seed-bureau-test.mts            simulation (lecture seule)
 *   … seed-bureau-test.mts --appliquer            écrit ce qui manque, replace les visites relatives, écrit la fiche des faits
 *   … seed-bureau-test.mts --fixture-seulement    relit la base et réécrit la fiche des faits (aucune écriture en base)
 *   npx tsx scripts/qa/lumi/seed-bureau-test.mts --hors-ligne    ni base ni réseau : vérifie le jeu, écrit la fiche PRÉVISIONNELLE
 *   [--org <id> --prefixe eval2] [--ancre AAAA-MM-JJ] [--fixture <fichier>]
 *
 * Garde-fous (tous vérifiés AVANT la première lecture de fiche) :
 *  - le nom du bureau doit dire QA, TEST ou « banc » ;
 *  - le bureau doit être inscrit au bac à sable des envois (`orgs_envois_simules`) :
 *    le seed crée des visites et émet des factures, ce qui réveille des automatisations ;
 *  - tout courriel du jeu est en @lume-qa.test, tout numéro en 514 555-01xx.
 *
 * Idempotent : l'identifiant de chaque fiche est dérivé de sa clé (`idEval`). Une
 * fiche présente n'est ni recréée ni modifiée ; une fiche mise à la corbeille
 * (deleted_at) est restaurée. Seules les visites « aujourd'hui / demain / cette
 * semaine » sont replacées sur l'ancre à chaque `--appliquer`.
 * Aucune suppression, ni dure ni douce.
 *
 * Montants : seules les colonnes `*_cents` sont écrites. `total`, `subtotal` et
 * `tax_total` sont calculées par les déclencheurs, comme les totaux des jobs
 * (job_line_items) et des factures (invoice_items, payments).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CLIENTS, COMMISSION, DEVIS, DOMAINE_COURRIEL, EQUIPES, FACTURES, FUSEAU, JOBS, MARQUEUR, MEMBRES, MODELES_COURRIEL, ORG_TEST_DEFAUT, PREFIXE_DEFAUT, PROPRIETES, TACHES, VALABLE_JUSQU_AU,
  adresseClient, ajouterJours, clientDe, courrielEval, idEval as idEvalDuJeu, membreDe, instantLocal, jourDe, jourLocal, nomClient, sousTotal, taxesQc, verifierJeu,
  type JobEval,
} from './jeu-eval.mts';
import { VARIANTE_DEFAUT, fixturePrevisionnelle, rentabiliteDe, type Fixture, type MesureVisites, type VarianteBureau } from './fixture-eval.mts';

const drapeau = (k: string): boolean => process.argv.includes(k);
const arg = (k: string, d = ''): string => {
  const i = process.argv.indexOf(k);
  const v = i > -1 ? process.argv[i + 1] : undefined;
  return v && !v.startsWith('--') ? v : d;
};

const APPLIQUER = drapeau('--appliquer');
const HORS_LIGNE = drapeau('--hors-ligne');
const FIXTURE_SEULE = drapeau('--fixture-seulement');
const ORG = arg('--org', ORG_TEST_DEFAUT);
const ANCRE = arg('--ancre', jourLocal(new Date()));
const PREFIXE = arg('--prefixe', PREFIXE_DEFAUT);
const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const FICHIER_FIXTURE = arg('--fixture', join(RACINE, 'evals', 'lumi', PREFIXE === PREFIXE_DEFAUT ? 'fixture.json' : `fixture-${PREFIXE}.json`));

if (!/^eval\d*$/.test(PREFIXE)) throw new Error(`--prefixe : « eval », « eval2 », « eval3 »… attendu (reçu « ${PREFIXE} »).`);
// Un compte n'appartient qu'à un bureau, et un identifiant de fiche est unique dans toute la base :
// le banc d'origine garde le préfixe « eval », tout autre bureau doit avoir le sien.
if ((ORG === ORG_TEST_DEFAUT) !== (PREFIXE === PREFIXE_DEFAUT)) {
  throw new Error(ORG === ORG_TEST_DEFAUT
    ? `--prefixe ${PREFIXE} sans --org : le banc d’origine garde le préfixe « ${PREFIXE_DEFAUT} ».`
    : `--org ${ORG} sans --prefixe : un autre bureau que le banc d’origine exige son préfixe (ex. --prefixe eval2), sinon il prendrait les comptes du banc.`);
}
const VARIANTE: VarianteBureau = PREFIXE === PREFIXE_DEFAUT
  ? VARIANTE_DEFAUT
  : { prefixe: PREFIXE, comptes: { proprietaire: `${PREFIXE}.proprio1@${DOMAINE_COURRIEL}`, technicien: `${PREFIXE}.tech@${DOMAINE_COURRIEL}` } };
/** Identifiant d'une fiche du jeu DANS ce bureau. */
const idEval = (cle: string): string => idEvalDuJeu(cle, ORG);

if (!/^\d{4}-\d{2}-\d{2}$/.test(ANCRE)) throw new Error(`--ancre : date attendue au format AAAA-MM-JJ (reçu « ${ANCRE} »).`);
if (APPLIQUER && (HORS_LIGNE || FIXTURE_SEULE)) throw new Error('--appliquer ne se combine ni avec --hors-ligne ni avec --fixture-seulement.');

type Ligne = Record<string, unknown>;
interface Erreur { message: string }

/* ── Journal ───────────────────────────────────────────────────────────── */

const compte = { creees: 0, presentes: 0, a_creer: 0, restaurees: 0, replacees: 0, corrigees: 0 };
const avertissements: string[] = [];
function dire(signe: '+' | '=' | '~' | '!' | '?', texte: string): void { console.log(`  ${signe} ${texte}`); }
function avertir(texte: string): void { avertissements.push(texte); dire('!', texte); }
function titre(texte: string): void { console.log(`\n${texte}`); }

function ecrireFixture(f: Fixture): void {
  mkdirSync(dirname(FICHIER_FIXTURE), { recursive: true });
  writeFileSync(FICHIER_FIXTURE, `${JSON.stringify(f, null, 1)}\n`);
  console.log(`\nFiche des faits (${f.etat}) écrite : ${FICHIER_FIXTURE}`);
}

/* ── Le jeu lui-même, avant toute chose ────────────────────────────────── */

const fautes = verifierJeu();
if (fautes.length) throw new Error(`Jeu de données invalide :\n - ${fautes.join('\n - ')}`);

if (HORS_LIGNE) {
  console.log(`HORS LIGNE — aucun accès à la base. Ancre : ${ANCRE}.`);
  console.log(`Le jeu : ${CLIENTS.length} clients (dont ${CLIENTS.filter((c) => c.statut === 'lead').length} prospect, ${CLIENTS.filter((c) => !c.courriel).length} sans courriel), `
    + `${PROPRIETES.length} adresse en plus, ${JOBS.length} jobs (${JOBS.filter((j) => j.visite).length} visites), ${DEVIS.length} devis, ${FACTURES.length} factures, `
    + `${FACTURES.reduce((n, f) => n + (f.paiements?.length ?? 0), 0)} paiements, ${MEMBRES.length} membres, ${EQUIPES.length} équipes, `
    + `${JOBS.reduce((n, j) => n + (j.pointages?.length ?? 0), 0)} pointages, ${JOBS.filter((j) => j.commissionCents).length} commissions, `
    + `${JOBS.filter((j) => j.depenses).length} jobs avec dépenses, ${TACHES.length} tâches, ${MODELES_COURRIEL.length} modèles de courriel.`);
  ecrireFixture(fixturePrevisionnelle(ANCRE, ORG, VARIANTE));
  process.exit(0);
}

/* ── Connexion : la production, jamais autre chose ─────────────────────── */

const REF = process.env.SUPABASE_PROJECT_REF_PROD ?? '';
const URL_PROD = process.env.SUPABASE_URL_PROD ?? '';
const CLE = process.env.SUPABASE_SERVICE_ROLE_KEY_PROD ?? '';
if (!REF || !URL_PROD || !CLE) throw new Error('SUPABASE_PROJECT_REF_PROD, SUPABASE_URL_PROD et SUPABASE_SERVICE_ROLE_KEY_PROD requis (--env-file=…/.env.local). Sans base : --hors-ligne.');
if (!URL_PROD.includes(REF)) throw new Error('SUPABASE_URL_PROD ne correspond pas à SUPABASE_PROJECT_REF_PROD — refus.');
const db: SupabaseClient = createClient(URL_PROD, CLE, { auth: { persistSession: false, autoRefreshToken: false } });

async function lire<T>(p: PromiseLike<{ data: unknown; error: Erreur | null }>, quoi: string): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(`${quoi} : ${error.message}`);
  return data as T;
}
async function ecrire(p: PromiseLike<{ error: Erreur | null }>, quoi: string): Promise<void> {
  if (!APPLIQUER) throw new Error(`écriture hors --appliquer (${quoi}) — bogue du seed, rien n'a été écrit.`);
  const { error } = await p;
  if (error) throw new Error(`${quoi} : ${error.message}`);
}

/* ── Garde-fous ────────────────────────────────────────────────────────── */

const org = await lire<{ id: string; name: string } | null>(db.from('orgs').select('id, name').eq('id', ORG).maybeSingle(), 'bureau');
if (!org) throw new Error(`Bureau ${ORG} introuvable.`);
if (!/\b(QA|TEST)\b|\bbanc\b/i.test(org.name)) throw new Error(`REFUS : « ${org.name} » n’a pas un nom de bureau de test (QA, TEST, banc).`);
const bac = await lire<{ org_id: string; mode: string } | null>(db.from('orgs_envois_simules').select('org_id, mode').eq('org_id', ORG).maybeSingle(), 'bac à sable');
if (!bac) throw new Error(`REFUS : « ${org.name} » n’est pas inscrit au bac à sable des envois (orgs_envois_simules). Sans lui, les automatisations du bureau enverraient pour vrai.`);

const proprio = await lire<Array<{ user_id: string }>>(
  db.from('memberships').select('user_id').eq('org_id', ORG).eq('role', 'owner').eq('status', 'active').order('created_at', { ascending: true }).limit(1), 'propriétaire');
if (!proprio.length) throw new Error('Aucun propriétaire actif dans le bureau : impossible de signer les fiches (created_by).');
const PROPRIO = proprio[0].user_id;
const NOM_ORG: string = org.name;

console.log(`${APPLIQUER ? 'ÉCRITURE' : FIXTURE_SEULE ? 'FICHE DES FAITS SEULEMENT (aucune écriture en base)' : 'SIMULATION (aucune écriture)'} — bureau « ${org.name} », bac à sable « ${bac.mode} », ancre ${ANCRE}.`);

/* ── Outils d'idempotence ──────────────────────────────────────────────── */

/** Tables qui ont une corbeille (deleted_at) : une fiche du jeu qui s'y trouve est restaurée. */
const AVEC_CORBEILLE = new Set(['clients', 'properties', 'jobs', 'job_line_items', 'schedule_events', 'quotes', 'invoices', 'invoice_items', 'payments', 'tasks', 'teams', 'fs_commission_rules', 'fs_commission_entries', 'payment_requests']);

/** Crée la fiche si elle n'existe pas. Rend true si elle existe à la sortie (donc false en simulation quand elle manque). */
async function assurer(table: string, id: string, ligne: Ligne, libelle: string): Promise<boolean> {
  const corbeille = AVEC_CORBEILLE.has(table);
  const deja = await lire<{ id: string; org_id: string; deleted_at?: string | null } | null>(
    db.from(table).select(corbeille ? 'id, org_id, deleted_at' : 'id, org_id').eq('id', id).maybeSingle(), `${table} « ${libelle} »`);
  if (deja && deja.org_id !== ORG) throw new Error(`${table} « ${libelle} » : l’identifiant ${id} appartient à un AUTRE bureau (${deja.org_id}) — arrêt, rien n’est écrit ailleurs que dans ${ORG}.`);
  if (deja) {
    if (corbeille && deja.deleted_at) {
      if (!APPLIQUER) { dire('~', `${table} « ${libelle} » : à la corbeille, serait restaurée`); return true; }
      await ecrire(db.from(table).update({ deleted_at: null }).eq('id', id).eq('org_id', ORG), `${table} « ${libelle} » (restauration)`);
      compte.restaurees += 1;
      dire('~', `${table} « ${libelle} » : restaurée`);
      return true;
    }
    compte.presentes += 1;
    return true;
  }
  if (!APPLIQUER) { compte.a_creer += 1; dire('+', `${table} « ${libelle} » : à créer`); return false; }
  await ecrire(db.from(table).insert({ id, ...ligne }), `${table} « ${libelle} »`);
  compte.creees += 1;
  dire('+', `${table} « ${libelle} » : créée`);
  return true;
}

const iso = (jour: string, hhmm: string): string => instantLocal(jour, hhmm).toISOString();
const memeInstant = (a: string | null | undefined, b: string): boolean => Boolean(a) && Date.parse(String(a)) === Date.parse(b);

/* ══ Écriture du jeu ═══════════════════════════════════════════════════ */

const idEquipeDe = (cle: string): string => idEval(`equipe:${cle}`);
const idEquipe = (cle: string | null): string | null => (cle ? idEquipeDe(cle) : null);
const idClient = (cle: string): string => idEval(`client:${cle}`);
const idJob = (cle: string): string => idEval(`job:${cle}`);
const idDevis = (cle: string): string => idEval(`devis:${cle}`);
const idFacture = (cle: string): string => idEval(`facture:${cle}`);
/** user_id des membres du jeu (attribué par l'authentification : pas dérivable de la clé). */
const idMembre = new Map<string, string>();

async function semerEquipe(): Promise<void> {
  titre('Équipes et membres');
  for (const [i, e] of EQUIPES.entries()) {
    await assurer('teams', idEquipeDe(e.cle), { org_id: ORG, name: e.nom, color_hex: e.couleur, description: `${MARQUEUR} equipe:${e.cle}`, is_active: true, display_order: 50 + i }, e.nom);
  }
  for (const m of MEMBRES) {
    const nomComplet = `${m.prenom} ${m.nom}`;
    const courriel = courrielEval(m.courriel, PREFIXE);
    const fiche = await lire<Array<{ id: string; user_id: string | null }>>(
      db.from('team_members').select('id, user_id').eq('org_id', ORG).eq('email', courriel).limit(1), `membre ${nomComplet}`);
    let userId = fiche[0]?.user_id ?? null;
    if (!userId) {
      if (!APPLIQUER) { compte.a_creer += 1; dire('+', `compte ${courriel} (${nomComplet}, ${m.role}) : à créer, avec son adhésion au bureau`); continue; }
      // email_confirm : aucun courriel de confirmation ne part. Mot de passe aléatoire, jamais affiché.
      const cree = await db.auth.admin.createUser({ email: courriel, password: randomBytes(24).toString('base64url'), email_confirm: true, user_metadata: { full_name: nomComplet } });
      userId = cree.data?.user?.id ?? null;
      if (!userId) {
        // Compte déjà là (seed interrompu avant l'adhésion) : generateLink le retrouve sans rien envoyer.
        const lien = await db.auth.admin.generateLink({ type: 'magiclink', email: courriel });
        userId = lien.data?.user?.id ?? null;
        if (!userId) throw new Error(`compte ${courriel} : ${cree.error?.message ?? '?'} / ${lien.error?.message ?? '?'}`);
        // Un compte retrouvé ne doit appartenir à aucun autre bureau : on n'y rattache jamais le compte de quelqu'un.
        const ailleurs = await lire<Array<{ org_id: string }>>(db.from('memberships').select('org_id').eq('user_id', userId).neq('org_id', ORG).limit(1), `adhésions de ${courriel}`);
        if (ailleurs.length) throw new Error(`compte ${courriel} : déjà membre d’un autre bureau (${ailleurs[0].org_id}) — refus de le rattacher à ${ORG}.`);
      } else {
        compte.creees += 1;
        dire('+', `compte ${courriel} : créé`);
      }
    }
    idMembre.set(m.cle, userId);

    const adhesion = await lire<{ user_id: string } | null>(db.from('memberships').select('user_id').eq('org_id', ORG).eq('user_id', userId).maybeSingle(), `adhésion ${nomComplet}`);
    if (!adhesion) {
      if (!APPLIQUER) { compte.a_creer += 1; dire('+', `adhésion de ${nomComplet} : à créer`); continue; }
      await ecrire(db.from('memberships').insert({
        user_id: userId, org_id: ORG, role: m.role, status: 'active', language: 'fr', full_name: nomComplet, team_id: idEquipe(m.equipe),
        hourly_rate_cents: m.tauxCents, compensation_mode: m.mode, lumi_briefing: false,
      }), `adhésion ${nomComplet}`);
      compte.creees += 1;
      dire('+', `adhésion de ${nomComplet} (${m.role}) : créée`);
    } else compte.presentes += 1;

    // La fiche team_members est créée par le déclencheur de l'adhésion ; on y pose le nom, le taux et l'équipe.
    const voulu = { first_name: m.prenom, last_name: m.nom, phone: m.telephone, role: m.role, status: 'active', hourly_rate_cents: m.tauxCents, compensation_mode: m.mode, team_id: idEquipe(m.equipe) };
    const tm = await lire<Array<Ligne & { id: string }>>(
      db.from('team_members').select('id, first_name, last_name, phone, role, status, hourly_rate_cents, compensation_mode, team_id').eq('org_id', ORG).eq('user_id', userId).limit(1), `fiche d'équipe ${nomComplet}`);
    if (!tm.length) {
      if (!APPLIQUER) { compte.a_creer += 1; dire('+', `fiche d'équipe de ${nomComplet} : à créer`); continue; }
      await ecrire(db.from('team_members').insert({ org_id: ORG, user_id: userId, email: courriel, ...voulu }), `fiche d'équipe ${nomComplet}`);
      compte.creees += 1;
    } else if (Object.entries(voulu).some(([k, v]) => tm[0][k] !== v)) {
      if (!APPLIQUER) dire('~', `fiche d'équipe de ${nomComplet} : nom, taux ou équipe à poser`);
      else {
        await ecrire(db.from('team_members').update(voulu).eq('id', tm[0].id).eq('org_id', ORG), `fiche d'équipe ${nomComplet}`);
        compte.corrigees += 1;
        dire('~', `fiche d'équipe de ${nomComplet} : nom, taux et équipe posés`);
      }
    } else compte.presentes += 1;

    if (m.equipe) {
      const lien = await lire<Array<{ id: string }>>(
        db.from('team_assignments').select('id').eq('org_id', ORG).eq('user_id', userId).eq('team_id', idEquipeDe(m.equipe)).limit(1), `équipe de ${nomComplet}`);
      if (!lien.length) {
        if (!APPLIQUER) { compte.a_creer += 1; dire('+', `${nomComplet} dans son équipe : à créer`); } else {
          await ecrire(db.from('team_assignments').insert({ org_id: ORG, user_id: userId, team_id: idEquipe(m.equipe), is_primary: true }), `équipe de ${nomComplet}`);
          compte.creees += 1;
        }
      } else compte.presentes += 1;
    }
  }
  const rep = idMembre.get(COMMISSION.membre);
  if (rep) {
    await assurer('fs_commission_rules', idEval(COMMISSION.cle), {
      org_id: ORG, name: COMMISSION.nom, description: `${MARQUEUR} ${COMMISSION.cle}`, type: 'percentage', percentage: COMMISSION.pourcent,
      base_kind: 'percent', base_percent: COMMISSION.pourcent, applies_to_user_id: rep, assigned_user_ids: [rep], is_active: true,
    }, COMMISSION.nom);
  } else dire('?', 'règle de commission : attend le compte de la représentante');
}

/** Adresse de service principale de chaque client (créée par le déclencheur à partir de l'adresse du client). */
const proprietePrincipale = new Map<string, string>();

async function semerClients(): Promise<void> {
  titre('Clients et adresses');
  for (const c of CLIENTS) {
    const present = await assurer('clients', idClient(c.cle), {
      org_id: ORG, created_by: PROPRIO, first_name: c.prenom, last_name: c.nom, company: c.entreprise ?? null, email: c.courriel, phone: c.telephone,
      address: adresseClient(c), city: c.ville, province: 'QC', postal_code: c.codePostal, country: 'CA', latitude: c.lat, longitude: c.lng,
      status: c.statut, description: `${MARQUEUR} client:${c.cle}`,
      ...(c.statut === 'lead' ? { lead_status: 'new_prospect', value: c.valeurEstimee ?? 0 } : {}),
    }, `${nomClient(c)} (${c.ville})`);
    if (!present) continue;
    const p = await lire<Array<{ id: string }>>(
      db.from('properties').select('id').eq('org_id', ORG).eq('client_id', idClient(c.cle)).eq('kind', 'service').is('deleted_at', null)
        .order('is_primary', { ascending: false }).order('created_at', { ascending: true }).limit(1), `adresse de ${nomClient(c)}`);
    if (p.length) proprietePrincipale.set(c.cle, p[0].id);
    else avertir(`${nomClient(c)} (${c.ville}) n’a pas d’adresse de service : le déclencheur clients_auto_property_from_address ne l’a pas créée.`);
  }
  for (const p of PROPRIETES) {
    const c = clientDe(p.client);
    await assurer('properties', idEval(`propriete:${p.cle}`), {
      org_id: ORG, client_id: idClient(p.client), created_by: PROPRIO, name: p.nom, address: `${p.rue}, ${p.ville}, QC ${p.codePostal}`,
      city: p.ville, province: 'QC', postal_code: p.codePostal, country: 'CA', latitude: p.lat, longitude: p.lng, is_primary: false, kind: 'service',
    }, `${p.nom} de ${nomClient(c)}`);
  }
}

function bornesVisite(j: JobEval): { debut: string; fin: string; jour: string } | null {
  if (!j.visite) return null;
  const jour = jourDe(j.visite.quand, ANCRE);
  return { jour, debut: iso(jour, j.visite.debut), fin: iso(jour, j.visite.fin) };
}

async function semerJobs(): Promise<void> {
  titre('Jobs, lignes et visites');
  for (const j of JOBS) {
    const c = clientDe(j.client);
    const v = bornesVisite(j);
    const st = sousTotal(j.lignes);
    const present = await assurer('jobs', idJob(j.cle), {
      org_id: ORG, created_by: PROPRIO, title: j.titre, client_id: idClient(j.client), client_name: nomClient(c),
      property_id: proprietePrincipale.get(j.client) ?? null, property_address: adresseClient(c), address: adresseClient(c),
      latitude: c.lat, longitude: c.lng, geocode_status: 'ok', team_id: idEquipe(j.equipe), status: j.statut,
      tax_cents: taxesQc(st).total, description: `${MARQUEUR} job:${j.cle}`, notes: j.notes ?? null, requires_invoicing: j.aFacturer ?? false,
      salesperson_id: j.vendeur ? idMembre.get(j.vendeur) ?? null : null,
      // Pas de carte de pipeline créée par le déclencheur du classement des ventes : le jeu ne touche pas au pipeline.
      show_on_leaderboard: false,
      ...(v ? { scheduled_at: v.debut, start_at: v.debut, end_at: v.fin, sale_date: v.jour } : {}),
      ...(j.statut === 'completed' && v ? { completed_at: v.fin } : {}),
    }, `${j.titre} — ${nomClient(c)}`);
    if (!present) continue;

    // Le déclencheur recalculate_job_totals_from_items refait sous-total et total à chaque ligne.
    for (const [i, l] of j.lignes.entries()) {
      await assurer('job_line_items', idEval(`job:${j.cle}:ligne:${i}`), { org_id: ORG, job_id: idJob(j.cle), created_by: PROPRIO, name: l.nom, qty: l.qte, unit_price_cents: l.prixCents, included: true }, `ligne « ${l.nom} » de ${j.cle}`);
    }
    if (!j.visite || !v) continue;
    const idVisite = idEval(`visite:${j.cle}`);
    const cree = await assurer('schedule_events', idVisite, {
      org_id: ORG, created_by: PROPRIO, job_id: idJob(j.cle), title: j.titre, team_id: idEquipe(j.equipe),
      start_at: v.debut, end_at: v.fin, start_time: v.debut, end_time: v.fin, status: j.visite.statut, timezone: FUSEAU, notes: `${MARQUEUR} visite:${j.cle}`,
    }, `visite du ${v.jour} — ${nomClient(c)}`);
    if (!cree || !('relatif' in j.visite.quand)) continue;
    // Visite relative (aujourd'hui, demain…) : replacée sur l'ancre si elle a glissé.
    const actuelle = await lire<{ start_at: string | null; end_at: string | null } | null>(db.from('schedule_events').select('start_at, end_at').eq('id', idVisite).maybeSingle(), `visite ${j.cle}`);
    if (actuelle && (!memeInstant(actuelle.start_at, v.debut) || !memeInstant(actuelle.end_at, v.fin))) {
      if (!APPLIQUER) { dire('~', `visite de ${nomClient(c)} : serait replacée au ${v.jour} ${j.visite.debut}`); continue; }
      await ecrire(db.from('schedule_events').update({ start_at: v.debut, end_at: v.fin, start_time: v.debut, end_time: v.fin }).eq('id', idVisite).eq('org_id', ORG), `visite ${j.cle} (replacement)`);
      await ecrire(db.from('jobs').update({ scheduled_at: v.debut, start_at: v.debut, end_at: v.fin }).eq('id', idJob(j.cle)).eq('org_id', ORG), `job ${j.cle} (replacement)`);
      compte.replacees += 1;
      dire('~', `visite de ${nomClient(c)} : replacée au ${v.jour} ${j.visite.debut}`);
    }
  }
}

/** Champs « montant » du dossier système Dépenses : clé du champ → id. */
const CHAMPS_DEPENSES = { carburant: 'depense_carburant', outils: 'depense_outils' } as const;
const LIBELLES_DEPENSES = { carburant: 'Carburant', outils: 'Outils' } as const;
const idChampDepense = new Map<string, string>();

async function semerDepenses(): Promise<void> {
  titre('Dépenses (champ personnalisé du job)');
  const dossiers = await lire<Array<{ id: string }>>(db.from('custom_field_folders').select('id').eq('org_id', ORG).eq('object_type', 'job').eq('cle_systeme', 'depenses'), 'dossier Dépenses');
  if (!dossiers.length) { avertir('Le dossier système « Dépenses » des jobs n’existe pas dans ce bureau : aucune dépense écrite, la rentabilité attendue sera fausse.'); return; }
  const champs = await lire<Array<{ id: string; key: string; label: string; archived_at: string | null }>>(
    db.from('custom_fields').select('id, key, label, archived_at').eq('org_id', ORG).eq('object_type', 'job').eq('field_type', 'monetary')
      .in('folder_id', dossiers.map((d) => d.id)).in('key', Object.values(CHAMPS_DEPENSES)), 'champs Dépenses');
  for (const [nom, cle] of Object.entries(CHAMPS_DEPENSES)) {
    let champ = champs.find((x) => x.key === cle);
    if (!champ) {
      // Une entreprise récente n'a plus que trois champs de base (carburant, sous-traitance, autres) :
      // « Outils », que le banc d'origine tient de l'ancienne liste, est créé comme un champ maison du dossier.
      const libelle = LIBELLES_DEPENSES[nom as keyof typeof CHAMPS_DEPENSES];
      if (!APPLIQUER) { compte.a_creer += 1; dire('+', `champ « ${libelle} » (${cle}) du dossier Dépenses : à créer`); continue; }
      const id = idEval(`champ:${cle}`);
      await ecrire(db.from('custom_fields').insert({
        id, org_id: ORG, object_type: 'job', folder_id: dossiers[0].id, key: cle, label: libelle, field_type: 'monetary',
        config: { currency: 'CAD', masque_creation: true }, position: 4, created_by: PROPRIO,
      }), `champ ${cle}`);
      compte.creees += 1;
      dire('+', `champ « ${libelle} » (${cle}) du dossier Dépenses : créé`);
      champ = { id, key: cle, label: libelle, archived_at: null };
    }
    idChampDepense.set(nom, champ.id);
    // La rentabilité ne compte que les champs NON archivés (server/lib/rentabilite/charger.ts).
    if (champ.archived_at) {
      if (!APPLIQUER) { dire('~', `champ « ${champ.label} » : archivé, serait réactivé`); continue; }
      await ecrire(db.from('custom_fields').update({ archived_at: null }).eq('id', champ.id).eq('org_id', ORG), `champ ${cle} (réactivation)`);
      compte.corrigees += 1;
      dire('~', `champ « ${champ.label} » : réactivé (il était archivé)`);
    }
  }
  for (const j of JOBS) {
    for (const [nom, cents] of Object.entries(j.depenses ?? {})) {
      const champ = idChampDepense.get(nom);
      if (!champ || !cents) continue;
      const deja = await lire<Array<{ id: string }>>(db.from('custom_field_values').select('id').eq('org_id', ORG).eq('field_id', champ).eq('job_id', idJob(j.cle)).limit(1), `dépense ${nom} de ${j.cle}`);
      if (deja.length) { compte.presentes += 1; continue; }
      if (!APPLIQUER) { compte.a_creer += 1; dire('+', `dépense « ${nom} » ${(cents / 100).toFixed(2)} $ sur ${j.cle} : à créer`); continue; }
      // Le déclencheur cf_maj_depenses_job reporte la somme dans jobs.expenses_cents.
      await ecrire(db.from('custom_field_values').insert({
        id: idEval(`depense:${j.cle}:${nom}`), org_id: ORG, field_id: champ, object_type: 'job', job_id: idJob(j.cle),
        value_money_cents: cents, value_currency: 'CAD', updated_by: PROPRIO,
      }), `dépense ${nom} de ${j.cle}`);
      compte.creees += 1;
      dire('+', `dépense « ${nom} » ${(cents / 100).toFixed(2)} $ sur ${j.cle} : créée`);
    }
  }
}

async function semerPointages(): Promise<void> {
  titre('Heures pointées');
  for (const j of JOBS) {
    const v = bornesVisite(j);
    if (!v) continue;
    for (const p of j.pointages ?? []) {
      const m = membreDe(p.membre);
      const userId = idMembre.get(p.membre);
      if (!userId) { dire('?', `pointage de ${m.prenom} sur ${j.cle} : attend son compte`); continue; }
      await assurer('time_entries', idEval(`pointage:${j.cle}:${p.membre}`), {
        org_id: ORG, employee_id: userId, employee_name: `${m.prenom} ${m.nom}`, date: v.jour,
        punch_in: `${p.debut}:00`, punch_out: `${p.fin}:00`, punch_in_at: iso(v.jour, p.debut), punch_out_at: iso(v.jour, p.fin),
        breaks: p.pause ? [{ start: `${p.pause[0]}:00`, end: `${p.pause[1]}:00` }] : [],
        job_id: idJob(j.cle), team_id: idEquipe(j.equipe), status: 'completed', notes: `${MARQUEUR} pointage:${j.cle}:${p.membre}`,
      }, `${m.prenom} ${m.nom} le ${v.jour} (${p.debut}–${p.fin})`);
    }
  }
}

/** Plus petit numéro libre, comme la base (org_smallest_free_number) : les devis n'ont pas de déclencheur de numérotation. */
function plusPetitLibre(pris: Set<number>): number {
  let n = 1;
  while (pris.has(n)) n += 1;
  return n;
}

async function semerDevis(): Promise<void> {
  titre('Devis');
  const existants = await lire<Array<{ quote_number: string | null }>>(db.from('quotes').select('quote_number').eq('org_id', ORG), 'numéros de devis');
  const pris = new Set(existants.map((q) => Number(String(q.quote_number ?? '').replace(/\D/g, ''))).filter((n) => n > 0));
  for (const d of DEVIS) {
    const c = clientDe(d.client);
    const st = sousTotal(d.lignes);
    const taxes = taxesQc(st).total;
    const numero = plusPetitLibre(pris);
    const canal = c.courriel ? 'email' : 'sms';
    const creeesAvant = compte.creees;
    const present = await assurer('quotes', idDevis(d.cle), {
      org_id: ORG, created_by: PROPRIO, quote_number: String(numero), title: d.titre, status: d.statut,
      ...(c.statut === 'lead' ? { context_type: 'lead', lead_id: idClient(d.client) } : { context_type: 'client', client_id: idClient(d.client) }),
      subtotal_cents: st, tax_cents: taxes, total_cents: st + taxes, valid_until: VALABLE_JUSQU_AU,
      internal_notes: `${MARQUEUR} devis:${d.cle}`, created_at: iso(d.cree, '10:00'),
      ...(d.envoye ? { [canal === 'email' ? 'sent_via_email_at' : 'sent_via_sms_at']: iso(d.envoye, '10:30'), last_sent_channel: canal } : {}),
      ...(d.statut === 'approved' && d.decide ? { approved_at: iso(d.decide, '15:00') } : {}),
      ...(d.statut === 'declined' && d.decide ? { declined_at: iso(d.decide, '15:00') } : {}),
    }, `${d.titre} — ${nomClient(c)} (${d.statut})`);
    if (compte.creees > creeesAvant) pris.add(numero); // le numéro n'est consommé que si le devis vient d'être créé
    if (!present) continue;
    for (const [i, l] of d.lignes.entries()) {
      await assurer('quote_line_items', idEval(`devis:${d.cle}:ligne:${i}`), { org_id: ORG, quote_id: idDevis(d.cle), name: l.nom, quantity: l.qte, unit_price_cents: l.prixCents, sort_order: i, item_type: 'service' }, `ligne « ${l.nom} » du devis ${d.cle}`);
    }
  }
}

async function semerFactures(): Promise<void> {
  titre('Factures et paiements');
  for (const f of FACTURES) {
    const c = clientDe(f.client);
    const st = sousTotal(f.lignes);
    const attendu = st + taxesQc(st).total;
    const id = idFacture(f.cle);
    // 1. Toujours créée en BROUILLON (sans date d'émission) : une facture émise est figée par enforce_invoice_immutability.
    //    Le numéro est attribué par le déclencheur crm_invoices_ensure_number.
    const present = await assurer('invoices', id, {
      org_id: ORG, created_by: PROPRIO, client_id: idClient(f.client), job_id: f.job ? idJob(f.job) : null, subject: f.sujet,
      due_date: f.echeance ?? null, tax_cents: taxesQc(st).total, internal_notes: `${MARQUEUR} facture:${f.cle}`,
      ...(f.emise ? { created_at: iso(f.emise, '16:00') } : {}),
    }, `${f.sujet} — ${nomClient(c)}`);
    if (!present) continue;
    let etat = await lire<{ status: string; issued_at: string | null; total_cents: number } | null>(db.from('invoices').select('status, issued_at, total_cents').eq('id', id).maybeSingle(), `facture ${f.cle}`);
    if (!etat) continue;

    // 2. Lignes (le déclencheur invoice_items_recalculate_parent refait sous-total, total et solde).
    for (const [i, l] of f.lignes.entries()) {
      const idLigne = idEval(`facture:${f.cle}:ligne:${i}`);
      if (etat.status !== 'draft') {
        const ligne = await lire<{ id: string } | null>(db.from('invoice_items').select('id').eq('id', idLigne).maybeSingle(), `ligne de facture ${f.cle}`);
        if (!ligne) avertir(`Facture ${f.cle} déjà émise mais sa ligne « ${l.nom} » manque : ses montants sont figés, elle ne peut plus être complétée.`);
        else compte.presentes += 1;
        continue;
      }
      await assurer('invoice_items', idLigne, { org_id: ORG, invoice_id: id, description: l.nom, title: l.nom, qty: l.qte, unit_price_cents: l.prixCents, sort_order: i, source_type: 'manual' }, `ligne « ${l.nom} » de la facture ${f.cle}`);
    }

    // 3. Émission : poser issued_at fait passer la facture à « sent » (invoices_apply_status_logic).
    if (f.emise && !etat.issued_at) {
      if (!APPLIQUER) dire('~', `facture ${f.cle} : serait émise au ${f.emise}`);
      else {
        etat = await lire<{ status: string; issued_at: string | null; total_cents: number } | null>(db.from('invoices').select('status, issued_at, total_cents').eq('id', id).maybeSingle(), `facture ${f.cle}`);
        if (etat && etat.total_cents !== attendu) avertir(`Facture ${f.cle} : total ${etat.total_cents} ¢ en base, ${attendu} ¢ prévus — émise quand même, la fiche des faits dira l'écart.`);
        await ecrire(db.from('invoices').update({ issued_at: iso(f.emise, '16:00'), sent_at: iso(f.emise, '16:00') }).eq('id', id).eq('org_id', ORG), `facture ${f.cle} (émission)`);
        compte.corrigees += 1;
        dire('~', `facture ${f.cle} : émise au ${f.emise}`);
      }
    }

    // 4. Paiements (payments_recalculate_invoice_trigger refait payé, solde et statut).
    for (const p of f.paiements ?? []) {
      await assurer('payments', idEval(`paiement:${p.cle}`), {
        org_id: ORG, created_by: PROPRIO, invoice_id: id, client_id: idClient(f.client), job_id: f.job ? idJob(f.job) : null,
        amount_cents: p.montantCents, currency: 'CAD', method: p.methode, status: 'succeeded', provider: 'manual',
        paid_at: iso(p.date, '14:00'), payment_date: iso(p.date, '14:00'),
      }, `${(p.montantCents / 100).toFixed(2)} $ (${p.methode}) de ${nomClient(c)}`);
    }

    // 5. Lien de paiement déjà envoyé (fictif : aucune intention Stripe derrière), pour « renvoie le lien ».
    if (f.lienPaiement) {
      await assurer('payment_requests', idEval(`lien:${f.cle}`), {
        org_id: ORG, invoice_id: id, amount_cents: attendu, currency: 'CAD', status: 'sent',
        expires_at: iso(VALABLE_JUSQU_AU, '23:00'), payment_url: `https://lume-qa.test/paiement-fictif/${f.cle}`,
      }, `lien de paiement de la facture ${f.cle}`);
    }
  }
}

async function semerCommissions(): Promise<void> {
  titre('Commissions');
  for (const j of JOBS) {
    if (!j.commissionCents || !j.vendeur) continue;
    const rep = idMembre.get(j.vendeur);
    const v = bornesVisite(j);
    if (!rep || !v) { dire('?', `commission de ${j.cle} : attend le compte de la représentante`); continue; }
    const facture = FACTURES.find((f) => f.job === j.cle);
    const payee = facture ? (facture.paiements ?? []).reduce((s, p) => s + p.montantCents, 0) >= sousTotal(facture.lignes) + taxesQc(sousTotal(facture.lignes)).total : false;
    // Le montant d'une commission est en DOLLARS (numeric) dans cette table.
    await assurer('fs_commission_entries', idEval(`commission:${j.cle}`), {
      org_id: ORG, user_id: rep, rule_id: idEval(COMMISSION.cle), job_id: idJob(j.cle), invoice_id: facture ? idFacture(facture.cle) : null,
      status: payee ? 'approved' : 'pending', amount: j.commissionCents / 100, base_amount: sousTotal(j.lignes) / 100,
      description: `${MARQUEUR} commission:${j.cle}`, triggered_at: iso(v.jour, '17:00'),
    }, `${(j.commissionCents / 100).toFixed(2)} $ sur ${j.cle}`);
  }
}

async function semerDivers(): Promise<void> {
  titre('Tâches et modèles de courriel');
  for (const t of TACHES) {
    await assurer('tasks', idEval(t.cle), {
      org_id: ORG, created_by: PROPRIO, title: t.titre, description: `${MARQUEUR} ${t.cle}`, status: t.statut, priority: t.priorite, type: 'Admin',
      due_date: t.echeance, completed_at: t.statut === 'done' ? iso(t.echeance, '12:00') : null,
    }, t.titre);
  }
  // Un seul modèle ACTIF par type (index uniq_email_templates_actif_par_type) : l'app désactive
  // l'ancien quand on en crée un nouveau. Le modèle par défaut d'un type est l'actif ; les autres
  // du même type existent, inactifs — c'est eux que « mets ce modèle par défaut » doit activer.
  const modeleActif = (m: (typeof MODELES_COURRIEL)[number]) => m.parDefaut || !MODELES_COURRIEL.some((x) => x.type === m.type && x.parDefaut);
  for (const m of MODELES_COURRIEL) {
    await assurer('email_templates', idEval(m.cle), { org_id: ORG, created_by: PROPRIO, name: m.nom, type: m.type, subject: m.sujet, body: m.corps, variables: ['client_name'], is_active: modeleActif(m), is_default: m.parDefaut, source: 'editeur' }, m.nom);
  }
}

/* ══ Fiche des faits : relue dans la base, par des requêtes à nous ═══════ */

const nombre = (v: unknown): number => Math.round(Number(v) || 0);

async function fixtureReelle(): Promise<Fixture> {
  const f = fixturePrevisionnelle(ANCRE, ORG, VARIANTE);
  f.etat = 'reel';
  f.org.nom = NOM_ORG;
  f.mesures.portee = 'bureau_entier';
  const ecarts: string[] = [];
  const comparer = (quoi: string, prevu: number, reel: number): void => { if (prevu !== reel) ecarts.push(`${quoi} : ${reel} en base, ${prevu} prévu`); };

  // ── Fiches du jeu : numéros, statuts et montants tels que la base les a calculés ──
  const jobs = await lire<Array<{ id: string; job_number: string; status: string; subtotal_cents: number; tax_cents: number; total_cents: number; expenses_cents: number; deleted_at: string | null }>>(
    db.from('jobs').select('id, job_number, status, subtotal_cents, tax_cents, total_cents, expenses_cents, deleted_at').eq('org_id', ORG).in('id', JOBS.map((j) => idJob(j.cle))), 'jobs du jeu');
  for (const j of JOBS) {
    const l = jobs.find((x) => x.id === idJob(j.cle));
    if (!l || l.deleted_at) { ecarts.push(`job ${j.cle} : absent de la base`); continue; }
    comparer(`job ${j.cle}, total`, f.jobs[j.cle].total_cents, nombre(l.total_cents));
    f.jobs[j.cle] = { ...f.jobs[j.cle], numero: l.job_number, statut: l.status, sous_total_cents: nombre(l.subtotal_cents), taxes_cents: nombre(l.tax_cents), total_cents: nombre(l.total_cents) };
  }
  const devis = await lire<Array<{ id: string; quote_number: string; status: string; subtotal_cents: number; tax_cents: number; total_cents: number; deleted_at: string | null }>>(
    db.from('quotes').select('id, quote_number, status, subtotal_cents, tax_cents, total_cents, deleted_at').eq('org_id', ORG).in('id', DEVIS.map((d) => idDevis(d.cle))), 'devis du jeu');
  for (const d of DEVIS) {
    const l = devis.find((x) => x.id === idDevis(d.cle));
    if (!l || l.deleted_at) { ecarts.push(`devis ${d.cle} : absent de la base`); continue; }
    comparer(`devis ${d.cle}, total`, f.devis[d.cle].total_cents, nombre(l.total_cents));
    if (l.status !== d.statut) ecarts.push(`devis ${d.cle} : statut ${l.status} en base, ${d.statut} prévu`);
    f.devis[d.cle] = { ...f.devis[d.cle], numero: l.quote_number, statut: l.status, sous_total_cents: nombre(l.subtotal_cents), taxes_cents: nombre(l.tax_cents), total_cents: nombre(l.total_cents) };
  }
  type FactureLue = { id: string; job_id: string | null; invoice_number: string; status: string; due_date: string | null; subtotal_cents: number; discount_cents: number; tax_cents: number; total_cents: number; paid_cents: number; balance_cents: number };
  const colonnesFacture = 'id, job_id, invoice_number, status, due_date, subtotal_cents, discount_cents, tax_cents, total_cents, paid_cents, balance_cents';
  // Toutes les factures du bureau (pas seulement celles du jeu) : c'est ce que Lumi voit.
  const factures = await lire<FactureLue[]>(db.from('invoices').select(colonnesFacture).eq('org_id', ORG).is('deleted_at', null).limit(5000), 'factures du bureau');
  for (const x of FACTURES) {
    const l = factures.find((y) => y.id === idFacture(x.cle));
    if (!l) { ecarts.push(`facture ${x.cle} : absente de la base`); continue; }
    comparer(`facture ${x.cle}, total`, f.factures[x.cle].total_cents, nombre(l.total_cents));
    comparer(`facture ${x.cle}, solde`, f.factures[x.cle].solde_cents, nombre(l.balance_cents));
    if (l.status !== f.factures[x.cle].statut) ecarts.push(`facture ${x.cle} : statut ${l.status} en base, ${f.factures[x.cle].statut} prévu`);
    f.factures[x.cle] = {
      ...f.factures[x.cle], numero: l.invoice_number, statut: l.status, echeance: l.due_date, sous_total_cents: nombre(l.subtotal_cents),
      taxes_cents: nombre(l.tax_cents), total_cents: nombre(l.total_cents), paye_cents: nombre(l.paid_cents), solde_cents: nombre(l.balance_cents),
    };
  }

  // ── Mesures du bureau entier ──
  const impayees = factures.filter((x) => (x.status === 'sent' || x.status === 'partial') && nombre(x.balance_cents) > 0);
  // « En retard » : la règle de l'écran Factures (émise, solde > 0, échéance avant aujourd'hui).
  const enRetard = impayees.filter((x) => x.due_date != null && x.due_date < ANCRE);
  f.mesures.factures_impayees = { nombre: impayees.length, solde_cents: impayees.reduce((s, x) => s + nombre(x.balance_cents), 0) };
  f.mesures.factures_en_retard = { nombre: enRetard.length, solde_cents: enRetard.reduce((s, x) => s + nombre(x.balance_cents), 0) };
  f.mesures.factures_brouillon = { nombre: factures.filter((x) => x.status === 'draft').length };

  const paiements = await lire<Array<{ amount_cents: number; refunded_cents: number | null }>>(
    db.from('payments').select('amount_cents, refunded_cents').eq('org_id', ORG).is('deleted_at', null).eq('status', 'succeeded')
      .gte('payment_date', iso('2026-09-01', '00:00')).lt('payment_date', iso('2026-10-01', '00:00')).limit(5000), 'paiements de septembre');
  f.mesures.encaisse_septembre_2026 = { nombre: paiements.length, total_cents: paiements.reduce((s, p) => s + nombre(p.amount_cents) - nombre(p.refunded_cents), 0) };

  type PointageLu = { job_id: string | null; employee_id: string | null; punch_in_at: string | null; punch_out_at: string | null; breaks: unknown };
  const heuresDe = (t: PointageLu): number => {
    if (!t.punch_in_at || !t.punch_out_at) return 0;
    let pauseMs = 0;
    for (const b of Array.isArray(t.breaks) ? (t.breaks as Array<{ start?: string; end?: string }>) : []) {
      if (!b.start || !b.end) continue;
      const sec = (v: string): number => { const m = /(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(v); return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] ?? 0) : 0; };
      pauseMs += /^\d{4}-/.test(b.start) ? Math.max(0, Date.parse(b.end) - Date.parse(b.start)) : ((sec(b.end) - sec(b.start) + 86_400) % 86_400) * 1000;
    }
    return Math.max(0, Date.parse(t.punch_out_at) - Date.parse(t.punch_in_at) - pauseMs) / 3_600_000;
  };
  const pointages = await lire<PointageLu[]>(
    db.from('time_entries').select('job_id, employee_id, punch_in_at, punch_out_at, breaks').eq('org_id', ORG).eq('status', 'completed').gte('date', '2026-09-01').lte('date', '2026-09-30').limit(5000), 'pointages de septembre');
  const equipe = await lire<Array<{ user_id: string | null; email: string; hourly_rate_cents: number; labour_cost_hourly: number | null; compensation_mode: string }>>(
    db.from('team_members').select('user_id, email, hourly_rate_cents, labour_cost_hourly, compensation_mode').eq('org_id', ORG), 'équipe');
  const cleDe = (userId: string | null): string => MEMBRES.find((m) => equipe.some((e) => e.user_id === userId && e.email === courrielEval(m.courriel, PREFIXE)))?.cle ?? 'autres';
  const heures: Record<string, number> = { total_heures: 0 };
  for (const t of pointages) {
    const h = heuresDe(t);
    heures[`${cleDe(t.employee_id)}_heures`] = (heures[`${cleDe(t.employee_id)}_heures`] ?? 0) + h;
    heures.total_heures += h;
  }
  for (const k of Object.keys(heures)) heures[k] = Math.round(heures[k] * 100) / 100;
  for (const [k, v] of Object.entries(f.mesures.heures_septembre_2026)) comparer(`heures de septembre, ${k}`, v, heures[k] ?? 0);
  f.mesures.heures_septembre_2026 = heures;

  const visites = await lire<Array<{ job_id: string | null; start_at: string | null; status: string | null }>>(
    db.from('schedule_events').select('job_id, start_at, status').eq('org_id', ORG).is('deleted_at', null).not('job_id', 'is', null)
      .gte('start_at', iso(ANCRE, '00:00')).lt('start_at', iso(ajouterJours(ANCRE, 7), '00:00')).limit(5000), 'visites des 7 prochains jours');
  const idsJobsVisites = [...new Set(visites.map((v) => v.job_id).filter((x): x is string => Boolean(x)))];
  const jobsVisites = idsJobsVisites.length
    ? await lire<Array<{ id: string; client_name: string | null }>>(db.from('jobs').select('id, client_name').eq('org_id', ORG).is('deleted_at', null).in('id', idsJobsVisites), 'jobs des visites')
    : [];
  const visitesLe = (du: string, au: string): MesureVisites => {
    const vs = visites.filter((v) => v.status !== 'cancelled' && v.start_at && jobsVisites.some((j) => j.id === v.job_id) && jourLocal(new Date(v.start_at)) >= du && jourLocal(new Date(v.start_at)) <= au);
    return { nombre: vs.length, clients: vs.map((v) => jobsVisites.find((j) => j.id === v.job_id)?.client_name ?? '—') };
  };
  f.mesures.visites = { aujourd_hui: visitesLe(ANCRE, ANCRE), demain: visitesLe(ajouterJours(ANCRE, 1), ajouterJours(ANCRE, 1)), sept_jours: visitesLe(ANCRE, ajouterJours(ANCRE, 6)) };

  const tousDevis = await lire<Array<{ status: string }>>(db.from('quotes').select('status').eq('org_id', ORG).is('deleted_at', null).limit(5000), 'devis du bureau');
  const nbDevis = (s: string): number => tousDevis.filter((d) => d.status === s).length;
  f.mesures.devis = { brouillon_nombre: nbDevis('draft'), en_attente_nombre: nbDevis('awaiting_response'), acceptes_nombre: nbDevis('approved'), refuses_nombre: nbDevis('declined') };
  const tousClients = await lire<Array<{ status: string }>>(db.from('clients').select('status').eq('org_id', ORG).is('deleted_at', null).limit(5000), 'clients du bureau');
  f.mesures.clients = { nombre: tousClients.filter((c) => c.status === 'active').length };
  f.mesures.prospects = { nombre: tousClients.filter((c) => c.status === 'lead').length };

  // ── Rentabilité des jobs terminées du jeu, à partir des lignes brutes ──
  const terminees = JOBS.filter((j) => j.statut === 'completed');
  const idsTerminees = terminees.map((j) => idJob(j.cle));
  const [pointagesJobs, commissions, dossiers] = await Promise.all([
    lire<PointageLu[]>(db.from('time_entries').select('job_id, employee_id, punch_in_at, punch_out_at, breaks').eq('org_id', ORG).eq('status', 'completed').in('job_id', idsTerminees), 'pointages des jobs'),
    lire<Array<{ job_id: string; amount: number }>>(db.from('fs_commission_entries').select('job_id, amount').eq('org_id', ORG).is('deleted_at', null).neq('status', 'reversed').in('job_id', idsTerminees), 'commissions des jobs'),
    lire<Array<{ id: string }>>(db.from('custom_field_folders').select('id').eq('org_id', ORG).eq('object_type', 'job').eq('cle_systeme', 'depenses'), 'dossier Dépenses'),
  ]);
  const champsDepenses = dossiers.length
    ? await lire<Array<{ id: string }>>(db.from('custom_fields').select('id').eq('org_id', ORG).eq('object_type', 'job').eq('field_type', 'monetary').is('archived_at', null).in('folder_id', dossiers.map((d) => d.id)), 'champs Dépenses')
    : [];
  const valeurs = champsDepenses.length
    ? await lire<Array<{ job_id: string; value_money_cents: number | null }>>(db.from('custom_field_values').select('job_id, value_money_cents').eq('org_id', ORG).in('field_id', champsDepenses.map((c) => c.id)).in('job_id', idsTerminees).not('value_money_cents', 'is', null), 'dépenses des jobs')
    : [];
  for (const j of terminees) {
    const id = idJob(j.cle);
    const job = jobs.find((x) => x.id === id);
    if (!job) continue;
    const facturesJob = factures.filter((x) => x.job_id === id && ['sent', 'partial', 'paid'].includes(x.status));
    const revenus = facturesJob.length ? facturesJob.reduce((s, x) => s + nombre(x.subtotal_cents) - nombre(x.discount_cents), 0) : nombre(job.subtotal_cents);
    let mainOeuvre = 0;
    let h = 0;
    for (const t of pointagesJobs.filter((x) => x.job_id === id)) {
      const m = equipe.find((e) => e.user_id === t.employee_id);
      const taux = m ? (nombre(m.hourly_rate_cents) > 0 ? nombre(m.hourly_rate_cents) : nombre(Number(m.labour_cost_hourly ?? 0) * 100)) : 0;
      h += heuresDe(t);
      if (m && m.compensation_mode !== 'commission') mainOeuvre += heuresDe(t) * taux;
    }
    const champs = valeurs.filter((x) => x.job_id === id);
    const r = rentabiliteDe({
      revenus, mainOeuvre: Math.round(mainOeuvre), heures: h,
      commissions: commissions.filter((x) => x.job_id === id).reduce((s, x) => s + nombre(Number(x.amount) * 100), 0),
      depenses: champs.length ? champs.reduce((s, x) => s + nombre(x.value_money_cents), 0) : nombre(job.expenses_cents),
    });
    comparer(`rentabilité de ${j.cle}, profit`, f.rentabilite[j.cle].profit_cents, r.profit_cents);
    f.rentabilite[j.cle] = r;
  }

  f.ecarts = ecarts;
  return f;
}

/* ══ Déroulé ═══════════════════════════════════════════════════════════ */

if (!FIXTURE_SEULE) {
  await semerEquipe();
  await semerClients();
  await semerJobs();
  await semerDepenses();
  await semerPointages();
  await semerDevis();
  await semerFactures();
  await semerCommissions();
  await semerDivers();
  console.log(`\nBilan : ${compte.creees} créées, ${compte.presentes} déjà là, ${compte.restaurees} restaurées, ${compte.replacees} visites replacées, ${compte.corrigees} corrigées${APPLIQUER ? '' : `, ${compte.a_creer} à créer`}.`);
}

if (APPLIQUER || FIXTURE_SEULE) {
  const f = await fixtureReelle();
  ecrireFixture(f);
  if (f.ecarts.length) console.log(`\nÉCARTS entre le plan et la base (${f.ecarts.length}) — à lire avant de lancer la batterie :\n - ${f.ecarts.join('\n - ')}`);
  else console.log('Aucun écart entre le plan et la base.');
} else {
  console.log('\nRien n’a été écrit. Pour écrire : relancer avec --appliquer.');
}
if (avertissements.length) console.log(`\nAvertissements (${avertissements.length}) :\n - ${avertissements.join('\n - ')}`);
process.exit(0);
