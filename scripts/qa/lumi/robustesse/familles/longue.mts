/**
 * Famille 1 — Conversation longue (50 tours, UNE conversation, un compte à elle).
 * ─────────────────────────────────────────────────────────────────────────
 * Ce que la famille doit savoir du serveur avant de juger :
 *  - une conversation qui a déjà coûté 40 ¢ ne repasse plus par le modèle (gabarit « ouvre une nouvelle
 *    conversation », server/lib/lumi/regles-cout.ts). Cinquante tours d'agent à ≈ 1,6 ¢ s'y arrêteraient vers le
 *    tour 25 : le script alterne donc 19 tours d'agent et 31 questions courantes servies sans modèle (0 ¢), qui
 *    remplissent l'historique tout autant ;
 *  - l'historique rejoué au modèle est borné à 60 messages. Un fait donné au tour 4 et jamais redit sort donc de
 *    la fenêtre : c'est exactement ce que « contexte-ancien » éprouve.
 *
 * Deux faits sont donnés au début : « ma cliente » (tour 3), redemandé aux tours 12, 24, 36 et 47 ; « le dossier
 * bleu » (tour 4), redemandé UNE fois, au tour 48. Aucune écriture n'est demandée ni confirmée.
 *
 * Les quatre tests se suivent et partagent la conversation : le premier la joue, les trois autres la jugent.
 */
import { extrait } from '../../critiques/jugement.mts';
import { FluxInterrompu, LimiteAtteinte } from '../acces.mts';
import { sqlFacture, sqlMemoireDepuis, sqlTours } from '../faits.mts';
import { CONVENTION_LONGUE } from '../fiches-rob.mts';
import { classerTour, estPlafondConversation, etatDuRappel, jugerCoutBorne, type Cible, type EtatHistorique, type TourMesure } from '../jugement.mts';
import type { Contexte, Famille, Issue, Preuve, Tour } from '../types.mts';
import { historiqueDe, sansJeu } from './commun.mts';

export type GenrePas = 'raccourci' | 'agent' | 'fait' | 'rappel_a' | 'rappel_b';
export interface Pas { n: number; genre: GenrePas; message: string }

/** Les 31 questions courantes, servies sans modèle (énoncés exacts et motifs de server/lib/lumi/raccourcis.ts). */
export const RACCOURCIS: readonly string[] = [
  'Combien de clients j’ai ?', 'Qu’est-ce que j’ai demain ?', 'Qui me doit de l’argent ?', 'Mes tâches', 'Montre-moi le job 1',
  'Combien j’ai encaissé ce mois-ci ?', 'Mes devis en attente', 'Qui est dans mon équipe ?', 'Qu’est-ce que j’ai aujourd’hui ?', 'Montre-moi le job 3',
  'Qui sont mes meilleurs clients ?', 'J’ai combien de jobs cette semaine ?', 'Montre-moi le job 4', 'Quelles factures sont en retard ?', 'Montre-moi le job 5',
  'Mon chiffre d’affaires du mois', 'Montre-moi le job 6', 'Quoi de neuf ?', 'Montre-moi le job 7', 'Où est mon équipe en ce moment ?',
  'Montre-moi le job 8', 'J’ai combien de clients dans mon CRM ?', 'Montre-moi le job 9', 'Qu’est-ce qu’il me reste comme tâches à faire ?', 'Montre-moi le job 10',
  'Combien de devis attendent une réponse du client ?', 'Montre-moi le job 11', 'C’est quoi le total de mes comptes en retard ?', 'Montre-moi le job 12',
  'Combien de factures en retard j’ai en ce moment ?', 'Mon brief du matin',
];

