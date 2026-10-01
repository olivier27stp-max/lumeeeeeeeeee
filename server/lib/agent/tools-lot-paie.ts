/* ═══════════════════════════════════════════════════════════════
   Lumi — lot ÉQUIPE ET PAIE : montants de paie, historique des
   versements, corrections de feuilles de temps, commissions, horaire
   du jour.
   ─────────────────────────────────────────────────────────────
   L'audit a trouvé des gestes que l'app permet et que Lumi ne savait pas
   faire. Trois chemins, selon ce que fait l'écran lui-même :

   - ce qui a une ROUTE en POST (approuver / verser une commission) passe par
     `appelInterne` : même garde admin, même verrou de période versée, même
     trace d'audit que la page Commissions ;
   - ce que l'écran LIT par une route en GET (paie de la période, historique,
     commissions) passe par `lireRoute` : `appelInterne` ne parle pas GET, et
     recopier le calcul (heures × taux + commissions + ajustements) ferait
     deux vérités pour la paie ;
   - ce que l'écran Feuilles de temps fait DIRECTEMENT en base (corriger,
     supprimer, forcer la sortie) passe par le client RLS de l'utilisateur,
     avec `org_id = ctx.orgId` sur chaque requête. Jamais le client service.

   Deux écarts VOULUS par rapport à l'écran, parce qu'il a un défaut :
   - l'écran ne corrige que `punch_in` / `punch_out` (l'heure affichée) ; la
     paie se calcule sur `punch_in_at` / `punch_out_at`. Ici les deux sont
     écrits ensemble, sinon Lumi dirait « corrigé » sans que la paie bouge ;
   - forcer la sortie ferme aussi la pause restée ouverte, comme le fait la
     route de pointage : une pause jamais fermée n'est pas déduite, donc payée.

   `time_entries` n'a pas de `deleted_at` : supprimer une entrée est définitif,
   comme sur l'écran.
   ═══════════════════════════════════════════════════════════════ */

import type { PermissionKey } from '../../../src/lib/permissions';
import { computeEntryHours } from '../payroll';
import { totauxCommissions, enCents } from '../field-sales/commission-periode';
import { toLocalDate, toLocalDateTime, addDays } from '../reports/dates';
import { dateHeureLocaleVersUtc } from '../lumi/temps';
import type { IdTopic } from '../lumi/topics';
import type { AgentTool, ToolContext } from './tools';
import {
  executerIdempotent, appelInterne, AppelInterneIncertain,
  traduireStatut, STATUT_ROLE,
} from './tools-etendus';

// ─────────────────────────────────────────────────────────────────
// Aides locales
// ─────────────────────────────────────────────────────────────────

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const DATE_HEURE_NAIVE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/;
const DATE_HEURE_DECALEE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/;

const FUSEAU_DEFAUT = 'America/Toronto'; // DEFAULT de company_settings.timezone
const STATUTS_COMMISSION = ['pending', 'approved', 'paid', 'reversed'] as const;
/** Un quart de plus de 24 h est une faute de frappe (mauvais jour), pas un quart. */
const QUART_MAX_MS = 24 * 3_600_000;
/** Au-delà, forcer la sortie « maintenant » paie des heures que personne n'a faites. */
const QUART_LONG_H = 16;
/** Tolérance d'horloge : une heure « dans le futur » de moins de 5 min passe. */
const MARGE_FUTUR_MS = 5 * 60_000;

/**
 * Un refus rédigé pour l'utilisateur (français, sans jargon). Les lectures le
 * rendent tel quel ; tout autre échec (base, réseau) devient une phrase
 * générique — jamais une erreur brute vers le modèle.
 */
class Refus extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Refus';
  }
}

function erreurLecture(scope: string, err: unknown): { error: string } {
  if (err instanceof Refus) return { error: err.message };
  console.error(`[agent-tool:${scope}]`, (err as { message?: string })?.message || err);
  return { error: 'La consultation a échoué côté Lume. Dis-le simplement à l’utilisateur et propose de réessayer.' };
}

const vide = (v: unknown): boolean => v == null || String(v).trim() === '';

/** Un identifiant obligatoire, au format uuid (sinon Postgres répondrait en jargon). */
function identifiant(v: unknown, nom: string, source: string): string {
  if (vide(v)) throw new Refus(`${nom} est requis — précise-le et réessaie.`);
  const s = String(v).trim();
  if (!UUID.test(s)) throw new Refus(`${nom} n'est pas un identifiant valide — récupère-le via ${source} et réessaie.`);
  return s;
}

function identifiantOptionnel(v: unknown, nom: string, source: string): string | undefined {
  return vide(v) ? undefined : identifiant(v, nom, source);
}

function dateYmdOptionnelle(v: unknown, nom: string): string | undefined {
  if (vide(v)) return undefined;
  const s = String(v).trim();
  if (!YMD.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`))) throw new Refus(`${nom} doit être une date au format AAAA-MM-JJ.`);
  return s;
}

/** Une date-heure complète, vérifiée AVANT toute lecture ; convertie plus tard, quand le fuseau est connu. */
function dateHeureOptionnelle(v: unknown, nom: string): string | undefined {
  if (vide(v)) return undefined;
  const s = String(v).trim();
  if (!DATE_HEURE_NAIVE.test(s) && !DATE_HEURE_DECALEE.test(s)) {
    throw new Refus(`${nom} doit être une date-heure complète, à l'heure de l'entreprise (ex. 2026-09-30T17:00).`);
  }
  return s;
}

/** Date-heure validée → instant ISO UTC. Sans décalage, c'est l'heure de l'entreprise. */
function versInstant(s: string, nom: string, fuseau: string): string {
  const iso = DATE_HEURE_NAIVE.test(s) ? dateHeureLocaleVersUtc(s, fuseau) : s.replace(' ', 'T');
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) throw new Refus(`${nom} n'est pas une date-heure valide (ex. 2026-09-30T17:00).`);
  return new Date(ms).toISOString();
}

const entier = (v: unknown, defaut: number, max: number): number => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : defaut;
};

const heures = (n: unknown) => Math.round((Number(n) || 0) * 100) / 100;
const dollars = new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD' });
const enDollars = (cents: number) => dollars.format(cents / 100);

/** Fuseau de l'entreprise, lu avec le client de l'utilisateur (aucun cache partagé à salir). */
async function fuseauEntreprise(ctx: ToolContext): Promise<string> {
  const { data, error } = await ctx.client
    .from('company_settings')
    .select('timezone')
    .eq('org_id', ctx.orgId)
    .maybeSingle();
  if (error) throw error;
  const brut = String((data as { timezone?: string } | null)?.timezone || '').trim();
  if (!brut) return FUSEAU_DEFAUT;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: brut });
    return brut;
  } catch (e) {
    console.error('[agent-tool:lot-paie] fuseau inconnu, repli sur le défaut', brut, (e as Error)?.message);
    return FUSEAU_DEFAUT;
  }
}

/** « 2026-09-30T08:02 » à l'heure de l'entreprise — la forme que l'outil accepte en retour. */
const localeIso = (iso: string, fuseau: string) => toLocalDateTime(iso, fuseau).replace(' ', 'T');
/** « 08:02:00 » à l'heure de l'entreprise, pour les colonnes `punch_in` / `punch_out` (time). */
const heureLocale = (iso: string, fuseau: string) => `${toLocalDateTime(iso, fuseau).slice(11)}:00`;

/** Rôle du demandeur dans l'org, lu avec SON client (sa propre ligne est toujours visible). */
async function roleDuDemandeur(ctx: ToolContext): Promise<string> {
  const { data, error } = await ctx.client
    .from('memberships')
    .select('role')
    .eq('org_id', ctx.orgId)
    .eq('user_id', ctx.userId)
    .maybeSingle();
  if (error) throw error;
  return String((data as { role?: string } | null)?.role || '').toLowerCase();
}

