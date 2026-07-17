import {
  User,
  Shield,
  CreditCard,
  Settings as SettingsIcon,
  Zap,
  Building,
  Users,
  Package,
  MapPin,
  Receipt,
  Wallet,
  Archive,
  FileText,
  Gift,
  MessageSquare,
  Calendar as CalendarIcon,
  LifeBuoy,
  Bell,
  Store,
  ArrowLeft,
  type LucideIcon,
} from 'lucide-react';
import { motion } from 'motion/react';
import { Navigate, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { cn } from '../../lib/utils';
import { useTranslation } from '../../i18n';
import { usePlatformOwner } from '../../hooks/usePlatformOwner';

// ─── Settings navigation (persistent sidebar) ─────────────────────
// Organized by user intent: Mon compte / Entreprise / Ventes & paiements /
// Communication / Équipe / Plus. Items with `external` leave the settings
// area (they keep their own full-page routes and gates).
interface NavItem {
  path: string;
  label: string;
  icon: LucideIcon;
  external?: boolean;
}

interface NavGroup {
  heading: string;
  items: NavItem[];
}

export function useSettingsNav(): NavGroup[] {
  const { t, language } = useTranslation();
  const isFr = language === 'fr';
  const isPlatformOwner = usePlatformOwner();

  return [
    {
      heading: isFr ? 'Mon compte' : 'My account',
      items: [
        // Language selection lives inside the profile page — no separate page.
        { path: '/settings/profile', label: isFr ? 'Mon profil' : 'My profile', icon: User },
      ],
    },
    {
      heading: isFr ? 'Entreprise' : 'Business',
      items: [
        { path: '/settings/company', label: t.settings.companySettings, icon: Building },
        { path: '/settings/billing', label: isFr ? 'Forfait & facturation' : 'Plan & billing', icon: CreditCard },
      ],
    },
    {
      heading: isFr ? 'Ventes & paiements' : 'Sales & payments',
      items: [
        { path: '/settings/products', label: t.settings.productsServices, icon: Package },
        { path: '/settings/taxes', label: 'Taxes', icon: Receipt },
        { path: '/settings/payments', label: 'Lume Payments', icon: Wallet },
        { path: '/settings/reminders', label: isFr ? 'Rappels de paiement' : 'Payment reminders', icon: Bell },
      ],
    },
    {
      heading: 'Communication',
      items: [
        { path: '/settings/messaging', label: isFr ? 'Messagerie SMS' : 'SMS Messaging', icon: MessageSquare },
        { path: '/settings/request-form', label: (t.settings as any).requestForm || t.requestForm.requestForm, icon: FileText },
        { path: '/automations', label: t.settings.automations, icon: Zap, external: true },
      ],
    },
    {
      heading: t.settings.team,
      items: [
        { path: '/settings/team', label: isFr ? 'Membres' : 'Members', icon: Users },
        { path: '/settings/roles', label: isFr ? 'Rôles & Permissions' : 'Roles & Permissions', icon: Shield },
        { path: '/settings/payroll', label: t.settings.payroll, icon: CalendarIcon },
        { path: '/settings/location', label: isFr ? 'Localisation GPS' : 'GPS tracking', icon: MapPin },
        { path: '/d2d-settings/teams', label: isFr ? 'Config terrain (D2D)' : 'Field config (D2D)', icon: MapPin, external: true },
      ],
    },
    {
      heading: isFr ? 'Plus' : 'More',
      items: [
        { path: '/settings/archives', label: (t.settings as any).archives || 'Archives', icon: Archive },
        { path: '/settings/marketplace', label: 'Marketplace', icon: Store },
        { path: '/settings/referrals', label: t.referFriend.referAFriend, icon: Gift },
        { path: '/settings/support', label: 'Support', icon: LifeBuoy },
      ],
    },
    ...(isPlatformOwner ? [{
      heading: isFr ? 'Plateforme' : 'Platform',
      items: [
        { path: '/platform-admin', label: 'Platform Admin', icon: Shield, external: true },
      ],
    }] : []),
  ];
}

// ─── Index route (/settings) ──────────────────────────────────────
// Redirects legacy ?tab= deep links to the new child routes, then sends
// desktop users to the first page. On mobile it renders nothing: the layout
// shows the full nav as a menu instead.
const LEGACY_TAB_TO_PATH: Record<string, string> = {
  account: 'profile',
  billing: 'billing',
  language: 'profile',
  company: 'company',
  products: 'products',
  payments: 'payments',
  reminders: 'reminders',
  messaging: 'messaging',
  taxes: 'taxes',
  'request-form': 'request-form',
  'manage-team': 'team',
  roles: 'roles',
  payroll: 'payroll',
  location: 'location',
  archives: 'archives',
  referrals: 'referrals',
  support: 'support',
};

export function SettingsIndex() {
  const [searchParams] = useSearchParams();
  const tab = searchParams.get('tab');
  if (tab && LEGACY_TAB_TO_PATH[tab]) {
    return <Navigate to={`/settings/${LEGACY_TAB_TO_PATH[tab]}`} replace />;
  }
  if (window.matchMedia('(min-width: 1024px)').matches) {
    return <Navigate to="/settings/profile" replace />;
  }
  return null;
}

// ─── Layout ───────────────────────────────────────────────────────
export default function SettingsLayout() {
  const { t, language } = useTranslation();
  const isFr = language === 'fr';
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const navSections = useSettingsNav();

  const isIndex = pathname === '/settings';
  const isActive = (path: string) => pathname === path || pathname.startsWith(path + '/');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="w-11 h-11 rounded-2xl bg-surface-secondary flex items-center justify-center">
          <SettingsIcon size={20} className="text-text-tertiary" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-text-primary tracking-tight">{t.settings.title}</h1>
          <p className="text-[12px] text-text-tertiary mt-0.5">{t.settings.subtitle}</p>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-8">
        {/* ── Sidebar — persistent on desktop; on mobile it IS the index page ── */}
        <div className={cn('lg:w-60 flex-col gap-6 shrink-0', isIndex ? 'flex' : 'hidden lg:flex')}>
          {navSections.map((section, sIdx) => (
            <div key={sIdx}>
              <p className="px-3 pb-2 text-xs font-medium text-text-tertiary">
                {section.heading}
              </p>
              <div className="space-y-0.5">
                {section.items.map((item) => {
                  const active = !item.external && isActive(item.path);
                  return (
                    <button
                      key={item.path}
                      onClick={() => navigate(item.path)}
                      className={cn(
                        'w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-[13px] font-medium transition-all',
                        active
                          ? 'bg-surface-secondary text-text-primary font-semibold'
                          : 'text-text-secondary hover:bg-surface-secondary/50 hover:text-text-primary'
                      )}
                    >
                      <item.icon size={15} className={active ? 'text-primary' : 'text-text-tertiary'} />
                      <span className="truncate">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* ── Content Area ── */}
        <div className={cn('flex-1 min-w-0', isIndex && 'hidden lg:block')}>
          {/* Mobile: way back to the settings menu */}
          {!isIndex && (
            <button
              type="button"
              onClick={() => navigate('/settings')}
              className="lg:hidden inline-flex items-center gap-1.5 mb-4 text-[13px] font-medium text-text-secondary hover:text-text-primary"
            >
              <ArrowLeft size={15} />
              {isFr ? 'Paramètres' : 'Settings'}
            </button>
          )}
          <motion.div
            key={pathname}
            initial={{ opacity: 0, x: 6 }}
            animate={{ opacity: 1, x: 0 }}
          >
            <Outlet />
          </motion.div>
        </div>
      </div>
    </div>
  );
}
