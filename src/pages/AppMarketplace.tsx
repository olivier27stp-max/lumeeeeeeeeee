import React, { useState, useCallback, useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Check,
  ExternalLink,
  Link2,
  Loader2,
  Unplug,
  X,
  Zap,
  AlertTriangle,
  Shield,
  Clock,
  ArrowRight,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useTranslation } from '../i18n';
import { cn } from '../lib/utils';
import { INTEGRATIONS, type Integration } from '../lib/integrations';
import {
  getConnection,
  fetchAllConnections,
  fetchNativeStatus,
  getNativeStatus,
  startOAuthFlow,
  testConnectionApi,
  disconnectApp,
  resolveAppStatus,
  refreshToken,
  type ConnectionInfo,
  type NativeStatus,
} from '../lib/integrationStore';

/** Display name in the current language (« Messagerie SMS » vs "SMS Messaging"). */
function appName(app: Integration, isFr: boolean): string {
  return isFr ? app.name : app.name_en || app.name;
}

// ─── Status helpers ─────────────────────────────────────────────
type ResolvedStatus =
  | 'connected'
  | 'available'
  | 'coming_soon'
  | 'requires_setup'
  | 'error'
  | 'pending'
  | 'token_expired';

function useConnectionState() {
  const [, setTick] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    // Both are independent round-trips — fetch together. Either may fail
    // without blocking the other (a broken Stripe key must not hide SMS).
    await Promise.allSettled([fetchAllConnections(), fetchNativeStatus()]);
    setTick((t) => t + 1);
  }, []);

  const refresh = useCallback(async () => {
    await load();
  }, [load]);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  const getStatus = useCallback((app: Integration): ResolvedStatus => {
    return resolveAppStatus(app.id, app.connection_type);
  }, []);

  const getConn = useCallback((appId: string): ConnectionInfo | null => {
    return getConnection(appId);
  }, []);

  return { getStatus, getConn, refresh, loading };
}

/**
 * Plain-language line describing what the customer should do next.
 * Deliberately concrete — "no SMS number yet" beats "not configured".
 */
function nativeHint(
  app: Integration,
  native: NativeStatus,
  isFr: boolean,
): { text: string; actionable: boolean } | null {
  if (app.id === 'stripe') {
    const s = native.stripe;
    if (s.active) {
      return {
        text: isFr
          ? 'Vos clients peuvent payer par carte.'
          : 'Your customers can pay by card.',
        actionable: false,
      };
    }
    if (s.detail === 'onboarding_incomplete') {
      return {
        text: isFr
          ? 'Il reste des informations à fournir avant de recevoir des paiements.'
          : 'Some information is still required before you can receive payments.',
        actionable: true,
      };
    }
    return {
      text: isFr
        ? 'Activez les paiements pour vous faire payer directement dans Lume.'
        : 'Turn on payments to get paid directly in Lume.',
      actionable: true,
    };
  }

  if (app.id === 'twilio') {
    const t = native.twilio;
    if (t.active) {
      return {
        text: isFr
          ? `Votre numéro : ${t.number}`
          : `Your number: ${t.number}`,
        actionable: false,
      };
    }
    if (t.detail === 'plan_excludes_sms') {
      return {
        text: isFr
          ? "Votre forfait actuel n'inclut pas les textos."
          : 'Your current plan does not include SMS.',
        actionable: true,
      };
    }
    return {
      text: isFr
        ? 'Obtenez votre numéro pour texter vos clients.'
        : 'Get your number to text your customers.',
      actionable: true,
    };
  }

  return null;
}

