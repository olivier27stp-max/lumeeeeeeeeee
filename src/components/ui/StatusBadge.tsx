import React from 'react';
import { cn } from '../../lib/utils';

type Variant = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

const variantMap: Record<Variant, string> = {
  success: 'badge-success',
  warning: 'badge-warning',
  danger: 'badge-danger',
  info: 'badge-info',
  neutral: 'badge-neutral',
};

// Common status → variant mapping for CRM entities
// Covers both DB values (snake_case) and display labels (Title Case)
const statusVariants: Record<string, Variant> = {
  // ── Client ──
  active: 'success',
  lead: 'info',
  inactive: 'neutral',

  // ── Job (DB values) ──
  draft: 'neutral',
  scheduled: 'info',
  in_progress: 'warning',
  completed: 'success',
  cancelled: 'danger',
  // Job (derived/display values)
  late: 'danger',
  unscheduled: 'neutral',
  requires_invoicing: 'warning',
  action_required: 'danger',
  // Job (display labels — for StatusBadge receiving formatted strings)
  'Draft': 'neutral',
  'Scheduled': 'info',
  'In Progress': 'warning',
  'Completed': 'success',
  'Cancelled': 'danger',
  'Late': 'danger',
  'Unscheduled': 'neutral',
  'Requires Invoicing': 'warning',
  'Action Required': 'danger',
  'Ending within 30 days': 'warning',

  // ── Invoice ──
  sent: 'info',
  partial: 'warning',
  paid: 'success',
  void: 'danger',
  past_due: 'danger',
  overdue: 'danger',
  'Sent': 'info',
  'Partial': 'warning',
  'Paid': 'success',
  'Void': 'danger',
  'Past Due': 'danger',
  'Overdue': 'danger',

  // ── Quote ──
  awaiting_response: 'warning',
  approved: 'success',
  declined: 'danger',
  expired: 'neutral',
  converted: 'success',
  'Awaiting Response': 'warning',
  'Approved': 'success',
  'Declined': 'danger',
  'Expired': 'neutral',
  'Converted': 'success',

  // ── Lead / Pipeline stages ──
  new: 'info',
  new_prospect: 'info',
  no_response: 'warning',
  quote_sent: 'warning',
  closed_won: 'success',
  closed_lost: 'danger',
  'New Prospect': 'info',
  'No Response': 'warning',
  'Quote Sent': 'warning',
  'Closed Won': 'success',
  'Closed Lost': 'danger',

  // ── Schedule events ──
  confirmed: 'success',
  tentative: 'warning',

  // ── Legacy ──
  follow_up_1: 'info',
  follow_up_2: 'warning',
  follow_up_3: 'warning',
  closed: 'success',
  lost: 'danger',
  'New': 'info',
  'Follow-up 1': 'info',
  'Follow-up 2': 'warning',
  'Follow-up 3': 'warning',
  'Closed': 'success',
  'Lost': 'danger',
  qualified: 'info',
  contacted: 'info',
  won: 'success',

  // ── Payment ──
  succeeded: 'success',
  pending: 'warning',
  failed: 'danger',
  refunded: 'neutral',
};

interface StatusBadgeProps {
  status: string;
  variant?: Variant;
  dot?: boolean;
  className?: string;
}

export default function StatusBadge({ status, variant, dot = true, className }: StatusBadgeProps) {
  const resolvedVariant = variant || statusVariants[status] || statusVariants[status.toLowerCase()] || 'neutral';
  const label = status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <span className={cn(variantMap[resolvedVariant], className)}>
      {dot && (
        <span className="w-[5px] h-[5px] rounded-full bg-current shrink-0 opacity-90" />
      )}
      {label}
    </span>
  );
}
