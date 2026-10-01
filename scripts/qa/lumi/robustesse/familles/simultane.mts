/**
 * Famille 5 — Le même compte sur deux appareils en même temps.
 * Deux SESSIONS du même compte (deux jetons : « web » et « mobile ») envoient au même instant : deux messages dans
 * la même conversation, un message et un « Confirmer », deux « Confirmer », deux conversations différentes.
 * Critère : jamais deux résultats pour la même carte, jamais deux écritures, un historique valide ensuite — et
 * deux conversations différentes passent toutes les deux.
 *
 * Le serveur peut refuser le second arrivé par un 409 « conversation_occupee » / « decision_en_cours » (verrou) :
 * c'est un refus propre. Sans verrou, les deux passent : le test juge alors l'historique enregistré.
 *
 * Seules écritures confirmées : des tâches [ROB].
 */
import { extrait } from '../../critiques/jugement.mts';
import { sqlResultatsPourLaCarte, sqlSoldeClient, sqlTachesDuJeton } from '../faits.mts';
import { titreRob } from '../fiches-rob.mts';
import { classerDecision, estOccupee, jugerDeuxMessages, jugerMessageEtConfirmer, jugerParalleles, jugerUneSeuleFois, reponseDecision } from '../jugement.mts';
import type { Contexte, Famille, Issue, Preuve, Session, Tour } from '../types.mts';
import { annulerLesCartes, carteEnAttente, cartesEnPreuve, historiqueDe, issue, preuvesDuTour, sansJeu } from './commun.mts';

/** Le message d'après : si le verrou répond encore « occupée », on attend et on renvoie, trois fois au plus. */
async function suivant(ctx: Contexte, s: Session, message: string, conversationId: string): Promise<{ dernier: Tour; essais: Tour[] }> {
  const essais: Tour[] = [];
  for (let i = 0; i < 3; i++) {
    const t = await ctx.lumi.demander(s, message, { conversation_id: conversationId });
    essais.push(t);
    if (!estOccupee(t)) break;
    await ctx.attendre(8000);
  }
  return { dernier: essais[essais.length - 1], essais };
}

const tachesDuJeton = async (ctx: Contexte, jeton: string): Promise<{ n: number; preuve: Preuve }> => {
  const requete = sqlTachesDuJeton(ctx.org, jeton);
  const l = await ctx.sql<{ title: string }>(requete);
  return { n: l.length, preuve: { libelle: 'tâches de ce test en base (SELECT)', contenu: `${requete}\n→ ${l.length} ligne(s) : ${l.map((x) => x.title).join(' | ') || '—'}` } };
};

async function deuxMessages(ctx: Contexte): Promise<Issue> {
  if (!ctx.jeuPresent) return sansJeu;
  const web = ctx.proprietaire();
  const mobile = await ctx.secondeSession();
  const c = ctx.faits.client('bergeron');
  const q0 = `Montre-moi la fiche de ${c.nom}.`;
  const t0 = await ctx.lumi.demander(web, q0);
  const preuves: Preuve[] = preuvesDuTour('tour 1 (web)', q0, t0);
  if (t0.statut !== 200 || !t0.conversation_id) return { verdict: 'NON COUVERT', constats: [`pas de conversation ouverte (statut ${t0.statut})`], preuves };
  const conv = t0.conversation_id;
  const qa = 'Quel est son numéro de téléphone ?';
  const qb = 'Quelle est son adresse courriel ?';
  const [a, b] = await Promise.all([
    ctx.lumi.demander(web, qa, { conversation_id: conv, sans_cadence: true }),
    ctx.lumi.demander(mobile, qb, { conversation_id: conv, sans_cadence: true }),
  ]);
  preuves.push(...preuvesDuTour('en même temps — web', qa, a), ...preuvesDuTour('en même temps — mobile', qb, b));
  await annulerLesCartes(ctx, web, a);
  await annulerLesCartes(ctx, web, b);
  await ctx.attendre(4000);
  const q3 = 'Et dans quelle ville il est ?';
  const s3 = await suivant(ctx, web, q3, conv);
  s3.essais.forEach((t, i) => preuves.push(...preuvesDuTour(`tour suivant, essai ${i + 1}`, q3, t)));
  await ctx.attendre(3000);
  const h = await historiqueDe(ctx, conv);
  preuves.push(h.preuve);
  return issue(jugerDeuxMessages({ a, b, historique: h.etat, suite: s3.dernier }), preuves);
}

