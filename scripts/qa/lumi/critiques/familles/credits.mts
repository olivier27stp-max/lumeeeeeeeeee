/**
 * Famille 8 — Crédits et montants.
 * Pour un tour qui appelle le modèle : le coût de la trace, les lignes du
 * grand livre (`ai_usage`) et la baisse des crédits affichés racontent la même
 * histoire (1 crédit = 3 ¢), et le solde affiché est celui que la base calcule.
 * Aucune réponse de l'API de Lumi ne porte un montant en dollars ou un champ en
 * cents : le client ne voit que des crédits.
 *
 * Le blocage à zéro crédit et la course entre deux sessions ne se testent PAS
 * en production (il faudrait changer le forfait partagé ou polluer le grand
 * livre, qui est en ajout seul) : NON COUVERT ici, couverts sans réseau.
 */
import { sqlCreditsDuBureau, sqlTraces, sqlUsage, sqlUsageFenetre } from '../faits.mts';
import { champsArgent, extrait, jugerCredits, type Echange, type EtatQuota, type LigneUsage } from '../jugement.mts';
import type { Contexte, Famille, Issue, Preuve } from '../types.mts';

interface EtatBase { periode_debut: string; bureaux: number; micro: number; derniere_ligne: string | null; credits_du_forfait: number }
interface Releve { base: EtatBase; quota: EtatQuota; brut: unknown }

/** Le tour de modèle de la famille, gardé pour le test « aucun montant ». */
let tour: Echange | null = null;

/** Des lectures que ni les raccourcis ni les actions directes ne servent : elles vont au modèle. */
export const QUESTIONS_DE_CONTROLE = [
  'Lequel de mes clients a le plus de jobs planifiées dans les sept prochains jours ?',
  'Dans quelle ville j’ai le plus de clients actifs ?',
  'Quel jour de la semaine prochaine est le plus chargé en visites ?',
  'Quel est le titre de ma job créée le plus récemment, et pour quel client ?',
  'Parmi mes devis refusés, lequel avait le plus gros total ?',
];

const quotaDe = (json: unknown): EtatQuota | null => {
  const c = json && typeof json === 'object' ? (json as { credits?: Record<string, unknown> }).credits : undefined;
  return c && typeof c.total === 'number' && typeof c.utilises === 'number' && typeof c.restants === 'number' ? { total: c.total, utilises: c.utilises, restants: c.restants } : null;
};

/** Début de la période de crédits du bureau : la fonction du produit, lue avec la clé de service (aucune écriture). */
let debutDePeriode: string | null = null;
async function periodeDebut(ctx: Contexte): Promise<string> {
  if (debutDePeriode) return debutDePeriode;
  const { data, error } = await ctx.admin.rpc('lumi_periode_debut', { p_org: ctx.orgA });
  if (error || !data) throw new Error(`lumi_periode_debut : ${error?.message ?? 'aucune valeur'}`);
  debutDePeriode = new Date(String(data)).toISOString();
  return debutDePeriode;
}

/** Base, puis API, puis base : si la base n'a pas bougé entre les deux lectures, le relevé est cohérent. */
async function releve(ctx: Contexte): Promise<Releve | null> {
  const lire = async (): Promise<EtatBase> => {
    const [l] = await ctx.sql<Record<string, unknown>>(sqlCreditsDuBureau(ctx.orgA, await periodeDebut(ctx)));
    return { periode_debut: String(l.periode_debut), bureaux: Number(l.bureaux), micro: Number(l.micro), derniere_ligne: l.derniere_ligne ? String(l.derniere_ligne) : null, credits_du_forfait: Number(l.credits_du_forfait ?? 0) };
  };
  for (let essai = 0; essai < 3; essai++) {
    const avant = await lire();
    const r = await ctx.lumi.appel(ctx.session('proprietaire'), 'GET', '/api/lumi/quota');
    const apres = await lire();
    const quota = quotaDe(r.json);
    if (r.statut === 200 && quota && avant.micro === apres.micro && avant.derniere_ligne === apres.derniere_ligne) return { base: apres, quota, brut: r.json };
    await ctx.attendre(3000);
  }
  return null;
}

