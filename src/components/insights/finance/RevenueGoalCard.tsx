import React from 'react';

function fmtDollars(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'CAD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format((cents || 0) / 100);
}

function fmtCompact(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'CAD',
    notation: 'compact',
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  }).format((cents || 0) / 100);
}

export default function RevenueGoalCard({
  currentCents,
  targetCents,
  onViewReport,
}: {
  currentCents: number;
  targetCents: number;
  onViewReport?: () => void;
}) {
  const pct = targetCents > 0 ? Math.min(100, (currentCents / targetCents) * 100) : 0;

  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-1">
        <div>
          <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Revenue Goal</h3>
          <p className="text-xs text-zinc-400 dark:text-zinc-500">{pct.toFixed(0)}% Progress</p>
        </div>
        <button
          onClick={onViewReport}
          className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors"
        >
          View Report
        </button>
      </div>

      {/* Value */}
      <div className="mt-4 mb-3 flex items-baseline gap-2">
        <span className="text-3xl font-bold text-zinc-900 dark:text-zinc-100 tabular-nums tracking-tight">
          {fmtDollars(currentCents)}
        </span>
        <span className="text-sm text-zinc-400 dark:text-zinc-500 font-medium">
          of {fmtCompact(targetCents)}
        </span>
      </div>

      {/* Divider */}
      <div className="border-t border-zinc-100 dark:border-zinc-800 mb-4" />

      {/* Progress bar */}
      <div className="h-3 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
        <div
          className="h-full rounded-full bg-emerald-500 transition-all duration-700"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
