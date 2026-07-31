import { useParams, Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { ArrowRight } from 'lucide-react';
import { useTranslation } from '../../i18n';
import type { Language } from '../../i18n';

// Contenu bilingue local — les dictionnaires i18n globaux ne couvrent pas ces
// entrées et ne doivent pas être modifiés d'ici.
type Bi = Record<Language, string>;

const INDUSTRY_DATA: Record<string, { name: Bi; img: string; description: Bi }> = {
  'hvac': {
    name: { en: 'HVAC', fr: 'CVAC' },
    img: '/industries/hvac.png',
    description: {
      en: 'Manage your heating and cooling jobs from lead to invoice. Lume helps HVAC companies streamline scheduling, dispatch technicians, and keep customers coming back season after season.',
      fr: 'Gérez vos jobs de chauffage et de climatisation, du lead à la facture. Lume aide les entreprises en CVAC à simplifier la planification, à répartir les techniciens et à fidéliser leur clientèle saison après saison.',
    },
  },
  'window-cleaning': {
    name: { en: 'Window Cleaning', fr: 'Lavage de vitres' },
    img: '/industries/window.jpg',
    description: {
      en: 'Run your routes, manage recurring clients, and send quotes in seconds. Lume is built for window cleaners who want to spend less time on admin and more time on the job.',
      fr: 'Gérez vos routes et vos clients récurrents, et envoyez des soumissions en quelques secondes. Lume est conçu pour les laveurs de vitres qui veulent passer moins de temps dans la paperasse et plus de temps sur le terrain.',
    },
  },
  'roofing': {
    name: { en: 'Roofing', fr: 'Toiture' },
    img: '/industries/roofing.png',
    description: {
      en: 'From inspection to final payment, manage every roofing project with clarity. Lume handles your long sales cycles, multi-crew coordination, and detailed estimates all in one place.',
      fr: 'De l\'inspection au paiement final, gérez chaque projet de toiture en toute clarté. Lume prend en charge vos longs cycles de vente, la coordination de plusieurs équipes et vos estimations détaillées, au même endroit.',
    },
  },
  'paver': {
    name: { en: 'Paver', fr: 'Pavé uni' },
    img: '/industries/paver.png',
    description: {
      en: 'Structure your season and maximize every lead. Lume gives paving companies the tools to prioritize high-value jobs, dispatch crews by zone, and close more deals.',
      fr: 'Structurez votre saison et maximisez chaque lead. Lume donne aux entreprises de pavé uni les outils pour prioriser les jobs payantes, répartir les équipes par zone et conclure plus de ventes.',
    },
  },
  'power-washing': {
    name: { en: 'Power Washing', fr: 'Lavage à pression' },
    img: '/industries/powerwash.jpg',
    description: {
      en: 'From first contact to five-star review — everything is covered. Lume helps pressure washing businesses manage residential and commercial leads, send fast quotes, and build a strong online reputation.',
      fr: 'Du premier contact à l\'avis 5 étoiles — tout est couvert. Lume aide les entreprises de lavage à pression à gérer leurs leads résidentiels et commerciaux, à envoyer des soumissions rapidement et à bâtir une solide réputation en ligne.',
    },
  },
  'led-lighting': {
    name: { en: 'LED Lighting', fr: 'Éclairage DEL' },
    img: '/industries/leds.png',
    description: {
      en: 'Light up your business operations. Lume helps LED lighting installers manage projects, track leads, and automate follow-ups so you can focus on delivering stunning results.',
      fr: 'Illuminez vos opérations. Lume aide les installateurs d\'éclairage DEL à gérer leurs projets, à suivre leurs leads et à automatiser les relances, pour que vous puissiez vous concentrer sur des résultats éclatants.',
    },
  },
  'lawn-care': {
    name: { en: 'Lawn Care', fr: 'Entretien de pelouse' },
    img: '/industries/lawncare.png',
    description: {
      en: 'Keep your routes tight and your clients happy. Lume helps lawn care businesses manage recurring schedules, optimize routes, and grow through automated review requests.',
      fr: 'Des routes optimisées, des clients satisfaits. Lume aide les entreprises d\'entretien de pelouse à gérer leurs horaires récurrents, à optimiser leurs routes et à croître grâce aux demandes d\'avis automatisées.',
    },
  },
  'landscaping': {
    name: { en: 'Landscaping', fr: 'Aménagement paysager' },
    img: '/industries/landscaping.png',
    description: {
      en: 'From design proposals to project completion, manage your landscaping business end to end. Lume handles quoting, scheduling, crew dispatch, and client communication seamlessly.',
      fr: 'De la proposition de design à la fin des travaux, gérez votre entreprise d\'aménagement paysager de bout en bout. Lume s\'occupe des soumissions, de la planification, de la répartition des équipes et des communications avec vos clients, sans friction.',
    },
  },
  'painting': {
    name: { en: 'Painting', fr: 'Peinture' },
    img: '/industries/painting.png',
    description: {
      en: 'Estimate faster, schedule smarter, and get paid on time. Lume gives painting contractors the tools to manage jobs from quote to completion without the paperwork headache.',
      fr: 'Estimez plus vite, planifiez mieux et soyez payé à temps. Lume donne aux entrepreneurs en peinture les outils pour gérer chaque job, de la soumission à la fin des travaux, sans casse-tête de paperasse.',
    },
  },
  'fencing': {
    name: { en: 'Fencing', fr: 'Clôtures' },
    img: '/industries/fencing.png',
    description: {
      en: 'From door knocking to installation day — one continuous flow. Lume powers your field sales with D2D mapping, leaderboards, and a pipeline that tracks every deal to close.',
      fr: 'Du porte-à-porte au jour de l\'installation — un seul flux continu. Lume propulse vos ventes terrain avec la carte D2D, les leaderboards et un pipeline qui suit chaque deal jusqu\'à la conclusion.',
    },
  },
  'auto-detailing': {
    name: { en: 'Auto Detailing', fr: 'Esthétique automobile' },
    img: '/industries/detailing.png',
    description: {
      en: 'Manage appointments, packages, and client loyalty effortlessly. Lume helps auto detailing businesses book more jobs, send reminders, and build a five-star reputation.',
      fr: 'Gérez vos rendez-vous, vos forfaits et la fidélité de vos clients sans effort. Lume aide les entreprises d\'esthétique automobile à décrocher plus de jobs, à envoyer des rappels et à bâtir une réputation 5 étoiles.',
    },
  },
  'pest-control': {
    name: { en: 'Pest Control', fr: 'Extermination' },
    img: '/industries/pestcontrol.png',
    description: {
      en: 'Stay on top of recurring treatments and new leads. Lume helps pest control businesses manage seasonal demand, automate follow-ups, and keep customers on a regular service schedule.',
      fr: 'Gardez le contrôle sur vos traitements récurrents et vos nouveaux leads. Lume aide les entreprises d\'extermination à gérer la demande saisonnière, à automatiser les relances et à garder leurs clients sur un horaire de service régulier.',
    },
  },
  'plumbing': {
    name: { en: 'Plumbing', fr: 'Plomberie' },
    img: '/industries/plumbing.png',
    description: {
      en: 'Dispatch the right plumber to the right job, every time. Lume helps plumbing companies manage emergency calls, scheduled maintenance, and invoicing from one platform.',
      fr: 'Envoyez le bon plombier sur la bonne job, chaque fois. Lume aide les entreprises de plomberie à gérer les appels d\'urgence, l\'entretien planifié et la facturation à partir d\'une seule plateforme.',
    },
  },
  'electrician': {
    name: { en: 'Electrician', fr: 'Électricien' },
    img: '/industries/electrician.png',
    description: {
      en: 'Wire your business for growth. Lume helps electrical contractors manage leads, schedule jobs, track crew performance, and send professional quotes that win more work.',
      fr: 'Branchez votre entreprise sur la croissance. Lume aide les entrepreneurs électriciens à gérer leurs leads, à planifier leurs jobs, à suivre la performance des équipes et à envoyer des soumissions professionnelles qui décrochent plus de contrats.',
    },
  },
  'cleaning': {
    name: { en: 'Cleaning', fr: 'Entretien ménager' },
    img: '/industries/cleaning.png',
    description: {
      en: 'Keep your cleaning business spotless from the inside out. Lume manages your recurring clients, team schedules, and billing so you can scale without the chaos.',
      fr: 'Une entreprise d\'entretien impeccable, de l\'intérieur comme de l\'extérieur. Lume gère vos clients récurrents, les horaires de votre équipe et la facturation, pour que vous puissiez grandir sans chaos.',
    },
  },
  'junk-removal': {
    name: { en: 'Junk Removal', fr: 'Ramassage de débris' },
    img: '/industries/junkremoval.png',
    description: {
      en: 'Turn every pickup into a five-star experience. Lume helps junk removal companies manage bookings, optimize routes, and follow up with customers automatically.',
      fr: 'Transformez chaque collecte en expérience 5 étoiles. Lume aide les entreprises de ramassage de débris à gérer les réservations, à optimiser les routes et à relancer les clients automatiquement.',
    },
  },
  'construction': {
    name: { en: 'Construction', fr: 'Construction' },
    img: '/industries/construction.png',
    description: {
      en: 'Manage crews, timelines, and budgets with confidence. Lume gives construction companies a clear pipeline from bid to completion with real-time visibility on every project.',
      fr: 'Gérez vos équipes, vos échéanciers et vos budgets en toute confiance. Lume donne aux entreprises de construction un pipeline clair, de la soumission à la livraison, avec une visibilité en temps réel sur chaque projet.',
    },
  },
  'renovation': {
    name: { en: 'Renovation', fr: 'Rénovation' },
    img: '/industries/renovation.png',
    description: {
      en: 'From estimate to final walkthrough — manage every renovation with clarity. Lume handles multi-phase projects, client communication, and subcontractor coordination all in one place.',
      fr: 'De l\'estimation à la visite finale — gérez chaque rénovation en toute clarté. Lume prend en charge les projets à phases multiples, les communications avec vos clients et la coordination des sous-traitants, au même endroit.',
    },
  },
  'pool-maintenance': {
    name: { en: 'Pool Maintenance', fr: 'Entretien de piscine' },
    img: '/industries/pool.png',
    description: {
      en: 'Keep pools clean and clients happy year-round. Lume helps pool maintenance companies manage recurring routes, seasonal demand, and automated service reminders.',
      fr: 'Des piscines propres et des clients heureux à l\'année. Lume aide les entreprises d\'entretien de piscine à gérer leurs routes récurrentes, la demande saisonnière et les rappels de service automatisés.',
    },
  },
  'excavation': {
    name: { en: 'Excavation', fr: 'Excavation' },
    img: '/industries/excavation.png',
    description: {
      en: 'Dig into better operations. Lume helps excavation companies manage project pipelines, coordinate heavy equipment scheduling, and track leads from first call to job completion.',
      fr: 'Creusez vers de meilleures opérations. Lume aide les entreprises d\'excavation à gérer leur pipeline de projets, à coordonner la machinerie lourde et à suivre leurs leads du premier appel à la fin des travaux.',
    },
  },
};

const COPY = {
  en: {
    notFound: 'Industry not found',
    backToIndustries: 'Back to Industries',
    kicker: 'Industry',
    bookDemo: 'Book a demo',
    mobileTitleLine1: 'The entire system,',
    mobileTitleLine2: 'right in your pocket.',
  },
  fr: {
    notFound: 'Industrie introuvable',
    backToIndustries: 'Retour aux industries',
    kicker: 'Industrie',
    bookDemo: 'Réserver une démo',
    mobileTitleLine1: 'Tout le système,',
    mobileTitleLine2: 'directement dans votre poche.',
  },
} as const;

export default function IndustryDetail() {
  const { slug } = useParams();
  const { language, t } = useTranslation();
  const c = COPY[language];
  const industry = slug ? INDUSTRY_DATA[slug] : null;

  if (!industry) {
    return (
      <div className="pt-36 pb-20 px-6 text-center" style={{ backgroundColor: '#fafaf8', backgroundImage: 'url("/paper-texture.png")', backgroundRepeat: 'repeat', backgroundSize: '300px 300px' }}>
        <h1 className="text-3xl font-extrabold text-[#111]">{c.notFound}</h1>
        <Link to="/industries" className="mt-4 inline-block text-sm text-[#3FAF97] font-medium">{c.backToIndustries}</Link>
      </div>
    );
  }

  return (
    <div style={{ backgroundColor: '#fafaf8', backgroundImage: 'url("/paper-texture.png")', backgroundRepeat: 'repeat', backgroundSize: '300px 300px' }}>
      <section className="pt-28 pb-24 md:pt-36 md:pb-32 px-6">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center gap-12 md:gap-16">
          {/* Image left */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="flex-1 rounded-xl overflow-hidden"
          >
            <img
              src={industry.img}
              alt={industry.name[language]}
              className="w-full aspect-[3/4] object-cover"
            />
          </motion.div>

          {/* Text right */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.1 }}
            className="flex-1"
          >
            <p className="text-[11px] uppercase tracking-[0.2em] font-semibold text-[#1F5F4F] mb-3">{c.kicker}</p>
            <h1 className="text-4xl md:text-5xl font-extrabold tracking-[-0.03em] leading-[1.08] text-[#111]">
              {industry.name[language]}
            </h1>
            <p className="mt-5 text-lg text-text-secondary leading-relaxed">
              {industry.description[language]}
            </p>
            <Link
              to="/contact"
              className="mt-8 inline-flex items-center gap-2 px-8 py-3.5 rounded-xl text-sm font-bold text-white transition-opacity hover:opacity-90 group"
              style={{ background: 'linear-gradient(135deg, #3FAF97 0%, #1F5F4F 100%)' }}
            >
              {c.bookDemo}
              <ArrowRight size={14} className="group-hover:translate-x-0.5 transition-transform" />
            </Link>
          </motion.div>
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

      {/* Mobile section */}
      <section className="px-6 py-24 md:py-32">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center gap-12 md:gap-16">
          {/* Title left */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            className="flex-1"
          >
            <div className="bg-text-primary inline-block px-6 py-5 md:px-8 md:py-6 rounded-2xl">
              <h2 className="text-2xl md:text-3xl lg:text-4xl font-extrabold tracking-[-0.03em] leading-[1.1] text-white whitespace-nowrap">
                {c.mobileTitleLine1}<br />{c.mobileTitleLine2}
              </h2>
            </div>
          </motion.div>

          {/* 3 phones right */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className="flex-1 flex items-end justify-center gap-4 md:gap-6"
          >
            <div className="w-[130px] md:w-[185px] lg:w-[210px]">
              <PhoneMockup />
            </div>
            <div className="w-[130px] md:w-[185px] lg:w-[210px] -mb-8">
              <PhoneMockup />
            </div>
            <div className="w-[130px] md:w-[185px] lg:w-[210px]">
              <PhoneMockup />
            </div>
          </motion.div>
        </div>
      </section>
    </div>
  );
}

function PhoneMockup() {
  const { language } = useTranslation();
  const fr = language === 'fr';
  return (
    <div>
      <div className="relative rounded-[1.75rem] md:rounded-[2.25rem] bg-[#1c1c1c] p-[3px] md:p-1"
           style={{ boxShadow: '2px 6px 12px rgba(0,0,0,0.12), 4px 12px 30px rgba(0,0,0,0.08)' }}>
        <div className="absolute -right-[2px] top-[20%] w-[2px] h-6 md:h-8 bg-[#2a2a2a] rounded-r" />
        <div className="absolute -left-[2px] top-[18%] w-[2px] h-4 md:h-5 bg-[#2a2a2a] rounded-l" />
        <div className="absolute -left-[2px] top-[28%] w-[2px] h-8 md:h-10 bg-[#2a2a2a] rounded-l" />
        <div className="absolute -left-[2px] top-[40%] w-[2px] h-8 md:h-10 bg-[#2a2a2a] rounded-l" />
        <div className="rounded-[1.6rem] md:rounded-[2rem] overflow-hidden border border-[#3a3a3a]">
          <div className="flex items-center justify-center py-2 md:py-2.5 bg-white">
            <div className="w-20 md:w-24 h-[18px] md:h-[22px] bg-[#1c1c1c] rounded-full" />
          </div>
          <div className="bg-white">
            <div className="aspect-[9/17] p-3 md:p-4 relative">
              <div className="flex items-center justify-between mb-3">
                <div className="text-[8px] md:text-[9px] font-semibold text-[#1a1a1a]">9:41</div>
                <div className="flex gap-1">
                  <div className="w-3 h-2 bg-[#1a1a1a] rounded-sm" />
                  <div className="w-2.5 h-2 bg-[#1a1a1a] rounded-sm" />
                  <div className="w-4 h-2 bg-[#1a1a1a] rounded-sm" />
                </div>
              </div>
              <div className="flex items-center justify-between mb-4">
                <div className="text-[10px] md:text-xs font-bold text-[#1a1a1a]">{fr ? 'Tableau de bord' : 'Dashboard'}</div>
                <div className="w-5 h-5 md:w-6 md:h-6 rounded-full bg-primary/10 flex items-center justify-center">
                  <div className="w-2.5 h-2.5 rounded-full bg-primary/30" />
                </div>
              </div>
              <div className="p-2.5 md:p-3 rounded-xl bg-[#f7f7f7] border border-[#eaeaea] mb-3">
                <div className="text-[7px] md:text-[8px] text-[#999] uppercase tracking-wide font-medium">{fr ? 'Aujourd\'hui' : 'Today'}</div>
                <div className="text-sm md:text-base font-bold text-[#1a1a1a] mt-1">{fr ? '3 jobs' : '3 Jobs'}</div>
                <div className="mt-2 h-1.5 bg-[#e5e5e5] rounded-full overflow-hidden">
                  <div className="h-full bg-primary rounded-full w-2/3" />
                </div>
              </div>
              <div className="space-y-2">
                {[
                  { time: fr ? '9 h 00' : '9:00 AM', name: 'J. Smith', addr: '142 Oak St', color: 'bg-emerald-50 border-emerald-100' },
                  { time: fr ? '11 h 30' : '11:30 AM', name: 'M. Johnson', addr: '88 Pine Ave', color: 'bg-blue-50 border-blue-100' },
                  { time: fr ? '14 h 00' : '2:00 PM', name: 'R. Davis', addr: '205 Maple Dr', color: 'bg-amber-50 border-amber-100' },
                ].map((item, i) => (
                  <div key={i} className={`p-2 md:p-2.5 rounded-lg border ${item.color}`}>
                    <div className="flex items-center justify-between">
                      <div className="text-[7px] md:text-[8px] text-[#888] font-medium">{item.time}</div>
                      <div className="w-1.5 h-1.5 rounded-full bg-success" />
                    </div>
                    <div className="text-[9px] md:text-[10px] font-semibold text-[#1a1a1a] mt-0.5">{item.name}</div>
                    <div className="text-[7px] md:text-[8px] text-[#999] mt-0.5">{item.addr}</div>
                  </div>
                ))}
              </div>
              <div className="absolute bottom-2 md:bottom-3 left-3 md:left-4 right-3 md:right-4">
                <div className="flex items-center justify-around py-1.5 md:py-2">
                  {(fr ? ['Accueil', 'Carte', 'Jobs', 'Plus'] : ['Home', 'Map', 'Jobs', 'More']).map((label, i) => (
                    <div key={label} className="flex flex-col items-center gap-0.5">
                      <div className={`w-4 h-4 md:w-5 md:h-5 rounded ${i === 0 ? 'bg-primary/20' : 'bg-[#e5e5e5]'}`} />
                      <span className={`text-[6px] md:text-[7px] font-medium ${i === 0 ? 'text-primary' : 'text-[#aaa]'}`}>{label}</span>
                    </div>
                  ))}
                </div>
                <div className="flex justify-center mt-1">
                  <div className="w-8 md:w-10 h-[3px] bg-[#1a1a1a] rounded-full" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
