import { supabase } from './supabase';

export interface TeamSuggestion {
  team_id: string;
  team_name: string;
  team_color: string;
  score: number;
  status: 'available' | 'partially_available' | 'busy' | 'unavailable';
  reasons: string[];
  earliest_available_at: string | null;
  jobs_today: number;
  sector_today: string | null;
  availability_windows: Array<{ start: string; end: string }>;
  proximity_km: number | null;
  skill_match: boolean;
}

export interface SuggestionsResponse {
  suggestions: TeamSuggestion[];
  meta: {
    date: string;
    teams_checked: number;
    has_coordinates: boolean;
    target_city: string | null;
  };
}

export interface SuggestionParams {
  date: string;
  startTime?: string;
  endTime?: string;
  duration?: number;
  address?: string;
  latitude?: number;
  longitude?: number;
  serviceType?: string;
}

export async function getTeamSuggestions(params: SuggestionParams): Promise<SuggestionsResponse> {
  const { data: session } = await supabase.auth.getSession();
  const token = session.session?.access_token;
  if (!token) throw new Error('Not authenticated.');

  const res = await fetch('/api/team-suggestions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(params),
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload?.error || 'Failed to get team suggestions.');
  return payload as SuggestionsResponse;
}
