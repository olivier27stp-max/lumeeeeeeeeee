import { useParams, Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { ArrowRight } from 'lucide-react';

const INDUSTRY_DATA: Record<string, { name: string; img: string; description: string }> = {
  'hvac': {
    name: 'HVAC',
    img: '/industries/hvac.png',
    description: 'Manage your heating and cooling jobs from lead to invoice. Lume helps HVAC companies streamline scheduling, dispatch technicians, and keep customers coming back season after season.',
  },
  'window-cleaning': {
    name: 'Window Cleaning',
    img: '/industries/window.jpg',
    description: 'Run your routes, manage recurring clients, and send quotes in seconds. Lume is built for window cleaners who want to spend less time on admin and more time on the job.',
  },
  'roofing': {
    name: 'Roofing',
    img: '/industries/roofing.png',
    description: 'From inspection to final payment, manage every roofing project with clarity. Lume handles your long sales cycles, multi-crew coordination, and detailed estimates all in one place.',
  },
  'paver': {
    name: 'Paver',
    img: '/industries/paver.png',
    description: 'Structure your season and maximize every lead. Lume gives paving companies the tools to prioritize high-value jobs, dispatch crews by zone, and close more deals.',
  },
  'power-washing': {
    name: 'Power Washing',
    img: '/industries/powerwash.jpg',
    description: 'From first contact to five-star review — everything is covered. Lume helps pressure washing businesses manage residential and commercial leads, send fast quotes, and build a strong online reputation.',
  },
  'led-lighting': {
    name: 'LED Lighting',
    img: '/industries/leds.png',
    description: 'Light up your business operations. Lume helps LED lighting installers manage projects, track leads, and automate follow-ups so you can focus on delivering stunning results.',
  },
  'lawn-care': {
    name: 'Lawn Care',
    img: '/industries/lawncare.png',
    description: 'Keep your routes tight and your clients happy. Lume helps lawn care businesses manage recurring schedules, optimize routes, and grow through automated review requests.',
  },
  'landscaping': {
    name: 'Landscaping',
    img: '/industries/landscaping.png',
    description: 'From design proposals to project completion, manage your landscaping business end to end. Lume handles quoting, scheduling, crew dispatch, and client communication seamlessly.',
  },
  'painting': {
    name: 'Painting',
    img: '/industries/painting.png',
    description: 'Estimate faster, schedule smarter, and get paid on time. Lume gives painting contractors the tools to manage jobs from quote to completion without the paperwork headache.',
  },
  'fencing': {
    name: 'Fencing',
    img: '/industries/fencing.png',
    description: 'From door knocking to installation day — one continuous flow. Lume powers your field sales with D2D mapping, leaderboards, and a pipeline that tracks every deal to close.',
  },
  'auto-detailing': {
    name: 'Auto Detailing',
    img: '/industries/detailing.png',
    description: 'Manage appointments, packages, and client loyalty effortlessly. Lume helps auto detailing businesses book more jobs, send reminders, and build a five-star reputation.',
  },
  'pest-control': {
    name: 'Pest Control',
    img: '/industries/pestcontrol.png',
    description: 'Stay on top of recurring treatments and new leads. Lume helps pest control businesses manage seasonal demand, automate follow-ups, and keep customers on a regular service schedule.',
  },
  'plumbing': {
    name: 'Plumbing',
    img: '/industries/plumbing.png',
    description: 'Dispatch the right plumber to the right job, every time. Lume helps plumbing companies manage emergency calls, scheduled maintenance, and invoicing from one platform.',
  },
  'electrician': {
    name: 'Electrician',
    img: '/industries/electrician.png',
    description: 'Wire your business for growth. Lume helps electrical contractors manage leads, schedule jobs, track crew performance, and send professional quotes that win more work.',
  },
  'cleaning': {
    name: 'Cleaning',
    img: '/industries/cleaning.png',
    description: 'Keep your cleaning business spotless from the inside out. Lume manages your recurring clients, team schedules, and billing so you can scale without the chaos.',
  },
  'junk-removal': {
    name: 'Junk Removal',
    img: '/industries/junkremoval.png',
    description: 'Turn every pickup into a five-star experience. Lume helps junk removal companies manage bookings, optimize routes, and follow up with customers automatically.',
  },
  'construction': {
    name: 'Construction',
    img: '/industries/construction.png',
    description: 'Manage crews, timelines, and budgets with confidence. Lume gives construction companies a clear pipeline from bid to completion with real-time visibility on every project.',
  },
  'renovation': {
    name: 'Renovation',
    img: '/industries/renovation.png',
    description: 'From estimate to final walkthrough — manage every renovation with clarity. Lume handles multi-phase projects, client communication, and subcontractor coordination all in one place.',
  },
  'pool-maintenance': {
    name: 'Pool Maintenance',
    img: '/industries/pool.png',
    description: 'Keep pools clean and clients happy year-round. Lume helps pool maintenance companies manage recurring routes, seasonal demand, and automated service reminders.',
  },
  'excavation': {
    name: 'Excavation',
    img: '/industries/excavation.png',
    description: 'Dig into better operations. Lume helps excavation companies manage project pipelines, coordinate heavy equipment scheduling, and track leads from first call to job completion.',
  },
};

export default function IndustryDetail() {
  const { slug } = useParams();
  const industry = slug ? INDUSTRY_DATA[slug] : null;

  if (!industry) {
    return (
      <div className="pt-36 pb-20 px-6 text-center" style={{ backgroundColor: '#fafaf8', backgroundImage: 'url("/paper-texture.png")', backgroundRepeat: 'repeat', backgroundSize: '300px 300px' }}>
        <h1 className="text-3xl font-extrabold text-[#111]">Industry not found</h1>
        <Link to="/industries" className="mt-4 inline-block text-sm text-[#3FAF97] font-medium">Back to Industries</Link>
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
              alt={industry.name}
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
            <p className="text-[11px] uppercase tracking-[0.2em] font-semibold text-[#1F5F4F] mb-3">Industry</p>
            <h1 className="text-4xl md:text-5xl font-extrabold tracking-[-0.03em] leading-[1.08] text-[#111]">
              {industry.name}
            </h1>
            <p className="mt-5 text-lg text-text-secondary leading-relaxed">
              {industry.description}
            </p>
            <Link
              to="/pricing"
              className="mt-8 inline-flex items-center gap-2 px-8 py-3.5 rounded-xl text-sm font-bold text-white transition-opacity hover:opacity-90 group"
              style={{ background: 'linear-gradient(135deg, #3FAF97 0%, #1F5F4F 100%)' }}
            >
              Start Now
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
                The entire system,<br />right in your pocket.
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
                <div className="text-[10px] md:text-xs font-bold text-[#1a1a1a]">Dashboard</div>
                <div className="w-5 h-5 md:w-6 md:h-6 rounded-full bg-primary/10 flex items-center justify-center">
                  <div className="w-2.5 h-2.5 rounded-full bg-primary/30" />
                </div>
              </div>
              <div className="p-2.5 md:p-3 rounded-xl bg-[#f7f7f7] border border-[#eaeaea] mb-3">
                <div className="text-[7px] md:text-[8px] text-[#999] uppercase tracking-wide font-medium">Today</div>
                <div className="text-sm md:text-base font-bold text-[#1a1a1a] mt-1">3 Jobs</div>
                <div className="mt-2 h-1.5 bg-[#e5e5e5] rounded-full overflow-hidden">
                  <div className="h-full bg-primary rounded-full w-2/3" />
                </div>
              </div>
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
              <div className="absolute bottom-2 md:bottom-3 left-3 md:left-4 right-3 md:right-4">
                <div className="flex items-center justify-around py-1.5 md:py-2">
                  {['Home', 'Map', 'Jobs', 'More'].map((label, i) => (
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
