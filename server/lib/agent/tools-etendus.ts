/* ═══════════════════════════════════════════════════════════════
   Lume Agent — outils étendus (lecture large + écritures)
   ─────────────────────────────────────────────────────────────
   Complète le registre de tools.ts. Même contrat, mêmes règles :

   • Chaque outil de LECTURE interroge LA MÊME SOURCE que l'écran
     correspondant de l'application (la leçon du bug des jobs : deux
     sources = deux vérités, et l'agent passe pour un menteur).
   • `needsIdentity: true` = l'outil exige le client Supabase à
     l'identité de l'utilisateur (session OAuth). Pas de repli sur le
     service client : pour la paie, les finances ou les positions GPS,
     un repli contournerait les permissions par rôle. Mieux vaut une
     erreur claire qu'une fuite polie.
   • Chaque ÉCRITURE est idempotente : l'empreinte (outil + arguments)
     est posée dans `agent_actions` AVANT d'agir, et l'unicité est
     portée par un index de la base. Un agent qui retente reçoit le
     résultat de la première exécution — jamais un doublon, jamais un
     deuxième SMS.
   • Les montants écrits vont dans les colonnes *_cents UNIQUEMENT
     (total/subtotal/tax_total sont des projections par trigger) et
     sont plafonnés (MCP_MAX_AMOUNT_CENTS, défaut 10 000 $).
   ═══════════════════════════════════════════════════════════════ */

import crypto from 'crypto';
import { getServiceClient } from '../supabase';
import { logSecurityEvent } from '../security';
import { twilioClient, getTwilioStatusCallbackUrl } from '../config';
import { normalizeE164, findOrCreateConversation } from '../helpers';
import { getOrgSmsFromNumber, SmsNumberNotProvisionedError, SmsNotInPlanError } from '../twilioProvisioning';
import {
  computePayPeriod, periodToIsoRange, computeEntryHours, DEFAULT_PAYROLL_SETTINGS,
  type PayrollSettings,
} from '../payroll';
import type { AgentTool, ToolContext } from './tools';

/* ── Garde-fous communs ────────────────────────────────────────── */

/** Plafond des montants qu'une écriture d'agent peut engager (cents). */
const PLAFOND_CENTS = (() => {
  const v = Number(process.env.MCP_MAX_AMOUNT_CENTS);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 1_000_000; // 10 000 $
})();

function depassePlafond(totalCents: number): { error: string } | null {
  if (totalCents > PLAFOND_CENTS) {
    return {
      error: `Le montant (${(totalCents / 100).toFixed(2)} $) dépasse le plafond autorisé pour l'agent `
        + `(${(PLAFOND_CENTS / 100).toFixed(2)} $). Créez cette pièce dans Lume directement, `
        + `ou faites relever MCP_MAX_AMOUNT_CENTS par l'administrateur.`,
    };
  }
  return null;
}

const clamp = (n: any, def: number, max: number) => {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return def;
  return Math.min(Math.floor(v), max);
};

/** Même politique que tools.ts : jamais d'erreur brute vers le modèle. */
function erreurOutil(scope: string, err: any): { error: string } {
  console.error(`[agent-tool:${scope}]`, err?.message || err);
  return { error: 'That lookup could not be completed. Try rephrasing or narrowing the request.' };
}

/** JSON à clés triées : la même intention → la même empreinte, toujours. */
function stableStringify(v: any): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

/**
 * Exécute une écriture UNE SEULE FOIS par (org, outil, arguments).
 *
 * L'empreinte est posée AVANT d'agir ; l'index unique de `agent_actions`
 * fait que deux requêtes identiques simultanées ne passent jamais toutes
 * les deux. Une retentative reçoit le résultat mémorisé de la première
 * exécution, marqué `deja_fait` pour que l'agent puisse le dire.
 * Si l'action échoue, l'empreinte est retirée : une vraie retentative
 * (après correction) reste possible.
 */
async function executerIdempotent(
  ctx: ToolContext,
  outil: string,
  args: Record<string, any>,
  action: () => Promise<Record<string, any>>,
): Promise<Record<string, any>> {
  const admin = getServiceClient();
  const argsHash = crypto.createHash('sha256').update(stableStringify(args)).digest('hex');

  const { data: posee, error: insErr } = await admin
    .from('agent_actions')
    .insert({ org_id: ctx.orgId, user_id: ctx.userId, outil, args_hash: argsHash })
    .select('id')
    .maybeSingle();

  if (insErr) {
    // 23505 = l'empreinte existe déjà : on renvoie le résultat mémorisé.
    if ((insErr as any).code === '23505') {
      const { data: existante } = await admin
        .from('agent_actions')
        .select('resultat, created_at')
        .eq('org_id', ctx.orgId).eq('outil', outil).eq('args_hash', argsHash)
        .maybeSingle();
      return {
        deja_fait: true,
        note: 'Cette action identique a déjà été exécutée il y a moins de 24 h — voici son résultat, rien n\'a été créé en double.',
        ...(existante?.resultat || {}),
      };
    }
    return erreurOutil(`${outil}:dedup`, insErr);
  }

  try {
    const resultat = await action();
    await admin.from('agent_actions').update({ resultat }).eq('id', posee!.id);
    logSecurityEvent({
      org_id: ctx.orgId, user_id: ctx.userId,
      event_type: 'agent_write_executed', severity: 'info', source: 'api',
      details: { outil, resultat: JSON.stringify(resultat).slice(0, 300) },
    });
    return resultat;
  } catch (e: any) {
    // Libérer l'empreinte : un échec ne doit pas bloquer une future tentative.
    await admin.from('agent_actions').delete().eq('id', posee!.id);
    console.error(`[agent-tool:${outil}]`, e?.message || e);
    return { error: e?.message ? String(e.message).slice(0, 200) : 'L\'action a échoué.' };
  }
}

