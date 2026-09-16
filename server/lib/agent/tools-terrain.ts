/* ═══════════════════════════════════════════════════════════════
   Lume Agent — outils « terrain » (jobs, visites, calendrier,
   listes de vérification, étiquettes, contrats, tâches)
   ─────────────────────────────────────────────────────────────
   Complète tools.ts / tools-etendus.ts : tout ce qu'un utilisateur fait
   dans l'app sur un job et que Lumi ne pouvait pas encore EXÉCUTER.
   Mêmes règles que les modules voisins :

   • chaque écriture passe par `executerIdempotent` (empreinte + résultat
     mémorisé, jamais de doublon) et exige l'identité de l'utilisateur ;
   • chaque accès à la base est filtré `org_id = ctx.orgId` en plus de la
     RLS — jamais un id d'une autre org, même par erreur du modèle ;
   • un envoi au client passe par la ROUTE de l'app (`appelInterne`) : les
     gabarits, le suivi des courriels et la journalisation restent uniques ;
   • les montants sont en cents ; on n'écrit JAMAIS une colonne projetée par
     trigger (total, subtotal…) ;
   • aucune erreur brute de Postgres n'atteint le modèle : les handlers
     lèvent des phrases en français, `executerIdempotent` traduit le reste.

   Les quatre manifestes exportés (OUTILS_TERRAIN, REGISTRE_TERRAIN,
   PERMISSIONS_TERRAIN, TOPICS_TERRAIN) sont à raccorder dans tools.ts,
   registre.ts, garde.ts et topics.ts ; tests/lumi-outils-terrain.test.ts
   vérifie qu'ils couvrent exactement ces outils.
   ═══════════════════════════════════════════════════════════════ */

import type { PermissionKey } from '../../../src/lib/permissions';
import type { IdTopic } from '../lumi/topics';
import type { AgentTool, ToolContext } from './tools';
import {
  executerIdempotent, champRequis, appelInterne, AppelInterneIncertain, traduireStatut,
} from './tools-etendus';

/* ── Aides communes ────────────────────────────────────────────── */

const FUSEAU_ORG = 'America/Montreal';
/** Fuseau par défaut des disponibilités, celui que l'app écrit (availabilityApi). */
const FUSEAU_DISPONIBILITES = 'America/Toronto';

/** Même politique que tools.ts : jamais d'erreur brute vers le modèle (lectures). */
function erreurLecture(scope: string, err: any): { error: string } {
  console.error(`[agent-tool:${scope}]`, err?.message || err);
  return { error: 'La consultation a échoué côté Lume. Dis-le simplement à l’utilisateur et propose de réessayer.' };
}

const clamp = (n: any, def: number, max: number) => {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return def;
  return Math.min(Math.floor(v), max);
};

/** Instant ISO valide, sinon erreur lisible. */
function instantIso(v: any, nomLisible: string): Date {
  const d = new Date(String(v ?? ''));
  if (Number.isNaN(d.getTime())) throw new Error(`${nomLisible} est invalide (date-heure ISO attendue).`);
  return d;
}

/** Date seule YYYY-MM-DD valide, sinon erreur lisible. */
function dateSeule(v: any, nomLisible: string): string {
  const s = String(v ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(new Date(`${s}T00:00:00Z`).getTime())) {
    throw new Error(`${nomLisible} est invalide (format AAAA-MM-JJ attendu).`);
  }
  return s;
}

/** Entier borné, sinon erreur lisible. */
function entierBorne(v: any, nomLisible: string, min: number, max: number): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${nomLisible} doit être un entier entre ${min} et ${max}.`);
  return n;
}

/** « HH:MM » → minutes depuis minuit. */
function heureEnMinutes(v: any, nomLisible: string): number {
  const m = String(v ?? '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) throw new Error(`${nomLisible} est invalide (format HH:MM attendu, ex. 08:30).`);
  const h = Number(m[1]); const mn = Number(m[2]);
  if (h > 24 || mn > 59 || h * 60 + mn > 1440) throw new Error(`${nomLisible} est hors de la journée.`);
  return h * 60 + mn;
}

function minutesEnHeure(minutes: number): string {
  const h = Math.floor(minutes / 60); const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

const JOURS_FR = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

const STATUT_CONTRAT: Record<string, string> = { draft: 'brouillon', sent: 'envoyé', signed: 'signé' };
const STATUT_TACHE: Record<string, string> = { open: 'à faire', done: 'terminée' };
const PRIORITE_TACHE: Record<string, string> = { low: 'basse', medium: 'moyenne', high: 'haute' };
const FREQUENCE_FR: Record<string, string> = {
  daily: 'chaque jour', weekly: 'chaque semaine', biweekly: 'aux deux semaines', monthly: 'chaque mois', custom: 'personnalisée',
};
const FREQUENCES = ['daily', 'weekly', 'biweekly', 'monthly', 'custom'] as const;
type Frequence = typeof FREQUENCES[number];

/**
 * Conditions par défaut d'un contrat (copie de DEFAULT_AGREEMENT_TERMS.fr de
 * src/lib/jobAgreementsApi.ts — le module client importe le client Supabase du
 * navigateur, on ne peut pas l'importer côté serveur).
 */
const CONDITIONS_CONTRAT_PAR_DEFAUT_FR = `1. Accès à la propriété : Le client n'a pas besoin d'être présent. En confirmant le rendez-vous, il autorise l'accès à la propriété. Les accès doivent être dégagés et les animaux sécurisés.
2. Garantie (7 jours) : Une garantie de 7 jours est offerte sur la qualité du travail. Toute correction sera effectuée sans frais si signalée dans ce délai.
3. État des surfaces : L'entreprise n'est pas responsable des dommages liés à des surfaces déjà endommagées ou à l'usure normale.
4. Annulation : Toute annulation doit être faite au moins 24 heures à l'avance.
5. Responsabilité : Le client doit informer l'entreprise de toute condition particulière ou surface fragile avant le début des travaux.`;

/**
 * Le job existe-t-il dans CETTE org (et non effacé) ? Renvoie les colonnes
 * demandées ou lève une erreur d'exploitant. Toute écriture liée à un job
 * commence ici : c'est la garde d'org explicite, en plus de la RLS.
 */