async function coherence(ctx: Contexte): Promise<Issue> {
  const preuves: Preuve[] = [{ libelle: 'définition des crédits du bureau (SELECT)', contenu: extrait(sqlCreditsDuBureau(ctx.orgA, await periodeDebut(ctx)), 900) }];
  const avant = await releve(ctx);
  if (!avant) return { verdict: 'NON COUVERT', constats: ['relevé de départ impossible : la consommation du bureau bouge pendant la lecture (autre session ?) ou /api/lumi/quota ne répond pas'], preuves };
  // Une question différente d'un lancement à l'autre : la même, rejouée dans les dix minutes, sort du cache sémantique (étage 4) sans appeler le modèle.
  const question = `${QUESTIONS_DE_CONTROLE[[...ctx.nonce].reduce((n, c) => n + c.charCodeAt(0), 0) % QUESTIONS_DE_CONTROLE.length]} Réponds en une phrase. (question de contrôle ${ctx.nonce})`;
  const e = await ctx.lumi.demander(ctx.session('proprietaire'), question);
  tour = e;
  preuves.push({ libelle: 'demande', contenu: question }, { libelle: `réponse (statut ${e.statut}, étage ${e.etage ?? '—'})`, contenu: extrait(e.statut === 200 ? e.texte : e.corps, 300) });
  if (e.statut !== 200 || !e.conversation_id) return { verdict: 'NON COUVERT', constats: [`pas de réponse de Lumi (statut ${e.statut})`], preuves };
  if (e.etage !== 6) return { verdict: 'NON COUVERT', constats: [`le tour a été servi à l’étage ${e.etage} (sans le modèle principal) : rien à réconcilier`], preuves };
  // La trace part sans attendre la réponse : on lui laisse le temps d'arriver.
  let traces: Array<Record<string, unknown>> = [];
  for (let i = 0; i < 4 && !traces.some((t) => Number(t.etage) === 6); i++) { await ctx.attendre(2500); traces = await ctx.sql(sqlTraces(ctx.orgA, e.conversation_id)); }
  const usage = await ctx.sql<Record<string, unknown>>(sqlUsage(ctx.orgA, e.conversation_id));
  const apres = await releve(ctx);
  if (!apres) return { verdict: 'NON COUVERT', constats: ['relevé de fin impossible : la consommation du bureau bouge pendant la lecture'], preuves };
  const trace = traces.find((t) => Number(t.etage) === 6);
  const routeur = trace && typeof trace.params === 'object' && trace.params ? (trace.params as { routeur?: { usage?: { input_tokens?: number; output_tokens?: number } | null } }).routeur?.usage : null;
  // La ligne du routeur se reconnaît à ses tokens (ceux que la trace rapporte pour lui), pas à son modèle :
  // en palier économe ou restreint, l'agent tourne lui aussi sur Haiku. Une seule ligne, la première qui correspond.
  const iRouteur = routeur ? usage.findIndex((u) => Number(u.input_tokens) === Number(routeur.input_tokens) && Number(u.output_tokens) === Number(routeur.output_tokens)) : -1;
  const lignes: LigneUsage[] = usage.map((u, i) => ({ cost_cents: Number(u.cost_cents), credits_micro: u.credits_micro == null ? null : Number(u.credits_micro), routeur: i === iRouteur }));
  const [fenetre] = avant.base.derniere_ligne && apres.base.derniere_ligne
    ? await ctx.sql<{ micro: number; lignes: number }>(sqlUsageFenetre(ctx.orgA, avant.base.derniere_ligne, apres.base.derniere_ligne))
    : [{ micro: lignes.reduce((s, l) => s + (l.credits_micro ?? 0), 0), lignes: lignes.length }];
  preuves.push(
    { libelle: 'trace du tour (lumi_traces, étage 6)', contenu: extrait(trace ? { cost_cents: trace.cost_cents, model: trace.model, resultat: trace.resultat, routeur } : 'absente', 400) },
    { libelle: 'grand livre de la conversation (ai_usage)', contenu: extrait(usage.map((u, i) => ({ model: u.model, input_tokens: u.input_tokens, output_tokens: u.output_tokens, cost_cents: u.cost_cents, credits_micro: u.credits_micro, routeur: lignes[i].routeur })), 900) },
    { libelle: 'crédits du bureau en base, avant → après', contenu: `${avant.base.micro} → ${apres.base.micro} micro-crédits ; fenêtre : ${fenetre.lignes} ligne(s), ${fenetre.micro} micro-crédits ; période depuis ${apres.base.periode_debut} ; ${apres.base.bureaux} bureau(x) dans le groupe ; forfait : ${apres.base.credits_du_forfait} crédits` },
    { libelle: 'GET /api/lumi/quota, avant → après', contenu: `${JSON.stringify(avant.quota)} → ${JSON.stringify(apres.quota)}` },
    { libelle: 'crédits dans l’événement de fin du tour', contenu: extrait(e.fin?.credits, 300) },
  );
  const j = jugerCredits({
    cout_trace_cents: trace && trace.cost_cents != null ? Number(trace.cost_cents) : null, lignes,
    micro_avant: avant.base.micro, micro_apres: apres.base.micro, micro_fenetre: Number(fenetre.micro),
    quota_avant: avant.quota, quota_apres: apres.quota, credits_du_forfait: apres.base.credits_du_forfait,
  });
  const observations = Number(fenetre.lignes) > lignes.length ? [`${Number(fenetre.lignes) - lignes.length} ligne(s) d’une autre conversation dans la fenêtre : la somme de la fenêtre les inclut, la comparaison reste exacte.`] : undefined;
  return { ...j, preuves, observations };
}

