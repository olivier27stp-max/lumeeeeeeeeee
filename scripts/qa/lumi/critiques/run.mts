/**
 * Tests critiques de Lumi — LE LANCEUR (phase 3 de la mission « Lumi fiable » : sécurité et exactitude).
 * ─────────────────────────────────────────────────────────────────────────
 * Tourne en PRODUCTION, contre https://lumecrm.net, dans le bureau de test A
 * « ZZ QA Champs (banc de test) ». Neuf familles : isolation, rôles, mémoire,
 * injection, actions sensibles, une seule exécution, exactitude, crédits, Loi 25.
 * Chaque test dit ce qu'il a fait, ce qu'il a observé, et rend PASS, FAIL,
 * NON COUVERT ou A RELIRE avec la preuve. Tout est jugé par du code.
 *
 *   npx tsx scripts/qa/lumi/critiques/run.mts --plan [--famille roles,memoire]
 *        Liste ce qui serait fait. N'appelle rien, n'écrit rien, ne lit aucune variable.
 *
 *   node --env-file=C:/Users/Rafba/lumeeeeeeeeee/.env.local --import tsx scripts/qa/lumi/critiques/run.mts
 *        [--famille <nom>[,<nom>]]   une ou plusieurs familles (isolation, roles, memoire, injection, actions, idempotence, exactitude, credits, loi25)
 *        [--test <id>[,<id>]]        un ou plusieurs tests
 *        [--sans-balayage]           sans les deux tests qui demandent à la base les lignes de TOUT autre bureau
 *        [--max-appels 55]           appels à Lumi permis par compte dans la passe (la prod en accepte 60 par heure et par personne)
 *        [--attendre]                attendre la fin d'une limite horaire au lieu de rendre NON COUVERT
 *        [--malgre-activite]         lancer même si le bureau a servi dans les 3 dernières minutes ou si un compte est déjà en mode « demander »
 *        [--proprietaire <courriel>] le compte propriétaire qui joue (défaut qa.map.owner@lume.test ; aussi eval.proprio1..3@lume-qa.test) —
 *                                    la batterie se joue famille par famille, un compte par famille, pour tenir dans la limite horaire
 *        [--sans-garde-horaire]      ne pas refuser d'après le compte des tours déjà tracés dans l'heure ; un 429 long rend alors NON COUVERT
 *        [--sortie evals/lumi/resultats/critiques-<date>]   base des fichiers .json et .md ; un fichier déjà là est COMPLÉTÉ
 *                                    (un test rejoué remplace son ancien résultat), sauf avec --neuf
 *        --regenerer [--note "…"]    réécrit le .md à partir du .json de --sortie, sans rien appeler ; chaque --note ajoute un constat de passe
 *        --remettre                  après une passe tuée : remet le mode Lumi des deux comptes
 *        --nettoyer                  après une passe tuée : retire les fiches [CRIT] (suppression douce)
 *
 * Garde-fous, vérifiés AVANT la première écriture :
 *  - le bureau A a un nom de bureau de test ET est inscrit au bac à sable des envois (`orgs_envois_simules`) — sinon refus ;
 *  - le bureau B a un nom de bureau de test, n'est pas le bureau A, et les deux comptes n'en sont pas membres ;
 *  - le budget d'appels tient dans la limite horaire, compte tenu des tours déjà faits dans l'heure ;
 *  - aucune autre batterie ne tourne (aucune trace de Lumi dans les 3 dernières minutes, aucun des deux comptes déjà en mode « demander »).
 * Écritures de la batterie : `memberships.lumi_mode` des deux comptes (« demander » le temps de la passe, état
 * d'origine écrit sur disque AVANT, remis à la fin même en cas d'erreur), et les fiches [CRIT] (retirées à la fin
 * par suppression douce). Aucun changement de forfait ni de budget. Jamais rien dans le bureau B.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LimiteAtteinte, clientService, clientUtilisateur, connexionProd, creerClientLumi, fermerSession, ouvrirSession, sqlLectureSeule, type Connexion } from './acces.mts';
import { JEU_ATTENDU, sqlActiviteRecente, sqlAdhesions, sqlBureaux, sqlFuseau, sqlJeuPresent, sqlModeLumi, sqlModelesDesConversations, sqlToursDansLHeure } from './faits.mts';
import { retirerFichesCrit } from './fiches-crit.mts';
import { LIMITE_HORAIRE, appelsPrevus, bilanDe, fusionner, ligneConsole, rapportMarkdown, selectionner, textePlan, type Lancement, type Passe, type Selection } from './rapport.mts';
import type { Compte, Contexte, Famille, Issue, Resultat, Session, TestCritique } from './types.mts';
import { isolation } from './familles/isolation.mts';
import { roles } from './familles/roles.mts';
import { memoire } from './familles/memoire.mts';
import { injection } from './familles/injection.mts';
import { actions } from './familles/actions.mts';
import { idempotence } from './familles/idempotence.mts';
import { exactitude } from './familles/exactitude.mts';
import { credits } from './familles/credits.mts';
import { loi25 } from './familles/loi25.mts';

export const FAMILLES: Famille[] = [isolation, roles, memoire, injection, actions, idempotence, exactitude, credits, loi25];

export const ORG_A = '93daa0c7-b749-4200-9755-dbeee62ce32d';
export const ORG_B = '0df93da0-dc34-481c-be91-bab69a4989b0';
export const COMPTES: Record<Compte, string> = { proprietaire: 'qa.map.owner@lume.test', technicien: 'qa.lumi.tech@lume.test' };
/** Les comptes propriétaires de test du bureau A (tous au rôle owner) : aucun autre compte n'est accepté. */
export const PROPRIETAIRES_DE_TEST = ['qa.map.owner@lume.test', 'eval.proprio1@lume-qa.test', 'eval.proprio2@lume-qa.test', 'eval.proprio3@lume-qa.test'];
const API = 'https://lumecrm.net';
const NOM_DE_TEST = /\b(QA|TEST)\b|\bbanc\b/i;

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const DOSSIER = join(RACINE, 'evals', 'lumi', 'resultats');
const FICHIER_ETAT = join(DOSSIER, '.etat-critiques.json');
/** Conversations ouvertes par les lancements précédents de cette batterie : le garde « une autre batterie tourne » ne les compte pas. */
const FICHIER_CONVERSATIONS = join(DOSSIER, '.critiques-conversations.json');
const lireJson = <T,>(fichier: string, defaut: T): T => { try { const t = readFileSync(fichier, 'utf8').trim(); return t ? (JSON.parse(t) as T) : defaut; } catch { return defaut; } };

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

