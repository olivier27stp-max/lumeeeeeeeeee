/**
 * Automated alerts engine — scans all orgs for configured alert rules
 * and creates notifications when thresholds are exceeded.
 *
 * Exported: runAlertScan()
 * Called from server/index.ts on a 30-minute interval.
 */

import { getServiceClient } from './supabase';

interface AlertRule {
  id: string;
  org_id: string;
  rule_type: string;
  enabled: boolean;
  threshold_days: number | null;
  threshold_count: number | null;
  notify_email: boolean;
}

/**
 * Run a full alert scan across all orgs with enabled rules.
 */
export async function runAlertScan(): Promise<void> {
  const sb = getServiceClient();

  // Fetch all enabled alert rules
  const { data: rules, error } = await sb
    .from('alert_rules')
    .select('*')
    .eq('enabled', true);

  if (error) {
    console.error('[alerts] Failed to fetch rules:', error.message);
    return;
  }

  if (!rules || rules.length === 0) return;

  for (const rule of rules as AlertRule[]) {
    try {
      await processRule(sb, rule);
    } catch (err: any) {
      console.error(`[alerts] Error processing rule ${rule.rule_type} for org ${rule.org_id}:`, err?.message);
    }
  }
}

async function processRule(sb: ReturnType<typeof getServiceClient>, rule: AlertRule): Promise<void> {
  switch (rule.rule_type) {
    case 'invoice_overdue':
      await checkInvoiceOverdue(sb, rule);
      break;
    case 'client_inactive':
      await checkClientInactive(sb, rule);
      break;
    case 'team_overload':
      await checkTeamOverload(sb, rule);
      break;
    case 'low_pipeline':
      await checkLowPipeline(sb, rule);
      break;
    default:
      // Unknown rule type — skip
      break;
  }
}

async function checkInvoiceOverdue(sb: ReturnType<typeof getServiceClient>, rule: AlertRule): Promise<void> {
  const days = rule.threshold_days || 30;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  const { data: invoices } = await sb
    .from('invoices')
    .select('id, invoice_number, client_id, due_date')
    .eq('org_id', rule.org_id)
    .eq('status', 'sent')
    .lt('due_date', cutoff.toISOString());

  if (!invoices || invoices.length === 0) return;

  for (const inv of invoices) {
    await createNotificationIfNotExists(sb, {
      org_id: rule.org_id,
      type: 'alert',
      category: 'invoice_overdue',
      title: `Invoice ${inv.invoice_number || inv.id} is overdue`,
      body: `This invoice has been overdue for more than ${days} days.`,
      entity_type: 'invoice',
      entity_id: inv.id,
    });
  }
}

async function checkClientInactive(sb: ReturnType<typeof getServiceClient>, rule: AlertRule): Promise<void> {
  const days = rule.threshold_days || 30;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  const { data: clients } = await sb
    .from('clients')
    .select('id, name')
    .eq('org_id', rule.org_id)
    .lt('updated_at', cutoff.toISOString());

  if (!clients || clients.length === 0) return;

  for (const client of clients) {
    await createNotificationIfNotExists(sb, {
      org_id: rule.org_id,
      type: 'alert',
      category: 'client_inactive',
      title: `Client "${client.name}" inactive`,
      body: `No activity for more than ${days} days.`,
      entity_type: 'client',
      entity_id: client.id,
    });
  }
}

async function checkTeamOverload(sb: ReturnType<typeof getServiceClient>, rule: AlertRule): Promise<void> {
  const maxJobs = rule.threshold_count || 5;

  const { data: members } = await sb
    .from('memberships')
    .select('user_id')
    .eq('org_id', rule.org_id);

  if (!members || members.length === 0) return;

  for (const member of members) {
    const { count } = await sb
      .from('jobs')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', rule.org_id)
      .eq('assigned_to', member.user_id)
      .in('status', ['in_progress', 'scheduled', 'pending']);

    if (count && count >= maxJobs) {
      await createNotificationIfNotExists(sb, {
        org_id: rule.org_id,
        type: 'alert',
        category: 'team_overload',
        title: 'Team member overloaded',
        body: `A team member has ${count} active jobs (threshold: ${maxJobs}).`,
        entity_type: 'team',
        entity_id: member.user_id,
      });
    }
  }
}

async function checkLowPipeline(sb: ReturnType<typeof getServiceClient>, rule: AlertRule): Promise<void> {
  const threshold = rule.threshold_count || 5;

  const { count } = await sb
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', rule.org_id)
    .in('status', ['new', 'contacted', 'qualified']);

  if (count !== null && count < threshold) {
    await createNotificationIfNotExists(sb, {
      org_id: rule.org_id,
      type: 'alert',
      category: 'low_pipeline',
      title: 'Low pipeline warning',
      body: `Only ${count} active leads in the pipeline (threshold: ${threshold}).`,
      entity_type: undefined,
      entity_id: undefined,
    });
  }
}

async function createNotificationIfNotExists(
  sb: ReturnType<typeof getServiceClient>,
  notification: {
    org_id: string;
    type: string;
    category: string;
    title: string;
    body: string;
    entity_type?: string;
    entity_id?: string;
  },
): Promise<void> {
  // Avoid duplicates — check if a similar unread notification exists in the last 24h
  const since = new Date();
  since.setHours(since.getHours() - 24);

  const query = sb
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', notification.org_id)
    .eq('category', notification.category)
    .is('read_at', null)
    .gte('created_at', since.toISOString());

  if (notification.entity_id) {
    query.eq('entity_id', notification.entity_id);
  }

  const { count } = await query;
  if (count && count > 0) return;

  await sb.from('notifications').insert(notification);
}
