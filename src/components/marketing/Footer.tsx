import { Link, useLocation } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';

const PRODUCT = [
  { label: 'Pipeline', href: '/features#pipeline' },
  { label: 'D2D Map', href: '/features#d2d-map' },
  { label: 'Leaderboard', href: '/features#leaderboard' },
  { label: 'AI Assistant', href: '/features#ai-voice' },
  { label: 'Automations', href: '/features#automation' },
  { label: 'Scheduling', href: '/features#scheduling' },
  { label: 'Google Reviews', href: '/features#reviews' },
];

const SOLUTIONS_LINKS = [
  { label: 'Owners', href: '/solutions#owners' },
  { label: 'Sales Teams', href: '/solutions#sales' },
  { label: 'Field Teams', href: '/solutions#field' },
  { label: 'Dispatchers', href: '/solutions#dispatch' },
];

const INDUSTRIES_LINKS = [
  { label: 'Window Cleaning', href: '/industries#window-cleaning' },
  { label: 'Pressure Washing', href: '/industries#pressure-washing' },
  { label: 'Roofing', href: '/industries#roofing' },
  { label: 'Renovation', href: '/industries#renovation' },
  { label: 'All Industries', href: '/industries' },
];

const COMPANY = [
  { label: 'Pricing', href: '/pricing' },
  { label: 'Contact', href: '/contact' },
];

export default function Footer() {
  const { pathname } = useLocation();
  const isContact = pathname === '/contact';
  return (
    <footer className="text-text-primary border-t border-[#c5c5c5]" style={{ backgroundColor: '#fafaf8', backgroundImage: 'url("/paper-texture.png")', backgroundRepeat: 'repeat', backgroundSize: '300px 300px' }}>
      {/* Demo Form Band */}
      {!isContact && <div className="bg-[#2a2a2a]">
        <div className="max-w-5xl mx-auto px-6 py-16">
          {/* Title above everything */}
          <h2 className="text-3xl md:text-4xl font-extrabold tracking-tight text-white text-center mb-10">
            See Lume in action
          </h2>

          <div className="flex flex-col md:flex-row gap-10 items-start">
            {/* Form in white box */}
            <div className="flex-1 bg-white p-8">
              <form
                onSubmit={(e) => e.preventDefault()}
                className="flex flex-col gap-4"
              >
                <input type="text" required placeholder="Full name *" className="px-4 py-3 border border-[#111] bg-white text-sm text-[#111] placeholder:text-[#111] placeholder:font-bold focus:outline-none focus:border-[#3FAF97] transition-colors" />
                <input type="email" required placeholder="Email *" className="px-4 py-3 border border-[#111] bg-white text-sm text-[#111] placeholder:text-[#111] placeholder:font-bold focus:outline-none focus:border-[#3FAF97] transition-colors" />
                <input type="tel" required placeholder="Phone *" className="px-4 py-3 border border-[#111] bg-white text-sm text-[#111] placeholder:text-[#111] placeholder:font-bold focus:outline-none focus:border-[#3FAF97] transition-colors" />
                <input type="text" required placeholder="Company *" className="px-4 py-3 border border-[#111] bg-white text-sm text-[#111] placeholder:text-[#111] placeholder:font-bold focus:outline-none focus:border-[#3FAF97] transition-colors" />
                <textarea rows={3} placeholder="Message" className="px-4 py-3 border border-[#111] bg-white text-sm text-[#111] placeholder:text-[#111] placeholder:font-bold focus:outline-none focus:border-[#3FAF97] transition-colors resize-none" />
                <button
                  type="submit"
                  className="w-full flex items-center justify-center gap-2 bg-[#3FAF97] text-white px-7 py-3.5 text-sm font-medium hover:bg-[#1F5F4F] transition-colors group mt-2"
                >
                  Book demo
                  <ArrowRight size={14} className="group-hover:translate-x-0.5 transition-transform" />
                </button>
              </form>
            </div>

            {/* Image + text overlay on the right */}
            <div className="flex-1 relative rounded-xl overflow-hidden min-h-[400px]">
              <img src="/desk.png" alt="Demo" className="absolute inset-0 w-full h-full object-cover" />
              <div className="absolute inset-0 bg-black/50" />
              <div className="relative z-10 flex flex-col justify-end h-full p-8">
                <p className="text-xl md:text-2xl font-bold text-white leading-snug">
                  Book a free demo — we'll show you exactly how Lume fits your business in minutes.
                </p>
                <p className="mt-3 text-sm text-white/70 leading-relaxed">
                  No commitment, no pressure. Just a quick walkthrough tailored to your industry.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>}

      {/* Links */}
      <div className="max-w-7xl mx-auto px-6 py-12">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-8">
          {/* Brand */}
          <div className="col-span-2 md:col-span-1">
            <Link to="/" className="flex items-center">
              <img src="/lume-logo-v2.png" alt="Lume" className="h-9 w-auto" />
            </Link>
            <p className="mt-3 text-xs text-text-tertiary leading-relaxed">
              The modern operating system for residential service businesses.
            </p>
          </div>

          <FooterCol title="Product" links={PRODUCT} />
          <FooterCol title="Company" links={COMPANY} />
        </div>

        {/* Bottom */}
        <div className="mt-12 pt-6 border-t border-outline flex flex-col md:flex-row items-center justify-between gap-3">
          <p className="text-xs text-text-tertiary">
            &copy; {new Date().getFullYear()} Lume. All rights reserved.
          </p>
          <div className="flex gap-6 text-xs text-text-tertiary">
            <span>Privacy</span>
            <span>Terms</span>
          </div>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: { label: string; href: string }[] }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-[0.15em] font-semibold text-text-tertiary mb-3">{title}</p>
      <ul className="space-y-2">
        {links.map(l => (
          <li key={l.label}>
            <Link to={l.href} className="text-sm text-text-secondary hover:text-text-primary transition-colors">
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
