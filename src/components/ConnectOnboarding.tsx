import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CreditCard, ExternalLink, CheckCircle2, AlertTriangle, Loader2, RefreshCw, Shield } from 'lucide-react';
import { getAccountStatus, createConnectedAccount, createOnboardingLink, refreshOnboardingLink } from '../lib/connectApi';
import type { ConnectedAccount } from '../types';
import { useTranslation } from '../i18n';

export default function ConnectOnboarding() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [onboardingUrl, setOnboardingUrl] = useState<string | null>(null);

  const statusQuery = useQuery({
    queryKey: ['connectAccountStatus'],
    queryFn: getAccountStatus,
    refetchInterval: 30_000,
  });

  const account = statusQuery.data?.account;
  const isConnected = statusQuery.data?.connected;

  async function handleActivate() {
    setCreating(true);
    try {
      await createConnectedAccount();
      const link = await createOnboardingLink();
      setOnboardingUrl(link.url);
      window.open(link.url, '_blank');
      queryClient.invalidateQueries({ queryKey: ['connectAccountStatus'] });
    } catch (err: any) {
      toast.error(err?.message || t.payments.failedToActivate);
    } finally {
      setCreating(false);
    }
  }

  async function handleContinueOnboarding() {
    try {
      const link = await refreshOnboardingLink();
      setOnboardingUrl(link.url);
      window.open(link.url, '_blank');
    } catch (err: any) {
      toast.error(err?.message || t.payments.failedToGetOnboardingLink);
    }
  }

  async function handleRefreshStatus() {
    await queryClient.invalidateQueries({ queryKey: ['connectAccountStatus'] });
    toast.success(t.payments.statusRefreshed);
  }

  // ── Not connected — show activation ──
  if (!isConnected) {
    return (
      <div className="section-card p-6">
        <div className="flex items-start gap-4">
          <div className="icon-tile icon-tile-blue">
            <CreditCard size={18} />
          </div>
          <div className="flex-1">
            <h3 className="text-[15px] font-bold text-text-primary">{t.payments.lumePayments}</h3>
            <p className="mt-1 text-[13px] text-text-secondary">
              {t.payments.lumePaymentsDesc}
            </p>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                className="glass-button bg-text-primary text-surface hover:bg-neutral-800 inline-flex items-center gap-2"
                onClick={handleActivate}
                disabled={creating || statusQuery.isLoading}
              >
                {creating ? <Loader2 size={14} className="animate-spin" /> : <CreditCard size={14} />}
                {creating ? t.payments.settingUp : t.payments.activateLumePayments}
              </button>
            </div>

            <div className="mt-3 flex items-center gap-1.5 text-[11px] text-text-tertiary">
              <Shield size={11} />
              <span>{t.payments.poweredByStripe}</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Connected but onboarding incomplete ──
  if (!account?.onboarding_complete || !account?.charges_enabled) {
    return (
      <div className="section-card border-amber-200 dark:border-amber-800 p-6">
        <div className="flex items-start gap-4">
          <div className="icon-tile icon-tile-amber">
            <AlertTriangle size={18} />
          </div>
          <div className="flex-1">
            <h3 className="text-[15px] font-bold text-text-primary">{t.payments.completeYourSetup}</h3>
            <p className="mt-1 text-[13px] text-text-secondary">
              {t.payments.onboardingIncompleteDesc}
            </p>

            <OnboardingChecklist account={account!} />

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                className="glass-button bg-amber-600 text-white hover:bg-amber-700 inline-flex items-center gap-2"
                onClick={handleContinueOnboarding}
              >
                <ExternalLink size={14} />
                {t.payments.continueSetup}
              </button>
              <button
                type="button"
                className="glass-button inline-flex items-center gap-1.5 text-[12px]"
                onClick={handleRefreshStatus}
              >
                <RefreshCw size={12} />
                {t.payments.refreshStatus}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Fully connected and ready ──
  return (
    <div className="section-card border-green-200 dark:border-green-800 p-6">
      <div className="flex items-start gap-4">
        <div className="icon-tile icon-tile-green">
          <CheckCircle2 size={18} />
        </div>
        <div className="flex-1">
          <h3 className="text-[15px] font-bold text-text-primary">{t.payments.lumePaymentsActive}</h3>
          <p className="mt-1 text-[13px] text-text-secondary">
            {t.payments.lumePaymentsActiveDesc}
          </p>

          <OnboardingChecklist account={account!} />

          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              className="glass-button inline-flex items-center gap-1.5 text-[12px]"
              onClick={handleRefreshStatus}
            >
              <RefreshCw size={12} />
              {t.payments.refreshStatus}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function OnboardingChecklist({ account }: { account: ConnectedAccount }) {
  const { t } = useTranslation();
  const items = [
    { label: t.payments.checklistAccountCreated, done: true },
    { label: t.payments.checklistDetailsSubmitted, done: account.details_submitted },
    { label: t.payments.checklistChargesEnabled, done: account.charges_enabled },
    { label: t.payments.checklistPayoutsEnabled, done: account.payouts_enabled },
  ];

  return (
    <div className="mt-3 grid grid-cols-2 gap-2">
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-2 text-[12px]">
          {item.done ? (
            <CheckCircle2 size={13} className="text-green-500 shrink-0" />
          ) : (
            <div className="w-[13px] h-[13px] rounded-full border-2 border-neutral-300 dark:border-neutral-600 shrink-0" />
          )}
          <span className={item.done ? 'text-text-primary' : 'text-text-tertiary'}>{item.label}</span>
        </div>
      ))}
    </div>
  );
}
