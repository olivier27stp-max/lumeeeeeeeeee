import React, { useEffect, useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle, XCircle, PenLine, Download, Phone, Mail, Globe, MapPin, Calendar, Hash, User, FileText, CreditCard, Loader2, AlertCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { formatQuoteMoney } from '../lib/quotesApi';
import { loadStripe, Stripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';

// ── Lume fallback logo (panda) ──
const LUME_LOGO_URL = '/lume-logo.png';

interface CompanyBranding {
  company_name: string;
  logo_url: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  street1: string | null;
  city: string | null;
  province: string | null;
  postal_code: string | null;
  country: string | null;
}

interface QuoteData {
  quote: {
    id: string;
    quote_number: string;
    title: string;
    status: string;
    valid_until: string | null;
    created_at: string | null;
    subtotal_cents: number;
    discount_cents: number;
    tax_rate_label: string;
    tax_cents: number;
    total_cents: number;
    currency: string;
    notes: string | null;
    contract_disclaimer: string | null;
    deposit_required: boolean;
    deposit_type: string | null;
    deposit_value: number;
    deposit_cents: number;
    deposit_status: string | null;
    require_payment_method: boolean;
    approved_at: string | null;
    declined_at: string | null;
    org_id: string;
    view_token: string;
  };
  company: CompanyBranding;
  client: { first_name: string; last_name: string; company: string | null; email: string | null; phone: string | null } | null;
  lead: { first_name: string; last_name: string; company: string | null; email: string | null; phone: string | null } | null;
  items: Array<{
    id: string;
    name: string;
    description: string | null;
    quantity: number;
    unit_price_cents: number;
    total_cents: number;
    is_optional: boolean;
    item_type: string;
  }>;
  signature: {
    signer_name: string;
    signature_url: string;
    signed_at: string;
  } | null;
}

type ViewState = 'loading' | 'error' | 'view' | 'accepted' | 'declined' | 'deposit_payment';

// ── Helpers ──
function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function calcDepositAmount(quote: QuoteData['quote']): number {
  if (!quote.deposit_required || !quote.deposit_value) return 0;
  if (quote.deposit_cents > 0) return quote.deposit_cents;
  if (quote.deposit_type === 'percentage') {
    return Math.round(quote.total_cents * quote.deposit_value / 100);
  }
  return Math.round(quote.deposit_value * 100);
}

function buildCompanyAddress(c: CompanyBranding): string | null {
  const parts = [c.street1, c.city, c.province, c.postal_code].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : null;
}

// ══════════════════════════════════════════════════════════════
// Stripe Deposit Payment Form
// ══════════════════════════════════════════════════════════════

function DepositPaymentForm({ onSuccess, onError }: { onSuccess: () => Promise<void> | void; onError: (msg: string) => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [processing, setProcessing] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setProcessing(true);
    try {
      const { error } = await stripe.confirmPayment({
        elements,
        confirmParams: { return_url: window.location.href },
        redirect: 'if_required',
      });
      if (error) {
        onError(error.message || 'Payment failed.');
      } else {
        await onSuccess();
      }
    } catch (err: any) {
      onError(err?.message || 'Payment failed.');
    } finally {
      setProcessing(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <PaymentElement />
      <button
        type="submit"
        disabled={processing || !stripe || !elements}
        className="w-full bg-[#111] text-white py-3 rounded-lg font-medium text-[14px] hover:bg-[#222] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
      >
        {processing ? (
          <><Loader2 size={16} className="animate-spin" /> Processing...</>
        ) : (
          <><CreditCard size={16} /> Pay Deposit Now</>
        )}
      </button>
    </form>
  );
}

// ══════════════════════════════════════════════════════════════
// Main Component
// ══════════════════════════════════════════════════════════════

export default function QuoteView() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<QuoteData | null>(null);
  const [viewState, setViewState] = useState<ViewState>('loading');
  const [error, setError] = useState('');
  const [accepting, setAccepting] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [showSignature, setShowSignature] = useState(false);
  const [signatureData, setSignatureData] = useState<string | null>(null);
  const [signerName, setSignerName] = useState('');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawingRef = useRef(false);

  // Deposit payment state
  const [depositIntentData, setDepositIntentData] = useState<{ client_secret: string; publishable_key: string; amount_cents: number; currency: string; payment_intent_id: string } | null>(null);
  const [stripePromise, setStripePromise] = useState<Promise<Stripe | null> | null>(null);
  const [depositPaid, setDepositPaid] = useState(false);
  const [depositError, setDepositError] = useState<string | null>(null);
  const [depositLoading, setDepositLoading] = useState(false);

  useEffect(() => {
    if (!token) return;
    loadQuote();
  }, [token]);

  async function loadQuote() {
    try {
      const { data: quote, error: qErr } = await supabase
        .from('quotes')
        .select('id, quote_number, title, status, valid_until, created_at, subtotal_cents, discount_cents, tax_rate_label, tax_cents, total_cents, currency, notes, contract_disclaimer, deposit_required, deposit_type, deposit_value, deposit_cents, deposit_status, require_payment_method, approved_at, declined_at, org_id, view_token, client_id, lead_id')
        .eq('view_token', token)
        .is('deleted_at', null)
        .maybeSingle();

      if (qErr || !quote) {
        setError('Quote not found');
        setViewState('error');
        return;
      }

      // Track view
      const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3002';
      fetch(`${API_BASE}/api/quotes/${quote.id}/track-view`, { method: 'POST' }).catch(() => {});

      // Get company branding (full details)
      const { data: companyData } = await supabase
        .from('company_settings')
        .select('company_name, logo_url, phone, email, website, street1, city, province, postal_code, country')
        .eq('org_id', quote.org_id)
        .maybeSingle();

      // Get line items
      const { data: items } = await supabase
        .from('quote_line_items')
        .select('id, name, description, quantity, unit_price_cents, total_cents, is_optional, item_type')
        .eq('quote_id', quote.id)
        .order('sort_order', { ascending: true });

      // Get client or lead (with phone)
      let client = null;
      let lead = null;
      if (quote.client_id) {
        const { data: c } = await supabase
          .from('clients')
          .select('first_name, last_name, company, email, phone')
          .eq('id', quote.client_id)
          .maybeSingle();
        client = c;
      }
      if (quote.lead_id) {
        const { data: l } = await supabase
          .from('leads')
          .select('first_name, last_name, company, email, phone')
          .eq('id', quote.lead_id)
          .maybeSingle();
        lead = l;
      }

      // Load signature if quote was accepted (via backend to bypass RLS)
      let signature = null;
      if (['approved', 'converted'].includes(quote.status)) {
        try {
          const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3002';
          const sigRes = await fetch(`${API_BASE}/api/quotes/public/signature?view_token=${token}`);
          if (sigRes.ok) {
            const sigData = await sigRes.json();
            if (sigData?.signature_url) {
              signature = {
                signer_name: sigData.signer_name || '',
                signature_url: sigData.signature_url,
                signed_at: sigData.signed_at || quote.approved_at,
              };
            }
          }
        } catch {
          // Signature display is non-critical
        }
      }

      setData({
        quote: {
          id: quote.id,
          quote_number: quote.quote_number,
          title: quote.title,
          status: quote.status,
          valid_until: quote.valid_until,
          created_at: quote.created_at,
          subtotal_cents: Number(quote.subtotal_cents || 0),
          discount_cents: Number(quote.discount_cents || 0),
          tax_rate_label: quote.tax_rate_label || 'Tax',
          tax_cents: Number(quote.tax_cents || 0),
          total_cents: Number(quote.total_cents || 0),
          currency: quote.currency || 'CAD',
          notes: quote.notes,
          contract_disclaimer: quote.contract_disclaimer,
          deposit_required: quote.deposit_required,
          deposit_type: quote.deposit_type,
          deposit_value: Number(quote.deposit_value || 0),
          deposit_cents: Number(quote.deposit_cents || 0),
          deposit_status: quote.deposit_status || null,
          require_payment_method: quote.require_payment_method || false,
          approved_at: quote.approved_at,
          declined_at: quote.declined_at,
          org_id: quote.org_id,
          view_token: quote.view_token,
        },
        company: {
          company_name: companyData?.company_name || 'Business',
          logo_url: companyData?.logo_url || null,
          phone: companyData?.phone || null,
          email: companyData?.email || null,
          website: companyData?.website || null,
          street1: companyData?.street1 || null,
          city: companyData?.city || null,
          province: companyData?.province || null,
          postal_code: companyData?.postal_code || null,
          country: companyData?.country || null,
        },
        client,
        lead,
        items: (items || []).map((i: any) => ({
          id: i.id,
          name: i.name,
          description: i.description,
          quantity: Number(i.quantity || 0),
          unit_price_cents: Number(i.unit_price_cents || 0),
          total_cents: Number(i.total_cents || 0),
          is_optional: i.is_optional,
          item_type: i.item_type,
        })),
        signature,
      });

      if (quote.status === 'approved') {
        // Check if deposit is pending - auto-load payment
        if (quote.deposit_required && (quote.deposit_status === 'pending' || quote.deposit_status === 'not_required') && Number(quote.deposit_value || 0) > 0 && quote.deposit_status !== 'paid') {
          setViewState('deposit_payment');
          // Auto-load deposit intent after setting data
          setTimeout(() => loadDepositIntent(), 100);
        } else {
          setViewState('accepted');
        }
      } else if (quote.status === 'declined') {
        setViewState('declined');
      } else {
        setViewState('view');
      }
    } catch (err: any) {
      setError('Could not load quote');
      setViewState('error');
    }
  }

  // ── Signature pad ──
  function initCanvas() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }

  function getPos(e: React.MouseEvent | React.TouchEvent) {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    if ('touches' in e) {
      return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
    }
    return { x: (e as React.MouseEvent).clientX - rect.left, y: (e as React.MouseEvent).clientY - rect.top };
  }

  function startDraw(e: React.MouseEvent | React.TouchEvent) {
    e.preventDefault();
    isDrawingRef.current = true;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const pos = getPos(e);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
  }

  function draw(e: React.MouseEvent | React.TouchEvent) {
    if (!isDrawingRef.current) return;
    e.preventDefault();
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const pos = getPos(e);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
  }

  function endDraw() {
    isDrawingRef.current = false;
    if (canvasRef.current) {
      setSignatureData(canvasRef.current.toDataURL('image/png'));
    }
  }

  function clearSignature() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setSignatureData(null);
  }

  // ── Load deposit payment intent ──
  async function loadDepositIntent() {
    if (!token) return;
    setDepositLoading(true);
    setDepositError(null);
    try {
      const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3002';
      const depositRes = await fetch(`${API_BASE}/api/quotes/public/deposit-intent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ view_token: token }),
      });
      const depositResult = await depositRes.json().catch(() => ({}));

      if (depositRes.ok && (depositResult as any).client_secret) {
        const intent = depositResult as any;
        setDepositIntentData({
          client_secret: intent.client_secret,
          publishable_key: intent.publishable_key,
          amount_cents: intent.amount_cents,
          currency: intent.currency,
          payment_intent_id: intent.payment_intent_id,
        });
        if (intent.publishable_key) {
          setStripePromise(loadStripe(intent.publishable_key));
        }
      } else {
        setDepositError((depositResult as any)?.error || 'Unable to load payment. Please try again.');
      }
    } catch {
      setDepositError('Unable to connect to payment service. Please try again.');
    } finally {
      setDepositLoading(false);
    }
  }

  // ── Confirm deposit payment with server ──
  async function confirmDepositPayment(paymentIntentId: string) {
    try {
      const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3002';
      await fetch(`${API_BASE}/api/quotes/public/deposit-confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ view_token: token, payment_intent_id: paymentIntentId }),
      });
    } catch {
      // Webhook will handle it if this fails
    }
  }

  // ── Accept / Decline ──
  async function handleAccept() {
    if (!data || !signatureData || !signerName.trim()) return;
    setAccepting(true);
    try {
      const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3002';
      const res = await fetch(`${API_BASE}/api/quotes/public/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          view_token: token,
          signer_name: signerName.trim(),
          signature_data: signatureData,
        }),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((result as any)?.error || 'Failed to accept quote');

      // If deposit is required, transition to payment step
      if (data.quote.deposit_required && data.quote.deposit_value > 0) {
        setViewState('deposit_payment');
        // Load the payment intent immediately
        await loadDepositIntent();
      } else {
        setViewState('accepted');
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to accept quote. Please try again.');
    } finally {
      setAccepting(false);
    }
  }

  async function handleDecline() {
    if (!data) return;
    setDeclining(true);
    try {
      const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3002';
      const res = await fetch(`${API_BASE}/api/quotes/public/decline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ view_token: token }),
      });
      if (!res.ok) throw new Error('Failed to decline quote');
      setViewState('declined');
    } catch (err) {
      setError('Failed to decline quote. Please try again.');
    } finally {
      setDeclining(false);
    }
  }

  // ── Loading ──
  if (viewState === 'loading') {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-[#e5e5e5] border-t-[#111] rounded-full animate-spin" />
      </div>
    );
  }

  // ── Error ──
  if (viewState === 'error' || !data) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <FileText size={36} className="text-[#d4d4d4] mx-auto mb-3" />
          <h1 className="text-[16px] font-semibold text-[#111]">Quote Not Found</h1>
          <p className="text-[13px] text-[#888] mt-1">This link may have expired or is invalid.</p>
        </div>
      </div>
    );
  }

  const { quote, company, client, lead, items, signature } = data;
  const cur = quote.currency;
  const contact = client || lead;
  const isExpired = quote.valid_until && new Date(quote.valid_until) < new Date();
  const canRespond = ['sent', 'awaiting_response', 'action_required'].includes(quote.status) && !isExpired;
  const requiredItems = items.filter(i => !i.is_optional);
  const optionalItems = items.filter(i => i.is_optional);
  const depositAmount = calcDepositAmount(quote);
  const companyAddress = buildCompanyAddress(company);

  // Company logo: fallback to Lume panda
  const logoUrl = company.logo_url || LUME_LOGO_URL;

  return (
    <div className="min-h-screen bg-[#fafafa]">
      {/* Print / PDF styles */}
      <style>{`
        @media print {
          body { background: white !important; }
          .no-print { display: none !important; }
          .quote-doc { box-shadow: none !important; border: none !important; margin: 0 !important; padding: 32px !important; max-width: 100% !important; }
        }
      `}</style>

      <div className="max-w-[680px] mx-auto py-8 px-4 sm:py-12">
        {/* Status banners */}
        {viewState === 'accepted' && (
          <div className="bg-[#f8f8f8] border border-[#e0e0e0] rounded-lg p-4 mb-5 flex items-center gap-3 no-print">
            <CheckCircle className="text-[#333] shrink-0" size={18} />
            <div>
              <p className="font-semibold text-[#111] text-[14px]">Quote Accepted</p>
              <p className="text-[13px] text-[#666]">Thank you for your approval. We'll be in touch shortly.</p>
            </div>
          </div>
        )}
        {viewState === 'declined' && (
          <div className="bg-[#f8f8f8] border border-[#e0e0e0] rounded-lg p-4 mb-5 flex items-center gap-3 no-print">
            <XCircle className="text-[#666] shrink-0" size={18} />
            <div>
              <p className="font-semibold text-[#111] text-[14px]">Quote Declined</p>
              <p className="text-[13px] text-[#666]">This quote has been declined.</p>
            </div>
          </div>
        )}

        {/* ═══ QUOTE DOCUMENT ═══ */}
        <div className="quote-doc bg-white rounded-lg border border-[#e5e5e5] shadow-sm overflow-hidden">

          {/* ── HEADER ── */}
          <div className="px-8 pt-8 pb-6">
            <div className="flex items-start justify-between">
              {/* Logo + Company info */}
              <div className="flex-1">
                <img
                  src={logoUrl}
                  alt={company.company_name}
                  className="h-10 max-w-[180px] object-contain mb-3"
                  onError={(e) => { (e.target as HTMLImageElement).src = LUME_LOGO_URL; }}
                />
                <h2 className="text-[14px] font-semibold text-[#111]">{company.company_name}</h2>
                {companyAddress && (
                  <p className="text-[12px] text-[#888] mt-0.5">{companyAddress}</p>
                )}
                <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1">
                  {company.phone && (
                    <span className="text-[12px] text-[#888]">{company.phone}</span>
                  )}
                  {company.email && (
                    <span className="text-[12px] text-[#888]">{company.email}</span>
                  )}
                  {company.website && (
                    <span className="text-[12px] text-[#888]">{company.website}</span>
                  )}
                </div>
              </div>

              {/* Quote label + number */}
              <div className="text-right ml-6">
                <h1 className="text-[28px] font-bold text-[#111] tracking-tight leading-none">QUOTE</h1>
                <p className="text-[13px] text-[#888] mt-1 font-medium">#{quote.quote_number}</p>
              </div>
            </div>
          </div>

          {/* ── Divider ── */}
          <div className="border-t border-[#eee]" />

          {/* ── META ROW: Client + Quote Details ── */}
          <div className="px-8 py-5 grid grid-cols-2 gap-6">
            {/* Client info */}
            <div>
              <p className="text-[10px] font-semibold text-[#aaa] uppercase tracking-[0.08em] mb-2">Prepared For</p>
              {contact ? (
                <>
                  <p className="text-[14px] font-semibold text-[#111]">
                    {contact.first_name} {contact.last_name}
                  </p>
                  {contact.company && (
                    <p className="text-[12px] text-[#666] mt-0.5">{contact.company}</p>
                  )}
                  {contact.email && (
                    <p className="text-[12px] text-[#888] mt-0.5">{contact.email}</p>
                  )}
                  {contact.phone && (
                    <p className="text-[12px] text-[#888] mt-0.5">{contact.phone}</p>
                  )}
                </>
              ) : (
                <p className="text-[13px] text-[#aaa]">--</p>
              )}
            </div>

            {/* Quote details */}
            <div className="text-right space-y-1.5">
              <p className="text-[10px] font-semibold text-[#aaa] uppercase tracking-[0.08em] mb-2">Details</p>
              {quote.created_at && (
                <div className="flex justify-end gap-2 text-[12px]">
                  <span className="text-[#888]">Date</span>
                  <span className="text-[#333] font-medium">{fmtDate(quote.created_at)}</span>
                </div>
              )}
              {quote.valid_until && (
                <div className="flex justify-end gap-2 text-[12px]">
                  <span className="text-[#888]">{isExpired ? 'Expired' : 'Valid Until'}</span>
                  <span className={`font-medium ${isExpired ? 'text-[#999]' : 'text-[#333]'}`}>
                    {fmtDate(quote.valid_until)}
                  </span>
                </div>
              )}
              <div className="flex justify-end gap-2 text-[12px]">
                <span className="text-[#888]">Status</span>
                <span className={`font-medium ${
                  quote.status === 'approved' ? 'text-[#333]' :
                  quote.status === 'declined' ? 'text-[#999]' :
                  isExpired ? 'text-[#999]' :
                  'text-[#333]'
                }`}>
                  {quote.status === 'approved' ? 'Approved' :
                   quote.status === 'declined' ? 'Declined' :
                   isExpired ? 'Expired' : 'Pending Review'}
                </span>
              </div>
            </div>
          </div>

          {/* ── Title / description ── */}
          {quote.title && (
            <div className="px-8 pb-4">
              <p className="text-[14px] font-medium text-[#333]">{quote.title}</p>
            </div>
          )}

          {/* ── Divider ── */}
          <div className="border-t border-[#eee]" />

          {/* ── LINE ITEMS TABLE ── */}
          <div className="px-8 py-6">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-[#e5e5e5]">
                  <th className="text-left py-2.5 font-semibold text-[#888] text-[11px] uppercase tracking-[0.05em]">Description</th>
                  <th className="text-center py-2.5 font-semibold text-[#888] text-[11px] uppercase tracking-[0.05em] w-16">Qty</th>
                  <th className="text-right py-2.5 font-semibold text-[#888] text-[11px] uppercase tracking-[0.05em] w-24">Price</th>
                  <th className="text-right py-2.5 font-semibold text-[#888] text-[11px] uppercase tracking-[0.05em] w-24">Total</th>
                </tr>
              </thead>
              <tbody>
                {requiredItems.map((item) => (
                  <tr key={item.id} className="border-b border-[#f0f0f0]">
                    {item.item_type === 'heading' ? (
                      <td colSpan={4} className="py-3 font-semibold text-[#111] text-[13px]">{item.name}</td>
                    ) : (
                      <>
                        <td className="py-3 text-[#222]">
                          <div className="font-medium">{item.name}</div>
                          {item.description && (
                            <div className="text-[11px] text-[#999] mt-0.5 leading-relaxed">{item.description}</div>
                          )}
                        </td>
                        <td className="py-3 text-center text-[#666]">{item.quantity}</td>
                        <td className="py-3 text-right text-[#666]">{formatQuoteMoney(item.unit_price_cents, cur)}</td>
                        <td className="py-3 text-right font-medium text-[#111]">{formatQuoteMoney(item.total_cents, cur)}</td>
                      </>
                    )}
                  </tr>
                ))}
                {requiredItems.length === 0 && (
                  <tr><td colSpan={4} className="py-8 text-center text-[#ccc] text-[13px]">No items</td></tr>
                )}
              </tbody>
            </table>

            {/* Optional items */}
            {optionalItems.length > 0 && (
              <>
                <p className="text-[11px] font-semibold text-[#aaa] uppercase tracking-[0.05em] mt-6 mb-2">Optional Items</p>
                <table className="w-full text-[13px]">
                  <tbody>
                    {optionalItems.map((item) => (
                      <tr key={item.id} className="border-b border-[#f5f5f5]">
                        <td className="py-2.5 text-[#888] italic">
                          <div>{item.name}</div>
                          {item.description && (
                            <div className="text-[11px] text-[#bbb] mt-0.5">{item.description}</div>
                          )}
                        </td>
                        <td className="py-2.5 text-center text-[#aaa] w-16">{item.quantity}</td>
                        <td className="py-2.5 text-right text-[#aaa] w-24">{formatQuoteMoney(item.unit_price_cents, cur)}</td>
                        <td className="py-2.5 text-right text-[#888] w-24">{formatQuoteMoney(item.total_cents, cur)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>

          {/* ── TOTALS ── */}
          <div className="px-8 pb-6">
            <div className="ml-auto w-full max-w-[280px]">
              <div className="space-y-2 text-[13px]">
                <div className="flex justify-between">
                  <span className="text-[#888]">Subtotal</span>
                  <span className="text-[#333] font-medium">{formatQuoteMoney(quote.subtotal_cents, cur)}</span>
                </div>
                {quote.discount_cents > 0 && (
                  <div className="flex justify-between">
                    <span className="text-[#888]">Discount</span>
                    <span className="text-[#333] font-medium">-{formatQuoteMoney(quote.discount_cents, cur)}</span>
                  </div>
                )}
                {quote.tax_cents > 0 && (
                  <div className="flex justify-between">
                    <span className="text-[#888]">{quote.tax_rate_label}</span>
                    <span className="text-[#333] font-medium">{formatQuoteMoney(quote.tax_cents, cur)}</span>
                  </div>
                )}
                <div className="border-t border-[#e5e5e5] pt-2 mt-2">
                  <div className="flex justify-between text-[15px]">
                    <span className="font-bold text-[#111]">Total</span>
                    <span className="font-bold text-[#111]">{formatQuoteMoney(quote.total_cents, cur)}</span>
                  </div>
                </div>
              </div>

              {/* Deposit info */}
              {quote.deposit_required && quote.deposit_value > 0 && (
                <div className="mt-3 bg-[#f5f5f5] rounded-md px-3 py-2.5">
                  <div className="flex justify-between text-[12px]">
                    <span className="text-[#666] font-medium">Deposit required</span>
                    <span className="text-[#333] font-semibold">
                      {quote.deposit_type === 'percentage'
                        ? `${quote.deposit_value}%`
                        : formatQuoteMoney(quote.deposit_value * 100, cur)}
                    </span>
                  </div>
                  {depositAmount > 0 && (
                    <div className="flex justify-between text-[12px] mt-1">
                      <span className="text-[#888]">Due upon acceptance</span>
                      <span className="text-[#111] font-semibold">{formatQuoteMoney(depositAmount, cur)}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* ── NOTES ── */}
          {quote.notes && (
            <>
              <div className="border-t border-[#eee]" />
              <div className="px-8 py-5">
                <p className="text-[10px] font-semibold text-[#aaa] uppercase tracking-[0.08em] mb-2">Notes</p>
                <p className="text-[13px] text-[#555] whitespace-pre-wrap leading-relaxed">{quote.notes}</p>
              </div>
            </>
          )}

          {/* ── TERMS & CONDITIONS ── */}
          {quote.contract_disclaimer && (
            <>
              <div className="border-t border-[#eee]" />
              <div className="px-8 py-5">
                <p className="text-[10px] font-semibold text-[#aaa] uppercase tracking-[0.08em] mb-2">Terms & Conditions</p>
                <p className="text-[12px] text-[#888] whitespace-pre-wrap leading-relaxed">{quote.contract_disclaimer}</p>
              </div>
            </>
          )}

          {/* ── SIGNATURE / ACCEPT / DECLINE ── */}
          {canRespond && viewState === 'view' && (
            <>
              <div className="border-t border-[#eee]" />
              <div className="px-8 py-6 no-print">
                {!showSignature ? (
                  <div className="flex gap-3">
                    <button
                      onClick={() => {
                        setShowSignature(true);
                        setTimeout(() => initCanvas(), 100);
                      }}
                      className="flex-1 bg-[#111] text-white py-3 rounded-lg font-medium text-[14px] hover:bg-[#222] transition-colors flex items-center justify-center gap-2"
                    >
                      <CheckCircle size={16} />
                      Accept Quote
                    </button>
                    <button
                      onClick={handleDecline}
                      disabled={declining}
                      className="flex-1 bg-white border border-[#ddd] text-[#555] py-3 rounded-lg font-medium text-[14px] hover:bg-[#f8f8f8] transition-colors flex items-center justify-center gap-2"
                    >
                      <XCircle size={16} />
                      {declining ? 'Declining...' : 'Decline'}
                    </button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <h3 className="text-[14px] font-semibold text-[#111] flex items-center gap-2">
                      <PenLine size={16} />
                      Sign to Accept
                    </h3>

                    {/* Deposit notice before signing */}
                    {quote.deposit_required && quote.deposit_value > 0 && (
                      <div className="bg-[#f5f5f5] rounded-md px-3 py-2.5 text-[12px] text-[#555]">
                        <p className="font-medium text-[#333]">
                          A deposit of {formatQuoteMoney(depositAmount, cur)} will be required upon acceptance.
                        </p>
                      </div>
                    )}

                    {/* Signer name */}
                    <div>
                      <label className="block text-[12px] font-medium text-[#666] mb-1">Your Full Name</label>
                      <input
                        type="text"
                        value={signerName}
                        onChange={(e) => setSignerName(e.target.value)}
                        placeholder="Full Name"
                        className="w-full px-3 py-2.5 border border-[#ddd] rounded-lg text-[13px] text-[#111] focus:outline-none focus:ring-1 focus:ring-[#111] focus:border-[#111] placeholder:text-[#ccc]"
                      />
                    </div>

                    {/* Signature canvas */}
                    <div>
                      <label className="block text-[12px] font-medium text-[#666] mb-1">Signature</label>
                      <div className="border border-[#ddd] rounded-lg overflow-hidden bg-white relative">
                        <canvas
                          ref={canvasRef}
                          width={500}
                          height={150}
                          className="w-full cursor-crosshair touch-none"
                          onMouseDown={startDraw}
                          onMouseMove={draw}
                          onMouseUp={endDraw}
                          onMouseLeave={endDraw}
                          onTouchStart={startDraw}
                          onTouchMove={draw}
                          onTouchEnd={endDraw}
                        />
                        {!signatureData && (
                          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                            <p className="text-[12px] text-[#ddd]">Draw your signature here</p>
                          </div>
                        )}
                      </div>
                      <button onClick={clearSignature} className="text-[12px] text-[#888] hover:text-[#333] mt-1 underline">
                        Clear signature
                      </button>
                    </div>

                    {error && (
                      <p className="text-[12px] text-[#c00]">{error}</p>
                    )}

                    {/* Action buttons */}
                    <div className="flex gap-3">
                      <button
                        onClick={handleAccept}
                        disabled={accepting || !signatureData || !signerName.trim()}
                        className="flex-1 bg-[#111] text-white py-3 rounded-lg font-medium text-[14px] hover:bg-[#222] transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                      >
                        <CheckCircle size={16} />
                        {accepting ? 'Accepting...' : 'Confirm & Accept'}
                      </button>
                      <button
                        onClick={() => { setShowSignature(false); clearSignature(); setSignerName(''); setError(''); }}
                        className="px-5 bg-white border border-[#ddd] text-[#555] py-3 rounded-lg font-medium text-[14px] hover:bg-[#f8f8f8] transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {/* ── RECORDED SIGNATURE (shown when quote already accepted) ── */}
          {signature && (viewState === 'accepted' || viewState === 'deposit_payment') && (
            <>
              <div className="border-t border-[#eee]" />
              <div className="px-8 py-5">
                <p className="text-[10px] font-semibold text-[#aaa] uppercase tracking-[0.08em] mb-3">Accepted & Signed</p>
                <div className="flex items-start gap-5">
                  {/* Signature image */}
                  {signature.signature_url && (
                    <div className="border border-[#eee] rounded-md bg-[#fafafa] p-2 flex-shrink-0">
                      <img
                        src={signature.signature_url}
                        alt="Signature"
                        className="h-14 max-w-[200px] object-contain"
                      />
                    </div>
                  )}
                  {/* Signer details */}
                  <div className="text-[12px] space-y-0.5 pt-1">
                    {signature.signer_name && (
                      <p className="text-[#333] font-medium">{signature.signer_name}</p>
                    )}
                    {signature.signed_at && (
                      <p className="text-[#999]">Signed on {fmtDate(signature.signed_at)}</p>
                    )}
                    {quote.approved_at && (
                      <p className="text-[#999]">Accepted on {fmtDate(quote.approved_at)}</p>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}

          {/* ── DEPOSIT PAYMENT STEP ── */}
          {viewState === 'deposit_payment' && (
            <>
              <div className="border-t border-[#eee]" />
              <div className="px-8 py-6 no-print">
                {depositPaid ? (
                  /* ── Success: deposit paid ── */
                  <div className="text-center py-6">
                    <div className="w-12 h-12 rounded-full bg-[#f5f5f5] flex items-center justify-center mx-auto mb-4">
                      <CheckCircle size={24} className="text-[#333]" />
                    </div>
                    <h3 className="text-[18px] font-semibold text-[#111]">Deposit Paid</h3>
                    <p className="text-[13px] text-[#888] mt-2 max-w-sm mx-auto">
                      Your deposit of <span className="font-semibold text-[#111]">{formatQuoteMoney(depositAmount, cur)}</span> has been received.
                      Thank you for confirming your quote.
                    </p>
                    <div className="mt-4 bg-[#f8f8f8] rounded-md px-4 py-3 inline-block">
                      <div className="flex items-center gap-4 text-[12px]">
                        <div>
                          <span className="text-[#888]">Quote total</span>
                          <span className="ml-2 font-medium text-[#333]">{formatQuoteMoney(quote.total_cents, cur)}</span>
                        </div>
                        <div className="w-px h-4 bg-[#ddd]" />
                        <div>
                          <span className="text-[#888]">Deposit paid</span>
                          <span className="ml-2 font-medium text-[#333]">{formatQuoteMoney(depositAmount, cur)}</span>
                        </div>
                        <div className="w-px h-4 bg-[#ddd]" />
                        <div>
                          <span className="text-[#888]">Remaining</span>
                          <span className="ml-2 font-medium text-[#333]">{formatQuoteMoney(quote.total_cents - depositAmount, cur)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  /* ── Payment form or loading ── */
                  <div>
                    {/* Header */}
                    <div className="mb-5">
                      <h3 className="text-[16px] font-semibold text-[#111]">Deposit Payment</h3>
                      <p className="text-[13px] text-[#888] mt-1">
                        Your quote has been accepted. Complete the deposit payment below to confirm.
                      </p>
                    </div>

                    {/* Deposit breakdown */}
                    <div className="bg-[#f8f8f8] rounded-md px-4 py-3 mb-5">
                      <div className="space-y-1.5 text-[13px]">
                        <div className="flex justify-between">
                          <span className="text-[#888]">Quote total</span>
                          <span className="text-[#333]">{formatQuoteMoney(quote.total_cents, cur)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[#888]">
                            Deposit {quote.deposit_type === 'percentage' ? `(${quote.deposit_value}%)` : ''}
                          </span>
                          <span className="font-semibold text-[#111]">{formatQuoteMoney(depositAmount, cur)}</span>
                        </div>
                        <div className="border-t border-[#e5e5e5] pt-1.5">
                          <div className="flex justify-between">
                            <span className="text-[#888]">Remaining balance</span>
                            <span className="text-[#333]">{formatQuoteMoney(quote.total_cents - depositAmount, cur)}</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Error message */}
                    {depositError && (
                      <div className="bg-[#fafafa] border border-[#e0e0e0] rounded-md px-3 py-2.5 mb-4 flex items-start gap-2">
                        <AlertCircle size={14} className="text-[#999] shrink-0 mt-0.5" />
                        <div>
                          <p className="text-[12px] text-[#666]">{depositError}</p>
                          <button
                            onClick={loadDepositIntent}
                            className="text-[12px] text-[#111] underline mt-1 hover:text-[#333]"
                          >
                            Try again
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Loading state */}
                    {depositLoading && (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 size={20} className="animate-spin text-[#999]" />
                        <span className="ml-2 text-[13px] text-[#888]">Loading payment...</span>
                      </div>
                    )}

                    {/* Stripe payment form */}
                    {!depositLoading && depositIntentData && stripePromise && (
                      <Elements
                        stripe={stripePromise}
                        options={{
                          clientSecret: depositIntentData.client_secret,
                          appearance: {
                            theme: 'flat',
                            variables: {
                              colorPrimary: '#111111',
                              colorBackground: '#ffffff',
                              colorText: '#111111',
                              colorDanger: '#c00000',
                              fontFamily: 'system-ui, -apple-system, sans-serif',
                              borderRadius: '8px',
                              spacingUnit: '4px',
                            },
                            rules: {
                              '.Label': { color: '#666666', fontSize: '12px', fontWeight: '500' },
                              '.Input': { borderColor: '#dddddd', padding: '10px 12px' },
                              '.Input:focus': { borderColor: '#111111', boxShadow: '0 0 0 1px #111111' },
                            },
                          },
                        }}
                      >
                        <DepositPaymentForm
                          onSuccess={async () => {
                            if (depositIntentData.payment_intent_id) {
                              await confirmDepositPayment(depositIntentData.payment_intent_id);
                            }
                            setDepositPaid(true);
                          }}
                          onError={(msg) => setDepositError(msg)}
                        />
                      </Elements>
                    )}

                    {/* No Stripe loaded and not loading - retry button */}
                    {!depositLoading && !depositIntentData && !depositError && (
                      <div className="text-center py-6">
                        <Loader2 size={20} className="animate-spin text-[#999] mx-auto" />
                        <p className="text-[13px] text-[#888] mt-2">Preparing payment...</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}

          {/* ── EXPIRED MESSAGE ── */}
          {isExpired && viewState === 'view' && (
            <>
              <div className="border-t border-[#eee]" />
              <div className="px-8 py-5 no-print">
                <div className="bg-[#f5f5f5] rounded-md px-4 py-3 text-center">
                  <p className="text-[13px] text-[#888] font-medium">
                    This quote expired on {fmtDate(quote.valid_until)}. Please contact us for an updated quote.
                  </p>
                </div>
              </div>
            </>
          )}
        </div>

        {/* ── Footer ── */}
        <p className="text-center text-[11px] text-[#bbb] mt-6 no-print">
          {company.company_name} &mdash; Powered by Lume
        </p>
      </div>
    </div>
  );
}
