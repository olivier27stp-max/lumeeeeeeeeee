import React from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts';
import { ChevronRight } from 'lucide-react';

const DONUT_COLORS_LIGHT = ['#171717', '#3f3f46', '#71717a', '#a1a1aa', '#d4d4d8'];
const DONUT_COLORS_DARK = ['#e4e4e7', '#a1a1aa', '#71717a', '#52525b', '#3f3f46'];

function useIsDark() {
  return document.documentElement.classList.contains('dark');
}

interface SummaryCategory {
  name: string;
  value: number;
  pct: number;
}

function fmtDollars(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'CAD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format((cents || 0) / 100);
}

export default function SummaryDonutCard({
  categories,
  totalCents,
  dateRange,
}: {
  categories: SummaryCategory[];
  totalCents: number;
  dateRange: string;
}) {
  const dark = useIsDark();

  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-5 flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-1">
        <div>
          <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Summary</h3>
          <p className="text-xs text-zinc-400 dark:text-zinc-500">{dateRange}</p>
        </div>
        <button className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 p-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors">
          <ChevronRight size={14} className="text-zinc-400 dark:text-zinc-500" />
        </button>
      </div>

      {/* Donut */}
      <div className="flex-1 flex items-center justify-center min-h-[180px] relative">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={categories}
              dataKey="value"
              nameKey="name"
              innerRadius="60%"
              outerRadius="85%"
              strokeWidth={2}
              stroke={dark ? '#18181b' : '#fff'}
            >
              {categories.map((_entry, i) => (
                <Cell key={i} fill={(dark ? DONUT_COLORS_DARK : DONUT_COLORS_LIGHT)[i % DONUT_COLORS_LIGHT.length]} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        {/* Center label */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="text-xl font-bold text-zinc-900 dark:text-zinc-100 tabular-nums">
            {fmtDollars(totalCents)}
          </span>
        </div>
      </div>

      {/* Legend grid */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 mt-2">
        {categories.map((cat, i) => (
          <div key={cat.name} className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: (dark ? DONUT_COLORS_DARK : DONUT_COLORS_LIGHT)[i % DONUT_COLORS_LIGHT.length] }}
              />
              <span className="text-xs text-zinc-500 dark:text-zinc-400 truncate">{cat.name}</span>
            </div>
            <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 tabular-nums flex-shrink-0">
              {cat.pct}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
