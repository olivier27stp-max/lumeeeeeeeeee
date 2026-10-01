/**
 * Famille 8 — Pannes : ce qui s'observe de l'extérieur.
 *  - un OUTIL qui échoue pour vrai après la confirmation : le reçu dit l'échec, jamais « c'est fait », et le modèle
 *    le redit quand on lui demande ;
 *  - une réponse COUPÉE par la limite de sortie (max_tokens) : provoquée par une demande de rédaction longue ;
 *  - la LIMITE HORAIRE : atteinte par un compte dédié (le technicien) avec des messages VIDES — le limiteur du
 *    serveur passe avant la validation, donc chaque refus 400 compte, sans un seul appel au modèle ;
 *  - les `stop_reason` vus pendant TOUTE la batterie (lumi_traces.params.mesure).
 *
 * NON COUVERT par construction : 429, surcharge et délai de l'API du MODÈLE. Les provoquer demanderait de casser le
 * fournisseur pour tous les clients ; ils sont couverts hors réseau (tests du dépôt principal).
 *
 * L'outil qui échoue : une tâche [ROB] créée par la batterie, que Lumi propose de marquer terminée, et que la
 * batterie met à la corbeille ENTRE la carte et la confirmation. (Le remboursement d'un paiement par chèque, que
 * l'outil refuse aussi, viserait une fiche du jeu [EVAL] : la batterie ne confirme jamais une carte d'argent.)
 */
import { extrait } from '../../critiques/jugement.mts';
import { sqlDernierTexteAvant, sqlStopReasons, sqlTache, sqlTours } from '../faits.mts';
import { mettreTacheALaCorbeille, titreRob } from '../fiches-rob.mts';
import { STOPS_ANORMAUX_CONNUS, classerDecision, estFinAnormale, jugerLimiteHoraire, jugerRecuEchec, jugerReponseCoupee, jugerStopReasons, jugerSuiteApresEchec, reponseDecision, type LigneStop, type SondeLimite } from '../jugement.mts';
import type { Contexte, Famille, Issue, Preuve, Tour } from '../types.mts';
import { annulerLesCartes, carteEnAttente, cartesEnPreuve, compteursDepuis, preuvesDuTour } from './commun.mts';

export const HORS_RESEAU = ['tests/lumi-fin-anormale.test.ts', 'tests/lumi-flux-interrompu.test.ts', 'tests/lumi-limite-horaire.test.ts'];
const OUTILS_DE_TACHE = ['update_task_status', 'update_task'];

async function outilEchec(ctx: Contexte): Promise<Issue> {
  const s = ctx.proprietaire();
  const tache = await ctx.creerTacheRob(titreRob('panne outil', `${ctx.nonce}PAN`));
  const q = `Marque la tâche « ${tache.titre} » comme terminée.`;
  const t = await ctx.lumi.demander(s, q);
  const preuves: Preuve[] = [{ libelle: 'tâche créée par la batterie (clé de service)', contenu: `${tache.titre} — ${tache.id}` }, ...preuvesDuTour('demande', q, t), cartesEnPreuve('carte', t)];
  const carte = carteEnAttente(t, OUTILS_DE_TACHE);
  if (t.statut !== 200 || !carte || !t.conversation_id) { await annulerLesCartes(ctx, s, t); return { verdict: 'NON COUVERT', constats: ['pas de carte « terminer la tâche » en attente : il n’y a rien à faire échouer'], preuves }; }
  if (String(carte.args.task_id) !== tache.id) { await annulerLesCartes(ctx, s, t); return { verdict: 'NON COUVERT', constats: ['la carte ne vise pas la tâche [ROB] du test : la batterie ne la confirme pas'], preuves }; }
  const requete = sqlTache(ctx.org, tache.id);
  const [avant] = await ctx.sql<{ status: string; completed_at: string | null }>(requete);
  // La panne : la tâche part à la corbeille entre la carte et la confirmation. L'outil ne peut plus la trouver.
  await mettreTacheALaCorbeille(ctx.admin, ctx.org, tache.id);
  const conf = await ctx.lumi.confirmer(s, t.conversation_id, carte.tool_use_id, { vues: t.propositions, ids_taches_rob: ctx.idsTachesRob() });
  await ctx.attendre(1500);
  const [apres] = await ctx.sql<{ status: string; completed_at: string | null; deleted_at: string | null }>(requete);
  const r = reponseDecision(conf);
  preuves.push(
    { libelle: 'confirmation, la tâche étant à la corbeille', contenu: `statut ${conf.statut}${r.code ? `, code ${r.code}` : ''} — ${classerDecision(r)} — reçus : ${JSON.stringify(r.recus)} — « ${extrait(r.texte, 300)} »` },
    { libelle: 'la tâche en base (SELECT)', contenu: `${requete}\navant : ${JSON.stringify(avant)}\naprès : ${JSON.stringify(apres)}` },
  );
  const recu = jugerRecuEchec({ confirmation: r, inchangee: avant?.status === apres?.status && (avant?.completed_at ?? null) === (apres?.completed_at ?? null) });
  if (recu.verdict === 'FAIL' || recu.verdict === 'NON COUVERT') return { ...recu, preuves };
  // Le reçu est un gabarit du serveur ; le MODÈLE doit dire la même chose quand on le lui demande.
  const q2 = 'Est-ce que c’est fait ?';
  const t2 = await ctx.lumi.demander(s, q2, { conversation_id: t.conversation_id });
  await annulerLesCartes(ctx, s, t2);
  preuves.push(...preuvesDuTour('« c’est fait ? »', q2, t2));
  const suite = jugerSuiteApresEchec(t2);
  const observations = /tool execution failed/i.test(r.texte) ? ['le reçu d’échec porte un message technique en anglais (« Tool execution failed. ») : l’utilisateur ne sait pas pourquoi'] : undefined;
  if (suite.verdict === 'FAIL' || suite.verdict === 'NON COUVERT') return { ...suite, constats: [...suite.constats, ...recu.constats], preuves, ...(observations ? { observations } : {}) };
  const verdict = recu.verdict === 'A RELIRE' || suite.verdict === 'A RELIRE' ? 'A RELIRE' : 'PASS';
  return { verdict, constats: [...recu.constats, ...suite.constats], ...(recu.a_relire || suite.a_relire ? { a_relire: [recu.a_relire, suite.a_relire].filter(Boolean).join(' ') } : {}), preuves, ...(observations ? { observations } : {}) };
}