// ─── Status Badge ───────────────────────────────────────────────
function StatusBadge({ status }: { status: ResolvedStatus }) {
  const { language } = useTranslation();
  const isFr = language === 'fr';
  switch (status) {
    case 'connected':
      return (
        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-success bg-success/10 rounded-full px-2 py-0.5">
          <Check size={9} /> {isFr ? 'Actif' : 'Active'}
        </span>
      );
    case 'error':
      return (
        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-danger bg-danger/10 rounded-full px-2 py-0.5">
          <AlertTriangle size={9} /> {isFr ? 'Erreur' : 'Error'}
        </span>
      );
    case 'requires_setup':
      return (
        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-warning bg-warning/10 rounded-full px-2 py-0.5">
          {isFr ? 'À activer' : 'To activate'}
        </span>
      );
    case 'pending':
      return (
        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-text-primary bg-neutral-100 dark:bg-neutral-800/30 rounded-full px-2 py-0.5">
          <Loader2 size={9} className="animate-spin" /> {isFr ? 'En attente' : 'Pending'}
        </span>
      );
    case 'token_expired':
      return (
        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-warning bg-warning/10 rounded-full px-2 py-0.5">
          <Clock size={9} /> {isFr ? 'Reconnexion requise' : 'Reconnection required'}
        </span>
      );
    case 'coming_soon':
      return (
        <span className="text-[10px] font-bold text-text-tertiary bg-surface-secondary rounded-full px-2 py-0.5">
          {isFr ? 'Bientôt disponible' : 'Coming soon'}
        </span>
      );
    default:
      return (
        <span className="text-[10px] font-bold text-text-tertiary bg-surface-secondary rounded-full px-2 py-0.5">
          {isFr ? 'Non connecté' : 'Not connected'}
        </span>
      );
  }
}

// ─── App Logo Tile ──────────────────────────────────────────────
function AppLogo({ app, size = 'md' }: { app: Integration; size?: 'sm' | 'md' | 'lg' }) {
  const sizeClasses = {
    sm: 'w-9 h-9 text-[11px] rounded-lg',
    md: 'w-12 h-12 text-[12px] rounded-xl',
    lg: 'w-14 h-14 text-[15px] rounded-2xl',
  };
  const imgSizes = { sm: 20, md: 28, lg: 32 };

  const [imgError, setImgError] = useState(false);

  if (app.logo_url && !imgError) {
    return (
      <div
        className={cn(
          'flex items-center justify-center shrink-0 shadow-sm overflow-hidden p-2',
          sizeClasses[size],
        )}
        style={{ backgroundColor: app.logo_color }}
      >
        <img
          src={app.logo_url}
          alt={app.name}
          width={imgSizes[size]}
          height={imgSizes[size]}
          className="object-contain"
          onError={() => setImgError(true)}
        />
      </div>
    );
  }

  return (
    <div
      className={cn('flex items-center justify-center font-extrabold shrink-0 shadow-sm', sizeClasses[size])}
      style={{ backgroundColor: app.logo_color, color: app.logo_text_color || '#FFFFFF' }}
    >
      {app.logo_initials}
    </div>
  );
}

// ─── Integration Row ────────────────────────────────────────────
interface RowProps {
  app: Integration;
  status: ResolvedStatus;
  native: NativeStatus;
  onOpen: () => void;
  onManage: (route: string) => void;
}

const IntegrationRow: React.FC<RowProps> = ({ app, status, native, onOpen, onManage }) => {
  const { language } = useTranslation();
  const isFr = language === 'fr';
  const isNative = app.connection_type === 'native';
  const isComingSoon = status === 'coming_soon';
  const hint = isNative ? nativeHint(app, native, isFr) : null;

  // Native cards route the customer to the page that actually owns the
  // setting; only QuickBooks opens the connection modal.
  const handleClick = () => {
    if (isComingSoon) return;
    if (isNative && app.manage_route) onManage(app.manage_route);
    else onOpen();
  };

  const ctaLabel = isNative
    ? status === 'connected'
      ? isFr ? 'Gérer' : 'Manage'
      : isFr ? 'Activer' : 'Activate'
    : status === 'connected'
      ? isFr ? 'Gérer' : 'Manage'
      : isFr ? 'Connecter' : 'Connect';

  return (
    <button
      onClick={handleClick}
      disabled={isComingSoon}
      className={cn(
        'section-card w-full p-5 text-left transition-all group',
        isComingSoon ? 'cursor-default' : 'hover:shadow-md hover:border-outline',
      )}
    >
      <div className="flex items-center gap-4">
        {/* The logo keeps its full brand colour even when the integration is
            not yet available — dimming it reads as a broken image. The badge
            alone carries the "not yet" message. */}
        <AppLogo app={app} size="lg" />

        <div className={cn('flex-1 min-w-0', isComingSoon && 'opacity-70')}>
          <div className="flex items-center gap-2 mb-1">
            <p className="text-[15px] font-bold text-text-primary">{appName(app, isFr)}</p>
            <StatusBadge status={status} />
          </div>
          <p className="text-[12px] text-text-secondary leading-relaxed">
            {isFr ? app.description_short.fr : app.description_short.en}
          </p>
          {hint && (
            <p
              className={cn(
                'text-[11px] mt-1.5 font-medium',
                hint.actionable ? 'text-warning' : 'text-success',
              )}
            >
              {hint.text}
            </p>
          )}
        </div>

        {!isComingSoon && (
          <div className="shrink-0">
            <span
              className={cn(
                'glass-button !text-[11px] !py-1.5 inline-flex items-center gap-1.5',
                status === 'connected'
                  ? 'opacity-0 group-hover:opacity-100 transition-opacity'
                  : '!border-primary/40 !text-primary',
              )}
            >
              {ctaLabel} <ArrowRight size={11} />
            </span>
          </div>
        )}
      </div>
    </button>
  );
};

