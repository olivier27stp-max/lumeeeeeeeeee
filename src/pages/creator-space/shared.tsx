// Petits blocs partagés du Creator Space (helpers de format, badge
// d'engagement, tuile de stat, pagination). Interne plateforme seulement.

import React, { useEffect, useState } from 'react';
import { cn } from '../../lib/utils';
import type { EngagementLevel } from '../../lib/creatorSpaceApi';

export function useDebounced(value: string, delay = 300): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('fr-CA', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.toLocaleDateString('fr-CA', { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' })}`;
}

// Format maison : $100 (jamais « 100 $ »)
export function fmtMoney(cents: number | null | undefined, currency?: string | null): string {
  if (cents == null) return '—';
  const amount = cents / 100;
  const str = Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
  return `$${str}${currency && currency !== 'CAD' ? ` ${currency}` : ''}`;
}

export function relativeDays(days: number): string {
  if (days <= 0) return "aujourd'hui";
  if (days === 1) return 'hier';
  return `il y a ${days} j`;
}

const ENGAGEMENT_STYLE: Record<EngagementLevel, { label: string; cls: string; dot: string }> = {
  high: { label: 'Élevé', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' },
  medium: { label: 'Moyen', cls: 'bg-blue-50 text-blue-700 border-blue-200', dot: 'bg-blue-500' },
  low: { label: 'Faible', cls: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-500' },
  inactive: { label: 'Inactif', cls: 'bg-surface-secondary text-text-tertiary border-outline', dot: 'bg-gray-400' },
};

export function EngagementBadge({ level }: { level: EngagementLevel }) {
  const s = ENGAGEMENT_STYLE[level];
  return (
    <span className={cn('inline-flex items-center gap-1.5 px-2 h-[22px] rounded-full border text-[11px] font-semibold', s.cls)}>
      <span className={cn('w-1.5 h-1.5 rounded-full', s.dot)} />
      {s.label}
    </span>
  );
}

const SUB_STATUS_STYLE: Record<string, string> = {
  active: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  trialing: 'bg-blue-50 text-blue-700 border-blue-200',
  past_due: 'bg-red-50 text-red-700 border-red-200',
  canceled: 'bg-surface-secondary text-text-tertiary border-outline',
  incomplete: 'bg-amber-50 text-amber-700 border-amber-200',
};

const SUB_STATUS_LABEL: Record<string, string> = {
  active: 'Actif',
  trialing: 'Essai',
  past_due: 'Impayé',
  canceled: 'Annulé',
  incomplete: 'Incomplet',
};

export function SubStatusBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-[12px] text-text-tertiary">Aucun forfait</span>;
  return (
    <span className={cn('inline-flex items-center px-2 h-[22px] rounded-full border text-[11px] font-semibold', SUB_STATUS_STYLE[status] ?? 'bg-surface-secondary text-text-secondary border-outline')}>
      {SUB_STATUS_LABEL[status] ?? status}
    </span>
  );
}

export function StatTile({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-lg border border-outline bg-surface-card px-4 py-3.5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">{label}</p>
      <p className="mt-1 text-[24px] font-bold text-text-primary leading-tight">{value}</p>
      {hint && <p className="mt-0.5 text-[12px] text-text-tertiary">{hint}</p>}
    </div>
  );
}

export function Paginator({ page, total, pageSize, onPage }: { page: number; total: number; pageSize: number; onPage: (p: number) => void }) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  if (pageCount <= 1) return null;
  return (
    <div className="flex items-center justify-between px-4 py-2.5 border-t border-outline text-[12px] text-text-tertiary">
      <span>
        Page {page} sur {pageCount} · {total} résultat{total > 1 ? 's' : ''}
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          className="h-7 px-2.5 rounded-md border border-outline bg-surface text-text-secondary text-[12px] font-medium hover:bg-surface-secondary disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Précédent
        </button>
        <button
          type="button"
          disabled={page >= pageCount}
          onClick={() => onPage(page + 1)}
          className="h-7 px-2.5 rounded-md border border-outline bg-surface text-text-secondary text-[12px] font-medium hover:bg-surface-secondary disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Suivant
        </button>
      </div>
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message?: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <p className="text-[14px] font-semibold text-text-primary">Une erreur est survenue</p>
      <p className="mt-1 text-[13px] text-text-tertiary max-w-sm">{message || 'Impossible de charger les données.'}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 h-9 px-4 rounded-md border border-outline bg-surface-card text-[13px] font-medium text-text-secondary hover:bg-surface-secondary"
      >
        Réessayer
      </button>
    </div>
  );
}
