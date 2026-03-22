/* ═══════════════════════════════════════════════════════════════
   Mr Lume — CRM Brain
   Fetches ALL context from the CRM for intelligent decisions.
   Called once at the start of every agent conversation turn.
   ═══════════════════════════════════════════════════════════════ */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface CRMBrainData {
  company: CompanyProfile;
  stats: CRMStats;
  teams: TeamProfile[];
  recentClients: ClientSummary[];
  recentJobs: JobSummary[];
  invoiceHealth: InvoiceHealth;
  leadPipeline: LeadPipeline;
  alerts: string[];
}

interface CompanyProfile {
  name: string;
  phone: string;
  email: string;
  address: string;
  timezone: string;
  currency: string;
  taxLines: any[];
}

interface CRMStats {
  totalClients: number;
  totalJobs: number;
  totalInvoices: number;
  totalRevenueCents: number;
  activeJobs: number;
  overdueInvoices: number;
  activeLeads: number;
  completedJobsLast30: number;
  avgJobValueCents: number;
  avgPaymentDays: number;
}

interface TeamProfile {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  activeJobCount: number;
  completedJobCount: number;
  completionRate: number;
}

interface ClientSummary {
  id: string;
  name: string;
  company: string | null;
  totalJobs: number;
  totalPaidCents: number;
  avgPaymentDays: number | null;
  lastJobDate: string | null;
  status: string;
}

interface JobSummary {
  id: string;
  title: string;
  status: string;
  clientName: string | null;
  teamId: string | null;
  totalCents: number;
  scheduledAt: string | null;
  jobType: string | null;
  isOverdue: boolean;
}

interface InvoiceHealth {
  totalDraft: number;
  totalSent: number;
  totalOverdue: number;
  totalOverdueCents: number;
  totalPaidLast30Cents: number;
  oldestOverdueDays: number;
  clientsOwing: { name: string; balanceCents: number }[];
}

interface LeadPipeline {
  newCount: number;
  contactedCount: number;
  qualifiedCount: number;
  totalPipelineValue: number;
  oldestUnactedDays: number;
  hotLeads: { name: string; value: number; daysSinceAction: number }[];
}

/**
 * Fetch the complete CRM brain — everything Mr Lume needs to know
 * about this organization to make intelligent decisions.
 */
