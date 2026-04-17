import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import {
  ArrowRight, Check,
  Kanban, FileText, Map, Trophy, Mic, BellRing,
  Star, Calendar, Zap, CreditCard,
} from 'lucide-react';

const FEATURES = [
  {
    id: 'ai-voice',
    icon: Mic,
    title: 'AI Voice Assistant',
    subtitle: 'Speak. Lume acts.',
    bullets: ['Create leads by voice', 'Send quotes instantly', 'Smart daily summaries', 'Hands-free productivity'],
  },
  {
    id: 'pipeline',
    icon: Kanban,
    title: 'Visual Pipeline',
    subtitle: 'Never lose a lead again',
    bullets: ['Drag-and-drop Kanban board', 'Filter by stage or assignee', 'Complete lead history', 'Bulk actions'],
  },
  {
    id: 'request-form',
    icon: FileText,
    title: 'Request Forms',
    subtitle: 'Capture leads 24/7',
    bullets: ['Embeddable web form', 'Auto-creates leads in pipeline', 'Instant notifications', 'Custom fields and branding'],
  },
  {
    id: 'd2d-map',
    icon: Map,
    title: 'D2D Map',
    subtitle: 'Your territory, mastered',
    bullets: ['Color-coded pins by status', 'Real-time GPS tracking', 'Assignable territory zones', 'Offline mode'],
  },
  {
    id: 'leaderboard',
    icon: Trophy,
    title: 'Leaderboard',
    subtitle: 'Performance becomes a game',
    bullets: ['Real-time rankings', 'Badges and achievements', 'Daily challenges', 'Team comparisons'],
  },
  {
    id: 'notifications',
    icon: BellRing,
    title: 'Quote Notifications',
    subtitle: 'Follow up at the right time',
    bullets: ['Know when quotes are opened', 'Auto reminders', 'View count tracking', 'Push and email alerts'],
  },
  {
    id: 'reviews',
    icon: Star,
    title: 'Google Reviews',
    subtitle: 'Build reputation on autopilot',
    bullets: ['Auto review requests post-service', 'Satisfaction filter', 'Track reviews generated', 'Direct Google integration'],
  },
  {
    id: 'scheduling',
    icon: Calendar,
    title: 'Scheduling & Dispatch',
    subtitle: 'Centralized team scheduling',
    bullets: ['Day / week / month views', 'Job assignment', 'Conflict detection', 'Google Calendar sync'],
  },
  {
    id: 'automation',
    icon: Zap,
    title: 'Automations',
    subtitle: 'Eliminate repetitive work',
    bullets: ['No-code workflows', 'Auto follow-ups', 'Status-based triggers', 'Quote reminders'],
  },
  {
    id: 'payments',
    icon: CreditCard,
    title: 'Lume Payments',
    subtitle: 'Get paid faster, every time',
    bullets: ['Accept cards on-site or online', 'Auto-invoice after job completion', 'Payment tracking per client'],
  },
];

