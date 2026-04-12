/* ═══════════════════════════════════════════════════════════════
   Scheduled Reports — Cron job that sends insights via email
   ═══════════════════════════════════════════════════════════════ */

import { Resend } from 'resend';
import { getServiceClient } from './supabase';
import { resendApiKey, emailFrom } from './config';

function fmtMoney(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format((cents || 0) / 100);
}

interface ReportData {
  orgName: string;
  period: string;
  newLeads: number;
  newJobs: number;
  revenue: number;
  invoiced: number;
  conversionRate: number;
  outstandingBalance: number;
  topClients: Array<{ name: string; revenue: number }>;
  churnAlerts: number;
}

async function gatherReportData(orgId: string, from: string, to: string): Promise<ReportData> {
  const admin = getServiceClient();

  // Org name
  const { data: org } = await admin.from('organizations').select('name').eq('id', orgId).maybeSingle();

  // Overview via RPC
  const { data: overview } = await admin.rpc('rpc_insights_overview', { p_org: orgId, p_from: from, p_to: to });
  const ov = Array.isArray(overview) ? overview[0] : overview;

  // Lead conversion
  const { data: conv } = await admin.rpc('rpc_insights_lead_conversion', { p_org: orgId, p_from: from, p_to: to });
  const cv = Array.isArray(conv) ? conv[0] : conv;

  // Invoices summary
  const { data: inv } = await admin.rpc('rpc_insights_invoices_summary', { p_org: orgId, p_from: from, p_to: to });
  const iv = Array.isArray(inv) ? inv[0] : inv;

  // Top clients by revenue
  const { data: topClients } = await admin.rpc('rpc_insights_client_lifetime_value', { p_org: orgId, p_limit: 5 });

  // Churn alerts
  const { data: churn } = await admin.rpc('rpc_insights_churn_risk', { p_org: orgId, p_limit: 100 });
  const highRisk = (churn || []).filter((c: any) => c.risk_level === 'high').length;

  return {
    orgName: org?.name || 'Your Organization',
    period: `${from} to ${to}`,
    newLeads: Number(ov?.new_leads_count || 0),
    newJobs: Number(ov?.new_oneoff_jobs_count || 0),
    revenue: Number(ov?.revenue_cents || 0),
    invoiced: Number(ov?.invoiced_value_cents || 0),
    conversionRate: Number(cv?.conversion_rate || 0),
    outstandingBalance: Number(iv?.total_outstanding_cents || 0),
    topClients: (topClients || []).slice(0, 5).map((c: any) => ({ name: c.client_name, revenue: Number(c.total_revenue_cents || 0) })),
    churnAlerts: highRisk,
  };
}

