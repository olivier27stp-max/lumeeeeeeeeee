import React, { useState, useEffect } from 'react';
import { usePlanFeature, type PlanFeatureFlag } from '../hooks/usePlanFeature';
import PlanUpgradeModal from './PlanUpgradeModal';

interface PlanFeatureGateProps {
  flag: PlanFeatureFlag;
  /** Optional: render this fallback when locked (defaults to opening the upgrade modal) */
  fallback?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * Wraps content behind a plan-feature gate.
 * - If the org's plan grants `flag`, renders `children`.
 * - Otherwise, opens the upgrade modal automatically on mount and renders `fallback`
 *   (or a faded placeholder if none provided).
 *
 * Use this for full-page gating (e.g. /messages, /lume-agent).
 * For inline UI elements (buttons), use `useUpgradeGate` directly.
 */
export default function PlanFeatureGate({ flag, fallback, children }: PlanFeatureGateProps) {
  const { hasFeature, loading, currentPlan, requiredPlan } = usePlanFeature(flag);
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    if (!loading && !hasFeature) {
      setModalOpen(true);
    }
  }, [loading, hasFeature]);

  if (loading) return null;
  if (hasFeature) return <>{children}</>;

  return (
    <>
      {fallback ?? (
        <div className="flex items-center justify-center min-h-[60vh] p-8">
          <div className="text-center max-w-md">
            <div className="w-14 h-14 rounded-full bg-primary/10 mx-auto mb-4 flex items-center justify-center">
              <span className="text-2xl">🔒</span>
            </div>
            <p className="text-sm font-semibold text-text-primary">Premium feature</p>
            <p className="text-xs text-text-secondary mt-1">
              Upgrade your plan to access this section.
            </p>
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-text-primary text-surface text-xs font-bold hover:bg-text-primary/90 transition-colors"
            >
              See details
            </button>
          </div>
        </div>
      )}
      <PlanUpgradeModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        flag={flag}
        requiredPlan={requiredPlan}
        currentPlan={currentPlan}
      />
    </>
  );
}

/**
 * Hook variant: returns a `triggerUpgrade()` function + modal element to render at the page level.
 * Use this when you want to gate a specific action (button click) rather than a whole page.
 *
 * Example:
 *   const { hasFeature, triggerUpgrade, modal } = useUpgradeGate('includes_sms');
 *   return (
 *     <>
 *       <button onClick={() => hasFeature ? sendSms() : triggerUpgrade()}>Send SMS</button>
 *       {modal}
 *     </>
 *   );
 */
export function useUpgradeGate(flag: PlanFeatureFlag) {
  const { hasFeature, loading, currentPlan, requiredPlan } = usePlanFeature(flag);
  const [modalOpen, setModalOpen] = useState(false);

  return {
    hasFeature,
    loading,
    triggerUpgrade: () => setModalOpen(true),
    modal: (
      <PlanUpgradeModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        flag={flag}
        requiredPlan={requiredPlan}
        currentPlan={currentPlan}
      />
    ),
  };
}
