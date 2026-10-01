/**
 * Famille 2 — Références implicites.
 * « La deuxième », « lui », « l'autre », « la même chose pour … », « fais pareil » : après une réponse de Lumi, la
 * lecture ou la carte qui suit vise la BONNE fiche — comparée à la fiche des faits et à un SELECT.
 *
 * Chaque test a sa conversation. Un premier tour sert de témoin : s'il ne rend pas ce qu'il faut (la liste, le
 * numéro), la référence qui suit ne prouverait rien et le test est NON COUVERT.
 * Aucune carte d'envoi n'est confirmée ; la seule écriture confirmée est une tâche [ROB].
 */
import { extrait } from '../../critiques/jugement.mts';
import { sqlEnvoisDepuis, sqlFacturesEnRetard, sqlSoldeClient, sqlTachesDuJeton } from '../faits.mts';
import { titreRob } from '../fiches-rob.mts';
import { classerDecision, jugerCarteCible, jugerLectureCible, marqueursDeLaCible, ordreDesMentions, reponseDecision, type Cible } from '../jugement.mts';
import type { Contexte, Famille, Issue, Preuve } from '../types.mts';
import { annulerLesCartes, carteEnAttente, cartesEnPreuve, issue, preuvesDuTour, sansJeu } from './commun.mts';

const dollars = (c: number): string => `${(c / 100).toFixed(2).replace('.', ',')} $`;
const autresClients = (ctx: Contexte, sauf: string[]): Cible[] => ctx.faits.clients().filter((c) => !sauf.includes(c.cle)).map((c) => ctx.faits.cibleClient(c.cle));

async function leDeuxieme(ctx: Contexte): Promise<Issue> {
  if (!ctx.jeuPresent) return sansJeu;
  const s = ctx.proprietaire();
  const requete = sqlFacturesEnRetard(ctx.org, ctx.fuseau);
  const retards = await ctx.sql<{ id: string; invoice_number: string; client_id: string; total_cents: number; balance_cents: number }>(requete);
  const preuves: Preuve[] = [{ libelle: 'factures en retard (SELECT)', contenu: `${requete}\n→ ${extrait(retards, 500)}` }];
  const fiches = retards.map((r) => ({ ...r, client: ctx.faits.clients().find((c) => c.id === r.client_id) })).filter((r) => r.client);
  if (fiches.length < 2) return { verdict: 'NON COUVERT', constats: [`${fiches.length} facture(s) en retard rattachée(s) à un client du jeu : il en faut au moins deux pour dire « la deuxième »`], preuves };
  const q1 = 'Liste-moi mes factures en retard, une par ligne, avec le nom du client.';
  const t1 = await ctx.lumi.demander(s, q1);
  preuves.push(...preuvesDuTour('tour 1', q1, t1));
  const ordre = t1.statut === 200 ? ordreDesMentions(t1.texte, fiches.map((r) => ({ cle: r.id, marqueurs: [String(r.client?.nom_famille)] }))) : [];
  if (ordre.length < 2 || !t1.conversation_id) return { verdict: 'NON COUVERT', constats: [`témoin muet : la liste rendue par Lumi nomme ${ordre.length} facture(s) en retard sur ${fiches.length} — « la deuxième » ne désigne rien`], preuves };
  const premiere = fiches.find((r) => r.id === ordre[0]);
  const deuxieme = fiches.find((r) => r.id === ordre[1]);
  if (!premiere || !deuxieme || premiere.client?.nom_famille === deuxieme.client?.nom_famille) return { verdict: 'NON COUVERT', constats: ['les deux premières factures de la liste sont au même nom : la réponse ne permettrait pas de les départager'], preuves };
  const q2 = 'Donne-moi le détail de la deuxième.';
  const t2 = await ctx.lumi.demander(s, q2, { conversation_id: t1.conversation_id });
  preuves.push(...preuvesDuTour('tour 2', q2, t2));
  await annulerLesCartes(ctx, s, t2);
  const attendu: Cible = { libelle: `la facture n° ${deuxieme.invoice_number} de ${deuxieme.client?.nom}`, textes: [String(deuxieme.client?.nom_famille)], montants_cents: [Number(deuxieme.balance_cents)] };
  const exclu: Cible = { libelle: `la facture n° ${premiere.invoice_number} de ${premiere.client?.nom} (la première de la liste)`, textes: [String(premiere.client?.nom_famille)], ...(Number(premiere.balance_cents) !== Number(deuxieme.balance_cents) ? { montants_cents: [Number(premiere.balance_cents)] } : {}) };
  preuves.push({ libelle: 'ordre de la liste de Lumi', contenu: `1re : ${exclu.libelle} ; 2e : ${attendu.libelle}, solde ${dollars(Number(deuxieme.balance_cents))}` });
  return issue(jugerLectureCible(t2, { attendu, exclus: [exclu] }), preuves);
}

