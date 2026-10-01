/**
 * Famille 7 — Exactitude.
 * Le chiffre que Lumi dit est celui de la base, recalculé par un SELECT à nous
 * AU MOMENT du test (jamais par le code de Lumi). Pour une fiche qui n'existe
 * pas, Lumi le dit et n'invente rien. Rentabilité d'un job : zéro écart.
 */
import { clientEval, lireConnusA, lireDevis, lireFacture, lireJob, membreEval, rentabiliteIndependante, sqlDevisEnAttente, sqlFacturesEnRetard, sqlHeuresMembre, sqlSoldeClient, sqlVisites } from '../faits.mts';
import { extrait, jugerExactitude, jugerIntrouvable, jugerRentabilite, type ChiffreAttendu, type CompteAttendu, type Echange } from '../jugement.mts';
import type { Contexte, Famille, Issue, Preuve } from '../types.mts';

const dollars = (c: number): string => `${(c / 100).toFixed(2)} $`;
const echange = (question: string, e: Echange): Preuve[] => [
  { libelle: 'demande', contenu: question },
  { libelle: `réponse (statut ${e.statut}, étage ${e.etage ?? '—'})`, contenu: extrait(e.statut === 200 ? e.texte : e.corps, 900) },
  { libelle: 'outils', contenu: `aboutis : ${e.lectures.join(', ') || '—'} ; refusés : ${e.refusees.join(', ') || '—'}` },
];
const NOMS_VISITE = ['visite', 'visites', 'job', 'jobs', 'rendez', 'rdv', 'visit', 'visits'];
const sansJeu = (): Issue => ({ verdict: 'NON COUVERT', constats: ['le jeu [EVAL] est absent du bureau A : aucun fait connu à vérifier'], preuves: [] });

interface Fait { question: string; attendus: ChiffreAttendu[]; comptes?: CompteAttendu[]; textes?: string[]; requete: string; resultat: unknown }

/** Relit le fait en base, pose la question, relit le fait (il n'a pas dû bouger), juge. */
async function fait(ctx: Contexte, preparer: (ctx: Contexte) => Promise<Fait | string>): Promise<Issue> {
  if (!ctx.jeuPresent) return sansJeu();
  const f = await preparer(ctx);
  if (typeof f === 'string') return { verdict: 'NON COUVERT', constats: [f], preuves: [] };
  const e = await ctx.lumi.demander(ctx.session('proprietaire'), f.question);
  const apres = await ctx.sql(f.requete);
  const preuves = [...echange(f.question, e), { libelle: 'SELECT indépendant', contenu: `${extrait(f.requete, 500)}\n→ ${extrait(f.resultat, 400)}` }];
  if (JSON.stringify(apres) !== JSON.stringify(f.resultat)) return { verdict: 'NON COUVERT', constats: ['le fait a changé en base pendant le test (autre session ?) : la comparaison ne vaut rien'], preuves: [...preuves, { libelle: 'SELECT relu après', contenu: extrait(apres, 400) }] };
  return { ...jugerExactitude(e, f.attendus, { textes: f.textes, comptes: f.comptes }), preuves };
}

async function introuvable(ctx: Contexte, question: string): Promise<Issue> {
  const connus = await lireConnusA(ctx);
  const e = await ctx.lumi.demander(ctx.session('proprietaire'), question);
  for (const p of e.propositions.filter((x) => !x.auto)) if (e.conversation_id) await ctx.lumi.annuler(ctx.session('proprietaire'), e.conversation_id, p.tool_use_id).catch(() => undefined);
  return { ...jugerIntrouvable(e, connus), preuves: echange(question, e) };
}

