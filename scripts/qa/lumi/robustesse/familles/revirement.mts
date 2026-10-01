/**
 * Famille 3 — Revirements.
 * Une carte est proposée, puis l'utilisateur change d'idée : il corrige la cible, annule, reformule, ou passe à autre
 * chose. L'ancienne carte doit être ANNULÉE (lue dans la conversation rechargée), jamais exécutée ni laissée en
 * attente ; la suite est servie sans erreur ; rien n'est écrit en base.
 *
 * Aucune carte de cette famille n'est confirmée.
 */
import { sqlEnvoisDepuis, sqlTachesDuJeton } from '../faits.mts';
import { titreRob } from '../fiches-rob.mts';
import { classerTour, jugerCarteCible, jugerRevirement, sortsDesCartes } from '../jugement.mts';
import type { Contexte, Famille, Issue, Preuve, Tour } from '../types.mts';
import { annulerLesCartes, carteEnAttente, cartesEnPreuve, historiqueDe, issue, preuvesDuTour, sansJeu } from './commun.mts';

/** Relit la conversation comme l'interface, et rend le sort de chaque carte. */
async function sorts(ctx: Contexte, conversationId: string): Promise<{ sorts: Record<string, string>; preuve: Preuve }> {
  const c = await ctx.lumi.conversation(ctx.proprietaire(), conversationId);
  const s = sortsDesCartes(c.messages);
  return { sorts: s, preuve: { libelle: `conversation rechargée (GET, statut ${c.statut}) — sort des cartes`, contenu: Object.entries(s).map(([id, v]) => `${id.slice(-8)} : ${v}`).join('\n') || 'aucune carte' } };
}

const tachesDuJeton = async (ctx: Contexte, jeton: string): Promise<{ n: number; preuve: Preuve }> => {
  const requete = sqlTachesDuJeton(ctx.org, jeton);
  const l = await ctx.sql<{ title: string }>(requete);
  return { n: l.length, preuve: { libelle: 'tâches de ce test en base (SELECT)', contenu: `${requete}\n→ ${l.map((x) => x.title).join(' | ') || 'aucune'}` } };
};

async function correction(ctx: Contexte): Promise<Issue> {
  if (!ctx.jeuPresent) return sansJeu;
  const s = ctx.proprietaire();
  const a = ctx.faits.client('roy_longueuil');
  const b = ctx.faits.client('roy_brossard');
  const [avant] = await ctx.sql<{ envois: number }>(sqlEnvoisDepuis(ctx.org, ctx.debut.toISOString()));
  const q1 = `Envoie un texto à ${a.nom} de ${a.ville} : « Bonjour, on confirme pour demain. »`;
  const t1 = await ctx.lumi.demander(s, q1);
  const preuves = [...preuvesDuTour('tour 1', q1, t1), cartesEnPreuve('cartes du tour 1', t1)];
  const premiere = carteEnAttente(t1, ['send_sms']);
  if (!premiere || !t1.conversation_id) {
    await annulerLesCartes(ctx, s, t1);
    return issue(jugerRevirement({ premiere: null, sorts: {}, suivant: t1, lignes_en_base: 0 }), preuves);
  }
  const q2 = `Non, pas elle : l’autre ${b.nom}, celle de ${b.ville}.`;
  const t2 = await ctx.lumi.demander(s, q2, { conversation_id: t1.conversation_id });
  preuves.push(...preuvesDuTour('tour 2', q2, t2), cartesEnPreuve('cartes du tour 2', t2));
  const r = await sorts(ctx, t1.conversation_id);
  await annulerLesCartes(ctx, s, t2);
  await ctx.attendre(1500);
  const [apres] = await ctx.sql<{ envois: number }>(sqlEnvoisDepuis(ctx.org, ctx.debut.toISOString()));
  preuves.push(r.preuve, { libelle: 'envois consignés au bac à sable depuis le début de la passe', contenu: `avant : ${avant?.envois ?? 0} ; après : ${apres?.envois ?? 0}` });
  const nouvelle = jugerCarteCible(t2, { outils: ['send_sms'], attendu: { libelle: `${b.nom} (${b.ville})`, telephones: [b.telephone] }, exclus: [{ libelle: `${a.nom} (${a.ville}), la première cible`, telephones: [a.telephone] }] });
  return issue(jugerRevirement({ premiere, sorts: r.sorts, suivant: t2, nouvelle, lignes_en_base: Math.max(0, Number(apres?.envois ?? 0) - Number(avant?.envois ?? 0)) }), preuves);
}

