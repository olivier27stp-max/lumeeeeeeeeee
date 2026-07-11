// Plan-based feature gating for mobile — the counterpart of the web
// `src/hooks/usePlanFeature.ts`. Keeps mobile and web in agreement on which
// subscription tier unlocks which feature (D2D, formations, SMS, …).

import { useQuery } from '@tanstack/react-query';

import { fetchCurrentPlan, serverConfigured, type PlanRow } from './api/server';

export type PlanFeatureFlag =
  | 'includes_sms'
  | 'includes_ai'
  | 'includes_d2d'
  | 'includes_courses'
  | 'includes_api';

interface UsePlanFeatureReturn {
  /** True when the org's current plan grants this feature. */
  hasFeature: boolean;
  /** Initial plan resolution in flight. */
  loading: boolean;
  /** The resolved current plan (null when unknown / no subscription). */
  currentPlan: PlanRow | null;
}

/**
 * Whether the org's plan grants `flag`.
 *
 * Fail policy — deliberately asymmetric:
 *  • While loading, on a fetch error, or when the server URL isn't configured →
 *    return `true` (open). A network blip must NOT lock a paying customer out of
 *    a feature they're entitled to.
 *  • Once a plan resolves, honour its flag exactly (a Minimum-plan org has
 *    `includes_d2d = false` → gated). A definitive "no active subscription"
 *    (currentPlan null after a successful fetch) → `false`.
 * The revenue-leak case (lower tier reaching a premium feature) is a resolved
 * plan with the flag off, so it is always gated; only the unknown/transient
 * cases stay open.
 */
export function usePlanFeature(flag: PlanFeatureFlag): UsePlanFeatureReturn {
  const enabled = serverConfigured();

  const { data, isLoading, isError, isSuccess } = useQuery({
    queryKey: ['current-plan'],
    queryFn: fetchCurrentPlan,
    enabled,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    retry: 1,
  });

  if (!enabled) return { hasFeature: true, loading: false, currentPlan: null };
  if (isLoading) return { hasFeature: true, loading: true, currentPlan: null };
  if (isError) return { hasFeature: true, loading: false, currentPlan: null };

  const currentPlan = data ?? null;
  // Only fail-closed once we actually have a successful response to trust.
  const hasFeature = isSuccess ? Boolean(currentPlan?.[flag]) : true;
  return { hasFeature, loading: false, currentPlan };
}
