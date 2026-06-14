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
      .select('*, jobs!inner(id, org_id, client_id, property_id, title, description, job_type, property_address, team_id, created_by)')
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
          await supabase
            .from('job_recurrence_rules')
            .update({ is_active: false, updated_at: now })
            .eq('id', rule.id);
          continue;
        }

        // Check end_date
        if (rule.end_date && new Date(rule.end_date) < new Date()) {
          await supabase
            .from('job_recurrence_rules')
            .update({ is_active: false, updated_at: now })
            .eq('id', rule.id);
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
            source_job_id: job.id,
          })
          .select('id')
          .single();

        if (jobErr) {
          console.error(`[recurring-jobs] failed to create job for rule ${rule.id}:`, jobErr.message);
          continue;
        }

        // Create schedule event for the new job
        if (newJob?.id) {
          await supabase.from('schedule_events').insert({
            org_id: job.org_id,
            job_id: newJob.id,
            client_id: job.client_id,
            team_id: job.team_id,
            start_at: scheduledAt,
            end_at: new Date(nextDate.getTime() + 2 * 60 * 60 * 1000).toISOString(), // 2h default
            status: 'scheduled',
          });
        }

        // Calculate next occurrence
        const nextRunAt = calculateNextRun(nextDate, rule.frequency, rule.interval_days || 7);

        // Update rule
        await supabase
          .from('job_recurrence_rules')
          .update({
            occurrences_created: (rule.occurrences_created || 0) + 1,
            next_run_at: nextRunAt.toISOString(),
            updated_at: now,
          })
          .eq('id', rule.id);

        console.log(`[recurring-jobs] created job ${newJob?.id} from rule ${rule.id}, next: ${nextRunAt.toISOString()}`);
      } catch (err: any) {
        console.error(`[recurring-jobs] error processing rule ${rule.id}:`, err?.message);
      }
    }
  } catch (err: any) {
    console.error('[recurring-jobs] scheduler error:', err?.message);
  }
}

function calculateNextRun(from: Date, frequency: string, intervalDays: number): Date {
  const next = new Date(from);
  switch (frequency) {
    case 'daily':
      next.setDate(next.getDate() + 1);
      break;
    case 'weekly':
      next.setDate(next.getDate() + 7);
      break;
    case 'biweekly':
      next.setDate(next.getDate() + 14);
      break;
    case 'monthly':
      next.setMonth(next.getMonth() + 1);
      break;
    case 'custom':
      next.setDate(next.getDate() + intervalDays);
      break;
    default:
      next.setDate(next.getDate() + 7);
  }
  return next;
}