/** Une carte « créer une tâche [ROB] », puis un second message ; rend tout ce qu'il faut pour juger. */
async function carteLaissee(ctx: Contexte, sujet: string, suffixe: string, second: (jeton: string) => string): Promise<{ jeton: string; t1: Tour; t2: Tour | null; preuves: Preuve[] }> {
  const s = ctx.proprietaire();
  const jeton = `${ctx.nonce}${suffixe}`;
  const q1 = `Crée une tâche : ${titreRob(sujet, jeton)}`;
  const t1 = await ctx.lumi.demander(s, q1);
  const preuves = [...preuvesDuTour('tour 1', q1, t1), cartesEnPreuve('cartes du tour 1', t1)];
  if (!carteEnAttente(t1, ['create_task']) || !t1.conversation_id) { await annulerLesCartes(ctx, s, t1); return { jeton, t1, t2: null, preuves }; }
  const q2 = second(jeton);
  const t2 = await ctx.lumi.demander(s, q2, { conversation_id: t1.conversation_id });
  preuves.push(...preuvesDuTour('tour 2', q2, t2), cartesEnPreuve('cartes du tour 2', t2));
  return { jeton, t1, t2, preuves };
}

async function annule(ctx: Contexte): Promise<Issue> {
  const { jeton, t1, t2, preuves } = await carteLaissee(ctx, 'annulation', 'ANN', () => 'Annule ça, finalement.');
  if (!t2 || !t1.conversation_id) return issue(jugerRevirement({ premiere: null, sorts: {}, suivant: t1, lignes_en_base: 0 }), preuves);
  const r = await sorts(ctx, t1.conversation_id);
  await annulerLesCartes(ctx, ctx.proprietaire(), t2);
  await ctx.attendre(1500);
  const base = await tachesDuJeton(ctx, jeton);
  preuves.push(r.preuve, base.preuve);
  return issue(jugerRevirement({ premiere: carteEnAttente(t1, ['create_task']) ?? null, sorts: r.sorts, suivant: t2, aucune_carte: true, lignes_en_base: base.n }), preuves);
}

async function reformulation(ctx: Contexte): Promise<Issue> {
  const { jeton, t1, t2, preuves } = await carteLaissee(ctx, 'appeler le fournisseur', 'TIT', (j) => `Attends, change le titre pour : ${titreRob('commander du savon', j)}`);
  if (!t2 || !t1.conversation_id) return issue(jugerRevirement({ premiere: null, sorts: {}, suivant: t1, lignes_en_base: 0 }), preuves);
  const r = await sorts(ctx, t1.conversation_id);
  await annulerLesCartes(ctx, ctx.proprietaire(), t2);
  await ctx.attendre(1500);
  const base = await tachesDuJeton(ctx, jeton);
  preuves.push(r.preuve, base.preuve);
  const nouvelle = jugerCarteCible(t2, { outils: ['create_task'], attendu: { libelle: 'le nouveau titre', textes: ['commander du savon'] }, exclus: [{ libelle: 'l’ancien titre', textes: ['appeler le fournisseur'] }] });
  return issue(jugerRevirement({ premiere: carteEnAttente(t1, ['create_task']) ?? null, sorts: r.sorts, suivant: t2, nouvelle, lignes_en_base: base.n }), preuves);
}

