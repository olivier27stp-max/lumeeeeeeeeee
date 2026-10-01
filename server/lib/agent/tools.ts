/* ═══════════════════════════════════════════════════════════════
   Lume Agent — Tool registry
   ─────────────────────────────────────────────────────────────
   READ tools run server-side against the caller's RLS-scoped
   Supabase client (org isolation enforced by RLS + explicit org_id).
   WRITE tools are NEVER executed here: calling one produces a
   *proposal* that is surfaced to the user for confirmation. The
   actual mutation runs client-side via the existing *Api.ts helpers
   only after the user clicks "Confirm".
   ═══════════════════════════════════════════════════════════════ */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { FunctionDeclaration } from './gemini';
import {
  OUTILS_LECTURE_ETENDUS, OUTILS_ECRITURE_ETENDUS, ETIQUETTES_DERIVED,
  handlerCreateQuote, handlerCreateInvoice, handlerCreateJob, handlerSendSms,
  STATUT_DEVIS, STATUT_FACTURE, STATUT_LEAD, STATUT_CLIENT, traduireStatut, bornesJourOrg, dateOrgAujourdhui,
} from './tools-etendus';

const PERIODES_REVENUS = ['this_month', 'last_month', 'this_year', 'last_year', 'last_30_days'] as const;

/**
 * Bornes d'une période de revenus, en jours de l'ENTREPRISE (audit 2026-09-30).
 * Avant : « le mois passé » n'existait pas (réponse = mois courant) et les
 * bornes étaient calculées en UTC (le soir du 31, on était déjà le mois suivant).
 */
export function bornesPeriodeRevenus(period: string, du?: string, au?: string, aujourdhui: string = dateOrgAujourdhui()): { period: string; from: string; to: string } {
  const jour = /^\d{4}-\d{2}-\d{2}$/;
  if (du && au && jour.test(du) && jour.test(au)) return { period: 'custom', from: du <= au ? du : au, to: du <= au ? au : du };
  const [a, m, j] = aujourdhui.split('-').map(Number);
  const ymd = (d: Date) => d.toISOString().slice(0, 10);
  const utc = (an: number, mois: number, jr: number) => new Date(Date.UTC(an, mois, jr));
  switch (period) {
    case 'last_month': return { period, from: ymd(utc(a, m - 2, 1)), to: ymd(utc(a, m - 1, 0)) };
    case 'this_year': return { period, from: `${a}-01-01`, to: `${a}-12-31` };
    case 'last_year': return { period, from: `${a - 1}-01-01`, to: `${a - 1}-12-31` };
    case 'last_30_days': return { period, from: ymd(utc(a, m - 1, j - 29)), to: aujourdhui };
    default: return { period: 'this_month', from: ymd(utc(a, m - 1, 1)), to: ymd(utc(a, m, 0)) };
  }
}
import { OUTILS_RAPPORTS } from './tools-rapports';
import { jourLocal } from '../dates-locales';