/** Les tours qui passent par le modèle, à leur place dans la conversation. */
const AGENT: Record<number, { genre: GenrePas; message: (v: { cliente: string; facture: string; payeur: string }) => string }> = {
  1: { genre: 'agent', message: (v) => `Montre-moi la fiche de ${v.cliente}.` },
  3: { genre: 'fait', message: (v) => `Pour la suite de cette conversation seulement (ne le note pas en mémoire) : quand je dis « ma cliente », je parle de ${v.cliente}. Réponds juste « OK ».` },
  4: { genre: 'fait', message: (v) => `Autre convention pour cette conversation seulement (ne la note pas en mémoire) : « le ${CONVENTION_LONGUE} », c’est la facture n° ${v.facture} de ${v.payeur}. Réponds juste « OK ».` },
  6: { genre: 'agent', message: () => 'Quelle est l’adresse de Nathalie Côté ?' },
  8: { genre: 'agent', message: () => 'C’est quoi le total du devis de Mélanie Simard ?' },
  10: { genre: 'agent', message: () => 'À quelle date est la prochaine visite chez Isabelle Fournier ?' },
  12: { genre: 'rappel_a', message: () => 'Quel est le numéro de téléphone de ma cliente ?' },
  14: { genre: 'agent', message: () => 'Qu’est-ce que Nathalie Côté a répondu à notre devis ?' },
  18: { genre: 'agent', message: () => 'Quel est le courriel de Sylvie Leblanc ?' },
  24: { genre: 'rappel_a', message: () => 'Et l’adresse courriel de ma cliente, c’est quoi ?' },
  30: { genre: 'agent', message: () => 'Combien d’heures ont été pointées en septembre 2026 ?' },
  36: { genre: 'rappel_a', message: () => 'Dans quelle ville habite ma cliente ?' },
  39: { genre: 'agent', message: () => 'Quel est le solde de la facture de Luc Bergeron ?' },
  42: { genre: 'agent', message: () => 'Dans quelle ville est le Restaurant Chez Poirier ?' },
  44: { genre: 'agent', message: () => 'C’est quoi le titre de la job d’André Ouellet ?' },
  46: { genre: 'agent', message: () => 'La facture d’Isabelle Fournier, elle est due pour quelle date ?' },
  47: { genre: 'rappel_a', message: () => 'Redonne-moi le numéro de téléphone de ma cliente.' },
  48: { genre: 'rappel_b', message: () => `Quel est le solde du ${CONVENTION_LONGUE} ?` },
  50: { genre: 'agent', message: () => 'Merci. Résume en deux phrases ce qu’on a regardé dans cette conversation.' },
};

export const TOURS = 50;
export const RAPPELS_A = [12, 24, 36, 47];
export const RAPPEL_B = 48;

/** Le script des 50 tours (pur). */
export function scriptLongue(v: { cliente: string; facture: string; payeur: string }): Pas[] {
  const pas: Pas[] = [];
  let r = 0;
  for (let n = 1; n <= TOURS; n++) {
    const a = AGENT[n];
    pas.push(a ? { n, genre: a.genre, message: a.message(v) } : { n, genre: 'raccourci', message: RACCOURCIS[r++ % RACCOURCIS.length] });
  }
  return pas;
}

interface TourJoue { pas: Pas; tour: Tour }
/** État partagé de la famille. */
const etat: {
  joue: boolean; tours: TourJoue[]; conversation: string | null; plafond_au_tour: number | null; arret: string | null;
  mesures: TourMesure[]; ecart_traces: string | null; historique: EtatHistorique | null; memoire: string[]; cliente: Cible | null; autres_clients: Cible[];
  ville: string; dossier: Cible | null; autres_factures: Cible[]; preuves: Preuve[];
} = { joue: false, tours: [], conversation: null, plafond_au_tour: null, arret: null, mesures: [], ecart_traces: null, historique: null, memoire: [], cliente: null, autres_clients: [], ville: '', dossier: null, autres_factures: [], preuves: [] };

const CLE_CLIENTE = 'levesque';
const CLE_FACTURE = 'partielle';
const pasJouee: Issue = { verdict: 'NON COUVERT', constats: ['la conversation longue n’a pas été jouée dans ce lancement (lancer la famille entière : --famille longue)'], preuves: [] };

