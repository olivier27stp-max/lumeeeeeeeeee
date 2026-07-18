import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Avatar } from '../components/d2d/avatar';
import {
  getRepPeriodStats,
  getRepPinCounts,
  getRepJobs,
  type RepPeriodStats,
  type RepPinCounts,
  type RepJob,
  type RepPinKind,
} from '../lib/repStatsApi';
import { getRepProfileInfo } from '../lib/leaderboardApi';
import { supabase } from '../lib/supabase';
import { PIN_STATUS_CONFIG } from '../components/map-d2d/lead-pin';
import { toast } from 'sonner';
import { useTranslation } from '../i18n';
import {
  Phone,
  Mail,
  Briefcase,
  Building2,
  Calendar,
  ChevronRight,
  ArrowLeft,
  Pencil,
  Check,
  X,
  DoorOpen,
  MessagesSquare,
  TrendingUp,
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

/** "Mercredi 16 juillet 2026" / "Wednesday, July 16, 2026" */
function fmtFullDate(d: string, isFr = true): string {
  return capitalize(
    new Date(`${d}T00:00:00`).toLocaleDateString(isFr ? 'fr-CA' : 'en-CA', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    })
  );
}

/** "16 juil. 2026" / "Jul 16, 2026" */
function fmtShortDate(d: string, isFr = true): string {
  return new Date(`${d}T00:00:00`).toLocaleDateString(isFr ? 'fr-CA' : 'en-CA', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

/** Display order of the seven sales-map pin types in the Pins card */
const PIN_KIND_ORDER: RepPinKind[] = [
  'closed_won', 'lead', 'appointment', 'follow_up', 'no_answer', 'rejected', 'other',
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
  const { language } = useTranslation();
  const isFr = language === 'fr';
  const paramId = id || memberId || '';

  const [profile, setProfile] = useState<ProfileData | null>(null);
  // Org (office) du rep — les stats sont scoppées dessus, pas sur l'org actif
  const [repOrgId, setRepOrgId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [repJobs, setRepJobs] = useState<RepJob[]>([]);
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
      // Résolu côté serveur : la RLS client bloque profiles/team_members pour
      // les reps d'un autre office de la compagnie (leaderboard scope 'all').
      const info = await getRepProfileInfo(userId);
      const dbProfile = info.profile;
      const dbMember = info.member;

      if (!dbProfile && !dbMember) {
        throw new Error('Profile not found');
      }

      // Office = the bureau (org) this rep is pinned to
      const office = info.office;

      // Build name from available sources
      const name = dbMember
        ? `${dbMember.first_name || ''} ${dbMember.last_name || ''}`.trim()
        : dbProfile?.full_name || (isFr ? 'Inconnu' : 'Unknown');

      // Hire date = when the account was created
      const hireSrc = dbMember?.created_at || info.accountCreatedAt;
      const hire_date = hireSrc
        ? capitalize(new Date(hireSrc).toLocaleDateString(isFr ? 'fr-CA' : 'en-CA', { day: 'numeric', month: 'long', year: 'numeric' }))
        : '';

      const result: ProfileData = {
        id: userId,
        name,
        role: dbMember?.role || (isFr ? 'Membre' : 'Member'),
        tagline: '',
        avatar_url: dbMember?.avatar_url || dbProfile?.avatar_url || null,
        banner_url: null,
        phone: dbMember?.phone || '',
        email: dbMember?.email || '',
        office,
        department: isFr ? 'Ventes' : 'Sales',
        hire_date,
        memberRowId: dbMember?.id || null,
      };

      // info.orgId = l'org (office) du rep — sert à scoper ses stats
      return { result, orgId: info.orgId };
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

        const { result: data, orgId } = await fetchFromApi(paramId);
        if (!cancelled) {
          setProfile(data);
          setRepOrgId(orgId);
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
  }, [paramId, isFr]);

  // Period data — stats, pins et jobs suivent tous la date/période sélectionnée
  useEffect(() => {
    if (!isUUID(paramId) || !repOrgId) return;
    let cancelled = false;
    (async () => {
      setStatsLoading(true);
      try {
        const [stats, jobs, pins] = await Promise.all([
          getRepPeriodStats(paramId, repOrgId, range.from, range.to).catch((err) => {
            console.error('[RepProfile] Period stats fetch failed:', err);
            return null;
          }),
          getRepJobs(paramId, repOrgId, range.from, range.to).catch(() => [] as RepJob[]),
          getRepPinCounts(paramId, repOrgId, range.from, range.to).catch(() => null),
        ]);
        if (!cancelled) {
          setPeriodStats(stats);
          setRepJobs(jobs);
          setPinCounts(pins);
        }
      } finally {
        if (!cancelled) setStatsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [paramId, repOrgId, range.from, range.to]);

  // Rep-editable contact info (email / phone) — saved on team_members
  async function saveContactField(field: 'email' | 'phone', value: string) {
    if (!profile?.memberRowId) {
      toast.error(isFr ? 'Profil équipe introuvable — impossible de sauvegarder.' : 'Team profile not found — unable to save.');
      throw new Error('No team_members row');
    }
    const { error } = await supabase
      .from('team_members')
      .update({ [field]: value, updated_at: new Date().toISOString() })
      .eq('id', profile.memberRowId);
    if (error) {
      toast.error(isFr ? 'Erreur de sauvegarde.' : 'Save error.');
      throw error;
    }
    setProfile((prev) => (prev ? { ...prev, [field]: value } : prev));
    toast.success(field === 'email' ? (isFr ? 'Email mis à jour' : 'Email updated') : (isFr ? 'Numéro mis à jour' : 'Number updated'));
  }

  // ── Not found ──
  if (!loading && !profile) {
    return (
      <div className="min-h-[calc(100vh-3rem)] bg-surface dark:bg-[#0B0F14] flex flex-col items-center justify-center">
        <p className="text-lg font-semibold text-text-primary">{isFr ? 'Profil introuvable' : 'Profile not found'}</p>
        <p className="mt-1 text-sm text-text-muted">{isFr ? "Ce représentant n'existe pas ou les données ne sont pas disponibles." : 'This rep does not exist or the data is not available.'}</p>
        <button onClick={() => navigate(-1)} className="mt-4 rounded-lg bg-text-primary px-4 py-2 text-sm font-semibold text-surface hover:opacity-90">
          {isFr ? 'Retour' : 'Back'}
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

          {/* Name row + Details card skeleton */}
          <div className="flex items-start justify-between gap-6 pt-16 pb-6">
            <div className="pl-1 space-y-2 shrink-0">
              <div className="h-8 w-48 rounded-lg animate-pulse bg-surface-tertiary dark:bg-[rgba(255,255,255,0.06)]" />
              <div className="h-4 w-32 rounded-lg animate-pulse bg-surface-tertiary dark:bg-[rgba(255,255,255,0.04)]" />
              <div className="h-3 w-40 rounded-lg animate-pulse bg-surface-tertiary dark:bg-[rgba(255,255,255,0.03)]" />
            </div>
            <div className="h-40 flex-1 rounded-2xl animate-pulse bg-surface-tertiary dark:bg-[rgba(255,255,255,0.04)]" />
          </div>
        </div>

        {/* Content grid skeleton */}
        <div className="mx-auto max-w-6xl px-8 pb-10">
          <div className="mb-5 h-10 rounded-xl animate-pulse bg-surface-tertiary dark:bg-[rgba(255,255,255,0.04)]" />
          <div className="grid grid-cols-12 gap-5">
            {/* Left column */}
            <div className="col-span-4 space-y-5">
              <div className="h-64 rounded-2xl animate-pulse bg-surface-tertiary dark:bg-[rgba(255,255,255,0.04)]" />
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
          {isFr ? 'Retour' : 'Back'}
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

        {/* Name row + Details card — Details étirée à l'horizontale, à droite de la pdp */}
        <div className="flex items-start justify-between gap-6 pt-16 pb-6">
          <div className="pl-1 shrink-0">
            <h1 className="text-[28px] font-extrabold text-text-primary tracking-tight">{p.name}</h1>
            <p className="mt-1 text-[14px] font-semibold text-text-secondary">{p.role}</p>
            {p.tagline && <p className="mt-1 text-[13px] text-text-tertiary italic">"{p.tagline}"</p>}
            {/* Actions — Message / Email / Day-replay removed (features not shipping). */}
            <div className="mt-3 flex items-center gap-2">
              <ActionBtn icon={Phone} href={p.phone ? `tel:${p.phone}` : undefined} />
            </div>
          </div>

          {/* Info card */}
          <div className="flex-1 min-w-0 rounded-2xl border border-outline bg-surface-elevated dark:bg-[#111519] dark:border-[rgba(255,255,255,0.06)] p-5">
            <h3 className="mb-4 text-[13px] font-bold text-text-primary">{isFr ? 'Détails' : 'Details'}</h3>
            <div className="grid grid-cols-3 gap-x-6 gap-y-4">
              <InfoRow icon={Building2} label={isFr ? 'Bureau' : 'Office'} value={p.office || '—'} />
              <InfoRow icon={Briefcase} label={isFr ? 'Département' : 'Department'} value={p.department} />
              <InfoRow icon={Calendar} label={isFr ? "Date d'embauche" : 'Hire Date'} value={p.hire_date || '—'} />
              <EditableInfoRow
                icon={Mail}
                label={isFr ? 'Courriel' : 'Email'}
                value={p.email}
                type="email"
                placeholder={isFr ? 'Ajouter un courriel' : 'Add an email'}
                canEdit={canEditContact}
                onSave={(v) => saveContactField('email', v)}
              />
              <EditableInfoRow
                icon={Phone}
                label={isFr ? 'Numéro de téléphone' : 'Phone Number'}
                value={p.phone}
                type="tel"
                placeholder={isFr ? 'Ajouter un numéro' : 'Add a number'}
                canEdit={canEditContact}
                onSave={(v) => saveContactField('phone', v)}
              />
            </div>
          </div>
        </div>
      </div>

      {/* ── Content ── */}
      <div className="mx-auto max-w-6xl px-8 pb-10">

        {/* Date / period selector — même boxe que le leaderboard, pleine largeur */}
        <PeriodBar range={range} onChange={(from, to) => setRange({ from, to })} />

        <div className="grid grid-cols-12 gap-5">

          {/* ============================================================= */}
          {/* LEFT COLUMN                                                    */}
          {/* ============================================================= */}
          <div className={`col-span-4 space-y-5 transition-opacity ${statsLoading ? 'opacity-50' : ''}`}>

            {/* Terrain — portes cognées / conversations / ventes, dérivé des pins de la période */}
            <CardPanel title={isFr ? 'Terrain' : 'Field'}>
              {/* Milieu plus large : « Conversations » est le libellé le plus long */}
              <div className="grid grid-cols-[1fr_1.4fr_1fr]">
                <TerrainCell icon={DoorOpen} value={pinCounts?.total ?? 0} label={isFr ? 'Portes' : 'Doors'} first />
                <TerrainCell icon={MessagesSquare} value={(pinCounts?.total ?? 0) - (pinCounts?.byKind.no_answer ?? 0)} label={isFr ? 'Conversations' : 'Conversations'} />
                <TerrainCell icon={TrendingUp} value={pinCounts?.byKind.closed_won ?? 0} label={isFr ? 'Ventes' : 'Sales'} />
              </div>
            </CardPanel>

            {/* Pins placed on the sales map during the period, one row per pin type */}
            <CardPanel title="Pins">
              <div className="space-y-3">
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
          <div className={`col-span-8 space-y-5 transition-opacity ${statsLoading ? 'opacity-50' : ''}`}>

            {/* KPI grid — the 8 period stats */}
            <div className="grid grid-cols-3 gap-3">
              <KpiCard label={isFr ? 'Revenu' : 'Revenue'} value={fmtCurrency(periodStats?.revenue ?? 0)} />
              <KpiCard label={isFr ? 'Jobs' : 'Jobs'} value={String(periodStats?.jobs ?? 0)} />
              <KpiCard label={isFr ? 'Revenu desservi' : 'Serviced Revenue'} value={fmtCurrency(periodStats?.servicedRevenue ?? 0)} />
              <KpiCard label={isFr ? 'Jobs desservies' : 'Serviced Jobs'} value={String(periodStats?.servicedJobs ?? 0)} />
              <KpiCard label={isFr ? 'Valeur moyenne du contrat' : 'Avg Contract Value'} value={periodStats?.avgContractValue != null ? fmtCurrency(periodStats.avgContractValue) : '—'} />
              <KpiCard label={isFr ? 'Taux de conclusion' : 'Closing Rate'} value={periodStats?.contractClosingRate != null ? `${periodStats.contractClosingRate}%` : '—'} />
              <KpiCard label={isFr ? "Taux d'annulation" : 'Cancel Rate'} value={periodStats?.cancelRate != null ? `${periodStats.cancelRate}%` : '—'} />
              <KpiCard label={isFr ? 'Jours travaillés' : 'Days Worked'} value={String(periodStats?.daysWorked ?? 0)} />
            </div>

            {/* ── Jobs — jobs créditées au rep durant la période ── */}
            <CardPanel title={`Jobs (${repJobs.length})`}>
              {repJobs.length === 0 ? (
                <p className="text-sm text-text-tertiary text-center py-6">{isFr ? 'Aucune job pour ce représentant dans cette période.' : 'No jobs for this rep in this period.'}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-outline">
                        <th className="px-2 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-text-tertiary">#</th>
                        <th className="px-2 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-text-tertiary">{isFr ? 'Titre' : 'Title'}</th>
                        <th className="px-2 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-text-tertiary">{isFr ? 'Statut' : 'Status'}</th>
                        <th className="px-2 py-2 text-right text-[10px] font-bold uppercase tracking-wider text-text-tertiary">{isFr ? 'Valeur' : 'Value'}</th>
                        <th className="px-2 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-text-tertiary">Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {repJobs.slice(0, 15).map((j) => (
                        <tr
                          key={j.id}
                          onClick={() => navigate(`/jobs/${j.id}`)}
                          className="border-b border-outline/50 last:border-0 cursor-pointer hover:bg-surface-secondary dark:hover:bg-[rgba(255,255,255,0.03)] transition-colors"
                        >
                          <td className="px-2 py-2 text-text-tertiary tabular-nums text-[12px]">{j.job_number || '—'}</td>
                          <td className="px-2 py-2 text-text-primary font-medium truncate max-w-[200px]">{j.title || '—'}</td>
                          <td className="px-2 py-2 text-text-secondary capitalize text-[12px]">{(j.status || '').replace(/_/g, ' ')}</td>
                          <td className="px-2 py-2 text-right tabular-nums text-text-primary">{fmtCurrency(Number(j.total_amount || 0))}</td>
                          <td className="px-2 py-2 text-text-tertiary text-[12px]">{new Date(j.created_at).toLocaleDateString('fr-CA')}</td>
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

/** Cellule de la boxe Terrain — icône filaire, chiffre extrabold, libellé uppercase */
function TerrainCell({ icon: Icon, value, label, first }: {
  icon: React.ComponentType<{ size: number; className?: string }>;
  value: number;
  label: string;
  first?: boolean;
}) {
  return (
    <div className={`flex min-w-0 flex-col gap-2 overflow-hidden py-0.5 pr-1 ${first ? 'pl-1' : 'border-l border-outline pl-4 dark:border-[rgba(255,255,255,0.08)]'}`}>
      <Icon size={17} className="shrink-0 text-text-primary" />
      <div className="min-w-0">
        <p className="text-[26px] font-extrabold leading-none tracking-tight tabular-nums text-text-primary">{value}</p>
        <p className="mt-1.5 truncate text-[9px] font-extrabold uppercase tracking-[0.1em] text-text-secondary">{label}</p>
      </div>
    </div>
  );
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
  const { language } = useTranslation();
  const isFr = language === 'fr';
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
            title={isFr ? 'Modifier' : 'Edit'}
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

/**
 * Barre de date/période pleine largeur — même boxe que le leaderboard :
 * icône + libellé à gauche, bouton « Changer » qui ouvre le picker Du/Au.
 */
function PeriodBar({ range, onChange }: {
  range: { from: string; to: string };
  onChange: (from: string, to: string) => void;
}) {
  const { language } = useTranslation();
  const isFr = language === 'fr';
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(range);

  const label = range.from === range.to
    ? fmtFullDate(range.from, isFr)
    : `${fmtShortDate(range.from, isFr)} – ${fmtShortDate(range.to, isFr)}`;

  return (
    <div className="relative mb-5">
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-border-subtle bg-white px-4 py-2.5 dark:bg-[#111519] dark:border-[rgba(255,255,255,0.06)]">
        <div className="flex min-w-0 items-center gap-2.5">
          <Calendar size={16} className="shrink-0 text-text-muted" />
          <p className="truncate text-sm font-semibold text-text-primary">{label}</p>
        </div>
        <button
          onClick={() => { setDraft(range); setOpen((o) => !o); }}
          className="shrink-0 rounded-lg border border-border-subtle bg-white px-3 py-1.5 text-xs font-semibold text-text-primary transition-colors hover:bg-surface-elevated dark:bg-[rgba(255,255,255,0.04)] dark:border-[rgba(255,255,255,0.08)] dark:hover:bg-[rgba(255,255,255,0.08)]"
        >
          {isFr ? 'Changer' : 'Change'}
        </button>
      </div>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-[calc(100%+8px)] z-20 w-72 rounded-2xl border border-border-subtle bg-white p-4 shadow-xl dark:bg-[#111519] dark:border-[rgba(255,255,255,0.08)]">
            <p className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
              {isFr ? 'Date ou période' : 'Date or period'}
            </p>
            <div className="space-y-2.5">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-text-secondary">{isFr ? 'Du' : 'From'}</span>
                <input
                  type="date"
                  value={draft.from}
                  max={todayStr()}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (!v) return;
                    setDraft((d) => ({ from: v, to: v > d.to ? v : d.to }));
                  }}
                  className="w-full rounded-lg border border-border-subtle bg-white px-3 py-1.5 text-sm text-text-primary outline-none dark:bg-[rgba(255,255,255,0.04)] dark:border-[rgba(255,255,255,0.1)]"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-text-secondary">{isFr ? 'Au' : 'To'}</span>
                <input
                  type="date"
                  value={draft.to}
                  min={draft.from}
                  max={todayStr()}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (!v) return;
                    setDraft((d) => ({ from: v < d.from ? v : d.from, to: v }));
                  }}
                  className="w-full rounded-lg border border-border-subtle bg-white px-3 py-1.5 text-sm text-text-primary outline-none dark:bg-[rgba(255,255,255,0.04)] dark:border-[rgba(255,255,255,0.1)]"
                />
              </label>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <button
                onClick={() => { const t = todayStr(); setDraft({ from: t, to: t }); }}
                className="flex-1 rounded-lg border border-border-subtle bg-white px-3 py-1.5 text-xs font-semibold text-text-primary transition-colors hover:bg-surface-elevated dark:bg-[rgba(255,255,255,0.04)] dark:border-[rgba(255,255,255,0.08)] dark:hover:bg-[rgba(255,255,255,0.08)]"
              >
                {isFr ? "Aujourd'hui" : 'Today'}
              </button>
              <button
                onClick={() => { onChange(draft.from, draft.to); setOpen(false); }}
                className="flex-1 rounded-lg bg-text-primary px-3 py-1.5 text-xs font-semibold text-surface transition-opacity hover:opacity-90"
              >
                {isFr ? 'Appliquer' : 'Apply'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function KpiCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-outline bg-surface-elevated dark:bg-[#111519] dark:border-[rgba(255,255,255,0.06)] px-4 py-4">
      <p className="mb-3 text-[15px] font-extrabold text-text-primary leading-tight">{label}</p>
      <p className="text-[22px] font-extrabold text-text-primary tracking-tight">{value}</p>
      {sub && <p className="mt-0.5 text-[10px] text-text-tertiary">{sub}</p>}
    </div>
  );
}
