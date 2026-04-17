import { useState, useEffect, useRef, useCallback } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  Menu, X, ChevronDown, ArrowRight,
  Kanban, FileText, Map, Trophy, Mic, BellRing,
  Star, Calendar, Zap, Users,
  Wrench, ShieldCheck, Droplets, Home, Car,
  Fence, HardHat, Hammer, Building2,
} from 'lucide-react';

const FEATURES = [
  { icon: Kanban, label: 'Visual Pipeline', desc: 'Track every opportunity at a glance', href: '/features#pipeline' },
  { icon: FileText, label: 'Request Forms', desc: 'Capture leads automatically', href: '/features#request-form' },
  { icon: Map, label: 'D2D Map', desc: 'Plan your territories', href: '/features#d2d-map' },
  { icon: Trophy, label: 'Leaderboard', desc: 'Motivate your team', href: '/features#leaderboard' },
  { icon: Mic, label: 'AI Voice Assistant', desc: 'Speak it, Lume does it', href: '/features#ai-voice' },
  { icon: BellRing, label: 'Quote Notifications', desc: 'Know when a quote is opened', href: '/features#notifications' },
  { icon: Star, label: 'Google Reviews', desc: 'Generate more 5-star reviews', href: '/features#reviews' },
  { icon: Calendar, label: 'Scheduling', desc: 'Smart dispatch & calendar', href: '/features#scheduling' },
  { icon: Zap, label: 'Automations', desc: 'Eliminate repetitive tasks', href: '/features#automation' },
  { icon: Users, label: 'Team Performance', desc: 'Full visibility on every rep', href: '/features#team' },
];

const INDUSTRIES_ITEMS = [
  { icon: Droplets, label: 'Window Cleaning', href: '/industries#window-cleaning' },
  { icon: Home, label: 'Gutter Cleaning', href: '/industries#gutter-cleaning' },
  { icon: ShieldCheck, label: 'Pressure Washing', href: '/industries#pressure-washing' },
  { icon: Wrench, label: 'Roofing', href: '/industries#roofing' },
  { icon: Car, label: 'Auto Detailing', href: '/industries#detailing' },
  { icon: Fence, label: 'Fencing', href: '/industries#fencing' },
  { icon: HardHat, label: 'Paving', href: '/industries#paving' },
  { icon: Hammer, label: 'Renovation', href: '/industries#renovation' },
  { icon: Building2, label: 'Demolition', href: '/industries#demolition' },
];

type MegaMenu = 'features' | 'industries' | null;