const estGestionnaire = (role: string) => role === 'owner' || role === 'admin';

async function exigerAdmin(ctx: ToolContext, capacite: string): Promise<void> {
  if (!estGestionnaire(await roleDuDemandeur(ctx))) {
    throw new Refus(`Ton rôle dans Lume ne permet pas ${capacite} (réservé aux administrateurs et propriétaires).`);
  }
}

/**
 * Paie et heures SUR SOI-MÊME : un admin ne corrige pas ses propres heures et
 * n'approuve ni ne verse sa propre commission. Le propriétaire, lui, le peut.
 */
async function refuserSurSoi(ctx: ToolContext, userId: string | null | undefined, capacite: string): Promise<void> {
  if (!userId || userId !== ctx.userId) return;
  if ((await roleDuDemandeur(ctx)) === 'owner') return;
  throw new Refus(`Tu ne peux pas faire ${capacite} pour toi-même : demande au propriétaire de l’entreprise.`);
}

interface MembreOrg { user_id: string; role: string; status: string | null; full_name: string | null }

/** La fiche d'un membre DE CETTE ORG — ou un refus lisible. */
async function membreDeLOrg(ctx: ToolContext, userId: string): Promise<MembreOrg> {
  const { data, error } = await ctx.client
    .from('memberships')
    .select('user_id, role, status, full_name')
    .eq('org_id', ctx.orgId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Refus('Ce membre est introuvable dans cette entreprise — vérifie avec get_team.');
  return data as MembreOrg;
}

const nomMembre = (m: { full_name: string | null }) => (m.full_name || '').trim() || 'ce membre';

/** user_id → nom, pour les membres de CETTE org. */
async function nomsDesMembres(ctx: ToolContext, ids: string[]): Promise<Map<string, string>> {
  const noms = new Map<string, string>();
  const uniques = [...new Set(ids.filter(Boolean))];
  if (!uniques.length) return noms;
  const { data, error } = await ctx.client
    .from('memberships')
    .select('user_id, full_name')
    .eq('org_id', ctx.orgId)
    .in('user_id', uniques);
  if (error) throw error;
  for (const m of (data || []) as Array<{ user_id: string; full_name: string | null }>) {
    const nom = (m.full_name || '').trim();
    if (nom) noms.set(m.user_id, nom);
  }
  return noms;
}

// ── Appels de routes ─────────────────────────────────────────────

/** Phrase d'exploitant pour un refus de route (les routes répondent en anglais, avec des codes). */
function messageRefusRoute(status: number, json: any, contexte: string): string {
  const detail = typeof json?.error === 'string' ? json.error.trim() : '';
  if (status === 401) return 'Cette action exige votre session Lume — reconnectez-vous.';
  if (status === 402) return `${contexte} exige un abonnement Lume actif.`;
  if (status === 403) return `Ton rôle dans Lume ne permet pas ${contexte} (réservé aux administrateurs et propriétaires).`;
  if (status === 404) return `Introuvable dans cette entreprise — ${contexte} n'a pas été fait. Vérifie l'identifiant et réessaie.`;
  if (status === 409 && detail) return `${contexte} : ${detail}`;
  return `${contexte} n'a pas fonctionné côté Lume (${status}). Dis-le simplement et propose de réessayer.`;
}

type ReponseRoute = { ok: true; json: any } | { ok: false; incertain: true };

/**
 * POST d'une route de l'app au nom de l'utilisateur. Un refus devient une
 * erreur en français (empreinte libérée). Une réponse jamais revenue est
 * signalée `incertain` SANS lever : l'empreinte est gardée, une retentative
 * tombe sur `deja_fait` — jamais une commission versée deux fois.
 */
async function viaRoute(ctx: ToolContext, chemin: string, corps: Record<string, unknown>, contexte: string): Promise<ReponseRoute> {
  let r: { ok: boolean; status: number; json: any };
  try {
    r = await appelInterne(ctx, chemin, corps);
  } catch (e) {
    if (e instanceof AppelInterneIncertain) return { ok: false, incertain: true };
    throw e;
  }
  if (!r.ok) throw new Refus(messageRefusRoute(r.status, r.json, contexte));
  return { ok: true, json: r.json ?? {} };
}

function resultatIncertain(contexte: string): Record<string, unknown> {
  return {
    incertain: true,
    note: `Je n'ai pas eu la confirmation que ${contexte} a abouti — c'est PEUT-ÊTRE fait. Vérifie dans Lume avant de recommencer ; ne refais pas le geste à l'aveugle.`,
  };
}

const TIMEOUT_LECTURE_MS = Number(process.env.MCP_INTERNAL_TIMEOUT_MS) || 20_000;

/**
 * GET d'une route de l'app au nom de l'utilisateur (même adresse, même
 * session, même bureau qu'`appelInterne`, qui ne parle que POST/PUT/PATCH).
 * Une lecture se relance sans risque : pas d'état « incertain » ici.
 */
async function lireRoute(ctx: ToolContext, chemin: string, contexte: string): Promise<any> {
  if (!ctx.accessToken) throw new Refus('Cette consultation exige votre session Lume — reconnectez-vous.');
  const port = Number(process.env.PORT || process.env.API_PORT || 3002);
  const ctrl = new AbortController();
  const minuteur = setTimeout(() => ctrl.abort(), TIMEOUT_LECTURE_MS);
  let r: Response;
  try {
    r = await fetch(`http://127.0.0.1:${port}/api${chemin}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${ctx.accessToken}`, 'x-org-id': ctx.orgId },
      signal: ctrl.signal,
    });
  } catch (e) {
    console.error(`[lireRoute:${chemin}] pas de réponse (org ${ctx.orgId}) :`, (e as Error)?.name === 'AbortError' ? 'timeout' : (e as Error)?.message || e);
    throw new Refus(`${contexte} n'a pas répondu à temps côté Lume. Dis-le simplement et propose de réessayer.`);
  } finally {
    clearTimeout(minuteur);
  }
  const json = await r.json().catch(() => null);
  if (!r.ok) throw new Refus(messageRefusRoute(r.status, json, contexte));
  return json;
}

// ─────────────────────────────────────────────────────────────────
// PAIE — lectures (routes GET /payroll/*, réservées admin/propriétaire)
// ─────────────────────────────────────────────────────────────────

interface LignePaie {
  user_id: string;
  name: string;
  role: string | null;
  hours: number;
  rate_cents: number;
  gross_cents: number;
  commission_cents: number;
  adjustments_cents: number;
  total_cents: number;
  adjustments?: Array<{ id: string; amount_cents: number; note: string | null }>;
  payment: { total_cents: number; paid_at: string; note: string | null } | null;
  commission_plan_missing?: boolean;
  inactive?: boolean;
  ecart_depuis_versement_cents?: number;
}

const somme = (lignes: LignePaie[], champ: 'gross_cents' | 'commission_cents' | 'adjustments_cents' | 'total_cents') =>
  lignes.reduce((s, l) => s + (Number(l[champ]) || 0), 0);