const FUSEAU_ORG = 'America/Montreal';
/** « 2026-02-28 » : dernier jour du mois d'un « YYYY-MM-DD ». */
function dernierJourDuMois(jour: string): string {
  const [y, m] = jour.split('-').map(Number);
  return `${jour.slice(0, 7)}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
}
import { searchHelp } from './tools-aide';
import { OUTILS_DOMAINES } from './outils-domaines';

export interface ToolContext {
  client: SupabaseClient;
  orgId: string;
  userId: string;
  /**
   * Jeton d'accès Supabase de l'utilisateur (session OAuth rejouée).
   * Présent uniquement sur le chemin MCP à identité ; permet aux outils
   * d'appeler les ROUTES de l'application en son nom (envoi de devis,
   * de facture) au lieu de dupliquer leur logique.
   */
  accessToken?: string;
  /**
   * Mode à blanc (R12) : même chemin, mêmes gardes, mêmes validations, mais
   * aucune écriture — executerIdempotent renvoie ce qui AURAIT été fait sans
   * poser d'empreinte ni appeler l'action. Les lectures restent réelles.
   */
  dryRun?: boolean;
}

export type ToolKind = 'read' | 'write';

export interface AgentTool {
  declaration: FunctionDeclaration;
  kind: ToolKind;
  /**
   * Exécute l'outil. Présent sur les lectures ET, depuis l'ouverture des
   * écritures MCP, sur les écritures. L'orchestrateur interne (Gemini)
   * n'exécute JAMAIS un outil `write` — il propose et l'utilisateur
   * confirme dans l'interface (voir orchestrator.ts, test sur `kind`).
   * Seul le serveur MCP exécute les handlers d'écriture, sous scope
   * `mcp:write` + identité obligatoire.
   */
  handler?: (args: Record<string, any>, ctx: ToolContext) => Promise<any>;
  /**
   * Exige le client Supabase à l'identité de l'utilisateur (session OAuth).
   * JAMAIS de repli sur le service client : pour la paie, les finances, le
   * GPS ou toute écriture, un repli contournerait les permissions par rôle.
   */
  needsIdentity?: boolean;
  /**
   * Réservé à un canal : 'lumi' = l'assistant dans l'application (l'outil
   * a besoin de l'interface pour montrer son résultat, ex. un rapport PDF).
   * Absent = tous les canaux (MCP inclus).
   */
  canal?: 'lumi';
}

const clamp = (n: any, def: number, max: number) => {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return def;
  return Math.min(Math.floor(v), max);
};

const fullName = (r: any) => `${r.first_name || ''} ${r.last_name || ''}`.trim();

// Never surface raw DB/Postgres error text to the model (it can leak table
// names, column names, and RLS policy details). Log server-side, return generic.
function toolError(scope: string, err: any): { error: string } {
  console.error(`[agent-tool:${scope}]`, err?.message || err);
  // Message pour le MODÈLE : quoi raconter, en langage d'exploitant —
  // jamais « That lookup could not be completed », qui ne disait rien.
  return { error: 'La consultation a échoué côté Lume. Dis-le simplement à l\u2019utilisateur, propose de réessayer, et s\u2019il y a un doute sur la connexion, suggère de reconnecter Lume dans les réglages de Claude.' };
}

// ─────────────────────────────────────────────────────────────────
// READ TOOLS
// ─────────────────────────────────────────────────────────────────

/**
 * Somme d'une colonne en cents, calculée ICI et renvoyée au modèle : un LLM
 * additionne mal de tête (constaté : 1 626,90 + 172,46 + 172,46 rendu
 * « 2 071,82 »). Un total fourni par l'outil n'est jamais recalculé.
 */
function somme(rows: any[] | null | undefined, champ: string): number {
  return (rows || []).reduce((acc, r) => acc + (Number(r?.[champ]) || 0), 0);
}

/**
 * En-tête de tout résultat de liste plafonnée : le total EXACT en base
 * (count: 'exact') avant les lignes. Quand la liste est tronquée, une note
 * explicite le dit — sans elle, le modèle répondait « 20 clients » en lisant
 * le nombre de lignes renvoyées alors que l'org en avait 21.
 */
function enTeteListe(count: number | null | undefined, rows: any[] | null | undefined): {
  total_matching: number; shown: number; note?: string;
} {
  const shown = rows?.length || 0;
  const total = count ?? shown;
  return total > shown
    ? { total_matching: total, shown, note: `Only ${shown} of ${total} are listed below. The exact total is ${total}.` }
    : { total_matching: total, shown };
}

const searchClients: AgentTool = {
  kind: 'read',
  declaration: {
    name: 'search_clients',
    description:
      'Search clients by name, company, email, phone, city or tag. Returns total_matching (exact count) and the matching clients with id, contact info and city.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search text. Omit it to count ALL clients (any text filters).' },
        tag: { type: 'string', description: 'Only clients having this tag (see list_client_tags).' },
        limit: { type: 'integer', description: 'Max results (default 10, max 25).' },
      },
    },
  },
  handler: async (args, ctx) => {
    const limit = clamp(args.limit, 10, 25);
    const etiquette = String(args.tag || '').trim();
    let q = ctx.client
      .from('clients')
      // `count: 'exact'` : le total RÉEL voyage avec les lignes plafonnées.
      // Sans lui, « combien de clients j'ai ? » recevait 25 fiches et
      // l'assistant répondait « au moins 25, probablement plus » — faux et
      // cher (25 fiches renvoyées au modèle pour un chiffre).
      // Étiquette : jointure INTERNE sur client_tags — seuls les clients qui la portent reviennent.
      .select(etiquette
        ? 'id, first_name, last_name, company, email, phone, address, city, status, client_tags!inner(tag)'
        : 'id, first_name, last_name, company, email, phone, address, city, status', { count: 'exact' })
      .eq('org_id', ctx.orgId)
      .is('deleted_at', null)
      .limit(limit);
    if (etiquette) q = q.ilike('client_tags.tag', etiquette.replace(/[\\%_]/g, (c) => `\\${c}`));
    const term = String(args.query || '').trim();
    if (term) {
      // Multi-tokens : « Marie Tremblay » cherchait cette chaîne ENTIÈRE dans
      // first_name seul → 0 résultat. On découpe en mots et on exige que
      // CHAQUE mot apparaisse quelque part (prénom, nom, compagnie…). Ainsi
      // « Marie Tremblay » = (Marie dans un champ) ET (Tremblay dans un champ).
      const mots = term.replace(/[%,()]/g, ' ').split(/\s+/).filter(Boolean).slice(0, 5);
      for (const mot of mots) {
        q = q.or(
          `first_name.ilike.%${mot}%,last_name.ilike.%${mot}%,company.ilike.%${mot}%,email.ilike.%${mot}%,phone.ilike.%${mot}%,city.ilike.%${mot}%,address.ilike.%${mot}%`,
        );
      }
    }
    const { data, error, count } = await q;
    if (error) return toolError('db', error);
    // La sélection dépend du filtre d'étiquette : le typage de supabase-js ne
    // suit pas une sélection conditionnelle, d'où la forme écrite ici.
    const lignes = (data ?? []) as unknown as Array<{
      id: string; first_name: string | null; last_name: string | null; company: string | null;
      email: string | null; phone: string | null; address: string | null; city: string | null; status: string | null;
    }>;
    return {
      ...enTeteListe(count, lignes),
      // Audit 2026-09-30 : 0 résultat ne veut pas dire « n'existe pas » — la recherche
      // porte sur le bureau actif seulement. Sans cette note, Lumi retirait des mots
      // (« de Lévis ») et agissait sur un homonyme d'un autre endroit.
      ...(term && !lignes.length ? { note: 'Aucun client ne correspond dans ce bureau (le bureau actif seulement). N’enlève pas de mots pour trouver quelqu’un d’autre : demande à l’utilisateur (orthographe, autre bureau).' } : {}),
      clients: lignes.map((c) => ({
        id: c.id, // interne : pour create_job / create_quote / get_client_profile…
        name: fullName(c),
        company: c.company,
        email: c.email,
        phone: c.phone,
        city: c.city,
        address: c.address,
        statut: traduireStatut(c.status, STATUT_CLIENT),
      })),
    };
  },
};

const searchLeads: AgentTool = {
  kind: 'read',
  declaration: {
    name: 'search_leads',
    description: 'Search leads (prospects) by name, company, email or phone. Returns total_matching (exact count) and the matching leads with id and status. Create, edit, move in the pipeline, delete, convert → create_lead, update_lead, update_lead_status, delete_lead, convert_lead_to_client, convert_lead_to_job. The pipeline BOARD (deal cards, stages, values) → list_deals, update_deal_stage, delete_deal.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search text. Omit it to count ALL leads (any text filters).' },
        limit: { type: 'integer', description: 'Max results (default 10, max 25).' },
      },
    },
  },
  handler: async (args, ctx) => {
    const limit = clamp(args.limit, 10, 25);
    let q = ctx.client
      .from('clients')
      .select('id, first_name, last_name, company, email, phone, status:lead_status, value, address', { count: 'exact' })
      .eq('status', 'lead')
      .is('deleted_at', null)
      .eq('org_id', ctx.orgId)
      .limit(limit);
    const term = String(args.query || '').trim();
    if (term) {
      const t = term.replace(/[%,()]/g, ' ');
      // « Julie Fortin » cherché d'un bloc dans first_name OU last_name → 0 résultat
      // (batterie d'exécution du 2026-09-17). Même découpage que search_clients :
      // chaque mot doit se trouver dans un des champs.
      const mots = t.replace(/[%,()]/g, ' ').split(/\s+/).filter(Boolean).slice(0, 5);
      for (const mot of mots) q = q.or(
        `first_name.ilike.%${mot}%,last_name.ilike.%${mot}%,company.ilike.%${mot}%,email.ilike.%${mot}%,phone.ilike.%${mot}%`,
      );
    }
    const { data, error, count } = await q;
    if (error) return toolError('db', error);
    return {
      ...enTeteListe(count, data),
      leads: (data || []).map((l) => ({
        id: l.id,
        name: fullName(l),
        company: l.company,
        email: l.email,
        phone: l.phone,
        statut: traduireStatut(l.status, STATUT_LEAD),
        value: l.value,
        address: l.address,
      })),
    };
  },
};

// Le statut que l'utilisateur VOIT dans Lume n'est pas `jobs.status` mais
// `jobs_active.derived_status` : un état calculé par la vue (migration
// 20260714000000) qui tient compte de l'avancement des visites. Un job
// `scheduled` dont la date est passée s'affiche « Late » dans l'application.
//
// Sans cette correspondance, l'agent et l'interface parlaient deux langues :
// on demandait « mes jobs en retard », l'agent ne connaissait que
// `scheduled`/`completed` et devait deviner en comparant des dates.


/** Accepte aussi bien le vocabulaire de l'interface que le statut brut. */
function normaliserStatutJob(valeur: string): { champ: 'derived_status' | 'status'; valeur: string } {
  const v = valeur.trim().toLowerCase().replace(/[\s-]+/g, '_');
  const alias: Record<string, string> = {
    late: 'late', overdue: 'late', en_retard: 'late', retard: 'late',
    upcoming: 'upcoming', a_venir: 'upcoming', prochain: 'upcoming', prochains: 'upcoming',
    action_required: 'action_required', action: 'action_required',
    requires_invoicing: 'requires_invoicing', a_facturer: 'requires_invoicing',
    archived: 'archived', archive: 'archived', archives: 'archived',
  };
  if (alias[v]) return { champ: 'derived_status', valeur: alias[v] };
  return { champ: 'status', valeur: v };
}

const listJobs: AgentTool = {
  kind: 'read',
  declaration: {
    name: 'list_jobs',
    description:
      'List jobs, optionally filtered by status or a search term. Returns number, title, client, address, schedule, total and the on-screen "statut" (use it as-is).',
    parameters: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          description:
            "Optional filter. Accepts what the user sees ('late', 'upcoming', 'action_required', "
            + "'requires_invoicing', 'archived') or a raw status ('scheduled', 'completed', 'draft', 'in_progress').",
        },
        query: { type: 'string', description: 'Search text (number, title, address, client). Omit it to count ALL jobs.' },
        limit: { type: 'integer', description: 'Max results (default 15, max 30).' },
      },
    },
  },
  handler: async (args, ctx) => {
    const limit = clamp(args.limit, 15, 30);
    // `count: 'exact'` : le total RÉEL voyage avec les lignes plafonnées.
    // Sans lui, l'assistant disait « 15 affichés, il y en a peut-être plus »
    // alors que l'utilisateur en avait 22 — un chiffre qu'il ne pouvait pas
    // donner. Un agent qui ne peut pas compter n'inspire pas confiance.
    let q = ctx.client
      .from('jobs_active')
      .select('id, job_number, title, client_name, property_address, scheduled_at, end_at, status, derived_status, total_cents, currency', { count: 'exact' })
      .eq('org_id', ctx.orgId)
      .order('scheduled_at', { ascending: false, nullsFirst: false })
      .limit(limit);
    if (args.status) {
      const { champ, valeur } = normaliserStatutJob(String(args.status));
      q = q.eq(champ, valeur);
    }
    const term = String(args.query || '').trim();
    if (term) {
      const t = term.replace(/[%,()]/g, ' ');
      q = q.or(`job_number.ilike.%${t}%,title.ilike.%${t}%,property_address.ilike.%${t}%,client_name.ilike.%${t}%`);
    }
    const { data, error, count } = await q;
    if (error) return toolError('db', error);
    return {
      ...enTeteListe(count, data),
      sum_total_cents_of_returned: somme(data, 'total_cents'),
      jobs: (data || []).map((j: any) => ({
        id: j.id, // interne : pour get_job / update_job / reschedule_job…
        job_number: j.job_number,
        title: j.title,
        client: j.client_name,
        address: j.property_address,
        date: j.scheduled_at,
        // Statut EN FRANÇAIS, lisible. On ne renvoie plus le statut brut
        // (raw_status) : c'était du vocabulaire db que l'agent finissait par
        // répéter (« ce job est scheduled »).
        statut: ETIQUETTES_DERIVED[j.derived_status] || ETIQUETTES_DERIVED[j.status] || j.derived_status || j.status,
        total_cents: j.total_cents,
      })),
    };
  },
};

const getJob: AgentTool = {
  kind: 'read',
  declaration: {
    name: 'get_job',
    description: 'Get the full details of a single job (with its visits and their visit_id) by its id OR its displayed number (« job 26 »).',
    parameters: {
      type: 'object',
      properties: { job_id: { type: 'string', description: 'The job id, or the job number shown in Lume.' } },
      required: ['job_id'],
    },
  },
  handler: async (args, ctx) => {
    // Un NUMÉRO de job (« la job 26 ») n'est pas un identifiant : la requête par
    // id échouait (uuid invalide) et Lumi répondait « souci de connexion à Lume »
    // (éval des outils, 2026-09-30). On cherche alors par numéro affiché.
    const cle = String(args.job_id ?? '').trim().replace(/^#/, '');
    const parNumero = !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cle);
    const { data, error } = await ctx.client
      .from('jobs_active')
      .select('id, job_number, title, description, client_name, client_id, property_address, scheduled_at, end_at, status, derived_status, total_cents, subtotal_cents, tax_cents, tax_lines, currency, job_type, requires_invoicing, notes')
      .eq('org_id', ctx.orgId)
      .eq(parNumero ? 'job_number' : 'id', cle)
      .limit(1)
      .maybeSingle();
    if (error) return toolError('db', error);
    let job: any = data;
    if (!job && parNumero && /^\d+$/.test(cle)) {
      // Numéro avec préfixe de bureau (« MTL-26 ») : on accepte une fin de numéro UNIQUE.
      const { data: proches } = await ctx.client.from('jobs_active').select('id').eq('org_id', ctx.orgId).ilike('job_number', `%-${cle}`).limit(2);
      if ((proches ?? []).length === 1) {
        const { data: j2 } = await ctx.client.from('jobs_active')
          .select('id, job_number, title, description, client_name, client_id, property_address, scheduled_at, end_at, status, derived_status, total_cents, subtotal_cents, tax_cents, tax_lines, currency, job_type, requires_invoicing, notes')
          .eq('org_id', ctx.orgId).eq('id', (proches as any[])[0].id).maybeSingle();
        job = j2;
      }
    }
    // `introuvable`, pas `error` : le job n'existe pas, ce n'est PAS une panne.
    // Avec `error`, Lumi répondait « la consultation a échoué côté Lume »
    // (mesuré le 2026-09-22 sur le job 33, qui n'existe simplement pas) — le
    // client croit à un bug et le signale, alors que tout fonctionne.
    if (!job) return { introuvable: true, message: "Aucun job avec ce numéro ou cet identifiant dans cette entreprise (il a peut-être été supprimé). Vérifie le numéro avec l'utilisateur, ou cherche-le avec list_jobs." };
    // Le job complet inclut ses lignes d'items — sans elles, « c'est quoi le
    // détail du job » ne sait répondre que le total.
    // Les visites du job avec leur identifiant : « facture la visite d'hier »
    // (create_invoice_for_visit) n'avait aucun moyen de le trouver.
    const { data: visites } = await ctx.client
      .from('schedule_events')
      .select('id, start_at, end_at, status')
      .eq('org_id', ctx.orgId)
      .eq('job_id', (job as any).id)
      // Une visite annulée (supprimée) ne ressort plus « planifiée » (audit 2026-09-30).
      .is('deleted_at', null)
      .order('start_at', { ascending: true })
      .limit(50);
    const { data: items } = await ctx.client
      .from('job_line_items')
      .select('name, qty, unit_price_cents, total_cents, included')
      .eq('job_id', (job as any).id)
      .is('deleted_at', null);
    // Les jalons de facturation avec leur id et s'ils sont déjà facturés (audit 2026-09-30) :
    // aucune lecture ne les donnait, create_invoice_for_milestone devinait.
    const { data: jalons } = await ctx.client
      .from('job_billing_milestones')
      .select('id, label, amount_cents, due_date, position')
      .eq('org_id', ctx.orgId).eq('job_id', (job as any).id)
      .order('position', { ascending: true });
    const idsJalons = (jalons || []).map((j: any) => j.id);
    const { data: facturesJalons } = idsJalons.length
      ? await ctx.client.from('invoices').select('billing_milestone_id, invoice_number, status').eq('org_id', ctx.orgId).in('billing_milestone_id', idsJalons).is('deleted_at', null)
      : { data: [] as any[] };
    const factureDe = new Map((facturesJalons || []).filter((f: any) => !['void', 'cancelled'].includes(String(f.status))).map((f: any) => [f.billing_milestone_id, f.invoice_number]));
    return {
      ...job, line_items: items || [],
      visits: (visites || []).map((v: any) => ({ visit_id: v.id, start_at: v.start_at, end_at: v.end_at, status: v.status })),
      ...(jalons && jalons.length ? { billing_milestones: jalons.map((j: any) => ({ milestone_id: j.id, label: j.label, amount_cents: j.amount_cents, due_date: j.due_date, facture: factureDe.get(j.id) ?? null })) } : {}),
    };
  },
};

// Shared helper: schedule events joined to their jobs, optional location filter.
async function fetchScheduleEvents(
  ctx: ToolContext,
  opts: { startDate?: string; endDate?: string; location?: string },
) {
  // Une DATE (« 2026-10-02 ») est un jour de l'entreprise, bornes incluses (audit 2026-09-30) :
  // avant, minuit UTC = 20 h la veille à Québec, et « demain » ramenait la veille au soir.
  const JOUR = /^\d{4}-\d{2}-\d{2}$/;
  const borne = (v: string | undefined, cote: 'debut' | 'fin', defaut: string) => {
    if (!v) return defaut;
    if (JOUR.test(v)) return bornesJourOrg(v)[cote];
    const d = new Date(v);
    return isNaN(d.getTime()) ? defaut : d.toISOString();
  };
  const startIso = borne(opts.startDate, 'debut', bornesJourOrg().debut);
  const endIso = borne(opts.endDate, 'fin', new Date(Date.now() + 90 * 86400000).toISOString());

  const { data: events, error: evErr } = await ctx.client
    .from('schedule_events')
    .select('id, job_id, start_at, end_at, status')
    .eq('org_id', ctx.orgId)
    .is('deleted_at', null)
    .gte('start_at', startIso)
    .lte('start_at', endIso)
    .order('start_at', { ascending: true })
    .limit(200);
  if (evErr) return toolError('db', evErr);

  const jobIds = Array.from(new Set((events || []).map((e) => e.job_id).filter(Boolean)));
  if (jobIds.length === 0) return { count: 0, events: [] };

  let jobsQ = ctx.client
    .from('jobs')
    .select('id, title, client_name, property_address, status, total_cents')
    .eq('org_id', ctx.orgId)
    .is('deleted_at', null)
    .in('id', jobIds);
  const loc = String(opts.location || '').trim();
  if (loc) jobsQ = jobsQ.ilike('property_address', `%${loc.replace(/[%,()]/g, ' ')}%`);
  const { data: jobs, error: jobErr } = await jobsQ;
  if (jobErr) return toolError('db', jobErr);

  const jobMap = new Map((jobs || []).map((j) => [j.id, j]));
  const result = (events || [])
    .filter((e) => jobMap.has(e.job_id))
    .map((e) => {
      const j = jobMap.get(e.job_id)!;
      return {
        start_at: e.start_at,
        end_at: e.end_at,
        statut: ETIQUETTES_DERIVED[e.status] || e.status,
        job_id: j.id,
        job_title: j.title,
        client_name: j.client_name,
        address: j.property_address,
        total_cents: j.total_cents,
      };
    });
  return { count: result.length, events: result };
}

const findDatesInLocation: AgentTool = {
  kind: 'read',
  declaration: {
    name: 'find_dates_in_location',
    description:
      "Find the scheduled dates where the team works in a given city or location (e.g. 'Bromont'). Searches the calendar by the job's property address. Use this to answer questions like 'what are our dates in Bromont?'.",
    parameters: {
      type: 'object',
      properties: {
        location: { type: 'string', description: 'City or location name to search the schedule for (e.g. Bromont).' },
        start_date: { type: 'string', description: 'Optional ISO date to start from (default: today).' },
        end_date: { type: 'string', description: 'Optional ISO date to end at (default: 90 days from now).' },
      },
      required: ['location'],
    },
  },
  handler: async (args, ctx) =>
    fetchScheduleEvents(ctx, { location: String(args.location), startDate: args.start_date, endDate: args.end_date }),
};

const querySchedule: AgentTool = {
  kind: 'read',
  declaration: {
    name: 'query_schedule',
    description: 'Scheduled visits between two dates: job, client, address, status.',
    parameters: {
      type: 'object',
      properties: {
        start_date: { type: 'string', description: 'ISO date (inclusive). Default: today.' },
        end_date: { type: 'string', description: 'ISO date (inclusive). Default: 30 days from now.' },
      },
    },
  },
  handler: async (args, ctx) =>
    fetchScheduleEvents(ctx, {
      startDate: args.start_date,
      endDate: args.end_date || new Date(Date.now() + 30 * 86400000).toISOString(),
    }),
};

const listQuotes: AgentTool = {
  kind: 'read',
  declaration: {
    name: 'list_quotes',
    description: 'List quotes, optionally filtered by status or a search term. Returns total_matching (exact count), then number, title, status and total. Edit, duplicate, send by text, convert to invoice, presets → update_quote, duplicate_quote, send_quote_sms, convert_quote_to_invoice, *_quote_preset.',
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string', description: "Optional status filter. One of: 'draft', 'awaiting_response', 'changes_requested', 'approved', 'declined', 'expired', 'converted', 'archived'." },
        query: { type: 'string', description: 'Search text (number or title). Omit it to count ALL quotes.' },
        client_id: { type: 'string', description: 'Optional: only this client\'s (or lead\'s) quotes (id from a client search).' },
        limit: { type: 'integer', description: 'Max results (default 15, max 30).' },
      },
    },
  },
  handler: async (args, ctx) => {
    const limit = clamp(args.limit, 15, 30);
    let q = ctx.client
      .from('quotes')
      .select('id, quote_number, title, status, total_cents, currency, valid_until, created_at, client_id, lead_id', { count: 'exact' })
      .eq('org_id', ctx.orgId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (args.status) q = q.eq('status', String(args.status));
    // Audit 2026-09-30 : « la soumission de Marie » — filtre par client et nom du client
    // dans chaque ligne (avant : ni l'un ni l'autre, Lumi devinait sur le titre).
    if (args.client_id) {
      const id = String(args.client_id).replace(/[^0-9a-f-]/gi, '');
      q = q.or(`client_id.eq.${id},lead_id.eq.${id}`);
    }
    const term = String(args.query || '').trim();
    if (term) {
      const t = term.replace(/[%,()]/g, ' ');
      q = q.or(`quote_number.ilike.%${t}%,title.ilike.%${t}%`);
    }
    const { data, error, count } = await q;
    if (error) return toolError('db', error);
    const idsClients = [...new Set((data || []).map((x: any) => x.client_id || x.lead_id).filter(Boolean))];
    const noms = new Map<string, string>();
    if (idsClients.length) {
      const { data: cl } = await ctx.client.from('clients')
        .select('id, first_name, last_name, company, display_as_company').eq('org_id', ctx.orgId).in('id', idsClients);
      for (const c of (cl || []) as any[]) {
        const nom = [c.first_name, c.last_name].filter(Boolean).join(' ').trim();
        noms.set(c.id, (c.display_as_company && c.company) ? c.company : (nom || c.company || ''));
      }
    }
    return {
      ...enTeteListe(count, data),
      sum_total_cents_of_returned: somme(data, 'total_cents'),
      quotes: (data || []).map((q: any) => ({
        id: q.id, // interne : pour send_quote / convert_quote_to_job
        quote_number: q.quote_number,
        title: q.title,
        client_name: noms.get(q.client_id || q.lead_id) || null,
        statut: traduireStatut(q.status, STATUT_DEVIS),
        total_cents: q.total_cents,
        valid_until: q.valid_until,
      })),
    };
  },
};

const listInvoices: AgentTool = {
  kind: 'read',
  // RPC à identité (auth.uid()) : sans session rejouable, l'outil ne PEUT
  // pas répondre. needsIdentity déclenche le message clair « reconnecte »
  // au lieu du générique « ça a échoué » qui laisse croire à un bug.
  needsIdentity: true,
  declaration: {
    name: 'list_invoices',
    description: 'List invoices, optionally filtered by status (all, draft, past_due, paid). Returns invoice number, client, status, total and balance. Partial payment, void, back to draft, edit, duplicate, delete, recurring, invoice templates, payment link, refund, card on file → record_invoice_payment, void_invoice, revert_invoice_to_draft, update_invoice, duplicate_invoice, delete_invoice, *_recurring_invoice, *_invoice_template, create_payment_request, resend_payment_request, refund_payment, charge_card_on_file.',
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string', description: "One of: all, draft, sent_not_due, past_due, paid. Default all." },
        query: { type: 'string', description: 'Search text: an invoice number or a client name. Finds an invoice that is not among the most recent ones.' },
        limit: { type: 'integer', description: 'Max results (default 15, max 30).' },
      },
    },
  },
  handler: async (args, ctx) => {
    const limit = clamp(args.limit, 15, 30);
    // « La facture de Gagnon », « la facture 12 d'il y a six mois » : sans recherche, une facture
    // hors des 30 plus récentes était introuvable (la RPC savait chercher, l'outil passait null).
    const recherche = String(args.query || '').trim().slice(0, 80);
    const { data, error } = await ctx.client.rpc('rpc_list_invoices', {
      p_status: String(args.status || 'all'),
      p_range: 'all',
      p_q: recherche || null,
      p_sort: 'recent',
      p_limit: limit,
      p_offset: 0,
      p_from: null,
      p_to: null,
      p_org: ctx.orgId,
    });
    if (error) return toolError('db', error);
    const rows = Array.isArray(data) ? data : (data as any)?.items || [];
    return {
      count: rows.length,
      sum_total_cents: somme(rows.slice(0, limit), 'total_cents'),
      sum_balance_cents: somme(rows.slice(0, limit), 'balance_cents'),
      invoices: rows.slice(0, limit).map((r: any) => ({
        id: r.id, // interne : pour send_invoice
        invoice_number: r.invoice_number,
        client_name: r.client_name,
        statut: traduireStatut(r.status, STATUT_FACTURE),
        total_cents: r.total_cents,
        balance_cents: r.balance_cents,
        due_date: r.due_date,
      })),
    };
  },
};

const UUID_FICHE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Une FACTURE au complet (2026-10-01). Avant, Lumi ne voyait une facture que comme une ligne
 * de list_invoices : numéro, client, statut, total, solde. « Qu'est-ce qu'il y a sur la
 * facture 12 ? », « elle a payé comment ? », « est-ce qu'elle l'a ouverte ? » n'avaient pas
 * de réponse. Le numéro affiché est accepté (la garde le résout dans l'org).
 */
const getInvoice: AgentTool = {
  kind: 'read',
  needsIdentity: true,
  declaration: {
    name: 'get_invoice',
    description: 'One invoice in full, by its id OR displayed number: line items, subtotal, discount, taxes, total, payments received (date, method, refunds), balance, due date, when it was sent, and whether the client opened it. Use it for any question about what is ON an invoice or how it was paid; list_invoices only gives one summary line per invoice.',
    parameters: {
      type: 'object',
      properties: { invoice_id: { type: 'string', description: 'The invoice id, or the invoice number shown in Lume.' } },
      required: ['invoice_id'],
    },
  },
  handler: async (args, ctx) => {
    const id = String(args.invoice_id ?? '').trim();
    if (!UUID_FICHE.test(id)) return { introuvable: true, message: "Aucune facture avec ce numéro dans cette entreprise. Vérifie le numéro avec l'utilisateur, ou cherche-la avec list_invoices (query)." };
    const { data: f, error } = await ctx.client.from('invoices')
      .select('id, invoice_number, status, subject, issued_at, due_date, sent_at, paid_at, subtotal_cents, discount_cents, tax_cents, total_cents, paid_cents, balance_cents, currency, notes, internal_notes, client_id, client_name_snapshot, client_email_snapshot, job_id, is_viewed, viewed_at, last_viewed_at, view_count, is_recurring')
      .eq('org_id', ctx.orgId).eq('id', id).is('deleted_at', null).maybeSingle();
    if (error) return toolError('db', error);
    if (!f) return { introuvable: true, message: "Aucune facture avec cet identifiant dans cette entreprise (elle a peut-être été supprimée)." };
    const [{ data: lignes }, { data: paiements }, { data: job }] = await Promise.all([
      ctx.client.from('invoice_items').select('title, description, qty, unit_price_cents, line_total_cents, sort_order')
        .eq('org_id', ctx.orgId).eq('invoice_id', id).is('deleted_at', null).order('sort_order', { ascending: true }).limit(100),
      ctx.client.from('payments').select('id, amount_cents, refunded_cents, tip_cents, paid_at, payment_date, method, provider, status, card_brand, card_last4')
        .eq('org_id', ctx.orgId).eq('invoice_id', id).is('deleted_at', null).order('paid_at', { ascending: true }).limit(50),
      (f as any).job_id
        ? ctx.client.from('jobs').select('job_number, title').eq('org_id', ctx.orgId).eq('id', (f as any).job_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    const x: any = f;
    return {
      id: x.id, // interne : pour send_invoice, record_invoice_payment, void_invoice…
      invoice_number: x.invoice_number,
      statut: traduireStatut(x.status, STATUT_FACTURE),
      client_id: x.client_id,
      client_name: x.client_name_snapshot,
      client_email: x.client_email_snapshot,
      subject: x.subject,
      issued_at: x.issued_at, due_date: x.due_date, sent_at: x.sent_at, paid_at: x.paid_at,
      subtotal_cents: x.subtotal_cents, discount_cents: x.discount_cents, tax_cents: x.tax_cents,
      total_cents: x.total_cents, paid_cents: x.paid_cents, balance_cents: x.balance_cents, currency: x.currency,
      notes_client: x.notes, notes_internes: x.internal_notes,
      job: job ? { job_number: (job as any).job_number, title: (job as any).title } : null,
      recurrente: x.is_recurring === true,
      // « L'a-t-elle ouverte ? » : la page publique de la facture compte ses ouvertures.
      ouverte_par_le_client: x.is_viewed === true, premiere_ouverture: x.viewed_at, derniere_ouverture: x.last_viewed_at, nombre_ouvertures: x.view_count ?? 0,
      line_items: ((lignes ?? []) as any[]).map((l) => ({ name: l.title || l.description, description: l.title ? l.description : null, qty: l.qty, unit_price_cents: l.unit_price_cents, total_cents: l.line_total_cents })),
      payments: ((paiements ?? []) as any[]).map((p) => ({
        payment_id: p.id, amount_cents: p.amount_cents, refunded_cents: p.refunded_cents ?? 0, tip_cents: p.tip_cents ?? 0,
        date: p.paid_at || p.payment_date, method: p.method, provider: p.provider, status: p.status,
        carte: p.card_last4 ? `${p.card_brand || 'carte'} •••• ${p.card_last4}` : null,
      })),
    };
  },
};

/**
 * Une SOUMISSION au complet (2026-10-01) : lignes, rabais, dépôt, dates d'envoi, et si le
 * client l'a ouverte. list_quotes n'en donne que le numéro, le titre, le statut et le total.
 */
const getQuote: AgentTool = {
  kind: 'read',
  declaration: {
    name: 'get_quote',
    description: 'One quote in full, by its id OR displayed number: line items (optional ones flagged), subtotal, discount, taxes, total, required deposit and its status, validity date, when it was sent (email / SMS), approved or declined, and whether the client opened it (how many times, last time). Use it for any question about what is IN a quote or whether the client saw it; list_quotes only gives one summary line per quote.',
    parameters: {
      type: 'object',
      properties: { quote_id: { type: 'string', description: 'The quote id, or the quote number shown in Lume.' } },
      required: ['quote_id'],
    },
  },
  handler: async (args, ctx) => {
    const id = String(args.quote_id ?? '').trim();
    if (!UUID_FICHE.test(id)) return { introuvable: true, message: "Aucune soumission avec ce numéro dans cette entreprise. Vérifie le numéro avec l'utilisateur, ou cherche-la avec list_quotes (query)." };
    const { data: q, error } = await ctx.client.from('quotes')
      .select('id, quote_number, title, status, valid_until, subtotal_cents, discount_type, discount_value, discount_cents, tax_cents, total_cents, currency, notes, internal_notes, deposit_required, deposit_type, deposit_value, deposit_cents, deposit_status, sent_via_email_at, sent_via_sms_at, approved_at, declined_at, converted_at, is_viewed, viewed_at, last_viewed_at, view_count, client_id, lead_id, job_id, created_at')
      .eq('org_id', ctx.orgId).eq('id', id).is('deleted_at', null).maybeSingle();
    if (error) return toolError('db', error);
    if (!q) return { introuvable: true, message: "Aucune soumission avec cet identifiant dans cette entreprise (elle a peut-être été supprimée)." };
    const x: any = q;
    const idClient = x.client_id || x.lead_id;
    const [{ data: lignes }, { data: client }] = await Promise.all([
      ctx.client.from('quote_line_items').select('name, description, quantity, unit_price_cents, total_cents, is_optional, sort_order')
        .eq('org_id', ctx.orgId).eq('quote_id', id).order('sort_order', { ascending: true }).limit(100),
      idClient
        ? ctx.client.from('clients').select('first_name, last_name, company, display_as_company, email, phone').eq('org_id', ctx.orgId).eq('id', idClient).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    const c: any = client;
    const nom = c ? ((c.display_as_company && c.company) ? c.company : ([c.first_name, c.last_name].filter(Boolean).join(' ').trim() || c.company || null)) : null;
    return {
      id: x.id, // interne : pour send_quote, update_quote, convert_quote_to_job…
      quote_number: x.quote_number,
      title: x.title,
      statut: traduireStatut(x.status, STATUT_DEVIS),
      client_id: idClient, client_name: nom, client_email: c?.email ?? null, client_phone: c?.phone ?? null,
      created_at: x.created_at, valid_until: x.valid_until,
      subtotal_cents: x.subtotal_cents,
      discount: x.discount_cents ? { type: x.discount_type, value_amount: x.discount_value, discount_cents: x.discount_cents } : null,
      tax_cents: x.tax_cents, total_cents: x.total_cents, currency: x.currency,
      deposit: x.deposit_required ? { type: x.deposit_type, value_amount: x.deposit_value, deposit_cents: x.deposit_cents, statut: x.deposit_status } : null,
      notes_client: x.notes, notes_internes: x.internal_notes,
      envoyee_par_courriel: x.sent_via_email_at, envoyee_par_texto: x.sent_via_sms_at,
      approuvee_le: x.approved_at, refusee_le: x.declined_at, convertie_le: x.converted_at,
      ouverte_par_le_client: x.is_viewed === true, premiere_ouverture: x.viewed_at, derniere_ouverture: x.last_viewed_at, nombre_ouvertures: x.view_count ?? 0,
      line_items: ((lignes ?? []) as any[]).map((l) => ({ name: l.name, description: l.description, quantity: l.quantity, unit_price_cents: l.unit_price_cents, total_cents: l.total_cents, optionnelle: l.is_optional === true })),
    };
  },
};

const getCompanyInfo: AgentTool = {
  kind: 'read',
  declaration: {
    name: 'get_company_info',
    description: "Get the user's own company details (name, email, phone, address). Use when asked about the business itself.",
    parameters: { type: 'object', properties: {} },
  },
  handler: async (_args, ctx) => {
    const { data, error } = await ctx.client
      .from('company_settings')
      .select('company_name, email, phone, website, street1, city, province, postal_code')
      .eq('org_id', ctx.orgId)
      .maybeSingle();
    if (error) return toolError('db', error);
    return data || { company_name: null };
  },
};

const getOverduePayments: AgentTool = {
  kind: 'read',
  // RPC à identité (auth.uid()) : sans session rejouable, l'outil ne PEUT
  // pas répondre. needsIdentity déclenche le message clair « reconnecte »
  // au lieu du générique « ça a échoué » qui laisse croire à un bug.
  needsIdentity: true,
  declaration: {
    name: 'get_overdue_payments',
    description:
      'Overdue invoices with client, phone, balance owing and days overdue. Basis for payment reminders (propose texts, send only after a clear yes).',
    parameters: {
      type: 'object',
      properties: { limit: { type: 'integer', description: 'Max results (default 50, max 100).' } },
    },
  },
  handler: async (args, ctx) => {
    const limit = clamp(args.limit, 50, 100);
    const { data, error } = await ctx.client.rpc('rpc_list_invoices', {
      p_status: 'past_due',
      p_range: 'all',
      p_q: null,
      p_sort: 'due_date_desc',
      p_limit: limit,
      p_offset: 0,
      p_from: null,
      p_to: null,
      p_org: ctx.orgId,
    });
    if (error) return toolError('db', error);
    const rows = (Array.isArray(data) ? data : (data as any)?.items || []) as any[];

    const clientIds = Array.from(new Set(rows.map((r) => r.client_id).filter(Boolean)));
    const phoneMap = new Map<string, string | null>();
    if (clientIds.length > 0) {
      const { data: clients } = await ctx.client
        .from('clients')
        .select('id, phone')
        .eq('org_id', ctx.orgId)
        .in('id', clientIds);
      for (const c of clients || []) phoneMap.set(c.id, c.phone);
    }

    const today = Date.now();
    return {
      count: rows.length,
      sum_balance_cents: somme(rows, 'balance_cents'),
      overdue: rows.map((r) => ({
        invoice_number: r.invoice_number,
        client_id: r.client_id,
        client_name: r.client_name,
        phone: r.client_id ? phoneMap.get(r.client_id) || null : null,
        balance_cents: r.balance_cents,
        due_date: r.due_date,
        days_overdue: r.due_date ? Math.max(0, Math.floor((today - new Date(r.due_date).getTime()) / 86400000)) : null,
      })),
    };
  },
};

const getRevenueSummary: AgentTool = {
  kind: 'read',
  // RPC à identité (auth.uid()) : sans session rejouable, l'outil ne PEUT
  // pas répondre. needsIdentity déclenche le message clair « reconnecte »
  // au lieu du générique « ça a échoué » qui laisse croire à un bug.
  needsIdentity: true,
  declaration: {
    name: 'get_revenue_summary',
    description:
      "Get collected revenue for a period versus the company's revenue goal. Use for questions about CA / revenue / objectives / how we're tracking.",
    parameters: {
      type: 'object',
      properties: {
        period: { type: 'string', enum: [...PERIODES_REVENUS], description: 'this_month (default), last_month (« le mois passé »), this_year, last_year, last_30_days. Ignored when from and to are given.' },
        from: { type: 'string', description: 'Optional start day YYYY-MM-DD (with to) for any other period.' },
        to: { type: 'string', description: 'Optional end day YYYY-MM-DD, inclusive.' },
      },
    },
  },
  handler: async (args, ctx) => {
    const bornes = bornesPeriodeRevenus(String(args.period || 'this_month'), args.from ? String(args.from) : undefined, args.to ? String(args.to) : undefined);
    const period = bornes.period;
    const fromStr = bornes.from;
    const toStr = bornes.to;

    const { data: series, error } = await ctx.client.rpc('rpc_insights_revenue_series', {
      p_org: ctx.orgId,
      p_from: fromStr,
      p_to: toStr,
      p_granularity: 'month',
    });
    if (error) return toolError('db', error);
    const rows = (Array.isArray(series) ? series : []) as any[];
    const revenueCents = rows.reduce((s, r) => s + (Number(r.revenue_cents) || 0), 0);
    const invoicedCents = rows.reduce((s, r) => s + (Number(r.invoiced_cents) || 0), 0);

    const { data: settings } = await ctx.client
      .from('company_settings')
      .select('revenue_goal_cents')
      .eq('org_id', ctx.orgId)
      .maybeSingle();
    // L'objectif est ANNUEL (formulaire de création d'espace, Réglages →
    // Entreprise) : comparer le revenu d'un mois à l'objectif de l'année
    // annonçait ~8 % d'atteinte à une entreprise pile dans ses chiffres.
    const objectifAnnuel = Number(settings?.revenue_goal_cents) || 0;
    // Objectif au prorata du nombre de jours de la période (année = objectif entier).
    const jours = Math.round((Date.parse(`${toStr}T00:00:00Z`) - Date.parse(`${fromStr}T00:00:00Z`)) / 86400000) + 1;
    const goalCents = Math.round(
      period === 'this_year' || period === 'last_year' ? objectifAnnuel
        : period === 'this_month' || period === 'last_month' ? objectifAnnuel / 12
          : (objectifAnnuel * jours) / 365,
    );

    return {
      period,
      from: fromStr,
      to: toStr,
      revenue_cents: revenueCents,
      invoiced_cents: invoicedCents,
      goal_annual_cents: objectifAnnuel,
      goal_cents: goalCents,
      goal_progress_pct: goalCents > 0 ? Math.round((revenueCents / goalCents) * 1000) / 10 : null,
    };
  },
};

const getDayRoute: AgentTool = {
  kind: 'read',
  declaration: {
    name: 'get_day_route',
    description:
      "Get the planned route for a given day: the scheduled jobs in time order with their addresses, clients and times. Optionally filtered to a city. Use for 'what's my route today?' or 'my stops in Bromont tomorrow'.",
    parameters: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'ISO date for the day (YYYY-MM-DD). Default: today.' },
        location: { type: 'string', description: 'Optional city/location filter (matches the job address).' },
      },
    },
  },
  handler: async (args, ctx) => {
    // Le jour de l'ENTREPRISE (audit 2026-09-30) : avant, les bornes étaient celles du serveur (UTC).
    const jourDemande = args.date ? String(args.date).slice(0, 10) : undefined;
    if (jourDemande && !/^\d{4}-\d{2}-\d{2}$/.test(jourDemande)) return { error: 'Invalid date.' };
    const bornes = bornesJourOrg(jourDemande);
    const dayStart = new Date(bornes.debut);
    const dayEnd = new Date(bornes.fin);

    const { data: events, error } = await ctx.client
      .from('schedule_events')
      .select('id, job_id, start_at, end_at, status')
      .eq('org_id', ctx.orgId)
      .is('deleted_at', null)
      .gte('start_at', dayStart.toISOString())
      .lte('start_at', dayEnd.toISOString())
      .order('start_at', { ascending: true })
      .limit(50);
    if (error) return toolError('db', error);

    const jobIds = Array.from(new Set((events || []).map((e) => e.job_id).filter(Boolean)));
    if (jobIds.length === 0) return { date: bornes.jour, count: 0, stops: [] };

    let jobsQ = ctx.client
      .from('jobs')
      .select('id, title, client_name, property_address, latitude, longitude, status, total_cents')
      .eq('org_id', ctx.orgId)
      .is('deleted_at', null)
      .in('id', jobIds);
    const loc = String(args.location || '').trim();
    if (loc) jobsQ = jobsQ.ilike('property_address', `%${loc.replace(/[%,()]/g, ' ')}%`);
    const { data: jobs, error: jobErr } = await jobsQ;
    if (jobErr) return toolError('db', jobErr);

    const jobMap = new Map((jobs || []).map((j) => [j.id, j]));
    const stops = (events || [])
      .filter((e) => jobMap.has(e.job_id))
      .map((e, i) => {
        const j = jobMap.get(e.job_id)!;
        return {
          order: i + 1,
          start_at: e.start_at,
          end_at: e.end_at,
          job_title: j.title,
          client_name: j.client_name,
          address: j.property_address,
          statut: ETIQUETTES_DERIVED[e.status] || ETIQUETTES_DERIVED[j.status] || e.status || j.status,
        };
      });
    return { date: dayStart.toISOString().slice(0, 10), count: stops.length, stops };
  },
};

// ─────────────────────────────────────────────────────────────────
// WRITE TOOLS (proposal-only — never executed server-side)
// ─────────────────────────────────────────────────────────────────

const lineItemSchema = {
  type: 'array',
  description: 'Line items.',
  items: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Item/service name.' },
      description: { type: 'string', description: 'Optional details.' },
      quantity: { type: 'number', description: 'Quantity (default 1).' },
      unit_price_cents: { type: 'integer', description: 'Unit price in CENTS (e.g. $500.00 = 50000).' },
    },
    required: ['name', 'unit_price_cents'],
  },
};

const createQuote: AgentTool = {
  kind: 'write',
  declaration: {
    name: 'create_quote',
    description:
      'Create a quote (draft) for a client or lead. Requires client_id OR lead_id (look it up first with a client or lead search). Numbering and totals are computed by the database. Only call once all line items and the recipient are known — and if several clients match the name, ask which one first.',
    parameters: {
      type: 'object',
      properties: {
        client_id: { type: 'string', description: 'Existing client id (preferred).' },
        lead_id: { type: 'string', description: 'Existing lead id (if quoting a lead).' },
        title: { type: 'string', description: 'Quote title.' },
        line_items: lineItemSchema,
        valid_days: { type: 'integer', description: 'Validity in days (default 30).' },
        notes: { type: 'string', description: 'Optional notes.' },
        no_taxes: { type: 'boolean', description: "true ONLY if the user explicitly says no taxes. Otherwise Lume computes the taxes from the client's region." },
      },
      required: ['title', 'line_items'],
    },
  },
};

const createInvoice: AgentTool = {
  kind: 'write',
  declaration: {
    name: 'create_invoice',
    description:
      'Create an invoice DRAFT for a client (client_id from a client search). The invoice stays a draft: nothing is sent to the client — sending happens in Lume. Amounts are in cents.',
    parameters: {
      type: 'object',
      properties: {
        client_id: { type: 'string', description: 'Existing client id.' },
        subject: { type: 'string', description: 'Invoice subject/title.' },
        due_date: { type: 'string', description: 'Optional ISO due date (YYYY-MM-DD).' },
        items: {
          type: 'array',
          description: 'Invoice items.',
          items: {
            type: 'object',
            properties: {
              description: { type: 'string', description: 'Item description.' },
              qty: { type: 'number', description: 'Quantity (default 1).' },
              unit_price_cents: { type: 'integer', description: 'Unit price in CENTS.' },
            },
            required: ['description', 'unit_price_cents'],
          },
        },
        no_taxes: { type: 'boolean', description: "true ONLY if the user explicitly says no taxes. Otherwise Lume computes the taxes from the client's region — never compute them yourself." },
      },
      required: ['client_id', 'items'],
    },
  },
};

const createJob: AgentTool = {
  kind: 'write',
  declaration: {
    name: 'create_job',
    description:
      'Create a COMPLETE job (work order): real line items, the org\u2019s taxes computed like the app, '
      + 'address geocoded for the map, and a calendar visit when scheduled_at is given (otherwise draft). '
      + 'If several clients match a name, ask which one before creating.',
    parameters: {
      type: 'object',
      properties: {
        team_id: { type: 'string', description: 'Optional team id (from list_teams): the job and its visit go to that team\'s calendar column.' },
        title: { type: 'string', description: 'Job title.' },
        client_id: { type: 'string', description: 'Existing client id (optional).' },
        property_address: { type: 'string', description: 'Job site address (optional).' },
        scheduled_at: { type: 'string', description: 'Optional ISO datetime for the visit (creates a calendar visit; without it the job stays a draft).' },
        end_at: { type: 'string', description: 'Optional ISO end of the visit (default: start + 1 h).' },
        description: { type: 'string', description: 'Optional description.' },
        job_type: { type: 'string', description: 'Optional job type (e.g. lavage de vitres).' },
        no_taxes: { type: 'boolean', description: 'true = no taxes on this job (default: the org\u2019s active taxes apply).' },
        line_items: {
          type: 'array',
          description: 'Optional line items.',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              qty: { type: 'number' },
              unit_price_cents: { type: 'integer', description: 'Unit price in CENTS.' },
            },
            required: ['name', 'unit_price_cents'],
          },
        },
      },
      required: ['title'],
    },
  },
};

const sendSms: AgentTool = {
  kind: 'write',
  declaration: {
    name: 'send_sms',
    description:
      'Send a free-text SMS to a client — IT ACTUALLY SENDS, and a sent SMS cannot be recalled. '
      + 'A quote link → send_quote_sms ; a contract link → send_agreement_sms ; a payment link → create_payment_request ; '
      + 'reminders to several overdue clients → send_payment_reminders.'
      + '  ALWAYS show the user the exact message and recipient and get their explicit OK in the conversation before calling this. Opt-outs (STOP) are enforced server-side.',
    parameters: {
      type: 'object',
      properties: {
        client_id: { type: 'string', description: 'Existing client id (optional but recommended).' },
        client_name: { type: 'string', description: 'Client name for display (optional).' },
        phone_number: { type: 'string', description: 'Recipient phone number.' },
        message_text: { type: 'string', description: 'The SMS body to send.' },
      },
      required: ['phone_number', 'message_text'],
    },
  },
};

// ─────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────
// Handlers d'écriture et outils étendus — voir tools-etendus.ts.
// Attachés ICI pour que les quatre déclarations historiques gardent
// leur place unique dans le registre (pas de doublon de nom).
createQuote.handler = handlerCreateQuote;
createQuote.needsIdentity = true;
createInvoice.handler = handlerCreateInvoice;
createInvoice.needsIdentity = true;
createJob.handler = handlerCreateJob;
createJob.needsIdentity = true;
sendSms.handler = handlerSendSms;
sendSms.needsIdentity = true;


/**
 * Météo — la seule information hors CRM que Lumi connaisse (2026-09-22).
 * Les clients de Lume travaillent dehors : la pluie décide si la journée a
 * lieu. Source Open-Meteo, gratuite ; aucune donnée de l'org ne sort, juste
 * des coordonnées. Voir server/lib/agent/meteo.ts.
 */
const getWeather: AgentTool = {
  // Lecture pure : aucune écriture, donc aucune carte de confirmation.
  kind: 'read',
  declaration: {
    name: 'get_weather',
    description: "Weather forecast for the company's area, today or tomorrow, with an outdoor-work verdict (bon/variable/mauvais). Use for questions about rain, wind, temperature, or whether a job can be done outside. Only covers today and tomorrow.",
    parameters: {
      type: 'object',
      properties: {
        jour: { type: 'string', enum: ['aujourdhui', 'demain'], description: "Day to forecast. Defaults to today." },
      },
    },
  },
  handler: async (args, ctx) => {
    const { previsionPourOrg } = await import('./meteo');
    const p = await previsionPourOrg(ctx.client, ctx.orgId, { jour: args.jour === 'demain' ? 1 : 0 });
    // Pas de prévision (adresse manquante, service indisponible) : on le DIT.
    // Le modèle doit répondre qu'il ne sait pas, jamais inventer une météo.
    if (!p) return { disponible: false, raison: "Aucune prévision : l'adresse de l'entreprise est peut-être incomplète (Paramètres → Entreprise)." };
    return p;
  },
};

export const AGENT_TOOLS: AgentTool[] = [
  searchHelp,
  searchClients,
  searchLeads,
  listJobs,
  getJob,
  findDatesInLocation,
  querySchedule,
  listQuotes,
  getQuote,
  listInvoices,
  getInvoice,
  getCompanyInfo,
  getOverduePayments,
  getRevenueSummary,
  getDayRoute,
  getWeather,
  createQuote,
  createInvoice,
  createJob,
  sendSms,
  ...OUTILS_LECTURE_ETENDUS,
  ...OUTILS_ECRITURE_ETENDUS,
  ...OUTILS_RAPPORTS,
  // Couverture d'exécution à 100 % (2026-09-16) : leads, argent, terrain, équipe, réglages, porte-à-porte, formations.
  ...OUTILS_DOMAINES,
];

export const TOOLS_BY_NAME: Record<string, AgentTool> = Object.fromEntries(
  AGENT_TOOLS.map((t) => [t.declaration.name, t]),
);

export const TOOL_DECLARATIONS: FunctionDeclaration[] = AGENT_TOOLS.map((t) => t.declaration);
