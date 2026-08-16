import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle, CreditCard, FileText, PenLine } from 'lucide-react';
import { loadStripe, type Stripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import AgreementDocument, { type AgreementDocData } from '../components/agreements/AgreementDocument';

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
  /** Statut vivant de la carte au dossier du client (jamais du snapshot). */
  payment_method?: {
    requested: boolean;
    card: SavedCard | null;
    available: boolean;
  } | null;
}

interface SavedCard {
  brand: string | null;
  last4: string;
  exp_month: number | null;
  exp_year: number | null;
}

function cardBrandLabel(brand: string | null): string {
  const b = (brand || '').toLowerCase();
  if (b === 'visa') return 'Visa';
  if (b === 'mastercard') return 'Mastercard';
  if (b === 'amex' || b === 'american_express') return 'Amex';
  if (b === 'discover') return 'Discover';
  return brand ? brand.charAt(0).toUpperCase() + brand.slice(1) : 'Carte';
}

function cardExpiryLabel(card: SavedCard, fr: boolean): string | null {
  if (!card.exp_month || !card.exp_year) return null;
  const mm = String(card.exp_month).padStart(2, '0');
  const yy = String(card.exp_year % 100).padStart(2, '0');
  return fr ? `Expire ${mm}/${yy}` : `Expires ${mm}/${yy}`;
}

