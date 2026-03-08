import React, { useMemo, useState } from 'react';
import { ArrowLeft, CheckCircle2, Loader2, RefreshCw, ShieldAlert } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { getCurrentOrgId } from '../lib/orgApi';
import {
  fetchPaymentSettings,
  savePayPalKeys,
  saveStripeKeys,
  setDefaultProvider,
  toggleProviderEnabled,
} from '../lib/paymentsApi';
import { cn } from '../lib/utils';

function badgeClass(enabled: boolean) {
  if (enabled) return 'bg-success-light text-success border-success-light';
  return 'bg-surface-tertiary text-text-primary border-border';
}

function keysBadgeClass(present: boolean) {
  if (present) return 'bg-success-light text-success border-success-light';
  return 'bg-warning-light text-warning border-warning-light';
}

export default function PaymentSettings() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [stripePublishableKey, setStripePublishableKey] = useState('');
  const [stripeSecretKey, setStripeSecretKey] = useState('');
  const [paypalClientId, setPaypalClientId] = useState('');
  const [paypalSecret, setPaypalSecret] = useState('');

  const orgQuery = useQuery({
    queryKey: ['currentOrgId', 'paymentSettings'],
    queryFn: getCurrentOrgId,
  });

  const orgId = orgQuery.data || null;

  const settingsQuery = useQuery({
    queryKey: ['paymentSettings', orgId || 'none'],
    queryFn: () => fetchPaymentSettings(orgId || undefined),
    enabled: Boolean(orgId),
  });

  const settings = settingsQuery.data?.settings;
  const canManage = Boolean(settingsQuery.data?.permissions.can_manage);

  const mutation = useMutation({
    mutationFn: async (payload: { type: 'save_stripe' | 'save_paypal' | 'toggle_stripe' | 'toggle_paypal' | 'set_default'; value?: any }) => {
      if (!orgId) throw new Error('Missing organization context.');

      if (payload.type === 'save_stripe') {
        return saveStripeKeys({
          orgId,
          stripePublishableKey: stripePublishableKey.trim(),
          stripeSecretKey: stripeSecretKey.trim(),
        });
      }

      if (payload.type === 'save_paypal') {
        return savePayPalKeys({
          orgId,
          paypalClientId: paypalClientId.trim(),
          paypalSecret: paypalSecret.trim(),
        });
      }

      if (payload.type === 'toggle_stripe') {
        return toggleProviderEnabled({ orgId, provider: 'stripe', enabled: Boolean(payload.value) });
      }

      if (payload.type === 'toggle_paypal') {
        return toggleProviderEnabled({ orgId, provider: 'paypal', enabled: Boolean(payload.value) });
      }

      return setDefaultProvider({ orgId, defaultProvider: payload.value });
    },
    onSuccess: (_, payload) => {
      if (payload.type === 'save_stripe') {
        setStripeSecretKey('');
        toast.success('Stripe keys saved.');
      } else if (payload.type === 'save_paypal') {
        setPaypalSecret('');
        toast.success('PayPal keys saved.');
      } else {
        toast.success('Payment settings updated.');
      }
      queryClient.invalidateQueries({ queryKey: ['paymentSettings'] });
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Unable to update payment settings.');
    },
  });

  const isBusy = mutation.isPending;

  const stripeSaveDisabled = !canManage || isBusy || !stripePublishableKey.trim() || !stripeSecretKey.trim();
  const paypalSaveDisabled = !canManage || isBusy || !paypalClientId.trim() || !paypalSecret.trim();

  const defaultOptions = useMemo(() => {
    return {
      stripeDisabled: !settings?.stripe_enabled || !settings?.stripe_keys_present,
      paypalDisabled: !settings?.paypal_enabled || !settings?.paypal_keys_present,
    };
  }, [settings]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-2">
          <button type="button" onClick={() => navigate('/payments')} className="glass-button inline-flex items-center gap-2">
            <ArrowLeft size={14} />
            Back to payments
          </button>
          <h1 className="text-5xl font-semibold tracking-tight text-text-primary">Payment settings</h1>
          <p className="text-base text-text-secondary">Store provider keys securely, then enable Stripe/PayPal for this organization.</p>
        </div>

        <button type="button" className="glass-button inline-flex items-center gap-2" onClick={() => settingsQuery.refetch()}>
          <RefreshCw size={14} className={cn(settingsQuery.isFetching && 'animate-spin')} />
          Refresh
        </button>
      </div>

      {!canManage && settings ? (
        <p className="rounded-lg border border-warning-light bg-warning-light px-3 py-2 text-sm text-warning">
          You can view settings, but only owner/admin can change provider keys and toggles.
        </p>
      ) : null}

      {settingsQuery.isLoading || orgQuery.isLoading ? (
        <div className="section-card min-h-[180px] flex items-center justify-center text-sm text-text-secondary">
          <Loader2 size={16} className="mr-2 animate-spin" />
          Loading payment settings...
        </div>
      ) : null}

      {settingsQuery.isError ? (
        <div className="section-card border border-danger-light text-danger">
          {(settingsQuery.error as Error)?.message || 'Unable to load payment settings.'}
        </div>
      ) : null}

      {settings ? (
        <>
          <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <article className="section-card min-h-[280px] space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-2xl font-semibold tracking-tight text-text-primary">Stripe</h2>
                  <p className="mt-1 text-sm text-text-secondary">Publishable key + secret key (encrypted server-side).</p>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <span className={cn('inline-flex rounded-full border px-3 py-1 text-xs font-medium', badgeClass(settings.stripe_enabled))}>
                    {settings.stripe_enabled ? 'Enabled' : 'Disabled'}
                  </span>
                  <span className={cn('inline-flex rounded-full border px-3 py-1 text-xs font-medium', keysBadgeClass(settings.stripe_keys_present))}>
                    Keys present: {settings.stripe_keys_present ? 'Yes' : 'No'}
                  </span>
                </div>
              </div>

              <label className="inline-flex items-center gap-2 text-sm text-text-primary">
                <input
                  type="checkbox"
                  checked={settings.stripe_enabled}
                  disabled={!canManage || isBusy}
                  onChange={(event) => mutation.mutate({ type: 'toggle_stripe', value: event.target.checked })}
                />
                Enabled
              </label>

              {!settings.stripe_keys_present ? (
                <div className="space-y-3 rounded-xl border border-warning-light bg-warning-light p-3">
                  <p className="inline-flex items-center gap-2 text-sm font-medium text-warning">
                    <ShieldAlert size={14} />
                    Stripe keys missing. Save keys before enabling.
                  </p>
                  <input
                    value={stripePublishableKey}
                    onChange={(event) => setStripePublishableKey(event.target.value)}
                    placeholder="pk_live_... or pk_test_..."
                    className="glass-input w-full"
                  />
                  <input
                    type="password"
                    value={stripeSecretKey}
                    onChange={(event) => setStripeSecretKey(event.target.value)}
                    placeholder="sk_live_... or sk_test_..."
                    className="glass-input w-full"
                  />
                  <button
                    type="button"
                    disabled={stripeSaveDisabled}
                    onClick={() => mutation.mutate({ type: 'save_stripe' })}
                    className="glass-button-primary"
                  >
                    {isBusy ? 'Saving...' : 'Save Stripe keys'}
                  </button>
                </div>
              ) : null}
            </article>

            <article className="section-card min-h-[280px] space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-2xl font-semibold tracking-tight text-text-primary">PayPal</h2>
                  <p className="mt-1 text-sm text-text-secondary">Client id + secret (encrypted server-side).</p>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <span className={cn('inline-flex rounded-full border px-3 py-1 text-xs font-medium', badgeClass(settings.paypal_enabled))}>
                    {settings.paypal_enabled ? 'Enabled' : 'Disabled'}
                  </span>
                  <span className={cn('inline-flex rounded-full border px-3 py-1 text-xs font-medium', keysBadgeClass(settings.paypal_keys_present))}>
                    Keys present: {settings.paypal_keys_present ? 'Yes' : 'No'}
                  </span>
                </div>
              </div>

              <label className="inline-flex items-center gap-2 text-sm text-text-primary">
                <input
                  type="checkbox"
                  checked={settings.paypal_enabled}
                  disabled={!canManage || isBusy}
                  onChange={(event) => mutation.mutate({ type: 'toggle_paypal', value: event.target.checked })}
                />
                Enabled
              </label>

              {!settings.paypal_keys_present ? (
                <div className="space-y-3 rounded-xl border border-warning-light bg-warning-light p-3">
                  <p className="inline-flex items-center gap-2 text-sm font-medium text-warning">
                    <ShieldAlert size={14} />
                    PayPal keys missing. Save keys before enabling.
                  </p>
                  <input
                    value={paypalClientId}
                    onChange={(event) => setPaypalClientId(event.target.value)}
                    placeholder="PayPal client id"
                    className="glass-input w-full"
                  />
                  <input
                    type="password"
                    value={paypalSecret}
                    onChange={(event) => setPaypalSecret(event.target.value)}
                    placeholder="PayPal secret"
                    className="glass-input w-full"
                  />
                  <button
                    type="button"
                    disabled={paypalSaveDisabled}
                    onClick={() => mutation.mutate({ type: 'save_paypal' })}
                    className="glass-button-primary"
                  >
                    {isBusy ? 'Saving...' : 'Save PayPal keys'}
                  </button>
                </div>
              ) : null}
            </article>
          </section>

          <section className="section-card space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-2xl font-semibold tracking-tight text-text-primary">Default provider</h2>
              <div className="inline-flex items-center gap-2 text-sm text-text-secondary">
                <CheckCircle2 size={16} className="text-success" />
                Used by invoice 'Pay now'
              </div>
            </div>

            <div className="max-w-sm">
              <select
                value={settings.default_provider}
                disabled={!canManage || isBusy}
                onChange={(event) => mutation.mutate({ type: 'set_default', value: event.target.value })}
                className="glass-input w-full"
              >
                <option value="none">None</option>
                <option value="stripe" disabled={defaultOptions.stripeDisabled}>Stripe</option>
                <option value="paypal" disabled={defaultOptions.paypalDisabled}>PayPal</option>
              </select>
            </div>
            <p className="text-sm text-text-secondary">
              If a default provider gets disabled, backend automatically falls back to <strong>None</strong> to keep settings valid.
            </p>
            {!settings.stripe_enabled && !settings.paypal_enabled ? (
              <p className="text-xs text-warning">Enable Stripe or PayPal first to choose a default provider.</p>
            ) : null}
          </section>
        </>
      ) : null}
    </div>
  );
}
