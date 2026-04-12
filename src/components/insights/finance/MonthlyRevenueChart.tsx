import React from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { TrendingUp } from 'lucide-react';

interface ChartPoint {
  label: string;
  value: number;
}

function useIsDark() {
  return document.documentElement.classList.contains('dark');
}

export default function MonthlyRevenueChart({
  data,
  trendPct,
  onViewReport,
}: {
  data: ChartPoint[];
  trendPct?: number | null;
  onViewReport?: () => void;
}) {
  const dark = useIsDark();

  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-5 flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-1">
        <div>
          <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Monthly Revenue</h3>
          <p className="text-xs text-zinc-400 dark:text-zinc-500">Last 6 months</p>
        </div>
        <button
          onClick={onViewReport}
          className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors"
        >
          View Report
        </button>
      </div>

      {/* Chart */}
      <div className="flex-1 min-h-[220px] mt-3">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} barCategoryGap="25%">
            <CartesianGrid vertical={false} stroke={dark ? '#3f3f46' : '#f4f4f5'} />
            <XAxis
              dataKey="label"
              axisLine={false}
              tickLine={false}
              tick={{ fill: dark ? '#a1a1aa' : '#71717a', fontSize: 12, fontWeight: 500 }}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fill: dark ? '#71717a' : '#a1a1aa', fontSize: 11 }}
              width={40}
              tickFormatter={(v: number) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v))}
            />
            <Tooltip
              cursor={{ fill: dark ? '#27272a' : '#f4f4f5', radius: 6 }}
              contentStyle={{
                borderRadius: 12,
                border: `1px solid ${dark ? '#3f3f46' : '#e4e4e7'}`,
                backgroundColor: dark ? '#18181b' : '#ffffff',
                color: dark ? '#fafafa' : '#18181b',
                boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
                fontSize: 13,
              }}
              formatter={(value: number) => [
                `$${value.toLocaleString()}`,
                'Revenue',
              ]}
            />
            <Bar
              dataKey="value"
              fill={dark ? '#e4e4e7' : '#171717'}
              radius={[6, 6, 0, 0]}
              maxBarSize={42}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Bottom trend text */}
      <div className="mt-2 space-y-0.5">
        {trendPct != null && (
          <p className="text-sm text-zinc-700 dark:text-zinc-300 font-medium flex items-center gap-1">
            Trending {trendPct >= 0 ? 'up' : 'down'} by {Math.abs(trendPct).toFixed(1)}% this month
            <TrendingUp
              size={14}
              className={trendPct >= 0 ? 'text-emerald-500' : 'text-rose-500'}
            />
          </p>
        )}
        <p className="text-xs text-zinc-400 dark:text-zinc-500">
          Showing data from the last 6 months
        </p>
      </div>
    </div>
  );
}
