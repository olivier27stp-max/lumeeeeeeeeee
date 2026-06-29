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

export interface StatusStyle {
  solid: string; // dot / accent strip
  bg: string; // soft tinted pill background
  text: string; // pill label colour
  label: string;
}

export const STATUS_COLORS: Record<string, StatusStyle> = {
  scheduled: { solid: '#2563EB', bg: '#EFF6FF', text: '#2563EB', label: 'Scheduled' },
  in_progress: { solid: '#7C3AED', bg: '#F5F3FF', text: '#7C3AED', label: 'In progress' },
  completed: { solid: '#16A34A', bg: '#ECFDF5', text: '#059669', label: 'Completed' },
  completed_paid: { solid: '#0D9488', bg: '#F0FDFA', text: '#0D9488', label: 'Completed & paid' },
  paid: { solid: '#0D9488', bg: '#F0FDFA', text: '#0D9488', label: 'Paid' },
  late: { solid: '#DC2626', bg: '#FEF2F2', text: '#DC2626', label: 'Late' },
  action_required: { solid: '#CA8A04', bg: '#FEFCE8', text: '#CA8A04', label: 'Action required' },
  draft: { solid: '#CA8A04', bg: '#FEFCE8', text: '#CA8A04', label: 'Draft' },
  cancelled: { solid: '#9CA3AF', bg: '#F3F4F6', text: '#6B7280', label: 'Cancelled' },
};

export function statusStyle(status: string): StatusStyle {
  return STATUS_COLORS[status] ?? { solid: '#9CA3AF', bg: '#F3F4F6', text: '#6B7280', label: status };
}