const getPayrollAmountsTool: AgentTool = {
  kind: 'read',
  needsIdentity: true,
  declaration: {
    name: 'get_payroll_amounts',
    description:
      'Pay per member for one pay period: hours, rate, gross, commissions, adjustments, total, paid or not. Admin/owner only. '
      + 'Use instead of get_payroll_summary whenever amounts are asked.',
    parameters: {
      type: 'object',
      properties: {
        period_ref: { type: 'string', description: 'Date YYYY-MM-DD inside the period (default: today).' },
        user_id: { type: 'string', description: 'Only this member (from get_team).' },
      },
    },
  },
  handler: async (args, ctx) => {
    try {
      const ref = dateYmdOptionnelle(args.period_ref, 'period_ref');
      const userId = identifiantOptionnel(args.user_id, 'user_id', 'get_team');
      const json = await lireRoute(ctx, `/payroll/period-summary${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`, 'la consultation de la paie');
      const toutes: LignePaie[] = Array.isArray(json?.rows) ? json.rows : [];
      const lignes = userId ? toutes.filter((l) => l.user_id === userId) : toutes;
      if (userId && !lignes.length) throw new Refus('Ce membre n’a pas de ligne de paie dans cette période — vérifie avec get_team.');
      const payees = lignes.filter((l) => l.payment);
      const periode = json?.period || {};
      return {
        period: { start: periode.start ?? null, end: periode.end ?? null, pay_date: periode.payDate ?? null },
        count: lignes.length,
        members: lignes.map((l) => ({
          user_id: l.user_id,
          name: l.name,
          role: traduireStatut(l.role, STATUT_ROLE),
          hours: heures(l.hours),
          rate_cents: l.rate_cents,
          gross_cents: l.gross_cents,
          commission_cents: l.commission_cents,
          adjustments_cents: l.adjustments_cents,
          total_cents: l.total_cents,
          paid: !!l.payment,
          ...(l.payment ? { paid_at: l.payment.paid_at, paid_total_cents: l.payment.total_cents } : {}),
          ...(l.adjustments?.length ? { adjustments: l.adjustments.map((a) => ({ amount_cents: a.amount_cents, note: a.note })) } : {}),
          ...(l.ecart_depuis_versement_cents ? { gap_since_payment_cents: l.ecart_depuis_versement_cents } : {}),
          ...(l.commission_plan_missing ? { commission_plan_missing: true } : {}),
          ...(l.inactive ? { inactive: true } : {}),
        })),
        totals: {
          hours: heures(lignes.reduce((s, l) => s + (Number(l.hours) || 0), 0)),
          gross_cents: somme(lignes, 'gross_cents'),
          commission_cents: somme(lignes, 'commission_cents'),
          adjustments_cents: somme(lignes, 'adjustments_cents'),
          total_cents: somme(lignes, 'total_cents'),
          paid_count: payees.length,
          unpaid_count: lignes.length - payees.length,
        },
        note: lignes.length
          ? `Paie du ${periode.start} au ${periode.end} (versée le ${periode.payDate}) : ${payees.length} payé(s), ${lignes.length - payees.length} à payer. Calcul de l’écran Paie, à l’instant.`
          : `Aucun membre à payer pour la période du ${periode.start} au ${periode.end}.`,
      };
    } catch (e) {
      return erreurLecture('get_payroll_amounts', e);
    }
  },
};

const getPayrollHistoryTool: AgentTool = {
  kind: 'read',
  needsIdentity: true,
  declaration: {
    name: 'get_payroll_history',
    description: 'Past pay periods already marked paid for ONE member (hours, gross, commissions, adjustments, total, paid date), newest first. Admin/owner only.',
    parameters: {
      type: 'object',
      properties: {
        user_id: { type: 'string', description: 'Member user id (from get_team).' },
        limit: { type: 'integer', description: 'Max periods (default 12, max 52).' },
      },
      required: ['user_id'],
    },
  },
  handler: async (args, ctx) => {
    try {
      const userId = identifiant(args.user_id, 'user_id', 'get_team');
      const membre = await membreDeLOrg(ctx, userId);
      const json = await lireRoute(ctx, `/payroll/history?user_id=${encodeURIComponent(userId)}`, 'la consultation de l’historique de paie');
      const tous: Array<Record<string, unknown>> = Array.isArray(json?.payments) ? json.payments : [];
      const versements = tous.slice(0, entier(args.limit, 12, 52));
      return {
        user_id: userId,
        name: nomMembre(membre),
        count: versements.length,
        payments: versements.map((p) => ({
          period_start: p.period_start,
          period_end: p.period_end,
          hours: heures(p.hours),
          gross_cents: p.gross_cents,
          commission_cents: p.commission_cents,
          adjustments_cents: p.adjustments_cents,
          total_cents: p.total_cents,
          paid_at: p.paid_at,
          ...(p.note ? { payment_note: p.note } : {}),
        })),
        note: versements.length
          ? `${versements.length} période(s) payée(s) pour ${nomMembre(membre)}${tous.length > versements.length ? ` (sur ${tous.length})` : ''}, la plus récente d’abord.`
          : `Aucune période marquée payée pour ${nomMembre(membre)} — la période en cours se lit avec get_payroll_amounts.`,
      };
    } catch (e) {
      return erreurLecture('get_payroll_history', e);
    }
  },
};

// ─────────────────────────────────────────────────────────────────
// FEUILLES DE TEMPS — retrouver et corriger des entrées (écran, en direct)
// ─────────────────────────────────────────────────────────────────

interface Pause { start?: string; end?: string }

interface EntreeTemps {
  id: string;
  employee_id: string | null;
  employee_name: string | null;
  date: string;
  punch_in: string | null;
  punch_out: string | null;
  punch_in_at: string | null;
  punch_out_at: string | null;
  breaks: Pause[] | null;
  status: string | null;
  notes: string | null;
  approved_at: string | null;
}

const COLONNES_ENTREE = 'id, employee_id, employee_name, date, punch_in, punch_out, punch_in_at, punch_out_at, breaks, status, notes, approved_at';

