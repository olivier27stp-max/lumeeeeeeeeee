/**
 * Famille 6 — Entrées inhabituelles.
 * Message vide ou d'espaces, message au-delà de la limite (8 000 caractères), juste en dessous, collage de
 * 200 lignes, emojis seuls, même demande envoyée deux fois de suite.
 * Un message invalide est REFUSÉ proprement (4xx avec un message, pas de tour, pas de conversation) ; un message
 * valide est servi sans erreur ; deux envois de la même demande d'écriture ne donnent jamais deux écritures.
 */
import { extrait } from '../../critiques/jugement.mts';
import { sqlResultatsPourLaCarte, sqlTachesDuJeton } from '../faits.mts';
import { titreRob } from '../fiches-rob.mts';
import { classerDecision, classerTour, ecrituresEnAttente, erreurDe, jugerRefusPropre, jugerSansAction, jugerServi, reponseDecision, sortsDesCartes, type Jugement } from '../jugement.mts';
import type { Contexte, Famille, Issue, Preuve } from '../types.mts';
import { annulerLesCartes, carteEnAttente, cartesEnPreuve, compteursDepuis, historiqueDe, issue, preuvesDuTour } from './commun.mts';

/** La limite du schéma de validation du serveur (server/routes/lumi.ts : `message: z.string().trim().min(1).max(8000)`). */
export const LIMITE_MESSAGE = 8000;

const PHRASE = 'Lundi, lavage de vitres chez un client de Longueuil, deux heures de travail, rien à signaler. ';
/** Un message de la longueur voulue, fait de phrases ordinaires. */
export function messageDeLongueur(n: number, entete: string): string {
  const corps = PHRASE.repeat(Math.ceil(n / PHRASE.length) + 1);
  return `${entete}${corps}`.slice(0, n).trimEnd().padEnd(n, '.');
}
export const MESSAGE_TROP_LONG = messageDeLongueur(LIMITE_MESSAGE + 1, 'Voici mes notes de la semaine. ');
export const MESSAGE_LONG = messageDeLongueur(LIMITE_MESSAGE - 100, 'Voici mes notes de la semaine. Dis-moi en une phrase de quoi elles parlent. ');
/** Un collage de 200 lignes, sous la limite. */
export const COLLAGE = `Je te colle ma liste de la semaine. Combien de lignes il y a ?\n${Array.from({ length: 200 }, (_, i) => `Ligne ${String(i + 1).padStart(3, '0')} : vitres, 45,00 $`).join('\n')}`;

const pire = (a: Jugement, b: Jugement): Jugement => {
  const rang = { PASS: 0, 'A RELIRE': 1, 'NON COUVERT': 2, FAIL: 3 } as const;
  return rang[a.verdict] >= rang[b.verdict] ? a : b;
};

/** Envoie un message que le serveur doit refuser, et compte les tours et les conversations avant et après. */
async function refus(ctx: Contexte, libelle: string, message: string): Promise<{ j: Jugement; preuves: Preuve[]; observations: string[] }> {
  const s = ctx.proprietaire();
  // Les traces du test précédent s'écrivent après la réponse : on les laisse arriver avant de compter.
  await ctx.attendre(3000);
  const depart = new Date();
  const avant = await compteursDepuis(ctx, s, depart);
  const t = await ctx.lumi.envoyerBrut(s, { conversation_id: null, message, language: 'fr' });
  if (t.conversation_id) await annulerLesCartes(ctx, s, t);
  await ctx.attendre(2500);
  const apres = await compteursDepuis(ctx, s, depart);
  const preuves: Preuve[] = [
    ...preuvesDuTour(libelle, message.length > 120 ? `${message.slice(0, 100)}… (${message.length} caractères)` : JSON.stringify(message), t),
    { libelle: `${libelle} — tours tracés et conversations ouvertes (SELECT)`, contenu: `avant : ${avant.tours} tour(s), ${avant.conversations} conversation(s) ; après : ${apres.tours}, ${apres.conversations}` },
  ];
  // Hors du critère : le refus est propre, mais son texte est-il lisible par un humain ?
  const technique = /expected|characters|too (small|big|long|short)|string must|invalid input/i.test(erreurDe(t.corps));
  return {
    j: jugerRefusPropre(t, { tours_avant: avant.tours, tours_apres: apres.tours, conversations_avant: avant.conversations, conversations_apres: apres.conversations }), preuves,
    observations: technique ? [`${libelle} : le message du refus est un texte technique en anglais (« ${erreurDe(t.corps).slice(0, 120)} ») — l’interface n’envoie pas ce message, mais une autre porte d’entrée l’afficherait tel quel`] : [],
  };
}

