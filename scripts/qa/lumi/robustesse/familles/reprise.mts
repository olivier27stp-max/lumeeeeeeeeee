/**
 * Famille 4 — Reprise après une coupure.
 * La batterie coupe ELLE-MÊME la connexion (comme un rechargement de page, une perte de réseau, une app fermée) :
 * au premier texte d'une réponse, à l'arrivée d'une carte, pendant un « Confirmer ». Puis elle recharge la
 * conversation comme l'interface et continue. Attendu : la conversation se recharge, aucune réponse vide, le
 * message suivant est servi, l'historique enregistré reste valide, et aucune écriture n'est faite à moitié ni deux fois.
 *
 * Ce que le serveur fait (lu dans le code) : il ne s'arrête PAS quand le client se déconnecte — le tour va à son
 * terme et s'enregistre. Tant qu'il tourne, un nouveau message dans la même conversation peut recevoir un 409
 * « conversation_occupee » (verrou) : c'est un refus propre, la batterie attend et renvoie, quelques fois au plus.
 *
 * Seules écritures confirmées : des tâches [ROB].
 */
import { extrait } from '../../critiques/jugement.mts';
import { sqlResultatsPourLaCarte, sqlTachesDuJeton } from '../faits.mts';
import { titreRob } from '../fiches-rob.mts';
import { classerDecision, classerTour, ecrituresEnAttente, estOccupee, jugerReprise, jugerUneSeuleFois, marqueursDeLaCible, reponseDecision, sortsDesCartes, type ReponseDecision } from '../jugement.mts';
import type { Contexte, Coupure, Famille, Issue, Preuve, Session, Tour } from '../types.mts';
import { carteEnAttente, cartesEnPreuve, compteursDepuis, historiqueDe, preuvesDuTour, sansJeu } from './commun.mts';

/** Une demande de tâche que le serveur ne sert PAS par une carte toute faite : c'est le modèle qui propose, et le flux laisse le temps de couper. */
export const demandeDeCarteParLeModele = (titre: string): string => `${titre} : crée-moi une tâche avec ce titre, priorité basse, pour demain.`;

const ATTENTE_OCCUPEE_MS = 8000;
const ESSAIS_OCCUPEE = 5;

/** Envoie un message ; tant que le verrou répond « occupée », attend et renvoie (le serveur le demande). Rend tous les essais. */
async function envoyerApresCoupure(ctx: Contexte, s: Session, message: string, conversationId: string, essaisMax = ESSAIS_OCCUPEE): Promise<{ dernier: Tour; essais: Tour[]; attente_s: number }> {
  const essais: Tour[] = [];
  const debut = Date.now();
  for (let i = 0; i < essaisMax; i++) {
    const t = await ctx.lumi.demander(s, message, { conversation_id: conversationId });
    essais.push(t);
    if (!estOccupee(t)) break;
    if (i < essaisMax - 1) await ctx.attendre(ATTENTE_OCCUPEE_MS);
  }
  return { dernier: essais[essais.length - 1], essais, attente_s: Math.round((Date.now() - debut) / 1000) };
}

const tachesDuJeton = async (ctx: Contexte, jeton: string): Promise<{ n: number; preuve: string }> => {
  const requete = sqlTachesDuJeton(ctx.org, jeton);
  const l = await ctx.sql<{ title: string }>(requete);
  return { n: l.length, preuve: `${requete}\n→ ${l.length} ligne(s) : ${l.map((x) => x.title).join(' | ') || '—'}` };
};