/** L'entrée de temps DE CETTE ORG — ou un refus lisible. */
async function entreeDeLOrg(ctx: ToolContext, entryId: string): Promise<EntreeTemps> {
  const { data, error } = await ctx.client
    .from('time_entries')
    .select(COLONNES_ENTREE)
    .eq('org_id', ctx.orgId)
    .eq('id', entryId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Refus('Cette entrée de temps est introuvable dans cette entreprise — retrouve-la avec list_time_entries.');
  return data as EntreeTemps;
}

const estOuverte = (e: EntreeTemps) => !e.punch_out && !e.punch_out_at;
/** Même lecture que l'écran (préfixe des notes) + les colonnes prévues pour ça. */
const estApprouvee = (e: EntreeTemps) => !!e.approved_at || String(e.notes || '').startsWith('[APPROVED]');
const nomEntree = (e: EntreeTemps) => (e.employee_name || '').trim() || 'ce membre';
const heuresEntree = (e: Pick<EntreeTemps, 'punch_in_at' | 'punch_out_at' | 'breaks'>) => heures(computeEntryHours(e));

/** Début / fin à l'heure de l'entreprise ; repli sur les colonnes d'affichage pour une vieille entrée sans horodatage. */
function bornesLocales(e: EntreeTemps, fuseau: string): { debut: string | null; fin: string | null } {
  const repli = (t: string | null) => (t ? `${e.date}T${String(t).slice(0, 5)}` : null);
  return {
    debut: e.punch_in_at ? localeIso(e.punch_in_at, fuseau) : repli(e.punch_in),
    fin: e.punch_out_at ? localeIso(e.punch_out_at, fuseau) : repli(e.punch_out),
  };
}

/**
 * Ferme la pause restée ouverte à l'heure de sortie, dans le format où elle a
 * été ouverte (la route de pointage écrit « HH:MM:SS » à l'horloge du serveur,
 * l'édition à la main un horodatage ISO). Null = aucune pause à fermer.
 */
function fermerPauseOuverte(pauses: Pause[] | null, finIso: string): Pause[] | null {
  const liste = Array.isArray(pauses) ? pauses : [];
  const derniere = liste[liste.length - 1];
  if (!derniere?.start || derniere.end) return null;
  const horodatee = /^\d{4}-\d{2}-\d{2}T/.test(derniere.start);
  return [...liste.slice(0, -1), { ...derniere, end: horodatee ? finIso : new Date(finIso).toTimeString().slice(0, 8) }];
}

function refuserFutur(iso: string, nom: string): void {
  if (Date.parse(iso) > Date.now() + MARGE_FUTUR_MS) throw new Refus(`${nom} est dans le futur — donne l'heure réelle du pointage.`);
}

/** Une écriture que la RLS filtre ne lève rien : zéro ligne touchée = rien de fait, et il faut le dire. */
function exigerLigneTouchee(data: unknown, geste: string): void {
  if (!Array.isArray(data) || !data.length) {
    throw new Refus(`${geste} n'a rien changé : l'entrée a été modifiée entre-temps ou ton rôle ne le permet pas. Relis-la avec list_time_entries.`);
  }
}

const listTimeEntriesTool: AgentTool = {
  kind: 'read',
  needsIdentity: true,
  declaration: {
    name: 'list_time_entries',
    description:
      'List individual time entries (id, member, clock-in, clock-out, hours, open, approved) to find one to correct. '
      + 'Default: last 7 days. Hours totals per member → get_timesheets.',
    parameters: {
      type: 'object',
      properties: {
        user_id: { type: 'string', description: 'Only this member (from get_team).' },
        from: { type: 'string', description: 'Start date YYYY-MM-DD (default: 7 days ago).' },
        to: { type: 'string', description: 'End date YYYY-MM-DD (default: today).' },
        open_only: { type: 'boolean', description: 'true = only entries with no clock-out.' },
        limit: { type: 'integer', description: 'Max entries (default 50, max 100).' },
      },
    },
  },
  handler: async (args, ctx) => {
    try {
      let userId = identifiantOptionnel(args.user_id, 'user_id', 'get_team');
      const du = dateYmdOptionnelle(args.from, 'from');
      const au = dateYmdOptionnelle(args.to, 'to');
      // Un membre sans rôle de gestion ne voit que SES entrées, comme sur l'écran.
      const gestionnaire = estGestionnaire(await roleDuDemandeur(ctx));
      if (!gestionnaire) {
        if (userId && userId !== ctx.userId) throw new Refus('Ton rôle dans Lume ne permet de consulter que tes propres entrées de temps.');
        userId = ctx.userId;
      }
      const fuseau = await fuseauEntreprise(ctx);
      const to = au ?? toLocalDate(new Date(), fuseau);
      const from = du ?? addDays(to, -6);
      if (from > to) throw new Refus('from doit précéder to.');
      const max = entier(args.limit, 50, 100);

      // La colonne `date` est posée à l'horloge du serveur (UTC) : un pointage du
      // soir y porte la date du lendemain. On élargit d'un jour de chaque côté,
      // puis on retient le jour LOCAL du pointage.
      let q = ctx.client
        .from('time_entries')
        .select(COLONNES_ENTREE)
        .eq('org_id', ctx.orgId)
        .gte('date', addDays(from, -1))
        .lte('date', addDays(to, 1))
        .order('date', { ascending: false })
        .order('punch_in_at', { ascending: false })
        .limit(1000);
      if (userId) q = q.eq('employee_id', userId);
      if (args.open_only === true) q = q.is('punch_out', null);
      const { data, error } = await q;
      if (error) throw error;

      const retenues = ((data || []) as EntreeTemps[]).filter((e) => {
        const jour = e.punch_in_at ? toLocalDate(e.punch_in_at, fuseau) : e.date;
        return jour >= from && jour <= to;
      });
      const entrees = retenues.slice(0, max);
      return {
        from, to,
        count: entrees.length,
        entries: entrees.map((e) => {
          const { debut, fin } = bornesLocales(e, fuseau);
          const note = String(e.notes || '').replace(/^\[APPROVED\]\s*/, '').trim();
          const jourLocal = e.punch_in_at ? toLocalDate(e.punch_in_at, fuseau) : e.date;
          return {
            id: e.id,
            user_id: e.employee_id,
            name: nomEntree(e),
            date: jourLocal,
            // Le jour de la semaine est DONNÉ : sans lui, le modèle le devinait (vu en prod le 2026-10-01 :
            // « lundi 24 septembre » pour un jeudi).
            weekday: JOURS_FR[new Date(`${jourLocal}T00:00:00Z`).getUTCDay()],
            clock_in_at: debut,
            clock_out_at: fin,
            hours: heuresEntree(e),
            open: estOuverte(e),
            approved: estApprouvee(e),
            ...(Array.isArray(e.breaks) && e.breaks.length ? { breaks: e.breaks.length } : {}),
            ...(note ? { notes: note } : {}),
          };
        }),
        note: !entrees.length
          ? `Aucune entrée de temps du ${from} au ${to}${args.open_only === true ? ' sans pointage de sortie' : ''}.`
          : retenues.length > entrees.length
            ? `${entrees.length} entrées affichées sur ${retenues.length} — resserre la période ou précise un membre. Heures à l’heure de l’entreprise.`
            : `${entrees.length} entrée(s) du ${from} au ${to}, heures à l’heure de l’entreprise.`,
      };
    } catch (e) {
      return erreurLecture('list_time_entries', e);
    }
  },
};

const updateTimeEntryTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'update_time_entry',
    description:
      'Correct the clock-in and/or clock-out of a time entry (paid hours follow). Admin/owner only, never one\'s own entry. '
      + 'Get entry_id from list_time_entries. Confirm the new times first.',
    parameters: {
      type: 'object',
      properties: {
        entry_id: { type: 'string', description: 'Time entry id.' },
        clock_in_at: { type: 'string', description: 'New clock-in date-time, company time (e.g. 2026-09-30T08:00).' },
        clock_out_at: { type: 'string', description: 'New clock-out date-time, company time.' },
      },
      required: ['entry_id'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'update_time_entry', args, async () => {
      const entryId = identifiant(args.entry_id, 'entry_id', 'list_time_entries');
      const debutBrut = dateHeureOptionnelle(args.clock_in_at, 'clock_in_at');
      const finBrute = dateHeureOptionnelle(args.clock_out_at, 'clock_out_at');
      if (!debutBrut && !finBrute) throw new Refus('Rien à changer — précise clock_in_at, clock_out_at ou les deux.');
      await exigerAdmin(ctx, 'la correction des feuilles de temps');
      const entree = await entreeDeLOrg(ctx, entryId);
      await refuserSurSoi(ctx, entree.employee_id, 'une correction de feuille de temps');
      const fuseau = await fuseauEntreprise(ctx);

      const nouveauDebut = debutBrut ? versInstant(debutBrut, 'clock_in_at', fuseau) : undefined;
      const nouvelleFin = finBrute ? versInstant(finBrute, 'clock_out_at', fuseau) : undefined;
      const debut = nouveauDebut ?? entree.punch_in_at;
      if (!debut) throw new Refus('Cette entrée n’a pas d’heure d’arrivée exploitable — donne aussi clock_in_at.');
      const fin = nouvelleFin ?? entree.punch_out_at;
      if (nouveauDebut) refuserFutur(nouveauDebut, 'clock_in_at');
      if (nouvelleFin) refuserFutur(nouvelleFin, 'clock_out_at');
      if (fin) {
        const duree = Date.parse(fin) - Date.parse(debut);
        if (duree <= 0) throw new Refus('Le départ doit suivre l’arrivée — vérifie les deux heures (et la date pour un quart de nuit).');
        if (duree > QUART_MAX_MS) throw new Refus('Ce quart ferait plus de 24 heures — vérifie la date des deux heures.');
      }
      const memeInstant = (a: string | undefined, b: string | null) => !a || (!!b && Date.parse(a) === Date.parse(b));
      if (memeInstant(nouveauDebut, entree.punch_in_at) && memeInstant(nouvelleFin, entree.punch_out_at)) {
        throw new Refus('Rien à changer — l’entrée porte déjà ces heures.');
      }

      const charge: Record<string, unknown> = {};
      if (nouveauDebut) {
        charge.punch_in_at = nouveauDebut;
        charge.punch_in = heureLocale(nouveauDebut, fuseau);
        // Le jour ne suit que si la correction change VRAIMENT de journée.
        const jourAvant = entree.punch_in_at ? toLocalDate(entree.punch_in_at, fuseau) : entree.date;
        const jourApres = toLocalDate(nouveauDebut, fuseau);
        if (jourApres !== jourAvant) charge.date = jourApres;
      }
      if (nouvelleFin) {
        charge.punch_out_at = nouvelleFin;
        charge.punch_out = heureLocale(nouvelleFin, fuseau);
        // Une entrée qui reçoit sa sortie est terminée (même état que le bouton « forcer la sortie »).
        if (entree.status !== 'completed') charge.status = 'completed';
        const pauses = fermerPauseOuverte(entree.breaks, nouvelleFin);
        if (pauses) charge.breaks = pauses;
      }

      const avant = bornesLocales(entree, fuseau);
      const heuresAvant = heuresEntree(entree);
      const { data, error } = await ctx.client
        .from('time_entries')
        .update(charge)
        .eq('id', entryId)
        .eq('org_id', ctx.orgId)
        .select('id');
      if (error) throw error;
      exigerLigneTouchee(data, 'La correction');

      const heuresApres = heuresEntree({ punch_in_at: debut, punch_out_at: fin, breaks: (charge.breaks as Pause[] | undefined) ?? entree.breaks });
      const debutLocal = localeIso(debut, fuseau);
      const finLocale = fin ? localeIso(fin, fuseau) : null;
      return {
        updated: true,
        entry_id: entryId,
        user_id: entree.employee_id,
        name: nomEntree(entree),
        clock_in_at: debutLocal,
        clock_out_at: finLocale,
        hours: heuresApres,
        previous: { clock_in_at: avant.debut, clock_out_at: avant.fin, hours: heuresAvant },
        note: `Entrée de ${nomEntree(entree)} corrigée : ${debutLocal.replace('T', ' ')} → ${finLocale ? finLocale.replace('T', ' ') : 'toujours en cours'} (${heuresApres} h, avant ${heuresAvant} h).`
          + (estApprouvee(entree) ? ' Ces heures étaient déjà approuvées.' : ''),
      };
    }),
};

const deleteTimeEntryTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'delete_time_entry',
    description:
      'Permanently delete a time entry (cannot be undone; its hours leave payroll). Admin/owner only, never one\'s own entry. '
      + 'To fix times use update_time_entry instead. Confirm first.',
    parameters: {
      type: 'object',
      properties: { entry_id: { type: 'string', description: 'Time entry id (from list_time_entries).' } },
      required: ['entry_id'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'delete_time_entry', args, async () => {
      const entryId = identifiant(args.entry_id, 'entry_id', 'list_time_entries');
      await exigerAdmin(ctx, 'la suppression d’entrées de temps');
      const entree = await entreeDeLOrg(ctx, entryId);
      await refuserSurSoi(ctx, entree.employee_id, 'une suppression d’entrée de temps');
      const fuseau = await fuseauEntreprise(ctx);

      const { data, error } = await ctx.client
        .from('time_entries')
        .delete()
        .eq('id', entryId)
        .eq('org_id', ctx.orgId)
        .select('id');
      if (error) throw error;
      exigerLigneTouchee(data, 'La suppression');

      const { debut, fin } = bornesLocales(entree, fuseau);
      const h = heuresEntree(entree);
      return {
        deleted: true,
        entry_id: entryId,
        user_id: entree.employee_id,
        name: nomEntree(entree),
        clock_in_at: debut,
        clock_out_at: fin,
        hours: h,
        note: `Entrée de temps de ${nomEntree(entree)} du ${(debut || entree.date).slice(0, 10)} supprimée définitivement (${estOuverte(entree) ? 'pointage encore ouvert' : `${h} h`}) — elle ne se récupère pas.`,
      };
    }),
};

const forcePunchOutTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'force_punch_out',
    description:
      'Close the open time entry of a member who forgot to punch out, at clock_out_at (default: now). Admin/owner only. '
      + 'Give entry_id or user_id. For one\'s own entry use punch_out. Ask the real end time if the shift is long.',
    parameters: {
      type: 'object',
      properties: {
        entry_id: { type: 'string', description: 'Open entry id (from list_time_entries).' },
        user_id: { type: 'string', description: 'Member whose open entry to close (from get_team).' },
        clock_out_at: { type: 'string', description: 'Real clock-out date-time, company time (default: now).' },
      },
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'force_punch_out', args, async () => {
      const entryIdDonne = identifiantOptionnel(args.entry_id, 'entry_id', 'list_time_entries');
      const userId = identifiantOptionnel(args.user_id, 'user_id', 'get_team');
      const finBrute = dateHeureOptionnelle(args.clock_out_at, 'clock_out_at');
      if (!entryIdDonne && !userId) throw new Refus('Précise entry_id ou user_id — de qui faut-il fermer le pointage ?');
      await exigerAdmin(ctx, 'la fermeture du pointage d’un membre');

      let entree: EntreeTemps;
      if (entryIdDonne) {
        entree = await entreeDeLOrg(ctx, entryIdDonne);
        if (userId && entree.employee_id !== userId) throw new Refus('Cette entrée de temps n’appartient pas à ce membre — vérifie avec list_time_entries.');
      } else {
        const membre = await membreDeLOrg(ctx, userId as string); // présent : garanti par le refus ci-dessus
        const { data, error } = await ctx.client
          .from('time_entries')
          .select(COLONNES_ENTREE)
          .eq('org_id', ctx.orgId)
          .eq('employee_id', membre.user_id)
          .is('punch_out', null)
          .order('date', { ascending: false })
          .limit(5);
        if (error) throw error;
        const ouvertes = (data || []) as EntreeTemps[];
        if (!ouvertes.length) throw new Refus(`${nomMembre(membre)} n’a aucun pointage ouvert — rien à fermer.`);
        if (ouvertes.length > 1) {
          throw new Refus(`${nomMembre(membre)} a ${ouvertes.length} pointages ouverts (${ouvertes.map((e) => e.date).join(', ')}) — précise entry_id (list_time_entries avec open_only).`);
        }
        entree = ouvertes[0];
      }
      if (!estOuverte(entree)) throw new Refus('Ce pointage est déjà fermé — pour changer ses heures, utilise update_time_entry.');
      await refuserSurSoi(ctx, entree.employee_id, 'la fermeture forcée de ton pointage');
      const fuseau = await fuseauEntreprise(ctx);

      const fin = finBrute ? versInstant(finBrute, 'clock_out_at', fuseau) : new Date().toISOString();
      if (finBrute) refuserFutur(fin, 'clock_out_at');
      if (entree.punch_in_at && Date.parse(fin) <= Date.parse(entree.punch_in_at)) {
        throw new Refus('Le départ doit suivre l’arrivée — vérifie clock_out_at.');
      }

      // Mêmes colonnes que le bouton de l'écran, plus la pause restée ouverte.
      const charge: Record<string, unknown> = { punch_out: heureLocale(fin, fuseau), punch_out_at: fin, status: 'completed' };
      const pauses = fermerPauseOuverte(entree.breaks, fin);
      if (pauses) charge.breaks = pauses;

      const { data, error } = await ctx.client
        .from('time_entries')
        .update(charge)
        .eq('id', entree.id)
        .eq('org_id', ctx.orgId)
        .is('punch_out', null)
        .select('id');
      if (error) throw error;
      exigerLigneTouchee(data, 'La fermeture du pointage');

      const h = heuresEntree({ punch_in_at: entree.punch_in_at, punch_out_at: fin, breaks: pauses ?? entree.breaks });
      const finLocale = localeIso(fin, fuseau);
      return {
        punched_out: true,
        entry_id: entree.id,
        user_id: entree.employee_id,
        name: nomEntree(entree),
        clock_in_at: bornesLocales(entree, fuseau).debut,
        clock_out_at: finLocale,
        hours: h,
        note: `Pointage de ${nomEntree(entree)} fermé à ${finLocale.replace('T', ' ')} (${h} h).`
          + (pauses ? ' Sa pause restée ouverte a été fermée à la même heure.' : '')
          + (h > QUART_LONG_H ? ` Attention : ${h} h, c’est long — si la vraie fin était plus tôt, corrige avec update_time_entry.` : ''),
      };
    }),
};

