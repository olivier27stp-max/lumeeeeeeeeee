import React, { useState, useEffect } from 'react';
import {
  User,
  Building2,
  Shield,
  Moon,
  CreditCard,
  Check,
  Loader2,
  Settings as SettingsIcon,
  Globe,
  Zap,
  Building,
  Users,
  Package,
  MapPin,
  Receipt,
  Wallet,
  Archive,
  FileText,
  Gift,
  MessageSquare,
} from 'lucide-react';
import { motion } from 'motion/react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Profile } from '../types';
import { cn } from '../lib/utils';
import MfaEnroll from '../components/auth/MfaEnroll';
import { useTranslation, Language } from '../i18n';
import LocationServices from '../components/LocationServices';
import ArchivesPanel from '../components/ArchivesPanel';
import { fetchPlans, fetchCurrentBilling, cancelSubscription, type Plan, type Subscription } from '../lib/billingApi';

// ─── All settings tabs (unified) ─────────────────────────────────
type SettingsTab =
  | 'account' | 'billing' | 'workspace' | 'language'
  | 'company' | 'products' | 'payments' | 'messaging' | 'taxes' | 'automations' | 'request-form'
  | 'team' | 'manage-team' | 'location'
  | 'archives' | 'referrals'
  | 'roles' | 'd2d-config';

interface NavItem {
  id: SettingsTab;
  label: string;
  icon: typeof User;
  link?: string; // if set, navigates to external route instead of inline tab
}

interface NavGroup {
  heading: string;
  items: NavItem[];
}

// ─── Placeholder panel for unbuilt sections ──────────────────────
function PlaceholderPanel({ title, description }: { title: string; description: string }) {
  return (
    <div className="glass-card rounded-2xl p-10 text-center">
      <SettingsIcon size={32} className="text-text-tertiary mx-auto mb-4 opacity-25" />
      <h3 className="text-xl font-bold text-text-primary">{title}</h3>
      <p className="text-[13px] text-text-tertiary mt-2 max-w-sm mx-auto leading-relaxed">{description}</p>
      <span className="badge-neutral text-[10px] mt-4 inline-block">Coming soon</span>
    </div>
  );
}

