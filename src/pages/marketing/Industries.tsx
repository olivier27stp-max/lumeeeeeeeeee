import { motion } from 'motion/react';
import { Link } from 'react-router-dom';

const INDUSTRIES = [
  { name: 'HVAC', slug: 'hvac', img: '/industries/hvac.png' },
  { name: 'Window Cleaning', slug: 'window-cleaning', img: '/industries/window.jpg' },
  { name: 'Roofing', slug: 'roofing', img: '/industries/roofing.png' },
  { name: 'Paver', slug: 'paver', img: '/industries/paver.png' },
  { name: 'Power Washing', slug: 'power-washing', img: '/industries/powerwash.jpg' },
  { name: 'LED Lighting', slug: 'led-lighting', img: '/industries/leds.png' },
  { name: 'Lawn Care', slug: 'lawn-care', img: '/industries/lawncare.png' },
  { name: 'Landscaping', slug: 'landscaping', img: '/industries/landscaping.png' },
  { name: 'Painting', slug: 'painting', img: '/industries/painting.png' },
  { name: 'Fencing', slug: 'fencing', img: '/industries/fencing.png' },
  { name: 'Auto Detailing', slug: 'auto-detailing', img: '/industries/detailing.png' },
  { name: 'Pest Control', slug: 'pest-control', img: '/industries/pestcontrol.png' },
  { name: 'Plumbing', slug: 'plumbing', img: '/industries/plumbing.png' },
  { name: 'Electrician', slug: 'electrician', img: '/industries/electrician.png' },
  { name: 'Cleaning', slug: 'cleaning', img: '/industries/cleaning.png' },
  { name: 'Junk Removal', slug: 'junk-removal', img: '/industries/junkremoval.png' },
  { name: 'Construction', slug: 'construction', img: '/industries/construction.png' },
  { name: 'Renovation', slug: 'renovation', img: '/industries/renovation.png' },
  { name: 'Pool Maintenance', slug: 'pool-maintenance', img: '/industries/pool.png' },
  { name: 'Excavation', slug: 'excavation', img: '/industries/excavation.png' },
];

export default function Industries() {
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
            Industries
          </motion.p>
          <motion.h1
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="text-4xl md:text-5xl lg:text-6xl font-extrabold tracking-[-0.03em] leading-[1.08] text-text-primary"
          >
            Built for every
            <br />
            home service business
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="mt-5 text-lg font-normal text-text-tertiary max-w-2xl mx-auto leading-relaxed"
          >
            No matter your trade — Lume adapts to the way you work.
          </motion.p>
        </div>
      </section>

      {/* Industry Grid */}
      <section className="px-6 pb-24 md:pb-32">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 md:gap-5">
            {INDUSTRIES.map((industry, i) => (
              <Link key={industry.name} to={`/industries/${industry.slug}`}>
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
                        alt={industry.name}
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
                      {industry.name}
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
