/**
 * Batterie de l'agent de SUPPORT — LE LANCEUR.
 * ─────────────────────────────────────────────────────────────────────────
 * Tourne en PRODUCTION, contre https://lumecrm.net, dans le bureau de test
 * « [TEST] QA Lumi éval 3 — ne pas utiliser ». Neuf familles : base de connaissances,
 * tarifs, fonctions qui n'existent pas, escalade, données du compte, aucune action dans le
 * CRM, injection, langue, coût. Chaque test dit ce qu'il a fait, ce qu'il a observé, et rend
 * PASS, FAIL, NON COUVERT ou A RELIRE avec la preuve. Tout est jugé par du code.
 *
 *   npx tsx scripts/qa/lumi/support/run.mts --plan [--famille kb,tarifs] [--compte proprio1,proprio2]
 *        Liste ce qui serait fait : les tests, le compte de chacun, l'étage prévu, les appels par
 *        compte et le coût estimé. N'appelle rien, n'écrit rien, ne lit aucune variable.
 *
 *   node --env-file=C:/Users/Rafba/lumeeeeeeeeee/.env.local --import tsx scripts/qa/lumi/support/run.mts --resume-slack-accepte
 *        [--famille <nom>[,<nom>]]   kb, tarifs, inexistant, escalade, donnees, pas-d-action, injection, langue, cout
 *        [--test <id>[,<id>]]        un ou plusieurs tests (le canari passe quand même en premier)
 *        [--org <uuid>]              un autre bureau de test (défaut : éval 3)
 *        [--compte <clé|courriel>[,…]]  les comptes qui posent les questions (défaut : proprio1 à proprio4 et tech, soit
 *                                    eval3.<clé>@lume-qa.test ; --prefixe eval2 pour un autre bureau)
 *        [--max-appels 55]           appels au chat permis par compte dans la passe (le serveur en accepte 60 par heure et par personne)
 *        [--sortie evals/lumi/resultats/support-<date>]   base des fichiers .json et .md ; un fichier déjà là est COMPLÉTÉ
 *                                    (un test rejoué remplace son ancien résultat), sauf avec --neuf
 *        [--malgre-plafond]          partir même si les réponses du modèle prévues dépassent le plafond du jour (les questions
 *                                    servies par la réponse fixe du plafond seront NON COUVERT)
 *        [--malgre-activite]         partir même si Lumi a servi le bureau dans les 3 dernières minutes
 *        --regenerer [--note "…"]    réécrit le .md à partir du .json de --sortie, sans rien appeler
 *        --fermer                    après une passe tuée : ferme les tickets que la batterie a laissés ouverts
 *
 * Garde-fous, vérifiés AVANT la première question :
 *  - le bureau a un nom de bureau de test ET est inscrit au bac à sable des envois en mode « succes » — sinon refus ;
 *  - chaque compte est une adresse @lume-qa.test, membre actif de ce seul bureau ;
 *  - le budget d'appels tient dans la limite horaire, et les réponses du modèle prévues dans le plafond du jour ;
 *  - --resume-slack-accepte : le résumé quotidien du support (7 h, canal Slack de l'équipe) liste TOUTES les
 *    conversations de la veille, bureaux de test compris. La batterie ne peut pas l'empêcher : il faut le savoir ;
 *  - LE CANARI : une demande de transfert direct (aucun modèle), puis par SELECT : aucun fil ni canal Slack sur
 *    le ticket, « escalated:email » et non « escalated:slack », une ligne envois_simules, aucun canal Slack créé.
 *    Canari non concluant → ARRÊT avant toute autre question, message en tête du rapport.
 * Pendant la passe : arrêt immédiat si un ticket porte un fil Slack ou si le modèle appelle l'outil de migration.
 * Écritures : celles du produit (tickets, messages, traces, grand livre, courriels consignés au bac à sable).
 * Les tickets sont fermés à la fin par l'API du support ; aucune suppression.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ArretImmediat, LimiteAtteinte, clientService, connexionProd, creerClientSupport, fermerSession, ouvrirSession, sqlLectureSeule } from './acces.mts';
import { sqlAdhesions, sqlBureau, sqlHorloge, sqlJeuPresent, sqlLumiRecent, sqlMessagesDansLHeure, sqlMigrations, sqlReponsesModele24h } from './faits.mts';
import { PLAFOND_MODELE_PAR_JOUR, reponsesModelePrevues } from './prevision.mts';
import { INTERVALLE_MS, LIMITE_HORAIRE, LOT_1, LOT_2, appelsParCompte, bilanDe, fusionner, ligneConsole, rapportMarkdown, repartir, selectionner, textePlan, type Lancement, type Passe, type Selection, type TicketDeLaPasse } from './rapport.mts';
import { creerPoser } from './tour.mts';
import type { Contexte, Famille, Issue, Resultat, Session, TestSupport, Tour } from './types.mts';
import { kb } from './familles/kb.mts';
import { tarifs } from './familles/tarifs.mts';
import { inexistant } from './familles/inexistant.mts';
import { ID_CANARI, canari, escalade } from './familles/escalade.mts';
import { donnees } from './familles/donnees.mts';
import { pasDAction } from './familles/pas-d-action.mts';
import { injection } from './familles/injection.mts';
import { langue } from './familles/langue.mts';
import { ID_COUT, cout } from './familles/cout.mts';

/**
 * L'ordre de jeu. « donnees » passe AVANT « pas-d-action » : le dossier du support porte les sujets
 * des cinq derniers tickets du bureau, et les demandes d'action nomment des clients du jeu [EVAL].
 */