export async function fetchCRMBrain(supabase: SupabaseClient, orgId: string): Promise<CRMBrainData> {
  const alerts: string[] = [];

  // ── Company Profile ──
  let company: CompanyProfile = { name: '', phone: '', email: '', address: '', timezone: 'America/Toronto', currency: 'CAD', taxLines: [] };
  try {
    const { data: cs } = await supabase.from('company_settings').select('*').eq('org_id', orgId).maybeSingle();
    if (cs) {
      company = {
        name: cs.company_name || cs.name || '',
        phone: cs.phone || '',
        email: cs.email || '',
        address: cs.address || '',
        timezone: cs.timezone || 'America/Toronto',
        currency: cs.currency || 'CAD',
        taxLines: cs.tax_lines || [],
      };
    }
  } catch { /* company_settings may not exist */ }

  // ── Teams with workload ──
  const teams: TeamProfile[] = [];
  try {
    const { data: teamRows } = await supabase.from('teams')
      .select('id, name, description, is_active')
      .eq('org_id', orgId).is('deleted_at', null);

    if (teamRows) {
      for (const t of teamRows) {
        const { count: activeCount } = await supabase.from('jobs')
          .select('*', { count: 'exact', head: true })
          .eq('org_id', orgId).eq('team_id', t.id).in('status', ['scheduled', 'in_progress']).is('deleted_at', null);

        const { count: completedCount } = await supabase.from('jobs')
          .select('*', { count: 'exact', head: true })
          .eq('org_id', orgId).eq('team_id', t.id).eq('status', 'completed').is('deleted_at', null);

        const { count: totalCount } = await supabase.from('jobs')
          .select('*', { count: 'exact', head: true })
          .eq('org_id', orgId).eq('team_id', t.id).is('deleted_at', null);

        const completionRate = (totalCount || 0) > 0 ? (completedCount || 0) / (totalCount || 1) : 0;

        teams.push({
          id: t.id,
          name: t.name,
          description: t.description,
          isActive: t.is_active,
          activeJobCount: activeCount || 0,
          completedJobCount: completedCount || 0,
          completionRate: Math.round(completionRate * 100),
        });

        if (t.is_active && (activeCount || 0) >= 5) {
          alerts.push(`Team "${t.name}" is overloaded with ${activeCount} active jobs`);
        }
      }
    }
  } catch { /* silent */ }

  // ── Global stats ──
  const stats: CRMStats = {
    totalClients: 0, totalJobs: 0, totalInvoices: 0, totalRevenueCents: 0,
    activeJobs: 0, overdueInvoices: 0, activeLeads: 0,
    completedJobsLast30: 0, avgJobValueCents: 0, avgPaymentDays: 0,
  };

  try {
    const [clients, jobs, invoices, activeJobs, leads] = await Promise.all([
      supabase.from('clients').select('*', { count: 'exact', head: true }).eq('org_id', orgId).is('deleted_at', null),
      supabase.from('jobs').select('*', { count: 'exact', head: true }).eq('org_id', orgId).is('deleted_at', null),
      supabase.from('invoices').select('*', { count: 'exact', head: true }).eq('org_id', orgId).is('deleted_at', null),
      supabase.from('jobs').select('*', { count: 'exact', head: true }).eq('org_id', orgId).in('status', ['scheduled', 'in_progress']).is('deleted_at', null),
      supabase.from('leads').select('*', { count: 'exact', head: true }).eq('org_id', orgId).in('status', ['new', 'contacted', 'qualified']).is('deleted_at', null),
    ]);

    stats.totalClients = clients.count || 0;
    stats.totalJobs = jobs.count || 0;
    stats.totalInvoices = invoices.count || 0;
    stats.activeJobs = activeJobs.count || 0;
    stats.activeLeads = leads.count || 0;

    // Revenue (sum of paid invoices)
    const { data: revData } = await supabase.from('invoices')
      .select('total_cents')
      .eq('org_id', orgId).eq('status', 'paid').is('deleted_at', null);
    stats.totalRevenueCents = (revData || []).reduce((sum, i) => sum + (i.total_cents || 0), 0);

    // Overdue invoices
    const { data: overdueData } = await supabase.from('invoices')
      .select('total_cents, balance_cents')
      .eq('org_id', orgId).eq('status', 'sent').is('deleted_at', null)
      .lt('due_date', new Date().toISOString().split('T')[0]);
    stats.overdueInvoices = overdueData?.length || 0;

    // Completed jobs last 30 days
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
    const { count: completed30 } = await supabase.from('jobs')
      .select('*', { count: 'exact', head: true })
      .eq('org_id', orgId).eq('status', 'completed').gte('completed_at', thirtyDaysAgo).is('deleted_at', null);
    stats.completedJobsLast30 = completed30 || 0;

    // Avg job value
    const { data: jobValues } = await supabase.from('jobs')
      .select('total_cents')
      .eq('org_id', orgId).is('deleted_at', null).gt('total_cents', 0);
    if (jobValues?.length) {
      stats.avgJobValueCents = Math.round(jobValues.reduce((s, j) => s + (j.total_cents || 0), 0) / jobValues.length);
    }

    // Avg payment days
    const { data: paidInvoices } = await supabase.from('invoices')
      .select('issued_at, paid_at')
      .eq('org_id', orgId).eq('status', 'paid').is('deleted_at', null)
      .not('issued_at', 'is', null).not('paid_at', 'is', null)
      .limit(50);
    if (paidInvoices?.length) {
      const totalDays = paidInvoices.reduce((s, i) => {
        const issued = new Date(i.issued_at).getTime();
        const paid = new Date(i.paid_at).getTime();
        return s + Math.max(0, (paid - issued) / 86400000);
      }, 0);
      stats.avgPaymentDays = Math.round(totalDays / paidInvoices.length);
    }
  } catch { /* silent */ }

  // ── Recent clients with history ──
  const recentClients: ClientSummary[] = [];
  try {
    const { data: clientRows } = await supabase.from('clients')
      .select('id, first_name, last_name, company, status')
      .eq('org_id', orgId).is('deleted_at', null)
      .order('updated_at', { ascending: false }).limit(15);

    if (clientRows) {
      for (const c of clientRows) {
        const { count: jobCount } = await supabase.from('jobs')
          .select('*', { count: 'exact', head: true })
          .eq('org_id', orgId).eq('client_id', c.id).is('deleted_at', null);

        const { data: payments } = await supabase.from('payments')
          .select('amount_cents')
          .eq('org_id', orgId).eq('client_id', c.id).eq('status', 'succeeded').is('deleted_at', null);
        const totalPaid = (payments || []).reduce((s, p) => s + (p.amount_cents || 0), 0);

        const { data: lastJob } = await supabase.from('jobs')
          .select('scheduled_at')
          .eq('org_id', orgId).eq('client_id', c.id).is('deleted_at', null)
          .order('scheduled_at', { ascending: false }).limit(1);

        recentClients.push({
          id: c.id,
          name: `${c.first_name} ${c.last_name}`,
          company: c.company,
          totalJobs: jobCount || 0,
          totalPaidCents: totalPaid,
          avgPaymentDays: null,
          lastJobDate: lastJob?.[0]?.scheduled_at || null,
          status: c.status || 'active',
        });
      }
    }
  } catch { /* silent */ }

  // ── Recent jobs ──
  const recentJobs: JobSummary[] = [];
  try {
    const { data: jobRows } = await supabase.from('jobs')
      .select('id, title, status, client_name, team_id, total_cents, scheduled_at, job_type')
      .eq('org_id', orgId).is('deleted_at', null)
      .order('created_at', { ascending: false }).limit(15);

    if (jobRows) {
      const now = Date.now();
      for (const j of jobRows) {
        const isOverdue = j.status === 'scheduled' && j.scheduled_at && new Date(j.scheduled_at).getTime() < now;
        recentJobs.push({
          id: j.id, title: j.title, status: j.status,
          clientName: j.client_name, teamId: j.team_id,
          totalCents: j.total_cents || 0,
          scheduledAt: j.scheduled_at, jobType: j.job_type,
          isOverdue: !!isOverdue,
        });
        if (isOverdue) alerts.push(`Job "${j.title}" is overdue`);
      }
    }
  } catch { /* silent */ }

  // ── Invoice health ──
  const invoiceHealth: InvoiceHealth = {
    totalDraft: 0, totalSent: 0, totalOverdue: 0, totalOverdueCents: 0,
    totalPaidLast30Cents: 0, oldestOverdueDays: 0, clientsOwing: [],
  };
  try {
    const today = new Date().toISOString().split('T')[0];
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();

    const [drafts, sent, overdue, paidRecent] = await Promise.all([
      supabase.from('invoices').select('*', { count: 'exact', head: true }).eq('org_id', orgId).eq('status', 'draft').is('deleted_at', null),
      supabase.from('invoices').select('*', { count: 'exact', head: true }).eq('org_id', orgId).eq('status', 'sent').is('deleted_at', null),
      supabase.from('invoices').select('id, balance_cents, due_date, client_id').eq('org_id', orgId).eq('status', 'sent').lt('due_date', today).is('deleted_at', null),
      supabase.from('invoices').select('total_cents').eq('org_id', orgId).eq('status', 'paid').gte('paid_at', thirtyDaysAgo).is('deleted_at', null),
    ]);

    invoiceHealth.totalDraft = drafts.count || 0;
    invoiceHealth.totalSent = sent.count || 0;
    invoiceHealth.totalOverdue = overdue.data?.length || 0;
    invoiceHealth.totalOverdueCents = (overdue.data || []).reduce((s, i) => s + (i.balance_cents || 0), 0);
    invoiceHealth.totalPaidLast30Cents = (paidRecent.data || []).reduce((s, i) => s + (i.total_cents || 0), 0);

    if (overdue.data?.length) {
      const oldestDue = overdue.data.reduce((oldest, i) => {
        const d = new Date(i.due_date).getTime();
        return d < oldest ? d : oldest;
      }, Date.now());
      invoiceHealth.oldestOverdueDays = Math.round((Date.now() - oldestDue) / 86400000);

      if (invoiceHealth.totalOverdue > 0) {
        alerts.push(`${invoiceHealth.totalOverdue} overdue invoice(s) totaling $${(invoiceHealth.totalOverdueCents / 100).toFixed(0)}`);
      }

      // Top clients owing
      const clientBalances = new Map<string, number>();
      for (const inv of overdue.data) {
        if (inv.client_id) {
          clientBalances.set(inv.client_id, (clientBalances.get(inv.client_id) || 0) + (inv.balance_cents || 0));
        }
      }
      for (const [clientId, balance] of clientBalances) {
        const client = recentClients.find(c => c.id === clientId);
        invoiceHealth.clientsOwing.push({ name: client?.name || clientId, balanceCents: balance });
      }
      invoiceHealth.clientsOwing.sort((a, b) => b.balanceCents - a.balanceCents);
    }
  } catch { /* silent */ }

  // ── Lead pipeline ──
  const leadPipeline: LeadPipeline = {
    newCount: 0, contactedCount: 0, qualifiedCount: 0,
    totalPipelineValue: 0, oldestUnactedDays: 0, hotLeads: [],
  };
  try {
    const { data: leads } = await supabase.from('leads')
      .select('id, first_name, last_name, status, value, updated_at')
      .eq('org_id', orgId).in('status', ['new', 'contacted', 'qualified']).is('deleted_at', null)
      .order('updated_at', { ascending: true });

    if (leads) {
      for (const l of leads) {
        if (l.status === 'new') leadPipeline.newCount++;
        if (l.status === 'contacted') leadPipeline.contactedCount++;
        if (l.status === 'qualified') leadPipeline.qualifiedCount++;
        leadPipeline.totalPipelineValue += Number(l.value) || 0;

        const daysSinceAction = Math.round((Date.now() - new Date(l.updated_at).getTime()) / 86400000);

        if (l.status === 'qualified' && daysSinceAction > 7) {
          leadPipeline.hotLeads.push({
            name: `${l.first_name} ${l.last_name}`,
            value: Number(l.value) || 0,
            daysSinceAction,
          });
        }
      }

      if (leads.length > 0) {
        leadPipeline.oldestUnactedDays = Math.round((Date.now() - new Date(leads[0].updated_at).getTime()) / 86400000);
      }

      if (leadPipeline.hotLeads.length > 0) {
        alerts.push(`${leadPipeline.hotLeads.length} qualified lead(s) need follow-up`);
      }
    }
  } catch { /* silent */ }

  // ── Jobs completed without invoice ──
  try {
    const { data: uninvoiced } = await supabase.from('jobs')
      .select('id, title')
      .eq('org_id', orgId).eq('status', 'completed').eq('requires_invoicing', true).is('deleted_at', null)
      .is('invoice_url', null).limit(5);

    if (uninvoiced?.length) {
      alerts.push(`${uninvoiced.length} completed job(s) need invoicing`);
    }
  } catch { /* silent */ }

  return { company, stats, teams, recentClients, recentJobs, invoiceHealth, leadPipeline, alerts };
}

