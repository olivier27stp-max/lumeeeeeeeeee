import React from 'react';
import { motion } from 'motion/react';
import { Check, ArrowRight, Mail } from 'lucide-react';
import { useTranslation } from '../i18n';

interface LandingProps {
  onStart: () => void;
}

const PLANS = [
  {
    key: 'beginner' as const,
    price: 127,
    featured: false,
  },
  {
    key: 'pro' as const,
    price: 297,
    featured: true,
  },
  {
    key: 'autopilot' as const,
    price: 797,
    featured: false,
  },
  {
    key: 'enterprise' as const,
    price: null,
    featured: false,
  },
];

export default function Landing({ onStart }: LandingProps) {
  const { t } = useTranslation();

  return (
    <div className="min-h-screen bg-surface text-text-primary antialiased selection:bg-black/10">
      {/* ── Navbar ── */}
      <nav className="fixed top-0 w-full z-50 bg-surface/80 backdrop-blur-xl border-b border-black/5">
        <div className="max-w-6xl mx-auto flex items-center justify-between px-6 h-16">
          <span className="text-lg font-bold tracking-[0.25em] uppercase">Lume</span>
          <a
            href="mailto:willhebert30@gmail.com"
            className="text-xs font-medium text-text-tertiary hover:text-black transition-colors tracking-wide uppercase"
          >
            Contact
          </a>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="pt-32 pb-24 px-6">
        <div className="max-w-3xl mx-auto text-center space-y-8">
          {/* Logo */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5 }}
            className="flex justify-center"
          >
            <img
              src="/lume-logo.png"
              alt="Lume CRM"
              className="h-44 w-auto mix-blend-multiply"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="text-5xl md:text-7xl font-extralight tracking-tight leading-[1.1]"
          >
            {t.landing.heroTitle1}
            <br />
            <span className="italic">{t.landing.heroTitle2}</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25 }}
            className="max-w-xl mx-auto text-text-tertiary text-lg font-light leading-relaxed"
          >
            {t.landing.heroDesc}
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35 }}
          >
            <button
              onClick={onStart}
              className="inline-flex items-center gap-2 bg-black text-white px-8 py-4 rounded-xl text-sm font-medium tracking-wide hover:bg-black/85 transition-colors group"
            >
              {t.landing.getStarted}
              <ArrowRight size={16} className="group-hover:translate-x-0.5 transition-transform" />
            </button>
          </motion.div>
        </div>
      </section>

      {/* ── Plans ── */}
      <section className="py-24 px-6 bg-white">
        <div className="max-w-6xl mx-auto space-y-16">
          <div className="text-center space-y-3">
            <h2 className="text-3xl md:text-4xl font-extralight tracking-tight">
              {t.landing.simplePricing}
            </h2>
            <p className="text-text-tertiary font-light">{t.landing.choosePlan}</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {PLANS.map((plan, i) => {
              const planData = t.landing.plans[plan.key];
              const isEnterprise = plan.key === 'enterprise';

              return (
                <motion.div
                  key={plan.key}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.08 }}
                  className={`
                    rounded-2xl border p-8 flex flex-col
                    ${plan.featured
                      ? 'bg-black text-white border-black'
                      : 'bg-white border-black/10 hover:border-black/20 transition-colors'
                    }
                  `}
                >
                  {/* Plan name */}
                  <p className={`text-[10px] uppercase tracking-[0.2em] font-semibold ${plan.featured ? 'text-white/50' : 'text-[#999]'}`}>
                    {planData.name}
                  </p>

                  {/* Price */}
                  <div className="mt-4 mb-6">
                    {isEnterprise ? (
                      <p className={`text-2xl font-light ${plan.featured ? 'text-white' : 'text-black'}`}>
                        {planData.priceLabel}
                      </p>
                    ) : (
                      <p className={`text-4xl font-extralight tabular-nums ${plan.featured ? 'text-white' : 'text-black'}`}>
                        ${plan.price}
                        <span className={`text-sm font-normal ${plan.featured ? 'text-white/40' : 'text-[#999]'}`}>
                          {t.landing.perMonth}
                        </span>
                      </p>
                    )}
                  </div>

                  {/* Features */}
                  <ul className="space-y-3 flex-1">
                    {planData.features.map((feat: string, fi: number) => (
                      <li key={fi} className={`flex items-start gap-2.5 text-[13px] font-light leading-snug ${plan.featured ? 'text-white/70' : 'text-[#666]'}`}>
                        <Check size={14} className={`mt-0.5 shrink-0 ${plan.featured ? 'text-white/50' : 'text-black/30'}`} />
                        {feat}
                      </li>
                    ))}
                  </ul>

                  {/* CTA */}
                  <div className="mt-8">
                    {isEnterprise ? (
                      <a
                        href="mailto:willhebert30@gmail.com"
                        className={`
                          flex items-center justify-center gap-2 w-full py-3 rounded-xl text-sm font-medium transition-colors
                          border border-black/10 text-[#666] hover:bg-black/5
                        `}
                      >
                        <Mail size={14} />
                        {t.landing.contactUs}
                      </a>
                    ) : (
                      <button
                        onClick={onStart}
                        className={`
                          w-full py-3 rounded-xl text-sm font-medium transition-colors
                          ${plan.featured
                            ? 'bg-white text-black hover:bg-white/90'
                            : 'bg-black text-white hover:bg-black/85'
                          }
                        `}
                      >
                        {t.landing.getStarted}
                      </button>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="py-10 px-6 border-t border-black/5">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <span className="text-xs font-bold tracking-[0.2em] uppercase text-[#999]">Lume</span>
          <p className="text-[11px] text-[#bbb]">{`© ${new Date().getFullYear()} Lume CRM. ${t.landing.allRightsReserved}`}</p>
          <div className="flex gap-6 text-[11px] text-[#999]">
            <a href="mailto:willhebert30@gmail.com" className="hover:text-black transition-colors">
              {t.landing.contact}
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
