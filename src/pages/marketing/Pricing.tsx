import { motion } from 'motion/react';
import { ArrowRight, ChevronDown } from 'lucide-react';
import { Fragment, useState } from 'react';
import BookDemoForm from '../../components/marketing/BookDemoForm';
import { useTranslation } from '../../i18n';
import TrustSection from '../../components/marketing/TrustSection';
import type { Language } from '../../i18n';

// Copie bilingue locale — les dictionnaires i18n globaux ne couvrent pas ces
// clés et ne doivent pas être modifiés d'ici.
type Bi = Record<Language, string>;

interface Plan {
  name: string;
  slug: string;
  /** L'étape de vie de l'entreprise que le forfait adresse — affichée au-dessus du nom. */
  stage: Bi;
  users: Bi;
  extraUserPrice: Bi;
  offices: Bi;
  extraOfficePrice?: Bi;
  monthlyPrice: number;
  annualFullYr: number;
  annualFirstYr: number;
  badge?: Bi;
  desc: Bi;
  cta: Bi;
  featured: boolean;
}

const PLANS: Plan[] = [
  {
    name: 'Minimum',
    slug: 'starter',
    stage: { en: 'Getting started', fr: 'Je démarre' },
    users: { en: 'Includes 3 users', fr: '3 utilisateurs inclus' },
    extraUserPrice: { en: '+$35/extra user/mo', fr: '+35 $/utilisateur suppl./mois' },
    offices: { en: '1 office', fr: '1 bureau' },
    extraOfficePrice: { en: '+$100/extra office', fr: '+100 $/bureau suppl.' },
    monthlyPrice: 150,
    annualFullYr: 1530,
    annualFirstYr: 1300,
    desc: {
      en: 'Everything you need to run the business solo or with a small crew.',
      fr: 'Tout ce qu\'il faut pour rouler votre entreprise seul ou avec une petite équipe.',
    },
    cta: { en: 'Book a demo', fr: 'Réserver une démo' },
    featured: false,
  },
  {
    name: 'Scale',
    slug: 'pro',
    stage: { en: 'I have a team', fr: 'J\'ai une équipe' },
    users: { en: 'Includes 10 users', fr: '10 utilisateurs inclus' },
    extraUserPrice: { en: '+$30/extra user/mo', fr: '+30 $/utilisateur suppl./mois' },
    offices: { en: '2 offices', fr: '2 bureaux' },
    extraOfficePrice: { en: '+$100/extra office', fr: '+100 $/bureau suppl.' },
    monthlyPrice: 340,
    annualFullYr: 3468,
    annualFirstYr: 2948,
    badge: { en: 'Most Popular', fr: 'Le plus populaire' },
    desc: {
      en: 'For growing teams — stop being the dispatcher and let the system run the day.',
      fr: 'Pour les équipes en croissance — arrêtez d\'être le répartiteur et laissez le système gérer la journée.',
    },
    cta: { en: 'Book a demo', fr: 'Réserver une démo' },
    featured: true,
  },
  {
    name: 'Autopilot',
    slug: 'autopilot',
    stage: { en: 'Runs without me', fr: 'Ça roule sans moi' },
    users: { en: 'Includes 20 users', fr: '20 utilisateurs inclus' },
    extraUserPrice: { en: '+$25/extra user/mo', fr: '+25 $/utilisateur suppl./mois' },
    offices: { en: '5 offices', fr: '5 bureaux' },
    extraOfficePrice: { en: '+$100/extra office', fr: '+100 $/bureau suppl.' },
    monthlyPrice: 495,
    annualFullYr: 5049,
    annualFirstYr: 4292,
    desc: {
      en: 'For businesses that grow without the owner — AI, sales teams and full control.',
      fr: 'Pour les entreprises qui grandissent sans le propriétaire — IA, équipes de vente et contrôle complet.',
    },
    cta: { en: 'Book a demo', fr: 'Réserver une démo' },
    featured: false,
  },
];

// ── Tableau comparatif ────────────────────────────────────────────
// `true` = inclus, `false` = non inclus, un objet Bi = texte (ex. quota).
type Cell = boolean | Bi;
interface CompareRow { label: Bi; cells: [Cell, Cell, Cell] }
interface CompareGroup { title: Bi; rows: CompareRow[] }

