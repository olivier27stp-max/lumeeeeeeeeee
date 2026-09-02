/* ═══════════════════════════════════════════════════════════════
   Settings → API & MCP
   ─────────────────────────────────────────────────────────────
   Owner/admin only (enforced server-side by requireAdmin and by RLS
   on `api_keys`). Two jobs:
     1. Manage machine credentials (create / list / revoke).
     2. Show how to connect an MCP client to this org's CRM.

   The raw key appears exactly once, right after creation. It is
   never stored client-side and cannot be retrieved afterwards.
   ═══════════════════════════════════════════════════════════════ */

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Check, Copy, KeyRound, Loader2, Plug, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from '../../i18n';
import {
  listApiKeys,
  createApiKey,
  revokeApiKey,
  getMcpInfo,
  listConnectedApps,
  revokeConnectedApp,
  buildClaudeCliCommand,
  buildMcpJsonConfig,
  type ApiKey,
  type CreatedApiKey,
  type McpInfo,
  type ConnectedApp,
} from '../../lib/mcpApi';

function fmtDate(iso: string | null, fr: boolean): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(fr ? 'fr-CA' : 'en-CA', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

/** A key is unusable if revoked or past its expiry. */
function isInactive(k: ApiKey): boolean {
  return k.revoked || (k.expires_at != null && new Date(k.expires_at) < new Date());
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          toast.error(label);
        }
      }}
      className="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-secondary transition shrink-0"
      title={label}
    >
      {copied ? <Check size={14} className="text-success" /> : <Copy size={14} />}
    </button>
  );
}