async function jouer(ctx: Contexte): Promise<Issue> {
  if (!ctx.jeuPresent) return sansJeu;
  // Une conversation neuve à chaque fois : rien ne reste d'une conversation jouée plus tôt dans le même processus.
  Object.assign(etat, { joue: false, tours: [], conversation: null, plafond_au_tour: null, arret: null, mesures: [], ecart_traces: null, historique: null, memoire: [], preuves: [] });
  const s = ctx.proprietaire();
  const f = ctx.faits;
  const cliente = f.client(CLE_CLIENTE);
  const facture = f.facture(CLE_FACTURE);
  const [ligne] = await ctx.sql<{ invoice_number: string; balance_cents: number; deleted_at: string | null }>(sqlFacture(ctx.org, facture.id));
  if (!ligne || ligne.deleted_at) return { verdict: 'NON COUVERT', constats: ['la facture « partiellement payée » du jeu est introuvable : le second fait ne peut pas être donné'], preuves: [] };
  etat.cliente = f.cibleClient(CLE_CLIENTE);
  etat.ville = cliente.ville;
  etat.autres_clients = f.clients().filter((c) => c.cle !== CLE_CLIENTE).map((c) => f.cibleClient(c.cle));
  etat.dossier = { libelle: `la facture n° ${ligne.invoice_number} (${facture.client})`, montants_cents: [Number(ligne.balance_cents)] };
  etat.autres_factures = ['en_retard', 'en_retard_ancienne', 'envoyee'].map((cle) => f.facture(cle)).filter((x) => x.solde_cents !== Number(ligne.balance_cents)).map((x) => ({ libelle: `la facture de ${x.client}`, montants_cents: [x.solde_cents] }));

  const script = scriptLongue({ cliente: cliente.nom, facture: String(ligne.invoice_number), payeur: facture.client });
  const depart = new Date();
  const defauts: string[] = [];
  let interruption: FluxInterrompu | null = null;
  for (const pas of script) {
    let tour: Tour;
    try {
      tour = await ctx.lumi.demander(s, pas.message, { conversation_id: etat.conversation });
    } catch (err) {
      if (err instanceof LimiteAtteinte) { etat.arret = `arrêt avant le tour ${pas.n} : ${err.message}`; break; }
      if (err instanceof FluxInterrompu) { etat.arret = `arrêt au tour ${pas.n} : ${err.message}`; interruption = err; break; }
      throw err;
    }
    etat.tours.push({ pas, tour });
    etat.conversation ??= tour.conversation_id;
    const c = classerTour(tour);
    if (c.genre !== 'repondu') defauts.push(`tour ${pas.n} (${pas.genre}) : ${c.raison}`);
    for (const r of tour.executes) defauts.push(`tour ${pas.n} : écriture exécutée (${r.tool_use_id}) alors que rien n’est demandé`);
    if (tour.statut === 200 && estPlafondConversation(tour.texte)) { etat.plafond_au_tour = pas.n; break; }
    if (!etat.conversation) { etat.arret = `arrêt au tour ${pas.n} : aucune conversation ouverte (statut ${tour.statut})`; break; }
    if (pas.n % 10 === 0) ctx.dire(`    tour ${pas.n}/${TOURS}`);
  }
  etat.joue = true;

  // Les mesures : une trace par tour, dans l'ordre ; l'historique enregistré ; la mémoire permanente.
  const preuves: Preuve[] = [];
  if (etat.conversation) {
    await ctx.attendre(4000);
    const traces = await ctx.sql<Record<string, unknown>>(sqlTours(ctx.org, etat.conversation));
    if (traces.length === etat.tours.length) {
      etat.mesures = traces.map((l, i) => ({ n: etat.tours[i].pas.n, etage: l.etage === null ? null : Number(l.etage), cout_cents: l.cost_cents === null ? null : Number(l.cost_cents), resultat: String(l.resultat), action: l.action ? String(l.action) : null, modele: l.model ? String(l.model) : null, stop: l.stop ? String(l.stop) : null }));
      for (const m of etat.mesures) if (m.resultat === 'erreur') defauts.push(`tour ${m.n} : tracé en erreur par le serveur (étage ${m.etage ?? '—'}, fin « ${m.stop ?? '—'} »)`);
    } else etat.ecart_traces = `${traces.length} trace(s) pour ${etat.tours.length} tour(s) joué(s) : les coûts ne peuvent pas être rattachés aux tours`;
    const h = await historiqueDe(ctx, etat.conversation);
    etat.historique = h.etat;
    defauts.push(...h.etat.defauts);
    preuves.push(h.preuve);
    const notes = await ctx.sql<{ key: string; value: string }>(sqlMemoireDepuis(ctx.org, new Date(depart.getTime() - 600_000).toISOString()));
    etat.memoire = notes.filter((x) => /ma cliente|dossier bleu/i.test(`${x.key} ${x.value}`)).map((x) => `${x.key} : ${x.value}`);
  }
  const tableau = etat.tours.map(({ pas, tour }, i) => {
    const m = etat.mesures[i];
    return `${String(pas.n).padStart(2)} ${pas.genre.padEnd(9)} étage ${tour.etage ?? '—'} ${m ? `${Number(m.cout_cents ?? 0).toFixed(3)} ¢ ${m.resultat}` : ''} | ${pas.message.slice(0, 60)} → ${tour.statut === 200 ? extrait(tour.texte.replace(/\s+/g, ' '), 110) : `statut ${tour.statut}`}`;
  });
  preuves.unshift({ libelle: `les ${etat.tours.length} tours joués (conversation ${etat.conversation ?? '—'})`, contenu: tableau.join('\n') });
  etat.preuves = preuves;

  if (interruption) throw interruption;
  const constats: string[] = [];
  if (etat.plafond_au_tour) constats.push(`plafond de coût de la conversation atteint au tour ${etat.plafond_au_tour} : Lumi répond par le gabarit « ouvre une nouvelle conversation » (0 ¢) — le script s’arrête là`);
  if (etat.arret) constats.push(etat.arret);
  if (etat.ecart_traces) constats.push(etat.ecart_traces);
  if (defauts.length) return { verdict: 'FAIL', constats: [...defauts, ...constats], preuves };
  if (etat.arret) return { verdict: 'NON COUVERT', constats: [...constats, `${etat.tours.length} tour(s) joués sans erreur avant l’arrêt`], preuves };
  return {
    verdict: 'PASS', preuves,
    constats: [`${etat.tours.length} tours servis sans erreur (flux fini, réponse non vide, aucune écriture)`, `aucun tour tracé en erreur ; historique valide (${etat.historique?.messages ?? 0} messages enregistrés)`, ...constats],
  };
}

