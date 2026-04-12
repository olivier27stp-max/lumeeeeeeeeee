import React, { useState, useMemo, useEffect } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CreditCard,
  Crown,
  Loader2,
  Lock,
  Rocket,
  Shield,
  Sparkles,
  Star,
  Zap,
  Building2,
  User,
  Globe,
  Tag,
  Gift,
} from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { cn } from '../lib/utils';
import { useTranslation } from '../i18n';
import { fetchPlans, saveOnboarding, subscribe, validatePromoCode, type Plan, type SubscribeInput } from '../lib/billingApi';
import { validateReferralCode } from '../lib/referralsApi';

type Step = 'plan' | 'onboarding' | 'payment';

export default function BillingCheckout() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { t, language } = useTranslation();
  const isFr = language === 'fr';

  // URL params
  const planParam = searchParams.get('plan') || 'pro';
  const intervalParam = (searchParams.get('interval') || 'monthly') as 'monthly' | 'yearly';
  const refParam = searchParams.get('ref') || '';

  // Step state
  const [step, setStep] = useState<Step>('plan');

  // Plan state
  const [plans, setPlans] = useState<Plan[]>([]);
  const [selectedPlanSlug, setSelectedPlanSlug] = useState(planParam);
  const [interval, setInterval] = useState<'monthly' | 'yearly'>(intervalParam);
  const [currency, setCurrency] = useState<'USD' | 'CAD'>('CAD');
  const [plansLoading, setPlansLoading] = useState(true);

  // Onboarding state
  const [fullName, setFullName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [region, setRegion] = useState('');
  const [country, setCountry] = useState('CA');
  const [postalCode, setPostalCode] = useState('');
  const [industry, setIndustry] = useState('');
  const [companySize, setCompanySize] = useState('');

  // Payment state
  const [cardName, setCardName] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [cardExpiry, setCardExpiry] = useState('');
  const [cardCvc, setCardCvc] = useState('');
  const [promoCode, setPromoCode] = useState('');
  const [promoValid, setPromoValid] = useState<null | { discount_type: string; discount_value: number }>(null);
  const [promoChecking, setPromoChecking] = useState(false);
  const [referralCode, setReferralCode] = useState(refParam);
  const [referralValid, setReferralValid] = useState<boolean | null>(refParam ? null : null);
  const [processing, setProcessing] = useState(false);
  const [onboardingSaving, setOnboardingSaving] = useState(false);

  // Load plans
  useEffect(() => {
    (async () => {
      try {
        const data = await fetchPlans();
        setPlans(data);
      } catch {
        // Fallback plans
        setPlans([]);
      } finally {
        setPlansLoading(false);
      }
    })();
  }, []);

  // Validate referral code from URL
  useEffect(() => {
    if (refParam) {
      validateReferralCode(refParam).then((valid) => {
        setReferralValid(valid);
        if (valid) toast.success(t.billing.referralCodeApplied);
      });
    }
  }, [refParam]);

  const plan = useMemo(() => plans.find((p) => p.slug === selectedPlanSlug) || plans[1] || null, [plans, selectedPlanSlug]);

  const getPrice = (p: Plan) => {
    if (!p) return 0;
    const key = interval === 'yearly'
      ? (currency === 'USD' ? 'yearly_price_usd' : 'yearly_price_cad')
      : (currency === 'USD' ? 'monthly_price_usd' : 'monthly_price_cad');
    return (p as any)[key] || 0;
  };

  const price = plan ? getPrice(plan) : 0;
  const displayPrice = (price / 100).toFixed(2);

  // Discount
  let discountedPrice = price;
  if (promoValid) {
    if (promoValid.discount_type === 'percentage') {
      discountedPrice = Math.round(price * (1 - promoValid.discount_value / 100));
    } else {
      discountedPrice = Math.max(0, price - promoValid.discount_value);
    }
  }
  const finalPrice = (discountedPrice / 100).toFixed(2);

  const savings = interval === 'yearly' && plan
    ? Math.round(((getPrice(plan) > 0 ? 1 : 0) * (
      (currency === 'USD' ? plan.monthly_price_usd : plan.monthly_price_cad) * 12 - (currency === 'USD' ? plan.yearly_price_usd : plan.yearly_price_cad)
    ) / ((currency === 'USD' ? plan.monthly_price_usd : plan.monthly_price_cad) * 12 || 1)) * 100)
    : 0;

  const formatCard = (val: string) => {
    const digits = val.replace(/\D/g, '').slice(0, 16);
    return digits.replace(/(.{4})/g, '$1 ').trim();
  };

  const formatExpiry = (val: string) => {
    const digits = val.replace(/\D/g, '').slice(0, 4);
    if (digits.length >= 3) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
    return digits;
  };

  const isOnboardingValid = fullName.trim() && companyName.trim() && email.includes('@');
  const isPaymentValid = plan?.slug === 'starter' || (cardName.trim() && cardNumber.replace(/\s/g, '').length >= 16 && cardExpiry.length >= 4 && cardCvc.length >= 3);

  const handleCheckPromo = async () => {
    if (!promoCode.trim()) return;
    setPromoChecking(true);
    const result = await validatePromoCode(promoCode.trim());
    setPromoChecking(false);
    if (result) {
      setPromoValid(result);
      toast.success(t.billing.promoCodeApplied);
    } else {
      setPromoValid(null);
      toast.error(t.billing.invalidPromoCode);
    }
  };

  const handleCheckReferral = async () => {
    if (!referralCode.trim()) return;
    const valid = await validateReferralCode(referralCode.trim());
    setReferralValid(valid);
    if (valid) {
      toast.success(t.billing.referralCodeValid);
    } else {
      toast.error(t.billing.invalidReferralCode);
    }
  };

  const handleSaveOnboarding = async () => {
    if (!isOnboardingValid) return;
    setOnboardingSaving(true);
    try {
      await saveOnboarding({
        full_name: fullName.trim(),
        company_name: companyName.trim(),
        email: email.trim(),
        phone: phone.trim(),
        address: address.trim(),
        city: city.trim(),
        region: region.trim(),
        country,
        postal_code: postalCode.trim(),
        industry: industry.trim(),
        company_size: companySize.trim(),
        currency,
      });
      setStep('payment');
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setOnboardingSaving(false);
    }
  };

  const handleSubscribe = async () => {
    if (!plan || (!isPaymentValid && plan.slug !== 'starter')) return;
    setProcessing(true);
    try {
      const input: SubscribeInput = {
        plan_slug: plan.slug,
        interval,
        currency,
        promo_code: promoValid ? promoCode.trim() : undefined,
        referral_code: referralValid ? referralCode.trim() : undefined,
        billing_email: email,
        card_name: cardName.trim(),
        company_name: companyName.trim(),
        country,
        postal_code: postalCode.trim(),
      };
      await subscribe(input);
      toast.success(t.billing.plannameSubscriptionActivated);
      navigate('/settings?tab=billing');
    } catch (err: any) {
      toast.error(err.message || (t.billing.paymentFailed));
    } finally {
      setProcessing(false);
    }
  };

  // Step indicators
  const steps: { id: Step; label: string }[] = [
    { id: 'plan', label: t.billing.plan },
    { id: 'onboarding', label: t.billing.business },
    { id: 'payment', label: t.billing.payment },
  ];

  return (
    <div className="space-y-8">
      {/* Back */}
      <button
        onClick={() => step === 'plan' ? navigate('/settings?tab=billing') : setStep(step === 'payment' ? 'onboarding' : 'plan')}
        className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-text-secondary hover:text-text-primary transition-colors"
      >
        <ArrowLeft size={14} /> {step === 'plan' ? (t.billing.backToBilling) : (t.billing.previousStep)}
      </button>

      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center">
          <CreditCard size={18} className="text-white" />
        </div>
        <div>
          <h1 className="text-[20px] font-bold text-text-primary tracking-tight">
            {isFr ? 'Finaliser l\'abonnement' : 'Complete your subscription'}
          </h1>
          <p className="text-[12px] text-text-tertiary">
            {t.billing.unlockPremiumFeaturesForYourBusiness}
          </p>
        </div>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2">
        {steps.map((s, i) => (
          <React.Fragment key={s.id}>
            <button
              onClick={() => {
                if (s.id === 'plan') setStep('plan');
                if (s.id === 'onboarding' && step !== 'plan') setStep('onboarding');
              }}
              className={cn(
                'flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-full transition-all',
                step === s.id
                  ? 'bg-primary text-white'
                  : steps.indexOf(steps.find(x => x.id === step)!) > i
                    ? 'bg-success/10 text-success'
                    : 'bg-surface-secondary text-text-tertiary'
              )}
            >
              {steps.indexOf(steps.find(x => x.id === step)!) > i ? <Check size={12} /> : <span className="text-[10px] font-bold">{i + 1}</span>}
              {s.label}
            </button>
            {i < steps.length - 1 && <div className="w-6 h-px bg-outline-subtle" />}
          </React.Fragment>
        ))}
      </div>

      {/* ═══ STEP 1: Plan Selection ═══ */}
      {step === 'plan' && (
        <div className="flex flex-col lg:flex-row gap-6">
          <div className="flex-1 space-y-4">
            {/* Currency toggle */}
            <div className="flex items-center gap-3">
              <div className="section-card p-1.5 inline-flex gap-1">
                {(['monthly', 'yearly'] as const).map((int) => (
                  <button
                    key={int}
                    onClick={() => setInterval(int)}
                    className={cn(
                      'px-4 py-2 rounded-lg text-[12px] font-semibold transition-all',
                      interval === int ? 'bg-primary text-white' : 'text-text-secondary hover:text-text-primary'
                    )}
                  >
                    {int === 'monthly' ? (t.billing.monthly) : (t.billing.yearly)}
                    {int === 'yearly' && savings > 0 && <span className="ml-1.5 text-[10px] font-bold text-success">-{savings}%</span>}
                  </button>
                ))}
              </div>
              <div className="section-card p-1.5 inline-flex gap-1">
                {(['CAD', 'USD'] as const).map((cur) => (
                  <button
                    key={cur}
                    onClick={() => setCurrency(cur)}
                    className={cn(
                      'px-3 py-2 rounded-lg text-[12px] font-semibold transition-all',
                      currency === cur ? 'bg-primary text-white' : 'text-text-secondary hover:text-text-primary'
                    )}
                  >
                    {cur}
                  </button>
                ))}
              </div>
            </div>

            {/* Plan cards */}
            {plansLoading ? (
              <div className="py-8 flex justify-center">
                <Loader2 size={20} className="animate-spin text-text-tertiary" />
              </div>
            ) : (
              <div className="space-y-2">
                {plans.map((p) => {
                  const pPrice = getPrice(p);
                  const isSelected = selectedPlanSlug === p.slug;
                  return (
                    <button
                      key={p.slug}
                      onClick={() => setSelectedPlanSlug(p.slug)}
                      className={cn(
                        'w-full section-card p-4 text-left transition-all',
                        isSelected ? '!border-primary ring-2 ring-primary/20' : 'hover:border-outline'
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className={cn(
                            'w-4 h-4 rounded-full border-2 flex items-center justify-center transition-all',
                            isSelected ? 'border-primary bg-primary' : 'border-outline-subtle'
                          )}>
                            {isSelected && <Check size={10} className="text-white" />}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-[14px] font-bold text-text-primary">{isFr ? p.name_fr : p.name}</span>
                              {p.slug === 'pro' && <span className="text-[9px] font-bold text-primary bg-primary/10 rounded-full px-1.5 py-0.5">{t.billing.recommended}</span>}
                            </div>
                          </div>
                        </div>
                        <div className="text-right">
                          <span className="text-[16px] font-bold text-text-primary tabular-nums">${(pPrice / 100).toFixed(0)}</span>
                          <span className="text-[10px] text-text-tertiary"> {currency}/{interval === 'yearly' ? (t.billing.yr) : (t.billing.mo)}</span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Features */}
            {plan && (
              <div className="section-card p-5 space-y-3">
                <p className="text-[10px] font-bold text-text-tertiary uppercase tracking-wider">
                  {t.billing.includedIn} {isFr ? plan.name_fr : plan.name}
                </p>
                <div className="space-y-2">
                  {(plan.features as string[]).map((f, i) => (
                    <div key={i} className="flex items-center gap-2 text-[12px] text-text-secondary">
                      <Check size={12} className="text-success shrink-0" />
                      {f}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Summary panel */}
          <div className="lg:w-[340px] shrink-0">
            <div className="section-card p-5 space-y-4 sticky top-4">
              <p className="text-[10px] font-bold text-text-tertiary uppercase tracking-wider">{t.billing.summary}</p>
              {plan && (
                <>
                  <div className="flex justify-between text-[13px]">
                    <span className="text-text-secondary">{isFr ? plan.name_fr : plan.name}</span>
                    <span className="font-semibold text-text-primary tabular-nums">${displayPrice} {currency}</span>
                  </div>
                  <button
                    onClick={() => setStep('onboarding')}
                    className="glass-button-primary w-full !py-3 !text-[13px] inline-flex items-center justify-center gap-2"
                  >
                    {t.billing.continue} <ArrowRight size={14} />
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ═══ STEP 2: Onboarding Form ═══ */}
      {step === 'onboarding' && (
        <div className="max-w-xl space-y-5">
          <div className="section-card p-6 space-y-5">
            <div className="flex items-center gap-2">
              <Building2 size={14} className="text-text-tertiary" />
              <p className="text-xs font-medium text-text-tertiary uppercase tracking-wider">
                {isFr ? 'Informations de l\'entreprise' : 'Business Information'}
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">{t.billing.fullName} *</label>
                <input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} className="glass-input w-full mt-1" placeholder="John Doe" />
              </div>
              <div>
                <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">{isFr ? 'Nom de l\'entreprise' : 'Company Name'} *</label>
                <input type="text" value={companyName} onChange={(e) => setCompanyName(e.target.value)} className="glass-input w-full mt-1" placeholder="Acme Corp" />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">{t.billing.email} *</label>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="glass-input w-full mt-1" placeholder="john@company.com" />
              </div>
              <div>
                <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">{t.billing.phone}</label>
                <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className="glass-input w-full mt-1" placeholder="+1 (555) 123-4567" />
              </div>
            </div>

            <div>
              <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">{t.billing.address}</label>
              <input type="text" value={address} onChange={(e) => setAddress(e.target.value)} className="glass-input w-full mt-1" placeholder="123 Main St" />
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">{t.billing.city}</label>
                <input type="text" value={city} onChange={(e) => setCity(e.target.value)} className="glass-input w-full mt-1" />
              </div>
              <div>
                <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">{t.billing.provincestate}</label>
                <input type="text" value={region} onChange={(e) => setRegion(e.target.value)} className="glass-input w-full mt-1" />
              </div>
              <div>
                <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">{t.billing.country}</label>
                <select value={country} onChange={(e) => setCountry(e.target.value)} className="glass-input w-full mt-1">
                  <option value="CA">Canada</option>
                  <option value="US">United States</option>
                  <option value="FR">France</option>
                  <option value="GB">United Kingdom</option>
                </select>
              </div>
              <div>
                <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">{t.billing.postalCode}</label>
                <input type="text" value={postalCode} onChange={(e) => setPostalCode(e.target.value)} className="glass-input w-full mt-1" />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">{t.billing.industry}</label>
                <select value={industry} onChange={(e) => setIndustry(e.target.value)} className="glass-input w-full mt-1">
                  <option value="">{t.billing.select}</option>
                  <option value="landscaping">{t.billing.landscaping}</option>
                  <option value="cleaning">{t.billing.cleaning}</option>
                  <option value="plumbing">{t.billing.plumbing}</option>
                  <option value="electrical">{t.billing.electrical}</option>
                  <option value="hvac">{t.billing.hvac}</option>
                  <option value="construction">{t.billing.construction}</option>
                  <option value="painting">{t.billing.painting}</option>
                  <option value="roofing">{t.billing.roofing}</option>
                  <option value="pest_control">{t.billing.pestControl}</option>
                  <option value="other">{t.billing.other}</option>
                </select>
              </div>
              <div>
                <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">{isFr ? 'Taille de l\'entreprise' : 'Company Size'}</label>
                <select value={companySize} onChange={(e) => setCompanySize(e.target.value)} className="glass-input w-full mt-1">
                  <option value="">{t.billing.select}</option>
                  <option value="1">1 ({t.billing.solo})</option>
                  <option value="2-5">2-5</option>
                  <option value="6-10">6-10</option>
                  <option value="11-25">11-25</option>
                  <option value="26-50">26-50</option>
                  <option value="50+">50+</option>
                </select>
              </div>
            </div>

            {/* Currency selection */}
            <div>
              <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">{t.billing.billingCurrency}</label>
              <div className="flex gap-2 mt-1">
                {(['CAD', 'USD'] as const).map((cur) => (
                  <button
                    key={cur}
                    onClick={() => setCurrency(cur)}
                    className={cn(
                      'flex-1 p-3 rounded-xl border text-center transition-all',
                      currency === cur ? 'border-primary bg-primary/5' : 'border-outline-subtle hover:border-outline'
                    )}
                  >
                    <span className="text-[14px] font-bold text-text-primary">{cur === 'CAD' ? 'CAD $' : 'USD $'}</span>
                    <p className="text-[10px] text-text-tertiary mt-0.5">{cur === 'CAD' ? (t.billing.canadianDollar) : (t.billing.usDollar)}</p>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <button
            onClick={handleSaveOnboarding}
            disabled={!isOnboardingValid || onboardingSaving}
            className="glass-button-primary !py-3 !text-[13px] inline-flex items-center gap-2 disabled:opacity-50"
          >
            {onboardingSaving ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} />}
            {onboardingSaving ? (t.billing.saving) : (t.billing.continueToPayment)}
          </button>
        </div>
      )}

      {/* ═══ STEP 3: Payment ═══ */}
      {step === 'payment' && plan && (
        <div className="flex flex-col lg:flex-row gap-6">
          {/* Payment form */}
          <div className="flex-1 max-w-lg">
            {plan.slug === 'starter' ? (
              <div className="section-card p-8 text-center">
                <Check size={32} className="text-success mx-auto mb-3" />
                <h3 className="text-[15px] font-bold text-text-primary">
                  {t.billing.starterPlanIsFree}
                </h3>
                <p className="text-[13px] text-text-tertiary mt-1">
                  {t.billing.noPaymentRequired}
                </p>
                <button
                  onClick={handleSubscribe}
                  disabled={processing}
                  className="glass-button-primary !text-[12px] mt-4 inline-flex items-center gap-1.5"
                >
                  {processing ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
                  {t.billing.activatePlan}
                </button>
              </div>
            ) : (
              <div className="section-card p-6 space-y-5">
                <div className="flex items-center gap-2">
                  <Lock size={14} className="text-text-tertiary" />
                  <p className="text-xs font-medium text-text-tertiary uppercase tracking-wider">
                    {t.billing.securePayment}
                  </p>
                </div>

                <div className="space-y-4">
                  {/* Card */}
                  <div className="border border-outline-subtle/60 rounded-xl p-4 space-y-3 bg-surface-secondary/30">
                    <p className="text-[11px] font-bold text-text-tertiary uppercase tracking-wider flex items-center gap-1.5">
                      <CreditCard size={12} /> {t.billing.cardInformation}
                    </p>
                    <div>
                      <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">{t.billing.cardholderName} *</label>
                      <input type="text" value={cardName} onChange={(e) => setCardName(e.target.value)} className="glass-input w-full mt-1" placeholder="John Doe" />
                    </div>
                    <div>
                      <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">{t.billing.cardNumber} *</label>
                      <input type="text" value={cardNumber} onChange={(e) => setCardNumber(formatCard(e.target.value))} className="glass-input w-full mt-1 tabular-nums" placeholder="4242 4242 4242 4242" maxLength={19} />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">{t.billing.expiry} *</label>
                        <input type="text" value={cardExpiry} onChange={(e) => setCardExpiry(formatExpiry(e.target.value))} className="glass-input w-full mt-1 tabular-nums" placeholder="MM/YY" maxLength={5} />
                      </div>
                      <div>
                        <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">CVC *</label>
                        <input type="text" value={cardCvc} onChange={(e) => setCardCvc(e.target.value.replace(/\D/g, '').slice(0, 4))} className="glass-input w-full mt-1 tabular-nums" placeholder="123" maxLength={4} />
                      </div>
                    </div>
                  </div>

                  {/* Promo code */}
                  <div>
                    <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider flex items-center gap-1">
                      <Tag size={10} /> {t.billing.promoCode}
                    </label>
                    <div className="flex gap-2 mt-1">
                      <input
                        type="text"
                        value={promoCode}
                        onChange={(e) => { setPromoCode(e.target.value); setPromoValid(null); }}
                        className="glass-input flex-1"
                        placeholder="SAVE20"
                      />
                      <button onClick={handleCheckPromo} disabled={promoChecking || !promoCode.trim()} className="glass-button inline-flex items-center gap-1.5 shrink-0">
                        {promoChecking ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                        {t.billing.apply}
                      </button>
                    </div>
                    {promoValid && (
                      <p className="text-[11px] text-success mt-1 flex items-center gap-1">
                        <Check size={10} />
                        {promoValid.discount_type === 'percentage' ? `${promoValid.discount_value}% off` : `$${(promoValid.discount_value / 100).toFixed(2)} off`}
                      </p>
                    )}
                  </div>

                  {/* Referral code */}
                  <div>
                    <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider flex items-center gap-1">
                      <Gift size={10} /> {t.billing.referralCode}
                    </label>
                    <div className="flex gap-2 mt-1">
                      <input
                        type="text"
                        value={referralCode}
                        onChange={(e) => { setReferralCode(e.target.value); setReferralValid(null); }}
                        className="glass-input flex-1"
                        placeholder="LUME-XXXXXXXX"
                      />
                      <button onClick={handleCheckReferral} disabled={!referralCode.trim()} className="glass-button inline-flex items-center gap-1.5 shrink-0">
                        <Check size={12} /> {t.billing.verify}
                      </button>
                    </div>
                    {referralValid === true && (
                      <p className="text-[11px] text-success mt-1 flex items-center gap-1"><Check size={10} /> {t.billing.validCode}</p>
                    )}
                    {referralValid === false && (
                      <p className="text-[11px] text-danger mt-1">{t.billing.invalidCode}</p>
                    )}
                  </div>
                </div>

                {/* Submit */}
                <button
                  onClick={handleSubscribe}
                  disabled={!isPaymentValid || processing}
                  className="glass-button-primary w-full !text-[13px] !py-3 inline-flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {processing ? (
                    <><Loader2 size={14} className="animate-spin" /> {t.billing.processing}</>
                  ) : (
                    <><Zap size={14} /> {isFr ? `S'abonner — $${finalPrice} ${currency}` : `Subscribe — $${finalPrice} ${currency}`}</>
                  )}
                </button>

                <div className="flex items-center justify-center gap-4 pt-1">
                  <div className="flex items-center gap-1.5 text-[10px] text-text-tertiary"><Shield size={11} /> {t.billing.secureCheckout}</div>
                  <div className="flex items-center gap-1.5 text-[10px] text-text-tertiary"><Check size={11} /> {t.billing.cancelAnytime}</div>
                </div>
              </div>
            )}
          </div>

          {/* Order summary sidebar */}
          <div className="lg:w-[340px] shrink-0">
            <div className="section-card p-5 space-y-3 sticky top-4">
              <p className="text-[10px] font-bold text-text-tertiary uppercase tracking-wider">{t.billing.orderSummary}</p>
              <div className="space-y-2">
                <div className="flex justify-between text-[13px]">
                  <span className="text-text-secondary">{isFr ? plan.name_fr : plan.name} ({interval === 'yearly' ? (t.billing.yearly2) : (t.billing.monthly2)})</span>
                  <span className="font-semibold text-text-primary tabular-nums">${displayPrice} {currency}</span>
                </div>
                {promoValid && (
                  <div className="flex justify-between text-[12px]">
                    <span className="text-success">{t.billing.promoDiscount}</span>
                    <span className="font-semibold text-success tabular-nums">-${((price - discountedPrice) / 100).toFixed(2)}</span>
                  </div>
                )}
                <div className="border-t border-outline-subtle/40 pt-2 flex justify-between text-[14px]">
                  <span className="font-semibold text-text-primary">{t.billing.total}</span>
                  <span className="font-bold text-text-primary tabular-nums">${finalPrice} {currency}</span>
                </div>
              </div>
              <p className="text-[10px] text-text-tertiary">
                {interval === 'yearly'
                  ? (t.billing.renewsAnnuallyCancelAnytime)
                  : (t.billing.renewsMonthlyCancelAnytime)}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
