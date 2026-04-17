/**
 * OnboardingFlow — Jobber-style multi-step signup + checkout
 *
 * Canonical flow:
 *   Pricing page → Start Now → /checkout?plan=pro&interval=monthly
 *   Step 1: Basic info (name, email, phone)
 *   Step 2: Company info
 *   Step 3: Business profile (team size, years)
 *   Step 4: Revenue estimate
 *   Step 5: Goals
 *   Step 6: Attribution
 *   Step 7: Plan optimization (upsell / yearly switch)
 *   Step 8: Checkout (billing cycle, summary, card)
 *   → Dashboard
 */
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowRight, ArrowLeft, Check, CreditCard, Lock, Loader2,
  Building2, Mail, User, Globe, Phone, Tag, Gift,
  Eye, EyeOff, Users, Calendar, DollarSign, Target, HelpCircle,
  Sparkles, Zap, TrendingUp, Clock,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { cn } from '../lib/utils';
import { useTranslation } from '../i18n';
import { supabase } from '../lib/supabase';
import {
  fetchPlans, saveOnboarding, subscribe, validatePromoCode,
  type Plan, type SubscribeInput,
} from '../lib/billingApi';
import { validateReferralCode } from '../lib/referralsApi';
// Stripe Checkout — payment handled via Stripe hosted page (secure, PCI compliant)

// ─── Plan display names — single source of truth ───
const PLAN_NAMES: Record<string, string> = {
  starter: 'Minimum',
  pro: 'Scale',
  autopilot: 'Autopilot',
};

// ─── Step definitions ───
type StepId = 'basic' | 'company' | 'profile' | 'revenue' | 'goals' | 'attribution' | 'optimize' | 'checkout';
const STEPS: StepId[] = ['basic', 'company', 'profile', 'revenue', 'goals', 'attribution', 'optimize', 'checkout'];

// ─── Right-side panel content per step ───
const STEP_PANELS: Record<StepId, { image: string; quote: string; author?: string }> = {
  basic:       { image: '/industries/landscaping.png', quote: 'Businesses grow their revenue by 37% on average with Lume.', author: '' },
  company:     { image: '/industries/landscaping.png', quote: 'Businesses grow their revenue by 37% on average with Lume.', author: '' },
  profile:     { image: '/industries/construction.png', quote: 'Business owners who use Lume save 7 hours a week.', author: '' },
  revenue:     { image: '/industries/hvac.png', quote: 'You can get paid 4x faster with Lume payments.', author: '' },
  goals:       { image: '/industries/powerwash.jpg', quote: 'Lume has changed the game for us. Now we are actually starting to scale up our business.', author: 'Vision Lavage' },
  attribution: { image: '/industries/roofing.png', quote: "We're here to help your business run smoothly.", author: '' },
  optimize:    { image: '/industries/window.jpg', quote: 'Upgrade your plan and unlock more powerful features.', author: '' },
  checkout:    { image: '', quote: '', author: '' },
};

