import React, { useState, useEffect } from 'react';
import {
  LayoutDashboard,
  Home,
  Users,
  Inbox,
  Settings,
  LogOut,
  Menu,
  X,
  Calendar as CalendarIcon,
  Briefcase,
  MapPin,
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
  Timer,
  Bell,
  Zap,
  MessageSquare,
  StickyNote,
  ClipboardList,
  GraduationCap,
  Trophy,
  Wallet,
  MapPinned,
  GitBranch,
  Shield,
  UserCog,
  Lock,
  Map,
  Repeat,
  CalendarCheck,
  Brain,
  Check,
  Info,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from './lib/utils';
import Dashboard from './pages/Dashboard';
import CrmWorkspace from './pages/CrmWorkspace';
import Clients from './pages/Clients';
import NewClient from './pages/NewClient';
import ClientDetails from './pages/ClientDetails';
import Schedule from './pages/Schedule';
import SettingsLayout, { SettingsIndex } from './pages/settings/SettingsLayout';
import ProfileSettings from './pages/settings/ProfileSettings';
import BillingSettings from './pages/settings/BillingSettings';
import LocationSettings from './pages/settings/LocationSettings';
import ArchivesPanel from './components/ArchivesPanel';
import SupportPage from './components/SupportPage';
import PayrollPage from './pages/settings/PayrollPage';
import Auth from './pages/Auth';
import Privacy from './pages/Privacy';
import Terms from './pages/Terms';
import PrivacyCenter from './pages/PrivacyCenter';
import Subprocessors from './pages/Subprocessors';
import { CookieBanner } from './components/CookieBanner';
import Landing from './pages/Landing';
import { supabase } from './lib/supabase';
import { fetchCurrentBilling, type GraceImpaye } from './lib/billingApi';
import { countPendingQuotes } from './lib/quotesApi';
import { countOverdueInvoices } from './lib/invoicesApi';
import { User } from '@supabase/supabase-js';
import Jobs from './pages/Jobs';
import NotFound from './pages/NotFound';
import JobDetails from './pages/JobDetails';
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Toaster } from 'sonner';
import { JobModalControllerProvider } from './contexts/JobModalController';
import { useTranslation } from './i18n';
import InvoiceDetails from './pages/InvoiceDetails';
import InvoiceEdit from './pages/InvoiceEdit';
import Statistiques from './pages/Statistiques';
import Finances from './pages/Finances';
import PaymentSettings from './pages/PaymentSettings';
import Automations from './pages/Automations';
import CompanySettings from './pages/CompanySettings';
import ManageTeam from './pages/ManageTeam';
import TeamMemberDetails from './pages/TeamMemberDetails';
import GlobalSearch from './components/GlobalSearch';
import { OfficeSwitcher } from './components/OfficeSwitcher';
import SearchResultsPage from './pages/SearchResults';
import Timesheets from './pages/Timesheets';
import Quotes from './pages/Quotes';
import QuoteDetails from './pages/QuoteDetails';
import type { TileColor } from './components/ui';
import ActivityCenter from './components/ActivityCenter';
import SupportFAB from './components/SupportFAB';
import ErrorBoundary from './components/ErrorBoundary';
import ProductsServices from './pages/ProductsServices';
import AppMarketplace from './pages/AppMarketplace';
import SettingsMessaging from './pages/SettingsMessaging';
import RequestFormSettings from './pages/RequestFormSettings';
import QuotePresets from './pages/QuotePresets';
const QuoteMeasure = React.lazy(() => import('./pages/QuoteMeasure'));
const QuoteNew = React.lazy(() => import('./pages/QuoteNew'));
// Console interne des migrations assistées — la page se gate elle-même via
// GET /api/migration-admin/check (PLATFORM_OWNER_ID) et redirige sinon.
const AdminMigrations = React.lazy(() => import('./pages/AdminMigrations'));
// Creator Space — espace interne plateforme (platformAdminIds), la page se
// gate elle-même via GET /api/creator-space/check et redirige sinon.
const CreatorSpace = React.lazy(() => import('./pages/creator-space/CreatorSpace'));
import TaxSettings from './pages/TaxSettings';
import OAuthCallback from './pages/OAuthCallback';
import EmailOAuthCallback from './pages/EmailOAuthCallback';
import DispatchMap from './pages/DispatchMap';
import OnboardingFlow from './pages/OnboardingFlow';
import CheckoutSuccess from './pages/CheckoutSuccess';
import AcceptInvitation from './pages/AcceptInvitation';
import Register from './pages/Register';
import AccessBlocked from './pages/AccessBlocked';
import VerifyEmail from './pages/VerifyEmail';
import VerifyEmailGate from './components/auth/VerifyEmailGate';
// Conserves volontairement bien que non montes : ils permettent de remettre
// Lume Agent en service en restaurant sa route et son entree de menu.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import MrLumePage from './features/agent/components/MrLumeChat';
import Messages from './pages/Messages';
import TasksPage from './pages/Tasks';
import PlanFeatureGate from './components/PlanFeatureGate';
import { useCurrentPlan } from './hooks/usePlanFeature';
import Courses from './pages/Courses';
import CourseView from './pages/CourseView';
import CourseBuilder from './pages/CourseBuilder';
// Lume Agent icon for sidebar — brain
const LumeAgentIcon = ({ size = 20, className = '' }: { size?: number; className?: string }) => (
  <Brain size={size} className={className} />
);
import SatisfactionSurvey from './pages/SatisfactionSurvey';
import ClientPortal from './pages/ClientPortal';
import PublicPayment from './pages/PublicPayment';
import MobileAppGate from './pages/MobileAppGate';
import { afficherPorteMobile } from './lib/mobileGate';
import PublicRequestForm from './pages/PublicRequestForm';
import Requests from './pages/Requests';
import RequestDetails from './pages/RequestDetails';
import Leaderboard from './pages/Leaderboard';
import Commissions from './pages/Commissions';
import RepProfile from './pages/RepProfile';
import FieldSales from './pages/FieldSales';
import D2DMap from './pages/D2DMap';
import D2DPipeline from './pages/D2DPipeline';
import D2DReports from './pages/D2DReports';
// D2DSettingsGeneral (mock non branché) puis D2DSettingsTeams (config terrain)
// retirées sur demande de Rafba — les équipes restent assignables à
// l'invitation ; /d2d-settings/* redirige vers /settings/team.
import D2DOnboarding from './pages/D2DOnboarding';
import SettingsRoles from './pages/SettingsRoles';
import PermissionGate from './components/PermissionGate';
import ModuleGate from './components/ModuleGate';
import { useModuleAccess } from './hooks/useModuleAccess';
import type { PermissionKey } from './lib/permissions';
import { hasPermission, ROLE_LABELS } from './lib/permissions';
import { usePermissions } from './hooks/usePermissions';
import { useRealtimeNotifications } from './hooks/useRealtimeNotifications';
import OnboardingWizard from './components/OnboardingWizard';
import SetupChecklist from './components/SetupChecklist';
import CommandPalette from './components/CommandPalette';
import DevRoleSwitcher from './components/DevRoleSwitcher';
import { CompanyProvider, useCompany } from './contexts/CompanyContext';
import { useLiveLocationTracking, endTrackingAndSignOut } from './hooks/useLiveLocationTracking';
import { useLocationTrackingConsent } from './hooks/useLocationTrackingConsent';
import LocationConsentModal from './components/LocationConsentModal';
import { CompanySelectorPage, CompanySwitcher, NoCompanyState } from './components/CompanySelector';
import { useSessionTimeout } from './hooks/useSessionTimeout';
import SessionTimeoutModal from './components/SessionTimeoutModal';

