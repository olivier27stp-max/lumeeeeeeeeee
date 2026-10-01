/* Recurring Job Scheduler — server-side CRON that creates jobs from recurrence rules
   Runs every 5 minutes. Checks job_recurrence_rules.next_run_at <= now() and creates new jobs.
*/

import { SupabaseClient } from '@supabase/supabase-js';
import { logger } from './logger';
import { heureLocale, instantLocal, jourLocal } from './dates-locales';

let intervalHandle: ReturnType<typeof setInterval> | null = null;

export function startRecurringJobScheduler(supabase: SupabaseClient) {
  logger.info('[recurring-jobs] scheduler started (interval: 5 min)');

  // Run immediately on startup
  void passageProtege(supabase);

  // Then every 5 minutes
  intervalHandle = setInterval(() => {
    void passageProtege(supabase);
  }, 5 * 60 * 1000);
}

/** Vrai pendant qu'un passage est en cours dans CE processus. */
let passageEnCours = false;

/**
 * Exécute un passage sous double protection.
 *
 * La création d'une occurrence et l'avancement de `next_run_at` ne sont pas
 * atomiques : deux passages concurrents créent DEUX jobs identiques, visibles
 * par l'utilisateur dans son calendrier. Le fichier documente déjà ce risque
 * pour le cas d'un échec d'écriture, sans le couvrir pour le cas concurrent.
 *
 * Garde locale (`passageEnCours`) contre le chevauchement de deux ticks dans
 * le même processus, verrou consultatif contre le multi-instance — comme tous
 * les autres crons du produit.
 */
async function passageProtege(supabase: SupabaseClient) {
  if (passageEnCours) {
    console.warn('[recurring-jobs] passage précédent encore en cours — ignoré');
    return;
  }
  passageEnCours = true;
  try {
    const { withAdvisoryLock } = await import('./advisory-lock');
    const { acquired } = await withAdvisoryLock('recurring-jobs', () => processRecurringJobs(supabase));
    if (!acquired) {
      logger.info('[recurring-jobs] passage pris par une autre instance — ignoré');
    }
  } catch (err: any) {
    console.error('[recurring-jobs] passage échoué:', err?.message);
  } finally {
    passageEnCours = false;
  }
}

export function stopRecurringJobScheduler() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