async function jobDeLOrg(ctx: ToolContext, jobId: string, colonnes = 'id, job_number, title, client_id'): Promise<Record<string, any>> {
  const { data, error } = await ctx.client
    .from('jobs')
    .select(colonnes)
    .eq('org_id', ctx.orgId).eq('id', jobId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Job introuvable — vérifie le numéro de job.');
  return data as Record<string, any>;
}

/**
 * Signale un événement aux automatisations APRÈS une écriture (même contrat
 * que signalerEvenement dans tools-etendus.ts) : un raté devient un
 * avertissement, jamais une erreur — l'écriture est faite, retenter = doublon.
 */
async function signalerTerrain(ctx: ToolContext, chemin: string, corps: Record<string, any>, quoi: string): Promise<string | null> {
  try {
    const { ok, status, json } = await appelInterne(ctx, chemin, corps);
    if (!ok) return `${quoi} (${json?.error || status}) — l'écriture est faite, mais ce suivi n'a pas tourné.`;
    return null;
  } catch (err: any) {
    return `${quoi} (${err?.message || 'session absente'}) — l'écriture est faite, mais ce suivi n'a pas tourné.`;
  }
}

/**
 * Résultat d'un envoi dont la réponse n'est jamais revenue. On le RENVOIE (pas
 * de throw) : l'empreinte d'idempotence est ainsi conservée avec ce résultat,
 * et une retentative de Claude tombe sur `deja_fait` au lieu de renvoyer le
 * contrat une seconde fois au client.
 */
function envoiIncertain(quoi: string): Record<string, any> {
  return {
    incertain: true,
    sent: null,
    note: `Je n'ai pas eu la confirmation que ${quoi} est bien parti — il a PEUT-ÊTRE été envoyé. `
      + 'Ne le renvoie pas d’ici là : vérifie dans Lume si le client l’a reçu, et ne relance que si ce n’est pas le cas.',
  };
}

/* ═══════════════════════════════════════════════════════════════
   JOBS — suppression, récurrence, gabarits
   ═══════════════════════════════════════════════════════════════ */

const deleteJobTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'delete_job',
    description:
      'Delete a job — same as the trash action in Lume: the job and its calendar visits go to the trash '
      + '(soft delete, not recoverable from the app). Prefer archive_job for a job that is merely stale. '
      + 'Get the job id from the jobs list. Confirm with the user first.',
    parameters: {
      type: 'object',
      properties: { job_id: { type: 'string', description: 'Job id (from the jobs list).' } },
      required: ['job_id'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'delete_job', args, async () => {
      const jobId = champRequis(args.job_id, 'Le job');
      const job = await jobDeLOrg(ctx, jobId, 'id, job_number, title');
      // La RPC de l'app (soft_delete_job) d'abord : c'est l'acte de suppression.
      const { error: rpcErr } = await ctx.client.rpc('soft_delete_job', { p_org_id: ctx.orgId, p_job_id: jobId });
      if (rpcErr) throw rpcErr;
      const avertissements: string[] = [];
      // Puis ses visites, comme softDeleteJob dans l'app. Le job est déjà
      // supprimé : un raté ici est un avertissement, pas une erreur.
      const nowIso = new Date().toISOString();
      const { error: evErr } = await ctx.client
        .from('schedule_events')
        .update({ deleted_at: nowIso, updated_at: nowIso })
        .eq('org_id', ctx.orgId).eq('job_id', jobId)
        .is('deleted_at', null);
      if (evErr) {
        console.error('[agent-tool:delete_job] visites non supprimées', evErr?.message || evErr);
        avertissements.push('les visites au calendrier n’ont pas toutes été retirées — à vérifier dans Lume.');
      }
      // Commission projetée (non confirmée) du job : annulée en arrière-plan par l'app aussi.
      const avertCom = await signalerTerrain(ctx, '/commissions/void-for-job', { jobId }, 'la commission projetée n’a pas été annulée');
      if (avertCom) avertissements.push(avertCom);
      return {
        deleted: true,
        job: { job_number: job.job_number, title: job.title },
        note: 'Job supprimé avec ses visites au calendrier.',
        ...(avertissements.length ? { warning: avertissements.join(' ') } : {}),
      };
    }),
};

const listRecurrenceRulesTool: AgentTool = {
  kind: 'read',
  needsIdentity: true,
  declaration: {
    name: 'list_recurrence_rules',
    description:
      'List the recurring-job rules of the company (which jobs repeat, how often, next run). '
      + 'Optionally for one job. Rule ids are needed to deactivate a rule.',
    parameters: {
      type: 'object',
      properties: {
        job_id: { type: 'string', description: 'Only the rules of this job (optional).' },
        include_inactive: { type: 'boolean', description: 'true = also list deactivated rules (default false).' },
        limit: { type: 'integer', description: 'Max rules (default 25, max 50).' },
      },
    },
  },
  handler: async (args, ctx) => {
    try {
      let q = ctx.client
        .from('job_recurrence_rules')
        .select('id, job_id, frequency, interval_days, day_of_week, day_of_month, start_date, end_date, max_occurrences, occurrences_created, next_run_at, is_active', { count: 'exact' })
        .eq('org_id', ctx.orgId)
        .order('created_at', { ascending: false })
        .limit(clamp(args.limit, 25, 50));
      if (args.job_id) q = q.eq('job_id', String(args.job_id));
      if (!args.include_inactive) q = q.eq('is_active', true);
      const { data, error, count } = await q;
      if (error) throw error;
      const regles = data || [];
      // Deux FK relient la règle au job : pas d'embed PostgREST (ambigu), une
      // seconde requête, filtrée org.
      const jobIds = [...new Set(regles.map((r: any) => r.job_id).filter(Boolean))];
      const nomsJobs = new Map<string, any>();
      if (jobIds.length) {
        const { data: jobs } = await ctx.client
          .from('jobs').select('id, job_number, title').eq('org_id', ctx.orgId).in('id', jobIds);
        for (const j of jobs || []) nomsJobs.set(j.id, j);
      }
      return {
        total_matching: count ?? regles.length,
        rules: regles.map((r: any) => ({
          id: r.id,
          job_id: r.job_id,
          job_number: nomsJobs.get(r.job_id)?.job_number ?? null,
          job_title: nomsJobs.get(r.job_id)?.title ?? null,
          frequence: FREQUENCE_FR[r.frequency] || r.frequency,
          interval_days: r.interval_days,
          day_of_week: r.day_of_week,
          day_of_month: r.day_of_month,
          start_date: r.start_date,
          end_date: r.end_date,
          max_occurrences: r.max_occurrences,
          occurrences_created: r.occurrences_created,
          next_run_at: r.next_run_at,
          statut: r.is_active ? 'active' : 'désactivée',
        })),
      };
    } catch (e) {
      return erreurLecture('list_recurrence_rules', e);
    }
  },
};

function intervalleParDefaut(freq: Frequence): number {
  switch (freq) {
    case 'daily': return 1;
    case 'weekly': return 7;
    case 'biweekly': return 14;
    case 'monthly': return 30;
    case 'custom': return 7;
  }
}

function prochaineOccurrence(depuis: Date, freq: Frequence, intervalJours: number): Date {
  const next = new Date(depuis);
  switch (freq) {
    case 'daily': next.setUTCDate(next.getUTCDate() + 1); break;
    case 'weekly': next.setUTCDate(next.getUTCDate() + 7); break;
    case 'biweekly': next.setUTCDate(next.getUTCDate() + 14); break;
    case 'monthly': next.setUTCMonth(next.getUTCMonth() + 1); break;
    case 'custom': next.setUTCDate(next.getUTCDate() + intervalJours); break;
  }
  return next;
}

const createRecurrenceRuleTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'create_recurrence_rule',
    description:
      'Make a job recurring: Lume will create a new copy of the job on each occurrence (daily, weekly, '
      + 'biweekly, monthly or every N days). One active rule per job. Get the job id from the jobs list.',
    parameters: {
      type: 'object',
      properties: {
        job_id: { type: 'string', description: 'Job id to repeat.' },
        frequency: { type: 'string', enum: [...FREQUENCES], description: "'daily', 'weekly', 'biweekly', 'monthly' or 'custom' (every interval_days)." },
        start_date: { type: 'string', description: 'First occurrence date YYYY-MM-DD.' },
        interval_days: { type: 'integer', description: "Days between occurrences (only for 'custom'; default per frequency)." },
        day_of_week: { type: 'array', items: { type: 'integer' }, description: 'Optional weekdays (0 = Sunday … 6 = Saturday).' },
        day_of_month: { type: 'integer', description: 'Optional day of month (1-31) for monthly rules.' },
        end_date: { type: 'string', description: 'Optional last date YYYY-MM-DD.' },
        max_occurrences: { type: 'integer', description: 'Optional maximum number of occurrences.' },
      },
      required: ['job_id', 'frequency', 'start_date'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'create_recurrence_rule', args, async () => {
      const jobId = champRequis(args.job_id, 'Le job');
      const freq = String(args.frequency) as Frequence;
      if (!FREQUENCES.includes(freq)) throw new Error('La fréquence doit être daily, weekly, biweekly, monthly ou custom.');
      const startDate = dateSeule(args.start_date, 'La date de début');
      const endDate = args.end_date ? dateSeule(args.end_date, 'La date de fin') : null;
      if (endDate && endDate < startDate) throw new Error('La date de fin précède la date de début.');
      const intervalJours = args.interval_days !== undefined ? entierBorne(args.interval_days, 'L’intervalle en jours', 1, 365) : intervalleParDefaut(freq);
      const joursSemaine = Array.isArray(args.day_of_week)
        ? [...new Set(args.day_of_week.map((d: any) => entierBorne(d, 'Le jour de semaine', 0, 6)))]
        : null;
      const jourDuMois = args.day_of_month !== undefined ? entierBorne(args.day_of_month, 'Le jour du mois', 1, 31) : null;
      const maxOcc = args.max_occurrences !== undefined ? entierBorne(args.max_occurrences, 'Le nombre maximal d’occurrences', 1, 1000) : null;

      const job = await jobDeLOrg(ctx, jobId, 'id, job_number, title');
      const { data: active, error: eActive } = await ctx.client
        .from('job_recurrence_rules').select('id')
        .eq('org_id', ctx.orgId).eq('job_id', jobId).eq('is_active', true)
        .limit(1).maybeSingle();
      if (eActive) throw eActive;
      if (active) throw new Error('Ce job a déjà une règle de récurrence active — désactive-la d’abord (deactivate_recurrence_rule).');

      // next_run_at comme dans l'app : la date de début si elle est à venir,
      // sinon la prochaine occurrence à partir de maintenant. Minuit à
      // Montréal ≈ 05:00Z : le cron ne rate pas le jour de début.
      const debut = new Date(`${startDate}T05:00:00Z`);
      const maintenant = new Date();
      const prochain = debut > maintenant ? debut : prochaineOccurrence(maintenant, freq, intervalJours);

      const { data, error } = await ctx.client
        .from('job_recurrence_rules')
        .insert({
          org_id: ctx.orgId,
          job_id: jobId,
          frequency: freq,
          interval_days: intervalJours,
          day_of_week: joursSemaine,
          day_of_month: jourDuMois,
          start_date: startDate,
          end_date: endDate,
          max_occurrences: maxOcc,
          next_run_at: prochain.toISOString(),
          is_active: true,
          timezone: FUSEAU_ORG,
        })
        .select('id, next_run_at')
        .single();
      if (error) throw error;
      return {
        created: true,
        rule_id: data.id,
        job: { job_number: job.job_number, title: job.title },
        frequence: FREQUENCE_FR[freq],
        next_run_at: data.next_run_at,
        note: `Récurrence créée (${FREQUENCE_FR[freq]}) : Lume créera une copie du job à chaque occurrence, la première le ${String(data.next_run_at).slice(0, 10)}.`,
      };
    }),
};

const deactivateRecurrenceRuleTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'deactivate_recurrence_rule',
    description:
      'Stop a recurring-job rule: no further copies of the job are created (already-created jobs stay). '
      + 'Get the rule id from list_recurrence_rules. Confirm with the user first.',
    parameters: {
      type: 'object',
      properties: { rule_id: { type: 'string', description: 'Recurrence rule id.' } },
      required: ['rule_id'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'deactivate_recurrence_rule', args, async () => {
      const ruleId = champRequis(args.rule_id, 'La règle de récurrence');
      const { data, error } = await ctx.client
        .from('job_recurrence_rules')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('org_id', ctx.orgId).eq('id', ruleId).eq('is_active', true)
        .select('id, job_id, occurrences_created')
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('Règle introuvable ou déjà désactivée.');
      return {
        deactivated: true,
        rule_id: data.id,
        occurrences_created: data.occurrences_created,
        note: 'Récurrence arrêtée : plus aucune copie du job ne sera créée. Les jobs déjà créés restent.',
      };
    }),
};

const createJobTemplateTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'create_job_template',
    description:
      'Save a reusable job template (title, type, line items, tags, notes) that the team can pick when '
      + 'creating a job in Lume. Nothing is scheduled or billed.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Template title.' },
        description: { type: 'string', description: 'Optional description.' },
        job_type: { type: 'string', description: "Optional job type (default 'one_off')." },
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
        tags: { type: 'array', items: { type: 'string' }, description: 'Optional tag names.' },
        notes: { type: 'string', description: 'Optional internal notes.' },
      },
      required: ['title'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'create_job_template', args, async () => {
      const titre = champRequis(args.title, 'Le titre').slice(0, 200);
      const items = (Array.isArray(args.line_items) ? args.line_items : [])
        .filter((it: any) => String(it?.name || '').trim())
        .map((it: any) => ({
          name: String(it.name).trim().slice(0, 200),
          qty: Number.isFinite(Number(it.qty)) && Number(it.qty) > 0 ? Number(it.qty) : 1,
          unit_price_cents: Math.max(0, Math.round(Number(it.unit_price_cents) || 0)),
        }));
      const tags = (Array.isArray(args.tags) ? args.tags : []).map((t: any) => String(t).trim()).filter(Boolean).slice(0, 20);
      const { data, error } = await ctx.client
        .from('job_templates')
        .insert({
          org_id: ctx.orgId,
          created_by: ctx.userId,
          title: titre,
          description: args.description ? String(args.description).slice(0, 5000) : null,
          job_type: args.job_type ? String(args.job_type).slice(0, 80) : 'one_off',
          line_items: items,
          tags,
          notes: args.notes ? String(args.notes).slice(0, 5000) : null,
        })
        .select('id, title')
        .single();
      if (error) throw error;
      return { created: true, template_id: data.id, title: data.title, items_count: items.length, note: 'Gabarit de job enregistré — disponible au choix lors de la création d’un job dans Lume.' };
    }),
};

