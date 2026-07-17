/**
 * Pin → CRM Action Mapping
 *
 * Single source of truth for what CRM action to trigger
 * when a pin is placed or changed to a specific status.
 */

import type { PinStatus, LeadPinData } from './lead-pin';
import type { Lead } from '../../types';

// ---------------------------------------------------------------------------
// CRM Action types
// ---------------------------------------------------------------------------

export type CrmAction = 'open_job' | 'open_lead_choice' | 'none';

export interface PinCrmMapping {
  action: CrmAction;
  label: string;
  description: string;
}

// ---------------------------------------------------------------------------
// Centralized mapping — pin status → CRM action
// ---------------------------------------------------------------------------

export const PIN_STATUS_CRM_MAP: Record<PinStatus, PinCrmMapping> = {
  closed_won: {
    action: 'open_job',
    label: 'Créer une Job',
    description: 'Ouvre le formulaire de création de Job CRM',
  },
  lead: {
    action: 'open_lead_choice',
    label: 'Devis ou Contrat',
    description: 'Propose de créer un devis, un contrat, ou de passer',
  },
  // Seuls les pins Vendu et Lead déclenchent une action au placement.
  appointment: { action: 'none', label: '', description: '' },
  follow_up: { action: 'none', label: '', description: '' },
  no_answer: { action: 'none', label: '', description: '' },
  rejected: { action: 'none', label: '', description: '' },
  other: { action: 'none', label: '', description: '' },
};

// ---------------------------------------------------------------------------
// Get CRM action for a pin status
// ---------------------------------------------------------------------------

export function getCrmActionForStatus(status: PinStatus): CrmAction {
  return PIN_STATUS_CRM_MAP[status].action;
}

export function shouldTriggerCrmAction(status: PinStatus): boolean {
  return PIN_STATUS_CRM_MAP[status].action !== 'none';
}

// ---------------------------------------------------------------------------
// Convert a D2D pin to a Lead-like object for CRM modals
// ---------------------------------------------------------------------------

export function pinToLeadData(pin: LeadPinData): Partial<Lead> {
  return {
    first_name: pin.name.split(' ')[0] || '',
    last_name: pin.name.split(' ').slice(1).join(' ') || '',
    email: pin.email || '',
    phone: pin.phone || '',
    address: pin.address || '',
    notes: pin.note || '',
    value: 0,
    status: 'new_prospect',
    source: 'door_knock',
  };
}

// ---------------------------------------------------------------------------
// Convert a D2D pin to Job draft initial values
// ---------------------------------------------------------------------------

export function pinToJobDraft(pin: LeadPinData) {
  return {
    title: `Job — ${pin.name}`,
    client_id: pin.client_id || pin.lead_id || null,
    property_address: pin.address || null,
    description: [
      pin.note ? `Note D2D: ${pin.note}` : '',
      pin.phone ? `Tél: ${pin.phone}` : '',
      pin.email ? `Email: ${pin.email}` : '',
    ].filter(Boolean).join('\n') || null,
    job_type: 'one_off' as const,
    requires_invoicing: true,
    billing_split: false,
  };
}

// ---------------------------------------------------------------------------
// Convert a D2D pin to a partial Lead for Quote modal
// ---------------------------------------------------------------------------

export function pinToQuoteLead(pin: LeadPinData): Lead {
  return {
    id: pin.id,
    created_at: new Date().toISOString(),
    first_name: pin.name.split(' ')[0] || '',
    last_name: pin.name.split(' ').slice(1).join(' ') || '',
    email: pin.email || '',
    phone: pin.phone || '',
    address: pin.address || '',
    notes: pin.note || '',
    status: 'new_prospect',
    value: 0,
  };
}
