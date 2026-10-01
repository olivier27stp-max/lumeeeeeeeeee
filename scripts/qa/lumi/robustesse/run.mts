/**
 * Robustesse des conversations de Lumi — LE LANCEUR (phase 4 de la mission « Lumi fiable »).
 * ─────────────────────────────────────────────────────────────────────────
 * Tourne en PRODUCTION, contre https://lumecrm.net, dans le bureau de test « [TEST] QA Lumi éval 3 — ne pas
 * utiliser ». Huit familles : conversation longue, références implicites, revirements, reprise après une coupure,
 * deux appareils en même temps, entrées inhabituelles, vocal, pannes. Chaque test dit ce qu'il a fait, ce qu'il a
 * observé, et rend PASS, FAIL, NON COUVERT ou A RELIRE avec la preuve. Tout est jugé par du code.
 *
 *   npx tsx scripts/qa/lumi/robustesse/run.mts --plan [--famille longue,reprise]
 *        Liste ce qui serait fait, les envois par compte et le coût estimé. N'appelle rien, n'écrit rien, ne lit aucune variable.
 *
 *   node --env-file=C:/Users/Rafba/lumeeeeeeeeee/.env.local --import tsx scripts/qa/lumi/robustesse/run.mts
 *        [--famille <nom>[,<nom>]]   une ou plusieurs familles (longue, references, revirement, reprise, simultane, entrees, vocal, pannes)
 *        [--test <id>[,<id>]]        un ou plusieurs tests
 *        [--org <id>]                le bureau de test (défaut : éval 3 ; connu aussi : éval 2)
 *        [--proprietaire <courriel>] un seul compte propriétaire pour toutes les familles retenues (défaut : un compte par famille)
 *        [--max-appels 55]           envois à Lumi permis par compte dans la passe (le serveur en accepte 60 par heure et par personne, refus compris)
 *        [--malgre-activite]         lancer même si le bureau a servi dans les 3 dernières minutes ou si un compte est déjà en mode « demander »
 *        [--malgre-palier]           jouer la conversation longue même si le bureau n'est pas au palier normal
 *        [--sans-garde-horaire]      ne pas refuser d'après le compte des tours déjà tracés dans l'heure
 *        [--sortie evals/lumi/resultats/robustesse-<date>]   base des fichiers .json et .md ; un fichier déjà là est COMPLÉTÉ
 *                                    (un test rejoué remplace son ancien résultat), sauf avec --neuf
 *        --regenerer [--note "…"]    réécrit le .md à partir du .json de --sortie, sans rien appeler
 *        --remettre                  après une passe tuée : remet le mode Lumi des comptes
 *        --nettoyer                  après une passe tuée : met les tâches [ROB] à la corbeille (suppression douce)
 *
 * Garde-fous, vérifiés AVANT la première écriture :
 *  - le bureau a un nom de bureau de test ET est inscrit au bac à sable des envois (`orgs_envois_simules`) — sinon refus ;
 *  - chaque compte est membre actif du bureau, au rôle attendu ;
 *  - le budget d'envois tient dans la limite horaire, compte tenu des tours déjà faits dans l'heure ;
 *  - aucune autre batterie ne tourne (aucune trace de Lumi dans les 3 dernières minutes hors de nos conversations,
 *    aucun compte déjà en mode « demander », aucun fichier d'état d'une autre batterie).
 * Écritures de la batterie : `memberships.lumi_mode` des comptes propriétaires (« demander » le temps de la passe,
 * état d'origine écrit sur disque AVANT, remis à la fin même en cas d'erreur), et des tâches [ROB] (mises à la
 * corbeille à la fin). La batterie ne confirme JAMAIS une carte d'envoi, de paiement ou de suppression.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConfirmationRefusee, FluxInterrompu, LimiteAtteinte, clientService, connexionProd, creerClientLumi, fermerSession, ouvrirSession, sqlLectureSeule, type Connexion } from './acces.mts';
import { BUREAUX, ORG_DEFAUT, bureauDe, chargerFaits, sqlActiviteRecente, sqlBureau, sqlFuseau, sqlJeuPresent, sqlMembre, sqlModeles, sqlToursDansLHeure } from './faits.mts';
import { creerTacheRob, retirerFichesRob } from './fiches-rob.mts';
import { issueInterruption, serveurRedemarre } from './jugement.mts';
import { LIMITE_HORAIRE, appelsPrevus, bilanDe, compteDe, fusionner, ligneConsole, rapportMarkdown, selectionner, textePlan, type Lancement, type Passe, type Selection } from './rapport.mts';
import type { Compte, CompteProprietaire, Contexte, Famille, Issue, Resultat, Sante, Session, TestRobustesse } from './types.mts';
import { COMPTES } from './types.mts';
import { longue } from './familles/longue.mts';
import { references } from './familles/references.mts';
import { revirement } from './familles/revirement.mts';
import { reprise } from './familles/reprise.mts';
import { simultane } from './familles/simultane.mts';
import { entrees } from './familles/entrees.mts';
import { vocal } from './familles/vocal.mts';
import { pannes } from './familles/pannes.mts';

export const FAMILLES: Famille[] = [longue, references, revirement, reprise, simultane, entrees, vocal, pannes];

const API = 'https://lumecrm.net';
const NOM_DE_TEST = /\b(QA|TEST)\b|\bbanc\b/i;

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const DOSSIER = join(RACINE, 'evals', 'lumi', 'resultats');
const FICHIER_ETAT = join(DOSSIER, '.etat-robustesse.json');
/** Conversations ouvertes par les lancements précédents de cette batterie : le garde « une autre batterie tourne » ne les compte pas. */
const FICHIER_CONVERSATIONS = join(DOSSIER, '.robustesse-conversations.json');
/** Les fichiers d'état des autres batteries : non vides tant qu'elles tournent (ou qu'elles ont été tuées). */
const ETATS_DES_AUTRES = [join(RACINE, 'evals', 'lumi-tools', 'resultats', '.etat-prod.json'), join(DOSSIER, '.etat-critiques.json')];
const lireTexte = (fichier: string): string => { try { return readFileSync(fichier, 'utf8').trim(); } catch { return ''; } };
const lireJson = <T,>(fichier: string, defaut: T): T => { try { const t = lireTexte(fichier); return t ? (JSON.parse(t) as T) : defaut; } catch { return defaut; } };

