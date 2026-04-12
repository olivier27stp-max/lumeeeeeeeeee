import { supabase } from './supabase';

// ---------------------------------------------------------------------------
// Auth helper
// ---------------------------------------------------------------------------
async function getAuthHeaders(): Promise<Record<string, string> | null> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return null;
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

const BASE = '/api/field-sales';

async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const headers = await getAuthHeaders();
  if (!headers) throw new Error('Not authenticated');
  const res = await fetch(`${BASE}${path}`, { ...options, headers: { ...headers, ...(options.headers ?? {}) } });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

function qs(params: Record<string, string | number | undefined | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== '') p.set(k, String(v));
  }
  const str = p.toString();
  return str ? `?${str}` : '';
}

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface FieldHouse {
  id: string;
  org_id: string;
  address: string;
  address_normalized: string;
  lat: number;
  lng: number;
  current_status: FieldHouseStatus;
  territory_id: string | null;
  assigned_user_id: string | null;
  visit_count: number;
  last_activity_at: string | null;
  metadata: Record<string, unknown>;
  deleted: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
  /** Joined from field_pins — present on list endpoint */
  field_pins?: FieldPin[];
}

export type FieldHouseStatus =
  | 'new'
  | 'knocked'
  | 'no_answer'
  | 'not_interested'
  | 'callback'
  | 'follow_up'
  | 'lead'
  | 'sold'
  | 'cancelled';

