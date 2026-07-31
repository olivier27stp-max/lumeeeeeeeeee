import { motion } from 'motion/react';
import { Link } from 'react-router-dom';
import { useTranslation } from '../../i18n';

// Noms bilingues locaux — les dictionnaires i18n globaux ne couvrent pas ces
// entrées et ne doivent pas être modifiés d'ici.
const INDUSTRIES = [
  { name: { en: 'HVAC', fr: 'CVAC' }, slug: 'hvac', img: '/industries/hvac.png' },
  { name: { en: 'Window Cleaning', fr: 'Lavage de vitres' }, slug: 'window-cleaning', img: '/industries/window.jpg' },
  { name: { en: 'Roofing', fr: 'Toiture' }, slug: 'roofing', img: '/industries/roofing.png' },
  { name: { en: 'Paver', fr: 'Pavé uni' }, slug: 'paver', img: '/industries/paver.png' },
  { name: { en: 'Power Washing', fr: 'Lavage à pression' }, slug: 'power-washing', img: '/industries/powerwash.jpg' },
  { name: { en: 'LED Lighting', fr: 'Éclairage DEL' }, slug: 'led-lighting', img: '/industries/leds.png' },
  { name: { en: 'Lawn Care', fr: 'Entretien de pelouse' }, slug: 'lawn-care', img: '/industries/lawncare.png' },
  { name: { en: 'Landscaping', fr: 'Aménagement paysager' }, slug: 'landscaping', img: '/industries/landscaping.png' },
  { name: { en: 'Painting', fr: 'Peinture' }, slug: 'painting', img: '/industries/painting.png' },
  { name: { en: 'Fencing', fr: 'Clôtures' }, slug: 'fencing', img: '/industries/fencing.png' },
  { name: { en: 'Auto Detailing', fr: 'Esthétique automobile' }, slug: 'auto-detailing', img: '/industries/detailing.png' },
  { name: { en: 'Pest Control', fr: 'Extermination' }, slug: 'pest-control', img: '/industries/pestcontrol.png' },
  { name: { en: 'Plumbing', fr: 'Plomberie' }, slug: 'plumbing', img: '/industries/plumbing.png' },
  { name: { en: 'Electrician', fr: 'Électricien' }, slug: 'electrician', img: '/industries/electrician.png' },
  { name: { en: 'Cleaning', fr: 'Entretien ménager' }, slug: 'cleaning', img: '/industries/cleaning.png' },
  { name: { en: 'Junk Removal', fr: 'Ramassage de débris' }, slug: 'junk-removal', img: '/industries/junkremoval.png' },
  { name: { en: 'Construction', fr: 'Construction' }, slug: 'construction', img: '/industries/construction.png' },
  { name: { en: 'Renovation', fr: 'Rénovation' }, slug: 'renovation', img: '/industries/renovation.png' },
  { name: { en: 'Pool Maintenance', fr: 'Entretien de piscine' }, slug: 'pool-maintenance', img: '/industries/pool.png' },
  { name: { en: 'Excavation', fr: 'Excavation' }, slug: 'excavation', img: '/industries/excavation.png' },
];

const COPY = {
  en: {
    kicker: 'Industries',
    titleLine1: 'Built for every',
    titleLine2: 'home service business',
    subtitle: 'No matter your trade — Lume adapts to the way you work.',
  },
  fr: {
    kicker: 'Industries',
    titleLine1: 'Conçu pour toutes les',
    titleLine2: 'entreprises de services résidentiels',
    subtitle: 'Peu importe votre métier — Lume s\'adapte à votre façon de travailler.',
  },
} as const;

export default function Industries() {
  const { language } = useTranslation();
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
            {c.titleLine2}
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="mt-5 text-lg font-normal text-text-tertiary max-w-2xl mx-auto leading-relaxed"
          >
            {c.subtitle}
          </motion.p>
        </div>
      </section>

      {/* Industry Grid */}
      <section className="px-6 pb-24 md:pb-32">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 md:gap-5">
            {INDUSTRIES.map((industry, i) => (
              <Link key={industry.slug} to={`/industries/${industry.slug}`}>
                <motion.div
                  initial={{ opacity: 0, y: 16 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: '-40px' }}
                  transition={{ delay: i * 0.03 }}
                  className="group relative rounded-xl overflow-hidden cursor-pointer"
                >
                  <div className="aspect-[3/4] overflow-hidden">
                    {industry.img ? (
                      <img
                        src={industry.img}
                        alt={industry.name[language]}
                        className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-full h-full bg-[#e5e5e0]" />
                    )}
                  </div>
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent pointer-events-none" />
                  <div className="absolute bottom-0 left-0 right-0 p-4">
                    <h3 className="text-white text-base font-bold tracking-tight">
                      {industry.name[language]}
                    </h3>
                  </div>
                </motion.div>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