// ─────────────────────────────────────────────────────────────────
// COMMISSIONS (routes /commissions/*, celles de la page Commissions)
// ─────────────────────────────────────────────────────────────────

const STATUT_COMMISSION: Record<string, string> = {
  pending: 'en attente', approved: 'approuvée', paid: 'versée', reversed: 'reversée',
};

interface EntreeCommission {
  id: string;
  user_id: string;
  status: string;
  amount: number | string | null;
  invoice_id: string | null;
}

/** La commission DE CETTE ORG, non supprimée — ou un refus lisible. */
async function commissionDeLOrg(ctx: ToolContext, commissionId: string): Promise<EntreeCommission> {
  const { data, error } = await ctx.client
    .from('fs_commission_entries')
    .select('id, user_id, status, amount, invoice_id')
    .eq('org_id', ctx.orgId)
    .eq('id', commissionId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Refus('Cette commission est introuvable dans cette entreprise — retrouve-la avec list_commissions.');
  return data as EntreeCommission;
}

const listCommissionsTool: AgentTool = {
  kind: 'read',
  needsIdentity: true,
  declaration: {
    name: 'list_commissions',
    description:
      'List sales commissions with totals (owed, pending, approved, paid, reversed, estimates), filtered by status, member and period. '
      + 'A non-admin only sees their own.',
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: [...STATUTS_COMMISSION], description: 'Only this status.' },
        user_id: { type: 'string', description: 'Only this member (from get_team).' },
        from: { type: 'string', description: 'Earned from YYYY-MM-DD (with to).' },
        to: { type: 'string', description: 'Earned until YYYY-MM-DD (with from).' },
        limit: { type: 'integer', description: 'Max rows (default 25, max 100).' },
      },
    },
  },
  handler: async (args, ctx) => {
    try {
      const statut = vide(args.status) ? undefined : String(args.status).toLowerCase();
      if (statut && !(STATUTS_COMMISSION as readonly string[]).includes(statut)) throw new Refus('status doit être pending, approved, paid ou reversed.');
      const userId = identifiantOptionnel(args.user_id, 'user_id', 'get_team');
      const from = dateYmdOptionnelle(args.from, 'from');
      const to = dateYmdOptionnelle(args.to, 'to');
      if (!!from !== !!to) throw new Refus('from et to vont ensemble — donne les deux, ou aucun.');
      if (from && to && from > to) throw new Refus('from doit précéder to.');

      const params = new URLSearchParams();
      if (userId) params.set('userId', userId);
      if (statut) params.set('status', statut);
      if (from && to) { params.set('from', from); params.set('to', to); }
      const requete = params.toString();
      const [json, fuseau] = await Promise.all([
        lireRoute(ctx, `/commissions${requete ? `?${requete}` : ''}`, 'la consultation des commissions'),
        fuseauEntreprise(ctx),
      ]);
      const toutes: Array<Record<string, any>> = Array.isArray(json) ? json : [];
      const lignes = toutes.slice(0, entier(args.limit, 25, 100));
      const totaux = totauxCommissions(toutes.map((e) => ({ status: String(e.status), amount: e.amount, invoice_id: e.invoice_id ?? null })));
      const plafonne = toutes.length >= 1000; // plafond de la route (les 1 000 plus récentes)
      return {
        ...(from && to ? { from, to } : {}),
        count: toutes.length,
        returned: lignes.length,
        totals: {
          owed_cents: totaux.du_cents,
          pending_cents: totaux.en_attente_cents,
          approved_cents: totaux.approuve_cents,
          paid_cents: totaux.verse_cents,
          reversed_cents: totaux.repris_cents,
          estimated_cents: totaux.estime_cents,
          sales: totaux.ventes,
        },
        commissions: lignes.map((e) => ({
          id: e.id,
          user_id: e.user_id,
          rep: e.rep_name ?? null,
          statut: e.is_estimate ? 'estimation (job pas encore payé)' : traduireStatut(e.status, STATUT_COMMISSION),
          amount_cents: enCents(e.amount),
          base_amount_cents: enCents(e.base_amount),
          earned_on: toLocalDate(e.triggered_at, fuseau) || null,
          invoice_number: e.invoice_number ?? null,
          job_number: e.job_number ?? null,
          client: e.client_name ?? null,
          plan: e.rule_name ?? null,
          ...(e.paid_at ? { paid_on: toLocalDate(e.paid_at, fuseau) } : {}),
          ...(e.reverse_reason ? { reverse_reason: e.reverse_reason } : {}),
        })),
        note: !toutes.length
          ? 'Aucune commission pour ce filtre.'
          : `${toutes.length} commission(s) : ${enDollars(totaux.du_cents)} dus, dont ${enDollars(totaux.verse_cents)} déjà versés. Les estimations et les reprises ne sont jamais dans le total dû.`
            + (plafonne ? ' Liste et totaux limités aux 1 000 plus récentes — précise une période.' : ''),
      };
    } catch (e) {
      return erreurLecture('list_commissions', e);
    }
  },
};

const approveCommissionTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'approve_commission',
    description:
      'Approve ONE pending commission (earned on a paid invoice; estimates cannot be approved). Admin/owner only, never one\'s own. '
      + 'Get commission_id from list_commissions. Confirm first.',
    parameters: {
      type: 'object',
      properties: { commission_id: { type: 'string', description: 'Commission id.' } },
      required: ['commission_id'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'approve_commission', args, async () => {
      const commissionId = identifiant(args.commission_id, 'commission_id', 'list_commissions');
      const commission = await commissionDeLOrg(ctx, commissionId);
      await refuserSurSoi(ctx, commission.user_id, 'l’approbation de ta propre commission');
      if (commission.status !== 'pending') {
        throw new Refus(`Cette commission est ${traduireStatut(commission.status, STATUT_COMMISSION)} — seule une commission en attente s’approuve.`);
      }
      if (!commission.invoice_id) {
        throw new Refus('C’est une estimation (le job n’est pas encore payé) : elle ne s’approuve pas tant que la facture n’est pas encaissée.');
      }
      const nom = (await nomsDesMembres(ctx, [commission.user_id])).get(commission.user_id) || 'ce membre';
      const contexte = `l'approbation de la commission de ${nom}`;
      const r = await viaRoute(ctx, `/commissions/${commissionId}/approve`, {}, contexte);
      if (!r.ok) return resultatIncertain(contexte);
      const montant = enCents(r.json.amount ?? commission.amount);
      return {
        approved: true,
        commission_id: commissionId,
        user_id: commission.user_id,
        name: nom,
        amount_cents: montant,
        note: `Commission de ${nom} approuvée (${enDollars(montant)}) — elle reste à verser : mark_commission_paid, ou la paie de la période.`,
      };
    }),
};

const markCommissionPaidTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'mark_commission_paid',
    description:
      'Mark ONE approved commission as paid. Admin/owner only, never one\'s own. Refused if its pay period is already paid. '
      + 'To pay a whole period use mark_payroll_period_paid. Confirm first.',
    parameters: {
      type: 'object',
      properties: { commission_id: { type: 'string', description: 'Commission id (from list_commissions).' } },
      required: ['commission_id'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'mark_commission_paid', args, async () => {
      const commissionId = identifiant(args.commission_id, 'commission_id', 'list_commissions');
      const commission = await commissionDeLOrg(ctx, commissionId);
      await refuserSurSoi(ctx, commission.user_id, 'le versement de ta propre commission');
      if (commission.status === 'pending') {
        throw new Refus('Cette commission est encore en attente — approuve-la d’abord (approve_commission), puis verse-la.');
      }
      if (commission.status !== 'approved') {
        throw new Refus(`Cette commission est ${traduireStatut(commission.status, STATUT_COMMISSION)} — seule une commission approuvée se verse.`);
      }
      const nom = (await nomsDesMembres(ctx, [commission.user_id])).get(commission.user_id) || 'ce membre';
      const contexte = `le versement de la commission de ${nom}`;
      const r = await viaRoute(ctx, `/commissions/${commissionId}/mark-paid`, {}, contexte);
      if (!r.ok) return resultatIncertain(contexte);
      const montant = enCents(r.json.amount ?? commission.amount);
      return {
        paid: true,
        commission_id: commissionId,
        user_id: commission.user_id,
        name: nom,
        amount_cents: montant,
        paid_at: r.json.paid_at ?? null,
        note: `Commission de ${nom} marquée versée (${enDollars(montant)}). Une erreur se défait dans Lume › Commissions (« Annuler le versement »).`,
      };
    }),
};

// ─────────────────────────────────────────────────────────────────
// HORAIRE D'ÉQUIPE — qui travaille, qui est absent (teamScheduleApi)
// ─────────────────────────────────────────────────────────────────

const JOURS_FR = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const TYPE_CONGE: Record<string, string> = {
  time_off: 'congé', vacation: 'vacances', sick: 'maladie', absence: 'absence', unavailable: 'indisponible', other: 'autre',
};

interface Assignation {
  id: string; team_id: string; user_id: string; start_time: string; end_time: string;
  availability_status: 'available' | 'unavailable' | 'removed'; note: string | null; recurring_schedule_id: string | null;
}
interface Recurrence {
  id: string; team_id: string; user_id: string; day_of_week: number; start_time: string; end_time: string;
  effective_start_date: string; effective_end_date: string | null;
}
interface Conge {
  id: string; user_id: string; start_date: string; end_date: string; all_day: boolean;
  start_time: string | null; end_time: string | null; kind: string; status: string; reason: string | null;
}
interface PresenceJour {
  user_id: string; team_id: string; start_time: string; end_time: string;
  status: 'available' | 'partial' | 'unavailable' | 'time_off';
  note: string | null; conge: Conge | null; demande: Conge | null;
}

const hhmm = (t: string | null | undefined) => (t || '').slice(0, 5);
const enMinutes = (t: string | null | undefined) => { const [h, m] = hhmm(t).split(':').map(Number); return (h || 0) * 60 + (m || 0); };
const enHeure = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const chevauche = (aDebut: number, aFin: number, bDebut: number, bFin: number) => aDebut < bFin && aFin > bDebut;

/**
 * Composition des équipes pour UNE date — même ordre de priorité que
 * `resolveDay` (src/lib/teamScheduleApi.ts, non importable côté serveur : il
 * charge le client du navigateur) : congé approuvé > assignation du jour >
 * récurrence hebdomadaire. Une ligne `removed` masque l'occurrence récurrente.
 */
function resoudreJour(assignations: Assignation[], recurrences: Recurrence[], conges: Conge[]): PresenceJour[] {
  const posees = assignations.filter((a) => a.availability_status !== 'removed');
  const retirees = assignations.filter((a) => a.availability_status === 'removed');
  const recurrencesRetirees = new Set(retirees.map((r) => r.recurring_schedule_id).filter(Boolean));
  const couplesRetires = new Set(retirees.filter((r) => !r.recurring_schedule_id).map((r) => `${r.user_id}|${r.team_id}`));

  const presences: PresenceJour[] = posees.map((a) => ({
    user_id: a.user_id, team_id: a.team_id, start_time: hhmm(a.start_time), end_time: hhmm(a.end_time),
    status: a.availability_status === 'unavailable' ? 'unavailable' : 'available',
    note: a.note, conge: null, demande: null,
  }));

  for (const r of recurrences) {
    if (recurrencesRetirees.has(r.id) || couplesRetires.has(`${r.user_id}|${r.team_id}`)) continue;
    const [debut, fin] = [enMinutes(r.start_time), enMinutes(r.end_time)];
    // Même équipe : la ligne du jour remplace l'occurrence ; autre équipe : seulement si les plages se chevauchent.
    const recouverte = posees.some((m) => m.user_id === r.user_id
      && (m.team_id === r.team_id || chevauche(enMinutes(m.start_time), enMinutes(m.end_time), debut, fin)));
    if (recouverte) continue;
    presences.push({
      user_id: r.user_id, team_id: r.team_id, start_time: hhmm(r.start_time), end_time: hhmm(r.end_time),
      status: 'available', note: null, conge: null, demande: null,
    });
  }

  for (const p of presences) {
    for (const c of conges.filter((x) => x.user_id === p.user_id)) {
      if (c.status === 'pending') { p.demande = p.demande || c; continue; }
      const fenetre = c.all_day || !c.start_time || !c.end_time ? null : { debut: enMinutes(c.start_time), fin: enMinutes(c.end_time) };
      const [debut, fin] = [enMinutes(p.start_time), enMinutes(p.end_time)];
      if (!fenetre || (fenetre.debut <= debut && fenetre.fin >= fin)) {
        p.status = 'time_off';
        p.conge = c;
      } else if (chevauche(fenetre.debut, fenetre.fin, debut, fin)) {
        // Congé partiel : on garde le plus grand segment restant.
        if (Math.max(0, fin - fenetre.fin) >= Math.max(0, fenetre.debut - debut)) p.start_time = enHeure(Math.max(debut, fenetre.fin));
        else p.end_time = enHeure(Math.min(fin, fenetre.debut));
        p.status = 'partial';
        p.conge = c;
      }
    }
  }
  return presences.sort((a, b) => a.start_time.localeCompare(b.start_time) || a.user_id.localeCompare(b.user_id));
}