const tourN = (n: number): TourJoue | undefined => etat.tours.find((t) => t.pas.n === n);
const estGabarit = (t: TourJoue): boolean => t.tour.statut === 200 && estPlafondConversation(t.tour.texte);

async function contexte(): Promise<Issue> {
  if (!etat.joue || !etat.cliente) return pasJouee;
  const constats: string[] = [];
  const defauts: string[] = [];
  let dernierHonore = 0;
  for (const n of RAPPELS_A) {
    const t = tourN(n);
    if (!t || estGabarit(t)) continue;
    const attendu: Cible = n === 36 ? { libelle: `${etat.cliente.libelle}`, textes: [etat.ville] } : etat.cliente;
    const r = etatDuRappel(t.tour, attendu, n === 36 ? [] : etat.autres_clients);
    constats.push(`tour ${n} : ${r.detail}`);
    if (r.etat === 'honore') dernierHonore = n;
    else defauts.push(`tour ${n} — « ${t.pas.message} » : ${r.detail}`);
  }
  const preuves: Preuve[] = RAPPELS_A.flatMap((n) => { const t = tourN(n); return t ? [{ libelle: `tour ${n} — « ${t.pas.message} »`, contenu: extrait(t.tour.statut === 200 ? t.tour.texte : t.tour.corps, 400) }] : []; });
  if (defauts.length) return { verdict: 'FAIL', constats: [...defauts, `fait donné au tour 3 ; dernier rappel honoré : ${dernierHonore ? `tour ${dernierHonore}` : 'aucun'}`], preuves };
  if (etat.memoire.length) return { verdict: 'NON COUVERT', constats: [`Lumi a écrit la convention en mémoire PERMANENTE malgré la consigne (${etat.memoire.join(' | ')}) : le rappel ne prouve plus rien sur le contexte de la conversation`, ...constats], preuves };
  const dernier = RAPPELS_A[RAPPELS_A.length - 1];
  if (dernierHonore !== dernier) return { verdict: 'NON COUVERT', constats: [`le rappel du tour ${dernier} n’a pas pu être posé (${etat.plafond_au_tour ? `plafond de coût de la conversation au tour ${etat.plafond_au_tour}` : etat.arret ?? 'conversation arrêtée'})`, ...constats], preuves };
  return { verdict: 'PASS', constats: [`« ma cliente », donné au tour 3, est honoré aux tours ${RAPPELS_A.join(', ')}`, ...constats], preuves };
}