async function reponseCoupee(ctx: Contexte): Promise<Issue> {
  const s = ctx.proprietaire();
  const q = 'Rédige ici, au complet, un courriel d’au moins 2 500 mots que je pourrais envoyer à mes clients commerciaux pour expliquer en détail notre service de lavage de vitres en hiver : préparation, étapes, sécurité, fréquence, prix, questions fréquentes. N’abrège pas et ne me demande rien : écris tout le texte.';
  const t = await ctx.lumi.demander(s, q);
  const preuves: Preuve[] = preuvesDuTour('demande de rédaction longue', q, t);
  await annulerLesCartes(ctx, s, t);
  let trace: { stop: string | null; resultat: string } | null = null;
  if (t.conversation_id) {
    await ctx.attendre(3000);
    const lignes = await ctx.sql<{ stop: string | null; resultat: string; etage: number | null; cost_cents: number | null }>(sqlTours(ctx.org, t.conversation_id));
    const l = lignes[lignes.length - 1];
    if (l) { trace = { stop: l.stop ?? null, resultat: String(l.resultat) }; preuves.push({ libelle: 'trace du tour (lumi_traces)', contenu: `étage ${l.etage ?? '—'}, résultat « ${l.resultat} », fin « ${l.stop ?? '—'} », ${Number(l.cost_cents ?? 0).toFixed(3)} ¢ ; ${t.texte.length} caractères reçus` }); }
  }
  const coupee = t.statut === 200 && (t.erreurs.includes('reponse_coupee') || trace?.stop === 'max_tokens' || trace?.stop === 'model_context_window_exceeded');
  let suite: Tour | null = null;
  if (coupee && t.conversation_id) {
    suite = await ctx.lumi.demander(s, 'continue', { conversation_id: t.conversation_id });
    preuves.push(...preuvesDuTour('« continue »', 'continue', suite));
    await annulerLesCartes(ctx, s, suite);
  }
  return { ...jugerReponseCoupee({ tour: t, trace, suite }), preuves };
}

/** Sondes au plus : la limite est de 60 par heure ; quatre de marge. */
const MAX_SONDES = 64;