export const FAMILLES: Famille[] = [kb, tarifs, inexistant, escalade, donnees, pasDAction, injection, langue, cout];

export { LOT_1, LOT_2 };

export const ORG_DEFAUT = '7f859087-0f5e-4604-8a20-315be43be4c3';
export const PREFIXE_DEFAUT = 'eval3';
export const DOMAINE_DE_TEST = 'lume-qa.test';
export const COMPTES_DEFAUT = ['proprio1', 'proprio2', 'proprio3', 'proprio4', 'tech'];
const API = 'https://lumecrm.net';
export const NOM_DE_TEST = /\b(QA|TEST)\b|\bbanc\b/i;

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const DOSSIER = join(RACINE, 'evals', 'lumi', 'resultats');
const FICHIER_ETAT = join(DOSSIER, '.etat-support.json');
const lireJson = <T,>(fichier: string, defaut: T): T => { try { const t = readFileSync(fichier, 'utf8').trim(); return t ? (JSON.parse(t) as T) : defaut; } catch { return defaut; } };

const drapeau = (k: string): boolean => process.argv.includes(k);
const arg = (k: string, d = ''): string => { const i = process.argv.indexOf(k); const v = i > -1 ? process.argv[i + 1] : undefined; return v && !v.startsWith('--') ? v : d; };
const liste = (k: string): string[] => arg(k).split(',').map((x) => x.trim()).filter(Boolean);
const attendre = (ms: number): Promise<void> => new Promise((ok) => setTimeout(ok, ms));
const dire = (texte: string): void => { console.log(texte); };

export interface CompteDeTest { cle: string; courriel: string }

/** `proprio1` → eval3.proprio1@lume-qa.test ; une adresse complète est gardée telle quelle. Toute adresse hors du domaine de test est refusée. */
export function comptesDemandes(valeurs: string[], prefixe: string = PREFIXE_DEFAUT): CompteDeTest[] {
  const out = (valeurs.length ? valeurs : COMPTES_DEFAUT).map((v): CompteDeTest => (v.includes('@')
    ? { cle: v.split('@')[0].replace(/^eval\d*\./, ''), courriel: v.toLowerCase() }
    : { cle: v, courriel: `${prefixe}.${v}@${DOMAINE_DE_TEST}` }));
  const dehors = out.filter((c) => !c.courriel.endsWith(`@${DOMAINE_DE_TEST}`));
  if (dehors.length) throw new Error(`REFUS : compte hors du domaine de test @${DOMAINE_DE_TEST} : ${dehors.map((c) => c.courriel).join(', ')}.`);
  if (new Set(out.map((c) => c.cle)).size !== out.length) throw new Error('REFUS : deux comptes portent la même clé.');
  return out;
}

