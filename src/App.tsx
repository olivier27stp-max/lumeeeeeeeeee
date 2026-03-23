import React, { useState, useEffect } from 'react';
import {
  LayoutDashboard,
  Users,
  Kanban,

  Settings,
  LogOut,
  Menu,
  X,
  Calendar as CalendarIcon,
  Briefcase,
  MapPin,
  FileText,
  TrendingUp,
  CreditCard,
  CalendarClock,
  Sun,
  Moon,
  Store,
  ChevronLeft,
  ChevronRight,
  Search,
  UserCircle2,
  Contact,
  HelpCircle,
  Timer,
  Bell,
  Zap,
  Sparkles,
  MessageSquare,
  StickyNote,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from './lib/utils';
import Dashboard from './pages/Dashboard';
import Pipeline from './pages/Pipeline';
import Clients from './pages/Clients';
import Leads from './pages/Leads';
// Tasks page removed from navigation
import Schedule from './pages/Schedule';
import SettingsPage from './pages/Settings';
import Auth from './pages/Auth';
import Landing from './pages/Landing';
import { supabase } from './lib/supabase';
import { User } from '@supabase/supabase-js';
import Jobs from './pages/Jobs';
import JobDetails from './pages/JobDetails';
import ClientDetails from './pages/ClientDetails';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Toaster } from 'sonner';
import { JobModalControllerProvider } from './contexts/JobModalController';
import { useTranslation } from './i18n';
import Invoices from './pages/Invoices';
import InvoiceDetails from './pages/InvoiceDetails';
import InvoiceEdit from './pages/InvoiceEdit';
import Insights from './pages/Insights';
import Payments from './pages/Payments';
import PaymentSettings from './pages/PaymentSettings';
import Automations from './pages/Automations';
import WorkflowsPage from './pages/Workflows';
import CompanySettings from './pages/CompanySettings';
import ManageTeam from './pages/ManageTeam';
import TeamMemberDetails from './pages/TeamMemberDetails';
import GlobalSearch from './components/GlobalSearch';
import SearchResultsPage from './pages/SearchResults';
import Availability from './pages/Availability';
import Timesheets from './pages/Timesheets';
import QuoteView from './pages/QuoteView';
import Quotes from './pages/Quotes';
import QuoteDetails from './pages/QuoteDetails';
import type { TileColor } from './components/ui';
import HelpChat from './components/HelpChat';
import ActivityCenter from './components/ActivityCenter';
import ErrorBoundary from './components/ErrorBoundary';
import ProductsServices from './pages/ProductsServices';
import AppMarketplace from './pages/AppMarketplace';
import PhoneNumberSettings from './pages/PhoneNumberSettings';
import RequestFormSettings from './pages/RequestFormSettings';
import QuoteTemplates from './pages/QuoteTemplates';
import OAuthCallback from './pages/OAuthCallback';
import DispatchMap from './pages/DispatchMap';
import BillingCheckout from './pages/BillingCheckout';
import AcceptInvitation from './pages/AcceptInvitation';
import ReferFriend from './pages/ReferFriend';
import MrLumePage from './features/agent/components/MrLumeChat';
import Messages from './pages/Messages';
import NoteBoards from './pages/NoteBoards';
import NoteCanvas from './pages/NoteCanvas';
// Mr Lume panda icon for sidebar
const MrLumeIcon = ({ size = 20, className = '' }: { size?: number; className?: string }) => (
  <img src="/lume-logo.png" alt="Mr Lume" style={{ width: size, height: size }} className={`object-contain ${className}`} />
);
import SatisfactionSurvey from './pages/SatisfactionSurvey';
import ClientPortal from './pages/ClientPortal';
import PublicPayment from './pages/PublicPayment';
import { useRealtimeNotifications } from './hooks/useRealtimeNotifications';
import OnboardingWizard from './components/OnboardingWizard';
import CommandPalette from './components/CommandPalette';

