import React from 'react';
import type { RecentTransaction } from '../../../lib/financeDashboardApi';

function fmtDollars(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'CAD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format((cents || 0) / 100);
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }) + ', ' + d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function TypeBadge({ type }: { type: string }) {
  const isIncome = type === 'income';
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold ${
        isIncome
          ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
          : 'bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400'
      }`}
    >
      {isIncome ? 'Income' : 'Expenses'}
    </span>
  );
}

export default function TransactionsTableCard({
  transactions,
  onViewAll,
}: {
  transactions: RecentTransaction[];
  onViewAll?: () => void;
}) {
  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-5 h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Transactions</h3>
        <button
          onClick={onViewAll}
          className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors"
        >
          View All
        </button>
      </div>

      {/* Table header */}
      <div className="grid grid-cols-[1fr_160px_90px_100px] gap-2 px-1 pb-2 border-b border-zinc-100 dark:border-zinc-800">
        <span className="text-xs font-medium text-zinc-400 dark:text-zinc-500">Transaction</span>
        <span className="text-xs font-medium text-zinc-400 dark:text-zinc-500">Date</span>
        <span className="text-xs font-medium text-zinc-400 dark:text-zinc-500">Type</span>
        <span className="text-xs font-medium text-zinc-400 dark:text-zinc-500 text-right">Amount</span>
      </div>

      {/* Rows */}
      <div className="flex-1 overflow-y-auto divide-y divide-zinc-50 dark:divide-zinc-800">
        {transactions.length === 0 && (
          <div className="py-10 text-center text-sm text-zinc-400 dark:text-zinc-500">
            No recent transactions
          </div>
        )}
        {transactions.map((tx) => {
          const isIncome = tx.type === 'income';
          return (
            <div
              key={tx.id}
              className="grid grid-cols-[1fr_160px_90px_100px] gap-2 items-center py-3.5 px-1 hover:bg-zinc-50/60 dark:hover:bg-zinc-800/60 transition-colors rounded-lg"
            >
              {/* Avatar + Name */}
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                  style={{ backgroundColor: tx.color }}
                >
                  {tx.initials}
                </div>
                <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200 truncate">
                  {tx.label}
                </span>
              </div>
              {/* Date */}
              <span className="text-xs text-zinc-500 dark:text-zinc-400 truncate">{fmtDate(tx.date)}</span>
              {/* Type */}
              <TypeBadge type={tx.type} />
              {/* Amount */}
              <span
                className={`text-sm font-semibold tabular-nums text-right ${
                  isIncome ? 'text-zinc-900 dark:text-zinc-100' : 'text-rose-500'
                }`}
              >
                {isIncome ? '' : '-'}{fmtDollars(tx.amount_cents)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