// ─── Component ───
export default function OnboardingFlow() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { t, language } = useTranslation();
  const isFr = language === 'fr';

  // URL params
  const planParam = params.get('plan') || 'pro';
  const intervalParam = (params.get('interval') || 'monthly') as 'monthly' | 'yearly';
  const refParam = params.get('ref') || '';

  // ─── Auth ───
  const [user, setUser] = useState<any>(null);
  const [authReady, setAuthReady] = useState(false);
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => { setUser(session?.user ?? null); setAuthReady(true); });
    const { data: { subscription: s } } = supabase.auth.onAuthStateChange((_e, session) => setUser(session?.user ?? null));
    return () => s.unsubscribe();
  }, []);

  // Pre-fill from auth user if already logged in
  useEffect(() => {
    if (user && !email) {
      setEmail(user.email || '');
      setFullName(user.user_metadata?.full_name || '');
    }
  }, [user]);

  // ─── Plans from DB ───
  const [plans, setPlans] = useState<Plan[]>([]);
  const [plansLoading, setPlansLoading] = useState(true);
  useEffect(() => { fetchPlans().then(setPlans).catch(() => {}).finally(() => setPlansLoading(false)); }, []);

  // ─── Flow state (persisted in sessionStorage to survive re-renders) ───
  const [step, setStepRaw] = useState<StepId>(() => {
    const saved = sessionStorage.getItem('onb_step');
    return (saved && STEPS.includes(saved as StepId)) ? saved as StepId : 'basic';
  });
  const setStep = (s: StepId) => { sessionStorage.setItem('onb_step', s); setStepRaw(s); };
  const [selectedSlug, setSelectedSlugRaw] = useState(() => sessionStorage.getItem('onb_plan') || planParam);
  const setSelectedSlug = (s: string) => { sessionStorage.setItem('onb_plan', s); setSelectedSlugRaw(s); };
  const [interval, setIntervalRaw] = useState<'monthly' | 'yearly'>(() => (sessionStorage.getItem('onb_interval') as any) || 'yearly');
  const setInterval = (v: 'monthly' | 'yearly') => { sessionStorage.setItem('onb_interval', v); setIntervalRaw(v); };
  const [currency] = useState<'USD' | 'CAD'>('CAD');

  // Step 1 — basic info (persisted to survive remounts)
  const [fullName, setFullNameRaw] = useState(() => sessionStorage.getItem('onb_name') || '');
  const setFullName = (v: string) => { sessionStorage.setItem('onb_name', v); setFullNameRaw(v); };
  const [email, setEmailRaw] = useState(() => sessionStorage.getItem('onb_email') || '');
  const setEmail = (v: string) => { sessionStorage.setItem('onb_email', v); setEmailRaw(v); };
  const [phone, setPhone] = useState('');

  // Step 1 — signup fields (persisted)
  const [password, setPasswordRaw] = useState(() => sessionStorage.getItem('onb_pw') || '');
  const setPassword = (v: string) => { sessionStorage.setItem('onb_pw', v); setPasswordRaw(v); };
  const [showPw, setShowPw] = useState(false);

  // Step 2 — company
  const [companyName, setCompanyName] = useState('');
  const [industry, setIndustry] = useState('');
  const [website, setWebsite] = useState('');

  // Step 3 — profile
  const [teamSize, setTeamSize] = useState('');
  const [yearsInBusiness, setYearsInBusiness] = useState('');

  // Step 4 — revenue
  const [estimatedRevenue, setEstimatedRevenue] = useState('');

  // Step 5 — goals
  const [goal, setGoal] = useState('');

  // Step 6 — attribution
  const [heardFrom, setHeardFrom] = useState('');

  // Step 8 — checkout
  const [promoCode, setPromoCode] = useState('');
  const [promoValid, setPromoValid] = useState<null | { discount_type: string; discount_value: number }>(null);
  const [referralCode, setReferralCode] = useState(refParam);
  const [processing, setProcessing] = useState(false);
  const [signupLoading, setSignupLoading] = useState(false);
  const [signupError, setSignupError] = useState('');

  // Email verification state
  const [emailVerified, setEmailVerified] = useState<boolean | null>(null);
  const [resendingVerification, setResendingVerification] = useState(false);

  // Referral validation
  useEffect(() => {
    if (refParam) validateReferralCode(refParam).then(v => { if (v) setReferralCode(refParam); });
  }, [refParam]);

  // Check email verification when reaching checkout step
  useEffect(() => {
    if (step === 'checkout' && user) {
      (async () => {
        try {
          const { checkEmailVerified } = await import('../lib/billingApi');
          const result = await checkEmailVerified();
          setEmailVerified(result.verified);
        } catch {
          setEmailVerified(null);
        }
      })();
    }
  }, [step, user]);

  // Resend verification email
  const handleResendVerification = async () => {
    if (!email) return;
    setResendingVerification(true);
    try {
      await fetch('/api/auth/resend-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      toast.success(isFr ? 'Email de vérification renvoyé!' : 'Verification email resent!');
    } catch {
      toast.error(isFr ? 'Erreur, réessayez' : 'Error, try again');
    }
    setResendingVerification(false);
  };

  // ─── Computed ───
  const plan = useMemo(() => plans.find(p => p.slug === selectedSlug) || plans[0] || null, [plans, selectedSlug]);

  // If no plan selected but plans loaded, auto-select first
  useEffect(() => {
    if (plans.length > 0 && !selectedSlug) setSelectedSlug(plans[0].slug);
  }, [plans, selectedSlug]);

  const getPrice = useCallback((p: Plan) => {
    const key = interval === 'yearly'
      ? (currency === 'USD' ? 'yearly_price_usd' : 'yearly_price_cad')
      : (currency === 'USD' ? 'monthly_price_usd' : 'monthly_price_cad');
    return (p as any)[key] || 0;
  }, [interval, currency]);

  const price = plan ? getPrice(plan) : 0;
  let discountedPrice = price;
  if (promoValid) {
    discountedPrice = promoValid.discount_type === 'percentage'
      ? Math.round(price * (1 - promoValid.discount_value / 100))
      : Math.max(0, price - promoValid.discount_value);
  }

  const stepIdx = STEPS.indexOf(step);
  const progress = ((stepIdx + 1) / STEPS.length) * 100;

  const provisionOrg = async () => {
    const { data: { user: u } } = await supabase.auth.getUser();
    if (!u) return;
    const { data: mem } = await supabase.from('memberships').select('org_id').eq('user_id', u.id).limit(1).maybeSingle();
    if (!mem) {
      const { data: newOrg } = await supabase.from('orgs').insert({ name: companyName || u.email?.split('@')[0] || 'Workspace', created_by: u.id }).select('id').single();
      if (newOrg) await supabase.from('memberships').insert({ user_id: u.id, org_id: newOrg.id, role: 'owner' });
    }
    try { await supabase.from('profiles').update({ onboarding_done: true }).eq('id', u.id); } catch {}
  };

  const goNext = () => {
    const i = STEPS.indexOf(step);
    const next = STEPS[i + 1];
    console.log('[goNext]', step, '->', next);
    if (next) setStep(next);
  };
  const goBack = () => {
    const i = STEPS.indexOf(step);
    if (i > 0) setStep(STEPS[i - 1]);
  };

  // ─── Signup (step 1) ───
  const handleCreateAccount = async () => {
    if (user) { goNext(); return; }
    if (!email || !password) { toast.error('Email and password required'); return; }
    if (password.length < 10) { setSignupError(isFr ? '10+ caractères requis' : '10+ characters required'); return; }
    setSignupLoading(true); setSignupError('');
    try {
      // Create account — allows proceeding through onboarding steps.
      // Email verification is checked at checkout step before payment.
      const regRes = await fetch('/api/auth/register-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, fullName: fullName.trim() }),
      });
      const regData = await regRes.json();
      if (!regRes.ok) throw new Error(regData.error || 'Registration failed');

      // Track email verification status for checkout step
      if (regData.email_verified === false) {
        setEmailVerified(false);
        toast.info(isFr ? 'Un email de vérification a été envoyé!' : 'A verification email has been sent!', { duration: 5000 });
      } else if (regData.email_verified === true) {
        setEmailVerified(true);
      }

      // Sign in immediately to proceed through onboarding
      const { data: signInData, error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
      if (signInErr) throw new Error(signInErr.message);

      // Save token for checkout step (survives App.tsx remounts)
      if (signInData.session?.access_token) {
        sessionStorage.setItem('onb_token', signInData.session.access_token);
        sessionStorage.setItem('onb_uid', signInData.session.user.id);
      }

      setUser(signInData.session?.user ?? null);
      try { await provisionOrg(); } catch {}
      goNext();
    } catch (err: any) {
      const msg = err.message || '';
      if (msg.includes('Invalid login')) {
        toast.error(isFr ? 'Mot de passe incorrect' : 'Invalid password');
      } else {
        toast.error(msg);
      }
      setSignupError(msg);
    }
    finally { setSignupLoading(false); }
  };

  // ─── Save onboarding + subscribe (step 8) ───
  const handleCheckout = async (_paymentMethodId?: string) => {
    if (!plan) { toast.error('No plan selected'); setProcessing(false); return; }
    setProcessing(true);

    let token = '';
    try {
      const { data: { session } } = await supabase.auth.getSession();
      token = session?.access_token || '';
      if (!token) { toast.error(isFr ? 'Créez un compte d\'abord' : 'Create an account first'); setProcessing(false); return; }
    } catch { toast.error('Session error'); setProcessing(false); return; }

    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

    // 1. Provision org
    try { await provisionOrg(); } catch {}

    // 2. Save onboarding
    try { await fetch('/api/billing/onboarding', { method: 'POST', headers, body: JSON.stringify({ full_name: fullName, company_name: companyName, email, phone, currency }) }); } catch {}

    // 3. Subscribe
    try {
      const res = await fetch('/api/billing/subscribe', {
        method: 'POST', headers,
        body: JSON.stringify({ plan_slug: selectedSlug, interval, currency, promo_code: promoCode || undefined, referral_code: referralCode || undefined, billing_email: email, company_name: companyName }),
      });

      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        if (d.code === 'EMAIL_NOT_VERIFIED') {
          setEmailVerified(false);
          toast.error(isFr ? 'Vérifiez votre email avant de continuer' : 'Please verify your email before continuing');
          setProcessing(false);
          return;
        }
        toast.error(d.error || 'Subscription failed');
        setProcessing(false);
        return;
      }

      // Success — clean up and redirect
      ['onb_step','onb_plan','onb_interval','onb_name','onb_email','onb_pw','onb_token','onb_uid'].forEach(k => sessionStorage.removeItem(k));
      alert(isFr ? 'Abonnement activé! Bienvenue sur Lume.' : 'Subscription activated! Welcome to Lume.');
      window.location.href = '/';
      return;
    } catch (err: any) {
      toast.error(err.message || 'Network error');
      setProcessing(false);
    }
  };

  // ─── Loading ───
  if (!authReady || plansLoading) {
    return <div className="min-h-screen flex items-center justify-center bg-[#fafaf8]"><Loader2 className="animate-spin text-gray-400" size={24} /></div>;
  }

  // ─── Render ───
  const panel = STEP_PANELS[step];
  const isCheckout = step === 'checkout';

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* ── Top bar ── */}
      <div className="sticky top-0 z-50 bg-white">
        <div className="px-6 h-14 flex items-center justify-between border-b border-gray-100">
          <img src="/lume-logo-v2.png" alt="Lume" className="h-8" />
          <span className="text-xs text-gray-400">{isFr ? 'Étape' : 'Step'} {stepIdx + 1}/{STEPS.length}</span>
        </div>
        {/* Progress bar — thin line below header */}
        <div className="h-0.5 bg-gray-100">
          <motion.div className="h-full bg-[#1F5F4F]" animate={{ width: `${progress}%` }} transition={{ duration: 0.3 }} />
        </div>
      </div>

      {/* ── Content ── */}
      <div className="flex-1 flex">
        {/* LEFT — form */}
        <div className={cn('flex-1 py-12 overflow-y-auto', isCheckout ? 'px-6 md:px-12' : 'px-8 md:px-16 lg:px-24 max-w-2xl')}>
          <div key={step}>

              {/* ═══════ STEP 1: Basic info ═══════ */}
              {step === 'basic' && (
                <div>
                  <h1 className="text-2xl md:text-3xl font-bold text-gray-900 leading-tight">{isFr ? 'Commençons' : "Let's get started"}</h1>
                  <p className="text-sm text-gray-500 mt-2 mb-8">{isFr ? 'Créez votre compte Lume' : 'Create your Lume account'}</p>
                  <div className="space-y-4">
                    <Field label={isFr ? 'Nom complet' : 'Full name'} required>
                      <input value={fullName} onChange={e => setFullName(e.target.value)} placeholder="John Doe" className="onb-input" />
                    </Field>
                    <Field label={isFr ? 'Courriel' : 'Email'} required>
                      <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" className="onb-input" />
                    </Field>
                    {!user && (
                      <Field label={isFr ? 'Mot de passe' : 'Password'} required>
                        <div className="relative">
                          <input type={showPw ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)}
                            placeholder={isFr ? '10+ caractères' : '10+ characters'} className="onb-input pr-10" />
                          <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                            {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                          </button>
                        </div>
                      </Field>
                    )}
                    <Field label={isFr ? 'Téléphone' : 'Phone'}>
                      <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="(555) 123-4567" className="onb-input" />
                    </Field>
                    {signupError && <p className="text-xs text-red-600 bg-red-50 p-2.5 rounded-lg">{signupError}</p>}
                  </div>
                  <button onClick={() => {
                    if (!fullName.trim() || !email.trim()) { toast.error(isFr ? 'Nom et courriel requis' : 'Name and email required'); return; }
                    if (!password || password.length < 10) { toast.error(isFr ? 'Mot de passe: 10+ caractères' : 'Password: 10+ characters'); return; }
                    goNext();
                  }} disabled={signupLoading}
                    className="onb-btn mt-8">
                    {signupLoading ? <Loader2 size={16} className="animate-spin" /> : <>{isFr ? 'Suivant' : 'Next'} <ArrowRight size={16} /></>}
                  </button>
                  {!user && (
                    <p className="text-center text-xs text-gray-400 mt-4">
                      {isFr ? 'Déjà un compte?' : 'Already have an account?'}{' '}
                      <button onClick={() => navigate('/auth')} className="text-[#1F5F4F] font-medium hover:underline">{isFr ? 'Se connecter' : 'Sign in'}</button>
                    </p>
                  )}
                </div>
              )}

              {/* ═══════ STEP 2: Company ═══════ */}
              {step === 'company' && (
                <div>
                  <h1 className="text-2xl md:text-3xl font-bold text-gray-900">{isFr ? 'Votre entreprise' : 'Tell us about your business'}</h1>
                  <p className="text-sm text-gray-500 mt-2 mb-8">{isFr ? 'Ces informations nous aident à personnaliser votre expérience.' : 'Understanding your business helps us tailor Lume to your needs.'}</p>
                  <div className="space-y-4">
                    <Field label={isFr ? "Nom de l'entreprise" : 'Company name'} required>
                      <input value={companyName} onChange={e => setCompanyName(e.target.value)} placeholder="ABC Landscaping" className="onb-input" />
                    </Field>
                    <Field label={isFr ? 'Industrie' : 'Industry'}>
                      <input value={industry} onChange={e => setIndustry(e.target.value)} placeholder={isFr ? 'Ex: Aménagement paysager' : 'e.g. Landscaping'} className="onb-input" />
                    </Field>
                    <Field label={isFr ? 'Site web' : 'Website'}>
                      <input value={website} onChange={e => setWebsite(e.target.value)} placeholder="https://..." className="onb-input" />
                    </Field>
                  </div>
                  <NavButtons onBack={goBack} onNext={goNext} disabled={!companyName.trim()} />
                </div>
              )}

              {/* ═══════ STEP 3: Business profile ═══════ */}
              {step === 'profile' && (
                <div>
                  <h1 className="text-2xl md:text-3xl font-bold text-gray-900">{isFr ? 'Votre entreprise en bref' : 'Your business at a glance'}</h1>
                  <p className="text-sm text-gray-500 mt-2 mb-8">{isFr ? 'On adapte les outils selon votre réalité.' : 'We use this to suggest the right tools and workflows.'}</p>
                  <div className="space-y-6">
                    <div>
                      <p className="text-sm font-semibold text-gray-900 mb-3">{isFr ? "Combien de personnes dans l'équipe?" : 'How many people work at your company?'}</p>
                      <ChipGroup options={[isFr ? 'Juste moi' : 'Just me', '2-5', '6-10', '11-19', '20+']} value={teamSize} onChange={setTeamSize} />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-900 mb-3">{isFr ? "Depuis combien d'années êtes-vous en affaires?" : 'How many years have you been in business?'}</p>
                      <ChipGroup options={[isFr ? 'Moins de 1 an' : 'Less than 1 year', '1-2', '3-5', '6-10', '10+']} value={yearsInBusiness} onChange={setYearsInBusiness} />
                    </div>
                  </div>
                  <NavButtons onBack={goBack} onNext={goNext} />
                </div>
              )}

              {/* ═══════ STEP 4: Revenue ═══════ */}
              {step === 'revenue' && (
                <div>
                  <h1 className="text-2xl md:text-3xl font-bold text-gray-900">{isFr ? 'Estimez votre chiffre d\'affaires' : "Let's fine-tune your experience"}</h1>
                  <p className="text-sm text-gray-500 mt-2 mb-8">{isFr ? 'On adapte les bons outils à votre volume.' : "What's your estimated revenue for this year?"}</p>
                  <ChipGroup
                    options={['$0 - $50K', '$50K - $150K', '$150K - $500K', '$500K - $1M', '$1M+', isFr ? 'Je préfère ne pas dire' : 'I prefer not to say']}
                    value={estimatedRevenue} onChange={setEstimatedRevenue}
                  />
                  <NavButtons onBack={goBack} onNext={goNext} />
                </div>
              )}

              {/* ═══════ STEP 5: Goals ═══════ */}
              {step === 'goals' && (
                <div>
                  <h1 className="text-2xl md:text-3xl font-bold text-gray-900">{isFr ? "Qu'est-ce qui vous amène ici?" : "What's top of mind for you?"}</h1>
                  <p className="text-sm text-gray-500 mt-2 mb-8">{isFr ? 'Sélectionnez une option.' : 'Select an option to continue.'}</p>
                  <div className="space-y-3">
                    {[
                      { id: 'grow', label: isFr ? 'Je veux faire croître mon entreprise' : 'I want to grow my business faster' },
                      { id: 'organize', label: isFr ? 'Je veux être plus organisé' : 'I want to feel in control of my business' },
                      { id: 'save', label: isFr ? 'Je veux sauver du temps' : 'I want to save time on admin work' },
                      { id: 'explore', label: isFr ? 'Je regarde juste' : "I'm not sure yet, just exploring" },
                    ].map(o => (
                      <button key={o.id} onClick={() => setGoal(o.id)}
                        className={cn('w-full text-left p-4 rounded-xl border-2 text-sm font-medium transition-all',
                          goal === o.id ? 'border-[#1F5F4F] bg-[#1F5F4F]/5 text-gray-900' : 'border-gray-200 text-gray-600 hover:border-gray-300')}>
                        {o.label}
                      </button>
                    ))}
                  </div>
                  <NavButtons onBack={goBack} onNext={goNext} />
                </div>
              )}

              {/* ═══════ STEP 6: Attribution ═══════ */}
              {step === 'attribution' && (
                <div>
                  <h1 className="text-2xl md:text-3xl font-bold text-gray-900">{isFr ? 'Comment avez-vous entendu parler de Lume?' : "We'd love to know..."}</h1>
                  <p className="text-sm text-gray-500 mt-2 mb-8">{isFr ? 'Merci de nous aider à nous améliorer.' : 'How did you find out about Lume?'}</p>
                  <Field label="">
                    <input value={heardFrom} onChange={e => setHeardFrom(e.target.value)} placeholder={isFr ? 'Ex: Google, référence, réseaux sociaux...' : 'e.g. Google, referral, social media...'} className="onb-input" />
                  </Field>
                  <NavButtons onBack={goBack} onNext={goNext} nextLabel={isFr ? 'Continuer' : 'Get Started'} />
                </div>
              )}

              {/* ═══════ STEP 7: Plan optimization ═══════ */}
              {step === 'optimize' && (
                <div>
                  <h1 className="text-2xl md:text-3xl font-bold text-gray-900">{isFr ? 'Optimisez votre plan' : 'Optimize your plan'}</h1>
                  <p className="text-sm text-gray-500 mt-2 mb-8">
                    {isFr ? 'Votre plan actuel:' : 'Your current plan:'} <strong>{PLAN_NAMES[selectedSlug] || selectedSlug}</strong>
                    {' — '}${Math.round((plan ? (currency === 'USD' ? plan.monthly_price_usd : plan.monthly_price_cad) : 0) / 100)}/{isFr ? 'mois' : 'mo'}
                  </p>

                  <div className="space-y-4">
                    {/* ── Yearly savings card ── */}
                    {plan && (() => {
                      const monthlyPrice = (currency === 'USD' ? plan.monthly_price_usd : plan.monthly_price_cad);
                      const yearlyTotal = (currency === 'USD' ? plan.yearly_price_usd : plan.yearly_price_cad);
                      const yearlyMonthly = Math.round(yearlyTotal / 12);
                      const savedPerMonth = monthlyPrice - yearlyMonthly;
                      const savedPerYear = savedPerMonth * 12;
                      return (
                        <div className={cn('p-5 rounded-xl border-2 transition-all cursor-pointer',
                          interval === 'yearly' ? 'border-[#3FAF97] bg-[#3FAF97]/5' : 'border-gray-200 hover:border-gray-300')}
                          onClick={() => setInterval(interval === 'yearly' ? 'monthly' : 'yearly')}>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <div className={cn('w-5 h-5 rounded-full border-2 flex items-center justify-center',
                                interval === 'yearly' ? 'border-[#3FAF97] bg-[#3FAF97]' : 'border-gray-300')}>
                                {interval === 'yearly' && <Check size={10} className="text-white" strokeWidth={3} />}
                              </div>
                              <div>
                                <p className="text-sm font-bold text-gray-900">{isFr ? 'Passer à la facturation annuelle' : 'Switch to annual billing'}</p>
                                <p className="text-xs text-gray-500 mt-0.5">
                                  {isFr ? `Économisez $${Math.round(savedPerYear / 100)}/an ($${Math.round(savedPerMonth / 100)}/mois)`
                                         : `Save $${Math.round(savedPerYear / 100)}/yr ($${Math.round(savedPerMonth / 100)}/mo)`}
                                </p>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="text-sm font-bold text-gray-900">${Math.round(yearlyMonthly / 100)}<span className="text-xs font-normal text-gray-500">/{isFr ? 'mois' : 'mo'}</span></p>
                              <p className="text-xs text-gray-400 line-through">${Math.round(monthlyPrice / 100)}/{isFr ? 'mois' : 'mo'}</p>
                            </div>
                          </div>
                        </div>
                      );
                    })()}

                    {/* ── Upsell to higher plans ── */}
                    {plans.filter(p => p.is_active && p.sort_order > (plan?.sort_order ?? 0)).sort((a, b) => a.sort_order - b.sort_order).map(p => {
                      const pMonthly = (currency === 'USD' ? p.monthly_price_usd : p.monthly_price_cad);
                      const currentMonthly = plan ? (currency === 'USD' ? plan.monthly_price_usd : plan.monthly_price_cad) : 0;
                      const diff = pMonthly - currentMonthly;
                      // Features the current plan doesn't have
                      const currentFeatures = plan?.features || [];
                      const extraFeatures = (p.features || []).filter((f: string) => !f.toLowerCase().startsWith('everything'));
                      const isSelected = selectedSlug === p.slug;

                      return (
                        <div key={p.slug}
                          className={cn('p-5 rounded-xl border-2 transition-all cursor-pointer',
                            isSelected ? 'border-[#1F5F4F] bg-[#1F5F4F]/5' : 'border-gray-200 hover:border-gray-300')}
                          onClick={() => setSelectedSlug(isSelected ? (planParam || 'pro') : p.slug)}>
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-3">
                              <div className={cn('w-5 h-5 rounded-full border-2 flex items-center justify-center',
                                isSelected ? 'border-[#1F5F4F] bg-[#1F5F4F]' : 'border-gray-300')}>
                                {isSelected && <Check size={10} className="text-white" strokeWidth={3} />}
                              </div>
                              <div>
                                <p className="text-sm font-bold text-gray-900">
                                  {isFr ? `Passer au plan ${PLAN_NAMES[p.slug] || p.name}` : `Upgrade to ${PLAN_NAMES[p.slug] || p.name}`}
                                </p>
                                <p className="text-xs text-[#3FAF97] font-medium mt-0.5">
                                  +${Math.round(diff / 100)}/{isFr ? 'mois' : 'mo'} {isFr ? 'de plus' : 'more'}
                                </p>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="text-sm font-bold text-gray-900">${Math.round(pMonthly / 100)}<span className="text-xs font-normal text-gray-500">/{isFr ? 'mois' : 'mo'}</span></p>
                            </div>
                          </div>
                          {/* Extra features you unlock */}
                          <div className="pl-8 space-y-1.5">
                            {extraFeatures.map((f: string, i: number) => (
                              <div key={i} className="flex items-center gap-2 text-xs text-gray-600">
                                <Check size={12} className="text-[#3FAF97] shrink-0" strokeWidth={3} />
                                {f}
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <NavButtons onBack={goBack} onNext={goNext} nextLabel={isFr ? 'Continuer au paiement' : 'Continue to Checkout'} />
                </div>
              )}

              {/* ═══════ STEP 8: Checkout ═══════ */}
              {step === 'checkout' && !plan && (
                <div className="text-center py-12">
                  <p className="text-gray-500 mb-4">{isFr ? 'Aucun plan sélectionné' : 'No plan selected'}</p>
                  <button onClick={() => setStep('basic')} className="onb-btn">{isFr ? 'Recommencer' : 'Start over'}</button>
                </div>
              )}
              {step === 'checkout' && plan && (
                <CheckoutStep
                  plan={plan}
                  planName={PLAN_NAMES[selectedSlug] || plan.name}
                  interval={interval}
                  setInterval={setInterval}
                  currency={currency}
                  price={price}
                  discountedPrice={discountedPrice}
                  promoCode={promoCode}
                  setPromoCode={setPromoCode}
                  promoValid={promoValid}
                  setPromoValid={setPromoValid}
                  email={email}
                  setEmail={setEmail}
                  password={password}
                  companyName={companyName}
                  processing={processing}
                  isFr={isFr}
                  onBack={goBack}
                  onCheckout={handleCheckout}
                  emailVerified={emailVerified}
                  resendingVerification={resendingVerification}
                  onResendVerification={handleResendVerification}
                />
              )}

          </div>
        </div>

        {/* RIGHT — visual panel (hidden on checkout step and mobile) */}
        {!isCheckout && panel.image && (
          <div className="hidden lg:flex w-[45%] relative bg-gray-900 overflow-hidden">
            <img src={panel.image} alt="" className="absolute inset-0 w-full h-full object-cover opacity-60" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-black/10" />
            <div className="relative z-10 flex flex-col justify-end p-12">
              {panel.quote && (
                <>
                  <p className="text-xs text-white/50 font-semibold uppercase tracking-widest mb-3">Did you know...</p>
                  <p className="text-xl md:text-2xl font-bold text-white leading-snug">{panel.quote}</p>
                  {panel.author && <p className="text-sm text-white/60 mt-3 font-medium">{panel.author}</p>}
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Inline styles for inputs ── */}
      <style>{`
        .onb-input {
          width: 100%;
          padding: 0.65rem 0.875rem;
          border: 1px solid #e5e5e5;
          border-radius: 0.75rem;
          font-size: 0.875rem;
          color: #171717;
          background: white;
          outline: none;
          transition: border-color 0.15s, box-shadow 0.15s;
        }
        .onb-input:focus {
          border-color: #1F5F4F;
          box-shadow: 0 0 0 3px rgba(31, 95, 79, 0.1);
        }
        .onb-input::placeholder { color: #a3a3a3; }
        .onb-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
          width: 100%;
          max-width: 200px;
          padding: 0.75rem 1.5rem;
          background: #171717;
          color: white;
          border-radius: 0.75rem;
          font-size: 0.875rem;
          font-weight: 600;
          transition: opacity 0.15s;
          cursor: pointer;
        }
        .onb-btn:hover { opacity: 0.85; }
        .onb-btn:disabled { opacity: 0.5; cursor: not-allowed; }
      `}</style>
    </div>
  );
}

// ─── Checkout Step (uses Stripe Elements) ───

function CheckoutStep({ plan, planName, interval, setInterval, currency, price, discountedPrice, promoCode, setPromoCode, promoValid, setPromoValid, email, setEmail, password, companyName, processing, isFr, onBack, onCheckout, emailVerified, resendingVerification, onResendVerification }: {
  plan: Plan; planName: string; interval: 'monthly' | 'yearly'; setInterval: (v: 'monthly' | 'yearly') => void;
  currency: string; price: number; discountedPrice: number;
  promoCode: string; setPromoCode: (v: string) => void;
  promoValid: any; setPromoValid: (v: any) => void;
  email: string; setEmail: (v: string) => void;
  password: string; companyName: string;
  processing: boolean; isFr: boolean; onBack: () => void; onCheckout: (pmId?: string) => Promise<void> | void;
  emailVerified: boolean | null; resendingVerification: boolean; onResendVerification: () => void;
}) {
  const [redirecting, setRedirecting] = useState(false);

  const handleStripeCheckout = async () => {
    setRedirecting(true);
    try {
      if (discountedPrice === 0) {
        // Free with promo — activate directly
        await onCheckout();
        // If we're still here (redirect didn't happen), reset
        setRedirecting(false);
        return;
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) { toast.error('Not logged in'); setRedirecting(false); return; }

      const res = await fetch('/api/billing/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ plan_slug: plan.slug, interval, currency, promo_code: promoCode || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create checkout session');

      window.location.href = data.url;
    } catch (err: any) {
      toast.error(err.message || 'Error');
      setRedirecting(false);
    }
  };

  const monthlyPrice = currency === 'USD' ? plan.monthly_price_usd : plan.monthly_price_cad;
  const yearlyPrice = currency === 'USD' ? plan.yearly_price_usd : plan.yearly_price_cad;
  const yearlyMonthly = Math.round(yearlyPrice / 12);
  const savedPerYear = (monthlyPrice * 12) - yearlyPrice;

  return (
    <div className="max-w-5xl mx-auto w-full">
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-4"><ArrowLeft size={14} /> {isFr ? 'Retour' : 'Back'}</button>

      {/* Hero banner */}
      <div className="relative rounded-2xl overflow-hidden mb-8">
        <img src="/industries/landscaping.png" alt="" className="w-full h-48 object-cover" />
        <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/60 to-black/30" />
        <div className="absolute inset-0 flex items-center px-8 md:px-12">
          <div>
            <p className="text-[#3FAF97] text-xs font-bold uppercase tracking-widest mb-2">{isFr ? 'Dernière étape' : 'Final step'}</p>
            <h1 className="text-2xl md:text-3xl font-bold text-white">{isFr ? 'Activez votre plan' : 'Activate your plan'} {planName}</h1>
            <p className="text-sm text-white/70 mt-1">{isFr ? 'Accès instantané à tous les outils Lume' : 'Instant access to all Lume tools'}</p>
          </div>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-8">
        {/* LEFT — billing options */}
        <div className="flex-1 space-y-6">
          {/* Billing cycle */}
          <div className="bg-white rounded-2xl border border-gray-200 p-6">
            <p className="text-base font-bold text-gray-900 mb-4">{isFr ? 'Cycle de facturation' : 'Billing cycle'}</p>
            <div className="space-y-3">
              {(['yearly', 'monthly'] as const).map(iv => {
                const p = iv === 'yearly' ? yearlyPrice : monthlyPrice;
                const perMonth = iv === 'yearly' ? yearlyMonthly : monthlyPrice;
                const isSelected = interval === iv;
                return (
                  <button key={iv} onClick={() => setInterval(iv)}
                    className={cn('w-full flex items-center justify-between p-4 rounded-xl border-2 text-left transition-all',
                      isSelected ? 'border-[#1F5F4F] bg-[#1F5F4F]/5' : 'border-gray-200 hover:border-gray-300')}>
                    <div className="flex items-center gap-3">
                      <div className={cn('w-5 h-5 rounded-full border-2 flex items-center justify-center', isSelected ? 'border-[#1F5F4F] bg-[#1F5F4F]' : 'border-gray-300')}>
                        {isSelected && <Check size={10} className="text-white" strokeWidth={3} />}
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-gray-900">{iv === 'yearly' ? (isFr ? 'Annuel' : 'Annual') : (isFr ? 'Mensuel' : 'Monthly')}</p>
                        {iv === 'yearly' && <p className="text-xs text-[#3FAF97] font-medium">{isFr ? `Économisez $${Math.round(savedPerYear / 100)}/an` : `Save $${Math.round(savedPerYear / 100)}/yr`}</p>}
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-base font-bold text-gray-900">${Math.round(perMonth / 100)}<span className="text-xs font-normal text-gray-500">/{isFr ? 'mois' : 'mo'}</span></p>
                      {iv === 'yearly' && <p className="text-[10px] text-gray-400 line-through">${Math.round(monthlyPrice / 100)}/{isFr ? 'mois' : 'mo'}</p>}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Promo code */}
          <div className="bg-white rounded-2xl border border-gray-200 p-6">
            <p className="text-sm font-bold text-gray-900 mb-3">{isFr ? 'Code promotionnel' : 'Promo code'}</p>
            <div className="flex gap-2">
              <input value={promoCode} onChange={e => setPromoCode(e.target.value)} placeholder={isFr ? 'Entrez votre code' : 'Enter your code'} className="onb-input flex-1" />
              <button onClick={async () => {
                const r = await validatePromoCode(promoCode);
                if (r) { setPromoValid(r); toast.success(isFr ? 'Code appliqué!' : 'Code applied!'); }
                else toast.error(isFr ? 'Code invalide' : 'Invalid code');
              }} className="px-5 py-2.5 text-sm font-semibold text-white bg-[#1F5F4F] rounded-xl hover:bg-[#174a3d] transition-colors">
                {isFr ? 'Appliquer' : 'Apply'}
              </button>
            </div>
            {promoValid && (
              <div className="mt-3 flex items-center gap-2 text-sm text-[#3FAF97] bg-[#3FAF97]/5 p-3 rounded-lg">
                <Check size={14} strokeWidth={3} />
                {isFr ? `Code ${promoCode.toUpperCase()} appliqué — ${promoValid.discount_value}% de rabais` : `Code ${promoCode.toUpperCase()} applied — ${promoValid.discount_value}% off`}
              </div>
            )}
          </div>

          {/* What you get */}
          <div className="bg-white rounded-2xl border border-gray-200 p-6">
            <p className="text-sm font-bold text-gray-900 mb-3">{isFr ? 'Ce qui est inclus' : "What's included"}</p>
            <div className="grid grid-cols-2 gap-2">
              {(plan.features || []).map((f: string, i: number) => (
                <div key={i} className="flex items-center gap-2 text-xs text-gray-600 py-1">
                  <Check size={12} className="text-[#3FAF97] shrink-0" strokeWidth={3} />
                  {f}
                </div>
              ))}
            </div>
          </div>

          {/* Social proof */}
          <div className="bg-[#1F5F4F] rounded-2xl p-6 text-white">
            <div className="flex items-center gap-4 mb-4">
              <div className="grid grid-cols-3 gap-6 flex-1 text-center">
                <div>
                  <p className="text-2xl font-bold">37%</p>
                  <p className="text-[10px] text-white/60">{isFr ? 'Plus de revenus' : 'More revenue'}</p>
                </div>
                <div>
                  <p className="text-2xl font-bold">7h</p>
                  <p className="text-[10px] text-white/60">{isFr ? 'Sauvées / sem.' : 'Saved / week'}</p>
                </div>
                <div>
                  <p className="text-2xl font-bold">4x</p>
                  <p className="text-[10px] text-white/60">{isFr ? 'Plus vite payé' : 'Faster paid'}</p>
                </div>
              </div>
            </div>
            <div className="flex gap-0.5 mb-2">
              {[1,2,3,4,5].map(i => (
                <svg key={i} className="w-3.5 h-3.5 text-amber-400 fill-amber-400" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" /></svg>
              ))}
            </div>
            <p className="text-sm text-white/80 italic leading-relaxed">
              "{isFr ? 'On a sauvé l\'équivalent d\'un salaire de secrétaire à temps plein en utilisant Lume.' : 'We saved the equivalent of a full-time secretary salary using Lume.'}"
            </p>
            <p className="text-xs text-white/50 mt-2 font-semibold">— Vision Lavage</p>
          </div>
        </div>

        {/* RIGHT — sticky summary + CTA */}
        <div className="lg:w-[380px] shrink-0">
          <div className="sticky top-20 space-y-4">
            <div className="bg-white rounded-2xl border-2 border-[#1F5F4F] p-6 shadow-lg">
              <p className="text-xs font-bold text-[#1F5F4F] uppercase tracking-widest mb-3">{isFr ? 'Votre commande' : 'Your order'}</p>

              <div className="space-y-3 pb-4 border-b border-gray-200">
                <div className="flex justify-between text-sm">
                  <span className="font-semibold text-gray-900">{planName}</span>
                  <span className="font-semibold">${Math.round((interval === 'yearly' ? yearlyMonthly : monthlyPrice) / 100)}/{isFr ? 'mois' : 'mo'}</span>
                </div>
                <p className="text-xs text-gray-500">{interval === 'yearly' ? (isFr ? `Facturé $${Math.round(yearlyPrice / 100)}/an` : `Billed $${Math.round(yearlyPrice / 100)}/yr`) : (isFr ? 'Facturé mensuellement' : 'Billed monthly')}</p>
                {interval === 'yearly' && (
                  <div className="flex justify-between text-sm text-[#3FAF97]">
                    <span>{isFr ? 'Économie' : 'Savings'}</span>
                    <span>-${Math.round(savedPerYear / 100)}/{isFr ? 'an' : 'yr'}</span>
                  </div>
                )}
                {promoValid && (
                  <div className="flex justify-between text-sm text-[#3FAF97]">
                    <span>{promoCode.toUpperCase()}</span>
                    <span>-${((price - discountedPrice) / 100).toFixed(2)}</span>
                  </div>
                )}
              </div>

              <div className="flex justify-between items-end pt-4 mb-6">
                <div>
                  <p className="text-xs text-gray-500">{isFr ? "Facturé aujourd'hui" : 'Billed today'}</p>
                  <p className="text-3xl font-bold text-gray-900">${(discountedPrice / 100).toFixed(2)}</p>
                  <p className="text-[10px] text-gray-400">{currency}</p>
                </div>
                {discountedPrice === 0 && (
                  <span className="px-3 py-1 bg-[#3FAF97]/10 text-[#1F5F4F] text-xs font-bold rounded-full">{isFr ? 'GRATUIT' : 'FREE'}</span>
                )}
              </div>

              {/* Email verification warning */}
              {emailVerified === false && (
                <div className="mb-4 p-4 bg-amber-50 border border-amber-200 rounded-xl">
                  <div className="flex items-start gap-3">
                    <Mail size={18} className="text-amber-600 shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-amber-800">
                        {isFr ? 'Email non vérifié' : 'Email not verified'}
                      </p>
                      <p className="text-xs text-amber-700 mt-1">
                        {isFr
                          ? 'Vérifiez votre email avant de continuer au paiement. Vérifiez votre boîte de réception.'
                          : 'Please verify your email before proceeding to payment. Check your inbox.'}
                      </p>
                      <button
                        onClick={onResendVerification}
                        disabled={resendingVerification}
                        className="mt-2 text-xs font-semibold text-amber-700 underline hover:text-amber-900 disabled:opacity-50"
                      >
                        {resendingVerification
                          ? (isFr ? 'Envoi en cours...' : 'Sending...')
                          : (isFr ? 'Renvoyer l\'email de vérification' : 'Resend verification email')}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <button onClick={async () => {
                if (emailVerified === false) {
                  toast.error(isFr ? 'Vérifiez votre email d\'abord' : 'Verify your email first');
                  return;
                }
                try {
                  const hdrs = { 'Content-Type': 'application/json' };
                  const storedName = sessionStorage.getItem('onb_name') || '';
                  const userInfo = { email, full_name: storedName || email.split('@')[0], company_name: companyName };

                  // Redirect to Stripe Checkout — subscription activated by webhook only
                  const r = await fetch('/api/billing/create-checkout-session', {
                    method: 'POST', headers: hdrs,
                    body: JSON.stringify({ ...userInfo, plan_slug: plan.slug, interval, currency, promo_code: promoCode || undefined }),
                  });
                  const d = await r.json();
                  if (!r.ok) {
                    if (d.code === 'EMAIL_NOT_VERIFIED') {
                      toast.error(isFr ? 'Vérifiez votre email d\'abord' : 'Verify your email first');
                      return;
                    }
                    alert('Error: ' + (d.error || 'Failed'));
                    return;
                  }
                  window.location.href = d.url;
                } catch (e: any) { alert('Error: ' + e.message); }
              }}
                disabled={emailVerified === false}
                className="w-full py-4 rounded-xl bg-[#1F5F4F] text-white text-base font-bold hover:bg-[#174a3d] transition-colors flex items-center justify-center gap-2 shadow-lg cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
                {discountedPrice === 0
                  ? <>{isFr ? 'Activer mon compte gratuitement' : 'Activate for free'} <ArrowRight size={16} /></>
                  : <>{isFr ? 'Payer et commencer' : 'Pay and get started'} <Lock size={14} /></>
                }
              </button>

              <div className="mt-4 space-y-2">
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <Lock size={12} className="text-gray-400" />
                  {isFr ? 'Paiement sécurisé par carte de crédit' : 'Secure credit card payment'}
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <Check size={12} className="text-gray-400" />
                  {isFr ? 'Annulable en tout temps, sans frais' : 'Cancel anytime, no fees'}
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <Zap size={12} className="text-gray-400" />
                  {isFr ? 'Accès instantané après paiement' : 'Instant access after payment'}
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <Users size={12} className="text-gray-400" />
                  {isFr ? 'Support prioritaire inclus' : 'Priority support included'}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ───

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      {label && <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1.5">{label}{required && ' *'}</label>}
      {children}
    </div>
  );
}

function NavButtons({ onBack, onNext, disabled, nextLabel }: { onBack: () => void; onNext: () => void; disabled?: boolean; nextLabel?: string }) {
  return (
    <div className="flex items-center gap-3 mt-8">
      <button onClick={onBack} className="text-sm text-gray-500 hover:text-gray-800 transition-colors flex items-center gap-1"><ArrowLeft size={14} /> Back</button>
      <button onClick={onNext} disabled={disabled} className="onb-btn">{nextLabel || 'Next'} <ArrowRight size={16} /></button>
    </div>
  );
}

function ChipGroup({ options, value, onChange }: { options: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(o => (
        <button key={o} onClick={() => onChange(o)}
          className={cn('px-4 py-2 rounded-xl border-2 text-sm font-medium transition-all',
            value === o ? 'border-[#1F5F4F] bg-[#1F5F4F]/5 text-gray-900' : 'border-gray-200 text-gray-600 hover:border-gray-300')}>
          {o}
        </button>
      ))}
    </div>
  );
}

function OptimizeCard({ title, description, price, saving, selected, onClick }: {
  title: string; description: string; price: string; saving?: string; selected?: boolean; onClick: () => void;
}) {
  return (
    <button onClick={onClick} className={cn('w-full text-left p-5 rounded-xl border-2 transition-all',
      selected ? 'border-[#1F5F4F] bg-[#1F5F4F]/5' : 'border-gray-200 hover:border-gray-300')}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-bold text-gray-900">{title}</p>
          <p className="text-xs text-gray-500 mt-0.5">{description}</p>
        </div>
        <div className="text-right">
          <p className="text-sm font-bold text-gray-900">{price}</p>
          {saving && <p className="text-xs text-[#3FAF97] font-medium">-{saving}</p>}
        </div>
      </div>
    </button>
  );
}