const getTeamScheduleTool: AgentTool = {
  kind: 'read',
  needsIdentity: true,
  declaration: {
    name: 'get_team_schedule',
    description:
      'Who is scheduled to work on a given day (team, hours) and who is off (approved time off, leave, pending requests). '
      + 'Staff roster, not job visits (→ query_schedule).',
    parameters: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'Day YYYY-MM-DD (default: today).' },
        team_id: { type: 'string', description: 'Only this team (from list_teams).' },
      },
    },
  },
  handler: async (args, ctx) => {
    try {
      const dateDonnee = dateYmdOptionnelle(args.date, 'date');
      const teamId = identifiantOptionnel(args.team_id, 'team_id', 'list_teams');
      const [date, role] = await Promise.all([
        dateDonnee ? Promise.resolve(dateDonnee) : fuseauEntreprise(ctx).then((tz) => toLocalDate(new Date(), tz)),
        roleDuDemandeur(ctx),
      ]);
      const jourSemaine = new Date(`${date}T00:00:00Z`).getUTCDay();

      const [a, r, c, t] = await Promise.all([
        ctx.client
          .from('team_schedule_assignments')
          .select('id, team_id, user_id, start_time, end_time, availability_status, note, recurring_schedule_id')
          .eq('org_id', ctx.orgId)
          .eq('work_date', date)
          .limit(1000),
        ctx.client
          .from('recurring_team_schedules')
          .select('id, team_id, user_id, day_of_week, start_time, end_time, effective_start_date, effective_end_date')
          .eq('org_id', ctx.orgId)
          .eq('is_active', true)
          .eq('day_of_week', jourSemaine)
          .lte('effective_start_date', date)
          .limit(1000),
        ctx.client
          .from('time_off_requests')
          .select('id, user_id, start_date, end_date, all_day, start_time, end_time, kind, status, reason')
          .eq('org_id', ctx.orgId)
          .in('status', ['pending', 'approved'])
          .lte('start_date', date)
          .gte('end_date', date)
          .limit(500),
        ctx.client
          .from('teams')
          .select('id, name')
          .eq('org_id', ctx.orgId)
          .is('deleted_at', null)
          .limit(200),
      ]);
      for (const res of [a, r, c, t]) if (res.error) throw res.error;

      const equipes = new Map(((t.data || []) as Array<{ id: string; name: string }>).map((e) => [e.id, e.name]));
      if (teamId && !equipes.has(teamId)) throw new Refus('Équipe introuvable dans cette entreprise — vérifie avec list_teams.');
      const recurrences = ((r.data || []) as Recurrence[]).filter((x) => !x.effective_end_date || x.effective_end_date >= date);
      const conges = (c.data || []) as Conge[];
      const toutes = resoudreJour((a.data || []) as Assignation[], recurrences, conges);
      const presences = teamId ? toutes.filter((p) => p.team_id === teamId) : toutes;
      const concernes = new Set(presences.map((p) => p.user_id));
      // Avec une équipe : seuls les congés de ses membres prévus ce jour-là. Sans : tous.
      const congesVus = teamId ? conges.filter((x) => concernes.has(x.user_id)) : conges;

      const noms = await nomsDesMembres(ctx, [...concernes, ...congesVus.map((x) => x.user_id)]);
      const nom = (id: string) => noms.get(id) || 'membre sans nom';
      // Le motif d'une absence (maladie…) ne regarde que les gestionnaires.
      const voitMotifs = estGestionnaire(role);
      const plage = (x: Conge) => (x.all_day || !x.start_time || !x.end_time ? {} : { start_time: hhmm(x.start_time), end_time: hhmm(x.end_time) });

      const auTravail = presences.filter((p) => p.status === 'available' || p.status === 'partial').map((p) => ({
        user_id: p.user_id,
        name: nom(p.user_id),
        team_id: p.team_id,
        team: equipes.get(p.team_id) || null,
        start_time: p.start_time,
        end_time: p.end_time,
        ...(p.status === 'partial' ? { partial_time_off: true } : {}),
        ...(p.demande ? { pending_time_off: true } : {}),
        ...(p.note ? { note: p.note } : {}),
      }));
      const approuves = congesVus.filter((x) => x.status === 'approved');
      const enConge = new Set(approuves.map((x) => x.user_id));
      const absents = [
        ...approuves.map((x) => ({
          user_id: x.user_id,
          name: nom(x.user_id),
          type: TYPE_CONGE[x.kind] || x.kind,
          all_day: x.all_day,
          ...plage(x),
          from: x.start_date,
          to: x.end_date,
          ...(voitMotifs && x.reason ? { reason: x.reason } : {}),
        })),
        // Marqué « indisponible » à la main dans la grille, sans congé approuvé.
        ...presences.filter((p) => p.status === 'unavailable' && !enConge.has(p.user_id)).map((p) => ({
          user_id: p.user_id,
          name: nom(p.user_id),
          type: 'indisponible',
          all_day: true,
          from: date,
          to: date,
          ...(p.note ? { note: p.note } : {}),
        })),
      ];
      const demandes = congesVus.filter((x) => x.status === 'pending').map((x) => ({
        user_id: x.user_id, name: nom(x.user_id), type: TYPE_CONGE[x.kind] || x.kind, all_day: x.all_day, ...plage(x), from: x.start_date, to: x.end_date,
      }));

      const jour = `${JOURS_FR[jourSemaine]} ${date}`;
      return {
        date,
        jour: JOURS_FR[jourSemaine],
        ...(teamId ? { team: equipes.get(teamId) } : {}),
        working_count: new Set(auTravail.map((p) => p.user_id)).size,
        working: auTravail,
        off: absents,
        pending_requests: demandes,
        note: !auTravail.length && !absents.length && !demandes.length
          ? `Aucun horaire d’équipe ni congé posé pour le ${jour} (Lume › Feuilles de temps › Horaire).`
          : `Le ${jour} : ${new Set(auTravail.map((p) => p.user_id)).size} personne(s) à l’horaire, ${new Set(absents.map((x) => x.user_id)).size} absente(s)${demandes.length ? `, ${demandes.length} demande(s) de congé en attente` : ''}.`,
      };
    } catch (e) {
      return erreurLecture('get_team_schedule', e);
    }
  },
};

// ─────────────────────────────────────────────────────────────────
// Exports — à brancher dans outils-domaines.ts (MODULES).
// ─────────────────────────────────────────────────────────────────

export const OUTILS_LOT_PAIE: AgentTool[] = [
  // paie
  getPayrollAmountsTool,
  getPayrollHistoryTool,
  // feuilles de temps
  listTimeEntriesTool,
  updateTimeEntryTool,
  deleteTimeEntryTool,
  forcePunchOutTool,
  // commissions
  listCommissionsTool,
  approveCommissionTool,
  markCommissionPaidTool,
  // horaire d'équipe
  getTeamScheduleTool,
];

/** Attributs des ÉCRITURES (mêmes sens que registre.ts : sensible / réversible / vers le client). */
export const REGISTRE_LOT_PAIE: Record<string, { sensible: boolean; reversible: boolean; vers_client: boolean }> = {
  update_time_entry:    { sensible: true, reversible: true,  vers_client: false }, // se recorrige (l'ancienne valeur est dans le résultat)
  delete_time_entry:    { sensible: true, reversible: false, vers_client: false }, // pas de deleted_at : définitif
  force_punch_out:      { sensible: true, reversible: false, vers_client: false }, // un pointage fermé ne se rouvre pas
  approve_commission:   { sensible: true, reversible: false, vers_client: false }, // aucune route pour désapprouver
  mark_commission_paid: { sensible: true, reversible: true,  vers_client: false }, // « Annuler le versement » existe à l'écran
};

/**
 * Permission de la page Rôles exigée par chaque outil. Les routes de paie et
 * de commissions exigent le RÔLE admin/propriétaire (pas une clé) : la clé
 * ci-dessous écarte les autres rôles avant l'appel, la route garde le dernier mot.
 */
export const PERMISSIONS_LOT_PAIE: Record<string, { cle: PermissionKey; capacite: string }> = {
  get_payroll_amounts:  { cle: 'financial.view_reports', capacite: 'la paie' },
  get_payroll_history:  { cle: 'financial.view_reports', capacite: 'la paie' },
  list_time_entries:    { cle: 'timesheets.read',        capacite: 'la consultation des feuilles de temps' },
  update_time_entry:    { cle: 'timesheets.update',      capacite: 'la correction des feuilles de temps' },
  delete_time_entry:    { cle: 'timesheets.update',      capacite: "la suppression d'entrées de temps" },
  force_punch_out:      { cle: 'timesheets.update',      capacite: "la fermeture du pointage d'un membre" },
  list_commissions:     { cle: 'commissions.read',       capacite: 'la consultation des commissions' },
  approve_commission:   { cle: 'financial.view_reports', capacite: "l'approbation des commissions" },
  mark_commission_paid: { cle: 'financial.view_reports', capacite: 'le versement des commissions' },
  get_team_schedule:    { cle: 'timesheets.read',        capacite: "la consultation de l'horaire d'équipe" },
};

/** Topic « equipe » du routeur : tous les outils de ce module. */
export const TOPICS_LOT_PAIE: Partial<Record<IdTopic, string[]>> = {
  equipe: OUTILS_LOT_PAIE.map((t) => t.declaration.name),
};