async function coupureTexte(ctx: Contexte): Promise<Issue> {
  if (!ctx.jeuPresent) return sansJeu;
  const s = ctx.proprietaire();
  const c = ctx.faits.client('bergeron');
  const depart = new Date();
  const q0 = `Montre-moi la fiche de ${c.nom}.`;
  const t0 = await ctx.lumi.demander(s, q0);
  const preuves: Preuve[] = preuvesDuTour('tour 1', q0, t0);
  if (t0.statut !== 200 || !t0.conversation_id) return { verdict: 'NON COUVERT', constats: [`pas de conversation ouverte (statut ${t0.statut})`], preuves };
  const conv = t0.conversation_id;
  const avant = await compteursDepuis(ctx, s, depart);
  const q1 = 'Explique-moi en détail la situation de ce client : ses jobs, ses factures, ce qu’il me doit, et ce que tu me conseilles de faire.';
  const coupe = await ctx.lumi.demander(s, q1, { conversation_id: conv, couper: { apres: 'texte' } });
  preuves.push(...preuvesDuTour('tour 2 (coupé au premier texte)', q1, coupe));
  // Le rechargement de la page, tout de suite : ce que l'interface affiche pendant que le serveur finit le tour.
  const aChaud = await ctx.lumi.conversation(s, conv);
  preuves.push({ libelle: `rechargement immédiat (GET, statut ${aChaud.statut})`, contenu: aChaud.messages.map((m) => `${m.role} : ${extrait(m.text, 90)}${m.proposal ? ` [carte ${m.proposal.tool} ${m.proposal.statut}]` : ''}`).join('\n') || '(aucun message)' });
  const q2 = 'Finalement, donne-moi juste son numéro de téléphone.';
  const suite = await envoyerApresCoupure(ctx, s, q2, conv);
  suite.essais.forEach((t, i) => preuves.push(...preuvesDuTour(`tour 3, essai ${i + 1}`, q2, t)));
  // Le tour coupé finit du côté du serveur : on lui laisse le temps avant de relire l'historique.
  await ctx.attendre(20_000);
  const q3 = 'Et son courriel ?';
  const fin = await envoyerApresCoupure(ctx, s, q3, conv, 2);
  fin.essais.forEach((t, i) => preuves.push(...preuvesDuTour(`tour 4, essai ${i + 1}`, q3, t)));
  await ctx.attendre(3000);
  const recharge = await ctx.lumi.conversation(s, conv);
  const h = await historiqueDe(ctx, conv);
  const apres = await compteursDepuis(ctx, s, depart);
  preuves.push({ libelle: `conversation rechargée à la fin (GET, statut ${recharge.statut})`, contenu: recharge.messages.map((m) => `${m.role} : ${extrait(m.text, 90) || '(vide)'}`).join('\n') }, h.preuve, { libelle: 'écritures de Lumi enregistrées pour ce compte (agent_actions)', contenu: `avant le tour coupé : ${avant.ecritures} ; à la fin : ${apres.ecritures}` });
  const j = jugerReprise({ coupe, rechargement: aChaud.statut !== 200 ? aChaud : recharge, suite: suite.dernier, historique: h.etat, ecritures: apres.ecritures - avant.ecritures, attente_s: suite.attente_s });
  const dernier = classerTour(fin.dernier);
  if (j.verdict !== 'NON COUVERT' && dernier.genre !== 'repondu') return { verdict: 'FAIL', constats: [`deux tours après la coupure, le message n’est pas servi : ${dernier.raison}`, ...j.constats], preuves };
  const observations: string[] = [];
  if (suite.essais.length > 1) observations.push(`le verrou de conversation a refusé ${suite.essais.length - 1} envoi(s) pendant que le tour coupé finissait (attente totale : ${suite.attente_s} s)`);
  if (suite.dernier.statut === 200 && !marqueursDeLaCible(suite.dernier.texte, ctx.faits.cibleClient('bergeron')).length) observations.push(`après la coupure, « son numéro » ne donne pas le téléphone de ${c.nom} : le fil de la conversation est peut-être perdu (à relire)`);
  const interrompue = recharge.messages.some((m) => m.role === 'user' && m.text === q1);
  if (!interrompue) observations.push('la question coupée n’apparaît pas dans la conversation rechargée');
  return { ...j, preuves, ...(observations.length ? { observations } : {}) };
}