const drapeau = (k: string): boolean => process.argv.includes(k);
const arg = (k: string, d = ''): string => { const i = process.argv.indexOf(k); const v = i > -1 ? process.argv[i + 1] : undefined; return v && !v.startsWith('--') ? v : d; };
const liste = (k: string): string[] => arg(k).split(',').map((x) => x.trim()).filter(Boolean);
const attendre = (ms: number): Promise<void> => new Promise((ok) => setTimeout(ok, ms));
const dire = (texte: string): void => { console.log(texte); };

interface EtatModes { org: string; modes: Array<{ compte: Compte; user_id: string; lumi_mode: string | null }> }

async function remettreModes(cx: Connexion, etat: EtatModes): Promise<string[]> {
  const admin = clientService(cx);
  const journal: string[] = [];
  for (const m of etat.modes) {
    const { error } = await admin.from('memberships').update({ lumi_mode: m.lumi_mode ?? 'argent' }).eq('org_id', etat.org).eq('user_id', m.user_id);
    journal.push(error ? `ÉCHEC — ${m.compte} : ${error.message}` : `${m.compte} : remis à « ${m.lumi_mode ?? 'argent'} »`);
  }
  try { writeFileSync(FICHIER_ETAT, ''); } catch { /* rien à effacer */ }
  return journal;
}

function resultatDe(famille: Famille, t: TestRobustesse, issue: Issue, duree: number): Resultat {
  return {
    id: t.id, famille: famille.nom, titre: t.titre, fait: t.fait, si_defaut: t.si_defaut, lignes: t.lignes, duree_ms: duree,
    ...(t.attente_discutable ? { attente_discutable: t.attente_discutable } : {}), ...(t.non_couvert?.couvert_par.length ? { couvert_par: t.non_couvert.couvert_par } : {}), ...issue,
  };
}

