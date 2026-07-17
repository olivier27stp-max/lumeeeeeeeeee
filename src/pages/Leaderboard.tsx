import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Card, CardContent } from '../components/d2d/card';
import { cn } from '../lib/utils';
import { useTranslation } from '../i18n';
import { getLeaderboard, getRepPerformance, setRepExperience, getOffices, type Office, type LeaderboardRange } from '../lib/leaderboardApi';
import { useCompany } from '../contexts/CompanyContext';
import { usePermissions } from '../hooks/usePermissions';
import { toast } from 'sonner';
import type { LeaderboardEntry, RepPerformanceDetail } from '../types';
import { Calendar, ChevronRight, X, User, Loader2, Search, Trophy } from 'lucide-react';

type Metric = 'sales' | 'revenue';
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

function perfToKPIs(perf: RepPerformanceDetail): { key: string; value: string }[] {
  return [
    { key: 'leads', value: String(perf.doors_knocked) },
    { key: 'contacted', value: String(perf.conversations) },
    { key: 'deals', value: String(perf.demos_set) },
    { key: 'quotes_sent', value: String(perf.quotes_sent) },
    { key: 'accounts', value: String(perf.closes) },
    { key: 'revenue', value: `$${perf.revenue.toLocaleString()}` },
    { key: 'conversion_rate', value: `${Math.round(perf.conversion_rate)}%` },
    { key: 'avg_ticket', value: `$${Math.round(perf.average_ticket || 0).toLocaleString()}` },
  ];
}

function perfToFunnel(perf: RepPerformanceDetail): { key: string; value: number; max: number }[] {
  const max = perf.doors_knocked || 1;
  return [
    { key: 'leads', value: perf.doors_knocked, max },
    { key: 'contacted', value: perf.conversations, max },
    { key: 'deals_open', value: perf.demos_set, max },
    { key: 'quotes_sent', value: perf.quotes_sent, max },
    { key: 'accounts', value: perf.closes, max },
  ];
}

// Podium ring colors — gold / silver / bronze (mirrors the mobile RANK_RING).
const RANK_RING = ['#F59E0B', '#94A3B8', '#EA580C'];

const money = (v: number) =>
  new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(v || 0);

