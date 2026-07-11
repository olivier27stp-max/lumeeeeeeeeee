import { useState, useEffect } from 'react';
import { fetchCurrentBilling, fetchPlans, type Plan, type Subscription } from '../lib/billingApi';

export type PlanFeatureFlag =
  | 'includes_sms'
  | 'includes_ai'
  | 'includes_d2d'
  | 'includes_courses'
  | 'includes_api'
  | 'includes_automations'
  | 'includes_marketplace'
  | 'includes_timesheets'
  | 'includes_request_forms'
  | 'includes_advanced_roles';

interface UsePlanFeatureReturn {
  /** True when the user's current plan grants this feature */
  hasFeature: boolean;
  /** Loading initial plan / subscription data */
  loading: boolean;
  /** Current plan (resolved from subscription) */
  currentPlan: Plan | null;
  /** Active subscription, if any */
  subscription: Subscription | null;
  /** All plans (used by upgrade modal to suggest the cheapest tier with the feature) */
  plans: Plan[];
  /** The lowest-priced plan that includes this feature (for upsell) */
  requiredPlan: Plan | null;
}

const cache: {
  plans: Plan[] | null;
  subscription: Subscription | null;
  currentPlan: Plan | null;
  fetchedAt: number;
} = { plans: null, subscription: null, currentPlan: null, fetchedAt: 0 };

const CACHE_TTL_MS = 30_000;

/**
 * Returns whether the current org's plan grants a given feature (via plan flags).
 * Falls back to `true` (open access) while loading to avoid flashing locked screens.
 *
 * Caches the plan + subscription for 30s across all hook instances so we don't
 * hit the API every time a gated component mounts.
 */
export function usePlanFeature(flag: PlanFeatureFlag): UsePlanFeatureReturn {
  const [loading, setLoading] = useState(!cache.plans);
  const [plans, setPlans] = useState<Plan[]>(cache.plans ?? []);
  const [subscription, setSubscription] = useState<Subscription | null>(cache.subscription);
  const [currentPlan, setCurrentPlan] = useState<Plan | null>(cache.currentPlan);

  useEffect(() => {
    const now = Date.now();
    if (cache.plans && now - cache.fetchedAt < CACHE_TTL_MS) {
      setPlans(cache.plans);
      setSubscription(cache.subscription);
      setCurrentPlan(cache.currentPlan);
      setLoading(false);
      return;
    }

    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [plansData, billing] = await Promise.all([
          fetchPlans().catch(() => []),
          fetchCurrentBilling().catch(() => ({ subscription: null, billing_profile: null })),
        ]);
        if (cancelled) return;

        const sub = billing.subscription;
        const plan = sub
          ? (sub.plans ?? plansData.find((p) => p.id === sub.plan_id) ?? null)
          : null;

        cache.plans = plansData;
        cache.subscription = sub;
        cache.currentPlan = plan;
        cache.fetchedAt = Date.now();

        setPlans(plansData);
        setSubscription(sub);
        setCurrentPlan(plan);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, []);

  const hasFeature = currentPlan ? Boolean((currentPlan as any)[flag]) : false;

  // Find cheapest plan that grants this feature (for upsell CTA)
  const requiredPlan = plans
    .filter((p) => Boolean((p as any)[flag]))
    .sort((a, b) => (a.monthly_price_usd || 0) - (b.monthly_price_usd || 0))[0] ?? null;

  return {
    hasFeature,
    loading,
    currentPlan,
    subscription,
    plans,
    requiredPlan,
  };
}

/** Clear the cache so the next hook call re-fetches (e.g. after a plan change). */
export function invalidatePlanFeatureCache() {
  cache.plans = null;
  cache.subscription = null;
  cache.currentPlan = null;
  cache.fetchedAt = 0;
}

/**
 * Returns the resolved current plan + all plans + loading state, in one hook.
 * Reuses the same 30s cache as usePlanFeature.
 */
export function useCurrentPlan(): { currentPlan: Plan | null; plans: Plan[]; loading: boolean } {
  // Use any flag — we only care about currentPlan / plans / loading.
  const { currentPlan, plans, loading } = usePlanFeature('includes_sms');
  return { currentPlan, plans, loading };
}
