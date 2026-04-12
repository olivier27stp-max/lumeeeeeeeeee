import { supabase } from './supabase';

const STORAGE_KEY = 'lume-active-org';

/**
 * Get the current org_id.
 * Priority: localStorage (set by CompanyContext on switch) → RPC fallback
 */
export async function getCurrentOrgId(): Promise<string | null> {
  // 1. Check localStorage (set by CompanyContext.switchCompany)
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      // Validate it's a UUID-like string
      if (/^[0-9a-f-]{36}$/i.test(saved)) {
        return saved;
      }
    }
  } catch {}

  // 2. Fallback to RPC (single-org or first membership)
  const { data, error } = await supabase.rpc('current_org_id');
  if (error) throw error;
  return (data as string | null) || null;
}

export async function getCurrentOrgIdOrThrow(): Promise<string> {
  const orgId = await getCurrentOrgId();
  if (!orgId) throw new Error('No organization context found. Please refresh.');
  return orgId;
}