function resultatDe(famille: Famille, t: TestCritique, issue: Issue, duree: number): Resultat {
  return {
    id: t.id, famille: famille.nom, titre: t.titre, fait: t.fait, si_defaut: t.si_defaut, duree_ms: duree,
    ...(t.attente_discutable ? { attente_discutable: t.attente_discutable } : {}), ...(t.non_couvert ? { couvert_par: t.non_couvert.couvert_par } : {}), ...issue,
  };
}

async function main(): Promise<void> {
  const selection: Selection = { familles: liste('--famille'), tests: liste('--test'), sansBalayage: drapeau('--sans-balayage') };
  const inconnues = (selection.familles ?? []).filter((n) => !FAMILLES.some((f) => f.nom === n));
  if (inconnues.length) throw new Error(`famille inconnue : ${inconnues.join(', ')} (connues : ${FAMILLES.map((f) => f.nom).join(', ')})`);
  const choix = selectionner(FAMILLES, selection);
  const tests = choix.flatMap((c) => c.tests);
  const maxDemande = Math.max(1, Math.min(LIMITE_HORAIRE, Number(arg('--max-appels', '55')) || 55));

  // ── --plan : ni réseau, ni base, ni variable d'environnement ──
  if (drapeau('--plan')) { dire(textePlan(choix, { maxParCompte: maxDemande })); return; }

  mkdirSync(DOSSIER, { recursive: true });
  // ── --regenerer : le rapport lisible refait à partir des données, sans réseau ──
  if (drapeau('--regenerer')) {
    const base = arg('--sortie', join(DOSSIER, `critiques-${new Date().toISOString().slice(0, 10)}`));
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
    const brut = (() => { try { return readFileSync(FICHIER_ETAT, 'utf8'); } catch { return ''; } })();
    if (!brut.trim()) { dire('rien à remettre'); return; }
    for (const l of await remettreModes(cx, JSON.parse(brut) as EtatModes)) dire(l);
    return;
  }
  const admin = clientService(cx);
  if (drapeau('--nettoyer')) {
    const m = await retirerFichesCrit(admin, ORG_A);
    for (const l of m.fait) dire(l);
    for (const l of m.erreurs) dire(`ÉCHEC — ${l}`);
    return;
  }
  if (!tests.length) throw new Error('aucun test retenu par --famille / --test');
  const comptes: Record<Compte, string> = { proprietaire: arg('--proprietaire', COMPTES.proprietaire), technicien: COMPTES.technicien };
  if (!PROPRIETAIRES_DE_TEST.includes(comptes.proprietaire)) throw new Error(`REFUS : --proprietaire doit être un des comptes de test (${PROPRIETAIRES_DE_TEST.join(', ')}).`);

  const sql = sqlLectureSeule(cx);

  // ── Garde-fous (lecture seule) ──
  const bureaux = await sql<{ id: string; name: string; bac: string | null }>(sqlBureaux(ORG_A, ORG_B));
  const a = bureaux.find((o) => o.id === ORG_A);
  const b = bureaux.find((o) => o.id === ORG_B);
  if (!a || !NOM_DE_TEST.test(a.name)) throw new Error(`REFUS : le bureau A « ${a?.name ?? ORG_A} » n’a pas un nom de bureau de test.`);
  if (!a.bac) throw new Error(`REFUS : « ${a.name} » n’est pas inscrit au bac à sable des envois (orgs_envois_simules). Sans lui, un envoi de test partirait pour vrai.`);
  if (!b || !NOM_DE_TEST.test(b.name)) throw new Error(`REFUS : le bureau B « ${b?.name ?? ORG_B} » n’a pas un nom de bureau de test.`);
  dire(`PROD — bureau A « ${a.name} » (bac à sable : ${a.bac}), bureau B « ${b.name} » (lecture seule), API ${API}`);

  // Le runner d'évaluation (evals/lumi-tools/run.mts --prod) laisse son état sur disque tant qu'il tourne.
  const autreBatterie = (() => { try { return readFileSync(join(RACINE, 'evals', 'lumi-tools', 'resultats', '.etat-prod.json'), 'utf8').trim(); } catch { return ''; } })();
  if (autreBatterie && !drapeau('--malgre-activite')) throw new Error('REFUS : evals/lumi-tools/resultats/.etat-prod.json n’est pas vide — la batterie d’évaluation tourne (ou a été tuée : la remettre avec son --remettre). Forcer : --malgre-activite.');
  const dejaOuvertes = lireJson<string[]>(FICHIER_CONVERSATIONS, []).filter((x) => /^[0-9a-f-]{36}$/i.test(x));
  const [activite] = await sql<{ traces: number; derniere: string | null }>(sqlActiviteRecente(ORG_A, 3, dejaOuvertes));
  if (Number(activite?.traces) > 0 && !drapeau('--malgre-activite')) {
    throw new Error(`REFUS : Lumi a servi ${activite.traces} fois dans le bureau A depuis 3 minutes (dernière : ${activite.derniere}). Une autre batterie tourne peut-être : attendre, ou relancer avec --malgre-activite.`);
  }

  // ── Sessions des deux comptes de A ──
  const sessions = {} as Record<Compte, Session>;
  for (const compte of ['proprietaire', 'technicien'] as const) sessions[compte] = await ouvrirSession(cx, admin, compte, comptes[compte]);
  const etat: EtatModes = { org: ORG_A, modes: [] };
  const restant = {} as Record<Compte, number>;
  const prevus = appelsPrevus(tests);
  try {
    for (const compte of ['proprietaire', 'technicien'] as const) {
      const s = sessions[compte];
      const adhesions = (await sql<{ org_id: string }>(sqlAdhesions(s.userId))).map((m) => String(m.org_id));
      if (adhesions.includes(ORG_B)) throw new Error(`REFUS : ${s.courriel} est membre du bureau B — le test d’isolation ne prouverait rien.`);
      const [m] = await sql<{ lumi_mode: string | null; role: string; status: string }>(sqlModeLumi(ORG_A, s.userId));
      const roleAttendu = compte === 'proprietaire' ? 'owner' : 'technician';
      if (!m || m.status !== 'active' || m.role !== roleAttendu) throw new Error(`REFUS : ${s.courriel} n’est pas ${roleAttendu} actif du bureau A (rôle ${m?.role}, statut ${m?.status}).`);
      etat.modes.push({ compte, user_id: s.userId, lumi_mode: m.lumi_mode });
      const [tours] = await sql<{ tours: number }>(sqlToursDansLHeure(ORG_A, s.userId));
      restant[compte] = Math.max(0, Math.min(maxDemande, LIMITE_HORAIRE - Number(tours?.tours ?? 0)));
      dire(`${compte} : ${s.courriel}, mode Lumi « ${m.lumi_mode} », ${tours?.tours ?? 0} tour(s) dans l’heure, ${prevus[compte]} appel(s) prévus, ${restant[compte]} permis`);
      if (drapeau('--sans-garde-horaire')) restant[compte] = maxDemande;
      if (prevus[compte] > restant[compte] && !drapeau('--attendre')) {
        throw new Error(`REFUS : ${prevus[compte]} appels prévus pour ${compte}, ${restant[compte]} permis dans l’heure. Découper avec --famille, attendre, ou relancer avec --attendre.`);
      }
      // Le mode de repos d'un compte est « argent ». « demander » au départ = une autre batterie l'a posé et le remettra à sa fin, en plein milieu de celle-ci.
      if (m.lumi_mode === 'demander') {
        if (!drapeau('--malgre-activite')) throw new Error(`REFUS : ${s.courriel} est déjà en mode « demander » — une autre batterie tourne sans doute (ou a été tuée : la remettre d’abord avec son --remettre). Forcer : --malgre-activite ; c’est alors « demander » qui sera remis à la fin.`);
        dire(`  ATTENTION : ${compte} est DÉJÀ en mode « demander » — c’est cet état qui sera remis à la fin.`);
      }
    }

    const [jeu] = await sql<typeof JEU_ATTENDU>(sqlJeuPresent(ORG_A));
    const jeuPresent = Boolean(jeu) && (Object.keys(JEU_ATTENDU) as Array<keyof typeof JEU_ATTENDU>).every((k) => Number(jeu[k]) === JEU_ATTENDU[k]);
    dire(`jeu [EVAL] : ${jeuPresent ? 'présent' : `ABSENT ou incomplet (${JSON.stringify(jeu)} ; attendu ${JSON.stringify(JEU_ATTENDU)}) — les tests qui en dépendent seront NON COUVERT`}`);
    const [fz] = await sql<{ fuseau: string }>(sqlFuseau(ORG_A));
    const fuseau = fz?.fuseau ?? 'America/Toronto';

    // ── Mode « demander » : état d'origine écrit sur disque AVANT toute modification ──
    writeFileSync(FICHIER_ETAT, JSON.stringify(etat, null, 1));
    let remis: string[] | null = null;
    const remettre = async (): Promise<string[]> => { remis ??= await remettreModes(cx, etat); return remis; };
    const menager = async (): Promise<Passe['menage']> => {
      try { return await retirerFichesCrit(admin, ORG_A); } catch (err) { return { fait: [], erreurs: [`ménage impossible : ${err instanceof Error ? err.message : String(err)}`] }; }
    };
    for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK'] as const) process.once(sig, () => { void menager().then(remettre).finally(() => process.exit(130)); });
    const poserDemander = async (): Promise<boolean> => {
      let change = false;
      for (const m of etat.modes) {
        const [actuel] = await sql<{ lumi_mode: string | null }>(sqlModeLumi(ORG_A, m.user_id));
        if (actuel?.lumi_mode === 'demander') continue;
        const { error } = await admin.from('memberships').update({ lumi_mode: 'demander' }).eq('org_id', ORG_A).eq('user_id', m.user_id);
        if (error) throw new Error(`mode « demander » de ${m.compte} : ${error.message}`);
        change = true;
      }
      return change;
    };

    const lumi = creerClientLumi({ api: API, orgA: ORG_A, cx, maxParCompte: drapeau('--attendre') ? { proprietaire: maxDemande, technicien: maxDemande } : restant, attendreLimite: drapeau('--attendre'), dire });
    const debut = new Date();
    const nonce = Date.now().toString(36).slice(-5).toUpperCase();
    const ctx: Contexte = {
      api: API, orgA: ORG_A, orgB: ORG_B, nomOrgB: b.name, fuseau, sql, admin, lumi, nonce, debut, jeuPresent, dire, attendre,
      session: (c) => sessions[c],
      clientAvecEntetes: (c, entetes) => clientUtilisateur(cx, sessions[c], entetes),
    };

    const SORTIE = arg('--sortie', join(DOSSIER, `critiques-${debut.toISOString().slice(0, 10)}`));
    // Un rapport déjà là est complété : la batterie se joue famille par famille.
    const avant = drapeau('--neuf') ? null : lireJson<(Passe & { resultats: Resultat[] }) | null>(`${SORTIE}.json`, null);
    const resultats: Resultat[] = [];
    const tousLesResultats = (): Resultat[] => fusionner(FAMILLES, avant?.resultats ?? [], resultats);
    const passe = (menage: Passe['menage'], mode: string[]): Passe => {
      const ici: Lancement = { date: debut.toISOString(), familles: choix.map((c) => c.famille.nom), comptes, appels: lumi.compteurs() };
      const lancements = [...(avant?.lancements ?? []), ici];
      return {
        date: lancements[0].date, api: API, org_a: ORG_A, org_b: ORG_B, jeu_present: jeuPresent, menage, mode, selection, lancements,
        appels: { proprietaire: lancements.reduce((n, x) => n + x.appels.proprietaire, 0), technicien: lancements.reduce((n, x) => n + x.appels.technicien, 0) },
        conversations: [...new Set([...(avant?.conversations ?? []), ...lumi.conversations()])],
        ...(avant?.notes?.length ? { notes: avant.notes } : {}),
      };
    };
    const ecrire = (p: Passe, partiel: boolean): void => {
      const tous = tousLesResultats();
      writeFileSync(`${SORTIE}.json.tmp`, JSON.stringify({ ...p, partiel, bilan: bilanDe(tous), resultats: tous }, null, 1));
      renameSync(`${SORTIE}.json.tmp`, `${SORTIE}.json`);
      writeFileSync(FICHIER_CONVERSATIONS, JSON.stringify([...new Set([...dejaOuvertes, ...lumi.conversations()])]));
      if (!partiel) writeFileSync(`${SORTIE}.md`, rapportMarkdown(p, FAMILLES, tous));
    };

    let menage: Passe['menage'] = { fait: [], erreurs: [] };
    let modes: string[] = [];
    try {
      if (await poserDemander()) { dire('mode « demander » posé ; attente de 35 s (cache de session du serveur)'); await attendre(35_000); }
      for (const { famille, tests: aJouer } of choix) {
        dire(`\n${famille.titre}`);
        // Une autre session a pu remettre le mode en cours de route : on le repose avant chaque famille.
        if (await poserDemander()) { dire('  le mode « demander » avait été défait : reposé ; attente de 35 s'); await attendre(35_000); }
        for (const t of aJouer) {
          const depart = Date.now();
          let issue: Issue;
          if (t.non_couvert || !t.executer) issue = { verdict: 'NON COUVERT', constats: [t.non_couvert?.raison ?? 'test sans exécution'], preuves: [] };
          else {
            try { issue = await t.executer(ctx); } catch (err) {
              // Une erreur de la batterie (réseau, limite, bogue du test) n'est pas un défaut de Lumi : NON COUVERT, avec l'erreur.
              const message = err instanceof Error ? err.message : String(err);
              issue = { verdict: 'NON COUVERT', constats: [err instanceof LimiteAtteinte ? message : `erreur de la batterie : ${message.slice(0, 300)}`], preuves: [] };
            }
          }
          const r = resultatDe(famille, t, issue, Date.now() - depart);
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
    // Qui a répondu (modèle, étage) sur toutes les conversations de la batterie, et le palier du bureau.
    const finale = passe(menage, modes);
    try {
      if (finale.conversations.length) finale.modeles = (await sql<{ modele: string; etage: number | null; tours: number }>(sqlModelesDesConversations(ORG_A, finale.conversations))).map((m) => ({ modele: String(m.modele), etage: m.etage === null ? null : Number(m.etage), tours: Number(m.tours) }));
      const q = await lumi.appel(sessions.proprietaire, 'GET', '/api/lumi/quota');
      finale.palier = q.json && typeof q.json === 'object' ? String((q.json as { credits?: { palier?: string } }).credits?.palier ?? '') || null : null;
    } catch (err) { dire(`modèles de la passe illisibles : ${err instanceof Error ? err.message : String(err)}`); }
    ecrire(finale, false);

    const bilan = bilanDe(resultats);
    dire(`\nBILAN de ce lancement : ${bilan.par_verdict.PASS} PASS, ${bilan.par_verdict.FAIL} FAIL, ${bilan.par_verdict['NON COUVERT']} NON COUVERT, ${bilan.par_verdict['A RELIRE']} A RELIRE — sur ${bilan.total} tests`);
    dire(`Appels à Lumi : propriétaire ${lumi.compteurs().proprietaire}, technicien ${lumi.compteurs().technicien}`);
    for (const l of modes) dire(`mode Lumi — ${l}`);
    for (const l of menage.fait) dire(`ménage — ${l}`);
    for (const l of menage.erreurs) dire(`ménage — ÉCHEC — ${l}`);
    dire(`Rapport : ${SORTIE}.md\nDonnées : ${SORTIE}.json`);
    process.exitCode = bilan.par_verdict.FAIL ? 1 : 0;
  } finally {
    for (const s of Object.values(sessions)) await fermerSession(admin, s);
  }
}

if (process.argv[1] && /critiques[\\/]run\.mts$/.test(process.argv[1])) {
  main().then(() => process.exit(process.exitCode ?? 0)).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
}