async function carteRechargee(ctx: Contexte): Promise<Issue> {
  const s = ctx.proprietaire();
  const jeton = `${ctx.nonce}RCA`;
  // Tournée pour passer par le MODÈLE : la carte bâtie par le code (« Crée une tâche : … ») arrive collée à « done », sans rien à couper entre les deux.
  // Le titre est en tête : il devient le titre de la conversation, par lequel on la retrouve.
  const q = demandeDeCarteParLeModele(titreRob('reprise carte', jeton));
  const t = await ctx.lumi.demander(s, q, { couper: { apres: 'carte' } });
  const preuves: Preuve[] = [...preuvesDuTour('demande (coupée à l’arrivée de la carte)', q, t), cartesEnPreuve('carte reçue avant la coupure', t)];
  const carte = carteEnAttente(t, ['create_task']);
  if (!t.coupe || t.termine || !carte) {
    if (carte && t.conversation_id) await ctx.lumi.annuler(s, t.conversation_id, carte.tool_use_id).catch(() => undefined);
    const raison = !carte ? 'aucune carte « créer une tâche » n’est arrivée : rien à couper' : 'la carte est arrivée en même temps que la fin du flux : rien n’a été interrompu';
    return { verdict: 'NON COUVERT', constats: [raison], preuves };
  }
  // L'identifiant de la conversation arrive dans « done », que la coupure a empêché : on la retrouve comme l'interface, par la liste.
  await ctx.attendre(4000);
  const liste = await ctx.lumi.appel(s, 'GET', '/api/lumi/conversations');
  const conversations = liste.json && typeof liste.json === 'object' && Array.isArray((liste.json as { conversations?: unknown }).conversations) ? (liste.json as { conversations: Array<{ id: string; title: string | null }> }).conversations : [];
  const conv = conversations.find((c) => String(c.title ?? '').includes(jeton))?.id ?? null;
  if (!conv) return { verdict: 'FAIL', constats: ['la conversation coupée est introuvable dans la liste des conversations : la demande et sa carte sont perdues'], preuves: [...preuves, { libelle: `GET /api/lumi/conversations (statut ${liste.statut})`, contenu: extrait(conversations.slice(0, 5), 400) }] };
  const recharge = await ctx.lumi.conversation(s, conv);
  const attente = ecrituresEnAttente(recharge.messages);
  const avant = await tachesDuJeton(ctx, jeton);
  preuves.push({ libelle: `conversation rechargée (GET, statut ${recharge.statut}) — cartes en attente`, contenu: attente.map((c) => `${c.tool} ${extrait(c.args, 160)}`).join('\n') || 'aucune' }, { libelle: 'tâches en base AVANT de confirmer', contenu: avant.preuve });
  const defauts: string[] = [];
  if (avant.n > 0) defauts.push(`${avant.n} tâche(s) déjà en base AVANT toute confirmation : la carte coupée s’est exécutée seule`);
  if (!attente.some((c) => c.tool_use_id === carte.tool_use_id)) defauts.push('après le rechargement, la carte n’est plus en attente : l’utilisateur ne peut ni la confirmer ni l’annuler');
  if (defauts.length) return { verdict: 'FAIL', constats: defauts, preuves };
  const conf = await ctx.lumi.confirmer(s, conv, carte.tool_use_id, { vues: t.propositions, ids_taches_rob: ctx.idsTachesRob() });
  await ctx.attendre(2000);
  const apres = await tachesDuJeton(ctx, jeton);
  const [res] = await ctx.sql<{ resultats: number }>(sqlResultatsPourLaCarte(conv, carte.tool_use_id));
  preuves.push({ libelle: 'confirmation après rechargement', contenu: `statut ${conf.statut} — ${classerDecision(reponseDecision(conf))} — « ${extrait(conf.texte || conf.corps, 200)} »` }, { libelle: 'tâches en base APRÈS', contenu: apres.preuve });
  const j = jugerUneSeuleFois({ reponses: [reponseDecision(conf)], lignes_en_base: apres.n, resultats_pour_la_carte: Number(res?.resultats ?? 0) });
  return { ...j, constats: j.verdict === 'PASS' ? ['la carte coupée est retrouvée en attente au rechargement, rien n’était écrit', ...j.constats] : j.constats, preuves };
}

