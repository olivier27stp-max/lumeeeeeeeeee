import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Card, CardContent } from '../components/d2d/card';
import { cn } from '../lib/utils';
import { useTranslation } from '../i18n';
import { getRepAvatar } from '../lib/constants/avatars';
import { getLeaderboard, getRepPerformance } from '../lib/leaderboardApi';
import type { LeaderboardEntry, RepPerformanceDetail } from '../types';
import {
  TrendingUp,
  TrendingDown,
  ChevronRight,
  Flame,
  Crown,
  X,
  User,
  Loader2,
} from 'lucide-react';

type Period = 'daily' | 'weekly' | 'monthly';

interface RepData {
  rank: number;
  name: string;
  userId: string;
  avatar: string;
  closes: number;
  revenue: number;
  trend: number;
  streak: number;
}

// No fallback data — empty state shown when API returns no results

// ---------------------------------------------------------------------------
// Convert API LeaderboardEntry[] -> RepData[]
// ---------------------------------------------------------------------------

function apiToRepData(entries: LeaderboardEntry[]): RepData[] {
  return entries.map((e) => ({
    rank: e.rank,
    name: e.full_name,
    userId: e.user_id,
    avatar: e.avatar_url ?? getRepAvatar(e.full_name) ?? `https://i.pravatar.cc/80?u=${e.user_id}`,
    closes: e.closes,
    revenue: e.revenue,
    trend: e.trend,
    streak: 0, // streak not available from API
  }));
}

// ---------------------------------------------------------------------------
// Period date helpers
// ---------------------------------------------------------------------------

function getPeriodDates(period: Period): { from: string; to: string } {
  const now = new Date();
  const to = now.toISOString().slice(0, 10);
  let from: string;
  if (period === 'daily') {
    from = to;
  } else if (period === 'weekly') {
    const d = new Date(now);
    d.setDate(d.getDate() - 6);
    from = d.toISOString().slice(0, 10);
  } else {
    const d = new Date(now);
    d.setDate(d.getDate() - 29);
    from = d.toISOString().slice(0, 10);
  }
  return { from, to };
}

// ---------------------------------------------------------------------------
// Convert API RepPerformanceDetail -> KPI + funnel arrays
// ---------------------------------------------------------------------------

function perfToKPIs(perf: RepPerformanceDetail): { key: string; value: string }[] {
  return [
    { key: 'doors_knocked', value: String(perf.doors_knocked) },
    { key: 'conversations', value: String(perf.conversations) },
    { key: 'demos_set', value: String(perf.demos_set) },
    { key: 'demos_held', value: String(perf.demos_held) },
    { key: 'quotes_sent', value: String(perf.quotes_sent) },
    { key: 'closes', value: String(perf.closes) },
    { key: 'revenue', value: `$${perf.revenue.toLocaleString()}` },
    { key: 'conversion_rate', value: `${Math.round(perf.conversion_rate)}%` },
  ];
}

function perfToFunnel(perf: RepPerformanceDetail): { key: string; value: number; max: number }[] {
  const max = perf.doors_knocked || 1;
  return [
    { key: 'doors_knocked', value: perf.doors_knocked, max },
    { key: 'conversations', value: perf.conversations, max },
    { key: 'demos_held', value: perf.demos_held, max },
    { key: 'quotes_sent', value: perf.quotes_sent, max },
    { key: 'closes', value: perf.closes, max },
  ];
}

// ---------------------------------------------------------------------------
// Card styles
// ---------------------------------------------------------------------------

interface CardStyle {
  gradient: string;
  overlay: string;
  rankBg: string;
  rankBorder: string;
  rankIcon: string;
  shadow: string;
}

