/* ═══════════════════════════════════════════════════════════════
   AI Context Builder
   Builds CRM context that gets injected into the system prompt
   so the LLM understands what the user is looking at.
   ═══════════════════════════════════════════════════════════════ */

import type { CRMContext } from './types';
import { getDashboardData, type DashboardData } from '../dashboardApi';
import en from '../../i18n/en';
import fr from '../../i18n/fr';

/**
 * Build a natural-language CRM context block for the system prompt.
 * This tells the LLM who the user is, what they're looking at, and
 * what data is available.
 */
export function buildCRMContextBlock(ctx: CRMContext, dashData?: DashboardData | null): string {
  const isFr = ctx.language === 'fr';
  const t = isFr ? fr : en;
  const lines: string[] = [];

  lines.push('## Current CRM Context\n');

  // User identity
  lines.push(`- **User**: ${ctx.userName} (${ctx.userRole})`);
  lines.push(`- **Organization**: ${ctx.orgName}`);
  lines.push(`- **Language**: ${t.agent.english}`);
  lines.push(`- **Current page**: ${ctx.currentRoute}`);

  // Active entity context
  if (ctx.activeEntity) {
    lines.push(`- **Viewing**: ${ctx.activeEntity.type} — ${ctx.activeEntity.label || ctx.activeEntity.id}`);
  }

  // Dashboard snapshot (lightweight summary for context)
  if (dashData) {
    lines.push('\n### Today\'s Snapshot');

    const appts = dashData.appointments;
    lines.push(`- Appointments today: ${appts.total} (${appts.completed} done, ${appts.remaining} remaining${appts.overdue > 0 ? `, ${appts.overdue} overdue` : ''})`);

    const wf = dashData.workflow;
    lines.push(`- Active leads: ${wf.quotes.activeLeads} | Quotes draft: ${wf.quotes.draft} | Approved: ${wf.quotes.approved}`);
    lines.push(`- Active jobs: ${wf.jobs.active}${wf.jobs.actionRequired > 0 ? ` (${wf.jobs.actionRequired} need action)` : ''}`);

    const perf = dashData.performance;
    const revToday = perf.revenue.today;
    lines.push(`- Revenue today: $${revToday.toLocaleString()}`);
    lines.push(`- New leads today: ${perf.newLeadsToday} | Conversion rate: ${perf.conversionRate}%`);

    if (perf.receivables.clientsOwing > 0) {
      lines.push(`- Outstanding receivables: $${perf.receivables.totalDue.toLocaleString()} across ${perf.receivables.clientsOwing} clients`);
    }
  }

  return lines.join('\n');
}

/**
 * Parse the current route to extract entity context.
 * e.g. "/clients/abc-123" → { type: 'client', id: 'abc-123' }
 */
export function parseRouteEntity(route: string): CRMContext['activeEntity'] | undefined {
  const patterns: { pattern: RegExp; type: CRMContext['activeEntity'] extends infer T ? T extends { type: infer U } ? U : never : never }[] = [
    { pattern: /^\/clients\/([a-f0-9-]+)/, type: 'client' },
    { pattern: /^\/leads\/([a-f0-9-]+)/, type: 'lead' },
    { pattern: /^\/jobs\/([a-f0-9-]+)/, type: 'job' },
    { pattern: /^\/invoices\/([a-f0-9-]+)/, type: 'invoice' },
    { pattern: /^\/schedule\/([a-f0-9-]+)/, type: 'schedule_event' },
  ];

  for (const { pattern, type } of patterns) {
    const match = route.match(pattern);
    if (match) {
      return { type, id: match[1] };
    }
  }
  return undefined;
}

/**
 * Fetch fresh dashboard data for context injection.
 * Returns null on failure (never blocks the chat).
 */
export async function fetchDashboardContext(): Promise<DashboardData | null> {
  try {
    return await getDashboardData();
  } catch {
    return null;
  }
}