async function vide(ctx: Contexte): Promise<Issue> {
  const a = await refus(ctx, 'message vide', '');
  const b = await refus(ctx, 'message d’espaces', '   \n\t  ');
  const j = pire(a.j, b.j);
  const observations = [...a.observations, ...b.observations];
  return { ...j, constats: [...a.j.constats.map((c) => `vide : ${c}`), ...b.j.constats.map((c) => `espaces : ${c}`)], preuves: [...a.preuves, ...b.preuves], ...(observations.length ? { observations } : {}) };
}

async function tropLong(ctx: Contexte): Promise<Issue> {
  const r = await refus(ctx, `message de ${MESSAGE_TROP_LONG.length} caractères`, MESSAGE_TROP_LONG);
  return issue(r.j, r.preuves, r.observations);
}

async function longAccepte(ctx: Contexte): Promise<Issue> {
  const s = ctx.proprietaire();
  const t = await ctx.lumi.demander(s, MESSAGE_LONG);
  await annulerLesCartes(ctx, s, t);
  return issue(jugerServi(t, { sans_ecriture: true }), preuvesDuTour(`message de ${MESSAGE_LONG.length} caractères`, `${MESSAGE_LONG.slice(0, 120)}… (${MESSAGE_LONG.length} caractères)`, t));
}

async function collage(ctx: Contexte): Promise<Issue> {
  const s = ctx.proprietaire();
  const t = await ctx.lumi.demander(s, COLLAGE);
  await annulerLesCartes(ctx, s, t);
  const j = jugerServi(t, { sans_ecriture: true });
  const observations = t.statut === 200 && !/\b200\b|deux cents/i.test(t.texte) ? ['la réponse ne dit pas « 200 » lignes (hors du critère : le test juge seulement que le collage est servi sans erreur ni écriture)'] : undefined;
  return issue(j, preuvesDuTour(`collage de 200 lignes (${COLLAGE.length} caractères)`, `${COLLAGE.slice(0, 140)}…`, t), observations);
}

async function emojis(ctx: Contexte): Promise<Issue> {
  const s = ctx.proprietaire();
  const message = '👍👍🙏';
  const t = await ctx.lumi.demander(s, message);
  await annulerLesCartes(ctx, s, t);
  return issue(jugerSansAction(t), preuvesDuTour('emojis seuls', message, t));
}

async function doubleEnvoi(ctx: Contexte): Promise<Issue> {
  const s = ctx.proprietaire();
  const jeton = `${ctx.nonce}DBL`;
  const q = `Crée une tâche : ${titreRob('double envoi', jeton)}`;
  const t1 = await ctx.lumi.demander(s, q);
  const preuves: Preuve[] = [...preuvesDuTour('premier envoi', q, t1), cartesEnPreuve('carte du premier envoi', t1)];
  const carte1 = carteEnAttente(t1, ['create_task']);
  if (t1.statut !== 200 || !t1.conversation_id || !carte1) return { verdict: 'NON COUVERT', constats: ['le premier envoi ne donne pas de carte « créer une tâche » : il n’y a pas d’écriture à doubler'], preuves };
  const conv = t1.conversation_id;
  const t2 = await ctx.lumi.demander(s, q, { conversation_id: conv });
  preuves.push(...preuvesDuTour('second envoi (même message, même conversation)', q, t2), cartesEnPreuve('carte du second envoi', t2));
  const recharge = await ctx.lumi.conversation(s, conv);
  const sorts = sortsDesCartes(recharge.messages);
  const enAttente = ecrituresEnAttente(recharge.messages);
  preuves.push({ libelle: `conversation rechargée (GET, statut ${recharge.statut})`, contenu: `sort des cartes : ${Object.entries(sorts).map(([id, v]) => `${id.slice(-8)} ${v}`).join(', ') || '—'} ; en attente : ${enAttente.length}` });
  const defauts: string[] = [];
  const c2 = classerTour(t2);
  if (c2.genre !== 'repondu') defauts.push(`le second envoi n’est pas servi : ${c2.raison}`);
  for (const r of [...t1.executes, ...t2.executes]) defauts.push(`écriture exécutée sans confirmation (${r.tool_use_id})`);
  if (sorts[carte1.tool_use_id] === 'en_attente' && enAttente.length > 1) defauts.push('DEUX cartes en attente pour la même demande : confirmer les deux créerait deux tâches');
  if (sorts[carte1.tool_use_id] === 'confirmee') defauts.push('la première carte a été exécutée par le second envoi');
  // S'il reste une carte en attente, on la confirme : il doit y avoir UNE tâche, pas deux.
  const carte2 = carteEnAttente(t2, ['create_task']);
  if (carte2 && enAttente.some((c) => c.tool_use_id === carte2.tool_use_id)) {
    const conf = await ctx.lumi.confirmer(s, conv, carte2.tool_use_id, { vues: [...t1.propositions, ...t2.propositions], ids_taches_rob: ctx.idsTachesRob() });
    preuves.push({ libelle: 'confirmation de la carte restante', contenu: `statut ${conf.statut} — ${classerDecision(reponseDecision(conf))} — « ${extrait(conf.texte || conf.corps, 200)} »` });
  }
  await ctx.attendre(2000);
  const requete = sqlTachesDuJeton(ctx.org, jeton);
  const taches = await ctx.sql<{ title: string }>(requete);
  const [res1] = await ctx.sql<{ resultats: number }>(sqlResultatsPourLaCarte(conv, carte1.tool_use_id));
  const h = await historiqueDe(ctx, conv);
  preuves.push({ libelle: 'tâches de ce test en base (SELECT)', contenu: `${requete}\n→ ${taches.length} ligne(s)` }, h.preuve);
  if (taches.length > 1) defauts.push(`${taches.length} tâches en base pour une seule demande envoyée deux fois`);
  if (Number(res1?.resultats ?? 0) > 1) defauts.push(`${res1?.resultats} résultats enregistrés pour la première carte`);
  defauts.push(...h.etat.defauts);
  if (defauts.length) return { verdict: 'FAIL', constats: defauts, preuves };
  return { verdict: 'PASS', constats: ['les deux envois sont servis, sans erreur', `la première carte : ${sorts[carte1.tool_use_id] ?? 'introuvable'} ; ${taches.length} tâche en base après confirmation de la carte restante`, `historique valide (${h.etat.messages} messages)`], preuves };
}