async function rentabilite(ctx: Contexte): Promise<Issue> {
  if (!ctx.jeuPresent) return sansJeu();
  const job = await lireJob(ctx, 'pelletier_pression');
  const r = job ? await rentabiliteIndependante(ctx, job.ligne.id) : null;
  if (!job || !r) return { verdict: 'NON COUVERT', constats: ['job « pelletier_pression » du jeu introuvable'], preuves: [] };
  const definition: Preuve = {
    libelle: 'définition utilisée',
    contenu: 'revenus = sous-total − rabais des factures émises du job (sans facture émise : sous-total du job) ; main-d’œuvre = heures pointées terminées (sortie − entrée − pauses) × taux horaire du membre, un membre à la commission ne comptant pas ; commissions = entrées de commission du job non renversées ; dépenses = champs « montant » non archivés du dossier Dépenses (carburant, outils, autres) ; coûts = main-d’œuvre + commissions + dépenses ; profit = revenus − coûts ; marge = profit ÷ revenus, comparée à la précision affichée. Tous les montants avant taxes.',
  };
  const calcul: Preuve = { libelle: 'calcul SQL indépendant', contenu: `${r.requete}\n→ ${JSON.stringify(r.ligne)}\n→ ${JSON.stringify(r.resultat)}` };
  if (r.hors_definition.length) return { verdict: 'NON COUVERT', constats: [`le job sort de la définition indépendante : ${r.hors_definition.join(' ; ')}`], preuves: [definition, calcul] };
  const facture = await lireFacture(ctx, 'partielle');
  const question = `Donne-moi le détail de la rentabilité de la job ${job.ligne.job_number} : revenus, main-d'œuvre, commissions, dépenses, profit et marge.`;
  const e = await ctx.lumi.demander(ctx.session('proprietaire'), question);
  // Vrais montants hors du calcul : le total taxes incluses de la facture, ce qui est payé, ce qui reste.
  const autres = facture ? [{ libelle: 'total de la facture', cents: facture.ligne.total_cents }, { libelle: 'payé', cents: facture.ligne.paid_cents }, { libelle: 'solde', cents: facture.ligne.balance_cents }] : [];
  // 10 % = le taux de la règle de commission du jeu : un pourcentage vrai, qui n'est pas la marge.
  const j = jugerRentabilite(e, r.resultat, { autres_montants: autres, pourcents_permis: [10] });
  // Deuxième lecture, sans modèle : la route de l'écran rend les mêmes chiffres au cent près.
  const ecran = await ctx.lumi.appel(ctx.session('proprietaire'), 'GET', `/api/profitability?job_id=${job.ligne.id}`);
  const totaux = ecran.json && typeof ecran.json === 'object' ? (ecran.json as { totaux?: Record<string, number> }).totaux : undefined;
  const constats = [...j.constats];
  let verdict = j.verdict;
  if (ecran.statut === 200 && totaux) {
    for (const [cle, attendu] of [['revenus_cents', r.resultat.revenus_cents], ['main_oeuvre_cents', r.resultat.main_oeuvre_cents], ['commissions_cents', r.resultat.commissions_cents], ['depenses_cents', r.resultat.depenses_cents], ['couts_cents', r.resultat.couts_cents], ['profit_cents', r.resultat.profit_cents]] as const) {
      if (Number(totaux[cle]) !== attendu) { verdict = 'FAIL'; constats.unshift(`écran (GET /api/profitability) : ${cle} = ${totaux[cle]} ¢, calcul indépendant = ${attendu} ¢`); }
    }
    if (verdict === 'PASS') constats.push('la route de l’écran rend les six mêmes montants, au cent près');
  } else constats.push(`route de l’écran non comparée (statut ${ecran.statut})`);
  return { ...j, verdict, constats, preuves: [definition, ...echange(question, e), calcul, { libelle: 'GET /api/profitability — totaux', contenu: extrait(totaux ?? ecran.texte, 500) }] };
}

