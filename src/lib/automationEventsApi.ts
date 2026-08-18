/* ═══════════════════════════════════════════════════════════════
   API — Automation Event Hooks

   Notifies the server-side automation engine when events happen
   that are managed client-side (appointments, job status, etc.)
   so the engine can trigger matching automation rules.

   These calls are fire-and-forget — failures are logged but
   don't break the user flow.
   ═══════════════════════════════════════════════════════════════ */

import { supabase } from './supabase';

async function getAuthHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Not authenticated');
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function fireEvent(path: string, body: Record<string, any>): Promise<void> {
  try {
    const headers = await getAuthHeaders();
    await fetch(`/api/automations/events/${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  } catch (err) {
    // Non-blocking — don't break user flow if automation hook fails
    console.warn('[automationEvents]', path, 'failed:', err);
  }
}

/** Notify engine that an appointment/schedule_event was created */
export function emitAppointmentCreated(params: {
  eventId: string;
  jobId?: string;
  clientId?: string;
  startTime?: string;
  title?: string;
  address?: string;
  /**
   * Visite créée en lot (plan de service, job multi-visites) : le moteur
   * saute la confirmation immédiate mais planifie normalement les rappels
   * datés (J-7 / J-1 / 2 h) de la visite. Sans ce flag, un plan de 10
   * visites envoyait 10 confirmations d'un coup au client.
   */
  suppressImmediate?: boolean;
}) {
  fireEvent('appointment-created', params);
}

/**
 * Notify engine that an existing appointment was MOVED to a new date.
 *
 * Distinct de `emitAppointmentCreated` : ré-émettre `created` sur un
 * déplacement renverrait une confirmation au client et laisserait les anciens
 * rappels calés sur l'ancienne date (cf. jobsApi.syncJobSchedule).
 */
export function emitAppointmentRescheduled(params: {
  eventId: string;
  jobId?: string;
  clientId?: string;
  startTime?: string;
}) {
  fireEvent('appointment-rescheduled', params);
}

/** Notify engine that an appointment was cancelled/unscheduled */
export function emitAppointmentCancelled(params: {
  eventId: string;
  jobId?: string;
  clientId?: string;
}) {
  fireEvent('appointment-cancelled', params);
}

/** Notify engine that a job was marked completed */
export function emitJobCompleted(params: {
  jobId: string;
}) {
  fireEvent('job-completed', params);
}

/** Notify engine that a pipeline deal changed stage */
export function emitDealStageChanged(params: {
  dealId: string;
  leadId?: string;
  jobId?: string;
  oldStage: string;
  newStage: string;
}) {
  fireEvent('deal-stage-changed', params);
}

/** Notify engine that a quote was sent */
export function emitQuoteSent(params: {
  quoteId: string;
  leadId?: string;
  channel: 'email' | 'sms';
}) {
  fireEvent('quote-sent', params);
}

/** Notify engine that a quote was approved */
export function emitQuoteApproved(params: {
  quoteId: string;
  leadId?: string;
}) {
  fireEvent('quote-approved', params);
}

/** Notify engine that a quote was declined */
export function emitQuoteDeclined(params: {
  quoteId: string;
  leadId?: string;
}) {
  fireEvent('quote-declined', params);
}

/** Notify engine that an invoice was paid manually */
export function emitInvoicePaidManually(params: {
  invoiceId: string;
  clientId?: string;
}) {
  fireEvent('invoice-paid', params);
}

/** Notify engine that a lead was created */
export function emitLeadCreated(params: {
  leadId: string;
}) {
  fireEvent('lead-created', params);
}

/** Notify engine that a lead's status changed */
export function emitLeadStatusChanged(params: {
  leadId: string;
  oldStatus: string;
  newStatus: string;
}) {
  fireEvent('lead-status-changed', params);
}
