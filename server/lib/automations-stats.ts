/* ═══════════════════════════════════════════════════════════════
   Statistiques, Historique et Journaux des automatisations — le calcul.

   UNE définition par métrique, et elle n'est pas ici : elle est dans la
   base (fonction `automation_evenements`, migration S-01), qui range chaque
   ligne du journal et chaque état de la file dans une catégorie. Ce fichier
   appelle la base avec le client de l'UTILISATEUR (la RLS décide de ce
   qu'il voit), puis additionne.

   LES MÉTRIQUES (sur une période de 7, 30 ou 90 jours civils, dans le
   fuseau de l'entreprise, aujourd'hui compris) :
   · déclenchées — une fiche est entrée dans l'automatisation (un événement
                   accepté, qu'il finisse envoyé, ignoré ou en échec). Le
                   même client qui repasse plus tard compte deux fois ; le
                   même événement reçu deux fois dans les 2 minutes, une.
   · envoyées    — messages réellement partis chez le client (texto,
                   courriel, demande d'avis, facture, devis).
   · actions     — autres actions réussies (tâche, étiquette, notification
                   interne…) : comptées À PART, jamais des « envois ».
   · échouées    — échecs DÉFINITIFS : une action reprise quatre fois avant
                   d'abandonner compte une fois ; un échec passager encore
                   en reprise n'est pas (encore) un échec.
   · ignorées    — rien n'est parti, et c'est voulu : catégories « ignorée »
                   et « annulée » de `automationMotifs.ts`, détaillées par
                   groupe (doublon, désabonné, hors ciblage, donnée
                   manquante, condition plus valide, limite d'envois, autre).
   · reportées   — l'envoi attend le prochain créneau (heures d'envoi,
                   rafale) : il partira, ce n'est pas un envoi ignoré.
   · en cours    — fiches qui ont encore une étape en file, MAINTENANT
                   (sans période).
   ═══════════════════════════════════════════════════════════════ */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  ACTIONS_MESSAGE_CLIENT, CATEGORIES_PAR_CODE, FILTRES_STATUT, groupeDeLIssue,
  type FiltreStatut,
} from '../../src/lib/automationIssues';
import type { GroupeMotif } from '../../src/lib/automationMotifs';

export const FUSEAU_DEFAUT = 'America/Montreal';
/** Durée de conservation des journaux (purge `run_retention_logs`) : rien n'est lisible au-delà. */
export const RETENTION_JOURS = 90;
/**
 * Les périodes acceptées par les routes. 7, 30 et 90 sont celles des écrans ; 60 reste accepté
 * pour le panneau d'étape de l'éditeur, qui écrit encore « 60 derniers jours ».
 */
export const PERIODES_ACCEPTEES = [7, 30, 60, 90] as const;

// ── Le temps : des jours civils dans le fuseau de l'entreprise ─────────────

function fuseauSur(fuseau: string | null | undefined): string {
  if (!fuseau) return FUSEAU_DEFAUT;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: fuseau });
    return fuseau;
  } catch {
    // Fuseau inconnu de ce serveur : on retombe sur celui par défaut plutôt que d'échouer.
    return FUSEAU_DEFAUT;
  }
}

/** La date civile (AAAA-MM-JJ) d'un instant dans un fuseau. */
export function jourLocal(instant: Date, fuseau: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: fuseauSur(fuseau), year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant);
}

/** L'instant (UTC) de minuit, heure locale du fuseau, pour une date civile. */
export function minuitLocal(jour: string, fuseau: string): Date {
  const tz = fuseauSur(fuseau);
  const [a, m, j] = jour.split('-').map(Number);
  const vise = Date.UTC(a, m - 1, j, 0, 0, 0);
  const lu = (t: number) => {
    const p = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(new Date(t));
    const v = (type: string) => Number(p.find((x) => x.type === type)?.value ?? 0);
    return Date.UTC(v('year'), v('month') - 1, v('day'), v('hour'), v('minute'), v('second'));
  };
  // Deux passes : la seconde corrige un changement d'heure entre l'estimation et la cible.
  let t = vise - (lu(vise) - vise);
  t = vise - (lu(t) - t);
  return new Date(t);
}

function ajouterJours(jour: string, n: number): string {
  const [a, m, j] = jour.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, j + n)).toISOString().slice(0, 10);
}