type ViewState = 'loading' | 'error' | 'view' | 'signed';

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

  // ── Payment method on file (SetupIntent Stripe — la carte reste associée
  // au client, jamais au seul contrat; aucun numéro de carte ne nous transite) ──
  const [pmView, setPmView] = useState<'idle' | 'consent' | 'loading' | 'form' | 'skipped'>('idle');
  const [pmConsent, setPmConsent] = useState(false);
  const [pmError, setPmError] = useState('');
  const [pmClientSecret, setPmClientSecret] = useState<string | null>(null);
  const [pmStripePromise, setPmStripePromise] = useState<Promise<Stripe | null> | null>(null);
  const [savedCard, setSavedCard] = useState<SavedCard | null>(null);

  async function confirmCard(setupIntentId: string) {
    const API_BASE = import.meta.env.VITE_API_URL || '';
    const res = await fetch(`${API_BASE}/api/agreements/public/payment-method/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ view_token: token, setup_intent_id: setupIntentId }),
    });
    const result = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((result as any)?.error || (fr ? 'Impossible d’enregistrer la carte.' : 'Could not save the card.'));
    if ((result as any).card?.last4) setSavedCard((result as any).card as SavedCard);
    setPmView('idle');
    setPmClientSecret(null);
    setPmError('');
  }

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
        setSavedCard(result.payment_method?.card ?? null);
        setViewState(result.agreement.status === 'signed' ? 'signed' : 'view');

        // Retour d'une confirmation 3-D Secure avec redirection : Stripe
        // rappelle la page avec ?setup_intent=seti_… — on finalise ici.
        const params = new URLSearchParams(window.location.search);
        const returnedSetupIntent = params.get('setup_intent');
        if (returnedSetupIntent) {
          window.history.replaceState({}, '', window.location.pathname);
          confirmCard(returnedSetupIntent).catch((err: any) => {
            setPmError(err?.message || (fr ? 'Impossible d’enregistrer la carte.' : 'Could not save the card.'));
          });
        }
      } catch {
        setError(fr ? 'Impossible de charger le contrat' : 'Could not load contract');
        setViewState('error');
      }
    })();
  }, [token]);

  async function startCardSetup() {
    setPmError('');
    setPmView('loading');
    try {
      const API_BASE = import.meta.env.VITE_API_URL || '';
      const res = await fetch(`${API_BASE}/api/agreements/public/payment-method/setup-intent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ view_token: token }),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok || !(result as any).client_secret) {
        throw new Error((result as any)?.error || (fr ? 'Impossible de démarrer l’ajout de carte.' : 'Could not start card setup.'));
      }
      setPmStripePromise(loadStripe((result as any).publishable_key));
      setPmClientSecret((result as any).client_secret);
      setPmView('form');
    } catch (err: any) {
      setPmError(err?.message || (fr ? 'Impossible de démarrer l’ajout de carte.' : 'Could not start card setup.'));
      setPmView('consent');
    }
  }

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
  // La section carte s'affiche aussi après signature : le client peut revenir
  // sur son contrat en tout temps pour ajouter son moyen de paiement.
  const pmRequested = data.payment_method?.requested === true;
  const pmAvailable = data.payment_method?.available === true;
  const showPaymentMethod = pmRequested && (Boolean(savedCard) || pmAvailable);

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
                    className="flex-1 bg-[#111] text-white py-3 rounded-lg font-medium text-[14px] hover:bg-[#222] transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
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

        {/* ── PAYMENT METHOD ON FILE ── */}
        {showPaymentMethod && (
          <div className="bg-white rounded-lg border border-[#e5e5e5] shadow-sm mt-5 px-8 py-6 no-print">
            <h3 className="text-[14px] font-semibold text-[#111] flex items-center gap-2">
              <CreditCard size={16} />
              {fr ? 'Moyen de paiement' : 'Payment Method'}
            </h3>

            {savedCard ? (
              <>
                <div className="mt-4 flex items-center gap-3">
                  <div className="h-9 w-12 rounded-md bg-[#111] flex items-center justify-center shrink-0">
                    <CreditCard size={16} className="text-white" />
                  </div>
                  <div>
                    <p className="text-[14px] font-semibold text-[#111]">
                      {cardBrandLabel(savedCard.brand)} •••• {savedCard.last4}
                    </p>
                    {cardExpiryLabel(savedCard, fr) && (
                      <p className="text-[12px] text-[#888]">{cardExpiryLabel(savedCard, fr)}</p>
                    )}
                  </div>
                  <CheckCircle size={18} className="text-[#16a34a] ml-auto shrink-0" />
                </div>
                <p className="text-[12px] text-[#888] mt-3 leading-relaxed">
                  {fr
                    ? 'Ce moyen de paiement est conservé de façon sécurisée par Stripe pour les paiements futurs.'
                    : 'This payment method is stored securely by Stripe for future payments.'}
                </p>
              </>
            ) : pmView === 'skipped' ? (
              <p className="text-[13px] text-[#888] mt-3 leading-relaxed">
                {fr
                  ? 'Aucun problème — vous pourrez ajouter un moyen de paiement plus tard en revenant sur cette page.'
                  : 'No problem — you can add a payment method later by returning to this page.'}
              </p>
            ) : (
              <>
                <p className="text-[13px] text-[#666] mt-2 leading-relaxed">
                  {fr
                    ? 'Ajoutez un moyen de paiement pour faciliter les paiements futurs liés à ce service.'
                    : 'Add a payment method to make future payments for this service easier.'}
                </p>

                {pmView === 'idle' && (
                  <div className="flex gap-3 mt-4">
                    <button
                      onClick={() => { setPmError(''); setPmConsent(false); setPmView('consent'); }}
                      className="flex-1 bg-[#111] text-white py-3 rounded-lg font-medium text-[14px] hover:bg-[#222] transition-colors flex items-center justify-center gap-2"
                    >
                      <CreditCard size={16} />
                      {fr ? 'Ajouter un moyen de paiement' : 'Add Payment Method'}
                    </button>
                    <button
                      onClick={() => setPmView('skipped')}
                      className="px-5 bg-white border border-[#ddd] text-[#555] py-3 rounded-lg font-medium text-[14px] hover:bg-[#f8f8f8] transition-colors"
                    >
                      {fr ? 'Passer pour l’instant' : 'Skip for now'}
                    </button>
                  </div>
                )}

                {(pmView === 'consent' || pmView === 'loading') && (
                  <div className="mt-4 space-y-4">
                    {/* Consentement explicite (Loi 25) : opt-in jamais pré-coché,
                        finalité claire, Stripe nommé, retrait possible. */}
                    <label className="flex items-start gap-2.5 cursor-pointer select-none rounded-lg border border-[#e5e5e5] bg-[#fafafa] p-3">
                      <input
                        type="checkbox"
                        checked={pmConsent}
                        onChange={(e) => setPmConsent(e.target.checked)}
                        className="h-4 w-4 mt-0.5 rounded"
                      />
                      <span className="text-[12px] text-[#666] leading-relaxed">
                        <span className="font-semibold block text-[#111]">
                          {fr ? 'Sauvegarder ma carte pour les paiements futurs' : 'Save my card for future payments'}
                        </span>
                        {fr
                          ? `Je consens à ce que ma carte soit conservée de façon sécurisée par Stripe afin que ${data.company.name || 'cette entreprise'} puisse encaisser mes prochaines factures. Aucun numéro de carte n’est conservé par l’entreprise. Je peux retirer ma carte en tout temps sur demande.`
                          : `I consent to my card being stored securely by Stripe so ${data.company.name || 'this business'} can charge my future invoices. The business never stores my card number. I can withdraw my card at any time upon request.`}
                      </span>
                    </label>
                    <div className="flex gap-3">
                      <button
                        onClick={startCardSetup}
                        disabled={!pmConsent || pmView === 'loading'}
                        className="flex-1 bg-[#111] text-white py-3 rounded-lg font-medium text-[14px] hover:bg-[#222] transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                      >
                        {pmView === 'loading' ? (fr ? 'Chargement…' : 'Loading...') : (fr ? 'Continuer' : 'Continue')}
                      </button>
                      <button
                        onClick={() => { setPmView('idle'); setPmError(''); }}
                        className="px-5 bg-white border border-[#ddd] text-[#555] py-3 rounded-lg font-medium text-[14px] hover:bg-[#f8f8f8] transition-colors"
                      >
                        {fr ? 'Annuler' : 'Cancel'}
                      </button>
                    </div>
                  </div>
                )}

                {pmView === 'form' && pmClientSecret && pmStripePromise && (
                  <Elements
                    stripe={pmStripePromise}
                    options={{
                      clientSecret: pmClientSecret,
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
                    <CardSetupForm
                      fr={fr}
                      onDone={async (setupIntentId) => {
                        try {
                          await confirmCard(setupIntentId);
                        } catch (err: any) {
                          setPmError(err?.message || (fr ? 'Impossible d’enregistrer la carte.' : 'Could not save the card.'));
                        }
                      }}
                      onCancel={() => { setPmView('idle'); setPmClientSecret(null); setPmError(''); }}
                      onError={(msg) => setPmError(msg)}
                    />
                  </Elements>
                )}

                {pmError && <p className="text-[12px] text-[#c00] mt-3">{pmError}</p>}
              </>
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

/**
 * Formulaire Stripe (PaymentElement) monté dans <Elements> — confirme le
 * SetupIntent sans redirection quand possible (3-D Secure en iframe), sinon
 * Stripe rappelle la page avec ?setup_intent=… et le parent finalise.
 */
function CardSetupForm({ fr, onDone, onCancel, onError }: {
  fr: boolean;
  onDone: (setupIntentId: string) => Promise<void>;
  onCancel: () => void;
  onError: (msg: string) => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setSubmitting(true);
    onError('');
    try {
      const result = await stripe.confirmSetup({
        elements,
        confirmParams: { return_url: window.location.href },
        redirect: 'if_required',
      });
      if (result.error) {
        onError(result.error.message || (fr ? 'La carte n’a pas pu être enregistrée.' : 'The card could not be saved.'));
        return;
      }
      if (result.setupIntent?.status === 'succeeded') {
        await onDone(result.setupIntent.id);
      } else {
        onError(fr ? 'La carte n’a pas pu être confirmée.' : 'The card could not be confirmed.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 space-y-4">
      <PaymentElement />
      <div className="flex gap-3">
        <button
          type="submit"
          disabled={submitting || !stripe || !elements}
          className="flex-1 bg-[#111] text-white py-3 rounded-lg font-medium text-[14px] hover:bg-[#222] transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          <CheckCircle size={16} />
          {submitting ? (fr ? 'Enregistrement…' : 'Saving...') : (fr ? 'Enregistrer la carte' : 'Save Card')}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-5 bg-white border border-[#ddd] text-[#555] py-3 rounded-lg font-medium text-[14px] hover:bg-[#f8f8f8] transition-colors"
        >
          {fr ? 'Annuler' : 'Cancel'}
        </button>
      </div>
      <p className="text-[11px] text-[#999] text-center">
        {fr
          ? 'Sécurisé par Stripe. Vos informations de carte sont chiffrées et jamais conservées par l’entreprise.'
          : 'Secured by Stripe. Your card details are encrypted and never stored by the business.'}
      </p>
    </form>
  );
}