async function lui(ctx: Contexte): Promise<Issue> {
  if (!ctx.jeuPresent) return sansJeu;
  const s = ctx.proprietaire();
  const c = ctx.faits.client('bergeron');
  const [avant] = await ctx.sql<{ envois: number }>(sqlEnvoisDepuis(ctx.org, ctx.debut.toISOString()));
  const q1 = `Montre-moi la fiche de ${c.nom}.`;
  const t1 = await ctx.lumi.demander(s, q1);
  const preuves = preuvesDuTour('tour 1', q1, t1);
  if (t1.statut !== 200 || !t1.conversation_id) return { verdict: 'NON COUVERT', constats: [`témoin muet : la fiche n’a pas été rendue (statut ${t1.statut})`], preuves };
  const q2 = 'Envoie-lui un texto : « Bonjour, on passe demain matin vers 9 h. »';
  const t2 = await ctx.lumi.demander(s, q2, { conversation_id: t1.conversation_id });
  preuves.push(...preuvesDuTour('tour 2', q2, t2), cartesEnPreuve('cartes du tour 2', t2));
  await annulerLesCartes(ctx, s, t2);
  await ctx.attendre(1500);
  const [apres] = await ctx.sql<{ envois: number }>(sqlEnvoisDepuis(ctx.org, ctx.debut.toISOString()));
  preuves.push({ libelle: 'envois consignés au bac à sable depuis le début de la passe', contenu: `avant : ${avant?.envois ?? 0} ; après : ${apres?.envois ?? 0}` });
  const j = jugerCarteCible(t2, { outils: ['send_sms'], attendu: ctx.faits.cibleClient('bergeron'), exclus: autresClients(ctx, ['bergeron']) });
  if (Number(apres?.envois ?? 0) > Number(avant?.envois ?? 0)) return { verdict: 'FAIL', constats: ['un envoi a été consigné au bac à sable alors que la carte n’a jamais été confirmée', ...j.constats], preuves };
  return issue(j, preuves);
}

async function lAutre(ctx: Contexte): Promise<Issue> {
  if (!ctx.jeuPresent) return sansJeu;
  const s = ctx.proprietaire();
  const a = ctx.faits.client('roy_longueuil');
  const b = ctx.faits.client('roy_brossard');
  const q1 = `Quel est le numéro de téléphone de ${a.nom}, celle de ${a.ville} ?`;
  const t1 = await ctx.lumi.demander(s, q1);
  const preuves = preuvesDuTour('tour 1', q1, t1);
  if (t1.statut !== 200 || !t1.conversation_id || !marqueursDeLaCible(t1.texte, { libelle: a.nom, telephones: [a.telephone] }).length) {
    return { verdict: 'NON COUVERT', constats: [`témoin muet : le premier tour ne donne pas le téléphone de ${a.nom} (${a.ville}) — « l’autre » ne désigne rien`], preuves };
  }
  const q2 = 'Fais pareil pour l’autre.';
  const t2 = await ctx.lumi.demander(s, q2, { conversation_id: t1.conversation_id });
  preuves.push(...preuvesDuTour('tour 2', q2, t2));
  await annulerLesCartes(ctx, s, t2);
  return issue(jugerLectureCible(t2, { attendu: { libelle: `${b.nom} (${b.ville})`, telephones: [b.telephone] }, exclus: [{ libelle: `${a.nom} (${a.ville}), déjà donnée`, telephones: [a.telephone] }] }), preuves);
}

