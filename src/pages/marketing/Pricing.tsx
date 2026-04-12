import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { Check, ArrowRight, ChevronDown } from 'lucide-react';
import { useState } from 'react';

const PLANS = [
  {
    name: 'Ignite',
    users: 'Includes 3 users',
    originalPrice: 150,
    price: 105,
    desc: 'Perfect for small teams getting started and staying organized.',
    promoNote: 'For 3 months, then $150/mo',
    features: [
      'CRM management',
      'Quotes & invoicing',
      'Online payments',
      'Customer management',
      'Mobile access',
      'Basic reporting',
    ],
    cta: 'Start Free Trial',
    featured: false,
  },
  {
    name: 'Scale',
    users: 'Includes 10 users',
    originalPrice: 340,
    price: 240,
    badge: 'Most Popular',
    desc: 'Built for growing teams that want to automate and scale faster.',
    promoNote: 'For 3 months, then $340/mo',
    features: [
      'Everything in Ignite',
      'Track employee timesheets',
      'Automate quote and invoice follow-ups',
      'Access quote templates',
      'Two-way texting with customers',
      'Track employee performance',
      'AI assistant',
    ],
    cta: 'Start Free Trial',
    featured: true,
  },
  {
    name: 'AutoPilot',
    users: 'Includes 20 users',
    originalPrice: 495,
    price: 360,
    desc: 'For high-performance teams that want full automation and control.',
    promoNote: 'For 3 months, then $495/mo',
    features: [
      'Everything in Scale',
      'Premium support',
      'Built for large teams',
    ],
    cta: 'Start Free Trial',
    featured: false,
  },
];

const FAQS = [
  { q: 'Is there a commitment?', a: 'Monthly plans have no commitment — cancel anytime. Annual plans are a one-year commitment, billed upfront at a 15% discount.' },
  { q: 'Can I switch plans?', a: 'Yes. You can upgrade or downgrade at any time. Changes take effect on the next billing cycle.' },
  { q: 'Is there a free trial?', a: 'Yes! Every plan comes with a 14-day free trial. No credit card required.' },
  { q: 'How does billing work?', a: 'Billing is monthly by credit card. You receive a detailed invoice each month.' },
  { q: 'Is onboarding included?', a: 'Yes. All plans include guided onboarding. AutoPilot includes dedicated onboarding with a specialist.' },
];