async function messageEtConfirmer(ctx: Contexte): Promise<Issue> {
  const web = ctx.proprietaire();
  const mobile = await ctx.secondeSession();
  const jeton = `${ctx.nonce}SMC`;
  const q1 = `Crée une tâche : ${titreRob('deux appareils', jeton)}`;
  const t1 = await ctx.lumi.demander(web, q1);
  const preuves: Preuve[] = [...preuvesDuTour('tour 1 (web)', q1, t1), cartesEnPreuve('carte', t1)];
  const carte = carteEnAttente(t1, ['create_task']);
  if (t1.statut !== 200 || !carte || !t1.conversation_id) return { verdict: 'NON COUVERT', constats: ['pas de carte « créer une tâche » en attente'], preuves };
  const conv = t1.conversation_id;
  const envoyerConfirmation = await ctx.lumi.preparerConfirmation(web, conv, carte.tool_use_id, { vues: t1.propositions, ids_taches_rob: ctx.idsTachesRob() });
  const q2 = 'Finalement non, laisse faire cette tâche.';
  const [conf, msg] = await Promise.all([envoyerConfirmation(), ctx.lumi.demander(mobile, q2, { conversation_id: conv, sans_cadence: true })]);
  const confirmation = reponseDecision(conf);
  preuves.push({ libelle: 'en même temps — web : « Confirmer »', contenu: `statut ${conf.statut}${confirmation.code ? `, code ${confirmation.code}` : ''} — ${classerDecision(confirmation)} — reçus : ${JSON.stringify(confirmation.recus)} — « ${extrait(confirmation.texte, 200)} »` }, ...preuvesDuTour('en même temps — mobile', q2, msg));
  await annulerLesCartes(ctx, web, msg);
  await ctx.attendre(4000);
  const q3 = 'Et Luc Bergeron, il me doit combien ?';
  const s3 = await suivant(ctx, web, q3, conv);
  s3.essais.forEach((t, i) => preuves.push(...preuvesDuTour(`tour suivant, essai ${i + 1}`, q3, t)));
  await ctx.attendre(3000);
  const base = await tachesDuJeton(ctx, jeton);
  const [res] = await ctx.sql<{ resultats: number }>(sqlResultatsPourLaCarte(conv, carte.tool_use_id));
  const h = await historiqueDe(ctx, conv);
  preuves.push(base.preuve, { libelle: 'résultats enregistrés pour la carte (SELECT)', contenu: String(res?.resultats ?? 0) }, h.preuve);
  return issue(jugerMessageEtConfirmer({ confirmation, message: msg, resultats_pour_la_carte: Number(res?.resultats ?? 0), lignes_en_base: base.n, historique: h.etat, suite: s3.dernier }), preuves);
}

async function deuxConfirmer(ctx: Contexte): Promise<Issue> {
  const web = ctx.proprietaire();
  const mobile = await ctx.secondeSession();
  const jeton = `${ctx.nonce}SDC`;
  const q = `Crée une tâche : ${titreRob('double confirmer', jeton)}`;
  const t = await ctx.lumi.demander(web, q);
  const preuves: Preuve[] = [...preuvesDuTour('demande (web)', q, t), cartesEnPreuve('carte', t)];
  const carte = carteEnAttente(t, ['create_task']);
  if (t.statut !== 200 || !carte || !t.conversation_id) return { verdict: 'NON COUVERT', constats: ['pas de carte « créer une tâche » en attente : rien à confirmer deux fois'], preuves };
  const garde = { vues: t.propositions, ids_taches_rob: ctx.idsTachesRob() };
  const surLeWeb = await ctx.lumi.preparerConfirmation(web, t.conversation_id, carte.tool_use_id, garde);
  const surLeMobile = await ctx.lumi.preparerConfirmation(mobile, t.conversation_id, carte.tool_use_id, garde);
  const [a, b] = await Promise.all([surLeWeb(), surLeMobile()]);
  await ctx.attendre(3000);
  const c = await ctx.lumi.confirmer(web, t.conversation_id, carte.tool_use_id, garde);
  const reponses = [a, b, c].map(reponseDecision);
  reponses.forEach((r, i) => preuves.push({ libelle: `confirmation ${i + 1} (${['web, en même temps', 'mobile, en même temps', 'web, après coup'][i]})`, contenu: `statut ${r.statut}${r.code ? `, code ${r.code}` : ''} — ${classerDecision(r)} — reçus : ${JSON.stringify(r.recus)} — « ${extrait(r.texte, 200)} »` }));
  await ctx.attendre(2000);
  const base = await tachesDuJeton(ctx, jeton);
  const [res] = await ctx.sql<{ resultats: number }>(sqlResultatsPourLaCarte(t.conversation_id, carte.tool_use_id));
  const h = await historiqueDe(ctx, t.conversation_id);
  preuves.push(base.preuve, h.preuve);
  const j = jugerUneSeuleFois({ reponses, lignes_en_base: base.n, resultats_pour_la_carte: Number(res?.resultats ?? 0) });
  return h.etat.defauts.length ? { verdict: 'FAIL', constats: [...h.etat.defauts, ...j.constats], preuves } : issue(j, preuves);
}