/**
 * Analyze org patterns and store learned insights in memory.
 * Called periodically (not on every request — too expensive).
 */
export async function learnOrgPatterns(supabase: SupabaseClient, orgId: string): Promise<void> {
  try {
    // Detect primary business type from job types
    const { data: jobTypes } = await supabase.from('jobs')
      .select('job_type')
      .eq('org_id', orgId).is('deleted_at', null).not('job_type', 'is', null);

    if (jobTypes?.length) {
      const typeCounts = new Map<string, number>();
      jobTypes.forEach(j => { typeCounts.set(j.job_type, (typeCounts.get(j.job_type) || 0) + 1); });
      const sorted = [...typeCounts.entries()].sort((a, b) => b[1] - a[1]);
      const primaryType = sorted[0]?.[0];
      const allTypes = sorted.map(([t, c]) => `${t} (${c})`).join(', ');

      await supabase.from('memory_entities').upsert({
        org_id: orgId,
        entity_type: 'org_pattern',
        key: 'business_type',
        value: { primary: primaryType, all: allTypes, totalJobs: jobTypes.length },
        confidence: 0.9,
        source: 'auto_learn',
      }, { onConflict: 'org_id,entity_type,key' }).select();
    }

    // Detect pricing patterns
    const { data: pricedJobs } = await supabase.from('jobs')
      .select('job_type, total_cents')
      .eq('org_id', orgId).is('deleted_at', null).gt('total_cents', 0);

    if (pricedJobs?.length) {
      const byType = new Map<string, number[]>();
      pricedJobs.forEach(j => {
        const type = j.job_type || 'other';
        if (!byType.has(type)) byType.set(type, []);
        byType.get(type)!.push(j.total_cents);
      });

      const pricing: Record<string, { min: number; max: number; avg: number; count: number }> = {};
      for (const [type, prices] of byType) {
        prices.sort((a, b) => a - b);
        pricing[type] = {
          min: prices[0],
          max: prices[prices.length - 1],
          avg: Math.round(prices.reduce((s, p) => s + p, 0) / prices.length),
          count: prices.length,
        };
      }

      await supabase.from('memory_entities').upsert({
        org_id: orgId,
        entity_type: 'org_pattern',
        key: 'pricing_ranges',
        value: pricing,
        confidence: 0.85,
        source: 'auto_learn',
      }, { onConflict: 'org_id,entity_type,key' }).select();
    }

    // Detect seasonal patterns (jobs per month)
    const { data: jobDates } = await supabase.from('jobs')
      .select('created_at')
      .eq('org_id', orgId).is('deleted_at', null);

    if (jobDates?.length && jobDates.length >= 10) {
      const monthly = new Map<number, number>();
      jobDates.forEach(j => {
        const month = new Date(j.created_at).getMonth() + 1;
        monthly.set(month, (monthly.get(month) || 0) + 1);
      });

      const sorted = [...monthly.entries()].sort((a, b) => b[1] - a[1]);
      const busiest = sorted.slice(0, 3).map(([m]) => m);
      const slowest = sorted.slice(-3).map(([m]) => m);

      await supabase.from('memory_entities').upsert({
        org_id: orgId,
        entity_type: 'org_pattern',
        key: 'seasonal_pattern',
        value: { busiestMonths: busiest, slowestMonths: slowest, monthlyBreakdown: Object.fromEntries(monthly) },
        confidence: jobDates.length >= 30 ? 0.8 : 0.5,
        source: 'auto_learn',
      }, { onConflict: 'org_id,entity_type,key' }).select();
    }

    console.log(`[crm-brain] Org patterns learned for ${orgId}`);
  } catch (err: any) {
    console.warn('[crm-brain] Pattern learning failed:', err?.message);
  }
}

