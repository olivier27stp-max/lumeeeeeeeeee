import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Avatar } from '../components/d2d/avatar';
import {
  getRepPeriodStats,
  getRepPinCounts,
  getRepDealJobs,
  type RepPeriodStats,
  type RepPinCounts,
  type RepDealJob,
  type RepPinKind,
} from '../lib/repStatsApi';
import { getCommissionEntries } from '../lib/commissionsApi';
import { supabase } from '../lib/supabase';
import { getCurrentOrgIdOrThrow } from '../lib/orgApi';
import type { FsCommissionEntry } from '../types';
import { PIN_STATUS_CONFIG } from '../components/map-d2d/lead-pin';
import { toast } from 'sonner';
import {
  Phone,
  Mail,
  MapPin,
  Briefcase,
  Building2,
  Calendar,
  CalendarDays,
  CalendarCheck,
  ChevronRight,
  ArrowLeft,
  Target,
  DollarSign,
  Percent,
  CircleDollarSign,
  ClipboardList,
  XCircle,
  Pencil,
  Check,
  X,
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

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Today as a local YYYY-MM-DD string */
function todayStr(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
}

/** "Mercredi 16 juillet 2026" */
function fmtFullDate(d: string): string {
  return capitalize(
    new Date(`${d}T00:00:00`).toLocaleDateString('fr-CA', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    })
  );
}

