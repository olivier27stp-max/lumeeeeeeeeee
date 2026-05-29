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
  X,
  Sparkles,
  Calendar as CalendarIcon,
  LifeBuoy,
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
import SeatsBanner from '../components/SeatsBanner';
import SupportPanel from '../components/SupportPanel';
import { fetchPlans, fetchCurrentBilling, cancelSubscription, changePlan, openCustomerPortal, cancelScheduledChange, type Plan, type Subscription } from '../lib/billingApi';
import { toast } from 'sonner';
import { usePlatformOwner } from '../hooks/usePlatformOwner';

// ─── All settings tabs (unified) ─────────────────────────────────
type SettingsTab =
  | 'account' | 'billing' | 'workspace' | 'language'
  | 'company' | 'products' | 'payments' | 'reminders' | 'messaging' | 'taxes' | 'automations' | 'request-form'
  | 'checklists' | 'booking' | 'webhooks' | 'support'
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
            {(t.settings as any).enable2FA}
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

  const refresh = async () => {
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
    }
  };

  useEffect(() => {
    (async () => {
      setLoading(true);
      await refresh();
      setLoading(false);
    })();
  }, []);

  // Open Stripe Customer Portal (manage card, view invoices)
  const [openingPortal, setOpeningPortal] = useState(false);
  const handleOpenPortal = async () => {
    try {
      setOpeningPortal(true);
      const { url } = await openCustomerPortal();
      window.location.href = url;
    } catch (err: any) {
      toast.error(err.message || (isFr ? 'Impossible d\'ouvrir le portail' : 'Failed to open billing portal'));
      setOpeningPortal(false);
    }
  };

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
    if (s === 'active' || s === 'trialing') return 'bg-white/20 text-white';
    if (s === 'past_due') return 'bg-warning/30 text-warning';
    return 'bg-white/10 text-white/60';
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

  // Cancel a scheduled plan change (release Stripe Subscription Schedule)
  const [cancelingScheduled, setCancelingScheduled] = useState(false);
  const handleCancelScheduled = async () => {
    setCancelingScheduled(true);
    try {
      await cancelScheduledChange();
      toast.success(isFr ? 'Changement de plan annulé' : 'Scheduled change canceled');
      await refresh();
    } catch (err: any) {
      toast.error(err.message || (isFr ? 'Échec de l\'annulation' : 'Failed to cancel'));
    } finally {
      setCancelingScheduled(false);
    }
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
        <div className="glass-card rounded-2xl p-6 bg-gradient-to-br from-indigo-700 via-blue-700 to-blue-800 overflow-hidden relative">
          <div className="relative z-10 space-y-5">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-white/60">{t.settings.currentPlan}</p>
                <div className="flex items-center gap-2 mt-1.5">
                  <p className="text-xl font-bold text-white">
                    LUME {currentPlan?.name || 'Plan'}
                  </p>
                  <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-white/15 text-white/90">
                    {subscription.interval === 'yearly' ? (isFr ? 'Annuel' : 'Annual') : (isFr ? 'Mensuel' : 'Monthly')}
                  </span>
                </div>
              </div>
              <span className={cn('inline-flex items-center gap-1.5 text-[10px] font-bold rounded-full px-3 py-1', statusStyle(subscription.status))}>
                <Check size={9} /> {statusLabel(subscription.status)}
              </span>
            </div>

            {/* Progress bar — real billing cycle */}
            {periodTotal > 0 && (
              <div>
                <div className="flex justify-between text-[10px] uppercase tracking-widest text-white/60 mb-1.5">
                  <span>
                    {subscription.interval === 'yearly'
                      ? (isFr ? 'Cycle annuel' : 'Annual cycle')
                      : (isFr ? 'Cycle mensuel' : 'Monthly cycle')}
                  </span>
                  <span>{progressPct}%</span>
                </div>
                <div className="h-2 bg-surface-card/20 rounded-full overflow-hidden">
                  <div className="h-full bg-surface-card rounded-full transition-all duration-500" style={{ width: `${progressPct}%` }} />
                </div>
                <div className="flex justify-between text-[10px] text-white/40 mt-1.5">
                  <span>
                    {periodStart > 0 && new Date(periodStart).toLocaleDateString(isFr ? 'fr-CA' : 'en-CA', { month: 'short', day: 'numeric' })}
                  </span>
                  <span>
                    {periodEnd > 0 && new Date(periodEnd).toLocaleDateString(isFr ? 'fr-CA' : 'en-CA', { month: 'short', day: 'numeric' })}
                  </span>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <p className="text-[12px] text-white/70 font-medium">
                  {priceDisplay}<span className="text-white/50">/{subscription.interval === 'yearly' ? (isFr ? 'an' : 'yr') : (isFr ? 'mois' : 'mo')}</span>
                  {renewalDate && (
                    <span className="text-white/50"> &middot; {isFr ? 'Renouvellement le' : 'Renews'} {renewalDate}</span>
                  )}
                </p>
                {daysLeft > 0 && (
                  <p className="text-[11px] text-white/40">
                    {daysLeft} {isFr ? 'jours restants dans ce cycle' : 'days left in this cycle'}
                  </p>
                )}
                {subscription.interval === 'monthly' && currentPlan && (
                  <p className="text-[11px] text-emerald-300 font-medium">
                    {isFr
                      ? `Économisez 15% en passant à l'annuel ($${Math.round(currentPlan.monthly_price_usd / 100 * 0.85)}/mois)`
                      : `Save 15% by switching to annual ($${Math.round(currentPlan.monthly_price_usd / 100 * 0.85)}/mo)`}
                  </p>
                )}
                {subscription.cancel_at_period_end && (
                  <p className="text-[11px] text-warning font-medium">
                    {isFr ? 'Annulation prévue à la fin de la période' : 'Cancels at end of period'}
                  </p>
                )}
                {subscription.scheduled_plan_id && subscription.scheduled_at && (() => {
                  const scheduledPlanName = plans.find((p) => p.id === subscription.scheduled_plan_id)?.name;
                  const dateStr = new Date(subscription.scheduled_at).toLocaleDateString(isFr ? 'fr-CA' : 'en-CA', {
                    day: 'numeric', month: 'long', year: 'numeric',
                  });
                  return (
                    <div className="mt-1.5 inline-flex items-center gap-2 text-[11px] text-amber-100 bg-amber-500/20 border border-amber-300/30 rounded-lg px-2.5 py-1.5">
                      <CalendarIcon size={11} />
                      <span>
                        {isFr
                          ? `Passage à ${scheduledPlanName || 'un autre plan'} le ${dateStr}`
                          : `Switching to ${scheduledPlanName || 'another plan'} on ${dateStr}`}
                      </span>
                      <button
                        type="button"
                        onClick={handleCancelScheduled}
                        disabled={cancelingScheduled}
                        className="ml-1 underline hover:text-white font-semibold disabled:opacity-50"
                      >
                        {cancelingScheduled
                          ? (isFr ? '...' : '...')
                          : (isFr ? 'Annuler' : 'Cancel')}
                      </button>
                    </div>
                  );
                })()}
              </div>
              <button
                onClick={handleOpenPortal}
                disabled={openingPortal}
                className="text-[11px] text-white/80 hover:text-white font-semibold px-3 py-1.5 rounded-md bg-white/10 hover:bg-white/15 transition-colors whitespace-nowrap"
                title={isFr ? 'Carte de crédit, factures, reçus, annulation' : 'Card, invoices, receipts, cancellation'}
              >
                {openingPortal
                  ? (isFr ? 'Ouverture...' : 'Opening...')
                  : (isFr ? 'Carte & factures' : 'Card & invoices')}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl p-6 text-center bg-gradient-to-br from-amber-500/5 via-surface-card to-transparent border border-amber-500/20">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-amber-500/10 mb-3">
            <CreditCard size={20} className="text-amber-600" />
          </div>
          <h3 className="text-base font-bold text-text-primary">
            {isFr ? 'Aucun abonnement actif' : 'No active subscription'}
          </h3>
          <p className="text-sm text-text-secondary mt-1.5 max-w-md mx-auto">
            {isFr
              ? 'Sélectionnez un plan ci-dessous pour réactiver votre accès complet.'
              : 'Select a plan below to restore full access.'}
          </p>
        </div>
      )}

      {/* ── Seats usage banner ── */}
      {subscription && subscription.status !== 'canceled' && (
        <SeatsBanner onChange={refresh} />
      )}

      {/* ── Plans Grid — Premium cards ── */}
      <PlansGrid
        plans={plans}
        currentPlan={currentPlan ?? null}
        subscription={subscription}
        isFr={isFr}
        navigate={navigate}
        onRefresh={refresh}
      />
    </div>
  );
}