/**
 * Format the brain data into a string for the LLM prompt.
 */
export function formatBrainForPrompt(brain: CRMBrainData, language: 'en' | 'fr'): string {
  const fr = language === 'fr';
  const $ = (cents: number) => `$${(cents / 100).toFixed(0)}`;

  let out = '';

  // Company
  if (brain.company.name) {
    out += `\n${fr ? '## PROFIL ENTREPRISE' : '## COMPANY PROFILE'}\n`;
    out += `${fr ? 'Nom' : 'Name'}: ${brain.company.name}\n`;
    if (brain.company.phone) out += `${fr ? 'Tel' : 'Phone'}: ${brain.company.phone}\n`;
    if (brain.company.timezone) out += `Timezone: ${brain.company.timezone}\n`;
    out += `${fr ? 'Devise' : 'Currency'}: ${brain.company.currency}\n`;
  }

  // Alerts
  if (brain.alerts.length) {
    out += `\n${fr ? '## ALERTES ACTUELLES' : '## CURRENT ALERTS'}\n`;
    brain.alerts.forEach(a => { out += `- ${a}\n`; });
  }

  // Stats
  out += `\n${fr ? '## STATISTIQUES CRM' : '## CRM STATISTICS'}\n`;
  out += `- ${brain.stats.totalClients} clients, ${brain.stats.totalJobs} jobs, ${brain.stats.totalInvoices} invoices\n`;
  out += `- ${brain.stats.activeJobs} ${fr ? 'jobs actifs' : 'active jobs'}, ${brain.stats.activeLeads} ${fr ? 'leads actifs' : 'active leads'}\n`;
  out += `- ${fr ? 'Revenue total' : 'Total revenue'}: ${$(brain.stats.totalRevenueCents)}\n`;
  out += `- ${fr ? 'Jobs completes (30j)' : 'Jobs completed (30d)'}: ${brain.stats.completedJobsLast30}\n`;
  if (brain.stats.avgJobValueCents > 0) out += `- ${fr ? 'Valeur moyenne job' : 'Avg job value'}: ${$(brain.stats.avgJobValueCents)}\n`;
  if (brain.stats.avgPaymentDays > 0) out += `- ${fr ? 'Delai paiement moyen' : 'Avg payment delay'}: ${brain.stats.avgPaymentDays} ${fr ? 'jours' : 'days'}\n`;

  // Teams
  if (brain.teams.length) {
    out += `\n${fr ? '## EQUIPES' : '## TEAMS'}\n`;
    brain.teams.forEach(t => {
      out += `- ${t.name}${!t.isActive ? ' (INACTIVE)' : ''}: ${t.activeJobCount} ${fr ? 'jobs actifs' : 'active jobs'}, ${t.completedJobCount} ${fr ? 'completes' : 'completed'}, ${fr ? 'taux' : 'rate'} ${t.completionRate}%`;
      if (t.description) out += ` — ${t.description}`;
      out += '\n';
    });
  }

  // Invoice health
  out += `\n${fr ? '## SANTE FACTURATION' : '## INVOICE HEALTH'}\n`;
  out += `- ${brain.invoiceHealth.totalDraft} draft, ${brain.invoiceHealth.totalSent} ${fr ? 'envoyees' : 'sent'}, ${brain.invoiceHealth.totalOverdue} ${fr ? 'en retard' : 'overdue'}\n`;
  if (brain.invoiceHealth.totalOverdue > 0) {
    out += `- ${fr ? 'Montant en retard' : 'Overdue amount'}: ${$(brain.invoiceHealth.totalOverdueCents)} (${fr ? 'plus ancien' : 'oldest'}: ${brain.invoiceHealth.oldestOverdueDays}${fr ? 'j' : 'd'})\n`;
  }
  if (brain.invoiceHealth.totalPaidLast30Cents > 0) {
    out += `- ${fr ? 'Paye (30j)' : 'Paid (30d)'}: ${$(brain.invoiceHealth.totalPaidLast30Cents)}\n`;
  }
  if (brain.invoiceHealth.clientsOwing.length) {
    out += `- ${fr ? 'Clients avec solde du' : 'Clients owing'}: ${brain.invoiceHealth.clientsOwing.map(c => `${c.name} (${$(c.balanceCents)})`).join(', ')}\n`;
  }

  // Lead pipeline
  if (brain.leadPipeline.newCount + brain.leadPipeline.contactedCount + brain.leadPipeline.qualifiedCount > 0) {
    out += `\n${fr ? '## PIPELINE LEADS' : '## LEAD PIPELINE'}\n`;
    out += `- New: ${brain.leadPipeline.newCount}, ${fr ? 'Contactes' : 'Contacted'}: ${brain.leadPipeline.contactedCount}, ${fr ? 'Qualifies' : 'Qualified'}: ${brain.leadPipeline.qualifiedCount}\n`;
    out += `- ${fr ? 'Valeur pipeline' : 'Pipeline value'}: ${$(brain.leadPipeline.totalPipelineValue * 100)}\n`;
    if (brain.leadPipeline.hotLeads.length) {
      out += `- ${fr ? 'Leads chauds a relancer' : 'Hot leads needing follow-up'}:\n`;
      brain.leadPipeline.hotLeads.slice(0, 5).forEach(l => {
        out += `  - ${l.name} (${$(l.value * 100)}) — ${l.daysSinceAction}${fr ? 'j sans action' : 'd without action'}\n`;
      });
    }
  }

  // Top clients
  if (brain.recentClients.length) {
    out += `\n${fr ? '## CLIENTS RECENTS' : '## RECENT CLIENTS'}\n`;
    brain.recentClients.slice(0, 8).forEach(c => {
      out += `- ${c.name}${c.company ? ` (${c.company})` : ''}: ${c.totalJobs} jobs, ${$(c.totalPaidCents)} ${fr ? 'paye' : 'paid'}`;
      if (c.lastJobDate) out += `, ${fr ? 'dernier job' : 'last job'}: ${new Date(c.lastJobDate).toLocaleDateString()}`;
      out += '\n';
    });
  }

  // Recent jobs
  if (brain.recentJobs.length) {
    out += `\n${fr ? '## JOBS RECENTS' : '## RECENT JOBS'}\n`;
    brain.recentJobs.slice(0, 8).forEach(j => {
      out += `- ${j.title} [${j.status}${j.isOverdue ? ' OVERDUE' : ''}] — ${$(j.totalCents)}`;
      if (j.clientName) out += `, ${fr ? 'client' : 'client'}: ${j.clientName}`;
      if (j.jobType) out += `, type: ${j.jobType}`;
      out += '\n';
    });
  }

  return out;
}
