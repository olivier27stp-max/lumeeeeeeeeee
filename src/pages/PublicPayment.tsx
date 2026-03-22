import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle2, AlertTriangle, CreditCard, Loader2, Lock, ShieldCheck } from 'lucide-react';
import { loadStripe, Stripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { fetchPublicPaymentData, createPublicPaymentIntent } from '../lib/connectApi';
import type { PublicPaymentData, CreatePublicPaymentIntentResponse } from '../lib/connectApi';

function formatMoney(cents: number, currency = 'CAD') {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

// ── Main Public Payment Page ──

export default function PublicPayment() {
  const { token } = useParams<{ token: string }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paymentData, setPaymentData] = useState<PublicPaymentData | null>(null);
  const [intentData, setIntentData] = useState<CreatePublicPaymentIntentResponse | null>(null);
  const [stripePromise, setStripePromise] = useState<Promise<Stripe | null> | null>(null);

  useEffect(() => {
    if (!token) {
      setError('Invalid payment link.');
      setLoading(false);
      return;
    }

    async function load() {
      try {
        const data = await fetchPublicPaymentData(token!);
        setPaymentData(data);

        // If already paid, don't load Stripe
        if (data.status === 'paid') {
          setLoading(false);
          return;
        }

        // Create payment intent
        const intent = await createPublicPaymentIntent(token!);
        setIntentData(intent);

        // Load Stripe with the platform's publishable key
        if (intent.publishable_key) {
          setStripePromise(loadStripe(intent.publishable_key));
        }
      } catch (err: any) {
        setError(err?.message || 'Failed to load payment page.');
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [token]);

  // ── Loading state ──
  if (loading) {
    return (
      <PublicPageShell>
        <div className="flex items-center justify-center py-20">
          <Loader2 size={28} className="animate-spin text-neutral-500" />
        </div>
      </PublicPageShell>
    );
  }

  // ── Error state ──
  if (error) {
    return (
      <PublicPageShell>
        <div className="text-center py-12">
          <AlertTriangle size={36} className="mx-auto text-amber-500 mb-3" />
          <h2 className="text-lg font-bold text-neutral-800 dark:text-neutral-100">Payment Unavailable</h2>
          <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">{error}</p>
        </div>
      </PublicPageShell>
    );
  }

  // ── Already paid ──
  if (paymentData?.status === 'paid') {
    return (
      <PublicPageShell business={paymentData.business}>
        <div className="text-center py-12">
          <CheckCircle2 size={48} className="mx-auto text-green-500 mb-4" />
          <h2 className="text-xl font-bold text-neutral-800 dark:text-neutral-100">Payment Complete</h2>
          <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
            This invoice has already been paid. Thank you!
          </p>
          {paymentData.amount_cents > 0 && (
            <p className="mt-3 text-lg font-semibold text-neutral-700 dark:text-neutral-200">
              {formatMoney(paymentData.amount_cents, paymentData.currency)}
            </p>
          )}
        </div>
      </PublicPageShell>
    );
  }

  // ── Payment form ──
  if (!paymentData || !intentData || !stripePromise) {
    return (
      <PublicPageShell>
        <div className="text-center py-12">
          <AlertTriangle size={36} className="mx-auto text-amber-500 mb-3" />
          <h2 className="text-lg font-bold text-neutral-800 dark:text-neutral-100">Unable to Load Payment</h2>
          <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
            Please try again or contact the business directly.
          </p>
        </div>
      </PublicPageShell>
    );
  }

  return (
    <PublicPageShell business={paymentData.business}>
      {/* Invoice Details */}
      <div className="mb-6">
        {paymentData.client && (
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            Payment for {paymentData.client.name}
          </p>
        )}
        {paymentData.invoice && (
          <div className="mt-3 rounded-lg border border-neutral-200 dark:border-neutral-700 p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium text-neutral-600 dark:text-neutral-300">
                Invoice {paymentData.invoice.invoice_number}
              </span>
              {paymentData.invoice.subject && (
                <span className="text-xs text-neutral-400">{paymentData.invoice.subject}</span>
              )}
            </div>

            {/* Line items */}
            {paymentData.items && paymentData.items.length > 0 && (
              <div className="border-t border-neutral-100 dark:border-neutral-700 pt-3 space-y-2">
                {paymentData.items.map((item) => (
                  <div key={item.id} className="flex items-center justify-between text-sm">
                    <span className="text-neutral-600 dark:text-neutral-300">
                      {item.description}
                      {item.qty > 1 && <span className="text-neutral-400 ml-1">x{item.qty}</span>}
                    </span>
                    <span className="text-neutral-700 dark:text-neutral-200 font-medium">
                      {formatMoney(item.line_total_cents, paymentData.currency)}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div className="border-t border-neutral-200 dark:border-neutral-600 mt-3 pt-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-neutral-800 dark:text-neutral-100">Amount Due</span>
                <span className="text-xl font-bold text-neutral-900 dark:text-neutral-50">
                  {formatMoney(paymentData.amount_cents, paymentData.currency)}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Stripe Payment Form */}
      <Elements
        stripe={stripePromise}
        options={{
          clientSecret: intentData.client_secret,
          appearance: {
            theme: 'stripe',
            variables: {
              colorPrimary: '#2563eb',
              borderRadius: '8px',
            },
          },
        }}
      >
        <CheckoutForm
          amountCents={paymentData.amount_cents}
          currency={paymentData.currency}
          publicToken={token!}
        />
      </Elements>
    </PublicPageShell>
  );
}

// ── Stripe Checkout Form ──

function CheckoutForm({ amountCents, currency, publicToken }: {
  amountCents: number;
  currency: string;
  publicToken: string;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [processing, setProcessing] = useState(false);
  const [succeeded, setSucceeded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;

    setProcessing(true);
    setError(null);

    const { error: submitError } = await elements.submit();
    if (submitError) {
      setError(submitError.message || 'Validation error.');
      setProcessing(false);
      return;
    }

    const { error: confirmError } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: `${window.location.href.split('?')[0]}?result=success`,
      },
      redirect: 'if_required',
    });

    if (confirmError) {
      setError(confirmError.message || 'Payment failed. Please try again.');
      setProcessing(false);
      return;
    }

    // Payment succeeded without redirect
    setSucceeded(true);
    setProcessing(false);
  }

  if (succeeded) {
    return (
      <div className="text-center py-8">
        <CheckCircle2 size={48} className="mx-auto text-green-500 mb-4" />
        <h3 className="text-lg font-bold text-neutral-800 dark:text-neutral-100">Payment Successful!</h3>
        <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
          Thank you for your payment of {formatMoney(amountCents, currency)}.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <PaymentElement />

      {error && (
        <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 p-3">
          <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
        </div>
      )}

      <button
        type="submit"
        disabled={!stripe || processing}
        className="w-full rounded-lg bg-neutral-900 text-white py-3 px-4 font-semibold text-sm
                   hover:bg-neutral-800 disabled:opacity-50 disabled:cursor-not-allowed
                   inline-flex items-center justify-center gap-2 transition-colors"
      >
        {processing ? (
          <>
            <Loader2 size={16} className="animate-spin" />
            Processing...
          </>
        ) : (
          <>
            <Lock size={16} />
            Pay {formatMoney(amountCents, currency)}
          </>
        )}
      </button>

      <div className="flex items-center justify-center gap-1.5 text-xs text-neutral-400">
        <ShieldCheck size={12} />
        <span>Secured by Stripe. Your card details are encrypted.</span>
      </div>
    </form>
  );
}

// ── Public Page Shell (layout wrapper) ──

function PublicPageShell({ children, business }: {
  children: React.ReactNode;
  business?: { name: string | null; logo_url: string | null; email: string | null; phone: string | null } | null;
}) {
  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-900 flex flex-col">
      {/* Header */}
      <header className="border-b border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-4 py-4">
        <div className="max-w-lg mx-auto flex items-center gap-3">
          {business?.logo_url ? (
            <img src={business.logo_url} alt={business.name || ''} className="h-8 w-8 rounded-lg object-cover" />
          ) : (
            <div className="h-8 w-8 rounded-lg bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center">
              <CreditCard size={16} className="text-text-primary dark:text-neutral-400" />
            </div>
          )}
          <span className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">
            {business?.name || 'Payment'}
          </span>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 px-4 py-8">
        <div className="max-w-lg mx-auto bg-white dark:bg-neutral-800 rounded-xl shadow-sm border border-neutral-200 dark:border-neutral-700 p-6">
          {children}
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-4 py-3">
        <div className="max-w-lg mx-auto flex items-center justify-between text-xs text-neutral-400">
          <span>Powered by Lume</span>
          {business?.email && <a href={`mailto:${business.email}`} className="hover:underline">{business.email}</a>}
        </div>
      </footer>
    </div>
  );
}
