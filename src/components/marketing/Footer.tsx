import { useState, type FormEvent } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowRight, Check } from 'lucide-react';
import { useTranslation } from '../../i18n';

type FormState = 'idle' | 'submitting' | 'sent' | 'error';

export default function Footer() {
  const { t, language } = useTranslation();
  const f = t.marketingSite.footer;
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

  const fr = language === 'fr';
  const START = fr
    ? [
        { label: 'Fonctionnalités', href: '/features' },
        { label: 'Soumissions et relances', href: '/features#notifications' },
        { label: 'Calendrier et dispatch', href: '/features#scheduling' },
        { label: 'Formulaire de demande', href: '/features#request-form' },
        { label: 'Paiements en ligne', href: '/features#payments' },
        { label: "Lumi, l'assistant IA", href: '/features#ai-voice' },
        { label: 'Porte-à-porte', href: '/features#d2d-map' },
        { label: 'Solutions', href: '/solutions' },
      ]
    : [
        { label: 'Features', href: '/features' },
        { label: 'Quotes and follow-ups', href: '/features#notifications' },
        { label: 'Calendar and dispatch', href: '/features#scheduling' },
        { label: 'Request form', href: '/features#request-form' },
        { label: 'Online payments', href: '/features#payments' },
        { label: 'Lumi, the AI assistant', href: '/features#ai-voice' },
        { label: 'Door-to-door', href: '/features#d2d-map' },
        { label: 'Solutions', href: '/solutions' },
      ];
  const INDUSTRIES = fr
    ? [
        { label: 'Lavage de vitres', href: '/industries/window-cleaning' },
        { label: 'Paysagement', href: '/industries/landscaping' },
        { label: 'Lavage à pression', href: '/industries/power-washing' },
        { label: 'Toiture', href: '/industries/roofing' },
        { label: 'Excavation', href: '/industries/excavation' },
        { label: 'Plomberie', href: '/industries/plumbing' },
        { label: 'CVAC', href: '/industries/hvac' },
        { label: 'Toutes les industries', href: '/industries' },
      ]
    : [
        { label: 'Window cleaning', href: '/industries/window-cleaning' },
        { label: 'Landscaping', href: '/industries/landscaping' },
        { label: 'Power washing', href: '/industries/power-washing' },
        { label: 'Roofing', href: '/industries/roofing' },
        { label: 'Excavation', href: '/industries/excavation' },
        { label: 'Plumbing', href: '/industries/plumbing' },
        { label: 'HVAC', href: '/industries/hvac' },
        { label: 'All industries', href: '/industries' },
      ];
  const ABOUT = fr
    ? [
        { label: 'Contact', href: '/contact' },
        { label: 'Tarifs', href: '/pricing' },
        { label: 'Confidentialité', href: '/privacy' },
        { label: "Conditions d'utilisation", href: '/terms' },
        { label: 'Sous-traitants', href: '/subprocessors' },
      ]
    : [
        { label: 'Contact', href: '/contact' },
        { label: 'Pricing', href: '/pricing' },
        { label: 'Privacy', href: '/privacy' },
        { label: 'Terms of use', href: '/terms' },
        { label: 'Subprocessors', href: '/subprocessors' },
      ];
  const USEFUL = fr
    ? [
        { label: 'Connexion à Lume', href: '/auth' },
        { label: 'Créer un compte', href: '/register' },
        { label: 'Réserver une démo', href: '#demo' },
        { label: 'Comparer les forfaits', href: '/pricing' },
      ]
    : [
        { label: 'Log in to Lume', href: '/auth' },
        { label: 'Create an account', href: '/register' },
        { label: 'Book a demo', href: '#demo' },
        { label: 'Compare plans', href: '/pricing' },
      ];
  const inputCls = 'w-full px-4 py-3 rounded-xl border border-[#d9d9d4] bg-white text-sm text-[#111] placeholder:text-[#8a8a84] focus:outline-none focus:border-[#1F5F4F] focus:ring-2 focus:ring-[#3FAF97]/25';
  const bullets = fr
    ? ['Vingt minutes, avec ton équipe, tes services et tes prix.', "Pas de carte de crédit, pas d'installation.", "On configure ton compte avec toi. L'intégration guidée est incluse."]
    : ['Twenty minutes, with your team, your services and your prices.', 'No credit card, nothing to install.', 'We set up your account with you. Guided onboarding is included.'];

  return (
    <footer className="text-text-primary border-t border-[#c5c5c5]" style={{ backgroundColor: '#fafaf8', backgroundImage: 'url("/paper-texture.png")', backgroundRepeat: 'repeat', backgroundSize: '300px 300px' }}>
      {/* ── Démo : texte à gauche, formulaire en carte à droite ── */}
      {!isContact && (
        <section id="demo" className="scroll-mt-20">
          <div className="max-w-6xl mx-auto px-6 py-16 md:py-20 grid grid-cols-1 md:grid-cols-[1fr_1.1fr] gap-10 md:gap-16 items-start">
            <div>
              <p className="text-[11px] uppercase tracking-[0.2em] font-semibold text-[#1F5F4F]">{fr ? 'Démo' : 'Demo'}</p>
              <h2 className="mt-2 text-3xl md:text-[38px] font-extrabold tracking-[-0.025em] leading-[1.1] text-[#0a0a0a]">{f.demoTitle}</h2>
              <p className="mt-4 text-[15px] leading-relaxed text-[#333] max-w-[46ch]">{f.imageOverlayTitle}</p>
              <ul className="mt-6 space-y-3">
                {bullets.map((x) => (
                  <li key={x} className="flex items-start gap-3 text-sm text-[#171717]">
                    <span className="mt-0.5 w-5 h-5 rounded-full border-2 border-[#3FAF97] flex items-center justify-center shrink-0"><Check size={11} className="text-[#3FAF97]" /></span>
                    {x}
                  </li>
                ))}
              </ul>
              <button type="button" onClick={() => window.dispatchEvent(new Event('lumi:open'))} className="mt-6 text-sm font-semibold text-[#1F5F4F] hover:underline">
                {fr ? 'Ou pose ta question à Lumi →' : 'Or ask Lumi a question →'}
              </button>
            </div>

            <div className="bg-white rounded-2xl border border-[#e5e5e0] shadow-[0_30px_70px_-34px_rgba(0,0,0,.3)] p-6 md:p-8">
              {state === 'sent' ? (
                <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
                  <div className="w-12 h-12 rounded-full bg-[#3FAF97]/15 flex items-center justify-center">
                    <Check size={24} className="text-[#3FAF97]" />
                  </div>
                  <p className="text-lg font-bold text-[#111]">{f.requestSent}</p>
                  <p className="text-sm text-[#555]">{f.requestSentDesc}</p>
                </div>
              ) : (
                <form onSubmit={onSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <input type="text" required name="full_name" autoComplete="name" value={form.full_name} onChange={onChange('full_name')} placeholder={f.fullNamePlaceholder} className={inputCls} />
                  <input type="text" required name="company" autoComplete="organization" value={form.company} onChange={onChange('company')} placeholder={f.companyPlaceholder} className={inputCls} />
                  <input type="email" required name="email" autoComplete="email" value={form.email} onChange={onChange('email')} placeholder={f.emailPlaceholder} className={inputCls} />
                  <input type="tel" required name="phone" autoComplete="tel" value={form.phone} onChange={onChange('phone')} placeholder={f.phonePlaceholder} className={inputCls} />
                  <textarea rows={3} name="message" value={form.message} onChange={onChange('message')} placeholder={f.messagePlaceholder} className={`${inputCls} sm:col-span-2 resize-none`} />
                  {state === 'error' && errMsg && (
                    <p className="sm:col-span-2 text-xs text-red-600" role="alert">{errMsg}</p>
                  )}
                  <button
                    type="submit"
                    disabled={state === 'submitting'}
                    className="sm:col-span-2 flex items-center justify-center gap-2 bg-[#111] text-white px-7 py-3.5 rounded-xl text-sm font-bold hover:bg-black transition-colors group disabled:opacity-60"
                  >
                    {state === 'submitting' ? f.sending : f.bookDemo}
                    {state !== 'submitting' && <ArrowRight size={14} className="group-hover:translate-x-0.5 transition-transform" />}
                  </button>
                  <p className="sm:col-span-2 text-[11px] text-[#8a8a84]">{fr ? 'On te répond le jour même, en français ou en anglais.' : 'We reply the same day, in French or English.'}</p>
                </form>
              )}
            </div>
          </div>
        </section>
      )}

      {/* ── Liens : contact en haut, quatre colonnes, mentions ── */}
      <div className="border-t border-[#c5c5c5]">
        <div className="max-w-7xl mx-auto px-6 py-12">
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6 pb-10 border-b border-[#d9d9d4]">
            <div>
              <Link to="/" className="inline-flex items-center"><img src="/lume-logo-v2.png" alt="Lume" className="h-9 w-auto" /></Link>
              <p className="mt-3 text-xs text-text-tertiary leading-relaxed max-w-[44ch]">{f.tagline}</p>
            </div>
            <div className="text-sm">
              <p className="text-[11px] uppercase tracking-[0.15em] font-semibold text-text-tertiary">{fr ? 'Écrivez-nous' : 'Write to us'}</p>
              <a href="mailto:support@lumecrm.net" className="mt-1 block text-lg font-bold text-[#111] hover:underline">support@lumecrm.net</a>
              <Link to="/contact" className="mt-1 inline-block text-sm text-[#1F5F4F] font-semibold hover:underline">{fr ? 'Voir toutes les options pour nous contacter →' : 'See all the ways to contact us →'}</Link>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 pt-10">
            <FooterCol title={fr ? 'Vous débutez avec Lume ?' : 'New to Lume?'} links={START} />
            <FooterCol title="Industries" links={INDUSTRIES} />
            <FooterCol title={fr ? 'À propos de Lume' : 'About Lume'} links={ABOUT} />
            <FooterCol title={fr ? 'Liens utiles' : 'Useful links'} links={USEFUL} />
          </div>

          <div className="mt-12 pt-6 border-t border-[#d9d9d4] flex flex-col md:flex-row items-center justify-between gap-3">
            <p className="text-xs text-text-tertiary">
              &copy; {new Date().getFullYear()} Lume. {f.allRightsReserved}
            </p>
            <div className="flex gap-6 text-xs text-text-tertiary">
              <Link to="/privacy" className="hover:text-text-primary transition-colors">{f.privacy}</Link>
              <Link to="/terms" className="hover:text-text-primary transition-colors">{f.terms}</Link>
              <Link to="/subprocessors" className="hover:text-text-primary transition-colors">{fr ? 'Sous-traitants' : 'Subprocessors'}</Link>
            </div>
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
            {l.href.startsWith('#') ? (
              <a href={l.href} className="text-sm text-text-secondary hover:text-text-primary transition-colors">{l.label}</a>
            ) : (
              <Link to={l.href} className="text-sm text-text-secondary hover:text-text-primary transition-colors">{l.label}</Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
