/* ═══════════════════════════════════════════════════════════════
   Gardes communes aux agents (MCP externe ET Lumi dans l'app)
   ─────────────────────────────────────────────────────────────
   Une seule matrice : quel outil exige quelle permission de la page Rôles,
   quels outils touchent aux montants, et comment blanchir les montants pour
   un membre qui ne les voit pas dans l'app. Vivait dans routes/mcp.ts ;
   partagé depuis que Lumi (agent interne, Opus 5) exécute les mêmes outils.
   ═══════════════════════════════════════════════════════════════ */
import type { PermissionKey } from '../../../src/lib/permissions';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getServiceClient } from '../supabase';
import { getUserContext, hasPermission } from '../rbac';
import { TOOLS_BY_NAME, type ToolContext } from './tools';

export const PERMISSION_PAR_OUTIL: Record<string, { cle: PermissionKey; capacite: string }> = {
  search_clients:            { cle: 'clients.read',       capacite: 'la consultation des clients' },
  get_client_profile:        { cle: 'clients.read',       capacite: 'la consultation des clients' },
  create_client:             { cle: 'clients.create',     capacite: 'la création de clients' },
  update_client:             { cle: 'clients.update',     capacite: 'la modification des clients' },
  search_leads:              { cle: 'leads.read',         capacite: 'la consultation des prospects' },
  list_request_submissions:  { cle: 'leads.read',         capacite: 'la consultation des demandes entrantes' },
  list_jobs:                 { cle: 'jobs.read',          capacite: 'la consultation des jobs' },
  get_job:                   { cle: 'jobs.read',          capacite: 'la consultation des jobs' },
  query_schedule:            { cle: 'jobs.read',          capacite: "la consultation de l'horaire" },
  find_dates_in_location:    { cle: 'jobs.read',          capacite: "la consultation de l'horaire" },
  get_day_route:             { cle: 'jobs.read',          capacite: "la consultation de l'horaire" },
  get_morning_briefing:      { cle: 'jobs.read',          capacite: 'le survol de la journée' },
  create_job:                { cle: 'jobs.create',        capacite: 'la création de jobs' },
  update_job_status:         { cle: 'jobs.update',        capacite: 'la modification des jobs' },
  update_job:                { cle: 'jobs.update',        capacite: 'la modification des jobs' },
  archive_job:               { cle: 'jobs.update',        capacite: "l'archivage des jobs" },
  assign_job:                { cle: 'jobs.assign',        capacite: "l'assignation des jobs" },
  reschedule_job:            { cle: 'calendar.update',    capacite: 'la replanification du calendrier' },
  get_conversations:         { cle: 'messages.read',      capacite: 'la lecture des SMS' },
  get_conversation_messages: { cle: 'messages.read',      capacite: 'la lecture des SMS' },
  send_sms:                  { cle: 'messages.send',      capacite: "l'envoi de SMS" },
  send_payment_reminders:    { cle: 'messages.send',      capacite: "l'envoi de rappels de paiement" },
  get_timesheets:            { cle: 'timesheets.read',    capacite: 'la consultation des feuilles de temps' },
  get_team:                  { cle: 'team.read',          capacite: "la consultation de l'équipe" },
  get_team_locations:        { cle: 'gps.read',           capacite: 'la localisation de l\u2019équipe' },
  get_d2d_stats:             { cle: 'door_to_door.access', capacite: 'les statistiques terrain' },
  list_automations:          { cle: 'automations.read',   capacite: 'la consultation des automatisations' },
  get_automation_health:     { cle: 'automations.read',   capacite: 'le diagnostic des automatisations' },
  get_payroll_summary:       { cle: 'financial.view_reports', capacite: 'la paie' },
  list_quotes:               { cle: 'quotes.read',        capacite: 'la consultation des devis' },
  create_quote:              { cle: 'quotes.create',      capacite: 'la création de devis' },
  send_quote:                { cle: 'quotes.send',        capacite: "l'envoi de devis" },
  list_invoices:             { cle: 'invoices.read',      capacite: 'la consultation des factures' },
  create_invoice:            { cle: 'invoices.create',    capacite: 'la création de factures' },
  create_invoice_from_job:   { cle: 'invoices.create',    capacite: 'la création de factures' },
  send_invoice:              { cle: 'invoices.send',      capacite: "l'envoi de factures" },
  convert_quote_to_job:      { cle: 'quotes.approve',     capacite: 'la conversion des devis' },
  convert_lead_to_client:    { cle: 'leads.update',       capacite: 'la conversion des prospects' },
  add_visit:                 { cle: 'calendar.update',    capacite: 'la planification du calendrier' },
  // Suivi léger (tâches, notes) : rattaché au dossier job/client. On exige au
  // moins la LECTURE des jobs — clé que tout rôle opérationnel possède (owner,
  // admin, sales_rep, technician). But : donner un garde explicite plutôt que
  // « ouvert à tout membre », SANS bloquer les rôles standards. Ne pas mapper
  // sur jobs.update (les sales_rep ne l'ont pas) ni clients.update (pas les
  // technicians) : ça casserait un usage courant.
  list_tasks:                { cle: 'jobs.read',          capacite: 'la consultation des tâches' },
  create_task:               { cle: 'jobs.read',          capacite: 'la création de tâches' },
  update_task_status:        { cle: 'jobs.read',          capacite: 'la mise à jour des tâches' },
  update_task:               { cle: 'jobs.read',          capacite: 'la modification des tâches' },
  delete_task:               { cle: 'jobs.read',          capacite: 'la suppression des tâches' },
  add_note:                  { cle: 'jobs.read',          capacite: "l'ajout de notes" },
  cancel_visit:              { cle: 'calendar.update',    capacite: "l'annulation d'une visite" },
  cancel_quote:              { cle: 'quotes.update',      capacite: "l'annulation d'un devis" },
  mark_invoice_paid:         { cle: 'financial.view_payments', capacite: "l'enregistrement d'un paiement" },
  // Agrégats financiers : permission dédiée, comme la paie.
  get_financial_overview:    { cle: 'financial.view_reports', capacite: 'la vue financière' },
  get_revenue_summary:       { cle: 'financial.view_reports', capacite: 'le résumé des revenus' },
  build_report:              { cle: 'financial.view_reports', capacite: 'les rapports' },
  get_overdue_payments:      { cle: 'financial.view_invoices', capacite: 'les paiements en retard' },
  // Conseil / analyse : mêmes chiffres que les rapports financiers.
  compare_revenue:           { cle: 'financial.view_reports', capacite: 'la comparaison des revenus' },
  get_top_clients:           { cle: 'financial.view_reports', capacite: 'la valeur des clients' },
  get_churn_risk:            { cle: 'financial.view_reports', capacite: 'les clients à risque' },
  get_job_profitability:     { cle: 'financial.view_reports', capacite: 'la rentabilité des jobs' },
  get_top_services:          { cle: 'financial.view_reports', capacite: 'les services les plus rentables' },
  set_job_expenses:          { cle: 'financial.view_reports', capacite: "la saisie des dépenses d'un job" },
  // Catalogue / planification.
  list_services:             { cle: 'jobs.read',          capacite: 'le catalogue de services' },
  find_free_slot:            { cle: 'calendar.read',      capacite: 'la recherche de créneaux' },
  optimize_route:            { cle: 'jobs.read',          capacite: "l'optimisation de tournée" },
  // Courriel libre : envoi au nom de l'entreprise (la route exige owner/admin).
  send_email:                { cle: 'messages.send',      capacite: "l'envoi de courriels" },
};

