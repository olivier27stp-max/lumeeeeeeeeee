import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, Copy, Check, Loader2, Send, ListChecks, X, AlertTriangle, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from '../i18n';
import BackToSettings from '../components/ui/BackToSettings';
import {
  listWebhooks,
  fetchKnownEvents,
  createWebhook,
  updateWebhook,
  deleteWebhook,
  testWebhook,
  listDeliveries,
  type WebhookEndpoint,
  type WebhookDelivery,
} from '../lib/webhooksApi';

function truncate(s: string, n: number): string {
  if (!s) return '';
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

function StatusDot({ status }: { status: string | null }) {
  let color = 'bg-zinc-400';
  if (status === 'sent') color = 'bg-emerald-500';
  else if (status === 'failed') color = 'bg-amber-500';
  else if (status === 'abandoned') color = 'bg-red-500';
  else if (status === 'pending') color = 'bg-sky-500';
  return <span className={`inline-block w-2.5 h-2.5 rounded-full ${color}`} aria-label={status || 'unknown'} />;
}

export default function WebhookSettings() {
  const { t, language } = useTranslation();
  const fr = language === 'fr';
  const wt = (t as any).webhooks || {};

  const [loading, setLoading] = useState(true);
  const [endpoints, setEndpoints] = useState<WebhookEndpoint[]>([]);
  const [knownEvents, setKnownEvents] = useState<string[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<WebhookEndpoint | null>(null);
  const [secretReveal, setSecretReveal] = useState<{ id: string; secret: string } | null>(null);
  const [drawer, setDrawer] = useState<{ endpoint: WebhookEndpoint; deliveries: WebhookDelivery[] } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, events] = await Promise.all([listWebhooks(), fetchKnownEvents()]);
      setEndpoints(list);
      setKnownEvents(events);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to load webhooks');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const onTest = async (id: string) => {
    setBusyId(id);
    try {
      await testWebhook(id);
      toast.success(fr ? 'Test envoyé' : 'Test sent');
      setTimeout(load, 1500);
    } catch (err: any) {
      toast.error(err?.message || 'Test failed');
    } finally {
      setBusyId(null);
    }
  };

  const onDelete = async (id: string) => {
    if (!confirm(fr ? 'Désactiver ce webhook ?' : 'Deactivate this webhook?')) return;
    setBusyId(id);
    try {
      await deleteWebhook(id);
      toast.success(fr ? 'Webhook désactivé' : 'Webhook deactivated');
      load();
    } catch (err: any) {
      toast.error(err?.message || 'Delete failed');
    } finally {
      setBusyId(null);
    }
  };

  const openDeliveries = async (ep: WebhookEndpoint) => {
    try {
      const deliveries = await listDeliveries(ep.id, 50);
      setDrawer({ endpoint: ep, deliveries });
    } catch (err: any) {
      toast.error(err?.message || 'Failed to load deliveries');
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
      <BackToSettings />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{wt.title || (fr ? 'Webhooks' : 'Webhooks')}</h1>
          <p className="text-sm text-zinc-500 mt-1">
            {wt.subtitle || (fr
              ? 'Envoyez des événements CRM vers vos services externes (Zapier, Make, n8n, etc.).'
              : 'Send CRM events to external services (Zapier, Make, n8n, etc.).')}
          </p>
        </div>
        <button
          onClick={() => { setEditing(null); setShowCreate(true); }}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 text-sm font-medium"
        >
          <Plus size={16} /> {wt.addEndpoint || (fr ? 'Ajouter un webhook' : 'Add webhook')}
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-zinc-500">
          <Loader2 className="animate-spin mr-2" size={18} /> {fr ? 'Chargement…' : 'Loading…'}
        </div>
      ) : endpoints.length === 0 ? (
        <div className="border border-dashed rounded-xl p-10 text-center text-zinc-500">
          {wt.emptyState || (fr ? 'Aucun webhook configuré.' : 'No webhooks configured yet.')}
        </div>
      ) : (
        <div className="border rounded-xl divide-y bg-white dark:bg-zinc-900 dark:border-zinc-800">
          {endpoints.map((ep) => (
            <div key={ep.id} className="p-4 flex items-center gap-4">
              <StatusDot status={ep.is_active ? (ep.last_delivery_status || 'pending') : 'inactive'} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="font-medium truncate">{ep.name}</div>
                  {!ep.is_active && (
                    <span className="text-xs rounded-full bg-zinc-200 dark:bg-zinc-800 px-2 py-0.5">
                      {fr ? 'Inactif' : 'Inactive'}
                    </span>
                  )}
                </div>
                <div className="text-xs text-zinc-500 truncate font-mono">{truncate(ep.url, 80)}</div>
                <div className="text-xs text-zinc-500 mt-1">
                  {(ep.events?.length || 0)} {wt.eventsCount || (fr ? 'événement(s)' : 'event(s)')} ·{' '}
                  {wt.lastDelivery || (fr ? 'Dernier envoi' : 'Last delivery')}: {formatDate(ep.last_delivery_at)}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  className="p-2 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  title={wt.testEndpoint || 'Test'}
                  onClick={() => onTest(ep.id)}
                  disabled={busyId === ep.id}
                >
                  {busyId === ep.id ? <Loader2 className="animate-spin" size={16} /> : <Send size={16} />}
                </button>
                <button
                  className="p-2 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  title={wt.deliveries || 'Deliveries'}
                  onClick={() => openDeliveries(ep)}
                >
                  <ListChecks size={16} />
                </button>
                <button
                  className="p-2 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  title={fr ? 'Modifier' : 'Edit'}
                  onClick={() => { setEditing(ep); setShowCreate(true); }}
                >
                  <RefreshCw size={16} />
                </button>
                <button
                  className="p-2 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-red-600"
                  title={fr ? 'Supprimer' : 'Delete'}
                  onClick={() => onDelete(ep.id)}
                  disabled={busyId === ep.id}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <DocsPanel fr={fr} />

      {showCreate && (
        <EndpointModal
          fr={fr}
          knownEvents={knownEvents}
          editing={editing}
          onClose={() => setShowCreate(false)}
          onCreated={({ id, secret }) => {
            setShowCreate(false);
            setSecretReveal({ id, secret });
            load();
          }}
          onUpdated={() => {
            setShowCreate(false);
            load();
          }}
        />
      )}

      {secretReveal && (
        <SecretRevealModal fr={fr} secret={secretReveal.secret} onClose={() => setSecretReveal(null)} />
      )}

      {drawer && (
        <DeliveriesDrawer fr={fr} endpoint={drawer.endpoint} deliveries={drawer.deliveries} onClose={() => setDrawer(null)} />
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────

function EndpointModal({
  fr,
  knownEvents,
  editing,
  onClose,
  onCreated,
  onUpdated,
}: {
  fr: boolean;
  knownEvents: string[];
  editing: WebhookEndpoint | null;
  onClose: () => void;
  onCreated: (r: { id: string; secret: string }) => void;
  onUpdated: () => void;
}) {
  const [name, setName] = useState(editing?.name || '');
  const [url, setUrl] = useState(editing?.url || '');
  const [selected, setSelected] = useState<Set<string>>(new Set(editing?.events || []));
  const [isActive, setIsActive] = useState(editing?.is_active ?? true);
  const [saving, setSaving] = useState(false);

  const toggleEvent = (e: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(e)) next.delete(e); else next.add(e);
      return next;
    });
  };

  const save = async () => {
    if (!name.trim()) return toast.error(fr ? 'Nom requis' : 'Name required');
    if (!url.trim() || !/^https?:\/\//.test(url.trim())) {
      return toast.error(fr ? 'URL HTTPS valide requise' : 'Valid URL required');
    }
    if (selected.size === 0) return toast.error(fr ? 'Au moins un événement' : 'At least one event');
    setSaving(true);
    try {
      if (editing) {
        await updateWebhook(editing.id, {
          name: name.trim(),
          url: url.trim(),
          events: Array.from(selected),
          is_active: isActive,
        });
        toast.success(fr ? 'Webhook mis à jour' : 'Webhook updated');
        onUpdated();
      } else {
        const r = await createWebhook({
          name: name.trim(),
          url: url.trim(),
          events: Array.from(selected),
          is_active: isActive,
        });
        onCreated({ id: r.endpoint.id, secret: r.secret });
      }
    } catch (err: any) {
      toast.error(err?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-zinc-900 rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 border-b dark:border-zinc-800 flex items-center justify-between">
          <h2 className="font-semibold">
            {editing ? (fr ? 'Modifier le webhook' : 'Edit webhook') : (fr ? 'Nouveau webhook' : 'New webhook')}
          </h2>
          <button onClick={onClose} className="p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded">
            <X size={18} />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="text-sm font-medium">{fr ? 'Nom' : 'Name'}</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={fr ? 'Mon Zap' : 'My Zap'}
              className="mt-1 w-full px-3 py-2 rounded-lg border dark:border-zinc-700 bg-white dark:bg-zinc-800"
            />
          </div>
          <div>
            <label className="text-sm font-medium">URL</label>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://hooks.zapier.com/..."
              className="mt-1 w-full px-3 py-2 rounded-lg border dark:border-zinc-700 bg-white dark:bg-zinc-800 font-mono text-sm"
            />
          </div>
          <div>
            <label className="text-sm font-medium">{fr ? 'Événements' : 'Events'}</label>
            <div className="mt-2 grid grid-cols-2 gap-2 max-h-64 overflow-y-auto pr-1">
              {knownEvents.map((e) => (
                <label key={e} className="inline-flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selected.has(e)}
                    onChange={() => toggleEvent(e)}
                    className="rounded"
                  />
                  <span className="font-mono text-xs">{e}</span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
              {fr ? 'Actif' : 'Active'}
            </label>
          </div>
        </div>
        <div className="p-5 border-t dark:border-zinc-800 flex items-center justify-end gap-2">
          <button onClick={onClose} className="px-3 py-2 text-sm rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800">
            {fr ? 'Annuler' : 'Cancel'}
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="px-3 py-2 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 text-white inline-flex items-center gap-2"
          >
            {saving && <Loader2 className="animate-spin" size={14} />}
            {fr ? 'Enregistrer' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────

function SecretRevealModal({ fr, secret, onClose }: { fr: boolean; secret: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  };
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-zinc-900 rounded-2xl max-w-lg w-full p-5">
        <div className="flex items-start gap-3">
          <AlertTriangle className="text-amber-500 shrink-0 mt-0.5" size={22} />
          <div className="flex-1">
            <h2 className="font-semibold">
              {fr ? 'Copiez votre secret de signature' : 'Copy your signing secret'}
            </h2>
            <p className="text-sm text-zinc-500 mt-1">
              {fr
                ? "Vous ne verrez plus jamais ce secret. Stockez-le en lieu sûr — il sert à vérifier les signatures HMAC."
                : "You won't see this secret again. Store it securely — use it to verify HMAC signatures."}
            </p>
          </div>
        </div>
        <div className="mt-4 p-3 bg-zinc-100 dark:bg-zinc-800 rounded-lg font-mono text-xs break-all">
          {secret}
        </div>
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            onClick={copy}
            className="px-3 py-2 text-sm rounded-lg border hover:bg-zinc-50 dark:hover:bg-zinc-800 inline-flex items-center gap-2"
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? (fr ? 'Copié' : 'Copied') : (fr ? 'Copier' : 'Copy')}
          </button>
          <button
            onClick={onClose}
            className="px-3 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700"
          >
            {fr ? "J'ai sauvegardé" : 'I saved it'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────

function DeliveriesDrawer({
  fr,
  endpoint,
  deliveries,
  onClose,
}: {
  fr: boolean;
  endpoint: WebhookEndpoint;
  deliveries: WebhookDelivery[];
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex justify-end" onClick={onClose}>
      <div
        className="bg-white dark:bg-zinc-900 w-full max-w-xl h-full overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 border-b dark:border-zinc-800 flex items-center justify-between">
          <div>
            <h2 className="font-semibold">{fr ? 'Livraisons récentes' : 'Recent deliveries'}</h2>
            <div className="text-xs text-zinc-500 truncate font-mono">{endpoint.name}</div>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded">
            <X size={18} />
          </button>
        </div>
        <div className="divide-y dark:divide-zinc-800">
          {deliveries.length === 0 ? (
            <div className="p-6 text-center text-sm text-zinc-500">
              {fr ? 'Aucune livraison.' : 'No deliveries yet.'}
            </div>
          ) : (
            deliveries.map((d) => (
              <div key={d.id} className="p-4 text-sm">
                <div className="flex items-center gap-2">
                  <StatusDot status={d.status} />
                  <span className="font-mono text-xs">{d.event_name}</span>
                  <span className="ml-auto text-xs text-zinc-500">{formatDate(d.created_at)}</span>
                </div>
                <div className="mt-1 text-xs text-zinc-500">
                  {fr ? 'Statut' : 'Status'}: <b>{d.status}</b>
                  {' · '}{fr ? 'Tentatives' : 'Attempts'}: {d.attempt_count}
                  {d.http_status != null && <> {' · '}HTTP {d.http_status}</>}
                </div>
                {d.error_message && (
                  <div className="mt-1 text-xs text-red-600 break-all">{d.error_message}</div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────

function DocsPanel({ fr }: { fr: boolean }) {
  const example = `// Express signature verification
import crypto from 'crypto';

app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const sig = req.header('X-Lume-Signature') || '';
  const m = /t=(\\d+),v1=([a-f0-9]+)/.exec(sig);
  if (!m) return res.status(400).end();
  const [, ts, hex] = m;
  const expected = crypto
    .createHmac('sha256', process.env.LUME_WEBHOOK_SECRET)
    .update(ts + '.' + req.body.toString('utf8'))
    .digest('hex');
  if (!crypto.timingSafeEqual(Buffer.from(hex), Buffer.from(expected))) {
    return res.status(401).end();
  }
  const event = JSON.parse(req.body.toString('utf8'));
  console.log('Lume event:', event.event, event.data);
  res.status(200).end();
});`;

  const curlExample = `curl -X POST https://your.endpoint/webhook \\
  -H "X-Lume-Event: webhook.test" \\
  -H "X-Lume-Signature: t=1715551234,v1=<hex>" \\
  -H "Content-Type: application/json" \\
  -d '{"event":"webhook.test","data":{"message":"Test"}}'`;

  return (
    <details className="border rounded-xl p-4 bg-white dark:bg-zinc-900 dark:border-zinc-800">
      <summary className="cursor-pointer font-medium">
        {fr ? 'Documentation — format & signature' : 'Documentation — payload & signature'}
      </summary>
      <div className="mt-4 space-y-4 text-sm">
        <div>
          <p className="text-zinc-600 dark:text-zinc-400">
            {fr
              ? 'Chaque requête est un POST JSON avec ces en-têtes :'
              : 'Each delivery is a JSON POST with the following headers:'}
          </p>
          <ul className="list-disc pl-5 mt-2 text-xs font-mono space-y-1">
            <li>X-Lume-Event: &lt;event_name&gt;</li>
            <li>X-Lume-Delivery: &lt;delivery_uuid&gt;</li>
            <li>X-Lume-Signature: t=&lt;unix_ts&gt;,v1=&lt;hmac_sha256_hex&gt;</li>
            <li>Content-Type: application/json</li>
          </ul>
        </div>
        <div>
          <p className="font-medium mb-1">{fr ? 'Format du corps' : 'Body shape'}</p>
          <pre className="text-xs bg-zinc-100 dark:bg-zinc-800 p-3 rounded overflow-x-auto">{`{
  "event": "invoice.paid",
  "created_at": "2026-05-12T22:00:00.000Z",
  "org_id": "uuid",
  "data": { /* event-specific payload */ }
}`}</pre>
        </div>
        <div>
          <p className="font-medium mb-1">{fr ? 'Vérification (Node/Express)' : 'Verification (Node/Express)'}</p>
          <pre className="text-xs bg-zinc-100 dark:bg-zinc-800 p-3 rounded overflow-x-auto">{example}</pre>
        </div>
        <div>
          <p className="font-medium mb-1">{fr ? 'Exemple curl' : 'curl example'}</p>
          <pre className="text-xs bg-zinc-100 dark:bg-zinc-800 p-3 rounded overflow-x-auto">{curlExample}</pre>
        </div>
        <p className="text-xs text-zinc-500">
          {fr
            ? 'Tentatives jusqu’à 5 fois avec backoff exponentiel (2, 4, 8, 16, 32 min) avant abandon.'
            : 'Retried up to 5 times with exponential backoff (2, 4, 8, 16, 32 min) before abandoning.'}
        </p>
      </div>
    </details>
  );
}
