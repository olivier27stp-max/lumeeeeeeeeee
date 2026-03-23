// ─── Workflow Preset Library ─────────────────────────────────────
// Fully prebuilt workflows ready for instant use.
// Each preset defines a complete node graph with edges.

import type { TriggerType, ActionType } from './workflowApi';

export interface PresetNode {
  id: string;
  node_type: 'trigger' | 'condition' | 'action' | 'delay';
  action_type?: ActionType;
  label: string;
  config: Record<string, any>;
  position_x: number;
  position_y: number;
}

export interface PresetEdge {
  source: string;
  target: string;
  label?: string;
}

export interface WorkflowPreset {
  id: string;
  name: string;
  description: string;
  category: 'lead' | 'estimate' | 'invoice' | 'job' | 'review' | 'field' | 'payment';
  icon: string;
  trigger_type: TriggerType;
  nodes: PresetNode[];
  edges: PresetEdge[];
}

export const PRESET_CATEGORIES = [
  { id: 'lead', label: 'Quotes', icon: 'FileText' },
  { id: 'estimate', label: 'Estimates', icon: 'FileText' },
  { id: 'invoice', label: 'Invoices', icon: 'Receipt' },
  { id: 'job', label: 'Jobs', icon: 'Briefcase' },
  { id: 'review', label: 'Reviews', icon: 'Star' },
  { id: 'field', label: 'Field Ops', icon: 'MapPin' },
  { id: 'payment', label: 'Payments', icon: 'CreditCard' },
] as const;