export default function ApiMcpSettings() {
  const { language } = useTranslation();
  const fr = language === 'fr';

  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [mcp, setMcp] = useState<McpInfo | null>(null);
  const [apps, setApps] = useState<ConnectedApp[]>([]);
  const [revokingApp, setRevokingApp] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [showForm, setShowForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [justCreated, setJustCreated] = useState<CreatedApiKey | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      // Infos MCP et applications connectées sont accessoires : leur échec
      // ne doit pas masquer la liste des clés.
      const [k, m, a] = await Promise.all([
        listApiKeys(),
        getMcpInfo().catch(() => null),
        listConnectedApps().catch(() => []),
      ]);
      setKeys(k);
      setMcp(m);
      setApps(a);
    } catch (err: any) {
      setError(err?.message || (fr ? 'Échec du chargement' : 'Failed to load'));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleCreate() {
    const name = newName.trim();
    if (name.length < 2) {
      toast.error(fr ? 'Donnez un nom d’au moins 2 caractères.' : 'Name must be at least 2 characters.');
      return;
    }
    setCreating(true);
    try {
      const created = await createApiKey({ name, scopes: ['mcp'] });
      setJustCreated(created);
      setNewName('');
      setShowForm(false);
      await load();
    } catch (err: any) {
      toast.error(err?.message || (fr ? 'Création impossible' : 'Could not create key'));
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(k: ApiKey) {
    const ok = window.confirm(
      fr
        ? `Révoquer « ${k.name} » ? Tout client qui l’utilise perdra l’accès immédiatement. Cette action est irréversible.`
        : `Revoke "${k.name}"? Any client using it loses access immediately. This cannot be undone.`,
    );
    if (!ok) return;
    setRevokingId(k.id);
    try {
      await revokeApiKey(k.id);
      toast.success(fr ? 'Clé révoquée' : 'Key revoked');
      await load();
    } catch (err: any) {
      toast.error(err?.message || (fr ? 'Révocation impossible' : 'Could not revoke key'));
    } finally {
      setRevokingId(null);
    }
  }

  async function handleRevokeApp(app: ConnectedApp) {
    const ok = window.confirm(
      fr
        ? `Retirer l’accès de « ${app.client_name} » ? L’application devra être réautorisée pour consulter vos données.`
        : `Remove access for "${app.client_name}"? The application will need to be authorized again.`,
    );
    if (!ok) return;
    setRevokingApp(app.id);
    try {
      await revokeConnectedApp(app.id);
      toast.success(fr ? 'Accès retiré' : 'Access removed');
      await load();
    } catch (err: any) {
      toast.error(err?.message || (fr ? 'Retrait impossible' : 'Could not remove access'));
    } finally {
      setRevokingApp(null);
    }
  }

  const activeKeys = keys.filter((k) => !isInactive(k));
  const mcpUrl = mcp?.url || '';

  return (
    <div className="max-w-3xl space-y-6">
      {/* ── Intro ── */}
      <div>
        <h2 className="text-[15px] font-semibold text-text-primary flex items-center gap-2">
          <Plug size={16} className="text-text-tertiary" />
          {fr ? 'API & MCP' : 'API & MCP'}
        </h2>
        <p className="mt-1 text-[13px] text-text-secondary leading-relaxed">
          {fr
            ? 'Connectez un assistant IA (Claude, Cursor…) à votre CRM pour le consulter en langage naturel : chiffre d’affaires, horaire, impayés, clients. L’accès est en lecture seule — aucun assistant ne peut modifier vos données.'
            : 'Connect an AI assistant (Claude, Cursor…) to your CRM and query it in plain language: revenue, schedule, unpaid invoices, clients. Access is read-only — no assistant can change your data.'}
        </p>
      </div>

      {error && <div className="section-card p-4 text-[13px] text-danger">{error}</div>}

      {/* ── Connexion recommandée : OAuth ── */}
      {mcp?.enabled && mcpUrl && (
        <div className="section-card p-4 space-y-3">
          <div>
            <h3 className="text-[13px] font-semibold text-text-primary">
              {fr ? 'Connecter un assistant' : 'Connect an assistant'}
            </h3>
            <p className="mt-1 text-[12.5px] text-text-secondary leading-relaxed">
              {fr
                ? 'Dans Claude : Réglages › Connecteurs › Ajouter un connecteur personnalisé, puis collez cette adresse. Vous vous connecterez avec votre compte Lume — aucune clé à copier.'
                : 'In Claude: Settings › Connectors › Add custom connector, then paste this address. You sign in with your Lume account — no key to copy.'}
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-lg bg-surface-secondary border border-outline/50 px-3 py-2">
            <code className="text-[12px] font-mono text-text-primary break-all flex-1">{mcpUrl}</code>
            <CopyButton value={mcpUrl} label={fr ? 'Copier l’adresse' : 'Copy address'} />
          </div>
        </div>
      )}

      {/* ── Applications connectées (OAuth) ── */}
      {apps.length > 0 && (
        <div className="section-card overflow-hidden">
          <div className="px-4 py-3 border-b border-outline/30">
            <span className="text-[13px] font-semibold text-text-primary">
              {fr ? 'Applications connectées' : 'Connected applications'}
            </span>
            <p className="mt-0.5 text-[11.5px] text-text-tertiary">
              {fr ? 'Autorisées avec votre compte.' : 'Authorized with your account.'}
            </p>
          </div>
          <div className="divide-y divide-outline/30">
            {apps.map((app) => (
              <div key={app.id} className="px-4 py-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-surface-secondary flex items-center justify-center shrink-0">
                    {app.logo_uri
                      ? <img src={app.logo_uri} alt="" className="w-5 h-5 rounded" />
                      : <Plug size={14} className="text-text-tertiary" />}
                  </div>
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium text-text-primary truncate">{app.client_name}</div>
                    <div className="text-[11.5px] text-text-tertiary">
                      {fr ? 'Autorisée le ' : 'Authorized '}{fmtDate(app.created_at, fr)}
                      {' · '}
                      {fr ? 'utilisée : ' : 'last used: '}
                      {app.last_used_at ? fmtDate(app.last_used_at, fr) : (fr ? 'jamais' : 'never')}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleRevokeApp(app)}
                  disabled={revokingApp === app.id}
                  className="p-1.5 rounded-lg text-text-tertiary hover:text-danger hover:bg-surface-secondary transition disabled:opacity-50 shrink-0"
                  title={fr ? 'Retirer l’accès' : 'Remove access'}
                >
                  {revokingApp === app.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Raw key, shown once ── */}
      {justCreated && (
        <div className="section-card p-4 space-y-3 border-warning/40">
          <div className="flex items-start gap-2">
            <AlertTriangle size={16} className="text-warning shrink-0 mt-0.5" />
            <div className="text-[13px] text-text-primary">
              <p className="font-semibold">{fr ? 'Copiez cette clé maintenant' : 'Copy this key now'}</p>
              <p className="text-text-secondary mt-0.5">
                {fr
                  ? 'Elle ne sera plus jamais affichée. Si vous la perdez, créez-en une nouvelle.'
                  : 'It will never be shown again. If you lose it, create a new one.'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-lg bg-surface-secondary border border-outline/50 px-3 py-2">
            <code className="text-[12px] font-mono text-text-primary break-all flex-1">{justCreated.key}</code>
            <CopyButton value={justCreated.key} label={fr ? 'Copier la clé' : 'Copy key'} />
          </div>
          <button
            type="button"
            onClick={() => setJustCreated(null)}
            className="text-[12px] text-text-tertiary hover:text-text-primary transition"
          >
            {fr ? 'J’ai copié la clé — masquer' : 'I saved it — hide'}
          </button>
        </div>
      )}

      {/* ── Keys ── */}
      <div className="section-card overflow-hidden">
        <div className="px-4 py-3 flex items-center justify-between gap-2 border-b border-outline/30">
          <div className="flex items-center gap-2">
            <KeyRound size={15} className="text-text-tertiary" />
            <div>
              <span className="text-[13px] font-semibold text-text-primary">{fr ? 'Clés d’accès' : 'Access keys'}</span>
              <p className="text-[11.5px] text-text-tertiary">
                {fr
                  ? 'Pour les scripts et outils en ligne de commande. Partagées par l’organisation.'
                  : 'For scripts and command-line tools. Shared across the organization.'}
              </p>
            </div>
          </div>
          {!showForm && (
            <button
              type="button"
              onClick={() => setShowForm(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-surface-secondary hover:bg-surface-secondary/70 px-3 py-1.5 text-[12px] font-medium text-text-primary transition"
            >
              <Plus size={13} />
              {fr ? 'Nouvelle clé' : 'New key'}
            </button>
          )}
        </div>

        {showForm && (
          <div className="px-4 py-3 bg-surface-secondary/20 border-b border-outline/30 space-y-2">
            <label className="block text-[12px] font-medium text-text-secondary">
              {fr ? 'Nom de la clé' : 'Key name'}
            </label>
            <div className="flex items-center gap-2">
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
                placeholder={fr ? 'Ex. Claude — portable' : 'e.g. Claude — laptop'}
                className="flex-1 rounded-lg bg-surface-card border border-outline/50 px-3 py-2 text-[13px] text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-outline"
              />
              <button
                type="button"
                onClick={handleCreate}
                disabled={creating}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-[12px] font-medium text-white disabled:opacity-60 transition"
              >
                {creating ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                {fr ? 'Créer' : 'Create'}
              </button>
              <button
                type="button"
                onClick={() => { setShowForm(false); setNewName(''); }}
                className="text-[12px] text-text-tertiary hover:text-text-primary px-2 transition"
              >
                {fr ? 'Annuler' : 'Cancel'}
              </button>
            </div>
            <p className="text-[11.5px] text-text-tertiary">
              {fr
                ? 'La clé expire automatiquement après 90 jours, ou après 60 jours sans utilisation.'
                : 'The key expires automatically after 90 days, or after 60 days of no use.'}
            </p>
          </div>
        )}

        {loading ? (
          <div className="p-4 space-y-2">
            <div className="h-12 rounded-xl bg-surface-secondary/40 animate-pulse" />
            <div className="h-12 rounded-xl bg-surface-secondary/40 animate-pulse" />
          </div>
        ) : keys.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-[13px] text-text-secondary">
              {fr ? 'Aucune clé pour l’instant.' : 'No keys yet.'}
            </p>
            <p className="text-[12px] text-text-tertiary mt-1">
              {fr ? 'Créez-en une pour connecter un assistant.' : 'Create one to connect an assistant.'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-outline/30">
            {keys.map((k) => {
              const inactive = isInactive(k);
              return (
                <div key={k.id} className="px-4 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-[13px] font-medium truncate ${inactive ? 'text-text-tertiary line-through' : 'text-text-primary'}`}>
                        {k.name}
                      </span>
                      {k.revoked ? (
                        <span className="inline-flex items-center rounded-full bg-surface-secondary text-text-tertiary px-2 py-0.5 text-[10.5px] font-medium">
                          {fr ? 'Révoquée' : 'Revoked'}
                        </span>
                      ) : inactive ? (
                        <span className="inline-flex items-center rounded-full bg-surface-secondary text-text-tertiary px-2 py-0.5 text-[10.5px] font-medium">
                          {fr ? 'Expirée' : 'Expired'}
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-0.5 flex items-center gap-3 text-[11.5px] text-text-tertiary">
                      <code className="font-mono">{k.key_prefix}</code>
                      <span>
                        {fr ? 'Utilisée : ' : 'Last used: '}
                        {k.last_used_at ? fmtDate(k.last_used_at, fr) : (fr ? 'jamais' : 'never')}
                      </span>
                      <span className="hidden sm:inline">
                        {fr ? 'Expire : ' : 'Expires: '}{fmtDate(k.expires_at, fr)}
                      </span>
                    </div>
                  </div>
                  {!k.revoked && (
                    <button
                      type="button"
                      onClick={() => handleRevoke(k)}
                      disabled={revokingId === k.id}
                      className="p-1.5 rounded-lg text-text-tertiary hover:text-danger hover:bg-surface-secondary transition disabled:opacity-50 shrink-0"
                      title={fr ? 'Révoquer' : 'Revoke'}
                    >
                      {revokingId === k.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Connect ── */}
      {mcp?.enabled && (
        <div className="section-card p-4 space-y-4">
          <div>
            <h3 className="text-[13px] font-semibold text-text-primary">
              {fr ? 'Connecter Claude à Lume' : 'Connect Claude to Lume'}
            </h3>
            <p className="mt-1 text-[12.5px] text-text-secondary leading-relaxed">
              {fr
                ? 'Créez une clé ci-dessus, puis lancez cette commande dans votre terminal en remplaçant la clé.'
                : 'Create a key above, then run this command in your terminal, replacing the key.'}
            </p>
          </div>

          <div>
            <div className="text-[11.5px] font-medium text-text-secondary mb-1.5">
              {fr ? 'Claude Code (terminal)' : 'Claude Code (terminal)'}
            </div>
            <div className="flex items-start gap-2 rounded-lg bg-surface-secondary border border-outline/50 px-3 py-2">
              <code className="text-[11.5px] font-mono text-text-primary break-all flex-1 leading-relaxed">
                {buildClaudeCliCommand(mcpUrl)}
              </code>
              <CopyButton value={buildClaudeCliCommand(mcpUrl)} label={fr ? 'Copier' : 'Copy'} />
            </div>
          </div>

          <div>
            <div className="text-[11.5px] font-medium text-text-secondary mb-1.5">
              {fr ? 'Autres clients (fichier de configuration)' : 'Other clients (config file)'}
            </div>
            <div className="flex items-start gap-2 rounded-lg bg-surface-secondary border border-outline/50 px-3 py-2">
              <pre className="text-[11.5px] font-mono text-text-primary flex-1 overflow-x-auto leading-relaxed">
                {buildMcpJsonConfig(mcpUrl)}
              </pre>
              <CopyButton value={buildMcpJsonConfig(mcpUrl)} label={fr ? 'Copier' : 'Copy'} />
            </div>
          </div>

          {activeKeys.length === 0 && (
            <p className="text-[12px] text-text-tertiary">
              {fr
                ? 'Aucune clé active — créez-en une pour que la connexion fonctionne.'
                : 'No active key — create one for the connection to work.'}
            </p>
          )}

          {mcp.tools.length > 0 && (
            <details className="group">
              <summary className="text-[12px] text-text-secondary hover:text-text-primary cursor-pointer transition list-none">
                {fr
                  ? `Ce que l’assistant peut consulter (${mcp.tools.length})`
                  : `What the assistant can read (${mcp.tools.length})`}
              </summary>
              <ul className="mt-2 space-y-1.5">
                {mcp.tools.map((t) => (
                  <li key={t.name} className="text-[11.5px] text-text-tertiary leading-relaxed">
                    <code className="font-mono text-text-secondary">{t.name}</code> — {t.description}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