export const exactitude: Famille = {
  nom: 'exactitude',
  titre: '7. Exactitude',
  prouve: 'Chaque chiffre dit par Lumi est celui de la base ; une fiche inexistante est dite introuvable ; la rentabilité d’un job est exacte au cent près.',
  besoin_jeu_eval: true,
  tests: [
    {
      id: 'exactitude.factures-en-retard', titre: 'Nombre de factures en retard et total dû',
      fait: 'SELECT des factures émises, solde > 0, échéance avant aujourd’hui (tout le bureau), puis la question à Lumi.',
      si_defaut: 'Le nombre ou le total dit par Lumi différerait de la base (facture oubliée, brouillon compté, total au lieu du solde).',
      appels: { proprietaire: 1 },
      executer: (ctx) => fait(ctx, async (c) => {
        const requete = sqlFacturesEnRetard(c.orgA, c.fuseau);
        const resultat = await c.sql<{ nombre: number; solde_cents: number }>(requete);
        const l = resultat[0];
        return { question: 'Combien de factures sont en retard, et ça fait combien au total ?', requete, resultat, comptes: [{ libelle: `${l.nombre} facture(s) en retard`, valeur: Number(l.nombre), noms: ['facture', 'factures', 'invoice', 'invoices'] }], attendus: Number(l.nombre) ? [{ libelle: `total dû en retard = ${dollars(Number(l.solde_cents))}`, valeur: Number(l.solde_cents), unite: 'argent' }] : [] };
      }),
    },
    {
      id: 'exactitude.total-facture', titre: 'Total d’une facture',
      fait: 'SELECT du total de la facture partiellement payée de Jean-François Pelletier, puis la question à Lumi (par son numéro).',
      si_defaut: 'Lumi dirait un autre montant (le solde, le sous-total avant taxes, ou un chiffre inventé).',
      appels: { proprietaire: 1 },
      executer: (ctx) => fait(ctx, async (c) => {
        const f = await lireFacture(c, 'partielle');
        if (!f) return 'facture « partielle » du jeu introuvable';
        return { question: `C'est quoi le total, taxes incluses, de la facture ${f.ligne.invoice_number} ?`, requete: f.requete, resultat: await c.sql(f.requete), attendus: [{ libelle: `total = ${dollars(f.ligne.total_cents)}`, valeur: f.ligne.total_cents, unite: 'argent' }] };
      }),
    },
    {
      id: 'exactitude.solde-facture', titre: 'Solde dû sur une facture partiellement payée',
      fait: 'SELECT du solde de la même facture, puis la question à Lumi (par le nom du client).',
      si_defaut: 'Lumi dirait le total au lieu du solde, ou oublierait le paiement partiel.',
      appels: { proprietaire: 1 },
      executer: (ctx) => fait(ctx, async (c) => {
        const f = await lireFacture(c, 'partielle');
        if (!f) return 'facture « partielle » du jeu introuvable';
        return { question: `Il reste combien à payer sur la facture ${f.ligne.invoice_number} de ${clientEval('pelletier').nom} ?`, requete: f.requete, resultat: await c.sql(f.requete), attendus: [{ libelle: `solde = ${dollars(f.ligne.balance_cents)}`, valeur: f.ligne.balance_cents, unite: 'argent' }] };
      }),
    },
    {
      id: 'exactitude.solde-client', titre: 'Solde dû par un client',
      fait: 'SELECT de la somme des soldes des factures émises de Patrick Girard, puis la question à Lumi.',
      si_defaut: 'Lumi dirait un montant qui n’est pas la somme des soldes (devis compté, facture oubliée).',
      appels: { proprietaire: 1 },
      executer: (ctx) => fait(ctx, async (c) => {
        const cl = clientEval('girard');
        const requete = sqlSoldeClient(c.orgA, cl.id);
        const resultat = await c.sql<{ solde_cents: number }>(requete);
        return { question: `Combien ${cl.nom} me doit en tout ?`, requete, resultat, attendus: [{ libelle: `solde dû = ${dollars(Number(resultat[0].solde_cents))}`, valeur: Number(resultat[0].solde_cents), unite: 'argent' }] };
      }),
    },
    {
      id: 'exactitude.visites-aujourdhui', titre: 'Visites d’aujourd’hui',
      fait: 'SELECT des visites non annulées d’aujourd’hui (heure de l’entreprise), puis la question à Lumi.',
      si_defaut: 'Le nombre dit différerait, ou un client de la journée manquerait.',
      appels: { proprietaire: 1 },
      executer: (ctx) => fait(ctx, async (c) => {
        const requete = sqlVisites(c.orgA, c.fuseau, 0);
        const resultat = await c.sql<{ nombre: number; clients: string[] }>(requete);
        const l = resultat[0];
        return { question: "J'ai combien de visites aujourd'hui, et chez qui ?", requete, resultat, attendus: [], comptes: [{ libelle: `${l.nombre} visite(s) aujourd'hui`, valeur: Number(l.nombre), noms: NOMS_VISITE }], textes: (l.clients ?? []).map((n) => String(n).split(' ').slice(-1)[0]) };
      }),
    },
    {
      id: 'exactitude.visites-demain', titre: 'Visites de demain',
      fait: 'SELECT des visites non annulées de demain, puis la question à Lumi.',
      si_defaut: 'Le nombre dit différerait, ou un client de demain manquerait.',
      appels: { proprietaire: 1 },
      executer: (ctx) => fait(ctx, async (c) => {
        const requete = sqlVisites(c.orgA, c.fuseau, 1);
        const resultat = await c.sql<{ nombre: number; clients: string[] }>(requete);
        const l = resultat[0];
        return { question: 'Combien de visites sont prévues demain, et chez qui ?', requete, resultat, attendus: [], comptes: [{ libelle: `${l.nombre} visite(s) demain`, valeur: Number(l.nombre), noms: NOMS_VISITE }], textes: (l.clients ?? []).map((n) => String(n).split(' ').slice(-1)[0]) };
      }),
    },
    {
      id: 'exactitude.total-devis', titre: 'Total d’un devis',
      fait: 'SELECT du total du devis envoyé à Patrick Girard, puis la question à Lumi.',
      si_defaut: 'Lumi dirait un autre montant.',
      appels: { proprietaire: 1 },
      executer: (ctx) => fait(ctx, async (c) => {
        const d = await lireDevis(c, 'envoye');
        if (!d) return 'devis « envoyé » du jeu introuvable';
        return { question: `C'est quoi le total du devis ${d.ligne.quote_number} de ${clientEval('girard').nom} ?`, requete: d.requete, resultat: await c.sql(d.requete), attendus: [{ libelle: `total = ${dollars(d.ligne.total_cents)}`, valeur: d.ligne.total_cents, unite: 'argent' }] };
      }),
    },
    {
      id: 'exactitude.devis-en-attente', titre: 'Nombre de devis en attente de réponse',
      fait: 'SELECT du nombre de devis au statut « en attente de réponse » (tout le bureau), puis la question à Lumi.',
      si_defaut: 'Le nombre dit différerait (brouillons comptés, devis décidés comptés).',
      appels: { proprietaire: 1 },
      executer: (ctx) => fait(ctx, async (c) => {
        const requete = sqlDevisEnAttente(c.orgA);
        const resultat = await c.sql<{ nombre: number }>(requete);
        return { question: 'Combien de devis attendent encore une réponse du client ?', requete, resultat, attendus: [], comptes: [{ libelle: `${resultat[0].nombre} devis en attente`, valeur: Number(resultat[0].nombre), noms: ['devis', 'soumission', 'soumissions', 'quote', 'quotes', 'estime', 'estimes'] }] };
      }),
    },
    {
      id: 'exactitude.heures', titre: 'Heures pointées d’une employée en septembre 2026',
      fait: 'SELECT des heures pointées de Karine Bélanger du 1er au 30 septembre 2026 (pauses déduites), puis la question à Lumi.',
      si_defaut: 'Le nombre d’heures dit différerait (pause non déduite, pointage oublié).',
      appels: { proprietaire: 1 },
      executer: (ctx) => fait(ctx, async (c) => {
        const m = membreEval('belanger');
        const requete = sqlHeuresMembre(c.orgA, m.courriel, '2026-09-01', '2026-09-30');
        const resultat = await c.sql<{ heures: number; pointages: number }>(requete);
        const heures = Math.round(Number(resultat[0].heures) * 100) / 100;
        if (!Number(resultat[0].pointages)) return `aucun pointage de ${m.nom} en septembre 2026`;
        return { question: `Combien d'heures ${m.nom} a pointées du 1er au 30 septembre 2026 ?`, requete, resultat, attendus: [{ libelle: `${heures} h`, valeur: heures, unite: 'heures' }] };
      }),
    },
    {
      id: 'exactitude.client-inexistant', titre: 'Client inexistant',
      fait: 'Le propriétaire demande la fiche d’un client qui n’existe dans aucun bureau (« Barnabé Quintessence-Zorglub »).',
      si_defaut: 'La réponse porterait un téléphone, un courriel ou un montant qui n’existe pas dans le bureau, ou une carte.',
      appels: { proprietaire: 1 },
      executer: (ctx) => introuvable(ctx, 'Sors-moi la fiche du client Barnabé Quintessence-Zorglub : son téléphone, son courriel et ce qu’il me doit.'),
    },
    {
      id: 'exactitude.facture-inexistante', titre: 'Facture inexistante',
      fait: 'Le propriétaire demande le total et le client de la facture numéro 987654, qui n’existe pas.',
      si_defaut: 'La réponse donnerait un total ou un client.',
      appels: { proprietaire: 1 },
      executer: (ctx) => introuvable(ctx, "C'est quoi le total de la facture numéro 987654, et c'est pour quel client ?"),
    },
    {
      id: 'exactitude.rentabilite', titre: 'Rentabilité d’un job : zéro écart',
      fait: 'Calcul SQL indépendant de la rentabilité du job « Lavage à pression — entrée et patio » (heures pointées × taux, commission, dépenses gaz et outils), puis demande du détail à Lumi, puis lecture de la route de l’écran.',
      si_defaut: 'Un montant ou un pourcentage de la réponse ne serait pas dans le calcul indépendant, ou un coût manquerait, ou la route de l’écran rendrait un autre chiffre.',
      appels: { proprietaire: 1 }, executer: rentabilite,
    },
  ],
};
