import { Filter } from 'lucide-react';
import { useTranslation } from '../../i18n';

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

/**
 * Reusable filter bar — collapses to status + date range for sales_rep,
 * expands with the rep selector when `reps` is provided (admin/owner).
 */
export default function CommissionFilters({ value, onChange, reps }: Props) {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const set = <K extends keyof CommissionFiltersValue>(key: K, v: CommissionFiltersValue[K]) =>
    onChange({ ...value, [key]: v });

  const statusOptions: { value: CommissionStatusFilter; label: string }[] = [
    { value: 'all',      label: fr ? 'Tous les statuts' : 'All statuses' },
    { value: 'pending',  label: fr ? 'En attente' : 'Pending' },
    { value: 'approved', label: fr ? 'Approuvé' : 'Approved' },
    { value: 'paid',     label: fr ? 'Versé' : 'Paid' },
    { value: 'reversed', label: fr ? 'Reversé' : 'Reversed' },
  ];
  // Menus déroulants lisibles en clair/sombre (fond + texte forcés).
  const selCls = 'rounded-md border border-border-subtle px-2 py-1 text-xs text-text-primary';
  const selStyle = { colorScheme: 'dark light' } as const;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border-subtle bg-surface px-3 py-2">
      <div className="flex items-center gap-1.5 text-xs font-medium text-text-muted">
        <Filter className="h-3 w-3" /> {fr ? 'Filtres' : 'Filters'}
      </div>

      <select
        value={value.status}
        onChange={(e) => set('status', e.target.value as CommissionStatusFilter)}
        className={selCls} style={selStyle}
        aria-label={fr ? 'Filtrer par statut' : 'Status filter'}
      >
        {statusOptions.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>

      <input
        type="date"
        value={value.from}
        onChange={(e) => set('from', e.target.value)}
        className={selCls} style={selStyle}
        aria-label={fr ? 'Date de début' : 'From date'}
      />
      <span className="text-xs text-text-muted">→</span>
      <input
        type="date"
        value={value.to}
        onChange={(e) => set('to', e.target.value)}
        className={selCls} style={selStyle}
        aria-label={fr ? 'Date de fin' : 'To date'}
      />

      {reps && reps.length > 0 && (
        <select
          value={value.repId || ''}
          onChange={(e) => set('repId', e.target.value || undefined)}
          className={selCls} style={selStyle}
          aria-label={fr ? 'Filtrer par représentant' : 'Sales rep filter'}
        >
          <option value="">{fr ? 'Tous les représentants' : 'All reps'}</option>
          {reps.map((r) => (
            <option key={r.id} value={r.id}>{r.label}</option>
          ))}
        </select>
      )}
    </div>
  );
}