/** Exporté pour la suite d'intégration : `orgId` borne le passage à une entreprise. */
export async function processRecurringJobs(supabase: SupabaseClient, options: { orgId?: string } = {}) {
  try {
    const now = new Date().toISOString();

    // Find active rules that are due
    let lecture = supabase
      .from('job_recurrence_rules')
      // La clé étrangère est nommée EXPLICITEMENT : depuis le durcissement
      // multi-tenant du 30 juillet (20260751100200), job_recurrence_rules a DEUX
      // clés vers jobs — l'originale sur job_id, et une composite (job_id,
      // org_id) qui porte l'isolation. PostgREST ne pouvait plus choisir et
      // répondait PGRST201, donc AUCUN job récurrent n'était plus planifié
      // (constaté dans les journaux de production le 2026-07-31).
      .select('*, jobs!job_recurrence_rules_job_id_fkey!inner(id, org_id, client_id, property_id, title, description, job_type, property_address, team_id, created_by)')
      .eq('is_active', true)
      .lte('next_run_at', now);
    if (options.orgId) lecture = lecture.eq('org_id', options.orgId);
    const { data: rules, error } = await lecture.limit(50);

    if (error) {
      console.error('[recurring-jobs] fetch error:', error.message);
      return;
    }

    if (!rules || rules.length === 0) return;

    logger.info(`[recurring-jobs] processing ${rules.length} due rules`);

    for (const rule of rules) {
      try {
        const job = (rule as any).jobs;
        if (!job) continue;

        // Check max occurrences
        if (rule.max_occurrences && rule.occurrences_created >= rule.max_occurrences) {
          const { error: deactErr } = await supabase
            .from('job_recurrence_rules')
            .update({ is_active: false, updated_at: now })
            .eq('id', rule.id);
          // Sans cette desactivation la regle reste due et sera reexaminee a
          // chaque passage (toutes les 5 min) — bruit permanent, jamais visible.
          if (deactErr) console.error(`[recurring-jobs] failed to deactivate rule ${rule.id} (max occurrences):`, deactErr.message);
          continue;
        }

        // Check end_date
        if (rule.end_date && new Date(rule.end_date) < new Date()) {
          const { error: deactErr } = await supabase
            .from('job_recurrence_rules')
            .update({ is_active: false, updated_at: now })
            .eq('id', rule.id);
          if (deactErr) console.error(`[recurring-jobs] failed to deactivate rule ${rule.id} (end date):`, deactErr.message);
          continue;
        }

        // Calculate the scheduled_at for the new job occurrence
        //
        // Une série SANS heure (`local_time` nul) : son `next_run_at` ne porte
        // aucune heure voulue — minuit (Lumi : « date de début 05:00Z », soit
        // ~1 h du matin) ou l'heure à laquelle on a cliqué « Activer » dans
        // l'app. La visite prend l'heure du job d'origine dans le fuseau de
        // l'entreprise, sinon 9 h, et la série la garde (`local_time`).
        // Jamais une visite dans le passé : si cette heure est déjà passée ce
        // jour-là, CETTE occurrence garde son instant et les suivantes
        // prennent l'heure de la série.
        //
        // Série sans fuseau = celui de l'ENTREPRISE (colonne documentée « NULL =
        // hériter de company_settings.timezone »). Le repli 'America/Toronto'
        // passé en dur plaçait la visite de 9 h d'une entreprise de Vancouver à 6 h.
        const fuseau: string = rule.timezone || await fuseauEntreprise(supabase, job.org_id);
        let heureSerie: string | null = rule.local_time ? String(rule.local_time).slice(0, 5) : null;
        let nextDate = new Date(rule.next_run_at);
        if (!heureSerie) {
          heureSerie = await heureDeReference(supabase, job.org_id, job.id, fuseau);
          const vise = new Date(instantLocal(jourLocal(fuseau, nextDate), heureSerie, fuseau));
          if (vise.getTime() >= Date.now()) nextDate = vise;
        }
        const scheduledAt = nextDate.toISOString();

        // Create new job (clone from source)
        const { data: newJob, error: jobErr } = await supabase
          .from('jobs')
          .insert({
            org_id: job.org_id,
            client_id: job.client_id,
            property_id: job.property_id,
            title: job.title,
            description: job.description,
            job_type: job.job_type || 'recurring',
            property_address: job.property_address,
            team_id: job.team_id,
            created_by: job.created_by,
            status: 'scheduled',
            scheduled_at: scheduledAt,
            // `jobs` n'a pas de colonne source_job_id : l'inclure faisait
            // echouer l'insertion, donc AUCUN job recurrent n'etait jamais
            // cree. Le lien vers l'occurrence source vit dans
            // job_recurrence_rules.job_id.
          })
          .select('id')
          .single();

        if (jobErr) {
          console.error(`[recurring-jobs] failed to create job for rule ${rule.id}:`, jobErr.message);
          continue;
        }

        // Create schedule event for the new job
        if (newJob?.id) {
          const { data: newEvent, error: evtErr } = await supabase
            .from('schedule_events')
            .insert({
              org_id: job.org_id,
              job_id: newJob.id,
              // schedule_events n'a pas de client_id : le client se resout via le job.
              team_id: job.team_id,
              // Obligatoire hors contexte d'authentification (trigger) : sans
              // lui, CHAQUE visite récurrente était refusée (« created_by is
              // required when no auth context ») — le job existait, absent du
              // calendrier, sans confirmation ni rappel au client.
              created_by: job.created_by,
              start_at: scheduledAt,
              end_at: new Date(nextDate.getTime() + 2 * 60 * 60 * 1000).toISOString(), // 2h default
              status: 'scheduled',
            })
            .select('id')
            .single();
          // Job cree mais absent du calendrier : l'equipe ne le voit pas.
          if (evtErr) console.error(`[recurring-jobs] schedule_event insert failed for job ${newJob.id} (rule ${rule.id}):`, evtErr.message);

          // Déclenche les automatisations de rendez-vous : confirmation
          // immédiate, puis rappels J-7 / J-1 / 2 h.
          //
          // Ce chemin insérait directement dans `schedule_events` sans passer
          // par le bus : les clients d'une tournée récurrente — donc ceux qui
          // ont un contrat d'entretien, les plus fidèles — ne recevaient NI
          // confirmation NI rappel, alors que les visites planifiées à la main
          // en recevaient. Même panne que celle du modal « Nouveau job », sur
          // un autre chemin.
          //
          // Non bloquant : une automatisation muette ne doit pas interrompre
          // la génération des occurrences suivantes.
          // `appointment.created` naît du TRIGGER sur l'insertion de la visite
          // (launch 2026-09-28, bloc 2) : les tournées récurrentes le reçoivent
          // comme les visites planifiées à la main, sans émission ici.
        }

        // Calculate next occurrence.
        // N2.7 — le calcul se fait en heure LOCALE + fuseau du tenant, via la
        // fonction SQL next_recurrence_at(). L'ancienne version faisait
        // `setDate(+7)` sur un Date JS : cette arithmetique s'applique dans le
        // fuseau du PROCESSUS (UTC en production), si bien qu'une visite du
        // mardi 8 h passait a 7 h apres le changement d'heure — et le restait.
        const nextRunAt = await calculateNextRunTz(
          supabase,
          nextDate,
          rule.frequency,
          rule.interval_days || 7,
          fuseau,
          heureSerie,
        );

        // Update rule
        const { error: ruleErr } = await supabase
          .from('job_recurrence_rules')
          .update({
            occurrences_created: (rule.occurrences_created || 0) + 1,
            next_run_at: nextRunAt.toISOString(),
            // L'heure retenue pour une série qui n'en avait pas : écrite une
            // fois, elle ne dépend plus du job d'origine (ni d'un job déplacé).
            ...(rule.local_time ? {} : { local_time: heureSerie }),
            updated_at: now,
          })
          .eq('id', rule.id);

        if (ruleErr) {
          // ALERTE : next_run_at reste dans le passe, donc la regle sera de
          // nouveau « due » dans 5 minutes et CREERA UN JOB EN DOUBLE, puis un
          // autre, indefiniment. Il faut corriger la regle a la main.
          console.error(
            `[recurring-jobs] CRITICAL: rule ${rule.id} not advanced after creating job ${newJob?.id} — duplicate jobs will be created every run:`,
            ruleErr.message,
          );
          continue;
        }

        logger.info(`[recurring-jobs] created job ${newJob?.id} from rule ${rule.id}, next: ${nextRunAt.toISOString()}`);
      } catch (err: any) {
        console.error(`[recurring-jobs] error processing rule ${rule.id}:`, err?.message);
      }
    }
  } catch (err: any) {
    console.error('[recurring-jobs] scheduler error:', err?.message);
  }
}

