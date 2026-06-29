import { supabase } from '../supabase';

/** One row of the shared `activity_log` table (same source as the web timeline). */
export interface ActivityLogEntry {
  id: string;
  org_id: string;
  entity_type: string;
  entity_id: string;
  related_entity_type: string | null;
  related_entity_id: string | null;
  event_type: string;
  actor_id: string | null;
  metadata: Record<string, any> | null;
  created_at: string;
}

// fr/en label + emoji per event type (mirrors web src/lib/activityApi.ts).
const LABELS: Record<string, { fr: string; en: string; emoji: string }> = {
  lead_created: { fr: 'Lead créé', en: 'Lead created', emoji: '➕' },
  lead_updated: { fr: 'Lead mis à jour', en: 'Lead updated', emoji: '✏️' },
  status_changed: { fr: 'Statut modifié', en: 'Status changed', emoji: '🔄' },
  lead_converted: { fr: 'Lead converti en travail', en: 'Lead converted to job', emoji: '➡️' },
  client_archived: { fr: 'Client archivé', en: 'Client archived', emoji: '🗄️' },
  client_deleted: { fr: 'Client supprimé', en: 'Client deleted', emoji: '🗑️' },
  estimate_sent: { fr: 'Devis envoyé', en: 'Estimate sent', emoji: '📤' },
  estimate_accepted: { fr: 'Devis accepté', en: 'Estimate accepted', emoji: '✅' },
  estimate_rejected: { fr: 'Devis refusé', en: 'Estimate rejected', emoji: '❌' },
  appointment_created: { fr: 'Rendez-vous créé', en: 'Appointment created', emoji: '📅' },
  appointment_updated: { fr: 'Rendez-vous mis à jour', en: 'Appointment updated', emoji: '📅' },
  appointment_cancelled: { fr: 'Rendez-vous annulé', en: 'Appointment cancelled', emoji: '📅' },
  job_created: { fr: 'Travail créé', en: 'Job created', emoji: '🧰' },
  job_completed: { fr: 'Travail terminé', en: 'Job completed', emoji: '✔️' },
  invoice_created: { fr: 'Facture créée', en: 'Invoice created', emoji: '📄' },
  invoice_sent: { fr: 'Facture envoyée', en: 'Invoice sent', emoji: '📤' },
  invoice_paid: { fr: 'Facture payée', en: 'Invoice paid', emoji: '💵' },
  invoice_overdue: { fr: 'Facture en retard', en: 'Invoice overdue', emoji: '⚠️' },
  invoice_reminded: { fr: 'Rappel de facture envoyé', en: 'Invoice reminder sent', emoji: '🔔' },
  follow_up_sent: { fr: 'Relance envoyée', en: 'Follow-up sent', emoji: '✉️' },
  feedback_received: { fr: 'Commentaire reçu', en: 'Feedback received', emoji: '💬' },
  review_requested: { fr: 'Avis demandé', en: 'Review requested', emoji: '⭐' },
};

/** A readable label for an activity event (falls back to the raw type). */
export function activityLabel(eventType: string, lang: 'fr' | 'en' = 'en'): string {
  const l = LABELS[eventType];
  if (!l) return eventType.replace(/_/g, ' ');
  return `${l.emoji} ${lang === 'fr' ? l.fr : l.en}`;
}

/** Activity history for an entity (e.g. a client) — newest first. */
export async function listActivityLog(
  orgId: string,
  entityType: string,
  entityId: string,
  limit = 30,
): Promise<ActivityLogEntry[]> {
  const { data, error } = await supabase
    .from('activity_log')
    .select('*')
    .eq('org_id', orgId)
    .or(
      `and(entity_type.eq.${entityType},entity_id.eq.${entityId}),and(related_entity_type.eq.${entityType},related_entity_id.eq.${entityId})`,
    )
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as ActivityLogEntry[];
}
