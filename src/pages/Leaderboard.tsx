import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Card, CardContent } from '../components/d2d/card';
import { cn } from '../lib/utils';
import { useTranslation } from '../i18n';
import { getLeaderboard, getRepProfileInfo, getOffices, type Office, type LeaderboardRange } from '../lib/leaderboardApi';
import { getRepPeriodStats, getRepPinCounts, type RepPeriodStats, type RepPinCounts } from '../lib/repStatsApi';
import { useCompany } from '../contexts/CompanyContext';
import type { LeaderboardEntry } from '../types';
import { Calendar, ChevronDown, X, User, Loader2, Search, Trophy, DoorOpen, MessagesSquare, TrendingUp } from 'lucide-react';

type Category = 'all' | 'rookie' | 'experienced';

interface RepData {
  rank: number;
  name: string;
  userId: string;
  avatar: string | null;
  closes: number;
  revenue: number;
  experienceLevel: 'rookie' | 'experienced' | null;
  teamName: string | null;
  officeName: string | null;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}

// DiceBear "notionists" — same universe as the mobile UnifiedAvatar, so a rep
// without a real photo gets the same generated character everywhere.
function dicebearUrl(seed: string): string {
  return `https://api.dicebear.com/9.x/notionists/svg?seed=${encodeURIComponent(seed)}&backgroundColor=f5f5f5&radius=50`;
}

function RepAvatar({ rep, className, textClassName }: { rep: RepData; className?: string; textClassName?: string }) {
  // Real uploaded photo wins; otherwise the generated DiceBear (seeded by the
  // rep's stable user id). Initials show underneath while the image loads / on error.
  const src = rep.avatar || dicebearUrl(rep.userId || rep.name);
  return (
    <div className={cn('relative shrink-0 overflow-hidden rounded-full bg-surface-elevated', className)}>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className={cn('font-bold text-text-muted', textClassName)}>{getInitials(rep.name)}</span>
      </div>
      <img
        src={src}
        alt={rep.name}
        loading="lazy"
        className="absolute inset-0 h-full w-full rounded-full object-cover"
      />
    </div>
  );
}

function apiToRepData(entries: LeaderboardEntry[]): RepData[] {
  return entries.map((e) => ({
    rank: e.rank,
    name: e.full_name,
    userId: e.user_id,
    avatar: e.avatar_url ?? null,
    closes: e.closes,
    revenue: e.revenue,
    experienceLevel: e.experience_level ?? null,
    teamName: e.team_name ?? null,
    officeName: e.office_name ?? null,
  }));
}

// Local YYYY-MM-DD (en-CA locale formats exactly that way)
function todayIso(): string {
  return new Date().toLocaleDateString('en-CA');
}

function parseIsoDate(s: string): Date {
  return new Date(`${s}T00:00:00`);
}

// "mercredi 16 juillet 2026" for a single day, "12 juill. – 16 juill. 2026" for a range
function formatRangeLabel(range: LeaderboardRange, fr: boolean): string {
  const locale = fr ? 'fr-CA' : 'en-CA';
  if (range.from === range.to) {
    return parseIsoDate(range.from).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }
  const short: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' };
  return `${parseIsoDate(range.from).toLocaleDateString(locale, short)} – ${parseIsoDate(range.to).toLocaleDateString(locale, short)}`;
}

// Les 9 KPIs du Rep Hub (mêmes libellés que RepProfile), format leaderboard
function statsToKPIs(stats: RepPeriodStats): { label: string; value: string; sub?: string }[] {
  return [
    { label: 'Revenue', value: money(stats.revenue) },
    { label: 'Jobs', value: String(stats.jobs) },
    { label: 'Serviced Revenue', value: money(stats.servicedRevenue) },
    { label: 'Serviced Jobs', value: String(stats.servicedJobs) },
    { label: 'APP', value: String(stats.app), sub: 'Pins rendez-vous' },
    { label: 'Avg Contract Value', value: stats.avgContractValue != null ? money(stats.avgContractValue) : '—' },
    { label: 'Closing Rate', value: stats.contractClosingRate != null ? `${stats.contractClosingRate}%` : '—' },
    { label: 'Cancel Rate', value: stats.cancelRate != null ? `${stats.cancelRate}%` : '—' },
    { label: 'Days Worked', value: String(stats.daysWorked) },
  ];
}

