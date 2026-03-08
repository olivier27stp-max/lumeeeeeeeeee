import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Loader2, X } from 'lucide-react';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';
import { PayPalButtons, PayPalScriptProvider } from '@paypal/react-paypal-js';
import { toast } from 'sonner';
import {
  capturePayPalOrder,
  createPayPalOrder,
  createStripeIntent,
  EnabledProvider,
  fetchPaymentSettings,
  formatMoneyFromCents,
  PaymentSettingsResponse,
} from '../lib/paymentsApi';

interface InvoicePaymentModalProps {
  open: boolean;
  invoiceId: string;
  invoiceNumber: string;
  balanceCents: number;
  currency: string;
  onClose: () => void;
  onPaid: () => void;
}

function StripePaymentForm({
  amountLabel,
  onSuccess,
}: {
  amountLabel: string;
  onSuccess: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!stripe || !elements) return;

    setSubmitting(true);
    setErrorMessage(null);

    const result = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: window.location.href,
      },
      redirect: 'if_required',
    });

    setSubmitting(false);

    if (result.error) {
      setErrorMessage(result.error.message || 'Card payment failed.');
      return;
    }

    const status = result.paymentIntent?.status;
    if (status === 'succeeded' || status === 'processing' || status === 'requires_capture') {
      toast.success('Payment submitted successfully.');
      onSuccess();
      return;
    }

    toast.message('Payment submitted. Waiting for final confirmation.');
    onSuccess();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <PaymentElement options={{ layout: 'tabs' }} />
      {errorMessage ? (
        <p className="rounded-lg border border-danger bg-danger-light px-3 py-2 text-sm text-danger">{errorMessage}</p>
      ) : null}
      <button type="submit" disabled={submitting || !stripe || !elements} className="glass-button-primary w-full">
        {submitting ? 'Processing card...' : `Pay ${amountLabel}`}
      </button>
    </form>
  );
}

