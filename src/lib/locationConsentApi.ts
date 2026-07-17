import { supabase } from './supabase';

/**
 * Org-wide live-location master switch + per-user tracking consent (Loi 25).
 * The tracking gate requires BOTH: org `enabled` AND user consent === true.
 */

/** Org switch. Returns true when no row exists yet (feature defaults ON). */
export async function getLocationTrackingEnabled(orgId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('location_tracking_settings')
    .select('enabled')
    .eq('org_id', orgId)
    .maybeSingle();
  if (error) throw error;
  return data ? data.enabled : true;
}

/** Admin-only (enforced by RLS). Upserts the org switch. */
export async function setLocationTrackingEnabled(orgId: string, enabled: boolean, userId?: string): Promise<void> {
  const { error } = await supabase
    .from('location_tracking_settings')
    .upsert(
      { org_id: orgId, enabled, created_by: userId ?? null, updated_at: new Date().toISOString() },
      { onConflict: 'org_id' },
    );
  if (error) throw error;
}

/** Tri-state: null = never asked, true = consented, false = declined. */
export async function getMyLocationConsent(userId: string): Promise<boolean | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('location_consent')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return (data?.location_consent ?? null) as boolean | null;
}

/**
 * Fired on window whenever the user's own consent is saved, so open hooks
 * (useLocationTrackingConsent in the app shell) react without a reload.
 */
export const LOCATION_CONSENT_EVENT = 'lume:location-consent';

/** Records the user's decision on their own profile (RLS: self-update). */
export async function setMyLocationConsent(userId: string, consent: boolean): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .update({ location_consent: consent, location_consent_at: new Date().toISOString() })
    .eq('id', userId);
  if (error) throw error;
  window.dispatchEvent(new CustomEvent(LOCATION_CONSENT_EVENT, { detail: { consent } }));
}

// ── Roster des consentements (admin/owner) ──────────────────────

async function apiHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  let activeOrg = '';
  try { activeOrg = localStorage.getItem('lume-active-org') || ''; } catch {}
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session?.access_token || ''}`,
    'x-org-id': activeOrg,
  };
}

export interface ConsentRosterEntry {
  user_id: string;
  role: string;
  full_name: string;
  consent: boolean | null;
  consent_at: string | null;
}

export async function fetchConsentRoster(): Promise<ConsentRosterEntry[]> {
  const res = await fetch('/api/tracking/consents', { headers: await apiHeaders() });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to load consent roster.');
  return (await res.json()).roster || [];
}

/** Remet le membre à « jamais demandé » → le modal réapparaît à sa prochaine connexion. */
export async function reRequestConsent(userId: string): Promise<void> {
  const res = await fetch('/api/tracking/consents/re-request', {
    method: 'POST',
    headers: await apiHeaders(),
    body: JSON.stringify({ userId }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to re-request consent.');
}
