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

/** Records the user's decision on their own profile (RLS: self-update). */
export async function setMyLocationConsent(userId: string, consent: boolean): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .update({ location_consent: consent, location_consent_at: new Date().toISOString() })
    .eq('id', userId);
  if (error) throw error;
}