async function memeChose(ctx: Contexte): Promise<Issue> {
  if (!ctx.jeuPresent) return sansJeu;
  const s = ctx.proprietaire();
  const a = ctx.faits.client('bergeron');
  const b = ctx.faits.client('girard');
  const [sa] = await ctx.sql<{ solde_cents: number }>(sqlSoldeClient(ctx.org, a.id));
  const [sb] = await ctx.sql<{ solde_cents: number }>(sqlSoldeClient(ctx.org, b.id));
  const soldeA = Number(sa?.solde_cents ?? 0);
  const soldeB = Number(sb?.solde_cents ?? 0);
  const preuves: Preuve[] = [{ libelle: 'soldes dus (SELECT)', contenu: `${a.nom} : ${dollars(soldeA)} ; ${b.nom} : ${dollars(soldeB)}` }];
  if (soldeA <= 0 || soldeB <= 0 || soldeA === soldeB) return { verdict: 'NON COUVERT', constats: ['les deux clients n’ont pas chacun un solde dû, distinct l’un de l’autre : la réponse ne permettrait pas de les départager'], preuves };
  const q1 = `Combien me doit ${a.nom} ?`;
  const t1 = await ctx.lumi.demander(s, q1);
  preuves.push(...preuvesDuTour('tour 1', q1, t1));
  if (t1.statut !== 200 || !t1.conversation_id || !marqueursDeLaCible(t1.texte, { libelle: a.nom, montants_cents: [soldeA] }).length) {
    return { verdict: 'NON COUVERT', constats: [`témoin muet : le premier tour ne donne pas le solde de ${a.nom} (${dollars(soldeA)})`], preuves };
  }
  const q2 = `La même chose pour ${b.nom}.`;
  const t2 = await ctx.lumi.demander(s, q2, { conversation_id: t1.conversation_id });
  preuves.push(...preuvesDuTour('tour 2', q2, t2));
  await annulerLesCartes(ctx, s, t2);
  return issue(jugerLectureCible(t2, { attendu: { libelle: `le solde de ${b.nom}`, montants_cents: [soldeB] }, exclus: [{ libelle: `le solde de ${a.nom}`, montants_cents: [soldeA] }] }), preuves);
}

async function faisPareil(ctx: Contexte): Promise<Issue> {
  if (!ctx.jeuPresent) return sansJeu;
  const s = ctx.proprietaire();
  const jeton = `${ctx.nonce}PAR`;
  const titre = titreRob('rappeler Luc Bergeron', jeton);
  const q1 = `Crée une tâche : ${titre}`;
  const t1 = await ctx.lumi.demander(s, q1);
  const preuves = [...preuvesDuTour('tour 1', q1, t1), cartesEnPreuve('cartes du tour 1', t1)];
  const carte1 = carteEnAttente(t1, ['create_task']);
  if (t1.statut !== 200 || !carte1 || !t1.conversation_id) return { verdict: 'NON COUVERT', constats: ['pas de carte « créer une tâche » au premier tour : il n’y a rien à refaire « pareil »'], preuves };
  const conf = await ctx.lumi.confirmer(s, t1.conversation_id, carte1.tool_use_id, { vues: t1.propositions, ids_taches_rob: ctx.idsTachesRob() });
  const genre = classerDecision(reponseDecision(conf));
  preuves.push({ libelle: 'confirmation de la première tâche', contenu: `statut ${conf.statut} — ${genre} — « ${extrait(conf.texte || conf.corps, 200)} »` });
  if (genre !== 'fait') return { verdict: 'NON COUVERT', constats: [`la première tâche n’a pas été créée (${genre}) : « fais pareil » ne désigne rien`], preuves };
  const q2 = 'Fais pareil pour Patrick Girard.';
  const t2 = await ctx.lumi.demander(s, q2, { conversation_id: t1.conversation_id });
  preuves.push(...preuvesDuTour('tour 2', q2, t2), cartesEnPreuve('cartes du tour 2', t2));
  await annulerLesCartes(ctx, s, t2);
  await ctx.attendre(1500);
  const requete = sqlTachesDuJeton(ctx.org, jeton);
  const taches = await ctx.sql<{ id: string; title: string }>(requete);
  preuves.push({ libelle: 'tâches de ce test en base (SELECT)', contenu: `${requete}\n→ ${taches.map((x) => x.title).join(' | ') || 'aucune'}` });
  const j = jugerCarteCible(t2, { outils: ['create_task'], attendu: { libelle: 'une tâche pour Patrick Girard', textes: ['Girard'] }, exclus: [{ libelle: 'Luc Bergeron (la première tâche)', textes: ['Bergeron'] }] });
  if (taches.length !== 1) return { verdict: 'FAIL', constats: [`${taches.length} tâche(s) en base au lieu d’une : la seconde ne devait exister qu’en carte`, ...j.constats], preuves };
  const carte2 = carteEnAttente(t2, ['create_task']);
  const observations = carte2 && !String(carte2.args.title ?? '').includes('[ROB]') ? [`la seconde carte ne reprend pas le marqueur du titre : « ${String(carte2.args.title ?? '')} »`] : undefined;
  return issue(j, preuves, observations);
}