async function contexteAncien(): Promise<Issue> {
  if (!etat.joue || !etat.dossier) return pasJouee;
  const t = tourN(RAPPEL_B);
  if (!t || estGabarit(t)) return { verdict: 'NON COUVERT', constats: [`le tour ${RAPPEL_B} n’a pas pu être posé (${etat.plafond_au_tour ? `plafond de coût de la conversation au tour ${etat.plafond_au_tour}` : etat.arret ?? 'conversation arrêtée'})`], preuves: [] };
  const preuves: Preuve[] = [{ libelle: `tour 4 — le fait`, contenu: tourN(4)?.pas.message ?? '' }, { libelle: `tour ${RAPPEL_B} — « ${t.pas.message} »`, contenu: extrait(t.tour.statut === 200 ? t.tour.texte : t.tour.corps, 500) }, { libelle: 'attendu', contenu: `${etat.dossier.libelle} : solde ${(Number(etat.dossier.montants_cents?.[0]) / 100).toFixed(2)} $ (SELECT au début du test)` }];
  const r = etatDuRappel(t.tour, etat.dossier, etat.autres_factures);
  if (r.etat === 'honore') {
    if (etat.memoire.length) return { verdict: 'NON COUVERT', constats: [`le solde est juste, mais Lumi a écrit la convention en mémoire PERMANENTE (${etat.memoire.join(' | ')}) : le rappel ne prouve rien sur le contexte`], preuves };
    return { verdict: 'PASS', constats: [`« le ${CONVENTION_LONGUE} », donné au tour 4 et jamais redit, est honoré au tour ${RAPPEL_B} : ${r.detail}`, `${etat.historique?.messages ?? '?'} messages enregistrés dans la conversation`], preuves };
  }
  const nuance = r.etat === 'demande' ? 'Lumi le DIT et demande de préciser : rien de faux n’est affirmé' : r.etat === 'devine' ? 'Lumi répond sur une AUTRE facture, sans prévenir' : 'la réponse ne dit ni le solde ni qu’il ne sait plus';
  return { verdict: 'FAIL', constats: [`le fait donné au tour 4 n’est plus honoré au tour ${RAPPEL_B} : ${r.detail}`, nuance, `${etat.historique?.messages ?? '?'} messages enregistrés : le serveur n’en rejoue que les 60 derniers au modèle, sans résumé de ce qui précède`], preuves };
}