// Podium ring colors — gold / silver / bronze (mirrors the mobile RANK_RING).
const RANK_RING = ['#F59E0B', '#94A3B8', '#EA580C'];

const money = (v: number) =>
  new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(v || 0);

export default function D2DLeaderboard() {
  const navigate = useNavigate();
  const { language } = useTranslation();
  const fr = language === 'fr';
  const { currentOrgId } = useCompany();
  // Date / période sélectionnée — toutes les stats de la page suivent cette fenêtre.
  const [range, setRange] = useState<LeaderboardRange>(() => ({ from: todayIso(), to: todayIso() }));
  const [pickerOpen, setPickerOpen] = useState(false);
  const [draft, setDraft] = useState<LeaderboardRange>(range);
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const [category, setCategory] = useState<Category>('all');
  const [officeId, setOfficeId] = useState<string>(''); // '' = follow the scope toggle
  const [offices, setOffices] = useState<Office[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [reps, setReps] = useState<RepData[]>([]);

  // Rangée dépliée + cache des stats Rep Hub, clé userId:from:to (période-scopé).
  // undefined = fetch en cours, null = échec, objet = stats chargées.
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedStats, setExpandedStats] = useState<Record<string, RepPeriodStats | null>>({});
  // Pins du rep déplié (boxe Terrain) — même clé période-scopée que expandedStats.
  const [expandedPins, setExpandedPins] = useState<Record<string, RepPinCounts | null>>({});

  // Load the list of offices (orgs of the company) for the office filter.
  useEffect(() => {
    getOffices().then((r) => setOffices(r.offices)).catch(() => setOffices([]));
  }, []);

  // Picking a specific office scopes to that org; otherwise follow the toggle.
  const effectiveScope = officeId ? 'mine' : scope;
  const effectiveOrgId = officeId || (currentOrgId ?? undefined);

  const fetchBoard = useCallback((cancelledRef?: { current: boolean }) => {
    setLoading(true);
    getLeaderboard(range, {
      scope: effectiveScope,
      orgId: effectiveOrgId,
      experience: category === 'all' ? undefined : category,
    })
      .then((entries) => { if (!cancelledRef?.current) setReps(entries && entries.length ? apiToRepData(entries) : []); })
      .catch(() => { if (!cancelledRef?.current) setReps([]); })
      .finally(() => { if (!cancelledRef?.current) setLoading(false); });
  }, [range.from, range.to, effectiveScope, effectiveOrgId, category]);

  useEffect(() => {
    const ref = { current: false };
    fetchBoard(ref);
    return () => { ref.current = true; };
  }, [fetchBoard]);

  // Stats Rep Hub de la rangée dépliée — org du rep résolue côté serveur
  // (scope 'all offices' : le rep peut appartenir à un autre bureau).
  useEffect(() => {
    if (!expandedId) return;
    const key = `${expandedId}:${range.from}:${range.to}`;
    if (expandedStats[key] !== undefined) return;
    let cancelled = false;
    (async () => {
      try {
        const info = await getRepProfileInfo(expandedId);
        const [stats, pins] = await Promise.all([
          getRepPeriodStats(expandedId, info.orgId, range.from, range.to),
          getRepPinCounts(expandedId, info.orgId, range.from, range.to),
        ]);
        if (!cancelled) {
          setExpandedStats((m) => ({ ...m, [key]: stats }));
          setExpandedPins((m) => ({ ...m, [key]: pins }));
        }
      } catch {
        if (!cancelled) {
          setExpandedStats((m) => ({ ...m, [key]: null }));
          setExpandedPins((m) => ({ ...m, [key]: null }));
        }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandedId, range.from, range.to]);

  // Classement : revenus, puis ventes (plus de choix de métrique).
  const board = [...reps].sort((a, b) => b.revenue - a.revenue || b.closes - a.closes);
  const salesText = (r: RepData) => `${r.closes} ${fr ? 'ventes' : 'sales'}`;

  const q = query.trim().toLowerCase();
  const searching = q.length > 0;
  const filtered = searching ? board.filter((r) => r.name.toLowerCase().includes(q)) : board;

  // Podium: places 2-1-3 so #1 sits in the middle, raised.
  const podium = board.slice(0, 3);
  const podiumOrder = [podium[1], podium[0], podium[2]].filter(Boolean) as RepData[];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-text-primary">{fr ? 'Classement' : 'Rankings'}</h2>
          <p className="mt-1 text-sm text-text-tertiary">{fr ? 'Classement de l\'équipe' : 'Team ranking'}</p>
        </div>
        {/* Scope toggle — seulement si la compagnie a 2+ offices, et caché
            quand un office précis est sélectionné (redondant). */}
        {offices.length > 1 && !officeId && (
          <div className="flex items-center rounded-lg border border-border-subtle overflow-hidden">
            {(['mine', 'all'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setScope(s)}
                className={cn(
                  'px-3 py-1.5 text-xs font-medium transition-colors',
                  scope === s ? 'bg-white text-text-primary shadow-sm' : 'text-text-muted hover:text-text-secondary',
                )}
              >
                {s === 'mine' ? (fr ? 'Mon bureau' : 'My office') : (fr ? 'Tous les bureaux' : 'All offices')}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Date / period selector — every stat on this page follows this window */}
      <div className="relative">
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-border-subtle bg-white px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <Calendar className="h-4 w-4 shrink-0 text-text-muted" />
            <p className="truncate text-sm font-semibold text-text-primary">{formatRangeLabel(range, fr)}</p>
          </div>
          <button
            onClick={() => { setDraft(range); setPickerOpen((o) => !o); }}
            className="shrink-0 rounded-lg border border-border-subtle bg-white px-3 py-1.5 text-xs font-semibold text-text-primary transition-colors hover:bg-surface-elevated"
          >
            {fr ? 'Changer' : 'Change'}
          </button>
        </div>

        {pickerOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setPickerOpen(false)} />
            <div className="absolute right-0 top-[calc(100%+8px)] z-20 w-72 rounded-2xl border border-border-subtle bg-white p-4 shadow-xl">
              <p className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                {fr ? 'Date ou période' : 'Date or period'}
              </p>
              <div className="space-y-2.5">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-text-secondary">{fr ? 'Du' : 'From'}</span>
                  <input
                    type="date"
                    value={draft.from}
                    max={todayIso()}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (!v) return;
                      setDraft((d) => ({ from: v, to: v > d.to ? v : d.to }));
                    }}
                    className="w-full rounded-lg border border-border-subtle bg-white px-3 py-1.5 text-sm text-text-primary outline-none"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-text-secondary">{fr ? 'Au' : 'To'}</span>
                  <input
                    type="date"
                    value={draft.to}
                    min={draft.from}
                    max={todayIso()}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (!v) return;
                      setDraft((d) => ({ from: v < d.from ? v : d.from, to: v }));
                    }}
                    className="w-full rounded-lg border border-border-subtle bg-white px-3 py-1.5 text-sm text-text-primary outline-none"
                  />
                </label>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <button
                  onClick={() => { const t = todayIso(); setDraft({ from: t, to: t }); }}
                  className="flex-1 rounded-lg border border-border-subtle bg-white px-3 py-1.5 text-xs font-semibold text-text-primary transition-colors hover:bg-surface-elevated"
                >
                  {fr ? "Aujourd'hui" : 'Today'}
                </button>
                <button
                  onClick={() => { setRange(draft); setPickerOpen(false); }}
                  className="flex-1 rounded-lg bg-text-primary px-3 py-1.5 text-xs font-semibold text-surface transition-opacity hover:opacity-90"
                >
                  {fr ? 'Appliquer' : 'Apply'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Category tabs (all / rookie / experienced) + office filter */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex rounded-xl border border-border-subtle bg-white p-0.5">
          {([
            ['all', fr ? 'Tous' : 'All'],
            ['rookie', fr ? '1re année' : 'First year'],
            ['experienced', fr ? 'Expérimentés' : 'Experienced'],
          ] as [Category, string][]).map(([c, label]) => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              className={cn(
                'rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors',
                category === c ? 'bg-text-primary text-surface' : 'text-text-muted hover:text-text-secondary',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {offices.length > 1 && (
          <select
            value={officeId}
            onChange={(e) => setOfficeId(e.target.value)}
            className="rounded-lg border border-border-subtle bg-white px-3 py-1.5 text-xs font-medium text-text-primary outline-none"
          >
            <option value="">{fr ? 'Tous les bureaux' : 'All offices'}</option>
            {offices.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        )}
      </div>

      {/* Search */}
      <div className="flex items-center gap-2 rounded-2xl border border-border-subtle bg-white px-3.5 py-2.5">
        <Search className="h-4 w-4 text-text-muted" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={fr ? 'Rechercher un rep…' : 'Search a rep…'}
          className="flex-1 bg-transparent text-sm text-text-primary outline-none placeholder:text-text-muted"
        />
        {searching && (
          <button onClick={() => setQuery('')} className="text-text-muted hover:text-text-secondary">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Loading / empty / content */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-text-muted" />
        </div>
      ) : board.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Trophy className="h-11 w-11 text-text-muted/30" />
          <p className="mt-3 text-sm font-medium text-text-secondary">{fr ? 'Aucune activité' : 'No activity'}</p>
          <p className="mt-1 text-xs text-text-muted">
            {fr ? 'Aucun rep n\'a de stats pour cette période.' : 'No rep has stats for this period.'}
          </p>
        </div>
      ) : (
        <>
          {/* Podium 2-1-3 (only when not searching) */}
          {!searching && (
            <div className="flex items-start justify-center gap-6 pb-2 pt-3">
              {podiumOrder.map((rep) => {
                const isFirst = rep.rank === 1;
                const ring = RANK_RING[rep.rank - 1] ?? 'transparent';
                const avatarSize = isFirst ? 'h-[84px] w-[84px]' : 'h-16 w-16';
                return (
                  <button
                    key={rep.userId}
                    onClick={() => navigate(`/reps/${rep.userId}`)}
                    className="flex flex-col items-center"
                    style={{ marginTop: isFirst ? 0 : 20 }}
                  >
                    <div className="relative">
                      <div style={{ border: `3px solid ${ring}`, borderRadius: 9999, padding: 2 }}>
                        <RepAvatar
                          rep={rep}
                          className={cn(avatarSize, 'shadow-lg')}
                          textClassName={isFirst ? 'text-2xl' : 'text-lg'}
                        />
                      </div>
                      <div
                        className="absolute -top-1.5 -right-1.5 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white text-[11px] font-bold text-white"
                        style={{ background: ring }}
                      >
                        {rep.rank}
                      </div>
                    </div>
                    <p className="mt-2 max-w-[120px] truncate text-center text-sm font-semibold text-text-primary">{rep.name}</p>
                    <p className={cn('text-center font-bold text-text-primary', isFirst ? 'text-xl' : 'text-lg')}>
                      {money(rep.revenue)}
                    </p>
                    <p className="text-center text-xs font-semibold text-text-muted">{salesText(rep)}</p>
                  </button>
                );
              })}
            </div>
          )}

          {/* Ranking list */}
          <Card>
            <CardContent className="p-0">
              {filtered.map((rep, i) => {
                const expanded = expandedId === rep.userId;
                const stats = expandedStats[`${rep.userId}:${range.from}:${range.to}`];
                const pins = expandedPins[`${rep.userId}:${range.from}:${range.to}`];
                return (
                  <div key={rep.userId} className={cn(i < filtered.length - 1 && 'border-b border-border-subtle')}>
                    <button
                      onClick={() => setExpandedId((cur) => (cur === rep.userId ? null : rep.userId))}
                      className="flex w-full items-center gap-4 px-5 py-3 text-left transition-colors hover:bg-surface-elevated"
                    >
                      <div className="w-6 text-center text-base font-bold text-text-muted">{rep.rank}</div>

                      <Link
                        to={`/reps/${rep.userId}`}
                        className="flex flex-1 items-center gap-3 min-w-0 group"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <RepAvatar rep={rep} className="h-9 w-9" textClassName="text-xs" />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-text-primary group-hover:text-text-secondary transition-colors">{rep.name}</p>
                          {/* Bureau du rep — pertinent seulement quand la compagnie a 2+ offices */}
                          {offices.length > 1 && rep.officeName && (
                            <p className="truncate text-xs text-text-muted">{rep.officeName}</p>
                          )}
                        </div>
                      </Link>

                      <p className="shrink-0 text-base font-bold text-text-primary">
                        {rep.closes} <span className="text-xs font-semibold text-text-muted">{fr ? 'ventes' : 'sales'}</span>
                      </p>
                      <p className="shrink-0 text-right text-base font-bold text-text-primary">{money(rep.revenue)}</p>
                      <ChevronDown className={cn('h-4 w-4 shrink-0 text-text-muted transition-transform duration-200', expanded && 'rotate-180')} />
                    </button>

                    {/* Rangée dépliée — les 9 stats du Rep Hub pour la période sélectionnée */}
                    {expanded && (
                      <div className="border-t border-border-subtle bg-surface-elevated/50 px-5 py-4">
                        {stats === undefined ? (
                          <div className="flex items-center justify-center py-6">
                            <Loader2 className="h-5 w-5 animate-spin text-text-muted" />
                          </div>
                        ) : stats === null ? (
                          <p className="py-4 text-center text-xs text-text-muted">
                            {fr ? 'Stats indisponibles' : 'Stats unavailable'}
                          </p>
                        ) : (
                          <>
                            {/* Terrain — portes / conversations / ventes de la période (dérivé des pins) */}
                            {pins && (
                              <div className="mb-2 rounded-lg border border-border-subtle bg-white px-4 py-3">
                                <p className="text-[10px] font-medium uppercase tracking-wider text-text-muted">Terrain</p>
                                {/* Milieu plus large : « Conversations » est le libellé le plus long */}
                                <div className="mt-2.5 grid grid-cols-[1fr_1.4fr_1fr]">
                                  {([
                                    [DoorOpen, pins.total, fr ? 'Portes' : 'Doors'],
                                    [MessagesSquare, pins.total - pins.byKind.no_answer, fr ? 'Conversations' : 'Talks'],
                                    [TrendingUp, pins.byKind.closed_won, fr ? 'Ventes' : 'Sales'],
                                  ] as [typeof DoorOpen, number, string][]).map(([Icon, value, label], idx) => (
                                    <div key={label} className={cn('flex min-w-0 flex-col gap-1.5 overflow-hidden', idx > 0 && 'border-l border-border-subtle pl-4')}>
                                      <Icon className="h-4 w-4 shrink-0 text-text-primary" />
                                      <div className="min-w-0">
                                        <p className="text-xl font-extrabold leading-none tracking-tight tabular-nums text-text-primary">{value}</p>
                                        <p className="mt-1 truncate text-[9px] font-bold uppercase tracking-[0.1em] text-text-muted">{label}</p>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            <div className="grid grid-cols-3 gap-2">
                              {statsToKPIs(stats).map((kpi) => (
                                <div key={kpi.label} className="rounded-lg border border-border-subtle bg-white px-3 py-2.5">
                                  <p className="text-[10px] font-medium uppercase tracking-wider text-text-muted">{kpi.label}</p>
                                  <p className="mt-0.5 text-sm font-bold text-text-primary">{kpi.value}</p>
                                  {kpi.sub && <p className="text-[10px] text-text-muted">{kpi.sub}</p>}
                                </div>
                              ))}
                            </div>

                            <Link
                              to={`/reps/${rep.userId}`}
                              className="mt-3 flex items-center justify-center gap-2 rounded-lg border border-border-subtle bg-white px-4 py-2 text-xs font-semibold text-text-primary transition-colors hover:bg-surface-elevated"
                            >
                              <User size={14} />
                              {fr ? 'Voir le profil complet' : 'View full profile'}
                            </Link>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </>
      )}

    </div>
  );
}
