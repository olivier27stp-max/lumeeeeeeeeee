import { useState, useEffect, useCallback, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { X, Check, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from '../../i18n';
import { submitDemoRequest, DEMO_INDUSTRY_VALUES, type DemoIndustry } from '../../lib/demoRequestsApi';
import CalendlyInline from './CalendlyInline';

// Lien de prise de rendez-vous. Affiché après l'envoi du formulaire pour que
// le prospect réserve lui-même son créneau de démo.
const CALENDLY_URL = 'https://calendly.com/willhebert30/30min';

interface BookDemoFormProps {
  open: boolean;
  onClose: () => void;
  /** Optional source tag (e.g. "pricing", "header") */
  source?: string;
}

interface FormState {
  full_name: string;
  company_name: string;
  email: string;
  phone: string;
  industry: DemoIndustry | '';
  employee_count: string;
  heard_from: string;
  availability: string;
  message: string;
}

const EMPTY: FormState = {
  full_name: '',
  company_name: '',
  email: '',
  phone: '',
  industry: '',
  employee_count: '',
  heard_from: '',
  availability: '',
  message: '',
};

const EMPLOYEE_OPTIONS = ['1', '2-5', '6-15', '16-50', '50+'];

const phoneRegex = /^[+]?[0-9][0-9\s\-().]{6,19}$/;
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function BookDemoForm({ open, onClose, source }: BookDemoFormProps) {
  const { t } = useTranslation();
  const bd = (t as any).bookDemo;
  const [form, setForm] = useState<FormState>(EMPTY);
  const [status, setStatus] = useState<'idle' | 'loading' | 'success'>('idle');
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [referral, setReferral] = useState('');

  // Capture the affiliate code from ?ref= (persisted, so it survives navigation
  // from the landing link to the contact page).
  useEffect(() => {
    try {
      const fromUrl = new URLSearchParams(window.location.search).get('ref');
      if (fromUrl) sessionStorage.setItem('lume_ref', fromUrl);
      const ref = (fromUrl || sessionStorage.getItem('lume_ref') || '').trim();
      if (ref) setReferral(ref);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  const setField = useCallback(<K extends keyof FormState>(k: K, v: FormState[K]) => {
    setForm(f => ({ ...f, [k]: v }));
    setErrors(prev => ({ ...prev, [k]: undefined }));
  }, []);

  const validate = (): boolean => {
    const e: Partial<Record<keyof FormState, string>> = {};
    if (!form.full_name.trim()) e.full_name = bd?.errors?.fullNameRequired || 'Full name is required.';
    if (!form.company_name.trim()) e.company_name = bd?.errors?.companyRequired || 'Company is required.';
    if (!emailRegex.test(form.email.trim())) e.email = bd?.errors?.emailInvalid || 'Valid email required.';
    if (!phoneRegex.test(form.phone.trim().replace(/\s+/g, ''))) e.phone = bd?.errors?.phoneInvalid || 'Valid phone required.';
    if (!form.industry) e.industry = bd?.errors?.industryRequired || 'Industry is required.';
    if (form.message.length > 2000) e.message = bd?.errors?.messageTooLong || 'Message too long (max 2000).';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  async function onSubmit(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    if (status === 'loading') return;
    if (!validate()) return;
    setStatus('loading');
    try {
      await submitDemoRequest({
        full_name: form.full_name.trim(),
        company_name: form.company_name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        industry: form.industry as DemoIndustry,
        employee_count: form.employee_count || null,
        source: source || form.heard_from || null,
        availability: form.availability || null,
        message: form.message.trim() || null,
        referral_code: referral || null,
      });
      setStatus('success');
    } catch (err: any) {
      setStatus('idle');
      toast.error(err?.message || bd?.errors?.submitFailed || 'Submission failed. Please try again.');
    }
  }

  function handleClose() {
    onClose();
    // Reset after close animation
    setTimeout(() => { setForm(EMPTY); setErrors({}); setStatus('idle'); }, 200);
  }

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={handleClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.97 }}
            transition={{ duration: 0.2 }}
            onClick={(e) => e.stopPropagation()}
            className={`bg-white rounded-2xl shadow-2xl w-full max-h-[92vh] overflow-y-auto relative transition-[max-width] ${status === 'success' ? 'max-w-3xl' : 'max-w-2xl'}`}
          >
            <button
              onClick={handleClose}
              aria-label="Close"
              className="absolute top-4 right-4 p-2 rounded-full hover:bg-gray-100 text-gray-500 transition-colors z-10"
            >
              <X size={20} />
            </button>

            {status === 'success' ? (
              <SuccessPanel
                onClose={handleClose}
                name={form.full_name.trim()}
                email={form.email.trim()}
              />
            ) : (
              <div className="p-6 sm:p-8">
                <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-[#111]">
                  {bd?.title || 'Book a demo'}
                </h2>
                <p className="mt-2 text-sm text-text-secondary">
                  {bd?.subtitle || "We'll walk you through everything — no commitment required."}
                </p>

                <form onSubmit={onSubmit} className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field
                    label={bd?.fields?.fullName || 'Full name *'}
                    error={errors.full_name}
                    className="sm:col-span-2"
                  >
                    <input
                      type="text" required value={form.full_name}
                      onChange={(e) => setField('full_name', e.target.value)}
                      className={inputCls(!!errors.full_name)}
                      autoComplete="name"
                    />
                  </Field>

                  <Field label={bd?.fields?.company || 'Company *'} error={errors.company_name}>
                    <input
                      type="text" required value={form.company_name}
                      onChange={(e) => setField('company_name', e.target.value)}
                      className={inputCls(!!errors.company_name)}
                      autoComplete="organization"
                    />
                  </Field>

                  <Field label={bd?.fields?.email || 'Email *'} error={errors.email}>
                    <input
                      type="email" required value={form.email}
                      onChange={(e) => setField('email', e.target.value)}
                      className={inputCls(!!errors.email)}
                      autoComplete="email"
                    />
                  </Field>

                  <Field label={bd?.fields?.phone || 'Phone *'} error={errors.phone}>
                    <input
                      type="tel" required value={form.phone}
                      onChange={(e) => setField('phone', e.target.value)}
                      className={inputCls(!!errors.phone)}
                      autoComplete="tel"
                    />
                  </Field>

                  <Field label={bd?.fields?.industry || 'Industry *'} error={errors.industry}>
                    <select
                      required value={form.industry}
                      onChange={(e) => setField('industry', e.target.value as DemoIndustry | '')}
                      className={inputCls(!!errors.industry)}
                    >
                      <option value="">{bd?.placeholders?.choose || 'Choose...'}</option>
                      {DEMO_INDUSTRY_VALUES.map((v) => (
                        <option key={v} value={v}>
                          {bd?.industries?.[v] || labelize(v)}
                        </option>
                      ))}
                    </select>
                  </Field>

                  <Field label={bd?.fields?.employeeCount || 'Team size'}>
                    <select
                      value={form.employee_count}
                      onChange={(e) => setField('employee_count', e.target.value)}
                      className={inputCls(false)}
                    >
                      <option value="">{bd?.placeholders?.choose || 'Choose...'}</option>
                      {EMPLOYEE_OPTIONS.map((v) => (
                        <option key={v} value={v}>{v}</option>
                      ))}
                    </select>
                  </Field>

                  <Field label={bd?.fields?.heardFrom || 'How did you hear about Lume?'}>
                    <select
                      value={form.heard_from}
                      onChange={(e) => setField('heard_from', e.target.value)}
                      className={inputCls(false)}
                    >
                      <option value="">{bd?.placeholders?.choose || 'Choose...'}</option>
                      {['Google', 'Facebook', 'Referral', 'Other'].map((v) => (
                        <option key={v} value={v.toLowerCase()}>
                          {bd?.sources?.[v.toLowerCase()] || v}
                        </option>
                      ))}
                    </select>
                  </Field>

                  <Field label={bd?.fields?.availability || 'Best time to reach you'}>
                    <select
                      value={form.availability}
                      onChange={(e) => setField('availability', e.target.value)}
                      className={inputCls(false)}
                    >
                      <option value="">{bd?.placeholders?.choose || 'Choose...'}</option>
                      {['morning', 'afternoon', 'evening', 'flexible'].map((v) => (
                        <option key={v} value={v}>
                          {bd?.availability?.[v] || labelize(v)}
                        </option>
                      ))}
                    </select>
                  </Field>

                  <Field
                    label={bd?.fields?.message || 'Message (optional)'}
                    error={errors.message}
                    className="sm:col-span-2"
                  >
                    <textarea
                      rows={3} maxLength={2000} value={form.message}
                      onChange={(e) => setField('message', e.target.value)}
                      className={inputCls(!!errors.message) + ' resize-none'}
                    />
                  </Field>

                  {referral ? (
                    <Field label="Parrainage (referral)" className="sm:col-span-2">
                      <input
                        type="text"
                        value={referral}
                        readOnly
                        className={inputCls(false) + ' bg-[#f5f5f5] font-semibold'}
                      />
                    </Field>
                  ) : null}

                  <div className="sm:col-span-2 mt-2">
                    <button
                      type="submit"
                      disabled={status === 'loading'}
                      className="w-full inline-flex items-center justify-center gap-2 bg-[#3FAF97] text-white px-7 py-3.5 rounded-xl text-sm font-bold hover:bg-[#1F5F4F] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {status === 'loading'
                        ? (bd?.submitting || 'Sending...')
                        : (bd?.submit || 'Book demo')}
                      {status !== 'loading' && <ArrowRight size={16} />}
                    </button>
                    <p className="mt-3 text-xs text-text-tertiary text-center">
                      {bd?.disclaimer || 'No commitment. We respond within 24 hours.'}
                    </p>
                  </div>
                </form>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}

function SuccessPanel({ onClose, name, email }: { onClose: () => void; name: string; email: string }) {
  const { t } = useTranslation();
  const bd = (t as any).bookDemo;
  return (
    <div className="px-6 sm:px-8 pt-8 pb-6">
      {/* En-tête court : la demande est reçue, il ne reste qu'à choisir l'heure. */}
      <div className="text-center">
        <div className="w-14 h-14 rounded-full bg-[#3FAF97]/15 flex items-center justify-center mx-auto mb-4">
          <Check size={28} className="text-[#3FAF97]" />
        </div>
        <h3 className="text-2xl font-bold text-[#111]">
          {bd?.success?.title || 'Request received — now pick a time'}
        </h3>
        <p className="mt-2 text-sm text-text-secondary max-w-md mx-auto">
          {bd?.success?.pickSlot || 'Choose the slot that works for you. The demo lasts 30 minutes, no commitment.'}
        </p>
      </div>

      {/* Calendrier Calendly, pré-rempli avec le nom et le courriel déjà saisis. */}
      <div className="mt-5 -mx-2 sm:mx-0 rounded-xl overflow-hidden border border-[#e5e5e5]">
        <CalendlyInline
          url={CALENDLY_URL}
          prefill={{ name, email }}
          fallbackHref={CALENDLY_URL}
        />
      </div>

      <div className="mt-4 text-center">
        <button
          onClick={onClose}
          className="text-sm font-semibold text-text-secondary hover:text-[#111] transition-colors"
        >
          {bd?.success?.close || 'Close'}
        </button>
      </div>
    </div>
  );
}

function Field({ label, error, children, className }: { label: string; error?: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`flex flex-col gap-1.5 ${className || ''}`}>
      <span className="text-xs font-semibold text-[#111] uppercase tracking-wide">{label}</span>
      {children}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </label>
  );
}

function inputCls(invalid: boolean) {
  return `px-3.5 py-2.5 border ${invalid ? 'border-red-500' : 'border-[#d4d4d4]'} bg-white text-sm text-[#111] placeholder:text-[#999] focus:outline-none focus:border-[#3FAF97] rounded-lg transition-colors`;
}

function labelize(slug: string) {
  return slug.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