export interface Periode {
  jours: number;
  fuseau: string;
  /** Début de la période : minuit (fuseau de l'entreprise) du premier jour. ISO, UTC. */
  depuis: string;
  /** Premier et dernier jour civil de la période (AAAA-MM-JJ). */
  premier_jour: string;
  dernier_jour: string;
}

/** Les N derniers jours civils, aujourd'hui compris, dans le fuseau de l'entreprise. */
export function periode(jours: number, fuseau: string, maintenant: Date = new Date()): Periode {
  const tz = fuseauSur(fuseau);
  const dernier = jourLocal(maintenant, tz);
  const premier = ajouterJours(dernier, -(jours - 1));
  return { jours, fuseau: tz, depuis: minuitLocal(premier, tz).toISOString(), premier_jour: premier, dernier_jour: dernier };
}

/** Le fuseau du bureau (`company_settings.timezone`), lu avec le client de l'utilisateur. */
export async function fuseauDuBureau(client: SupabaseClient, orgId: string): Promise<string> {
  const { data, error } = await client.from('company_settings').select('timezone').eq('org_id', orgId).maybeSingle();
  if (error) return FUSEAU_DEFAUT;
  return fuseauSur((data as { timezone?: string | null } | null)?.timezone);
}

// ── Les compteurs ───────────────────────────────────────────

export interface Compteurs {
  declenchees: number;
  envoyees: number;
  actions: number;
  echouees: number;
  /** Ignorées + annulées. */
  ignorees: number;
  /** Dont annulées (un envoi prévu qui n'a plus lieu d'être). */
  annulees: number;
  reportees: number;
  /** Fiches qui ont encore une étape en file, maintenant. */
  en_cours: number;
  ignorees_par_groupe: Partial<Record<GroupeMotif, number>>;
  ignorees_par_code: Record<string, number>;
  reportees_par_code: Record<string, number>;
}

export interface StatsRegle extends Compteurs {
  dernier_echec: { quand: string; action_type: string; erreur: string | null } | null;
  dernier_ignore: { quand: string; action_type: string; issue: string; detail: string | null } | null;
  /*
   * Les noms d'avant, gardés pour le panneau d'étape de l'éditeur et la suite de tests :
   * declenches = declenchees ; envoyes = envoyees + actions (toute action réussie) ;
   * sautes = envois ignorés DANS un passage (sans les événements écartés à l'entrée) ;
   * echecs = echouees.
   */
  declenches: number;
  envoyes: number;
  sautes: number;
  echecs: number;
  sautes_par_raison: Record<string, number>;
  dernier_saut: string | null;
}

export interface StatsEtape {
  envoyes: number;
  sautes: number;
  echecs: number;
  en_attente: number;
}

export interface JourStats {
  jour: string;
  declenchees: number;
  envoyees: number;
  echouees: number;
  ignorees: number;
}

export interface Statistiques {
  periode: Periode;
  par_regle: Record<string, StatsRegle>;
  total: Compteurs;
  /** Un élément par jour de la période, zéros compris. */
  par_jour: JourStats[];
  par_etape: Record<string, StatsEtape> | null;
}

/** Ce que rend la fonction SQL `automation_statistiques`. */
export interface BrutStatistiques {
  lignes: Array<{ rule_id: string; action_type: string; issue: string; categorie: string; n: number }>;
  declenchees: Array<{ rule_id: string; n: number }>;
  par_jour: Array<{ jour: string; n: number }>;
  par_jour_categorie: Array<{ jour: string; categorie: string; n: number }>;
  en_cours: Array<{ rule_id: string; n: number }>;
  dernier_echec: Array<{ rule_id: string; quand: string; action_type: string; erreur: string | null }>;
  dernier_ignore: Array<{ rule_id: string; quand: string; action_type: string; issue: string; detail: string | null }>;
  etapes: Array<{ step_id: string; categorie: string; n: number }> | null;
  etapes_en_attente: Array<{ step_id: string; n: number }> | null;
}

const compteursVides = (): Compteurs => ({
  declenchees: 0, envoyees: 0, actions: 0, echouees: 0, ignorees: 0, annulees: 0, reportees: 0, en_cours: 0,
  ignorees_par_groupe: {}, ignorees_par_code: {}, reportees_par_code: {},
});

/** Les codes qui écartent un événement AVANT qu'il entre : ignorés, mais pas des « étapes sautées ». */
const CODES_REFUS_ENTREE = new Set(['conditions', 'hors_ciblage', 'une_fois_par_client', 'pause_bureau']);

