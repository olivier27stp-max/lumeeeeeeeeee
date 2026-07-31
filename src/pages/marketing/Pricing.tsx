import { motion } from 'motion/react';
import { ArrowRight, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import BookDemoForm from '../../components/marketing/BookDemoForm';
import { useTranslation } from '../../i18n';
import type { Language } from '../../i18n';

// Copie bilingue locale — les dictionnaires i18n globaux ne couvrent pas ces
// clés et ne doivent pas être modifiés d'ici.
type Bi = Record<Language, string>;

interface Plan {
  name: string;
  slug: string;
  users: Bi;
  extraUserPrice: Bi;
  offices: Bi;
  extraOfficePrice?: Bi;
  monthlyPrice: number;
  annualFullYr: number;
  annualFirstYr: number;
  badge?: Bi;
  desc: Bi;
  features: Record<Language, string[]>;
  cta: Bi;
  featured: boolean;
}

const PLANS: Plan[] = [
  {
    name: 'Minimum',
    slug: 'starter',
    users: { en: 'Includes 3 users', fr: '3 utilisateurs inclus' },
    extraUserPrice: { en: '+$35/extra user/mo', fr: '+35 $/utilisateur suppl./mois' },
    offices: { en: '1 office', fr: '1 bureau' },
    monthlyPrice: 150,
    annualFullYr: 1530,
    annualFirstYr: 1300,
    desc: {
      en: 'Perfect for small teams getting started and staying organized.',
      fr: 'Parfait pour les petites équipes qui démarrent et veulent rester organisées.',
    },
    features: {
      en: [
        'CRM dashboard',
        'Client management + client portal',
        'Quotes & invoicing',
        'Jobs & calendar',
        'Online payments (Stripe & PayPal)',
        'Tasks & leads pipeline',
        'Email communications',
        'Mobile access',
        'Basic reporting',
      ],
      fr: [
        'Tableau de bord CRM',
        'Gestion des clients + portail client',
        'Soumissions et facturation',
        'Jobs et calendrier',
        'Paiements en ligne (Stripe et PayPal)',
        'Tâches et pipeline de leads',
        'Communications par courriel',
        'Accès mobile',
        'Rapports de base',
      ],
    },
    cta: { en: 'Book a demo', fr: 'Réserver une démo' },
    featured: false,
  },
  {
    name: 'Scale',
    slug: 'pro',
    users: { en: 'Includes 10 users', fr: '10 utilisateurs inclus' },
    extraUserPrice: { en: '+$30/extra user/mo', fr: '+30 $/utilisateur suppl./mois' },
    offices: { en: '2 offices', fr: '2 bureaux' },
    extraOfficePrice: { en: '+$100/extra office', fr: '+100 $/bureau suppl.' },
    monthlyPrice: 340,
    annualFullYr: 3468,
    annualFirstYr: 2948,
    badge: { en: 'Most Popular', fr: 'Le plus populaire' },
    desc: {
      en: 'Built for growing teams that want to automate and scale faster.',
      fr: 'Conçu pour les équipes en croissance qui veulent automatiser et croître plus vite.',
    },
    features: {
      en: [
        'Everything in Minimum',
        'Lume AI Agent (voice + unlimited)',
        'Two-way SMS texting with customers (dedicated number)',
        'Door-to-door sales suite (map, pipeline, leaderboard, commissions)',
        'Courses / LMS for team training',
        'Full API access',
        'Automated quote & invoice follow-ups',
        'Quote templates, presets & satellite measure tool',
        'Employee timesheets',
        'Track employee performance',
        'Recurring jobs, checklists & GPS tracking',
        'Dispatch map & batch messaging',
        'Internal team chat',
        'Advanced analytics & insights',
        'QuickBooks export',
        'Marketplace integrations & webhooks',
        'Custom request forms',
      ],
      fr: [
        'Tout ce qui est inclus dans Minimum',
        'Agent IA Lume (voix + illimité)',
        'Textos bidirectionnels avec vos clients (numéro dédié)',
        'Suite de vente porte-à-porte (carte, pipeline, leaderboard, commissions)',
        'Formations / LMS pour votre équipe',
        'Accès complet à l\'API',
        'Relances automatiques de soumissions et factures',
        'Modèles de soumission, préréglages et outil de mesure satellite',
        'Feuilles de temps des employés',
        'Suivi de la performance des employés',
        'Jobs récurrentes, listes de vérification et suivi GPS',
        'Carte de répartition et messagerie en lot',
        'Clavardage d\'équipe interne',
        'Analyses et statistiques avancées',
        'Exportation QuickBooks',
        'Intégrations marketplace et webhooks',
        'Formulaires de demande personnalisés',
      ],
    },
    cta: { en: 'Book a demo', fr: 'Réserver une démo' },
    featured: true,
  },
  {
    name: 'Autopilot',
    slug: 'autopilot',
    users: { en: 'Includes 20 users', fr: '20 utilisateurs inclus' },
    extraUserPrice: { en: '+$25/extra user/mo', fr: '+25 $/utilisateur suppl./mois' },
    offices: { en: '5 offices', fr: '5 bureaux' },
    extraOfficePrice: { en: '+$100/extra office', fr: '+100 $/bureau suppl.' },
    monthlyPrice: 495,
    annualFullYr: 5049,
    annualFirstYr: 4292,
    desc: {
      en: 'For high-performance teams that want full automation and control.',
      fr: 'Pour les équipes performantes qui veulent une automatisation et un contrôle complets.',
    },
    features: {
      en: [
        'Everything in Scale',
        'Multi-team management',
        'Advanced roles & permissions',
        'Team availability management',
        'Automated satisfaction surveys',
        'Premium support',
        'Dedicated onboarding specialist',
      ],
      fr: [
        'Tout ce qui est inclus dans Scale',
        'Gestion multi-équipes',
        'Rôles et permissions avancés',
        'Gestion des disponibilités de l\'équipe',
        'Sondages de satisfaction automatisés',
        'Soutien prioritaire',
        'Spécialiste d\'intégration dédié',
      ],
    },
    cta: { en: 'Book a demo', fr: 'Réserver une démo' },
    featured: false,
  },
];

const FAQS: { q: Bi; a: Bi }[] = [
  {
    q: { en: 'Is there a commitment?', fr: 'Y a-t-il un engagement ?' },
    a: {
      en: 'Monthly plans have no commitment — cancel anytime. Annual plans are a one-year commitment, billed upfront at a 15% discount.',
      fr: 'Les forfaits mensuels sont sans engagement — annulez en tout temps. Les forfaits annuels représentent un engagement d\'un an, facturé d\'avance avec un rabais de 15 %.',
    },
  },
  {
    q: { en: 'Can I switch plans?', fr: 'Puis-je changer de forfait ?' },
    a: {
      en: 'Yes. You can upgrade or downgrade at any time. Changes take effect on the next billing cycle.',
      fr: 'Oui. Vous pouvez passer à un forfait supérieur ou inférieur en tout temps. Les changements prennent effet au prochain cycle de facturation.',
    },
  },
  {
    q: { en: 'Can I see a demo first?', fr: 'Puis-je voir une démo d\'abord ?' },
    a: {
      en: 'Yes! Book a demo with our team and we\'ll walk you through the platform live.',
      fr: 'Oui ! Réservez une démo avec notre équipe et nous vous ferons visiter la plateforme en direct.',
    },
  },
  {
    q: { en: 'How does billing work?', fr: 'Comment fonctionne la facturation ?' },
    a: {
      en: 'Billing is monthly by credit card. You receive a detailed invoice each month.',
      fr: 'La facturation est mensuelle, par carte de crédit. Vous recevez une facture détaillée chaque mois.',
    },
  },
  {
    q: { en: 'Is onboarding included?', fr: 'L\'intégration est-elle incluse ?' },
    a: {
      en: 'Yes. All plans include guided onboarding. AutoPilot includes dedicated onboarding with a specialist.',
      fr: 'Oui. Tous les forfaits incluent une intégration guidée. Autopilot inclut une intégration dédiée avec un spécialiste.',
    },
  },
];

const COPY = {
  en: {
    kicker: 'Pricing',
    titleLine1: 'Simple pricing,',
    titleUnderlined: 'no surprises',
    subtitle: 'Choose the plan that fits your team',
    monthly: 'Monthly',
    annual: 'Annual',
    perMonth: '/mo',
    billedMonthly: 'Billed monthly · cancel anytime',
    billedAnnually: (firstYr: string, fullYr: string) =>
      `$${firstYr} billed for year one, then $${fullYr}/yr`,
    faqHeading: 'Frequently asked questions',
  },
  fr: {
    kicker: 'Tarifs',
    titleLine1: 'Des prix simples,',
    titleUnderlined: 'sans surprises',
    subtitle: 'Choisissez le forfait qui convient à votre équipe',
    monthly: 'Mensuel',
    annual: 'Annuel',
    perMonth: '/mois',
    billedMonthly: 'Facturé mensuellement · annulez en tout temps',
    billedAnnually: (firstYr: string, fullYr: string) =>
      `${firstYr} $ facturés la première année, puis ${fullYr} $/an`,
    faqHeading: 'Questions fréquentes',
  },
} as const;

export default function Pricing({ authenticated: _authenticated }: { authenticated?: boolean }) {
  const [annual, setAnnual] = useState(true);
  const [demoOpen, setDemoOpen] = useState(false);
  const { language, t } = useTranslation();
  const c = COPY[language];
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
            {c.kicker}
          </motion.p>
          <motion.h1
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="text-4xl md:text-5xl lg:text-6xl font-extrabold tracking-[-0.03em] leading-[1.08] text-text-primary"
          >
            {c.titleLine1}
            <br />
            <span className="relative inline-block font-extrabold">{c.titleUnderlined}<svg className="absolute -bottom-1 left-0 w-full text-[#3FAF97]" height="6" viewBox="0 0 120 8" fill="none" preserveAspectRatio="none"><path d="M2 5.5C12 2.5 22 7 32 4S52 1 62 4.5S82 7.5 92 4S112 2 118 5" stroke="currentColor" strokeWidth="4" strokeLinecap="round" fill="none" /></svg></span>
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="mt-5 text-lg font-normal text-text-secondary max-w-2xl mx-auto leading-relaxed"
          >
            {c.subtitle}
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
            {c.monthly}
          </button>
          <button
            onClick={() => setAnnual(true)}
            className={`px-5 py-2 rounded-full text-sm font-medium transition-all duration-200 ${
              annual ? 'bg-[#111] text-white' : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            {c.annual}
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
                      {plan.badge[language]}
                    </span>
                  </div>
                )}

                {/* Users + Plan name + description */}
                {plan.users && (
                  <p className="text-[11px] uppercase tracking-[0.15em] font-bold text-[#111] mb-1">
                    {plan.users[language]}
                    {plan.extraUserPrice && (
                      <span className="ml-1 font-medium normal-case tracking-normal text-text-secondary">· {plan.extraUserPrice[language]}</span>
                    )}
                  </p>
                )}
                {plan.offices && (
                  <p className="text-[11px] uppercase tracking-[0.15em] font-bold text-[#111] mb-1">
                    {plan.offices[language]}
                    {plan.extraOfficePrice && (
                      <span className="ml-1 font-medium normal-case tracking-normal text-text-secondary">· {plan.extraOfficePrice[language]}</span>
                    )}
                  </p>
                )}
                <p className="text-3xl font-extrabold text-[#111]">
                  {plan.name}
                </p>
                <p className="text-[13px] text-text-secondary leading-relaxed mt-1 mb-5">
                  {plan.desc[language]}
                </p>

                {/* Price */}
                <div className="mb-1">
                  {annual && (
                    <span className="text-base text-text-secondary line-through mr-2">
                      ${Math.round(plan.annualFullYr / 12)}
                    </span>
                  )}
                  <span className="text-4xl font-bold tabular-nums text-text-primary">
                    ${annual ? Math.round(plan.annualFirstYr / 12) : plan.monthlyPrice}
                  </span>
                  <span className="text-sm font-normal text-text-secondary">{c.perMonth}</span>
                </div>
                <p className="text-[11px] text-text-secondary mb-5">
                  {annual
                    ? c.billedAnnually(
                        plan.annualFirstYr.toLocaleString(language === 'fr' ? 'fr-CA' : 'en-CA'),
                        plan.annualFullYr.toLocaleString(language === 'fr' ? 'fr-CA' : 'en-CA')
                      )
                    : c.billedMonthly}
                </p>

                {/* Divider */}
                <hr className="border-0 border-t-2 border-[#e0e0e0] mb-6" />

                {/* Features */}
                <ul className="space-y-3 flex-1">
                  {plan.features[language].map(f => (
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

                {/* CTA — demo-only: no direct self-serve checkout from the landing */}
                <div className="mt-8">
                  <button
                    onClick={() => setDemoOpen(true)}
                    className={`flex items-center justify-center gap-2 w-full py-3 rounded-xl text-sm font-medium transition-all duration-200 group ${
                      plan.featured
                        ? 'bg-[#1F5F4F] text-white hover:bg-[#174a3d]'
                        : 'bg-text-primary text-white hover:opacity-90'
                    }`}
                  >
                    {plan.cta[language]}
                    <ArrowRight size={14} className="group-hover:translate-x-0.5 transition-transform" />
                  </button>
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
            {t.marketingSite.trust.heading}
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
            {c.faqHeading}
          </motion.h2>
          <div className="space-y-2">
            {FAQS.map((faq, i) => (
              <PricingFAQ key={i} q={faq.q[language]} a={faq.a[language]} />
            ))}
          </div>
        </div>
      </section>

      <BookDemoForm open={demoOpen} onClose={() => setDemoOpen(false)} source="pricing" />
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
