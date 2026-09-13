/**
 * WorkspaceNew — formulaire multi-pages de création de workspace (compagnie).
 *
 * Deux modes, une seule UI :
 *   - 'onboarding' : après paiement, complète l'org auto-provisionné
 *     (remplace l'ancien assistant 3 étapes). Rendu plein écran hors shell.
 *   - 'new' : un propriétaire ouvre une 2e compagnie (/workspaces/new).
 *     Nouveau company_group → à la fin, bascule dessus et va au /checkout
 *     (un abonnement par workspace).
 *
 * Pages : Entreprise* → Coordonnées → Préférences → Avis clients → Équipe →
 * Récapitulatif. Seule la 1re est obligatoire ; les autres se passent.
 * Brouillon en sessionStorage (un rafraîchissement ne perd rien).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowLeft, ArrowRight, Building2, Check, Loader2, MapPin, Plus, Settings2, Star, Trash2, Users, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../lib/utils';
import { supabase } from '../lib/supabase';
import { STORAGE_BUCKETS } from '../lib/storage';
import { useCompany } from '../contexts/CompanyContext';
import { useNavigationGuard } from '../contexts/NavigationGuard';
import { useTranslation } from '../i18n';
import AddressAutocomplete, { type StructuredAddress } from '../components/AddressAutocomplete';
import FileUpload from '../components/FileUpload';
import LeaveFormConfirm from '../components/ui/LeaveFormConfirm';
import {
  createWorkspace,
  type EmployeeCount,
  type InviteRole,
  type WorkspaceMode,
} from '../lib/workspacesApi';

// ── Constantes ──────────────────────────────────────────────────────

const INDUSTRY_KEYS = [
  'landscaping', 'snow_removal', 'residential_cleaning', 'commercial_cleaning',
  'plumbing', 'electrical', 'roofing', 'hvac', 'window_cleaning', 'other',
] as const;
const EMPLOYEE_OPTIONS: EmployeeCount[] = ['1', '2-5', '6-15', '16-50', '50+'];
const INVITE_ROLES: InviteRole[] = ['admin', 'technician', 'sales_rep'];

type StepId = 'company' | 'contact' | 'preferences' | 'reviews' | 'team' | 'review';
const STEPS: StepId[] = ['company', 'contact', 'preferences', 'reviews', 'team', 'review'];

interface Invite { email: string; role: InviteRole }

interface FormState {
  full_name: string;
  company_name: string;
  industry: string;
  employee_count: '' | EmployeeCount;
  language: 'fr' | 'en';
  logo_url: string;
  address_search: string;
  street1: string;
  street2: string;
  city: string;
  province: string;
  postal_code: string;
  country: string;
  phone: string;
  email: string;
  website: string;
  currency: 'CAD' | 'USD';
  timezone: string;
  revenue_goal: string;
  review_enabled: boolean;
  google_review_url: string;
  facebook_review_url: string;
  invites: Invite[];
}

function detectTimezone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Toronto'; } catch { return 'America/Toronto'; }
}

function timezoneOptions(current: string): string[] {
  let all: string[] = [];
  try { all = ((Intl as any).supportedValuesOf?.('timeZone') as string[]) || []; } catch { all = []; }
  const americas = all.filter((z) => z.startsWith('America/'));
  const base = americas.length > 0 ? americas : ['America/Toronto', 'America/Montreal', 'America/Vancouver', 'America/Edmonton', 'America/Winnipeg', 'America/Halifax', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles'];
  return current && !base.includes(current) ? [current, ...base] : base;
}

function defaultState(language: string): FormState {
  return {
    full_name: '',
    company_name: '',
    industry: '',
    employee_count: '',
    language: language === 'en' ? 'en' : 'fr',
    logo_url: '',
    address_search: '',
    street1: '', street2: '', city: '', province: '', postal_code: '', country: '',
    phone: '', email: '', website: '',
    currency: 'CAD',
    timezone: detectTimezone(),
    revenue_goal: '',
    review_enabled: false,
    google_review_url: '',
    facebook_review_url: '',
    invites: [],
  };
}

const fieldLabel = 'text-xs font-medium text-text-tertiary';

// ── Composant ───────────────────────────────────────────────────────

export default function WorkspaceNew({ mode, onComplete }: { mode: WorkspaceMode; onComplete?: () => void }) {
  const navigate = useNavigate();
  const { t, language } = useTranslation();
  const fr = language === 'fr';
  const { currentOrgId, currentRole, userId, refresh } = useCompany();
  const storageKey = `lume-workspace-form:${mode}`;

  const [step, setStep] = useState<StepId>('company');
  const [state, setState] = useState<FormState>(() => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (raw) return { ...defaultState(language), ...JSON.parse(raw) };
    } catch { /* ignore */ }
    return defaultState(language);
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviteDraft, setInviteDraft] = useState<Invite>({ email: '', role: 'technician' });

  useEffect(() => {
    try { sessionStorage.setItem(storageKey, JSON.stringify(state)); } catch { /* ignore */ }
  }, [state, storageKey]);

  // Préremplissage en onboarding : nom du profil + nom d'org auto-provisionné
  // (seulement si l'utilisateur n'a rien saisi encore).
  useEffect(() => {
    if (mode !== 'onboarding' || !userId) return;
    (async () => {
      try {
        const { data: profile } = await supabase.from('profiles').select('full_name').eq('id', userId).maybeSingle();
        if (profile?.full_name) setState((s) => (s.full_name ? s : { ...s, full_name: profile.full_name as string }));
        if (currentOrgId) {
          const { data: cs } = await supabase.from('company_settings').select('company_name').eq('org_id', currentOrgId).limit(1).maybeSingle();
          if (cs?.company_name) setState((s) => (s.company_name ? s : { ...s, company_name: cs.company_name as string }));
        }
      } catch { /* non-fatal */ }
    })();
  }, [mode, userId, currentOrgId]);

  const update = <K extends keyof FormState>(k: K, v: FormState[K]) => setState((s) => ({ ...s, [k]: v }));

  // Garde « quitter sans sauvegarder » — mode 'new' seulement (dans le shell).
  const [dirty, setDirty] = useState(false);
  const guard = useNavigationGuard(mode === 'new' && dirty && !saving);
  useEffect(() => {
    if (mode !== 'new' || !dirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [mode, dirty]);

  const stepIdx = STEPS.indexOf(step);
  const industryLabel = (key: string) => ((t as any).onboarding?.industries?.[key] as string) || key;
  const companyValid = state.company_name.trim().length > 0 && !!state.industry && !!state.employee_count
    && (mode !== 'onboarding' || state.full_name.trim().length > 0);
  const isOptional = step !== 'company' && step !== 'review';

  const goNext = () => {
    setError(null);
    if (step === 'company' && !companyValid) {
      setError(fr ? 'Nom, industrie et taille d\'équipe sont requis.' : 'Name, industry and team size are required.');
      return;
    }
    const next = STEPS[stepIdx + 1];
    if (next) setStep(next);
  };
  const goBack = () => { setError(null); const prev = STEPS[stepIdx - 1]; if (prev) setStep(prev); };

  const onAddressSelect = (a: StructuredAddress) => {
    setDirty(true);
    setState((s) => ({
      ...s,
      address_search: a.formatted_address,
      street1: [a.street_number, a.street_name].filter(Boolean).join(' '),
      city: a.city, province: a.province, postal_code: a.postal_code, country: a.country,
    }));
  };

  const addInvite = () => {
    const email = inviteDraft.email.trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError(fr ? 'Courriel invalide.' : 'Invalid email.');
      return;
    }
    if (state.invites.length >= 5) { setError(fr ? 'Maximum 5 invitations ici.' : 'Up to 5 invites here.'); return; }
    if (state.invites.some((i) => i.email === email)) { setInviteDraft({ email: '', role: inviteDraft.role }); return; }
    setError(null);
    update('invites', [...state.invites, { email, role: inviteDraft.role }]);
    setInviteDraft({ email: '', role: inviteDraft.role });
  };

  const handleSubmit = async () => {
    if (!companyValid) { setStep('company'); return; }
    setSaving(true);
    setError(null);
    try {
      const hasAddress = [state.street1, state.street2, state.city, state.province, state.postal_code, state.country].some((v) => v.trim());
      const goal = Math.round(parseFloat(state.revenue_goal.replace(/[^\d.]/g, '')) * 100);
      const result = await createWorkspace({
        mode,
        company: {
          name: state.company_name.trim(),
          industry: state.industry,
          employee_count: state.employee_count as EmployeeCount,
          logo_url: state.logo_url || null,
          language: state.language,
        },
        profile: mode === 'onboarding' ? { full_name: state.full_name.trim() } : null,
        contact: {
          phone: state.phone.trim() || null,
          email: state.email.trim() || null,
          website: state.website.trim() || null,
          address: hasAddress
            ? {
              street1: state.street1.trim(), street2: state.street2.trim(), city: state.city.trim(),
              province: state.province.trim(), postal_code: state.postal_code.trim(), country: state.country.trim(),
            }
            : null,
        },
        preferences: {
          currency: state.currency,
          timezone: state.timezone || null,
          revenue_goal_cents: Number.isFinite(goal) && goal > 0 ? goal : null,
        },
        reviews: {
          enabled: state.review_enabled,
          google_review_url: state.google_review_url.trim() || null,
          facebook_review_url: state.facebook_review_url.trim() || null,
        },
        invites: state.invites,
      });

      try { sessionStorage.removeItem(storageKey); } catch { /* ignore */ }
      guard.release();
      setDirty(false);

      if (mode === 'new') {
        // Bascule sur le nouveau workspace puis paiement de SON abonnement :
        // /checkout démarre directement à l'étape de paiement.
        try {
          localStorage.setItem('lume-active-org', result.org_id);
          sessionStorage.setItem('onb_step', 'checkout');
        } catch { /* ignore */ }
        window.location.assign('/checkout');
        return;
      }

      await refresh();
      toast.success(fr ? 'Votre workspace est prêt.' : 'Your workspace is ready.');
      onComplete?.();
    } catch (err: any) {
      setError(err?.message || (fr ? 'Échec de la création.' : 'Failed to create workspace.'));
      setSaving(false);
    }
  };

  const close = () => navigate('/settings/offices');

  // Mode 'new' : réservé au propriétaire (le serveur refuse aussi).
  if (mode === 'new' && currentRole && currentRole !== 'owner') {
    return (
      <div className="p-8 max-w-xl mx-auto text-[13px] text-amber-700 rounded-xl border border-amber-500/30 bg-amber-500/5 mt-8">
        {fr ? 'Seul le propriétaire de la compagnie peut créer un nouveau workspace.' : 'Only the company owner can create a new workspace.'}
      </div>
    );
  }

  const stepTitles: Record<StepId, string> = {
    company: fr ? 'Entreprise' : 'Business',
    contact: fr ? 'Coordonnées' : 'Contact details',
    preferences: fr ? 'Préférences' : 'Preferences',
    reviews: fr ? 'Avis clients' : 'Customer reviews',
    team: fr ? 'Équipe' : 'Team',
    review: fr ? 'Récapitulatif' : 'Summary',
  };
  const stepIcons: Record<StepId, React.ComponentType<{ size?: number; className?: string }>> = {
    company: Building2, contact: MapPin, preferences: Settings2, reviews: Star, team: Users, review: Check,
  };

  return (
    <div
      className={cn(
        'relative min-h-full bg-surface flex flex-col text-text-primary',
        mode === 'onboarding' && 'min-h-screen',
      )}
      onInput={(e) => { if (e.nativeEvent.isTrusted) setDirty(true); }}
      onChange={(e) => { if (e.nativeEvent.isTrusted) setDirty(true); }}
    >
      {/* ── En-tête ── */}
      <div className="relative px-6 pt-8 pb-2 text-center">
        {mode === 'onboarding' && (
          <div className="flex items-center justify-center gap-2 mb-3">
            <div className="w-8 h-8 rounded-lg bg-text-primary flex items-center justify-center">
              <span className="text-[14px] font-bold text-surface">L</span>
            </div>
            <span className="text-[18px] font-semibold tracking-tight">Lume</span>
          </div>
        )}
        <h2 className="text-[30px] font-extrabold tracking-tight leading-tight">
          {mode === 'onboarding'
            ? (fr ? 'Configurons votre workspace' : 'Let\'s set up your workspace')
            : (fr ? 'Nouveau workspace' : 'New workspace')}
        </h2>
        <p className="text-[13px] text-text-tertiary mt-1">
          {mode === 'onboarding'
            ? (fr ? 'Quelques infos pour personnaliser votre CRM. Seule la première page est obligatoire.' : 'A few details to personalize your CRM. Only the first page is required.')
            : (fr ? 'Une compagnie séparée, avec ses propres bureaux, données et abonnement.' : 'A separate company with its own offices, data and subscription.')}
        </p>
        {mode === 'new' && (
          <button type="button" onClick={close} aria-label={t.common.cancel}
            className="absolute right-6 top-6 p-2 rounded-xl border border-outline hover:bg-surface-secondary transition-colors">
            <X size={18} />
          </button>
        )}
      </div>

      {/* ── Progression ── */}
      <div className="px-6 pt-4">
        <ol className="max-w-2xl mx-auto flex items-center gap-1.5">
          {STEPS.map((s, i) => {
            const Icon = stepIcons[s];
            const done = i < stepIdx;
            const active = s === step;
            return (
              <li key={s} className="flex-1 min-w-0">
                <button
                  type="button"
                  onClick={() => { if (done || (i > 0 && companyValid)) { setError(null); setStep(s); } }}
                  className={cn(
                    'w-full flex flex-col items-center gap-1.5 group',
                    !(done || (i > 0 && companyValid)) && 'cursor-default',
                  )}
                  aria-current={active ? 'step' : undefined}
                >
                  <span className={cn('h-1.5 w-full rounded-full transition-colors', (done || active) ? 'bg-primary' : 'bg-outline')} />
                  <span className={cn('flex items-center gap-1 text-[11px] font-semibold truncate', active ? 'text-primary' : done ? 'text-text-secondary' : 'text-text-tertiary')}>
                    <Icon size={11} />
                    <span className="hidden sm:inline">{stepTitles[s]}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>

      {/* ── Page ── */}
      <div className="flex-1 px-6 py-6">
        <div className="max-w-2xl mx-auto rounded-xl border border-border bg-surface-card p-6">
          <div className="flex items-baseline justify-between mb-5">
            <h3 className="text-[16px] font-semibold">{stepTitles[step]}</h3>
            {isOptional && <span className="text-[11px] font-medium text-text-tertiary">{fr ? 'facultatif' : 'optional'}</span>}
          </div>

          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={step}
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }}
              transition={{ duration: 0.14 }}
              className="space-y-5"
            >
              {step === 'company' && (
                <>
                  {mode === 'onboarding' && (
                    <div className="space-y-2">
                      <label className={fieldLabel}>{fr ? 'Votre nom complet' : 'Your full name'} <span className="text-danger">*</span></label>
                      <input autoFocus value={state.full_name} onChange={(e) => update('full_name', e.target.value)} className="glass-input w-full" maxLength={120} />
                    </div>
                  )}
                  <div className="space-y-2">
                    <label className={fieldLabel}>{fr ? 'Nom de l\'entreprise' : 'Company name'} <span className="text-danger">*</span></label>
                    <input autoFocus={mode === 'new'} value={state.company_name} onChange={(e) => update('company_name', e.target.value)} className="glass-input w-full" maxLength={200} placeholder={fr ? 'Ex. Vision Lavage' : 'e.g. ABC Landscaping'} />
                  </div>
                  <div className="space-y-2">
                    <label className={fieldLabel}>{fr ? 'Industrie' : 'Industry'} <span className="text-danger">*</span></label>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {INDUSTRY_KEYS.map((key) => (
                        <button
                          key={key}
                          type="button"
                          onClick={() => { setDirty(true); update('industry', key); }}
                          className={cn(
                            'px-3 py-2 rounded-xl border text-[13px] text-left transition-colors',
                            state.industry === key ? 'border-primary bg-primary/10 text-primary font-semibold' : 'border-outline-subtle hover:bg-surface-secondary',
                          )}
                        >
                          {industryLabel(key)}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className={fieldLabel}>{fr ? 'Taille de l\'équipe' : 'Team size'} <span className="text-danger">*</span></label>
                    <div className="flex flex-wrap gap-2">
                      {EMPLOYEE_OPTIONS.map((opt) => (
                        <button
                          key={opt}
                          type="button"
                          onClick={() => { setDirty(true); update('employee_count', opt); }}
                          className={cn(
                            'px-3.5 py-2 rounded-full border text-[13px] transition-colors',
                            state.employee_count === opt ? 'border-primary bg-primary/10 text-primary font-semibold' : 'border-outline-subtle hover:bg-surface-secondary',
                          )}
                        >
                          {opt === '1' ? (fr ? 'Juste moi' : 'Just me') : opt}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className={fieldLabel}>{fr ? 'Langue' : 'Language'}</label>
                      <select value={state.language} onChange={(e) => update('language', e.target.value as 'fr' | 'en')} className="glass-input w-full">
                        <option value="fr">Français</option>
                        <option value="en">English</option>
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className={fieldLabel}>Logo</label>
                      {state.logo_url ? (
                        <div className="flex items-center gap-3">
                          <img src={state.logo_url} alt="" className="h-10 w-10 rounded-lg object-contain bg-surface-secondary border border-outline-subtle" />
                          <button type="button" onClick={() => { setDirty(true); update('logo_url', ''); }} className="glass-button inline-flex items-center gap-1.5 text-[11px] !text-danger !border-danger/30">
                            <Trash2 size={11} /> {fr ? 'Retirer' : 'Remove'}
                          </button>
                        </div>
                      ) : (
                        <FileUpload
                          bucket={STORAGE_BUCKETS.COMPANY_LOGOS}
                          path={mode === 'onboarding' && currentOrgId ? currentOrgId : `pending/${userId || 'anon'}`}
                          accept="image/*"
                          maxSizeMb={5}
                          normalizeImageMaxDim={1024}
                          onUpload={(url) => { setDirty(true); update('logo_url', url); }}
                        />
                      )}
                    </div>
                  </div>
                </>
              )}

              {step === 'contact' && (
                <>
                  <div className="space-y-2">
                    <label className={fieldLabel}>{fr ? 'Adresse' : 'Address'}</label>
                    <AddressAutocomplete value={state.address_search} onChange={(v) => update('address_search', v)} onSelect={onAddressSelect} className="glass-input w-full" placeholder={fr ? 'Rechercher une adresse…' : 'Search an address…'} />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Field label={fr ? 'Rue' : 'Street'} value={state.street1} onChange={(v) => update('street1', v)} />
                    <Field label={fr ? 'Bureau / suite' : 'Unit / suite'} value={state.street2} onChange={(v) => update('street2', v)} />
                    <Field label={fr ? 'Ville' : 'City'} value={state.city} onChange={(v) => update('city', v)} />
                    <Field label={fr ? 'Province / État' : 'Province / State'} value={state.province} onChange={(v) => update('province', v)} hint={fr ? 'Sert à installer les bonnes taxes (défaut : Québec).' : 'Used to install the right taxes (default: Quebec).'} />
                    <Field label={fr ? 'Code postal' : 'Postal code'} value={state.postal_code} onChange={(v) => update('postal_code', v)} />
                    <Field label={fr ? 'Pays' : 'Country'} value={state.country} onChange={(v) => update('country', v)} placeholder="CA" />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Field label={fr ? 'Téléphone' : 'Phone'} value={state.phone} onChange={(v) => update('phone', v)} type="tel" />
                    <Field label={fr ? 'Courriel de l\'entreprise' : 'Business email'} value={state.email} onChange={(v) => update('email', v)} type="email" />
                  </div>
                  <Field label={fr ? 'Site web' : 'Website'} value={state.website} onChange={(v) => update('website', v)} placeholder="https://" />
                </>
              )}

              {step === 'preferences' && (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className={fieldLabel}>{fr ? 'Devise' : 'Currency'}</label>
                      <select value={state.currency} onChange={(e) => update('currency', e.target.value as 'CAD' | 'USD')} className="glass-input w-full">
                        <option value="CAD">CAD</option>
                        <option value="USD">USD</option>
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className={fieldLabel}>{fr ? 'Fuseau horaire' : 'Timezone'}</label>
                      <select value={state.timezone} onChange={(e) => update('timezone', e.target.value)} className="glass-input w-full">
                        {timezoneOptions(state.timezone).map((z) => <option key={z} value={z}>{z}</option>)}
                      </select>
                    </div>
                  </div>
                  <Field
                    label={fr ? 'Objectif de revenu annuel' : 'Annual revenue goal'}
                    value={state.revenue_goal}
                    onChange={(v) => update('revenue_goal', v.replace(/[^\d.]/g, ''))}
                    placeholder="$250000"
                    inputMode="decimal"
                    hint={fr ? 'Affiché sur l\'accueil pour suivre votre progression.' : 'Shown on the home page to track progress.'}
                  />
                </>
              )}

              {step === 'reviews' && (
                <>
                  <p className="text-[13px] text-text-secondary">
                    {fr
                      ? 'À la fin d\'une job, Lume envoie un sondage d\'étoiles. Les notes 4-5 sont dirigées vers votre page Google ou Facebook ; les notes basses restent internes. Vous pourrez le régler plus tard dans Réglages → Avis clients.'
                      : 'When a job ends, Lume sends a star survey. 4-5 star ratings are routed to your Google or Facebook page; low ratings stay internal. You can adjust this later in Settings → Customer reviews.'}
                  </p>
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input type="checkbox" checked={state.review_enabled} onChange={(e) => update('review_enabled', e.target.checked)} className="h-4 w-4 mt-0.5 rounded" />
                    <span>
                      <span className="block text-[13px] font-medium">{fr ? 'Activer les demandes d\'avis' : 'Enable review requests'}</span>
                      <span className="text-[12px] text-text-tertiary">{fr ? 'Nécessite au moins un lien ci-dessous.' : 'Requires at least one link below.'}</span>
                    </span>
                  </label>
                  <Field label={fr ? 'Lien d\'avis Google' : 'Google review link'} value={state.google_review_url} onChange={(v) => update('google_review_url', v)} placeholder="https://g.page/r/…/review" hint={fr ? 'Fiche Google Business → « Obtenir plus d\'avis » → copier le lien.' : 'Google Business profile → “Get more reviews” → copy the link.'} />
                  <Field label={fr ? 'Lien d\'avis Facebook' : 'Facebook review link'} value={state.facebook_review_url} onChange={(v) => update('facebook_review_url', v)} placeholder="https://www.facebook.com/…/reviews" />
                </>
              )}

              {step === 'team' && (
                <>
                  <p className="text-[13px] text-text-secondary">
                    {fr ? 'Invitez jusqu\'à 5 personnes maintenant. Vous pourrez en ajouter d\'autres dans Réglages → Membres.' : 'Invite up to 5 people now. You can add more later in Settings → Members.'}
                  </p>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      value={inviteDraft.email}
                      onChange={(e) => setInviteDraft((d) => ({ ...d, email: e.target.value }))}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addInvite(); } }}
                      className="glass-input flex-1"
                      type="email"
                      placeholder={fr ? 'courriel@exemple.com' : 'email@example.com'}
                    />
                    <select value={inviteDraft.role} onChange={(e) => setInviteDraft((d) => ({ ...d, role: e.target.value as InviteRole }))} className="glass-input sm:w-44">
                      {INVITE_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r === 'admin' ? 'Admin' : r === 'technician' ? (fr ? 'Technicien' : 'Technician') : (fr ? 'Ventes' : 'Sales')}
                        </option>
                      ))}
                    </select>
                    <button type="button" onClick={addInvite} className="glass-button inline-flex items-center justify-center gap-1.5">
                      <Plus size={14} /> {fr ? 'Ajouter' : 'Add'}
                    </button>
                  </div>
                  {state.invites.length > 0 && (
                    <ul className="space-y-1.5">
                      {state.invites.map((inv) => (
                        <li key={inv.email} className="flex items-center justify-between gap-3 rounded-xl border border-outline-subtle px-3 py-2">
                          <span className="text-[13px] truncate">{inv.email}</span>
                          <span className="flex items-center gap-3 shrink-0">
                            <span className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
                              {inv.role === 'admin' ? 'Admin' : inv.role === 'technician' ? (fr ? 'Technicien' : 'Technician') : (fr ? 'Ventes' : 'Sales')}
                            </span>
                            <button type="button" onClick={() => update('invites', state.invites.filter((i) => i.email !== inv.email))} className="text-text-tertiary hover:text-danger" aria-label={fr ? 'Retirer' : 'Remove'}>
                              <Trash2 size={13} />
                            </button>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}

              {step === 'review' && (
                <div className="space-y-4">
                  <Summary title={stepTitles.company} onEdit={() => setStep('company')} rows={[
                    ...(mode === 'onboarding' ? [[fr ? 'Vous' : 'You', state.full_name]] : []),
                    [fr ? 'Entreprise' : 'Company', state.company_name],
                    [fr ? 'Industrie' : 'Industry', state.industry ? industryLabel(state.industry) : ''],
                    [fr ? 'Équipe' : 'Team', state.employee_count === '1' ? (fr ? 'Juste moi' : 'Just me') : state.employee_count],
                    ['Logo', state.logo_url ? (fr ? 'Ajouté' : 'Added') : ''],
                  ]} />
                  <Summary title={stepTitles.contact} onEdit={() => setStep('contact')} rows={[
                    [fr ? 'Adresse' : 'Address', [state.street1, state.city, state.province, state.postal_code].filter(Boolean).join(', ')],
                    [fr ? 'Téléphone' : 'Phone', state.phone],
                    [fr ? 'Courriel' : 'Email', state.email],
                    [fr ? 'Site web' : 'Website', state.website],
                  ]} />
                  <Summary title={stepTitles.preferences} onEdit={() => setStep('preferences')} rows={[
                    [fr ? 'Devise' : 'Currency', state.currency],
                    [fr ? 'Fuseau horaire' : 'Timezone', state.timezone],
                    [fr ? 'Objectif annuel' : 'Annual goal', state.revenue_goal ? `$${state.revenue_goal}` : ''],
                  ]} />
                  <Summary title={stepTitles.reviews} onEdit={() => setStep('reviews')} rows={[
                    [fr ? 'Demandes d\'avis' : 'Review requests', state.review_enabled && (state.google_review_url || state.facebook_review_url) ? (fr ? 'Activées' : 'Enabled') : (fr ? 'Désactivées' : 'Disabled')],
                    ['Google', state.google_review_url],
                    ['Facebook', state.facebook_review_url],
                  ]} />
                  <Summary title={stepTitles.team} onEdit={() => setStep('team')} rows={
                    state.invites.length > 0
                      ? state.invites.map((i) => [i.email, i.role === 'admin' ? 'Admin' : i.role === 'technician' ? (fr ? 'Technicien' : 'Technician') : (fr ? 'Ventes' : 'Sales')])
                      : [[fr ? 'Invitations' : 'Invites', '']]
                  } />
                  {mode === 'new' && (
                    <p className="text-[12px] text-text-tertiary">
                      {fr
                        ? 'À la création, vous passerez au paiement de l\'abonnement de ce workspace. Vos autres workspaces ne changent pas.'
                        : 'After creation you will pay for this workspace\'s subscription. Your other workspaces are unaffected.'}
                    </p>
                  )}
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      {/* ── Pied de page ── */}
      <div className="sticky bottom-0 z-10 px-6 py-4 border-t border-border bg-surface">
        <div className="max-w-2xl mx-auto flex items-center justify-between gap-4">
          <p className="text-[13px] text-danger min-h-[1rem] flex-1">{error || ''}</p>
          <div className="flex items-center gap-2 shrink-0">
            {stepIdx > 0 && (
              <button type="button" onClick={goBack} disabled={saving} className="glass-button inline-flex items-center gap-1.5">
                <ArrowLeft size={14} /> {fr ? 'Retour' : 'Back'}
              </button>
            )}
            {isOptional && (
              <button type="button" onClick={goNext} disabled={saving} className="glass-button-ghost">
                {fr ? 'Passer' : 'Skip'}
              </button>
            )}
            {step !== 'review' ? (
              <button type="button" onClick={goNext} disabled={saving} className="glass-button-primary inline-flex items-center gap-1.5">
                {fr ? 'Continuer' : 'Continue'} <ArrowRight size={14} />
              </button>
            ) : (
              <button type="button" onClick={handleSubmit} disabled={saving} className="glass-button-primary inline-flex items-center gap-2">
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                {saving
                  ? (fr ? 'Création…' : 'Creating…')
                  : mode === 'new'
                    ? (fr ? 'Créer et passer au paiement' : 'Create and go to payment')
                    : (fr ? 'Terminer la configuration' : 'Finish setup')}
              </button>
            )}
          </div>
        </div>
      </div>

      {mode === 'new' && (
        <LeaveFormConfirm open={guard.active} onConfirm={guard.confirmLeave} onCancel={guard.cancelLeave} />
      )}
    </div>
  );
}

// ── Sous-composants ─────────────────────────────────────────────────

function Field({
  label, value, onChange, placeholder, type = 'text', hint, inputMode,
}: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
  type?: string; hint?: string; inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
}) {
  return (
    <div className="space-y-2">
      <label className={fieldLabel}>{label}</label>
      <input value={value} onChange={(e) => onChange(e.target.value)} className="glass-input w-full" placeholder={placeholder} type={type} inputMode={inputMode} />
      {hint && <p className="text-[11px] text-text-tertiary">{hint}</p>}
    </div>
  );
}

function Summary({ title, rows, onEdit }: { title: string; rows: string[][]; onEdit: () => void }) {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const filled = rows.map(([k, v]) => [k ?? '', v ?? ''] as const).filter(([, v]) => v);
  return (
    <div className="rounded-xl border border-outline-subtle p-4">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-[13px] font-semibold">{title}</h4>
        <button type="button" onClick={onEdit} className="text-[12px] font-medium text-primary hover:underline">
          {fr ? 'Modifier' : 'Edit'}
        </button>
      </div>
      {filled.length === 0 ? (
        <p className="text-[12px] text-text-tertiary">{fr ? 'Rien pour l\'instant — vous pourrez compléter plus tard.' : 'Nothing yet — you can complete this later.'}</p>
      ) : (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[12px]">
          {filled.map(([k, v]) => (
            <React.Fragment key={k + v}>
              <dt className="text-text-tertiary">{k}</dt>
              <dd className="text-text-primary truncate">{v}</dd>
            </React.Fragment>
          ))}
        </dl>
      )}
    </div>
  );
}