function compter(c: Compteurs, issue: string, categorie: string, n: number): void {
  switch (categorie) {
    case 'envoyee': c.envoyees += n; break;
    case 'action': c.actions += n; break;
    case 'echouee': c.echouees += n; break;
    case 'ignoree':
    case 'annulee': {
      c.ignorees += n;
      if (categorie === 'annulee') c.annulees += n;
      const g = groupeDeLIssue(issue);
      c.ignorees_par_groupe[g] = (c.ignorees_par_groupe[g] ?? 0) + n;
      c.ignorees_par_code[issue] = (c.ignorees_par_code[issue] ?? 0) + n;
      break;
    }
    case 'reportee':
      c.reportees += n;
      c.reportees_par_code[issue] = (c.reportees_par_code[issue] ?? 0) + n;
      break;
    // en_cours, tentative : jamais comptées sur une période.
    default: break;
  }
}

/** Additionne ce que la base a rendu. Pure : c'est elle que les tests rapides éprouvent. */
export function plierStatistiques(brut: BrutStatistiques, p: Periode): Statistiques {
  const regles = new Map<string, Compteurs>();
  const de = (id: string) => {
    let c = regles.get(id);
    if (!c) { c = compteursVides(); regles.set(id, c); }
    return c;
  };
  const total = compteursVides();

  for (const l of brut.lignes ?? []) {
    compter(de(l.rule_id), l.issue, l.categorie, Number(l.n));
    compter(total, l.issue, l.categorie, Number(l.n));
  }
  for (const d of brut.declenchees ?? []) { de(d.rule_id).declenchees = Number(d.n); total.declenchees += Number(d.n); }
  for (const e of brut.en_cours ?? []) { de(e.rule_id).en_cours = Number(e.n); total.en_cours += Number(e.n); }

  const echecs = new Map((brut.dernier_echec ?? []).map((d) => [d.rule_id, d]));
  const ignores = new Map((brut.dernier_ignore ?? []).map((d) => [d.rule_id, d]));

  const par_regle: Record<string, StatsRegle> = {};
  for (const [id, c] of regles) {
    const e = echecs.get(id);
    const i = ignores.get(id);
    const sautes_par_raison = Object.fromEntries(Object.entries(c.ignorees_par_code).filter(([code]) => !CODES_REFUS_ENTREE.has(code)));
    par_regle[id] = {
      ...c,
      dernier_echec: e ? { quand: e.quand, action_type: e.action_type, erreur: e.erreur } : null,
      dernier_ignore: i ? { quand: i.quand, action_type: i.action_type, issue: i.issue, detail: i.detail } : null,
      declenches: c.declenchees,
      envoyes: c.envoyees + c.actions,
      sautes: Object.values(sautes_par_raison).reduce((s, n) => s + n, 0),
      echecs: c.echouees,
      sautes_par_raison,
      dernier_saut: i && !CODES_REFUS_ENTREE.has(i.issue) ? i.detail : null,
    };
  }

  // Un élément par jour de la période, même à zéro : la courbe ne saute aucun jour.
  const jours = new Map<string, JourStats>();
  for (let j = p.premier_jour; j <= p.dernier_jour; j = ajouterJours(j, 1)) {
    jours.set(j, { jour: j, declenchees: 0, envoyees: 0, echouees: 0, ignorees: 0 });
  }
  for (const d of brut.par_jour ?? []) {
    const j = jours.get(d.jour);
    if (j) j.declenchees += Number(d.n);
  }
  for (const d of brut.par_jour_categorie ?? []) {
    const j = jours.get(d.jour);
    if (!j) continue;
    if (d.categorie === 'envoyee') j.envoyees += Number(d.n);
    else if (d.categorie === 'echouee') j.echouees += Number(d.n);
    else if (d.categorie === 'ignoree' || d.categorie === 'annulee') j.ignorees += Number(d.n);
  }

  let par_etape: Record<string, StatsEtape> | null = null;
  if (brut.etapes) {
    par_etape = {};
    const etape = (id: string) => (par_etape![id] ??= { envoyes: 0, sautes: 0, echecs: 0, en_attente: 0 }); // `!` : posé deux lignes plus haut.
    for (const e of brut.etapes) {
      if (e.categorie === 'envoyee' || e.categorie === 'action') etape(e.step_id).envoyes += Number(e.n);
      else if (e.categorie === 'ignoree' || e.categorie === 'annulee') etape(e.step_id).sautes += Number(e.n);
      else if (e.categorie === 'echouee') etape(e.step_id).echecs += Number(e.n);
    }
    for (const e of brut.etapes_en_attente ?? []) etape(e.step_id).en_attente += Number(e.n);
  }

  return { periode: p, par_regle, total, par_jour: [...jours.values()], par_etape };
}