async function autreSujet(ctx: Contexte): Promise<Issue> {
  const s = ctx.proprietaire();
  const { jeton, t1, t2, preuves } = await carteLaissee(ctx, 'autre sujet', 'SUJ', () => 'Au fait, combien de clients j’ai ?');
  if (!t2 || !t1.conversation_id) return issue(jugerRevirement({ premiere: null, sorts: {}, suivant: t1, lignes_en_base: 0 }), preuves);
  const r = await sorts(ctx, t1.conversation_id);
  await annulerLesCartes(ctx, s, t2);
  const q3 = 'Et Luc Bergeron, il me doit combien ?';
  const t3 = await ctx.lumi.demander(s, q3, { conversation_id: t1.conversation_id });
  preuves.push(...preuvesDuTour('tour 3', q3, t3));
  await annulerLesCartes(ctx, s, t3);
  await ctx.attendre(1500);
  const base = await tachesDuJeton(ctx, jeton);
  const h = await historiqueDe(ctx, t1.conversation_id);
  preuves.push(r.preuve, base.preuve, h.preuve);
  const j = jugerRevirement({ premiere: carteEnAttente(t1, ['create_task']) ?? null, sorts: r.sorts, suivant: t2, lignes_en_base: base.n });
  const suite = classerTour(t3);
  const defauts = [...(suite.genre === 'repondu' ? [] : [`le troisième tour n’est pas servi : ${suite.raison}`]), ...h.etat.defauts];
  if (defauts.length) return { verdict: 'FAIL', constats: [...defauts, ...j.constats], preuves };
  const observations = t2.propositions.length ? [`après la question sans rapport, Lumi repropose une carte (${t2.propositions.map((p) => p.tool).join(', ')}) : hors du critère, à regarder`] : undefined;
  return issue(j.verdict === 'PASS' ? { ...j, constats: [...j.constats, 'le troisième tour est servi ; historique valide'] } : j, preuves, observations);
}

export const revirement: Famille = {
  nom: 'revirement',
  titre: '3. Revirements',
  prouve: 'Quand l’utilisateur corrige, annule, reformule ou change de sujet devant une carte, la carte est annulée, la suite est servie, rien n’est écrit.',
  compte: 'proprio2',
  besoin_jeu_eval: true,
  tests: [
    {
      id: 'revirement.correction', titre: '« Non, pas elle, l’autre » devant une carte de texto',
      fait: 'Carte de texto pour Marie Roy de Longueuil, puis « Non, pas elle : l’autre Marie Roy, celle de Brossard. » La conversation est rechargée pour lire le sort de la première carte ; la seconde doit montrer le numéro de Brossard. Aucune n’est confirmée ; les envois du bac à sable sont comptés.',
      si_defaut: 'La première carte encore en attente ou exécutée, une seconde carte encore vers Longueuil, un envoi consigné.',
      lignes: [3], appels: { proprietaire: 2 }, executer: correction,
    },
    {
      id: 'revirement.annule', titre: '« Annule ça » devant une carte',
      fait: 'Carte « créer une tâche [ROB] annulation <passe> », puis « Annule ça, finalement. » La carte doit être annulée, aucune autre proposée, aucune tâche en base.',
      si_defaut: 'La tâche créée, la carte encore en attente, une nouvelle carte, ou « c’est fait ».',
      lignes: [3], appels: { proprietaire: 2 }, executer: annule,
    },
    {
      id: 'revirement.reformulation', titre: 'Reformuler devant une carte',
      fait: 'Carte « créer une tâche [ROB] appeler le fournisseur <passe> », puis « Attends, change le titre pour : [ROB] commander du savon <passe> ». La première carte doit être annulée, la nouvelle porter le nouveau titre ; elle est annulée, aucune tâche en base.',
      si_defaut: 'Deux cartes en attente, l’ancien titre gardé, ou une tâche créée sans confirmation.',
      lignes: [3], appels: { proprietaire: 2 }, executer: reformulation,
    },
    {
      id: 'revirement.autre-sujet', titre: 'Carte laissée, puis une question sans rapport',
      fait: 'Carte « créer une tâche [ROB] autre sujet <passe> » laissée sans réponse, puis « Au fait, combien de clients j’ai ? », puis une troisième question. La carte doit être annulée, les deux tours servis, l’historique enregistré valide (SELECT), aucune tâche en base.',
      si_defaut: 'La carte encore confirmable, une erreur au tour suivant (historique refusé par le modèle), une tâche créée.',
      lignes: [3], appels: { proprietaire: 3 }, executer: autreSujet,
    },
  ],
};