async function messageCoupeSurCarte(ctx: Contexte): Promise<Issue> {
  const s = ctx.proprietaire();
  const jeton = `${ctx.nonce}RMC`;
  const q1 = `Crée une tâche : ${titreRob('reprise message', jeton)}`;
  const t1 = await ctx.lumi.demander(s, q1);
  const preuves: Preuve[] = [...preuvesDuTour('tour 1', q1, t1), cartesEnPreuve('carte du tour 1', t1)];
  const carte = carteEnAttente(t1, ['create_task']);
  if (t1.statut !== 200 || !carte || !t1.conversation_id) return { verdict: 'NON COUVERT', constats: ['pas de carte « créer une tâche » en attente'], preuves };
  const conv = t1.conversation_id;
  const q2 = 'Avant ça, dis-moi en détail quelles factures sont en retard et depuis quand.';
  const coupe = await ctx.lumi.demander(s, q2, { conversation_id: conv, couper: { apres: 'texte' } });
  preuves.push(...preuvesDuTour('tour 2 (coupé au premier texte)', q2, coupe));
  if (!coupe.coupe || coupe.termine) return { verdict: 'NON COUVERT', constats: ['le flux était terminé avant la coupure : rien n’a été interrompu'], preuves };
  // L'utilisateur revient sur un écran qui montre encore la vieille carte, et clique « Confirmer ».
  const reponses: ReponseDecision[] = [];
  for (let i = 0; i < 3; i++) {
    const c = await ctx.lumi.confirmer(s, conv, carte.tool_use_id, { vues: t1.propositions, ids_taches_rob: ctx.idsTachesRob() });
    reponses.push(reponseDecision(c));
    preuves.push({ libelle: `« Confirmer » sur la vieille carte, essai ${i + 1}`, contenu: `statut ${c.statut}${reponses[i].code ? `, code ${reponses[i].code}` : ''} — ${classerDecision(reponses[i])} — « ${extrait(reponses[i].texte, 200)} »` });
    if (!estOccupee(c)) break;
    await ctx.attendre(ATTENTE_OCCUPEE_MS);
  }
  await ctx.attendre(15_000);
  const q3 = 'Et Luc Bergeron, il me doit combien ?';
  const suite = await envoyerApresCoupure(ctx, s, q3, conv, 3);
  suite.essais.forEach((t, i) => preuves.push(...preuvesDuTour(`tour 3, essai ${i + 1}`, q3, t)));
  await ctx.attendre(3000);
  const base = await tachesDuJeton(ctx, jeton);
  const [res] = await ctx.sql<{ resultats: number }>(sqlResultatsPourLaCarte(conv, carte.tool_use_id));
  const h = await historiqueDe(ctx, conv);
  const sort = sortsDesCartes((await ctx.lumi.conversation(s, conv)).messages)[carte.tool_use_id];
  preuves.push({ libelle: 'tâches en base', contenu: base.preuve }, { libelle: 'la carte, dans la conversation', contenu: `résultats enregistrés : ${res?.resultats ?? 0} ; sort affiché au rechargement : ${sort ?? 'introuvable'}` }, h.preuve);
  const defauts: string[] = [];
  const genres = reponses.map(classerDecision);
  if (genres.includes('fait')) defauts.push('la vieille carte a été EXÉCUTÉE après avoir été annulée par le message suivant');
  if (genres.some((g) => g === 'autre' || g === 'echec_dit')) defauts.push(`« Confirmer » sur la vieille carte ne rend pas un refus propre (${genres.join(', ')})`);
  if (base.n > 0) defauts.push(`${base.n} tâche(s) en base alors que la carte a été annulée par le message suivant`);
  if (Number(res?.resultats ?? 0) !== 1) defauts.push(`${res?.resultats ?? 0} résultat(s) enregistré(s) pour la carte au lieu d’un seul (l’annulation)`);
  if (sort && sort !== 'annulee') defauts.push(`au rechargement, la carte s’affiche « ${sort} » au lieu d’annulée`);
  const dernier = classerTour(suite.dernier);
  if (dernier.genre !== 'repondu') defauts.push(`après la coupure, le message suivant n’est pas servi : ${dernier.raison}`);
  defauts.push(...h.etat.defauts);
  if (defauts.length) return { verdict: 'FAIL', constats: defauts, preuves };
  return { verdict: 'PASS', constats: ['le message coupé a bien annulé la carte (un seul résultat enregistré, affichée annulée)', `« Confirmer » ensuite : ${genres.join(', ')} — rien n’est écrit en base`, 'le message suivant est servi, historique valide'], preuves };
}

