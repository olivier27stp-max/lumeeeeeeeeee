import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';

interface ModuleFlag {
  enabled: boolean;
  metadata: Record<string, unknown>;
}

interface UseModuleAccessReturn {
  /** Whether the module is enabled for the current org */
  isEnabled: boolean;
  /** True while loading the initial flag state */
  loading: boolean;
  /** Activate the module (upserts org_features row) */
  activate: () => Promise<boolean>;
  /** Whether activation is in progress */
  activating: boolean;
}

/** Event name used to sync all instances of useModuleAccess */
const MODULE_ACTIVATED_EVENT = 'lume:module-activated';

/**
 * Reusable hook to check and toggle module access via org_features table.
 * Works with any module key — e.g. 'module_vente', 'module_dispatch', etc.
 * All instances sharing the same moduleKey stay in sync via a global event.
 */
export function useModuleAccess(moduleKey: string): UseModuleAccessReturn {
  const [flag, setFlag] = useState<ModuleFlag | null>(null);
  const [loading, setLoading] = useState(true);
  const [activating, setActivating] = useState(false);
  const fetchedRef = useRef(false);

  const fetchFlag = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) { setLoading(false); return; }

      const res = await fetch('/api/features', {
        headers: { Authorization: `Bearer ${session.access_token}` },
        signal: AbortSignal.timeout(8000),
      });

      if (res.ok) {
        const json = await res.json();
        const flags = json.flags || {};
        setFlag(flags[moduleKey] || { enabled: false, metadata: {} });
        fetchedRef.current = true;
      }
    } catch {
      setFlag({ enabled: false, metadata: {} });
    } finally {
      setLoading(false);
    }
  }, [moduleKey]);

  useEffect(() => {
    fetchFlag();
  }, [fetchFlag]);

  // Listen for activation events from other hook instances
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.moduleKey === moduleKey) {
        setFlag({ enabled: true, metadata: {} });
      }
    };
    window.addEventListener(MODULE_ACTIVATED_EVENT, handler);
    return () => window.removeEventListener(MODULE_ACTIVATED_EVENT, handler);
  }, [moduleKey]);

  const activate = useCallback(async (): Promise<boolean> => {
    setActivating(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return false;

      const res = await fetch(`/api/features/${moduleKey}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ enabled: true }),
      });

      if (res.ok) {
        setFlag({ enabled: true, metadata: {} });
        // Notify all other hook instances
        window.dispatchEvent(new CustomEvent(MODULE_ACTIVATED_EVENT, { detail: { moduleKey } }));
        return true;
      }
      return false;
    } catch {
      return false;
    } finally {
      setActivating(false);
    }
  }, [moduleKey]);

  return {
    isEnabled: flag?.enabled === true,
    loading,
    activate,
    activating,
  };
}
