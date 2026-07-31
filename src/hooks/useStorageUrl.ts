import { useEffect, useState } from 'react';
import { resolveStorageUrl } from '../lib/storage';

/**
 * Resolves a stored storage URL to a displayable one. URLs from private
 * buckets (attachments, job-photos) are exchanged for signed URLs; external
 * or public-bucket URLs pass through unchanged. Returns null until resolved.
 */
export function useStorageUrl(url: string | null | undefined): string | null {
  const [resolved, setResolved] = useState<string | null>(null);

  useEffect(() => {
    if (!url) { setResolved(null); return; }
    let alive = true;
    resolveStorageUrl(url).then(
      (u) => { if (alive) setResolved(u); },
      () => { if (alive) setResolved(url); },
    );
    return () => { alive = false; };
  }, [url]);

  return resolved;
}
