import React, { useState, useEffect } from 'react';
import {
  LayoutDashboard,
  Users,
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
  ClipboardList,
  GraduationCap,
  Trophy,
  DollarSign,
  Newspaper,
  MapPinned,
  GitBranch,
  Shield,
  UserCog,
  Lock,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from './lib/utils';
import Dashboard from './pages/Dashboard';
import CrmWorkspace from './pages/CrmWorkspace';
// Pipeline page kept but removed from nav — backend logic still used
// import Pipeline from './pages/Pipeline';
import Clients from './pages/Clients';
import ClientDetails from './pages/ClientDetails';
import Leads from './pages/Leads';
// Tasks page removed from navigation
import Schedule from './pages/Schedule';
import SettingsPage from './pages/Settings';
import Auth from './pages/Auth';
import Privacy from './pages/Privacy';
import Terms from './pages/Terms';
import PrivacyCenter from './pages/PrivacyCenter';
import Subprocessors from './pages/Subprocessors';
import { CookieBanner } from './components/CookieBanner';
import Landing from './pages/Landing';
import { supabase } from './lib/supabase';
import { User } from '@supabase/supabase-js';
import Jobs from './pages/Jobs';
import NotFound from './pages/NotFound';
import JobDetails from './pages/JobDetails';
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
// WorkflowsPage and WorkflowsHub removed — redirected to /automations
import CompanySettings from './pages/CompanySettings';
import ManageTeam from './pages/ManageTeam';
import TeamMemberDetails from './pages/TeamMemberDetails';
import GlobalSearch from './components/GlobalSearch';
import SearchResultsPage from './pages/SearchResults';
import Timesheets from './pages/Timesheets';
import QuoteView from './pages/QuoteView';
import Quotes from './pages/Quotes';
import QuoteDetails from './pages/QuoteDetails';
import type { TileColor } from './components/ui';
// HelpChat removed — ? button navigates to Lume Agent page
import ActivityCenter from './components/ActivityCenter';
import ErrorBoundary from './components/ErrorBoundary';
import ProductsServices from './pages/ProductsServices';
import AppMarketplace from './pages/AppMarketplace';
// PhoneNumberSettings removed from Settings nav
import RequestFormSettings from './pages/RequestFormSettings';
import QuotePresets from './pages/QuotePresets';
const QuoteMeasure = React.lazy(() => import('./pages/QuoteMeasure'));
import TaxSettings from './pages/TaxSettings';
import OAuthCallback from './pages/OAuthCallback';
import DispatchMap from './pages/DispatchMap';
// BillingCheckout removed — all checkout goes through /checkout (CheckoutFlow)
import OnboardingFlow from './pages/OnboardingFlow';
import CheckoutSuccess from './pages/CheckoutSuccess';
import AcceptInvitation from './pages/AcceptInvitation';
import Register from './pages/Register';
import VerifyEmail from './pages/VerifyEmail';
import ReferFriend from './pages/ReferFriend';
import MrLumePage from './features/agent/components/MrLumeChat';
import Messages from './pages/Messages';
import NoteBoards from './pages/NoteBoards';
import NoteCanvas from './pages/NoteCanvas';
import TasksPage from './pages/Tasks';
import Courses from './pages/Courses';
import CourseView from './pages/CourseView';
import CourseBuilder from './pages/CourseBuilder';
// Lume Agent icon for sidebar
const LumeAgentIcon = ({ size = 20, className = '' }: { size?: number; className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
    <path d="M12 3L20 7.5V16.5L12 21L4 16.5V7.5L12 3Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.5" />
  </svg>
);
import SatisfactionSurvey from './pages/SatisfactionSurvey';
import ClientPortal from './pages/ClientPortal';
import PublicPayment from './pages/PublicPayment';
import Leaderboard from './pages/Leaderboard';
import Commissions from './pages/Commissions';
import SocialFeed from './pages/SocialFeed';
import RepProfile from './pages/RepProfile';
import FieldSales from './pages/FieldSales';
import D2DMap from './pages/D2DMap';
import D2DPipeline from './pages/D2DPipeline';
import D2DDashboard from './pages/D2DDashboard';
import D2DReports from './pages/D2DReports';
import D2DSettingsGeneral from './pages/D2DSettingsGeneral';
import D2DSettingsTeams from './pages/D2DSettingsTeams';
import D2DOnboarding from './pages/D2DOnboarding';
import SettingsRoles from './pages/SettingsRoles';
import SettingsUsers from './pages/SettingsUsers';
import PermissionGate from './components/PermissionGate';
import ModuleGate from './components/ModuleGate';
import { useModuleAccess } from './hooks/useModuleAccess';
import type { PermissionKey } from './lib/permissions';
import { hasPermission } from './lib/permissions';
import { usePermissions } from './hooks/usePermissions';
import { useRealtimeNotifications } from './hooks/useRealtimeNotifications';
const MemoryGraphPage = React.lazy(() => import('./features/memory-graph/MemoryGraphPage'));
import OnboardingWizard from './components/OnboardingWizard';
import CommandPalette from './components/CommandPalette';
import DevRoleSwitcher from './components/DevRoleSwitcher';
import { CompanyProvider, useCompany } from './contexts/CompanyContext';
import { CompanySelectorPage, CompanySwitcher, NoCompanyState } from './components/CompanySelector';
import { useSessionTimeout } from './hooks/useSessionTimeout';
import { usePlatformOwner } from './hooks/usePlatformOwner';

// Marketing landing pages — from Lume-Landing-page-officielle repo
import MarketingLayout from './components/marketing/MarketingLayout';
import MarketingHome from './pages/marketing/Home';
import MarketingFeatures from './pages/marketing/Features';
import MarketingSolutions from './pages/marketing/Solutions';
import MarketingIndustries from './pages/marketing/Industries';
import MarketingIndustryDetail from './pages/marketing/IndustryDetail';
import MarketingPricing from './pages/marketing/Pricing';
import MarketingContact from './pages/marketing/Contact';

// Platform Admin — lazy loaded, owner-only
const PlatformAdmin = React.lazy(() => import('./pages/PlatformAdmin'));

type NavItem = {
  id: string;
  label: string;
  icon: typeof LayoutDashboard;
  path: string;
  tileColor: TileColor;
  /** Permission key required to see this nav item */
  requiredPermission?: PermissionKey;
};

type NavSection = {
  label: string | null;
  items: NavItem[];
};

/** Wrap a page element with a permission check */
function Gated({ permission, anyPermission, children }: { permission?: PermissionKey; anyPermission?: PermissionKey[]; children: React.ReactNode }) {
  return <PermissionGate permission={permission} anyPermission={anyPermission}>{children}</PermissionGate>;
}

/** Standard page wrapper — constrains width for form/list pages */
function PageWrapper({ children }: { children: React.ReactNode }) {
  return <div className="max-w-[1400px] mx-auto px-6 lg:px-10 py-8">{children}</div>;
}

/** Wrapper that resolves orgId from CompanyContext before rendering OnboardingWizard */
function OnboardingWizardWrapper({ userId, language, onComplete }: { userId: string; language: string; onComplete: () => void }) {
  const { currentOrgId, loading } = useCompany();
  if (loading) return <div className="h-screen w-screen flex items-center justify-center bg-surface"><div className="animate-pulse text-text-muted text-sm">Loading...</div></div>;
  return <OnboardingWizard userId={userId} orgId={currentOrgId || ''} language={language} onComplete={onComplete} />;
}

export default function App() {
  const { t, language } = useTranslation();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Auto-signout after 30 min of inactivity
  useSessionTimeout(user?.id || null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('lume-sidebar-open');
      if (saved === 'true' || saved === 'false') return saved === 'true';
    }
    return true;
  });
  useEffect(() => {
    try { localStorage.setItem('lume-sidebar-open', String(isSidebarOpen)); } catch {}
  }, [isSidebarOpen]);
  const [isSidebarHovered, setIsSidebarHovered] = useState(false);
  const sidebarExpanded = isSidebarOpen || isSidebarHovered;
  const [view, setView] = useState<'landing' | 'auth'>('landing');
  const [isDark, setIsDark] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('lume-theme');
      if (saved) return saved === 'dark';
    }
    return false;
  });
  // helpOpen state removed — ? button navigates to Lume Agent
  const [activityOpen, setActivityOpen] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [hasSubscription, setHasSubscription] = useState<boolean | null>(null); // null = checking
  const [onboardingChecked, setOnboardingChecked] = useState(false);
  const [showMoreNav, setShowMoreNav] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('lume-sidebar-more');
      if (saved === 'true' || saved === 'false') return saved === 'true';
    }
    return false;
  });
  useEffect(() => {
    try { localStorage.setItem('lume-sidebar-more', String(showMoreNav)); } catch {}
  }, [showMoreNav]);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { unreadCount: unreadNotifs, resetCount: resetNotifCount } = useRealtimeNotifications(!!user);
  const [unreadSms, setUnreadSms] = useState(0);

  // Fetch unread SMS count + realtime subscription
  useEffect(() => {
    if (!user) { setUnreadSms(0); return; }

    const loadUnread = async () => {
      // Scope to user's org for multi-tenant isolation
      const { data: membership } = await supabase
        .from('memberships')
        .select('org_id')
        .eq('user_id', user.id)
        .limit(1)
        .maybeSingle();
      const oid = membership?.org_id;
      if (!oid) { setUnreadSms(0); return; }

      const { data } = await supabase
        .from('conversations')
        .select('unread_count')
        .eq('org_id', oid);
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
  // Also ensures every user has an org + membership (auto-provision on first login)
  useEffect(() => {
    if (!user || onboardingChecked) return;
    (async () => {
      try {
        // 1. Ensure user has at least one membership (auto-provision org if missing)
        const { data: mem } = await supabase
          .from('memberships')
          .select('org_id')
          .eq('user_id', user.id)
          .limit(1)
          .maybeSingle();

        if (!mem) {
          // No membership — this is a brand new user who signed up via email/password or Google.
          // Create an org + membership for them so the rest of the app works.
          try {
            const { data: newOrg } = await supabase
              .from('orgs')
              .insert({ name: user.email?.split('@')[0] || 'My Workspace', created_by: user.id })
              .select('id')
              .single();

            if (newOrg) {
              await supabase
                .from('memberships')
                .insert({ user_id: user.id, org_id: newOrg.id, role: 'owner' });
              console.log('[App] Auto-provisioned org', newOrg.id, 'for user', user.id);
            }
          } catch (provErr: any) {
            console.warn('[App] Failed to auto-provision org:', provErr?.message);
          }
        }

        // 2. Check if onboarding is done
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

  // Check if user has an active subscription — redirect to /checkout if not
  // Beta bypass list sourced exclusively from env (comma-separated emails).
  const BYPASS_EMAILS = (import.meta.env.VITE_BETA_BYPASS_EMAILS || '')
    .split(',')
    .map((e: string) => e.trim().toLowerCase())
    .filter(Boolean);
  useEffect(() => {
    if (!user || !onboardingChecked || showOnboarding) { setHasSubscription(null); return; }
    // Bypass for beta emails whitelisted via env
    if (user.email && BYPASS_EMAILS.includes(user.email.toLowerCase())) {
      setHasSubscription(true);
      return;
    }
    (async () => {
      try {
        const { data: mem } = await supabase.from('memberships').select('org_id').eq('user_id', user.id).limit(1).maybeSingle();
        if (!mem) { setHasSubscription(false); return; }
        const { data: sub } = await supabase
          .from('subscriptions')
          .select('id, status')
          .eq('org_id', mem.org_id)
          .in('status', ['active', 'trialing'])
          .limit(1)
          .maybeSingle();
        setHasSubscription(!!sub);
      } catch {
        // If subscriptions table doesn't exist, treat as having a subscription (don't block)
        setHasSubscription(true);
      }
    })();
  }, [user, onboardingChecked, showOnboarding]);

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

  // Public checkout — accessible with or without auth
  if (location.pathname === '/checkout/success') {
    return <CheckoutSuccess />;
  }
  if (location.pathname === '/checkout') {
    return <OnboardingFlow />;
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

  if (!user) {
    if (view === 'auth') {
      return <Auth onBack={() => setView('landing')} />;
    }
    return (
      <>
        <CookieBanner />
        <Routes>
          <Route path="/auth" element={<Auth onBack={() => setView('landing')} />} />
          <Route path="/register" element={<Register />} />
          <Route path="/verify-email" element={<VerifyEmail />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/subprocessors" element={<Subprocessors />} />
          <Route element={<MarketingLayout />}>
            <Route index element={<MarketingHome />} />
            <Route path="features" element={<MarketingFeatures />} />
            <Route path="solutions" element={<MarketingSolutions />} />
            <Route path="industries" element={<MarketingIndustries />} />
            <Route path="industries/:slug" element={<MarketingIndustryDetail />} />
            <Route path="pricing" element={<MarketingPricing />} />
            <Route path="contact" element={<MarketingContact />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </>
    );
  }

  // ── Subscription guard ──
  // User is logged in but has no active subscription.
  // They can see: landing, marketing pages, checkout, auth pages.
  // Any app page (dashboard, settings, etc.) redirects to landing.
  if (user && hasSubscription === false) {
    return (
      <Routes>
        <Route path="/checkout/success" element={<CheckoutSuccess />} />
        <Route path="/checkout" element={<OnboardingFlow />} />
        <Route path="/auth" element={<Auth onBack={() => setView('landing')} />} />
        <Route path="/register" element={<Register />} />
        <Route path="/verify-email" element={<VerifyEmail />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/terms" element={<Terms />} />
          <Route path="/subprocessors" element={<Subprocessors />} />
        <Route element={<MarketingLayout />}>
          <Route index element={<MarketingHome />} />
          <Route path="features" element={<MarketingFeatures />} />
          <Route path="solutions" element={<MarketingSolutions />} />
          <Route path="industries" element={<MarketingIndustries />} />
          <Route path="industries/:slug" element={<MarketingIndustryDetail />} />
          <Route path="pricing" element={<MarketingPricing />} />
          <Route path="contact" element={<MarketingContact />} />
        </Route>
        {/* Any unknown/app route → back to landing */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    );
  }

  // Show onboarding wizard for new users (only AFTER they have a subscription)
  if (showOnboarding && user) {
    return (
      <CompanyProvider userId={user.id}>
        <OnboardingWizardWrapper userId={user.id} language={language} onComplete={() => setShowOnboarding(false)} />
      </CompanyProvider>
    );
  }

  return (
    <CompanyProvider userId={user.id}>
    <AuthenticatedApp
      user={user}
      language={language}
      t={t}
      isDark={isDark}
      setIsDark={setIsDark}
      isSidebarOpen={isSidebarOpen}
      setIsSidebarOpen={setIsSidebarOpen}
      isSidebarHovered={isSidebarHovered}
      setIsSidebarHovered={setIsSidebarHovered}
      sidebarExpanded={sidebarExpanded}
      showMoreNav={showMoreNav}
      setShowMoreNav={setShowMoreNav}
      commandPaletteOpen={commandPaletteOpen}
      setCommandPaletteOpen={setCommandPaletteOpen}
      activityOpen={activityOpen}
      setActivityOpen={setActivityOpen}
      unreadSms={unreadSms}
      unreadNotifs={unreadNotifs}
      resetNotifCount={resetNotifCount}
      navigate={navigate}
      location={location}
    />
    </CompanyProvider>
  );
}

// ── Authenticated App Shell (inside CompanyProvider) ──────────────────

function AuthenticatedApp({
  user,
  language,
  t,
  isDark,
  setIsDark,
  isSidebarOpen,
  setIsSidebarOpen,
  isSidebarHovered,
  setIsSidebarHovered,
  sidebarExpanded,
  showMoreNav,
  setShowMoreNav,
  commandPaletteOpen,
  setCommandPaletteOpen,
  activityOpen,
  setActivityOpen,
  unreadSms,
  unreadNotifs,
  resetNotifCount,
  navigate,
  location,
}: any) {
  const { current, companies, loading: companyLoading, isMultiCompany, hasNoCompany, currentOrgId } = useCompany();

  // Sidebar counters: pending quotes + overdue invoices
  const [pendingQuotes, setPendingQuotes] = useState(0);
  const [overdueInvoices, setOverdueInvoices] = useState(0);
  useEffect(() => {
    if (!user || !currentOrgId) { setPendingQuotes(0); setOverdueInvoices(0); return; }
    const load = async () => {
      const [qRes, iRes] = await Promise.all([
        supabase.from('quotes').select('status', { count: 'exact', head: true }).eq('org_id', currentOrgId).is('deleted_at', null).in('status', ['sent', 'awaiting_response', 'action_required']),
        supabase.from('invoices').select('status', { count: 'exact', head: true }).eq('org_id', currentOrgId).is('deleted_at', null).eq('status', 'sent').lt('due_date', new Date().toISOString().slice(0, 10)),
      ]);
      setPendingQuotes(qRes.count || 0);
      setOverdueInvoices(iRes.count || 0);
    };
    load();
    const interval = setInterval(load, 60_000);
    return () => clearInterval(interval);
  }, [user, currentOrgId]);
  // usePermissions MUST be called inside CompanyProvider to get correct data
  const permsCtx = usePermissions();
  const isPlatformOwner = usePlatformOwner();
  const venteModule = useModuleAccess('module_vente');

  // Still loading company memberships
  if (companyLoading) {
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

  // No company: show error / invitation prompt
  if (hasNoCompany) {
    return <NoCompanyState />;
  }

  // Multi-company without active selection: show selector
  if (isMultiCompany && !current) {
    return <CompanySelectorPage />;
  }

  /** Filter nav items based on user permissions */
  const canSee = (item: NavItem) => {
    if (!item.requiredPermission) return true;
    if (permsCtx.role === 'owner') return true;
    return hasPermission(permsCtx.permissions, item.requiredPermission, permsCtx.role ?? undefined);
  };

  const navSections: NavSection[] = [
    {
      label: null,
      items: [
        { id: 'ai-helper', label: 'Lume Agent', icon: LumeAgentIcon as any, path: '/dashboard', tileColor: 'blue', requiredPermission: 'ai.use' },
        { id: 'day', label: 'CRM', icon: LayoutDashboard, path: '/day', tileColor: 'blue' },
      ],
    },
    {
      label: language === 'fr' ? 'Principal' : 'Main',
      items: [
        { id: 'clients', label: t.nav.clients, icon: Users, path: '/clients', tileColor: 'blue', requiredPermission: 'clients.read' },
        { id: 'quotes', label: language === 'fr' ? 'Devis' : 'Quotes', icon: ClipboardList, path: '/quotes', tileColor: 'blue', requiredPermission: 'quotes.read' },
        { id: 'invoices', label: t.nav.invoices, icon: FileText, path: '/invoices', tileColor: 'blue', requiredPermission: 'financial.view_invoices' },
        { id: 'jobs', label: t.nav.jobs, icon: Briefcase, path: '/jobs', tileColor: 'blue', requiredPermission: 'jobs.read' },
        { id: 'schedule', label: t.nav.calendar, icon: CalendarIcon, path: '/calendar', tileColor: 'blue', requiredPermission: 'calendar.read' },
      ],
    },
    {
      label: language === 'fr' ? 'Outils' : 'Tools',
      items: [
        { id: 'messages', label: t.nav.messages, icon: MessageSquare, path: '/messages', tileColor: 'blue', requiredPermission: 'messages.read' },
        { id: 'timesheets', label: t.nav.timesheets, icon: Timer, path: '/timesheets', tileColor: 'blue', requiredPermission: 'timesheets.read' },
        { id: 'courses', label: t.courses?.title || 'Courses', icon: GraduationCap, path: '/courses', tileColor: 'blue' },
        { id: 'payments', label: t.nav.payments, icon: CreditCard, path: '/payments', tileColor: 'blue', requiredPermission: 'financial.view_payments' },
        ...(isPlatformOwner ? [{ id: 'platform-admin', label: 'Platform Admin', icon: Shield, path: '/platform-admin', tileColor: 'blue' as const }] : []),
      ],
    },
    {
      label: t.nav.d2d,
      items: venteModule.isEnabled
        ? [
            { id: 'd2d-dashboard', label: t.nav.venteDashboard, icon: LayoutDashboard, path: '/d2d-dashboard', tileColor: 'blue', requiredPermission: 'door_to_door.access' },
            { id: 'field-sales', label: t.nav.venteMap, icon: MapPinned, path: '/field-sales', tileColor: 'blue', requiredPermission: 'door_to_door.access' },
            { id: 'd2d-pipeline', label: t.nav.ventePipeline, icon: GitBranch, path: '/d2d-pipeline', tileColor: 'blue', requiredPermission: 'door_to_door.access' },
            { id: 'leaderboard', label: t.nav.leaderboard, icon: Trophy, path: '/leaderboard', tileColor: 'blue', requiredPermission: 'financial.view_reports' },
            { id: 'commissions', label: t.nav.commissions, icon: DollarSign, path: '/commissions', tileColor: 'blue', requiredPermission: 'financial.view_reports' },
          ]
        : [
            { id: 'vente-locked', label: t.nav.d2d, icon: Lock, path: '/d2d-dashboard', tileColor: 'blue' },
          ],
    },
  ] as NavSection[];

  // Filter nav items by permissions
  const filteredNavSections = navSections
    .map((section) => ({ ...section, items: section.items.filter(canSee) }))
    .filter((section) => section.items.length > 0);

  // "More" section — collapsed by default
  const moreNavItems: NavItem[] = ([
    { id: 'insights', label: language === 'fr' ? 'Statistiques' : 'Statistics', icon: TrendingUp, path: '/insights', tileColor: 'blue' as const, requiredPermission: 'financial.view_analytics' as PermissionKey },
    { id: 'tasks', label: language === 'fr' ? 'Tâches' : 'Tasks', icon: ClipboardList, path: '/tasks', tileColor: 'blue' as const, requiredPermission: 'leads.read' as PermissionKey },
    { id: 'automations', label: t.workflows?.title || 'Automations', icon: Zap, path: '/automations', tileColor: 'blue' as const, requiredPermission: 'automations.read' as PermissionKey },
    { id: 'marketplace', label: 'Marketplace', icon: Store, path: '/settings/marketplace', tileColor: 'blue' as const, requiredPermission: 'integrations.read' as PermissionKey },
  ] as NavItem[]).filter(canSee);

  // Auto-expand "More" if the user is on a "more" page
  const moreIds = moreNavItems.map((i) => i.path);
  const isOnMorePage = moreIds.some((p) => location.pathname === p || location.pathname.startsWith(`${p}/`));

  const isActive = (path: string) => location.pathname === path || location.pathname.startsWith(`${path}/`);

  return (
    <JobModalControllerProvider>
      <Toaster
        richColors
        // On mobile, top-right overlaps the header / floats badly; bottom-center keeps
        // toasts out of the way of scroll content.
        position={typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches ? 'bottom-center' : 'top-right'}
        toastOptions={{
          className: '!rounded-lg !border !border-outline !shadow-md !text-[13px] !font-medium',
        }}
      />
      <CookieBanner />
      <div className="flex h-screen overflow-hidden bg-surface">
        {/* ─── Mobile sidebar overlay ─── */}
        {isSidebarOpen && (
          <div
            className="fixed inset-0 bg-black/30 z-30 md:hidden"
            onClick={() => setIsSidebarOpen(false)}
          />
        )}

        {/* ─── Sidebar — Premium ─── */}
        <motion.aside
          initial={false}
          animate={{ width: sidebarExpanded ? 232 : 56 }}
          transition={{ duration: 0.18, ease: [0.2, 0, 0, 1] }}
          onMouseEnter={() => { if (!isSidebarOpen) setIsSidebarHovered(true); }}
          onMouseLeave={() => setIsSidebarHovered(false)}
          className={cn(
            "bg-sidebar dark:bg-sidebar flex flex-col z-40 shrink-0 border-r border-outline/40",
            "max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:shadow-2xl",
            !isSidebarOpen && "max-md:hidden",
            !isSidebarOpen && isSidebarHovered && "shadow-2xl"
          )}
        >
          {/* Logo */}
          <div className="h-14 px-3 flex items-center justify-between">
            <AnimatePresence mode="wait">
              {sidebarExpanded ? (
                <motion.div
                  key="logo-full"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="pl-1"
                >
                  <img src="/lume-logo-v2.png" alt="Lume CRM" className="h-7 w-auto object-contain" />
                </motion.div>
              ) : (
                <motion.div
                  key="logo-short"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="mx-auto"
                >
                  <img src="/lume-logo-v2.png" alt="Lume CRM" className="h-6 w-auto object-contain" />
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
                className="p-1.5 rounded-lg text-sidebar-text hover:text-sidebar-text-active hover:bg-sidebar-hover transition-all"
              >
                {isSidebarOpen ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
              </button>
            )}
          </div>

          {/* Active company name */}
          {sidebarExpanded && current?.companyName && (
            <div className="px-4 pb-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-sidebar-text/50 truncate">
                {current.companyName}
              </p>
            </div>
          )}

          {/* Navigation */}
          <nav className="flex-1 px-2.5 py-2 overflow-y-auto space-y-0.5">
            {filteredNavSections.map((section, sIdx) => (
              <div key={sIdx}>
                {section.label && sidebarExpanded && (
                  <p className="px-2.5 pt-5 pb-1.5 text-[10.5px] font-bold uppercase tracking-wider text-sidebar-text/70">
                    {section.label}
                  </p>
                )}
                {!sidebarExpanded && sIdx > 0 && (
                  <div className="mx-2 my-3 border-t border-sidebar-text/10" />
                )}
                <div className="space-y-0.5">
                  {section.items.map((item) => {
                    const active = isActive(item.path);
                    return (
                      <button
                        key={item.id}
                        onClick={() => navigate(item.path)}
                        title={!sidebarExpanded ? item.label : undefined}
                        className={cn(
                          "w-full flex items-center gap-2.5 px-2.5 py-[8px] rounded-lg transition-all duration-100 text-[14px] relative",
                          sidebarExpanded ? "" : "justify-center",
                          active
                            ? "bg-sidebar-active text-sidebar-text-active font-semibold"
                            : "text-sidebar-text font-medium hover:bg-sidebar-hover hover:text-sidebar-text-active"
                        )}
                      >
                        {active && (
                          <motion.div
                            layoutId="sidebar-active"
                            className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full bg-sidebar-accent"
                            transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                          />
                        )}
                        <span className="relative">
                          <item.icon size={17} strokeWidth={active ? 2.2 : 1.8} className={cn(
                            active ? "text-sidebar-text-active" : "text-sidebar-text"
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
                            {item.id === 'quotes' && pendingQuotes > 0 && (
                              <span className="ml-auto bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 text-[9px] font-bold rounded-full min-w-[16px] h-[16px] flex items-center justify-center px-1 shrink-0">
                                {pendingQuotes}
                              </span>
                            )}
                            {item.id === 'invoices' && overdueInvoices > 0 && (
                              <span className="ml-auto bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400 text-[9px] font-bold rounded-full min-w-[16px] h-[16px] flex items-center justify-center px-1 shrink-0">
                                {overdueInvoices}
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
                  className="w-full flex items-center gap-2.5 px-2.5 py-[8px] rounded-lg text-[14px] font-medium text-sidebar-text hover:bg-sidebar-hover hover:text-sidebar-text-active transition-colors mt-1"
                >
                  <ChevronLeft size={15} strokeWidth={1.8} className={cn("text-sidebar-text transition-transform duration-150", showMoreNav || isOnMorePage ? "-rotate-90" : "rotate-0")} />
                  <span>{t.common.more}</span>
                </button>
                {(showMoreNav || isOnMorePage) && (
                  <div className="space-y-0.5 mt-0.5">
                    {moreNavItems.map((item) => {
                      const active = isActive(item.path);
                      return (
                        <button
                          key={item.id}
                          onClick={() => navigate(item.path)}
                          className={cn(
                            "w-full flex items-center gap-2.5 px-2.5 py-[8px] rounded-lg transition-all duration-100 text-[14px] pl-5 relative",
                            active
                              ? "bg-sidebar-active text-sidebar-text-active font-semibold"
                              : "text-sidebar-text font-medium hover:bg-sidebar-hover hover:text-sidebar-text-active"
                          )}
                        >
                          {active && (
                            <div className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full bg-sidebar-accent" />
                          )}
                          <item.icon size={17} strokeWidth={active ? 2.2 : 1.8} className={cn(active ? "text-sidebar-text-active" : "text-sidebar-text")} />
                          <span className="truncate">{item.label}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
            {!sidebarExpanded && (
              <div className="mx-2 my-3 border-t border-border-light" />
            )}
            {!sidebarExpanded && moreNavItems.slice(0, 3).map((item) => {
              const active = isActive(item.path);
              return (
                <button
                  key={item.id}
                  onClick={() => navigate(item.path)}
                  title={item.label}
                  className={cn(
                    "w-full flex items-center justify-center py-[8px] rounded-lg transition-all duration-100 text-[14px]",
                    active ? "bg-sidebar-active text-sidebar-text-active font-semibold" : "text-sidebar-text font-medium hover:bg-sidebar-hover hover:text-sidebar-text-active"
                  )}
                >
                  <item.icon size={17} strokeWidth={active ? 2.2 : 1.8} className={cn(active ? "text-sidebar-text-active" : "text-sidebar-text")} />
                </button>
              );
            })}
          </nav>

          {/* Footer */}
          <div className="p-2.5 space-y-0.5 border-t border-sidebar-text/10">
            {/* Company switcher — only visible for multi-company users */}
            {sidebarExpanded && <CompanySwitcher />}
            <DevRoleSwitcher expanded={sidebarExpanded} />
            <button
              onClick={() => setIsDark(!isDark)}
              title={!sidebarExpanded ? (isDark ? t.nav.lightMode : t.nav.darkMode) : undefined}
              className={cn(
                "w-full flex items-center gap-2.5 px-2.5 py-[8px] rounded-lg text-[14px] font-medium text-sidebar-text hover:bg-sidebar-hover hover:text-sidebar-text-active transition-colors",
                !sidebarExpanded && "justify-center"
              )}
            >
              {isDark ? <Sun size={17} strokeWidth={1.8} className="text-sidebar-text" /> : <Moon size={17} strokeWidth={1.8} className="text-sidebar-text" />}
              {sidebarExpanded && <span>{isDark ? t.nav.lightMode : t.nav.darkMode}</span>}
            </button>
            <button
              onClick={() => navigate('/settings')}
              title={!sidebarExpanded ? t.nav.settings : undefined}
              className={cn(
                "w-full flex items-center gap-2.5 px-2.5 py-[8px] rounded-lg text-[14px] font-medium transition-colors relative",
                isActive('/settings')
                  ? "bg-sidebar-active text-sidebar-text-active font-semibold"
                  : "text-sidebar-text hover:bg-sidebar-hover hover:text-sidebar-text-active",
                !sidebarExpanded && "justify-center"
              )}
            >
              {isActive('/settings') && (
                <div className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full bg-sidebar-accent" />
              )}
              <Settings size={17} strokeWidth={isActive('/settings') ? 2.2 : 1.8} className={cn(
                isActive('/settings') ? "text-sidebar-text-active" : "text-sidebar-text"
              )} />
              {sidebarExpanded && <span>{t.nav.settings}</span>}
            </button>
            <button
              onClick={() => supabase.auth.signOut()}
              title={!sidebarExpanded ? t.nav.signOut : undefined}
              className={cn(
                "w-full flex items-center gap-2.5 px-2.5 py-[8px] rounded-lg text-[14px] font-medium text-sidebar-text hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30 dark:hover:text-red-400 transition-colors",
                !sidebarExpanded && "justify-center"
              )}
            >
              <LogOut size={17} strokeWidth={1.8} className="text-sidebar-text group-hover:text-red-600" />
              {sidebarExpanded && <span>{t.nav.signOut}</span>}
            </button>
          </div>
        </motion.aside>

        {/* ─── Main content ─── */}
        <main className="flex-1 flex flex-col overflow-hidden">
          {/* Top bar — premium, elevated */}
          <header className="h-12 shrink-0 flex items-center gap-3 px-5 border-b border-border bg-surface-elevated">
            {(!isSidebarOpen || true) && (
              <button
                onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                className={cn(
                  "p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-tertiary transition-colors",
                  isSidebarOpen && "hidden max-md:block"
                )}
              >
                <Menu size={17} />
              </button>
            )}
            <div className="flex-1 max-w-xl">
              <GlobalSearch />
            </div>
            <div className="ml-auto flex items-center gap-0.5">
              <button
                onClick={() => navigate('/messages')}
                title={t.nav.messages}
                className="p-2 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-tertiary transition-all relative"
              >
                <MessageSquare size={17} strokeWidth={1.75} />
                {unreadSms > 0 && (
                  <span className="absolute top-1 right-1 bg-danger text-white text-[8px] font-bold rounded-full min-w-[14px] h-[14px] flex items-center justify-center px-0.5 shadow-sm">
                    {unreadSms > 9 ? '9+' : unreadSms}
                  </span>
                )}
              </button>
              <button
                onClick={() => { setActivityOpen(true); resetNotifCount(); }}
                title={language === 'fr' ? 'Centre d\'activités' : 'Activity Center'}
                className="p-2 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-tertiary transition-all relative"
              >
                <Bell size={17} strokeWidth={1.75} />
                {unreadNotifs > 0 && (
                  <span className="absolute top-1 right-1 bg-danger text-white text-[8px] font-bold rounded-full min-w-[14px] h-[14px] flex items-center justify-center px-0.5 shadow-sm">
                    {unreadNotifs > 9 ? '9+' : unreadNotifs}
                  </span>
                )}
              </button>
              <button
                onClick={() => navigate('/dashboard')}
                title="Lume Agent"
                className="p-2 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-tertiary transition-all"
              >
                <HelpCircle size={17} strokeWidth={1.75} />
              </button>
              <div className="ml-1.5 avatar-sm">
                <UserCircle2 size={15} strokeWidth={1.75} />
              </div>
            </div>
          </header>

          {/* Page content */}
          <div className="flex-1 overflow-y-auto">
            <ErrorBoundary labels={t.errorBoundary}>
                  <Routes>
                    <Route path="/" element={<Navigate to="/dashboard" replace />} />
                    <Route path="/dashboard" element={<Gated permission="ai.use"><PageWrapper><MrLumePage /></PageWrapper></Gated>} />
                    <Route path="/day" element={<Gated permission="settings.read"><PageWrapper><CrmWorkspace /></PageWrapper></Gated>} />
                    <Route path="/messages" element={<Gated permission="messages.read"><PageWrapper><Messages /></PageWrapper></Gated>} />
                    <Route path="/leads" element={<Navigate to="/quotes" replace />} />
                    <Route path="/pipeline" element={<Navigate to="/dashboard" replace />} />
                    <Route path="/clients" element={<Gated permission="clients.read"><div className="px-8 py-6"><Clients /></div></Gated>} />
                    <Route path="/clients/:id" element={<Gated permission="clients.read"><div className="px-8 py-6"><ClientDetails /></div></Gated>} />
                    <Route path="/jobs" element={<Gated permission="jobs.read"><div className="px-8 py-6"><Jobs /></div></Gated>} />
                    <Route path="/jobs/:id" element={<Gated permission="jobs.read"><PageWrapper><JobDetails /></PageWrapper></Gated>} />
                    <Route path="/calendar" element={<Gated permission="calendar.read"><Schedule /></Gated>} />
                    <Route path="/availability" element={<Navigate to="/timesheets?view=disponibilites" replace />} />
                    <Route path="/search" element={<Gated permission="settings.read"><PageWrapper><SearchResultsPage /></PageWrapper></Gated>} />
                    <Route path="/quotes" element={<Gated permission="quotes.read"><div className="px-8 py-6"><Quotes /></div></Gated>} />
                    <Route path="/quotes/measure" element={<Gated permission="quotes.read"><React.Suspense fallback={null}><QuoteMeasure /></React.Suspense></Gated>} />
                    <Route path="/quotes/presets" element={<Gated permission="settings.read"><PageWrapper><QuotePresets /></PageWrapper></Gated>} />
                    <Route path="/quotes/templates" element={<Gated permission="settings.read"><PageWrapper><QuotePresets /></PageWrapper></Gated>} />
                    <Route path="/quotes/:id" element={<Gated permission="quotes.read"><PageWrapper><QuoteDetails /></PageWrapper></Gated>} />
                    <Route path="/quotes/:id/measure" element={<Gated permission="quotes.read"><React.Suspense fallback={null}><QuoteMeasure /></React.Suspense></Gated>} />
                    <Route path="/invoices" element={<Gated permission="invoices.read"><PageWrapper><Invoices /></PageWrapper></Gated>} />
                    <Route path="/invoices/new" element={<Gated permission="invoices.create"><PageWrapper><InvoiceEdit /></PageWrapper></Gated>} />
                    <Route path="/invoices/:id" element={<Gated permission="invoices.read"><PageWrapper><InvoiceDetails /></PageWrapper></Gated>} />
                    <Route path="/invoices/:id/edit" element={<Gated permission="invoices.update"><PageWrapper><InvoiceEdit /></PageWrapper></Gated>} />
                    <Route path="/insights" element={<Gated permission="reports.read"><PageWrapper><Insights /></PageWrapper></Gated>} />
                    <Route path="/payments" element={<Gated permission="payments.read"><PageWrapper><Payments /></PageWrapper></Gated>} />
                    <Route path="/payments/settings" element={<Navigate to="/settings?tab=payments" replace />} />
                    <Route path="/timesheets" element={<Gated permission="timesheets.read"><PageWrapper><Timesheets /></PageWrapper></Gated>} />
                    <Route path="/settings" element={<Gated permission="settings.read"><PageWrapper><SettingsPage /></PageWrapper></Gated>} />
                    <Route path="/account/privacy" element={<PageWrapper><PrivacyCenter /></PageWrapper>} />
                    <Route path="/privacy" element={<Privacy />} />
                    <Route path="/terms" element={<Terms />} />
          <Route path="/subprocessors" element={<Subprocessors />} />
                    <Route path="/settings/payments" element={<Gated permission="settings.read"><PageWrapper><PaymentSettings /></PageWrapper></Gated>} />
                    <Route path="/settings/products" element={<Gated permission="settings.update"><PageWrapper><ProductsServices /></PageWrapper></Gated>} />
                    <Route path="/automations" element={<Gated permission="automations.read"><PageWrapper><Automations /></PageWrapper></Gated>} />
                    <Route path="/tasks" element={<Gated permission="settings.read"><PageWrapper><TasksPage /></PageWrapper></Gated>} />
                    <Route path="/courses" element={<Gated permission="settings.read"><div className="px-8 py-6"><Courses /></div></Gated>} />
                    <Route path="/training" element={<Navigate to="/courses" replace />} />
                    <Route path="/courses/new" element={<Gated permission="settings.update"><CourseBuilder /></Gated>} />
                    <Route path="/courses/:id" element={<Gated permission="settings.read"><CourseView /></Gated>} />
                    <Route path="/courses/:id/edit" element={<Gated permission="settings.update"><CourseBuilder /></Gated>} />
                    <Route path="/notes" element={<Gated permission="settings.read"><PageWrapper><NoteBoards /></PageWrapper></Gated>} />
                    <Route path="/notes/:id" element={<Gated permission="settings.read"><NoteCanvas /></Gated>} />
                    <Route path="/automations/hub" element={<Navigate to="/automations" replace />} />
                    <Route path="/automations/builder" element={<Navigate to="/automations" replace />} />
                    <Route path="/settings/company" element={<Gated permission="settings.update"><PageWrapper><CompanySettings /></PageWrapper></Gated>} />
                    <Route path="/company-settings" element={<Navigate to="/settings/company" replace />} />
                    <Route path="/settings/team" element={<Gated permission="team.read"><PageWrapper><ManageTeam /></PageWrapper></Gated>} />
                    <Route path="/manage-team" element={<Navigate to="/settings/team" replace />} />
                    <Route path="/settings/team/:memberId" element={<Gated permission="team.read"><PageWrapper><TeamMemberDetails /></PageWrapper></Gated>} />
                    {/* Dispatch: NO PageWrapper — full-bleed */}
                    <Route path="/dispatch" element={<Gated permission="map.access"><DispatchMap /></Gated>} />
                    {/* Vente (ex-D2D) — gated by module activation */}
                    <Route path="/field-sales" element={<Gated permission="door_to_door.access"><ModuleGate moduleKey="module_vente" moduleName={t.nav.d2d}><D2DMap /></ModuleGate></Gated>} />
                    <Route path="/d2d-dashboard" element={<ModuleGate moduleKey="module_vente" moduleName={t.nav.d2d}><PageWrapper><D2DDashboard /></PageWrapper></ModuleGate>} />
                    <Route path="/d2d-pipeline" element={<Gated permission="door_to_door.access"><ModuleGate moduleKey="module_vente" moduleName={t.nav.d2d}><D2DPipeline /></ModuleGate></Gated>} />
                    <Route path="/leaderboard" element={<Gated permission="reports.read"><ModuleGate moduleKey="module_vente" moduleName={t.nav.d2d}><PageWrapper><Leaderboard /></PageWrapper></ModuleGate></Gated>} />
                    <Route path="/commissions" element={<Gated permission="reports.read"><ModuleGate moduleKey="module_vente" moduleName={t.nav.d2d}><PageWrapper><Commissions /></PageWrapper></ModuleGate></Gated>} />
                    <Route path="/d2d-reports" element={<Gated permission="door_to_door.access"><ModuleGate moduleKey="module_vente" moduleName={t.nav.d2d}><PageWrapper><D2DReports /></PageWrapper></ModuleGate></Gated>} />
                    <Route path="/d2d-settings/general" element={<Gated permission="settings.update"><ModuleGate moduleKey="module_vente" moduleName={t.nav.d2d}><PageWrapper><D2DSettingsGeneral /></PageWrapper></ModuleGate></Gated>} />
                    <Route path="/d2d-settings/teams" element={<Gated permission="settings.update"><ModuleGate moduleKey="module_vente" moduleName={t.nav.d2d}><PageWrapper><D2DSettingsTeams /></PageWrapper></ModuleGate></Gated>} />
                    <Route path="/d2d-onboarding" element={<Gated permission="door_to_door.access"><ModuleGate moduleKey="module_vente" moduleName={t.nav.d2d}><D2DOnboarding /></ModuleGate></Gated>} />
                    <Route path="/settings/team/:memberId/profile" element={<Gated permission="team.read"><RepProfile /></Gated>} />
                    <Route path="/reps/:id" element={<Gated permission="team.read"><RepProfile /></Gated>} />
                    <Route path="/settings/marketplace" element={<Gated permission="integrations.read"><PageWrapper><AppMarketplace /></PageWrapper></Gated>} />
                    <Route path="/settings/request-form" element={<Gated permission="settings.update"><PageWrapper><RequestFormSettings /></PageWrapper></Gated>} />
                    {/* NOTE: /quotes/presets and /quotes/templates moved before /quotes/:id to prevent route conflict */}
                    <Route path="/settings/taxes" element={<Gated permission="settings.update"><PageWrapper><TaxSettings /></PageWrapper></Gated>} />
                    <Route path="/settings/roles" element={<Gated permission="users.update_role"><PageWrapper><SettingsRoles /></PageWrapper></Gated>} />
                    <Route path="/settings/users" element={<Gated permission="users.invite"><PageWrapper><SettingsUsers /></PageWrapper></Gated>} />
                    <Route path="/apps/callback" element={<Gated permission="integrations.update"><OAuthCallback /></Gated>} />
                    {/* BillingCheckout removed — upgrade goes through /checkout */}
                    <Route path="/settings/referrals" element={<Gated permission="settings.read"><PageWrapper><ReferFriend /></PageWrapper></Gated>} />
                    {/* Memory Graph — LIA Brain Visualization */}
                    <Route path="/memory-graph" element={<Gated permission="ai.admin"><React.Suspense fallback={null}><MemoryGraphPage /></React.Suspense></Gated>} />
{/* Platform Admin — owner-only, server enforces auth */}
                    <Route path="/platform-admin" element={isPlatformOwner ? <React.Suspense fallback={null}><PageWrapper><PlatformAdmin /></PageWrapper></React.Suspense> : <Navigate to="/dashboard" replace />} />
                    <Route path="*" element={<PageWrapper><NotFound /></PageWrapper>} />
                  </Routes>
            </ErrorBoundary>
          </div>
        </main>
      </div>
      {/* HelpChat removed — ? button now navigates to Lume Agent */}
      <ActivityCenter open={activityOpen} onClose={() => setActivityOpen(false)} />
      <AnimatePresence>
        {commandPaletteOpen && (
          <CommandPalette open={commandPaletteOpen} onClose={() => setCommandPaletteOpen(false)} language={language} />
        )}
      </AnimatePresence>
    </JobModalControllerProvider>
  );
}
