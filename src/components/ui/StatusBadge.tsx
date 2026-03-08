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
const statusVariants: Record<string, Variant> = {
  // Client
  active: 'success',
  lead: 'info',
  inactive: 'neutral',
  // Job
  draft: 'neutral',
  scheduled: 'info',
  in_progress: 'warning',
  completed: 'success',
  cancelled: 'danger',
  // Invoice
  sent: 'info',
  partial: 'warning',
  paid: 'success',
  void: 'danger',
  past_due: 'danger',
  overdue: 'danger',
  // Lead stages
  qualified: 'info',
  contacted: 'info',
  quote_sent: 'warning',
  closed: 'success',
  lost: 'danger',
  won: 'success',
  new: 'info',
  // Pipeline
  'Qualified': 'info',
  'Contact': 'info',
  'Quote Sent': 'warning',
  'Closed': 'success',
  'Lost': 'danger',
  // Payment
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

export default function StatusBadge({ status, variant, dot, className }: StatusBadgeProps) {
  const resolvedVariant = variant || statusVariants[status] || statusVariants[status.toLowerCase()] || 'neutral';
  const label = status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <span className={cn(variantMap[resolvedVariant], className)}>
      {dot && (
        <span className="w-1.5 h-1.5 rounded-full bg-current mr-1 opacity-80" />
      )}
      {label}
    </span>
  );
}
