/**
 * Famille 4 — Escalade vers un humain.
 * Le CANARI passe avant toute autre question de la batterie (le lanceur l'exécute en premier,
 * quelle que soit la sélection) : n'importe quelle question peut finir chez un humain si le
 * modèle le décide, et l'escalade d'un bureau qui n'est pas arrêté par le bac à sable écrit à
 * de vraies personnes dans Slack. Tant que le canari n'a pas prouvé le contraire, rien d'autre
 * n'est demandé.
 */
import { sqlCanauxSlack, sqlEnvoisSimules } from '../faits.mts';
import { jugerCanari, jugerEscalade } from '../jugement.mts';
import { preuvesDuTour, unTour } from '../tour.mts';
import { MARQUEUR_SUP, type Contexte, type Famille, type Issue, type Session, type TestSupport } from '../types.mts';

export const ID_CANARI = 'escalade.canari';
export const MESSAGE_CANARI = `${MARQUEUR_SUP} Canari de la batterie d’évaluation du support — bureau de test, aucune réponse attendue.`;

async function executerCanari(ctx: Contexte, s: Session): Promise<Issue> {
  const [avant] = await ctx.sql<{ canaux: number }>(sqlCanauxSlack(ctx.org));
  const o = await ctx.poser(s, ID_CANARI, MESSAGE_CANARI, { humain: true });
  // Le courriel de repli est consigné au bac à sable pendant la requête ; une marge pour la lecture.
  await ctx.attendre(1500);
  const requete = sqlEnvoisSimules(ctx.org, o.debut);
  const [envois] = await ctx.sql<{ envois: number; sujets: string[] }>(requete);
  const [apres] = await ctx.sql<{ canaux: number }>(sqlCanauxSlack(ctx.org));
  const j = jugerCanari(o, { envois_simules: Number(envois?.envois ?? 0), canaux_avant: Number(avant?.canaux ?? 0), canaux_apres: Number(apres?.canaux ?? 0) });
  const observations = Number(avant?.canaux ?? 0) > 0 ? [`${avant.canaux} canal(aux) Slack existai(en)t déjà pour ce bureau avant le canari (créés avant le correctif) : aucun n’a été ajouté.`] : [];
  return {
    verdict: j.verdict, constats: j.constats, observations, ...(j.arret ? { arret: j.arret } : {}),
    preuves: preuvesDuTour(o, [{ libelle: 'bac à sable et Slack (SELECT envois_simules, support_slack_channels)', contenu: `${requete}\n→ ${JSON.stringify(envois)}\ncanaux Slack du bureau : ${avant?.canaux ?? '?'} avant, ${apres?.canaux ?? '?'} après` }]),
  };
}

export const canari: TestSupport = {
  id: ID_CANARI,
  titre: 'Canari : l’escalade d’un bureau de test ne touche pas Slack',
  fait: 'Avant toute autre question, un utilisateur demande un humain par le bouton (« humain: true », aucun modèle). On relit le ticket, ses messages système, le bac à sable des envois et les canaux Slack du bureau.',
  si_defaut: 'Le ticket porterait un fil ou un canal Slack, un message système « escalated:slack », un nouveau canal Slack pour le bureau — ou « escalated:email » sans aucune ligne envois_simules (le courriel serait parti pour vrai). Dans tous ces cas la batterie s’arrête.',
  appels: 1,
  question: MESSAGE_CANARI,
  humain: true,
  ecrit: ['1 ticket de support escaladé, sujet préfixé [SUP], fermé à la fin', '1 ligne envois_simules (le courriel d’escalade, consigné et non envoyé)'],
  executer: executerCanari,
};

interface CasEscalade { id: string; titre: string; question: string; attendue: boolean; offre_toleree?: boolean; fait: string; si_defaut: string; attente_discutable?: string }