// ─── Workspace Tab (editable name + slug) ───────────────────────
function WorkspaceTab() {
  const { t, language } = useTranslation();
  const [wsName, setWsName] = useState('');
  const [wsSlug, setWsSlug] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [orgId, setOrgId] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }

      const { data: mem } = await supabase
        .from('memberships')
        .select('org_id')
        .eq('user_id', user.id)
        .limit(1)
        .maybeSingle();

      if (mem?.org_id) {
        setOrgId(mem.org_id);
        const { data: org } = await supabase
          .from('orgs')
          .select('name, slug')
          .eq('id', mem.org_id)
          .single();
        if (org) {
          setWsName(org.name || '');
          setWsSlug(org.slug || '');
        }
      }
      setLoading(false);
    }
    load();
  }, []);

  const slugify = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

  const handleNameChange = (val: string) => {
    setWsName(val);
    setWsSlug(slugify(val));
    setSaved(false);
  };

  const handleSave = async () => {
    if (!orgId || !wsName.trim()) return;
    setSaving(true);
    const { error } = await supabase
      .from('orgs')
      .update({ name: wsName.trim(), slug: wsSlug || slugify(wsName) })
      .eq('id', orgId);
    setSaving(false);
    if (!error) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  };

  if (loading) return <div className="flex justify-center py-12"><Loader2 size={18} className="animate-spin text-text-tertiary" /></div>;

  return (
    <div className="space-y-6">
      <div className="glass-card rounded-2xl p-6 space-y-5">
        <p className="text-xs font-medium text-text-tertiary">{t.settings.general}</p>
        <div className="space-y-4">
          <div>
            <label className="text-xs font-medium text-text-tertiary">{t.settings.workspaceName}</label>
            <input
              type="text"
              value={wsName}
              onChange={(e) => handleNameChange(e.target.value)}
              className="glass-input w-full mt-1.5"
              placeholder="My Company"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-text-tertiary">{t.settings.workspaceUrl}</label>
            <div className="flex items-center gap-2.5 mt-1.5">
              <span className="text-xs text-text-tertiary shrink-0">lume.crm/</span>
              <input
                type="text"
                value={wsSlug}
                onChange={(e) => { setWsSlug(slugify(e.target.value)); setSaved(false); }}
                className="glass-input flex-1"
                placeholder="my-company"
              />
            </div>
          </div>
        </div>
        <button
          onClick={handleSave}
          disabled={saving || !wsName.trim()}
          className={cn('glass-button-primary inline-flex items-center gap-2', saved && '!bg-success !text-white !border-success')}
        >
          {saving ? <Loader2 size={13} className="animate-spin" /> : saved ? <Check size={13} /> : null}
          {saving ? (t.billing.saving) : saved ? (t.companySettings.saved) : (t.customFields.save)}
        </button>
      </div>
      <div className="glass-card rounded-2xl p-6 space-y-5">
        <p className="text-xs font-medium text-text-tertiary">{t.settings.appearance}</p>
        <div className="flex items-center justify-between p-4 bg-surface-secondary rounded-xl hover:bg-surface-secondary/80 transition-colors">
          <div className="flex items-center gap-3.5">
            <Moon size={18} className="text-text-tertiary" />
            <div>
              <p className="text-[13px] font-semibold text-text-primary">{t.settings.darkMode}</p>
              <p className="text-xs text-text-tertiary">{t.settings.darkModeDesc}</p>
            </div>
          </div>
          <span className="badge-neutral text-[10px]">{t.common.comingSoon}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────
// ── MFA Section Component ──
function MfaSection() {
  const { t } = useTranslation();
  const [mfaEnabled, setMfaEnabled] = React.useState<boolean | null>(null);
  const [showEnroll, setShowEnroll] = React.useState(false);
  const [disabling, setDisabling] = React.useState(false);

  React.useEffect(() => {
    checkMfaStatus();
  }, []);

  const checkMfaStatus = async () => {
    try {
      const { data } = await supabase.auth.mfa.listFactors();
      const verified = data?.totp?.filter(f => f.status === 'verified') || [];
      setMfaEnabled(verified.length > 0);
    } catch {
      setMfaEnabled(false);
    }
  };

  const handleDisableMfa = async () => {
    if (!confirm('Are you sure you want to disable two-factor authentication? This will make your account less secure.')) return;
    setDisabling(true);
    try {
      const { data } = await supabase.auth.mfa.listFactors();
      const factors = data?.totp?.filter(f => f.status === 'verified') || [];
      for (const factor of factors) {
        await supabase.auth.mfa.unenroll({ factorId: factor.id });
      }
      setMfaEnabled(false);
    } catch (err: any) {
      alert(err.message || 'Failed to disable 2FA');
    } finally {
      setDisabling(false);
    }
  };

  if (showEnroll) {
    return (
      <div className="glass-card rounded-2xl p-6">
        <MfaEnroll
          onComplete={() => { setShowEnroll(false); setMfaEnabled(true); }}
          onCancel={() => setShowEnroll(false)}
        />
      </div>
    );
  }

  return (
    <div className="glass-card rounded-2xl p-6 space-y-5">
      <p className="text-xs font-medium text-text-tertiary">{t.settings.security}</p>
      <div className="flex items-center justify-between p-4 bg-surface-secondary rounded-xl hover:bg-surface-secondary/80 transition-colors">
        <div className="flex items-center gap-3.5">
          <Shield size={18} className={mfaEnabled ? 'text-green-600' : 'text-text-tertiary'} />
          <div>
            <p className="text-[13px] font-semibold text-text-primary">{t.settings.twoFactor}</p>
            <p className="text-xs text-text-tertiary">{t.settings.twoFactorDesc}</p>
          </div>
        </div>
        {mfaEnabled === null ? (
          <Loader2 size={14} className="animate-spin text-text-tertiary" />
        ) : mfaEnabled ? (
          <div className="flex items-center gap-2.5">
            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-green-700 bg-green-100 rounded-full px-3 py-1">
              <Check size={9} /> Active
            </span>
            <button
              onClick={handleDisableMfa}
              disabled={disabling}
              className="glass-button-ghost text-[10px] text-red-500 hover:text-red-700 font-medium"
            >
              {disabling ? 'Disabling...' : 'Disable'}
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowEnroll(true)}
            className="glass-button-secondary text-[11px] !py-2 !px-4"
          >
            Enable 2FA
          </button>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Billing Tab — connected to real Stripe/DB data
   ═══════════════════════════════════════════════════════════════ */
function BillingTab({ navigate, isFr, t }: { navigate: (path: string) => void; isFr: boolean; t: any }) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [canceling, setCanceling] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [plansData, billingData] = await Promise.all([
          fetchPlans().catch(() => []),
          fetchCurrentBilling().catch(() => ({ subscription: null, billing_profile: null })),
        ]);
        setPlans(plansData);
        setSubscription(billingData.subscription);
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Current plan info
  const currentPlan = subscription?.plans || plans.find((p) => p.id === subscription?.plan_id);
  const priceDisplay = subscription
    ? `$${(subscription.amount_cents / 100).toFixed(0)}`
    : null;

  // Progress bar calculation
  const now = Date.now();
  const periodStart = subscription?.current_period_start ? new Date(subscription.current_period_start).getTime() : 0;
  const periodEnd = subscription?.current_period_end ? new Date(subscription.current_period_end).getTime() : 0;
  const periodTotal = periodEnd - periodStart;
  const periodElapsed = now - periodStart;
  const progressPct = periodTotal > 0 ? Math.min(100, Math.max(0, Math.round((periodElapsed / periodTotal) * 100))) : 0;

  const daysLeft = periodEnd > now ? Math.ceil((periodEnd - now) / (1000 * 60 * 60 * 24)) : 0;
  const renewalDate = periodEnd > 0
    ? new Date(periodEnd).toLocaleDateString(isFr ? 'fr-CA' : 'en-CA', { month: 'long', day: 'numeric', year: 'numeric' })
    : null;

  const statusLabel = (s: string) => {
    if (s === 'active') return isFr ? 'Actif' : 'Active';
    if (s === 'past_due') return isFr ? 'En retard' : 'Past Due';
    if (s === 'canceled') return isFr ? 'Annulé' : 'Canceled';
    if (s === 'trialing') return isFr ? 'Essai' : 'Trial';
    return s;
  };
  const statusStyle = (s: string) => {
    if (s === 'active' || s === 'trialing') return 'bg-surface-card/20 text-white';
    if (s === 'past_due') return 'bg-warning/30 text-warning';
    return 'bg-surface-card/10 text-white/60';
  };

  const handleCancel = async () => {
    if (!confirm(isFr ? 'Annuler votre abonnement à la fin de la période ?' : 'Cancel subscription at end of period?')) return;
    setCanceling(true);
    try {
      await cancelSubscription();
      const fresh = await fetchCurrentBilling().catch(() => ({ subscription: null, billing_profile: null }));
      setSubscription(fresh.subscription);
    } catch { /* silent */ }
    finally { setCanceling(false); }
  };

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-44 bg-surface-tertiary rounded-2xl" />
        <div className="h-64 bg-surface-tertiary rounded-2xl" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="section-card p-8 text-center">
        <p className="text-sm text-danger">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Current Plan Card ── */}
      {subscription && subscription.status !== 'canceled' ? (
        <div className="glass-card rounded-2xl p-6 bg-primary overflow-hidden relative">
          <div className="relative z-10 space-y-5">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-white/60">{t.settings.currentPlan}</p>
                <p className="text-xl font-bold mt-1.5 text-white">
                  LUME {currentPlan?.name || 'Plan'}
                </p>
              </div>
              <span className={cn('inline-flex items-center gap-1.5 text-[10px] font-bold rounded-full px-3 py-1', statusStyle(subscription.status))}>
                <Check size={9} /> {statusLabel(subscription.status)}
              </span>
            </div>

            {/* Progress bar — real billing cycle */}
            {periodTotal > 0 && (
              <div>
                <div className="flex justify-between text-[10px] uppercase tracking-widest text-white/60 mb-1.5">
                  <span>{isFr ? 'Cycle de facturation' : 'Billing Cycle'}</span>
                  <span>{progressPct}%</span>
                </div>
                <div className="h-2 bg-surface-card/20 rounded-full overflow-hidden">
                  <div className="h-full bg-surface-card rounded-full transition-all duration-500" style={{ width: `${progressPct}%` }} />
                </div>
              </div>
            )}

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <p className="text-[11px] text-white/50">
                  {priceDisplay}/{subscription.interval === 'yearly' ? (isFr ? 'an' : 'yr') : (isFr ? 'mois' : 'mo')}
                  {renewalDate && (
                    <> &middot; {isFr ? 'Renouvellement le' : 'Renews'} {renewalDate}</>
                  )}
                </p>
                {daysLeft > 0 && (
                  <p className="text-[11px] text-white/40">
                    {daysLeft} {isFr ? 'jours restants' : 'days remaining'}
                  </p>
                )}
                {subscription.cancel_at_period_end && (
                  <p className="text-[11px] text-warning font-medium">
                    {isFr ? 'Annulation prévue à la fin de la période' : 'Cancels at end of period'}
                  </p>
                )}
              </div>
              {!subscription.cancel_at_period_end && (
                <button
                  onClick={handleCancel}
                  disabled={canceling}
                  className="text-[11px] text-white/40 hover:text-white/70 transition-colors underline"
                >
                  {isFr ? 'Annuler' : 'Cancel'}
                </button>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="section-card rounded-2xl p-6 text-center">
          <p className="text-sm text-text-secondary">
            {isFr ? 'Aucun plan actif' : 'No active plan'}
          </p>
          <p className="text-xs text-text-muted mt-1">
            {isFr ? 'Choisissez un plan ci-dessous pour commencer.' : 'Choose a plan below to get started.'}
          </p>
        </div>
      )}

      {/* ── Plans Grid ── */}
      <div className="glass-card rounded-2xl p-6 space-y-5">
        <p className="text-xs font-medium text-text-tertiary">{t.settings.subscriptionTiers}</p>
        <div className="space-y-3">
          {plans.map((plan) => {
            const isCurrent = subscription?.plan_id === plan.id && subscription?.status !== 'canceled';
            const price = plan.monthly_price_usd / 100;
            const features = Array.isArray(plan.features) ? plan.features.join(' · ') : '';

            return (
              <button
                key={plan.id}
                onClick={() => {
                  if (!isCurrent) navigate(`/checkout?plan=${plan.slug}&interval=monthly`);
                }}
                className={cn(
                  'w-full flex items-center justify-between p-4 rounded-2xl border transition-all text-left',
                  isCurrent
                    ? 'border-primary bg-primary/5'
                    : 'border-outline-subtle hover:border-outline hover:bg-surface-secondary/40 cursor-pointer',
                )}
              >
                <div className="flex items-center gap-3.5">
                  <div className={cn('w-3 h-3 rounded-full', isCurrent ? 'bg-primary' : 'bg-border')} />
                  <div>
                    <span className="text-[13px] font-semibold text-text-primary">
                      {isFr ? plan.name_fr : plan.name}
                    </span>
                    <p className="text-[11px] text-text-tertiary mt-0.5 line-clamp-1">{features}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[14px] font-bold text-text-primary tabular-nums">
                    ${price}
                    <span className="text-[10px] font-normal text-text-tertiary">/{isFr ? 'mois' : 'mo'}</span>
                  </span>
                  {isCurrent ? (
                    <span className="badge-info text-[10px]">{t.settings.current}</span>
                  ) : (
                    <span className="text-xs font-medium text-primary">{t.settings.choose || (isFr ? 'Choisir' : 'Choose')}</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function Settings() {
  const { t, language, setLanguage } = useTranslation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Read initial tab from URL ?tab=payments (for redirects from Payment Settings etc.)
  const urlTab = searchParams.get('tab') as SettingsTab | null;
  const [activeTab, setActiveTab] = useState<SettingsTab>(urlTab || 'account');

  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [fullName, setFullName] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const isFr = language === 'fr';

  // Sync tab with URL
  useEffect(() => {
    if (urlTab && urlTab !== activeTab) {
      setActiveTab(urlTab);
    }
  }, [urlTab]);

  const handleTabChange = (tab: SettingsTab) => {
    setActiveTab(tab);
    setSearchParams({ tab });
  };

  useEffect(() => {
    async function fetchProfile() {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setUserEmail(user.email || '');
        const { data } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', user.id)
          .single();
        setProfile(data);
        setFullName(data?.full_name || '');
      }
      setLoading(false);
    }
    fetchProfile();
  }, []);

  async function handleSaveProfile() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setSaving(true);
    setSaved(false);
    const { error } = await supabase
      .from('profiles')
      .update({ full_name: fullName.trim() })
      .eq('id', user.id);
    setSaving(false);
    if (!error) {
      setSaved(true);
      setProfile((prev) => prev ? { ...prev, full_name: fullName.trim() } : prev);
      setTimeout(() => setSaved(false), 2000);
    }
  }

  // ─── Navigation structure (3 sections, simplified) ───────────
  const navSections: NavGroup[] = [
    {
      heading: t.settings.general,
      items: [
        { id: 'account',   label: t.settings.account,   icon: User },
        { id: 'workspace', label: t.settings.workspace,  icon: Building2 },
        { id: 'company',   label: t.settings.companySettings, icon: Building, link: '/settings/company' },
        { id: 'language',  label: t.settings.language,   icon: Globe },
        { id: 'billing',   label: t.settings.billing,   icon: CreditCard },
      ],
    },
    {
      heading: isFr ? 'Activité' : 'Activity',
      items: [
        { id: 'products',     label: t.settings.productsServices, icon: Package, link: '/settings/products' },
        { id: 'taxes',        label: 'Taxes',                     icon: Receipt, link: '/settings/taxes' },
        { id: 'payments',     label: t.commandPalette.payments,   icon: Wallet, link: '/settings/payments' },
        { id: 'messaging',    label: isFr ? 'Messagerie SMS' : 'SMS Messaging', icon: MessageSquare, link: '/settings/messaging' },
        { id: 'request-form', label: (t.settings as any).requestForm || (t.requestForm.requestForm), icon: FileText, link: '/settings/request-form' },
        { id: 'automations',  label: t.settings.automations,      icon: Zap, link: '/automations' },
        { id: 'location',     label: t.settings.locationServices, icon: MapPin },
        { id: 'archives',     label: (t.settings as any).archives || 'Archives', icon: Archive },
      ],
    },
    {
      heading: t.settings.team,
      items: [
        { id: 'manage-team', label: isFr ? 'Membres' : 'Members',                icon: Users, link: '/settings/team' },
        { id: 'roles',       label: isFr ? 'Rôles & Permissions' : 'Roles & Permissions', icon: Shield, link: '/settings/roles' },
        { id: 'd2d-config',  label: isFr ? 'Config Vente' : 'Sales Config',      icon: MapPin, link: '/d2d-settings/general' },
        { id: 'referrals' as SettingsTab, label: t.referFriend.referAFriend,     icon: Gift, link: '/settings/referrals' },
      ],
    },
  ];

  // Items that navigate to a separate route
  const linkItems = new Set(navSections.flatMap((s) => s.items.filter((i) => i.link).map((i) => i.id)));

  // Plan labels kept for legacy — billing tab now uses real data

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="w-11 h-11 rounded-2xl bg-surface-secondary flex items-center justify-center">
          <SettingsIcon size={20} className="text-text-tertiary" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-text-primary tracking-tight">{t.settings.title}</h1>
          <p className="text-[12px] text-text-tertiary mt-0.5">{t.settings.subtitle}</p>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-8">
        {/* ── Sidebar ─────────────────────────────────── */}
        <div className="lg:w-60 flex flex-col gap-6 shrink-0">
          {navSections.map((section, sIdx) => (
            <div key={sIdx}>
              <p className="px-3 pb-2 text-xs font-medium text-text-tertiary">
                {section.heading}
              </p>
              <div className="space-y-0.5">
                {section.items.map((item) => {
                  const isActive = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => {
                        if (item.link) {
                          navigate(item.link);
                        } else {
                          handleTabChange(item.id);
                        }
                      }}
                      className={cn(
                        'w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-[13px] font-medium transition-all',
                        isActive
                          ? 'bg-surface-secondary text-text-primary font-semibold'
                          : 'text-text-secondary hover:bg-surface-secondary/50 hover:text-text-primary'
                      )}
                    >
                      <item.icon size={15} className={isActive ? 'text-primary' : 'text-text-tertiary'} />
                      <span className="truncate">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* ── Content Area ────────────────────────────── */}
        <div className="flex-1 max-w-2xl">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, x: 6 }}
            animate={{ opacity: 1, x: 0 }}
            className="space-y-6"
          >
            {/* ═══ ACCOUNT ═══ */}
            {activeTab === 'account' && (
              <div className="space-y-6">
                <div className="glass-card rounded-2xl p-6 space-y-6">
                  <div className="flex items-center gap-4">
                    <div className="avatar-md text-lg">
                      {profile?.full_name?.[0] || 'U'}
                    </div>
                    <div>
                      <h3 className="text-[13px] font-bold text-text-primary">{t.settings.profilePicture}</h3>
                      <p className="text-xs text-text-tertiary">{t.settings.updateAvatar}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <div>
                      <label className="text-xs font-medium text-text-tertiary">{t.settings.fullName}</label>
                      <input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} className="glass-input w-full mt-1.5" />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-text-tertiary">{t.settings.emailAddress}</label>
                      <input type="email" disabled value={userEmail} className="glass-input w-full mt-1.5 opacity-50" />
                    </div>
                  </div>
                  <button
                    onClick={handleSaveProfile}
                    disabled={saving || fullName.trim() === (profile?.full_name || '')}
                    className={cn('glass-button-primary inline-flex items-center gap-2', saved && '!bg-success !text-white !border-success')}
                  >
                    {saving ? <Loader2 size={13} className="animate-spin" /> : saved ? <Check size={13} /> : null}
                    {saving ? t.common.saving : saved ? t.common.saved : t.common.save}
                  </button>
                </div>
                <MfaSection />
              </div>
            )}

            {/* ═══ BILLING ═══ */}
            {activeTab === 'billing' && (
              <BillingTab navigate={navigate} isFr={isFr} t={t} />
            )}

            {/* ═══ WORKSPACE ═══ */}
            {activeTab === 'workspace' && (
              <WorkspaceTab />
            )}

            {/* ═══ LANGUAGE ═══ */}
            {activeTab === 'language' && (
              <div className="glass-card rounded-2xl p-6 space-y-5">
                <p className="text-xs font-medium text-text-tertiary">{t.settings.languageLabel}</p>
                <p className="text-[13px] text-text-secondary leading-relaxed">{t.settings.languageDesc}</p>
                <div className="space-y-3">
                  {([
                    { code: 'en' as Language, label: 'English', flag: '🇬🇧' },
                    { code: 'fr' as Language, label: 'Français', flag: '🇫🇷' },
                  ]).map((lang) => (
                    <button
                      key={lang.code}
                      onClick={() => setLanguage(lang.code)}
                      className={cn(
                        'w-full flex items-center justify-between p-4 rounded-2xl border transition-all text-left',
                        language === lang.code ? 'border-primary bg-primary/5' : 'border-outline-subtle hover:border-outline hover:bg-surface-secondary/40'
                      )}
                    >
                      <div className="flex items-center gap-3.5">
                        <span className="text-xl">{lang.flag}</span>
                        <span className="text-[13px] font-semibold text-text-primary">{lang.label}</span>
                      </div>
                      {language === lang.code && (
                        <span className="badge-info text-[10px]"><Check size={10} className="inline mr-0.5" />{t.settings.current}</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* ═══ PLACEHOLDER PANELS for unbuilt sections ═══ */}
            {activeTab === 'location' && (
              <LocationServices />
            )}
            {activeTab === 'archives' && (
              <ArchivesPanel />
            )}
          </motion.div>
        </div>
      </div>
    </div>
  );
}
