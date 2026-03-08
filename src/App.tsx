import React, { useState, useEffect } from 'react';
import {
  LayoutDashboard,
  Users,
  Kanban,
  CheckSquare,
  Settings,
  LogOut,
  Menu,
  X,
  Calendar as CalendarIcon,
  Briefcase,
  FileText,
  TrendingUp,
  CreditCard,
  Clock,
  CalendarClock,
  Sun,
  Moon,
  ChevronLeft,
  Search,
  UserCircle2,
  Contact,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from './lib/utils';
import Dashboard from './pages/Dashboard';
import Pipeline from './pages/Pipeline';
import Clients from './pages/Clients';
import Leads from './pages/Leads';
import Tasks from './pages/Tasks';
import Schedule from './pages/Schedule';
import SettingsPage from './pages/Settings';
import Auth from './pages/Auth';
import Landing from './pages/Landing';
import { supabase } from './lib/supabase';
import { User } from '@supabase/supabase-js';
import Jobs from './pages/Jobs';
import JobDetails from './pages/JobDetails';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Toaster } from 'sonner';
import { JobModalControllerProvider } from './contexts/JobModalController';
import Invoices from './pages/Invoices';
import InvoiceDetails from './pages/InvoiceDetails';
import Insights from './pages/Insights';
import Payments from './pages/Payments';
import PaymentSettings from './pages/PaymentSettings';
import GlobalSearch from './components/GlobalSearch';
import SearchResultsPage from './pages/SearchResults';
import FindTime from './pages/FindTime';
import Availability from './pages/Availability';
import type { TileColor } from './components/ui';

type NavItem = {
  id: string;
  label: string;
  icon: typeof LayoutDashboard;
  path: string;
  tileColor: TileColor;
};