export const OUTILS_FINANCIERS = new Set([
  'get_revenue_summary', 'get_financial_overview', 'get_overdue_payments',
  'list_invoices', 'create_invoice', 'create_invoice_from_job',
  'send_invoice', 'create_quote', 'send_quote', 'list_quotes',
  'mark_invoice_paid', 'cancel_quote',
  'compare_revenue', 'get_top_clients', 'get_churn_risk',
  'get_job_profitability', 'get_top_services',
  'build_report',
]);

// Champs à blanchir pour un membre sans droit aux montants. On couvre les
// suffixes techniques (_cents, _amount…) ET des noms financiers SANS AMBIGUÏTÉ
// même sans suffixe — filet contre un futur champ mal nommé qui, autrement,
// fuirait faute de finir par `_cents`. On EXCLUT volontairement les mots
// polysémiques comme `total` ou `count` : ce sont souvent des compteurs
// (nombre de jobs, de devis…), pas des montants — les blanchir casserait
// l'affichage. Seuls des noms non ambigus figurent ici.
export const CLES_MONTANTS = /(_cents|_amount|_price|margin_pct|goal_progress_pct)$|^(revenue|solde|mrr|arr|ltv|lifetime_value|commission|payout)$/i;


/**
 * La personne voit-elle les montants ? La fonction de l'app, telle quelle —
 * SECURITY DEFINER, elle porte la règle complète (rôles à droit d'office +
 * réglage explicite de l'org). Jamais exposer par défaut.
 */