// Route groups (extracted to src/routes/* to keep this file from growing further)
import { PublicRoutes } from './routes/PublicRoutes';
import { TokenRoute, detectTokenKind } from './routes/TokenRoutes';
import { useQueryClient } from '@tanstack/react-query';
// Cross-cutting hooks previously inlined in App()
import { useCommandPaletteShortcut } from './hooks/useCommandPaletteShortcut';

// Toasts (sonner) — pastille monochrome Lume, styles dans index.css (.lume-toast).
// Partagé par les deux <Toaster> (VerifyEmailGate + AuthenticatedApp).
const lumeToastIcons = {
  success: <Check size={15} strokeWidth={2.5} />,
  error: <X size={15} strokeWidth={2.5} />,
  info: <Info size={15} strokeWidth={2.5} />,
  warning: <AlertCircle size={15} strokeWidth={2.5} />,
  loading: <Loader2 size={15} strokeWidth={2.5} className="animate-spin" />,
};
const lumeToastOptions = { className: 'lume-toast', duration: 3500 };

type NavItem = {
  id: string;
  label: string;
  icon: typeof LayoutDashboard;
  path: string;
  tileColor: TileColor;
  /** Permission key required to see this nav item */
  requiredPermission?: PermissionKey;
  /** Plan flag required to see this nav item (e.g. 'includes_sms') */
  requiredPlanFlag?: 'includes_sms' | 'includes_ai' | 'includes_d2d' | 'includes_courses' | 'includes_api';
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

/** Legacy /payments → /finances redirect, preserving old ?tab=payouts bookmarks */
function PaymentsRedirect() {
  const location = useLocation();
  const incomingTab = new URLSearchParams(location.search).get('tab');
  const to = incomingTab === 'payouts' ? '/finances?tab=versements' : '/finances?tab=paiements';
  return <Navigate to={to} replace />;
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

  // Auto-signout after 4 h of inactivity (warns 5 min ahead)
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
  const [accessBlockedReason, setAccessBlockedReason] = useState<'no_membership' | 'no_subscription' | null>(null);
  // Impayé en cours, accès encore ouvert : sert à afficher le bandeau
  // d'avertissement. Null quand l'abonnement est en règle.
  const [graceImpaye, setGraceImpaye] = useState<GraceImpaye | null>(null);
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
  const queryClient = useQueryClient();
  // NOTE: useRealtimeNotifications uses useCompany() internally, so it must be
  // called inside <CompanyProvider>. It's hoisted into AuthenticatedApp instead.
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

    let channel: ReturnType<typeof supabase.channel> | null = null;
    (async () => {
      const { data: membership } = await supabase
        .from('memberships')
        .select('org_id')
        .eq('user_id', user.id)
        .limit(1)
        .maybeSingle();
      const oid = membership?.org_id;
      if (!oid) return;
      channel = supabase
        .channel(`sms-unread-badge-${oid}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations', filter: `org_id=eq.${oid}` }, () => {
          loadUnread();
        })
        .subscribe();
    })();
    return () => { if (channel) supabase.removeChannel(channel); };
  }, [user]);

  useEffect(() => {
    // Dark mode applies ONLY to the authenticated CRM dashboard — never to the
    // public landing / marketing / auth pages. We still persist the user's
    // preference so it sticks once they're back in the app.
    document.documentElement.classList.toggle('dark', isDark && !!user);
    localStorage.setItem('lume-theme', isDark ? 'dark' : 'light');
  }, [isDark, user]);

  useEffect(() => {
    // OAuth (PKCE) callback: Supabase returns to the app with ?code=...
    // The client was configured with detectSessionInUrl: true, so the SDK
    // performs the code-for-session exchange on load — but asynchronously.
    // We must wait for that exchange (a SIGNED_IN event) before resolving
    // `loading`, otherwise the app renders the logged-out tree and bounces
    // the user back to /auth while the exchange is still in flight.
    let resolved = false;
    const url = new URL(window.location.href);
    const pendingOAuth =
      url.searchParams.has('code') || window.location.hash.includes('access_token=');

    // Un échec OAuth (échange Supabase↔Google raté, consentement refusé, app
    // non vérifiée…) revient sur le Site URL avec ?error=…&error_description=….
    // Sans ceci, l'erreur était avalée et l'utilisateur « rebondissait » sur
    // l'accueil sans aucune explication — indiagnosticable.
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const oauthErrDesc = url.searchParams.get('error_description') || hashParams.get('error_description');
    const oauthErrCode =
      url.searchParams.get('error_code') || url.searchParams.get('error') || hashParams.get('error');
    if (oauthErrCode || oauthErrDesc) {
      import('sonner').then(({ toast }) => {
        toast.error(`Connexion échouée / Sign-in failed — ${oauthErrDesc || oauthErrCode}`, {
          duration: 20000,
        });
      });
      for (const k of ['error', 'error_code', 'error_description', 'state']) url.searchParams.delete(k);
      window.history.replaceState({}, '', url.pathname + url.search);
    }

    const finishBootstrap = (session: any) => {
      if (resolved) return;
      resolved = true;
      setUser(session?.user ?? null);
      setLoading(false);
      if (pendingOAuth) {
        // Clean the URL so refreshes don't re-trigger the OAuth flow.
        url.searchParams.delete('code');
        url.searchParams.delete('state');
        window.history.replaceState({}, '', url.pathname + url.search);
      }
    };

    if (pendingOAuth) {
      // Give the SDK up to 5s to finish the exchange before falling back.
      const fallbackTimer = setTimeout(async () => {
        const { data: { session } } = await supabase.auth.getSession();
        finishBootstrap(session);
      }, 5000);
      const origSub = supabase.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
          clearTimeout(fallbackTimer);
          finishBootstrap(session);
          origSub.data.subscription.unsubscribe();
        }
      });
    } else {
      supabase.auth.getSession().then(({ data: { session } }) => finishBootstrap(session));
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      const prev = user;
      setUser(session?.user ?? null);
      // Reconnect (sign back in): drop all cached query data so the whole app
      // reloads fresh instead of showing the previous session's cache.
      if (event === 'SIGNED_IN') {
        void queryClient.invalidateQueries();
      }
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

  // Ctrl+K opens command palette
  useCommandPaletteShortcut(setCommandPaletteOpen);

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
            const { data: newOrg, error: orgErr } = await supabase
              .from('orgs')
              .insert({ name: user.email?.split('@')[0] || 'My Workspace', created_by: user.id })
              .select('id')
              .single();
            if (orgErr) throw orgErr;

            if (newOrg) {
              const { error: memErr } = await supabase
                .from('memberships')
                .insert({ user_id: user.id, org_id: newOrg.id, role: 'owner' });
              if (memErr) throw memErr;
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

        // Show wizard for any account where onboarding is not yet done.
        // The subscription guard below also ensures we don't render it until
        // the user has paid (showOnboarding && user is the outer condition).
        if (!profile?.onboarding_done) {
          setShowOnboarding(true);
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
    if (!user || !onboardingChecked || showOnboarding) {
      setHasSubscription(null);
      setAccessBlockedReason(null);
      return;
    }
    // Bypass for beta emails whitelisted via env
    if (user.email && BYPASS_EMAILS.includes(user.email.toLowerCase())) {
      setHasSubscription(true);
      setAccessBlockedReason(null);
      return;
    }
    (async () => {
      try {
        const { data: mem } = await supabase
          .from('memberships')
          .select('org_id')
          .eq('user_id', user.id)
          .limit(1)
          .maybeSingle();
        if (!mem) {
          setHasSubscription(false);
          setAccessBlockedReason('no_membership');
          return;
        }
        // L'abonnement vit sur UN seul bureau de la compagnie — un employé
        // d'un bureau secondaire ne peut pas lire la sub du bureau principal
        // (RLS). /billing/current la résout sur tout le company_group côté
        // serveur (service role), donc on passe par l'API.
        const { subscription, grace } = await fetchCurrentBilling();
        if (subscription && ['active', 'trialing'].includes(subscription.status)) {
          setHasSubscription(true);
          setAccessBlockedReason(null);
          setGraceImpaye(null);
        } else if (subscription?.status === 'past_due' && grace?.actif) {
          // Une carte expirée ne doit pas fermer le CRM le jour même : le
          // client perdrait l'accès à ses clients et ses jobs en pleine
          // journée de travail, sans avoir été prévenu. On garde l'accès
          // ouvert pendant la fenêtre de relance de Stripe, avec un bandeau
          // qui dit la date de fermeture.
          setHasSubscription(true);
          setAccessBlockedReason(null);
          setGraceImpaye(grace);
        } else {
          setHasSubscription(false);
          setAccessBlockedReason('no_subscription');
          setGraceImpaye(null);
        }
      } catch {
        // API indisponible → on ne bloque pas l'accès (fail-open, comme avant)
        setHasSubscription(true);
        setAccessBlockedReason(null);
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

  // Aperçu de la porte mobile — visible sans compte, pour la regarder sur un
  // vrai téléphone avant de la brancher pour de bon. Ne bloque rien : c'est
  // une page qu'on choisit d'ouvrir, pas une redirection.
  if (location.pathname === '/apercu-mobile') {
    return <MobileAppGate />;
  }

  // Public token pages (no auth required) — quote, survey, portal, pay, invite
  const tokenKind = detectTokenKind(location.pathname);
  if (tokenKind) {
    return <TokenRoute kind={tokenKind} />;
  }

  // Public embeddable request form (iframe target — works without auth, for any
  // visitor logged in or not, so it can be embedded on external sites).
  const formKeyMatch = location.pathname.match(/^\/form\/([a-f0-9]{32,})$/i);
  if (formKeyMatch) {
    return <PublicRequestForm apiKey={formKeyMatch[1]} />;
  }

  // ── Porte mobile ──
  // Placee APRES toutes les routes publiques, jamais avant : un client qui
  // ouvre une soumission recue par texto doit passer, il n'a pas de compte
  // Lume et n'installera jamais l'application. `afficherPorteMobile` porte
  // cette liste blanche, et ses tests la croisent avec `detectTokenKind`.
  //
  // Placee AVANT le gate d'authentification : sur telephone, on n'affiche meme
  // pas l'ecran de connexion — se connecter pour tomber sur un CRM inutilisable
  // serait pire que la porte elle-meme.
  if (afficherPorteMobile(location.pathname)) {
    return <MobileAppGate />;
  }

  if (!user) {
    if (view === 'auth') {
      return <Auth onBack={() => setView('landing')} />;
    }
    return (
      <>
        <CookieBanner />
        <PublicRoutes onAuthBack={() => setView('landing')} />
      </>
    );
  }

  // ── Email verification gate ──
  // Hard gate for email/password users whose address is not yet confirmed.
  // Google/OAuth users have `email_confirmed_at` set by Supabase automatically,
  // so they bypass this. We skip during the OAuth callback (the session may not
  // yet be hydrated) and on the verify-email landing page.
  const isOAuthCallback =
    location.pathname === '/auth/callback' ||
    location.pathname === '/apps/callback' ||
    location.pathname === '/email/callback' ||
    location.pathname === '/verify-email';
  // Google/OAuth providers set email_confirmed_at automatically, so this only
  // triggers for unverified email/password sign-ups.
  if (user && !(user as any).email_confirmed_at && !isOAuthCallback) {
    return (
      <>
        <Toaster
          position="top-right"
          gap={8}
          icons={lumeToastIcons}
          toastOptions={lumeToastOptions}
        />
        <VerifyEmailGate email={user.email || ''} />
      </>
    );
  }

  // ── Subscription guard ──
  // User is logged in but has no membership OR no active subscription.
  // Show an explicit AccessBlocked page so the user knows WHY they can't
  // get in, instead of being silently bounced back to the landing page.
  // Allow /checkout and /checkout/success through so they can pay if needed.
  if (user && hasSubscription === false && accessBlockedReason) {
    return (
      <Routes>
        <Route path="/checkout/success" element={<CheckoutSuccess />} />
        <Route path="/checkout" element={<OnboardingFlow />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/terms" element={<Terms />} />
        <Route path="/subprocessors" element={<Subprocessors />} />
        <Route
          path="*"
          element={<AccessBlocked reason={accessBlockedReason} userEmail={user.email} />}
        />
      </Routes>
    );
  }

  // Show onboarding wizard only when user is paid (hasSubscription === true)
  // AND onboarding has not been completed yet.
  if (showOnboarding && user && hasSubscription === true) {
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
      graceImpaye={graceImpaye}
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
  graceImpaye,
  navigate,
  location,
}: any) {
  const queryClient = useQueryClient();
  // Bumping this remounts GlobalSearch (it holds local state, not react-query),
  // so a logo click resets the search bar to a clean state.
  const [searchResetKey, setSearchResetKey] = useState(0);
  // Click the Lume logo → refresh everything: drop all cached data (refetches
  // active queries), reset the search bar, and go Home.
  const handleLogoClick = () => {
    void queryClient.invalidateQueries();
    setSearchResetKey((k) => k + 1);
    navigate('/');
  };
  const { current, currentRole, companies, loading: companyLoading, isMultiCompany, hasNoCompany, currentOrgId } = useCompany();
  // Call realtime notifications hook INSIDE CompanyProvider (it uses useCompany() internally)
  const { unreadCount: unreadNotifs, resetCount: resetNotifCount, countsByNav: notifCountsByNav, markNavAsRead } = useRealtimeNotifications(!!user, {
    onViewRequests: () => navigate('/requests'),
    viewRequestsLabel: language === 'fr' ? 'Voir' : 'View',
  });
  // Visiting Requests or the pipeline clears their sidebar badge (marks the
  // underlying request notifications as read).
  useEffect(() => {
    if (location.pathname === '/requests') markNavAsRead('requests');
    else if (location.pathname === '/pipeline') markNavAsRead('d2d-pipeline');
  }, [location.pathname, markNavAsRead]);
  // Current plan — used to hide locked features from sidebar.
  // `planLoading` est indispensable : sans lui, on ne peut pas distinguer
  // « plan pas encore charge » de « plan sans cette feature ».
  const { currentPlan, loading: planLoading } = useCurrentPlan();

  // Sidebar counters: pending quotes + overdue invoices
  const [pendingQuotes, setPendingQuotes] = useState(0);
  const [overdueInvoices, setOverdueInvoices] = useState(0);
  useEffect(() => {
    if (!user || !currentOrgId) { setPendingQuotes(0); setOverdueInvoices(0); return; }
    const load = async () => {
      // Counts share the query shape of the Quotes/Finances pages: if a page
      // query breaks, its badge disappears instead of showing an orphan count.
      const [q, i] = await Promise.all([
        countPendingQuotes(currentOrgId),
        countOverdueInvoices(currentOrgId),
      ]);
      setPendingQuotes(q);
      setOverdueInvoices(i);
    };
    load();
    const interval = setInterval(load, 60_000);
    return () => clearInterval(interval);
  }, [user, currentOrgId]);
  // usePermissions MUST be called inside CompanyProvider to get correct data
  const permsCtx = usePermissions();
  // Les outils de développement (bascule de rôle / de forfait) étaient
  // conditionnés par `usePlatformOwner`, supprimé avec le back-office
  // Platform Admin. Ils ne donnent aucun accès inter-tenants — ils agissent
  // uniquement sur la session courante — et sont désormais réservés au mode
  // développement, donc invisibles en production.
  const showDevTools = import.meta.env.DEV;
  const venteModule = useModuleAccess('module_vente');

  // Auto-locate every signed-in user (desktop + mobile web) for the whole
  // session, so they appear as a live blue pin on the dispatch / sales maps.
  // Gated on the org switch + per-user consent (Loi 25); the modal below
  // collects consent on first login.
  const locationConsent = useLocationTrackingConsent(user?.id ?? null, currentOrgId);
  useLiveLocationTracking(user?.id ?? null, currentOrgId, locationConsent.allowed);

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

  /** Filter nav items based on user permissions + plan flags */
  const canSee = (item: NavItem) => {
    // Permission check
    if (item.requiredPermission) {
      const ok = permsCtx.role === 'owner'
        || hasPermission(permsCtx.permissions, item.requiredPermission, permsCtx.role ?? undefined);
      if (!ok) return false;
    }
    // Plan flag check — hide entirely if the plan doesn't grant the feature.
    //
    // `currentPlan` null ne veut PAS dire « pas de plan » : il vaut aussi null
    // tant que /api/billing/current n'a pas repondu, et definitivement si cet
    // appel echoue. Masquer dans ce cas faisait disparaitre TOUTES les entrees
    // protegees d'un coup — l'utilisateur ne gardait que les modules non
    // proteges (clients, jobs, finances, calendrier, taches...) alors que son
    // abonnement etait bien actif.
    //
    // On distingue donc les deux cas : pendant le chargement on laisse passer
    // (le PlanFeatureGate de la route reverifie de toute facon), et seul un
    // plan REELLEMENT charge peut masquer une entree.
    if (item.requiredPlanFlag) {
      if (planLoading || !currentPlan) return true;
      return Boolean((currentPlan as any)[item.requiredPlanFlag]);
    }
    return true;
  };

  const navSections: NavSection[] = [
    {
      label: null,
      items: [
        { id: 'day', label: t.nav.crm, icon: Home, path: '/day', tileColor: 'blue' },
      ],
    },
    {
      label: language === 'fr' ? 'Principal' : 'Main',
      items: [
        { id: 'clients', label: t.nav.clients, icon: Users, path: '/clients', tileColor: 'blue', requiredPermission: 'clients.read' },
        { id: 'requests', label: t.nav.requests, icon: Inbox, path: '/requests', tileColor: 'blue', requiredPermission: 'clients.read' },
        { id: 'quotes', label: language === 'fr' ? 'Devis' : 'Quotes', icon: ClipboardList, path: '/quotes', tileColor: 'blue', requiredPermission: 'quotes.read' },
        { id: 'finances', label: t.nav.finances, icon: Wallet, path: '/finances', tileColor: 'blue', requiredPermission: 'financial.view_invoices' },
        { id: 'jobs', label: t.nav.jobs, icon: Briefcase, path: '/jobs', tileColor: 'blue', requiredPermission: 'jobs.read' },
        { id: 'schedule', label: t.nav.calendar, icon: CalendarIcon, path: '/calendar', tileColor: 'blue', requiredPermission: 'calendar.read' },
      ],
    },
    {
      label: language === 'fr' ? 'Outils' : 'Tools',
      items: [
        { id: 'messages', label: t.nav.messages, icon: MessageSquare, path: '/messages', tileColor: 'blue', requiredPermission: 'messages.read', requiredPlanFlag: 'includes_sms' },
        { id: 'timesheets', label: t.nav.timesheets, icon: Timer, path: '/timesheets', tileColor: 'blue', requiredPermission: 'timesheets.read', requiredPlanFlag: 'includes_timesheets' },
        { id: 'courses', label: t.courses?.title || 'Courses', icon: GraduationCap, path: '/courses', tileColor: 'blue', requiredPlanFlag: 'includes_courses' },
      ],
    },
    {
      label: t.nav.d2d,
      // `loading` et `indetermine` comptent autant que `isEnabled` : pendant le
      // chargement de /api/features — ou si l'appel echoue — l'etat n'est pas
      // « desactive », il est INCONNU. Afficher le cadenas dans ce cas donnait
      // l'impression que le module s'etait desactive tout seul, alors qu'il
      // etait bien actif en base. On garde le menu deploye ; les pages restent
      // protegees par ModuleGate, qui refera la verification.
      items: (venteModule.isEnabled || venteModule.loading || venteModule.indetermine)
        ? [
            { id: 'field-sales', label: t.nav.venteMap, icon: MapPinned, path: '/field-sales', tileColor: 'blue', requiredPermission: 'door_to_door.access', requiredPlanFlag: 'includes_d2d' },
            { id: 'd2d-pipeline', label: t.nav.ventePipeline, icon: GitBranch, path: '/pipeline', tileColor: 'blue', requiredPermission: 'door_to_door.access', requiredPlanFlag: 'includes_d2d' },
            { id: 'leaderboard', label: t.nav.leaderboard, icon: Trophy, path: '/leaderboard', tileColor: 'blue', requiredPermission: 'financial.view_reports', requiredPlanFlag: 'includes_d2d' },
            { id: 'commissions', label: t.nav.commissions, icon: Wallet, path: '/commissions', tileColor: 'blue', requiredPermission: 'commissions.read', requiredPlanFlag: 'includes_d2d' },
          ]
        : [
            { id: 'vente-locked', label: t.nav.d2d, icon: Lock, path: '/field-sales', tileColor: 'blue', requiredPlanFlag: 'includes_d2d' },
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
    { id: 'automations', label: t.workflows?.title || 'Automations', icon: Zap, path: '/automations', tileColor: 'blue' as const, requiredPermission: 'automations.read' as PermissionKey, requiredPlanFlag: 'includes_automations' },
    { id: 'marketplace', label: 'Marketplace', icon: Store, path: '/settings/marketplace', tileColor: 'blue' as const, requiredPermission: 'integrations.read' as PermissionKey, requiredPlanFlag: 'includes_marketplace' },
  ] as NavItem[]).filter(canSee);

  // Auto-expand "More" if the user is on a "more" page
  const moreIds = moreNavItems.map((i) => i.path);
  const isOnMorePage = moreIds.some((p) => location.pathname === p || location.pathname.startsWith(`${p}/`));

  const isActive = (path: string) => location.pathname === path || location.pathname.startsWith(`${path}/`);

  return (
    <JobModalControllerProvider>
      <Toaster
        // On mobile, top-right overlaps the header / floats badly; bottom-center keeps
        // toasts out of the way of scroll content.
        position={typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches ? 'bottom-center' : 'top-right'}
        gap={8}
        icons={lumeToastIcons}
        toastOptions={lumeToastOptions}
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
                  <img src="/lume-logo-v2.png" alt="Lume CRM" onClick={handleLogoClick} className="h-7 w-auto object-contain dark:invert cursor-pointer" />
                </motion.div>
              ) : (
                <motion.div
                  key="logo-short"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="mx-auto"
                >
                  <img src="/lume-logo-v2.png" alt="Lume CRM" onClick={handleLogoClick} className="h-6 w-auto object-contain dark:invert cursor-pointer" />
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

          {/* Active user role */}
          {sidebarExpanded && currentRole && (
            <div className="px-4 pb-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-sidebar-text/50 truncate">
                {ROLE_LABELS[currentRole]?.[language === 'fr' ? 'fr' : 'en'] ?? currentRole}
              </p>
            </div>
          )}

          {/* Dev tools (role + plan switch) — mode développement uniquement */}
          {showDevTools && (
          <div className="px-2.5 pb-2">
            <DevRoleSwitcher expanded={sidebarExpanded} />
            {/* Temporary plan switcher — sits right under the role switcher */}
            <button
              onClick={() => navigate('/dev/plan-switch')}
              title={!sidebarExpanded ? 'Switch Plan' : undefined}
              className={cn(
                'mt-1 w-full flex items-center gap-2.5 px-2.5 py-[8px] rounded-lg text-[14px] font-medium transition-colors',
                'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
                !sidebarExpanded && 'justify-center'
              )}
            >
              <CreditCard size={17} strokeWidth={1.8} />
              {sidebarExpanded && <span className="truncate text-left flex-1">Switch Plan</span>}
            </button>
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
                          {!['messages', 'quotes', 'finances'].includes(item.id) && (notifCountsByNav[item.id] || 0) > 0 && !sidebarExpanded && (
                            <span className="absolute -top-1.5 -right-1.5 bg-danger text-white text-[7px] font-bold rounded-full min-w-[12px] h-[12px] flex items-center justify-center px-0.5">
                              {notifCountsByNav[item.id] > 9 ? '9+' : notifCountsByNav[item.id]}
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
                            {item.id === 'finances' && overdueInvoices > 0 && (
                              <span className="ml-auto bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400 text-[9px] font-bold rounded-full min-w-[16px] h-[16px] flex items-center justify-center px-1 shrink-0">
                                {overdueInvoices}
                              </span>
                            )}
                            {/* Unread-notification count for pages without a domain-specific badge */}
                            {!['messages', 'quotes', 'finances'].includes(item.id) && (notifCountsByNav[item.id] || 0) > 0 && (
                              <span className="ml-auto bg-danger text-white text-[9px] font-bold rounded-full min-w-[16px] h-[16px] flex items-center justify-center px-1 shrink-0">
                                {notifCountsByNav[item.id] > 9 ? '9+' : notifCountsByNav[item.id]}
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
              onClick={() => endTrackingAndSignOut()}
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
          {/* Impayé en cours — l'accès est maintenu, mais pas indéfiniment.
              Non refermable et présent sur toutes les pages : le client doit
              apprendre la fermeture à venir ici, pas le jour où elle arrive. */}
          {graceImpaye?.actif && (
            <div className="shrink-0 flex flex-wrap items-center gap-x-2 gap-y-1 px-5 py-2 bg-amber-50 border-b border-amber-200 text-[13px] text-amber-900">
              <AlertCircle size={15} className="shrink-0 text-amber-600" />
              <span>
                <strong>Votre dernier paiement n’est pas passé.</strong>{' '}
                {graceImpaye.jours_restants <= 1
                  ? 'Votre accès sera suspendu demain.'
                  : `Il vous reste ${graceImpaye.jours_restants} jours pour mettre votre carte à jour.`}
              </span>
              <Link
                to="/settings/billing"
                className="font-semibold underline underline-offset-2 hover:text-amber-950"
              >
                Mettre à jour ma carte
              </Link>
            </div>
          )}
          {/* Top bar — premium, elevated */}
          <header className="h-11 shrink-0 flex items-center gap-3 px-5 border-b border-border bg-surface-elevated">
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
            <OfficeSwitcher />
            <div className="ml-auto">
              <GlobalSearch key={searchResetKey} />
            </div>
            <div className="flex items-center gap-0.5">
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
              <div className="ml-1.5 avatar-sm">
                <UserCircle2 size={15} strokeWidth={1.75} />
              </div>
            </div>
          </header>

          {/* Page content — relative host so full-page item forms (jobs, quotes…)
              can portal in and fill this area while the sidebar + top bar stay. */}
          <div id="page-content-area" className="relative flex-1 min-h-0">
            <div className="absolute inset-0 overflow-y-auto">
            <ErrorBoundary labels={t.errorBoundary}>
                  <Routes>
                    <Route path="/" element={<Navigate to="/day" replace />} />
                    <Route path="/pricing" element={<Navigate to="/settings/billing" replace />} />
                    {/* Lume Agent masque — la fonctionnalite n'est pas encore ouverte aux
                        utilisateurs. La route est REDIRIGEE plutot que supprimee : un favori
                        ou un lien deja partage ne doit pas tomber sur une page blanche.
                        Pour la remettre : restaurer l'element d'origine (MrLumePage est
                        toujours importe) et l'entree de menu 'ai-helper'. */}
                    <Route path="/lume-agent" element={<Navigate to="/day" replace />} />
                    <Route path="/dashboard" element={<Navigate to="/day" replace />} />
                    <Route path="/day" element={<Gated permission="settings.read"><PageWrapper><CrmWorkspace /></PageWrapper></Gated>} />
                    <Route path="/messages" element={<Gated permission="messages.read"><PlanFeatureGate flag="includes_sms"><PageWrapper><Messages /></PageWrapper></PlanFeatureGate></Gated>} />
                    <Route path="/leads" element={<Navigate to="/quotes" replace />} />
                    <Route path="/clients" element={<Gated permission="clients.read"><div className="px-8 py-6"><Clients /></div></Gated>} />
                    <Route path="/clients/new" element={<Gated permission="clients.create"><NewClient /></Gated>} />
                    {/* Edit reuses the Clients list page, which opens its edit drawer from the :id route param */}
                    <Route path="/clients/:id/edit" element={<Gated permission="clients.update"><div className="px-8 py-6"><Clients /></div></Gated>} />
                    <Route path="/clients/:id" element={<Gated permission="clients.read"><div className="px-8 py-6"><ClientDetails /></div></Gated>} />
                    <Route path="/requests" element={<Gated permission="clients.read"><div className="px-8 py-6"><Requests /></div></Gated>} />
                    <Route path="/requests/:id" element={<Gated permission="clients.read"><div className="px-8 py-6"><RequestDetails /></div></Gated>} />
                    <Route path="/jobs" element={<Gated permission="jobs.read"><div className="px-8 py-6"><Jobs /></div></Gated>} />
                    <Route path="/jobs/:id" element={<Gated permission="jobs.read"><PageWrapper><JobDetails /></PageWrapper></Gated>} />
                    <Route path="/calendar" element={<Gated permission="calendar.read"><Schedule /></Gated>} />
                    <Route path="/availability" element={<Navigate to="/timesheets?view=horaire" replace />} />
                    <Route path="/search" element={<Gated permission="settings.read"><PageWrapper><SearchResultsPage /></PageWrapper></Gated>} />
                    <Route path="/quotes" element={<Gated permission="quotes.read"><div className="px-8 py-6"><Quotes /></div></Gated>} />
                    <Route path="/quotes/new" element={<Gated permission="quotes.read"><React.Suspense fallback={null}><QuoteNew /></React.Suspense></Gated>} />
                    <Route path="/quotes/measure" element={<Gated permission="quotes.read"><React.Suspense fallback={null}><QuoteMeasure /></React.Suspense></Gated>} />
                    <Route path="/quotes/presets" element={<Gated permission="settings.read"><PageWrapper><QuotePresets /></PageWrapper></Gated>} />
                    <Route path="/quotes/templates" element={<Gated permission="settings.read"><PageWrapper><QuotePresets /></PageWrapper></Gated>} />
                    <Route path="/quotes/:id" element={<Gated permission="quotes.read"><PageWrapper><QuoteDetails /></PageWrapper></Gated>} />
                    <Route path="/quotes/:id/measure" element={<Gated permission="quotes.read"><React.Suspense fallback={null}><QuoteMeasure /></React.Suspense></Gated>} />
                    <Route path="/finances" element={<Gated permission="invoices.read"><PageWrapper><Finances /></PageWrapper></Gated>} />
                    <Route path="/invoices" element={<Navigate to="/finances" replace />} />
                    <Route path="/invoices/new" element={<Gated permission="invoices.create"><PageWrapper><InvoiceEdit /></PageWrapper></Gated>} />
                    <Route path="/invoices/:id" element={<Gated permission="invoices.read"><PageWrapper><InvoiceDetails /></PageWrapper></Gated>} />
                    <Route path="/invoices/:id/edit" element={<Gated permission="invoices.update"><PageWrapper><InvoiceEdit /></PageWrapper></Gated>} />
                    <Route path="/insights" element={<Gated permission="reports.read"><PageWrapper><Statistiques /></PageWrapper></Gated>} />
                    <Route path="/payments" element={<PaymentsRedirect />} />
                    <Route path="/payments/settings" element={<Navigate to="/settings/payments" replace />} />
                    <Route path="/timesheets" element={<Gated permission="timesheets.read"><PlanFeatureGate flag="includes_timesheets"><PageWrapper><Timesheets /></PageWrapper></PlanFeatureGate></Gated>} />
                    {/* Settings — unified layout: persistent sidebar + nested sub-pages.
                        Old ?tab= deep links are redirected by SettingsIndex. Each child
                        keeps the same permission/plan gates as its old standalone route. */}
                    <Route path="/settings" element={<PageWrapper><SettingsLayout /></PageWrapper>}>
                      <Route index element={<SettingsIndex />} />
                      <Route path="profile" element={<Gated permission="settings.read"><ProfileSettings /></Gated>} />
                      {/* Language moved into the profile page */}
                      <Route path="language" element={<Navigate to="/settings/profile" replace />} />
                      <Route path="company" element={<Gated permission="settings.update"><CompanySettings /></Gated>} />
                      <Route path="billing" element={<Gated permission="settings.read"><BillingSettings /></Gated>} />
                      <Route path="products" element={<Gated permission="settings.update"><ProductsServices /></Gated>} />
                      <Route path="taxes" element={<Gated permission="settings.update"><TaxSettings /></Gated>} />
                      <Route path="payments" element={<Gated permission="settings.read"><PaymentSettings /></Gated>} />
                      {/* Standalone reminders settings page removed — old links land on Lume Payments */}
                      <Route path="reminders" element={<Navigate to="/settings/payments" replace />} />
                      <Route path="messaging" element={<Gated permission="settings.read"><SettingsMessaging /></Gated>} />
                      <Route path="request-form" element={<Gated permission="settings.update"><PlanFeatureGate flag="includes_request_forms"><RequestFormSettings /></PlanFeatureGate></Gated>} />
                      <Route path="team" element={<Gated permission="team.read"><ManageTeam /></Gated>} />
                      <Route path="roles" element={<Gated permission="users.update_role"><SettingsRoles /></Gated>} />
                      <Route path="payroll" element={<Gated permission="settings.read"><PayrollPage /></Gated>} />
                      <Route path="location" element={<Gated permission="settings.read"><LocationSettings /></Gated>} />
                      <Route path="archives" element={<Gated permission="settings.read"><div className="max-w-2xl"><ArchivesPanel /></div></Gated>} />
                      <Route path="marketplace" element={<Gated permission="integrations.read"><PlanFeatureGate flag="includes_marketplace"><AppMarketplace /></PlanFeatureGate></Gated>} />
                      {/* Parrainage: route retirée tant que la récompense (crédit
                          Stripe au parrain) n'est pas validée par un vrai paiement.
                          Fermée pour tout le monde, propriétaire inclus. L'API
                          renvoie 404 de son côté. Réactivation: REFERRALS_ENABLED. */}
                      <Route path="support" element={<Gated permission="settings.read"><SupportPage /></Gated>} />
                    </Route>
                    <Route path="/account/privacy" element={<PageWrapper><PrivacyCenter /></PageWrapper>} />
                    <Route path="/privacy" element={<Privacy />} />
                    <Route path="/terms" element={<Terms />} />
          <Route path="/subprocessors" element={<Subprocessors />} />
                    <Route path="/automations" element={<Gated permission="automations.read"><PlanFeatureGate flag="includes_automations"><PageWrapper><Automations /></PageWrapper></PlanFeatureGate></Gated>} />
                    <Route path="/tasks" element={<Gated permission="settings.read"><PageWrapper><TasksPage /></PageWrapper></Gated>} />
                    <Route path="/courses" element={<Gated permission="settings.read"><PlanFeatureGate flag="includes_courses"><div className="px-8 py-6"><Courses /></div></PlanFeatureGate></Gated>} />
                    <Route path="/training" element={<Navigate to="/courses" replace />} />
                    <Route path="/courses/new" element={<Gated permission="settings.update"><PlanFeatureGate flag="includes_courses"><CourseBuilder /></PlanFeatureGate></Gated>} />
                    <Route path="/courses/:id" element={<Gated permission="settings.read"><PlanFeatureGate flag="includes_courses"><CourseView /></PlanFeatureGate></Gated>} />
                    <Route path="/courses/:id/edit" element={<Gated permission="settings.update"><CourseBuilder /></Gated>} />
                    <Route path="/automations/hub" element={<Navigate to="/automations" replace />} />
                    <Route path="/automations/builder" element={<Navigate to="/automations" replace />} />
                    <Route path="/company-settings" element={<Navigate to="/settings/company" replace />} />
                    <Route path="/manage-team" element={<Navigate to="/settings/team" replace />} />
                    <Route path="/settings/team/:memberId" element={<Gated permission="team.read"><PageWrapper><TeamMemberDetails /></PageWrapper></Gated>} />
                    {/* Dispatch: NO PageWrapper — full-bleed */}
                    <Route path="/dispatch" element={<Gated permission="map.access"><DispatchMap /></Gated>} />
                    {/* Vente (ex-D2D) — gated by plan flag + module activation */}
                    <Route path="/field-sales" element={<Gated permission="door_to_door.access"><PlanFeatureGate flag="includes_d2d"><ModuleGate moduleKey="module_vente" moduleName={t.nav.d2d}><D2DMap /></ModuleGate></PlanFeatureGate></Gated>} />
                    {/* Dashboard page removed for all roles — redirect to Sales Map */}
                    <Route path="/d2d-dashboard" element={<Navigate to="/field-sales" replace />} />
                    <Route path="/pipeline" element={<Gated permission="door_to_door.access"><PlanFeatureGate flag="includes_d2d"><ModuleGate moduleKey="module_vente" moduleName={t.nav.d2d}><D2DPipeline /></ModuleGate></PlanFeatureGate></Gated>} />
                    {/* Legacy URL — keep old bookmarks/links working */}
                    <Route path="/d2d-pipeline" element={<Navigate to="/pipeline" replace />} />
                    <Route path="/leaderboard" element={<Gated permission="reports.read"><PlanFeatureGate flag="includes_d2d"><ModuleGate moduleKey="module_vente" moduleName={t.nav.d2d}><PageWrapper><Leaderboard /></PageWrapper></ModuleGate></PlanFeatureGate></Gated>} />
                    {/* Commissions: role-based dashboard from main — not restricted to the Vente module/plan flag */}
                    <Route path="/commissions" element={<Gated permission="commissions.read"><PageWrapper><Commissions /></PageWrapper></Gated>} />
                    <Route path="/d2d-reports" element={<Gated permission="door_to_door.access"><PlanFeatureGate flag="includes_d2d"><ModuleGate moduleKey="module_vente" moduleName={t.nav.d2d}><PageWrapper><D2DReports /></PageWrapper></ModuleGate></PlanFeatureGate></Gated>} />
                    <Route path="/d2d-settings/general" element={<Navigate to="/settings/team" replace />} />
                    <Route path="/d2d-settings/teams" element={<Navigate to="/settings/team" replace />} />
                    <Route path="/d2d-onboarding" element={<Gated permission="door_to_door.access"><PlanFeatureGate flag="includes_d2d"><ModuleGate moduleKey="module_vente" moduleName={t.nav.d2d}><D2DOnboarding /></ModuleGate></PlanFeatureGate></Gated>} />
                    <Route path="/settings/team/:memberId/profile" element={<Gated permission="team.read"><RepProfile /></Gated>} />
                    <Route path="/reps/:id" element={<Gated permission="team.read"><RepProfile /></Gated>} />
                    {/* NOTE: /quotes/presets and /quotes/templates moved before /quotes/:id to prevent route conflict */}
                    <Route path="/settings/users" element={<Navigate to="/settings/team" replace />} />
                    <Route path="/apps/callback" element={<Gated permission="integrations.update"><OAuthCallback /></Gated>} />
                    {/* Email mailbox OAuth return — per-owner, no org permission gate. */}
                    <Route path="/email/callback" element={<EmailOAuthCallback />} />
                    {/* BillingCheckout removed — upgrade goes through /checkout */}
                    {/* /platform-admin retiré : le back-office donnait une vue
                        inter-tenants (orgs, utilisateurs, revenus) depuis
                        l'application. L'URL redirige désormais comme toute
                        route inconnue. */}
                    {/* Console interne des migrations assistées — hors nav,
                        réservée à PLATFORM_OWNER_ID (guard serveur + gate dans
                        la page). Périmètre limité aux projets de migration. */}
                    <Route path="/admin/migrations" element={<React.Suspense fallback={null}><AdminMigrations /></React.Suspense>} />
                    {/* Creator Space — hors nav, réservé à platformAdminIds
                        (guard serveur par-handler + gate dans la page).
                        Lecture seule : vues plateforme inter-compagnies. */}
                    <Route path="/creator-space/*" element={<React.Suspense fallback={null}><CreatorSpace /></React.Suspense>} />
                    <Route path="*" element={<PageWrapper><NotFound /></PageWrapper>} />
                  </Routes>
            </ErrorBoundary>
            </div>
          </div>
        </main>
      </div>
      {/* HelpChat removed — ? button now navigates to Lume Agent */}
      <SupportFAB />
      <ActivityCenter open={activityOpen} onClose={() => setActivityOpen(false)} />
      {/* Setup checklist — visible only to owner/admin until completed/dismissed */}
      {(permsCtx.role === 'owner' || permsCtx.role === 'admin') && <SetupChecklist />}
      <AnimatePresence>
        {commandPaletteOpen && (
          <CommandPalette open={commandPaletteOpen} onClose={() => setCommandPaletteOpen(false)} language={language} />
        )}
      </AnimatePresence>
      <LocationConsentModal
        open={locationConsent.needsPrompt}
        language={language}
        onAccept={locationConsent.accept}
        onDecline={locationConsent.decline}
      />
      <SessionTimeoutModal language={language} />
    </JobModalControllerProvider>
  );
}