const cardStyles: Record<number, CardStyle> = {
  1: {
    gradient: 'linear-gradient(135deg, #F59E0B 0%, #F97316 100%)',
    overlay: 'rgba(255,255,255,0.08)',
    rankBg: 'rgba(255,255,255,0.15)',
    rankBorder: 'rgba(255,255,255,0.25)',
    rankIcon: '#FFF7ED',
    shadow: '0 10px 30px rgba(245,158,11,0.25), 0 4px 12px rgba(0,0,0,0.1)',
  },
  2: {
    gradient: 'linear-gradient(135deg, #64748B 0%, #334155 100%)',
    overlay: 'rgba(255,255,255,0.06)',
    rankBg: 'rgba(255,255,255,0.12)',
    rankBorder: 'rgba(255,255,255,0.2)',
    rankIcon: '#E2E8F0',
    shadow: '0 10px 30px rgba(51,65,85,0.3), 0 4px 12px rgba(0,0,0,0.1)',
  },
  3: {
    gradient: 'linear-gradient(135deg, #FB923C 0%, #EA580C 100%)',
    overlay: 'rgba(255,255,255,0.07)',
    rankBg: 'rgba(255,255,255,0.12)',
    rankBorder: 'rgba(255,255,255,0.2)',
    rankIcon: '#FFEDD5',
    shadow: '0 10px 30px rgba(234,88,12,0.25), 0 4px 12px rgba(0,0,0,0.1)',
  },
};

const noiseTexture = `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`;

// ---------------------------------------------------------------------------
// Trend badge
// ---------------------------------------------------------------------------

