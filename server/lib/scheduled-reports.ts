/* ═══════════════════════════════════════════════════════════════
   Scheduled Reports — Cron job that sends insights via email
   ═══════════════════════════════════════════════════════════════ */

import { getServiceClient } from './supabase';
import { emailFrom } from './config';
import { sendEmail, isMailerConfigured } from './mailer';
import { logger } from './logger';
import { resolvePublicBaseUrl } from './helpers';
import { rendreCourrielLume, montant, dateLisible, echapper } from './courriels/gabarit';

const fmtMoney = (cents: number): string => montant(cents, 'CAD', 'fr');

export type FrequenceRapport = 'daily' | 'weekly' | 'monthly';
const LIBELLE_FREQUENCE: Record<FrequenceRapport, string> = { daily: 'quotidien', weekly: 'hebdomadaire', monthly: 'mensuel' };
export function libelleFrequence(f: string): string {
  return LIBELLE_FREQUENCE[(f as FrequenceRapport)] ?? LIBELLE_FREQUENCE.weekly;
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
  const { data: org } = await admin.from('orgs').select('name').eq('id', orgId).maybeSingle();

  // Une RPC en echec ne leve pas : sans ce log, le rapport partirait chez le
  // client avec des zeros partout, indiscernables d'une periode sans activite.
  const logRpc = (name: string, error: { message: string } | null) => {
    if (error) console.error(`[scheduled-reports] ${name} failed for org ${orgId}:`, error.message);
  };

  // Overview via RPC
  const { data: overview, error: ovErr } = await admin.rpc('rpc_insights_overview', { p_org: orgId, p_from: from, p_to: to });
  logRpc('rpc_insights_overview', ovErr);
  const ov = Array.isArray(overview) ? overview[0] : overview;

  // Lead conversion
  const { data: conv, error: cvErr } = await admin.rpc('rpc_insights_lead_conversion', { p_org: orgId, p_from: from, p_to: to });
  logRpc('rpc_insights_lead_conversion', cvErr);
  const cv = Array.isArray(conv) ? conv[0] : conv;

  // Invoices summary
  const { data: inv, error: ivErr } = await admin.rpc('rpc_insights_invoices_summary', { p_org: orgId, p_from: from, p_to: to });
  logRpc('rpc_insights_invoices_summary', ivErr);
  const iv = Array.isArray(inv) ? inv[0] : inv;

  // Top clients by revenue
  const { data: topClients, error: tcErr } = await admin.rpc('rpc_insights_client_lifetime_value', { p_org: orgId, p_limit: 5 });
  logRpc('rpc_insights_client_lifetime_value', tcErr);

  // Churn alerts
  const { data: churn, error: chErr } = await admin.rpc('rpc_insights_churn_risk', { p_org: orgId, p_limit: 100 });
  logRpc('rpc_insights_churn_risk', chErr);
  const highRisk = (churn || []).filter((c: any) => c.risk_level === 'high').length;

  return {
    orgName: org?.name || 'Ton entreprise',
    period: from === to ? dateLisible(from, 'fr') : `du ${dateLisible(from, 'fr')} au ${dateLisible(to, 'fr')}`,
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

/** Le rapport, voix Lume : les chiffres en lignes, les meilleurs clients en tableau, un bouton vers l'app. Pur, exporté pour les tests. */
export function buildEmailHtml(data: ReportData, frequency: string, lienApp: string): string {
  const periode = libelleFrequence(frequency);
  const topClientsHtml = data.topClients.length
    ? data.topClients.map((c, i) => `<tr><td style="padding:8px 0;font-size:14px;color:#374151;${i ? 'border-top:1px solid #e5e7eb;' : ''}">${echapper(c.name)}</td><td align="right" style="padding:8px 0;font-size:14px;font-weight:600;color:#111827;${i ? 'border-top:1px solid #e5e7eb;' : ''}">${echapper(fmtMoney(c.revenue))}</td></tr>`).join('')
    : '<tr><td style="padding:8px 0;font-size:14px;color:#9ca3af;">Aucun revenu sur la période.</td></tr>';
  const alerteChurn = data.churnAlerts > 0
    ? `<p style="margin:0 0 20px;padding:12px 16px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;font-size:14px;"><strong style="color:#dc2626;">${data.churnAlerts} client${data.churnAlerts > 1 ? 's' : ''} à risque de départ</strong> — sans travaux depuis longtemps ; un appel vaut la peine.</p>`
    : '';
  return rendreCourrielLume({
    langue: 'fr',
    preheader: `${data.orgName} — ${fmtMoney(data.revenue)} de revenus, ${data.newLeads} nouveaux prospects, ${data.newJobs} nouveaux travaux`,
    titre: `Ton rapport ${periode}`,
    intro: `Voici où en est ${data.orgName} (${data.period}).`,
    montant: { libelle: 'Revenus encaissés', valeur: fmtMoney(data.revenue), sous: `Facturé : ${fmtMoney(data.invoiced)}` },
    lignes: [
      { libelle: 'Nouveaux prospects', valeur: String(data.newLeads) },
      { libelle: 'Nouveaux travaux', valeur: String(data.newJobs) },
      { libelle: 'Taux de conversion', valeur: `${(data.conversionRate * 100).toFixed(1).replace('.', ',')} %` },
      { libelle: 'Solde impayé', valeur: fmtMoney(data.outstandingBalance), fort: data.outstandingBalance > 0 },
    ],
    corpsHtml: `${alerteChurn}<p style="margin:0 0 6px;font-size:12px;letter-spacing:.6px;text-transform:uppercase;color:#6b7280;font-weight:600;">Meilleurs clients</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${topClientsHtml}</table>`,
    bouton: { texte: 'Ouvrir Lume', url: lienApp },
    note: 'Tu reçois ce rapport parce qu’il est programmé dans Lume. Pour changer sa fréquence ou l’arrêter, demande-le à Lumi.',
  });
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
  // Sans PUBLIC_URL (dev local), le bouton mène au site plutôt que d'échouer.
  let base = '';
  try { base = resolvePublicBaseUrl(); } catch { base = 'https://lumecrm.net'; }
  const html = buildEmailHtml(data, report.frequency, `${base}/insights`);

  if (!isMailerConfigured()) throw new Error('SMTP not configured');

  await sendEmail({
    from: emailFrom,
    to: report.recipient_email,
    subject: `Ton rapport ${libelleFrequence(report.frequency)} — ${data.orgName}`,
    html,
  });

  // Update last_sent_at
  const { error: stampErr } = await admin.from('scheduled_reports')
    .update({ last_sent_at: new Date().toISOString() })
    .eq('id', reportId);
  if (stampErr) {
    // Sans last_sent_at, processScheduledReports() croit que le rapport n'est
    // jamais parti et le RENVERRA a chaque passage du cron.
    console.error(`[scheduled-reports] CRITICAL: last_sent_at not written for report ${reportId} (org ${report.org_id}) — the report will be re-sent on every run:`, stampErr.message);
  }

  logger.info(`[scheduled-reports] Sent ${report.frequency} report`, { email: report.recipient_email, orgId: report.org_id });
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