// ── Plans Grid component ───────────────────────────────────────────
function PlansGrid({
  plans,
  currentPlan,
  subscription,
  isFr,
  navigate,
  onRefresh,
}: {
  plans: Plan[];
  currentPlan: Plan | null;
  subscription: Subscription | null;
  isFr: boolean;
  navigate: (path: string) => void;
  onRefresh: () => Promise<void> | void;
}) {
  const [showAll, setShowAll] = useState(false);
  const [downgradeTarget, setDowngradeTarget] = useState<Plan | null>(null);
  const [busySlug, setBusySlug] = useState<string | null>(null);

  // Change plan via Stripe — upgrade applies immediately with proration,
  // downgrade is scheduled for end-of-period (user keeps current plan until then).
  const handleChangePlan = async (plan: Plan, interval: 'monthly' | 'yearly') => {
    try {
      setBusySlug(plan.slug);
      const result: any = await changePlan({ plan_slug: plan.slug, interval });
      if (result.no_change) {
        toast.success(isFr ? 'Aucun changement nécessaire' : 'No change needed');
      } else if (result.scheduled && result.effective_date) {
        const dateStr = new Date(result.effective_date).toLocaleDateString(isFr ? 'fr-CA' : 'en-CA', {
          year: 'numeric', month: 'long', day: 'numeric',
        });
        toast.success(
          isFr
            ? `Plan programmé : passage à ${plan.name} le ${dateStr}`
            : `Scheduled: switching to ${plan.name} on ${dateStr}`,
          { duration: 6000 },
        );
      } else if (result.upgraded) {
        toast.success(
          isFr
            ? `Plan mis à niveau vers ${plan.name} — proration appliquée`
            : `Upgraded to ${plan.name} — proration applied`,
          { duration: 5000 },
        );
      } else {
        toast.success(isFr ? 'Plan mis à jour' : 'Plan updated');
      }
      await onRefresh();
    } catch (err: any) {
      toast.error(err.message || (isFr ? 'Échec du changement de plan' : 'Failed to change plan'));
    } finally {
      setBusySlug(null);
    }
  };

  const hasActiveSub = !!(subscription && subscription.status !== 'canceled' && currentPlan);
  const currentOrder = currentPlan?.sort_order ?? 0;

  const sectionLabel = hasActiveSub
    ? (isFr ? 'Mettre à niveau' : 'Upgrade')
    : (isFr ? 'Choisir un plan' : 'Choose a plan');
  const sectionTitle = hasActiveSub
    ? (isFr ? 'Boostez votre équipe avec un plan supérieur' : 'Boost your team with a higher plan')
    : (isFr ? 'Sélectionnez le plan qui vous convient' : 'Select the plan that fits you');

  // Sort once
  const sortedPlans = [...plans].sort((a, b) => a.sort_order - b.sort_order);

  // Filter: when active sub, default to current + upgrades only (no downgrades)
  const visiblePlans = hasActiveSub && !showAll
    ? sortedPlans.filter((p) => p.sort_order >= currentOrder)
    : sortedPlans;

  const hasDowngrades = hasActiveSub && sortedPlans.some((p) => p.sort_order < currentOrder);

  if (plans.length === 0) {
    return (
      <div className="section-card rounded-2xl p-8 text-center">
        <Loader2 className="animate-spin mx-auto text-text-tertiary" size={20} />
        <p className="text-xs text-text-tertiary mt-3">{isFr ? 'Chargement des plans...' : 'Loading plans...'}</p>
      </div>
    );
  }

  // If the user is already on the highest plan and we're not showing all
  if (hasActiveSub && visiblePlans.length === 1 && !showAll) {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl p-6 text-center bg-gradient-to-br from-emerald-500/5 via-surface-card to-transparent border border-emerald-500/20">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-emerald-500/10 mb-3">
            <Check size={20} className="text-emerald-600" />
          </div>
          <h3 className="text-base font-bold text-text-primary">
            {isFr ? 'Vous avez le meilleur plan' : 'You\'re on the top plan'}
          </h3>
          <p className="text-sm text-text-secondary mt-1.5 max-w-md mx-auto">
            {isFr
              ? `Vous profitez de toutes les fonctionnalités de Lume ${currentPlan?.name}.`
              : `You're enjoying every feature of Lume ${currentPlan?.name}.`}
          </p>
          {hasDowngrades && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="inline-flex items-center gap-2 mt-4 px-4 py-2 rounded-lg border border-outline-subtle hover:border-outline bg-surface-card hover:bg-surface-secondary text-text-primary text-xs font-semibold transition-colors"
            >
              {isFr ? 'Changer ou rétrograder mon plan' : 'Change or downgrade my plan'}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-text-tertiary uppercase tracking-wider">{sectionLabel}</p>
          <h3 className="text-lg font-bold text-text-primary mt-1">{sectionTitle}</h3>
        </div>
        {hasDowngrades && (
          <button
            type="button"
            onClick={() => setShowAll(!showAll)}
            className="text-xs font-medium text-text-tertiary hover:text-text-primary underline whitespace-nowrap"
          >
            {showAll
              ? (isFr ? 'Masquer les plans inférieurs' : 'Hide lower plans')
              : (isFr ? 'Voir tous les plans' : 'View all plans')}
          </button>
        )}
      </div>

      {/* Padding-top reserves vertical space for the floating "Most Popular" badge */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-5">
        {visiblePlans.map((plan) => {
          const isCurrent = subscription?.plan_id === plan.id && subscription?.status !== 'canceled';
          const isFeatured = plan.slug === 'pro';
          const isUpgrade = hasActiveSub && plan.sort_order > currentOrder;
          const isDowngrade = hasActiveSub && plan.sort_order < currentOrder;
          const price = plan.monthly_price_usd / 100;
          const features: string[] = Array.isArray(plan.features) ? plan.features : [];
          const seatsInfo = plan.seats_included
            ? `${plan.seats_included} ${isFr ? 'utilisateurs inclus' : 'users included'}`
            : null;
          const extraSeat = plan.extra_seat_price_usd
            ? `+$${plan.extra_seat_price_usd / 100}/${isFr ? 'utilisateur supplémentaire' : 'extra user'}`
            : null;

          let ctaLabel: string;
          if (isCurrent) ctaLabel = isFr ? 'Plan actuel' : 'Current plan';
          else if (isUpgrade) ctaLabel = isFr ? `Passer à ${plan.name}` : `Upgrade to ${plan.name}`;
          else if (isDowngrade) ctaLabel = isFr ? `Rétrograder vers ${plan.name}` : `Downgrade to ${plan.name}`;
          else ctaLabel = isFr ? 'Choisir ce plan' : 'Choose this plan';

          return (
            <div
              key={plan.id}
              className={cn(
                'relative rounded-2xl border p-6 flex flex-col transition-all',
                isCurrent
                  ? 'bg-emerald-500/5 border-emerald-500/40 shadow-md'
                  : isFeatured
                    ? 'bg-gradient-to-b from-primary/10 to-transparent border-primary/40 shadow-lg shadow-primary/10'
                    : 'bg-surface-card border-outline-subtle hover:border-outline',
              )}
            >
              {/* Top badge row — reserved space prevents layout shift */}
              <div className="absolute -top-3 left-0 right-0 flex justify-center pointer-events-none">
                {isCurrent ? (
                  <span className="bg-emerald-500 text-white text-[10px] font-bold uppercase tracking-wider px-3 py-1 rounded-full shadow-md">
                    {isFr ? 'Plan actuel' : 'Current plan'}
                  </span>
                ) : isFeatured ? (
                  <span className="bg-primary text-white text-[10px] font-bold uppercase tracking-wider px-3 py-1 rounded-full shadow-md">
                    {isFr ? 'Le plus populaire' : 'Most Popular'}
                  </span>
                ) : null}
              </div>

              {/* Plan name */}
              <h4 className="text-xl font-extrabold text-text-primary">
                {isFr ? plan.name_fr : plan.name}
              </h4>

              {/* Seats */}
              {seatsInfo && (
                <p className="text-[11px] uppercase tracking-wider font-semibold text-text-tertiary mt-1">
                  {seatsInfo}
                </p>
              )}

              {/* Price */}
              <div className="mt-4 mb-1">
                <span className="text-4xl font-extrabold tabular-nums text-text-primary">${price}</span>
                <span className="text-sm font-normal text-text-tertiary ml-1">/{isFr ? 'mois' : 'mo'}</span>
              </div>
              {extraSeat && <p className="text-[11px] text-text-tertiary mb-4">{extraSeat}</p>}

              {/* Divider */}
              <div className="border-t border-outline-subtle my-4" />

              {/* Features list */}
              <ul className="space-y-2.5 flex-1 mb-6">
                {features.map((feat, fi) => (
                  <li key={fi} className="flex items-start gap-2 text-[13px] text-text-secondary leading-snug">
                    <Check size={14} className={cn('mt-0.5 shrink-0', isCurrent ? 'text-emerald-500' : isFeatured ? 'text-primary' : 'text-emerald-500')} />
                    <span>{feat}</span>
                  </li>
                ))}
              </ul>

              {/* CTA */}
              <button
                type="button"
                disabled={isCurrent || busySlug === plan.slug}
                onClick={() => {
                  if (isCurrent) return;
                  if (isDowngrade) {
                    setDowngradeTarget(plan);
                    return;
                  }
                  // Existing sub → use Stripe change-plan with proration
                  if (hasActiveSub) {
                    handleChangePlan(plan, subscription?.interval ?? 'monthly');
                    return;
                  }
                  // No sub → onboarding/checkout flow
                  navigate(`/checkout?plan=${plan.slug}&interval=monthly`);
                }}
                className={cn(
                  'w-full py-3 rounded-xl text-sm font-bold transition-all',
                  isCurrent
                    ? 'bg-emerald-500/10 text-emerald-700 cursor-not-allowed'
                    : busySlug === plan.slug
                      ? 'bg-surface-secondary text-text-tertiary cursor-wait'
                      : isDowngrade
                        ? 'bg-surface-secondary text-text-secondary hover:bg-surface-tertiary border border-outline-subtle'
                        : isFeatured
                          ? 'bg-primary text-white hover:bg-primary/90 shadow-md hover:shadow-lg'
                          : 'bg-text-primary text-surface hover:bg-text-primary/90',
                )}
              >
                {busySlug === plan.slug
                  ? (isFr ? 'Mise à jour...' : 'Updating...')
                  : ctaLabel}
              </button>
            </div>
          );
        })}
      </div>

      {/* Downgrade retention modal */}
      {downgradeTarget && currentPlan && (
        <DowngradeModal
          fromPlan={currentPlan}
          toPlan={downgradeTarget}
          interval={subscription?.interval ?? 'monthly'}
          periodEnd={subscription?.current_period_end ?? null}
          isFr={isFr}
          busy={busySlug === downgradeTarget.slug}
          onClose={() => setDowngradeTarget(null)}
          onConfirm={async () => {
            const target = downgradeTarget;
            await handleChangePlan(target, subscription?.interval ?? 'monthly');
            setDowngradeTarget(null);
          }}
          onSwitchToAnnual={async () => {
            await handleChangePlan(currentPlan, 'yearly');
            setDowngradeTarget(null);
          }}
        />
      )}
    </div>
  );
}

// ── Downgrade retention modal ──────────────────────────────────────
function DowngradeModal({
  fromPlan,
  toPlan,
  interval,
  periodEnd,
  isFr,
  busy,
  onClose,
  onConfirm,
  onSwitchToAnnual,
}: {
  fromPlan: Plan;
  toPlan: Plan;
  interval: 'monthly' | 'yearly';
  periodEnd: string | null;
  isFr: boolean;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
  onSwitchToAnnual: () => void;
}) {
  // Compute features that will be lost (in fromPlan but not in toPlan)
  const fromFeatures: string[] = Array.isArray(fromPlan.features) ? fromPlan.features : [];
  const toFeatures: string[] = Array.isArray(toPlan.features) ? toPlan.features : [];
  const toSet = new Set(toFeatures.map((f) => f.toLowerCase().trim()));
  const lostFeatures = fromFeatures.filter((f) => {
    const lower = f.toLowerCase().trim();
    if (lower.startsWith('everything in')) return false;
    return !toSet.has(lower);
  });

  // Module flags lost with icon hints
  type LostItem = { label: string; key: string };
  const lostFlags: LostItem[] = [];
  if (fromPlan.includes_sms && !toPlan.includes_sms) lostFlags.push({ label: isFr ? 'SMS bidirectionnel avec clients' : 'Two-way SMS with customers', key: 'sms' });
  if (fromPlan.includes_ai && !toPlan.includes_ai) lostFlags.push({ label: isFr ? 'Lume Agent IA (voix + illimité)' : 'Lume AI Agent (voice + unlimited)', key: 'ai' });
  if (fromPlan.includes_d2d && !toPlan.includes_d2d) lostFlags.push({ label: isFr ? 'Suite porte-à-porte complète' : 'Full door-to-door suite', key: 'd2d' });
  if (fromPlan.includes_courses && !toPlan.includes_courses) lostFlags.push({ label: isFr ? 'Formations / LMS interne' : 'Courses / LMS for team', key: 'lms' });
  if (fromPlan.includes_api && !toPlan.includes_api) lostFlags.push({ label: isFr ? 'Accès API + webhooks' : 'API + webhooks access', key: 'api' });

  // Seats lost
  const seatsLost = (fromPlan.seats_included ?? 0) - (toPlan.seats_included ?? 0);

  // Prices
  const fromPrice = interval === 'yearly' ? Math.round(fromPlan.monthly_price_usd * 0.85 / 100) : fromPlan.monthly_price_usd / 100;
  const toPrice = interval === 'yearly' ? Math.round(toPlan.monthly_price_usd * 0.85 / 100) : toPlan.monthly_price_usd / 100;
  const monthlySavings = fromPrice - toPrice;

  // Yearly retention offer (only if currently monthly)
  const yearlyDiscount = Math.round(fromPlan.monthly_price_usd / 100 * 0.85);
  const yearlyAnnualSavings = (fromPlan.monthly_price_usd / 100 - yearlyDiscount) * 12;

  // Effective date (end of current period)
  const effectiveDate = periodEnd
    ? new Date(periodEnd).toLocaleDateString(isFr ? 'fr-CA' : 'en-CA', { day: 'numeric', month: 'long', year: 'numeric' })
    : null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto"
      onClick={busy ? undefined : onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-surface-card rounded-3xl shadow-2xl max-w-2xl w-full my-8 overflow-hidden border border-outline-subtle"
      >
        {/* ── Hero gradient header with abstract SVG illustration ── */}
        <div className="relative px-8 pt-10 pb-8 bg-gradient-to-br from-indigo-600 via-blue-600 to-purple-600 overflow-hidden">
          {/* Abstract decorative blobs */}
          <div className="absolute inset-0 opacity-20" aria-hidden="true">
            <svg className="absolute -top-10 -right-10 w-64 h-64" viewBox="0 0 200 200" fill="none">
              <path fill="white" d="M37.6,-50.7C49.4,-44.4,60.1,-34.9,65.4,-22.5C70.7,-10.1,70.6,5.3,65.4,18.9C60.2,32.5,49.9,44.4,37.4,53.1C24.9,61.9,10.3,67.6,-4.2,73.1C-18.7,78.7,-37.5,84.2,-49.7,77.3C-61.9,70.4,-67.5,51.2,-71.7,33.4C-76,15.7,-78.9,-0.6,-74.4,-14.6C-69.9,-28.7,-58,-40.5,-44.7,-46.6C-31.5,-52.6,-15.7,-52.9,-1.7,-50.5C12.3,-48.2,25.9,-57,37.6,-50.7Z" transform="translate(100 100)" />
            </svg>
            <svg className="absolute -bottom-16 -left-16 w-80 h-80" viewBox="0 0 200 200" fill="none">
              <path fill="white" d="M44.7,-71.8C58.7,-65.1,71.1,-54,77.4,-40.3C83.7,-26.7,84,-10.4,80.7,4.6C77.4,19.7,70.5,33.6,60.8,44.7C51.1,55.9,38.6,64.3,24.6,69.4C10.6,74.6,-4.9,76.5,-19.2,73.1C-33.6,69.7,-46.7,61,-57.4,49.4C-68.1,37.7,-76.4,23.1,-78,7.5C-79.6,-8.2,-74.6,-24.9,-66,-39.1C-57.4,-53.3,-45.4,-65.1,-31.8,-71.6C-18.3,-78.2,-3.2,-79.5,11.4,-77.6C26,-75.7,38.7,-78.4,44.7,-71.8Z" transform="translate(100 100)" />
            </svg>
          </div>

          <div className="relative flex items-start justify-between gap-6">
            <div className="flex-1 text-white">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/70 mb-2">
                {isFr ? 'Changement de plan' : 'Plan change'}
              </p>
              <h2 className="text-2xl md:text-3xl font-extrabold tracking-tight">
                {isFr ? `Avant de rétrograder vers ${toPlan.name}…` : `Before downgrading to ${toPlan.name}…`}
              </h2>
              <p className="text-[13px] text-white/80 mt-2 max-w-md">
                {isFr
                  ? `Voici ce que vous perdrez en passant de ${fromPlan.name} à ${toPlan.name}.`
                  : `Here's what you'll lose moving from ${fromPlan.name} to ${toPlan.name}.`}
              </p>
            </div>

            {/* Plan transition visual */}
            <div className="hidden sm:flex flex-col items-end gap-1 shrink-0">
              <div className="flex items-center gap-2 text-white">
                <div className="text-right">
                  <p className="text-[9px] uppercase font-bold tracking-wider text-white/60">{isFr ? 'De' : 'From'}</p>
                  <p className="text-sm font-extrabold">{fromPlan.name}</p>
                  <p className="text-[10px] text-white/70 tabular-nums">${fromPrice}/{interval === 'yearly' ? (isFr ? 'mois' : 'mo') : (isFr ? 'mois' : 'mo')}</p>
                </div>
                <div className="text-white/40 text-xl">→</div>
                <div>
                  <p className="text-[9px] uppercase font-bold tracking-wider text-white/60">{isFr ? 'Vers' : 'To'}</p>
                  <p className="text-sm font-extrabold">{toPlan.name}</p>
                  <p className="text-[10px] text-white/70 tabular-nums">${toPrice}/{interval === 'yearly' ? (isFr ? 'mois' : 'mo') : (isFr ? 'mois' : 'mo')}</p>
                </div>
              </div>
              {monthlySavings > 0 && (
                <p className="text-[10px] text-emerald-300 font-bold">
                  {isFr ? `Économies : $${monthlySavings}/mois` : `Savings: $${monthlySavings}/mo`}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* ── Effective date callout ── */}
        {effectiveDate && (
          <div className="px-8 py-4 bg-blue-500/5 border-b border-blue-500/20 flex items-start gap-3">
            <div className="shrink-0 w-8 h-8 rounded-full bg-blue-500/15 flex items-center justify-center mt-0.5">
              <CalendarIcon size={15} className="text-blue-600" />
            </div>
            <div className="flex-1">
              <p className="text-[13px] font-semibold text-text-primary">
                {isFr
                  ? `Vous gardez ${fromPlan.name} jusqu'au ${effectiveDate}`
                  : `You'll keep ${fromPlan.name} until ${effectiveDate}`}
              </p>
              <p className="text-[12px] text-text-secondary mt-0.5">
                {isFr
                  ? `Le changement prendra effet automatiquement à la fin de votre période de facturation. Aucun remboursement n'est nécessaire.`
                  : `The change takes effect automatically at the end of your billing cycle. No refund needed.`}
              </p>
            </div>
          </div>
        )}

        {/* ── What you'll lose ── */}
        <div className="px-8 py-6 max-h-[40vh] overflow-y-auto">
          <p className="text-[11px] uppercase tracking-wider font-bold text-text-tertiary mb-3">
            {isFr ? `Vous perdrez ces fonctionnalités` : `You'll lose these features`}
          </p>
          <ul className="space-y-2.5">
            {lostFlags.map((flag) => (
              <li key={flag.key} className="flex items-start gap-3 text-[13px] text-text-primary font-medium">
                <div className="shrink-0 w-5 h-5 rounded-full bg-red-500/10 flex items-center justify-center mt-0.5">
                  <X size={11} className="text-red-600" strokeWidth={3} />
                </div>
                <span>{flag.label}</span>
              </li>
            ))}
            {seatsLost > 0 && (
              <li className="flex items-start gap-3 text-[13px] text-text-primary font-medium">
                <div className="shrink-0 w-5 h-5 rounded-full bg-red-500/10 flex items-center justify-center mt-0.5">
                  <X size={11} className="text-red-600" strokeWidth={3} />
                </div>
                <span>
                  {isFr
                    ? `${seatsLost} sièges utilisateur (${fromPlan.seats_included} → ${toPlan.seats_included})`
                    : `${seatsLost} user seats (${fromPlan.seats_included} → ${toPlan.seats_included})`}
                </span>
              </li>
            )}
            {lostFeatures.slice(0, 6).map((feat, i) => (
              <li key={`feat-${i}`} className="flex items-start gap-3 text-[13px] text-text-secondary">
                <div className="shrink-0 w-5 h-5 rounded-full bg-red-500/5 flex items-center justify-center mt-0.5">
                  <X size={11} className="text-red-500/70" strokeWidth={2.5} />
                </div>
                <span>{feat}</span>
              </li>
            ))}
            {lostFeatures.length > 6 && (
              <li className="text-[11px] text-text-tertiary italic ml-8">
                {isFr
                  ? `+ ${lostFeatures.length - 6} autres fonctionnalités`
                  : `+ ${lostFeatures.length - 6} more features`}
              </li>
            )}
          </ul>
        </div>

        {/* ── Retention offer (only if currently monthly) ── */}
        {interval === 'monthly' && (
          <div className="mx-8 mb-6 p-5 rounded-2xl bg-gradient-to-br from-emerald-500/15 via-emerald-500/5 to-transparent border-2 border-emerald-500/30">
            <div className="flex items-start gap-4">
              <div className="shrink-0 w-11 h-11 rounded-full bg-emerald-500/20 flex items-center justify-center">
                <Sparkles size={18} className="text-emerald-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-extrabold text-text-primary">
                  {isFr ? `Attendez ! Voici une meilleure offre` : `Wait! Here's a better deal`}
                </p>
                <p className="text-[12px] text-text-secondary mt-1.5 leading-relaxed">
                  {isFr
                    ? `Au lieu de rétrograder, gardez ${fromPlan.name} en facturation annuelle à `
                    : `Instead of downgrading, keep ${fromPlan.name} on annual billing at `}
                  <span className="font-bold text-text-primary">${yearlyDiscount}/mo</span>
                  {isFr ? ` et économisez ` : ` and save `}
                  <span className="font-bold text-emerald-600">${yearlyAnnualSavings}/{isFr ? 'an' : 'yr'}</span>.
                </p>
                <button
                  type="button"
                  disabled={busy}
                  onClick={onSwitchToAnnual}
                  className="mt-3 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-500 text-white text-[12px] font-bold hover:bg-emerald-600 active:scale-[0.98] transition-all disabled:opacity-60"
                >
                  <Sparkles size={13} />
                  {isFr ? `Garder ${fromPlan.name} en annuel` : `Keep ${fromPlan.name} on annual`}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Actions ── */}
        <div className="px-8 pb-7 pt-2 flex flex-col-reverse sm:flex-row gap-2 sm:gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className="flex-1 sm:flex-initial px-5 py-3 rounded-xl text-[13px] font-medium text-text-tertiary hover:text-text-secondary border border-outline-subtle hover:border-outline transition-colors disabled:opacity-50"
          >
            {busy
              ? (isFr ? 'Programmation...' : 'Scheduling...')
              : (isFr ? `Rétrograder vers ${toPlan.name}` : `Downgrade to ${toPlan.name}`)}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="flex-1 px-5 py-3 rounded-xl text-[13px] font-extrabold bg-text-primary text-surface hover:bg-text-primary/90 active:scale-[0.98] transition-all shadow-md disabled:opacity-50"
          >
            {isFr ? `Garder mon plan ${fromPlan.name}` : `Keep my ${fromPlan.name} plan`}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

export default function Settings() {
  const { t, language, setLanguage } = useTranslation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const isPlatformOwner = usePlatformOwner();

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
        { id: 'support',   label: isFr ? 'Support' : 'Support', icon: LifeBuoy },
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
    // Platform section — owner-only, shown at the very bottom
    ...(isPlatformOwner ? [{
      heading: isFr ? 'Plateforme' : 'Platform',
      items: [
        { id: 'platform-admin' as SettingsTab, label: 'Platform Admin', icon: Shield, link: '/platform-admin' },
      ],
    }] : []),
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
            {activeTab === 'support' && (
              <SupportPanel />
            )}
          </motion.div>
        </div>
      </div>
    </div>
  );
}