/** Nom affichable d'un client (même logique que l'app). */
function nomClient(r: any): string {
  if (!r) return '';
  if (r.display_as_company && r.company) return String(r.company);
  return `${r.first_name || ''} ${r.last_name || ''}`.trim() || String(r.company || '');
}

/* ════════════════════════════════════════════════════════════════
   LECTURE — nouveaux domaines
   ════════════════════════════════════════════════════════════════ */

const getConversations: AgentTool = {
  kind: 'read',
  declaration: {
    name: 'get_conversations',
    description:
      'List recent SMS conversations with clients: who, last message, when, unread count. '
      + 'Use get_conversation_messages to read a full thread.',
    parameters: {
      type: 'object',
      properties: { limit: { type: 'integer', description: 'Max conversations (default 15, max 30).' } },
    },
  },
  handler: async (args, ctx) => {
    const { data, error } = await ctx.client
      .from('conversations')
      .select('id, client_id, client_name, phone_number, last_message_text, last_message_at, unread_count')
      .eq('org_id', ctx.orgId)
      .order('last_message_at', { ascending: false })
      .limit(clamp(args.limit, 15, 30));
    if (error) return erreurOutil('conversations', error);
    return { count: data?.length || 0, conversations: data || [] };
  },
};

const getConversationMessages: AgentTool = {
  kind: 'read',
  declaration: {
    name: 'get_conversation_messages',
    description:
      'Read the SMS thread with one client. Provide client_id (preferred) or phone_number. '
      + 'Returns the most recent messages with direction (inbound = the client wrote).',
    parameters: {
      type: 'object',
      properties: {
        client_id: { type: 'string', description: 'Client id (from search_clients).' },
        phone_number: { type: 'string', description: 'Phone number if no client_id.' },
        limit: { type: 'integer', description: 'Max messages (default 20, max 50).' },
      },
    },
  },
  handler: async (args, ctx) => {
    let conv = ctx.client
      .from('conversations')
      .select('id, client_name, phone_number')
      .eq('org_id', ctx.orgId)
      .limit(1);
    if (args.client_id) conv = conv.eq('client_id', String(args.client_id));
    else if (args.phone_number) conv = conv.eq('phone_number', normalizeE164(String(args.phone_number)));
    else return { error: 'Provide client_id or phone_number.' };

    const { data: c, error: e1 } = await conv.maybeSingle();
    if (e1) return erreurOutil('conversation', e1);
    if (!c) return { count: 0, messages: [], note: 'No conversation found for this client.' };

    const { data, error } = await ctx.client
      .from('messages')
      .select('direction, message_text, status, created_at')
      .eq('org_id', ctx.orgId)
      .eq('conversation_id', c.id)
      .order('created_at', { ascending: false })
      .limit(clamp(args.limit, 20, 50));
    if (error) return erreurOutil('messages', error);
    return {
      client_name: c.client_name, phone_number: c.phone_number,
      count: data?.length || 0,
      // Antichronologique en base → remis dans l'ordre de lecture.
      messages: (data || []).reverse(),
    };
  },
};

const getTeam: AgentTool = {
  kind: 'read',
  declaration: {
    name: 'get_team',
    description:
      'List the team members: name, email, role, status. Returns the user_id needed by assign_job.',
    parameters: { type: 'object', properties: {} },
  },
  handler: async (_args, ctx) => {
    const { data, error } = await ctx.client
      .from('team_members')
      .select('user_id, first_name, last_name, email, role, status')
      .eq('org_id', ctx.orgId)
      .order('first_name', { ascending: true });
    if (error) return erreurOutil('team', error);
    return {
      count: data?.length || 0,
      members: (data || []).map((m) => ({
        user_id: m.user_id,
        name: `${m.first_name || ''} ${m.last_name || ''}`.trim(),
        email: m.email, role: m.role, status: m.status,
      })),
    };
  },
};

