import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { AlertCircle, CheckCircle, CreditCard, FileText, Loader2, PenLine } from 'lucide-react';
import { loadStripe, Stripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import AgreementDocument, { type AgreementDocData } from '../components/agreements/AgreementDocument';
import { resolveBrand, readableOn } from '../lib/brandColor';

interface PublicAgreementData {
  agreement: {
    id: string;
    status: string;
    require_signature: boolean;
    terms: string;
    created_at: string | null;
    signer_name: string | null;
    signature_data: string | null;
    signed_at: string | null;
  };
  number: string;
  logo_url: string | null;
  company: {
    name: string;
    address: string | null;
    phone: string | null;
    email: string | null;
    website: string | null;
    tax_lines: string[];
    /** Accent choisi par l'entreprise. null = encre noire. */
    brand_color?: string | null;
  };
  client: { name: string | null; email: string | null; phone: string | null };
  doc: {
    items: Array<{ name: string; qty: number; unit_price_cents: number; total_cents: number }>;
    subtotal_cents: number;
    discount_cents?: number;
    discount_percent?: number | null;
    tax_lines: Array<{ label: string; rate: number; amount_cents: number }>;
    total_cents: number;
    client_name: string | null;
    property_address: string | null;
    service_plan?: { year: number; visits: Array<{ month: number; date: string; year?: number }> } | null;
    payment_terms?: {
      deposit_required: boolean;
      deposit_type: 'percentage' | 'fixed' | null;
      deposit_value: number;
      deposit_cents: number;
      require_payment_method: boolean;
    } | null;
  };
  deposit_status?: string | null;
}

type ViewState = 'loading' | 'error' | 'view' | 'signed';

interface DepositIntentData {
  client_secret: string | null;
  publishable_key: string;
  amount_cents: number;
  currency: string;
  payment_intent_id: string;
}

const centsFr = (cents: number, currency: string, fr: boolean) =>
  new Intl.NumberFormat(fr ? 'fr-CA' : 'en-CA', { style: 'currency', currency: currency || 'CAD' })
    .format(cents / 100);

/**
 * Le formulaire de carte, monté dans <Elements>. Séparé parce que useStripe
 * et useElements n'existent qu'à l'intérieur du fournisseur.
 */
function DepositPaymentForm({
  fr, label, brand, onSuccess, onError,
}: {
  fr: boolean;
  label: string;
  brand: string;
  onSuccess: () => Promise<void> | void;
  onError: (msg: string) => void;
}) {
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
      if (error) onError(error.message || (fr ? 'Le paiement a échoué.' : 'Payment failed.'));
      else await onSuccess();
    } catch (err: any) {
      onError(err?.message || (fr ? 'Le paiement a échoué.' : 'Payment failed.'));
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
        style={{ background: brand, color: readableOn(brand) }}
        className="w-full py-3 rounded-lg font-medium text-[14px] transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
      >
        {processing
          ? <><Loader2 size={16} className="animate-spin" /> {fr ? 'Traitement…' : 'Processing…'}</>
          : <><CreditCard size={16} /> {label}</>}
      </button>
    </form>
  );
}

const isFr = (): boolean => (typeof navigator !== 'undefined' && (navigator.language || '').toLowerCase().startsWith('fr'));

/**
 * Public contract page (/contract/:token) — the client reads the agreement
 * and, when a signature is required, signs it with the same canvas pad as
 * the public quote approval page.
 */