export interface OptionsStatistiques {
  jours?: number;
  fuseau?: string;
  maintenant?: Date;
}

/**
 * Les statistiques d'un bureau (ou d'une automatisation, avec le détail par étape).
 * `client` : celui de l'utilisateur — la RLS s'applique à tout ce que la base lit.
 */
export async function calculerStatistiques(
  client: SupabaseClient,
  orgId: string,
  ruleId: string | null,
  options: OptionsStatistiques = {},
): Promise<Statistiques> {
  const fuseau = options.fuseau ?? await fuseauDuBureau(client, orgId);
  const p = periode(options.jours ?? 60, fuseau, options.maintenant);
  const { data, error } = await client.rpc('automation_statistiques', {
    p_org: orgId,
    p_depuis: p.depuis,
    p_rule: ruleId,
    p_fuseau: p.fuseau,
    p_categories: CATEGORIES_PAR_CODE,
    p_messages: ACTIONS_MESSAGE_CLIENT,
  });
  if (error) throw new Error(error.message);
  return plierStatistiques(data as BrutStatistiques, p);
}

// ── Journaux et Historique : lecture paginée ────────────────

export const PAR_PAGE_DEFAUT = 50;
export const PAR_PAGE_MAX = 200;

export interface FiltresLecture {
  ruleId?: string | null;
  jours: number;
  /** Dates civiles (AAAA-MM-JJ) dans le fuseau du bureau : resserrent la période. */
  du?: string | null;
  au?: string | null;
  statut?: FiltreStatut | null;
  action?: string | null;
  clientId?: string | null;
  recherche?: string | null;
  page?: number;
  parPage?: number;
}

/** Les bornes d'une lecture : la période, resserrée par les dates choisies. */
export function bornes(f: FiltresLecture, fuseau: string, maintenant: Date = new Date()): { p: Periode; depuis: string; jusqua: string | null } {
  const p = periode(f.jours, fuseau, maintenant);
  let depuis = p.depuis;
  if (f.du && f.du > p.premier_jour) depuis = minuitLocal(f.du, p.fuseau).toISOString();
  // « Au 3 octobre » comprend tout le 3 octobre : jusqu'à la dernière milliseconde du jour.
  const jusqua = f.au ? new Date(minuitLocal(ajouterJours(f.au, 1), p.fuseau).getTime() - 1).toISOString() : null;
  return { p, depuis, jusqua };
}

/** La fiche concernée (facture, devis, job, rendez-vous, opportunité) : de quoi l'afficher et y aller. */
export interface FicheLiee {
  type: string;
  id: string;
  numero: string | null;
  titre: string | null;
  /** Chemin de la fiche dans l'application, ou `null` s'il n'y a pas d'écran pour elle. */
  lien: string | null;
}

interface LigneAvecFiche {
  entity_type: string;
  entity_id: string;
  rule_id: string;
  fiche?: FicheLiee | null;
}

const texte = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v));

/** Résout, en une requête par table, la fiche citée par chaque ligne d'une page. */
async function resoudreFiches(client: SupabaseClient, orgId: string, lignes: LigneAvecFiche[]): Promise<void> {
  const ids = (type: string) => [...new Set(lignes.filter((l) => l.entity_type === type).map((l) => l.entity_id))];
  const fiches = new Map<string, FicheLiee>();
  const lire = async (
    table: string, colonnes: string, type: string, vers: (r: Record<string, unknown>) => FicheLiee,
  ) => {
    const liste = ids(type);
    if (!liste.length) return;
    const { data, error } = await client.from(table).select(colonnes).eq('org_id', orgId).in('id', liste);
    // Une table illisible (droit manquant) n'empêche pas d'afficher le reste : la fiche reste sans lien.
    if (error) return;
    for (const r of (data ?? []) as unknown as Array<Record<string, unknown>>) fiches.set(String(r.id), vers(r));
  };
  await Promise.all([
    lire('invoices', 'id, invoice_number', 'invoice', (r) => ({ type: 'invoice', id: String(r.id), numero: texte(r.invoice_number), titre: null, lien: `/invoices/${r.id}` })),
    lire('quotes', 'id, quote_number, title', 'quote', (r) => ({ type: 'quote', id: String(r.id), numero: texte(r.quote_number), titre: texte(r.title), lien: `/quotes/${r.id}` })),
    lire('jobs', 'id, job_number, title', 'job', (r) => ({ type: 'job', id: String(r.id), numero: texte(r.job_number), titre: texte(r.title), lien: `/jobs/${r.id}` })),
    lire('deals', 'id, title', 'deal', (r) => ({ type: 'deal', id: String(r.id), numero: null, titre: texte(r.title), lien: null })),
    lire('schedule_events', 'id, job_id, title', 'schedule_event', (r) => ({ type: 'schedule_event', id: String(r.id), numero: null, titre: texte(r.title), lien: r.job_id ? `/jobs/${r.job_id}` : null })),
    lire('schedule_events', 'id, job_id, title', 'appointment', (r) => ({ type: 'schedule_event', id: String(r.id), numero: null, titre: texte(r.title), lien: r.job_id ? `/jobs/${r.job_id}` : null })),
  ]);
  for (const l of lignes) l.fiche = fiches.get(l.entity_id) ?? null;
}