const COMPARISON: CompareGroup[] = [
  {
    title: { en: 'Core CRM', fr: 'Cœur du CRM' },
    rows: [
      { label: { en: 'Dashboard & global search', fr: 'Tableau de bord et recherche globale' }, cells: [true, true, true] },
      { label: { en: 'Clients, notes, history & archives', fr: 'Clients, notes, historique et archives' }, cells: [true, true, true] },
      { label: { en: 'Incoming requests', fr: 'Demandes entrantes' }, cells: [true, true, true] },
      { label: { en: 'Quotes, invoicing, e-signatures & contracts', fr: 'Soumissions, facturation, signatures et contrats' }, cells: [true, true, true] },
      { label: { en: 'Products, services & taxes', fr: 'Produits, services et taxes' }, cells: [true, true, true] },
      { label: { en: 'Online payments (Stripe & PayPal)', fr: 'Paiements en ligne (Stripe et PayPal)' }, cells: [true, true, true] },
      { label: { en: 'Jobs, calendar, day view & tasks', fr: 'Jobs, calendrier, vue Jour et tâches' }, cells: [true, true, true] },
      { label: { en: 'Recurring jobs', fr: 'Jobs récurrentes' }, cells: [true, true, true] },
      { label: { en: 'Client emails & appointment reminders', fr: 'Courriels clients et rappels de rendez-vous' }, cells: [true, true, true] },
      { label: { en: 'Client portal', fr: 'Portail client' }, cells: [true, true, true] },
      { label: { en: 'Basic finances & reporting', fr: 'Finances et rapports de base' }, cells: [true, true, true] },
      { label: { en: 'Mobile access', fr: 'Accès mobile' }, cells: [true, true, true] },
      { label: { en: 'Referral program', fr: 'Programme de parrainage' }, cells: [true, true, true] },
    ],
  },
  {
    title: { en: 'Team & operations', fr: 'Équipe et opérations' },
    rows: [
      { label: { en: 'Two-way SMS with a dedicated number', fr: 'Textos bidirectionnels avec numéro dédié' }, cells: [false, true, true] },
      { label: { en: 'Batch messaging', fr: 'Messages groupés' }, cells: [false, true, true] },
      { label: { en: 'Automations & quote/invoice follow-ups', fr: 'Automatisations et relances de soumissions et factures' }, cells: [false, true, true] },
      { label: { en: 'Custom request forms', fr: 'Formulaires de demande personnalisés' }, cells: [false, true, true] },
      { label: { en: 'Employee timesheets & payroll', fr: 'Feuilles de temps et paie' }, cells: [false, true, true] },
      { label: { en: 'Dispatch map & live GPS', fr: 'Carte de répartition et GPS en direct' }, cells: [false, true, true] },
      { label: { en: 'Checklists & checklist templates', fr: 'Listes de vérification et modèles' }, cells: [false, true, true] },
      { label: { en: 'Internal team chat', fr: 'Clavardage d\'équipe interne' }, cells: [false, true, true] },
      { label: { en: 'Quote templates, presets & satellite measure tool', fr: 'Modèles de soumission, préréglages et mesure satellite' }, cells: [false, true, true] },
      { label: { en: 'Employee performance tracking', fr: 'Suivi de la performance des employés' }, cells: [false, true, true] },
      { label: { en: 'Insights & advanced analytics', fr: 'Insights et statistiques avancées' }, cells: [false, true, true] },
      { label: { en: 'QuickBooks export', fr: 'Exportation QuickBooks' }, cells: [false, true, true] },
      { label: { en: 'Webhooks', fr: 'Webhooks' }, cells: [false, true, true] },
    ],
  },
  {
    title: { en: 'Artificial intelligence', fr: 'Intelligence artificielle' },
    rows: [
      { label: { en: 'Lume AI Agent — text', fr: 'Agent IA Lume — texte' }, cells: [false, { en: 'Monthly quota', fr: 'Quota mensuel' }, { en: 'Unlimited', fr: 'Illimité' }] },
      { label: { en: 'Lume AI Agent — voice', fr: 'Agent IA Lume — voix' }, cells: [false, false, { en: 'Unlimited', fr: 'Illimité' }] },
    ],
  },
  {
    title: { en: 'Growth & control', fr: 'Croissance et contrôle' },
    rows: [
      { label: { en: 'Door-to-door: map, pipeline, leaderboard, commissions, reports', fr: 'Porte-à-porte : carte, pipeline, leaderboard, commissions, rapports' }, cells: [false, false, true] },
      { label: { en: 'Courses / LMS', fr: 'Formations / LMS' }, cells: [false, false, true] },
      { label: { en: 'Full API access', fr: 'Accès complet à l\'API' }, cells: [false, false, true] },
      { label: { en: 'Integrations marketplace', fr: 'Marketplace d\'intégrations' }, cells: [false, false, true] },
      { label: { en: 'Advanced roles & permissions', fr: 'Rôles et permissions avancés' }, cells: [false, false, true] },
      { label: { en: 'Multi-team management', fr: 'Gestion multi-équipes' }, cells: [false, false, true] },
      { label: { en: 'Team availability management', fr: 'Gestion des disponibilités' }, cells: [false, false, true] },
      { label: { en: 'Automated satisfaction surveys', fr: 'Sondages de satisfaction automatisés' }, cells: [false, false, true] },
    ],
  },
  {
    title: { en: 'Support', fr: 'Accompagnement' },
    rows: [
      { label: { en: 'Standard support', fr: 'Soutien standard' }, cells: [true, true, true] },
      { label: { en: 'Premium support', fr: 'Soutien prioritaire' }, cells: [false, false, true] },
      { label: { en: 'Dedicated onboarding specialist', fr: 'Spécialiste d\'intégration dédié' }, cells: [false, false, true] },
    ],
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
    subtitle: 'Three plans, one grid. Pick the stage your business is at today — upgrade whenever you\'re ready.',
    monthly: 'Monthly',
    annual: 'Annual',
    perMonth: '/mo',
    billedMonthly: 'Billed monthly · cancel anytime',
    billedAnnually: (firstYr: string, fullYr: string) =>
      `$${firstYr} billed for year one, then $${fullYr}/yr`,
    faqHeading: 'Frequently asked questions',
    included: 'Included',
    notIncluded: 'Not included',
  },
  fr: {
    kicker: 'Tarifs',
    titleLine1: 'Des prix simples,',
    titleUnderlined: 'sans surprises',
    subtitle: 'Trois forfaits, une seule grille. Choisissez l\'étape où votre entreprise est aujourd\'hui — passez au suivant quand vous serez prêt.',
    monthly: 'Mensuel',
    annual: 'Annuel',
    perMonth: '/mois',
    billedMonthly: 'Facturé mensuellement · annulez en tout temps',
    billedAnnually: (firstYr: string, fullYr: string) =>
      `${firstYr} $ facturés la première année, puis ${fullYr} $/an`,
    faqHeading: 'Questions fréquentes',
    included: 'Inclus',
    notIncluded: 'Non inclus',
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

      {/* Grille unique : en-tête collant (étape, nom, prix, description, limites, CTA) + toutes les fonctionnalités */}
      <section className="px-6 pb-20 md:pb-28">
        <div className="max-w-5xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="bg-white border border-[#e5e5e0] rounded-2xl shadow-sm overflow-x-auto md:overflow-visible"
          >
            <table className="w-full min-w-[720px] border-collapse text-[13px]">
              <thead>
                <tr>
                  <th scope="col" className="bg-white rounded-tl-2xl text-left px-5 pt-7 pb-6 align-bottom w-[34%]">
                    <span className="sr-only">{language === 'fr' ? 'Fonctionnalité' : 'Feature'}</span>
                  </th>
                  {PLANS.map((plan, i) => (
                    <th
                      key={plan.slug}
                      scope="col"
                      className={`px-4 pt-7 pb-6 text-center align-top ${i === PLANS.length - 1 ? 'rounded-tr-2xl' : ''} ${
                        plan.featured ? 'bg-[#f4f8f6]' : 'bg-white'
                      }`}
                    >
                      <p className="text-[11px] uppercase tracking-[0.15em] font-semibold text-[#1F5F4F]">{plan.stage[language]}</p>
                      <p className="mt-2 text-[22px] font-extrabold tracking-[-0.02em] text-[#111] leading-tight">
                        {plan.name}
                        {plan.badge && (
                          <span className="ml-2 align-middle inline-block bg-[#1F5F4F] text-white text-[9px] uppercase tracking-[0.15em] font-semibold px-2.5 py-1 rounded-full whitespace-nowrap">
                            {plan.badge[language]}
                          </span>
                        )}
                      </p>
                      <p className="mt-2 tabular-nums">
                        {annual && (
                          <span className="text-sm text-text-secondary line-through mr-1.5">${Math.round(plan.annualFullYr / 12)}</span>
                        )}
                        <span className="text-[26px] font-bold text-text-primary">${annual ? Math.round(plan.annualFirstYr / 12) : plan.monthlyPrice}</span>
                        <span className="text-xs font-normal text-text-secondary">{c.perMonth}</span>
                      </p>
                      <p className="mt-1 text-[10px] text-text-tertiary leading-snug">
                        {annual
                          ? c.billedAnnually(
                              plan.annualFirstYr.toLocaleString(language === 'fr' ? 'fr-CA' : 'en-CA'),
                              plan.annualFullYr.toLocaleString(language === 'fr' ? 'fr-CA' : 'en-CA')
                            )
                          : c.billedMonthly}
                      </p>
                      <p className="mt-3 text-xs text-text-secondary leading-relaxed font-normal max-w-[24ch] mx-auto">{plan.desc[language]}</p>
                      <p className="mt-3 text-[10px] uppercase tracking-[0.14em] font-bold text-[#111]">
                        {plan.users[language]} · {plan.offices[language]}
                      </p>
                      <p className="text-[11px] font-normal text-text-secondary">
                        {plan.extraUserPrice[language]}{plan.extraOfficePrice ? ` · ${plan.extraOfficePrice[language]}` : ''}
                      </p>
                      <button
                        onClick={() => setDemoOpen(true)}
                        className={`mt-4 flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-[13px] font-medium transition-all duration-200 group ${
                          plan.featured ? 'bg-[#1F5F4F] text-white hover:bg-[#174a3d]' : 'bg-text-primary text-white hover:opacity-90'
                        }`}
                      >
                        {plan.cta[language]}
                        <ArrowRight size={14} className="group-hover:translate-x-0.5 transition-transform" />
                      </button>
                    </th>
                  ))}
                </tr>
                {/* Bande compacte : la seule partie qui colle en haut pendant le défilement */}
                <tr>
                  <th scope="col" className="sticky top-0 z-10 bg-white border-y-2 border-[#e0e0e0] text-left px-5 py-3 text-[11px] uppercase tracking-[0.15em] font-semibold text-text-tertiary">
                    {language === 'fr' ? 'Fonctionnalité' : 'Feature'}
                  </th>
                  {PLANS.map(plan => (
                    <th
                      key={plan.slug}
                      scope="col"
                      className={`sticky top-0 z-10 border-y-2 border-[#e0e0e0] px-4 py-3 text-center ${plan.featured ? 'bg-[#f4f8f6]' : 'bg-white'}`}
                    >
                      <div className="flex items-center justify-center gap-3">
                        <span className="text-[15px] font-extrabold text-[#111]">{plan.name}</span>
                        <span className="tabular-nums text-[15px] font-bold text-text-primary">
                          ${annual ? Math.round(plan.annualFirstYr / 12) : plan.monthlyPrice}
                          <span className="text-[11px] font-normal text-text-secondary">{c.perMonth}</span>
                        </span>
                        <button
                          onClick={() => setDemoOpen(true)}
                          aria-label={plan.cta[language]}
                          className={`hidden md:inline-flex items-center justify-center w-7 h-7 rounded-full transition-colors ${
                            plan.featured ? 'bg-[#1F5F4F] text-white hover:bg-[#174a3d]' : 'bg-text-primary text-white hover:opacity-90'
                          }`}
                        >
                          <ArrowRight size={13} />
                        </button>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {COMPARISON.map(group => (
                  <Fragment key={group.title.en}>
                    <CompareGroupHeader title={group.title[language]} />
                    {group.rows.map(row => (
                      <tr key={row.label.en} className="border-t border-[#f0f0ec] hover:bg-[#fafaf8] transition-colors">
                        <td className="px-5 py-3 text-text-secondary leading-snug">{row.label[language]}</td>
                        {row.cells.map((cell, i) => (
                          <td key={i} className={`px-4 py-3 text-center ${PLANS[i].featured ? 'bg-[#1F5F4F]/[0.04]' : ''}`}>
                            <CompareCell cell={cell} language={language} yes={c.included} no={c.notIncluded} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </motion.div>
        </div>
      </section>

      <TrustSection />

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

function CompareGroupHeader({ title }: { title: string }) {
  return (
    <tr className="bg-[#fafaf8] border-t border-[#e5e5e0]">
      <th scope="colgroup" colSpan={4} className="text-left px-5 py-2.5 text-[11px] uppercase tracking-[0.15em] font-semibold text-[#1F5F4F]">
        {title}
      </th>
    </tr>
  );
}

function CompareCell({ cell, language, yes, no }: { cell: Cell; language: Language; yes: string; no: string }) {
  if (cell === true) {
    return (
      <span className="inline-flex w-5 h-5 rounded-full items-center justify-center" style={{ border: '2px solid #3FAF97' }} role="img" aria-label={yes}>
        <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M3 8.5l3.5 3.5L13 5" stroke="#3FAF97" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    );
  }
  if (cell === false) {
    return <span className="text-text-tertiary/60 select-none" role="img" aria-label={no}>—</span>;
  }
  return <span className="text-xs font-semibold text-[#1F5F4F]">{cell[language]}</span>;
}