/* ═══════════════════════════════════════════════════════════════
   CALENDRIER — planifier / déplanifier un job
   ═══════════════════════════════════════════════════════════════ */

const scheduleJobTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'schedule_job',
    description:
      'Put an UNSCHEDULED (draft) job on the calendar — the same engine as dragging it from the '
      + 'unscheduled list. Optionally assign a team. For a job that already has a visit, use '
      + 'reschedule_job (move) or add_visit (extra visit) instead.',
    parameters: {
      type: 'object',
      properties: {
        job_id: { type: 'string', description: 'Job id.' },
        start_at: { type: 'string', description: 'ISO start datetime.' },
        end_at: { type: 'string', description: 'ISO end (default: start + 1 h).' },
        team_id: { type: 'string', description: 'Optional team id to assign the visit to.' },
      },
      required: ['job_id', 'start_at'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'schedule_job', args, async () => {
      const jobId = champRequis(args.job_id, 'Le job');
      const debut = instantIso(args.start_at, 'Le début');
      const fin = args.end_at ? instantIso(args.end_at, 'La fin') : new Date(debut.getTime() + 60 * 60_000);
      if (fin <= debut) throw new Error('La fin doit être après le début.');
      const job = await jobDeLOrg(ctx, jobId, 'id, job_number, title');
      // Même RPC que l'app (rpc_schedule_job) : crée la visite, recalcule
      // jobs.scheduled_at et le statut.
      const { data, error } = await ctx.client.rpc('rpc_schedule_job', {
        p_job_id: jobId,
        p_start_at: debut.toISOString(),
        p_end_at: fin.toISOString(),
        p_team_id: args.team_id ? String(args.team_id) : null,
        p_timezone: FUSEAU_ORG,
      });
      if (error) throw error;
      const ev: any = (data as any)?.event || data || {};
      const avert = ev.id
        ? await signalerTerrain(ctx, '/automations/events/appointment-created', { eventId: ev.id, jobId, startTime: ev.start_at || debut.toISOString() }, 'automatisations non déclenchées')
        : null;
      return {
        scheduled: true,
        job: { job_number: job.job_number, title: job.title },
        visit: { start_at: ev.start_at || debut.toISOString(), end_at: ev.end_at || fin.toISOString() },
        note: 'Job planifié au calendrier.',
        ...(avert ? { warning: avert } : {}),
      };
    }),
};

const unscheduleJobTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'unschedule_job',
    description:
      'Take a job OFF the calendar: removes ALL its visits and puts it back in the unscheduled list '
      + '(or only one visit when event_id is given). To drop just the next visit, cancel_visit is '
      + 'simpler. Confirm with the user first.',
    parameters: {
      type: 'object',
      properties: {
        job_id: { type: 'string', description: 'Job id.' },
        event_id: { type: 'string', description: 'Optional: remove only this visit (schedule event id).' },
      },
      required: ['job_id'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'unschedule_job', args, async () => {
      const jobId = champRequis(args.job_id, 'Le job');
      const job = await jobDeLOrg(ctx, jobId, 'id, job_number, title');
      let q = ctx.client
        .from('schedule_events').select('id, start_at')
        .eq('org_id', ctx.orgId).eq('job_id', jobId)
        .is('deleted_at', null);
      if (args.event_id) q = q.eq('id', String(args.event_id));
      const { data: visites, error } = await q;
      if (error) throw error;
      if (!visites?.length) throw new Error(args.event_id ? 'Cette visite est introuvable sur ce job.' : 'Ce job n’a aucune visite au calendrier.');
      // Même RPC que l'app : soft-delete + recompute_job_schedule (brouillon si plus de visite).
      const { error: rpcErr } = await ctx.client.rpc('rpc_unschedule_job', {
        p_job_id: jobId,
        p_event_id: args.event_id ? String(args.event_id) : null,
      });
      if (rpcErr) throw rpcErr;
      const avertissements: string[] = [];
      for (const v of visites) {
        const a = await signalerTerrain(ctx, '/automations/events/appointment-cancelled', { eventId: v.id, jobId }, 'automatisations non déclenchées');
        if (a) { avertissements.push(a); break; }
      }
      return {
        unscheduled: true,
        job: { job_number: job.job_number, title: job.title },
        visites_retirees: visites.length,
        note: args.event_id
          ? 'Visite retirée du calendrier.'
          : `${visites.length} visite(s) retirée(s) : le job repasse dans la liste « à planifier ».`,
        ...(avertissements.length ? { warning: avertissements[0] } : {}),
      };
    }),
};

/* ═══════════════════════════════════════════════════════════════
   LISTES DE VÉRIFICATION — instances sur un job + gabarits
   ═══════════════════════════════════════════════════════════════ */

const TYPES_ITEM = ['checkbox', 'text', 'number', 'photo', 'signature'] as const;

/** Items d'une liste, nettoyés comme le schéma Zod de routes/checklists.ts. */
function nettoyerItems(brut: any): Array<{ id: string; type: string; label: string; required: boolean }> {
  const liste = Array.isArray(brut) ? brut : [];
  if (liste.length > 200) throw new Error('Trop d’éléments (max 200).');
  return liste.map((it: any, i: number) => {
    const label = String(it?.label ?? '').trim();
    if (!label) throw new Error(`L'élément ${i + 1} n'a pas de libellé.`);
    const type = String(it?.type || 'checkbox');
    if (!(TYPES_ITEM as readonly string[]).includes(type)) throw new Error(`Type d'élément inconnu « ${type} » (checkbox, text, number, photo, signature).`);
    return {
      id: String(it?.id || `item-${i + 1}`).slice(0, 80),
      type,
      label: label.slice(0, 500),
      required: Boolean(it?.required),
    };
  });
}

const SCHEMA_ITEMS = {
  type: 'array',
  description: 'Checklist items.',
  items: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Stable item id (default item-N).' },
      type: { type: 'string', enum: [...TYPES_ITEM], description: "Item kind (default 'checkbox')." },
      label: { type: 'string', description: 'What to check or fill.' },
      required: { type: 'boolean' },
    },
    required: ['label'],
  },
};

function resumerChecklist(c: any): Record<string, any> {
  const items: any[] = Array.isArray(c.items) ? c.items : [];
  const reponses: Record<string, unknown> = c.responses && typeof c.responses === 'object' ? c.responses : {};
  return {
    id: c.id,
    template_id: c.template_id,
    statut: c.completed_at ? 'complétée' : 'en cours',
    completed_at: c.completed_at,
    items_count: items.length,
    items_done: items.filter((it) => reponses[it.id] !== undefined && reponses[it.id] !== null && reponses[it.id] !== false && reponses[it.id] !== '').length,
    items: items.slice(0, 50).map((it) => ({ id: it.id, label: it.label, type: it.type, required: Boolean(it.required), reponse: reponses[it.id] ?? null })),
  };
}

const listJobChecklistsTool: AgentTool = {
  kind: 'read',
  needsIdentity: true,
  declaration: {
    name: 'list_job_checklists',
    description: 'List the checklists attached to a job, with each item and its current answer (ticked or not). Get the job id from the jobs list.',
    parameters: {
      type: 'object',
      properties: { job_id: { type: 'string', description: 'Job id.' } },
      required: ['job_id'],
    },
  },
  handler: async (args, ctx) => {
    try {
      const { data, error } = await ctx.client
        .from('job_checklists')
        .select('id, template_id, items, responses, completed_at')
        .eq('org_id', ctx.orgId).eq('job_id', String(args.job_id))
        .order('created_at', { ascending: true })
        .limit(20);
      if (error) throw error;
      return { checklists: (data || []).map(resumerChecklist) };
    } catch (e) {
      return erreurLecture('list_job_checklists', e);
    }
  },
};

const createJobChecklistTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'create_job_checklist',
    description:
      'Attach a checklist to a job, either from a saved template (template_id, items copied) or ad hoc '
      + '(items). Get template ids from list_checklist_templates.',
    parameters: {
      type: 'object',
      properties: {
        job_id: { type: 'string', description: 'Job id.' },
        template_id: { type: 'string', description: 'Checklist template id (optional).' },
        items: SCHEMA_ITEMS,
      },
      required: ['job_id'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'create_job_checklist', args, async () => {
      const jobId = champRequis(args.job_id, 'Le job');
      const job = await jobDeLOrg(ctx, jobId, 'id, job_number, title');
      let items = nettoyerItems(args.items);
      if (args.template_id) {
        const { data: tpl, error } = await ctx.client
          .from('checklist_templates').select('id, items')
          .eq('org_id', ctx.orgId).eq('id', String(args.template_id))
          .maybeSingle();
        if (error) throw error;
        if (!tpl) throw new Error('Gabarit de liste introuvable.');
        items = Array.isArray(tpl.items) ? (tpl.items as any[]) : [];
      }
      if (!items.length) throw new Error('Une liste vide n’a pas de sens : donne des éléments ou un gabarit.');
      const { data, error } = await ctx.client
        .from('job_checklists')
        .insert({ org_id: ctx.orgId, job_id: jobId, template_id: args.template_id ? String(args.template_id) : null, items, responses: {} })
        .select('id')
        .single();
      if (error) throw error;
      return { created: true, checklist_id: data.id, job: { job_number: job.job_number, title: job.title }, items_count: items.length, note: `Liste de vérification ajoutée au job (${items.length} élément(s)).` };
    }),
};

const updateJobChecklistTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'update_job_checklist',
    description:
      "Tick or fill items of a job's checklist (responses: item id → value, true for a checkbox, text or "
      + 'number otherwise; existing answers are kept) and/or mark the whole checklist complete or not. '
      + 'Get checklist and item ids from list_job_checklists.',
    parameters: {
      type: 'object',
      properties: {
        job_id: { type: 'string', description: 'Job id.' },
        checklist_id: { type: 'string', description: 'Checklist id.' },
        responses: { type: 'object', description: 'Answers to merge: { "<item id>": true | "text" | 12 }.' },
        completed: { type: 'boolean', description: 'true = mark complete, false = reopen.' },
      },
      required: ['job_id', 'checklist_id'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'update_job_checklist', args, async () => {
      const jobId = champRequis(args.job_id, 'Le job');
      const checklistId = champRequis(args.checklist_id, 'La liste');
      const reponses = args.responses && typeof args.responses === 'object' && !Array.isArray(args.responses) ? args.responses as Record<string, unknown> : null;
      if (!reponses && args.completed === undefined) throw new Error('Rien à modifier — donne des réponses ou l’état complété.');
      const { data: existante, error: eLect } = await ctx.client
        .from('job_checklists').select('id, items, responses')
        .eq('org_id', ctx.orgId).eq('job_id', jobId).eq('id', checklistId)
        .maybeSingle();
      if (eLect) throw eLect;
      if (!existante) throw new Error('Liste introuvable sur ce job.');
      const patch: Record<string, any> = { updated_at: new Date().toISOString() };
      if (reponses) {
        const idsConnus = new Set((Array.isArray(existante.items) ? existante.items : []).map((it: any) => String(it?.id)));
        const inconnus = Object.keys(reponses).filter((k) => !idsConnus.has(k));
        if (inconnus.length) throw new Error(`Élément(s) inconnu(s) sur cette liste : ${inconnus.slice(0, 5).join(', ')}. Relis la liste avant de cocher.`);
        patch.responses = { ...(existante.responses && typeof existante.responses === 'object' ? existante.responses : {}), ...reponses };
      }
      if (args.completed !== undefined) {
        if (args.completed) { patch.completed_at = new Date().toISOString(); patch.completed_by = ctx.userId; }
        else { patch.completed_at = null; patch.completed_by = null; }
      }
      const { data, error } = await ctx.client
        .from('job_checklists')
        .update(patch)
        .eq('org_id', ctx.orgId).eq('job_id', jobId).eq('id', checklistId)
        .select('id, template_id, items, responses, completed_at')
        .single();
      if (error) throw error;
      const resume = resumerChecklist(data);
      return {
        updated: true,
        checklist: { id: resume.id, statut: resume.statut, items_count: resume.items_count, items_done: resume.items_done },
        note: args.completed === true ? 'Liste marquée complétée.' : args.completed === false ? 'Liste rouverte.' : `Réponses enregistrées (${resume.items_done}/${resume.items_count} éléments remplis).`,
      };
    }),
};

const deleteJobChecklistTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'delete_job_checklist',
    description: "Remove a checklist from a job (its answers are lost — same as the app's delete). Confirm with the user first.",
    parameters: {
      type: 'object',
      properties: {
        job_id: { type: 'string', description: 'Job id.' },
        checklist_id: { type: 'string', description: 'Checklist id.' },
      },
      required: ['job_id', 'checklist_id'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'delete_job_checklist', args, async () => {
      const jobId = champRequis(args.job_id, 'Le job');
      const checklistId = champRequis(args.checklist_id, 'La liste');
      // La table n'a pas de deleted_at : la route de l'app supprime la ligne, on fait pareil.
      const { data, error } = await ctx.client
        .from('job_checklists')
        .delete()
        .eq('org_id', ctx.orgId).eq('job_id', jobId).eq('id', checklistId)
        .select('id')
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('Liste introuvable sur ce job.');
      return { deleted: true, checklist_id: data.id, note: 'Liste de vérification retirée du job.' };
    }),
};

const listChecklistTemplatesTool: AgentTool = {
  kind: 'read',
  needsIdentity: true,
  declaration: {
    name: 'list_checklist_templates',
    description: 'List the company’s checklist templates (name, job type, number of items). Ids are needed to attach one to a job or edit it.',
    parameters: {
      type: 'object',
      properties: { include_inactive: { type: 'boolean', description: 'true = also list deactivated templates.' } },
    },
  },
  handler: async (args, ctx) => {
    try {
      let q = ctx.client
        .from('checklist_templates')
        .select('id, name, description, job_type, items, is_active')
        .eq('org_id', ctx.orgId)
        .order('updated_at', { ascending: false })
        .limit(50);
      if (!args.include_inactive) q = q.eq('is_active', true);
      const { data, error } = await q;
      if (error) throw error;
      return {
        templates: (data || []).map((t: any) => ({
          id: t.id, name: t.name, description: t.description, job_type: t.job_type,
          items_count: Array.isArray(t.items) ? t.items.length : 0,
          items: (Array.isArray(t.items) ? t.items : []).slice(0, 30).map((it: any) => ({ id: it.id, label: it.label, type: it.type })),
          statut: t.is_active ? 'actif' : 'désactivé',
        })),
      };
    } catch (e) {
      return erreurLecture('list_checklist_templates', e);
    }
  },
};

const createChecklistTemplateTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'create_checklist_template',
    description: 'Create a reusable checklist template (admin/owner only, like in Lume settings). Give the items to check.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Template name.' },
        description: { type: 'string' },
        job_type: { type: 'string', description: 'Optional job type this template is for.' },
        items: SCHEMA_ITEMS,
      },
      required: ['name', 'items'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'create_checklist_template', args, async () => {
      const nom = champRequis(args.name, 'Le nom').slice(0, 200);
      const items = nettoyerItems(args.items);
      if (!items.length) throw new Error('Un gabarit sans élément n’a pas de sens : donne au moins un élément.');
      const { data, error } = await ctx.client
        .from('checklist_templates')
        .insert({
          org_id: ctx.orgId,
          name: nom,
          description: args.description ? String(args.description).slice(0, 2000) : null,
          job_type: args.job_type ? String(args.job_type).slice(0, 100) : null,
          items,
          is_active: true,
        })
        .select('id, name')
        .single();
      if (error) throw error;
      return { created: true, template_id: data.id, name: data.name, items_count: items.length, note: 'Gabarit de liste créé.' };
    }),
};

const updateChecklistTemplateTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'update_checklist_template',
    description: 'Edit a checklist template: name, description, job type, items (REPLACES all items when given) or active flag. Only provided fields change. Admin/owner only.',
    parameters: {
      type: 'object',
      properties: {
        template_id: { type: 'string', description: 'Template id.' },
        name: { type: 'string' },
        description: { type: 'string' },
        job_type: { type: 'string' },
        items: SCHEMA_ITEMS,
        is_active: { type: 'boolean', description: 'false = hide from the pickers, true = reactivate.' },
      },
      required: ['template_id'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'update_checklist_template', args, async () => {
      const templateId = champRequis(args.template_id, 'Le gabarit');
      const patch: Record<string, any> = { updated_at: new Date().toISOString() };
      if (args.name !== undefined) patch.name = champRequis(args.name, 'Le nom').slice(0, 200);
      if (args.description !== undefined) patch.description = args.description ? String(args.description).slice(0, 2000) : null;
      if (args.job_type !== undefined) patch.job_type = args.job_type ? String(args.job_type).slice(0, 100) : null;
      if (args.items !== undefined) {
        patch.items = nettoyerItems(args.items);
        if (!patch.items.length) throw new Error('Un gabarit sans élément n’a pas de sens.');
      }
      if (args.is_active !== undefined) patch.is_active = Boolean(args.is_active);
      if (Object.keys(patch).length === 1) throw new Error('Rien à modifier — précise ce que tu veux changer.');
      const { data, error } = await ctx.client
        .from('checklist_templates')
        .update(patch)
        .eq('org_id', ctx.orgId).eq('id', templateId)
        .select('id, name, is_active, items')
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('Gabarit introuvable.');
      return { updated: true, template: { id: data.id, name: data.name, statut: data.is_active ? 'actif' : 'désactivé', items_count: Array.isArray(data.items) ? data.items.length : 0 }, note: 'Gabarit mis à jour.' };
    }),
};

const deleteChecklistTemplateTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'delete_checklist_template',
    description: 'Delete a checklist template (deactivated, like in Lume — checklists already attached to jobs are untouched). Admin/owner only. Confirm with the user first.',
    parameters: {
      type: 'object',
      properties: { template_id: { type: 'string', description: 'Template id.' } },
      required: ['template_id'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'delete_checklist_template', args, async () => {
      const templateId = champRequis(args.template_id, 'Le gabarit');
      // Comme la route DELETE de l'app : désactivation, pas de suppression physique.
      const { data, error } = await ctx.client
        .from('checklist_templates')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('org_id', ctx.orgId).eq('id', templateId)
        .select('id, name')
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('Gabarit introuvable.');
      return { deleted: true, template: { name: data.name }, note: 'Gabarit supprimé (désactivé) — les listes déjà attachées aux jobs restent.' };
    }),
};

/* ═══════════════════════════════════════════════════════════════
   ÉTIQUETTES DE JOBS
   ═══════════════════════════════════════════════════════════════ */

const listJobTagsTool: AgentTool = {
  kind: 'read',
  needsIdentity: true,
  declaration: {
    name: 'list_job_tags',
    description: 'List the company’s job tags (name, colour). Tag ids are needed to tag a job.',
    parameters: { type: 'object', properties: {} },
  },
  handler: async (_args, ctx) => {
    try {
      const { data, error } = await ctx.client
        .from('job_tags').select('id, name, color_hex')
        .eq('org_id', ctx.orgId).is('deleted_at', null)
        .order('name').limit(100);
      if (error) throw error;
      return { tags: data || [] };
    } catch (e) {
      return erreurLecture('list_job_tags', e);
    }
  },
};

const createJobTagTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'create_job_tag',
    description: 'Create a job tag (name + optional hex colour) that can then be put on jobs. Refuses a name that already exists.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Tag name.' },
        color_hex: { type: 'string', description: 'Colour like #3B82F6 (optional).' },
      },
      required: ['name'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'create_job_tag', args, async () => {
      const nom = champRequis(args.name, 'Le nom de l’étiquette').slice(0, 60);
      const couleur = args.color_hex ? String(args.color_hex).trim() : '#b8c4b0';
      if (!/^#[0-9a-fA-F]{6}$/.test(couleur)) throw new Error('La couleur doit être au format hexadécimal, ex. #3B82F6.');
      const { data: doublon, error: eDoublon } = await ctx.client
        .from('job_tags').select('id, name')
        .eq('org_id', ctx.orgId).is('deleted_at', null).ilike('name', nom)
        .limit(1).maybeSingle();
      if (eDoublon) throw eDoublon;
      if (doublon) throw new Error(`L'étiquette « ${doublon.name} » existe déjà — utilise-la plutôt.`);
      const { data, error } = await ctx.client
        .from('job_tags')
        .insert({ org_id: ctx.orgId, name: nom, color_hex: couleur })
        .select('id, name, color_hex')
        .single();
      if (error) throw error;
      return { created: true, tag: data, note: `Étiquette « ${data.name} » créée.` };
    }),
};

const setJobTagsTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'set_job_tags',
    description: "REPLACE a job's tags with the given tag ids (empty list = remove all tags). Get tag ids from list_job_tags and the job id from the jobs list.",
    parameters: {
      type: 'object',
      properties: {
        job_id: { type: 'string', description: 'Job id.' },
        tag_ids: { type: 'array', items: { type: 'string' }, description: 'Tag ids to set (replaces the current ones).' },
      },
      required: ['job_id', 'tag_ids'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'set_job_tags', args, async () => {
      const jobId = champRequis(args.job_id, 'Le job');
      const ids = [...new Set((Array.isArray(args.tag_ids) ? args.tag_ids : []).map((t: any) => String(t)).filter(Boolean))];
      if (ids.length > 20) throw new Error('Trop d’étiquettes sur un job (max 20).');
      const job = await jobDeLOrg(ctx, jobId, 'id, job_number, title');
      let noms: string[] = [];
      if (ids.length) {
        const { data: tags, error } = await ctx.client
          .from('job_tags').select('id, name')
          .eq('org_id', ctx.orgId).is('deleted_at', null).in('id', ids);
        if (error) throw error;
        const trouves = new Map((tags || []).map((t: any) => [t.id, t.name]));
        const manquants = ids.filter((id) => !trouves.has(id));
        if (manquants.length) throw new Error('Une ou plusieurs étiquettes sont introuvables dans cette entreprise — relis list_job_tags.');
        noms = ids.map((id) => String(trouves.get(id)));
      }
      const { error: eMaj } = await ctx.client
        .from('jobs')
        .update({ tag_ids: ids, updated_at: new Date().toISOString() })
        .eq('org_id', ctx.orgId).eq('id', jobId)
        .is('deleted_at', null);
      if (eMaj) throw eMaj;
      return {
        updated: true,
        job: { job_number: job.job_number, title: job.title },
        tags: noms,
        note: noms.length ? `Étiquettes du job : ${noms.join(', ')}.` : 'Toutes les étiquettes ont été retirées du job.',
      };
    }),
};

/* ═══════════════════════════════════════════════════════════════
   FACTURATION FRACTIONNÉE — jalons + facture par visite / par jalon
   ═══════════════════════════════════════════════════════════════ */

const saveJobBillingMilestonesTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'save_job_billing_milestones',
    description:
      "Set a job's payment schedule (billing milestones: deposit, on completion…). The list REPLACES "
      + 'the current schedule: milestones with an id are updated, without an id created, missing ones '
      + 'deleted. Amounts in CENTS. Optionally switch the job to split billing. Each milestone is then '
      + 'invoiced with create_invoice_for_milestone.',
    parameters: {
      type: 'object',
      properties: {
        job_id: { type: 'string', description: 'Job id.' },
        milestones: {
          type: 'array',
          description: 'Full schedule, in order.',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Existing milestone id (omit for a new one).' },
              label: { type: 'string', description: 'e.g. Dépôt, Fin des travaux.' },
              amount_cents: { type: 'integer', description: 'Amount in CENTS.' },
              percent: { type: 'number', description: 'Optional share of the job total (0-100), informative.' },
              due_date: { type: 'string', description: 'Optional due date YYYY-MM-DD.' },
            },
            required: ['label', 'amount_cents'],
          },
        },
        billing_split: { type: 'boolean', description: 'true = bill this job through these milestones; false = single invoice.' },
      },
      required: ['job_id', 'milestones'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'save_job_billing_milestones', args, async () => {
      const jobId = champRequis(args.job_id, 'Le job');
      const brouillons: any[] = Array.isArray(args.milestones) ? args.milestones : [];
      if (brouillons.length > 20) throw new Error('Trop de jalons (max 20).');
      const job = await jobDeLOrg(ctx, jobId, 'id, job_number, title, total_cents, billing_split');
      const jalons = brouillons.map((d, i) => {
        const label = champRequis(d?.label, `Le libellé du jalon ${i + 1}`).slice(0, 120);
        const montant = Number(d?.amount_cents);
        if (!Number.isInteger(montant) || montant < 0) throw new Error(`Le montant du jalon « ${label} » doit être un entier de cents positif.`);
        const pourcent = d?.percent === undefined || d?.percent === null ? null : Number(d.percent);
        if (pourcent !== null && (!Number.isFinite(pourcent) || pourcent < 0 || pourcent > 100)) throw new Error(`Le pourcentage du jalon « ${label} » doit être entre 0 et 100.`);
        return {
          id: d?.id ? String(d.id) : null,
          position: i,
          label,
          percent: pourcent,
          amount_cents: montant,
          due_date: d?.due_date ? dateSeule(d.due_date, `L'échéance du jalon « ${label} »`) : null,
        };
      });

      const { data: existants, error: eList } = await ctx.client
        .from('job_billing_milestones').select('id')
        .eq('org_id', ctx.orgId).eq('job_id', jobId);
      if (eList) throw eList;
      const idsExistants = new Set((existants || []).map((m: any) => String(m.id)));
      const idsGardes = new Set(jalons.map((j) => j.id).filter(Boolean) as string[]);
      for (const id of idsGardes) if (!idsExistants.has(id)) throw new Error('Un jalon cité est introuvable sur ce job — relis l’échéancier avant de le modifier.');
      const aSupprimer = [...idsExistants].filter((id) => !idsGardes.has(id));

      if (aSupprimer.length) {
        const { error } = await ctx.client
          .from('job_billing_milestones').delete()
          .eq('org_id', ctx.orgId).eq('job_id', jobId).in('id', aSupprimer);
        if (error) throw error;
      }
      for (const j of jalons) {
        const champs = { position: j.position, label: j.label, percent: j.percent, amount_cents: j.amount_cents, due_date: j.due_date };
        if (j.id) {
          const { error } = await ctx.client
            .from('job_billing_milestones')
            .update({ ...champs, updated_at: new Date().toISOString() })
            .eq('org_id', ctx.orgId).eq('job_id', jobId).eq('id', j.id);
          if (error) throw error;
        } else {
          const { error } = await ctx.client
            .from('job_billing_milestones')
            .insert({ ...champs, org_id: ctx.orgId, job_id: jobId });
          if (error) throw error;
        }
      }
      if (args.billing_split !== undefined) {
        const { error } = await ctx.client
          .from('jobs')
          .update({ billing_split: Boolean(args.billing_split), updated_at: new Date().toISOString() })
          .eq('org_id', ctx.orgId).eq('id', jobId);
        if (error) throw error;
      }

      const { data: frais, error: eFrais } = await ctx.client
        .from('job_billing_milestones')
        .select('id, position, label, percent, amount_cents, due_date')
        .eq('org_id', ctx.orgId).eq('job_id', jobId)
        .order('position', { ascending: true });
      if (eFrais) throw eFrais;
      const somme = (frais || []).reduce((s: number, m: any) => s + (Number(m.amount_cents) || 0), 0);
      const total = Number(job.total_cents) || 0;
      return {
        saved: true,
        job: { job_number: job.job_number, title: job.title },
        milestones: frais || [],
        sum_amount_cents: somme,
        job_total_cents: total,
        billing_split: args.billing_split !== undefined ? Boolean(args.billing_split) : Boolean(job.billing_split),
        note: `Échéancier enregistré : ${(frais || []).length} jalon(s), ${jalons.filter((j) => !j.id).length} créé(s), ${aSupprimer.length} supprimé(s).`
          + (total > 0 && somme !== total ? ` Attention : la somme des jalons (${(somme / 100).toFixed(2)} $) diffère du total du job (${(total / 100).toFixed(2)} $) — à signaler.` : ''),
      };
    }),
};

/** Facture d'une visite ou d'un jalon via la route de l'app (une seule logique de calcul). */
async function facturerDepuisJob(ctx: ToolContext, corps: Record<string, any>, quoi: string): Promise<Record<string, any>> {
  let res;
  try {
    res = await appelInterne(ctx, '/invoices/from-job', { ...corps, sendNow: false });
  } catch (e) {
    if (e instanceof AppelInterneIncertain) {
      // La facture a PEUT-ÊTRE été créée : on garde l'empreinte (résultat
      // renvoyé, pas levé) pour qu'une retentative ne crée pas de doublon.
      return { incertain: true, created: null, note: `Je n'ai pas eu la confirmation que la facture ${quoi} a été créée — vérifie la liste des factures avant de réessayer.` };
    }
    throw e;
  }
  const { ok, status, json } = res;
  if (!ok) throw new Error(json?.error || `Création refusée (${status}).`);
  if (json?.skipped) return { created: false, note: `Aucune facture créée : ${quoi} n'a aucun service à facturer.` };
  const statut = traduireStatut(json?.status, { draft: 'brouillon', sent: 'envoyée', paid: 'payée', overdue: 'en retard' }) || 'brouillon';
  return {
    created: !json?.already_exists,
    already_exists: Boolean(json?.already_exists),
    invoice_id: json?.invoice_id || json?.invoice?.id || null,
    invoice_number: json?.invoice?.invoice_number || null,
    statut,
    note: json?.already_exists
      ? `Cette ${quoi} avait déjà sa facture — rien n'a été créé en double.`
      : `Facture ${quoi} préparée en BROUILLON — rien n'est parti chez le client. send_invoice pour l'envoyer, avec confirmation.`,
  };
}

const createInvoiceForVisitTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'create_invoice_for_visit',
    description:
      'Invoice ONE visit of a per-visit billed job (billing_mode per_visit): the app computes the '
      + "visit's share of the job total. Idempotent — one visit = one invoice. The invoice stays a DRAFT; "
      + 'nothing is sent. Get the visit (schedule event) id from the job details or schedule.',
    parameters: {
      type: 'object',
      properties: {
        job_id: { type: 'string', description: 'Job id.' },
        visit_id: { type: 'string', description: 'Visit (schedule event) id.' },
      },
      required: ['job_id', 'visit_id'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'create_invoice_for_visit', args, async () => {
      const jobId = champRequis(args.job_id, 'Le job');
      const visitId = champRequis(args.visit_id, 'La visite');
      await jobDeLOrg(ctx, jobId, 'id');
      return facturerDepuisJob(ctx, { jobId, visitId }, 'de la visite');
    }),
};

const createInvoiceForMilestoneTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'create_invoice_for_milestone',
    description:
      'Invoice ONE billing milestone of a split-billed job (deposit, completion…). Idempotent — one '
      + 'milestone = one invoice. The invoice stays a DRAFT; nothing is sent. Get milestone ids from '
      + 'save_job_billing_milestones or the job details.',
    parameters: {
      type: 'object',
      properties: {
        job_id: { type: 'string', description: 'Job id.' },
        milestone_id: { type: 'string', description: 'Billing milestone id.' },
      },
      required: ['job_id', 'milestone_id'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'create_invoice_for_milestone', args, async () => {
      const jobId = champRequis(args.job_id, 'Le job');
      const milestoneId = champRequis(args.milestone_id, 'Le jalon');
      await jobDeLOrg(ctx, jobId, 'id');
      const { data: jalon, error } = await ctx.client
        .from('job_billing_milestones').select('id, label')
        .eq('org_id', ctx.orgId).eq('job_id', jobId).eq('id', milestoneId)
        .maybeSingle();
      if (error) throw error;
      if (!jalon) throw new Error('Jalon introuvable sur ce job.');
      return { milestone: { label: jalon.label }, ...(await facturerDepuisJob(ctx, { jobId, milestoneId }, `du jalon « ${jalon.label} »`)) };
    }),
};

/* ═══════════════════════════════════════════════════════════════
   CONTRATS (ententes de job)
   ═══════════════════════════════════════════════════════════════ */

const listJobAgreementsTool: AgentTool = {
  kind: 'read',
  needsIdentity: true,
  declaration: {
    name: 'list_job_agreements',
    description: 'List the contracts (agreements) attached to a job with their status (draft, sent, signed). Get the job id from the jobs list.',
    parameters: {
      type: 'object',
      properties: { job_id: { type: 'string', description: 'Job id.' } },
      required: ['job_id'],
    },
  },
  handler: async (args, ctx) => {
    try {
      const { data, error } = await ctx.client
        .from('job_agreements')
        .select('id, status, require_signature, sent_at, signed_at, signer_name, created_at')
        .eq('org_id', ctx.orgId).eq('job_id', String(args.job_id))
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(10);
      if (error) throw error;
      return {
        agreements: (data || []).map((a: any) => ({
          id: a.id,
          statut: traduireStatut(a.status, STATUT_CONTRAT) || a.status,
          signature_requise: a.require_signature !== false,
          sent_at: a.sent_at,
          signed_at: a.signed_at,
          signer_name: a.signer_name,
          created_at: a.created_at,
        })),
      };
    } catch (e) {
      return erreurLecture('list_job_agreements', e);
    }
  },
};

const createJobAgreementTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'create_job_agreement',
    description:
      'Create a DRAFT contract for a job (company branding + the job’s services and prices + terms, '
      + 'signable online). Refused when the job came from a quote (the signed quote is the contract). '
      + 'Nothing is sent: use send_agreement_email or send_agreement_sms afterwards.',
    parameters: {
      type: 'object',
      properties: {
        job_id: { type: 'string', description: 'Job id.' },
        terms: { type: 'string', description: 'Terms and conditions text (default: the standard French terms).' },
        require_signature: { type: 'boolean', description: 'Client must sign online (default true).' },
        client_id: { type: 'string', description: 'Client id (default: the job’s client).' },
      },
      required: ['job_id'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'create_job_agreement', args, async () => {
      const jobId = champRequis(args.job_id, 'Le job');
      const job = await jobDeLOrg(ctx, jobId, 'id, job_number, title, client_id');
      // Un job issu d'un devis a déjà son contrat : le devis signé (même
      // règle que l'app et que le trigger job_agreements_enforce_job_only).
      const { data: devis, error: eDevis } = await ctx.client
        .from('quotes').select('id')
        .eq('org_id', ctx.orgId).eq('job_id', jobId).is('deleted_at', null)
        .limit(1).maybeSingle();
      if (eDevis) throw eDevis;
      if (devis) throw new Error('Cette job possède déjà une soumission associée : la soumission sert de document contractuel, on ne peut pas ajouter de contrat.');
      const clientId = args.client_id ? String(args.client_id) : (job.client_id || null);
      if (!clientId) throw new Error('Ce job n’a pas de client : associe-lui un client avant de créer un contrat.');
      const { data, error } = await ctx.client
        .from('job_agreements')
        .insert({
          org_id: ctx.orgId,
          job_id: jobId,
          client_id: clientId,
          require_signature: args.require_signature === undefined ? true : Boolean(args.require_signature),
          terms: args.terms ? String(args.terms).slice(0, 20000) : CONDITIONS_CONTRAT_PAR_DEFAUT_FR,
          status: 'draft',
        })
        .select('id, status')
        .single();
      if (error) throw error;
      return {
        created: true,
        agreement_id: data.id,
        job: { job_number: job.job_number, title: job.title },
        statut: 'brouillon',
        note: 'Contrat créé en BROUILLON — rien n’est parti chez le client. send_agreement_email ou send_agreement_sms pour l’envoyer, avec confirmation.',
      };
    }),
};

/** Envoi d'un contrat par la route de l'app (courriel ou texto). */
async function envoyerContrat(ctx: ToolContext, agreementId: string, chemin: string, canal: 'email' | 'sms'): Promise<Record<string, any>> {
  // Garde d'org explicite avant l'appel de route (qui la refait avec la session).
  const { data: contrat, error } = await ctx.client
    .from('job_agreements').select('id, status, job_id')
    .eq('org_id', ctx.orgId).eq('id', agreementId).is('deleted_at', null)
    .maybeSingle();
  if (error) throw error;
  if (!contrat) throw new Error('Contrat introuvable.');
  if (!contrat.job_id) throw new Error('Ce contrat n’est plus actif : la soumission signée tient lieu de contrat.');
  let res;
  try {
    res = await appelInterne(ctx, chemin, { agreementId });
  } catch (e) {
    if (e instanceof AppelInterneIncertain) return envoiIncertain('le contrat');
    throw e;
  }
  const { ok, status, json } = res;
  if (!ok) throw new Error(json?.error || `Envoi refusé (${status}).`);
  return {
    sent: true,
    channel: canal,
    statut: contrat.status === 'signed' ? 'signé' : 'envoyé',
    note: canal === 'email'
      ? 'Le contrat est parti par courriel via le moteur d’envoi de Lume (lien de consultation et de signature).'
      : 'Le contrat est parti par texto via Lume (lien de consultation et de signature).',
  };
}

const sendAgreementEmailTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'send_agreement_email',
    description:
      "Email a job's contract to its client — IT ACTUALLY SENDS (view-and-sign link). ALWAYS show the "
      + 'user which contract goes to whom and get their explicit OK first. Get the agreement id from list_job_agreements.',
    parameters: {
      type: 'object',
      properties: { agreement_id: { type: 'string', description: 'Agreement id.' } },
      required: ['agreement_id'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'send_agreement_email', args, async () =>
      envoyerContrat(ctx, champRequis(args.agreement_id, 'Le contrat'), '/emails/send-agreement', 'email')),
};

const sendAgreementSmsTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'send_agreement_sms',
    description:
      "Text (SMS) a job's contract link to its client — IT ACTUALLY SENDS and cannot be recalled. ALWAYS "
      + 'show the user which contract goes to whom and get their explicit OK first. Get the agreement id from list_job_agreements.',
    parameters: {
      type: 'object',
      properties: { agreement_id: { type: 'string', description: 'Agreement id.' } },
      required: ['agreement_id'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'send_agreement_sms', args, async () =>
      envoyerContrat(ctx, champRequis(args.agreement_id, 'Le contrat'), '/agreements/send-sms', 'sms')),
};

/* ═══════════════════════════════════════════════════════════════
   DISPONIBILITÉS DES ÉQUIPES (heures d'ouverture du calendrier)
   ═══════════════════════════════════════════════════════════════ */

/** L'équipe existe-t-elle dans CETTE org ? */
async function equipeDeLOrg(ctx: ToolContext, teamId: string): Promise<{ id: string; name: string }> {
  const { data, error } = await ctx.client
    .from('teams').select('id, name')
    .eq('org_id', ctx.orgId).eq('id', teamId).is('deleted_at', null)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Équipe introuvable — vérifie l’id d’équipe.');
  return data as { id: string; name: string };
}

const listAvailabilityTool: AgentTool = {
  kind: 'read',
  needsIdentity: true,
  declaration: {
    name: 'list_availability',
    description: 'List the weekly availability windows of the teams (which weekdays and hours each team can be booked). Optionally for one team.',
    parameters: {
      type: 'object',
      properties: { team_id: { type: 'string', description: 'Only this team (optional).' } },
    },
  },
  handler: async (args, ctx) => {
    try {
      let q = ctx.client
        .from('team_availability_active')
        .select('id, team_id, weekday, start_minute, end_minute, timezone')
        .eq('org_id', ctx.orgId)
        .order('weekday', { ascending: true })
        .order('start_minute', { ascending: true })
        .limit(200);
      if (args.team_id) q = q.eq('team_id', String(args.team_id));
      const { data, error } = await q;
      if (error) throw error;
      const lignes = data || [];
      const teamIds = [...new Set(lignes.map((r: any) => r.team_id))];
      const noms = new Map<string, string>();
      if (teamIds.length) {
        const { data: equipes } = await ctx.client.from('teams').select('id, name').eq('org_id', ctx.orgId).in('id', teamIds);
        for (const t of equipes || []) noms.set(t.id, t.name);
      }
      return {
        availability: lignes.map((r: any) => ({
          id: r.id,
          team_id: r.team_id,
          team: noms.get(r.team_id) || null,
          jour: JOURS_FR[Number(r.weekday)] || String(r.weekday),
          weekday: r.weekday,
          start_time: minutesEnHeure(Number(r.start_minute)),
          end_time: minutesEnHeure(Number(r.end_minute)),
          timezone: r.timezone,
        })),
        ...(lignes.length ? {} : { note: 'Aucune disponibilité définie : set_default_availability pose lundi-vendredi 8 h à 17 h pour une équipe.' }),
      };
    } catch (e) {
      return erreurLecture('list_availability', e);
    }
  },
};

const createAvailabilityTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'create_availability',
    description:
      'Add a weekly availability window for a team (weekday + start/end time). A window starting at the '
      + 'same time on the same weekday is replaced. Get team ids from list_availability or the team list.',
    parameters: {
      type: 'object',
      properties: {
        team_id: { type: 'string', description: 'Team id.' },
        weekday: { type: 'integer', description: '0 = Sunday … 6 = Saturday.' },
        start_time: { type: 'string', description: 'Start HH:MM (24 h).' },
        end_time: { type: 'string', description: 'End HH:MM (24 h), after start.' },
        timezone: { type: 'string', description: 'IANA timezone (default America/Toronto, like the app).' },
      },
      required: ['team_id', 'weekday', 'start_time', 'end_time'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'create_availability', args, async () => {
      const teamId = champRequis(args.team_id, 'L’équipe');
      const weekday = entierBorne(args.weekday, 'Le jour de semaine', 0, 6);
      const debut = heureEnMinutes(args.start_time, 'L’heure de début');
      const fin = heureEnMinutes(args.end_time, 'L’heure de fin');
      if (fin <= debut) throw new Error('L’heure de fin doit être après l’heure de début.');
      const equipe = await equipeDeLOrg(ctx, teamId);
      // Même règle que l'app : une plage identique (équipe + jour + début) est remplacée.
      const { error: eDoublon } = await ctx.client
        .from('team_availability')
        .update({ deleted_at: new Date().toISOString() })
        .eq('org_id', ctx.orgId).eq('team_id', teamId).eq('weekday', weekday).eq('start_minute', debut)
        .is('deleted_at', null);
      if (eDoublon) throw eDoublon;
      const { data, error } = await ctx.client
        .from('team_availability')
        .insert({
          org_id: ctx.orgId, team_id: teamId, weekday, start_minute: debut, end_minute: fin,
          timezone: args.timezone ? String(args.timezone).slice(0, 60) : FUSEAU_DISPONIBILITES,
        })
        .select('id')
        .single();
      if (error) throw error;
      return {
        created: true,
        availability_id: data.id,
        team: equipe.name,
        note: `Disponibilité ajoutée : ${equipe.name}, ${JOURS_FR[weekday]} de ${minutesEnHeure(debut)} à ${minutesEnHeure(fin)}.`,
      };
    }),
};

const deleteAvailabilityTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'delete_availability',
    description: 'Remove one weekly availability window. Get the window id from list_availability. Confirm with the user first.',
    parameters: {
      type: 'object',
      properties: { availability_id: { type: 'string', description: 'Availability window id.' } },
      required: ['availability_id'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'delete_availability', args, async () => {
      const id = champRequis(args.availability_id, 'La plage de disponibilité');
      const { data, error } = await ctx.client
        .from('team_availability')
        .update({ deleted_at: new Date().toISOString() })
        .eq('org_id', ctx.orgId).eq('id', id).is('deleted_at', null)
        .select('id, weekday, start_minute, end_minute')
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('Plage de disponibilité introuvable.');
      return { deleted: true, note: `Plage retirée : ${JOURS_FR[Number(data.weekday)]} ${minutesEnHeure(Number(data.start_minute))}-${minutesEnHeure(Number(data.end_minute))}.` };
    }),
};

const setDefaultAvailabilityTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'set_default_availability',
    description: "Reset a team's weekly availability to the default Monday-Friday 8:00-17:00 (its current windows are all replaced). Confirm with the user first.",
    parameters: {
      type: 'object',
      properties: { team_id: { type: 'string', description: 'Team id.' } },
      required: ['team_id'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'set_default_availability', args, async () => {
      const teamId = champRequis(args.team_id, 'L’équipe');
      const equipe = await equipeDeLOrg(ctx, teamId);
      const { error: eClear } = await ctx.client
        .from('team_availability')
        .update({ deleted_at: new Date().toISOString() })
        .eq('org_id', ctx.orgId).eq('team_id', teamId).is('deleted_at', null);
      if (eClear) throw eClear;
      const lignes = [1, 2, 3, 4, 5].map((weekday) => ({
        org_id: ctx.orgId, team_id: teamId, weekday, start_minute: 480, end_minute: 1020, timezone: FUSEAU_DISPONIBILITES,
      }));
      const { data, error } = await ctx.client.from('team_availability').insert(lignes).select('id');
      if (error) throw error;
      return { reset: true, team: equipe.name, windows_count: (data || []).length, note: `Disponibilités de ${equipe.name} remises par défaut : lundi à vendredi, 8 h à 17 h.` };
    }),
};

/* ═══════════════════════════════════════════════════════════════
   TÂCHES — calendrier, duplication, actions en lot
   ═══════════════════════════════════════════════════════════════ */

const rescheduleTaskTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'reschedule_task',
    description:
      'Put a task on the calendar at a precise time, or move it — same as dragging it in the Lume '
      + 'calendar. Optional duration makes it a block. (update_task only changes the due date, not the time.)',
    parameters: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'Task id (from the tasks list).' },
        scheduled_at: { type: 'string', description: 'ISO datetime of the task.' },
        duration_minutes: { type: 'integer', description: 'Optional block length 1-1440 (0 = point in time).' },
      },
      required: ['task_id', 'scheduled_at'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'reschedule_task', args, async () => {
      const taskId = champRequis(args.task_id, 'La tâche');
      const quand = instantIso(args.scheduled_at, 'L’heure de la tâche');
      const duree = args.duration_minutes === undefined || Number(args.duration_minutes) === 0
        ? null
        : entierBorne(args.duration_minutes, 'La durée en minutes', 1, 1440);
      const { data, error } = await ctx.client
        .from('tasks')
        .update({ scheduled_at: quand.toISOString(), duration_minutes: duree, updated_at: new Date().toISOString() })
        .eq('org_id', ctx.orgId).eq('id', taskId).is('deleted_at', null)
        .select('id, title, scheduled_at, duration_minutes, status')
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('Tâche introuvable.');
      return {
        rescheduled: true,
        task: { title: data.title, scheduled_at: data.scheduled_at, duration_minutes: data.duration_minutes, statut: STATUT_TACHE[data.status] || data.status },
        note: duree ? `Tâche placée au calendrier (bloc de ${duree} min).` : 'Tâche placée au calendrier.',
      };
    }),
};

const duplicateTaskTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'duplicate_task',
    description: 'Duplicate a task (same title with « (copie) », description, priority, due date, links and assignee; the copy is open). Get the task id from the tasks list.',
    parameters: {
      type: 'object',
      properties: { task_id: { type: 'string', description: 'Task id to copy.' } },
      required: ['task_id'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'duplicate_task', args, async () => {
      const taskId = champRequis(args.task_id, 'La tâche');
      const { data: source, error: eSrc } = await ctx.client
        .from('tasks')
        .select('title, description, priority, type, due_date, linked_entity_type, linked_entity_id, linked_person_type, linked_person_id, assignee_user_id, team_id, job_id')
        .eq('org_id', ctx.orgId).eq('id', taskId).is('deleted_at', null)
        .maybeSingle();
      if (eSrc) throw eSrc;
      if (!source) throw new Error('Tâche introuvable.');
      const { data, error } = await ctx.client
        .from('tasks')
        .insert({
          org_id: ctx.orgId,
          created_by: ctx.userId,
          title: `${source.title} (copie)`.slice(0, 200),
          description: source.description,
          status: 'open',
          priority: source.priority,
          type: source.type,
          due_date: source.due_date,
          linked_entity_type: source.linked_entity_type,
          linked_entity_id: source.linked_entity_id,
          linked_person_type: source.linked_person_type,
          linked_person_id: source.linked_person_id,
          assignee_user_id: source.assignee_user_id,
          team_id: source.team_id,
          job_id: source.job_id,
        })
        .select('id, title, priority, due_date')
        .single();
      if (error) throw error;
      return {
        created: true,
        task: { id: data.id, title: data.title, priorite: PRIORITE_TACHE[data.priority] || data.priority, echeance: data.due_date, statut: 'à faire' },
        note: 'Tâche dupliquée (ouverte).',
      };
    }),
};

/** Ids de tâches d'un lot : dédoublonnés, bornés, non vides. */
function idsDeTaches(v: any): string[] {
  const ids = [...new Set((Array.isArray(v) ? v : []).map((t: any) => String(t ?? '').trim()).filter(Boolean))];
  if (!ids.length) throw new Error('Aucune tâche indiquée — donne au moins un id de tâche.');
  if (ids.length > 100) throw new Error('Trop de tâches d’un coup (max 100) — fractionne.');
  return ids;
}

const bulkUpdateTaskStatusTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'bulk_update_task_status',
    description: "Mark SEVERAL tasks done (or reopen them) in one call. Valid status: 'done', 'open'. Get task ids from the tasks list.",
    parameters: {
      type: 'object',
      properties: {
        task_ids: { type: 'array', items: { type: 'string' }, description: 'Task ids (max 100).' },
        status: { type: 'string', enum: ['done', 'open'], description: "'done' or 'open'." },
      },
      required: ['task_ids', 'status'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'bulk_update_task_status', args, async () => {
      const ids = idsDeTaches(args.task_ids);
      const statut = String(args.status);
      if (!['done', 'open'].includes(statut)) throw new Error("Statut invalide : 'done' ou 'open'.");
      const { data, error } = await ctx.client
        .from('tasks')
        .update({ status: statut, completed_at: statut === 'done' ? new Date().toISOString() : null, updated_at: new Date().toISOString() })
        .eq('org_id', ctx.orgId).in('id', ids).is('deleted_at', null)
        .select('id');
      if (error) throw error;
      const n = (data || []).length;
      return {
        updated_count: n,
        requested_count: ids.length,
        statut: STATUT_TACHE[statut],
        note: n === ids.length
          ? `${n} tâche(s) ${statut === 'done' ? 'terminée(s)' : 'rouverte(s)'}.`
          : `${n} tâche(s) sur ${ids.length} mise(s) à jour — les autres sont introuvables (déjà supprimées ?).`,
      };
    }),
};

const bulkDeleteTasksTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'bulk_delete_tasks',
    description: 'Delete SEVERAL tasks in one call (soft delete, like in Lume). Get task ids from the tasks list. Confirm with the user first.',
    parameters: {
      type: 'object',
      properties: { task_ids: { type: 'array', items: { type: 'string' }, description: 'Task ids (max 100).' } },
      required: ['task_ids'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'bulk_delete_tasks', args, async () => {
      const ids = idsDeTaches(args.task_ids);
      const { data, error } = await ctx.client
        .from('tasks')
        .update({ deleted_at: new Date().toISOString() })
        .eq('org_id', ctx.orgId).in('id', ids).is('deleted_at', null)
        .select('id');
      if (error) throw error;
      const n = (data || []).length;
      return {
        deleted_count: n,
        requested_count: ids.length,
        note: n === ids.length ? `${n} tâche(s) supprimée(s).` : `${n} tâche(s) sur ${ids.length} supprimée(s) — les autres étaient introuvables.`,
      };
    }),
};

/* ═══════════════════════════════════════════════════════════════
   MANIFESTES
   ═══════════════════════════════════════════════════════════════ */

export const OUTILS_TERRAIN: AgentTool[] = [
  // Jobs
  deleteJobTool,
  listRecurrenceRulesTool,
  createRecurrenceRuleTool,
  deactivateRecurrenceRuleTool,
  createJobTemplateTool,
  // Calendrier
  scheduleJobTool,
  unscheduleJobTool,
  // Listes de vérification
  listJobChecklistsTool,
  createJobChecklistTool,
  updateJobChecklistTool,
  deleteJobChecklistTool,
  listChecklistTemplatesTool,
  createChecklistTemplateTool,
  updateChecklistTemplateTool,
  deleteChecklistTemplateTool,
  // Étiquettes
  listJobTagsTool,
  createJobTagTool,
  setJobTagsTool,
  // Facturation fractionnée
  saveJobBillingMilestonesTool,
  createInvoiceForVisitTool,
  createInvoiceForMilestoneTool,
  // Contrats
  listJobAgreementsTool,
  createJobAgreementTool,
  sendAgreementEmailTool,
  sendAgreementSmsTool,
  // Disponibilités
  listAvailabilityTool,
  createAvailabilityTool,
  deleteAvailabilityTool,
  setDefaultAvailabilityTool,
  // Tâches
  rescheduleTaskTool,
  duplicateTaskTool,
  bulkUpdateTaskStatusTool,
  bulkDeleteTasksTool,
];

/**
 * Attributs des ÉCRITURES (même sémantique que registre.ts : sensible =
 * carte même en mode « argent » ; reversible = se défait dans l'app ;
 * vers_client = l'effet atteint le client). Une suppression est soft en base
 * mais irréversible pour l'utilisateur ; un envoi ne se rappelle pas.
 */
const A = (a: Partial<{ sensible: boolean; reversible: boolean; vers_client: boolean }>) =>
  ({ sensible: false, reversible: true, vers_client: false, ...a });

export const REGISTRE_TERRAIN: Record<string, { sensible: boolean; reversible: boolean; vers_client: boolean }> = {
  delete_job:                   A({ sensible: true, reversible: false }),
  create_recurrence_rule:       A({}),
  deactivate_recurrence_rule:   A({}),
  create_job_template:          A({}),
  schedule_job:                 A({}),
  unschedule_job:               A({ sensible: true, reversible: false }),   // retire des rendez-vous convenus avec le client
  create_job_checklist:         A({}),
  update_job_checklist:         A({}),
  delete_job_checklist:         A({ sensible: true, reversible: false }),   // les réponses sont perdues
  create_checklist_template:    A({}),
  update_checklist_template:    A({}),
  delete_checklist_template:    A({ sensible: true, reversible: false }),
  create_job_tag:               A({}),
  set_job_tags:                 A({}),
  save_job_billing_milestones:  A({ sensible: true }),                      // de l'argent (échéancier)
  create_invoice_for_visit:     A({ sensible: true }),
  create_invoice_for_milestone: A({ sensible: true }),
  create_job_agreement:         A({}),
  send_agreement_email:         A({ sensible: true, reversible: false, vers_client: true }),
  send_agreement_sms:           A({ sensible: true, reversible: false, vers_client: true }),
  create_availability:          A({}),
  delete_availability:          A({ sensible: true, reversible: false }),
  set_default_availability:     A({ sensible: true, reversible: false }),   // efface les plages existantes
  reschedule_task:              A({}),
  duplicate_task:               A({}),
  bulk_update_task_status:      A({}),
  bulk_delete_tasks:            A({ sensible: true, reversible: false }),
};

/** Permission de la page Rôles exigée par outil (même forme que PERMISSION_PAR_OUTIL). */
export const PERMISSIONS_TERRAIN: Record<string, { cle: PermissionKey; capacite: string }> = {
  delete_job:                   { cle: 'jobs.delete',      capacite: 'la suppression des jobs' },
  list_recurrence_rules:        { cle: 'jobs.read',        capacite: 'la consultation des jobs récurrents' },
  create_recurrence_rule:       { cle: 'jobs.update',      capacite: 'la récurrence des jobs' },
  deactivate_recurrence_rule:   { cle: 'jobs.update',      capacite: 'la récurrence des jobs' },
  create_job_template:          { cle: 'jobs.create',      capacite: 'la création de gabarits de job' },
  schedule_job:                 { cle: 'calendar.update',  capacite: 'la planification du calendrier' },
  unschedule_job:               { cle: 'calendar.update',  capacite: 'le retrait d’un job du calendrier' },
  list_job_checklists:          { cle: 'jobs.read',        capacite: 'la consultation des listes de vérification' },
  create_job_checklist:         { cle: 'jobs.update',      capacite: 'les listes de vérification des jobs' },
  update_job_checklist:         { cle: 'jobs.update',      capacite: 'les listes de vérification des jobs' },
  delete_job_checklist:         { cle: 'jobs.update',      capacite: 'les listes de vérification des jobs' },
  list_checklist_templates:     { cle: 'jobs.read',        capacite: 'la consultation des gabarits de listes' },
  // Gabarits = réglage d'entreprise (la RLS exige déjà un rôle admin/propriétaire).
  create_checklist_template:    { cle: 'settings.update',  capacite: 'les gabarits de listes (réglage d’entreprise)' },
  update_checklist_template:    { cle: 'settings.update',  capacite: 'les gabarits de listes (réglage d’entreprise)' },
  delete_checklist_template:    { cle: 'settings.update',  capacite: 'les gabarits de listes (réglage d’entreprise)' },
  list_job_tags:                { cle: 'jobs.read',        capacite: 'la consultation des étiquettes' },
  create_job_tag:               { cle: 'jobs.update',      capacite: 'les étiquettes de jobs' },
  set_job_tags:                 { cle: 'jobs.update',      capacite: 'les étiquettes de jobs' },
  save_job_billing_milestones:  { cle: 'invoices.create',  capacite: 'l’échéancier de facturation d’un job' },
  create_invoice_for_visit:     { cle: 'invoices.create',  capacite: 'la création de factures' },
  create_invoice_for_milestone: { cle: 'invoices.create',  capacite: 'la création de factures' },
  list_job_agreements:          { cle: 'jobs.read',        capacite: 'la consultation des contrats' },
  create_job_agreement:         { cle: 'jobs.update',      capacite: 'la création de contrats' },
  send_agreement_email:         { cle: 'messages.send',    capacite: 'l’envoi de contrats' },
  send_agreement_sms:           { cle: 'messages.send',    capacite: 'l’envoi de contrats' },
  list_availability:            { cle: 'calendar.read',    capacite: 'la consultation des disponibilités' },
  create_availability:          { cle: 'team.update',      capacite: 'les disponibilités des équipes' },
  delete_availability:          { cle: 'team.update',      capacite: 'les disponibilités des équipes' },
  set_default_availability:     { cle: 'team.update',      capacite: 'les disponibilités des équipes' },
  // Tâches : même clé que list_tasks / update_task (jobs.read, que tout rôle opérationnel possède).
  reschedule_task:              { cle: 'jobs.read',        capacite: 'la planification des tâches' },
  duplicate_task:               { cle: 'jobs.read',        capacite: 'la duplication des tâches' },
  bulk_update_task_status:      { cle: 'jobs.read',        capacite: 'la mise à jour des tâches' },
  bulk_delete_tasks:            { cle: 'jobs.read',        capacite: 'la suppression des tâches' },
};

/** Topic de chaque outil (un seul) : tout le terrain en planification, les tâches en équipe. */
export const TOPICS_TERRAIN: Partial<Record<IdTopic, string[]>> = {
  planification: [
    'delete_job', 'list_recurrence_rules', 'create_recurrence_rule', 'deactivate_recurrence_rule', 'create_job_template',
    'schedule_job', 'unschedule_job',
    'list_job_checklists', 'create_job_checklist', 'update_job_checklist', 'delete_job_checklist',
    'list_checklist_templates', 'create_checklist_template', 'update_checklist_template', 'delete_checklist_template',
    'list_job_tags', 'create_job_tag', 'set_job_tags',
    'save_job_billing_milestones', 'create_invoice_for_visit', 'create_invoice_for_milestone',
    'list_job_agreements', 'create_job_agreement', 'send_agreement_email', 'send_agreement_sms',
    'list_availability', 'create_availability', 'delete_availability', 'set_default_availability',
  ],
  equipe: ['reschedule_task', 'duplicate_task', 'bulk_update_task_status', 'bulk_delete_tasks'],
};
