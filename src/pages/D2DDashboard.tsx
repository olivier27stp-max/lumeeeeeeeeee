import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { StatCard } from '../components/d2d/stat-card';
import { Card, CardContent, CardHeader, CardTitle } from '../components/d2d/card';
import { Badge } from '../components/d2d/badge';
import { Avatar } from '../components/d2d/avatar';
import { cn } from '../lib/utils';
import { getRepAvatar } from '../lib/constants/avatars';
import { usePermissions } from '../hooks/usePermissions';
import { supabase } from '../lib/supabase';
import { getLeaderboard, getRealtimeStats } from '../lib/leaderboardApi';
import type { LeaderboardEntry, RepPerformanceDetail } from '../types';
import {
  Users,
  DollarSign,
  Banknote,
  Target,
  TrendingUp,
  Calendar,
  GitBranch,
  Trophy,
  Zap,
  MapPin,
  Clock,
  Loader2,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Fallback data (used when API calls fail)
// ---------------------------------------------------------------------------

const fallbackOwnerStats = [
  {
    icon: <Users className="h-4 w-4" strokeWidth={2.5} />,
    label: 'Active Reps',
    value: '—',
    subtitle: 'No data yet',
  },
  {
    icon: <Banknote className="h-4 w-4" strokeWidth={2.5} />,
    label: 'Revenue Today',
    value: '$0',
    subtitle: 'No data yet',
  },
  {
    icon: <Target className="h-4 w-4" strokeWidth={2.5} />,
    label: 'Closes Today',
    value: '0',
    subtitle: 'No data yet',
  },
  {
    icon: <TrendingUp className="h-4 w-4" strokeWidth={2.5} />,
    label: 'Pipeline Value',
    value: '$0',
    subtitle: 'No data yet',
  },
];

const fallbackRecentWins: { rep: string; deal: string; value: string; time: string; userId: string }[] = [];

const fallbackRepStats = [
  {
    icon: <MapPin className="h-4 w-4" strokeWidth={2.5} />,
    label: 'Doors Knocked',
    value: '0',
  },
  {
    icon: <Target className="h-4 w-4" strokeWidth={2.5} />,
    label: 'Closes',
    value: '0',
  },
  {
    icon: <DollarSign className="h-4 w-4" strokeWidth={2.5} />,
    label: 'Revenue',
    value: '$0',
  },
  {
    icon: <Clock className="h-4 w-4" strokeWidth={2.5} />,
    label: 'Time in Field',
    value: '0h 0m',
    subtitle: 'No session',
  },
];

const pipelineStages: { name: string; color: string; value: string; count: number }[] = [];

const todaySchedule: { time: string; title: string; status: string }[] = [];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCurrency(amount: number): string {
  return '$' + amount.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

// ---------------------------------------------------------------------------
// Loading spinner
// ---------------------------------------------------------------------------

function LoadingState() {
  return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="h-6 w-6 animate-spin text-text-tertiary" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function D2DDashboard() {
  const { role, userId, loading: permLoading } = usePermissions();
  const isManager = role === 'owner' || role === 'admin' || role === 'manager';

  if (permLoading) {
    return <LoadingState />;
  }

  if (isManager) {
    return <ManagerDashboard userId={userId} />;
  }

  return <RepDashboard userId={userId} />;
}

// ---------------------------------------------------------------------------
// Manager Dashboard
// ---------------------------------------------------------------------------

function ManagerDashboard({ userId }: { userId: string | null }) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [userName, setUserName] = useState('');
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [useFallback, setUseFallback] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      try {
        // Fetch user name and leaderboard in parallel
        const [profileResult, lbResult] = await Promise.allSettled([
          userId
            ? supabase.from('profiles').select('full_name').eq('id', userId).maybeSingle()
            : Promise.resolve(null),
          getLeaderboard('daily'),
        ]);

        if (cancelled) return;

        // Extract user name
        if (profileResult.status === 'fulfilled' && profileResult.value) {
          const profile = (profileResult.value as any)?.data;
          if (profile?.full_name) {
            setUserName(profile.full_name.split(' ')[0]);
          }
        }

        // Extract leaderboard
        if (lbResult.status === 'fulfilled' && lbResult.value) {
          setLeaderboard(lbResult.value);
        } else {
          setUseFallback(true);
        }
      } catch {
        if (!cancelled) setUseFallback(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchData();
    return () => { cancelled = true; };
  }, [userId]);

  if (loading) {
    return <LoadingState />;
  }

  // Derive stats from leaderboard data
  const activeReps = leaderboard.length;
  const totalRevenue = leaderboard.reduce((sum, e) => sum + e.revenue, 0);
  const totalCloses = leaderboard.reduce((sum, e) => sum + e.closes, 0);
  const totalDoors = leaderboard.reduce((sum, e) => sum + e.doors_knocked, 0);
  const avgConversion = totalDoors > 0 ? Math.round((totalCloses / totalDoors) * 100) : 0;

  const ownerStats = useFallback
    ? fallbackOwnerStats
    : [
        {
          icon: <Users className="h-4 w-4" strokeWidth={2.5} />,
          label: 'Active Reps',
          value: String(activeReps),
          change: { value: '', direction: 'up' as const },
          subtitle: 'In the field right now',
        },
        {
          icon: <Banknote className="h-4 w-4" strokeWidth={2.5} />,
          label: 'Revenue Today',
          value: formatCurrency(totalRevenue),
          change: { value: '', direction: 'up' as const },
          subtitle: 'vs. yesterday',
        },
        {
          icon: <Target className="h-4 w-4" strokeWidth={2.5} />,
          label: 'Closes Today',
          value: String(totalCloses),
          change: { value: '', direction: 'up' as const },
          subtitle: `${avgConversion}% conversion rate`,
        },
        {
          icon: <TrendingUp className="h-4 w-4" strokeWidth={2.5} />,
          label: 'Pipeline Value',
          value: formatCurrency(totalRevenue),
          change: { value: '', direction: 'up' as const },
          subtitle: `${totalDoors} doors knocked`,
        },
      ];

  // Derive recent wins from top 3 closers
  const recentWins = useFallback
    ? fallbackRecentWins
    : leaderboard
        .filter((e) => e.closes > 0)
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 3)
        .map((entry) => ({
          rep: entry.full_name,
          deal: `${entry.closes} close${entry.closes !== 1 ? 's' : ''} today`,
          value: formatCurrency(entry.revenue),
          time: 'Today',
          userId: entry.user_id,
        }));

  const displayName = userName || 'there';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold text-text-primary">{getGreeting()}, {displayName}</h2>
        <p className="mt-1 text-sm text-text-tertiary">
          Here is what is happening across your team today.
        </p>
      </div>

      {/* Stat cards -- clickable */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {ownerStats.map((stat) => (
          <div
            key={stat.label}
            className="cursor-pointer transition-shadow hover:shadow-md rounded-xl"
            onClick={() => {
              if (stat.label === 'Active Reps') navigate('/field-sales');
              else if (stat.label === 'Pipeline Value') navigate('/d2d-pipeline');
            }}
          >
            <StatCard {...stat} />
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Recent wins -- rep names are clickable */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Trophy className="h-3.5 w-3.5 text-gold" />
              Recent Wins
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {recentWins.length === 0 && (
                <p className="text-[13px] text-text-muted py-4 text-center">No wins yet today</p>
              )}
              {recentWins.map((win, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between rounded-lg bg-surface-elevated px-3 py-2.5 cursor-pointer transition-colors hover:bg-surface-tertiary"
                  onClick={() => navigate(`/reps/${win.userId}`)}
                >
                  <div className="flex items-center gap-3">
                    <Avatar name={win.rep} src={getRepAvatar(win.rep)} size="sm" />
                    <div>
                      <p className="text-[13px] font-medium text-text-primary">
                        {win.rep}
                      </p>
                      <p className="text-[11px] text-text-muted">{win.deal}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-[13px] font-semibold text-success">{win.value}</p>
                    <p className="text-[10px] text-text-muted">{win.time}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Pipeline overview -- clickable -> pipeline page */}
        <Card
          className="cursor-pointer transition-shadow hover:shadow-md"
          onClick={() => navigate('/d2d-pipeline')}
        >
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <GitBranch className="h-3.5 w-3.5 text-text-secondary" />
              Pipeline
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {pipelineStages.map((stage, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 rounded-lg bg-surface-elevated px-3 py-2.5"
                >
                  <div
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: stage.color }}
                  />
                  <div className="flex-1">
                    <p className="text-[13px] font-medium text-text-primary">{stage.name}</p>
                    <p className="text-[10px] text-text-muted">{stage.count} leads</p>
                  </div>
                  <p className="text-[13px] font-semibold text-text-primary">{stage.value}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rep Dashboard
// ---------------------------------------------------------------------------

function RepDashboard({ userId }: { userId: string | null }) {
  const [loading, setLoading] = useState(true);
  const [userName, setUserName] = useState('');
  const [stats, setStats] = useState<RepPerformanceDetail | null>(null);
  const [rank, setRank] = useState<number | null>(null);
  const [useFallback, setUseFallback] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      if (!userId) {
        setUseFallback(true);
        setLoading(false);
        return;
      }

      try {
        const [profileResult, statsResult, lbResult] = await Promise.allSettled([
          supabase.from('profiles').select('full_name').eq('id', userId).maybeSingle(),
          getRealtimeStats(userId),
          getLeaderboard('daily'),
        ]);

        if (cancelled) return;

        // Extract user name
        if (profileResult.status === 'fulfilled' && profileResult.value?.data?.full_name) {
          setUserName(profileResult.value.data.full_name.split(' ')[0]);
        }

        // Extract realtime stats
        if (statsResult.status === 'fulfilled' && statsResult.value) {
          setStats(statsResult.value);
        } else {
          setUseFallback(true);
        }

        // Find rank from leaderboard
        if (lbResult.status === 'fulfilled' && lbResult.value) {
          const entry = lbResult.value.find((e) => e.user_id === userId);
          if (entry) setRank(entry.rank);
        }
      } catch {
        if (!cancelled) setUseFallback(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchData();
    return () => { cancelled = true; };
  }, [userId]);

  if (loading) {
    return <LoadingState />;
  }

  const repStats = useFallback || !stats
    ? fallbackRepStats
    : [
        {
          icon: <MapPin className="h-4 w-4" strokeWidth={2.5} />,
          label: 'Doors Knocked',
          value: String(stats.doors_knocked),
          change: { value: '', direction: 'up' as const },
        },
        {
          icon: <Target className="h-4 w-4" strokeWidth={2.5} />,
          label: 'Closes',
          value: String(stats.closes),
          change: { value: '', direction: 'up' as const },
        },
        {
          icon: <DollarSign className="h-4 w-4" strokeWidth={2.5} />,
          label: 'Revenue',
          value: formatCurrency(stats.revenue),
          change: { value: '', direction: 'up' as const },
        },
        {
          icon: <Clock className="h-4 w-4" strokeWidth={2.5} />,
          label: 'Conversion',
          value: `${Math.round(stats.conversion_rate)}%`,
          subtitle: `${stats.quotes_sent} quotes sent`,
        },
      ];

  const displayName = userName || 'there';
  const rankDisplay = rank ?? '—';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-text-primary">Welcome back, {displayName}</h2>
          <p className="mt-0.5 text-xs text-text-tertiary">
            You are ranked <span className="font-medium text-text-primary">#{rankDisplay}</span> today. Keep pushing!
          </p>
        </div>
        <Badge variant="success" className="px-2 py-0.5 text-[11px]">
          <Zap className="mr-1 h-3 w-3" />
          Session Active
        </Badge>
      </div>

      {/* Personal stats */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {repStats.map((stat) => (
          <StatCard key={stat.label} {...stat} />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Today schedule */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-3.5 w-3.5 text-text-secondary" />
              Today's Schedule
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {todaySchedule.map((item, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 rounded-lg bg-surface-elevated px-3 py-2.5"
                >
                  <div
                    className={cn(
                      'h-1.5 w-1.5 shrink-0 rounded-full',
                      item.status === 'completed' ? 'bg-success' : 'bg-text-tertiary'
                    )}
                  />
                  <div className="flex-1">
                    <p className="text-[13px] font-medium text-text-primary">
                      {item.title}
                    </p>
                    <p className="text-[11px] text-text-muted">{item.time}</p>
                  </div>
                  {item.status === 'completed' && (
                    <Badge variant="success" className="text-[10px]">Done</Badge>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Active challenges — placeholder until gamification API is connected */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Trophy className="h-3.5 w-3.5 text-gold" />
              Active Challenges
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Trophy className="h-8 w-8 text-text-muted/30 mb-3" />
              <p className="text-[13px] font-medium text-text-secondary">
                No active challenges
              </p>
              <p className="text-[11px] text-text-muted mt-1">
                Challenges will appear here when configured by your manager.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