async function cout(): Promise<Issue> {
  if (!etat.joue) return pasJouee;
  const preuves: Preuve[] = [{ libelle: 'coût par tour (lumi_traces)', contenu: etat.mesures.map((m) => `${String(m.n).padStart(2)} étage ${m.etage ?? '—'} ${Number(m.cout_cents ?? 0).toFixed(3)} ¢ ${m.modele ?? 'sans modèle'} ${m.stop ?? ''}`).join('\n') || '(aucune mesure)' }];
  if (etat.ecart_traces) return { verdict: 'NON COUVERT', constats: [etat.ecart_traces], preuves };
  const j = jugerCoutBorne(etat.mesures);
  const plafond = etat.plafond_au_tour ? [`plafond de coût de la conversation atteint au tour ${etat.plafond_au_tour} : le serveur borne lui-même la dépense d’une conversation`] : [];
  return { ...j, constats: [...j.constats, ...plafond], preuves };
}

export const longue: Famille = {
  nom: 'longue',
  titre: '1. Conversation longue',
  prouve: 'Cinquante tours dans une conversation : aucune erreur, l’historique reste valide, un fait du début est encore honoré à la fin, le coût par tour plafonne.',
  compte: 'proprio1',
  besoin_jeu_eval: true,
  besoin_palier_normal: true,
  tests: [
    {
      id: 'longue.conversation', titre: 'Cinquante tours sans erreur, historique valide',
      fait: 'Une conversation de 50 tours scriptés : 19 demandes qui passent par le modèle (lectures courtes sur le jeu [EVAL], deux conventions données aux tours 3 et 4) et 31 questions courantes servies sans modèle. Chaque flux est lu, les traces et l’historique enregistré sont relus par SELECT.',
      si_defaut: 'Un tour en erreur ou sans réponse, un tour tracé « erreur », un historique que l’API du modèle refuserait (action sans résultat), ou une écriture exécutée.',
      lignes: [1], appels: { proprietaire: TOURS }, appels_sans_modele: 31, cout_estime_cents: 32, executer: jouer,
    },
    {
      id: 'longue.contexte', titre: 'Le fait du tour 3 est honoré aux tours 12, 24, 36 et 47',
      fait: 'Juge la conversation jouée : « ma cliente » (Chantal Lévesque, tour 3) est redemandé quatre fois ; chaque réponse doit porter son téléphone, son courriel ou sa ville.',
      si_defaut: 'Une réponse sur une autre cliente, ou « de quelle cliente parles-tu ? ».',
      lignes: [1], appels: {}, executer: contexte,
    },
    {
      id: 'longue.contexte-ancien', titre: 'Le fait du tour 4, jamais redit, est honoré au tour 48',
      fait: 'Juge la conversation jouée : « le dossier bleu » (une facture, tour 4) n’est redemandé qu’au tour 48 ; la réponse doit porter le solde de cette facture, relu en base.',
      si_defaut: 'Le solde d’une autre facture (deviné), ou « je ne sais pas ce qu’est le dossier bleu ».',
      attente_discutable: 'Le serveur ne rejoue au modèle que les 60 derniers messages, sans résumé : au tour 48 le tour 4 est sorti de la fenêtre. Un FAIL est donc attendu par construction ; « Lumi demande de préciser » est une gestion propre de la limite, mais ce n’est pas « honorer le fait » — le test rend FAIL et le dit.',
      lignes: [1], appels: {}, executer: contexteAncien,
    },
    {
      id: 'longue.cout', titre: 'Le coût par tour plafonne',
      fait: 'Juge la conversation jouée, sur les coûts relus dans lumi_traces : la médiane des tours d’agent des 10 derniers tours ne dépasse pas 3 fois celle des tours 5 à 15.',
      si_defaut: 'Un coût par tour qui grandit avec la conversation (historique relu en entier à chaque tour).',
      lignes: [1], appels: {}, executer: cout,
    },
  ],
};