// Director Panel — lazy loaded
const DirectorHome = React.lazy(() => import('./pages/director-panel/DirectorHome'));
const DirectorFlows = React.lazy(() => import('./pages/director-panel/DirectorFlows'));
const FlowEditor = React.lazy(() => import('./pages/director-panel/FlowEditor'));
const DirectorTemplates = React.lazy(() => import('./pages/director-panel/DirectorTemplates'));
const DirectorAssets = React.lazy(() => import('./pages/director-panel/DirectorAssets'));
const DirectorRuns = React.lazy(() => import('./pages/director-panel/DirectorRuns'));
const DirectorSettings = React.lazy(() => import('./pages/director-panel/DirectorSettings'));
const DirectorStyles = React.lazy(() => import('./pages/director-panel/DirectorStyles'));
const DirectorTraining = React.lazy(() => import('./pages/director-panel/DirectorTraining'));
const DirectorLayout = React.lazy(() => import('./pages/director-panel/DirectorLayout'));

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
  const { t, language } = useTranslation();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isSidebarHovered, setIsSidebarHovered] = useState(false);
  const sidebarExpanded = isSidebarOpen || isSidebarHovered;
  const [view, setView] = useState<'landing' | 'auth'>('landing');
  const [isDark, setIsDark] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('lume-theme') === 'dark';
    }
    return false;
  });
  const [helpOpen, setHelpOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingChecked, setOnboardingChecked] = useState(false);
  const [userOrgId, setUserOrgId] = useState<string | null>(null);
  const [showMoreNav, setShowMoreNav] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { unreadCount: unreadNotifs, resetCount: resetNotifCount } = useRealtimeNotifications(!!user);
  const [unreadSms, setUnreadSms] = useState(0);

  // Fetch unread SMS count + realtime subscription
  useEffect(() => {
    if (!user) { setUnreadSms(0); return; }

    const loadUnread = async () => {
      const { data } = await supabase
        .from('conversations')
        .select('unread_count');
      const total = (data || []).reduce((sum: number, c: any) => sum + (c.unread_count || 0), 0);
      setUnreadSms(total);
    };

    loadUnread();

    const channel = supabase
      .channel('sms-unread-badge')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, () => {
        loadUnread();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
    localStorage.setItem('lume-theme', isDark ? 'dark' : 'light');
  }, [isDark]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      const prev = user;
      setUser(session?.user ?? null);
      // Session expired or user signed out in another tab
      if (event === 'SIGNED_OUT' && prev) {
        import('sonner').then(({ toast }) => {
          toast.info(t.common.sessionExpiredPleaseSignInAgain);
        });
      }
      if (event === 'TOKEN_REFRESHED') {
        // silently refreshed — no action needed
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // Auto-logout after 30 minutes of inactivity
  useEffect(() => {
    if (!user) return;
    const INACTIVITY_MS = 30 * 60 * 1000;
    let timer: ReturnType<typeof setTimeout>;
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        supabase.auth.signOut();
      }, INACTIVITY_MS);
    };
    const events = ['mousedown', 'keydown', 'scroll', 'touchstart'] as const;
    events.forEach((e) => document.addEventListener(e, reset, { passive: true }));
    reset();
    return () => {
      clearTimeout(timer);
      events.forEach((e) => document.removeEventListener(e, reset));
    };
  }, [user]);

  // Ctrl+K opens command palette
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setCommandPaletteOpen((prev) => !prev);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  // Check if user needs onboarding — only for brand new sign-ups
  useEffect(() => {
    if (!user || onboardingChecked) return;
    (async () => {
      try {
        // Get org_id
        const { data: membership } = await supabase
          .from('memberships')
          .select('org_id')
          .eq('user_id', user.id)
          .limit(1)
          .maybeSingle();
        if (membership?.org_id) setUserOrgId(membership.org_id);

        // Check if onboarding is done
        const { data: profile } = await supabase
          .from('profiles')
          .select('onboarding_done')
          .eq('id', user.id)
          .maybeSingle();

        if (!profile?.onboarding_done) {
          // Only show wizard for accounts created in the last 5 minutes (fresh sign-up)
          const createdAt = new Date(user.created_at || 0).getTime();
          const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
          if (createdAt > fiveMinutesAgo) {
            setShowOnboarding(true);
          } else {
            // Old account, never completed onboarding — just mark it done silently
            try { await supabase.from('profiles').update({ onboarding_done: true }).eq('id', user.id); } catch {}
          }
        }
      } catch {
        // If profile table doesn't have onboarding_done column, skip
      } finally {
        setOnboardingChecked(true);
      }
    })();
  }, [user, onboardingChecked]);

  if (loading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-surface">
        <div className="flex flex-col items-center gap-3">
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
            className="w-6 h-6 border-2 border-outline border-t-text-primary rounded-full"
          />
          <span className="text-xs text-text-tertiary font-medium">{t.nav.loadingWorkspace}</span>
        </div>
      </div>
    );
  }

  // Public pages (no auth required)
  if (location.pathname.startsWith('/quote/')) {
    return (
      <Routes>
        <Route path="/quote/:token" element={<QuoteView />} />
      </Routes>
    );
  }

  if (location.pathname.startsWith('/survey/')) {
    return (
      <Routes>
        <Route path="/survey/:token" element={<SatisfactionSurvey />} />
      </Routes>
    );
  }

  if (location.pathname.startsWith('/portal/')) {
    return (
      <Routes>
        <Route path="/portal/:token" element={<ClientPortal />} />
      </Routes>
    );
  }

  if (location.pathname.startsWith('/pay/')) {
    return (
      <Routes>
        <Route path="/pay/:token" element={<PublicPayment />} />
      </Routes>
    );
  }

  if (location.pathname.startsWith('/invite/')) {
    return (
      <Routes>
        <Route path="/invite/:token" element={<AcceptInvitation />} />
      </Routes>
    );
  }

  // Director Panel flow editor — full screen, no sidebar
  if (user && location.pathname.match(/^\/director-panel\/flows\/.+/)) {
    return (
      <ErrorBoundary>
        <React.Suspense fallback={<div className="h-screen w-screen bg-[#111]" />}>
          <Routes>
            <Route path="/director-panel/flows/:flowId" element={<FlowEditor />} />
          </Routes>
        </React.Suspense>
      </ErrorBoundary>
    );
  }

  if (!user) {
    if (view === 'landing') {
      return <Landing onStart={() => setView('auth')} />;
    }
    return <Auth onBack={() => setView('landing')} />;
  }

  // Show onboarding wizard for new users
  if (showOnboarding && user) {
    return (
      <OnboardingWizard
        userId={user.id}
        orgId={userOrgId || ''}
        language={language}
        onComplete={() => setShowOnboarding(false)}
      />
    );
  }

  const navSections: NavSection[] = [
    {
      label: null,
      items: [
        { id: 'ai-helper', label: 'Mr Lume', icon: MrLumeIcon as any, path: '/dashboard', tileColor: 'blue' },
        { id: 'day', label: t.common.day, icon: LayoutDashboard, path: '/day', tileColor: 'blue' },
      ],
    },
    {
      label: t.nav.crm,
      items: [
        { id: 'leads', label: t.nav.leads, icon: FileText, path: '/leads', tileColor: 'blue' },
        { id: 'pipeline', label: t.nav.pipeline, icon: Kanban, path: '/pipeline', tileColor: 'blue' },
        { id: 'clients', label: t.nav.clients, icon: Users, path: '/clients', tileColor: 'blue' },
      ],
    },
    {
      label: t.nav.operations,
      items: [
        { id: 'messages', label: t.nav.messages, icon: MessageSquare, path: '/messages', tileColor: 'blue' },
        { id: 'jobs', label: t.nav.jobs, icon: Briefcase, path: '/jobs', tileColor: 'blue' },
        { id: 'schedule', label: t.nav.calendar, icon: CalendarIcon, path: '/calendar', tileColor: 'blue' },
        { id: 'invoices', label: t.nav.invoices, icon: FileText, path: '/invoices', tileColor: 'blue' },
      ],
    },
    {
      label: 'Studio',
      items: [
        { id: 'director-panel', label: 'Director Panel', icon: Sparkles, path: '/director-panel', tileColor: 'blue' },
      ],
    },
  ];

  // "More" section — collapsed by default
  const moreNavItems: NavItem[] = [
    { id: 'availability', label: t.nav.availability, icon: CalendarClock, path: '/availability', tileColor: 'blue' },
    { id: 'timesheets', label: t.nav.timesheets, icon: Timer, path: '/timesheets', tileColor: 'blue' },
    { id: 'dispatch', label: t.location?.dispatchMap || 'Dispatch Map', icon: MapPin, path: '/dispatch', tileColor: 'blue' },
    { id: 'notes', label: t.noteBoards?.title || 'Note Boards', icon: StickyNote, path: '/notes', tileColor: 'blue' },
    { id: 'workflows', label: t.workflows?.title || 'Workflows', icon: Zap, path: '/workflows', tileColor: 'blue' },
    { id: 'payments', label: t.nav.payments, icon: CreditCard, path: '/payments', tileColor: 'blue' },
    { id: 'insights', label: t.nav.insights, icon: TrendingUp, path: '/insights', tileColor: 'blue' },
    { id: 'marketplace', label: 'Marketplace', icon: Store, path: '/settings/marketplace', tileColor: 'blue' },
  ];

  // Auto-expand "More" if the user is on a "more" page
  const moreIds = moreNavItems.map((i) => i.path);
  const isOnMorePage = moreIds.some((p) => location.pathname === p || location.pathname.startsWith(`${p}/`));

  const isActive = (path: string) => location.pathname === path || location.pathname.startsWith(`${path}/`);

  return (
    <JobModalControllerProvider>
      <Toaster
        richColors
        position="top-right"
        toastOptions={{
          className: '!rounded-lg !border !border-outline !shadow-md !text-[13px] !font-medium',
        }}
      />
      <div className="flex h-screen overflow-hidden bg-surface">
        {/* ─── Mobile sidebar overlay ─── */}
        {isSidebarOpen && (
          <div
            className="fixed inset-0 bg-black/30 z-30 md:hidden"
            onClick={() => setIsSidebarOpen(false)}
          />
        )}

        {/* ─── Sidebar ─── */}
        <motion.aside
          initial={false}
          animate={{ width: sidebarExpanded ? 220 : 52 }}
          transition={{ duration: 0.15, ease: [0.4, 0, 0.2, 1] }}
          onMouseEnter={() => { if (!isSidebarOpen) setIsSidebarHovered(true); }}
          onMouseLeave={() => setIsSidebarHovered(false)}
          className={cn(
            "bg-surface flex flex-col z-40 shrink-0 border-r border-outline",
            "max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:shadow-xl",
            !isSidebarOpen && "max-md:hidden",
            !isSidebarOpen && isSidebarHovered && "shadow-xl"
          )}
        >
          {/* Logo */}
          <div className="h-12 px-3 flex items-center justify-between">
            <AnimatePresence mode="wait">
              {sidebarExpanded ? (
                <motion.div
                  key="logo-full"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="pl-0.5"
                >
                  <img src="/lume-logo.png" alt="Lume CRM" className="h-14 w-auto object-contain dark:invert" />
                </motion.div>
              ) : (
                <motion.div
                  key="logo-short"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="mx-auto"
                >
                  <img src="/lume-logo.png" alt="Lume CRM" className="h-12 w-auto object-contain dark:invert" />
                </motion.div>
              )}
            </AnimatePresence>
            {sidebarExpanded && (
              <button
                onClick={() => {
                  if (isSidebarOpen) {
                    setIsSidebarOpen(false);
                  } else {
                    setIsSidebarOpen(true);
                    setIsSidebarHovered(false);
                  }
                }}
                className="p-1 rounded-md text-text-tertiary hover:text-text-secondary transition-colors"
              >
                {isSidebarOpen ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
              </button>
            )}
          </div>

          {/* Navigation */}
          <nav className="flex-1 px-2 py-1 overflow-y-auto space-y-px">
            {navSections.map((section, sIdx) => (
              <div key={sIdx}>
                {section.label && sidebarExpanded && (
                  <p className="px-2 pt-4 pb-1 text-[11px] font-medium text-text-tertiary">
                    {section.label}
                  </p>
                )}
                {!sidebarExpanded && sIdx > 0 && (
                  <div className="mx-2 my-2 border-t border-border-light" />
                )}
                <div className="space-y-px">
                  {section.items.map((item) => {
                    const active = isActive(item.path);
                    return (
                      <button
                        key={item.id}
                        onClick={() => navigate(item.path)}
                        title={!sidebarExpanded ? item.label : undefined}
                        className={cn(
                          "w-full flex items-center gap-2.5 px-2 py-[6px] rounded-md transition-all duration-75 text-[13px]",
                          sidebarExpanded ? "" : "justify-center",
                          active
                            ? "bg-surface-tertiary text-text-primary font-medium"
                            : "text-text-secondary hover:bg-surface-secondary hover:text-text-primary"
                        )}
                      >
                        <span className="relative">
                          <item.icon size={15} strokeWidth={active ? 2 : 1.75} className={cn(
                            active ? "text-text-primary" : "text-text-tertiary"
                          )} />
                          {item.id === 'messages' && unreadSms > 0 && !sidebarExpanded && (
                            <span className="absolute -top-1.5 -right-1.5 bg-danger text-white text-[7px] font-bold rounded-full min-w-[12px] h-[12px] flex items-center justify-center px-0.5">
                              {unreadSms > 9 ? '9+' : unreadSms}
                            </span>
                          )}
                        </span>
                        {sidebarExpanded && (
                          <>
                            <span className="truncate">{item.label}</span>
                            {item.id === 'messages' && unreadSms > 0 && (
                              <span className="ml-auto bg-danger text-white text-[9px] font-bold rounded-full min-w-[16px] h-[16px] flex items-center justify-center px-1 shrink-0">
                                {unreadSms > 9 ? '9+' : unreadSms}
                              </span>
                            )}
                          </>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

            {/* "More" collapsible section */}
            {sidebarExpanded && (
              <div>
                <button
                  onClick={() => setShowMoreNav(!showMoreNav)}
                  className="w-full flex items-center gap-2.5 px-2 py-[6px] rounded-md text-[13px] text-text-tertiary hover:bg-surface-secondary hover:text-text-primary transition-colors mt-1"
                >
                  <ChevronLeft size={15} strokeWidth={1.75} className={cn("text-text-tertiary transition-transform", showMoreNav || isOnMorePage ? "-rotate-90" : "rotate-0")} />
                  <span>{t.common.more}</span>
                </button>
                {(showMoreNav || isOnMorePage) && (
                  <div className="space-y-px mt-px">
                    {moreNavItems.map((item) => {
                      const active = isActive(item.path);
                      return (
                        <button
                          key={item.id}
                          onClick={() => navigate(item.path)}
                          className={cn(
                            "w-full flex items-center gap-2.5 px-2 py-[6px] rounded-md transition-all duration-75 text-[13px] pl-4",
                            active
                              ? "bg-surface-tertiary text-text-primary font-medium"
                              : "text-text-secondary hover:bg-surface-secondary hover:text-text-primary"
                          )}
                        >
                          <item.icon size={15} strokeWidth={active ? 2 : 1.75} className={cn(active ? "text-text-primary" : "text-text-tertiary")} />
                          <span className="truncate">{item.label}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
            {!sidebarExpanded && (
              <div className="mx-2 my-2 border-t border-border-light" />
            )}
            {!sidebarExpanded && moreNavItems.slice(0, 3).map((item) => {
              const active = isActive(item.path);
              return (
                <button
                  key={item.id}
                  onClick={() => navigate(item.path)}
                  title={item.label}
                  className={cn(
                    "w-full flex items-center justify-center py-[6px] rounded-md transition-all duration-75 text-[13px]",
                    active ? "bg-surface-tertiary text-text-primary font-medium" : "text-text-secondary hover:bg-surface-secondary hover:text-text-primary"
                  )}
                >
                  <item.icon size={15} strokeWidth={active ? 2 : 1.75} className={cn(active ? "text-text-primary" : "text-text-tertiary")} />
                </button>
              );
            })}
          </nav>

          {/* Footer */}
          <div className="p-2 space-y-px border-t border-border-light">
            <button
              onClick={() => setIsDark(!isDark)}
              title={!sidebarExpanded ? (isDark ? t.nav.lightMode : t.nav.darkMode) : undefined}
              className={cn(
                "w-full flex items-center gap-2.5 px-2 py-[6px] rounded-md text-[13px] text-text-secondary hover:bg-surface-secondary hover:text-text-primary transition-colors",
                !sidebarExpanded && "justify-center"
              )}
            >
              {isDark ? <Sun size={15} strokeWidth={1.75} className="text-text-tertiary" /> : <Moon size={15} strokeWidth={1.75} className="text-text-tertiary" />}
              {sidebarExpanded && <span>{isDark ? t.nav.lightMode : t.nav.darkMode}</span>}
            </button>
            <button
              onClick={() => navigate('/settings')}
              title={!sidebarExpanded ? t.nav.settings : undefined}
              className={cn(
                "w-full flex items-center gap-2.5 px-2 py-[6px] rounded-md text-[13px] transition-colors",
                isActive('/settings')
                  ? "bg-surface-tertiary text-text-primary font-medium"
                  : "text-text-secondary hover:bg-surface-secondary hover:text-text-primary",
                !sidebarExpanded && "justify-center"
              )}
            >
              <Settings size={15} strokeWidth={isActive('/settings') ? 2 : 1.75} className={cn(
                isActive('/settings') ? "text-text-primary" : "text-text-tertiary"
              )} />
              {sidebarExpanded && <span>{t.nav.settings}</span>}
            </button>
            <button
              onClick={() => supabase.auth.signOut()}
              title={!sidebarExpanded ? t.nav.signOut : undefined}
              className={cn(
                "w-full flex items-center gap-2.5 px-2 py-[6px] rounded-md text-[13px] text-text-secondary hover:bg-danger-light hover:text-danger transition-colors",
                !sidebarExpanded && "justify-center"
              )}
            >
              <LogOut size={15} strokeWidth={1.75} className="text-text-tertiary" />
              {sidebarExpanded && <span>{t.nav.signOut}</span>}
            </button>
          </div>
        </motion.aside>

        {/* ─── Main content ─── */}
        <main className="flex-1 flex flex-col overflow-hidden">
          {/* Top bar */}
          <header className="h-12 shrink-0 flex items-center gap-3 px-4 border-b border-outline bg-surface">
            {(!isSidebarOpen || true) && (
              <button
                onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                className={cn(
                  "p-1.5 rounded-md text-text-tertiary hover:text-text-primary hover:bg-surface-tertiary transition-colors",
                  isSidebarOpen && "hidden max-md:block"
                )}
              >
                <Menu size={16} />
              </button>
            )}
            <div className="flex-1 max-w-xl">
              <GlobalSearch />
            </div>
            <div className="ml-auto flex items-center gap-1">
              <button
                onClick={() => navigate('/messages')}
                title={t.nav.messages}
                className="p-2 rounded-md text-text-tertiary hover:text-text-primary hover:bg-surface-tertiary transition-colors relative"
              >
                <MessageSquare size={16} strokeWidth={1.75} />
                {unreadSms > 0 && (
                  <span className="absolute top-1 right-1 bg-danger text-white text-[8px] font-bold rounded-full min-w-[14px] h-[14px] flex items-center justify-center px-0.5">
                    {unreadSms > 9 ? '9+' : unreadSms}
                  </span>
                )}
              </button>
              <button
                onClick={() => { setActivityOpen(true); resetNotifCount(); }}
                title={language === 'fr' ? 'Centre d\'activités' : 'Activity Center'}
                className="p-2 rounded-md text-text-tertiary hover:text-text-primary hover:bg-surface-tertiary transition-colors relative"
              >
                <Bell size={16} strokeWidth={1.75} />
                {unreadNotifs > 0 && (
                  <span className="absolute top-1 right-1 bg-danger text-white text-[8px] font-bold rounded-full min-w-[14px] h-[14px] flex items-center justify-center px-0.5">
                    {unreadNotifs > 9 ? '9+' : unreadNotifs}
                  </span>
                )}
              </button>
              <button
                onClick={() => setHelpOpen(true)}
                title={t.nav.help || 'Help'}
                className="p-2 rounded-md text-text-tertiary hover:text-text-primary hover:bg-surface-tertiary transition-colors"
              >
                <HelpCircle size={16} strokeWidth={1.75} />
              </button>
              <div className="ml-1 avatar-sm">
                <UserCircle2 size={14} strokeWidth={1.75} />
              </div>
            </div>
          </header>

          {/* Page content */}
          <div className="flex-1 overflow-y-auto dot-grid">
            <div className="max-w-[1280px] mx-auto px-6 py-5">
              <AnimatePresence mode="wait">
                <motion.div
                  key={location.pathname}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.12, ease: [0.23, 1, 0.32, 1] }}
                >
                  <ErrorBoundary labels={t.errorBoundary}>
                    <Routes>
                      <Route path="/" element={<Navigate to="/dashboard" replace />} />
                      <Route path="/dashboard" element={<MrLumePage />} />
                      <Route path="/day" element={<Dashboard />} />
                      <Route path="/messages" element={<Messages />} />
                      <Route path="/leads" element={<Leads />} />
                      <Route path="/pipeline" element={<Pipeline />} />
                      <Route path="/clients" element={<Clients />} />
                      <Route path="/clients/:id" element={<ClientDetails />} />
                      <Route path="/jobs" element={<Jobs />} />
                      <Route path="/jobs/:id" element={<JobDetails />} />
                      <Route path="/calendar" element={<Schedule />} />
                      <Route path="/availability" element={<Availability />} />
                      <Route path="/search" element={<SearchResultsPage />} />
                      <Route path="/quotes" element={<Quotes />} />
                      <Route path="/quotes/:id" element={<QuoteDetails />} />
                      <Route path="/invoices" element={<Invoices />} />
                      <Route path="/invoices/new" element={<InvoiceEdit />} />
                      <Route path="/invoices/:id" element={<InvoiceDetails />} />
                      <Route path="/invoices/:id/edit" element={<InvoiceEdit />} />
                      <Route path="/insights" element={<Insights />} />
                      <Route path="/payments" element={<Payments />} />
                      <Route path="/payments/settings" element={<Navigate to="/settings?tab=payments" replace />} />
                      <Route path="/timesheets" element={<Timesheets />} />
                      {/* Tasks route removed — no longer in navigation */}
                      <Route path="/settings" element={<SettingsPage />} />
                      <Route path="/settings/payments" element={<PaymentSettings />} />
                      <Route path="/settings/products" element={<ProductsServices />} />
                      <Route path="/settings/automations" element={<Automations />} />
                      <Route path="/notes" element={<NoteBoards />} />
                      <Route path="/notes/:id" element={<NoteCanvas />} />
                      <Route path="/workflows" element={<Automations />} />
                      <Route path="/workflows/builder" element={<WorkflowsPage />} />
                      <Route path="/settings/company" element={<CompanySettings />} />
                      <Route path="/settings/team" element={<ManageTeam />} />
                      <Route path="/settings/team/:memberId" element={<TeamMemberDetails />} />
                      <Route path="/dispatch" element={<DispatchMap />} />
                      <Route path="/settings/marketplace" element={<AppMarketplace />} />
                      <Route path="/settings/phone-number" element={<PhoneNumberSettings />} />
                      <Route path="/settings/request-form" element={<RequestFormSettings />} />
                      <Route path="/quotes/templates" element={<QuoteTemplates />} />
                      <Route path="/apps/callback" element={<OAuthCallback />} />
                      <Route path="/settings/billing/checkout" element={<BillingCheckout />} />
                      <Route path="/settings/referrals" element={<ReferFriend />} />
                      {/* Director Panel routes */}
                      <Route path="/director-panel" element={<React.Suspense fallback={null}><DirectorLayout /></React.Suspense>}>
                        <Route index element={<React.Suspense fallback={null}><DirectorHome orgId={userOrgId || ''} /></React.Suspense>} />
                        <Route path="flows" element={<React.Suspense fallback={null}><DirectorFlows orgId={userOrgId || ''} /></React.Suspense>} />
                        <Route path="templates" element={<React.Suspense fallback={null}><DirectorTemplates /></React.Suspense>} />
                        <Route path="assets" element={<React.Suspense fallback={null}><DirectorAssets orgId={userOrgId || ''} /></React.Suspense>} />
                        <Route path="runs" element={<React.Suspense fallback={null}><DirectorRuns orgId={userOrgId || ''} /></React.Suspense>} />
                        <Route path="settings" element={<React.Suspense fallback={null}><DirectorSettings /></React.Suspense>} />
                        <Route path="styles" element={<React.Suspense fallback={null}><DirectorStyles /></React.Suspense>} />
                        <Route path="training" element={<React.Suspense fallback={null}><DirectorTraining /></React.Suspense>} />
                      </Route>
                      <Route path="*" element={<Navigate to="/dashboard" replace />} />

                    </Routes>
                  </ErrorBoundary>
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </main>
      </div>
      <HelpChat open={helpOpen} onClose={() => setHelpOpen(false)} />
      <ActivityCenter open={activityOpen} onClose={() => setActivityOpen(false)} />
      <AnimatePresence>
        {commandPaletteOpen && (
          <CommandPalette open={commandPaletteOpen} onClose={() => setCommandPaletteOpen(false)} language={language} />
        )}
      </AnimatePresence>
    </JobModalControllerProvider>
  );
}