/** La position (1, 2, 3…) de chaque étape des parcours cités par une page. */
interface RepereEtape { position: number; type: string; nom: string | null }

async function positionsDesEtapes(client: SupabaseClient, orgId: string, ruleIds: string[]): Promise<Map<string, Map<string, RepereEtape>>> {
  const resultat = new Map<string, Map<string, RepereEtape>>();
  if (!ruleIds.length) return resultat;
  const { data, error } = await client.from('automation_rules').select('id, steps').eq('org_id', orgId).in('id', ruleIds);
  if (error) return resultat;
  for (const r of (data ?? []) as Array<{ id: string; steps: unknown }>) {
    const m = new Map<string, RepereEtape>();
    if (Array.isArray(r.steps)) {
      r.steps.forEach((e, i) => {
        const etape = e as { id?: unknown; type?: unknown; nom?: unknown };
        if (typeof etape.id !== 'string') return;
        // Le nom que l'utilisateur a donné à l'étape dans l'éditeur, s'il y en a un.
        const nom = typeof etape.nom === 'string' && etape.nom.trim() ? etape.nom.trim() : null;
        m.set(etape.id, { position: i + 1, type: String(etape.type ?? ''), nom });
      });
    }
    resultat.set(r.id, m);
  }
  return resultat;
}

export interface LigneJournal {
  source: 'journal' | 'tache';
  id: string;
  issue: string;
  categorie: string;
  quand: string;
  rule_id: string;
  rule_nom: string | null;
  entity_type: string;
  entity_id: string;
  client_id: string | null;
  client_nom: string | null;
  task_id: string | null;
  step_id: string | null;
  /** La position de l'étape dans le parcours (1, 2, 3…), ou `null` (pas un parcours, ou étape retirée). */
  etape_position: number | null;
  /** Le nom donné à l'étape dans l'éditeur, s'il y en a un. */
  etape_nom: string | null;
  action_type: string;
  trigger_event: string | null;
  result_error: string | null;
  result_data: Record<string, unknown> | null;
  action_config: Record<string, unknown> | null;
  duration_ms: number | null;
  execution_key: string | null;
  tache: { status: string; execute_at: string; attempts: number; last_error: string | null; completed_at: string | null } | null;
  fiche: FicheLiee | null;
}

export interface PageJournal {
  periode: Periode;
  total: number;
  page: number;
  par_page: number;
  /** Les types d'action présents sur la période (pour le filtre). */
  actions: string[];
  lignes: LigneJournal[];
}

function pagination(f: FiltresLecture): { page: number; parPage: number; decalage: number } {
  const parPage = Math.min(PAR_PAGE_MAX, Math.max(1, Math.floor(f.parPage ?? PAR_PAGE_DEFAUT)));
  const page = Math.max(1, Math.floor(f.page ?? 1));
  return { page, parPage, decalage: (page - 1) * parPage };
}