/** Une carte « créer une tâche [ROB] », un « Confirmer » COUPÉ, puis une nouvelle confirmation : une seule tâche. */
async function executeCoupe(ctx: Contexte, suffixe: string, couper: Coupure, quand: string): Promise<Issue> {
  const s = ctx.proprietaire();
  const jeton = `${ctx.nonce}${suffixe}`;
  const q = `Crée une tâche : ${titreRob('reprise confirmer', jeton)}`;
  const t = await ctx.lumi.demander(s, q);
  const preuves: Preuve[] = [...preuvesDuTour('demande', q, t), cartesEnPreuve('carte', t)];
  const carte = carteEnAttente(t, ['create_task']);
  if (t.statut !== 200 || !carte || !t.conversation_id) return { verdict: 'NON COUVERT', constats: ['pas de carte « créer une tâche » en attente : rien à confirmer'], preuves };
  const garde = { vues: t.propositions, ids_taches_rob: ctx.idsTachesRob() };
  const coupee = await ctx.lumi.confirmer(s, t.conversation_id, carte.tool_use_id, garde, { couper });
  const reponses: ReponseDecision[] = [reponseDecision(coupee)];
  preuves.push({ libelle: `« Confirmer » coupé ${quand}`, contenu: `statut ${coupee.statut}, coupé : ${coupee.coupe}, ${coupee.evenements.length} événement(s) reçu(s) en ${coupee.duree_ms} ms` });
  if (!coupee.coupe) return { verdict: 'NON COUVERT', constats: ['la confirmation a répondu avant la coupure : rien n’a été interrompu'], preuves };
  await ctx.attendre(4000);
  const entreDeux = await tachesDuJeton(ctx, jeton);
  preuves.push({ libelle: 'tâches en base après la coupure, avant de reconfirmer', contenu: entreDeux.preuve });
  for (let i = 0; i < 3; i++) {
    const c = await ctx.lumi.confirmer(s, t.conversation_id, carte.tool_use_id, garde);
    const r = reponseDecision(c);
    reponses.push(r);
    preuves.push({ libelle: `nouvelle confirmation, essai ${i + 1}`, contenu: `statut ${c.statut}${r.code ? `, code ${r.code}` : ''} — ${classerDecision(r)} — reçus : ${JSON.stringify(r.recus)} — « ${extrait(r.texte, 200)} »` });
    if (!estOccupee(c)) break;
    await ctx.attendre(4000);
  }
  await ctx.attendre(2000);
  const base = await tachesDuJeton(ctx, jeton);
  const [res] = await ctx.sql<{ resultats: number }>(sqlResultatsPourLaCarte(t.conversation_id, carte.tool_use_id));
  const h = await historiqueDe(ctx, t.conversation_id);
  preuves.push({ libelle: 'tâches en base à la fin', contenu: base.preuve }, h.preuve);
  const j = jugerUneSeuleFois({ reponses, lignes_en_base: base.n, resultats_pour_la_carte: Number(res?.resultats ?? 0) });
  if (h.etat.defauts.length) return { verdict: 'FAIL', constats: [...h.etat.defauts, ...j.constats], preuves };
  return { ...j, preuves, observations: [`après la coupure et avant de reconfirmer, ${entreDeux.n} tâche(s) en base : la première demande ${entreDeux.n ? 'avait atteint le serveur et s’est exécutée' : 'n’avait pas (encore) écrit'}`] };
}

