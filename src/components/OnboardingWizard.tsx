/* OnboardingWizard — v2 (3 steps): You / Your business / Your team.
   Posts the full payload to /api/onboarding/complete which handles
   profile, org, company_settings, industry presets, and invitations
   in one server-authoritative call. */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  User as UserIcon,
  Building2,
  Users,
  ArrowRight,
  ArrowLeft,
  Check,
  Upload,
  Plus,
  Trash2,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { getCurrentOrgIdOrThrow } from '../lib/orgApi';
import { toast } from 'sonner';
import { cn } from '../lib/utils';
import { useTranslation } from '../i18n';

interface OnboardingWizardProps {
  userId: string;
  orgId: string;
  language: string;
  onComplete: () => void;
}

type Invite = { email: string; role: 'admin' | 'technician' | 'sales_rep' };

type State = {
  full_name: string;
  language: 'fr' | 'en';
  photo_url: string;
  company_name: string;
  industry: string;
  employee_count: '' | '1' | '2-5' | '6-15' | '16-50' | '50+';
  address: string;
  logo_url: string;
  invites: Invite[];
};

const INDUSTRY_KEYS = [
  'landscaping',
  'snow_removal',
  'residential_cleaning',
  'commercial_cleaning',
  'plumbing',
  'electrical',
  'roofing',
  'hvac',
  'window_cleaning',
  'other',
] as const;

const EMPLOYEE_OPTIONS = ['1', '2-5', '6-15', '16-50', '50+'] as const;

const SESSION_KEY = 'lume-onboarding-v2';

async function uploadToAttachments(
  file: File,
  orgId: string,
  prefix: 'avatars' | 'logos',
): Promise<string | null> {
  if (!file || !orgId) return null;
  const ext = (file.name.split('.').pop() || 'png').toLowerCase().slice(0, 6);
  const path = `${prefix}/${orgId}/${Date.now()}.${ext}`;
  const { error: upErr } = await supabase.storage
    .from('attachments')
    .upload(path, file, { contentType: file.type || undefined, upsert: true });
  if (upErr) {
    console.error('[onboarding] upload failed:', upErr.message);
    return null;
  }
  const { data, error: signErr } = await supabase.storage
    .from('attachments')
    .createSignedUrl(path, 60 * 60 * 24 * 365);
  if (signErr || !data?.signedUrl) return null;
  return data.signedUrl;
}

