import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { ArrowRight, Star } from 'lucide-react';

/* ─── HERO + DEVICES SIDE BY SIDE ─── */
function Hero() {
  return (
    <section className="relative pt-28 pb-16 md:pt-36 md:pb-24 px-6 overflow-hidden">
      <div className="max-w-7xl mx-auto flex flex-col lg:flex-row items-center gap-12 lg:gap-16">
        {/* Left — Text */}
        <div className="flex-1 shrink-0 text-center lg:text-left">
          <motion.h1
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="text-[clamp(1.75rem,4vw,3.5rem)] font-extrabold tracking-[-0.03em] leading-[1.12] text-text-primary whitespace-nowrap"
          >
            <span>Stop managing{' '}
              <span className="relative inline-block">
                manually,
                <svg className="absolute -bottom-1 left-0 w-full text-red-500" height="6" viewBox="0 0 120 8" fill="none" preserveAspectRatio="none">
                  <path d="M2 5.5C12 2.5 22 7 32 4S52 1 62 4.5S82 7.5 92 4S112 2 118 5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" fill="none" />
                </svg>
              </span>
            </span>
            <br />
            <span>start scaling{' '}
              <span className="relative inline-block">
                automatically
                <svg className="absolute -bottom-1 left-0 w-full text-[#3FAF97]" height="6" viewBox="0 0 120 8" fill="none" preserveAspectRatio="none">
                  <path d="M2 5.5C12 2.5 22 7 32 4S52 1 62 4.5S82 7.5 92 4S112 2 118 5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" fill="none" />
                </svg>
              </span>
            </span>
          </motion.h1>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25 }}
            className="mt-8 flex flex-col sm:flex-row items-center lg:items-start justify-center lg:justify-start gap-3"
          >
            <Link
              to="/contact"
              className="inline-flex items-center gap-2 bg-text-primary text-surface px-7 py-3.5 rounded-xl text-sm font-bold hover:opacity-85 transition-opacity group"
            >
              Book a demo
              <ArrowRight size={16} className="group-hover:translate-x-0.5 transition-transform" />
            </Link>
            <Link
              to="/contact"
              className="inline-flex items-center gap-2 bg-[#3FAF97] text-white px-7 py-3.5 rounded-xl text-sm font-bold hover:bg-[#1F5F4F] transition-colors"
            >
              Free trial
            </Link>
          </motion.div>
        </div>

        {/* Right — Device mockups */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.6 }}
          className="flex-1 w-full max-w-2xl relative z-10"
        >
        {/* Wall-mounted monitor */}
        <div className="relative z-10">
          {/* Wall shadow behind monitor */}
          <div className="absolute -bottom-5 left-[4%] right-[4%] h-8 bg-black/20 blur-2xl rounded-full" />
          <div className="absolute inset-0 translate-x-2 translate-y-3 bg-black/15 blur-xl rounded-[10px] md:rounded-[14px]" />

          {/* Monitor frame — thick uniform bezel */}
          <div className="relative rounded-lg md:rounded-xl border-[6px] md:border-[10px] border-[#111111] bg-[#111111] overflow-hidden"
               style={{ boxShadow: '0 4px 20px rgba(0,0,0,0.15), 0 1px 4px rgba(0,0,0,0.1)' }}>
            {/* Subtle bezel inner edge */}
            <div className="absolute inset-0 rounded-[4px] md:rounded-[6px] ring-1 ring-inset ring-white/5 pointer-events-none z-10" />
            {/* Screen content */}
            <div className="bg-white">
              <div className="aspect-[16/9]">
                <div className="h-full flex">
                  {/* Sidebar */}
                  <div className="hidden md:flex w-48 bg-[#f8f8f8] border-r border-[#e8e8e8] flex-col p-4">
                    <div className="h-5 bg-[#e0e0e0] rounded w-20 mb-6" />
                    <div className="space-y-3 flex-1">
                      {['w-full', 'w-4/5', 'w-3/4', 'w-full', 'w-2/3', 'w-4/5', 'w-3/4'].map((w, i) => (
                        <div key={i} className={`h-3.5 rounded ${w} ${i === 0 ? 'bg-primary/15' : 'bg-[#ebebeb]'}`} />
                      ))}
                    </div>
                    <div className="mt-auto pt-4 border-t border-[#e8e8e8]">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-[#e0e0e0]" />
                        <div className="h-3 bg-[#e0e0e0] rounded w-16" />
                      </div>
                    </div>
                  </div>
                  {/* Main content */}
                  <div className="flex-1 p-4 md:p-6 bg-white">
                    {/* Top bar */}
                    <div className="flex items-center justify-between mb-6">
                      <div className="h-5 bg-[#ebebeb] rounded w-32" />
                      <div className="flex gap-2">
                        <div className="h-8 bg-[#ebebeb] rounded-lg w-24" />
                        <div className="h-8 bg-primary/10 rounded-lg w-20" />
                      </div>
                    </div>
                    {/* Stat cards */}
                    <div className="grid grid-cols-3 gap-3 mb-6">
                      {[
                        { label: 'Revenue', value: '$48,200', change: '+12%' },
                        { label: 'New Leads', value: '147', change: '+23%' },
                        { label: 'Close Rate', value: '68%', change: '+5%' },
                      ].map((stat, i) => (
                        <div key={i} className="p-3 md:p-4 rounded-xl border border-[#eaeaea] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
                          <div className="text-[9px] md:text-[10px] text-[#999] uppercase tracking-wide font-medium">{stat.label}</div>
                          <div className="text-base md:text-xl font-bold mt-1 text-[#1a1a1a]">{stat.value}</div>
                          <div className="text-[10px] font-medium text-success mt-0.5">{stat.change}</div>
                        </div>
                      ))}
                    </div>
                    {/* Charts area */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="p-3 md:p-4 rounded-xl border border-[#eaeaea] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
                        <div className="text-[10px] font-semibold text-[#555] mb-3">Pipeline</div>
                        <div className="flex items-end gap-1.5 h-16 md:h-24">
                          {[40, 65, 50, 80, 60, 75, 45, 90, 55, 70, 85, 50].map((h, i) => (
                            <div key={i} className="flex-1 flex items-end">
                              <div style={{ height: `${h}%` }} className="w-full bg-primary/20 rounded-sm" />
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="p-3 md:p-4 rounded-xl border border-[#eaeaea] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
                        <div className="text-[10px] font-semibold text-[#555] mb-3">Recent Activity</div>
                        <div className="space-y-2.5">
                          {[...Array(4)].map((_, i) => (
                            <div key={i} className="flex items-center gap-2">
                              <div className="w-5 h-5 md:w-6 md:h-6 rounded-full bg-[#ebebeb] shrink-0" />
                              <div className="flex-1">
                                <div className="h-2.5 bg-[#ebebeb] rounded w-4/5" />
                              </div>
                              <div className="h-2 bg-[#ebebeb] rounded w-10" />
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

        </div>

        {/* Phone — overlapping right side */}
        <div className="absolute -right-10 md:-right-16 lg:-right-14 bottom-0 md:-bottom-10 z-20 w-[130px] md:w-[185px] lg:w-[210px] scale-[0.7] origin-bottom-right">
          <div className="relative rounded-[1.75rem] md:rounded-[2.25rem] bg-[#1c1c1c] p-[3px] md:p-1"
               style={{ boxShadow: '2px 6px 12px rgba(0,0,0,0.12), 4px 12px 30px rgba(0,0,0,0.08)' }}>
            {/* Side buttons */}
            <div className="absolute -right-[2px] top-[20%] w-[2px] h-6 md:h-8 bg-[#2a2a2a] rounded-r" />
            <div className="absolute -left-[2px] top-[18%] w-[2px] h-4 md:h-5 bg-[#2a2a2a] rounded-l" />
            <div className="absolute -left-[2px] top-[28%] w-[2px] h-8 md:h-10 bg-[#2a2a2a] rounded-l" />
            <div className="absolute -left-[2px] top-[40%] w-[2px] h-8 md:h-10 bg-[#2a2a2a] rounded-l" />

            <div className="rounded-[1.6rem] md:rounded-[2rem] overflow-hidden border border-[#3a3a3a]">
              {/* Dynamic Island */}
              <div className="flex items-center justify-center py-2 md:py-2.5 bg-white">
                <div className="w-20 md:w-24 h-[18px] md:h-[22px] bg-[#1c1c1c] rounded-full" />
              </div>
              {/* Screen */}
              <div className="bg-white">
                <div className="aspect-[9/17] p-3 md:p-4 relative">
                  {/* Status bar */}
                  <div className="flex items-center justify-between mb-3">
                    <div className="text-[8px] md:text-[9px] font-semibold text-[#1a1a1a]">9:41</div>
                    <div className="flex gap-1">
                      <div className="w-3 h-2 bg-[#1a1a1a] rounded-sm" />
                      <div className="w-2.5 h-2 bg-[#1a1a1a] rounded-sm" />
                      <div className="w-4 h-2 bg-[#1a1a1a] rounded-sm" />
                    </div>
                  </div>
                  {/* App header */}
                  <div className="flex items-center justify-between mb-4">
                    <div className="text-[10px] md:text-xs font-bold text-[#1a1a1a]">Dashboard</div>
                    <div className="w-5 h-5 md:w-6 md:h-6 rounded-full bg-primary/10 flex items-center justify-center">
                      <div className="w-2.5 h-2.5 rounded-full bg-primary/30" />
                    </div>
                  </div>
                  {/* Summary card */}
                  <div className="p-2.5 md:p-3 rounded-xl bg-[#f7f7f7] border border-[#eaeaea] mb-3">
                    <div className="text-[7px] md:text-[8px] text-[#999] uppercase tracking-wide font-medium">Today</div>
                    <div className="text-sm md:text-base font-bold text-[#1a1a1a] mt-1">3 Jobs</div>
                    <div className="mt-2 h-1.5 bg-[#e5e5e5] rounded-full overflow-hidden">
                      <div className="h-full bg-primary rounded-full w-2/3" />
                    </div>
                  </div>
                  {/* Schedule items */}
                  <div className="space-y-2">
                    {[
                      { time: '9:00 AM', name: 'J. Smith', addr: '142 Oak St', color: 'bg-emerald-50 border-emerald-100' },
                      { time: '11:30 AM', name: 'M. Johnson', addr: '88 Pine Ave', color: 'bg-blue-50 border-blue-100' },
                      { time: '2:00 PM', name: 'R. Davis', addr: '205 Maple Dr', color: 'bg-amber-50 border-amber-100' },
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
                  {/* Bottom nav */}
                  <div className="absolute bottom-2 md:bottom-3 left-3 md:left-4 right-3 md:right-4">
                    <div className="flex items-center justify-around py-1.5 md:py-2">
                      {['Home', 'Map', 'Jobs', 'More'].map((label, i) => (
                        <div key={label} className="flex flex-col items-center gap-0.5">
                          <div className={`w-4 h-4 md:w-5 md:h-5 rounded ${i === 0 ? 'bg-primary/20' : 'bg-[#e5e5e5]'}`} />
                          <span className={`text-[6px] md:text-[7px] font-medium ${i === 0 ? 'text-primary' : 'text-[#aaa]'}`}>{label}</span>
                        </div>
                      ))}
                    </div>
                    {/* Home indicator */}
                    <div className="flex justify-center mt-1">
                      <div className="w-8 md:w-10 h-[3px] bg-[#1a1a1a] rounded-full" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </motion.div>
      </div>
    </section>
  );
}

/* ─── TRUST SECTION ─── */
function TrustLogo({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 select-none h-10">
      {children}
    </div>
  );
}

function TrustSection() {
  return (
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
          <TrustLogo>
            <svg width="28" height="28" viewBox="0 0 18 18" fill="none" className="shrink-0">
              <rect x="1" y="1" width="16" height="16" rx="3" stroke="#c0392b" strokeWidth="1.5" />
              <circle cx="9" cy="9" r="3" fill="#c0392b" />
            </svg>
            <div className="flex flex-col leading-none">
              <span className="text-[22px] font-bold text-black tracking-tight">Summit</span>
              <span className="text-[11px] font-medium text-black tracking-[0.04em]">ROOFING CO.</span>
            </div>
          </TrustLogo>

          <TrustLogo>
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
          </TrustLogo>

          <TrustLogo>
            <span className="text-[26px] font-light tracking-[0.12em] text-black border-2 border-black rounded-lg px-2.5 py-0.5">
              NTG
            </span>
          </TrustLogo>

          <TrustLogo>
            <span className="text-[26px] text-black">
              <span className="font-extrabold">APEX</span>
              <span className="font-normal">SUPPLY</span>
            </span>
          </TrustLogo>

          <TrustLogo>
            <img src="/vision-lavage.png" alt="Vision Lavage" className="h-8 w-auto" />
          </TrustLogo>

          <TrustLogo>
            <span className="text-[26px] font-black tracking-tight text-black italic">
              Bright<span className="text-[#2563eb]">Wash</span>
            </span>
          </TrustLogo>

          <TrustLogo>
            <span className="text-[26px] font-bold tracking-[0.15em] text-black uppercase">
              PRO<span className="font-light">SHINE</span>
            </span>
          </TrustLogo>

        </motion.div>
      </div>
    </section>
  );
}

/* ─── TESTIMONIAL ─── */
function Testimonial() {
  return (
    <section className="py-20 md:py-28 px-6">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        className="max-w-3xl mx-auto text-center"
      >
        {/* 5 stars */}
        <div className="flex items-center justify-center gap-1 mb-6">
          {[...Array(5)].map((_, i) => (
            <Star key={i} size={20} className="text-amber-400 fill-amber-400" />
          ))}
        </div>

        {/* Quote */}
        <blockquote className="text-xl md:text-2xl lg:text-3xl font-bold tracking-tight leading-[1.2] text-text-primary">
          "We saved the equivalent of a full-time secretary salary using Lume CRM"
        </blockquote>

        {/* Attribution */}
        <p className="mt-6 text-sm font-semibold text-text-secondary">
          Vision Lavage
        </p>
      </motion.div>
    </section>
  );
}

/* ─── INDUSTRIES GRID ─── */
const SERVICES = [
  { name: 'HVAC', img: '/industries/hvac.png' },
  { name: 'Window Cleaning', img: '/industries/window.jpg' },
  { name: 'Excavation', img: '/industries/excavation.png' },
  { name: 'Landscaping', img: '/industries/landscaping.png' },
  { name: 'Power Washing', img: '/industries/powerwash.jpg' },
];

function IndustriesGrid() {
  return (
    <section className="py-20 md:py-28 px-6 bg-text-primary">
      <div className="max-w-7xl mx-auto">
        <motion.h2
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-3xl md:text-4xl lg:text-5xl font-bold tracking-tight leading-[1.1] text-white text-center mb-14"
        >
          Built for Home Service Business
        </motion.h2>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 md:gap-5">
          {SERVICES.map((service, i) => (
            <motion.div
              key={service.name}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-40px' }}
              transition={{ delay: i * 0.06 }}
              className="group relative rounded-xl overflow-hidden cursor-pointer"
            >
              <div className="aspect-[3/4] overflow-hidden">
                <img
                  src={service.img}
                  alt={service.name}
                  className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                  loading="lazy"
                />
              </div>
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent pointer-events-none" />
              <div className="absolute bottom-0 left-0 right-0 p-4">
                <h3 className="text-white text-base font-bold tracking-tight">
                  {service.name}
                </h3>
              </div>
            </motion.div>
          ))}
        </div>

        <div className="mt-10 text-center">
          <Link
            to="/industries"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-white/60 hover:text-white transition-colors"
          >
            See every industry <ArrowRight size={14} />
          </Link>
        </div>
      </div>
    </section>
  );
}


/* ─── FEATURE BLOCKS ─── */
function FeatureBlocks() {
  return (
    <section className="py-24 md:py-32 px-6 bg-text-primary">
      <div className="max-w-7xl mx-auto space-y-28 md:space-y-36">

        <motion.h2
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-3xl md:text-4xl lg:text-5xl font-extrabold tracking-tight leading-[1.1] text-center"
          style={{
            background: 'linear-gradient(180deg, #ffffff 0%, #3FAF97 60%, #6FD1B8 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
          }}
        >
          What sets Lume apart
          <svg className="mx-auto mt-3 w-48 md:w-64" height="10" viewBox="0 0 200 10" fill="none" preserveAspectRatio="none">
            <defs>
              <linearGradient id="waveGrad" x1="0" y1="0" x2="200" y2="0" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#ffffff" />
                <stop offset="50%" stopColor="#3FAF97" />
                <stop offset="100%" stopColor="#6FD1B8" />
              </linearGradient>
            </defs>
            <path d="M2 7C18 2 34 9 50 5S82 1 98 6S130 9 146 4S178 2 198 7" stroke="url(#waveGrad)" strokeWidth="2.5" strokeLinecap="round" fill="none" />
          </svg>
        </motion.h2>

        {/* Feature 0 — D2D Map: mockup left, text right */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          className="relative rounded-[28px] p-8 md:p-12 lg:p-14 overflow-hidden"
          style={{
            background: 'linear-gradient(180deg, #000000 0%, #0B0F0F 20%, #0F1F1C 40%, #12332C 55%, #1F5F4F 75%, #3FAF97 92%, #6FD1B8 100%)',
            boxShadow: '0 20px 60px rgba(0,0,0,0.6), 0 8px 24px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.04)',
          }}
        >
          <div className="absolute inset-0 pointer-events-none opacity-60" style={{ background: 'linear-gradient(120deg, transparent 20%, rgba(255,255,255,0.08) 45%, rgba(255,255,255,0.04) 55%, transparent 80%)' }} />
          <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(ellipse at 85% 10%, rgba(63,175,151,0.12) 0%, transparent 50%)' }} />
          <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(ellipse at 15% 90%, rgba(111,209,184,0.1) 0%, transparent 45%)' }} />
          <div className="absolute inset-0 rounded-[28px] pointer-events-none" style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), inset 1px 0 0 rgba(255,255,255,0.03)' }} />

          <div className="relative flex flex-col lg:flex-row items-center gap-10 lg:gap-16">
          {/* Mockup — D2D Map */}
          <div className="flex-1 w-full max-w-2xl">
            <div className="rounded-xl border-[6px] md:border-[8px] border-[#111] bg-[#111] overflow-hidden"
                 style={{ boxShadow: '0 10px 30px rgba(0,0,0,0.5), 0 4px 12px rgba(0,0,0,0.3)' }}>
              <div className="bg-white">
                <div className="aspect-[16/10]">
                  <div className="h-full flex">
                    {/* Sidebar */}
                    <div className="hidden md:flex w-44 bg-[#f8f8f8] border-r border-[#e8e8e8] flex-col p-3">
                      <div className="h-4 bg-[#e0e0e0] rounded w-16 mb-5" />
                      <div className="space-y-2.5 flex-1">
                        {['w-full', 'w-4/5', 'w-3/4', 'w-full', 'w-2/3', 'w-4/5'].map((w, i) => (
                          <div key={i} className={`h-3 rounded ${w} ${i === 3 ? 'bg-primary/15' : 'bg-[#ebebeb]'}`} />
                        ))}
                      </div>
                    </div>
                    {/* Main — Map view */}
                    <div className="flex-1 relative bg-[#e8f4e8]">
                      {/* Map grid */}
                      <div className="absolute inset-0 opacity-15" style={{
                        backgroundImage: 'linear-gradient(#999 1px, transparent 1px), linear-gradient(90deg, #999 1px, transparent 1px)',
                        backgroundSize: '32px 32px',
                      }} />
                      {/* Streets */}
                      <div className="absolute top-[30%] left-0 right-0 h-[3px] bg-[#d4d4d4]" />
                      <div className="absolute top-[60%] left-0 right-0 h-[3px] bg-[#d4d4d4]" />
                      <div className="absolute left-[25%] top-0 bottom-0 w-[3px] bg-[#d4d4d4]" />
                      <div className="absolute left-[55%] top-0 bottom-0 w-[3px] bg-[#d4d4d4]" />
                      <div className="absolute left-[80%] top-0 bottom-0 w-[2px] bg-[#d4d4d4]" />
                      {/* Territory zone */}
                      <div className="absolute top-[10%] left-[8%] w-[42%] h-[50%] border-2 border-primary/30 rounded-xl bg-primary/5" />
                      {/* Pins */}
                      {[
                        { x: '15%', y: '20%', color: 'bg-emerald-500' },
                        { x: '22%', y: '42%', color: 'bg-emerald-500' },
                        { x: '35%', y: '25%', color: 'bg-primary' },
                        { x: '30%', y: '50%', color: 'bg-amber-500' },
                        { x: '45%', y: '35%', color: 'bg-emerald-500' },
                        { x: '60%', y: '22%', color: 'bg-red-500' },
                        { x: '65%', y: '55%', color: 'bg-primary' },
                        { x: '72%', y: '40%', color: 'bg-emerald-500' },
                        { x: '55%', y: '70%', color: 'bg-amber-500' },
                        { x: '82%', y: '65%', color: 'bg-emerald-500' },
                        { x: '40%', y: '72%', color: 'bg-primary' },
                        { x: '18%', y: '68%', color: 'bg-emerald-500' },
                        { x: '88%', y: '30%', color: 'bg-red-500' },
                        { x: '75%', y: '78%', color: 'bg-amber-500' },
                      ].map((pin, i) => (
                        <div key={i} className="absolute" style={{ left: pin.x, top: pin.y }}>
                          <div className={`w-2.5 h-2.5 rounded-full ${pin.color} shadow-sm ring-2 ring-white`} />
                        </div>
                      ))}
                      {/* Rep avatar on map */}
                      <div className="absolute" style={{ left: '38%', top: '45%' }}>
                        <div className="w-7 h-7 rounded-full bg-primary ring-2 ring-white shadow-lg flex items-center justify-center">
                          <span className="text-[7px] font-bold text-white">MD</span>
                        </div>
                      </div>
                      {/* Legend */}
                      <div className="absolute bottom-2 right-2 bg-white/90 rounded-lg p-2 shadow-sm">
                        <div className="space-y-1">
                          {[
                            { color: 'bg-emerald-500', label: 'Sold' },
                            { color: 'bg-primary', label: 'Follow-up' },
                            { color: 'bg-amber-500', label: 'Not home' },
                            { color: 'bg-red-500', label: 'Not interested' },
                          ].map((item) => (
                            <div key={item.label} className="flex items-center gap-1.5">
                              <div className={`w-2 h-2 rounded-full ${item.color}`} />
                              <span className="text-[7px] text-[#555] font-medium">{item.label}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Text */}
          <div className="flex-1 text-center lg:text-left">
            <h2 className="text-3xl md:text-4xl lg:text-[2.75rem] font-extrabold tracking-tight leading-[1.1] text-white">
              Every D2D team's favorite feature
            </h2>
            <ul className="mt-6 space-y-3 max-w-xl mx-auto lg:mx-0">
              {['See every pin on the map', 'Track your sales reps location in real time', 'Assign territories for your knockers'].map((item) => (
                <li key={item} className="flex items-center gap-3 text-base font-bold text-white">
                  <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0" style={{ border: '2px solid #ffffff' }}>
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                      <path d="M3 8.5l3.5 3.5L13 5" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                  {item}
                </li>
              ))}
            </ul>
          </div>
          </div>
        </motion.div>

        {/* Feature 1 — Voice AI: text left, mockup right */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          className="relative rounded-[28px] p-8 md:p-12 lg:p-14 overflow-hidden"
          style={{
            background: 'linear-gradient(180deg, #000000 0%, #0B0F0F 20%, #0F1F1C 40%, #12332C 55%, #1F5F4F 75%, #3FAF97 92%, #6FD1B8 100%)',
            boxShadow: '0 20px 60px rgba(0,0,0,0.6), 0 8px 24px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.04)',
          }}
        >
          {/* Diagonal light band */}
          <div className="absolute inset-0 pointer-events-none opacity-60" style={{ background: 'linear-gradient(120deg, transparent 20%, rgba(255,255,255,0.08) 45%, rgba(255,255,255,0.04) 55%, transparent 80%)' }} />
          {/* Top-left ambient glow */}
          <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(ellipse at 15% 10%, rgba(63,175,151,0.12) 0%, transparent 50%)' }} />
          {/* Bottom-right warm glow */}
          <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(ellipse at 85% 90%, rgba(111,209,184,0.1) 0%, transparent 45%)' }} />
          {/* Subtle edge highlight */}
          <div className="absolute inset-0 rounded-[28px] pointer-events-none" style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), inset 1px 0 0 rgba(255,255,255,0.03)' }} />

          <div className="relative flex flex-col lg:flex-row items-center gap-10 lg:gap-16">
          {/* Text */}
          <div className="flex-1 text-center lg:text-left">
            <h2 className="text-3xl md:text-4xl lg:text-[2.75rem] font-extrabold tracking-tight leading-[1.1] text-white">
              Run your entire business by voice
            </h2>
            <ul className="mt-6 space-y-3 max-w-xl mx-auto lg:mx-0">
              {['Create jobs by voice', 'Send quotes instantly', 'Automated follow-ups', 'Zero manual data entry'].map((item) => (
                <li key={item} className="flex items-center gap-3 text-base font-bold text-white">
                  <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0" style={{ border: '2px solid #ffffff' }}>
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                      <path d="M3 8.5l3.5 3.5L13 5" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                  {item}
                </li>
              ))}
            </ul>
          </div>

          {/* Mockup — Voice CRM */}
          <div className="flex-1 w-full max-w-2xl">
            <div className="rounded-xl border-[6px] md:border-[8px] border-[#111] bg-[#111] overflow-hidden"
                 style={{ boxShadow: '0 10px 30px rgba(0,0,0,0.5), 0 4px 12px rgba(0,0,0,0.3)' }}>
              <div className="bg-white">
                <div className="aspect-[16/10]">
                  <div className="h-full flex">
                    {/* Sidebar */}
                    <div className="hidden md:flex w-44 bg-[#f8f8f8] border-r border-[#e8e8e8] flex-col p-3">
                      <div className="h-4 bg-[#e0e0e0] rounded w-16 mb-5" />
                      <div className="space-y-2.5 flex-1">
                        {['w-full', 'w-4/5', 'w-3/4', 'w-full', 'w-2/3', 'w-4/5'].map((w, i) => (
                          <div key={i} className={`h-3 rounded ${w} ${i === 2 ? 'bg-primary/15' : 'bg-[#ebebeb]'}`} />
                        ))}
                      </div>
                    </div>
                    {/* Main */}
                    <div className="flex-1 p-4 md:p-5 flex flex-col">
                      {/* Top bar */}
                      <div className="flex items-center justify-between mb-5">
                        <div className="h-4 bg-[#ebebeb] rounded w-28" />
                        <div className="flex gap-2">
                          <div className="w-7 h-7 rounded-full bg-[#ebebeb]" />
                        </div>
                      </div>

                      {/* Chat / voice conversation */}
                      <div className="flex-1 space-y-3">
                        {/* User voice bubble */}
                        <div className="flex items-start gap-2.5 justify-end">
                          <div className="bg-[#f0f0f0] rounded-xl rounded-tr-sm px-3.5 py-2.5 max-w-[75%]">
                            <div className="flex items-center gap-2 mb-1">
                              <div className="w-3 h-3 rounded-full bg-primary/30" />
                              <span className="text-[9px] font-semibold text-primary">Voice Input</span>
                            </div>
                            <p className="text-[11px] text-[#333] font-medium leading-snug">
                              "Create a quote for 123 Main Street, window cleaning, $350"
                            </p>
                          </div>
                        </div>

                        {/* AI response */}
                        <div className="flex items-start gap-2.5">
                          <div className="w-6 h-6 rounded-full bg-text-primary flex items-center justify-center shrink-0">
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round">
                              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                              <line x1="12" y1="19" x2="12" y2="22" />
                            </svg>
                          </div>
                          <div className="bg-text-primary rounded-xl rounded-tl-sm px-3.5 py-2.5 max-w-[75%]">
                            <p className="text-[11px] text-white font-medium leading-snug mb-2">
                              Quote created successfully
                            </p>
                            <div className="space-y-1 text-[9px] text-white/60">
                              <p>Client: 123 Main Street</p>
                              <p>Service: Window Cleaning</p>
                              <p>Amount: $350.00</p>
                              <p>Status: Draft — Ready to send</p>
                            </div>
                          </div>
                        </div>

                        {/* AI follow-up */}
                        <div className="flex items-start gap-2.5">
                          <div className="w-6 h-6" />
                          <div className="bg-primary/10 border border-primary/20 rounded-xl rounded-tl-sm px-3.5 py-2 max-w-[70%]">
                            <p className="text-[10px] text-primary font-medium">
                              Want me to send this quote to the client now?
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Voice input bar */}
                      <div className="mt-4 flex items-center gap-2 bg-[#f5f5f5] rounded-xl px-3.5 py-2.5 border border-[#e5e5e5]">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="2" strokeLinecap="round">
                          <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                          <line x1="12" y1="19" x2="12" y2="22" />
                        </svg>
                        <span className="text-[10px] text-[#aaa] flex-1">Speak a command or type here...</span>
                        <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center">
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round">
                            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                          </svg>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          </div>
        </motion.div>

        {/* Feature 2 — Pipeline: mockup left, text right */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          className="relative rounded-[28px] p-8 md:p-12 lg:p-14 overflow-hidden"
          style={{
            background: 'linear-gradient(180deg, #000000 0%, #0B0F0F 20%, #0F1F1C 40%, #12332C 55%, #1F5F4F 75%, #3FAF97 92%, #6FD1B8 100%)',
            boxShadow: '0 20px 60px rgba(0,0,0,0.6), 0 8px 24px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.04)',
          }}
        >
          {/* Diagonal light band */}
          <div className="absolute inset-0 pointer-events-none opacity-60" style={{ background: 'linear-gradient(120deg, transparent 20%, rgba(255,255,255,0.08) 45%, rgba(255,255,255,0.04) 55%, transparent 80%)' }} />
          {/* Top-right ambient glow */}
          <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(ellipse at 85% 10%, rgba(63,175,151,0.12) 0%, transparent 50%)' }} />
          {/* Bottom-left warm glow */}
          <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(ellipse at 15% 90%, rgba(111,209,184,0.1) 0%, transparent 45%)' }} />
          {/* Subtle edge highlight */}
          <div className="absolute inset-0 rounded-[28px] pointer-events-none" style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), inset 1px 0 0 rgba(255,255,255,0.03)' }} />

          <div className="relative flex flex-col lg:flex-row-reverse items-center gap-10 lg:gap-16">
          {/* Text */}
          <div className="flex-1 text-center lg:text-left">
            <h2 className="text-3xl md:text-4xl lg:text-[2.75rem] font-extrabold tracking-tight leading-[1.1] text-white">
              Still managing your sales in spreadsheets?
            </h2>
            <ul className="mt-6 space-y-3 max-w-xl mx-auto lg:mx-0">
              {['Real-time KPI tracking', 'Visual sales pipeline', 'Automated follow-ups'].map((item) => (
                <li key={item} className="flex items-center gap-3 text-base font-bold text-white">
                  <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0" style={{ border: '2px solid #ffffff' }}>
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                      <path d="M3 8.5l3.5 3.5L13 5" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                  {item}
                </li>
              ))}
            </ul>
          </div>

          {/* Mockup — Pipeline / KPI Dashboard */}
          <div className="flex-1 w-full max-w-2xl">
            <div className="rounded-xl border-[6px] md:border-[8px] border-[#111] bg-[#111] overflow-hidden"
                 style={{ boxShadow: '0 10px 30px rgba(0,0,0,0.5), 0 4px 12px rgba(0,0,0,0.3)' }}>
              <div className="bg-white">
                <div className="aspect-[16/10]">
                  <div className="h-full flex">
                    {/* Sidebar */}
                    <div className="hidden md:flex w-44 bg-[#f8f8f8] border-r border-[#e8e8e8] flex-col p-3">
                      <div className="h-4 bg-[#e0e0e0] rounded w-16 mb-5" />
                      <div className="space-y-2.5 flex-1">
                        {['w-full', 'w-4/5', 'w-3/4', 'w-full', 'w-2/3', 'w-4/5'].map((w, i) => (
                          <div key={i} className={`h-3 rounded ${w} ${i === 0 ? 'bg-primary/15' : 'bg-[#ebebeb]'}`} />
                        ))}
                      </div>
                    </div>
                    {/* Main */}
                    <div className="flex-1 p-4 md:p-5">
                      {/* Top bar */}
                      <div className="flex items-center justify-between mb-4">
                        <div className="text-[10px] font-bold text-[#333]">Sales Pipeline</div>
                        <div className="flex gap-1.5">
                          {['Day', 'Week', 'Month'].map((t, i) => (
                            <button key={t} className={`px-2 py-0.5 rounded text-[8px] font-medium ${i === 2 ? 'bg-text-primary text-white' : 'text-[#999] bg-[#f0f0f0]'}`}>{t}</button>
                          ))}
                        </div>
                      </div>

                      {/* KPI row */}
                      <div className="grid grid-cols-4 gap-2 mb-4">
                        {[
                          { label: 'Revenue', value: '$127K', change: '+18%', color: 'text-success' },
                          { label: 'Deals Won', value: '34', change: '+12%', color: 'text-success' },
                          { label: 'Conversion', value: '62%', change: '+5%', color: 'text-success' },
                          { label: 'Avg Deal', value: '$3.7K', change: '+8%', color: 'text-success' },
                        ].map((kpi, i) => (
                          <div key={i} className="p-2 rounded-lg border border-[#eaeaea] bg-white">
                            <div className="text-[7px] text-[#999] uppercase tracking-wide font-medium">{kpi.label}</div>
                            <div className="text-sm font-bold text-[#1a1a1a] mt-0.5">{kpi.value}</div>
                            <div className={`text-[8px] font-medium ${kpi.color}`}>{kpi.change}</div>
                          </div>
                        ))}
                      </div>

                      {/* Pipeline columns */}
                      <div className="flex gap-2 flex-1">
                        {[
                          { title: 'New Lead', count: 12, cards: 4, color: 'bg-blue-500' },
                          { title: 'Contacted', count: 8, cards: 3, color: 'bg-amber-500' },
                          { title: 'Quote Sent', count: 6, cards: 3, color: 'bg-purple-500' },
                          { title: 'Won', count: 4, cards: 2, color: 'bg-[#3FAF97]' },
                        ].map((col, ci) => (
                          <div key={ci} className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 mb-2">
                              <div className={`w-1.5 h-1.5 rounded-full ${col.color}`} />
                              <span className="text-[8px] font-semibold text-[#555] truncate">{col.title}</span>
                              <span className="text-[7px] text-[#bbb] font-medium">{col.count}</span>
                            </div>
                            <div className="space-y-1.5">
                              {[...Array(col.cards)].map((_, j) => (
                                <div key={j} className="p-1.5 rounded-md border border-[#eee] bg-[#fafafa]">
                                  <div className="h-2 bg-[#e5e5e5] rounded w-4/5 mb-1" />
                                  <div className="h-1.5 bg-[#eee] rounded w-3/5" />
                                  <div className="flex items-center gap-1 mt-1.5">
                                    <div className="w-3 h-3 rounded-full bg-[#e0e0e0]" />
                                    <div className="h-1.5 bg-[#eee] rounded w-8" />
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          </div>
        </motion.div>

      </div>
    </section>
  );
}

/* ─── PAGE ─── */
export default function Home() {
  return (
    <>
      <Hero />
      <TrustSection />
      <Testimonial />
      <IndustriesGrid />
      <FeatureBlocks />
    </>
  );
}
