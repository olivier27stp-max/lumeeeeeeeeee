import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  Link2,
  Loader2,
  RefreshCw,
  Search,
  Star,
  Unplug,
  X,
  Zap,
  AlertTriangle,
  Shield,
  Clock,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { cn } from '../lib/utils';
import {
  INTEGRATIONS,
  CATEGORIES,
  getFeaturedIntegrations,
  type Integration,
  type AuthField,
} from '../lib/integrations';
import {
  getConnection,
  fetchAllConnections,
  startOAuthFlow,
  connectWithCredentials,
  testConnectionApi,
  disconnectApp,
  resolveAppStatus,
  refreshToken,
  type ConnectionInfo,
} from '../lib/integrationStore';

// ─── Status helpers ─────────────────────────────────────────────
type ResolvedStatus = 'connected' | 'available' | 'coming_soon' | 'requires_setup' | 'error' | 'pending' | 'token_expired';

function useConnectionState() {
  const [, setTick] = useState(0);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      await fetchAllConnections();
    } catch {
      // Silent fail — cache stays as-is
    }
    setTick((t) => t + 1);
  }, []);

  // Load connections on mount
  useEffect(() => {
    fetchAllConnections()
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const getStatus = useCallback((app: Integration): ResolvedStatus => {
    return resolveAppStatus(app.id, app.connection_type);
  }, []);

  const getConn = useCallback((appId: string): ConnectionInfo | null => {
    return getConnection(appId);
  }, []);

  return { getStatus, getConn, refresh, loading };
}

// ─── Status Badge ───────────────────────────────────────────────
function StatusBadge({ status }: { status: ResolvedStatus }) {
  switch (status) {
    case 'connected':
      return (
        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-success bg-success/10 rounded-full px-2 py-0.5">
          <Check size={9} /> Connected
        </span>
      );
    case 'error':
      return (
        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-danger bg-danger/10 rounded-full px-2 py-0.5">
          <AlertTriangle size={9} /> Error
        </span>
      );
    case 'requires_setup':
      return (
        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-warning bg-warning/10 rounded-full px-2 py-0.5">
          Requires Setup
        </span>
      );
    case 'pending':
      return (
        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-text-primary bg-neutral-100 dark:bg-neutral-800/30 rounded-full px-2 py-0.5">
          <Loader2 size={9} className="animate-spin" /> Pending
        </span>
      );
    case 'token_expired':
      return (
        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-warning bg-warning/10 rounded-full px-2 py-0.5">
          <Clock size={9} /> Token Expired
        </span>
      );
    case 'coming_soon':
      return (
        <span className="text-[10px] font-bold text-text-tertiary bg-surface-secondary rounded-full px-2 py-0.5">
          Coming Soon
        </span>
      );
    default:
      return null;
  }
}

// ─── Connection Type Label ──────────────────────────────────────
function connectionLabel(type: string): string {
  switch (type) {
    case 'oauth': return 'OAuth';
    case 'api_key': return 'API Key';
    case 'webhook': return 'Webhook';
    case 'manual': return 'Manual';
    case 'internal': return 'Built-in';
    default: return '';
  }
}

// ─── App Logo Tile ──────────────────────────────────────────────
function AppLogo({ app, size = 'md' }: { app: Integration; size?: 'sm' | 'md' | 'lg' }) {
  const sizeClasses = {
    sm: 'w-9 h-9 text-[11px] rounded-lg',
    md: 'w-11 h-11 text-[12px] rounded-xl',
    lg: 'w-14 h-14 text-[15px] rounded-2xl',
  };
  const imgSizes = { sm: 20, md: 24, lg: 32 };

  const [imgError, setImgError] = useState(false);

  // Use official logo if available and not broken
  if (app.logo_url && !imgError) {
    return (
      <div
        className={cn('flex items-center justify-center shrink-0 shadow-sm overflow-hidden p-2', sizeClasses[size])}
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

// ─── App Card ───────────────────────────────────────────────────
interface AppCardProps {
  app: Integration;
  status: ResolvedStatus;
  onClick: () => void;
}

const AppCard: React.FC<AppCardProps> = ({ app, status, onClick }) => {
  return (
    <button
      onClick={onClick}
      className="section-card p-4 text-left hover:shadow-md hover:border-outline transition-all group flex flex-col h-full"
    >
      <div className="flex items-start gap-3 mb-3">
        <AppLogo app={app} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-[14px] font-bold text-text-primary truncate">{app.name}</p>
            <StatusBadge status={status} />
          </div>
          <p className="text-[11px] text-text-tertiary mt-0.5">{app.category}</p>
        </div>
      </div>
      <p className="text-[12px] text-text-secondary leading-relaxed flex-1">{app.description_short}</p>
      <div className="mt-3 pt-3 border-t border-outline-subtle/40 flex items-center justify-between">
        <span className="text-[11px] text-text-tertiary font-medium">{connectionLabel(app.connection_type)}</span>
        <span className="text-[11px] font-semibold text-primary opacity-0 group-hover:opacity-100 transition-opacity inline-flex items-center gap-1">
          View details <ChevronRight size={10} />
        </span>
      </div>
    </button>
  );
};

// ─── Featured Card ──────────────────────────────────────────────
interface FeaturedCardProps {
  app: Integration;
  status: ResolvedStatus;
  onClick: () => void;
}

const FeaturedCard: React.FC<FeaturedCardProps> = ({ app, status, onClick }) => {
  return (
    <button
      onClick={onClick}
      className="section-card p-5 text-left hover:shadow-md hover:border-outline transition-all group"
    >
      <div className="flex items-center gap-4">
        <AppLogo app={app} size="lg" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <p className="text-[15px] font-bold text-text-primary">{app.name}</p>
            <StatusBadge status={status} />
          </div>
          <p className="text-[12px] text-text-secondary leading-relaxed">{app.description_short}</p>
        </div>
        <div className="shrink-0">
          {status === 'connected' ? (
            <span className="glass-button !text-[11px] !py-1.5 inline-flex items-center gap-1.5 !border-success/40 !text-success">
              <Check size={11} /> Connected
            </span>
          ) : status === 'available' ? (
            <span className="glass-button-primary !text-[11px] !py-1.5 inline-flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
              <Zap size={11} /> Connect
            </span>
          ) : (
            <span className="badge-neutral text-[10px]">Coming Soon</span>
          )}
        </div>
      </div>
    </button>
  );
};

// ─── Credential Field ───────────────────────────────────────────
interface CredentialFieldProps {
  field: AuthField;
  value: string;
  onChange: (v: string) => void;
}

const CredentialField: React.FC<CredentialFieldProps> = ({ field, value, onChange }) => {
  const [visible, setVisible] = useState(false);
  const isSecret = field.type === 'password';

  if (field.type === 'select' && field.options) {
    return (
      <div>
        <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">
          {field.label} {field.required && '*'}
        </label>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="glass-input w-full mt-1"
        >
          <option value="">{field.placeholder}</option>
          {field.options.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
        {field.helpText && <p className="text-[10px] text-text-tertiary mt-1">{field.helpText}</p>}
      </div>
    );
  }

  return (
    <div>
      <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">
        {field.label} {field.required && '*'}
      </label>
      <div className="relative mt-1">
        <input
          type={isSecret && !visible ? 'password' : 'text'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          className="glass-input w-full pr-9"
        />
        {isSecret && (
          <button
            type="button"
            onClick={() => setVisible(!visible)}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-primary"
          >
            {visible ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>
        )}
      </div>
      {field.helpText && <p className="text-[10px] text-text-tertiary mt-1">{field.helpText}</p>}
    </div>
  );
};

// ─── Integration Detail Modal ───────────────────────────────────
interface DetailModalProps {
  app: Integration | null;
  onClose: () => void;
  onConnectionChange: () => Promise<void> | void;
}

function IntegrationDetailModal({ app, onClose, onConnectionChange }: DetailModalProps) {
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);
  const [webhookUrl] = useState(() => `https://api.lumecrm.app/webhooks/${crypto.randomUUID().slice(0, 8)}`);

  if (!app) return null;

  const status = resolveAppStatus(app.id, app.connection_type);
  const conn = getConnection(app.id);

  // Initialize form
  const initForm = () => {
    const initial: Record<string, string> = {};
    app.auth_fields.forEach((f) => { initial[f.key] = ''; });
    setFormValues(initial);
  };

  React.useEffect(() => {
    if (app) {
      initForm();
      setShowDisconnectConfirm(false);
    }
  }, [app?.id]);

  const handleFieldChange = (key: string, value: string) => {
    setFormValues((prev) => ({ ...prev, [key]: value }));
  };

  const requiredFieldsFilled = app.auth_fields
    .filter((f) => f.required)
    .every((f) => (formValues[f.key] || '').trim() !== '');

  const handleSave = async () => {
    if (!requiredFieldsFilled) return;
    setSaving(true);
    try {
      const result = await connectWithCredentials(app.id, formValues);
      if (result.success) {
        await onConnectionChange();
        toast.success(`${app.name} connecté avec succès`);
      } else {
        toast.error(result.error || `Échec de la connexion à ${app.name}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erreur de connexion');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      const result = await testConnectionApi(app.id);
      if (result.success) {
        toast.success(`Connexion à ${app.name} fonctionnelle${result.account_name ? ` (${result.account_name})` : ''}`);
        await onConnectionChange();
      } else {
        toast.error(result.error || `Test échoué pour ${app.name}`);
        await onConnectionChange();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Test échoué');
    } finally {
      setTesting(false);
    }
  };

  const handleOAuth = async () => {
    setSaving(true);
    try {
      const authorizeUrl = await startOAuthFlow(app.id);
      // Redirect to provider's OAuth page
      window.location.href = authorizeUrl;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Échec du démarrage OAuth pour ${app.name}`);
      setSaving(false);
    }
  };

  const handleRefreshToken = async () => {
    setSaving(true);
    try {
      const success = await refreshToken(app.id);
      if (success) {
        toast.success(`Token de ${app.name} rafraîchi`);
        await onConnectionChange();
      } else {
        toast.error(`Impossible de rafraîchir le token. Reconnectez ${app.name}.`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Rafraîchissement échoué');
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
      initForm();
      toast.success(`${app.name} déconnecté`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Échec de la déconnexion');
    } finally {
      setDisconnecting(false);
    }
  };

  const handleCopyWebhook = () => {
    navigator.clipboard.writeText(webhookUrl);
    toast.success('URL du webhook copiée');
  };

  // ── Render connection UI based on type ──
  const renderConnectionUI = () => {
    // ── CONNECTED STATE ──
    if (status === 'connected') {
      return (
        <div className="space-y-4">
          <div className="flex items-center gap-3 p-3 bg-success/5 border border-success/20 rounded-xl">
            <div className="w-8 h-8 rounded-lg bg-success/10 flex items-center justify-center">
              <Check size={16} className="text-success" />
            </div>
            <div className="flex-1">
              <p className="text-[13px] font-semibold text-text-primary">Connecté</p>
              <p className="text-[11px] text-text-tertiary">
                {conn?.connected_account_name && <span className="font-medium text-text-secondary">{conn.connected_account_name}</span>}
                {conn?.connected_at ? ` — depuis le ${new Date(conn.connected_at).toLocaleDateString('fr-CA')}` : ''}
              </p>
            </div>
          </div>

          {/* Last test info */}
          {conn?.last_tested && (
            <div className="flex items-center gap-2 text-[11px] text-text-tertiary px-1">
              <Shield size={10} />
              Dernier test: {new Date(conn.last_tested).toLocaleString('fr-CA')}
              {conn.last_test_result === 'success' ? (
                <span className="text-success font-medium">— OK</span>
              ) : conn.last_test_result === 'failure' ? (
                <span className="text-danger font-medium">— Échec</span>
              ) : null}
            </div>
          )}

          {/* Webhook URL for webhook apps */}
          {app.connection_type === 'webhook' && (
            <div className="space-y-2">
              <p className="text-[10px] font-bold text-text-tertiary uppercase tracking-wider">Webhook Endpoint</p>
              <div className="flex items-center gap-2 p-3 bg-surface-secondary/50 rounded-lg">
                <code className="text-[11px] text-text-secondary font-mono flex-1 truncate">{webhookUrl}</code>
                <button onClick={handleCopyWebhook} className="p-1.5 rounded-md text-text-tertiary hover:text-text-primary hover:bg-surface-secondary">
                  <Copy size={12} />
                </button>
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 pt-2">
            <button onClick={handleTest} disabled={testing} className="glass-button !text-[12px] inline-flex items-center gap-1.5">
              {testing ? <Loader2 size={12} className="animate-spin" /> : <Shield size={12} />}
              Tester la connexion
            </button>
            {!showDisconnectConfirm ? (
              <button onClick={() => setShowDisconnectConfirm(true)} className="glass-button !text-[12px] inline-flex items-center gap-1.5 !text-danger !border-danger/30 hover:!bg-danger/5">
                <Unplug size={12} /> Déconnecter
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button onClick={handleDisconnect} disabled={disconnecting} className="glass-button !text-[12px] !bg-danger !text-white !border-danger inline-flex items-center gap-1.5">
                  {disconnecting ? <Loader2 size={12} className="animate-spin" /> : null}
                  Confirmer
                </button>
                <button onClick={() => setShowDisconnectConfirm(false)} className="glass-button !text-[12px]">
                  Annuler
                </button>
              </div>
            )}
          </div>
        </div>
      );
    }

    // ── TOKEN EXPIRED STATE ──
    if (status === 'token_expired') {
      return (
        <div className="space-y-4">
          <div className="flex items-center gap-3 p-3 bg-warning/5 border border-warning/20 rounded-xl">
            <div className="w-8 h-8 rounded-lg bg-warning/10 flex items-center justify-center">
              <Clock size={16} className="text-warning" />
            </div>
            <div className="flex-1">
              <p className="text-[13px] font-semibold text-text-primary">Token expiré</p>
              <p className="text-[11px] text-text-tertiary">
                {conn?.connected_account_name || app.name} — Le token d'accès a expiré et doit être renouvelé.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button onClick={handleRefreshToken} disabled={saving} className="glass-button-primary !text-[12px] inline-flex items-center gap-1.5">
              {saving ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              Rafraîchir le token
            </button>
            <button onClick={handleOAuth} disabled={saving} className="glass-button !text-[12px] inline-flex items-center gap-1.5">
              <Link2 size={12} /> Reconnecter via OAuth
            </button>
          </div>
        </div>
      );
    }

    // ── PENDING AUTHORIZATION STATE ──
    if (status === 'pending') {
      return (
        <div className="space-y-4">
          <div className="flex items-center gap-3 p-3 bg-neutral-50 dark:bg-neutral-800/10 border border-neutral-200 dark:border-neutral-700/30 rounded-xl">
            <div className="w-8 h-8 rounded-lg bg-neutral-100 dark:bg-neutral-800/20 flex items-center justify-center">
              <Loader2 size={16} className="text-text-primary animate-spin" />
            </div>
            <div className="flex-1">
              <p className="text-[13px] font-semibold text-text-primary">Autorisation en attente</p>
              <p className="text-[11px] text-text-tertiary">
                Le processus OAuth a été démarré. Complétez l'autorisation dans la fenêtre du fournisseur.
              </p>
            </div>
          </div>

          <button onClick={handleOAuth} disabled={saving} className="glass-button-primary !text-[12px] inline-flex items-center gap-1.5">
            {saving ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            Relancer l'autorisation
          </button>
        </div>
      );
    }

    // ── ERROR STATE ──
    if (status === 'error') {
      return (
        <div className="space-y-4">
          <div className="flex items-center gap-3 p-3 bg-danger/5 border border-danger/20 rounded-xl">
            <div className="w-8 h-8 rounded-lg bg-danger/10 flex items-center justify-center">
              <AlertTriangle size={16} className="text-danger" />
            </div>
            <div className="flex-1">
              <p className="text-[13px] font-semibold text-text-primary">Erreur de connexion</p>
              <p className="text-[11px] text-text-tertiary">
                {conn?.last_error || 'Une erreur est survenue avec cette intégration.'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button onClick={handleTest} disabled={testing} className="glass-button !text-[12px] inline-flex items-center gap-1.5">
              {testing ? <Loader2 size={12} className="animate-spin" /> : <Shield size={12} />}
              Re-tester
            </button>
            {app.connection_type === 'oauth' ? (
              <button onClick={handleOAuth} disabled={saving} className="glass-button-primary !text-[12px] inline-flex items-center gap-1.5">
                {saving ? <Loader2 size={12} className="animate-spin" /> : <Link2 size={12} />}
                Reconnecter
              </button>
            ) : null}
            <button onClick={() => setShowDisconnectConfirm(true)} className="glass-button !text-[12px] inline-flex items-center gap-1.5 !text-danger !border-danger/30">
              <Unplug size={12} /> Déconnecter
            </button>
          </div>

          {showDisconnectConfirm && (
            <div className="flex items-center gap-2">
              <button onClick={handleDisconnect} disabled={disconnecting} className="glass-button !text-[12px] !bg-danger !text-white !border-danger inline-flex items-center gap-1.5">
                {disconnecting ? <Loader2 size={12} className="animate-spin" /> : null}
                Confirmer la déconnexion
              </button>
              <button onClick={() => setShowDisconnectConfirm(false)} className="glass-button !text-[12px]">
                Annuler
              </button>
            </div>
          )}
        </div>
      );
    }

    // ── COMING SOON ──
    if (app.connection_type === 'coming_soon') {
      return (
        <div className="p-4 bg-surface-secondary/50 rounded-xl text-center">
          <p className="text-[13px] font-medium text-text-secondary">This integration is coming soon.</p>
          <p className="text-[11px] text-text-tertiary mt-1">We'll notify you when it becomes available.</p>
        </div>
      );
    }

    // ── INTERNAL (always connected) ──
    if (app.connection_type === 'internal') {
      return (
        <div className="space-y-4">
          <div className="flex items-center gap-3 p-3 bg-success/5 border border-success/20 rounded-xl">
            <div className="w-8 h-8 rounded-lg bg-success/10 flex items-center justify-center">
              <Check size={16} className="text-success" />
            </div>
            <div>
              <p className="text-[13px] font-semibold text-text-primary">Built-in Integration</p>
              <p className="text-[11px] text-text-tertiary">This integration is pre-configured and always active.</p>
            </div>
          </div>
          {app.auth_fields.length > 0 && (
            <div className="space-y-3">
              <p className="text-[10px] font-bold text-text-tertiary uppercase tracking-wider">Current Configuration</p>
              {app.auth_fields.map((field) => (
                <div key={field.key} className="flex items-center justify-between py-2 px-3 bg-surface-secondary/50 rounded-lg">
                  <span className="text-[12px] text-text-secondary">{field.label}</span>
                  <span className="text-[12px] text-text-tertiary font-mono">Configured</span>
                </div>
              ))}
            </div>
          )}
        </div>
      );
    }

    // ── OAUTH FLOW ──
    if (app.connection_type === 'oauth') {
      return (
        <div className="space-y-4">
          <div className="p-4 bg-surface-secondary/50 rounded-xl space-y-3">
            <div className="flex items-center gap-2">
              <Link2 size={14} className="text-text-tertiary" />
              <p className="text-[12px] font-semibold text-text-primary">Connexion via {app.oauth_provider || 'OAuth'}</p>
            </div>
            <p className="text-[12px] text-text-secondary">
              Cliquez pour connecter votre compte {app.name}. Vous serez redirigé vers {app.oauth_provider || app.name} pour autoriser Lume CRM.
            </p>
            <button
              onClick={handleOAuth}
              disabled={saving}
              className="glass-button-primary !text-[12px] w-full inline-flex items-center justify-center gap-2"
            >
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} />}
              {saving ? 'Redirection...' : `Connecter ${app.name}`}
            </button>
            {app.official_setup_url && (
              <a
                href={app.official_setup_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-[11px] text-primary hover:underline w-full justify-center"
                onClick={(e) => e.stopPropagation()}
              >
                <ExternalLink size={10} /> Console développeur {app.name}
              </a>
            )}
          </div>
        </div>
      );
    }

    // ── WEBHOOK FLOW ──
    if (app.connection_type === 'webhook') {
      return (
        <div className="space-y-4">
          {/* Webhook URL */}
          <div className="space-y-2">
            <p className="text-[10px] font-bold text-text-tertiary uppercase tracking-wider">Your Webhook Endpoint</p>
            <div className="flex items-center gap-2 p-3 bg-surface-secondary/50 rounded-xl border border-outline-subtle/40">
              <code className="text-[11px] text-text-primary font-mono flex-1 truncate">{webhookUrl}</code>
              <button onClick={handleCopyWebhook} className="p-1.5 rounded-md text-text-tertiary hover:text-primary hover:bg-primary/5 transition-colors" title="Copy URL">
                <Copy size={13} />
              </button>
            </div>
            {app.webhook_instructions && (
              <p className="text-[11px] text-text-tertiary leading-relaxed">{app.webhook_instructions}</p>
            )}
          </div>

          {/* API key if needed */}
          {app.auth_fields.length > 0 && (
            <div className="space-y-3">
              <p className="text-[10px] font-bold text-text-tertiary uppercase tracking-wider">Authentication</p>
              {app.auth_fields.map((field) => (
                <CredentialField
                  key={field.key}
                  field={field}
                  value={formValues[field.key] || ''}
                  onChange={(v) => handleFieldChange(field.key, v)}
                />
              ))}
            </div>
          )}

          <button
            onClick={handleSave}
            disabled={!requiredFieldsFilled || saving}
            className="glass-button-primary !text-[12px] w-full inline-flex items-center justify-center gap-2"
          >
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} />}
            {saving ? 'Connecting...' : 'Activate Webhook'}
          </button>
        </div>
      );
    }

    // ── LIFE360 SETUP GUIDE (manual, no API) ──
    if (app.id === 'life360') {
      return (
        <div className="space-y-4">
          <a
            href="https://www.life360.com"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 p-4 bg-primary/5 border border-primary/20 rounded-xl text-[13px] text-primary hover:bg-primary/10 transition-colors font-medium"
            onClick={(e) => e.stopPropagation()}
          >
            <ExternalLink size={14} />
            Open Life360 Website
          </a>

          <div>
            <p className="text-[10px] font-bold text-text-tertiary uppercase tracking-wider mb-3">Setup Guide</p>
            <div className="space-y-2.5">
              {[
                { step: '1', title: 'Install the Life360 app', desc: 'Download Life360 from the App Store or Google Play on each technician\'s phone.' },
                { step: '2', title: 'Create a team circle', desc: 'Open the app and create a new circle for your field team.' },
                { step: '3', title: 'Invite technicians', desc: 'Add all technicians to the circle using their phone numbers or email addresses.' },
                { step: '4', title: 'Enable location sharing', desc: 'Each technician must accept the invite and enable "Always" location sharing.' },
              ].map((item) => (
                <div key={item.step} className="flex items-start gap-3 p-3 bg-surface-secondary/50 rounded-xl">
                  <div className="w-5 h-5 rounded-md bg-text-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                    <span className="text-[10px] font-bold text-text-secondary">{item.step}</span>
                  </div>
                  <div>
                    <p className="text-[12px] font-semibold text-text-primary">{item.title}</p>
                    <p className="text-[11px] text-text-tertiary mt-0.5 leading-relaxed">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="p-3 bg-surface-secondary/30 rounded-xl border border-outline-subtle/30">
            <p className="text-[11px] text-text-tertiary leading-relaxed">
              Life360 does not currently offer a public API for third-party integrations. This setup guide helps your team use Life360's mobile app for location sharing. Full API integration will be added when available.
            </p>
          </div>

          <a
            href="https://www.life360.com/download/"
            target="_blank"
            rel="noopener noreferrer"
            className="glass-button-primary !text-[12px] w-full inline-flex items-center justify-center gap-2"
            onClick={(e) => e.stopPropagation()}
          >
            <ExternalLink size={12} />
            Download Life360 App
          </a>
        </div>
      );
    }

    // ── API KEY / MANUAL FLOW ──
    return (
      <div className="space-y-4">
        {app.official_setup_url && (
          <a
            href={app.official_setup_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 p-3 bg-primary/5 border border-primary/20 rounded-xl text-[12px] text-primary hover:bg-primary/10 transition-colors"
            onClick={(e) => e.stopPropagation()}
          >
            <ExternalLink size={13} />
            <span className="font-medium">Obtenir vos identifiants depuis {app.name}</span>
          </a>
        )}
        {app.auth_fields.length > 0 ? (
          <>
            <p className="text-[10px] font-bold text-text-tertiary uppercase tracking-wider">
              {app.connection_type === 'api_key' ? 'Identifiants API' : 'Configuration'}
            </p>
            <div className="space-y-3">
              {app.auth_fields.map((field) => (
                <CredentialField
                  key={field.key}
                  field={field}
                  value={formValues[field.key] || ''}
                  onChange={(v) => handleFieldChange(field.key, v)}
                />
              ))}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleSave}
                disabled={!requiredFieldsFilled || saving}
                className="glass-button-primary !text-[12px] inline-flex items-center gap-1.5"
              >
                {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                {saving ? 'Validation en cours...' : 'Valider & Connecter'}
              </button>
            </div>
            <p className="text-[10px] text-text-tertiary">
              Les identifiants seront testés en temps réel avant d'être sauvegardés.
            </p>
          </>
        ) : (
          <div className="p-4 bg-surface-secondary/50 rounded-xl text-center">
            <p className="text-[12px] text-text-tertiary">Aucune configuration requise pour cette intégration.</p>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 16, scale: 0.97 }}
        transition={{ duration: 0.2 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-surface w-full max-w-lg max-h-[90vh] rounded-2xl border border-outline shadow-2xl overflow-hidden flex flex-col"
      >
        {/* Colored banner */}
        <div className="relative h-20 shrink-0 flex items-end px-6 pb-0" style={{ backgroundColor: app.logo_color + '18' }}>
          <div className="absolute right-4 top-4">
            <button onClick={onClose} className="p-1.5 rounded-lg bg-surface/80 backdrop-blur-sm text-text-tertiary hover:text-text-primary transition-colors border border-outline-subtle/40">
              <X size={14} />
            </button>
          </div>
          <div className="translate-y-6">
            <AppLogo app={app} size="lg" />
          </div>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-6 pt-9 pb-6 space-y-5">
          {/* Header */}
          <div>
            <div className="flex items-center gap-2.5 mb-1">
              <h2 className="text-[18px] font-bold text-text-primary">{app.name}</h2>
              <StatusBadge status={status} />
            </div>
            <div className="flex items-center gap-2 text-[11px] text-text-tertiary font-medium">
              <span>{app.category}</span>
              <span>&middot;</span>
              <span>{connectionLabel(app.connection_type)}</span>
              {app.official_site_url && (
                <>
                  <span>&middot;</span>
                  <a
                    href={app.official_site_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    Website <ExternalLink size={9} />
                  </a>
                </>
              )}
              {app.docs_url && (
                <>
                  <span>&middot;</span>
                  <a
                    href={app.docs_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    Docs <ExternalLink size={9} />
                  </a>
                </>
              )}
            </div>
          </div>

          {/* Description */}
          <p className="text-[13px] text-text-secondary leading-relaxed">{app.description_long}</p>

          {/* Features */}
          <div>
            <p className="text-[10px] font-bold text-text-tertiary uppercase tracking-wider mb-2">Supported Features</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {app.supported_features.map((f, i) => (
                <div key={i} className="flex items-center gap-2 text-[12px] text-text-secondary">
                  <Check size={11} className="text-success shrink-0" />
                  {f}
                </div>
              ))}
            </div>
          </div>

          {/* Divider */}
          <div className="border-t border-outline-subtle/40" />

          {/* Connection UI */}
          <div>
            <p className="text-[10px] font-bold text-text-tertiary uppercase tracking-wider mb-3">
              {status === 'connected' ? 'Connection Status' : 'Setup'}
            </p>
            {renderConnectionUI()}
          </div>
        </div>
      </motion.div>
    </div>
  );
}

// ─── Connected Apps Summary ─────────────────────────────────────
function ConnectedAppsSummary({
  onOpenApp,
  getStatus,
}: {
  onOpenApp: (app: Integration) => void;
  getStatus: (app: Integration) => ResolvedStatus;
}) {
  const connected = INTEGRATIONS.filter((app) => getStatus(app) === 'connected');
  if (connected.length === 0) return null;

  return (
    <div className="section-card p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[11px] font-bold text-text-tertiary uppercase tracking-wider">
          Connected ({connected.length})
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {connected.map((app) => (
          <button
            key={app.id}
            onClick={() => onOpenApp(app)}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-secondary/50 hover:bg-surface-secondary border border-outline-subtle/40 transition-colors"
          >
            <AppLogo app={app} size="sm" />
            <span className="text-[12px] font-semibold text-text-primary">{app.name}</span>
            <Check size={11} className="text-success" />
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Main Marketplace Page ──────────────────────────────────────
export default function AppMarketplace() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [selectedApp, setSelectedApp] = useState<Integration | null>(null);
  const { getStatus, refresh, loading } = useConnectionState();

  const featured = useMemo(() => getFeaturedIntegrations(), []);

  const filtered = useMemo(() => {
    let list = INTEGRATIONS;
    if (activeCategory) {
      list = list.filter((a) => a.category === activeCategory);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (a) =>
          a.name.toLowerCase().includes(q) ||
          a.description_short.toLowerCase().includes(q) ||
          a.category.toLowerCase().includes(q) ||
          a.slug.toLowerCase().includes(q)
      );
    }
    return list;
  }, [search, activeCategory]);

  const showGrouped = !search.trim() && !activeCategory;

  return (
    <div className="space-y-6">
      {/* Back */}
      <button
        onClick={() => navigate('/settings')}
        className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-text-secondary hover:text-text-primary transition-colors"
      >
        <ArrowLeft size={14} /> Settings
      </button>

      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-text-primary flex items-center justify-center">
          <Zap size={18} className="text-surface" />
        </div>
        <div>
          <h1 className="text-[22px] font-bold text-text-primary tracking-tight">App Marketplace</h1>
          <p className="text-[13px] text-text-tertiary">Connect your favorite tools to extend your business workflow.</p>
        </div>
      </div>

      {/* Connected Apps Summary */}
      <ConnectedAppsSummary onOpenApp={setSelectedApp} getStatus={getStatus} />

      {/* Search */}
      <div className="relative max-w-md">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none" />
        <input
          value={search}
          onChange={(e) => { setSearch(e.target.value); setActiveCategory(null); }}
          placeholder="Search apps or features..."
          className="w-full bg-surface border border-outline-subtle/60 rounded-xl pl-9 pr-3 py-2.5 text-[13px] text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-primary/40 transition-colors"
        />
        {search && (
          <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-primary">
            <X size={12} />
          </button>
        )}
      </div>

      {/* Category pills */}
      <div className="flex flex-wrap gap-1.5">
        <button
          onClick={() => setActiveCategory(null)}
          className={cn(
            'px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all border',
            !activeCategory
              ? 'bg-text-primary text-surface border-text-primary'
              : 'bg-surface border-outline-subtle/60 text-text-secondary hover:border-outline hover:text-text-primary'
          )}
        >
          All Apps
        </button>
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => { setActiveCategory(activeCategory === cat ? null : cat); setSearch(''); }}
            className={cn(
              'px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all border',
              activeCategory === cat
                ? 'bg-text-primary text-surface border-text-primary'
                : 'bg-surface border-outline-subtle/60 text-text-secondary hover:border-outline hover:text-text-primary'
            )}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Content */}
      {showGrouped ? (
        <>
          {/* Featured */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Star size={14} className="text-text-secondary" />
              <h2 className="text-[15px] font-bold text-text-primary">Featured Apps</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {featured.map((app) => (
                <FeaturedCard key={app.id} app={app} status={getStatus(app)} onClick={() => setSelectedApp(app)} />
              ))}
            </div>
          </div>

          {/* Categories */}
          {CATEGORIES.map((cat) => {
            const apps = INTEGRATIONS.filter((a) => a.category === cat);
            if (apps.length === 0) return null;
            return (
              <div key={cat}>
                <h2 className="text-[15px] font-bold text-text-primary mb-3">{cat}</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {apps.map((app) => (
                    <AppCard key={app.id} app={app} status={getStatus(app)} onClick={() => setSelectedApp(app)} />
                  ))}
                </div>
              </div>
            );
          })}
        </>
      ) : filtered.length === 0 ? (
        <div className="section-card p-12 text-center">
          <Search size={28} className="text-text-tertiary mx-auto mb-3 opacity-30" />
          <p className="text-[14px] font-medium text-text-secondary">No apps found</p>
          <p className="text-[12px] text-text-tertiary mt-1">Try a different search term or category.</p>
        </div>
      ) : (
        <div>
          <p className="text-[12px] text-text-tertiary mb-3">{filtered.length} app{filtered.length !== 1 ? 's' : ''} found</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filtered.map((app) => (
              <AppCard key={app.id} app={app} status={getStatus(app)} onClick={() => setSelectedApp(app)} />
            ))}
          </div>
        </div>
      )}

      {/* Detail Modal */}
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
