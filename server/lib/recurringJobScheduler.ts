/* Recurring Job Scheduler — server-side CRON that creates jobs from recurrence rules
   Runs every 5 minutes. Checks job_recurrence_rules.next_run_at <= now() and creates new jobs.
*/

import { SupabaseClient } from '@supabase/supabase-js';

let intervalHandle: ReturnType<typeof setInterval> | null = null;

export function startRecurringJobScheduler(supabase: SupabaseClient) {
  console.log('[recurring-jobs] scheduler started (interval: 5 min)');

  // Run immediately on startup
  void processRecurringJobs(supabase);

  // Then every 5 minutes
  intervalHandle = setInterval(() => {
    void processRecurringJobs(supabase);
  }, 5 * 60 * 1000);
}

export function stopRecurringJobScheduler() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

async function processRecurringJobs(supabase: SupabaseClient) {
  try {
    const now = new Date().toISOString();

    // Find active rules that are due
    const { data: rules, error } = await supabase
      .from('job_recurrence_rules')
      // La clé étrangère est nommée EXPLICITEMENT : depuis le durcissement
      // multi-tenant du 30 juillet (20260751100200), job_recurrence_rules a DEUX
      // clés vers jobs — l'originale sur job_id, et une composite (job_id,
      // org_id) qui porte l'isolation. PostgREST ne pouvait plus choisir et
      // répondait PGRST201, donc AUCUN job récurrent n'était plus planifié
      // (constaté dans les journaux de production le 2026-07-31).
      .select('*, jobs!job_recurrence_rules_job_id_fkey!inner(id, org_id, client_id, property_id, title, description, job_type, property_address, team_id, created_by)')
      .eq('is_active', true)
      .lte('next_run_at', now)
      .limit(50);

    if (error) {
      console.error('[recurring-jobs] fetch error:', error.message);
      return;
    }

    if (!rules || rules.length === 0) return;

    console.log(`[recurring-jobs] processing ${rules.length} due rules`);

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
        const nextDate = new Date(rule.next_run_at);
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
          const { error: evtErr } = await supabase.from('schedule_events').insert({
            org_id: job.org_id,
            job_id: newJob.id,
            // schedule_events n'a pas de client_id : le client se resout via le job.
            team_id: job.team_id,
            start_at: scheduledAt,
            end_at: new Date(nextDate.getTime() + 2 * 60 * 60 * 1000).toISOString(), // 2h default
            status: 'scheduled',
          });
          // Job cree mais absent du calendrier : l'equipe ne le voit pas.
          if (evtErr) console.error(`[recurring-jobs] schedule_event insert failed for job ${newJob.id} (rule ${rule.id}):`, evtErr.message);
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
          rule.timezone,
          rule.local_time,
        );

        // Update rule
        const { error: ruleErr } = await supabase
          .from('job_recurrence_rules')
          .update({
            occurrences_created: (rule.occurrences_created || 0) + 1,
            next_run_at: nextRunAt.toISOString(),
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

        console.log(`[recurring-jobs] created job ${newJob?.id} from rule ${rule.id}, next: ${nextRunAt.toISOString()}`);
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
