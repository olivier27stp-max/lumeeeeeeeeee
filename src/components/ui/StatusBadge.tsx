import React, { useState } from 'react';
import {
  User,
  CheckCircle,
  PauseCircle,
  XCircle,
  Clock,
  AlertCircle,
  AlertTriangle,
  MinusCircle,
  Circle,
  Send,
  Loader2,
  Archive,
  CalendarClock,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { useTranslation } from '../../i18n';

type Variant = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

// Premium dark-gradient treatment per variant — enterprise SaaS status system.
const variantStyle: Record<Variant, { bg: string; icon: string; defaultIcon: LucideIcon }> = {
  success: { bg: 'linear-gradient(135deg, #0F5132 0%, #0A3822 100%)', icon: '#43D17B', defaultIcon: CheckCircle },
  info:    { bg: 'linear-gradient(135deg, #1A1D24 0%, #0F1117 100%)', icon: '#4F8CFF', defaultIcon: Circle },
  warning: { bg: 'linear-gradient(135deg, #3A2E12 0%, #241B08 100%)', icon: '#E0A93B', defaultIcon: Clock },
  danger:  { bg: 'linear-gradient(135deg, #3A1618 0%, #241012 100%)', icon: '#E5565B', defaultIcon: XCircle },
  neutral: { bg: 'linear-gradient(135deg, #3A3A3A 0%, #232323 100%)', icon: '#B5B5B5', defaultIcon: MinusCircle },
};

// Per-status icon overrides (keyed by normalized snake_case status).
const statusIcons: Record<string, LucideIcon> = {
  // Client
  lead: User,
  active: CheckCircle,
  inactive: PauseCircle,
  // Job
  draft: Circle,
  scheduled: Clock,
  in_progress: Loader2,
  completed: CheckCircle,
  cancelled: XCircle,
  late: AlertTriangle,
  unscheduled: MinusCircle,
  requires_invoicing: AlertCircle,
  action_required: AlertCircle,
  upcoming: CalendarClock,
  // Invoice
  sent: Send,
  partial: Clock,
  paid: CheckCircle,
  void: XCircle,
  past_due: AlertCircle,
  overdue: AlertCircle,
  // Quote
  awaiting_response: Clock,
  changes_requested: AlertCircle,
  approved: CheckCircle,
  declined: XCircle,
  expired: MinusCircle,
  converted: CheckCircle,
  // Lead / pipeline
  new: User,
  new_prospect: User,
  no_response: Clock,
  quote_sent: Send,
  closed_won: CheckCircle,
  closed_lost: XCircle,
  qualified: User,
  contacted: User,
  won: CheckCircle,
  follow_up_1: Clock,
  follow_up_2: Clock,
  follow_up_3: Clock,
  closed: CheckCircle,
  lost: XCircle,
  // Schedule
  confirmed: CheckCircle,
  tentative: Clock,
  // Payment
  succeeded: CheckCircle,
  pending: Clock,
  failed: XCircle,
  refunded: MinusCircle,
  // Misc
  archived: Archive,
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
  // Job (derived/display values) — 4-status system
  late: 'danger',          // red
  unscheduled: 'warning',
  requires_invoicing: 'warning',
  action_required: 'warning', // yellow
  upcoming: 'success',        // green
  // Job (display labels — for StatusBadge receiving formatted strings)
  'Draft': 'warning',
  'Scheduled': 'success',
  'In Progress': 'success',
  'Completed': 'neutral',
  'Cancelled': 'neutral',
  'Late': 'danger',
  'Unscheduled': 'warning',
  'Requires Invoicing': 'warning',
  'Action Required': 'warning',
  'Upcoming': 'success',
  'Archived': 'neutral',
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
  changes_requested: 'danger',
  approved: 'success',
  declined: 'danger',
  expired: 'neutral',
  converted: 'success',
  'Awaiting Response': 'warning',
  'Changes Requested': 'danger',
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

  // ── Misc ──
  archived: 'neutral',
};

const BASE_SHADOW = '0 4px 12px rgba(0,0,0,0.20)';
const HOVER_SHADOW = '0 8px 20px rgba(0,0,0,0.28)';

interface StatusBadgeProps {
  status: string;
  variant?: Variant;
  /** @deprecated the premium badge always renders an icon; kept for API compatibility */
  dot?: boolean;
  className?: string;
}

export default function StatusBadge({ status, variant, className }: StatusBadgeProps) {
  const { t } = useTranslation();
  const [hovered, setHovered] = useState(false);

  const resolvedVariant = variant || statusVariants[status] || statusVariants[status.toLowerCase()] || 'neutral';
  // Normalize to a snake_case key: "Foo Bar" → foo_bar, "past-due" → past_due
  const key = status.includes(' ')
    ? status.toLowerCase().replace(/\s+/g, '_').replace(/-/g, '_')
    : status.toLowerCase().replace(/-/g, '_');

  const translated = (t as any).status?.[key];
  const label = translated || status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  // Archived jobs get a dedicated near-black treatment.
  // Requires-invoicing keeps the dark premium look but shifts orange, so it
  // reads distinct from the amber "Action Required" warning variant.
  const style = key === 'archived'
    ? { bg: 'linear-gradient(135deg, #1C1C1E 0%, #08080A 100%)', icon: '#8A8A8E', defaultIcon: Archive }
    : key === 'requires_invoicing'
      ? { bg: 'linear-gradient(135deg, #47280D 0%, #2B1706 100%)', icon: '#F58A2E', defaultIcon: AlertCircle }
      : variantStyle[resolvedVariant];
  const Icon = statusIcons[key] || style.defaultIcon;

  return (
    <span
      className={className}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: 24,
        // No minWidth: the bubble hugs its label, so short statuses stay
        // compact and long ones grow naturally.
        padding: '0 10px',
        borderRadius: 999,
        background: style.bg,
        border: '1px solid rgba(255,255,255,0.08)',
        boxShadow: hovered ? HOVER_SHADOW : BASE_SHADOW,
        transform: hovered ? 'translateY(-1px)' : 'translateY(0)',
        transition: 'all 0.18s ease',
        whiteSpace: 'nowrap',
        userSelect: 'none',
      }}
    >
      <Icon size={12} color={style.icon} strokeWidth={2.25} aria-hidden />
      <span
        aria-hidden
        style={{ width: 1, height: 11, background: 'rgba(255,255,255,0.12)', margin: '0 6px' }}
      />
      <span
        style={{
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: '#FFFFFF',
          lineHeight: 1,
        }}
      >
        {label}
      </span>
    </span>
  );
}