export default function D2DLeaderboard() {
  const navigate = useNavigate();
  const { language } = useTranslation();
  const fr = language === 'fr';
  const { currentOrgId } = useCompany();
  const { role } = usePermissions();
  const isAdmin = role === 'owner' || role === 'admin';
  // Date / période sélectionnée — toutes les stats de la page suivent cette fenêtre.
  const [range, setRange] = useState<LeaderboardRange>(() => ({ from: todayIso(), to: todayIso() }));
  const [pickerOpen, setPickerOpen] = useState(false);
  const [draft, setDraft] = useState<LeaderboardRange>(range);
  const [metric, setMetric] = useState<Metric>('revenue');
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const [category, setCategory] = useState<Category>('all');
  const [officeId, setOfficeId] = useState<string>(''); // '' = follow the scope toggle
  const [offices, setOffices] = useState<Office[]>([]);
  const [query, setQuery] = useState('');
  const [selectedRep, setSelectedRep] = useState<RepData | null>(null);
  const [loading, setLoading] = useState(true);
  const [reps, setReps] = useState<RepData[]>([]);

  const [detailKPIs, setDetailKPIs] = useState<{ key: string; value: string }[]>([]);
  const [funnelSteps, setFunnelSteps] = useState<{ key: string; value: number; max: number }[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

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

  const reload = useCallback(() => fetchBoard(), [fetchBoard]);

  useEffect(() => {
    const ref = { current: false };
    fetchBoard(ref);
    return () => { ref.current = true; };
  }, [fetchBoard]);

  // Admin: tag a rep rookie/experienced, then refresh.
  const tagRep = useCallback(async (userId: string, level: 'rookie' | 'experienced' | null) => {
    try {
      await setRepExperience(userId, level);
      toast.success(fr ? 'Catégorie mise à jour' : 'Category updated');
      reload();
    } catch (e: any) {
      toast.error(e?.message || (fr ? 'Échec' : 'Failed'));
    }
  }, [reload, fr]);

  const openRepDrawer = useCallback((rep: RepData) => {
    setSelectedRep(rep);
    setDetailLoading(true);
    getRepPerformance(rep.userId, range.from, range.to)
      .then(({ performance }) => {
        setDetailKPIs(perfToKPIs(performance));
        setFunnelSteps(perfToFunnel(performance));
      })
      .catch(() => {
        setDetailKPIs([]);
        setFunnelSteps([]);
      })
      .finally(() => setDetailLoading(false));
  }, [range.from, range.to]);

  // Sort by the selected metric (mirrors mobile: revenue → revenue then closes).
  const board = [...reps].sort((a, b) =>
    metric === 'revenue' ? b.revenue - a.revenue || b.closes - a.closes : b.closes - a.closes || b.revenue - a.revenue,
  );
  const valText = (r: RepData) => (metric === 'revenue' ? money(r.revenue) : String(r.closes));
  const subText = (r: RepData) => (metric === 'revenue' ? `${r.closes} ${fr ? 'ventes' : 'sales'}` : money(r.revenue));

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
        {/* Scope toggle — hidden when a specific office is selected (redundant). */}
        {!officeId && (
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

      {/* Metric pills */}
      <div className="flex justify-center gap-2">
        {(['sales', 'revenue'] as Metric[]).map((m) => (
          <button
            key={m}
            onClick={() => setMetric(m)}
            className={cn(
              'rounded-full border px-4 py-1.5 text-xs font-semibold transition-colors',
              metric === m ? 'border-text-primary bg-text-primary text-surface' : 'border-border-subtle bg-white text-text-primary',
            )}
          >
            {m === 'sales' ? (fr ? 'Ventes' : 'Sales') : (fr ? 'Revenus' : 'Revenue')}
          </button>
        ))}
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
                      {valText(rep)}
                    </p>
                  </button>
                );
              })}
            </div>
          )}

          {/* Ranking list */}
          <Card>
            <CardContent className="p-0">
              {filtered.map((rep, i) => (
                <button
                  key={rep.userId}
                  onClick={() => openRepDrawer(rep)}
                  className={cn(
                    'flex w-full items-center gap-4 px-5 py-3 text-left transition-colors hover:bg-surface-elevated',
                    i < filtered.length - 1 && 'border-b border-border-subtle',
                  )}
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
                      <p className="text-xs text-text-muted">{subText(rep)}</p>
                    </div>
                  </Link>

                  <p className="text-right text-base font-bold text-text-primary">{valText(rep)}</p>
                  <ChevronRight className="h-4 w-4 text-text-muted" />
                </button>
              ))}
            </CardContent>
          </Card>
        </>
      )}

      {/* Drawer (unchanged — real rep detail) */}
      {selectedRep && (
        <>
          <div className="fixed inset-0 z-40 bg-black/20" onClick={() => setSelectedRep(null)} />
          <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col bg-white border-l border-border-subtle shadow-xl animate-in slide-in-from-right duration-200">
            <div className="flex items-center justify-between border-b border-border-subtle px-5 py-4">
              <div className="flex items-center gap-3">
                <RepAvatar rep={selectedRep} className="h-11 w-11" textClassName="text-sm" />
                <h3 className="text-sm font-semibold text-text-primary">{selectedRep.name}</h3>
              </div>
              <button onClick={() => setSelectedRep(null)} className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-surface-elevated hover:text-text-secondary">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              {/* Admin: classify this rep */}
              {isAdmin && (
                <div className="mb-5 rounded-lg border border-border-subtle bg-surface-elevated p-3">
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                    {fr ? 'Catégorie du rep' : 'Rep category'}
                  </p>
                  <div className="flex gap-1.5">
                    {([
                      ['rookie', fr ? '1re année' : 'First year'],
                      ['experienced', fr ? 'Expérimenté' : 'Experienced'],
                      [null, fr ? 'Aucune' : 'None'],
                    ] as [('rookie' | 'experienced' | null), string][]).map(([lvl, label]) => (
                      <button
                        key={String(lvl)}
                        onClick={() => { tagRep(selectedRep.userId, lvl); setSelectedRep((p) => p ? { ...p, experienceLevel: lvl } : p); }}
                        className={cn(
                          'flex-1 rounded-md border px-2 py-1.5 text-xs font-semibold transition-colors',
                          selectedRep.experienceLevel === lvl
                            ? 'border-text-primary bg-text-primary text-surface'
                            : 'border-border-subtle bg-white text-text-primary hover:bg-surface-elevated',
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {detailLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-text-muted" />
                </div>
              ) : (
                <>
                  <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">{fr ? 'Détails de performance' : 'Performance detail'} · {formatRangeLabel(range, fr)}</h4>
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