export default function ContractView() {
  const { token } = useParams<{ token: string }>();
  const fr = isFr();
  const [data, setData] = useState<PublicAgreementData | null>(null);
  const [viewState, setViewState] = useState<ViewState>('loading');
  const [error, setError] = useState('');
  const [signing, setSigning] = useState(false);
  const [showSignature, setShowSignature] = useState(false);
  const [signatureData, setSignatureData] = useState<string | null>(null);
  const [signerName, setSignerName] = useState('');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawingRef = useRef(false);
  // ── Dépôt : signer sans pouvoir payer obligeait le client à attendre une
  // facture séparée, au moment précis où il est le plus disposé à payer.
  const [depositCents, setDepositCents] = useState(0);
  const [depositPaid, setDepositPaid] = useState(false);
  const [depositIntent, setDepositIntent] = useState<DepositIntentData | null>(null);
  const [stripePromise, setStripePromise] = useState<Promise<Stripe | null> | null>(null);
  const [depositLoading, setDepositLoading] = useState(false);
  const [depositError, setDepositError] = useState('');
  const [depositUnavailable, setDepositUnavailable] = useState(false);

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const API_BASE = import.meta.env.VITE_API_URL || '';
        const res = await fetch(`${API_BASE}/api/agreements/public/${token}`);
        if (!res.ok) {
          setError(fr ? 'Contrat introuvable' : 'Contract not found');
          setViewState('error');
          return;
        }
        const result: PublicAgreementData = await res.json();
        setData(result);
        const terms = result.doc.payment_terms;
        const du = terms?.deposit_required ? Number(terms.deposit_cents || 0) : 0;
        setDepositCents(du);
        setDepositPaid(result.deposit_status === 'paid');
        setViewState(result.agreement.status === 'signed' ? 'signed' : 'view');
      } catch {
        setError(fr ? 'Impossible de charger le contrat' : 'Could not load contract');
        setViewState('error');
      }
    })();
  }, [token]);

  // ── Signature pad (same mechanics as QuoteView) ──
  function initCanvas() {
    const ctx = canvasRef.current?.getContext('2d');
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
    // The canvas draws in its internal 500×150 space but is displayed at CSS
    // size (w-full) — without this scaling, strokes land up-left of the
    // finger on phones.
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const point = 'touches' in e ? e.touches[0] : (e as React.MouseEvent);
    return { x: (point.clientX - rect.left) * scaleX, y: (point.clientY - rect.top) * scaleY };
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
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setSignatureData(null);
  }

  async function loadDepositIntent() {
    if (!token) return;
    setDepositLoading(true);
    setDepositError('');
    try {
      const API_BASE = import.meta.env.VITE_API_URL || '';
      const res = await fetch(`${API_BASE}/api/agreements/public/deposit-intent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ view_token: token }),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok || !(result as any).client_secret) {
        // 503 = le commerçant n'a pas fini de brancher son fournisseur de
        // paiement. Ce n'est pas au client de lire ça : son contrat est
        // signé, on lui dit simplement que le dépôt suivra.
        if (res.status === 503) setDepositUnavailable(true);
        else setDepositError((result as any)?.error || (fr ? 'Impossible de charger le paiement.' : 'Unable to load payment.'));
        return;
      }
      setDepositIntent(result as DepositIntentData);
      if ((result as DepositIntentData).publishable_key) {
        setStripePromise(loadStripe((result as DepositIntentData).publishable_key));
      }
    } catch {
      setDepositError(fr ? 'Impossible de joindre le service de paiement.' : 'Unable to reach the payment service.');
    } finally {
      setDepositLoading(false);
    }
  }

  async function confirmDepositPayment(paymentIntentId: string) {
    try {
      const API_BASE = import.meta.env.VITE_API_URL || '';
      await fetch(`${API_BASE}/api/agreements/public/deposit-confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ view_token: token, payment_intent_id: paymentIntentId }),
      });
    } catch {
      // Le webhook Stripe rattrapera l'encaissement si cet appel échoue.
    }
  }

  async function handleSign() {
    if (!data || !signatureData || !signerName.trim()) return;
    setSigning(true);
    setError('');
    try {
      const API_BASE = import.meta.env.VITE_API_URL || '';
      const res = await fetch(`${API_BASE}/api/agreements/public/sign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          view_token: token,
          signer_name: signerName.trim(),
          signature_data: signatureData,
        }),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((result as any)?.error || (fr ? 'Échec de la signature du contrat' : 'Failed to sign contract'));
      setData((prev) => prev ? {
        ...prev,
        agreement: {
          ...prev.agreement,
          status: 'signed',
          signer_name: signerName.trim(),
          signature_data: signatureData,
          signed_at: new Date().toISOString(),
        },
      } : prev);
      setViewState('signed');
      if ((result as any)?.deposit_due) {
        setDepositCents(Number((result as any).deposit_cents || 0));
        loadDepositIntent();
      }
    } catch (err: any) {
      setError(err?.message || (fr ? 'Échec de la signature. Veuillez réessayer.' : 'Failed to sign. Please try again.'));
    } finally {
      setSigning(false);
    }
  }

  if (viewState === 'loading') {
    return (
      <div className="min-h-screen bg-[#fafafa] flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-[#e5e5e5] border-t-[#111] rounded-full animate-spin" />
      </div>
    );
  }

  if (viewState === 'error' || !data) {
    return (
      <div className="min-h-screen bg-[#fafafa] flex items-center justify-center">
        <div className="text-center">
          <FileText size={36} className="text-[#d4d4d4] mx-auto mb-3" />
          <h1 className="text-[16px] font-semibold text-[#111]">{fr ? 'Contrat introuvable' : 'Contract Not Found'}</h1>
          <p className="text-[13px] text-[#888] mt-1">{fr ? 'Ce lien est peut-être expiré ou invalide.' : 'This link may have expired or is invalid.'}</p>
        </div>
      </div>
    );
  }

  // Une seule résolution : tout hex invalide retombe sur l'encre noire.
  const brand = resolveBrand(data.company.brand_color);

  const language: 'en' | 'fr' = fr ? 'fr' : 'en';
  const docData: AgreementDocData = {
    agreementNumber: data.number,
    createdAt: data.agreement.created_at,
    requireSignature: data.agreement.require_signature,
    terms: data.agreement.terms,
    logoUrl: data.logo_url,
    company: {
      name: data.company.name,
      address: data.company.address,
      phone: data.company.phone,
      email: data.company.email,
      website: data.company.website,
      taxLines: data.company.tax_lines,
      brandColor: data.company.brand_color ?? null,
    },
    clientName: data.doc.client_name || data.client.name,
    clientEmail: data.client.email,
    clientPhone: data.client.phone,
    propertyAddress: data.doc.property_address,
    items: data.doc.items,
    subtotalCents: data.doc.subtotal_cents,
    discount: data.doc.discount_cents
      ? { amount_cents: data.doc.discount_cents, percent: data.doc.discount_percent ?? null }
      : null,
    taxLines: data.doc.tax_lines,
    totalCents: data.doc.total_cents,
    servicePlan: data.doc.service_plan ?? null,
    paymentTerms: data.doc.payment_terms ?? null,
    signature: data.agreement.signature_data && data.agreement.signer_name
      ? { signerName: data.agreement.signer_name, signatureData: data.agreement.signature_data, signedAt: data.agreement.signed_at }
      : null,
  };

  const canSign = data.agreement.require_signature && viewState === 'view';

  return (
    <div className="min-h-screen bg-[#fafafa]">
      <style>{`
        @media print {
          body { background: white !important; }
          .no-print { display: none !important; }
          .agreement-doc { box-shadow: none !important; border: none !important; }
        }
      `}</style>

      <div className="max-w-[680px] mx-auto py-8 px-4 sm:py-12">
        {viewState === 'signed' && (
          <div className="bg-[#f8f8f8] border border-[#e0e0e0] rounded-lg p-4 mb-5 flex items-center gap-3 no-print">
            <CheckCircle className="text-[#333] shrink-0" size={18} />
            <div>
              <p className="font-semibold text-[#111] text-[14px]">{fr ? 'Contrat signé' : 'Contract Signed'}</p>
              <p className="text-[13px] text-[#666]">{fr ? 'Merci ! Une copie signée est conservée au dossier.' : 'Thank you! A signed copy is kept on file.'}</p>
            </div>
          </div>
        )}

        {/* Dépôt — proposé une fois le contrat signé, tant qu'il n'est pas payé. */}
        {viewState === 'signed' && depositCents > 0 && (
          <div className="bg-white border border-[#e5e5e5] rounded-lg p-5 mb-5 no-print">
            {depositPaid ? (
              <div className="flex items-center gap-3">
                <CheckCircle className="text-[#333] shrink-0" size={18} />
                <div>
                  <p className="font-semibold text-[#111] text-[14px]">{fr ? 'Dépôt payé' : 'Deposit paid'}</p>
                  <p className="text-[13px] text-[#666]">
                    {fr ? 'Merci ! Un reçu vous a été envoyé.' : 'Thank you! A receipt has been sent to you.'}
                  </p>
                </div>
              </div>
            ) : depositUnavailable ? (
              <div className="flex items-baseline justify-between gap-3">
                <div>
                  <p className="font-semibold text-[#111] text-[14px]">{fr ? 'Dépôt à verser' : 'Deposit due'}</p>
                  <p className="text-[13px] text-[#666] mt-0.5">
                    {fr
                      ? 'Nous vous contacterons pour le règlement.'
                      : 'We will contact you to arrange payment.'}
                  </p>
                </div>
                <p className="font-semibold text-[#111] text-[18px] shrink-0">
                  {centsFr(depositCents, 'CAD', fr)}
                </p>
              </div>
            ) : (
              <>
                <div className="flex items-baseline justify-between gap-3 mb-4">
                  <p className="font-semibold text-[#111] text-[14px]">{fr ? 'Dépôt à verser' : 'Deposit due'}</p>
                  <p className="font-semibold text-[#111] text-[18px]">
                    {centsFr(depositCents, depositIntent?.currency || 'CAD', fr)}
                  </p>
                </div>

                {depositError && (
                  <div className="bg-[#fafafa] border border-[#e0e0e0] rounded-md px-3 py-2.5 mb-4 flex items-start gap-2">
                    <AlertCircle size={14} className="text-[#999] shrink-0 mt-0.5" />
                    <div>
                      <p className="text-[12px] text-[#666]">{depositError}</p>
                      <button onClick={loadDepositIntent} className="text-[12px] text-[#111] underline mt-1 hover:text-[#333]">
                        {fr ? 'Réessayer' : 'Try again'}
                      </button>
                    </div>
                  </div>
                )}

                {depositLoading && (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 size={20} className="animate-spin text-[#999]" />
                    <span className="ml-2 text-[13px] text-[#888]">{fr ? 'Chargement du paiement…' : 'Loading payment…'}</span>
                  </div>
                )}

                {!depositLoading && depositIntent?.client_secret && stripePromise && (
                  <Elements
                    stripe={stripePromise}
                    options={{
                      clientSecret: depositIntent.client_secret,
                      appearance: {
                        theme: 'flat',
                        variables: {
                          colorPrimary: brand,
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
                          '.Input:focus': { borderColor: brand, boxShadow: `0 0 0 1px ${brand}` },
                        },
                      },
                    }}
                  >
                    <DepositPaymentForm
                      fr={fr}
                      brand={brand}
                      label={`${fr ? 'Payer' : 'Pay'} ${centsFr(depositCents, depositIntent.currency || 'CAD', fr)}`}
                      onSuccess={async () => {
                        await confirmDepositPayment(depositIntent.payment_intent_id);
                        setDepositPaid(true);
                      }}
                      onError={setDepositError}
                    />
                  </Elements>
                )}

                {/* Le client revenu plus tard sur son lien : rien n'est encore chargé. */}
                {!depositLoading && !depositIntent && !depositError && (
                  <button
                    onClick={loadDepositIntent}
                    style={{ background: brand, color: readableOn(brand) }}
                    className="w-full py-3 rounded-lg font-medium text-[14px] transition-opacity hover:opacity-90 flex items-center justify-center gap-2"
                  >
                    <CreditCard size={16} />
                    {fr ? 'Payer' : 'Pay'} {centsFr(depositCents, 'CAD', fr)}
                  </button>
                )}
              </>
            )}
          </div>
        )}

        <AgreementDocument data={docData} language={language} />

        {/* ── SIGN AREA ── */}
        {canSign && (
          <div className="bg-white rounded-lg border border-[#e5e5e5] shadow-sm mt-5 px-8 py-6 no-print">
            {!showSignature ? (
              <div className="space-y-3">
                {error && <p className="text-[12px] text-[#c00]">{error}</p>}
                <button
                  onClick={() => {
                    setShowSignature(true);
                    setError('');
                    setTimeout(() => initCanvas(), 100);
                  }}
                  className="w-full bg-[#111] text-white py-3 rounded-lg font-medium text-[14px] hover:bg-[#222] transition-colors flex items-center justify-center gap-2"
                >
                  <PenLine size={16} />
                  {fr ? 'Signer le contrat' : 'Sign the contract'}
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <h3 className="text-[14px] font-semibold text-[#111] flex items-center gap-2">
                  <PenLine size={16} />
                  {fr ? 'Signer pour accepter' : 'Sign to Accept'}
                </h3>

                <div>
                  <label className="block text-[12px] font-medium text-[#666] mb-1">{fr ? 'Votre nom complet' : 'Your Full Name'}</label>
                  <input
                    type="text"
                    value={signerName}
                    onChange={(e) => setSignerName(e.target.value)}
                    placeholder={fr ? 'Nom complet' : 'Full Name'}
                    className="w-full px-3 py-2.5 border border-[#ddd] rounded-lg text-[13px] text-[#111] focus:outline-none focus:ring-1 focus:ring-[#111] focus:border-[#111] placeholder:text-[#ccc]"
                  />
                </div>

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
                        <p className="text-[12px] text-[#ddd]">{fr ? 'Dessinez votre signature ici' : 'Draw your signature here'}</p>
                      </div>
                    )}
                  </div>
                  <button onClick={clearSignature} className="text-[12px] text-[#888] hover:text-[#333] mt-1 underline">
                    {fr ? 'Effacer la signature' : 'Clear signature'}
                  </button>
                </div>

                {error && <p className="text-[12px] text-[#c00]">{error}</p>}

                <div className="flex gap-3">
                  <button
                    onClick={handleSign}
                    disabled={signing || !signatureData || !signerName.trim()}
                    style={{ background: brand, color: readableOn(brand) }}
                    className="flex-1 py-3 rounded-lg font-medium text-[14px] transition-opacity hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    <CheckCircle size={16} />
                    {signing ? (fr ? 'Signature…' : 'Signing...') : (fr ? 'Confirmer et signer' : 'Confirm & Sign')}
                  </button>
                  <button
                    onClick={() => { setShowSignature(false); clearSignature(); setSignerName(''); setError(''); }}
                    className="px-5 bg-white border border-[#ddd] text-[#555] py-3 rounded-lg font-medium text-[14px] hover:bg-[#f8f8f8] transition-colors"
                  >
                    {fr ? 'Annuler' : 'Cancel'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        <p className="text-center text-[11px] text-[#bbb] mt-6 no-print">
          {data.company.name} &mdash; {fr ? 'Propulsé par Lume' : 'Powered by Lume'}
        </p>
      </div>
    </div>
  );
}