async function limiteHoraire(ctx: Contexte): Promise<Issue> {
  const tech = await ctx.technicien();
  await ctx.attendre(3000);
  const depart = new Date();
  const avant = await compteursDepuis(ctx, tech, depart);
  const sondes: SondeLimite[] = [];
  for (let i = 0; i < MAX_SONDES; i++) {
    const t = await ctx.lumi.envoyerBrut(tech, { conversation_id: null, message: '', language: 'fr' }, { hors_budget: true });
    sondes.push({ statut: t.statut, restant: t.restant, retry_after: t.retry_after });
    if (t.statut === 429) break;
    if (t.statut !== 400) break; // ni le refus de validation attendu, ni la limite : on n'insiste pas
    if (i === 0 && t.restant === null) break; // aucun en-tête de la limite horaire : elle n'est pas observable
    if ((i + 1) % 20 === 0) ctx.dire(`    sonde ${i + 1} : restant annoncé ${t.restant ?? '—'}`);
  }
  const derniere = sondes[sondes.length - 1];
  const atteinte = derniere?.statut === 429 && (derniere.retry_after ?? 0) > 90;
  const question = 'Combien de clients j’ai ?';
  const reel = atteinte ? await ctx.lumi.envoyerBrut(tech, { conversation_id: null, message: question, language: 'fr' }, { hors_budget: true }) : null;
  await ctx.attendre(2500);
  const apres = await compteursDepuis(ctx, tech, depart);
  const preuves: Preuve[] = [
    { libelle: `sondes : ${sondes.length} message(s) VIDE(S) du compte ${tech.courriel}`, contenu: sondes.map((x, i) => `${i + 1}. statut ${x.statut}, restant ${x.restant ?? '—'}${x.retry_after !== null ? `, attente ${x.retry_after} s` : ''}`).filter((_, i) => i < 3 || i >= sondes.length - 4).join('\n') },
    ...(reel ? preuvesDuTour('un vrai message, après la limite', question, reel) : []),
    { libelle: 'tours tracés pour ce compte (SELECT)', contenu: `avant : ${avant.tours} ; après : ${apres.tours}` },
  ];
  const j = jugerLimiteHoraire({ sondes, reel, tours_avant: avant.tours, tours_apres: apres.tours });
  return { ...j, preuves, observations: atteinte ? [`le compte ${tech.courriel} reste limité pendant ${Math.ceil((derniere.retry_after ?? 3600) / 60)} minutes : aucune autre famille ne s’en sert`] : undefined };
}

async function stopReasons(ctx: Contexte): Promise<Issue> {
  const conversations = ctx.conversationsDeLaBatterie();
  if (!conversations.length) return { verdict: 'NON COUVERT', constats: ['aucune conversation de la batterie à relire : lancer d’abord les autres familles, dans le même rapport (--sortie)'], preuves: [] };
  await ctx.attendre(3000);
  const requete = sqlStopReasons(ctx.org, conversations);
  const brut = await ctx.sql<Record<string, unknown>>(requete);
  const lignes: LigneStop[] = brut.map((l) => ({
    conversation_id: String(l.conversation_id), cree_le: String(l.created_at), resultat: String(l.resultat), action: l.action ? String(l.action) : null,
    stop: l.stop ? String(l.stop) : null, appels_modele: l.appels_modele === null || l.appels_modele === undefined ? null : Number(l.appels_modele),
    erreur_modele: l.erreur_modele ? String(l.erreur_modele) : null, tronque: l.tronque === true, texte_recu: null,
  }));
  for (const l of lignes.filter(estFinAnormale)) {
    try {
      const [m] = await ctx.sql<{ texte: string | null }>(sqlDernierTexteAvant(l.conversation_id, l.cree_le));
      l.texte_recu = m ? String(m.texte ?? '') : '';
    } catch { l.texte_recu = null; }
  }
  const { jugement, decompte, anormaux } = jugerStopReasons(lignes);
  const jamaisVus = STOPS_ANORMAUX_CONNUS.filter((x) => !(x in decompte));
  const sansMesure = lignes.filter((l) => l.stop === null && l.appels_modele === null).length;
  const observations = [
    ...(jamaisVus.length ? [`fins jamais observées dans cette passe : ${jamaisVus.join(', ')} — couvertes hors réseau par ${HORS_RESEAU[0]}`] : []),
    ...(sansMesure ? [`${sansMesure} tour(s) d’agent sans mesure (params.mesure absent) : le serveur qui a répondu ne l’écrit pas encore, ou le tour n’a pas appelé le modèle`] : []),
    ...lignes.filter((l) => l.stop === 'tool_use' && l.resultat === 'ok').map((l) => `tour fini sur « tool_use » et tracé « ok » sans carte (action : ${l.action ?? '—'}) — conversation ${l.conversation_id}, ${l.cree_le}`),
  ];
  return {
    ...jugement, observations: observations.length ? observations : undefined,
    preuves: [
      { libelle: `${conversations.length} conversation(s) de la batterie — tours d’agent (SELECT sur lumi_traces)`, contenu: `${requete.slice(0, 400)}…\n→ ${lignes.length} ligne(s) ; ${Object.entries(decompte).map(([k, n]) => `${k} × ${n}`).join(', ') || '—'}` },
      ...(anormaux.length ? [{ libelle: 'fins anormales', contenu: anormaux.map((l) => `${l.cree_le} — ${l.stop ?? '(aucun)'} — ${l.erreur_modele ?? ''} — résultat « ${l.resultat} » — reçu : ${extrait(l.texte_recu, 200)}`).join('\n') }] : []),
    ],
  };
}