export default function InvoicePaymentModal(props: InvoicePaymentModalProps) {
  const { open, onClose, invoiceId, invoiceNumber, balanceCents, currency, onPaid } = props;

  const [settingsPayload, setSettingsPayload] = useState<PaymentSettingsResponse | null>(null);
  const [loadingProviders, setLoadingProviders] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  const [selectedProvider, setSelectedProvider] = useState<EnabledProvider | null>(null);

  const [stripeClientSecret, setStripeClientSecret] = useState<string | null>(null);
  const [stripePublishableKey, setStripePublishableKey] = useState<string | null>(null);
  const [stripeLoading, setStripeLoading] = useState(false);
  const [stripeError, setStripeError] = useState<string | null>(null);

  const [paypalBusy, setPaypalBusy] = useState(false);

  useEffect(() => {
    if (!open) return;

    setLoadingProviders(true);
    setStatusError(null);

    fetchPaymentSettings()
      .then((payload) => {
        setSettingsPayload(payload);
      })
      .catch((error: Error) => {
        setStatusError(error.message || 'Unable to load payment providers.');
      })
      .finally(() => {
        setLoadingProviders(false);
      });
  }, [open]);

  const enabledProviders = useMemo(() => {
    if (!settingsPayload?.settings) return [] as EnabledProvider[];
    const next: EnabledProvider[] = [];

    if (settingsPayload.settings.stripe_enabled && settingsPayload.settings.stripe_keys_present) next.push('stripe');
    if (settingsPayload.settings.paypal_enabled && settingsPayload.settings.paypal_keys_present) next.push('paypal');

    return next;
  }, [settingsPayload]);

  useEffect(() => {
    if (!open) return;

    const preferred = settingsPayload?.settings.default_provider;
    const resolvedDefault = preferred && preferred !== 'none' && enabledProviders.includes(preferred)
      ? preferred
      : enabledProviders[0] || null;

    setSelectedProvider(resolvedDefault);
  }, [open, settingsPayload, enabledProviders]);

  useEffect(() => {
    if (!open) return;
    if (selectedProvider !== 'stripe') return;
    if (!invoiceId) return;
    if (stripeClientSecret) return;

    setStripeLoading(true);
    setStripeError(null);

    createStripeIntent(invoiceId)
      .then((payload) => {
        setStripeClientSecret(payload.client_secret);
        setStripePublishableKey(payload.publishable_key);
      })
      .catch((error: Error) => {
        setStripeError(error.message || 'Unable to initialize Stripe payment intent.');
      })
      .finally(() => {
        setStripeLoading(false);
      });
  }, [open, selectedProvider, invoiceId, stripeClientSecret]);

  useEffect(() => {
    if (!open) {
      setSettingsPayload(null);
      setSelectedProvider(null);
      setStatusError(null);
      setStripeClientSecret(null);
      setStripePublishableKey(null);
      setStripeError(null);
      setStripeLoading(false);
      setPaypalBusy(false);
    }
  }, [open]);

  const stripePromise = useMemo(() => {
    if (!stripePublishableKey) return null;
    return loadStripe(stripePublishableKey);
  }, [stripePublishableKey]);

  const amountLabel = formatMoneyFromCents(balanceCents, currency || 'CAD');
  if (!open) return null;

  async function handlePayPalCapture(orderId: string) {
    setPaypalBusy(true);
    try {
      await capturePayPalOrder(orderId);
      toast.success('PayPal payment captured.');
      onPaid();
      onClose();
    } catch (error: any) {
      toast.error(error?.message || 'PayPal capture failed.');
    } finally {
      setPaypalBusy(false);
    }
  }

  const paypalClientId = settingsPayload?.settings.paypal_client_id || '';
  const paypalScriptOptions = {
    clientId: paypalClientId,
    currency: (currency || 'CAD').toUpperCase(),
    intent: 'capture',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4">
      <div className="glass w-full max-w-xl rounded-2xl border border-white/25 p-5">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-2xl font-semibold tracking-tight text-text-primary">Pay invoice #{invoiceNumber}</h3>
            <p className="mt-1 text-sm text-text-secondary">Outstanding balance: {amountLabel}</p>
          </div>
          <button type="button" onClick={onClose} className="glass-button !p-2" aria-label="Close">
            <X size={16} />
          </button>
        </div>

        {loadingProviders ? (
          <div className="flex min-h-[220px] items-center justify-center text-sm text-text-secondary">
            <Loader2 size={16} className="mr-2 animate-spin" />
            Loading payment providers...
          </div>
        ) : null}

        {!loadingProviders && statusError ? (
          <p className="rounded-lg border border-danger bg-danger-light px-3 py-2 text-sm text-danger">{statusError}</p>
        ) : null}

        {!loadingProviders && !statusError ? (
          <div className="space-y-4">
            {enabledProviders.length === 0 ? (
              <div className="rounded-xl border border-warning bg-warning-light p-4 text-sm text-warning">
                <p className="inline-flex items-center gap-2 font-medium">
                  <AlertTriangle size={14} />
                  No payment provider is currently enabled.
                </p>
                <p className="mt-2">Enable Stripe or PayPal in Payment settings before collecting invoice payments.</p>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  {enabledProviders.map((provider) => (
                    <button
                      key={provider}
                      type="button"
                      onClick={() => {
                        setSelectedProvider(provider);
                        if (provider === 'stripe') {
                          setStripeClientSecret(null);
                          setStripePublishableKey(null);
                          setStripeError(null);
                        }
                      }}
                      className={
                        selectedProvider === provider
                          ? 'glass-button-primary !py-1.5 !text-xs uppercase tracking-wide'
                          : 'glass-button !py-1.5 !text-xs uppercase tracking-wide'
                      }
                    >
                      {provider}
                    </button>
                  ))}
                </div>

                {selectedProvider === 'stripe' ? (
                  <div className="space-y-3 rounded-xl border border-white/25 bg-surface/55 p-4">
                    {stripeLoading ? <p className="text-sm text-text-secondary">Preparing secure card form...</p> : null}
                    {stripeError ? (
                      <p className="rounded-lg border border-danger bg-danger-light px-3 py-2 text-sm text-danger">{stripeError}</p>
                    ) : null}

                    {stripeClientSecret && stripePromise ? (
                      <Elements stripe={stripePromise} options={{ clientSecret: stripeClientSecret }}>
                        <StripePaymentForm
                          amountLabel={amountLabel}
                          onSuccess={() => {
                            onPaid();
                            onClose();
                          }}
                        />
                      </Elements>
                    ) : null}
                  </div>
                ) : null}

                {selectedProvider === 'paypal' ? (
                  <div className="space-y-3 rounded-xl border border-white/25 bg-surface/55 p-4">
                    {!paypalClientId ? (
                      <p className="rounded-lg border border-danger bg-danger-light px-3 py-2 text-sm text-danger">
                        PayPal client id is missing from server configuration.
                      </p>
                    ) : (
                      <PayPalScriptProvider options={paypalScriptOptions as any}>
                        <PayPalButtons
                          disabled={paypalBusy}
                          style={{ layout: 'vertical', shape: 'pill', label: 'pay' }}
                          createOrder={async () => {
                            const order = await createPayPalOrder(invoiceId);
                            return order.order_id;
                          }}
                          onApprove={async (data) => {
                            if (!data.orderID) throw new Error('PayPal order id is missing.');
                            await handlePayPalCapture(data.orderID);
                          }}
                          onError={(error) => {
                            const message = error instanceof Error ? error.message : 'PayPal payment failed.';
                            toast.error(message);
                          }}
                        />
                      </PayPalScriptProvider>
                    )}
                  </div>
                ) : null}
              </>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
