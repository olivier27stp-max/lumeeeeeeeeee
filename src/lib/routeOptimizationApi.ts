export interface OptimizedStop {
  job_id: string;
  order: number;
  distance_km_from_prev: number;
  eta_minutes_from_prev: number;
  estimated_arrival_time: string;
  title: string | null;
  address: string | null;
  lat: number;
  lng: number;
  duration_minutes: number;
}

export interface OptimizeResponse {
  ok: true;
  algorithm: 'nearest-neighbor';
  provider: 'haversine' | 'osrm' | 'google';
  ordered_jobs: OptimizedStop[];
  total_distance_km: number;
  total_drive_minutes: number;
  return_leg: { distance_km: number; drive_minutes: number } | null;
  skipped: { job_id: string; reason: string }[];
  notes?: string;
}

export interface OptimizeRequest {
  job_ids: string[];
  start_location?: { lat?: number; lng?: number; address?: string };
  end_location?: { lat?: number; lng?: number; address?: string };
  depart_at?: string; // ISO
}

// optimizeRoute / applyOptimizedSchedule retirés (audit Agenda 2026-09-30) : le bouton
// « Optimiser la journée » passe par Lumi (proposition, puis carte de confirmation).
