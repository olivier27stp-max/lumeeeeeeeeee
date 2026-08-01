import { useState, useEffect } from 'react';
import { CreditCard, Check, Loader2, X, Sparkles, Calendar as CalendarIcon } from 'lucide-react';
import { motion } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { cn } from '../../lib/utils';
import { useTranslation } from '../../i18n';
import SeatsBanner from '../../components/SeatsBanner';
import OfficesManager from '../../components/OfficesManager';
import {
  fetchPlans,
  fetchCurrentBilling,
  changePlan,
  openCustomerPortal,
  cancelScheduledChange,
  type Plan,
  type Subscription,
} from '../../lib/billingApi';
import { translatePlanFeature } from '../../lib/planFeatures';

/* ═══════════════════════════════════════════════════════════════
   Plan & billing — connected to real Stripe/DB data.
   Extracted from the old Settings.tsx hub during the settings refonte.
   ═══════════════════════════════════════════════════════════════ */
export default function BillingSettings() {
  const { t, language } = useTranslation();
  const isFr = language === 'fr';
  const navigate = useNavigate();

  const [plans, setPlans] = useState<Plan[]>([]);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  // Display currency follows the subscription (checkout defaults to CAD).
  // The grid used to hardcode *_usd fields, showing USD prices to CAD customers.
  const currency: 'CAD' | 'USD' =
    (subscription?.currency || 'CAD').toUpperCase() === 'USD' ? 'USD' : 'CAD';

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
    <div className="max-w-2xl space-y-6">
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
                    {(() => {
                      // Real yearly price from the plans table (hardcoded ×0.85 before).
                      const yearlyP = currency === 'USD' ? currentPlan.yearly_price_usd : currentPlan.yearly_price_cad;
                      const monthlyP = currency === 'USD' ? currentPlan.monthly_price_usd : currentPlan.monthly_price_cad;
                      const yrMo = yearlyP
                        ? Math.round(yearlyP / 1200)
                        : Math.round(monthlyP / 100 * 0.85);
                      return isFr
                        ? `Économisez en passant à l'annuel ($${yrMo}/mois)`
                        : `Save by switching to annual ($${yrMo}/mo)`;
                    })()}
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

      {/* ── Offices allowance + extra-office billing ── */}
      {subscription && subscription.status !== 'canceled' && (
        <OfficesManager onChange={refresh} />
      )}

      {/* ── Plans Grid — Premium cards ── */}
      <PlansGrid
        plans={plans}
        currentPlan={currentPlan ?? null}
        subscription={subscription}
        currency={currency}
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
  currency,
  isFr,
  navigate,
  onRefresh,
}: {
  plans: Plan[];
  currentPlan: Plan | null;
  subscription: Subscription | null;
  currency: 'CAD' | 'USD';
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
          const price = (currency === 'USD' ? plan.monthly_price_usd : plan.monthly_price_cad) / 100;
          const extraSeatPrice = currency === 'USD' ? plan.extra_seat_price_usd : plan.extra_seat_price_cad;
          const extraOfficePrice = currency === 'USD' ? plan.extra_office_price_usd : plan.extra_office_price_cad;
          const features: string[] = Array.isArray(plan.features) ? plan.features : [];
          const seatsInfo = plan.seats_included
            ? `${plan.seats_included} ${isFr ? 'utilisateurs inclus' : 'users included'}`
            : null;
          const extraSeat = extraSeatPrice
            ? `+$${extraSeatPrice / 100}/${isFr ? 'utilisateur supplémentaire' : 'extra user'}`
            : null;
          const officesInfo = plan.included_offices
            ? `${plan.included_offices} ${isFr ? (plan.included_offices === 1 ? 'bureau inclus' : 'bureaux inclus') : (plan.included_offices === 1 ? 'office included' : 'offices included')}`
            : null;
          const extraOffice = extraOfficePrice
            ? `+$${extraOfficePrice / 100}/${isFr ? 'bureau supplémentaire' : 'extra office'}`
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

              {/* Offices */}
              {officesInfo && (
                <p className="text-[11px] uppercase tracking-wider font-semibold text-text-tertiary mt-0.5">
                  {officesInfo}
                </p>
              )}

              {/* Price */}
              <div className="mt-4 mb-1">
                <span className="text-4xl font-extrabold tabular-nums text-text-primary">${price}</span>
                <span className="text-sm font-normal text-text-tertiary ml-1">/{isFr ? 'mois' : 'mo'}</span>
              </div>
              {extraSeat && <p className="text-[11px] text-text-tertiary">{extraSeat}</p>}
              {extraOffice && <p className="text-[11px] text-text-tertiary">{extraOffice}</p>}

              {/* Divider */}
              <div className="border-t border-outline-subtle my-4" />

              {/* Features list */}
              <ul className="space-y-2.5 flex-1 mb-6">
                {features.map((feat, fi) => (
                  <li key={fi} className="flex items-start gap-2 text-[13px] text-text-secondary leading-snug">
                    <Check size={14} className={cn('mt-0.5 shrink-0', isCurrent ? 'text-emerald-500' : isFeatured ? 'text-primary' : 'text-emerald-500')} />
                    <span>{translatePlanFeature(feat, isFr)}</span>
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
          currency={currency}
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
  currency,
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
  currency: 'CAD' | 'USD';
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

  // Offices lost
  const officesLost = (fromPlan.included_offices ?? 0) - (toPlan.included_offices ?? 0);

  // Prices — real yearly price from the plans table when available (the old
  // hardcoded ×0.85 drifted from the actual pricing model).
  const monthlyOf = (p: Plan) => (currency === 'USD' ? p.monthly_price_usd : p.monthly_price_cad);
  const yearlyOf = (p: Plan) => (currency === 'USD' ? p.yearly_price_usd : p.yearly_price_cad);
  const yearlyMo = (p: Plan) =>
    yearlyOf(p) ? Math.round(yearlyOf(p) / 1200) : Math.round(monthlyOf(p) * 0.85 / 100);
  const fromPrice = interval === 'yearly' ? yearlyMo(fromPlan) : monthlyOf(fromPlan) / 100;
  const toPrice = interval === 'yearly' ? yearlyMo(toPlan) : monthlyOf(toPlan) / 100;
  const monthlySavings = fromPrice - toPrice;

  // Yearly retention offer (only if currently monthly)
  const yearlyDiscount = yearlyMo(fromPlan);
  const yearlyAnnualSavings = (monthlyOf(fromPlan) / 100 - yearlyDiscount) * 12;

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
                  <p className="text-[10px] text-white/70 tabular-nums">${fromPrice}/{isFr ? 'mois' : 'mo'}</p>
                </div>
                <div className="text-white/40 text-xl">→</div>
                <div>
                  <p className="text-[9px] uppercase font-bold tracking-wider text-white/60">{isFr ? 'Vers' : 'To'}</p>
                  <p className="text-sm font-extrabold">{toPlan.name}</p>
                  <p className="text-[10px] text-white/70 tabular-nums">${toPrice}/{isFr ? 'mois' : 'mo'}</p>
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
            {officesLost > 0 && (
              <li className="flex items-start gap-3 text-[13px] text-text-primary font-medium">
                <div className="shrink-0 w-5 h-5 rounded-full bg-red-500/10 flex items-center justify-center mt-0.5">
                  <X size={11} className="text-red-600" strokeWidth={3} />
                </div>
                <span>
                  {isFr
                    ? `${officesLost} ${officesLost === 1 ? 'bureau' : 'bureaux'} (${fromPlan.included_offices} → ${toPlan.included_offices})`
                    : `${officesLost} ${officesLost === 1 ? 'office' : 'offices'} (${fromPlan.included_offices} → ${toPlan.included_offices})`}
                </span>
              </li>
            )}
            {lostFeatures.slice(0, 6).map((feat, i) => (
              <li key={`feat-${i}`} className="flex items-start gap-3 text-[13px] text-text-secondary">
                <div className="shrink-0 w-5 h-5 rounded-full bg-red-500/5 flex items-center justify-center mt-0.5">
                  <X size={11} className="text-red-500/70" strokeWidth={2.5} />
                </div>
                <span>{translatePlanFeature(feat, isFr)}</span>
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
