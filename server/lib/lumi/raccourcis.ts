/**
 * Raccourcis déterministes — Lumi répond SANS le modèle.
 * ─────────────────────────────────────────────────────
 * Les cinq questions les plus posées (« combien de clients », « qu'est-ce
 * que j'ai demain », « combien j'ai encaissé ce mois-ci », « qui me doit de
 * l'argent », « mon briefing ») ont une réponse qui ne demande aucune
 * intelligence : un outil, un gabarit. Salesforce fait pareil (ses bots
 * déterministes répondent tant que c'est possible, le modèle n'arrive
 * qu'après). Ici ça vaut doublement : à faible trafic, chaque question
 * réveille la cache d'une heure (7 300 tokens réécrits à prix double) —
 * un raccourci coûte 0 ¢ et répond en 200 ms.
 *
 * Détection VOLONTAIREMENT stricte : le message entier doit être court et
 * composé uniquement de mots connus (mots vides + mots-clés du raccourci).
 * Un nom propre, une ville, une précision (« à Saint-Bruno », « le mois
 * dernier ») font tomber la détection et le modèle reprend la main. Mieux
 * vaut rater un raccourci que répondre à côté.
 *
 * La réponse est stockée comme un message assistant ordinaire : le modèle
 * la relit ensuite comme s'il l'avait écrite, et la conversation continue.
 * Les gardes de rôle (page Rôles, montants masqués) passent par
 * executerOutilGarde exactement comme pour le modèle : un refus = pas de
 * raccourci, le modèle explique.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { executerOutilGarde } from '../agent/garde';
import { composerBriefing, type DonneesBriefing } from './briefing';
import { fichesDuResultat, type Fiche } from './fiches';

export type IdRaccourci = 'clients-total' | 'agenda' | 'revenu-mois' | 'retards' | 'briefing';
export interface Raccourci { id: IdRaccourci; tool: string; args: Record<string, any>; periode?: 'aujourdhui' | 'demain' | 'semaine' }
export interface ReponseRaccourci { texte: string; fiches: Fiche[] }

export interface ContexteRaccourci {
  client: SupabaseClient;
  orgId: string;
  userId: string;
  accessToken?: string;
  language: 'fr' | 'en';
  fuseau: string;
  prenom: string | null;
  maintenant?: Date;
}

const MAX_MOTS = 12;

/** Minuscules, sans accents, sans ponctuation : « Qu'est-ce que j'ai demain ? » → « qu est ce que j ai demain ». */
export function normaliser(s: string): string[] {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
}

/** Mots qui ne portent aucun sens pour la détection (fr + en + oral québécois). */
const MOTS_VIDES = new Set(('je j ai jai on a as nous avons vous mes mon ma le la les l de d du des un une en au aux ce cet cette ci y il elle est c s ' +
  'stp svp pls please tu peux me dire donne donnes moi montre montres voir vois quoi que qu quest kes kess ke qui est ce et pis pi ' +
  'combien cb cmb nombre nb tout tous total en tout total ok ouais bah fak faque la ya yatu tu y as ' +
  'hui hey lumi salut bonjour allo yo hi hello ' +
  'the my i do have has what whats s is are how many much show list tell there any of for in this all so far got we our me ' +
  'ai avons a on').split(/\s+/));

interface Definition {
  id: IdRaccourci;
  /** Chaque groupe doit fournir au moins un mot du message. */
  groupes: string[][];
  /** Mots acceptés en plus des mots vides et des groupes. */
  extras?: string[];
  /** Un seul de ces mots présent → pas de raccourci (précision que le gabarit ne sait pas rendre). */
  interdits?: string[];
}

const DATES_AUJ = ['aujourd', 'aujourdhui', 'ajd', 'auj', 'today'];
const DATES_DEMAIN = ['demain', 'dmain', 'tomorrow', 'tmrw'];
const DATES_SEMAINE = ['semaine', 'week'];

