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
  Route,
  Receipt,
  Wallet,
  Store,
  Archive,
  Phone,
  FileText,
  Gift,
} from 'lucide-react';
import { motion } from 'motion/react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Profile } from '../types';
import { cn } from '../lib/utils';
import { useTranslation, Language } from '../i18n';
import LocationServices from '../components/LocationServices';
import ArchivesPanel from '../components/ArchivesPanel';

// ─── All settings tabs (unified) ─────────────────────────────────
type SettingsTab =
  | 'account' | 'billing' | 'workspace' | 'language'
  | 'company' | 'products' | 'payments' | 'expense-tracking' | 'automations' | 'phone-number' | 'request-form'
  | 'team' | 'manage-team' | 'schedule' | 'location' | 'route-optimization'
  | 'marketplace' | 'archives' | 'referrals';

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
    <div className="section-card p-8 text-center">
      <SettingsIcon size={28} className="text-text-tertiary mx-auto mb-3 opacity-30" />
      <h3 className="text-[15px] font-semibold text-text-primary">{title}</h3>
      <p className="text-[13px] text-text-tertiary mt-1 max-w-sm mx-auto">{description}</p>
      <span className="badge-neutral text-[10px] mt-3 inline-block">Coming soon</span>
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
    <div className="space-y-5">
      <div className="section-card p-5 space-y-4">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">{t.settings.general}</h3>
        <div className="space-y-3">
          <div>
            <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">{t.settings.workspaceName}</label>
            <input
              type="text"
              value={wsName}
              onChange={(e) => handleNameChange(e.target.value)}
              className="glass-input w-full mt-1"
              placeholder="My Company"
            />
          </div>
          <div>
            <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">{t.settings.workspaceUrl}</label>
            <div className="flex items-center gap-2 mt-1">
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
          className={cn('glass-button inline-flex items-center gap-1.5', saved && '!bg-success !text-white !border-success')}
        >
          {saving ? <Loader2 size={13} className="animate-spin" /> : saved ? <Check size={13} /> : null}
          {saving ? (t.billing.saving) : saved ? (t.companySettings.saved) : (t.customFields.save)}
        </button>
      </div>
      <div className="section-card p-5 space-y-4">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">{t.settings.appearance}</h3>
        <div className="flex items-center justify-between p-3 bg-surface-secondary rounded-xl">
          <div className="flex items-center gap-3">
            <Moon size={16} className="text-text-tertiary" />
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

  // ─── Navigation structure ────────────────────────────────────
  const navSections: NavGroup[] = [
    {
      heading: t.settings.general,
      items: [
        { id: 'account',   label: t.settings.account,   icon: User },
        { id: 'billing',   label: t.settings.billing,   icon: CreditCard },
        { id: 'workspace', label: t.settings.workspace,  icon: Building2 },
        { id: 'language',  label: t.settings.language,   icon: Globe },
      ],
    },
    {
      heading: t.billing.business,
      items: [
        { id: 'company',          label: t.settings.companySettings, icon: Building, link: '/settings/company' },
        { id: 'products',         label: t.settings.productsServices, icon: Package, link: '/settings/products' },
        { id: 'payments',         label: t.commandPalette.payments,                        icon: Wallet, link: '/settings/payments' },
        { id: 'expense-tracking', label: t.settings.expenseTracking,    icon: Receipt },
        { id: 'automations',      label: t.settings.automations,            icon: Zap, link: '/settings/automations' },
        { id: 'phone-number',     label: t.settings.phoneNumber,      icon: Phone, link: '/settings/phone-number' },
        { id: 'request-form',     label: (t.settings as any).requestForm || (t.requestForm.requestForm), icon: FileText, link: '/settings/request-form' },
      ],
    },
    {
      heading: t.settings.team,
      items: [
        { id: 'team',               label: t.settings.organization,          icon: Users },
        { id: 'manage-team',        label: isFr ? 'Gérer l\'équipe' : 'Manage Team',       icon: Users, link: '/settings/team' },
        { id: 'schedule',           label: t.settings.schedule,                   icon: Users },
        { id: 'location',           label: t.settings.locationServices, icon: MapPin },
        { id: 'route-optimization', label: t.settings.routeOptimization, icon: Route },
      ],
    },
    {
      heading: t.settings.connectedApps,
      items: [
        { id: 'marketplace',    label: isFr ? 'Marketplace d\'apps' : 'App Marketplace', icon: Store, link: '/settings/marketplace' },
      ],
    },
    {
      heading: t.settings.data,
      items: [
        { id: 'archives', label: (t.settings as any).archives || 'Archives', icon: Archive },
      ],
    },
    {
      heading: t.settings.referral,
      items: [
        { id: 'referrals' as SettingsTab, label: t.referFriend.referAFriend, icon: Gift, link: '/settings/referrals' },
      ],
    },
  ];

  // Items that navigate to a separate route
  const linkItems = new Set(navSections.flatMap((s) => s.items.filter((i) => i.link).map((i) => i.id)));

  const planLabels: Record<string, string> = {
    Free: t.settings.free, Pro: t.settings.pro, Enterprise: t.settings.enterprise,
  };
  const planPrices: Record<string, string> = {
    Free: '$0', Pro: '$29', Enterprise: t.settings.custom,
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-surface-secondary flex items-center justify-center">
          <SettingsIcon size={18} className="text-text-tertiary" />
        </div>
        <div>
          <h1 className="text-[20px] font-bold text-text-primary tracking-tight">{t.settings.title}</h1>
          <p className="text-[12px] text-text-tertiary">{t.settings.subtitle}</p>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* ── Sidebar ─────────────────────────────────── */}
        <div className="lg:w-56 flex flex-col gap-5 shrink-0">
          {navSections.map((section, sIdx) => (
            <div key={sIdx}>
              <p className="px-3 pb-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-text-tertiary">
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
                        'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium transition-all',
                        isActive
                          ? 'bg-surface-secondary text-text-primary font-semibold'
                          : 'text-text-secondary hover:bg-surface-secondary/50 hover:text-text-primary'
                      )}
                    >
                      <item.icon size={14} className={isActive ? 'text-primary' : 'text-text-tertiary'} />
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
            className="space-y-5"
          >
            {/* ═══ ACCOUNT ═══ */}
            {activeTab === 'account' && (
              <div className="space-y-5">
                <div className="section-card p-5 space-y-5">
                  <div className="flex items-center gap-4">
                    <div className="avatar-md text-lg">
                      {profile?.full_name?.[0] || 'U'}
                    </div>
                    <div>
                      <h3 className="text-[13px] font-bold text-text-primary">{t.settings.profilePicture}</h3>
                      <p className="text-xs text-text-tertiary">{t.settings.updateAvatar}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">{t.settings.fullName}</label>
                      <input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} className="glass-input w-full mt-1" />
                    </div>
                    <div>
                      <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">{t.settings.emailAddress}</label>
                      <input type="email" disabled value={userEmail} className="glass-input w-full mt-1 opacity-50" />
                    </div>
                  </div>
                  <button
                    onClick={handleSaveProfile}
                    disabled={saving || fullName.trim() === (profile?.full_name || '')}
                    className={cn('glass-button inline-flex items-center gap-1.5', saved && '!bg-success !text-white !border-success')}
                  >
                    {saving ? <Loader2 size={13} className="animate-spin" /> : saved ? <Check size={13} /> : null}
                    {saving ? t.common.saving : saved ? t.common.saved : t.common.save}
                  </button>
                </div>
                <div className="section-card p-5 space-y-4">
                  <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">{t.settings.security}</h3>
                  <div className="flex items-center justify-between p-3 bg-surface-secondary rounded-xl">
                    <div className="flex items-center gap-3">
                      <Shield size={16} className="text-text-tertiary" />
                      <div>
                        <p className="text-[13px] font-semibold text-text-primary">{t.settings.twoFactor}</p>
                        <p className="text-xs text-text-tertiary">{t.settings.twoFactorDesc}</p>
                      </div>
                    </div>
                    <span className="badge-neutral text-[10px]">{t.common.comingSoon}</span>
                  </div>
                </div>
              </div>
            )}

            {/* ═══ BILLING ═══ */}
            {activeTab === 'billing' && (
              <div className="space-y-5">
                <div className="section-card p-5 bg-primary overflow-hidden relative">
                  <div className="relative z-10 space-y-4">
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="text-[11px] font-medium uppercase tracking-wider text-white/60">{t.settings.currentPlan}</p>
                        <p className="text-xl font-bold mt-1 text-white">LUME Pro</p>
                      </div>
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-white bg-white/20 rounded-full px-2.5 py-0.5">
                        <Check size={9} /> {t.common.active}
                      </span>
                    </div>
                    <div>
                      <div className="flex justify-between text-[10px] uppercase tracking-wider text-white/60 mb-1">
                        <span>{t.settings.usage}</span><span>85%</span>
                      </div>
                      <div className="h-1.5 bg-white/20 rounded-full overflow-hidden">
                        <div className="h-full bg-white w-[85%] rounded-full" />
                      </div>
                    </div>
                    <p className="text-[11px] text-white/50">$29 {t.settings.perMonth} &middot; {t.settings.nextBillingOnApril12026}</p>
                  </div>
                </div>
                <div className="section-card p-5 space-y-4">
                  <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">{t.settings.subscriptionTiers}</h3>
                  <div className="space-y-2">
                    {([
                      { key: 'Free', price: '$0', features: t.settings.threeClients10Jobsmo },
                      { key: 'Pro', price: '$29', features: t.settings.unlimitedIntegrationsPrioritySupport },
                      { key: 'Enterprise', price: t.settings.custom, features: t.settings.ssoApiDedicatedManager },
                    ]).map(({ key: plan, price, features }) => {
                      const isCurrent = plan === 'Pro';
                      return (
                        <button
                          key={plan}
                          onClick={() => {
                            if (!isCurrent) navigate(`/settings/billing/checkout?plan=${plan.toLowerCase()}&interval=monthly`);
                          }}
                          className={cn(
                            'w-full flex items-center justify-between p-3.5 rounded-xl border transition-all text-left',
                            isCurrent ? 'border-primary bg-primary/5' : 'border-outline-subtle hover:border-outline hover:bg-surface-secondary/40 cursor-pointer'
                          )}
                        >
                          <div className="flex items-center gap-3">
                            <div className={cn('w-2.5 h-2.5 rounded-full', isCurrent ? 'bg-primary' : 'bg-border')} />
                            <div>
                              <span className="text-[13px] font-semibold text-text-primary">{planLabels[plan]}</span>
                              <p className="text-[11px] text-text-tertiary mt-0.5">{features}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-[13px] font-bold text-text-primary tabular-nums">{price}<span className="text-[10px] font-normal text-text-tertiary">/{t.billing.mo}</span></span>
                            {isCurrent ? (
                              <span className="badge-info text-[10px]">{t.settings.current}</span>
                            ) : plan === 'Enterprise' ? (
                              <span className="badge-neutral text-[10px]">{t.settings.contact}</span>
                            ) : (
                              <span className="text-[11px] font-semibold text-primary">{t.settings.choose} &rarr;</span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* ═══ WORKSPACE ═══ */}
            {activeTab === 'workspace' && (
              <WorkspaceTab />
            )}

            {/* ═══ LANGUAGE ═══ */}
            {activeTab === 'language' && (
              <div className="section-card p-5 space-y-4">
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">{t.settings.languageLabel}</h3>
                <p className="text-[13px] text-text-secondary">{t.settings.languageDesc}</p>
                <div className="space-y-2">
                  {([
                    { code: 'en' as Language, label: 'English', flag: '🇬🇧' },
                    { code: 'fr' as Language, label: 'Français', flag: '🇫🇷' },
                  ]).map((lang) => (
                    <button
                      key={lang.code}
                      onClick={() => setLanguage(lang.code)}
                      className={cn(
                        'w-full flex items-center justify-between p-3.5 rounded-xl border transition-all text-left',
                        language === lang.code ? 'border-primary bg-primary/5' : 'border-outline-subtle hover:border-outline'
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-lg">{lang.flag}</span>
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
            {activeTab === 'expense-tracking' && (
              <PlaceholderPanel title="Expense Tracking" description="Track business expenses and categorize spending." />
            )}
            {activeTab === 'team' && (
              <PlaceholderPanel title="Organization" description="Manage your organization structure and departments." />
            )}
            {activeTab === 'schedule' && (
              <PlaceholderPanel title="Schedule Settings" description="Set default scheduling preferences and availability windows." />
            )}
            {activeTab === 'location' && (
              <LocationServices />
            )}
            {activeTab === 'route-optimization' && (
              <PlaceholderPanel title="Route Optimization" description="Optimize driving routes between job sites for your teams." />
            )}
            {activeTab === 'marketplace' && (
              <div className="section-card p-8 text-center">
                <Store size={28} className="text-text-tertiary mx-auto mb-3 opacity-30" />
                <h3 className="text-[15px] font-semibold text-text-primary">
                  {t.settings.noApplicationsConnectedYet}
                </h3>
                <p className="text-[13px] text-text-tertiary mt-1 max-w-sm mx-auto">
                  {isFr
                    ? 'Connectez des outils externes pour automatiser vos workflows et synchroniser vos données.'
                    : 'Connect external tools to automate workflows and sync your data.'}
                </p>
                <button
                  onClick={() => navigate('/settings/marketplace')}
                  className="glass-button-primary inline-flex items-center gap-1.5 mt-4 text-[12px]"
                >
                  <Store size={13} />
                  {t.settings.browseMarketplace}
                </button>
              </div>
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
