import { useState, useEffect } from 'react';
import { StatCard } from '../components/d2d/stat-card';
import { Card, CardContent, CardHeader, CardTitle } from '../components/d2d/card';
import { Button } from '../components/d2d/button';
import { Badge } from '../components/d2d/badge';
import { Avatar } from '../components/d2d/avatar';
import { cn } from '../lib/utils';
import { getLeaderboard } from '../lib/leaderboardApi';
import { getRepAvatar } from '../lib/constants/avatars';
import type { LeaderboardEntry } from '../types';
import {
  BarChart3,
  TrendingUp,
  Users,
  DollarSign,
  Target,
  Calendar,
  Download,
  Filter,
  ChevronDown,
  MapPin,
  Loader2,
} from 'lucide-react';

// No fallback data — empty state shown when API returns no results

type Period = 'daily' | 'weekly' | 'monthly';

const periodLabels: Record<Period, string> = {
  daily: 'Today',
  weekly: 'This Week',
  monthly: 'This Month',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function formatCurrency(n: number): string {
  return '$' + n.toLocaleString('en-US');
}

function computeSummary(data: LeaderboardEntry[]) {
  const totalRevenue = data.reduce((s, r) => s + r.revenue, 0);
  const totalCloses = data.reduce((s, r) => s + r.closes, 0);
  const totalDoors = data.reduce((s, r) => s + r.doors_knocked, 0);
  const activeReps = data.length;
  const avgConversion =
    activeReps > 0
      ? data.reduce((s, r) => s + r.conversion_rate, 0) / activeReps
      : 0;
  return { totalRevenue, totalCloses, totalDoors, activeReps, avgConversion };
}

// Estimate funnel stages from aggregate totals.
// Conversations ~ 27% of doors, Demos ~ 27% of conversations (rough D2D ratios).
function computeFunnel(data: LeaderboardEntry[]) {
  const doors = data.reduce((s, r) => s + r.doors_knocked, 0);
  const closes = data.reduce((s, r) => s + r.closes, 0);
  const conversations = Math.round(doors * 0.27);
  const demos = Math.round(conversations * 0.27);
  return { doors, conversations, demos, closes };
}

// ---------------------------------------------------------------------------
// Revenue Bar Chart (horizontal)
// ---------------------------------------------------------------------------
function RevenueBarChart({ data }: { data: LeaderboardEntry[] }) {
  const sorted = [...data].sort((a, b) => b.revenue - a.revenue);
  const maxRevenue = sorted[0]?.revenue || 1;

  return (
    <div className="space-y-2.5">
      {sorted.map((rep) => {
        const pct = (rep.revenue / maxRevenue) * 100;
        return (
          <div key={rep.user_id} className="flex items-center gap-3">
            <div className="w-24 truncate text-[11px] font-medium text-text-secondary">
              {rep.full_name.split(' ')[0]}
            </div>
            <div className="relative flex-1 h-5 rounded bg-surface-elevated overflow-hidden">
              <div
                className="absolute inset-y-0 left-0 rounded bg-gradient-to-r from-accent/80 to-accent transition-all duration-700"
                style={{ width: `${pct}%` }}
              />
              <span className="absolute inset-y-0 right-2 flex items-center text-[10px] font-semibold text-text-primary">
                {formatCurrency(rep.revenue)}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Conversion Funnel (vertical)
// ---------------------------------------------------------------------------
function ConversionFunnel({ data }: { data: LeaderboardEntry[] }) {
  const funnel = computeFunnel(data);
  const stages = [
    { label: 'Doors', value: funnel.doors, color: 'bg-blue-500/70' },
    { label: 'Conversations', value: funnel.conversations, color: 'bg-indigo-500/70' },
    { label: 'Demos', value: funnel.demos, color: 'bg-violet-500/70' },
    { label: 'Closes', value: funnel.closes, color: 'bg-emerald-500/80' },
  ];
  const maxVal = stages[0]?.value || 1;

  return (
    <div className="flex items-end justify-around gap-3 h-48 pt-4">
      {stages.map((stage) => {
        const heightPct = Math.max((stage.value / maxVal) * 100, 6);
        return (
          <div key={stage.label} className="flex flex-col items-center gap-1 flex-1">
            <span className="text-[11px] font-semibold text-text-primary">
              {stage.value.toLocaleString()}
            </span>
            <div className="w-full flex justify-center" style={{ height: '140px' }}>
              <div className="relative w-full max-w-[56px] flex flex-col justify-end h-full">
                <div
                  className={cn('rounded-t-md transition-all duration-700', stage.color)}
                  style={{ height: `${heightPct}%` }}
                />
              </div>
            </div>
            <span className="text-[10px] font-medium text-text-muted">{stage.label}</span>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------
export default function D2DReports() {
  const [period, setPeriod] = useState<Period>('monthly');
  const [data, setData] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    getLeaderboard(period)
      .then((entries) => {
        if (!cancelled) {
          setData(entries);
        }
      })
      .catch(() => {
        if (!cancelled) setData([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [period]);

  const { totalRevenue, totalCloses, totalDoors, activeReps, avgConversion } =
    computeSummary(data);

  const summaryStats = [
    {
      icon: <DollarSign className="h-4 w-4" />,
      label: 'Total Revenue',
      value: formatCurrency(totalRevenue),
      subtitle: periodLabels[period],
    },
    {
      icon: <Target className="h-4 w-4" />,
      label: 'Total Closes',
      value: String(totalCloses),
      subtitle: periodLabels[period],
    },
    {
      icon: <Users className="h-4 w-4" />,
      label: 'Active Reps',
      value: String(activeReps),
      subtitle: `${period} period`,
    },
    {
      icon: <TrendingUp className="h-4 w-4" />,
      label: 'Avg Conversion',
      value: `${avgConversion.toFixed(1)}%`,
      subtitle: 'Doors to close',
    },
    {
      icon: <MapPin className="h-4 w-4" />,
      label: 'Doors Knocked',
      value: totalDoors.toLocaleString('en-US'),
      subtitle: periodLabels[period],
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-text-primary">Reports</h2>
          <p className="text-xs text-text-tertiary">
            Analytics and performance insights
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Period selector */}
          {(['daily', 'weekly', 'monthly'] as Period[]).map((p) => (
            <Button
              key={p}
              variant={period === p ? 'default' : 'outline'}
              size="sm"
              onClick={() => setPeriod(p)}
              className="capitalize"
            >
              {p}
            </Button>
          ))}
          <Button variant="outline" size="sm" className="gap-1.5">
            <Filter className="h-3 w-3" />
            Filters
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5">
            <Download className="h-3 w-3" />
            Export
          </Button>
        </div>
      </div>

      {/* Loading indicator */}
      {loading && (
        <div className="flex items-center gap-2 text-xs text-text-muted">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading report data...
        </div>
      )}

      {/* Summary stats */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {summaryStats.map((stat) => (
          <StatCard key={stat.label} {...stat} />
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Revenue by Rep */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-3.5 w-3.5 text-text-secondary" />
              Revenue by Rep
            </CardTitle>
          </CardHeader>
          <CardContent>
            <RevenueBarChart data={data} />
          </CardContent>
        </Card>

        {/* Conversion Funnel */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-3.5 w-3.5 text-text-secondary" />
              Conversion Funnel
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ConversionFunnel data={data} />
          </CardContent>
        </Card>
      </div>

      {/* Detailed table */}
      <Card>
        <CardHeader>
          <CardTitle>Rep Performance Breakdown</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border-subtle">
                  {['Rep', 'Team', 'Doors', 'Closes', 'Revenue', 'Conv %', 'Trend'].map(
                    (col) => (
                      <th
                        key={col}
                        className="px-5 py-2.5 text-left text-[11px] font-medium text-text-muted"
                      >
                        {col}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {data.map((rep) => (
                  <tr
                    key={rep.user_id}
                    className="border-b border-border-subtle last:border-b-0 table-row-hover"
                  >
                    <td className="px-5 py-2.5">
                      <div className="flex items-center gap-2">
                        <Avatar
                          src={rep.avatar_url ?? getRepAvatar(rep.full_name)}
                          name={rep.full_name}
                          size="sm"
                          className="!h-5 !w-5 !text-[8px]"
                        />
                        <span className="text-[13px] font-medium text-text-primary">
                          {rep.full_name}
                        </span>
                      </div>
                    </td>
                    <td className="px-5 py-2.5">
                      <Badge variant="secondary" className="text-[10px]">
                        {rep.team_name ?? '—'}
                      </Badge>
                    </td>
                    <td className="px-5 py-2.5 text-[13px] text-text-secondary">
                      {rep.doors_knocked}
                    </td>
                    <td className="px-5 py-2.5 text-[13px] font-semibold text-text-primary">
                      {rep.closes}
                    </td>
                    <td className="px-5 py-2.5 text-[13px] font-medium text-text-primary">
                      {formatCurrency(rep.revenue)}
                    </td>
                    <td className="px-5 py-2.5 text-[13px] text-text-secondary">
                      {rep.conversion_rate.toFixed(1)}%
                    </td>
                    <td className="px-5 py-2.5">
                      <span
                        className={cn(
                          'inline-flex items-center gap-0.5 text-[12px] font-medium',
                          rep.trend >= 0 ? 'text-success' : 'text-error'
                        )}
                      >
                        {rep.trend >= 0 ? '+' : ''}
                        {rep.trend.toFixed(1)}%
                      </span>
                    </td>
                  </tr>
                ))}
                {data.length === 0 && (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-5 py-8 text-center text-xs text-text-muted"
                    >
                      No data available for this period.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