/** Les Journaux : chaque événement, filtré et paginé EN BASE, avec le total. */
export async function lireJournal(client: SupabaseClient, orgId: string, f: FiltresLecture, options: OptionsStatistiques = {}): Promise<PageJournal> {
  const fuseau = options.fuseau ?? await fuseauDuBureau(client, orgId);
  const { p, depuis, jusqua } = bornes(f, fuseau, options.maintenant);
  const { page, parPage, decalage } = pagination(f);
  const { data, error } = await client.rpc('automation_journal', {
    p_org: orgId,
    p_depuis: depuis,
    p_jusqua: jusqua,
    p_rule: f.ruleId ?? null,
    p_statuts: f.statut ? [...FILTRES_STATUT[f.statut]] : null,
    p_action: f.action || null,
    p_client: f.clientId ?? null,
    p_recherche: f.recherche?.trim() || null,
    p_categories: CATEGORIES_PAR_CODE,
    p_messages: ACTIONS_MESSAGE_CLIENT,
    p_limite: parPage,
    p_decalage: decalage,
  });
  if (error) throw new Error(error.message);
  const brut = data as { total: number; actions: string[]; lignes: LigneJournal[] };
  const lignes = brut.lignes ?? [];
  const positions = await positionsDesEtapes(client, orgId, [...new Set(lignes.filter((l) => l.step_id).map((l) => l.rule_id))]);
  for (const l of lignes) {
    const repere = l.step_id ? positions.get(l.rule_id)?.get(l.step_id) : undefined;
    l.etape_position = repere?.position ?? null;
    l.etape_nom = repere?.nom ?? null;
  }
  await resoudreFiches(client, orgId, lignes);
  return { periode: p, total: Number(brut.total ?? 0), page, par_page: parPage, actions: brut.actions ?? [], lignes };
}

export interface EvenementPassage {
  source: 'journal' | 'tache';
  id: string;
  issue: string;
  categorie: string;
  quand: string;
  action_type: string;
  step_id: string | null;
  etape_position: number | null;
  etape_nom: string | null;
  en_file: boolean;
  trigger_event: string | null;
  /** La phrase du moteur (motif d'un envoi ignoré, erreur, motif d'annulation). */
  detail: string | null;
  execute_at: string | null;
  attempts: number | null;
}

export interface Passage {
  cle: string;
  rule_id: string;
  rule_nom: string | null;
  entity_type: string;
  entity_id: string;
  client_id: string | null;
  client_nom: string | null;
  debut: string;
  fin: string;
  en_file: boolean;
  /** Faux : l'événement a été écarté avant d'entrer (hors ciblage…). */
  declenche: boolean;
  resultat: string;
  evenements: EvenementPassage[];
  fiche: FicheLiee | null;
}

export interface PagePassages {
  periode: Periode;
  total: number;
  page: number;
  par_page: number;
  passages: Passage[];
}

/** Les statuts d'un PASSAGE offerts par le filtre de l'Historique → résultats lus en base. */
const RESULTATS_PAR_FILTRE: Record<FiltreStatut, string[]> = {
  reussis: ['envoyee', 'action'],
  ignores: ['ignoree', 'annulee'],
  reportes: ['reportee'],
  echoues: ['echouee'],
  en_cours: ['en_cours'],
  tentatives: ['tentative'],
};

/** L'Historique : une ligne par passage d'un client, filtré et paginé EN BASE, avec le total. */
export async function lirePassages(client: SupabaseClient, orgId: string, f: FiltresLecture, options: OptionsStatistiques = {}): Promise<PagePassages> {
  const fuseau = options.fuseau ?? await fuseauDuBureau(client, orgId);
  const { p, depuis, jusqua } = bornes(f, fuseau, options.maintenant);
  const { page, parPage, decalage } = pagination(f);
  const { data, error } = await client.rpc('automation_passages', {
    p_org: orgId,
    p_depuis: depuis,
    p_jusqua: jusqua,
    p_rule: f.ruleId ?? null,
    p_statuts: f.statut ? RESULTATS_PAR_FILTRE[f.statut] : null,
    p_client: f.clientId ?? null,
    p_recherche: f.recherche?.trim() || null,
    p_categories: CATEGORIES_PAR_CODE,
    p_messages: ACTIONS_MESSAGE_CLIENT,
    p_limite: parPage,
    p_decalage: decalage,
  });
  if (error) throw new Error(error.message);
  const brut = data as { total: number; passages: Passage[] };
  const passages = brut.passages ?? [];
  const positions = await positionsDesEtapes(client, orgId, [...new Set(passages.map((x) => x.rule_id))]);
  for (const x of passages) {
    for (const e of x.evenements ?? []) {
      const repere = e.step_id ? positions.get(x.rule_id)?.get(e.step_id) : undefined;
      e.etape_position = repere?.position ?? null;
      e.etape_nom = repere?.nom ?? null;
    }
  }
  await resoudreFiches(client, orgId, passages);
  return { periode: p, total: Number(brut.total ?? 0), page, par_page: parPage, passages };
}