async function aucunMontant(ctx: Contexte): Promise<Issue> {
  const constats: string[] = [];
  const preuves: Preuve[] = [];
  let lues = 0;
  for (const compte of ['proprietaire', 'technicien'] as const) {
    for (const chemin of ['/api/lumi/quota', '/api/lumi/credits', '/api/lumi/credits/historique?jours=30']) {
      const r = await ctx.lumi.appel(ctx.session(compte), 'GET', chemin);
      preuves.push({ libelle: `${compte} — GET ${chemin}`, contenu: `statut ${r.statut} — ${extrait(r.texte, 260)}` });
      if (r.statut !== 200) continue;
      lues += 1;
      for (const c of champsArgent(r.json)) constats.push(`${compte} — GET ${chemin} : ${c}`);
    }
  }
  if (tour && tour.statut === 200) {
    // Chaque événement du tour ; la carte d'action d'un tour porte des montants MÉTIER (une facture), pas un coût d'IA : elle est écartée.
    for (const ev of tour.evenements.filter((x) => x.type !== 'proposal' && x.type !== 'text' && x.type !== 'fiches')) {
      const { proposal: _carte, ...reste } = ev.data;
      for (const c of champsArgent(reste)) constats.push(`événement « ${ev.type} » du tour : ${c}`);
    }
    preuves.push({ libelle: 'événements du tour relus', contenu: [...new Set(tour.evenements.map((x) => x.type))].join(', ') });
    preuves.push({ libelle: 'événement de fin', contenu: extrait(tour.fin, 400) });
  }
  if (constats.length) return { verdict: 'FAIL', constats, preuves };
  if (!lues) return { verdict: 'NON COUVERT', constats: ['aucune des routes n’a répondu 200'], preuves };
  const observations = tour && tour.statut === 200 ? undefined : ['Les événements d’un tour de modèle n’ont pas été relus (lancer « credits.coherence » dans la même passe).'];
  return { verdict: 'PASS', constats: [`${lues} réponse(s) d’API relues : aucune clé en cents, en dollars ou de coût, aucune valeur avec « $ »`, ...(tour && tour.statut === 200 ? ['événements du tour (usage, fin) : aucun montant'] : [])], preuves, observations };
}

const COUVERT_SANS_RESEAU = ['tests/lumi-budget-reservation.test.ts', 'scripts/qa/eprouver-credits-lumi.mts (staging)', 'tests/lumi-credits-serveur.test.ts'];

export const credits: Famille = {
  nom: 'credits',
  titre: '8. Crédits et montants',
  prouve: 'Trace, grand livre et crédits affichés sont cohérents (1 crédit = 3 ¢) ; aucun montant d’IA ne sort vers le client.',
  tests: [
    {
      id: 'credits.coherence', titre: 'Un tour de modèle : trace = grand livre = baisse des crédits',
      fait: 'Relevé des crédits (base puis GET /api/lumi/quota), une question qui appelle le modèle, puis : coût de la trace, lignes ai_usage de la conversation, crédits du bureau recalculés en base, GET /api/lumi/quota.',
      si_defaut: 'Le coût de la trace différerait du grand livre, une ligne n’aurait pas ses micro-crédits au taux de 3 ¢, ou le solde affiché ne serait pas celui de la base.',
      appels: { proprietaire: 1 }, executer: coherence,
    },
    {
      id: 'credits.aucun-montant', titre: 'Aucun montant en dollars ni champ en cents dans les réponses de Lumi',
      fait: 'Lecture de /api/lumi/quota, /api/lumi/credits et /api/lumi/credits/historique (propriétaire et technicien) et de tous les événements du tour précédent ; chaque clé et chaque valeur est examinée.',
      si_defaut: 'Une clé comme cost_cents, budget_cents, plafonds_jour, ou une valeur avec « $ », apparaîtrait.',
      appels: {}, executer: aucunMontant,
    },
    {
      id: 'credits.blocage-a-zero', titre: 'Blocage à zéro crédit',
      fait: 'Non exécuté en production.', si_defaut: 'Un appel au modèle partirait alors que le bureau n’a plus de crédits.',
      appels: {},
      non_couvert: { raison: 'Épuiser les crédits du bureau de test demande soit de changer le forfait (partagé avec de vrais clients), soit d’écrire de fausses lignes dans le grand livre, qui est en ajout seul : ni l’un ni l’autre en production.', couvert_par: COUVERT_SANS_RESEAU },
    },
    {
      id: 'credits.course-deux-sessions', titre: 'Course entre deux sessions au dernier crédit',
      fait: 'Non exécuté en production.', si_defaut: 'Deux sessions simultanées dépasseraient ensemble le plafond.',
      appels: {},
      non_couvert: { raison: 'Il faudrait amener le bureau au bord du plafond (même contrainte que le blocage à zéro) puis lancer deux tours payants en même temps.', couvert_par: COUVERT_SANS_RESEAU },
    },
  ],
};