export default function Header() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [megaMenu, setMegaMenu] = useState<MegaMenu>(null);
  const [scrolled, setScrolled] = useState(false);
  const [hidden, setHidden] = useState(false);
  const lastScrollY = useRef(0);
  const menuRef = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const navigate = useNavigate();

  const handleHashLink = useCallback((href: string) => {
    setMegaMenu(null);
    setMobileOpen(false);
    const [path, hash] = href.split('#');
    if (location.pathname === path && hash) {
      const el = document.getElementById(hash);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
    }
    navigate(href);
    if (hash) {
      setTimeout(() => {
        const el = document.getElementById(hash);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    }
  }, [location.pathname, navigate]);

  useEffect(() => {
    setMobileOpen(false);
    setMegaMenu(null);
  }, [location.pathname]);

  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY;
      setScrolled(y > 8);
      setHidden(y > 300 && y > lastScrollY.current);
      lastScrollY.current = y;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMegaMenu(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const toggleMega = (menu: MegaMenu) => {
    setMegaMenu(prev => prev === menu ? null : menu);
  };

  return (
    <header
      ref={menuRef}
      className={`fixed w-full z-50 transition-all duration-300 border-b border-[#c5c5c5] ${
        hidden ? '-top-20' : 'top-0'
      }`}
      style={{ backgroundColor: '#fafaf8', backgroundImage: 'url("/paper-texture.png")', backgroundRepeat: 'repeat', backgroundSize: '300px 300px' }}
    >
      <nav className="flex items-center justify-between h-16">
        {/* Logo — pinned to left edge */}
        <Link to="/" className="flex items-center pl-6">
          <img src="/lume-logo-v2.png" alt="Lume" className="h-10 w-auto" />
        </Link>

        {/* Desktop Nav */}
        <div className="hidden lg:flex items-center gap-1 ml-8">
          <NavDropdown label="Features" active={megaMenu === 'features'} onClick={() => toggleMega('features')} />
          <NavLink to="/industries" label="Industries" />
          <NavLink to="/pricing" label="Pricing" />
          <NavLink to="/contact" label="Contact" />
        </div>

        {/* Desktop CTA */}
        <div className="hidden lg:flex items-center gap-3 pr-6">
          <Link
            to="/auth"
            className="text-sm font-bold text-black hover:opacity-60 transition-colors"
          >
            Login
          </Link>
          <Link
            to="/contact"
            className="inline-flex items-center gap-2 bg-[#3FAF97] text-white px-5 py-2.5 rounded-lg text-sm font-medium hover:bg-[#1F5F4F] transition-colors group"
          >
            Book a demo
            <ArrowRight size={14} className="group-hover:translate-x-0.5 transition-transform" />
          </Link>
        </div>

        {/* Mobile hamburger */}
        <button
          className="lg:hidden p-2 mr-6 text-text-secondary hover:text-text-primary"
          onClick={() => setMobileOpen(!mobileOpen)}
        >
          {mobileOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
      </nav>

      {/* Mega Menu — Features */}
      <AnimatePresence>
        {megaMenu === 'features' && (
          <MegaPanel>
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-1">
              {FEATURES.map(f => (
                <MegaItem key={f.label} icon={f.icon} label={f.label} desc={f.desc} href={f.href} onClick={() => handleHashLink(f.href)} />
              ))}
            </div>
            <div className="mt-4 pt-4 border-t border-outline">
              <Link
                to="/features"
                onClick={() => setMegaMenu(null)}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-[#3FAF97] hover:text-[#1F5F4F] transition-colors"
              >
                View all features <ArrowRight size={14} />
              </Link>
            </div>
          </MegaPanel>
        )}

        {megaMenu === 'industries' && (
          <MegaPanel>
            <div className="grid grid-cols-3 gap-1">
              {INDUSTRIES_ITEMS.map(i => (
                <button
                  key={i.label}
                  onClick={() => handleHashLink(i.href)}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-surface-tertiary transition-colors text-left"
                >
                  <i.icon size={16} className="text-text-tertiary" />
                  <span className="text-sm font-medium text-text-primary">{i.label}</span>
                </button>
              ))}
            </div>
            <div className="mt-4 pt-4 border-t border-outline">
              <Link
                to="/industries"
                onClick={() => setMegaMenu(null)}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:text-primary-hover transition-colors"
              >
                View all industries <ArrowRight size={14} />
              </Link>
            </div>
          </MegaPanel>
        )}
      </AnimatePresence>

      {/* Mobile Menu */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="lg:hidden bg-surface border-t border-outline overflow-hidden"
          >
            <div className="px-6 py-4 space-y-1">
              <MobileLink to="/features" label="Features" />
              <MobileLink to="/industries" label="Industries" />
              <MobileLink to="/pricing" label="Pricing" />
              <MobileLink to="/contact" label="Contact" />
              <div className="pt-4 space-y-2">
                <Link
                  to="/auth"
                  className="block w-full text-center text-sm font-medium text-text-secondary hover:text-text-primary py-2"
                >
                  Login
                </Link>
                <Link
                  to="/contact"
                  className="block w-full text-center bg-[#3FAF97] text-white px-5 py-3 rounded-lg text-sm font-medium hover:bg-[#1F5F4F] transition-colors"
                >
                  Book a demo
                </Link>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}

function NavDropdown({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1 px-3 py-2 text-sm font-bold rounded-lg transition-colors ${
        active ? 'text-black bg-surface-tertiary' : 'text-black hover:opacity-60'
      }`}
    >
      {label}
      <ChevronDown size={14} className={`transition-transform ${active ? 'rotate-180' : ''}`} />
    </button>
  );
}

function NavLink({ to, label }: { to: string; label: string }) {
  return (
    <Link to={to} className="px-3 py-2 text-sm font-bold text-black hover:opacity-60 rounded-lg transition-colors">
      {label}
    </Link>
  );
}

function MegaPanel({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.15 }}
      className="hidden lg:block absolute left-0 w-full border-t border-[#c5c5c5] border-b border-b-[#c5c5c5] shadow-lg"
      style={{ backgroundColor: '#fafaf8', backgroundImage: 'url("/paper-texture.png")', backgroundRepeat: 'repeat', backgroundSize: '300px 300px' }}
    >
      <div className="max-w-7xl mx-auto px-6 py-5">
        {children}
      </div>
    </motion.div>
  );
}

function MegaItem({ icon: Icon, label, desc, onClick }: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  desc: string;
  href: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-start gap-3 px-3 py-3 rounded-lg hover:bg-surface-tertiary transition-colors group text-left w-full"
    >
      <div className="mt-0.5 p-1.5 rounded-md bg-surface-tertiary group-hover:bg-surface-secondary">
        <Icon size={16} className="text-text-secondary" />
      </div>
      <div>
        <p className="text-sm font-medium text-text-primary">{label}</p>
        <p className="text-xs text-text-tertiary mt-0.5">{desc}</p>
      </div>
    </button>
  );
}

function MobileLink({ to, label }: { to: string; label: string }) {
  return (
    <Link to={to} className="block px-3 py-3 text-sm font-medium text-text-secondary hover:text-text-primary rounded-lg hover:bg-surface-tertiary transition-colors">
      {label}
    </Link>
  );
}