/**
 * N2.7 — Prochaine occurrence, calculée en heure LOCALE + fuseau du tenant.
 *
 * Délègue à la fonction SQL `next_recurrence_at()` : elle avance la DATE locale
 * puis recompose l'instant en appliquant le fuseau, si bien que Postgres pose
 * le bon décalage horaire de part et d'autre du changement d'heure. Une visite
 * du mardi 8 h reste à 8 h — ce qui n'était pas le cas avec l'arithmétique JS.
 *
 * `timezone` NULL hérite de company_settings.timezone côté SQL ; le repli
 * 'America/Toronto' (identifiant IANA canonique de l'Est canadien) ne sert que
 * si le tenant n'a rien configuré.
 */
/** Heure de travail d'une visite récurrente quand aucune heure n'est connue. */
export const HEURE_VISITE_PAR_DEFAUT = '09:00';

/**
 * L'heure LOCALE (« HH:MM ») à laquelle une série place ses visites : celle du
 * job d'origine (`jobs.scheduled_at`), sinon de sa première visite au
 * calendrier, lue dans le fuseau de l'entreprise. Sans heure connue — ou
 * minuit pile, la marque d'une date saisie sans heure — : 9 h.
 *
 * Partagée par le passage des séries et par l'outil Lumi qui les crée
 * (tools-terrain.ts) : les deux doivent donner la même heure.
 */