export async function membreVoitLesMontants(userId: string | null | undefined, orgId: string): Promise<boolean> {
  if (!userId) return false;
  try {
    const { data, error } = await getServiceClient()
      .rpc('membre_voit_les_montants', { p_user: userId, p_org: orgId });
    if (error) throw error;
    return data === true;
  } catch (e: any) {
    console.error('[agent-garde] visibilité des montants indéterminable :', e?.message || e);
    return false;
  }
}

/** Blanchit récursivement les champs de montants d'un résultat d'outil. */
export function masquerMontants(v: any): any {
  if (Array.isArray(v)) return v.map(masquerMontants);
  if (v && typeof v === 'object') {
    const sortie: Record<string, any> = {};
    for (const [k, val] of Object.entries(v)) {
      sortie[k] = CLES_MONTANTS.test(k) ? null : masquerMontants(val);
    }
    return sortie;
  }
  return v;
}

export type RefusOutil = { refus: string };

/**
 * Exécute un outil pour un UTILISATEUR identifié, avec toutes les gardes :
 * outil connu, permission de la page Rôles, montants masqués si le rôle ne
 * les voit pas. Le message de refus est écrit pour être relayé tel quel par
 * l'assistant à la personne, en mots simples.
 */
export async function executerOutilGarde(opts: {
  name: string;
  args: Record<string, any>;
  userId: string;
  orgId: string;
  client: SupabaseClient;
  accessToken?: string;
}): Promise<{ result: any } | RefusOutil> {
  const tool = TOOLS_BY_NAME[opts.name];
  if (!tool || typeof tool.handler !== 'function') return { refus: `Outil inconnu : ${opts.name}` };

  const regle = PERMISSION_PAR_OUTIL[opts.name];
  if (regle) {
    const ctxRole = await getUserContext(getServiceClient(), opts.userId, opts.orgId);
    if (!ctxRole || !hasPermission(ctxRole, regle.cle)) {
      return {
        refus: `Les accès Lume de cette personne n'incluent pas ${regle.capacite} `
          + '(réglage de l’écran des rôles de son entreprise). Dis-le-lui simplement, '
          + 'et suggère de voir l’administrateur si ce droit devrait changer.',
      };
    }
  }

  const voitLesMontants = await membreVoitLesMontants(opts.userId, opts.orgId);
  if (!voitLesMontants && OUTILS_FINANCIERS.has(opts.name)) {
    return { refus: 'Cette personne ne voit pas les montants dans Lume (réglage de son rôle) : cet outil financier ne lui est pas accessible. Dis-le-lui simplement.' };
  }

  const ctx: ToolContext = { client: opts.client, orgId: opts.orgId, userId: opts.userId, accessToken: opts.accessToken };
  const result = await tool.handler(opts.args, ctx);
  return {
    result: voitLesMontants
      ? result
      : { ...masquerMontants(result), montants_masques: true, note_montants: 'Les montants sont masqués : le rôle de cette personne dans Lume ne les inclut pas. Ne pas les estimer ni les déduire.' },
  };
}