/** "16 juil. 2026" */
function fmtShortDate(d: string): string {
  return new Date(`${d}T00:00:00`).toLocaleDateString('fr-CA', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

/** Display order of the six sales-map pin types in the Pins card */
const PIN_KIND_ORDER: RepPinKind[] = [
  'closed_won', 'appointment', 'follow_up', 'no_answer', 'rejected', 'other',
];

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
  office: string;
  department: string;
  hire_date: string;
  /** team_members row id — needed to save the rep's email/phone edits */
  memberRowId: string | null;
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
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [commissions, setCommissions] = useState<FsCommissionEntry[]>([]);
  const [deals, setDeals] = useState<RepDealJob[]>([]);
  const [pinCounts, setPinCounts] = useState<RepPinCounts | null>(null);

  // Stats period — defaults to today; a single date has from === to
  const [range, setRange] = useState<{ from: string; to: string }>(() => {
    const t = todayStr();
    return { from: t, to: t };
  });
  const [periodStats, setPeriodStats] = useState<RepPeriodStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function fetchFromApi(userId: string) {
      const orgId = await getCurrentOrgIdOrThrow();
      const [profileRes, memberRes, officeRes] = await Promise.all([
        supabase.from('profiles').select('id, full_name, avatar_url, created_at').eq('id', userId).maybeSingle(),
        supabase.from('team_members').select('id, first_name, last_name, email, phone, role, avatar_url, created_at').eq('user_id', userId).eq('org_id', orgId).maybeSingle(),
        supabase.from('company_settings').select('company_name').eq('org_id', orgId).limit(1),
      ]);

      const dbProfile = profileRes.data;
      const dbMember = memberRes.data;

      if (!dbProfile && !dbMember) {
        throw new Error('Profile not found');
      }

      // Office = the bureau (org) this rep is pinned to
      let office = officeRes.data?.[0]?.company_name || '';
      if (!office) {
        const { data: billing } = await supabase
          .from('org_billing_settings').select('company_name').eq('org_id', orgId).limit(1);
        office = billing?.[0]?.company_name || '';
      }

      // Build name from available sources
      const name = dbMember
        ? `${dbMember.first_name || ''} ${dbMember.last_name || ''}`.trim()
        : dbProfile?.full_name || 'Unknown';

      // Hire date = when the account was created
      const hireSrc = dbMember?.created_at || dbProfile?.created_at;
      const hire_date = hireSrc
        ? capitalize(new Date(hireSrc).toLocaleDateString('fr-CA', { day: 'numeric', month: 'long', year: 'numeric' }))
        : '';

      const result: ProfileData = {
        id: userId,
        name,
        role: dbMember?.role || 'Membre',
        tagline: '',
        avatar_url: dbMember?.avatar_url || dbProfile?.avatar_url || null,
        banner_url: null,
        phone: dbMember?.phone || '',
        email: dbMember?.email || '',
        office,
        department: 'Sales',
        hire_date,
        memberRowId: dbMember?.id || null,
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

      try {
        const { data: session } = await supabase.auth.getSession();
        if (!cancelled) setCurrentUserId(session.session?.user?.id ?? null);

        const data = await fetchFromApi(paramId);
        const orgId = await getCurrentOrgIdOrThrow();
        const [commissionEntries, dealJobs, pins] = await Promise.all([
          getCommissionEntries({ userId: paramId }).catch(() => [] as Awaited<ReturnType<typeof getCommissionEntries>>),
          getRepDealJobs(paramId, orgId).catch(() => [] as RepDealJob[]),
          getRepPinCounts(paramId, orgId).catch(() => null),
        ]);
        if (!cancelled) {
          setProfile(data);
          setCommissions(commissionEntries);
          setDeals(dealJobs);
          setPinCounts(pins);
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

  // Period stats — reloaded whenever the selected date / range changes
  useEffect(() => {
    if (!isUUID(paramId)) return;
    let cancelled = false;
    (async () => {
      setStatsLoading(true);
      try {
        const orgId = await getCurrentOrgIdOrThrow();
        const stats = await getRepPeriodStats(paramId, orgId, range.from, range.to);
        if (!cancelled) setPeriodStats(stats);
      } catch (err) {
        console.error('[RepProfile] Period stats fetch failed:', err);
        if (!cancelled) setPeriodStats(null);
      } finally {
        if (!cancelled) setStatsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [paramId, range.from, range.to]);

  // Rep-editable contact info (email / phone) — saved on team_members
  async function saveContactField(field: 'email' | 'phone', value: string) {
    if (!profile?.memberRowId) {
      toast.error('Profil équipe introuvable — impossible de sauvegarder.');
      throw new Error('No team_members row');
    }
    const { error } = await supabase
      .from('team_members')
      .update({ [field]: value, updated_at: new Date().toISOString() })
      .eq('id', profile.memberRowId);
    if (error) {
      toast.error('Erreur de sauvegarde.');
      throw error;
    }
    setProfile((prev) => (prev ? { ...prev, [field]: value } : prev));
    toast.success(field === 'email' ? 'Email mis à jour' : 'Numéro mis à jour');
  }

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
              <div className="grid grid-cols-3 gap-3">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="h-28 rounded-2xl animate-pulse bg-surface-tertiary dark:bg-[rgba(255,255,255,0.04)]" />
                ))}
              </div>
              <div className="grid grid-cols-3 gap-3">
                {[...Array(3)].map((_, i) => (
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
  const canEditContact = currentUserId === p.id && !!p.memberRowId;
  const singleDay = range.from === range.to;

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
              <Avatar name={p.name} src={p.avatar_url || `https://api.dicebear.com/9.x/notionists/svg?seed=${encodeURIComponent(p.id || p.name)}&backgroundColor=f5f5f5&radius=50`} size="lg" className="!h-[110px] !w-[110px]" />
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

          {/* Actions — Message / Email / Day-replay removed (features not shipping). */}
          <div className="flex items-center gap-2">
            <ActionBtn icon={Phone} href={p.phone ? `tel:${p.phone}` : undefined} />
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
                <InfoRow icon={Building2} label="Office" value={p.office || '—'} />
                <InfoRow icon={Briefcase} label="Department" value={p.department} />
                <InfoRow icon={Calendar} label="Hire Date" value={p.hire_date || '—'} />
                <EditableInfoRow
                  icon={Mail}
                  label="Email"
                  value={p.email}
                  type="email"
                  placeholder="Ajouter un email"
                  canEdit={canEditContact}
                  onSave={(v) => saveContactField('email', v)}
                />
                <EditableInfoRow
                  icon={Phone}
                  label="Phone Number"
                  value={p.phone}
                  type="tel"
                  placeholder="Ajouter un numéro"
                  canEdit={canEditContact}
                  onSave={(v) => saveContactField('phone', v)}
                />
              </div>
            </CardPanel>

            {/* Pins placed on the sales map, one row per pin type */}
            <CardPanel title="Pins">
              <div className="space-y-3">
                <div className="flex items-center justify-between rounded-xl border border-outline dark:border-[rgba(255,255,255,0.04)] bg-surface-secondary dark:bg-[rgba(255,255,255,0.02)] px-4 py-3">
                  <div className="flex items-center gap-2">
                    <MapPin size={14} className="text-text-secondary" />
                    <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-text-tertiary">Pins</span>
                  </div>
                  <span className="text-[16px] font-extrabold tabular-nums text-text-primary">{pinCounts?.total ?? 0}</span>
                </div>
                <div className="space-y-1">
                  {PIN_KIND_ORDER.map((kind) => {
                    const cfg = PIN_STATUS_CONFIG[kind];
                    return (
                      <div key={kind} className="flex items-center justify-between px-1.5 py-1.5">
                        <div className="flex items-center gap-2.5">
                          <span className="h-2.5 w-2.5 rounded-full" style={{ background: cfg.color }} />
                          <span className="text-[13px] font-semibold text-text-primary">{cfg.label}</span>
                        </div>
                        <span className="text-[13px] font-bold tabular-nums text-text-primary">{pinCounts?.byKind[kind] ?? 0}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </CardPanel>
          </div>

          {/* ============================================================= */}
          {/* RIGHT COLUMN                                                   */}
          {/* ============================================================= */}
          <div className="col-span-8 space-y-5">

            {/* Period header — full date + date/range picker box */}
            <div className="flex items-center justify-between gap-3">
              <p className="text-[15px] font-bold text-text-primary truncate">
                {singleDay ? fmtFullDate(range.from) : `Du ${fmtFullDate(range.from).toLowerCase()} au ${fmtFullDate(range.to).toLowerCase()}`}
              </p>
              <DateRangeBox range={range} onChange={(from, to) => setRange({ from, to })} />
            </div>

            {/* KPI grid — the 9 period stats */}
            <div className={`space-y-3 transition-opacity ${statsLoading ? 'opacity-50' : ''}`}>
              <div className="grid grid-cols-3 gap-3">
                <KpiCard icon={DollarSign} label="Revenue" value={fmtCurrency(periodStats?.revenue ?? 0)} />
                <KpiCard icon={Briefcase} label="Jobs" value={String(periodStats?.jobs ?? 0)} />
                <KpiCard icon={CircleDollarSign} label="Service Revenue" value={fmtCurrency(periodStats?.serviceRevenue ?? 0)} />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <KpiCard icon={ClipboardList} label="Service Jobs" value={String(periodStats?.serviceJobs ?? 0)} />
                <KpiCard icon={CalendarCheck} label="APP" value={String(periodStats?.app ?? 0)} sub="Pins rendez-vous" />
                <KpiCard icon={Target} label="VG" value={String(periodStats?.vg ?? 0)} sub="Pins vente" />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <KpiCard icon={Percent} label="Contract Closing Rate" value={periodStats?.contractClosingRate != null ? `${periodStats.contractClosingRate}%` : '—'} />
                <KpiCard icon={XCircle} label="Cancel Rate" value={periodStats?.cancelRate != null ? `${periodStats.cancelRate}%` : '—'} />
                <KpiCard icon={CalendarDays} label="Days Worked" value={String(periodStats?.daysWorked ?? 0)} />
              </div>
            </div>

            {/* ── For Deals — jobs where the rep is the assigned salesperson ── */}
            <CardPanel title={`For Deals (${deals.length})`}>
              {deals.length === 0 ? (
                <p className="text-sm text-text-tertiary text-center py-6">Aucune job assignée à ce rep pour le moment.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-outline">
                        <th className="px-2 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-text-tertiary">#</th>
                        <th className="px-2 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-text-tertiary">Titre</th>
                        <th className="px-2 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-text-tertiary">Statut</th>
                        <th className="px-2 py-2 text-right text-[10px] font-bold uppercase tracking-wider text-text-tertiary">Valeur</th>
                        <th className="px-2 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-text-tertiary">Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {deals.slice(0, 15).map((d) => (
                        <tr
                          key={d.id}
                          onClick={() => navigate(`/jobs/${d.id}`)}
                          className="border-b border-outline/50 last:border-0 cursor-pointer hover:bg-surface-secondary dark:hover:bg-[rgba(255,255,255,0.03)] transition-colors"
                        >
                          <td className="px-2 py-2 text-text-tertiary tabular-nums text-[12px]">{d.job_number || '—'}</td>
                          <td className="px-2 py-2 text-text-primary font-medium truncate max-w-[200px]">{d.title || '—'}</td>
                          <td className="px-2 py-2 text-text-secondary capitalize text-[12px]">{(d.status || '').replace(/_/g, ' ')}</td>
                          <td className="px-2 py-2 text-right tabular-nums text-text-primary">{fmtCurrency(Number(d.total_amount || 0))}</td>
                          <td className="px-2 py-2 text-text-tertiary text-[12px]">{new Date(d.created_at).toLocaleDateString('fr-CA')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardPanel>

            {/* ── Commission history ── */}
            <CardPanel title={`Historique commissions (${commissions.length})`}>
              {commissions.length === 0 ? (
                <p className="text-sm text-text-tertiary text-center py-6">Aucune commission enregistrée.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-outline">
                        <th className="px-2 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-text-tertiary">Description</th>
                        <th className="px-2 py-2 text-right text-[10px] font-bold uppercase tracking-wider text-text-tertiary">Base</th>
                        <th className="px-2 py-2 text-right text-[10px] font-bold uppercase tracking-wider text-text-tertiary">Commission</th>
                        <th className="px-2 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-text-tertiary">Statut</th>
                        <th className="px-2 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-text-tertiary">Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {commissions.slice(0, 30).map((c) => (
                        <tr key={c.id} className="border-b border-outline/50 last:border-0">
                          <td className="px-2 py-2 text-text-primary truncate max-w-[180px]">{c.description ?? c.lead_id ?? '—'}</td>
                          <td className="px-2 py-2 text-right tabular-nums text-text-secondary">${(c.base_amount || 0).toLocaleString('en-US')}</td>
                          <td className="px-2 py-2 text-right tabular-nums text-text-primary font-semibold">${(c.amount || 0).toLocaleString('en-US')}</td>
                          <td className="px-2 py-2">
                            <span className={`inline-flex items-center rounded px-2 py-0.5 text-[10px] font-semibold capitalize ${
                              c.status === 'paid' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400' :
                              c.status === 'approved' ? 'bg-blue-100 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400' :
                              c.status === 'pending' ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400' :
                              'bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-300'
                            }`}>{c.status}</span>
                          </td>
                          <td className="px-2 py-2 text-text-tertiary text-[12px]">{new Date(c.created_at).toLocaleDateString('fr-CA')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardPanel>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ActionBtn({ icon: Icon, href, className }: { icon: React.ComponentType<{ size: number; className?: string }>; href?: string; className?: string }) {
  const cls = `${className ? `${className} ` : ''}flex h-10 w-10 items-center justify-center rounded-xl border border-outline transition-all duration-200 hover:scale-110 hover:bg-surface-secondary active:scale-95`;
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

/** InfoRow variant with inline editing — the rep can add/update their own email & phone */
function EditableInfoRow({ icon: Icon, label, value, type, placeholder, canEdit, onSave }: {
  icon: React.ComponentType<{ size: number; className?: string }>;
  label: string;
  value: string;
  type: 'email' | 'tel';
  placeholder: string;
  canEdit: boolean;
  onSave: (value: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      await onSave(draft.trim());
      setEditing(false);
    } catch {
      // error toast handled by onSave
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface-tertiary dark:bg-[rgba(255,255,255,0.04)] border border-outline dark:border-[rgba(255,255,255,0.06)]">
        <Icon size={16} className="text-text-secondary" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[9px] font-bold uppercase tracking-[0.1em] text-text-tertiary">{label}</p>
        {editing ? (
          <input
            type={type}
            value={draft}
            autoFocus
            disabled={saving}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setEditing(false); }}
            placeholder={placeholder}
            className="mt-0.5 w-full rounded-lg border border-outline bg-surface px-2 py-1 text-[13px] font-semibold text-text-primary outline-none focus:border-text-tertiary dark:bg-[rgba(255,255,255,0.04)] dark:border-[rgba(255,255,255,0.1)]"
          />
        ) : (
          <p className={`text-[13px] font-semibold truncate ${value ? 'text-text-primary' : 'text-text-tertiary italic'}`}>
            {value || (canEdit ? placeholder : '—')}
          </p>
        )}
      </div>
      {canEdit ? (
        editing ? (
          <div className="flex shrink-0 items-center gap-1">
            <button onClick={handleSave} disabled={saving} className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20 transition-colors disabled:opacity-50">
              <Check size={14} />
            </button>
            <button onClick={() => { setDraft(value); setEditing(false); }} disabled={saving} className="flex h-7 w-7 items-center justify-center rounded-lg bg-surface-tertiary text-text-tertiary hover:text-text-primary transition-colors dark:bg-[rgba(255,255,255,0.04)]">
              <X size={14} />
            </button>
          </div>
        ) : (
          <button
            onClick={() => { setDraft(value); setEditing(true); }}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-tertiary transition-colors dark:hover:bg-[rgba(255,255,255,0.06)]"
            title="Modifier"
          >
            <Pencil size={13} />
          </button>
        )
      ) : (
        <ChevronRight size={14} className="shrink-0 text-text-tertiary" />
      )}
    </div>
  );
}

/** Small horizontal date box — click to pick a single date or a period */
function DateRangeBox({ range, onChange }: {
  range: { from: string; to: string };
  onChange: (from: string, to: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draftFrom, setDraftFrom] = useState(range.from);
  const [draftTo, setDraftTo] = useState(range.from === range.to ? '' : range.to);

  function toggle() {
    if (!open) {
      setDraftFrom(range.from);
      setDraftTo(range.from === range.to ? '' : range.to);
    }
    setOpen(!open);
  }

  function apply() {
    const from = draftFrom || todayStr();
    let to = draftTo || from;
    if (to < from) to = from;
    onChange(from, to);
    setOpen(false);
  }

  function resetToday() {
    const t = todayStr();
    onChange(t, t);
    setOpen(false);
  }

  return (
    <div className="relative shrink-0">
      <button
        onClick={toggle}
        className="flex items-center gap-2 rounded-xl border border-outline bg-surface-elevated px-3.5 py-2 text-[12.5px] font-semibold text-text-primary transition-colors hover:bg-surface-secondary dark:bg-[#111519] dark:border-[rgba(255,255,255,0.06)] dark:hover:bg-[rgba(255,255,255,0.04)]"
      >
        <Calendar size={14} className="text-text-tertiary" />
        {range.from === range.to ? fmtShortDate(range.from) : `${fmtShortDate(range.from)} — ${fmtShortDate(range.to)}`}
      </button>

      {open && (
        <>
          {/* click-away backdrop */}
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-20 mt-2 w-64 rounded-2xl border border-outline bg-surface-elevated p-4 shadow-xl dark:bg-[#111519] dark:border-[rgba(255,255,255,0.08)]">
            <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-text-tertiary">Date</p>
            <input
              type="date"
              value={draftFrom}
              onChange={(e) => setDraftFrom(e.target.value)}
              className="mb-3 w-full rounded-lg border border-outline bg-surface px-2.5 py-1.5 text-[13px] font-medium text-text-primary outline-none focus:border-text-tertiary dark:bg-[rgba(255,255,255,0.04)] dark:border-[rgba(255,255,255,0.1)]"
            />
            <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-text-tertiary">Fin de période (optionnel)</p>
            <input
              type="date"
              value={draftTo}
              min={draftFrom || undefined}
              onChange={(e) => setDraftTo(e.target.value)}
              className="mb-4 w-full rounded-lg border border-outline bg-surface px-2.5 py-1.5 text-[13px] font-medium text-text-primary outline-none focus:border-text-tertiary dark:bg-[rgba(255,255,255,0.04)] dark:border-[rgba(255,255,255,0.1)]"
            />
            <div className="flex items-center justify-between gap-2">
              <button onClick={resetToday} className="rounded-lg px-3 py-1.5 text-[12px] font-semibold text-text-tertiary transition-colors hover:text-text-primary">
                Aujourd'hui
              </button>
              <button onClick={apply} className="rounded-lg bg-text-primary px-4 py-1.5 text-[12px] font-bold text-surface transition-opacity hover:opacity-90">
                Appliquer
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function KpiCard({ icon: Icon, label, value, sub }: { icon: React.ComponentType<{ size: number; className?: string }>; label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-outline bg-surface-elevated dark:bg-[#111519] dark:border-[rgba(255,255,255,0.06)] px-4 py-4">
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-tertiary dark:bg-[rgba(255,255,255,0.04)] mb-3">
        <Icon size={16} className="text-text-secondary" />
      </div>
      <p className="text-[22px] font-extrabold text-text-primary tracking-tight">{value}</p>
      <p className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-text-tertiary">{label}</p>
      {sub && <p className="mt-0.5 text-[10px] text-text-tertiary">{sub}</p>}
    </div>
  );
}