// ─── Integration Detail Modal (QuickBooks / OAuth only) ─────────
interface DetailModalProps {
  app: Integration | null;
  onClose: () => void;
  onConnectionChange: () => Promise<void> | void;
}

function IntegrationDetailModal({ app, onClose, onConnectionChange }: DetailModalProps) {
  const { language } = useTranslation();
  const isFr = language === 'fr';
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);

  React.useEffect(() => {
    setShowDisconnectConfirm(false);
  }, [app?.id]);

  if (!app) return null;

  const status = resolveAppStatus(app.id, app.connection_type);
  const conn = getConnection(app.id);
  const name = appName(app, isFr);

  const handleTest = async () => {
    setTesting(true);
    try {
      const result = await testConnectionApi(app.id);
      if (result.success) {
        toast.success(
          (isFr ? `Connexion à ${name} fonctionnelle` : `Connection to ${name} is working`) +
            (result.account_name ? ` (${result.account_name})` : ''),
        );
      } else {
        toast.error(result.error || (isFr ? `Test échoué pour ${name}` : `Test failed for ${name}`));
      }
      await onConnectionChange();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : isFr ? 'Test échoué' : 'Test failed');
    } finally {
      setTesting(false);
    }
  };

  const handleOAuth = async () => {
    setSaving(true);
    try {
      const authorizeUrl = await startOAuthFlow(app.id);
      window.location.href = authorizeUrl;
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : isFr
            ? `Échec du démarrage OAuth pour ${name}`
            : `Failed to start OAuth for ${name}`,
      );
      setSaving(false);
    }
  };

  const handleRefreshToken = async () => {
    setSaving(true);
    try {
      const success = await refreshToken(app.id);
      if (success) {
        toast.success(isFr ? `Connexion à ${name} renouvelée` : `${name} connection renewed`);
        await onConnectionChange();
      } else {
        toast.error(
          isFr
            ? `Impossible de renouveler. Reconnectez ${name}.`
            : `Unable to renew. Please reconnect ${name}.`,
        );
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : isFr ? 'Renouvellement échoué' : 'Refresh failed');
    } finally {
      setSaving(false);
    }
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      await disconnectApp(app.id);
      setShowDisconnectConfirm(false);
      await onConnectionChange();
      toast.success(isFr ? `${name} déconnecté` : `${name} disconnected`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : isFr ? 'Échec de la déconnexion' : 'Disconnection failed');
    } finally {
      setDisconnecting(false);
    }
  };

  const renderConnectionUI = () => {
    if (status === 'connected') {
      return (
        <div className="space-y-4">
          <div className="flex items-center gap-3 p-3 bg-success/5 border border-success/20 rounded-xl">
            <div className="w-8 h-8 rounded-lg bg-success/10 flex items-center justify-center">
              <Check size={16} className="text-success" />
            </div>
            <div className="flex-1">
              <p className="text-[13px] font-semibold text-text-primary">{isFr ? 'Connecté' : 'Connected'}</p>
              <p className="text-[11px] text-text-tertiary">
                {conn?.connected_account_name && (
                  <span className="font-medium text-text-secondary">{conn.connected_account_name}</span>
                )}
                {conn?.connected_at
                  ? isFr
                    ? ` — depuis le ${new Date(conn.connected_at).toLocaleDateString('fr-CA')}`
                    : ` — since ${new Date(conn.connected_at).toLocaleDateString('en-CA')}`
                  : ''}
              </p>
            </div>
          </div>

          {conn?.last_tested && (
            <div className="flex items-center gap-2 text-[11px] text-text-tertiary px-1">
              <Shield size={10} />
              {isFr ? 'Dernier test' : 'Last test'}:{' '}
              {new Date(conn.last_tested).toLocaleString(isFr ? 'fr-CA' : 'en-CA')}
              {conn.last_test_result === 'success' ? (
                <span className="text-success font-medium">— OK</span>
              ) : conn.last_test_result === 'failure' ? (
                <span className="text-danger font-medium">{isFr ? '— Échec' : '— Failed'}</span>
              ) : null}
            </div>
          )}

          <div className="flex items-center gap-2 pt-2">
            <button
              onClick={handleTest}
              disabled={testing}
              className="glass-button !text-[12px] inline-flex items-center gap-1.5"
            >
              {testing ? <Loader2 size={12} className="animate-spin" /> : <Shield size={12} />}
              {isFr ? 'Tester la connexion' : 'Test connection'}
            </button>
            {!showDisconnectConfirm ? (
              <button
                onClick={() => setShowDisconnectConfirm(true)}
                className="glass-button !text-[12px] inline-flex items-center gap-1.5 !text-danger !border-danger/30 hover:!bg-danger/5"
              >
                <Unplug size={12} /> {isFr ? 'Déconnecter' : 'Disconnect'}
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  onClick={handleDisconnect}
                  disabled={disconnecting}
                  className="glass-button !text-[12px] !bg-danger !text-white !border-danger inline-flex items-center gap-1.5"
                >
                  {disconnecting ? <Loader2 size={12} className="animate-spin" /> : null}
                  {isFr ? 'Confirmer' : 'Confirm'}
                </button>
                <button onClick={() => setShowDisconnectConfirm(false)} className="glass-button !text-[12px]">
                  {isFr ? 'Annuler' : 'Cancel'}
                </button>
              </div>
            )}
          </div>
        </div>
      );
    }

    if (status === 'token_expired') {
      return (
        <div className="space-y-4">
          <div className="flex items-center gap-3 p-3 bg-warning/5 border border-warning/20 rounded-xl">
            <div className="w-8 h-8 rounded-lg bg-warning/10 flex items-center justify-center">
              <Clock size={16} className="text-warning" />
            </div>
            <div className="flex-1">
              <p className="text-[13px] font-semibold text-text-primary">
                {isFr ? 'Reconnexion requise' : 'Reconnection required'}
              </p>
              <p className="text-[11px] text-text-tertiary">
                {isFr
                  ? "L'accès a expiré. Renouvelez-le pour continuer la synchronisation."
                  : 'Access has expired. Renew it to keep syncing.'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleRefreshToken}
              disabled={saving}
              className="glass-button-primary !text-[12px] inline-flex items-center gap-1.5"
            >
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Link2 size={12} />}
              {isFr ? 'Renouveler' : 'Renew'}
            </button>
            <button
              onClick={handleOAuth}
              disabled={saving}
              className="glass-button !text-[12px] inline-flex items-center gap-1.5"
            >
              <Link2 size={12} /> {isFr ? 'Reconnecter' : 'Reconnect'}
            </button>
          </div>
        </div>
      );
    }

    if (status === 'error') {
      return (
        <div className="space-y-4">
          <div className="flex items-center gap-3 p-3 bg-danger/5 border border-danger/20 rounded-xl">
            <div className="w-8 h-8 rounded-lg bg-danger/10 flex items-center justify-center">
              <AlertTriangle size={16} className="text-danger" />
            </div>
            <div className="flex-1">
              <p className="text-[13px] font-semibold text-text-primary">
                {isFr ? 'Erreur de connexion' : 'Connection error'}
              </p>
              <p className="text-[11px] text-text-tertiary">
                {conn?.last_error ||
                  (isFr ? 'Une erreur est survenue avec cette intégration.' : 'An error occurred with this integration.')}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleTest}
              disabled={testing}
              className="glass-button !text-[12px] inline-flex items-center gap-1.5"
            >
              {testing ? <Loader2 size={12} className="animate-spin" /> : <Shield size={12} />}
              {isFr ? 'Re-tester' : 'Re-test'}
            </button>
            <button
              onClick={handleOAuth}
              disabled={saving}
              className="glass-button-primary !text-[12px] inline-flex items-center gap-1.5"
            >
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Link2 size={12} />}
              {isFr ? 'Reconnecter' : 'Reconnect'}
            </button>
          </div>
        </div>
      );
    }

    // ── Not connected — OAuth start ──
    return (
      <div className="space-y-4">
        <div className="p-4 bg-surface-secondary/50 rounded-xl space-y-3">
          <p className="text-[12px] text-text-secondary">
            {isFr
              ? `Vous serez redirigé vers ${app.oauth_provider || name} pour autoriser Lume à synchroniser vos factures.`
              : `You'll be redirected to ${app.oauth_provider || name} to authorize Lume to sync your invoices.`}
          </p>
          <button
            onClick={handleOAuth}
            disabled={saving}
            className="glass-button-primary !text-[12px] w-full inline-flex items-center justify-center gap-2"
          >
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} />}
            {saving
              ? isFr
                ? 'Redirection...'
                : 'Redirecting...'
              : isFr
                ? `Connecter ${name}`
                : `Connect ${name}`}
          </button>
        </div>
      </div>
    );
  };

  return (
    <div
      className="fixed inset-0 z-[130] flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 16, scale: 0.97 }}
        transition={{ duration: 0.2 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-surface w-full max-w-lg max-h-[90vh] rounded-2xl border border-outline shadow-2xl overflow-hidden flex flex-col"
      >
        <div
          className="relative h-20 shrink-0 flex items-end px-6 pb-0"
          style={{ backgroundColor: app.logo_color + '18' }}
        >
          <div className="absolute right-4 top-4">
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg bg-surface/80 backdrop-blur-sm text-text-tertiary hover:text-text-primary transition-colors border border-outline-subtle/40"
            >
              <X size={14} />
            </button>
          </div>
          <div className="translate-y-6">
            <AppLogo app={app} size="lg" />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 pt-9 pb-6 space-y-5">
          <div>
            <div className="flex items-center gap-2.5 mb-1">
              <h2 className="text-[18px] font-bold text-text-primary">{name}</h2>
              <StatusBadge status={status} />
            </div>
            {app.official_site_url && (
              <div className="flex items-center gap-2 text-[11px] text-text-tertiary font-medium">
                <a
                  href={app.official_site_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  {isFr ? 'Site web' : 'Website'} <ExternalLink size={9} />
                </a>
              </div>
            )}
          </div>

          <p className="text-[13px] text-text-secondary leading-relaxed">
            {isFr ? app.description_long.fr : app.description_long.en}
          </p>

          <div>
            <p className="text-[10px] font-bold text-text-tertiary uppercase tracking-wider mb-2">
              {isFr ? 'Ce que ça fait' : 'What it does'}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {(isFr ? app.supported_features.fr : app.supported_features.en).map((f, i) => (
                <div key={i} className="flex items-center gap-2 text-[12px] text-text-secondary">
                  <Check size={11} className="text-success shrink-0" />
                  {f}
                </div>
              ))}
            </div>
          </div>

          <div className="border-t border-outline-subtle/40" />

          <div>{renderConnectionUI()}</div>
        </div>
      </motion.div>
    </div>
  );
}

// ─── Main Marketplace Page ──────────────────────────────────────
export default function AppMarketplace() {
  const navigate = useNavigate();
  const { language } = useTranslation();
  const isFr = language === 'fr';
  const [selectedApp, setSelectedApp] = useState<Integration | null>(null);
  const { getStatus, refresh, loading } = useConnectionState();

  const native = getNativeStatus();

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center">
          <Zap size={18} className="text-white" />
        </div>
        <div>
          <h1 className="text-[22px] font-bold text-text-primary tracking-tight">
            {isFr ? 'Connexions' : 'Connections'}
          </h1>
          <p className="text-[13px] text-text-tertiary">
            {isFr
              ? 'Les outils branchés à votre compte Lume.'
              : 'The tools connected to your Lume account.'}
          </p>
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="section-card p-5 animate-pulse">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-2xl bg-surface-secondary" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-32 bg-surface-secondary rounded" />
                  <div className="h-2.5 w-56 bg-surface-secondary rounded" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {INTEGRATIONS.map((app) => (
            <IntegrationRow
              key={app.id}
              app={app}
              status={getStatus(app)}
              native={native}
              onOpen={() => setSelectedApp(app)}
              onManage={(route) => navigate(route)}
            />
          ))}
        </div>
      )}

      <p className="text-[11px] text-text-tertiary">
        {isFr
          ? "D'autres connexions s'ajouteront au fur et à mesure."
          : 'More connections will be added over time.'}
      </p>

      <AnimatePresence>
        {selectedApp && (
          <IntegrationDetailModal
            app={selectedApp}
            onClose={() => setSelectedApp(null)}
            onConnectionChange={refresh}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