const DEFINITIONS: Definition[] = [
  {
    id: 'clients-total',
    groupes: [['combien', 'cb', 'cmb', 'nombre', 'nb', 'many', 'count'], ['client', 'clients', 'customer', 'customers']],
    extras: ['actifs', 'actif', 'active', 'dans', 'base', 'crm', 'lume', 'compte', 'comptes', 'exactement', 'exact'],
    interdits: ['lead', 'leads', 'prospect', 'prospects', 'nouveau', 'nouveaux', 'new', 'mois', 'month', 'semaine', 'week', 'annee', 'year'],
  },
  {
    id: 'agenda',
    groupes: [[...DATES_AUJ, ...DATES_DEMAIN, ...DATES_SEMAINE]],
    extras: ['job', 'jobs', 'agenda', 'horaire', 'programme', 'planifie', 'planifies', 'prevu', 'prevus', 'rdv', 'rendez', 'visite', 'visites',
      'schedule', 'scheduled', 'appointment', 'appointments', 'visit', 'visits', 'calendar', 'calendrier', 'cette', 'ou', 'where', 'c', 'quand', 'when', 'prevoir', 'faire', 'up', 'on', 'going'],
    interdits: ['hier', 'yesterday', 'prochaine', 'next', 'derniere', 'last', 'facture', 'factures', 'invoice', 'invoices', 'tache', 'taches', 'task', 'tasks', 'libre', 'free', 'dispo', 'disponible', 'trou', 'slot'],
  },
  {
    id: 'revenu-mois',
    groupes: [
      ['encaisse', 'encaisses', 'revenu', 'revenus', 'chiffre', 'ca', 'ventes', 'vente', 'revenue', 'collected', 'sales', 'facture', 'factures', 'invoiced', 'billed', 'rentre', 'rentrer', 'gagne', 'made', 'fait'],
      ['mois', 'month'],
    ],
    extras: ['depuis', 'debut', 'since', 'start', 'beginning', 'affaires', 'affaire', 'd', 'argent', 'money', 'objectif', 'goal', 'cash', 'jusqu', 'date', 'present', 'maintenant', 'now'],
    interdits: ['dernier', 'derniere', 'passe', 'precedent', 'last', 'previous', 'retard', 'retards', 'impaye', 'impayes', 'impayee', 'impayees', 'overdue', 'unpaid', 'annee', 'year', 'semaine', 'week', 'prochain', 'next', 'chaque', 'each', 'par', 'per', 'moyenne', 'average'],
  },
  {
    id: 'retards',
    groupes: [
      ['retard', 'retards', 'impaye', 'impayes', 'impayee', 'impayees', 'overdue', 'souffrance', 'late', 'unpaid', 'doit', 'doivent', 'owe', 'owes', 'due', 'dus', 'attente', 'pending'],
      ['facture', 'factures', 'paiement', 'paiements', 'invoice', 'invoices', 'payment', 'payments', 'argent', 'money', 'client', 'clients', 'compte', 'comptes', 'doit', 'doivent', 'owe', 'owes', 'cash'],
    ],
    extras: ['en', 'moment', 'ce', 'right', 'now', 'still', 'encore', 'toujours', 'who', 'pas', 'paye', 'payees', 'payes', 'paid', 'recevoir', 'receivable', 'receivables', 'a', 'de'],
    interdits: ['job', 'jobs', 'tache', 'taches', 'task', 'tasks', 'devis', 'quote', 'quotes', 'soumission', 'soumissions', 'relance', 'relancer', 'remind', 'reminder', 'envoie', 'envoyer', 'send', 'texte', 'texto', 'sms', 'email', 'courriel'],
  },
  {
    id: 'briefing',
    groupes: [['briefing', 'brief', 'survol', 'resume', 'journee', 'matin', 'neuf', 'point', 'situation', 'update', 'morning', 'overview', 'summary', 'recap']],
    extras: ['jour', 'day', 'ma', 'mon', 'quoi', 'de', 'nouveau', 'new', 'fais', 'fait', 'faire', 'un', 'le', 'du', 'today', 'aujourd', 'aujourdhui', 'ajd', 'what', 'up', 'whats'],
    interdits: ['hier', 'yesterday', 'demain', 'tomorrow', 'semaine', 'week', 'mois', 'month', 'client', 'clients', 'facture', 'factures', 'job', 'jobs'],
  },
];