interface Etat { org: string; tickets: TicketDeLaPasse[] }

function resultatDe(famille: Famille, t: TestSupport, issue: Issue, duree: number, compte: string | null): Resultat {
  return {
    id: t.id, famille: famille.nom, titre: t.titre, fait: t.fait, si_defaut: t.si_defaut, compte, duree_ms: duree,
    ...(t.attente_discutable ? { attente_discutable: t.attente_discutable } : {}), ...(t.non_couvert ? { couvert_par: t.non_couvert.couvert_par } : {}), ...issue,
  };
}

async function main(): Promise<void> {
  const selection: Selection = { familles: liste('--famille'), tests: liste('--test') };
  const inconnues = (selection.familles ?? []).filter((n) => !FAMILLES.some((f) => f.nom === n));
  if (inconnues.length) throw new Error(`famille inconnue : ${inconnues.join(', ')} (connues : ${FAMILLES.map((f) => f.nom).join(', ')})`);
  const choix = selectionner(FAMILLES, selection);
  const tests = choix.flatMap((c) => c.tests);
  const maxDemande = Math.max(1, Math.min(LIMITE_HORAIRE, Number(arg('--max-appels', '55')) || 55));
  const comptes = comptesDemandes(liste('--compte'), arg('--prefixe', PREFIXE_DEFAUT));
  const cles = comptes.map((c) => c.cle);

  // ── --plan : ni réseau, ni base, ni variable d'environnement ──
  if (drapeau('--plan')) { dire(textePlan(choix, { canari, comptes: cles, maxParCompte: maxDemande })); return; }

  mkdirSync(DOSSIER, { recursive: true });
  const SORTIE = arg('--sortie', join(DOSSIER, `support-${new Date().toISOString().slice(0, 10)}`));
  type Donnees = Passe & { resultats: Resultat[] };

  // ── --regenerer : le rapport lisible refait à partir des données, sans réseau ──
  if (drapeau('--regenerer')) {
    const donnees = lireJson<Donnees | null>(`${SORTIE}.json`, null);
    if (!donnees) throw new Error(`rien à régénérer : ${SORTIE}.json est absent ou illisible`);
    const notes = process.argv.flatMap((x, i) => (x === '--note' && process.argv[i + 1] ? [process.argv[i + 1]] : []));
    donnees.notes = [...new Set([...(donnees.notes ?? []), ...notes])];
    writeFileSync(`${SORTIE}.json`, JSON.stringify({ ...donnees, bilan: bilanDe(donnees.resultats) }, null, 1));
    writeFileSync(`${SORTIE}.md`, rapportMarkdown(donnees, FAMILLES, donnees.resultats));
    dire(`Rapport régénéré : ${SORTIE}.md (${donnees.resultats.length} tests, ${donnees.notes.length} constat(s) de passe)`);
    return;
  }

  const org = arg('--org', ORG_DEFAUT);
  const cx = await connexionProd();
  const admin = clientService(cx);
  const sql = sqlLectureSeule(cx);
  const sessions = new Map<string, Session>();
  const session = async (c: CompteDeTest): Promise<Session> => {
    const deja = sessions.get(c.cle);
    if (deja) return deja;
    const s = await ouvrirSession(cx, admin, c.cle, c.courriel);
    sessions.set(c.cle, s);
    return s;
  };
  const etat: Etat = { org, tickets: [] };
  const ecrireEtat = (): void => { try { writeFileSync(FICHIER_ETAT, etat.tickets.some((t) => !t.ferme) ? JSON.stringify(etat, null, 1) : ''); } catch { /* l'état n'est qu'un filet */ } };

  /** Ferme les tickets de la batterie : par l'API du support ; en repli, le seul statut, par identifiant. Les comptes avancent en parallèle, chacun à sa cadence. */
  const fermerTickets = async (support: ReturnType<typeof creerClientSupport>): Promise<void> => {
    const ouverts = etat.tickets.filter((t) => !t.ferme);
    await Promise.all([...new Set(ouverts.map((t) => t.compte))].map(async (cle) => {
      for (const t of ouverts.filter((x) => x.compte === cle)) {
        let statut = 0;
        try { statut = await support.fermer(await session({ cle: t.compte, courriel: t.courriel }), t.id); } catch (err) { t.fermeture = `API : ${err instanceof Error ? err.message : String(err)}`; }
        if (statut === 200) { t.ferme = true; t.fermeture = 'fermé par l’API du support'; } else {
          const { error } = await admin.from('support_tickets').update({ status: 'closed' }).eq('id', t.id).eq('org_id', org);
          t.ferme = !error;
          t.fermeture = error ? `ÉCHEC : API statut ${statut}, puis ${error.message}` : `statut « closed » posé par la clé de service (l’API a répondu ${statut || 'aucun statut'})`;
        }
        ecrireEtat();
      }
    }));
  };

  // ── --fermer : après une passe tuée ──
  if (drapeau('--fermer')) {
    const reste = lireJson<Etat | null>(FICHIER_ETAT, null);
    if (!reste?.tickets?.some((t) => !t.ferme)) { dire('aucun ticket à fermer'); return; }
    if (reste.org !== org) throw new Error(`REFUS : l’état sur disque est celui du bureau ${reste.org} — relancer avec --org ${reste.org}.`);
    etat.tickets = reste.tickets;
    const support = creerClientSupport({ api: API, org, cx, maxParCompte: {}, dire });
    try { await fermerTickets(support); } finally { for (const s of sessions.values()) await fermerSession(admin, s); }
    for (const t of etat.tickets) dire(`${t.id} (${t.compte}) : ${t.fermeture ?? (t.ferme ? 'déjà fermé' : 'non fermé')}`);
    return;
  }

  if (!tests.length) throw new Error('aucun test retenu par --famille / --test');
  const besoinChat = tests.some((t) => t.appels > 0);
  // Le canari passe d'abord, quelle que soit la sélection, dès qu'une question doit être posée.
  const aJouer: TestSupport[] = besoinChat ? [canari, ...tests.filter((t) => t.id !== ID_CANARI)] : tests;
  const repartition = repartir(aJouer, cles);

  // ── Garde-fous (lecture seule) ──
  const [bureau] = await sql<{ id: string; name: string; bac: string | null; forfait: string | null }>(sqlBureau(org));
  if (!bureau || !NOM_DE_TEST.test(bureau.name)) throw new Error(`REFUS : le bureau « ${bureau?.name ?? org} » n’a pas un nom de bureau de test.`);
  if (!bureau.bac) throw new Error(`REFUS : « ${bureau.name} » n’est pas inscrit au bac à sable des envois (orgs_envois_simules). Sans lui, une escalade écrirait à de vraies personnes.`);
  if (bureau.bac !== 'succes') throw new Error(`REFUS : « ${bureau.name} » est au bac à sable en mode « ${bureau.bac} » ; « succes » attendu (en panne simulée, le courriel d’escalade échoue et le canari ne prouve rien).`);
  dire(`PROD — bureau « ${bureau.name} » (bac à sable : ${bureau.bac}, forfait ${bureau.forfait ?? 'aucun'}), API ${API}`);
  if (besoinChat && !drapeau('--resume-slack-accepte')) {
    throw new Error('REFUS : le résumé quotidien du support (server/lib/support/resume-quotidien.ts, 7 h, canal Slack de l’équipe) liste toutes les conversations de la veille, bureaux de test compris : celles de cette batterie y paraîtront demain matin (40 lignes au plus, avec un extrait). La batterie ne peut pas l’empêcher. Relancer avec --resume-slack-accepte une fois que c’est su — ou exclure d’abord les bureaux du bac à sable de ce résumé.');
  }

  const [deja] = await sql<{ reponses: number }>(sqlReponsesModele24h(org));
  const dejaServies = Number(deja?.reponses ?? 0);
  const prevues = reponsesModelePrevues(aJouer);
  dire(`réponses du modèle : ${dejaServies} déjà servies au bureau en 24 h, ${prevues} prévues par cette sélection, plafond ${PLAFOND_MODELE_PAR_JOUR}`);
  if (besoinChat && dejaServies + prevues > PLAFOND_MODELE_PAR_JOUR && !drapeau('--malgre-plafond')) {
    throw new Error(`REFUS : ${dejaServies} + ${prevues} réponses du modèle dépasseraient le plafond de ${PLAFOND_MODELE_PAR_JOUR} par bureau et par 24 heures. Jouer la batterie en deux lots, à 24 heures d’écart dans ce bureau (ou le second dans un autre bureau de test, avec --org, --prefixe et son propre --sortie) : « --famille ${LOT_1} », puis « --famille ${LOT_2} ». Ou relancer avec --malgre-plafond : les questions servies par la réponse fixe du plafond seront NON COUVERT.`);
  }
  if (aJouer.some((t) => t.id.startsWith('pas-d-action.'))) {
    const [activite] = await sql<{ traces: number; derniere: string | null }>(sqlLumiRecent(org, 3));
    if (Number(activite?.traces) > 0 && !drapeau('--malgre-activite')) {
      throw new Error(`REFUS : Lumi a servi ${activite.traces} fois dans ce bureau depuis 3 minutes (dernière : ${activite.derniere}). Une autre batterie tourne peut-être, et la famille « pas-d-action » surveille le journal des actions : attendre, ou relancer avec --malgre-activite.`);
    }
  }
  const [jeu] = await sql<{ clients: number; factures: number }>(sqlJeuPresent(org, { clients: ['bergeron'], factures: ['en_retard'] }));
  const jeuPresent = Number(jeu?.clients) === 1 && Number(jeu?.factures) === 1;
  dire(`jeu [EVAL] : ${jeuPresent ? 'présent' : 'ABSENT ou incomplet — les familles qui en dépendent seront NON COUVERT'}`);
  const [migAvant] = await sql<{ migrations: number }>(sqlMigrations(org));
  // L'horloge du poste peut dériver : les fenêtres des tours sont exprimées dans celle de la base (à la latence d'un appel près).
  const avantHorloge = Date.now();
  const [horloge] = await sql<{ maintenant: string }>(sqlHorloge());
  const decalageMs = horloge?.maintenant ? Math.round(Date.parse(String(horloge.maintenant)) - (avantHorloge + Date.now()) / 2) : 0;
  if (Math.abs(decalageMs) > 2000) dire(`horloge du poste : ${decalageMs > 0 ? 'en retard' : 'en avance'} de ${Math.abs(Math.round(decalageMs / 1000))} s sur la base — corrigé dans les fenêtres de lecture`);

  const debut = new Date();
  const avant = drapeau('--neuf') ? null : lireJson<Donnees | null>(`${SORTIE}.json`, null);
  // Un rapport appartient à UN bureau : le relevé des coûts relit le grand livre de ce bureau-là.
  if (avant && avant.org !== org) throw new Error(`REFUS : ${SORTIE}.json est le rapport du bureau ${avant.org}. Donner un autre --sortie pour le bureau ${org} (ou --neuf pour l’écraser).`);
  // Les tours des lancements précédents restent pour le relevé des coûts ; ceux d'un test rejoué sont remplacés quand il se rejoue.
  const tours: Tour[] = [...(avant?.tours ?? [])];
  const resultats: Resultat[] = [];
  const alertes: string[] = [];
  // Dans un objet : le contrôle de flux de TypeScript ne suit pas une variable réaffectée dans une fermeture.
  const stop: { raison: string | null } = { raison: null };
  const restant: Record<string, number> = {};
  const prevusParCompte = appelsParCompte(aJouer, cles);

  try {
    if (besoinChat) {
      for (const c of comptes) {
        const s = await session(c);
        const adhesions = await sql<{ org_id: string; role: string; status: string }>(sqlAdhesions(s.userId));
        const ici = adhesions.find((a) => String(a.org_id) === org);
        if (!ici || ici.status !== 'active') throw new Error(`REFUS : ${c.courriel} n’est pas membre actif du bureau de test.`);
        if (adhesions.some((a) => String(a.org_id) !== org)) throw new Error(`REFUS : ${c.courriel} est aussi membre d’un autre bureau — un compte de la batterie n’appartient qu’au bureau de test.`);
        const [m] = await sql<{ messages: number }>(sqlMessagesDansLHeure(org, s.userId));
        restant[c.cle] = Math.max(0, Math.min(maxDemande, LIMITE_HORAIRE - Number(m?.messages ?? 0)));
        dire(`${c.cle} : ${c.courriel} (${ici.role}), ${m?.messages ?? 0} message(s) au support dans l’heure, ${prevusParCompte[c.cle] ?? 0} appel(s) prévus, ${restant[c.cle]} permis`);
        if ((prevusParCompte[c.cle] ?? 0) > restant[c.cle]) throw new Error(`REFUS : ${prevusParCompte[c.cle]} appels prévus pour ${c.cle}, ${restant[c.cle]} permis dans l’heure. Découper avec --famille, ajouter des comptes (--compte), ou attendre.`);
      }
    }

    const support = creerClientSupport({ api: API, org, cx, maxParCompte: restant, dire, intervalleMs: INTERVALLE_MS, decalageMs });
    const surTicket = (s: Session, ticketId: string): void => {
      if (etat.tickets.some((t) => t.id === ticketId)) return;
      etat.tickets.push({ id: ticketId, compte: s.cle, courriel: s.courriel, ferme: false });
      ecrireEtat();
    };
    const ctx: Contexte = {
      org, sql, forfait: bureau.forfait, dire, attendre,
      poser: creerPoser({ org, sql, support, attendre, tours, surTicket }),
      tours: () => tours,
      maintenant: () => new Date(Date.now() + decalageMs).toISOString(),
    };

    const passe = (): Passe => {
      const ici: Lancement = { date: debut.toISOString(), familles: choix.map((c) => c.famille.nom), comptes: Object.fromEntries(comptes.map((c) => [c.cle, c.courriel])), appels: support.compteurs() };
      const lancements = [...(avant?.lancements ?? []), ici];
      const appels: Record<string, number> = {};
      for (const x of lancements) for (const [c, n] of Object.entries(x.appels)) appels[c] = (appels[c] ?? 0) + n;
      return {
        date: lancements[0].date, api: API, org, nom_org: bureau.name, forfait: bureau.forfait, jeu_present: jeuPresent, selection, lancements, appels, tours,
        tickets: [...(avant?.tickets ?? []), ...etat.tickets], reponses_modele_24h_avant: dejaServies, arret: stop.raison, alertes,
        ...(avant?.notes?.length ? { notes: avant.notes } : {}),
      };
    };
    const ecrire = (partiel: boolean): void => {
      const tous = fusionner(FAMILLES, avant?.resultats ?? [], resultats);
      const p = passe();
      writeFileSync(`${SORTIE}.json.tmp`, JSON.stringify({ ...p, partiel, bilan: bilanDe(tous), resultats: tous }, null, 1));
      renameSync(`${SORTIE}.json.tmp`, `${SORTIE}.json`);
      if (!partiel) writeFileSync(`${SORTIE}.md`, rapportMarkdown(p, FAMILLES, tous));
    };
    for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK'] as const) {
      process.once(sig, () => { void fermerTickets(support).then(async () => { for (const s of sessions.values()) await fermerSession(admin, s); }).finally(() => process.exit(130)); });
    }

    /** Joue un test ; une erreur de la batterie (réseau, limite, bogue du test) n'est pas un défaut du support : NON COUVERT. */
    const jouer = async (famille: Famille, t: TestSupport): Promise<Resultat> => {
      const depart = Date.now();
      const cle = repartition.get(t.id) ?? null;
      let issue: Issue;
      if (t.non_couvert || !t.executer) issue = { verdict: 'NON COUVERT', constats: [t.non_couvert?.raison ?? 'test sans exécution'], preuves: [] };
      else if (stop.raison) issue = { verdict: 'NON COUVERT', constats: ['batterie arrêtée avant ce test — voir l’arrêt en tête du rapport'], preuves: [] };
      else if (famille.besoin_jeu_eval && !jeuPresent) issue = { verdict: 'NON COUVERT', constats: ['le jeu [EVAL] est absent du bureau : rien à surveiller'], preuves: [] };
      else {
        try {
          const s = cle ? sessions.get(cle) : [...sessions.values()][0];
          if (t.appels > 0 && !s) throw new Error('aucune session pour ce test');
          if (t.appels > 0) for (let i = tours.length - 1; i >= 0; i -= 1) if (tours[i].test === t.id) tours.splice(i, 1);
          issue = await t.executer(ctx, s as Session);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (err instanceof ArretImmediat) { stop.raison = message; issue = { verdict: 'FAIL', constats: [message], preuves: [] }; }
          else issue = { verdict: 'NON COUVERT', constats: [err instanceof LimiteAtteinte ? message : `erreur de la batterie : ${message.slice(0, 300)}`], preuves: [] };
        }
      }
      if (issue.arret && !stop.raison) stop.raison = issue.arret;
      const r = resultatDe(famille, t, issue, Date.now() - depart, cle);
      resultats.push(r);
      dire(`  ${ligneConsole(r)}`);
      ecrire(true);
      return r;
    };

    try {
      if (besoinChat) {
        dire('\nCanari — avant toute autre question');
        await jouer(escalade, canari);
        if (stop.raison) dire(`\nARRÊT : ${stop.raison}`);
      }
      for (const { famille, tests: liste_ } of choix) {
        dire(`\n${famille.titre}`);
        for (const t of liste_.filter((x) => x.id !== ID_CANARI)) {
          // Le relevé des coûts se fait même après un arrêt : il mesure ce qui a déjà été dépensé.
          if (stop.raison && t.id === ID_COUT && t.executer) { const sauve = stop.raison; stop.raison = null; await jouer(famille, t); stop.raison = sauve; continue; }
          // Après un arrêt, un test déjà jugé lors d'un lancement précédent garde son résultat : « arrêtée » ne l'écrase pas.
          if (stop.raison && avant?.resultats?.some((r) => r.id === t.id)) continue;
          await jouer(famille, t);
        }
      }
    } finally {
      if (besoinChat) {
        dire(`\nfermeture de ${etat.tickets.filter((t) => !t.ferme).length} ticket(s) (un toutes les ${INTERVALLE_MS / 1000} s par compte)`);
        await fermerTickets(support);
      }
    }

    // ── Contrôles de fin : aucune migration démarrée ──
    try {
      const [migApres] = await sql<{ migrations: number }>(sqlMigrations(org));
      if (Number(migApres?.migrations ?? 0) > Number(migAvant?.migrations ?? 0)) alertes.push(`Une migration de données a été créée dans le bureau pendant la passe (${migAvant?.migrations ?? 0} → ${migApres?.migrations}) : l’outil start_migration prévient les administrateurs réels de la plateforme. À annuler dans le bureau de test.`);
    } catch (err) { alertes.push(`Contrôle des migrations impossible : ${err instanceof Error ? err.message : String(err)}`); }
    const nonFermes = etat.tickets.filter((t) => !t.ferme);
    if (nonFermes.length) alertes.push(`${nonFermes.length} ticket(s) de la batterie n’ont pas pu être fermés : relancer avec --fermer.`);
    ecrire(false);

    const bilan = bilanDe(resultats);
    dire(`\nBILAN de ce lancement : ${bilan.par_verdict.PASS} PASS, ${bilan.par_verdict.FAIL} FAIL, ${bilan.par_verdict['NON COUVERT']} NON COUVERT, ${bilan.par_verdict['A RELIRE']} A RELIRE — sur ${bilan.total} tests`);
    dire(`Appels au chat de support : ${Object.entries(support.compteurs()).map(([c, n]) => `${c} ${n}`).join(', ') || 'aucun'}`);
    for (const a of alertes) dire(`ALERTE — ${a}`);
    if (stop.raison) dire(`ARRÊT — ${stop.raison}`);
    dire(`Rapport : ${SORTIE}.md\nDonnées : ${SORTIE}.json`);
    process.exitCode = stop.raison ? 2 : bilan.par_verdict.FAIL ? 1 : 0;
  } finally {
    for (const s of sessions.values()) await fermerSession(admin, s);
  }
}

if (process.argv[1] && /support[\\/]run\.mts$/.test(process.argv[1])) {
  main().then(() => process.exit(process.exitCode ?? 0)).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
}