function buildEmailHtml(data: ReportData): string {
  const topClientsHtml = data.topClients.length > 0
    ? data.topClients.map((c) => `<tr><td style="padding:6px 12px;border-bottom:1px solid #eee">${c.name}</td><td style="padding:6px 12px;border-bottom:1px solid #eee;text-align:right;font-weight:600">${fmtMoney(c.revenue)}</td></tr>`).join('')
    : '<tr><td colspan="2" style="padding:12px;text-align:center;color:#999">No data</td></tr>';

  return `
<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f5f5f5;padding:20px">
<div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08)">
  <div style="background:#111;color:#fff;padding:24px 28px">
    <h1 style="margin:0;font-size:20px">Lume CRM — Insights Report</h1>
    <p style="margin:4px 0 0;font-size:13px;opacity:0.7">${data.orgName} | ${data.period}</p>
  </div>
  <div style="padding:28px">
    <h2 style="margin:0 0 16px;font-size:16px;color:#333">Key Metrics</h2>
    <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
      <tr>
        <td style="padding:12px;background:#f8f9fa;border-radius:8px;text-align:center;width:25%">
          <div style="font-size:24px;font-weight:700;color:#111">${data.newLeads}</div>
          <div style="font-size:11px;color:#666;text-transform:uppercase;letter-spacing:0.5px;margin-top:4px">New Leads</div>
        </td>
        <td style="width:8px"></td>
        <td style="padding:12px;background:#f8f9fa;border-radius:8px;text-align:center;width:25%">
          <div style="font-size:24px;font-weight:700;color:#111">${data.newJobs}</div>
          <div style="font-size:11px;color:#666;text-transform:uppercase;letter-spacing:0.5px;margin-top:4px">New Jobs</div>
        </td>
        <td style="width:8px"></td>
        <td style="padding:12px;background:#f8f9fa;border-radius:8px;text-align:center;width:25%">
          <div style="font-size:24px;font-weight:700;color:#111">${(data.conversionRate * 100).toFixed(1)}%</div>
          <div style="font-size:11px;color:#666;text-transform:uppercase;letter-spacing:0.5px;margin-top:4px">Conversion</div>
        </td>
      </tr>
    </table>
    <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
      <tr>
        <td style="padding:12px;background:#f0fdf4;border-radius:8px;text-align:center;width:33%">
          <div style="font-size:22px;font-weight:700;color:#16a34a">${fmtMoney(data.revenue)}</div>
          <div style="font-size:11px;color:#666;text-transform:uppercase;margin-top:4px">Revenue</div>
        </td>
        <td style="width:8px"></td>
        <td style="padding:12px;background:#eff6ff;border-radius:8px;text-align:center;width:33%">
          <div style="font-size:22px;font-weight:700;color:#2563eb">${fmtMoney(data.invoiced)}</div>
          <div style="font-size:11px;color:#666;text-transform:uppercase;margin-top:4px">Invoiced</div>
        </td>
        <td style="width:8px"></td>
        <td style="padding:12px;background:${data.outstandingBalance > 0 ? '#fef2f2' : '#f8f9fa'};border-radius:8px;text-align:center;width:33%">
          <div style="font-size:22px;font-weight:700;color:${data.outstandingBalance > 0 ? '#dc2626' : '#111'}">${fmtMoney(data.outstandingBalance)}</div>
          <div style="font-size:11px;color:#666;text-transform:uppercase;margin-top:4px">Outstanding</div>
        </td>
      </tr>
    </table>

    ${data.churnAlerts > 0 ? `<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px 16px;margin-bottom:24px"><strong style="color:#dc2626">${data.churnAlerts} high-risk client${data.churnAlerts > 1 ? 's' : ''}</strong> <span style="color:#666">— Check the Churn tab in Insights for details.</span></div>` : ''}

    <h2 style="margin:0 0 12px;font-size:16px;color:#333">Top Clients</h2>
    <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
      <thead><tr><th style="padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;color:#666;border-bottom:2px solid #eee">Client</th><th style="padding:8px 12px;text-align:right;font-size:11px;text-transform:uppercase;color:#666;border-bottom:2px solid #eee">Revenue</th></tr></thead>
      <tbody>${topClientsHtml}</tbody>
    </table>

    <p style="font-size:12px;color:#999;text-align:center;margin-top:32px">Generated by Lume CRM — <a href="#" style="color:#2563eb">Open Dashboard</a></p>
  </div>
</div>
</body></html>`;
}

export async function sendScheduledReport(reportId: string): Promise<void> {
  const admin = getServiceClient();

  const { data: report, error } = await admin.from('scheduled_reports')
    .select('*')
    .eq('id', reportId)
    .eq('enabled', true)
    .maybeSingle();

  if (error || !report) throw new Error('Report not found or disabled');

  // Determine date range based on frequency
  const now = new Date();
  let from: string, to: string;
  if (report.frequency === 'daily') {
    const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
    from = to = yesterday.toISOString().slice(0, 10);
  } else if (report.frequency === 'weekly') {
    const weekAgo = new Date(now); weekAgo.setDate(weekAgo.getDate() - 7);
    from = weekAgo.toISOString().slice(0, 10);
    to = new Date(now.getTime() - 86400000).toISOString().slice(0, 10);
  } else {
    const monthAgo = new Date(now); monthAgo.setMonth(monthAgo.getMonth() - 1);
    from = monthAgo.toISOString().slice(0, 10);
    to = new Date(now.getTime() - 86400000).toISOString().slice(0, 10);
  }

  const data = await gatherReportData(report.org_id, from, to);
  const html = buildEmailHtml(data);

  if (!resendApiKey) throw new Error('RESEND_API_KEY not configured');
  const resend = new Resend(resendApiKey);

  await resend.emails.send({
    from: emailFrom,
    to: report.recipient_email,
    subject: `Lume CRM — ${report.frequency === 'daily' ? 'Daily' : report.frequency === 'weekly' ? 'Weekly' : 'Monthly'} Insights Report`,
    html,
  });

  // Update last_sent_at
  await admin.from('scheduled_reports')
    .update({ last_sent_at: new Date().toISOString() })
    .eq('id', reportId);

  console.log(`[scheduled-reports] Sent ${report.frequency} report to ${report.recipient_email} for org ${report.org_id}`);
}

export async function processScheduledReports(): Promise<number> {
  const admin = getServiceClient();
  const now = new Date();
  const dayOfWeek = now.getDay();
  const dayOfMonth = now.getDate();

  const { data: reports } = await admin.from('scheduled_reports')
    .select('*')
    .eq('enabled', true);

  if (!reports?.length) return 0;

  let sent = 0;
  for (const report of reports) {
    try {
      const lastSent = report.last_sent_at ? new Date(report.last_sent_at) : null;
      const hoursSinceLastSent = lastSent ? (now.getTime() - lastSent.getTime()) / 3600000 : Infinity;

      let shouldSend = false;
      if (report.frequency === 'daily' && hoursSinceLastSent >= 20) {
        shouldSend = true;
      } else if (report.frequency === 'weekly' && hoursSinceLastSent >= 144 && dayOfWeek === (report.day_of_week ?? 1)) {
        shouldSend = true;
      } else if (report.frequency === 'monthly' && hoursSinceLastSent >= 672 && dayOfMonth === (report.day_of_month ?? 1)) {
        shouldSend = true;
      }

      if (shouldSend) {
        await sendScheduledReport(report.id);
        sent++;
      }
    } catch (err: any) {
      console.error(`[scheduled-reports] Failed for report ${report.id}:`, err?.message);
    }
  }

  return sent;
}
