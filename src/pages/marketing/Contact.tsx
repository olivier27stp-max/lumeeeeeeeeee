import { useState, type FormEvent } from 'react';
import { motion } from 'motion/react';
import { ArrowRight, Mail, MapPin, Check } from 'lucide-react';
import { submitDemoRequest, DEMO_INDUSTRY_VALUES, type DemoIndustry } from '../../lib/demoRequestsApi';

type FormState = 'idle' | 'submitting' | 'sent' | 'error';

interface Form {
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

const EMPTY: Form = {
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

const INDUSTRY_LABELS: Record<DemoIndustry, string> = {
  landscaping: 'Landscaping',
  snow_removal: 'Snow removal',
  residential_cleaning: 'Residential cleaning',
  commercial_cleaning: 'Commercial cleaning',
  plumbing: 'Plumbing',
  electrical: 'Electrical',
  roofing: 'Roofing',
  hvac: 'HVAC',
  window_cleaning: 'Window cleaning',
  other: 'Other',
};

const SOURCE_OPTIONS = ['Google', 'Facebook', 'Instagram', 'Referral', 'Other'];
const AVAILABILITY_OPTIONS = ['Morning', 'Afternoon', 'Evening', 'Flexible'];

const phoneRegex = /^[+]?[0-9][0-9\s\-().]{6,19}$/;
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const inputCls =
  'px-4 py-3 border border-white/10 bg-white/5 text-sm text-white placeholder:text-white/40 focus:outline-none focus:border-[#3FAF97] transition-colors rounded-lg';
const selectCls = inputCls + ' appearance-none cursor-pointer';

export default function Contact() {
  const [form, setForm] = useState<Form>(EMPTY);
  const [state, setState] = useState<FormState>('idle');
  const [errMsg, setErrMsg] = useState('');
  const [errors, setErrors] = useState<Partial<Record<keyof Form, string>>>({});
  const submitted = state === 'sent';

  function onChange<K extends keyof Form>(key: K) {
    return (e: { target: { value: string } }) => {
      setForm((f) => ({ ...f, [key]: e.target.value }));
      if (errors[key]) setErrors((prev) => ({ ...prev, [key]: undefined }));
    };
  }

  function validate(): boolean {
    const next: Partial<Record<keyof Form, string>> = {};
    if (!form.full_name.trim()) next.full_name = 'Required';
    if (!form.company_name.trim()) next.company_name = 'Required';
    if (!emailRegex.test(form.email.trim())) next.email = 'Invalid email';
    if (!phoneRegex.test(form.phone.trim())) next.phone = 'Invalid phone';
    if (!form.industry) next.industry = 'Required';
    if (form.message.length > 2000) next.message = 'Max 2000 characters';
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (state === 'submitting') return;
    if (!validate()) return;
    setState('submitting');
    setErrMsg('');
    try {
      await submitDemoRequest({
        full_name: form.full_name.trim(),
        company_name: form.company_name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        industry: form.industry as DemoIndustry,
        employee_count: form.employee_count || undefined,
        source: form.heard_from || 'contact',
        availability: form.availability || undefined,
        message: form.message.trim() || undefined,
      });
      setState('sent');
    } catch (err: any) {
      setState('error');
      setErrMsg(err?.message || 'Something went wrong — please try again.');
    }
  }

  return (
    <div style={{ backgroundColor: '#fafaf8', backgroundImage: 'url("/paper-texture.png")', backgroundRepeat: 'repeat', backgroundSize: '300px 300px' }}>
      {/* Hero */}
      <section className="pt-28 pb-12 md:pt-36 md:pb-16 px-6">
        <div className="max-w-4xl mx-auto text-center">
          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-[11px] uppercase tracking-[0.2em] font-semibold text-[#1F5F4F] mb-4"
          >
            Contact
          </motion.p>
          <motion.h1
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="text-4xl md:text-5xl font-extrabold text-[#111] tracking-tight leading-tight"
          >
            Book a demo
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="mt-5 text-lg font-normal text-text-secondary max-w-2xl mx-auto leading-relaxed"
          >
            We'll walk you through everything — no commitment required.
          </motion.p>
        </div>
      </section>

      {/* Info left + Form right */}
      <section className="px-6 pb-24 md:pb-32">
        <div className="max-w-5xl mx-auto flex flex-col md:flex-row gap-10 md:gap-16 items-start">
          {/* Info left */}
          <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} className="flex-1 md:pt-4">
            <h2 className="text-2xl md:text-3xl font-extrabold text-[#111] leading-snug mb-8">Get in touch</h2>

            <div className="space-y-6">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-full bg-[#111] flex items-center justify-center shrink-0">
                  <Mail size={16} className="text-white" />
                </div>
                <div>
                  <p className="text-sm font-bold text-[#111]">Email</p>
                  <a href="mailto:admin@lumecrm.net" className="text-sm text-text-secondary hover:text-[#111] transition-colors">
                    admin@lumecrm.net
                  </a>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-full bg-[#111] flex items-center justify-center shrink-0">
                  <MapPin size={16} className="text-white" />
                </div>
                <div>
                  <p className="text-sm font-bold text-[#111]">Location</p>
                  <p className="text-sm text-text-secondary">Quebec, Canada</p>
                </div>
              </div>
            </div>

            <div className="mt-10 pt-8 border-t border-[#e0e0e0]">
              <p className="text-sm font-bold text-[#111] mb-3">What to expect</p>
              <ul className="space-y-2.5">
                {[
                  'A 20-30 min walkthrough of Lume',
                  'Tailored to your industry',
                  'No commitment, no pressure',
                  'Response within 24 hours',
                ].map((item) => (
                  <li key={item} className="flex items-center gap-2.5 text-sm text-text-secondary">
                    <div className="w-5 h-5 rounded-full flex items-center justify-center shrink-0" style={{ border: '2px solid #3FAF97' }}>
                      <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
                        <path d="M3 8.5l3.5 3.5L13 5" stroke="#3FAF97" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </motion.div>

          {/* Form right — dark box, all 9 fields */}
          <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.1 }} className="flex-1 w-full">
            {submitted ? (
              <div className="bg-[#111] rounded-2xl p-10 text-center">
                <div className="w-14 h-14 rounded-full bg-[#3FAF97]/20 flex items-center justify-center mx-auto mb-5">
                  <Check size={28} className="text-[#3FAF97]" />
                </div>
                <h3 className="text-xl font-bold text-white">Request sent!</h3>
                <p className="mt-2 text-sm text-white/50">Our team will reach out within 24 hours to schedule your demo.</p>
                <p className="mt-4 text-xs text-white/40">A confirmation has been sent to your email with a reference number.</p>
              </div>
            ) : (
              <div className="bg-[#111] rounded-2xl p-8">
                <form onSubmit={onSubmit} className="flex flex-col gap-3.5" noValidate>
                  <div>
                    <input
                      type="text"
                      required
                      name="full_name"
                      value={form.full_name}
                      onChange={onChange('full_name')}
                      placeholder="Full name *"
                      className={inputCls + ' w-full'}
                      autoComplete="name"
                    />
                    {errors.full_name && <p className="mt-1 text-xs text-red-400">{errors.full_name}</p>}
                  </div>

                  <div>
                    <input
                      type="text"
                      required
                      name="company_name"
                      value={form.company_name}
                      onChange={onChange('company_name')}
                      placeholder="Company *"
                      className={inputCls + ' w-full'}
                      autoComplete="organization"
                    />
                    {errors.company_name && <p className="mt-1 text-xs text-red-400">{errors.company_name}</p>}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    <div>
                      <input
                        type="email"
                        required
                        name="email"
                        value={form.email}
                        onChange={onChange('email')}
                        placeholder="Email *"
                        className={inputCls + ' w-full'}
                        autoComplete="email"
                      />
                      {errors.email && <p className="mt-1 text-xs text-red-400">{errors.email}</p>}
                    </div>
                    <div>
                      <input
                        type="tel"
                        required
                        name="phone"
                        value={form.phone}
                        onChange={onChange('phone')}
                        placeholder="Phone *"
                        className={inputCls + ' w-full'}
                        autoComplete="tel"
                      />
                      {errors.phone && <p className="mt-1 text-xs text-red-400">{errors.phone}</p>}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    <div>
                      <select
                        required
                        name="industry"
                        value={form.industry}
                        onChange={onChange('industry')}
                        className={selectCls + ' w-full'}
                      >
                        <option value="" disabled>Industry *</option>
                        {DEMO_INDUSTRY_VALUES.map((v) => (
                          <option key={v} value={v} style={{ color: '#111' }}>
                            {INDUSTRY_LABELS[v]}
                          </option>
                        ))}
                      </select>
                      {errors.industry && <p className="mt-1 text-xs text-red-400">{errors.industry}</p>}
                    </div>
                    <div>
                      <select
                        name="employee_count"
                        value={form.employee_count}
                        onChange={onChange('employee_count')}
                        className={selectCls + ' w-full'}
                      >
                        <option value="">Team size</option>
                        {EMPLOYEE_OPTIONS.map((v) => (
                          <option key={v} value={v} style={{ color: '#111' }}>
                            {v} employees
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    <select
                      name="heard_from"
                      value={form.heard_from}
                      onChange={onChange('heard_from')}
                      className={selectCls + ' w-full'}
                    >
                      <option value="">How did you hear about us?</option>
                      {SOURCE_OPTIONS.map((v) => (
                        <option key={v} value={v} style={{ color: '#111' }}>{v}</option>
                      ))}
                    </select>
                    <select
                      name="availability"
                      value={form.availability}
                      onChange={onChange('availability')}
                      className={selectCls + ' w-full'}
                    >
                      <option value="">Preferred time</option>
                      {AVAILABILITY_OPTIONS.map((v) => (
                        <option key={v} value={v} style={{ color: '#111' }}>{v}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <textarea
                      rows={4}
                      name="message"
                      value={form.message}
                      onChange={onChange('message')}
                      placeholder="Tell us about your needs (optional)"
                      className={inputCls + ' w-full resize-none'}
                      maxLength={2000}
                    />
                    {errors.message && <p className="mt-1 text-xs text-red-400">{errors.message}</p>}
                  </div>

                  {state === 'error' && errMsg && (
                    <p className="text-xs text-red-400" role="alert">{errMsg}</p>
                  )}

                  <button
                    type="submit"
                    disabled={state === 'submitting'}
                    className="w-full flex items-center justify-center gap-2 bg-[#3FAF97] text-white px-7 py-3.5 rounded-lg text-sm font-medium hover:bg-[#1F5F4F] transition-colors group mt-2 disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {state === 'submitting' ? 'Sending…' : 'Book demo'}
                    {state !== 'submitting' && <ArrowRight size={14} className="group-hover:translate-x-0.5 transition-transform" />}
                  </button>
                </form>
              </div>
            )}
          </motion.div>
        </div>
      </section>
    </div>
  );
}