export interface FieldHouseEvent {
  id: string;
  org_id: string;
  house_id: string;
  user_id: string;
  event_type: string;
  note_text: string | null;
  note_voice_url: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface FieldPin {
  id: string;
  org_id: string;
  house_id: string;
  lat: number;
  lng: number;
  status: FieldHouseStatus;
  pin_color: string;
  has_note: boolean;
  updated_at?: string;
}

/** Lightweight pin returned by GET /pins (map view) */
export interface FieldPinLight {
  id: string;
  house_id: string;
  lat: number;
  lng: number;
  status: FieldHouseStatus;
  has_note: boolean;
  pin_color: string;
  note_preview?: string | null;
  customer_name?: string | null;
  address?: string | null;
  assigned_user_id?: string | null;
  territory_id?: string | null;
}

export interface FieldHouseDetail extends FieldHouse {
  events: FieldHouseEvent[];
  pin: FieldPin | null;
  score: number;
  next_action: string;
}

export interface FieldTerritory {
  id: string;
  org_id: string;
  name: string;
  /** GeoJSON polygon */
  geojson: Record<string, unknown>;
  color: string;
  assigned_user_ids: string[];
  metadata: Record<string, unknown>;
  deleted: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface FieldDailyStats {
  id: string;
  org_id: string;
  user_id: string;
  date: string; // YYYY-MM-DD
  knocks: number;
  leads: number;
  sales: number;
  callbacks: number;
  no_answers: number;
  not_interested: number;
  notes: number;
  created_at?: string;
  updated_at?: string;
}

export interface FieldSettings {
  org_id: string;
  allow_voice_notes: boolean;
  default_pin_radius: number;
  require_gps_on_knock: boolean;
  daily_goal_knocks: number;
  daily_goal_leads: number;
  custom_statuses: string[];
  pin_colors: Record<string, string>;
  working_hours_start: string; // HH:MM
  working_hours_end: string;   // HH:MM
  timezone: string;
  updated_at?: string;
}

export interface FieldStatsAggregated {
  totals: {
    knocks: number;
    leads: number;
    sales: number;
    callbacks: number;
    no_answers: number;
    not_interested: number;
    notes: number;
  };
  conversion_rate: number;
  status_counts: Record<string, number>;
}

export interface FieldLeaderboardEntry {
  rank: number;
  user_id: string;
  value: number;
  metric: string;
  full_name: string;
  avatar_url: string | null;
}

export interface HouseListResponse {
  data: FieldHouse[];
  total: number | null;
  page: number;
  limit: number;
}

// ---------------------------------------------------------------------------
// Houses
// ---------------------------------------------------------------------------

export interface ListHousesParams {
  status?: FieldHouseStatus;
  territory_id?: string;
  search?: string;
  lat?: number;
  lng?: number;
  radius?: number;
  page?: number;
  limit?: number;
}

export async function listHouses(params: ListHousesParams = {}): Promise<HouseListResponse> {
  return apiFetch<HouseListResponse>(`/houses${qs(params as any)}`);
}

export async function getHouseDetail(id: string): Promise<FieldHouseDetail> {
  return apiFetch<FieldHouseDetail>(`/houses/${id}`);
}

export interface CreateHousePayload {
  address: string;
  lat: number;
  lng: number;
  status?: string;
  note_text?: string;
  territory_id?: string;
  assigned_user_id?: string;
  metadata?: Record<string, unknown>;
  customer_name?: string;
  customer_phone?: string;
  customer_email?: string;
}

export async function createHouse(payload: CreateHousePayload): Promise<FieldHouse & { pin: FieldPin }> {
  return apiFetch(`/houses`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export interface UpdateHousePayload {
  address?: string;
  lat?: number;
  lng?: number;
  current_status?: FieldHouseStatus;
  territory_id?: string;
  assigned_user_id?: string;
  metadata?: Record<string, unknown>;
}

export async function updateHouse(id: string, payload: UpdateHousePayload): Promise<FieldHouse> {
  return apiFetch<FieldHouse>(`/houses/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export async function deleteHouse(id: string): Promise<{ success: boolean }> {
  return apiFetch<{ success: boolean }>(`/houses/${id}`, { method: 'DELETE' });
}

export async function linkHouseToEntity(
  houseId: string,
  payload: { entity_type: string; entity_id: string }
): Promise<{ success: boolean }> {
  return apiFetch(`/houses/${houseId}/link`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export interface CreateEventPayload {
  event_type: string;
  note_text?: string;
  note_voice_url?: string;
  metadata?: Record<string, unknown>;
}

export async function addHouseEvent(
  houseId: string,
  payload: CreateEventPayload
): Promise<FieldHouseEvent> {
  return apiFetch<FieldHouseEvent>(`/houses/${houseId}/events`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function deleteHouseEvent(eventId: string): Promise<{ success: boolean }> {
  return apiFetch<{ success: boolean }>(`/events/${eventId}`, { method: 'DELETE' });
}

// ---------------------------------------------------------------------------
// Territories
// ---------------------------------------------------------------------------

export async function listTerritories(): Promise<FieldTerritory[]> {
  return apiFetch<FieldTerritory[]>('/territories');
}

export interface CreateTerritoryPayload {
  name: string;
  geojson: Record<string, unknown>;
  color?: string;
  assigned_user_ids?: string[];
  metadata?: Record<string, unknown>;
}

export async function createTerritory(payload: CreateTerritoryPayload): Promise<FieldTerritory> {
  return apiFetch<FieldTerritory>('/territories', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export interface UpdateTerritoryPayload {
  name?: string;
  geojson?: Record<string, unknown>;
  color?: string;
  assigned_user_ids?: string[];
  metadata?: Record<string, unknown>;
}

export async function updateTerritory(
  id: string,
  payload: UpdateTerritoryPayload
): Promise<FieldTerritory> {
  return apiFetch<FieldTerritory>(`/territories/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export async function deleteTerritory(id: string): Promise<{ success: boolean }> {
  return apiFetch<{ success: boolean }>(`/territories/${id}`, { method: 'DELETE' });
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

export interface StatsParams {
  user_id?: string;
  territory_id?: string;
  from?: string; // YYYY-MM-DD
  to?: string;
}

export async function getStats(params: StatsParams = {}): Promise<FieldStatsAggregated> {
  return apiFetch<FieldStatsAggregated>(`/stats${qs(params as any)}`);
}

export interface DailyStatsParams {
  user_id?: string;
  from?: string;
  to?: string;
}

export async function getDailyStats(params: DailyStatsParams = {}): Promise<FieldDailyStats[]> {
  return apiFetch<FieldDailyStats[]>(`/stats/daily${qs(params as any)}`);
}

export type LeaderboardMetric = 'knocks' | 'leads' | 'sales' | 'callbacks';

export interface LeaderboardParams {
  metric?: LeaderboardMetric;
  from?: string;
  to?: string;
  limit?: number;
}

export async function getLeaderboard(
  params: LeaderboardParams = {}
): Promise<FieldLeaderboardEntry[]> {
  return apiFetch<FieldLeaderboardEntry[]>(`/stats/leaderboard${qs(params as any)}`);
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export async function getSettings(): Promise<FieldSettings> {
  return apiFetch<FieldSettings>('/settings');
}

export async function updateSettings(payload: Partial<Omit<FieldSettings, 'org_id'>>): Promise<FieldSettings> {
  return apiFetch<FieldSettings>('/settings', {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

// ---------------------------------------------------------------------------
// Pins (map view)
// ---------------------------------------------------------------------------

export interface PinsParams {
  north?: number;
  south?: number;
  east?: number;
  west?: number;
}

export async function getPins(params: PinsParams = {}): Promise<FieldPinLight[]> {
  return apiFetch<FieldPinLight[]>(`/pins${qs(params as any)}`);
}

// ---------------------------------------------------------------------------
// Field Sales Reps
// ---------------------------------------------------------------------------

export interface FieldSalesRep {
  id: string;
  org_id: string;
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  role: 'sales_rep' | 'team_leader' | 'manager';
  is_active: boolean;
  created_at: string;
}

export interface FieldSalesTeam {
  id: string;
  org_id: string;
  name: string;
  leader_id: string | null;
  color: string;
  is_active: boolean;
  members?: Array<{ rep_id: string; field_sales_reps: FieldSalesRep }>;
}

export async function listReps(): Promise<FieldSalesRep[]> {
  return apiFetch<FieldSalesRep[]>('/reps');
}

export async function createRep(payload: { user_id: string; display_name: string; role?: string }): Promise<FieldSalesRep> {
  return apiFetch<FieldSalesRep>('/reps', { method: 'POST', body: JSON.stringify(payload) });
}

export async function updateRep(id: string, payload: Partial<FieldSalesRep>): Promise<FieldSalesRep> {
  return apiFetch<FieldSalesRep>(`/reps/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
}

export async function listFieldTeams(): Promise<FieldSalesTeam[]> {
  return apiFetch<FieldSalesTeam[]>('/teams');
}

export async function createFieldTeam(payload: { name: string; leader_id?: string; color?: string; member_ids?: string[] }): Promise<FieldSalesTeam> {
  return apiFetch<FieldSalesTeam>('/teams', { method: 'POST', body: JSON.stringify(payload) });
}

// ---------------------------------------------------------------------------
// AI Intelligence APIs
// ---------------------------------------------------------------------------

export interface TerritoryRecommendation {
  id: string;
  name: string;
  score: number;
  fatigue_score: number;
  coverage: number;
  total_pins: number;
  active_leads: number;
  close_rate: number;
  explanation: string;
}

export interface PinRecommendation {
  id: string;
  address: string;
  score: number;
  status: string;
  next_action: string;
  territory_id: string | null;
  lat: number;
  lng: number;
}

export interface AITerritoryRecommendations {
  territories: TerritoryRecommendation[];
  pins: PinRecommendation[];
  generated_at: string;
}

export async function getAITerritoryRecommendations(): Promise<AITerritoryRecommendations> {
  return apiFetch<AITerritoryRecommendations>('/ai/territory/recommendations');
}

export interface ScheduleSlot {
  start_time: string;
  end_time: string;
  score: number;
  explanation: string;
  nearby_jobs: number;
  nearby_pins: number;
  is_peak_hour: boolean;
}

export interface AIScheduleRecommendations {
  slots: ScheduleSlot[];
  target_date: string;
  generated_at: string;
}

export async function getAIScheduleRecommendations(params: {
  target_date: string;
  user_id?: string;
  job_duration_minutes?: number;
}): Promise<AIScheduleRecommendations> {
  return apiFetch<AIScheduleRecommendations>('/ai/schedule/recommendations', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export interface FollowUpAction {
  id: string;
  type: 'call_client' | 'reknock' | 'follow_up_quote' | 'follow_up_lead' | 'schedule_job';
  entity_type: string;
  entity_id: string;
  score: number;
  title: string;
  description: string;
  address?: string;
  client_name?: string;
  days_since_activity: number;
  pin_id?: string;
}

export interface AIFollowUps {
  actions: FollowUpAction[];
  generated_at: string;
}

export async function getAIFollowUps(params?: { user_id?: string; limit?: number }): Promise<AIFollowUps> {
  return apiFetch<AIFollowUps>(`/ai/follow-ups${qs(params as any)}`);
}

export interface ZoneTarget {
  territory_id: string;
  territory_name: string;
  territory_score: number;
  fatigue_score: number;
  pin_count: number;
  recommended_time: string;
  reason: string;
}

export interface HouseTarget {
  house_id: string;
  address: string;
  current_status: string;
  reknock_score: number;
  recommended_action: string;
  order: number;
}

export interface DailyPlan {
  date: string;
  user_id: string;
  generated_at: string;
  summary: string;
  target_zones: ZoneTarget[];
  priority_houses: HouseTarget[];
  follow_ups: FollowUpAction[];
  schedule_slots: ScheduleSlot[];
  estimated_knocks: number;
  estimated_leads: number;
}

export async function getAIDailyPlan(params?: { user_id?: string; date?: string }): Promise<DailyPlan> {
  return apiFetch<DailyPlan>(`/ai/daily-plan${qs(params as any)}`);
}

export interface AssignmentRecommendation {
  territory_id: string;
  territory_name: string;
  recommended_user_id: string;
  recommended_user_name: string;
  score: number;
  explanation: string;
  current_user_id: string | null;
  current_user_name: string | null;
}

export async function getAITerritoryAssignments(): Promise<{ recommendations: AssignmentRecommendation[]; generated_at: string }> {
  return apiFetch('/ai/territory-assignments');
}

export async function triggerAIRecalculation(): Promise<{ success: boolean; recalculated_at: string }> {
  return apiFetch('/ai/recalculate', { method: 'POST' });
}

export async function autoPin(payload: {
  address: string;
  lat: number;
  lng: number;
  entity_type: string;
  entity_id: string;
  client_id?: string;
  lead_id?: string;
  quote_id?: string;
  job_id?: string;
}): Promise<{ house_id: string; pin_id: string; is_new: boolean; territory_id: string | null; linked_entities: string[] }> {
  return apiFetch('/auto-pin', { method: 'POST', body: JSON.stringify(payload) });
}

export interface CompanyOperatingProfile {
  org_id: string;
  industry_type: string;
  avg_job_duration_minutes: number;
  avg_jobs_per_day: number;
  max_travel_radius_km: number;
  weight_proximity: number;
  weight_team_availability: number;
  weight_value: number;
  weight_recency: number;
  preferred_reknock_delay_days: number;
  scheduling_pattern_type: string;
  peak_hours_start: string;
  peak_hours_end: string;
  operating_days: number[];
}

export async function getOperatingProfile(): Promise<CompanyOperatingProfile> {
  return apiFetch<CompanyOperatingProfile>('/operating-profile');
}

export async function updateOperatingProfile(payload: Partial<CompanyOperatingProfile>): Promise<CompanyOperatingProfile> {
  return apiFetch<CompanyOperatingProfile>('/operating-profile', {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}
