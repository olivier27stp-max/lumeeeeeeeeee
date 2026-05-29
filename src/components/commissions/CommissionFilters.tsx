import { Filter } from 'lucide-react';

export type CommissionStatusFilter = 'all' | 'pending' | 'approved' | 'paid' | 'reversed';

export interface CommissionFiltersValue {
  status: CommissionStatusFilter;
  from: string; // YYYY-MM-DD
  to: string;   // YYYY-MM-DD
  repId?: string; // admin/owner only
}

interface RepOption {
  id: string;
  label: string;
}

interface Props {
  value: CommissionFiltersValue;
  onChange: (next: CommissionFiltersValue) => void;
  reps?: RepOption[]; // when provided, shows the rep filter (admin/owner)
}

const STATUS_OPTIONS: { value: CommissionStatusFilter; label: string }[] = [
  { value: 'all',      label: 'All statuses' },
  { value: 'pending',  label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'paid',     label: 'Paid' },
  { value: 'reversed', label: 'Reversed' },
];

/**
 * Reusable filter bar — collapses to status + date range for sales_rep,
 * expands with the rep selector when `reps` is provided (admin/owner).
 */
export default function CommissionFilters({ value, onChange, reps }: Props) {
  const set = <K extends keyof CommissionFiltersValue>(key: K, v: CommissionFiltersValue[K]) =>
    onChange({ ...value, [key]: v });

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border-subtle bg-surface px-3 py-2">
      <div className="flex items-center gap-1.5 text-xs font-medium text-text-muted">
        <Filter className="h-3 w-3" /> Filters
      </div>

      <select
        value={value.status}
        onChange={(e) => set('status', e.target.value as CommissionStatusFilter)}
        className="rounded-md border border-border-subtle bg-surface px-2 py-1 text-xs text-text-primary"
        aria-label="Status filter"
      >
        {STATUS_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>

      <input
        type="date"
        value={value.from}
        onChange={(e) => set('from', e.target.value)}
        className="rounded-md border border-border-subtle bg-surface px-2 py-1 text-xs text-text-primary"
        aria-label="From date"
      />
      <span className="text-xs text-text-muted">→</span>
      <input
        type="date"
        value={value.to}
        onChange={(e) => set('to', e.target.value)}
        className="rounded-md border border-border-subtle bg-surface px-2 py-1 text-xs text-text-primary"
        aria-label="To date"
      />

      {reps && reps.length > 0 && (
        <select
          value={value.repId || ''}
          onChange={(e) => set('repId', e.target.value || undefined)}
          className="rounded-md border border-border-subtle bg-surface px-2 py-1 text-xs text-text-primary"
          aria-label="Sales rep filter"
        >
          <option value="">All reps</option>
          {reps.map((r) => (
            <option key={r.id} value={r.id}>{r.label}</option>
          ))}
        </select>
      )}
    </div>
  );
}
