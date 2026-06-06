/**
 * TEMPORARY page — plan/subscription switcher for testing.
 *
 * Lets an admin/owner switch the current org's plan directly (bypassing Stripe)
 * so plan-gated UI can be tested (locked tabs, "Discover features", feature gates).
 * Route: /dev/plan-switch. Remove once no longer needed.
 */
import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Check, Loader2, Sparkles, AlertTriangle } from 'lucide-react';
import { cn } from '../lib/utils';
import { useTranslation } from '../i18n';
import {
  fetchPlans, fetchCurrentBilling, devSwitchPlan,
  type Plan, type Subscription,
} from '../lib/billingApi';
import { invalidatePlanFeatureCache } from '../hooks/usePlanFeature';

const FEATURE_FLAGS: Array<{ key: keyof Plan; label: string }> = [
  { key: 'includes_sms', label: 'SMS' },
  { key: 'includes_ai', label: 'AI' },
  { key: 'includes_d2d', label: 'D2D' },
  { key: 'includes_courses', label: 'Courses' },
  { key: 'includes_api', label: 'API' },
];

export default function DevPlanSwitch() {
  const { language } = useTranslation();
  const fr = language === 'fr';

  const [plans, setPlans] = useState<Plan[]>([]);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [interval, setInterval] = useState<'monthly' | 'yearly'>('monthly');
  const [switching, setSwitching] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [plansData, billing] = await Promise.all([
        fetchPlans().catch(() => []),
        fetchCurrentBilling().catch(() => ({ subscription: null, billing_profile: null })),
      ]);
      setPlans([...plansData].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)));
      setSubscription(billing.subscription);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const currentPlanId = subscription?.plan_id ?? null;
  const currentInterval = subscription?.interval ?? null;

  const handleSwitch = async (plan: Plan) => {
    setSwitching(plan.id);
    try {
      const result = await devSwitchPlan({ plan_slug: plan.slug, interval });
      invalidatePlanFeatureCache();
      toast.success(result.message || (fr ? 'Plan changé — rechargement…' : 'Plan switched — reloading…'));
      // Full reload so all plan-gated UI (sidebar, gates, locked tabs) reflects the new plan.
      setTimeout(() => window.location.reload(), 700);
    } catch (err: any) {
      toast.error(err?.message || (fr ? 'Échec du changement de plan' : 'Failed to switch plan'));
      setSwitching(null);
    }
  };

  return (
    <div className="max-w-[1100px] mx-auto px-6 lg:px-10 py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
          <Sparkles size={18} className="text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-bold tracking-tight text-text-primary">
            {fr ? 'Changer de plan (test)' : 'Switch plan (test)'}
          </h1>
          <p className="text-[13px] text-text-tertiary">
            {fr
              ? 'Outil temporaire — change le plan de l’organisation sans passer par Stripe.'
              : 'Temporary tool — switches the org plan directly, no Stripe.'}
          </p>
        </div>
      </div>

      {/* Temporary warning banner */}
      <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-[13px] text-amber-700 dark:text-amber-300">
        <AlertTriangle size={16} className="shrink-0 mt-0.5" />
        <span>
          {fr
            ? 'Page temporaire pour les tests. Aucun paiement n’est traité ; le plan est modifié directement en base.'
            : 'Temporary testing page. No payment is processed; the plan is changed directly in the database.'}
        </span>
      </div>

      {/* Interval toggle */}
      <div className="flex items-center gap-2">
        <span className="text-[13px] text-text-secondary">{fr ? 'Intervalle :' : 'Interval:'}</span>
        <div className="flex p-0.5 bg-surface-tertiary rounded-lg border border-outline">
          {(['monthly', 'yearly'] as const).map((iv) => (
            <button
              key={iv}
              type="button"
              onClick={() => setInterval(iv)}
              className={cn(
                'px-3 py-1.5 rounded-md text-xs font-semibold transition-all',
                interval === iv ? 'bg-surface shadow-sm text-text-primary' : 'text-text-tertiary'
              )}
            >
              {iv === 'monthly' ? (fr ? 'Mensuel' : 'Monthly') : (fr ? 'Annuel' : 'Yearly')}
            </button>
          ))}
        </div>
      </div>

      {/* Plans */}
      {loading ? (
        <div className="p-12 text-center">
          <Loader2 size={22} className="animate-spin text-text-tertiary mx-auto" />
        </div>
      ) : plans.length === 0 ? (
        <div className="p-12 text-center text-text-secondary text-sm">
          {fr ? 'Aucun plan trouvé.' : 'No plans found.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {plans.map((plan) => {
            const isCurrent = plan.id === currentPlanId && interval === currentInterval;
            const priceField = interval === 'yearly' ? 'yearly_price_cad' : 'monthly_price_cad';
            const price = (plan as any)[priceField] as number | undefined;
            return (
              <div
                key={plan.id}
                className={cn(
                  'section-card p-5 space-y-3 border transition-all',
                  isCurrent ? 'border-primary/50 ring-1 ring-primary/30' : 'border-outline'
                )}
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-[15px] font-bold text-text-primary">{fr ? (plan.name_fr || plan.name) : plan.name}</h3>
                  {isCurrent && (
                    <span className="text-[10px] font-bold uppercase tracking-wide text-primary bg-primary/10 px-2 py-0.5 rounded">
                      {fr ? 'Actuel' : 'Current'}
                    </span>
                  )}
                </div>

                <p className="text-[13px] text-text-secondary">
                  {price != null ? `${price} CAD / ${interval === 'yearly' ? (fr ? 'an' : 'yr') : (fr ? 'mois' : 'mo')}` : '—'}
                </p>

                <div className="flex flex-wrap gap-1.5">
                  {FEATURE_FLAGS.map((f) => {
                    const on = Boolean((plan as any)[f.key]);
                    return (
                      <span
                        key={String(f.key)}
                        className={cn(
                          'inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded border',
                          on
                            ? 'text-primary border-primary/30 bg-primary/10'
                            : 'text-text-tertiary border-outline bg-surface-secondary/50 line-through'
                        )}
                      >
                        {on && <Check size={10} />}{f.label}
                      </span>
                    );
                  })}
                </div>

                <button
                  type="button"
                  onClick={() => handleSwitch(plan)}
                  disabled={isCurrent || switching !== null}
                  className={cn(
                    'glass-button-primary w-full px-3 py-2 text-xs font-semibold inline-flex items-center justify-center gap-1.5 disabled:opacity-50',
                  )}
                >
                  {switching === plan.id
                    ? <Loader2 size={12} className="animate-spin" />
                    : null}
                  {isCurrent ? (fr ? 'Plan actuel' : 'Current plan') : (fr ? 'Basculer sur ce plan' : 'Switch to this plan')}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