function TrendBadge({ trend }: { trend: number }) {
  if (trend === 0) return null;
  const up = trend > 0;
  return (
    <span className={cn('inline-flex items-center gap-0.5 text-xs font-medium', up ? 'text-success' : 'text-error')}>
      {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {up ? '+' : ''}{trend}%
    </span>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function D2DLeaderboard() {
  const navigate = useNavigate();
  const { language } = useTranslation();
  const fr = language === 'fr';
  const periodLabels: Record<Period, string> = fr
    ? { daily: 'Quotidien', weekly: 'Hebdomadaire', monthly: 'Mensuel' }
    : { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' };
  const [period, setPeriod] = useState<Period>('weekly');
  const [selectedRep, setSelectedRep] = useState<RepData | null>(null);
  const [loading, setLoading] = useState(true);
  const [podiumData, setPodiumData] = useState<RepData[]>([]);
  const [leaderboardData, setLeaderboardData] = useState<RepData[]>([]);

  // Drawer detail state
  const [detailKPIs, setDetailKPIs] = useState<{ key: string; value: string }[]>([]);
  const [funnelSteps, setFunnelSteps] = useState<{ key: string; value: number; max: number }[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  // Fetch leaderboard when period changes
  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    getLeaderboard(period)
      .then((entries) => {
        if (cancelled) return;
        if (!entries || entries.length === 0) {
          setPodiumData([]);
          setLeaderboardData([]);
        } else {
          const all = apiToRepData(entries);
          setPodiumData(all.slice(0, 3));
          setLeaderboardData(all.slice(3));
        }
      })
      .catch(() => {
        if (cancelled) return;
        setPodiumData([]);
        setLeaderboardData([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [period]);

  // Fetch rep detail when drawer opens
  const openRepDrawer = useCallback((rep: RepData) => {
    setSelectedRep(rep);
    setDetailLoading(true);

    const { from, to } = getPeriodDates(period);

    getRepPerformance(rep.userId, from, to)
      .then(({ performance }) => {
        setDetailKPIs(perfToKPIs(performance));
        setFunnelSteps(perfToFunnel(performance));
      })
      .catch(() => {
        setDetailKPIs([]);
        setFunnelSteps([]);
      })
      .finally(() => {
        setDetailLoading(false);
      });
  }, [period]);

  const allReps = [...podiumData, ...leaderboardData];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-text-primary">{fr ? 'Classement' : 'Rankings'}</h2>
          <p className="mt-1 text-sm text-text-tertiary">{fr ? 'Classement de l\'équipe' : 'Team ranking'}</p>
        </div>
        <div className="flex items-center rounded-lg border border-border-subtle overflow-hidden">
          {(['daily', 'weekly', 'monthly'] as Period[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={cn(
                'px-3 py-1.5 text-xs font-medium transition-colors',
                period === p ? 'bg-white text-text-primary shadow-sm' : 'text-text-muted hover:text-text-secondary',
              )}
            >
              {periodLabels[p]}
            </button>
          ))}
        </div>
      </div>

      {/* Loading state */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-text-muted" />
        </div>
      ) : podiumData.length === 0 && leaderboardData.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <User className="h-10 w-10 text-text-muted/30" />
          <p className="mt-3 text-sm font-medium text-text-secondary">Aucune donnée</p>
          <p className="mt-1 text-xs text-text-muted">Aucun rep n'a de stats pour cette période.</p>
        </div>
      ) : (
        <>
          {/* Top 3 */}
          <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
            {podiumData.map((rep) => {
              const s = cardStyles[rep.rank];
              return (
                <button
                  key={rep.rank}
                  onClick={() => navigate(`/reps/${rep.userId}`)}
                  className="group relative overflow-hidden rounded-[16px] p-6 text-left transition-all duration-200 hover:-translate-y-0.5"
                  style={{
                    background: s.gradient,
                    boxShadow: s.shadow,
                  }}
                >
                  {/* Radial glass overlay */}
                  <div
                    className="pointer-events-none absolute inset-0"
                    style={{
                      backgroundImage: `radial-gradient(circle at 20% 30%, rgba(255,255,255,0.15), transparent 40%), radial-gradient(circle at 80% 70%, rgba(255,255,255,0.1), transparent 50%)`,
                    }}
                  />
                  {/* Noise grain */}
                  <div
                    className="pointer-events-none absolute inset-0 rounded-[16px]"
                    style={{ backgroundImage: noiseTexture, opacity: 0.04, mixBlendMode: 'overlay' }}
                  />
                  {/* Light overlay */}
                  <div className="pointer-events-none absolute inset-0" style={{ background: s.overlay }} />

                  {/* Rank badge */}
                  <div className="relative flex items-center justify-between">
                    <div
                      className="flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold"
                      style={{
                        background: s.rankBg,
                        border: `1px solid ${s.rankBorder}`,
                        backdropFilter: 'blur(8px)',
                        color: s.rankIcon,
                      }}
                    >
                      {rep.rank === 1 ? <Crown className="h-4 w-4" /> : rep.rank}
                    </div>
                    {rep.streak > 0 && (
                      <div
                        className="flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
                        style={{ background: 'rgba(255,255,255,0.12)', color: s.rankIcon }}
                      >
                        <Flame className="h-3 w-3" />
                        {rep.streak}d
                      </div>
                    )}
                  </div>

                  {/* Avatar + name */}
                  <div className="relative mt-5 flex flex-col items-center">
                    <img
                      src={rep.avatar}
                      alt={rep.name}
                      className="h-[72px] w-[72px] rounded-full object-cover shadow-lg ring-2 ring-white/20"
                    />
                    <p className="mt-3 text-base font-semibold text-white">{rep.name}</p>
                  </div>

                  {/* Closes */}
                  <p className="relative mt-4 text-center text-sm font-semibold text-white/90">
                    {rep.closes} {fr ? 'ventes' : 'closes'}
                  </p>

                  {/* Revenue */}
                  <p className="relative mt-3 text-center text-2xl font-bold text-white">
                    ${(rep.revenue / 1000).toFixed(1)}k
                  </p>
                </button>
              );
            })}
          </div>

          {/* Rest of leaderboard */}
          <Card>
            <CardContent className="p-0">
              {leaderboardData.map((rep, i) => (
                <button
                  key={rep.rank}
                  onClick={() => openRepDrawer(rep)}
                  className={cn(
                    'flex w-full items-center gap-4 px-5 py-3 text-left transition-colors hover:bg-surface-elevated',
                    i < leaderboardData.length - 1 && 'border-b border-border-subtle',
                  )}
                >
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-elevated text-xs font-semibold text-text-muted">
                    {rep.rank}
                  </div>

                  <Link
                    to={`/reps/${rep.userId}`}
                    className="flex flex-1 items-center gap-3 min-w-0 group"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <img src={rep.avatar} alt={rep.name} className="h-7 w-7 rounded-full object-cover" />
                    <p className="text-sm font-semibold text-text-primary group-hover:text-text-secondary transition-colors">{rep.name}</p>
                  </Link>

                  {rep.streak > 0 && (
                    <div className="flex items-center gap-1 text-xs text-warning font-medium">
                      <Flame className="h-3 w-3" />
                      {rep.streak}d
                    </div>
                  )}

                  <div className="text-right w-16">
                    <p className="text-lg font-bold text-text-primary">{rep.closes}</p>
                    <p className="text-[10px] text-text-muted font-medium">{fr ? 'ventes' : 'closes'}</p>
                  </div>

                  <div className="text-right w-20">
                    <p className="text-sm font-semibold text-text-secondary">${(rep.revenue / 1000).toFixed(1)}k</p>
                    <p className="text-[10px] text-text-muted font-medium">{fr ? 'revenu' : 'revenue'}</p>
                  </div>

                  <div className="w-14 flex justify-end">
                    <TrendBadge trend={rep.trend} />
                  </div>

                  <ChevronRight className="h-4 w-4 text-text-muted" />
                </button>
              ))}
            </CardContent>
          </Card>
        </>
      )}

      {/* Drawer */}
      {selectedRep && (
        <>
          <div className="fixed inset-0 z-40 bg-black/20" onClick={() => setSelectedRep(null)} />
          <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col bg-white border-l border-border-subtle shadow-xl animate-in slide-in-from-right duration-200">
            <div className="flex items-center justify-between border-b border-border-subtle px-5 py-4">
              <div className="flex items-center gap-3">
                <img src={selectedRep.avatar} alt={selectedRep.name} className="h-11 w-11 rounded-full object-cover" />
                <div>
                  <h3 className="text-sm font-semibold text-text-primary">{selectedRep.name}</h3>
                  {selectedRep.streak > 0 && (
                    <div className="mt-0.5 flex items-center gap-1 text-xs text-warning font-medium">
                      <Flame className="h-3 w-3" />
                      {selectedRep.streak}d streak
                    </div>
                  )}
                </div>
              </div>
              <button onClick={() => setSelectedRep(null)} className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-surface-elevated hover:text-text-secondary">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              {detailLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-text-muted" />
                </div>
              ) : (
                <>
                  <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">{fr ? 'Détails de performance' : 'Performance detail'} ({periodLabels[period]})</h4>
                  <div className="grid grid-cols-2 gap-2">
                    {detailKPIs.map((kpi) => (
                      <div key={kpi.key} className="rounded-lg border border-border-subtle bg-surface-elevated px-3 py-3">
                        <p className="text-[10px] font-medium uppercase tracking-wider text-text-muted">{kpi.key}</p>
                        <p className="mt-1 text-base font-bold text-text-primary">{kpi.value}</p>
                      </div>
                    ))}
                  </div>

                  <div className="mt-6">
                    <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">{fr ? 'Taux de conversion' : 'Conversion rate'}</h4>
                    <div className="space-y-3">
                      {funnelSteps.map((step) => (
                        <div key={step.key}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs text-text-tertiary">{step.key}</span>
                            <span className="text-xs font-semibold text-text-primary">{step.value}</span>
                          </div>
                          <div className="h-1.5 rounded-full bg-surface-elevated">
                            <div
                              className="h-1.5 rounded-full bg-text-primary transition-all duration-500"
                              style={{ width: `${(step.value / step.max) * 100}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <Link
                    to={`/reps/${selectedRep.userId}`}
                    className="mt-6 flex items-center justify-center gap-2 rounded-xl bg-text-primary text-surface px-5 py-3 text-sm font-semibold transition-opacity hover:opacity-90"
                  >
                    <User size={16} />
                    {fr ? 'Voir le profil complet' : 'View Full Profile'}
                  </Link>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