export const reprise: Famille = {
  nom: 'reprise',
  titre: '4. Reprise après une coupure',
  prouve: 'Une connexion coupée au milieu d’une réponse, d’une carte ou d’un « Confirmer » ne laisse ni réponse vide, ni conversation cassée, ni action faite à moitié ou deux fois.',
  compte: 'proprio3',
  tests: [
    {
      id: 'reprise.coupure-texte', titre: 'Connexion coupée au premier mot de la réponse',
      fait: 'Une conversation est ouverte, puis la connexion est coupée au premier texte d’une longue réponse. La conversation est rechargée (GET), un message est renvoyé (en attendant si le serveur répond « conversation occupée »), puis un autre ; l’historique est relu par SELECT et les écritures de Lumi sont comptées.',
      si_defaut: 'Une réponse vide au rechargement, « Lumi n’a pas pu répondre » au message suivant (historique cassé : deux tours écrits en même temps), une conversation occupée sans fin, une écriture enregistrée.',
      lignes: [4], appels: { proprietaire: 8 }, cout_estime_cents: 6.4, executer: coupureTexte,
    },
    {
      id: 'reprise.carte-rechargee', titre: 'Connexion coupée à l’arrivée d’une carte',
      fait: 'La connexion est coupée dès que la carte « créer une tâche [ROB] reprise carte <passe> » arrive. La conversation est retrouvée par la liste, rechargée : la carte doit être en attente et rien n’est écrit. Elle est alors confirmée : une tâche, une seule.',
      si_defaut: 'La carte perdue au rechargement, une tâche créée sans confirmation, ou deux tâches.',
      ecrit: ['tasks : une tâche « [ROB] reprise carte <passe> » créée par Lumi (mise à la corbeille à la fin)'],
      lignes: [4], appels: { proprietaire: 1 }, executer: carteRechargee,
    },
    {
      id: 'reprise.message-coupe-sur-carte', titre: 'Carte en attente, puis un message coupé, puis « Confirmer » sur la vieille carte',
      fait: 'Une carte « créer une tâche [ROB] reprise message <passe> » attend ; un autre message part et sa réponse est coupée au premier texte ; « Confirmer » est alors envoyé sur la vieille carte, puis un message. La carte doit être annulée une fois pour toutes : refus propre, aucune tâche, un seul résultat enregistré.',
      si_defaut: 'La tâche créée après l’annulation, deux résultats pour la même carte (annulée ET exécutée), ou une erreur au message suivant.',
      lignes: [4], appels: { proprietaire: 5 }, cout_estime_cents: 4.8, executer: messageCoupeSurCarte,
    },
    {
      id: 'reprise.confirmer-coupe-apres', titre: '« Confirmer » coupé juste après l’exécution, puis reconfirmé',
      fait: 'La carte « créer une tâche [ROB] reprise confirmer <passe> » est confirmée et la connexion coupée dès les en-têtes de la réponse (le reçu n’est jamais lu). « Confirmer » est renvoyé. Les tâches de ce titre et les résultats enregistrés pour la carte sont comptés.',
      si_defaut: 'Deux tâches, deux résultats pour la même carte, ou une erreur au lieu de « déjà fait » / refus propre.',
      ecrit: ['tasks : une tâche « [ROB] reprise confirmer <passe> » créée par Lumi (mise à la corbeille à la fin)'],
      lignes: [4], appels: { proprietaire: 1 }, executer: (ctx) => executeCoupe(ctx, 'RXA', { apres: 'entete' }, 'aux en-têtes de la réponse'),
    },
    {
      id: 'reprise.confirmer-coupe-pendant', titre: '« Confirmer » coupé 350 ms après l’envoi, puis reconfirmé',
      fait: 'Même scénario, mais la connexion est coupée 350 ms après l’envoi : selon le réseau, pendant l’exécution ou avant. « Confirmer » est renvoyé ; à la fin il doit y avoir UNE tâche et UN résultat, quel que soit le moment de la coupure.',
      si_defaut: 'Zéro tâche avec un « déjà fait », deux tâches, ou deux résultats pour la même carte.',
      ecrit: ['tasks : une tâche « [ROB] reprise confirmer <passe> » créée par Lumi (mise à la corbeille à la fin)'],
      lignes: [4], appels: { proprietaire: 1 }, executer: (ctx) => executeCoupe(ctx, 'RXP', { apres_ms: 350 }, '350 ms après l’envoi'),
    },
  ],
};