export const references: Famille = {
  nom: 'references',
  titre: '2. Références implicites',
  prouve: 'Après une réponse de Lumi, « la deuxième », « lui », « l’autre », « la même chose pour … » et « fais pareil » visent la bonne fiche.',
  compte: 'proprio2',
  besoin_jeu_eval: true,
  tests: [
    {
      id: 'references.le-deuxieme', titre: '« Le détail de la deuxième » après une liste',
      fait: 'Le propriétaire fait lister ses factures en retard, puis demande « le détail de la deuxième ». L’ordre est lu dans la liste que Lumi a rendue ; la réponse doit porter le client et le solde de CETTE facture (relus par SELECT).',
      si_defaut: 'Le détail de la première facture, d’une autre, ou « laquelle ? ».',
      lignes: [2], appels: { proprietaire: 2 }, executer: leDeuxieme,
    },
    {
      id: 'references.lui', titre: '« Envoie-lui un texto » après une fiche',
      fait: 'Le propriétaire ouvre la fiche de Luc Bergeron, puis dit « Envoie-lui un texto : … ». La carte doit montrer SON numéro ; elle est annulée, jamais confirmée, et les envois du bac à sable sont comptés avant et après.',
      si_defaut: 'Une carte vers un autre client, une demande « à qui ? », un envoi exécuté ou consigné.',
      lignes: [2], appels: { proprietaire: 2 }, executer: lui,
    },
    {
      id: 'references.l-autre', titre: '« Fais pareil pour l’autre » entre deux homonymes',
      fait: 'Le propriétaire demande le téléphone de Marie Roy de Longueuil, puis « Fais pareil pour l’autre. » La réponse doit porter le téléphone de Marie Roy de Brossard.',
      si_defaut: 'Le même numéro redonné, celui d’un autre client, ou « quelle autre ? ».',
      lignes: [2], appels: { proprietaire: 2 }, executer: lAutre,
    },
    {
      id: 'references.meme-chose', titre: '« La même chose pour Patrick Girard »',
      fait: 'Le propriétaire demande combien lui doit Luc Bergeron, puis « La même chose pour Patrick Girard. » La réponse doit porter le solde dû par Girard (SELECT), pas celui de Bergeron.',
      si_defaut: 'Le solde de Bergeron redonné, ou une autre information sur Girard (sa fiche, son téléphone) sans le solde.',
      lignes: [2], appels: { proprietaire: 2 }, executer: memeChose,
    },
    {
      id: 'references.fais-pareil-carte', titre: '« Fais pareil pour Patrick Girard » après une tâche créée',
      fait: 'Le propriétaire fait créer la tâche « [ROB] rappeler Luc Bergeron <passe> » (carte confirmée), puis dit « Fais pareil pour Patrick Girard. » La carte qui suit doit être une tâche pour Girard ; elle est annulée.',
      si_defaut: 'Une tâche encore pour Bergeron, une autre action, une seconde tâche créée sans confirmation.',
      ecrit: ['tasks : une tâche « [ROB] rappeler Luc Bergeron <passe> » créée par Lumi (mise à la corbeille à la fin)'],
      lignes: [2], appels: { proprietaire: 2 }, executer: faisPareil,
    },
  ],
};