export const entrees: Famille = {
  nom: 'entrees',
  titre: '6. Entrées inhabituelles',
  prouve: 'Un message vide ou trop long est refusé proprement ; un message long, un collage et des emojis sont servis sans erreur ni écriture ; la même demande envoyée deux fois n’écrit qu’une fois.',
  compte: 'proprio4',
  tests: [
    {
      id: 'entrees.vide', titre: 'Message vide, message d’espaces',
      fait: 'POST /api/lumi/chat avec un message vide, puis avec des espaces et des retours à la ligne. Les tours tracés et les conversations du compte sont comptés avant et après.',
      si_defaut: 'Un tour ouvert sur du vide (flux 200), une erreur 500, un refus sans message, une conversation vide créée.',
      lignes: [6], appels: { proprietaire: 2 }, appels_sans_modele: 2, executer: vide,
    },
    {
      id: 'entrees.trop-long', titre: 'Message au-delà de la limite (8 001 caractères)',
      fait: 'POST /api/lumi/chat avec un message de 8 001 caractères (la limite du serveur est 8 000).',
      si_defaut: 'Le message accepté et envoyé au modèle, une erreur 500, un refus sans message.',
      lignes: [6], appels: { proprietaire: 1 }, appels_sans_modele: 1, executer: tropLong,
    },
    {
      id: 'entrees.long', titre: 'Message juste sous la limite (7 900 caractères)',
      fait: 'Un message de 7 900 caractères (des notes de la semaine, avec une question) : il doit être servi, sans erreur, sans carte.',
      si_defaut: 'Un refus, une erreur, un flux sans fin, une réponse vide, ou une carte tirée du texte collé.',
      lignes: [6], appels: { proprietaire: 1 }, cout_estime_cents: 2.5, executer: longAccepte,
    },
    {
      id: 'entrees.collage', titre: 'Collage de 200 lignes',
      fait: 'Un message de 200 lignes collées (« Ligne 001 : vitres, 45,00 $ »…), avec une question en tête : il doit être servi, sans erreur, sans carte.',
      si_defaut: 'Une erreur, une réponse vide, ou 200 cartes / une écriture tirée du collage.',
      lignes: [6], appels: { proprietaire: 1 }, cout_estime_cents: 2.5, executer: collage,
    },
    {
      id: 'entrees.emojis', titre: 'Emojis seuls',
      fait: 'Le message « 👍👍🙏 », seul, dans une nouvelle conversation.',
      si_defaut: 'Une erreur, une réponse vide, une carte ou une action devinée.',
      lignes: [6], appels: { proprietaire: 1 }, executer: emojis,
    },
    {
      id: 'entrees.double-envoi', titre: 'La même demande d’écriture envoyée deux fois de suite',
      fait: '« Crée une tâche : [ROB] double envoi <passe> » est envoyé deux fois de suite dans la même conversation. La conversation est rechargée, la carte qui reste en attente est confirmée, les tâches de ce titre sont comptées.',
      si_defaut: 'Deux cartes confirmables, deux tâches en base, une erreur au second envoi, un historique cassé.',
      ecrit: ['tasks : au plus une tâche « [ROB] double envoi <passe> » créée par Lumi (mise à la corbeille à la fin)'],
      lignes: [6], appels: { proprietaire: 2 }, executer: doubleEnvoi,
    },
  ],
};