const getTimesheets: AgentTool = {
  kind: 'read',
  declaration: {
    name: 'get_timesheets',
    description:
      'Hours worked per employee over a date range (default: last 7 days). '
      + 'Computed from punch-in/punch-out entries, breaks deducted — the same math as the Timesheets screen.',
    parameters: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Start date YYYY-MM-DD (default: 7 days ago).' },
        to: { type: 'string', description: 'End date YYYY-MM-DD (default: today).' },
      },
    },
  },
  handler: async (args, ctx) => {
    const to = String(args.to || new Date().toISOString().slice(0, 10));
    const from = String(args.from || new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10));
    const { data, error } = await ctx.client
      .from('time_entries')
      .select('employee_id, employee_name, date, punch_in, punch_out, breaks')
      .eq('org_id', ctx.orgId)
      .gte('date', from).lte('date', to)
      .order('date', { ascending: true });
    if (error) return erreurOutil('timesheets', error);

    const parEmploye = new Map<string, { name: string; hours: number; entries: number }>();
    for (const e of data || []) {
      const cle = String(e.employee_id || e.employee_name || '?');
      const cur = parEmploye.get(cle) || { name: e.employee_name || cle, hours: 0, entries: 0 };
      cur.hours += computeEntryHours(e as any);
      cur.entries += 1;
      parEmploye.set(cle, cur);
    }
    return {
      from, to,
      employees: [...parEmploye.values()].map((v) => ({ ...v, hours: Math.round(v.hours * 100) / 100 })),
      total_hours: Math.round([...parEmploye.values()].reduce((s, v) => s + v.hours, 0) * 100) / 100,
    };
  },
};

const listTasks: AgentTool = {
  kind: 'read',
  declaration: {
    name: 'list_tasks',
    description:
      "List the org's tasks (to-dos), optionally filtered by status ('open' or 'done'). Ordered by due date.",
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string', description: "Optional: 'open' (default) or 'done' or 'all'." },
        limit: { type: 'integer', description: 'Max tasks (default 20, max 40).' },
      },
    },
  },
  handler: async (args, ctx) => {
    let q = ctx.client
      .from('tasks_active')
      .select('id, title, description, status, priority, due_date, assignee_user_id, created_at')
      .eq('org_id', ctx.orgId)
      .order('due_date', { ascending: true, nullsFirst: false })
      .limit(clamp(args.limit, 20, 40));
    const statut = String(args.status || 'open');
    if (statut === 'open' || statut === 'done') q = q.eq('status', statut);
    const { data, error } = await q;
    if (error) return erreurOutil('tasks', error);
    return { count: data?.length || 0, tasks: data || [] };
  },
};

const listRequestSubmissions: AgentTool = {
  kind: 'read',
  declaration: {
    name: 'list_request_submissions',
    description:
      'Incoming request-form submissions (leads from the public form): who asked, contact info, when.',
    parameters: {
      type: 'object',
      properties: { limit: { type: 'integer', description: 'Max submissions (default 15, max 30).' } },
    },
  },
  handler: async (args, ctx) => {
    const { data, error } = await ctx.client
      .from('form_submissions')
      .select('id, first_name, last_name, company, email, phone, city, created_at')
      .eq('org_id', ctx.orgId)
      .is('deleted_at', null)
      .is('archived_at', null)
      .order('created_at', { ascending: false })
      .limit(clamp(args.limit, 15, 30));
    if (error) return erreurOutil('requests', error);
    return { count: data?.length || 0, submissions: data || [] };
  },
};

const getD2dStats: AgentTool = {
  kind: 'read',
  declaration: {
    name: 'get_d2d_stats',
    description:
      'Door-to-door field sales stats over a period (default: last 30 days): knocks, leads, sales, '
      + 'revenue — total and per rep.',
    parameters: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Start date YYYY-MM-DD (default: 30 days ago).' },
        to: { type: 'string', description: 'End date YYYY-MM-DD (default: today).' },
      },
    },
  },
  handler: async (args, ctx) => {
    const to = String(args.to || new Date().toISOString().slice(0, 10));
    const from = String(args.from || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
    const { data, error } = await ctx.client
      .from('field_daily_stats')
      .select('user_id, date, knocks, leads, quotes_sent, sales, revenue_cents')
      .eq('org_id', ctx.orgId)
      .gte('date', from).lte('date', to);
    if (error) return erreurOutil('d2d', error);

    const parRep = new Map<string, { knocks: number; leads: number; quotes_sent: number; sales: number; revenue_cents: number }>();
    const total = { knocks: 0, leads: 0, quotes_sent: 0, sales: 0, revenue_cents: 0 };
    for (const r of data || []) {
      const cur = parRep.get(r.user_id) || { knocks: 0, leads: 0, quotes_sent: 0, sales: 0, revenue_cents: 0 };
      for (const k of ['knocks', 'leads', 'quotes_sent', 'sales', 'revenue_cents'] as const) {
        cur[k] += Number((r as any)[k]) || 0;
        total[k] += Number((r as any)[k]) || 0;
      }
      parRep.set(r.user_id, cur);
    }
    // Noms depuis team_members — même source que l'écran terrain.
    const ids = [...parRep.keys()];
    const noms = new Map<string, string>();
    if (ids.length) {
      const { data: tm } = await ctx.client
        .from('team_members')
        .select('user_id, first_name, last_name')
        .eq('org_id', ctx.orgId)
        .in('user_id', ids);
      for (const m of tm || []) noms.set(m.user_id, `${m.first_name || ''} ${m.last_name || ''}`.trim());
    }
    return {
      from, to, total,
      per_rep: [...parRep.entries()].map(([uid, s]) => ({ user_id: uid, name: noms.get(uid) || null, ...s })),
    };
  },
};

