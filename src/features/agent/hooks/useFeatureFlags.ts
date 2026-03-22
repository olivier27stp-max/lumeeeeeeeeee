import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../../../lib/supabase';

interface FeatureFlag {
  enabled: boolean;
  metadata: Record<string, unknown>;
}

interface UseFeatureFlagsReturn {
  flags: Record<string, FeatureFlag>;
  isEnabled: (feature: string) => boolean;
  loading: boolean;
  error: boolean;
  refetch: () => void;
}

export function useFeatureFlags(): UseFeatureFlagsReturn {
  const [flags, setFlags] = useState<Record<string, FeatureFlag>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const fetchedRef = useRef(false);
  const retryDoneRef = useRef(false);

  const fetchFlags = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        setLoading(false);
        return;
      }

      const res = await fetch('/api/features', {
        headers: { Authorization: `Bearer ${session.access_token}` },
        signal: AbortSignal.timeout(8000),
      });

      if (res.ok) {
        const json = await res.json();
        setFlags(json.flags || {});
        setError(false);
        fetchedRef.current = true;
      } else {
        console.warn('[useFeatureFlags] API returned', res.status);
        setError(true);
      }
    } catch (err: any) {
      console.warn('[useFeatureFlags] Fetch failed:', err?.message);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFlags();

    // Single retry after 5s if first fetch didn't succeed
    const retryTimeout = setTimeout(() => {
      if (!fetchedRef.current && !retryDoneRef.current) {
        retryDoneRef.current = true;
        fetchFlags();
      }
    }, 5000);

    return () => clearTimeout(retryTimeout);
  }, [fetchFlags]);

  const isEnabled = useCallback(
    (feature: string) => flags[feature]?.enabled === true,
    [flags]
  );

  return { flags, isEnabled, loading, error, refetch: fetchFlags };
}