/** Le message, entier, correspond-il à un raccourci ? Sinon null et le modèle répond. */
export function detecterRaccourci(message: string): Raccourci | null {
  const mots = normaliser(message);
  if (mots.length === 0 || mots.length > MAX_MOTS) return null;
  for (const def of DEFINITIONS) {
    if (def.interdits?.some((m) => mots.includes(m))) continue;
    if (!def.groupes.every((g) => g.some((m) => mots.includes(m)))) continue;
    const permis = new Set([...MOTS_VIDES, ...def.groupes.flat(), ...(def.extras ?? [])]);
    if (!mots.every((m) => permis.has(m))) continue;
    switch (def.id) {
      case 'clients-total': return { id: def.id, tool: 'search_clients', args: { limit: 1 } };
      case 'agenda': {
        const periode = mots.some((m) => DATES_DEMAIN.includes(m)) ? 'demain' : mots.some((m) => DATES_SEMAINE.includes(m)) ? 'semaine' : 'aujourdhui';
        return { id: def.id, tool: 'query_schedule', args: {}, periode };
      }
      case 'revenu-mois': return { id: def.id, tool: 'get_revenue_summary', args: { period: 'this_month' } };
      case 'retards': return { id: def.id, tool: 'get_overdue_payments', args: { limit: 50 } };
      case 'briefing': return { id: def.id, tool: 'get_morning_briefing', args: {} };
      default: return null;
    }
  }
  return null;
}

// ── Dates dans le fuseau de l'entreprise ────────────────────────

/** « 2026-09-12 » dans le fuseau donné, décalé de n jours. */
export function jourLocal(fuseau: string, maintenant: Date, decalageJours = 0): string {
  const d = new Date(maintenant.getTime() + decalageJours * 86_400_000);
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: fuseau, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return `${v('year')}-${v('month')}-${v('day')}`;
}

/** Minuit local d'un jour « YYYY-MM-DD » dans le fuseau, en ISO UTC. */
export function minuitLocal(jour: string, fuseau: string): string {
  const [y, m, d] = jour.split('-').map(Number);
  // Première estimation à minuit UTC, puis correction par le décalage réel du fuseau ce jour-là.
  const estime = Date.UTC(y, m - 1, d, 0, 0, 0);
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: fuseau, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(estime));
  const v = (t: string) => Number(p.find((x) => x.type === t)?.value ?? 0);
  const localCommeUtc = Date.UTC(v('year'), v('month') - 1, v('day'), v('hour'), v('minute'));
  const decalage = localCommeUtc - estime; // ex. Montréal : -4 h
  return new Date(estime - decalage).toISOString();
}

/** Bornes [début, fin] d'une période, en ISO UTC, calées sur le fuseau de l'org. */
export function bornesPeriode(periode: NonNullable<Raccourci['periode']>, fuseau: string, maintenant: Date): { start_date: string; end_date: string; jours: string[] } {
  const debut = periode === 'demain' ? jourLocal(fuseau, maintenant, 1) : jourLocal(fuseau, maintenant, 0);
  const nbJours = periode === 'semaine' ? 7 : 1;
  const jours = Array.from({ length: nbJours }, (_, i) => jourLocal(fuseau, new Date(minuitLocal(debut, fuseau)), i));
  const finExclusive = jourLocal(fuseau, new Date(minuitLocal(debut, fuseau)), nbJours);
  // query_schedule filtre par start_at ≤ end_date : une milliseconde avant le minuit suivant.
  const end = new Date(new Date(minuitLocal(finExclusive, fuseau)).getTime() - 1).toISOString();
  return { start_date: minuitLocal(debut, fuseau), end_date: end, jours };
}

// ── Gabarits ─────────────────────────────────────────────────────

