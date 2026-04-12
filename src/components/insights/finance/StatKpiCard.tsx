import React from 'react';
import { ArrowUpRight, ArrowDownRight, Wallet, TrendingUp, Receipt, AlertCircle } from 'lucide-react';

/* ── Helpers ────────────────────────────────────────────────── */

function fmtDollars(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'CAD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format((cents || 0) / 100);
}

function DeltaBadge({ value, label }: { value: number | null; label?: string }) {
  if (value == null) return null;
  const isUp = value > 0;
  const Icon = isUp ? ArrowUpRight : ArrowDownRight;
  const color = isUp ? 'text-emerald-600' : 'text-rose-500';
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${color}`}>
      <Icon size={14} />
      {Math.abs(value).toFixed(1)}%
      {label && <span className="text-zinc-400 dark:text-zinc-500 ml-1 font-normal">{label}</span>}
    </span>
  );
}

/* ── Balance Card ───────────────────────────────────────────── */

export function BalanceCard({
  value,
  changePct,
  onViewPayments,
  onExport,
}: {
  value: number;
  changePct: number | null;
  onViewPayments?: () => void;
  onExport?: () => void;
}) {
  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-5 flex flex-col justify-between min-h-[180px]">
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Wallet size={16} className="text-zinc-400 dark:text-zinc-500" />
          <span className="text-sm font-medium text-zinc-500 dark:text-zinc-400">My Balance</span>
        </div>
        <div className="flex items-end gap-3 flex-wrap">
          <span className="text-3xl font-bold text-zinc-900 dark:text-zinc-100 tabular-nums tracking-tight">
            {fmtDollars(value)}
          </span>
          <DeltaBadge value={changePct} />
        </div>
        <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1">compared to last month</p>
      </div>
      <div className="flex items-center gap-2 mt-4">
        <button
          onClick={onViewPayments}
          className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-medium py-2.5 px-4 hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors"
        >
          <ArrowUpRight size={13} />
          View Payments
        </button>
        <button
          onClick={onExport}
          className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 text-xs font-medium py-2.5 px-4 hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors"
        >
          <ArrowDownRight size={13} />
          Export
        </button>
      </div>
    </div>
  );
}

/* ── Net Profit Card ────────────────────────────────────────── */

export function NetProfitCard({
  value,
  changePct,
}: {
  value: number;
  changePct: number | null;
}) {
  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-5 flex flex-col justify-between min-h-[180px]">
      <div>
        <div className="flex items-center gap-2 mb-3">
          <TrendingUp size={16} className="text-zinc-400 dark:text-zinc-500" />
          <span className="text-sm font-medium text-zinc-500 dark:text-zinc-400">Net Profit</span>
        </div>
        <span className="text-3xl font-bold text-zinc-900 dark:text-zinc-100 tabular-nums tracking-tight">
          {fmtDollars(value)}
        </span>
      </div>
      <div className="mt-3">
        <DeltaBadge value={changePct} label="compared to last month" />
      </div>
    </div>
  );
}

/* ── Expenses Card ──────────────────────────────────────────── */

export function ExpensesCard({
  value,
  changePct,
}: {
  value: number;
  changePct: number | null;
}) {
  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-5 flex flex-col justify-between min-h-[180px]">
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Receipt size={16} className="text-zinc-400 dark:text-zinc-500" />
          <span className="text-sm font-medium text-zinc-500 dark:text-zinc-400">Expenses</span>
        </div>
        <span className="text-3xl font-bold text-zinc-900 dark:text-zinc-100 tabular-nums tracking-tight">
          {fmtDollars(value)}
        </span>
      </div>
      <div className="mt-3">
        <DeltaBadge value={changePct} label="compared to last month" />
      </div>
    </div>
  );
}

/* ── Pending Invoices Card ──────────────────────────────────── */

export function PendingInvoicesCard({
  value,
  overdueCount,
  microData,
}: {
  value: number;
  overdueCount: number;
  microData?: number[];
}) {
  const bars = microData || Array.from({ length: 24 }, () => Math.random() * 100);
  const maxBar = Math.max(...bars, 1);

  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-5 flex flex-col justify-between min-h-[180px]">
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <AlertCircle size={16} className="text-zinc-400 dark:text-zinc-500" />
            <span className="text-sm font-medium text-zinc-500 dark:text-zinc-400">Pending Invoices</span>
          </div>
          {overdueCount > 0 && (
            <span className="inline-flex items-center rounded-full bg-rose-500 text-white text-[10px] font-bold px-2.5 py-0.5">
              {overdueCount} overdue invoice{overdueCount > 1 ? 's' : ''}
            </span>
          )}
        </div>
        <span className="text-3xl font-bold text-zinc-900 dark:text-zinc-100 tabular-nums tracking-tight">
          {fmtDollars(value)}
        </span>
      </div>
      {/* Micro bar chart */}
      <div className="flex items-end gap-[2px] h-8 mt-3">
        {bars.map((v, i) => (
          <div
            key={i}
            className="flex-1 rounded-sm bg-zinc-800 dark:bg-zinc-300"
            style={{ height: `${Math.max(8, (v / maxBar) * 100)}%` }}
          />
        ))}
      </div>
    </div>
  );
}