function FeatureMockup({ id }: { id: string }) {
  const shell = (children: React.ReactNode) => (
    <div className="rounded-lg border border-white/10 overflow-hidden bg-[#111]" style={{ boxShadow: '0 4px 16px rgba(0,0,0,0.4)' }}>
      <div className="bg-white aspect-[16/9]">
        <div className="h-full flex">{children}</div>
      </div>
    </div>
  );

  const sidebar = (active: number) => (
    <div className="hidden sm:flex w-28 bg-[#f8f8f8] border-r border-[#e8e8e8] flex-col p-2">
      <div className="h-3 bg-[#e0e0e0] rounded w-12 mb-4" />
      <div className="space-y-2">
        {[...Array(6)].map((_, i) => (
          <div key={i} className={`h-2.5 rounded w-${i === active ? 'full' : '4/5'} ${i === active ? 'bg-primary/15' : 'bg-[#ebebeb]'}`} />
        ))}
      </div>
    </div>
  );

  const mockups: Record<string, React.ReactNode> = {
    'ai-voice': shell(
      <>{sidebar(4)}
        <div className="flex-1 p-3 flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <div className="h-3 bg-[#ebebeb] rounded w-20" />
            <div className="w-5 h-5 rounded-full bg-[#ebebeb]" />
          </div>
          <div className="flex-1 space-y-2">
            <div className="flex justify-end"><div className="bg-[#f0f0f0] rounded-lg rounded-tr-sm px-2.5 py-1.5 max-w-[70%]"><div className="flex items-center gap-1 mb-0.5"><div className="w-2 h-2 rounded-full bg-primary/30" /><span className="text-[7px] font-semibold text-primary">Voice</span></div><p className="text-[8px] text-[#333]">"Quote for 123 Main St, $350"</p></div></div>
            <div className="flex gap-1.5"><div className="w-4 h-4 rounded-full bg-[#1a1a1a] shrink-0" /><div className="bg-[#1a1a1a] rounded-lg rounded-tl-sm px-2.5 py-1.5 max-w-[70%]"><p className="text-[8px] text-white font-medium mb-1">Quote created</p><div className="text-[7px] text-white/50 space-y-0.5"><p>$350.00 — Window Cleaning</p><p>Status: Draft</p></div></div></div>
            <div className="flex gap-1.5"><div className="w-4 h-4" /><div className="bg-primary/10 border border-primary/20 rounded-lg px-2.5 py-1"><p className="text-[7px] text-primary">Send to client?</p></div></div>
          </div>
          <div className="flex items-center gap-1.5 bg-[#f5f5f5] rounded-lg px-2.5 py-1.5 border border-[#e5e5e5] mt-2">
            <div className="w-4 h-4 rounded-full bg-primary" />
            <span className="text-[7px] text-[#aaa] flex-1">Speak a command...</span>
          </div>
        </div>
      </>
    ),
    'pipeline': shell(
      <>{sidebar(0)}
        <div className="flex-1 p-3">
          <div className="h-3 bg-[#ebebeb] rounded w-24 mb-3" />
          <div className="flex gap-1.5 h-[calc(100%-20px)]">
            {[{t:'New',n:3,c:'bg-blue-500'},{t:'Contact',n:2,c:'bg-amber-500'},{t:'Quote',n:2,c:'bg-purple-500'},{t:'Won',n:1,c:'bg-emerald-500'}].map((col,ci) => (
              <div key={ci} className="flex-1 min-w-0">
                <div className="flex items-center gap-1 mb-1.5"><div className={`w-1.5 h-1.5 rounded-full ${col.c}`} /><span className="text-[6px] font-semibold text-[#555]">{col.t}</span></div>
                <div className="space-y-1">
                  {[...Array(col.n)].map((_,j) => (
                    <div key={j} className="p-1.5 rounded border border-[#eee] bg-[#fafafa]">
                      <div className="h-1.5 bg-[#e5e5e5] rounded w-4/5 mb-1" />
                      <div className="h-1 bg-[#eee] rounded w-3/5" />
                      <div className="flex items-center gap-0.5 mt-1"><div className="w-2.5 h-2.5 rounded-full bg-[#e0e0e0]" /><div className="h-1 bg-[#eee] rounded w-6" /></div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </>
    ),
    'request-form': shell(
      <>{sidebar(1)}
        <div className="flex-1 p-3">
          <div className="h-3 bg-[#ebebeb] rounded w-28 mb-3" />
          <div className="max-w-[65%] space-y-2">
            {['Name', 'Email', 'Phone', 'Service'].map((label) => (
              <div key={label}><div className="text-[6px] text-[#999] mb-0.5">{label}</div><div className="h-5 bg-[#f5f5f5] rounded border border-[#e5e5e5]" /></div>
            ))}
            <div><div className="text-[6px] text-[#999] mb-0.5">Message</div><div className="h-10 bg-[#f5f5f5] rounded border border-[#e5e5e5]" /></div>
            <div className="h-5 bg-primary rounded w-20 mt-1" />
          </div>
        </div>
      </>
    ),
    'd2d-map': shell(
      <>{sidebar(3)}
        <div className="flex-1 relative bg-[#e8f4e8]">
          <div className="absolute inset-0 opacity-15" style={{backgroundImage:'linear-gradient(#999 1px,transparent 1px),linear-gradient(90deg,#999 1px,transparent 1px)',backgroundSize:'24px 24px'}} />
          <div className="absolute top-[10%] left-[8%] w-[35%] h-[40%] border border-primary/30 rounded-lg bg-primary/5" />
          {[{x:'15%',y:'20%',c:'bg-emerald-500'},{x:'30%',y:'35%',c:'bg-primary'},{x:'45%',y:'25%',c:'bg-amber-500'},{x:'60%',y:'50%',c:'bg-emerald-500'},{x:'25%',y:'55%',c:'bg-red-500'},{x:'70%',y:'35%',c:'bg-emerald-500'},{x:'50%',y:'70%',c:'bg-primary'},{x:'80%',y:'60%',c:'bg-amber-500'}].map((p,i) => (
            <div key={i} className="absolute" style={{left:p.x,top:p.y}}><div className={`w-2 h-2 rounded-full ${p.c} ring-1 ring-white`} /></div>
          ))}
          <div className="absolute" style={{left:'32%',top:'40%'}}><div className="w-5 h-5 rounded-full bg-primary ring-2 ring-white shadow flex items-center justify-center"><span className="text-[5px] font-bold text-white">MD</span></div></div>
        </div>
      </>
    ),
    'leaderboard': shell(
      <>{sidebar(2)}
        <div className="flex-1 p-3">
          <div className="flex items-center justify-between mb-3">
            <div className="text-[7px] font-bold text-[#333]">Leaderboard</div>
            <div className="flex gap-1">{['D','W','M'].map((t,i) => (<div key={t} className={`px-1.5 py-0.5 rounded text-[6px] font-medium ${i===1?'bg-[#1a1a1a] text-white':'text-[#999]'}`}>{t}</div>))}</div>
          </div>
          {[{n:'Marc D.',s:'14 sales',r:1},{n:'Sophie L.',s:'12 sales',r:2},{n:'Antoine R.',s:'9 sales',r:3},{n:'Julie M.',s:'7 sales',r:4},{n:'Phil K.',s:'5 sales',r:5}].map((rep) => (
            <div key={rep.n} className="flex items-center gap-2 py-1.5 border-t border-[#f0f0f0]">
              <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[6px] font-bold ${rep.r===1?'bg-yellow-100 text-yellow-700':rep.r===2?'bg-gray-100 text-gray-600':rep.r===3?'bg-orange-100 text-orange-700':'bg-[#f5f5f5] text-[#aaa]'}`}>{rep.r}</span>
              <div className="w-4 h-4 rounded-full bg-[#e5e5e5]" />
              <span className="text-[7px] font-medium text-[#1a1a1a] flex-1">{rep.n}</span>
              <span className="text-[7px] font-semibold text-[#1a1a1a]">{rep.s}</span>
            </div>
          ))}
        </div>
      </>
    ),
    'notifications': shell(
      <>{sidebar(5)}
        <div className="flex-1 p-3">
          <div className="h-3 bg-[#ebebeb] rounded w-28 mb-3" />
          <div className="space-y-2">
            {[{t:'Quote #1042 opened',d:'John Smith — 2 min ago',s:'bg-emerald-500'},{t:'Quote #1038 viewed 3x',d:'Maria Johnson — 1h ago',s:'bg-primary'},{t:'Reminder: Follow up #1035',d:'Robert Davis — overdue',s:'bg-amber-500'},{t:'Quote #1031 expired',d:'Lisa Chen — 3 days ago',s:'bg-red-500'}].map((n) => (
              <div key={n.t} className="flex items-start gap-2 p-2 rounded-lg bg-[#fafafa] border border-[#eee]">
                <div className={`w-2 h-2 rounded-full ${n.s} mt-1 shrink-0`} />
                <div><div className="text-[7px] font-semibold text-[#1a1a1a]">{n.t}</div><div className="text-[6px] text-[#999]">{n.d}</div></div>
              </div>
            ))}
          </div>
        </div>
      </>
    ),
    'reviews': shell(
      <>{sidebar(5)}
        <div className="flex-1 p-3">
          <div className="h-3 bg-[#ebebeb] rounded w-24 mb-3" />
          <div className="flex gap-2 mb-3">
            {[{l:'Avg Rating',v:'4.8',c:''},{l:'Total',v:'127',c:''},{l:'This Month',v:'+12',c:'text-emerald-600'}].map((s) => (
              <div key={s.l} className="flex-1 p-2 rounded-lg border border-[#eee]"><div className="text-[6px] text-[#999]">{s.l}</div><div className={`text-[10px] font-bold text-[#1a1a1a] ${s.c}`}>{s.v}</div></div>
            ))}
          </div>
          <div className="space-y-1.5">
            {[{n:'J. Smith',r:5,t:'Excellent service!'},{n:'M. Johnson',r:5,t:'Very professional'},{n:'R. Davis',r:4,t:'Good work, on time'}].map((rev) => (
              <div key={rev.n} className="flex items-start gap-2 p-1.5 rounded-lg bg-[#fafafa] border border-[#eee]">
                <div className="w-4 h-4 rounded-full bg-[#e5e5e5] shrink-0" />
                <div><div className="text-[7px] font-semibold text-[#1a1a1a]">{rev.n}</div><div className="flex gap-0.5">{[...Array(rev.r)].map((_,i)=>(<span key={i} className="text-[6px] text-amber-400">★</span>))}</div><div className="text-[6px] text-[#999]">{rev.t}</div></div>
              </div>
            ))}
          </div>
        </div>
      </>
    ),
    'scheduling': shell(
      <>{sidebar(3)}
        <div className="flex-1 p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[7px] font-bold text-[#333]">April 2026</div>
            <div className="flex gap-1">{['Day','Week','Month'].map((t,i) => (<div key={t} className={`px-1.5 py-0.5 rounded text-[6px] font-medium ${i===0?'bg-[#1a1a1a] text-white':'text-[#999]'}`}>{t}</div>))}</div>
          </div>
          <div className="space-y-1">
            {['8:00','9:00','10:00','11:00','12:00','1:00','2:00','3:00'].map((time,i) => (
              <div key={time} className="flex items-stretch gap-1.5">
                <span className="text-[6px] text-[#999] w-6 pt-0.5">{time}</span>
                <div className="flex-1 border-t border-[#f0f0f0] min-h-[12px] relative">
                  {i===1 && <div className="absolute inset-x-0 top-0 h-[20px] bg-primary/10 border-l-2 border-primary rounded-r px-1"><span className="text-[5px] font-medium text-primary">J. Smith — Window cleaning</span></div>}
                  {i===3 && <div className="absolute inset-x-0 top-0 h-[20px] bg-emerald-50 border-l-2 border-emerald-500 rounded-r px-1"><span className="text-[5px] font-medium text-emerald-700">M. Johnson — Pressure wash</span></div>}
                  {i===5 && <div className="absolute inset-x-0 top-0 h-[20px] bg-amber-50 border-l-2 border-amber-500 rounded-r px-1"><span className="text-[5px] font-medium text-amber-700">R. Davis — Gutter cleaning</span></div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </>
    ),
    'automation': shell(
      <>{sidebar(4)}
        <div className="flex-1 p-3">
          <div className="h-3 bg-[#ebebeb] rounded w-24 mb-3" />
          <div className="flex flex-col items-center gap-1.5 py-2">
            <div className="px-3 py-1.5 rounded-lg bg-primary/10 border border-primary/20 text-[7px] font-semibold text-primary">New Lead Created</div>
            <div className="w-px h-4 bg-[#ddd]" />
            <div className="px-3 py-1.5 rounded-lg bg-[#f5f5f5] border border-[#e5e5e5] text-[7px] text-[#555]">Wait 2 hours</div>
            <div className="w-px h-4 bg-[#ddd]" />
            <div className="px-3 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200 text-[7px] text-emerald-700">Send welcome email</div>
            <div className="w-px h-4 bg-[#ddd]" />
            <div className="px-3 py-1.5 rounded-lg bg-[#f5f5f5] border border-[#e5e5e5] text-[7px] text-[#555]">Wait 24 hours</div>
            <div className="w-px h-4 bg-[#ddd]" />
            <div className="px-3 py-1.5 rounded-lg bg-amber-50 border border-amber-200 text-[7px] text-amber-700">Send follow-up SMS</div>
          </div>
        </div>
      </>
    ),
    'payments': shell(
      <>{sidebar(5)}
        <div className="flex-1 p-3">
          <div className="h-3 bg-[#ebebeb] rounded w-24 mb-3" />
          <div className="flex gap-2 mb-3">
            {[{l:'Collected',v:'$24,800'},{l:'Pending',v:'$3,200'},{l:'Overdue',v:'$850'}].map((s) => (
              <div key={s.l} className="flex-1 p-2 rounded-lg border border-[#eee]"><div className="text-[6px] text-[#999]">{s.l}</div><div className="text-[10px] font-bold text-[#1a1a1a]">{s.v}</div></div>
            ))}
          </div>
          <div className="space-y-1.5">
            {[{n:'INV-1042',c:'J. Smith',a:'$350',s:'Paid',sc:'text-emerald-600 bg-emerald-50'},{n:'INV-1041',c:'M. Johnson',a:'$780',s:'Pending',sc:'text-amber-600 bg-amber-50'},{n:'INV-1040',c:'R. Davis',a:'$1,200',s:'Paid',sc:'text-emerald-600 bg-emerald-50'},{n:'INV-1039',c:'L. Chen',a:'$450',s:'Overdue',sc:'text-red-600 bg-red-50'}].map((inv) => (
              <div key={inv.n} className="flex items-center gap-2 p-1.5 rounded-lg bg-[#fafafa] border border-[#eee]">
                <div className="text-[7px] font-semibold text-[#1a1a1a] w-14">{inv.n}</div>
                <div className="text-[7px] text-[#666] flex-1">{inv.c}</div>
                <div className="text-[7px] font-bold text-[#1a1a1a]">{inv.a}</div>
                <span className={`text-[6px] font-medium px-1.5 py-0.5 rounded ${inv.sc}`}>{inv.s}</span>
              </div>
            ))}
          </div>
        </div>
      </>
    ),
  };

  return mockups[id] || null;
}

export default function Features() {
  return (
    <div className="min-h-screen">
      {/* Hero */}
      <section className="pt-28 pb-12 md:pt-36 md:pb-16 px-6" style={{ backgroundColor: '#fafaf8', backgroundImage: 'url("/paper-texture.png")', backgroundRepeat: 'repeat', backgroundSize: '300px 300px' }}>
        <div className="max-w-4xl mx-auto text-center">
          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-[11px] uppercase tracking-[0.2em] font-semibold text-[#1F5F4F] mb-4"
          >
            Features
          </motion.p>
          <motion.h1
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="text-4xl md:text-5xl lg:text-6xl font-extrabold tracking-[-0.03em] leading-[1.08] text-text-primary"
          >
            One platform.
            <br />
            Every tool your business needs.
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="mt-5 text-lg font-normal text-text-tertiary max-w-2xl mx-auto leading-relaxed"
          >
            From lead capture to 5-star reviews — manage sales, operations, scheduling, automation, and team performance in one place.
          </motion.p>
        </div>
      </section>

      {/* Quick Nav */}
      <section className="px-6 pb-12" style={{ backgroundColor: '#fafaf8', backgroundImage: 'url("/paper-texture.png")', backgroundRepeat: 'repeat', backgroundSize: '300px 300px' }}>
        <div className="max-w-5xl mx-auto">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.25 }}
            className="flex flex-wrap justify-center gap-2"
          >
            {FEATURES.map(f => (
              <a
                key={f.id}
                href={`#${f.id}`}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-text-secondary hover:text-text-primary hover:bg-surface-tertiary border border-outline transition-colors"
              >
                <f.icon size={12} />
                {f.title}
              </a>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Feature Cards */}
      <section className="px-6 py-24 md:py-32 bg-text-primary">
        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-6 md:gap-8">
          {FEATURES.map((feature, i) => (
            <motion.div
              key={feature.id}
              id={feature.id}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-60px' }}
              transition={{ delay: i % 2 === 0 ? 0 : 0.1 }}
              className="relative rounded-[28px] p-8 md:p-12 lg:p-14 overflow-hidden h-full"
              style={{
                background: 'linear-gradient(180deg, #000000 0%, #0B0F0F 20%, #0F1F1C 40%, #12332C 55%, #1F5F4F 75%, #3FAF97 92%, #6FD1B8 100%)',
                boxShadow: '0 20px 60px rgba(0,0,0,0.6), 0 8px 24px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.04)',
              }}
            >
              {/* Light effects */}
              <div className="absolute inset-0 pointer-events-none opacity-60" style={{ background: 'linear-gradient(120deg, transparent 20%, rgba(255,255,255,0.08) 45%, rgba(255,255,255,0.04) 55%, transparent 80%)' }} />
              <div className="absolute inset-0 pointer-events-none" style={{ background: `radial-gradient(ellipse at ${i % 2 === 0 ? '15% 10%' : '85% 10%'}, rgba(63,175,151,0.12) 0%, transparent 50%)` }} />
              <div className="absolute inset-0 pointer-events-none" style={{ background: `radial-gradient(ellipse at ${i % 2 === 0 ? '85% 90%' : '15% 90%'}, rgba(111,209,184,0.1) 0%, transparent 45%)` }} />
              <div className="absolute inset-0 rounded-[28px] pointer-events-none" style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), inset 1px 0 0 rgba(255,255,255,0.03)' }} />

              <div className="relative flex flex-col h-full">
                <div className="space-y-5">
                  <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg" style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.1)' }}>
                    <feature.icon size={14} className="text-[#3FAF97]" />
                    <span className="text-[10px] uppercase tracking-[0.15em] font-semibold text-white/60">{feature.title}</span>
                  </div>
                  <h2 className="text-2xl md:text-3xl font-extrabold tracking-tight text-white leading-[1.1]">
                    {feature.subtitle}
                  </h2>
                  <ul className="space-y-3">
                    {feature.bullets.map(b => (
                      <li key={b} className="flex items-center gap-3 text-sm font-bold text-white">
                        <div className="w-5 h-5 rounded-full flex items-center justify-center shrink-0" style={{ border: '2px solid #ffffff' }}>
                          <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
                            <path d="M3 8.5l3.5 3.5L13 5" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </div>
                        {b}
                      </li>
                    ))}
                  </ul>
                </div>

                {/* CRM Mockup — always at bottom */}
                <div className="mt-auto pt-6">
                  <FeatureMockup id={feature.id} />
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="px-6 pb-24 md:pb-32 bg-text-primary">
        <div className="max-w-4xl mx-auto text-center">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <h2 className="text-3xl md:text-4xl font-extrabold tracking-tight text-white">
              Ready to see Lume in action?
            </h2>
            <p className="mt-3 text-white/50 font-normal max-w-lg mx-auto">
              Book a personalized demo and discover how Lume can transform your operations.
            </p>
            <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link
                to="/pricing"
                className="inline-flex items-center gap-2 bg-white text-text-primary px-8 py-4 rounded-xl text-sm font-bold hover:bg-white/90 transition-colors group"
              >
                Start Now
                <ArrowRight size={16} className="group-hover:translate-x-0.5 transition-transform" />
              </Link>
              <Link
                to="/contact"
                className="inline-flex items-center gap-2 border-2 border-white/30 text-white px-8 py-4 rounded-xl text-sm font-bold hover:border-white/50 transition-colors"
              >
                Book a Demo
              </Link>
            </div>
          </motion.div>
        </div>
      </section>
    </div>
  );
}