const fmtDollars = (cents: number, fr: boolean) => (fr
  ? `${(cents / 100).toLocaleString('fr-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`
  : `$${(cents / 100).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`).replace(/[  ]/g, ' ');

function heureLocale(iso: string, fuseau: string, fr: boolean): string {
  try {
    const h = new Intl.DateTimeFormat(fr ? 'fr-CA' : 'en-CA', { hour: 'numeric', minute: '2-digit', hour12: !fr, timeZone: fuseau }).format(new Date(iso));
    return fr ? h.replace(/ h 00$/, ' h') : h;
  } catch { return ''; }
}

function jourLisible(jour: string, fuseau: string, fr: boolean): string {
  const d = new Date(minuitLocal(jour, fuseau));
  const s = new Intl.DateTimeFormat(fr ? 'fr-CA' : 'en-CA', { weekday: 'long', day: 'numeric', month: 'long', timeZone: fuseau }).format(d);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Rend le texte à partir du résultat BRUT (non masqué) de l'outil. Pur : testable sans base. */
export function rendreRaccourci(r: Raccourci, resultat: any, opts: { fr: boolean; fuseau: string; prenom: string | null; maintenant: Date }): string {
  const { fr, fuseau } = opts;
  switch (r.id) {
    case 'clients-total': {
      const n = Number(resultat?.total_matching ?? 0);
      return fr ? `Tu as ${n} client${n > 1 ? 's' : ''}.` : `You have ${n} client${n === 1 ? '' : 's'}.`;
    }
    case 'agenda': {
      const events: any[] = Array.isArray(resultat?.events) ? resultat.events : [];
      const periode = r.periode ?? 'aujourdhui';
      const quand = fr
        ? (periode === 'demain' ? 'demain' : periode === 'semaine' ? 'cette semaine' : "aujourd'hui")
        : (periode === 'demain' ? 'tomorrow' : periode === 'semaine' ? 'this week' : 'today');
      if (events.length === 0) {
        return fr ? `Rien de prévu ${quand} : le calendrier est libre.` : `Nothing scheduled ${quand}: the calendar is free.`;
      }
      const n = events.length;
      const entete = fr ? `${n} visite${n > 1 ? 's' : ''} ${quand} :` : `${n} visit${n > 1 ? 's' : ''} ${quand}:`;
      const parJour = new Map<string, any[]>();
      for (const e of events) {
        const j = jourLocal(fuseau, new Date(e.start_at));
        if (!parJour.has(j)) parJour.set(j, []);
        parJour.get(j)!.push(e);
      }
      const lignes: string[] = [];
      for (const [jour, liste] of parJour) {
        if (periode === 'semaine') lignes.push(`\n${jourLisible(jour, fuseau, fr)}`);
        for (const e of liste.slice(0, 15)) {
          const qui = [e.client_name, e.job_title].filter(Boolean).join(' · ');
          const ou = e.address ? ` — ${e.address}` : '';
          lignes.push(`• ${heureLocale(e.start_at, fuseau, fr)} · ${qui || (fr ? 'Job' : 'Job')}${ou}`);
        }
      }
      return `${entete}\n${lignes.join('\n')}`;
    }
    case 'revenu-mois': {
      const enc = Number(resultat?.revenue_cents ?? 0);
      const fac = Number(resultat?.invoiced_cents ?? 0);
      const obj = Number(resultat?.goal_cents ?? 0);
      const pct = resultat?.goal_progress_pct;
      const objectif = obj > 0
        ? (fr ? ` Objectif du mois : ${fmtDollars(obj, fr)}${pct != null ? ` (${pct} %)` : ''}.` : ` Monthly goal: ${fmtDollars(obj, fr)}${pct != null ? ` (${pct}%)` : ''}.`)
        : '';
      return fr
        ? `Encaissé ce mois-ci : ${fmtDollars(enc, fr)}. Facturé : ${fmtDollars(fac, fr)}.${objectif}`
        : `Collected this month: ${fmtDollars(enc, fr)}. Invoiced: ${fmtDollars(fac, fr)}.${objectif}`;
    }
    case 'retards': {
      const rows: any[] = Array.isArray(resultat?.overdue) ? resultat.overdue : [];
      if (rows.length === 0) return fr ? 'Aucune facture en retard. Tout le monde est à jour.' : 'No overdue invoices. Everyone is up to date.';
      const total = Number(resultat?.sum_balance_cents ?? rows.reduce((s, x) => s + Number(x.balance_cents || 0), 0));
      const n = rows.length;
      const tri = [...rows].sort((a, b) => Number(b.days_overdue ?? 0) - Number(a.days_overdue ?? 0));
      const lignes = tri.slice(0, 8).map((x) => {
        const jours = x.days_overdue != null ? (fr ? ` · ${x.days_overdue} jour${x.days_overdue > 1 ? 's' : ''}` : ` · ${x.days_overdue} day${x.days_overdue === 1 ? '' : 's'}`) : '';
        return `• ${x.invoice_number || (fr ? 'Facture' : 'Invoice')} · ${x.client_name || '—'} · ${fmtDollars(Number(x.balance_cents || 0), fr)}${jours}`;
      });
      const reste = n - Math.min(8, n);
      const suite = reste > 0 ? (fr ? `\n… et ${reste} autre${reste > 1 ? 's' : ''}.` : `\n… and ${reste} more.`) : '';
      const entete = fr
        ? `${n} facture${n > 1 ? 's' : ''} en retard, ${fmtDollars(total, fr)} au total :`
        : `${n} overdue invoice${n > 1 ? 's' : ''}, ${fmtDollars(total, fr)} in total:`;
      const offre = fr ? '\nDis « relance-les » et je prépare les textos.' : '\nSay “chase them” and I’ll draft the texts.';
      return `${entete}\n${lignes.join('\n')}${suite}${offre}`;
    }
    case 'briefing': {
      const texte = composerBriefing(resultat as DonneesBriefing, { prenom: opts.prenom, fr, fuseau, maintenant: opts.maintenant });
      return texte ?? (fr
        ? 'Rien à signaler : pas de visite aujourd’hui, aucun retard, aucune tâche en attente, pas de nouvelle demande.'
        : 'Nothing to report: no visit today, no overdue invoice, no pending task, no new request.');
    }
    default:
      return '';
  }
}

/**
 * Exécute l'outil du raccourci (avec les gardes) et rend la réponse.
 * null = le modèle prend le relais (refus de rôle, erreur d'outil, résultat inattendu).
 */
export async function repondreRaccourci(r: Raccourci, ctx: ContexteRaccourci): Promise<ReponseRaccourci | null> {
  const maintenant = ctx.maintenant ?? new Date();
  const fr = ctx.language !== 'en';
  let args = { ...r.args };
  if (r.id === 'agenda' && r.periode) {
    const b = bornesPeriode(r.periode, ctx.fuseau, maintenant);
    args = { start_date: b.start_date, end_date: b.end_date };
  }
  try {
    const res = await executerOutilGarde({ name: r.tool, args, userId: ctx.userId, orgId: ctx.orgId, client: ctx.client, accessToken: ctx.accessToken });
    if ('refus' in res) return null;
    const resultat = res.result;
    if (!resultat || typeof resultat !== 'object' || resultat.error) return null;
    if (r.id === 'briefing' && !resultat.todays_visits) return null;
    const texte = rendreRaccourci(r, resultat, { fr, fuseau: ctx.fuseau, prenom: ctx.prenom, maintenant });
    if (!texte) return null;
    // Le compte des clients ne lie personne (une fiche pour « tu as 19 clients » n'aurait pas de sens).
    const fiches = r.id === 'clients-total' ? [] : fichesDuResultat(r.tool, args, resultat);
    return { texte, fiches };
  } catch (err: any) {
    console.error(`[lumi:raccourci:${r.id}]`, err?.message || err);
    return null;
  }
}
