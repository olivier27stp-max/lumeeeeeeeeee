// Single source of truth for status colours, used by StatusPill (badges) and
// the Home job cards (left accent strip) so everything stays consistent.
//
// Scheme (per product):
//  - scheduled        → blue
//  - in_progress      → violet
//  - completed        → green
//  - completed_paid   → teal
//  - late             → red
//  - action_required  → yellow
//  - draft            → yellow
//  - cancelled        → grey

// The label is intentionally NOT stored here anymore: it is resolved via the
// i18n dictionary (mobileComp.status*) through statusLabel(status, t) so pills
// stay translated. labelKey maps a status slug → the mobileComp key.
export interface StatusStyle {
  solid: string; // dot / accent strip
  bg: string; // soft tinted pill background
  text: string; // pill label colour
  labelKey: string; // key into t.mobileComp for the display label
}

export const STATUS_COLORS: Record<string, StatusStyle> = {
  scheduled: { solid: '#2563EB', bg: '#EFF6FF', text: '#2563EB', labelKey: 'statusScheduled' },
  in_progress: { solid: '#7C3AED', bg: '#F5F3FF', text: '#7C3AED', labelKey: 'statusInProgress' },
  completed: { solid: '#16A34A', bg: '#ECFDF5', text: '#059669', labelKey: 'statusCompleted' },
  completed_paid: { solid: '#0D9488', bg: '#F0FDFA', text: '#0D9488', labelKey: 'statusCompletedPaid' },
  paid: { solid: '#0D9488', bg: '#F0FDFA', text: '#0D9488', labelKey: 'statusPaid' },
  late: { solid: '#DC2626', bg: '#FEF2F2', text: '#DC2626', labelKey: 'statusLate' },
  action_required: { solid: '#CA8A04', bg: '#FEFCE8', text: '#CA8A04', labelKey: 'statusActionRequired' },
  draft: { solid: '#CA8A04', bg: '#FEFCE8', text: '#CA8A04', labelKey: 'statusDraft' },
  cancelled: { solid: '#9CA3AF', bg: '#F3F4F6', text: '#6B7280', labelKey: 'statusCancelled' },
};

export function statusStyle(status: string): StatusStyle {
  return STATUS_COLORS[status] ?? { solid: '#9CA3AF', bg: '#F3F4F6', text: '#6B7280', labelKey: '' };
}

/** Resolve a status slug to a localized label. Falls back to the raw slug for
 *  unknown statuses (e.g. server-only statuses without a dictionary entry). */
export function statusLabel(
  status: string,
  comp: Record<string, string>,
): string {
  const key = STATUS_COLORS[status]?.labelKey;
  return (key && comp[key]) || status;
}
