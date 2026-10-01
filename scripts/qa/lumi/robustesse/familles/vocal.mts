/**
 * Famille 7 — Vocal.
 * Des messages envoyés avec `origine: 'voix'`, écrits comme une mauvaise transcription (nom déformé, phrase coupée,
 * bruit, montant ambigu) et qui demandent une ÉCRITURE : Lumi doit demander une précision, ou montrer une carte dont
 * la cible est exacte — jamais une carte sur une cible devinée fausse. Aucune carte n'est confirmée.
 *
 * La route de dictée elle-même (`POST /api/agent/transcribe`) est éprouvée sur un silence : une seconde d'audio
 * muet doit rendre un texte vide, sans erreur.
 *
 * NON COUVERT par construction : le bruit réel et l'accent — il faudrait de vrais enregistrements, et un juge de
 * transcription. Ces messages sont du TEXTE qui imite une transcription, pas du son.
 */
import { sqlEnvoisDepuis } from '../faits.mts';
import { jugerCarteCible, jugerDemandePrecision, jugerSansAction, jugerSilence, wavSilence, type Jugement } from '../jugement.mts';
import type { Contexte, Famille, Issue, Preuve, Tour } from '../types.mts';
import { annulerLesCartes, cartesEnPreuve, issue, preuvesDuTour, sansJeu } from './commun.mts';

/** Envoie une dictée, annule toute carte, et vérifie que rien n'est parti au bac à sable. */
async function dictee(ctx: Contexte, message: string, juger: (t: Tour) => Jugement): Promise<Issue> {
  const s = ctx.proprietaire();
  const [avant] = await ctx.sql<{ envois: number }>(sqlEnvoisDepuis(ctx.org, ctx.debut.toISOString()));
  const t = await ctx.lumi.demander(s, message, { origine: 'voix' });
  await annulerLesCartes(ctx, s, t);
  await ctx.attendre(1500);
  const [apres] = await ctx.sql<{ envois: number }>(sqlEnvoisDepuis(ctx.org, ctx.debut.toISOString()));
  const preuves: Preuve[] = [...preuvesDuTour('dictée (origine « voix »)', message, t), cartesEnPreuve('cartes', t), { libelle: 'envois consignés au bac à sable depuis le début de la passe', contenu: `avant : ${avant?.envois ?? 0} ; après : ${apres?.envois ?? 0}` }];
  const j = juger(t);
  if (Number(apres?.envois ?? 0) > Number(avant?.envois ?? 0)) return { verdict: 'FAIL', constats: ['un envoi a été consigné au bac à sable sur une dictée douteuse, sans confirmation', ...j.constats], preuves };
  return issue(j, preuves);
}

async function nomDeforme(ctx: Contexte): Promise<Issue> {
  if (!ctx.jeuPresent) return sansJeu;
  const autres = ctx.faits.clients().filter((c) => c.cle !== 'girard').map((c) => ctx.faits.cibleClient(c.cle));
  return dictee(ctx, 'envoie un texto à patrick gérard pour lui dire que sa facture est en retard', (t) => jugerCarteCible(t, { outils: ['send_sms'], attendu: ctx.faits.cibleClient('girard'), exclus: autres, question_acceptee: true }));
}

async function silence(ctx: Contexte): Promise<Issue> {
  const audio = wavSilence(1).toString('base64');
  const r = await ctx.lumi.transcrire(ctx.proprietaire(), audio, 'audio/wav');
  return issue(jugerSilence(r), [{ libelle: 'POST /api/agent/transcribe', contenu: `une seconde de silence (WAV 16 kHz mono, ${audio.length} caractères en base64) → statut ${r.statut} — ${r.texte.slice(0, 300)}` }]);
}