export default function Pricing() {
  const [annual, setAnnual] = useState(true);
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
            Pricing
          </motion.p>
          <motion.h1
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="text-4xl md:text-5xl lg:text-6xl font-extrabold tracking-[-0.03em] leading-[1.08] text-text-primary"
          >
            See how it works, try Lume
            <br />
            <span className="relative inline-block font-extrabold">for free<svg className="absolute -bottom-1 left-0 w-full text-[#3FAF97]" height="6" viewBox="0 0 120 8" fill="none" preserveAspectRatio="none"><path d="M2 5.5C12 2.5 22 7 32 4S52 1 62 4.5S82 7.5 92 4S112 2 118 5" stroke="currentColor" strokeWidth="4" strokeLinecap="round" fill="none" /></svg></span> now
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="mt-5 text-lg font-normal text-text-secondary max-w-2xl mx-auto leading-relaxed"
          >
            Just try it, no credit card required
          </motion.p>
        </div>
      </section>

      {/* Toggle */}
      <div className="flex justify-center mb-10 px-6">
        <div className="inline-flex items-center bg-white rounded-full p-1 border border-[#e5e5e0] shadow-sm">
          <button
            onClick={() => setAnnual(false)}
            className={`px-5 py-2 rounded-full text-sm font-medium transition-all duration-200 ${
              !annual ? 'bg-[#111] text-white' : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            Monthly
          </button>
          <button
            onClick={() => setAnnual(true)}
            className={`px-5 py-2 rounded-full text-sm font-medium transition-all duration-200 ${
              annual ? 'bg-[#111] text-white' : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            Annual
            <span className="ml-1.5 text-[10px] font-semibold text-[#3FAF97]">-15%</span>
          </button>
        </div>
      </div>

      {/* Plans */}
      <section className="px-6 pb-20 md:pb-28">
        <div className="max-w-5xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-stretch">
            {PLANS.map((plan, i) => (
              <motion.div
                key={plan.name}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-40px' }}
                transition={{ delay: i * 0.08 }}
                className={`relative rounded-2xl p-7 flex flex-col h-full transition-shadow duration-300 ${
                  plan.featured
                    ? 'bg-white border-2 border-[#1F5F4F] shadow-xl shadow-[#1F5F4F]/8'
                    : 'bg-white border border-[#e5e5e0] shadow-sm hover:shadow-md'
                }`}
              >
                {/* Badge */}
                {plan.badge && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <span className="inline-block bg-[#1F5F4F] text-white text-[10px] uppercase tracking-[0.15em] font-semibold px-4 py-1.5 rounded-full">
                      {plan.badge}
                    </span>
                  </div>
                )}

                {/* Users + Plan name + description */}
                {plan.users && (
                  <p className="text-[11px] uppercase tracking-[0.15em] font-bold text-[#111] mb-1">{plan.users}</p>
                )}
                <p className="text-3xl font-extrabold text-[#111]">
                  {plan.name}
                </p>
                <p className="text-[13px] text-text-secondary leading-relaxed mt-1 mb-5">
                  {plan.desc}
                </p>

                {/* Price */}
                <div className="mb-1">
                  <span className="text-base text-text-secondary line-through mr-2">
                    ${annual ? Math.round(plan.originalPrice * 0.85) : plan.originalPrice}
                  </span>
                  <span className="text-4xl font-bold tabular-nums text-text-primary">
                    ${annual ? Math.round(plan.price * 0.85) : plan.price}
                  </span>
                  <span className="text-sm font-normal text-text-secondary">/mo</span>
                </div>
                <p className="text-[11px] text-text-secondary mb-5">
                  {annual
                    ? `Billed annually at $${Math.round(plan.price * 0.85 * 12)}/yr`
                    : plan.promoNote}
                </p>

                {/* Divider */}
                <hr className="border-0 border-t-2 border-[#e0e0e0] mb-6" />

                {/* Features */}
                <ul className="space-y-3 flex-1">
                  {plan.features.map(f => (
                    <li key={f} className="flex items-center gap-3 text-[13px] font-normal leading-snug text-text-secondary">
                      <div className="w-5 h-5 rounded-full flex items-center justify-center shrink-0" style={{ border: '2px solid #3FAF97' }}>
                        <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
                          <path d="M3 8.5l3.5 3.5L13 5" stroke="#3FAF97" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </div>
                      {f}
                    </li>
                  ))}
                </ul>

                {/* CTA */}
                <div className="mt-8">
                  <Link
                    to="/contact"
                    className={`flex items-center justify-center gap-2 w-full py-3 rounded-xl text-sm font-medium transition-all duration-200 group ${
                      plan.featured
                        ? 'bg-[#1F5F4F] text-white hover:bg-[#174a3d]'
                        : 'bg-text-primary text-white hover:opacity-90'
                    }`}
                  >
                    {plan.cta}
                    <ArrowRight size={14} className="group-hover:translate-x-0.5 transition-transform" />
                  </Link>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Trust */}
      <section className="py-16 md:py-20 px-6">
        <div className="max-w-7xl mx-auto">
          <motion.p
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            className="text-center text-base md:text-lg uppercase tracking-[0.15em] font-semibold text-black mb-12"
          >
            Trusted by customers nationwide
          </motion.p>
          <motion.div
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            className="flex items-center justify-between"
          >
            <div className="flex items-center gap-2.5 select-none h-10">
              <svg width="28" height="28" viewBox="0 0 18 18" fill="none" className="shrink-0">
                <rect x="1" y="1" width="16" height="16" rx="3" stroke="#c0392b" strokeWidth="1.5" />
                <circle cx="9" cy="9" r="3" fill="#c0392b" />
              </svg>
              <div className="flex flex-col leading-none">
                <span className="text-[22px] font-bold text-black tracking-tight">Summit</span>
                <span className="text-[11px] font-medium text-black tracking-[0.04em]">ROOFING CO.</span>
              </div>
            </div>

            <div className="flex items-center gap-2.5 select-none h-10">
              <span className="text-[26px] font-extrabold tracking-[0.06em] text-black uppercase">
                CLEARVIEW
              </span>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <rect x="3" y="4" width="14" height="16" rx="1" stroke="black" strokeWidth="1.8" fill="none" />
                <line x1="10" y1="4" x2="10" y2="20" stroke="black" strokeWidth="1.2" />
                <line x1="3" y1="12" x2="17" y2="12" stroke="black" strokeWidth="1.2" />
                <path d="M2 20L18 20" stroke="black" strokeWidth="2" strokeLinecap="round" />
                <path d="M20 3L20 7" stroke="black" strokeWidth="1.5" strokeLinecap="round" />
                <path d="M18 5L22 5" stroke="black" strokeWidth="1.5" strokeLinecap="round" />
                <path d="M19 10L19 12" stroke="black" strokeWidth="1" strokeLinecap="round" />
                <path d="M18 11L20 11" stroke="black" strokeWidth="1" strokeLinecap="round" />
                <circle cx="22" cy="8" r="0.7" fill="black" />
              </svg>
            </div>

            <div className="flex items-center gap-2.5 select-none h-10">
              <span className="text-[26px] font-light tracking-[0.12em] text-black border-2 border-black rounded-lg px-2.5 py-0.5">
                NTG
              </span>
            </div>

            <div className="flex items-center gap-2.5 select-none h-10">
              <span className="text-[26px] text-black">
                <span className="font-extrabold">APEX</span>
                <span className="font-normal">SUPPLY</span>
              </span>
            </div>

            <div className="flex items-center gap-2.5 select-none h-10">
              <img src="/vision-lavage.png" alt="Vision Lavage" className="h-8 w-auto" />
            </div>

            <div className="flex items-center gap-2.5 select-none h-10">
              <span className="text-[26px] font-black tracking-tight text-black italic">
                Bright<span className="text-[#2563eb]">Wash</span>
              </span>
            </div>

            <div className="flex items-center gap-2.5 select-none h-10">
              <span className="text-[26px] font-bold tracking-[0.15em] text-black uppercase">
                PRO<span className="font-light">SHINE</span>
              </span>
            </div>
          </motion.div>
        </div>
      </section>

      {/* FAQ */}
      <section className="px-6 pb-24 md:pb-32">
        <div className="max-w-3xl mx-auto">
          <motion.h2
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-2xl md:text-3xl font-bold tracking-tight text-text-primary text-center mb-10"
          >
            Frequently asked questions
          </motion.h2>
          <div className="space-y-2">
            {FAQS.map((faq, i) => (
              <PricingFAQ key={i} q={faq.q} a={faq.a} />
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function PricingFAQ({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-white border border-[#e5e5e0] rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-[#fafaf8] transition-colors"
      >
        <span className="text-sm font-medium text-text-primary pr-4">{q}</span>
        <ChevronDown size={16} className={`text-text-tertiary shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="px-5 pb-4">
          <p className="text-sm text-text-tertiary leading-relaxed">{a}</p>
        </div>
      )}
    </div>
  );
}