type NavSection = {
  label: string | null;
  items: NavItem[];
};

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [view, setView] = useState<'landing' | 'auth'>('landing');
  const [isDark, setIsDark] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('lume-theme') === 'dark';
    }
    return false;
  });
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
    localStorage.setItem('lume-theme', isDark ? 'dark' : 'light');
  }, [isDark]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  if (loading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-surface-secondary">
        <div className="flex flex-col items-center gap-3">
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
            className="w-7 h-7 border-2 border-outline-subtle border-t-text-primary rounded-full"
          />
          <span className="text-xs text-text-tertiary font-semibold">Loading workspace...</span>
        </div>
      </div>
    );
  }

  if (!user) {
    if (view === 'landing') {
      return <Landing onStart={() => setView('auth')} />;
    }
    return <Auth onBack={() => setView('landing')} />;
  }

  const navSections: NavSection[] = [
    {
      label: null,
      items: [
        { id: 'dashboard', label: 'Home', icon: LayoutDashboard, path: '/dashboard', tileColor: 'blue' },
      ],
    },
    {
      label: 'CRM',
      items: [
        { id: 'leads', label: 'Leads', icon: Contact, path: '/leads', tileColor: 'pink' },
        { id: 'pipeline', label: 'Pipeline', icon: Kanban, path: '/pipeline', tileColor: 'purple' },
        { id: 'clients', label: 'Clients', icon: Users, path: '/clients', tileColor: 'rose' },
      ],
    },
    {
      label: 'Operations',
      items: [
        { id: 'jobs', label: 'Jobs', icon: Briefcase, path: '/jobs', tileColor: 'amber' },
        { id: 'schedule', label: 'Calendar', icon: CalendarIcon, path: '/calendar', tileColor: 'cyan' },
        { id: 'findtime', label: 'Find Time', icon: Clock, path: '/find-time', tileColor: 'green' },
        { id: 'availability', label: 'Availability', icon: CalendarClock, path: '/availability', tileColor: 'blue' },
        { id: 'tasks', label: 'Tasks', icon: CheckSquare, path: '/tasks', tileColor: 'purple' },
      ],
    },
    {
      label: 'Finance',
      items: [
        { id: 'invoices', label: 'Invoices', icon: FileText, path: '/invoices', tileColor: 'green' },
        { id: 'payments', label: 'Payments', icon: CreditCard, path: '/payments', tileColor: 'amber' },
        { id: 'insights', label: 'Insights', icon: TrendingUp, path: '/insights', tileColor: 'cyan' },
      ],
    },
  ];

  const isActive = (path: string) => location.pathname === path || location.pathname.startsWith(`${path}/`);

  return (
    <JobModalControllerProvider>
      <Toaster
        richColors
        position="top-right"
        toastOptions={{
          className: '!rounded-xl !border-[1.5px] !border-outline !shadow-md !text-[13px] !font-medium',
        }}
      />
      <div className="flex h-screen overflow-hidden bg-surface-secondary">
        {/* Sidebar — light, outlined, with icon tiles */}
        <motion.aside
          initial={false}
          animate={{ width: isSidebarOpen ? 230 : 56 }}
          transition={{ duration: 0.15, ease: [0.4, 0, 0.2, 1] }}
          className="bg-sidebar flex flex-col z-20 shrink-0 border-r-[1.5px] border-outline"
        >
          {/* Logo area */}
          <div className="h-[56px] px-3 flex items-center justify-between">
            <AnimatePresence mode="wait">
              {isSidebarOpen ? (
                <motion.div
                  key="logo-full"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex items-center gap-2.5 pl-0.5"
                >
                  <div className="w-7 h-7 rounded-lg bg-text-primary flex items-center justify-center">
                    <span className="text-[12px] font-extrabold text-surface">L</span>
                  </div>
                  <span className="text-[14px] font-extrabold tracking-wide text-text-primary">LUME</span>
                </motion.div>
              ) : (
                <motion.div
                  key="logo-short"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="mx-auto"
                >
                  <div className="w-7 h-7 rounded-lg bg-text-primary flex items-center justify-center">
                    <span className="text-[12px] font-extrabold text-surface">L</span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
            {isSidebarOpen && (
              <button
                onClick={() => setIsSidebarOpen(false)}
                className="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-tertiary transition-colors"
              >
                <ChevronLeft size={14} />
              </button>
            )}
          </div>

          {/* Nav */}
          <nav className="flex-1 px-2 py-1 overflow-y-auto space-y-0.5">
            {navSections.map((section, sIdx) => (
              <div key={sIdx}>
                {section.label && isSidebarOpen && (
                  <p className="px-2 pt-5 pb-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-text-tertiary">
                    {section.label}
                  </p>
                )}
                {!isSidebarOpen && sIdx > 0 && (
                  <div className="mx-1 my-2.5 border-t border-border" />
                )}
                <div className="space-y-0.5">
                  {section.items.map((item) => {
                    const active = isActive(item.path);
                    return (
                      <button
                        key={item.id}
                        onClick={() => navigate(item.path)}
                        title={!isSidebarOpen ? item.label : undefined}
                        className={cn(
                          "w-full flex items-center gap-2.5 px-2 py-[7px] rounded-lg transition-all duration-100 text-[13px] group",
                          isSidebarOpen ? "" : "justify-center",
                          active
                            ? "bg-text-primary text-surface"
                            : "text-sidebar-text hover:bg-surface-tertiary hover:text-text-primary"
                        )}
                      >
                        <div className={cn(
                          "icon-tile icon-tile-sm",
                          active
                            ? "bg-surface/20 text-surface"
                            : `icon-tile-${item.tileColor}`
                        )}>
                          <item.icon size={13} strokeWidth={2} />
                        </div>
                        {isSidebarOpen && (
                          <span className="font-semibold truncate">{item.label}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>

          {/* Footer */}
          <div className="p-2 space-y-0.5 border-t border-border">
            <button
              onClick={() => setIsDark(!isDark)}
              title={!isSidebarOpen ? (isDark ? 'Light Mode' : 'Dark Mode') : undefined}
              className={cn(
                "w-full flex items-center gap-2.5 px-2 py-[7px] rounded-lg text-[13px] text-sidebar-text hover:bg-surface-tertiary hover:text-text-primary transition-colors",
                !isSidebarOpen && "justify-center"
              )}
            >
              <div className="icon-tile icon-tile-sm icon-tile-amber">
                {isDark ? <Sun size={13} strokeWidth={2} /> : <Moon size={13} strokeWidth={2} />}
              </div>
              {isSidebarOpen && <span className="font-semibold">{isDark ? 'Light Mode' : 'Dark Mode'}</span>}
            </button>
            <button
              onClick={() => navigate('/settings')}
              title={!isSidebarOpen ? 'Settings' : undefined}
              className={cn(
                "w-full flex items-center gap-2.5 px-2 py-[7px] rounded-lg text-[13px] transition-colors",
                isActive('/settings')
                  ? "bg-text-primary text-surface"
                  : "text-sidebar-text hover:bg-surface-tertiary hover:text-text-primary",
                !isSidebarOpen && "justify-center"
              )}
            >
              <div className={cn(
                "icon-tile icon-tile-sm",
                isActive('/settings') ? "bg-surface/20 text-surface" : "icon-tile-purple"
              )}>
                <Settings size={13} strokeWidth={2} />
              </div>
              {isSidebarOpen && <span className="font-semibold">Settings</span>}
            </button>
            <button
              onClick={() => supabase.auth.signOut()}
              title={!isSidebarOpen ? 'Sign Out' : undefined}
              className={cn(
                "w-full flex items-center gap-2.5 px-2 py-[7px] rounded-lg text-[13px] text-sidebar-text hover:bg-danger-light hover:text-danger transition-colors",
                !isSidebarOpen && "justify-center"
              )}
            >
              <div className="icon-tile icon-tile-sm icon-tile-rose">
                <LogOut size={13} strokeWidth={2} />
              </div>
              {isSidebarOpen && <span className="font-semibold">Sign Out</span>}
            </button>
          </div>
        </motion.aside>

        {/* Main content */}
        <main className="flex-1 flex flex-col overflow-hidden bg-surface-secondary">
          {/* Top bar — clean outlined header */}
          <header className="h-[56px] shrink-0 flex items-center gap-3 px-5 border-b-[1.5px] border-outline bg-surface">
            {!isSidebarOpen && (
              <button
                onClick={() => setIsSidebarOpen(true)}
                className="p-1.5 rounded-lg border-[1.5px] border-outline-subtle text-text-tertiary hover:text-text-primary hover:bg-surface-tertiary transition-colors"
              >
                <Menu size={16} />
              </button>
            )}
            <div className="flex-1 max-w-2xl">
              <GlobalSearch />
            </div>
            <div className="ml-auto flex items-center gap-2">
              <div className="avatar-sm">
                <UserCircle2 size={14} />
              </div>
            </div>
          </header>

          {/* Page content */}
          <div className="flex-1 overflow-y-auto">
            <div className="max-w-[1280px] mx-auto px-6 py-5">
              <AnimatePresence mode="wait">
                <motion.div
                  key={location.pathname}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15, ease: [0.23, 1, 0.32, 1] }}
                >
                  <Routes>
                    <Route path="/" element={<Navigate to="/dashboard" replace />} />
                    <Route path="/dashboard" element={<Dashboard />} />
                    <Route path="/leads" element={<Leads />} />
                    <Route path="/pipeline" element={<Pipeline />} />
                    <Route path="/clients" element={<Clients />} />
                    <Route path="/clients/:id" element={<Clients />} />
                    <Route path="/jobs" element={<Jobs />} />
                    <Route path="/jobs/:id" element={<JobDetails />} />
                    <Route path="/calendar" element={<Schedule />} />
                    <Route path="/find-time" element={<FindTime />} />
                    <Route path="/availability" element={<Availability />} />
                    <Route path="/search" element={<SearchResultsPage />} />
                    <Route path="/invoices" element={<Invoices />} />
                    <Route path="/invoices/:id" element={<InvoiceDetails />} />
                    <Route path="/insights" element={<Insights />} />
                    <Route path="/payments" element={<Payments />} />
                    <Route path="/payments/settings" element={<PaymentSettings />} />
                    <Route path="/tasks" element={<Tasks />} />
                    <Route path="/settings" element={<SettingsPage />} />
                    <Route path="*" element={<Navigate to="/dashboard" replace />} />
                  </Routes>
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </main>
      </div>
    </JobModalControllerProvider>
  );
}