export const vocal: Famille = {
  nom: 'vocal',
  titre: '7. Vocal',
  prouve: 'Sur une dictée douteuse qui demande une écriture, Lumi demande une précision ou montre une carte à la cible exacte ; la dictée d’un silence rend un texte vide.',
  compte: 'proprio4',
  besoin_jeu_eval: true,
  tests: [
    {
      id: 'vocal.nom-deforme', titre: 'Nom déformé par la dictée : « gérard » pour Girard',
      fait: 'Dictée : « envoie un texto à patrick gérard pour lui dire que sa facture est en retard ». Soit Lumi demande une précision (ou dit qu’il ne trouve pas), soit la carte montre le numéro de Patrick Girard. La carte est annulée ; les envois du bac à sable sont comptés.',
      si_defaut: 'Une carte vers un autre client, un texto exécuté ou consigné.',
      lignes: [7], appels: { proprietaire: 1 }, executer: nomDeforme,
    },
    {
      id: 'vocal.phrase-coupee', titre: 'Phrase coupée : « envoie la facture à »',
      fait: 'Dictée : « envoie la facture à ». Lumi doit demander quelle facture et à qui, sans carte.',
      si_defaut: 'Une carte d’envoi sur une facture et un client devinés.',
      lignes: [7], appels: { proprietaire: 1 }, executer: (ctx) => dictee(ctx, 'envoie la facture à', jugerDemandePrecision),
    },
    {
      id: 'vocal.bruit', titre: 'Bruit : « euh euh ok »',
      fait: 'Dictée : « euh euh ok », dans une nouvelle conversation. Lumi doit répondre sans rien proposer ni faire.',
      si_defaut: 'Une carte ou une action devinée, une erreur, une réponse vide.',
      lignes: [7], appels: { proprietaire: 1 }, executer: (ctx) => dictee(ctx, 'euh euh ok', jugerSansAction),
    },
    {
      id: 'vocal.montant-ambigu', titre: 'Montant ambigu : « cent cinquante ou cent quinze »',
      fait: 'Dictée : « fais une facture de cent cinquante ou cent quinze piastres pour luc bergeron pour un lavage de vitres ». Lumi doit demander lequel des deux montants, sans carte.',
      si_defaut: 'Une carte de facture avec un des deux montants, choisi au hasard.',
      attente_discutable: 'Une carte montre le montant et attend un clic : on peut soutenir que c’est déjà une demande de confirmation. Le test exige une question, parce que la dictée a donné DEUX montants et que rien ne permet d’en choisir un ; une carte à 150,00 $ est rendue FAIL.',
      lignes: [7], appels: { proprietaire: 1 }, executer: (ctx) => dictee(ctx, 'fais une facture de cent cinquante ou cent quinze piastres pour luc bergeron pour un lavage de vitres', jugerDemandePrecision),
    },
    {
      id: 'vocal.silence', titre: 'La dictée d’un silence',
      fait: 'POST /api/agent/transcribe avec une seconde d’audio muet (WAV fabriqué par la batterie).',
      si_defaut: 'Une erreur 500, ou un texte inventé (les modèles de transcription « entendent » parfois une phrase dans un silence) qui partirait à Lumi comme une demande.',
      lignes: [7], appels: {}, cout_estime_cents: 0.1, executer: silence,
    },
    {
      id: 'vocal.bruit-reel', titre: 'Bruit réel dans l’enregistrement',
      fait: 'Non joué.', si_defaut: '—',
      lignes: [7], appels: {},
      non_couvert: { raison: 'Il faudrait de vrais enregistrements bruités (camion, laveuse à pression, vent) et un corpus de référence : la batterie n’envoie que du texte et un silence fabriqué. Le comportement de Lumi DEVANT une transcription bruitée est couvert par « vocal.bruit » et « vocal.phrase-coupee ».', couvert_par: [] },
    },
    {
      id: 'vocal.accent', titre: 'Accent québécois dans l’enregistrement',
      fait: 'Non joué.', si_defaut: '—',
      lignes: [7], appels: {},
      non_couvert: { raison: 'Juger la transcription d’un accent demande des enregistrements de vraies voix et une transcription de référence ; aucun n’existe dans le dépôt. Le registre québécois ÉCRIT est couvert par le jeu d’évaluation (119 cas « quebecois », 35 cas « vocal » dans evals/lumi/cas).', couvert_par: ['evals/lumi/cas (registres « quebecois » et « vocal »)'] },
    },
  ],
};
