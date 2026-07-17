import { getServiceClient } from './supabase';

/**
 * Verrou serveur du consentement de localisation (Loi 25).
 * Le tracking exige : switch d'org activé (défaut ON sans rangée) ET
 * profiles.location_consent === true. Avant, seul le client se retenait —
 * le serveur acceptait les positions de n'importe quelle session.
 *
 * Cache 60 s : les points GPS arrivent aux quelques secondes, pas question
 * de payer 2 requêtes DB par point. Une révocation prend ≤ 60 s à mordre
 * côté serveur (le client s'arrête immédiatement de toute façon) ;
 * clearConsentCache() force l'éviction (utilisée par « Redemander »).
 */

export interface TrackingDenial {
  error: string;
  code: 'tracking_disabled' | 'consent_required';
}

const cache = new Map<string, { denial: TrackingDenial | null; ts: number }>();
const CACHE_TTL = 60_000;

export function clearConsentCache(userId: string): void {
  for (const key of cache.keys()) {
    if (key.startsWith(`${userId}:`)) cache.delete(key);
  }
}

export async function checkLocationTrackingAllowed(
  admin: ReturnType<typeof getServiceClient>,
  orgId: string,
  userId: string,
): Promise<TrackingDenial | null> {
  const key = `${userId}:${orgId}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < CACHE_TTL) return hit.denial;

  const [{ data: setting }, { data: prof }] = await Promise.all([
    admin.from('location_tracking_settings').select('enabled').eq('org_id', orgId).maybeSingle(),
    admin.from('profiles').select('location_consent').eq('id', userId).maybeSingle(),
  ]);

  let denial: TrackingDenial | null = null;
  if (setting && setting.enabled === false) {
    denial = { error: 'Location tracking is disabled for this organization.', code: 'tracking_disabled' };
  } else if (prof?.location_consent !== true) {
    denial = { error: 'Location sharing consent has not been granted.', code: 'consent_required' };
  }

  cache.set(key, { denial, ts: Date.now() });
  return denial;
}
