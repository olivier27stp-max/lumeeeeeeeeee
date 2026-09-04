import { useState, type FormEvent } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowRight, Check } from 'lucide-react';
import { useTranslation } from '../../i18n';

type FormState = 'idle' | 'submitting' | 'sent' | 'error';

export default function Footer() {
  const { t } = useTranslation();
  const f = t.marketingSite.footer;
  const PRODUCT = [
    { label: f.product.pipeline, href: '/features#pipeline' },
    { label: f.product.d2dMap, href: '/features#d2d-map' },
    { label: f.product.leaderboard, href: '/features#leaderboard' },
    { label: f.product.aiAssistant, href: '/features#ai-voice' },
    { label: f.product.automations, href: '/features#automation' },
    { label: f.product.scheduling, href: '/features#scheduling' },
    { label: f.product.googleReviews, href: '/features#reviews' },
  ];
  const COMPANY = [
    { label: f.company.contact, href: '/contact' },
  ];

  const { pathname } = useLocation();
  const isContact = pathname === '/contact';
  const [form, setForm] = useState({ full_name: '', email: '', phone: '', company: '', message: '' });
  const [state, setState] = useState<FormState>('idle');
  const [errMsg, setErrMsg] = useState('');

  const onChange = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm(f => ({ ...f, [k]: e.target.value }));

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (state === 'submitting') return;
    setState('submitting');
    setErrMsg('');
    try {
      const res = await fetch('/api/public/book-demo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, source: 'landing' }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: f.submissionFailed }));
        throw new Error(body.error || f.submissionFailed);
      }
      setState('sent');
    } catch (err: any) {
      setState('error');
      setErrMsg(err?.message || f.genericError);
    }
  }

  return (
    <footer className="text-text-primary border-t border-[#c5c5c5]" style={{ backgroundColor: '#fafaf8', backgroundImage: 'url("/paper-texture.png")', backgroundRepeat: 'repeat', backgroundSize: '300px 300px' }}>
      {/* Demo Form Band */}
      {!isContact && <div className="bg-[#2a2a2a]">
        <div className="max-w-5xl mx-auto px-6 py-16">
          {/* Title above everything */}
          <h2 className="text-3xl md:text-4xl font-extrabold tracking-tight text-white text-center mb-10">
            {f.demoTitle}
          </h2>

          <div className="flex flex-col md:flex-row gap-10 items-start">
            {/* Form in white box */}
            <div className="flex-1 bg-white p-8">
              {state === 'sent' ? (
                <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
                  <div className="w-12 h-12 rounded-full bg-[#3FAF97]/15 flex items-center justify-center">
                    <Check size={24} className="text-[#3FAF97]" />
                  </div>
                  <p className="text-lg font-bold text-[#111]">{f.requestSent}</p>
                  <p className="text-sm text-[#555]">{f.requestSentDesc}</p>
                </div>
              ) : (
                <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate={false}>
                  <input type="text" required name="full_name" value={form.full_name} onChange={onChange('full_name')} placeholder={f.fullNamePlaceholder} className="px-4 py-3 border border-[#111] bg-white text-sm text-[#111] placeholder:text-[#111] placeholder:font-bold focus:outline-none focus:border-[#3FAF97] transition-colors" />
                  <input type="email" required name="email" value={form.email} onChange={onChange('email')} placeholder={f.emailPlaceholder} className="px-4 py-3 border border-[#111] bg-white text-sm text-[#111] placeholder:text-[#111] placeholder:font-bold focus:outline-none focus:border-[#3FAF97] transition-colors" />
                  <input type="tel" required name="phone" value={form.phone} onChange={onChange('phone')} placeholder={f.phonePlaceholder} className="px-4 py-3 border border-[#111] bg-white text-sm text-[#111] placeholder:text-[#111] placeholder:font-bold focus:outline-none focus:border-[#3FAF97] transition-colors" />
                  <input type="text" required name="company" value={form.company} onChange={onChange('company')} placeholder={f.companyPlaceholder} className="px-4 py-3 border border-[#111] bg-white text-sm text-[#111] placeholder:text-[#111] placeholder:font-bold focus:outline-none focus:border-[#3FAF97] transition-colors" />
                  <textarea rows={3} name="message" value={form.message} onChange={onChange('message')} placeholder={f.messagePlaceholder} className="px-4 py-3 border border-[#111] bg-white text-sm text-[#111] placeholder:text-[#111] placeholder:font-bold focus:outline-none focus:border-[#3FAF97] transition-colors resize-none" />
                  {state === 'error' && errMsg && (
                    <p className="text-xs text-red-600" role="alert">{errMsg}</p>
                  )}
                  <button
                    type="submit"
                    disabled={state === 'submitting'}
                    className="w-full flex items-center justify-center gap-2 bg-[#3FAF97] text-white px-7 py-3.5 text-sm font-medium hover:bg-[#1F5F4F] transition-colors group mt-2 disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {state === 'submitting' ? f.sending : f.bookDemo}
                    {state !== 'submitting' && <ArrowRight size={14} className="group-hover:translate-x-0.5 transition-transform" />}
                  </button>
                </form>
              )}
            </div>

            {/* Image + text overlay on the right */}
            <div className="flex-1 relative rounded-xl overflow-hidden min-h-[400px]">
              {/* desk.png pesait 2185 Ko — 85 % du poids de la page d'accueil,
                  pour une image recouverte d'un voile noir à 50 %. La version
                  WebP fait 30 Ko (écart visuel mesuré : 0,7 % par pixel).
                  Le <picture> garde le PNG pour les navigateurs sans WebP. */}
              <picture className="absolute inset-0 w-full h-full">
                <source srcSet="/desk.webp" type="image/webp" />
                <img src="/desk.png" alt="Demo" loading="lazy" decoding="async" className="absolute inset-0 w-full h-full object-cover" />
              </picture>
              <div className="absolute inset-0 bg-black/50" />
              <div className="relative z-10 flex flex-col justify-end h-full p-8">
                <p className="text-xl md:text-2xl font-bold text-white leading-snug">
                  {f.imageOverlayTitle}
                </p>
                <p className="mt-3 text-sm text-white/70 leading-relaxed">
                  {f.imageOverlayDesc}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>}

      {/* Links */}
      <div className="max-w-7xl mx-auto px-6 py-12">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-8">
          {/* Brand */}
          <div className="col-span-2 md:col-span-1">
            <Link to="/" className="flex items-center">
              <img src="/lume-logo-v2.png" alt="Lume" className="h-9 w-auto" />
            </Link>
            <p className="mt-3 text-xs text-text-tertiary leading-relaxed">
              {f.tagline}
            </p>
          </div>

          <FooterCol title={f.colProduct} links={PRODUCT} />
          <FooterCol title={f.colCompany} links={COMPANY} />
        </div>

        {/* Bottom */}
        <div className="mt-12 pt-6 border-t border-outline flex flex-col md:flex-row items-center justify-between gap-3">
          <p className="text-xs text-text-tertiary">
            &copy; {new Date().getFullYear()} Lume. {f.allRightsReserved}
          </p>
          <div className="flex gap-6 text-xs text-text-tertiary">
            <Link to="/privacy" className="hover:text-text-primary transition-colors">{f.privacy}</Link>
            <Link to="/terms" className="hover:text-text-primary transition-colors">{f.terms}</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: { label: string; href: string }[] }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-[0.15em] font-semibold text-text-tertiary mb-3">{title}</p>
      <ul className="space-y-2">
        {links.map(l => (
          <li key={l.label}>
            <Link to={l.href} className="text-sm text-text-secondary hover:text-text-primary transition-colors">
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