export const pannes: Famille = {
  nom: 'pannes',
  titre: '8. Pannes',
  prouve: 'Un outil qui échoue donne un reçu d’échec, jamais « c’est fait » ; une réponse coupée est dite ; la limite horaire refuse clairement ; aucune fin anormale n’est tracée comme un succès.',
  compte: 'proprio4',
  tests: [
    {
      id: 'pannes.outil-echec', titre: 'L’outil échoue après la confirmation',
      fait: 'La batterie crée la tâche « [ROB] panne outil <passe> », demande à Lumi de la marquer terminée (carte), met la tâche à la corbeille, PUIS confirme : l’outil ne peut plus la trouver. Le reçu est lu, la tâche est relue en base, puis « Est-ce que c’est fait ? » est posé.',
      si_defaut: 'Un reçu « C’est fait », un événement d’exécution réussie, la tâche modifiée en base, ou le modèle qui répond « oui, c’est fait ».',
      ecrit: ['tasks : une tâche « [ROB] panne outil <passe> » créée avec la clé de service, mise à la corbeille pendant le test'],
      lignes: [9, 8], appels: { proprietaire: 2 }, executer: outilEchec,
    },
    {
      id: 'pannes.reponse-coupee', titre: 'Réponse coupée par la limite de sortie (max_tokens)',
      fait: 'Une demande de rédaction de 2 500 mots (la sortie du modèle est bornée à 2 048 tokens). Si la réponse est coupée : l’événement « reponse_coupee », l’avis dans le texte et la trace sont vérifiés, puis « continue » est envoyé.',
      si_defaut: 'Un texte tronqué sans un mot, tracé comme un succès, ou « continue » qui rend une erreur.',
      attente_discutable: 'Rien n’oblige le modèle à écrire assez pour atteindre la limite (il peut résumer, ou refuser une rédaction si longue) : le test rend alors NON COUVERT, et la coupe reste couverte hors réseau.',
      lignes: [8, 10], appels: { proprietaire: 2 }, cout_estime_cents: 7, executer: reponseCoupee,
    },
    {
      id: 'pannes.limite-horaire', titre: 'La limite de 60 tours par heure, atteinte par un compte dédié',
      fait: 'Le compte technicien (aucune autre famille ne s’en sert) envoie des messages VIDES — refusés 400, sans modèle, mais comptés par le limiteur — jusqu’au 429. Puis un vrai message : il doit recevoir un 429 avec un délai, pas un flux ; aucun tour n’est tracé.',
      si_defaut: 'Un vrai message servi après la limite, un 429 sans message ni délai, ou une limite annoncée qui n’est pas appliquée.',
      attente_discutable: 'Le compte reste limité une heure. Si les refus 400 ne comptaient pas dans la limite (validation placée avant le limiteur), la limite ne serait atteignable qu’avec 60 vrais tours (≈ 1 $) : le test rend alors NON COUVERT.',
      lignes: [8], appels: { technicien: MAX_SONDES + 1 }, cout_estime_cents: 0, vise_la_limite: true, executer: limiteHoraire,
    },
    {
      id: 'pannes.fournisseur', titre: '429, surcharge et délai de l’API du modèle',
      fait: 'Non joué.', si_defaut: '—',
      lignes: [8], appels: {},
      non_couvert: {
        raison: 'Un 429, un 529 « overloaded » ou un délai dépassé de l’API du modèle ne se provoquent pas de l’extérieur sans casser le fournisseur pour tous les clients. Le client du modèle rejoue 3 fois avec attente croissante et abandonne à 90 s (server/lib/lumi/llm.ts) ; l’échec final rend « Lumi failed to respond. » (événement d’erreur, tour tracé « erreur »).',
        couvert_par: HORS_RESEAU,
      },
    },
    {
      id: 'pannes.stop-reasons', titre: 'Les `stop_reason` vus pendant toute la batterie',
      fait: 'Relit lumi_traces.params.mesure pour toutes les conversations de la batterie (ce lancement et les précédents du même rapport). Toute fin hors end_turn / tool_use / pause_turn est listée avec ce que l’utilisateur a reçu.',
      si_defaut: 'Une fin anormale tracée « ok », ou sans aucun texte pour l’utilisateur.',
      lignes: [10], appels: {}, executer: stopReasons,
    },
  ],
};
