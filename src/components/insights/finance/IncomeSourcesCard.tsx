import React from 'react';
import { ArrowUpRight, MessageSquare } from 'lucide-react';

const SOURCE_COLORS = ['#171717', '#3f3f46', '#71717a', '#a1a1aa'];

interface IncomeSource {
  name: string;
  value: number;
}

function fmtDollars(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'CAD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format((cents || 0) / 100);
}

export default function IncomeSourcesCard({
  totalIncome,
  changePct,
  sources,
}: {
  totalIncome: number;
  changePct: number | null;
  sources: IncomeSource[];
}) {
  const total = sources.reduce((s, src) => s + src.value, 0) || 1;

  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-5 flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Top Services</h3>
        <ArrowUpRight size={16} className="text-zinc-400 dark:text-zinc-500" />
      </div>

      {/* Total */}
      <div className="mb-1">
        <p className="text-xs text-zinc-400 dark:text-zinc-500 mb-0.5">Total Income</p>
        <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 tabular-nums tracking-tight">
          {fmtDollars(totalIncome)}
        </p>
      </div>
      {changePct != null && (
        <span
          className={`inline-flex items-center gap-0.5 text-xs font-medium mb-4 ${
            changePct >= 0 ? 'text-emerald-600' : 'text-rose-500'
          }`}
        >
          <ArrowUpRight size={13} />
          {Math.abs(changePct).toFixed(1)}% compared to last month
        </span>
      )}

      {/* Segmented progress bar */}
      <div className="flex rounded-full overflow-hidden h-2.5 mb-5">
        {sources.map((src, i) => (
          <div
            key={src.name}
            className="h-full first:rounded-l-full last:rounded-r-full"
            style={{
              width: `${(src.value / total) * 100}%`,
              backgroundColor: SOURCE_COLORS[i % SOURCE_COLORS.length],
            }}
          />
        ))}
      </div>

      {/* Source list */}
      <div className="space-y-3 flex-1">
        {sources.map((src, i) => (
          <div key={src.name} className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span
                className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: SOURCE_COLORS[i % SOURCE_COLORS.length] }}
              />
              <span className="text-sm text-zinc-600 dark:text-zinc-400">{src.name}</span>
            </div>
            <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 tabular-nums">
              {fmtDollars(src.value)}
            </span>
          </div>
        ))}
      </div>

      {/* Bottom note */}
      <div className="mt-5 flex items-start gap-2.5 rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-100 dark:border-zinc-700 p-3">
        <MessageSquare size={14} className="text-zinc-400 dark:text-zinc-500 mt-0.5 flex-shrink-0" />
        <div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
            Top 3 services by revenue for the selected period.
          </p>
          <p className="text-xs text-zinc-400 dark:text-zinc-500 leading-relaxed">
            The rest is grouped under "Other".
          </p>
        </div>
      </div>
    </div>
  );
}