async function deuxConversations(ctx: Contexte): Promise<Issue> {
  if (!ctx.jeuPresent) return sansJeu;
  const web = ctx.proprietaire();
  const mobile = await ctx.secondeSession();
  const a = ctx.faits.client('bergeron');
  const b = ctx.faits.client('girard');
  const [sa] = await ctx.sql<{ solde_cents: number }>(sqlSoldeClient(ctx.org, a.id));
  const [sb] = await ctx.sql<{ solde_cents: number }>(sqlSoldeClient(ctx.org, b.id));
  const soldeA = Number(sa?.solde_cents ?? 0);
  const soldeB = Number(sb?.solde_cents ?? 0);
  const preuves: Preuve[] = [{ libelle: 'soldes dus (SELECT)', contenu: `${a.nom} : ${(soldeA / 100).toFixed(2)} $ ; ${b.nom} : ${(soldeB / 100).toFixed(2)} $` }];
  if (soldeA <= 0 || soldeB <= 0 || soldeA === soldeB) return { verdict: 'NON COUVERT', constats: ['les deux clients n’ont pas chacun un solde dû, distinct l’un de l’autre'], preuves };
  const qa = `Combien me doit ${a.nom} ?`;
  const qb = `Combien me doit ${b.nom} ?`;
  const [ta, tb] = await Promise.all([ctx.lumi.demander(web, qa, { sans_cadence: true }), ctx.lumi.demander(mobile, qb, { sans_cadence: true })]);
  preuves.push(...preuvesDuTour('conversation 1 (web)', qa, ta), ...preuvesDuTour('conversation 2 (mobile)', qb, tb));
  await annulerLesCartes(ctx, web, ta);
  await annulerLesCartes(ctx, web, tb);
  return issue(jugerParalleles({ a: ta, b: tb, cible_a: { libelle: `le solde de ${a.nom}`, montants_cents: [soldeA] }, cible_b: { libelle: `le solde de ${b.nom}`, montants_cents: [soldeB] } }), preuves);
}

export const simultane: Famille = {
  nom: 'simultane',
  titre: '5. Deux appareils en même temps',
  prouve: 'Deux sessions du même compte qui écrivent au même instant ne donnent jamais deux résultats pour la même carte ni un historique cassé ; deux conversations différentes passent toutes les deux.',
  compte: 'proprio3',
  tests: [
    {
      id: 'simultane.deux-messages', titre: 'Deux messages au même instant dans la même conversation',
      fait: 'Une conversation est ouverte sur le « web » ; le « web » et le « mobile » (deux jetons du même compte) y envoient chacun un message au même instant. Puis un message suit, et l’historique enregistré est relu par SELECT.',
      si_defaut: 'Une erreur 500, les deux messages refusés, un historique où une action n’a pas son résultat (les deux tours se sont écrits l’un dans l’autre), ou une erreur au message suivant.',
      lignes: [5, 6], appels: { proprietaire: 6 }, cout_estime_cents: 6.4, executer: deuxMessages,
    },
    {
      id: 'simultane.message-et-confirmer', titre: 'Un message et un « Confirmer » au même instant',
      fait: 'Une carte « créer une tâche [ROB] deux appareils <passe> » attend. Au même instant, le « web » confirme et le « mobile » écrit « Finalement non ». Les résultats enregistrés pour la carte et les tâches en base sont comptés, puis un message suit.',
      si_defaut: 'Deux résultats pour la même carte (confirmée ET annulée), une tâche créée alors que la confirmation dit non, ou une erreur au message suivant.',
      ecrit: ['tasks : au plus une tâche « [ROB] deux appareils <passe> » créée par Lumi (mise à la corbeille à la fin)'],
      lignes: [5], appels: { proprietaire: 5 }, cout_estime_cents: 4.8, executer: messageEtConfirmer,
    },
    {
      id: 'simultane.deux-confirmer', titre: '« Confirmer » sur le web et sur le mobile au même instant',
      fait: 'Une carte « créer une tâche [ROB] double confirmer <passe> » est confirmée au même instant par les deux sessions, puis une troisième fois 3 s plus tard.',
      si_defaut: 'Deux tâches, deux reçus « c’est fait », deux résultats enregistrés pour la carte, ou une erreur au lieu de « déjà fait » / refus propre.',
      ecrit: ['tasks : une tâche « [ROB] double confirmer <passe> » créée par Lumi (mise à la corbeille à la fin)'],
      lignes: [5], appels: { proprietaire: 1 }, executer: deuxConfirmer,
    },
    {
      id: 'simultane.deux-conversations', titre: 'Deux conversations différentes en parallèle',
      fait: 'Au même instant, le « web » demande dans une nouvelle conversation combien doit Luc Bergeron, et le « mobile », dans une autre, combien doit Patrick Girard. Chaque réponse doit porter SON solde (SELECT).',
      si_defaut: 'Une des deux refusée ou en erreur, les deux rangées dans la même conversation, ou une réponse qui porte le solde de l’autre.',
      lignes: [5], appels: { proprietaire: 2 }, executer: deuxConversations,
    },
  ],
};
