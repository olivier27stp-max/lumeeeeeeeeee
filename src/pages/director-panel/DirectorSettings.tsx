import React, { useEffect, useState, useCallback } from 'react';
import { Settings, Key, Coins, Puzzle, RefreshCw, Check, X, AlertTriangle, Loader2, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '../../components/ui';
import { getCreditBalance } from '../../lib/directorApi';
import { supabase } from '../../lib/supabase';
import { useTranslation } from '../../i18n';

const SETTINGS_KEY = 'lia-director-settings';

interface DirectorPrefs {
  defaultModel: string;
  defaultVideoModel: string;
  autoEnhance: boolean;
  qualityPreset: string;
  chatModel: string;
  visionModel: string;
}

const DEFAULT_PREFS: DirectorPrefs = {
  defaultModel: 'flux-2-pro',
  defaultVideoModel: 'wan-2.5',
  autoEnhance: true,
  qualityPreset: 'high',
  chatModel: 'llama3.2',
  visionModel: 'llava',
};

function loadPrefs(): DirectorPrefs {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch { /* corrupt */ }
  return { ...DEFAULT_PREFS };
}

function savePrefs(prefs: DirectorPrefs) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(prefs));
}

export default function DirectorSettings() {
  const { t } = useTranslation();
  const [orgId, setOrgId] = useState<string | null>(null);
  const [credits, setCredits] = useState<number | null>(null);
  const [loadingCredits, setLoadingCredits] = useState(false);
  const [prefs, setPrefs] = useState<DirectorPrefs>(loadPrefs);
  const [falStatus, setFalStatus] = useState<'checking' | 'connected' | 'error'>('checking');
  const [ollamaStatus, setOllamaStatus] = useState<'checking' | 'connected' | 'offline'>('checking');
  const [storageStatus, setStorageStatus] = useState<'checking' | 'connected' | 'error'>('checking');

  useEffect(() => {
    supabase.rpc('current_org_id').then(({ data }) => { if (data) setOrgId(String(data)); });
  }, []);

  useEffect(() => {
    if (!orgId) return;
    setLoadingCredits(true);
    getCreditBalance(orgId)
      .then((b) => setCredits(b?.credits_balance ?? 0))
      .catch(() => setCredits(0))
      .finally(() => setLoadingCredits(false));
  }, [orgId]);

  // Check provider statuses on mount
  useEffect(() => {
    // fal.ai — check by hitting credits endpoint (requires working server + auth)
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch('/api/director-panel/credits', {
          headers: { 'Authorization': `Bearer ${session?.access_token}` },
        });
        setFalStatus(res.ok ? 'connected' : 'error');
      } catch { setFalStatus('error'); }
    })();

    // Ollama — check by pinging local API
    fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(3000) })
      .then((r) => setOllamaStatus(r.ok ? 'connected' : 'offline'))
      .catch(() => setOllamaStatus('offline'));

    // Supabase Storage
    supabase.storage.listBuckets()
      .then(({ error }) => setStorageStatus(error ? 'error' : 'connected'))
      .catch(() => setStorageStatus('error'));
  }, []);

  const updatePref = useCallback(<K extends keyof DirectorPrefs>(key: K, value: DirectorPrefs[K]) => {
    setPrefs((prev) => {
      const next = { ...prev, [key]: value };
      savePrefs(next);
      return next;
    });
  }, []);

  const handleRefreshCredits = async () => {
    if (!orgId) return;
    setLoadingCredits(true);
    try {
      const b = await getCreditBalance(orgId);
      setCredits(b?.credits_balance ?? 0);
      toast.success(t.directorPanel.creditsRefreshed);
    } catch { toast.error(t.directorPanel.creditsRefreshFailed); }
    finally { setLoadingCredits(false); }
  };

  const StatusIcon = ({ status }: { status: string }) => {
    if (status === 'checking') return <Loader2 className="w-3 h-3 animate-spin text-text-tertiary" />;
    if (status === 'connected') return <Check className="w-3 h-3 text-success" />;
    return <X className="w-3 h-3 text-danger" />;
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <PageHeader title={t.directorPanel.settingsTitle} subtitle={t.directorPanel.settingsSubtitle} icon={Settings} />

      {/* Credits */}
      <div className="section-card p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-amber-50 border border-amber-200 flex items-center justify-center shrink-0">
            <Coins className="w-5 h-5 text-amber-600" />
          </div>
          <div className="flex-1">
            <h3 className="text-[13px] font-semibold text-text-primary">{t.directorPanel.creditBalance}</h3>
            <p className="text-[12px] text-text-tertiary">{t.directorPanel.creditsUsedForAi}</p>
          </div>
          <button onClick={handleRefreshCredits} disabled={loadingCredits} className="glass-button !p-2" title="Refresh">
            <RefreshCw className={`w-3.5 h-3.5 ${loadingCredits ? 'animate-spin' : ''}`} />
          </button>
        </div>
        <div className="flex items-baseline gap-2 px-1">
          <span className="text-3xl font-light tabular-nums text-text-primary">
            {credits !== null ? credits.toLocaleString() : '\u2014'}
          </span>
          <span className="text-[12px] text-text-tertiary">{t.directorPanel.creditsRemaining}</span>
        </div>
      </div>

      {/* Default Models */}
      <div className="section-card p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-purple-50 border border-purple-200 flex items-center justify-center shrink-0">
            <Puzzle className="w-5 h-5 text-purple-600" />
          </div>
          <div>
            <h3 className="text-[13px] font-semibold text-text-primary">{t.directorPanel.defaultModels}</h3>
            <p className="text-[12px] text-text-tertiary">{t.directorPanel.defaultModelsDesc}</p>
          </div>
        </div>
        <div className="space-y-3 px-1">
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary">{t.directorPanel.imageModel}</label>
            <select value={prefs.defaultModel} onChange={(e) => updatePref('defaultModel', e.target.value)} className="glass-input w-full mt-1">
              <option value="flux-2-pro">Flux 2 Pro (5 credits)</option>
              <option value="flux-pro-1.1-ultra">Flux Pro 1.1 Ultra (5 credits)</option>
              <option value="flux-fast">Flux Fast (1 credit)</option>
              <option value="recraft-v4">Recraft V4 (3 credits)</option>
              <option value="gpt-image-1-5">GPT Image (4 credits)</option>
              <option value="nano-banana-pro">Nano Banana Pro (3 credits)</option>
            </select>
          </div>
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary">{t.directorPanel.videoModel}</label>
            <select value={prefs.defaultVideoModel} onChange={(e) => updatePref('defaultVideoModel', e.target.value)} className="glass-input w-full mt-1">
              <option value="wan-2.5">Wan 2.5 (15 credits)</option>
              <option value="kling-3">Kling 3 (20 credits)</option>
              <option value="ltx-2-video">LTX 2 Video (12 credits)</option>
              <option value="seedance-v1.5-pro">Seedance Pro (18 credits)</option>
            </select>
          </div>
        </div>
      </div>

      {/* Generation Preferences */}
      <div className="section-card p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-center shrink-0">
            <Key className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <h3 className="text-[13px] font-semibold text-text-primary">{t.directorPanel.generationPreferences}</h3>
            <p className="text-[12px] text-text-tertiary">{t.directorPanel.generationPreferencesDesc}</p>
          </div>
        </div>
        <div className="space-y-3 px-1">
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary">{t.directorPanel.defaultQuality}</label>
            <select value={prefs.qualityPreset} onChange={(e) => updatePref('qualityPreset', e.target.value)} className="glass-input w-full mt-1">
              <option value="draft">Draft (fast, lower quality)</option>
              <option value="standard">Standard</option>
              <option value="high">High (recommended)</option>
              <option value="ultra">Ultra (slowest, best quality)</option>
            </select>
          </div>
          <label className="flex items-center justify-between cursor-pointer py-2">
            <div>
              <p className="text-[13px] font-medium text-text-primary">{t.directorPanel.autoEnhancePrompts}</p>
              <p className="text-[11px] text-text-tertiary">{t.directorPanel.autoEnhanceDesc}</p>
            </div>
            <div
              onClick={() => updatePref('autoEnhance', !prefs.autoEnhance)}
              className={`w-9 h-5 rounded-full transition-colors relative cursor-pointer ${prefs.autoEnhance ? 'bg-primary' : 'bg-surface-tertiary border border-outline'}`}
            >
              <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${prefs.autoEnhance ? 'translate-x-4' : 'translate-x-0.5'}`} />
            </div>
          </label>
        </div>
      </div>

      {/* LIA AI Model */}
      <div className="section-card p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-green-50 border border-green-200 flex items-center justify-center shrink-0">
            <Settings className="w-5 h-5 text-green-600" />
          </div>
          <div>
            <h3 className="text-[13px] font-semibold text-text-primary">{t.directorPanel.liaAiModel}</h3>
            <p className="text-[12px] text-text-tertiary">{t.directorPanel.liaAiModelDesc}</p>
          </div>
        </div>
        <div className="space-y-3 px-1">
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary">{t.directorPanel.chatModel}</label>
            <select value={prefs.chatModel} onChange={(e) => updatePref('chatModel', e.target.value)} className="glass-input w-full mt-1">
              <option value="llama3.2">Llama 3.2 (3B — fast)</option>
              <option value="llama3.3">Llama 3.3 (70B — smart)</option>
              <option value="mixtral">Mixtral 8x7B</option>
              <option value="qwen2.5">Qwen 2.5 (7B)</option>
              <option value="deepseek-r1">DeepSeek R1</option>
            </select>
            <p className="text-[10px] text-text-tertiary mt-1">Run <code className="bg-surface-tertiary px-1 rounded">ollama pull {prefs.chatModel}</code> first</p>
          </div>
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary">{t.directorPanel.visionModel}</label>
            <select value={prefs.visionModel} onChange={(e) => updatePref('visionModel', e.target.value)} className="glass-input w-full mt-1">
              <option value="llava">LLaVA (7B)</option>
              <option value="llava:13b">LLaVA 13B</option>
              <option value="bakllava">BakLLaVA</option>
            </select>
          </div>
        </div>
        {ollamaStatus === 'offline' && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-[11px] text-amber-700">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            {t.directorPanel.ollamaOfflineWarning} <code className="bg-amber-100 px-1 rounded">ollama serve</code> {t.directorPanel.ollamaOfflineWarningEnd}
          </div>
        )}
      </div>

      {/* Provider Status */}
      <div className="section-card p-5 space-y-3">
        <h3 className="text-[13px] font-semibold text-text-primary">{t.directorPanel.providerStatus}</h3>
        {[
          { name: 'fal.ai (Generation API)', status: falStatus },
          { name: 'Supabase Storage', status: storageStatus },
          { name: 'Ollama (Local AI Chat)', status: ollamaStatus === 'connected' ? 'connected' : ollamaStatus === 'offline' ? 'offline' : 'checking' },
        ].map((p) => (
          <div key={p.name} className="flex items-center justify-between py-1.5">
            <span className="text-[12px] text-text-secondary">{p.name}</span>
            <span className={`flex items-center gap-1.5 text-[11px] font-medium ${
              p.status === 'connected' ? 'text-success' : p.status === 'checking' ? 'text-text-tertiary' : 'text-danger'
            }`}>
              <StatusIcon status={p.status} />
              {p.status}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
