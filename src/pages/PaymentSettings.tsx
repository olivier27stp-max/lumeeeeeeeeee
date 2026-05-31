import React from 'react';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from '../i18n';
import { cn } from '../lib/utils';
import PermissionGate from '../components/PermissionGate';
import ConnectOnboarding from '../components/ConnectOnboarding';

export default function PaymentSettings() {
  const { t, language } = useTranslation();
  const navigate = useNavigate();

  return (
    <PermissionGate permission="payments.manage_settings">
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-2">
            <button type="button" onClick={() => navigate('/payments')} className="glass-button inline-flex items-center gap-2">
              <ArrowLeft size={14} />
              {t.payments.backToPayments}
            </button>
            <h1 className="text-5xl font-semibold tracking-tight text-text-primary">
              {t.commandPalette.payments}
            </h1>
            <p className="text-base text-text-secondary">
              {t.paymentSettings.acceptPaymentsDesc}
            </p>
          </div>
        </div>

        <ConnectOnboarding />

        <section className="section-card p-5 space-y-3">
          <h3 className="text-[14px] font-semibold text-text-primary">
            {t.paymentSettings.howItWorks}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-800 text-[11px] font-bold text-text-primary dark:text-neutral-400">1</span>
                <span className="text-[13px] font-medium text-text-primary">
                  {t.paymentSettings.activatePayments}
                </span>
              </div>
              <p className="text-[12px] text-text-tertiary pl-8">
                {t.paymentSettings.connectBankDesc}
              </p>
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-800 text-[11px] font-bold text-text-primary dark:text-neutral-400">2</span>
                <span className="text-[13px] font-medium text-text-primary">
                  {t.paymentSettings.sendPaymentRequests}
                </span>
              </div>
              <p className="text-[12px] text-text-tertiary pl-8">
                {t.paymentSettings.sendPaymentLinkDesc}
              </p>
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-800 text-[11px] font-bold text-text-primary dark:text-neutral-400">3</span>
                <span className="text-[13px] font-medium text-text-primary">
                  {t.paymentSettings.getPaid}
                </span>
              </div>
              <p className="text-[12px] text-text-tertiary pl-8">
                {t.paymentSettings.paymentsDepositedDesc}
              </p>
            </div>
          </div>
        </section>

        <section className="section-card p-5 space-y-2">
          <h3 className="text-[14px] font-semibold text-text-primary">
            {t.paymentSettings.fees}
          </h3>
          <div className="flex items-baseline gap-1">
            <span className="text-[24px] font-bold text-text-primary">2.9%</span>
            <span className="text-[13px] text-text-secondary">+ 30&cent;</span>
            <span className="text-[13px] text-text-tertiary ml-2">
              {t.paymentSettings.perSuccessfulTransaction}
            </span>
          </div>
          <p className="text-[12px] text-text-tertiary">
            {t.paymentSettings.noMonthlyFeesDesc}
          </p>
        </section>
      </div>
    </PermissionGate>
  );
}