async function main(): Promise<void> {
  const org = arg('--org', ORG_DEFAUT).toLowerCase();
  const bureau = bureauDe(org);
  if (!bureau) throw new Error(`REFUS : bureau inconnu de la batterie (${org}). Connus : ${BUREAUX.map((b) => `${b.cle} ${b.org}`).join(', ')}.`);
  const courrielProprietaire = arg('--proprietaire');
  const proprietaire = courrielProprietaire ? (COMPTES.find((c) => c !== 'technicien' && bureau.comptes[c] === courrielProprietaire) as CompteProprietaire | undefined) : undefined;
  if (courrielProprietaire && !proprietaire) throw new Error(`REFUS : --proprietaire doit être un compte propriétaire de test de ce bureau (${COMPTES.filter((c) => c !== 'technicien').map((c) => bureau.comptes[c]).join(', ')}).`);
  const selection: Selection = { familles: liste('--famille'), tests: liste('--test'), proprietaire: proprietaire ?? null };
  const inconnues = (selection.familles ?? []).filter((n) => !FAMILLES.some((f) => f.nom === n));
  if (inconnues.length) throw new Error(`famille inconnue : ${inconnues.join(', ')} (connues : ${FAMILLES.map((f) => f.nom).join(', ')})`);
  const choix = selectionner(FAMILLES, selection);
  const tests = choix.flatMap((c) => c.tests);
  const maxDemande = Math.max(1, Math.min(LIMITE_HORAIRE, Number(arg('--max-appels', '55')) || 55));

  // ── --plan : ni réseau, ni base, ni variable d'environnement ──
  if (drapeau('--plan')) { dire(textePlan(choix, { maxParCompte: maxDemande, selection, comptes: bureau.comptes, familles: FAMILLES })); return; }

  mkdirSync(DOSSIER, { recursive: true });
  // ── --regenerer : le rapport lisible refait à partir des données, sans réseau ──
  if (drapeau('--regenerer')) {
    const base = arg('--sortie', join(DOSSIER, `robustesse-${new Date().toISOString().slice(0, 10)}`));
    const donnees = lireJson<(Passe & { resultats: Resultat[] }) | null>(`${base}.json`, null);
    if (!donnees) throw new Error(`rien à régénérer : ${base}.json est absent ou illisible`);
    const notes = process.argv.flatMap((x, i) => (x === '--note' && process.argv[i + 1] ? [process.argv[i + 1]] : []));
    donnees.notes = [...new Set([...(donnees.notes ?? []), ...notes])];
    writeFileSync(`${base}.json`, JSON.stringify({ ...donnees, bilan: bilanDe(donnees.resultats) }, null, 1));
    writeFileSync(`${base}.md`, rapportMarkdown(donnees, FAMILLES, donnees.resultats));
    dire(`Rapport régénéré : ${base}.md (${donnees.resultats.length} tests, ${donnees.notes.length} constat(s) de passe)`);
    return;
  }
  const cx = await connexionProd();

  if (drapeau('--remettre')) {
    const brut = lireTexte(FICHIER_ETAT);
    if (!brut) { dire('rien à remettre'); return; }
    for (const l of await remettreModes(cx, JSON.parse(brut) as EtatModes)) dire(l);
    return;
  }
  const admin = clientService(cx);
  const sql = sqlLectureSeule(cx);

  // ── Garde-fous du bureau (lecture seule) — aussi avant --nettoyer ──
  const [b] = await sql<{ id: string; name: string; bac: string | null }>(sqlBureau(org));
  if (!b || !NOM_DE_TEST.test(b.name)) throw new Error(`REFUS : le bureau « ${b?.name ?? org} » n’a pas un nom de bureau de test.`);
  if (!b.bac) throw new Error(`REFUS : « ${b.name} » n’est pas inscrit au bac à sable des envois (orgs_envois_simules). Sans lui, un envoi de test partirait pour vrai.`);

  if (drapeau('--nettoyer')) {
    const m = await retirerFichesRob(admin, org);
    for (const l of m.fait) dire(l);
    for (const l of m.erreurs) dire(`ÉCHEC — ${l}`);
    return;
  }
  if (!tests.length) throw new Error('aucun test retenu par --famille / --test');
  dire(`PROD — bureau « ${b.name} » (bac à sable : ${b.bac}), API ${API}`);
  const faits = chargerFaits(RACINE, org);

  if (!drapeau('--malgre-activite')) {
    for (const f of ETATS_DES_AUTRES) if (lireTexte(f)) throw new Error(`REFUS : ${f} n’est pas vide — une autre batterie tourne (ou a été tuée : la remettre avec son --remettre). Forcer : --malgre-activite.`);
    if (lireTexte(FICHIER_ETAT)) throw new Error('REFUS : un lancement précédent de cette batterie n’a pas remis le mode Lumi des comptes (passe tuée ?). Lancer d’abord --remettre, puis --nettoyer. Forcer : --malgre-activite.');
  }
  const dejaOuvertes = lireJson<string[]>(FICHIER_CONVERSATIONS, []).filter((x) => /^[0-9a-f-]{36}$/i.test(x));
  const [activite] = await sql<{ traces: number; derniere: string | null }>(sqlActiviteRecente(org, 3, dejaOuvertes));
  if (Number(activite?.traces) > 0 && !drapeau('--malgre-activite')) {
    throw new Error(`REFUS : Lumi a servi ${activite.traces} fois dans ce bureau depuis 3 minutes (dernière : ${activite.derniere}). Une autre batterie tourne peut-être : attendre, ou relancer avec --malgre-activite.`);
  }

  // ── Les comptes de la passe : ceux des familles retenues, et le technicien si un test s'en sert ──
  const proprietaires = [...new Set(choix.map((c) => compteDe(c.famille, selection)))];
  const besoinTechnicien = tests.some((t) => (t.appels.technicien ?? 0) > 0 && !t.non_couvert);
  const sessions = new Map<Compte, Session>();
  const secondes = new Map<Compte, Session>();
  const fermerTout = async (): Promise<void> => { for (const s of [...sessions.values(), ...secondes.values()]) await fermerSession(admin, s); };
  const etat: EtatModes = { org, modes: [] };
  const restant = Object.fromEntries(COMPTES.map((c) => [c, 0])) as Record<Compte, number>;
  const prevus = appelsPrevus(choix, selection, 'budget');
  try {
    for (const compte of proprietaires) {
      const s = await ouvrirSession(cx, admin, compte, bureau.comptes[compte]);
      sessions.set(compte, s);
      const [m] = await sql<{ lumi_mode: string | null; role: string; status: string }>(sqlMembre(org, s.userId));
      if (!m || m.status !== 'active' || m.role !== 'owner') throw new Error(`REFUS : ${s.courriel} n’est pas propriétaire actif du bureau (rôle ${m?.role}, statut ${m?.status}).`);
      etat.modes.push({ compte, user_id: s.userId, lumi_mode: m.lumi_mode });
      const [tours] = await sql<{ tours: number }>(sqlToursDansLHeure(org, s.userId));
      restant[compte] = drapeau('--sans-garde-horaire') ? maxDemande : Math.max(0, Math.min(maxDemande, LIMITE_HORAIRE - Number(tours?.tours ?? 0)));
      dire(`${compte} : ${s.courriel}, mode Lumi « ${m.lumi_mode} », ${tours?.tours ?? 0} tour(s) tracé(s) dans l’heure, ${prevus[compte]} envoi(s) prévus, ${restant[compte]} permis`);
      if (prevus[compte] > restant[compte]) throw new Error(`REFUS : ${prevus[compte]} envois prévus pour ${compte}, ${restant[compte]} permis dans l’heure. Découper avec --famille, ou attendre.`);
      // Le mode de repos d'un compte est « argent ». « demander » au départ = une autre batterie l'a posé et le remettra à sa fin, en plein milieu de celle-ci.
      if (m.lumi_mode === 'demander') {
        if (!drapeau('--malgre-activite')) throw new Error(`REFUS : ${s.courriel} est déjà en mode « demander » — une autre batterie tourne sans doute (ou a été tuée : la remettre d’abord). Forcer : --malgre-activite ; c’est alors « demander » qui sera remis à la fin.`);
        dire(`  ATTENTION : ${compte} est DÉJÀ en mode « demander » — c’est cet état qui sera remis à la fin.`);
      }
    }
    if (besoinTechnicien) {
      const s = await ouvrirSession(cx, admin, 'technicien', bureau.comptes.technicien);
      sessions.set('technicien', s);
      const [m] = await sql<{ role: string; status: string }>(sqlMembre(org, s.userId));
      if (!m || m.status !== 'active' || m.role !== 'technician') throw new Error(`REFUS : ${s.courriel} n’est pas technicien actif du bureau (rôle ${m?.role}, statut ${m?.status}).`);
      dire(`technicien : ${s.courriel} — compte dédié au test de la limite horaire (il y restera limité une heure)`);
    }
    restant.technicien = maxDemande;

    const idsClients = faits.clients().map((c) => c.id);
    const idsFactures = ['payee', 'partielle', 'en_retard', 'envoyee', 'en_retard_ancienne', 'payee_cheque', 'brouillon'].map((cle) => faits.facture(cle).id);
    const [jeu] = await sql<{ clients: number; factures: number }>(sqlJeuPresent(org, idsClients, idsFactures));
    const jeuPresent = Number(jeu?.clients) === idsClients.length && Number(jeu?.factures) === idsFactures.length;
    dire(`jeu [EVAL] : ${jeuPresent ? 'présent' : `ABSENT ou incomplet (${JSON.stringify(jeu)} ; attendu ${idsClients.length} clients, ${idsFactures.length} factures) — les tests qui en dépendent seront NON COUVERT`}`);
    const [fz] = await sql<{ fuseau: string }>(sqlFuseau(org));
    const fuseau = fz?.fuseau ?? 'America/Toronto';

    // ── Mode « demander » : état d'origine écrit sur disque AVANT toute modification ──
    writeFileSync(FICHIER_ETAT, JSON.stringify(etat, null, 1));
    let remis: string[] | null = null;
    const remettre = async (): Promise<string[]> => { remis ??= await remettreModes(cx, etat); return remis; };
    const menager = async (): Promise<Passe['menage']> => {
      try { return await retirerFichesRob(admin, org); } catch (err) { return { fait: [], erreurs: [`ménage impossible : ${err instanceof Error ? err.message : String(err)}`] }; }
    };
    for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK'] as const) process.once(sig, () => { void menager().then(remettre).then(fermerTout).finally(() => process.exit(130)); });
    const poserDemander = async (): Promise<boolean> => {
      let change = false;
      for (const m of etat.modes) {
        const [actuel] = await sql<{ lumi_mode: string | null }>(sqlMembre(org, m.user_id));
        if (actuel?.lumi_mode === 'demander') continue;
        const { error } = await admin.from('memberships').update({ lumi_mode: 'demander' }).eq('org_id', org).eq('user_id', m.user_id);
        if (error) throw new Error(`mode « demander » de ${m.compte} : ${error.message}`);
        change = true;
      }
      return change;
    };

    const lumi = creerClientLumi({ api: API, org, cx, maxParCompte: restant, dire });
    const debut = new Date();
    const nonce = Date.now().toString(36).slice(-5).toUpperCase();
    const SORTIE = arg('--sortie', join(DOSSIER, `robustesse-${debut.toISOString().slice(0, 10)}`));
    // Un rapport déjà là est complété : la batterie se joue famille par famille.
    const avant = drapeau('--neuf') ? null : lireJson<(Passe & { resultats: Resultat[] }) | null>(`${SORTIE}.json`, null);
    const tachesRob: string[] = [];
    let compteCourant: CompteProprietaire = proprietaires[0];
    let palierCourant: string | null = null;
    const session = (c: Compte): Session => { const s = sessions.get(c); if (!s) throw new Error(`aucune session ouverte pour le compte ${c}`); return s; };

    const ctx: Contexte = {
      api: API, org, nomOrg: b.name, fuseau, sql, admin, lumi, faits, nonce, debut, jeuPresent, dire, attendre,
      get palier() { return palierCourant; },
      proprietaire: () => session(compteCourant),
      async secondeSession() {
        const deja = secondes.get(compteCourant);
        if (deja) return deja;
        const premiere = session(compteCourant);
        const s = await ouvrirSession(cx, admin, compteCourant, premiere.courriel, 'mobile');
        secondes.set(compteCourant, s);
        if (s.jeton === premiere.jeton) throw new Error('la seconde connexion a rendu le même jeton que la première : « deux appareils » ne peut pas être joué');
        const r = await lumi.appel(premiere, 'GET', '/api/lumi/quota');
        if (r.statut !== 200) throw new Error(`la seconde connexion a fermé la première session (statut ${r.statut}) : « deux appareils » ne peut pas être joué`);
        return s;
      },
      technicien: async () => session('technicien'),
      async creerTacheRob(titre) {
        const t = await creerTacheRob(admin, org, session(compteCourant).userId, titre);
        tachesRob.push(t.id);
        return t;
      },
      idsTachesRob: () => [...tachesRob],
      conversationsDeLaBatterie: () => [...new Set([...(avant?.conversations ?? []), ...dejaOuvertes, ...lumi.conversations()])].filter((x) => /^[0-9a-f-]{36}$/i.test(x)),
    };

    const resultats: Resultat[] = [];
    const paliers: Record<string, string | null> = {};
    const redemarrages: string[] = [...(avant?.redemarrages ?? [])];
    const tousLesResultats = (): Resultat[] => fusionner(FAMILLES, avant?.resultats ?? [], resultats);
    const comptesDuLancement = Object.fromEntries([...sessions.entries()].map(([c, s]) => [c, s.courriel])) as Partial<Record<Compte, string>>;
    const passe = (menage: Passe['menage'], mode: string[]): Passe => {
      const ici: Lancement = { date: debut.toISOString(), familles: choix.map((c) => c.famille.nom), comptes: comptesDuLancement, appels: lumi.compteurs(), paliers };
      const lancements = [...(avant?.lancements ?? []), ici];
      return {
        date: lancements[0].date, api: API, org, nom_org: b.name, jeu_present: jeuPresent, menage, mode, selection, lancements,
        appels: Object.fromEntries(COMPTES.map((c) => [c, lancements.reduce((n, x) => n + (x.appels[c] ?? 0), 0)])) as Record<Compte, number>,
        conversations: ctx.conversationsDeLaBatterie(),
        ...(redemarrages.length ? { redemarrages } : {}),
        ...(avant?.notes?.length ? { notes: avant.notes } : {}),
      };
    };
    const ecrire = (p: Passe, partiel: boolean): void => {
      const tous = tousLesResultats();
      writeFileSync(`${SORTIE}.json.tmp`, JSON.stringify({ ...p, partiel, bilan: bilanDe(tous), resultats: tous }, null, 1));
      renameSync(`${SORTIE}.json.tmp`, `${SORTIE}.json`);
      writeFileSync(FICHIER_CONVERSATIONS, JSON.stringify(ctx.conversationsDeLaBatterie()));
      if (!partiel) writeFileSync(`${SORTIE}.md`, rapportMarkdown(p, FAMILLES, tous));
    };

    /** Joue UN test, et traduit ce qui n'est pas un défaut de Lumi (limite, redéploiement, refus de la batterie) en NON COUVERT. */
    const jouer = async (t: TestRobustesse): Promise<Issue> => {
      if (t.non_couvert || !t.executer) return { verdict: 'NON COUVERT', constats: [t.non_couvert?.raison ?? 'test sans exécution'], preuves: [] };
      const debutTest = Date.now();
      let issue: Issue;
      try {
        issue = await t.executer(ctx);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (err instanceof FluxInterrompu) {
          const sante = await lumi.sante();
          const j = issueInterruption({ cause: err.cause_interruption, detail: err.detail, debut_test_ms: debutTest, sante });
          if (serveurRedemarre(sante, debutTest)) redemarrages.push(`${new Date().toISOString()} (pendant ${t.id})`);
          const p = err.partiel;
          return { ...j, preuves: p ? [{ libelle: 'ce qui avait été reçu avant l’interruption', contenu: `${p.evenements.length} événement(s) ; texte : ${p.texte.slice(0, 400) || '(aucun)'}` }] : [] };
        }
        if (err instanceof LimiteAtteinte) return { verdict: 'NON COUVERT', constats: [message], preuves: [] };
        if (err instanceof ConfirmationRefusee) return { verdict: 'NON COUVERT', constats: [message, 'la carte est restée en attente ; elle expire seule au bout de 15 minutes et le message suivant de la conversation l’annule'], preuves: [] };
        // Une erreur de la batterie (réseau, bogue du test) n'est pas un défaut de Lumi : NON COUVERT, avec l'erreur.
        return { verdict: 'NON COUVERT', constats: [`erreur de la batterie : ${message.slice(0, 300)}`], preuves: [] };
      }
      // Un défaut constaté pendant qu'un redéploiement remettait le serveur à zéro n'est pas un défaut de Lumi.
      if (issue.verdict === 'FAIL') {
        const sante: Sante = await lumi.sante();
        if (serveurRedemarre(sante, debutTest)) {
          redemarrages.push(`${new Date().toISOString()} (pendant ${t.id})`);
          return { ...issue, verdict: 'NON COUVERT', constats: [`redéploiement : le serveur a redémarré pendant le test (${sante.ok ? `en marche depuis ${Math.round(sante.uptime_s ?? 0)} s` : 'injoignable'}) — à rejouer`, ...issue.constats.map((c) => `(observé pendant le redémarrage) ${c}`)] };
        }
      }
      return issue;
    };

    let menage: Passe['menage'] = { fait: [], erreurs: [] };
    let modes: string[] = [];
    try {
      const depart = await lumi.sante();
      dire(`serveur : ${depart.ok ? `en marche depuis ${Math.round((depart.uptime_s ?? 0) / 60)} min` : 'santé illisible'}`);
      if (await poserDemander()) { dire('mode « demander » posé ; attente de 35 s (cache de session du serveur)'); await attendre(35_000); }
      for (const { famille, tests: aJouer } of choix) {
        compteCourant = compteDe(famille, selection);
        dire(`\n${famille.titre} — compte ${compteCourant}`);
        // Une autre session a pu remettre le mode en cours de route : on le repose avant chaque famille.
        if (await poserDemander()) { dire('  le mode « demander » avait été défait : reposé ; attente de 35 s'); await attendre(35_000); }
        const q = await lumi.appel(session(compteCourant), 'GET', '/api/lumi/quota').catch(() => null);
        palierCourant = q?.json && typeof q.json === 'object' ? String((q.json as { credits?: { palier?: string } }).credits?.palier ?? '') || null : null;
        paliers[famille.nom] = palierCourant;
        dire(`  palier de crédits du bureau : « ${palierCourant ?? 'inconnu'} »`);
        const palierInsuffisant = famille.besoin_palier_normal === true && palierCourant !== 'normal' && !drapeau('--malgre-palier');
        for (const t of aJouer) {
          const debutTest = Date.now();
          const issue: Issue = palierInsuffisant && !t.non_couvert
            ? { verdict: 'NON COUVERT', constats: [`palier « ${palierCourant ?? 'inconnu'} » : hors du palier normal, le serveur ne rejoue que 6 messages d’historique et répond avec le modèle de repli — la famille ne prouverait rien. Rejouer demain (le garde-fou journalier se lève à minuit), ou forcer avec --malgre-palier.`], preuves: [] }
            : await jouer(t);
          const r = resultatDe(famille, t, issue, Date.now() - debutTest);
          resultats.push(r);
          dire(`  ${ligneConsole(r)}`);
          ecrire(passe(menage, modes), true);
        }
      }
    } finally {
      // Ménage et remise en état, quoi qu'il arrive.
      menage = await menager();
      modes = await remettre();
    }
    // Qui a répondu (modèle, étage, coût) sur toutes les conversations de la batterie, et le palier du bureau.
    const finale = passe(menage, modes);
    try {
      if (finale.conversations.length) {
        finale.modeles = (await sql<{ modele: string; etage: number | null; tours: number; cout_cents: number }>(sqlModeles(org, finale.conversations)))
          .map((m) => ({ modele: String(m.modele), etage: m.etage === null ? null : Number(m.etage), tours: Number(m.tours), cout_cents: Number(m.cout_cents ?? 0) }));
      }
      const q = await lumi.appel(session(compteCourant), 'GET', '/api/lumi/quota');
      finale.palier = q.json && typeof q.json === 'object' ? String((q.json as { credits?: { palier?: string } }).credits?.palier ?? '') || null : null;
    } catch (err) { dire(`modèles de la passe illisibles : ${err instanceof Error ? err.message : String(err)}`); }
    ecrire(finale, false);

    const bilan = bilanDe(resultats);
    dire(`\nBILAN de ce lancement : ${bilan.par_verdict.PASS} PASS, ${bilan.par_verdict.FAIL} FAIL, ${bilan.par_verdict['NON COUVERT']} NON COUVERT, ${bilan.par_verdict['A RELIRE']} A RELIRE — sur ${bilan.total} tests`);
    dire(`Envois à Lumi : ${COMPTES.filter((c) => lumi.compteurs()[c]).map((c) => `${c} ${lumi.compteurs()[c]}`).join(', ') || 'aucun'}`);
    if (finale.modeles?.length) dire(`Coût d’inférence relu dans les traces (toutes conversations du rapport) : ${(finale.modeles.reduce((n, m) => n + m.cout_cents, 0) / 100).toFixed(2)} $`);
    for (const l of modes) dire(`mode Lumi — ${l}`);
    for (const l of menage.fait) dire(`ménage — ${l}`);
    for (const l of menage.erreurs) dire(`ménage — ÉCHEC — ${l}`);
    dire(`Rapport : ${SORTIE}.md\nDonnées : ${SORTIE}.json`);
    process.exitCode = bilan.par_verdict.FAIL ? 1 : 0;
  } finally {
    await fermerTout();
  }
}

if (process.argv[1] && /robustesse[\\/]run\.mts$/.test(process.argv[1])) {
  main().then(() => process.exit(process.exitCode ?? 0)).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
}