export const WORKFLOW_PRESETS: WorkflowPreset[] = [
  // ═══ 1. New Lead Welcome ═══
  {
    id: 'new_lead_welcome',
    name: 'New Lead Welcome',
    description: 'Send a welcome SMS, assign a lead owner, and create a follow-up task when a new lead arrives.',
    category: 'lead',
    icon: 'UserPlus',
    trigger_type: 'lead_created',
    nodes: [
      { id: 'n1', node_type: 'trigger', label: 'Lead Created', config: { trigger_type: 'lead_created' }, position_x: 250, position_y: 0 },
      { id: 'n2', node_type: 'action', action_type: 'send_sms', label: 'Send Welcome SMS', config: { body: 'Hi {client_name}, thanks for reaching out! We\'ll get back to you shortly.' }, position_x: 250, position_y: 120 },
      { id: 'n3', node_type: 'action', action_type: 'assign_user', label: 'Assign Lead Owner', config: { user_id: '', assignment_rule: 'round_robin' }, position_x: 250, position_y: 240 },
      { id: 'n4', node_type: 'action', action_type: 'create_task', label: 'Create Follow-Up Task', config: { title: 'Follow up with {client_name}', assignee: 'lead_owner' }, position_x: 250, position_y: 360 },
    ],
    edges: [
      { source: 'n1', target: 'n2' },
      { source: 'n2', target: 'n3' },
      { source: 'n3', target: 'n4' },
    ],
  },

  // ═══ 2. Estimate Follow-Up ═══
  {
    id: 'estimate_followup',
    name: 'Estimate Follow-Up',
    description: 'Wait 24 hours after sending an estimate. If not approved, send a follow-up message.',
    category: 'estimate',
    icon: 'FileText',
    trigger_type: 'estimate_sent',
    nodes: [
      { id: 'n1', node_type: 'trigger', label: 'Estimate Sent', config: { trigger_type: 'estimate_sent' }, position_x: 250, position_y: 0 },
      { id: 'n2', node_type: 'delay', label: 'Wait 24 Hours', config: { delay_value: 24, delay_unit: 'hours' }, position_x: 250, position_y: 120 },
      { id: 'n3', node_type: 'condition', label: 'Estimate Not Approved?', config: { conditions: [{ field: 'estimate_status', operator: 'not_equals', value: 'approved' }], operator: 'AND' }, position_x: 250, position_y: 240 },
      { id: 'n4', node_type: 'action', action_type: 'send_sms', label: 'Send Follow-Up SMS', config: { body: 'Hi {client_name}, just checking in on the estimate we sent. Let us know if you have any questions!' }, position_x: 250, position_y: 360 },
    ],
    edges: [
      { source: 'n1', target: 'n2' },
      { source: 'n2', target: 'n3' },
      { source: 'n3', target: 'n4', label: 'Yes' },
    ],
  },

  // ═══ 3. Estimate Approved ═══
  {
    id: 'estimate_approved',
    name: 'Estimate Approved',
    description: 'When an estimate is approved, update status, create a job, and notify the team.',
    category: 'estimate',
    icon: 'CheckCircle',
    trigger_type: 'estimate_approved',
    nodes: [
      { id: 'n1', node_type: 'trigger', label: 'Estimate Approved', config: { trigger_type: 'estimate_approved' }, position_x: 250, position_y: 0 },
      { id: 'n2', node_type: 'action', action_type: 'update_status', label: 'Update to "Approved"', config: { status: 'approved' }, position_x: 250, position_y: 120 },
      { id: 'n3', node_type: 'action', action_type: 'create_task', label: 'Create Job', config: { title: 'New job for {client_name}', assignee: 'lead_owner' }, position_x: 120, position_y: 250 },
      { id: 'n4', node_type: 'action', action_type: 'send_notification', label: 'Notify Team', config: { title: 'Estimate approved', body: '{client_name} approved estimate #{estimate_number}' }, position_x: 380, position_y: 250 },
    ],
    edges: [
      { source: 'n1', target: 'n2' },
      { source: 'n2', target: 'n3' },
      { source: 'n2', target: 'n4' },
    ],
  },

  // ═══ 4. Invoice Reminder ═══
  {
    id: 'invoice_reminder',
    name: 'Invoice Reminder',
    description: 'Send a payment reminder when an invoice is overdue, and escalate internally after 7 days.',
    category: 'invoice',
    icon: 'AlertCircle',
    trigger_type: 'invoice_overdue',
    nodes: [
      { id: 'n1', node_type: 'trigger', label: 'Invoice Overdue', config: { trigger_type: 'invoice_overdue' }, position_x: 250, position_y: 0 },
      { id: 'n2', node_type: 'action', action_type: 'send_email', label: 'Send Payment Reminder', config: { subject: 'Payment Reminder - Invoice #{invoice_number}', body: 'Hi {client_name}, this is a friendly reminder that invoice #{invoice_number} for {invoice_amount} is now overdue. Please submit payment at your earliest convenience.' }, position_x: 250, position_y: 120 },
      { id: 'n3', node_type: 'delay', label: 'Wait 7 Days', config: { delay_value: 7, delay_unit: 'days' }, position_x: 250, position_y: 240 },
      { id: 'n4', node_type: 'condition', label: 'Still Unpaid?', config: { conditions: [{ field: 'invoice_status', operator: 'equals', value: 'overdue' }], operator: 'AND' }, position_x: 250, position_y: 360 },
      { id: 'n5', node_type: 'action', action_type: 'create_task', label: 'Escalate Internally', config: { title: 'Follow up on overdue invoice #{invoice_number}', assignee: 'manager' }, position_x: 250, position_y: 480 },
    ],
    edges: [
      { source: 'n1', target: 'n2' },
      { source: 'n2', target: 'n3' },
      { source: 'n3', target: 'n4' },
      { source: 'n4', target: 'n5', label: 'Yes' },
    ],
  },

  // ═══ 5. Review Request ═══
  {
    id: 'review_request',
    name: 'Review Request',
    description: 'Wait 2 hours after a job is completed, then send a review request via SMS.',
    category: 'review',
    icon: 'Star',
    trigger_type: 'job_completed',
    nodes: [
      { id: 'n1', node_type: 'trigger', label: 'Job Completed', config: { trigger_type: 'job_completed' }, position_x: 250, position_y: 0 },
      { id: 'n2', node_type: 'delay', label: 'Wait 2 Hours', config: { delay_value: 2, delay_unit: 'hours' }, position_x: 250, position_y: 120 },
      { id: 'n3', node_type: 'action', action_type: 'request_review', label: 'Send Review Request', config: { template: 'Hi {client_name}, we just finished your job. We\'d love your feedback! Leave us a review: {review_link}' }, position_x: 250, position_y: 240 },
    ],
    edges: [
      { source: 'n1', target: 'n2' },
      { source: 'n2', target: 'n3' },
    ],
  },

  // ═══ 6. Missed Lead Response ═══
  {
    id: 'missed_lead_response',
    name: 'Missed Lead Response',
    description: 'If a new lead gets no response within 4 hours, notify the team and assign an escalation.',
    category: 'lead',
    icon: 'AlertTriangle',
    trigger_type: 'lead_created',
    nodes: [
      { id: 'n1', node_type: 'trigger', label: 'Lead Created', config: { trigger_type: 'lead_created' }, position_x: 250, position_y: 0 },
      { id: 'n2', node_type: 'delay', label: 'Wait 4 Hours', config: { delay_value: 4, delay_unit: 'hours' }, position_x: 250, position_y: 120 },
      { id: 'n3', node_type: 'condition', label: 'No Response Yet?', config: { conditions: [{ field: 'lead_contacted', operator: 'equals', value: false }], operator: 'AND' }, position_x: 250, position_y: 240 },
      { id: 'n4', node_type: 'action', action_type: 'send_notification', label: 'Alert Team', config: { title: 'Missed lead!', body: 'Lead {client_name} has had no response for 4 hours.' }, position_x: 120, position_y: 370 },
      { id: 'n5', node_type: 'action', action_type: 'assign_user', label: 'Assign Escalation', config: { user_id: '', assignment_rule: 'manager' }, position_x: 380, position_y: 370 },
    ],
    edges: [
      { source: 'n1', target: 'n2' },
      { source: 'n2', target: 'n3' },
      { source: 'n3', target: 'n4', label: 'Yes' },
      { source: 'n3', target: 'n5', label: 'Yes' },
    ],
  },

  // ═══ 7. Deposit Received ═══
  {
    id: 'deposit_received',
    name: 'Deposit Received',
    description: 'When a deposit payment is received, update the job to "Ready to Schedule".',
    category: 'payment',
    icon: 'CreditCard',
    trigger_type: 'payment_received',
    nodes: [
      { id: 'n1', node_type: 'trigger', label: 'Payment Received', config: { trigger_type: 'payment_received' }, position_x: 250, position_y: 0 },
      { id: 'n2', node_type: 'condition', label: 'Is Deposit?', config: { conditions: [{ field: 'payment_type', operator: 'equals', value: 'deposit' }], operator: 'AND' }, position_x: 250, position_y: 120 },
      { id: 'n3', node_type: 'action', action_type: 'update_status', label: 'Set "Ready to Schedule"', config: { status: 'ready_to_schedule' }, position_x: 250, position_y: 250 },
      { id: 'n4', node_type: 'action', action_type: 'send_notification', label: 'Notify Scheduler', config: { title: 'Deposit received', body: '{client_name} paid deposit. Job ready to schedule.' }, position_x: 250, position_y: 370 },
    ],
    edges: [
      { source: 'n1', target: 'n2' },
      { source: 'n2', target: 'n3', label: 'Yes' },
      { source: 'n3', target: 'n4' },
    ],
  },

  // ═══ 8. Technician Arrived ═══
  {
    id: 'technician_arrived',
    name: 'Technician Arrived',
    description: 'When a technician enters a geofence, update the job status and notify the client.',
    category: 'field',
    icon: 'MapPin',
    trigger_type: 'technician_arrived',
    nodes: [
      { id: 'n1', node_type: 'trigger', label: 'Technician Arrived', config: { trigger_type: 'technician_arrived' }, position_x: 250, position_y: 0 },
      { id: 'n2', node_type: 'action', action_type: 'update_status', label: 'Update to "In Progress"', config: { status: 'in_progress' }, position_x: 120, position_y: 130 },
      { id: 'n3', node_type: 'action', action_type: 'send_sms', label: 'Notify Client', config: { body: 'Hi {client_name}, our technician has arrived on site. Work is starting now!' }, position_x: 380, position_y: 130 },
    ],
    edges: [
      { source: 'n1', target: 'n2' },
      { source: 'n1', target: 'n3' },
    ],
  },

  // ═══ 9. No Show / Stale Location ═══
  {
    id: 'stale_location',
    name: 'No Show / Stale Location',
    description: 'If no location update is received for 30 minutes during a scheduled job, alert dispatch.',
    category: 'field',
    icon: 'AlertTriangle',
    trigger_type: 'job_started',
    nodes: [
      { id: 'n1', node_type: 'trigger', label: 'Job Started', config: { trigger_type: 'job_started' }, position_x: 250, position_y: 0 },
      { id: 'n2', node_type: 'delay', label: 'Wait 30 Minutes', config: { delay_value: 30, delay_unit: 'minutes' }, position_x: 250, position_y: 120 },
      { id: 'n3', node_type: 'condition', label: 'No Location Update?', config: { conditions: [{ field: 'location_stale', operator: 'equals', value: true }], operator: 'AND' }, position_x: 250, position_y: 240 },
      { id: 'n4', node_type: 'action', action_type: 'send_notification', label: 'Alert Dispatch', config: { title: 'Possible no-show', body: 'No location update from {technician_name} for 30 minutes on job #{job_number}.' }, position_x: 250, position_y: 370 },
    ],
    edges: [
      { source: 'n1', target: 'n2' },
      { source: 'n2', target: 'n3' },
      { source: 'n3', target: 'n4', label: 'Yes' },
    ],
  },

  // ═══ 10. Lost Lead Handling ═══
  {
    id: 'lost_lead_handling',
    name: 'Lost Lead Handling',
    description: 'When a lead is marked as lost, tag it, ask for a loss reason, and schedule a reactivation reminder.',
    category: 'lead',
    icon: 'UserMinus',
    trigger_type: 'lead_updated',
    nodes: [
      { id: 'n1', node_type: 'trigger', label: 'Lead Updated', config: { trigger_type: 'lead_updated' }, position_x: 250, position_y: 0 },
      { id: 'n2', node_type: 'condition', label: 'Status = Lost?', config: { conditions: [{ field: 'lead_status', operator: 'equals', value: 'lost' }], operator: 'AND' }, position_x: 250, position_y: 120 },
      { id: 'n3', node_type: 'action', action_type: 'add_tag', label: 'Tag as Lost', config: { tag: 'lost-lead' }, position_x: 120, position_y: 250 },
      { id: 'n4', node_type: 'action', action_type: 'create_note', label: 'Ask Loss Reason', config: { content: 'Follow up: why was this lead lost? Record reason.' }, position_x: 380, position_y: 250 },
      { id: 'n5', node_type: 'action', action_type: 'schedule_reminder', label: 'Reactivation Reminder', config: { delay: 90, delay_unit: 'days', message: 'Consider reactivating lead {client_name}' }, position_x: 250, position_y: 380 },
    ],
    edges: [
      { source: 'n1', target: 'n2' },
      { source: 'n2', target: 'n3', label: 'Yes' },
      { source: 'n2', target: 'n4', label: 'Yes' },
      { source: 'n3', target: 'n5' },
    ],
  },
];

export function getPresetsByCategory(category: string): WorkflowPreset[] {
  return WORKFLOW_PRESETS.filter((p) => p.category === category);
}

export function getPresetById(id: string): WorkflowPreset | undefined {
  return WORKFLOW_PRESETS.find((p) => p.id === id);
}