export async function heureDeReference(supabase: SupabaseClient, orgId: string, jobId: string, fuseau: string): Promise<string> {
  const { data: job, error } = await supabase.from('jobs').select('scheduled_at').eq('id', jobId).eq('org_id', orgId).maybeSingle();
  if (error) console.error(`[recurring-jobs] heure du job ${jobId} illisible, repli ${HEURE_VISITE_PAR_DEFAUT}:`, error.message);
  let instant: string | null = (job as { scheduled_at?: string | null } | null)?.scheduled_at ?? null;
  if (!instant) {
    const { data: visite, error: eVisite } = await supabase.from('schedule_events').select('start_at')
      .eq('org_id', orgId).eq('job_id', jobId).is('deleted_at', null).not('start_at', 'is', null)
      .order('start_at', { ascending: true }).limit(1).maybeSingle();
    if (eVisite) console.error(`[recurring-jobs] visite du job ${jobId} illisible, repli ${HEURE_VISITE_PAR_DEFAUT}:`, eVisite.message);
    instant = (visite as { start_at?: string | null } | null)?.start_at ?? null;
  }
  if (!instant || Number.isNaN(new Date(instant).getTime())) return HEURE_VISITE_PAR_DEFAUT;
  const heure = heureLocale(instant, fuseau);
  return heure === '00:00' ? HEURE_VISITE_PAR_DEFAUT : heure;
}

/** Le jour civil suivant d'une série (« 2026-10-15 » → « 2026-10-22 » en hebdo). */
function jourSuivant(jour: string, freq: string, intervalJours: number): string {
  const [y, m, d] = jour.split('-').map(Number);
  if (freq === 'monthly') {
    // Comme Postgres (date + interval « 1 month ») : le 31 janvier donne la fin de février.
    const dernier = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    return new Date(Date.UTC(y, m, Math.min(d, dernier))).toISOString().slice(0, 10);
  }
  const pas = freq === 'daily' ? 1 : freq === 'weekly' ? 7 : freq === 'biweekly' ? 14 : Math.max(1, intervalJours);
  return new Date(Date.UTC(y, m - 1, d + pas)).toISOString().slice(0, 10);
}

/**
 * La première visite d'une série : le jour de début à l'heure LOCALE de la
 * série, dans le fuseau de l'entreprise ; si ce moment est passé, l'occurrence
 * suivante sur le même rythme (jamais « maintenant + 7 jours », qui donnait à
 * la série l'heure à laquelle on l'avait créée).
 */
export function premiereOccurrence(
  jourDebut: string, heure: string, fuseau: string, freq: string, intervalJours: number, maintenant: Date = new Date(),
): { jour: string; instant: string } {
  let jour = jourDebut;
  let instant = instantLocal(jour, heure, fuseau);
  for (let garde = 0; new Date(instant) <= maintenant && garde < 5000; garde++) {
    jour = jourSuivant(jour, freq, intervalJours);
    instant = instantLocal(jour, heure, fuseau);
  }
  return { jour, instant };
}

/** Fuseau de l'entreprise (company_settings.timezone), repli America/Toronto. */
export async function fuseauEntreprise(supabase: SupabaseClient, orgId: string): Promise<string> {
  const { data, error } = await supabase.from('company_settings').select('timezone').eq('org_id', orgId).maybeSingle();
  if (error) console.error('[recurring-jobs] fuseau de l’entreprise illisible, repli America/Toronto:', error.message);
  return (data as { timezone?: string | null } | null)?.timezone || 'America/Toronto';
}

async function calculateNextRunTz(
  supabase: SupabaseClient,
  from: Date,
  frequency: string,
  intervalDays: number,
  timezone: string | null,
  localTime: string | null,
): Promise<Date> {
  const { data, error } = await supabase.rpc('next_recurrence_at', {
    p_from: from.toISOString(),
    p_frequency: frequency,
    p_interval: intervalDays,
    p_timezone: timezone || 'America/Toronto',
    p_local_time: localTime,
  });

  if (error || !data) {
    // Repli volontairement conservateur : ne jamais bloquer la génération de la
    // série. Le décalage DST reste possible sur cette occurrence, mais un job
    // manquant serait plus grave qu'un job décalé d'une heure.
    console.error('[recurring-jobs] next_recurrence_at failed, fallback UTC:', error?.message);
    const next = new Date(from);
    const days = frequency === 'daily' ? 1
      : frequency === 'biweekly' ? 14
      : frequency === 'custom' ? intervalDays
      : 7;
    if (frequency === 'monthly') next.setMonth(next.getMonth() + 1);
    else next.setDate(next.getDate() + days);
    return next;
  }

  return new Date(data as string);
}