const listCourses: AgentTool = {
  kind: 'read',
  declaration: {
    name: 'list_courses',
    description: 'List the training courses of the org: title, category, status.',
    parameters: { type: 'object', properties: {} },
  },
  handler: async (_args, ctx) => {
    const { data, error } = await ctx.client
      .from('courses')
      .select('id, title, category, status, created_at')
      .eq('org_id', ctx.orgId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(30);
    if (error) return erreurOutil('courses', error);
    return { count: data?.length || 0, courses: data || [] };
  },
};

const listAutomations: AgentTool = {
  kind: 'read',
  declaration: {
    name: 'list_automations',
    description: 'List the automation rules: name, trigger event, active or not.',
    parameters: { type: 'object', properties: {} },
  },
  handler: async (_args, ctx) => {
    const { data, error } = await ctx.client
      .from('automation_rules')
      .select('id, name, trigger_event, is_active, is_preset')
      .eq('org_id', ctx.orgId)
      .order('name', { ascending: true })
      .limit(50);
    if (error) return erreurOutil('automations', error);
    return { count: data?.length || 0, automations: data || [] };
  },
};

/* ── Lecture SENSIBLE : identité obligatoire ─────────────────────
   Ces trois-là ne se replient JAMAIS sur le service client : les
   permissions par rôle de l'utilisateur (RLS) doivent s'appliquer.  */

const getPayrollSummary: AgentTool = {
  kind: 'read',
  needsIdentity: true,
  declaration: {
    name: 'get_payroll_summary',
    description:
      'Current pay period: dates, pay day, and hours per employee. Requires the caller to have '
      + 'payroll access in Lume — a member without it gets nothing, same as in the app.',
    parameters: { type: 'object', properties: {} },
  },
  handler: async (_args, ctx) => {
    const { data: reglages, error: e1 } = await ctx.client
      .from('payroll_settings')
      .select('pay_period_type, anchor_date, pay_day_offset, timezone')
      .eq('org_id', ctx.orgId)
      .maybeSingle();
    if (e1) return erreurOutil('payroll', e1);

    const settings: PayrollSettings = {
      org_id: ctx.orgId,
      ...(reglages || DEFAULT_PAYROLL_SETTINGS),
    } as PayrollSettings;
    const periode = computePayPeriod(settings);
    const { fromIso, toIso } = periodToIsoRange(periode);

    const { data: entrees, error: e2 } = await ctx.client
      .from('time_entries')
      .select('employee_id, employee_name, date, punch_in, punch_out, breaks')
      .eq('org_id', ctx.orgId)
      .gte('date', fromIso.slice(0, 10)).lte('date', toIso.slice(0, 10));
    if (e2) return erreurOutil('payroll', e2);

    const parEmploye = new Map<string, { name: string; hours: number }>();
    for (const e of entrees || []) {
      const cle = String(e.employee_id || e.employee_name || '?');
      const cur = parEmploye.get(cle) || { name: e.employee_name || cle, hours: 0 };
      cur.hours += computeEntryHours(e as any);
      parEmploye.set(cle, cur);
    }
    return {
      period: periode,
      employees: [...parEmploye.values()].map((v) => ({ ...v, hours: Math.round(v.hours * 100) / 100 })),
      note: 'Heures seulement — les commissions et ajustements se consultent dans Lume › Paie.',
    };
  },
};

const getFinancialOverview: AgentTool = {
  kind: 'read',
  needsIdentity: true,
  declaration: {
    name: 'get_financial_overview',
    description:
      'Financial overview: invoice KPIs (30 days), revenue collected this month, and job margins '
      + '(revenue vs recorded expenses) for completed jobs this month. Requires financial access in Lume.',
    parameters: { type: 'object', properties: {} },
  },
  handler: async (_args, ctx) => {
    const debutMois = new Date();
    debutMois.setDate(1);
    const from = debutMois.toISOString().slice(0, 10);
    const to = new Date().toISOString().slice(0, 10);

    const [kpisR, serieR, jobsR] = await Promise.all([
      ctx.client.rpc('rpc_invoices_kpis_30d', { p_org: ctx.orgId }),
      ctx.client.rpc('rpc_insights_revenue_series', { p_org: ctx.orgId, p_from: from, p_to: to, p_granularity: 'month' }),
      ctx.client
        .from('jobs_active')
        .select('total_cents, expenses_cents')
        .eq('org_id', ctx.orgId)
        .eq('status', 'completed')
        .gte('completed_at', `${from}T00:00:00Z`),
    ]);
    if (kpisR.error) return erreurOutil('finances', kpisR.error);
    if (serieR.error) return erreurOutil('finances', serieR.error);
    if (jobsR.error) return erreurOutil('finances', jobsR.error);

    const kpis = Array.isArray(kpisR.data) ? kpisR.data[0] : kpisR.data;
    const revenus = (Array.isArray(serieR.data) ? serieR.data : [])
      .reduce((s: number, r: any) => s + (Number(r.revenue_cents) || 0), 0);
    const jobs = jobsR.data || [];
    const ca = jobs.reduce((s, j: any) => s + (Number(j.total_cents) || 0), 0);
    const depenses = jobs.reduce((s, j: any) => s + (Number(j.expenses_cents) || 0), 0);

    return {
      invoices_30d: kpis || {},
      revenue_this_month_cents: revenus,
      completed_jobs_this_month: {
        count: jobs.length,
        revenue_cents: ca,
        expenses_cents: depenses,
        margin_cents: ca - depenses,
        margin_pct: ca > 0 ? Math.round(((ca - depenses) / ca) * 1000) / 10 : null,
      },
    };
  },
};

const getTeamLocations: AgentTool = {
  kind: 'read',
  needsIdentity: true,
  declaration: {
    name: 'get_team_locations',
    description:
      'Last known GPS positions of team members currently tracked (fresh within 20 minutes). '
      + 'Only members who consented to tracking in Lume appear — the same consent rules as the live map.',
    parameters: { type: 'object', properties: {} },
  },
  handler: async (_args, ctx) => {
    const fraicheur = new Date(Date.now() - 20 * 60_000).toISOString();
    const { data, error } = await ctx.client
      .from('tracking_live_locations')
      .select('user_id, latitude, longitude, is_moving, tracking_status, job_id, updated_at')
      .eq('org_id', ctx.orgId)
      .gte('updated_at', fraicheur);
    if (error) return erreurOutil('gps', error);

    const ids = [...new Set((data || []).map((d) => d.user_id))];
    const noms = new Map<string, string>();
    if (ids.length) {
      const { data: tm } = await ctx.client
        .from('team_members')
        .select('user_id, first_name, last_name')
        .eq('org_id', ctx.orgId)
        .in('user_id', ids);
      for (const m of tm || []) noms.set(m.user_id, `${m.first_name || ''} ${m.last_name || ''}`.trim());
    }
    return {
      count: data?.length || 0,
      members: (data || []).map((d) => ({
        name: noms.get(d.user_id) || null,
        latitude: d.latitude, longitude: d.longitude,
        is_moving: d.is_moving, status: d.tracking_status,
        job_id: d.job_id, updated_at: d.updated_at,
      })),
      note: 'Positions récentes seulement (20 min). Un membre sans consentement de localisation n\'apparaît jamais.',
    };
  },
};

/* ════════════════════════════════════════════════════════════════
   ÉCRITURE — handlers
   Tous idempotents, tous à identité obligatoire, tous audités.
   Les quatre déclarations historiques (create_quote, create_invoice,
   create_job, send_sms) vivent dans tools.ts : leurs handlers sont
   exportés d'ici et attachés là-bas.
   ════════════════════════════════════════════════════════════════ */

export const handlerCreateJob = async (args: Record<string, any>, ctx: ToolContext) =>
  executerIdempotent(ctx, 'create_job', args, async () => {
    const items: any[] = Array.isArray(args.line_items) ? args.line_items : [];
    const totalCents = items.reduce(
      (s, it) => s + Math.round((Number(it.qty) || 1) * (Number(it.unit_price_cents) || 0)), 0);
    const cap = depassePlafond(totalCents);
    if (cap) throw new Error(cap.error);

    // Nom et adresse du client, comme le fait l'application à la création.
    let clientName: string | null = null;
    let clientAddress: string | null = null;
    if (args.client_id) {
      const { data: c, error } = await ctx.client
        .from('clients')
        .select('id, first_name, last_name, company, display_as_company, address')
        .eq('org_id', ctx.orgId).eq('id', String(args.client_id))
        .is('deleted_at', null).single();
      if (error || !c) throw new Error('Client introuvable — vérifiez le client_id avec search_clients.');
      clientName = nomClient(c) || null;
      clientAddress = c.address || null;
    }

    const description = [
      args.description ? String(args.description) : null,
      items.length
        ? 'Items : ' + items.map((it) => `${it.name} × ${it.qty || 1} @ ${((it.unit_price_cents || 0) / 100).toFixed(2)} $`).join(' ; ')
        : null,
    ].filter(Boolean).join('\n') || null;

    const { data, error } = await ctx.client
      .from('jobs')
      .insert({
        org_id: ctx.orgId,
        title: String(args.title).slice(0, 200),
        description,
        client_id: args.client_id || null,
        client_name: clientName,
        property_address: args.property_address || clientAddress || null,
        scheduled_at: args.scheduled_at || null,
        status: args.scheduled_at ? 'scheduled' : 'draft',
        total_cents: totalCents || null,
        currency: 'CAD',
      })
      .select('id, job_number, title, status, scheduled_at')
      .single();
    if (error) throw error;
    return { created: true, job: data };
  });

export const handlerCreateClient = async (args: Record<string, any>, ctx: ToolContext) =>
  executerIdempotent(ctx, 'create_client', args, async () => {
    // Même RPC que l'application : validation et gestion des doublons
    // vivent en base, on ne les réinvente pas.
    const { data, error } = await ctx.client.rpc('create_client_with_duplicate_handling', {
      p_org_id: ctx.orgId,
      p_mode: 'add',
      p_payload: {
        first_name: String(args.first_name || '').trim(),
        last_name: String(args.last_name || '').trim(),
        company: args.company ? String(args.company).trim() : null,
        email: args.email ? String(args.email).trim() : null,
        email_label: 'main',
        phone: args.phone ? String(args.phone).trim() : null,
        phones: [],
        address: args.address ? String(args.address).trim() : null,
        billing_same_as_service: true,
        city: args.city ? String(args.city).trim() : null,
        status: 'active',
        display_as_company: Boolean(args.company && !args.first_name),
        lead_source: 'agent',
      },
      p_merge_duplicates: true,
    });
    if (error) throw error;
    const row: any = Array.isArray(data) ? data[0] : data;
    return { created: true, client: { id: row?.id, name: nomClient(row) } };
  });

export const handlerCreateTask = async (args: Record<string, any>, ctx: ToolContext) =>
  executerIdempotent(ctx, 'create_task', args, async () => {
    const priorite = ['low', 'medium', 'high'].includes(String(args.priority)) ? String(args.priority) : 'medium';
    const { data, error } = await ctx.client
      .from('tasks')
      .insert({
        org_id: ctx.orgId,
        created_by: ctx.userId,
        title: String(args.title).slice(0, 200),
        description: args.description ? String(args.description) : null,
        status: 'open',
        priority: priorite,
        due_date: args.due_date || null,
        assignee_user_id: args.assignee_user_id || null,
      })
      .select('id, title, status, priority, due_date')
      .single();
    if (error) throw error;
    return { created: true, task: data };
  });

export const handlerUpdateJobStatus = async (args: Record<string, any>, ctx: ToolContext) =>
  executerIdempotent(ctx, 'update_job_status', args, async () => {
    const valides = ['draft', 'scheduled', 'in_progress', 'completed', 'cancelled'];
    const statut = String(args.status || '');
    if (!valides.includes(statut)) {
      throw new Error(`Statut invalide. Valeurs acceptées : ${valides.join(', ')}.`);
    }
    const patch: Record<string, any> = { status: statut };
    if (statut === 'completed') patch.completed_at = new Date().toISOString();
    const { data, error } = await ctx.client
      .from('jobs')
      .update(patch)
      .eq('org_id', ctx.orgId).eq('id', String(args.job_id))
      .is('deleted_at', null)
      .select('id, job_number, title, status')
      .single();
    if (error) throw error;
    return { updated: true, job: data };
  });

export const handlerAssignJob = async (args: Record<string, any>, ctx: ToolContext) =>
  executerIdempotent(ctx, 'assign_job', args, async () => {
    // Le destinataire doit être un membre réel de CETTE org.
    const { data: membre } = await ctx.client
      .from('team_members')
      .select('user_id, first_name, last_name')
      .eq('org_id', ctx.orgId).eq('user_id', String(args.assignee_user_id))
      .maybeSingle();
    if (!membre) throw new Error('Ce user_id n\'est pas membre de l\'équipe — vérifiez avec get_team.');

    const { data, error } = await ctx.client
      .from('jobs')
      .update({ assigned_user_id: membre.user_id })
      .eq('org_id', ctx.orgId).eq('id', String(args.job_id))
      .is('deleted_at', null)
      .select('id, job_number, title')
      .single();
    if (error) throw error;
    return {
      updated: true,
      job: data,
      assigned_to: `${membre.first_name || ''} ${membre.last_name || ''}`.trim(),
    };
  });

export const handlerCreateQuote = async (args: Record<string, any>, ctx: ToolContext) =>
  executerIdempotent(ctx, 'create_quote', args, async () => {
    const items: any[] = Array.isArray(args.line_items) ? args.line_items : [];
    if (!items.length) throw new Error('line_items est requis.');
    const totalCents = items.reduce(
      (s, it) => s + Math.round((Number(it.quantity) || 1) * (Number(it.unit_price_cents) || 0)), 0);
    const cap = depassePlafond(totalCents);
    if (cap) throw new Error(cap.error);

    // Même RPC que l'écran « Nouveau devis » : numérotation et défauts en base.
    const { data: rpcResult, error: rpcError } = await ctx.client.rpc('rpc_create_quote', {
      p_lead_id: args.lead_id || null,
      p_client_id: args.client_id || null,
      p_title: String(args.title).slice(0, 200),
      p_salesperson_id: null,
      p_context_type: args.client_id ? 'client' : 'lead',
      p_currency: 'CAD',
      p_valid_days: clamp(args.valid_days, 30, 365),
      p_notes: args.notes ? String(args.notes) : null,
      p_contract: null,
      p_deposit_required: false,
      p_require_payment_method: false,
    });
    if (rpcError) throw rpcError;
    const quoteId = String((rpcResult as any)?.quote_id || '');
    if (!quoteId) throw new Error('Le devis a été créé mais son id est introuvable.');

    const lignes = items.map((it, i) => ({
      quote_id: quoteId,
      name: String(it.name).trim(),
      description: it.description ? String(it.description) : null,
      quantity: Number(it.quantity) || 1,
      unit_price_cents: Math.round(Number(it.unit_price_cents) || 0),
      total_cents: Math.round((Number(it.quantity) || 1) * (Number(it.unit_price_cents) || 0)),
      sort_order: i,
      item_type: 'service',
      is_optional: false,
      discount_value: 0,
    }));
    const { error: itemsError } = await ctx.client.from('quote_line_items').insert(lignes);
    if (itemsError) throw itemsError;

    // Les totaux du devis sont recalculés PAR LA BASE, jamais à la main.
    const { error: recalcErr } = await ctx.client.rpc('rpc_recalculate_quote', { p_quote_id: quoteId });
    if (recalcErr) throw recalcErr;

    return { created: true, quote_id: quoteId, total_cents: totalCents, status: 'draft' };
  });

export const handlerCreateInvoice = async (args: Record<string, any>, ctx: ToolContext) =>
  executerIdempotent(ctx, 'create_invoice', args, async () => {
    const items: any[] = Array.isArray(args.items) ? args.items : [];
    if (!items.length) throw new Error('items est requis.');
    const totalCents = items.reduce(
      (s, it) => s + Math.round((Number(it.qty) || 1) * (Number(it.unit_price_cents) || 0)), 0)
      + Math.max(0, Math.round(Number(args.tax_cents) || 0));
    const cap = depassePlafond(totalCents);
    if (cap) throw new Error(cap.error);

    // Mêmes RPC que l'écran « Nouvelle facture ». La facture reste en
    // BROUILLON : rien ne part chez le client — l'envoi se fait dans Lume.
    const { data: creation, error: e1 } = await ctx.client.rpc('rpc_create_invoice_draft', {
      p_client_id: String(args.client_id),
      p_subject: args.subject ? String(args.subject) : null,
      p_due_date: args.due_date || null,
    });
    if (e1) throw e1;
    const row: any = Array.isArray(creation) ? creation[0] : creation;
    const invoiceId = String(row?.id || '');
    if (!invoiceId) throw new Error('La facture a été créée mais son id est introuvable.');

    const { error: e2 } = await ctx.client.rpc('rpc_save_invoice_draft', {
      p_invoice_id: invoiceId,
      p_subject: args.subject ? String(args.subject) : null,
      p_due_date: args.due_date || null,
      p_tax_cents: Math.max(0, Math.round(Number(args.tax_cents) || 0)),
      p_discount_cents: 0,
      p_notes: null,
      p_internal_notes: 'Créée par l\'agent (MCP).',
      p_items: items
        .map((it) => ({
          description: String(it.description || '').trim(),
          qty: Number.isFinite(Number(it.qty)) ? Number(it.qty) : 1,
          unit_price_cents: Math.round(Number(it.unit_price_cents) || 0),
        }))
        .filter((it) => it.description && it.qty > 0 && it.unit_price_cents >= 0),
    });
    if (e2) throw e2;

    return {
      created: true, invoice_id: invoiceId, status: 'draft', total_cents: totalCents,
      note: 'Facture en BROUILLON — elle ne part pas chez le client. L\'envoi se fait depuis Lume.',
    };
  });

export const handlerSendSms = async (args: Record<string, any>, ctx: ToolContext) =>
  executerIdempotent(ctx, 'send_sms', args, async () => {
    // Un SMS envoyé ne se rattrape pas : chaque garde de la route
    // officielle est reproduite ici, dans le même ordre.
    if (!twilioClient) throw new Error('Twilio n\'est pas configuré sur ce serveur.');
    const texte = String(args.message_text || '').trim();
    if (!texte) throw new Error('message_text est requis.');
    if (texte.length > 1000) throw new Error('Message trop long (max 1000 caractères).');

    const telephone = normalizeE164(String(args.phone_number || ''));
    const admin = getServiceClient();

    // Conformité LCAP : jamais vers un destinataire qui a texté STOP.
    const { data: optOut } = await admin
      .from('sms_opt_outs')
      .select('id')
      .eq('org_id', ctx.orgId).eq('phone', telephone)
      .maybeSingle();
    if (optOut) throw new Error('Ce destinataire a refusé les SMS de votre organisation (STOP).');

    let fromNumber: string;
    try {
      fromNumber = await getOrgSmsFromNumber(ctx.orgId);
    } catch (e) {
      if (e instanceof SmsNumberNotProvisionedError) throw new Error('Votre organisation n\'a pas encore de numéro SMS — Réglages › Messagerie.');
      if (e instanceof SmsNotInPlanError) throw new Error('Votre forfait n\'inclut pas les SMS.');
      throw e;
    }

    const conversation = await findOrCreateConversation(
      admin, ctx.orgId, telephone, args.client_id || undefined, args.client_name || undefined);

    const statusCallback = getTwilioStatusCallbackUrl();
    const twilioMessage = await twilioClient.messages.create({
      body: texte, from: fromNumber, to: telephone,
      ...(statusCallback ? { statusCallback } : {}),
    });

    const { data: message, error } = await admin
      .from('messages')
      .insert({
        conversation_id: conversation.id,
        org_id: ctx.orgId,
        client_id: conversation.client_id || args.client_id || null,
        phone_number: telephone,
        direction: 'outbound',
        message_text: texte,
        status: 'sent',
        provider_message_id: twilioMessage.sid,
        sender_user_id: ctx.userId,
      })
      .select('id, created_at')
      .single();
    if (error) throw error;

    return { sent: true, to: telephone, message_id: message?.id, provider_sid: twilioMessage.sid };
  });

/* ── Nouvelles déclarations d'écriture ───────────────────────────── */

const createClientTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'create_client',
    description:
      'Create a client in the CRM. Duplicates are detected and merged by the same rule as the app. '
      + 'If several existing clients share the name the user gave, ask which one BEFORE creating.',
    parameters: {
      type: 'object',
      properties: {
        first_name: { type: 'string', description: 'First name.' },
        last_name: { type: 'string', description: 'Last name.' },
        company: { type: 'string', description: 'Company name (optional).' },
        email: { type: 'string', description: 'Email (optional).' },
        phone: { type: 'string', description: 'Phone (optional).' },
        address: { type: 'string', description: 'Service address (optional).' },
        city: { type: 'string', description: 'City (optional).' },
      },
      required: ['first_name', 'last_name'],
    },
  },
  handler: handlerCreateClient,
};

const createTaskTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'create_task',
    description: 'Create a task (to-do), optionally assigned to a team member (user_id from get_team).',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Task title.' },
        description: { type: 'string', description: 'Details (optional).' },
        due_date: { type: 'string', description: 'Due date YYYY-MM-DD (optional).' },
        priority: { type: 'string', description: "'low', 'medium' (default) or 'high'." },
        assignee_user_id: { type: 'string', description: 'Team member user_id (optional).' },
      },
      required: ['title'],
    },
  },
  handler: handlerCreateTask,
};

const updateJobStatusTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'update_job_status',
    description:
      "Change a job's status. Valid: draft, scheduled, in_progress, completed, cancelled. "
      + 'Get the job id from list_jobs first.',
    parameters: {
      type: 'object',
      properties: {
        job_id: { type: 'string', description: 'Job id.' },
        status: { type: 'string', description: 'New status.' },
      },
      required: ['job_id', 'status'],
    },
  },
  handler: handlerUpdateJobStatus,
};

const assignJobTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'assign_job',
    description: 'Assign a job to a team member. Use get_team for the user_id, list_jobs for the job id.',
    parameters: {
      type: 'object',
      properties: {
        job_id: { type: 'string', description: 'Job id.' },
        assignee_user_id: { type: 'string', description: 'Team member user_id.' },
      },
      required: ['job_id', 'assignee_user_id'],
    },
  },
  handler: handlerAssignJob,
};

/** Lecture ajoutée par ce module. */
export const OUTILS_LECTURE_ETENDUS: AgentTool[] = [
  getConversations,
  getConversationMessages,
  getTeam,
  getTimesheets,
  listTasks,
  listRequestSubmissions,
  getD2dStats,
  listCourses,
  listAutomations,
  getPayrollSummary,
  getFinancialOverview,
  getTeamLocations,
];

/** Écriture ajoutée par ce module (les 4 historiques restent dans tools.ts). */
export const OUTILS_ECRITURE_ETENDUS: AgentTool[] = [
  createClientTool,
  createTaskTool,
  updateJobStatusTool,
  assignJobTool,
];
