/* ═══════════════════════════════════════════════════════════════
   Activity Log API — Fetch unified activity history for entities.
   ═══════════════════════════════════════════════════════════════ */

import { supabase } from './supabase';
import { getCurrentOrgIdOrThrow } from './orgApi';

export interface ActivityLogEntry {
  id: string;
  org_id: string;
  entity_type: string;
  entity_id: string;
  related_entity_type: string | null;
  related_entity_id: string | null;
  event_type: string;
  actor_id: string | null;
  metadata: Record<string, any>;
  created_at: string;
}

export const EVENT_TYPE_LABELS: Record<string, { en: string; fr: string; icon: string }> = {
  lead_created: { en: 'Lead created', fr: 'Lead créé', icon: 'plus' },
  lead_updated: { en: 'Lead updated', fr: 'Lead mis à jour', icon: 'edit' },
  status_changed: { en: 'Status changed', fr: 'Statut modifié', icon: 'refresh' },
  lead_converted: { en: 'Lead converted to job', fr: 'Lead converti en travail', icon: 'arrow-right' },
  client_archived: { en: 'Client archived', fr: 'Client archivé', icon: 'archive' },
  client_deleted: { en: 'Client deleted', fr: 'Client supprimé', icon: 'trash' },
  estimate_sent: { en: 'Estimate sent', fr: 'Devis envoyé', icon: 'send' },
  estimate_accepted: { en: 'Estimate accepted', fr: 'Devis accepté', icon: 'check' },
  estimate_rejected: { en: 'Estimate rejected', fr: 'Devis refusé', icon: 'x' },
  appointment_created: { en: 'Appointment created', fr: 'Rendez-vous créé', icon: 'calendar' },
  appointment_updated: { en: 'Appointment updated', fr: 'Rendez-vous mis à jour', icon: 'calendar' },
  appointment_cancelled: { en: 'Appointment cancelled', fr: 'Rendez-vous annulé', icon: 'calendar-x' },
  job_created: { en: 'Job created', fr: 'Travail créé', icon: 'briefcase' },
  job_completed: { en: 'Job completed', fr: 'Travail terminé', icon: 'check-circle' },
  invoice_created: { en: 'Invoice created', fr: 'Facture créée', icon: 'file-text' },
  invoice_sent: { en: 'Invoice sent', fr: 'Facture envoyée', icon: 'send' },
  invoice_paid: { en: 'Invoice paid', fr: 'Facture payée', icon: 'dollar-sign' },
  invoice_overdue: { en: 'Invoice overdue', fr: 'Facture en retard', icon: 'alert-circle' },
  invoice_reminded: { en: 'Invoice reminder sent', fr: 'Rappel de facture envoyé', icon: 'bell' },
  follow_up_sent: { en: 'Follow-up sent', fr: 'Relance envoyée', icon: 'mail' },
  feedback_received: { en: 'Feedback received', fr: 'Commentaire reçu', icon: 'message-circle' },
  review_requested: { en: 'Review requested', fr: 'Avis demandé', icon: 'star' },
};

export async function fetchActivityLog(
  entityType: string,
  entityId: string,
  options: { limit?: number; offset?: number } = {},
): Promise<ActivityLogEntry[]> {
  const limit = options.limit || 50;
  const offset = options.offset || 0;

  const orgId = await getCurrentOrgIdOrThrow();
  const { data, error } = await supabase
    .from('activity_log')
    .select('*')
    .eq('org_id', orgId)
    .or(`and(entity_type.eq.${entityType},entity_id.eq.${entityId}),and(related_entity_type.eq.${entityType},related_entity_id.eq.${entityId})`)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) throw error;
  return data || [];
}

export async function fetchRecentActivity(
  options: { limit?: number } = {},
): Promise<ActivityLogEntry[]> {
  const limit = options.limit || 30;

  const orgId = await getCurrentOrgIdOrThrow();
  const { data, error } = await supabase
    .from('activity_log')
    .select('*')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data || [];
}