export default function OnboardingWizard({
  userId,
  orgId: orgIdProp,
  language,
  onComplete,
}: OnboardingWizardProps) {
  const { t } = useTranslation();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [resolvedOrgId, setResolvedOrgId] = useState(orgIdProp);

  // Resolve org id (defensive — should be passed in by wrapper)
  useEffect(() => {
    if (resolvedOrgId) return;
    getCurrentOrgIdOrThrow().then(setResolvedOrgId).catch(() => {});
  }, [resolvedOrgId]);

  // Hydrate from sessionStorage so refresh mid-wizard doesn't lose data
  const [state, setState] = useState<State>(() => {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (raw) return { ...defaultState(language), ...JSON.parse(raw) };
    } catch (err) { console.warn('[onboarding] hydrate failed:', err); }
    return defaultState(language);
  });

  useEffect(() => {
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(state)); } catch (err) { console.warn(err); }
  }, [state]);

  // Prefill from profile + org
  useEffect(() => {
    (async () => {
      try {
        const { data: profile } = await supabase
          .from('profiles')
          .select('full_name')
          .eq('id', userId)
          .maybeSingle();
        if (profile?.full_name && !state.full_name) {
          setState((s) => ({ ...s, full_name: profile.full_name as string }));
        }
        if (resolvedOrgId) {
          const { data: org } = await supabase
            .from('orgs')
            .select('name')
            .eq('id', resolvedOrgId)
            .maybeSingle();
          if (org?.name && !state.company_name) {
            setState((s) => ({ ...s, company_name: org.name as string }));
          }
        }
      } catch (err) { console.warn('[onboarding] prefill failed:', err); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, resolvedOrgId]);

  const update = useCallback(<K extends keyof State>(k: K, v: State[K]) => {
    setState((s) => ({ ...s, [k]: v }));
  }, []);

  // ── File upload handlers ──
  const onPhotoFile = async (file: File | null) => {
    if (!file || !resolvedOrgId) return;
    setSaving(true);
    const url = await uploadToAttachments(file, resolvedOrgId, 'avatars');
    if (url) update('photo_url', url);
    else toast.error(state.language === 'fr' ? 'Échec du téléversement' : 'Upload failed');
    setSaving(false);
  };
  const onLogoFile = async (file: File | null) => {
    if (!file || !resolvedOrgId) return;
    setSaving(true);
    const url = await uploadToAttachments(file, resolvedOrgId, 'logos');
    if (url) update('logo_url', url);
    else toast.error(state.language === 'fr' ? 'Échec du téléversement' : 'Upload failed');
    setSaving(false);
  };

  // ── Step validation ──
  const canAdvance = useMemo(() => {
    if (!resolvedOrgId) return false;
    if (step === 0) return state.full_name.trim().length > 0;
    if (step === 1) {
      return (
        state.company_name.trim().length > 0 &&
        !!state.industry &&
        !!state.employee_count
      );
    }
    return true;
  }, [step, state, resolvedOrgId]);

  const handleSubmit = useCallback(async () => {
    if (!resolvedOrgId) return;
    setSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const payload = {
        full_name: state.full_name.trim(),
        language: state.language,
        photo_url: state.photo_url || null,
        company_name: state.company_name.trim(),
        industry: state.industry,
        employee_count: state.employee_count,
        address: state.address.trim() || null,
        logo_url: state.logo_url || null,
        invites: state.invites
          .filter((i) => i.email.trim().length > 0)
          .map((i) => ({ email: i.email.trim(), role: i.role })),
      };
      const res = await fetch('/api/onboarding/complete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token ? `Bearer ${token}` : '',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || (state.language === 'fr' ? 'Erreur du serveur' : 'Server error'));
      }
      try { sessionStorage.removeItem(SESSION_KEY); } catch (err) { console.warn(err); }
      onComplete();
    } catch (err: any) {
      toast.error(err?.message || (t.onboarding as any).saveFailed);
    } finally {
      setSaving(false);
    }
  }, [resolvedOrgId, state, onComplete, t]);

  // ── Swipe (mobile) ──
  const swipeProps = useSwipe(() => {
    if (canAdvance && step < 2) setStep(step + 1);
  }, () => {
    if (step > 0) setStep(step - 1);
  });

  const fr = language === 'fr';
  const tt = t.onboarding as any;

  return (
    <div className="fixed inset-0 z-[200] bg-surface flex items-center justify-center p-4" {...swipeProps}>
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-lg"
      >
        {/* Logo */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <span className="text-[14px] font-bold text-white">L</span>
            </div>
            <span className="text-[18px] font-semibold tracking-tight text-text-primary">Lume</span>
          </div>
          <p className="text-[13px] text-text-tertiary">{tt.letsSetUpWorkspace}</p>
        </div>

        {/* Progress dots */}
        <div className="flex items-center justify-center gap-2 mb-6">
          {[0, 1, 2].map((i) => (
            <React.Fragment key={i}>
              <div className={cn(
                'w-7 h-7 rounded-full flex items-center justify-center transition-all text-[11px] font-semibold',
                i < step ? 'bg-primary text-white' :
                i === step ? 'bg-primary/10 text-primary border-2 border-primary' :
                'bg-surface-secondary text-text-tertiary',
              )}>
                {i < step ? <Check size={12} /> : i + 1}
              </div>
              {i < 2 && <div className={cn('w-10 h-0.5 rounded-full', i < step ? 'bg-primary' : 'bg-outline')} />}
            </React.Fragment>
          ))}
        </div>

        <div className="section-card overflow-hidden">
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -24 }}
              transition={{ duration: 0.16 }}
              className="p-6"
            >
              {step === 0 && (
                <StepYou
                  state={state}
                  update={update}
                  tt={tt}
                  fr={fr}
                  onPhotoFile={onPhotoFile}
                />
              )}
              {step === 1 && (
                <StepBusiness state={state} update={update} tt={tt} onLogoFile={onLogoFile} />
              )}
              {step === 2 && <StepTeam state={state} update={update} tt={tt} />}
            </motion.div>
          </AnimatePresence>

          <div className="flex items-center justify-between px-6 py-4 border-t border-outline bg-surface-secondary/50">
            <div>
              {step > 0 && (
                <button
                  onClick={() => setStep(step - 1)}
                  className="text-[13px] text-text-tertiary hover:text-text-secondary inline-flex items-center gap-1"
                  disabled={saving}
                >
                  <ArrowLeft size={14} />
                  {t.companySettings.back}
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              {step === 2 && (
                <button
                  onClick={() => {
                    update('invites', []);
                    handleSubmit();
                  }}
                  className="text-[13px] text-text-tertiary hover:text-text-secondary transition-colors"
                  disabled={saving || !resolvedOrgId}
                >
                  {tt.inviteLater}
                </button>
              )}
              <button
                onClick={step === 2 ? handleSubmit : () => canAdvance && setStep(step + 1)}
                disabled={saving || !resolvedOrgId || (step < 2 && !canAdvance)}
                className="glass-button-primary inline-flex items-center gap-1.5"
              >
                {saving
                  ? tt.saving
                  : step === 2
                    ? tt.done
                    : tt.continue}
                {!saving && <ArrowRight size={14} />}
              </button>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

// ─── Step 1: You ──────────────────────────────────────────────────
function StepYou({
  state, update, tt, fr, onPhotoFile,
}: {
  state: State;
  update: <K extends keyof State>(k: K, v: State[K]) => void;
  tt: any;
  fr: boolean;
  onPhotoFile: (f: File | null) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="text-center mb-2">
        <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3">
          <UserIcon size={22} className="text-primary" />
        </div>
        <h2 className="text-[18px] font-bold text-text-primary">{tt.stepYou}</h2>
        <p className="text-[13px] text-text-tertiary mt-1">{tt.letsSetUpWorkspace}</p>
      </div>

      <div>
        <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">
          {tt.fullName} *
        </label>
        <input
          value={state.full_name}
          onChange={(e) => update('full_name', e.target.value)}
          className="glass-input w-full mt-1"
          placeholder={fr ? 'Jean Tremblay' : 'John Doe'}
          autoFocus
        />
      </div>

      <div>
        <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">
          {tt.language}
        </label>
        <div className="mt-1 flex gap-2">
          {(['fr', 'en'] as const).map((lng) => (
            <button
              key={lng}
              type="button"
              onClick={() => update('language', lng)}
              className={cn(
                'flex-1 px-3 py-2 rounded-lg text-[13px] font-medium border transition-all',
                state.language === lng
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-outline text-text-secondary hover:border-text-tertiary',
              )}
            >
              {lng === 'fr' ? 'Français' : 'English'}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">
          {tt.profilePhoto}
        </label>
        <div className="mt-1 flex items-center gap-3">
          {state.photo_url ? (
            <img src={state.photo_url} alt="" className="w-14 h-14 rounded-full object-cover border border-outline" />
          ) : (
            <div className="w-14 h-14 rounded-full bg-surface-secondary border border-outline flex items-center justify-center">
              <UserIcon size={20} className="text-text-tertiary" />
            </div>
          )}
          <label className="glass-button inline-flex items-center gap-1.5 cursor-pointer">
            <Upload size={14} />
            {tt.uploadPhoto}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => onPhotoFile(e.target.files?.[0] || null)}
            />
          </label>
          {state.photo_url && (
            <button
              type="button"
              onClick={() => update('photo_url', '')}
              className="text-[12px] text-text-tertiary hover:text-text-primary"
            >
              {tt.skip}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Step 2: Business ─────────────────────────────────────────────
function StepBusiness({
  state, update, tt, onLogoFile,
}: {
  state: State;
  update: <K extends keyof State>(k: K, v: State[K]) => void;
  tt: any;
  onLogoFile: (f: File | null) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="text-center mb-2">
        <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3">
          <Building2 size={22} className="text-primary" />
        </div>
        <h2 className="text-[18px] font-bold text-text-primary">{tt.stepBusiness}</h2>
        <p className="text-[13px] text-text-tertiary mt-1">{tt.thisInfoWillAppearOnYourInvoicesAndQuote}</p>
      </div>

      <div>
        <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">
          {tt.companyName} *
        </label>
        <input
          value={state.company_name}
          onChange={(e) => update('company_name', e.target.value)}
          className="glass-input w-full mt-1"
          placeholder={tt.exAbcLandscaping}
          autoFocus
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">
            {tt.industry} *
          </label>
          <select
            value={state.industry}
            onChange={(e) => update('industry', e.target.value)}
            className="glass-input w-full mt-1"
          >
            <option value="">—</option>
            {INDUSTRY_KEYS.map((k) => (
              <option key={k} value={k}>
                {(tt.industries && tt.industries[k]) || k}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">
            {tt.employees} *
          </label>
          <select
            value={state.employee_count}
            onChange={(e) => update('employee_count', e.target.value as State['employee_count'])}
            className="glass-input w-full mt-1"
          >
            <option value="">—</option>
            {EMPLOYEE_OPTIONS.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">
          {tt.address}
        </label>
        <input
          value={state.address}
          onChange={(e) => update('address', e.target.value)}
          className="glass-input w-full mt-1"
          placeholder="123 Main St, Montréal QC"
        />
      </div>

      <div>
        <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">
          {tt.logo}
        </label>
        <div className="mt-1 flex items-center gap-3">
          {state.logo_url ? (
            <img src={state.logo_url} alt="" className="w-14 h-14 rounded-lg object-contain border border-outline bg-white p-1" />
          ) : (
            <div className="w-14 h-14 rounded-lg bg-surface-secondary border border-outline flex items-center justify-center">
              <Building2 size={18} className="text-text-tertiary" />
            </div>
          )}
          <label className="glass-button inline-flex items-center gap-1.5 cursor-pointer">
            <Upload size={14} />
            {tt.uploadLogo}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => onLogoFile(e.target.files?.[0] || null)}
            />
          </label>
          {state.logo_url && (
            <button
              type="button"
              onClick={() => update('logo_url', '')}
              className="text-[12px] text-text-tertiary hover:text-text-primary"
            >
              {tt.skip}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Step 3: Team ─────────────────────────────────────────────────
function StepTeam({
  state, update, tt,
}: {
  state: State;
  update: <K extends keyof State>(k: K, v: State[K]) => void;
  tt: any;
}) {
  // Ensure at least 3 rows visible to start
  const rows = state.invites.length >= 3 ? state.invites : [
    ...state.invites,
    ...Array(3 - state.invites.length).fill({ email: '', role: 'technician' as const }),
  ];

  const setRow = (idx: number, patch: Partial<Invite>) => {
    const next = rows.map((r, i) => (i === idx ? { ...r, ...patch } : r));
    update('invites', next);
  };
  const addRow = () => {
    if (rows.length >= 5) return;
    update('invites', [...rows, { email: '', role: 'technician' }]);
  };
  const removeRow = (idx: number) => {
    update('invites', rows.filter((_, i) => i !== idx));
  };

  return (
    <div className="space-y-4">
      <div className="text-center mb-2">
        <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3">
          <Users size={22} className="text-primary" />
        </div>
        <h2 className="text-[18px] font-bold text-text-primary">{tt.inviteTeam}</h2>
        <p className="text-[13px] text-text-tertiary mt-1">{tt.inviteTeamDesc}</p>
      </div>

      <div className="space-y-2">
        {rows.map((row, idx) => (
          <div key={idx} className="flex items-center gap-2">
            <input
              type="email"
              value={row.email}
              onChange={(e) => setRow(idx, { email: e.target.value })}
              className="glass-input flex-1"
              placeholder="email@example.com"
            />
            <select
              value={row.role}
              onChange={(e) => setRow(idx, { role: e.target.value as Invite['role'] })}
              className="glass-input w-28"
            >
              <option value="admin">{tt.invite_admin}</option>
              <option value="technician">{tt.invite_technician}</option>
              <option value="sales_rep">{tt.invite_sales_rep}</option>
            </select>
            {rows.length > 1 && (
              <button
                type="button"
                onClick={() => removeRow(idx)}
                className="p-2 text-text-tertiary hover:text-danger transition-colors"
                aria-label="remove"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        ))}
      </div>

      {rows.length < 5 && (
        <button
          type="button"
          onClick={addRow}
          className="text-[13px] text-primary hover:underline inline-flex items-center gap-1"
        >
          <Plus size={14} />
          {tt.addAnother}
        </button>
      )}
    </div>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────
function defaultState(lang: string): State {
  return {
    full_name: '',
    language: lang === 'en' ? 'en' : 'fr',
    photo_url: '',
    company_name: '',
    industry: '',
    employee_count: '',
    address: '',
    logo_url: '',
    invites: [
      { email: '', role: 'technician' },
      { email: '', role: 'technician' },
      { email: '', role: 'technician' },
    ],
  };
}

function useSwipe(onLeft: () => void, onRight: () => void) {
  const startX = React.useRef<number | null>(null);
  return {
    onTouchStart: (e: React.TouchEvent) => {
      startX.current = e.touches[0]?.clientX ?? null;
    },
    onTouchEnd: (e: React.TouchEvent) => {
      if (startX.current == null) return;
      const dx = (e.changedTouches[0]?.clientX ?? 0) - startX.current;
      startX.current = null;
      if (Math.abs(dx) < 50) return;
      if (dx < 0) onLeft();
      else onRight();
    },
  };
}
