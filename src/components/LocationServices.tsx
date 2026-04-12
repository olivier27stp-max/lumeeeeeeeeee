import React, { useState, useEffect, useCallback } from 'react';
import {
  MapPin, Radio, Wifi, WifiOff, RefreshCw, Loader2, Check, AlertCircle,
  Trash2, Plus, Link2, Unlink, ChevronRight, Shield, Circle,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { useTranslation } from '../i18n';
import {
  type GpsProviderConfig, type GpsProvider, type DeviceMapping, type ExternalDevice, type TraccarConfig, type Life360Config,
  getGpsProviders, saveGpsProvider, disconnectGpsProvider, updateSyncStatus,
  traccarFetchDevices, traccarTestConnection,
  life360FetchCircles, life360TestConnection,
  getDeviceMappings, saveDeviceMapping, removeDeviceMapping,
  syncProviderLocations,
} from '../lib/locationApi';

// ─── Provider card ──────────────────────────────────────────────
const PROVIDERS: { id: GpsProvider; name: string; color: string; icon: typeof Radio; setupOnly?: boolean }[] = [
  { id: 'traccar', name: 'Traccar', color: '#3daf57', icon: Radio },
  { id: 'life360', name: 'Life360', color: '#333333', icon: Wifi, setupOnly: true },
];

export default function LocationServices() {
  const { t } = useTranslation();
  const [providers, setProviders] = useState<GpsProviderConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [connectingId, setConnectingId] = useState<GpsProvider | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);

  // Connect form state
  const [formProvider, setFormProvider] = useState<GpsProvider | null>(null);
  const [formFields, setFormFields] = useState<Record<string, string>>({});

  // Device mapping state
  const [mappingProvider, setMappingProvider] = useState<GpsProviderConfig | null>(null);
  const [mappings, setMappings] = useState<DeviceMapping[]>([]);
  const [devices, setDevices] = useState<ExternalDevice[]>([]);
  const [loadingDevices, setLoadingDevices] = useState(false);

  const loadProviders = useCallback(async () => {
    try {
      const data = await getGpsProviders();
      setProviders(data);
    } catch (e) {
      console.error('Failed to load GPS providers', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadProviders(); }, [loadProviders]);

  const isConnected = (providerId: GpsProvider) =>
    providers.some((p) => p.provider === providerId && p.active);

  const getProviderConfig = (providerId: GpsProvider) =>
    providers.find((p) => p.provider === providerId);

  // ── Connect ──
  const handleConnect = async () => {
    if (!formProvider) return;
    setConnectingId(formProvider);
    setTestResult(null);

    try {
      // Test connection first
      let ok = false;
      if (formProvider === 'traccar') {
        ok = await traccarTestConnection({
          server_url: formFields.server_url || '',
          username: formFields.username,
          password: formFields.password,
        });
      } else {
        ok = await life360TestConnection({ access_token: formFields.access_token || '' });
      }

      if (!ok) {
        setTestResult({ ok: false, msg: 'Connection test failed. Check your credentials.' });
        return;
      }

      // Save provider
      await saveGpsProvider(formProvider, formFields as unknown as TraccarConfig | Life360Config);
      setTestResult({ ok: true, msg: 'Connected successfully!' });
      setFormProvider(null);
      setFormFields({});
      await loadProviders();
    } catch (e: any) {
      setTestResult({ ok: false, msg: e.message || 'Connection failed' });
    } finally {
      setConnectingId(null);
    }
  };

  // ── Disconnect ──
  const handleDisconnect = async (provider: GpsProviderConfig) => {
    try {
      await disconnectGpsProvider(provider.id);
      await loadProviders();
    } catch (e) {
      console.error('Failed to disconnect', e);
    }
  };

  // ── Sync ──
  const handleSync = async (provider: GpsProviderConfig) => {
    setSyncingId(provider.id);
    try {
      await updateSyncStatus(provider.id, 'syncing');
      await syncProviderLocations(provider);
      await updateSyncStatus(provider.id, 'ok');
      await loadProviders();
    } catch (e: any) {
      await updateSyncStatus(provider.id, 'error', e.message);
    } finally {
      setSyncingId(null);
    }
  };

  // ── Device Mappings ──
  const openMappings = async (provider: GpsProviderConfig) => {
    setMappingProvider(provider);
    setLoadingDevices(true);
    try {
      const [maps, devs] = await Promise.all([
        getDeviceMappings(provider.id),
        provider.provider === 'traccar'
          ? traccarFetchDevices(provider.config as any)
          : life360FetchCircles(provider.config as any).then((circles) =>
              circles.flatMap((c: any) =>
                (c.members || []).map((m: any) => ({
                  id: m.id,
                  name: `${m.firstName} ${m.lastName}`,
                  latitude: m.location?.latitude,
                  longitude: m.location?.longitude,
                  battery: m.location?.battery,
                }))
              )
            ),
      ]);
      setMappings(maps);
      setDevices(devs);
    } catch (e) {
      console.error('Failed to load devices', e);
    } finally {
      setLoadingDevices(false);
    }
  };

  const handleMapDevice = async (externalId: string, externalName: string, userId: string) => {
    if (!mappingProvider) return;
    try {
      await saveDeviceMapping(mappingProvider.id, userId, externalId, externalName);
      const updated = await getDeviceMappings(mappingProvider.id);
      setMappings(updated);
    } catch (e) {
      console.error('Failed to map device', e);
    }
  };

  const handleUnmapDevice = async (mappingId: string) => {
    try {
      await removeDeviceMapping(mappingId);
      if (mappingProvider) {
        const updated = await getDeviceMappings(mappingProvider.id);
        setMappings(updated);
      }
    } catch (e) {
      console.error('Failed to unmap device', e);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={20} className="animate-spin text-text-tertiary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-[15px] font-semibold text-text-primary flex items-center gap-2">
          <MapPin size={16} />
          Location Services
        </h2>
        <p className="text-[13px] text-text-tertiary mt-1">
          Connect a GPS provider to track your field team, set up geofences, and verify proof of presence.
        </p>
      </div>

      {/* Provider cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {PROVIDERS.map((prov) => {
          const connected = isConnected(prov.id);
          const config = getProviderConfig(prov.id);
          const isSyncing = config && syncingId === config.id;
          const Icon = prov.icon;

          return (
            <div
              key={prov.id}
              className={cn(
                'section-card p-5 rounded-2xl border transition-all',
                connected
                  ? 'border-success/30 bg-success/5'
                  : 'border-outline hover:border-outline-subtle'
              )}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold text-sm"
                    style={{ backgroundColor: prov.color }}
                  >
                    {prov.name.slice(0, 2)}
                  </div>
                  <div>
                    <h3 className="text-[14px] font-semibold text-text-primary">{prov.name}</h3>
                    <p className="text-[11px] text-text-tertiary mt-0.5">
                      {connected ? 'Connected' : 'Not connected'}
                    </p>
                  </div>
                </div>

                {connected ? (
                  <div className="flex items-center gap-1">
                    <Circle size={8} className="text-success fill-success" />
                    <span className="text-[11px] font-medium text-success">Active</span>
                  </div>
                ) : null}
              </div>

              {/* Connected state - actions */}
              {connected && config && (
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    onClick={() => handleSync(config)}
                    disabled={!!isSyncing}
                    className="btn-secondary text-[12px] px-3 py-1.5 rounded-lg flex items-center gap-1.5"
                  >
                    {isSyncing ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <RefreshCw size={12} />
                    )}
                    {isSyncing ? 'Syncing...' : 'Sync Now'}
                  </button>
                  <button
                    onClick={() => openMappings(config)}
                    className="btn-secondary text-[12px] px-3 py-1.5 rounded-lg flex items-center gap-1.5"
                  >
                    <Link2 size={12} />
                    Device Mappings
                  </button>
                  <button
                    onClick={() => handleDisconnect(config)}
                    className="text-[12px] px-3 py-1.5 rounded-lg text-danger hover:bg-danger/10 flex items-center gap-1.5 transition-colors"
                  >
                    <WifiOff size={12} />
                    Disconnect
                  </button>

                  {config.sync_status === 'error' && config.error_msg && (
                    <div className="w-full mt-2 flex items-start gap-2 text-[11px] text-danger bg-danger/10 rounded-lg px-3 py-2">
                      <AlertCircle size={12} className="mt-0.5 shrink-0" />
                      {config.error_msg}
                    </div>
                  )}

                  {config.last_sync && (
                    <p className="w-full text-[11px] text-text-tertiary mt-1">
                      Last synced: {new Date(config.last_sync).toLocaleString()}
                    </p>
                  )}
                </div>
              )}

              {/* Not connected */}
              {!connected && prov.setupOnly && (
                <div className="mt-4 space-y-2">
                  <a
                    href="https://www.life360.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-primary text-[12px] px-4 py-2 rounded-lg flex items-center gap-1.5 w-fit"
                  >
                    <Plus size={12} />
                    Open {prov.name} Website
                  </a>
                  <p className="text-[10px] text-text-tertiary leading-relaxed">
                    Install the mobile app, create a team circle, and invite technicians to share location.
                  </p>
                </div>
              )}
              {!connected && !prov.setupOnly && (
                <button
                  onClick={() => {
                    setFormProvider(prov.id);
                    setFormFields({});
                    setTestResult(null);
                  }}
                  className="mt-4 btn-primary text-[12px] px-4 py-2 rounded-lg flex items-center gap-1.5"
                >
                  <Plus size={12} />
                  Connect {prov.name}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Connect form modal */}
      <AnimatePresence>
        {formProvider && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
            onClick={() => { setFormProvider(null); setTestResult(null); }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-surface rounded-2xl shadow-xl border border-outline p-6 w-full max-w-md"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-[15px] font-semibold text-text-primary mb-4">
                Connect {formProvider === 'traccar' ? 'Traccar' : 'Life360'}
              </h3>

              {formProvider === 'traccar' ? (
                <div className="space-y-3">
                  <div>
                    <label className="text-[12px] font-medium text-text-secondary mb-1 block">Server URL</label>
                    <input
                      type="url"
                      placeholder="https://your-traccar-server.com"
                      value={formFields.server_url || ''}
                      onChange={(e) => setFormFields({ ...formFields, server_url: e.target.value })}
                      className="input-primary w-full text-[13px] rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="text-[12px] font-medium text-text-secondary mb-1 block">Username</label>
                    <input
                      type="text"
                      placeholder="admin@example.com"
                      value={formFields.username || ''}
                      onChange={(e) => setFormFields({ ...formFields, username: e.target.value })}
                      className="input-primary w-full text-[13px] rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="text-[12px] font-medium text-text-secondary mb-1 block">Password</label>
                    <input
                      type="password"
                      placeholder="••••••••"
                      value={formFields.password || ''}
                      onChange={(e) => setFormFields({ ...formFields, password: e.target.value })}
                      className="input-primary w-full text-[13px] rounded-lg"
                    />
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div>
                    <label className="text-[12px] font-medium text-text-secondary mb-1 block">Access Token</label>
                    <input
                      type="password"
                      placeholder="Bearer token from Life360"
                      value={formFields.access_token || ''}
                      onChange={(e) => setFormFields({ ...formFields, access_token: e.target.value })}
                      className="input-primary w-full text-[13px] rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="text-[12px] font-medium text-text-secondary mb-1 block">Circle ID <span className="text-text-tertiary">(optional)</span></label>
                    <input
                      type="text"
                      placeholder="Auto-detect if blank"
                      value={formFields.circle_id || ''}
                      onChange={(e) => setFormFields({ ...formFields, circle_id: e.target.value })}
                      className="input-primary w-full text-[13px] rounded-lg"
                    />
                  </div>
                </div>
              )}

              {/* Test result */}
              {testResult && (
                <div
                  className={cn(
                    'mt-3 flex items-center gap-2 text-[12px] rounded-lg px-3 py-2',
                    testResult.ok ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'
                  )}
                >
                  {testResult.ok ? <Check size={14} /> : <AlertCircle size={14} />}
                  {testResult.msg}
                </div>
              )}

              <div className="flex justify-end gap-2 mt-5">
                <button
                  onClick={() => { setFormProvider(null); setTestResult(null); }}
                  className="btn-secondary text-[13px] px-4 py-2 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConnect}
                  disabled={connectingId !== null}
                  className="btn-primary text-[13px] px-4 py-2 rounded-lg flex items-center gap-1.5"
                >
                  {connectingId ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Shield size={14} />
                  )}
                  {connectingId ? 'Testing...' : 'Test & Connect'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Device mapping modal */}
      <AnimatePresence>
        {mappingProvider && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
            onClick={() => setMappingProvider(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-surface rounded-2xl shadow-xl border border-outline p-6 w-full max-w-lg max-h-[70vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-[15px] font-semibold text-text-primary mb-1">
                Device Mappings — {mappingProvider.provider === 'traccar' ? 'Traccar' : 'Life360'}
              </h3>
              <p className="text-[12px] text-text-tertiary mb-4">
                Link external devices to your team members so their positions appear on the dispatch map.
              </p>

              {loadingDevices ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 size={18} className="animate-spin text-text-tertiary" />
                </div>
              ) : (
                <div className="space-y-2">
                  {devices.length === 0 && (
                    <p className="text-[13px] text-text-tertiary text-center py-6">
                      No devices found from the provider.
                    </p>
                  )}
                  {devices.map((dev) => {
                    const existing = mappings.find((m) => m.external_id === dev.id);
                    return (
                      <div
                        key={dev.id}
                        className="flex items-center justify-between rounded-xl border border-outline px-4 py-3"
                      >
                        <div>
                          <p className="text-[13px] font-medium text-text-primary">{dev.name}</p>
                          <p className="text-[11px] text-text-tertiary">ID: {dev.id}</p>
                        </div>
                        {existing ? (
                          <button
                            onClick={() => handleUnmapDevice(existing.id)}
                            className="text-[11px] text-danger hover:bg-danger/10 px-2 py-1 rounded-lg flex items-center gap-1 transition-colors"
                          >
                            <Unlink size={11} />
                            Unlink
                          </button>
                        ) : (
                          <button
                            onClick={() => handleMapDevice(dev.id, dev.name, '')}
                            className="text-[11px] text-primary hover:bg-primary/10 px-2 py-1 rounded-lg flex items-center gap-1 transition-colors"
                          >
                            <Link2 size={11} />
                            Link
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="flex justify-end mt-4">
                <button
                  onClick={() => setMappingProvider(null)}
                  className="btn-secondary text-[13px] px-4 py-2 rounded-lg"
                >
                  Done
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Geofencing info card */}
      <div className="section-card p-5 rounded-2xl border border-outline">
        <div className="flex items-center gap-2 mb-2">
          <Shield size={15} className="text-primary" />
          <h3 className="text-[14px] font-semibold text-text-primary">Proof of Presence</h3>
        </div>
        <p className="text-[13px] text-text-tertiary leading-relaxed">
          When a technician enters within <strong className="text-text-primary">100m</strong> of a job site,
          Lume CRM automatically records proof of presence using GPS data from your connected provider.
          Geofences are created automatically for each job with a valid address.
        </p>
        <div className="mt-3 flex items-center gap-4">
          <div className="flex items-center gap-1.5 text-[12px] text-text-secondary">
            <div className="w-2 h-2 rounded-full bg-success" />
            Enter event
          </div>
          <div className="flex items-center gap-1.5 text-[12px] text-text-secondary">
            <div className="w-2 h-2 rounded-full bg-danger" />
            Exit event
          </div>
          <div className="flex items-center gap-1.5 text-[12px] text-text-secondary">
            <div className="w-2 h-2 rounded-full bg-warning" />
            100m radius
          </div>
        </div>
      </div>

      {/* Quick link to dispatch map */}
      <div className="section-card p-4 rounded-2xl border border-outline hover:border-primary/30 transition-colors cursor-pointer group">
        <a href="/dispatch" className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
              <MapPin size={16} className="text-primary" />
            </div>
            <div>
              <h3 className="text-[13px] font-semibold text-text-primary group-hover:text-primary transition-colors">
                Open Dispatch Map
              </h3>
              <p className="text-[11px] text-text-tertiary">
                View all technician positions in real-time
              </p>
            </div>
          </div>
          <ChevronRight size={16} className="text-text-tertiary group-hover:text-primary transition-colors" />
        </a>
      </div>
    </div>
  );
}
