import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Avatar } from '../components/d2d/avatar';
import { getRepAvatar } from '../lib/constants/avatars';
import { getRepPerformance, getRealtimeStats } from '../lib/leaderboardApi';
import { supabase } from '../lib/supabase';
import type { RepPerformanceDetail } from '../types';
import {
  MessageSquare,
  Phone,
  Mail,
  Settings,
  MapPin,
  Briefcase,
  Hash,
  Calendar,
  TrendingUp,
  ChevronRight,
  ArrowLeft,
  Users,
  Target,
  DollarSign,
  BarChart3,
  Percent,
  CircleDollarSign,
  ClipboardList,
  CheckCircle2,
  Clock,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** UUID v4 pattern check */
function isUUID(str: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

function fmtCurrency(n: number) {
  if (n >= 1000) return `$${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k`;
  return `$${n}`;
}

/** Build quarter date ranges for the last 4 quarters from today */
function getQuarterRanges(): { label: string; from: string; to: string }[] {
  const now = new Date();
  const quarters: { label: string; from: string; to: string }[] = [];
  let year = now.getFullYear();
  let quarter = Math.ceil((now.getMonth() + 1) / 3);

  for (let i = 0; i < 4; i++) {
    const startMonth = (quarter - 1) * 3; // 0-based
    const from = new Date(year, startMonth, 1);
    const to = new Date(year, startMonth + 3, 0); // last day of quarter
    quarters.push({
      label: `Q${quarter} ${year}`,
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
    });
    quarter--;
    if (quarter === 0) {
      quarter = 4;
      year--;
    }
  }
  return quarters;
}

/** Convert API RepPerformanceDetail into the stats shape used by the UI */
function perfToStats(perf: RepPerformanceDetail) {
  return {
    revenue: perf.revenue,
    closes: perf.closes,
    deals: perf.demos_held,
    conversion: perf.conversion_rate,
    doors: perf.doors_knocked,
    avgDealValue: perf.average_ticket,
    commission: Math.round(perf.revenue * 0.1), // 10% commission estimate
    activeLeads: perf.quotes_sent,
    jobsCompleted: perf.closes,
    jobsPending: perf.follow_ups_completed,
  };
}

// ---------------------------------------------------------------------------
// Profile shape used by the UI
// ---------------------------------------------------------------------------
interface ProfileData {
  id: string;
  name: string;
  role: string;
  tagline: string;
  avatar_url: string | null;
  banner_url: string | null;
  phone: string;
  email: string;
  location: string;
  department: string;
  employee_id: string;
  hire_date: string;
  team: string;
  stats: {
    revenue: number; closes: number; deals: number; conversion: number;
    doors: number; avgDealValue: number; commission: number;
    activeLeads: number; jobsCompleted: number; jobsPending: number;
  };
  quarterSales: { label: string; value: number; percent: number }[];
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function D2DRepProfile() {
  const { id, memberId } = useParams<{ id: string; memberId: string }>();
  const navigate = useNavigate();
  const paramId = id || memberId || '';

  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function fetchFromApi(userId: string) {
      // Fetch profile info, team member details, and performance in parallel
      const [profileRes, memberRes, realtimeRes] = await Promise.all([
        supabase.from('profiles').select('id, full_name, avatar_url, company_name').eq('id', userId).maybeSingle(),
        supabase.from('team_members').select('*').eq('user_id', userId).maybeSingle(),
        getRealtimeStats(userId),
      ]);

      const dbProfile = profileRes.data;
      const dbMember = memberRes.data;

      if (!dbProfile && !dbMember) {
        throw new Error('Profile not found');
      }

      // Build name from available sources
      const name = dbMember
        ? `${dbMember.first_name || ''} ${dbMember.last_name || ''}`.trim()
        : dbProfile?.full_name || 'Unknown';

      const address = dbMember?.address;
      const location = address
        ? [address.city, address.province].filter(Boolean).join(', ')
        : '';

      // Fetch quarterly performance data
      const quarterRanges = getQuarterRanges();
      const quarterResults = await Promise.all(
        quarterRanges.map(async (q) => {
          try {
            const { performance } = await getRepPerformance(userId, q.from, q.to);
            return { label: q.label, revenue: performance.revenue };
          } catch {
            return { label: q.label, revenue: 0 };
          }
        })
      );

      // Calculate quarter sales with percentages (relative to a target, e.g. $90k/quarter)
      const TARGET_QUARTERLY = 90000;
      const quarterSales = quarterResults
        .filter((q) => q.revenue > 0)
        .map((q) => ({
          label: q.label,
          value: q.revenue,
          percent: Math.min(100, Math.round((q.revenue / TARGET_QUARTERLY) * 100)),
        }));

      const stats = perfToStats(realtimeRes);

      const result: ProfileData = {
        id: userId,
        name,
        role: dbMember?.role || 'Sales Rep',
        tagline: '',
        avatar_url: dbMember?.avatar_url || dbProfile?.avatar_url || null,
        banner_url: null,
        phone: dbMember?.phone || '',
        email: dbMember?.email || '',
        location,
        department: 'Sales',
        employee_id: dbMember?.id ? `CLO-${String(dbMember.id).slice(0, 4).toUpperCase()}` : '',
        hire_date: dbMember?.created_at
          ? new Date(dbMember.created_at).toLocaleDateString('fr-CA', { month: 'short', year: 'numeric' })
          : '',
        team: '',
        stats,
        quarterSales,
      };

      return result;
    }

    async function load() {
      setLoading(true);

      // Slug params (not UUID) are no longer supported — need a real user ID
      if (!isUUID(paramId)) {
        if (!cancelled) {
          setProfile(null);
          setLoading(false);
        }
        return;
      }

      // It's a UUID — fetch from the API
      try {
        const data = await fetchFromApi(paramId);
        if (!cancelled) {
          setProfile(data);
          setLoading(false);
        }
      } catch (err) {
        console.error('[RepProfile] API fetch failed:', err);
        if (!cancelled) {
          setProfile(null);
          setLoading(false);
        }
      }
    }

    load();
    return () => { cancelled = true; };
  }, [paramId]);

  // ── Not found ──
  if (!loading && !profile) {
    return (
      <div className="min-h-[calc(100vh-3rem)] bg-surface dark:bg-[#0B0F14] flex flex-col items-center justify-center">
        <p className="text-lg font-semibold text-text-primary">Profil introuvable</p>
        <p className="mt-1 text-sm text-text-muted">Ce rep n'existe pas ou les données ne sont pas disponibles.</p>
        <button onClick={() => navigate(-1)} className="mt-4 rounded-lg bg-text-primary px-4 py-2 text-sm font-semibold text-surface hover:opacity-90">
          Retour
        </button>
      </div>
    );
  }

  // ── Loading skeleton ──
  if (loading || !profile) {
    return (
      <div className="min-h-[calc(100vh-3rem)] bg-surface dark:bg-[#0B0F14]">
        {/* Banner skeleton */}
        <div className="relative h-[200px] w-full overflow-hidden">
          <div className="h-full w-full animate-pulse bg-surface-tertiary dark:bg-[rgba(255,255,255,0.04)]" />
        </div>

        <div className="relative mx-auto max-w-6xl px-8">
          {/* Avatar skeleton */}
          <div className="absolute -top-14">
            <div className="h-[116px] w-[116px] rounded-full animate-pulse bg-surface-tertiary dark:bg-[rgba(255,255,255,0.06)]" />
          </div>

          {/* Name row skeleton */}
          <div className="flex items-end justify-between pt-16 pb-6">
            <div className="pl-1 space-y-2">
              <div className="h-8 w-48 rounded-lg animate-pulse bg-surface-tertiary dark:bg-[rgba(255,255,255,0.06)]" />
              <div className="h-4 w-32 rounded-lg animate-pulse bg-surface-tertiary dark:bg-[rgba(255,255,255,0.04)]" />
              <div className="h-3 w-40 rounded-lg animate-pulse bg-surface-tertiary dark:bg-[rgba(255,255,255,0.03)]" />
            </div>
            <div className="flex items-center gap-2">
              <div className="h-10 w-28 rounded-xl animate-pulse bg-surface-tertiary dark:bg-[rgba(255,255,255,0.06)]" />
              <div className="h-10 w-10 rounded-xl animate-pulse bg-surface-tertiary dark:bg-[rgba(255,255,255,0.04)]" />
              <div className="h-10 w-10 rounded-xl animate-pulse bg-surface-tertiary dark:bg-[rgba(255,255,255,0.04)]" />
              <div className="h-10 w-10 rounded-xl animate-pulse bg-surface-tertiary dark:bg-[rgba(255,255,255,0.04)]" />
            </div>
          </div>
        </div>

        {/* Content grid skeleton */}
        <div className="mx-auto max-w-6xl px-8 pb-10">
          <div className="grid grid-cols-12 gap-5">
            {/* Left column */}
            <div className="col-span-4 space-y-5">
              <div className="h-64 rounded-2xl animate-pulse bg-surface-tertiary dark:bg-[rgba(255,255,255,0.04)]" />
              <div className="h-40 rounded-2xl animate-pulse bg-surface-tertiary dark:bg-[rgba(255,255,255,0.04)]" />
            </div>
            {/* Right column */}
            <div className="col-span-8 space-y-5">
              <div className="grid grid-cols-4 gap-3">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="h-28 rounded-2xl animate-pulse bg-surface-tertiary dark:bg-[rgba(255,255,255,0.04)]" />
                ))}
              </div>
              <div className="grid grid-cols-4 gap-3">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="h-28 rounded-2xl animate-pulse bg-surface-tertiary dark:bg-[rgba(255,255,255,0.04)]" />
                ))}
              </div>
              <div className="h-48 rounded-2xl animate-pulse bg-surface-tertiary dark:bg-[rgba(255,255,255,0.04)]" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  const p = profile;

  return (
    <div className="min-h-[calc(100vh-3rem)] bg-surface dark:bg-[#0B0F14]">

      {/* ── Banner ── */}
      <div className="relative h-[200px] w-full overflow-hidden">
        {p.banner_url ? (
          <img src={p.banner_url} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="h-full w-full" style={{ background: 'linear-gradient(135deg, #1a1a1a 0%, #333 40%, #555 100%)' }} />
        )}
        <div className="absolute inset-0" style={{ background: 'linear-gradient(to top, var(--color-surface, #fafafa) 0%, rgba(250,250,250,0.7) 25%, transparent 60%)' }} />
        <div className="dark:block hidden absolute inset-0" style={{ background: 'linear-gradient(to top, #0B0F14 0%, #0B0F14aa 25%, transparent 60%)' }} />

        {/* Back */}
        <button
          onClick={() => navigate(-1)}
          className="absolute top-5 left-6 z-10 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium text-white/80 transition-colors hover:text-white"
          style={{ background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(8px)' }}
        >
          <ArrowLeft size={14} />
          Back
        </button>
      </div>

      {/* ── Profile header ── */}
      <div className="relative mx-auto max-w-6xl px-8">
        {/* Avatar */}
        <div className="absolute -top-14">
          <div className="rounded-full p-[3px]" style={{ background: 'linear-gradient(135deg, #333, #666)', boxShadow: '0 0 24px rgba(0,0,0,0.2)' }}>
            <div className="rounded-full border-4 border-surface dark:border-[#0B0F14]">
              <Avatar name={p.name} src={getRepAvatar(p.name)} size="lg" className="!h-[110px] !w-[110px]" />
            </div>
          </div>
        </div>

        {/* Name row */}
        <div className="flex items-end justify-between pt-16 pb-6">
          <div className="pl-1">
            <h1 className="text-[28px] font-extrabold text-text-primary tracking-tight">{p.name}</h1>
            <p className="mt-1 text-[14px] font-semibold text-text-secondary">{p.role}</p>
            {p.tagline && <p className="mt-1 text-[13px] text-text-tertiary italic">"{p.tagline}"</p>}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <Link
              to="/feed"
              className="flex items-center gap-2 rounded-xl bg-text-primary text-surface px-5 py-2.5 text-[13px] font-bold transition-all duration-200 hover:opacity-90 hover:scale-[1.02] active:scale-[0.98]"
            >
              <MessageSquare size={16} strokeWidth={2.5} />
              Message
            </Link>
            <ActionBtn icon={Phone} href={p.phone ? `tel:${p.phone}` : undefined} />
            <ActionBtn icon={Mail} href={p.email ? `mailto:${p.email}` : undefined} />
            <ActionBtn icon={Settings} />
          </div>
        </div>
      </div>

      {/* ── Content grid ── */}
      <div className="mx-auto max-w-6xl px-8 pb-10">
        <div className="grid grid-cols-12 gap-5">

          {/* ============================================================= */}
          {/* LEFT COLUMN                                                    */}
          {/* ============================================================= */}
          <div className="col-span-4 space-y-5">

            {/* Info card */}
            <CardPanel title="Details">
              <div className="space-y-4">
                <InfoRow icon={MapPin} label="Location" value={p.location || '—'} />
                <InfoRow icon={Briefcase} label="Department" value={p.department} />
                <InfoRow icon={Users} label="Team" value={p.team || '—'} />
                <InfoRow icon={Calendar} label="Hire Date" value={p.hire_date || '—'} />
                <InfoRow icon={Hash} label="Employee ID" value={p.employee_id || '—'} />
              </div>
            </CardPanel>

            {/* Contact info */}
            <CardPanel title="Contact">
              <div className="space-y-3">
                <ContactItem label="Phone" value={p.phone || '—'} />
                <ContactItem label="Email" value={p.email || '—'} />
                <ContactItem label="Team" value={p.team || '—'} />
              </div>
            </CardPanel>
          </div>

          {/* ============================================================= */}
          {/* RIGHT COLUMN                                                   */}
          {/* ============================================================= */}
          <div className="col-span-8 space-y-5">

            {/* KPI row — top 4 */}
            <div className="grid grid-cols-4 gap-3">
              <KpiCard icon={DollarSign} label="Total Revenue" value={fmtCurrency(p.stats.revenue)} />
              <KpiCard icon={Target} label="Deals Closed" value={String(p.stats.closes)} />
              <KpiCard icon={Percent} label="Conversion" value={`${p.stats.conversion}%`} />
              <KpiCard icon={BarChart3} label="Avg Deal Value" value={fmtCurrency(p.stats.avgDealValue)} />
            </div>

            {/* KPI row — bottom 4 */}
            <div className="grid grid-cols-4 gap-3">
              <KpiCard icon={CircleDollarSign} label="Commission" value={fmtCurrency(p.stats.commission)} />
              <KpiCard icon={ClipboardList} label="Active Leads" value={String(p.stats.activeLeads)} />
              <KpiCard icon={CheckCircle2} label="Jobs Completed" value={String(p.stats.jobsCompleted)} />
              <KpiCard icon={Clock} label="Jobs Pending" value={String(p.stats.jobsPending)} />
            </div>

            {/* Quarterly performance */}
            {p.quarterSales.length > 0 && (
              <CardPanel title="Sales by Quarter">
                <div className="space-y-5">
                  {p.quarterSales.map((q) => (
                    <div key={q.label}>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[13px] font-semibold text-text-primary">{q.label}</span>
                        <div className="flex items-baseline gap-2">
                          <span className="text-[14px] font-bold text-text-primary">{fmtCurrency(q.value)}</span>
                          <span className="text-[11px] font-semibold text-text-tertiary">{q.percent}%</span>
                        </div>
                      </div>
                      <div className="h-3 w-full overflow-hidden rounded-full bg-surface-tertiary dark:bg-[rgba(255,255,255,0.04)]">
                        <div
                          className="h-full rounded-full transition-all duration-1000 ease-out bg-text-primary"
                          style={{ width: `${q.percent}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </CardPanel>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ActionBtn({ icon: Icon, href }: { icon: React.ComponentType<{ size: number; className?: string }>; href?: string }) {
  const cls = "flex h-10 w-10 items-center justify-center rounded-xl border border-outline transition-all duration-200 hover:scale-110 hover:bg-surface-secondary active:scale-95";
  if (href) {
    return <a href={href} className={cls}><Icon size={18} className="text-text-tertiary" /></a>;
  }
  return <button className={cls}><Icon size={18} className="text-text-tertiary" /></button>;
}

function CardPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-outline bg-surface-elevated dark:bg-[#111519] dark:border-[rgba(255,255,255,0.06)] p-5">
      <h3 className="mb-4 text-[13px] font-bold text-text-primary">{title}</h3>
      {children}
    </div>
  );
}

function InfoRow({ icon: Icon, label, value }: { icon: React.ComponentType<{ size: number; className?: string }>; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface-tertiary dark:bg-[rgba(255,255,255,0.04)] border border-outline dark:border-[rgba(255,255,255,0.06)]">
        <Icon size={16} className="text-text-secondary" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[9px] font-bold uppercase tracking-[0.1em] text-text-tertiary">{label}</p>
        <p className="text-[13px] font-semibold text-text-primary truncate">{value}</p>
      </div>
      <ChevronRight size={14} className="shrink-0 text-text-tertiary" />
    </div>
  );
}

function KpiCard({ icon: Icon, label, value }: { icon: React.ComponentType<{ size: number; className?: string }>; label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-outline bg-surface-elevated dark:bg-[#111519] dark:border-[rgba(255,255,255,0.06)] px-4 py-4">
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-tertiary dark:bg-[rgba(255,255,255,0.04)] mb-3">
        <Icon size={16} className="text-text-secondary" />
      </div>
      <p className="text-[22px] font-extrabold text-text-primary tracking-tight">{value}</p>
      <p className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-text-tertiary">{label}</p>
    </div>
  );
}

function ContactItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-outline dark:border-[rgba(255,255,255,0.04)] bg-surface-secondary dark:bg-[rgba(255,255,255,0.02)] px-4 py-3">
      <p className="text-[9px] font-bold uppercase tracking-[0.1em] text-text-tertiary">{label}</p>
      <p className="mt-1 text-[13px] font-semibold text-text-primary truncate">{value}</p>
    </div>
  );
}