export const CAS_ESCALADE: CasEscalade[] = [
  {
    id: 'humain-demande', titre: 'Demande explicite d’un humain', question: 'je veux parler à une vraie personne svp', attendue: true,
    fait: 'Un utilisateur écrit qu’il veut parler à une vraie personne (question reprise de evaluer-support-qualite.mts).',
    si_defaut: 'Le ticket resterait chez l’assistant (statut « ai », aucune date d’escalade) — par exemple parce que la FAQ « Comment parler à un humain ? » répond à sa place en lui disant de le redemander.',
  },
  {
    id: 'bogue', titre: 'Bogue décrit', question: "quand j'ouvre le calendrier ça charge sans arret pis ça affiche rien", attendue: true,
    fait: 'Un utilisateur décrit une page qui ne charge pas (question reprise de evaluer-support-qualite.mts).',
    si_defaut: 'Le ticket ne serait pas escaladé, ou la réponse ne dirait pas que l’équipe prend le relais.',
  },
  {
    id: 'facturation-abonnement', titre: 'Double prélèvement de l’abonnement', question: "Lume m'a prélevé deux fois mon abonnement ce mois-ci sur ma carte. Je veux qu'on me rembourse le deuxième prélèvement.", attendue: true,
    fait: 'Un utilisateur signale un double prélèvement de son abonnement Lume et demande un remboursement : le support ne peut pas le régler lui-même.',
    si_defaut: 'Le ticket ne serait pas escaladé, ou le support promettrait lui-même un remboursement.',
  },
  {
    id: 'hors-connaissance', titre: 'Question hors de sa connaissance', question: "Est-ce que Lume a un rapport d'audit SOC 2 Type II à jour ? Mon assureur me le demande pour mon dossier.", attendue: true, offre_toleree: true,
    fait: 'Un utilisateur demande un document que ni la FAQ, ni la carte de l’app, ni la documentation du support ne mentionnent.',
    si_defaut: 'Le support affirmerait une certification, ou resterait sans transférer ni proposer l’équipe.',
    attente_discutable: 'Le prompt du support dit de ne PAS transférer une question « hors de Lume ». Celle-ci porte sur Lume mais n’est dans aucune de ses sources : la mission demande l’escalade ; proposer l’équipe sans transférer est rendu « A RELIRE ».',
  },
  {
    id: 'faq-sans-escalade', titre: 'Une question dont la FAQ a la réponse n’escalade pas', question: 'Comment ajouter un employé à mon équipe ?', attendue: false,
    fait: 'Un utilisateur pose mot pour mot une question de la FAQ (« add-member ») : la réponse est écrite, aucun humain n’est nécessaire.',
    si_defaut: 'Le ticket porterait une date d’escalade et un message système « escalated:* ».',
  },
];

export const escalade: Famille = {
  nom: 'escalade',
  titre: '4. Escalade vers un humain',
  prouve: 'Une demande d’humain, un bogue, un litige de facturation de l’abonnement ou une question hors de sa connaissance finissent chez l’équipe (ticket escaladé en base, la réponse le dit) — sans rien envoyer dans Slack depuis un bureau de test ; une question de la FAQ, elle, n’escalade pas.',
  tests: [
    canari,
    ...CAS_ESCALADE.map((c): TestSupport => ({
      id: `escalade.${c.id}`, titre: `${c.titre} : « ${c.question} »`, fait: c.fait, si_defaut: c.si_defaut, appels: 1, question: c.question,
      ...(c.attente_discutable ? { attente_discutable: c.attente_discutable } : {}),
      ...(c.attendue ? { ecrit: ['si le support transfère : 1 ticket escaladé et 1 ligne envois_simules (courriel consigné, non envoyé)'] } : {}),
      executer: (ctx, s) => unTour(ctx.poser, s, `escalade.${c.id}`, c.question, (o) => jugerEscalade(o, { attendue: c.attendue, offre_toleree: c.offre_toleree })),
    })),
  ],
};
