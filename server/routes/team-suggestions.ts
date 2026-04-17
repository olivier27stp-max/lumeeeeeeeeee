import { Router } from 'express';
import { requireAuthedClient, getServiceClient } from '../lib/supabase';
import { sendSafeError } from '../lib/error-handler';

const router = Router();

// ── Haversine distance in km ──
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Extract city from address string ──
function extractCity(address: string | null): string | null {
  if (!address) return null;
  const parts = address.split(',').map(p => p.trim());
  // Typical format: "123 Rue X, City, Province, PostalCode" or "City, Province"
  if (parts.length >= 2) return parts[parts.length >= 3 ? 1 : 0].toLowerCase();
  return parts[0].toLowerCase();
}

interface SuggestionRequest {
  date: string;          // YYYY-MM-DD
  startTime?: string;    // HH:MM
  endTime?: string;      // HH:MM
  duration?: number;     // minutes
  address?: string;
  latitude?: number;
  longitude?: number;
  serviceType?: string;
  jobId?: string;
}

interface TeamSuggestion {
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

// ══════════════════════════════════════════════════════════════
// POST /api/team-suggestions — Get suggested teams for a job
// ══════════════════════════════════════════════════════════════
router.post('/team-suggestions', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const { client, orgId } = auth;
    const body = req.body as SuggestionRequest;
    const { date, startTime, endTime, duration, address, latitude, longitude, serviceType } = body;

    if (!date) return res.status(400).json({ error: 'date is required.' });

    const targetDate = new Date(date + 'T00:00:00');
    const weekday = targetDate.getDay(); // 0=Sun, 6=Sat

    // ── 1. Fetch active teams (org-scoped) ──
    const { data: teams } = await client
      .from('teams')
      .select('id, name, color_hex, description, is_active')
      .eq('org_id', orgId)
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('name');

    if (!teams || teams.length === 0) {
      return res.json({ suggestions: [], meta: { date, teams_checked: 0 } });
    }

    const teamIds = teams.map(t => t.id);

    // ── 2. Fetch weekly availability for this weekday ──
    const { data: weeklyAvail } = await client
      .from('team_availability')
      .select('team_id, start_minute, end_minute')
      .in('team_id', teamIds)
      .eq('weekday', weekday)
      .is('deleted_at', null);

    // ── 3. Fetch date-specific overrides for this date ──
    const { data: dateSlots } = await client
      .from('team_date_slots')
      .select('team_id, start_time, end_time, status, notes')
      .in('team_id', teamIds)
      .eq('slot_date', date);

    // ── 4. Fetch scheduled events for this date (org-scoped) ──
    const dayStart = `${date}T00:00:00`;
    const dayEnd = `${date}T23:59:59`;
    const { data: events } = await client
      .from('schedule_events')
      .select('id, team_id, start_at, end_at, job_id, notes, job:jobs!inner(id, title, property_address, latitude, longitude, client_name, status)')
      .eq('org_id', orgId)
      .in('team_id', teamIds)
      .gte('start_at', dayStart)
      .lte('start_at', dayEnd)
      .is('deleted_at', null)
      .order('start_at');

    // ── 5. Fetch team capabilities if table exists ──
    let capabilities: any[] = [];
    try {
      const { data: caps } = await client
        .from('team_capabilities')
        .select('team_id, service_type, skill_tags')
        .in('team_id', teamIds);
      capabilities = caps || [];
    } catch {
      // Table doesn't exist yet - skip
    }

    // ── 6. Build suggestions ──
    const targetCity = extractCity(address || null);
    const suggestions: TeamSuggestion[] = [];

    for (const team of teams) {
      const teamEvents = (events || []).filter(e => e.team_id === team.id);
      const teamWeekly = (weeklyAvail || []).filter(a => a.team_id === team.id);
      const teamDateOverrides = (dateSlots || []).filter(s => s.team_id === team.id);
      const teamCaps = capabilities.filter(c => c.team_id === team.id);

      // ── Determine availability windows ──
      let availWindows: Array<{ startMin: number; endMin: number }> = [];

      // Check for blocked date override
      const isBlocked = teamDateOverrides.some(s => s.status === 'blocked');
      if (isBlocked) {
        // Team is blocked this entire day
        suggestions.push({
          team_id: team.id,
          team_name: team.name,
          team_color: team.color_hex,
          score: 0,
          status: 'unavailable',
          reasons: ['Day off / blocked'],
          earliest_available_at: null,
          jobs_today: teamEvents.length,
          sector_today: null,
          availability_windows: [],
          proximity_km: null,
          skill_match: true,
        });
        continue;
      }

      // PRIMARY: date-specific slots (team_date_slots) — this is what the Availability tab writes
      const availableDateSlots = teamDateOverrides.filter(s => s.status === 'available');
      if (availableDateSlots.length > 0) {
        for (const slot of availableDateSlots) {
          const [sh, sm] = slot.start_time.split(':').map(Number);
          const [eh, em] = slot.end_time.split(':').map(Number);
          availWindows.push({ startMin: sh * 60 + (sm || 0), endMin: eh * 60 + (em || 0) });
        }
      } else if (teamWeekly.length > 0) {
        // FALLBACK: weekly recurring availability (team_availability) if configured
        for (const rule of teamWeekly) {
          availWindows.push({ startMin: rule.start_minute, endMin: rule.end_minute });
        }
      } else {
        // NO availability at all for this day → team is unavailable
        suggestions.push({
          team_id: team.id,
          team_name: team.name,
          team_color: team.color_hex,
          score: 0,
          status: 'unavailable',
          reasons: ['No availability set for this day'],
          earliest_available_at: null,
          jobs_today: teamEvents.length,
          sector_today: null,
          availability_windows: [],
          proximity_km: null,
          skill_match: true,
        });
        continue;
      }

      if (availWindows.length === 0) {
        suggestions.push({
          team_id: team.id,
          team_name: team.name,
          team_color: team.color_hex,
          score: 0,
          status: 'unavailable',
          reasons: ['No availability configured for this day'],
          earliest_available_at: null,
          jobs_today: 0,
          sector_today: null,
          availability_windows: [],
          proximity_km: null,
          skill_match: true,
        });
        continue;
      }

      // ── Calculate free windows (availability minus booked events) ──
      const bookedRanges = teamEvents.map(e => {
        const s = new Date(e.start_at);
        const en = new Date(e.end_at);
        return { startMin: s.getHours() * 60 + s.getMinutes(), endMin: en.getHours() * 60 + en.getMinutes() };
      });

      const freeWindows: Array<{ startMin: number; endMin: number }> = [];
      for (const window of availWindows) {
        let cursor = window.startMin;
        const sorted = bookedRanges
          .filter(b => b.endMin > window.startMin && b.startMin < window.endMin)
          .sort((a, b) => a.startMin - b.startMin);

        for (const booked of sorted) {
          if (cursor < booked.startMin) {
            freeWindows.push({ startMin: cursor, endMin: booked.startMin });
          }
          cursor = Math.max(cursor, booked.endMin);
        }
        if (cursor < window.endMin) {
          freeWindows.push({ startMin: cursor, endMin: window.endMin });
        }
      }

      // Convert free windows to time strings
      const freeWindowsFormatted = freeWindows.map(w => ({
        start: `${String(Math.floor(w.startMin / 60)).padStart(2, '0')}:${String(w.startMin % 60).padStart(2, '0')}`,
        end: `${String(Math.floor(w.endMin / 60)).padStart(2, '0')}:${String(w.endMin % 60).padStart(2, '0')}`,
      }));

      // ── SCORING ──
      let score = 0;
      const reasons: string[] = [];

      // --- Availability score (40%) ---
      const targetStartMin = startTime ? parseInt(startTime.split(':')[0]) * 60 + parseInt(startTime.split(':')[1]) : null;
      const targetEndMin = endTime ? parseInt(endTime.split(':')[0]) * 60 + parseInt(endTime.split(':')[1]) : null;
      const jobDuration = duration || (targetStartMin && targetEndMin ? targetEndMin - targetStartMin : 60);

      let availScore = 0;
      let exactSlotFit = false;
      let earliestFreeMin: number | null = null;

      if (targetStartMin !== null) {
        // Check if target time fits in a free window
        for (const fw of freeWindows) {
          if (targetStartMin >= fw.startMin && (targetStartMin + jobDuration) <= fw.endMin) {
            exactSlotFit = true;
            availScore = 40;
            reasons.push(`Available at ${startTime}`);
            break;
          }
        }
        if (!exactSlotFit) {
          // Find closest free window
          for (const fw of freeWindows) {
            if ((fw.endMin - fw.startMin) >= jobDuration) {
              if (earliestFreeMin === null) earliestFreeMin = fw.startMin;
              availScore = 20;
              break;
            }
          }
          if (availScore > 0) {
            const freeTime = `${String(Math.floor(earliestFreeMin! / 60)).padStart(2, '0')}:${String(earliestFreeMin! % 60).padStart(2, '0')}`;
            reasons.push(`Available at ${freeTime} (requested ${startTime})`);
          }
        }
      } else {
        // No specific time requested - check general availability
        const totalFreeMinutes = freeWindows.reduce((sum, w) => sum + (w.endMin - w.startMin), 0);
        if (totalFreeMinutes >= jobDuration) {
          availScore = 35;
          earliestFreeMin = freeWindows[0]?.startMin ?? null;
          if (totalFreeMinutes > 300) {
            reasons.push('Available most of the day');
          } else {
            reasons.push(`${Math.round(totalFreeMinutes / 60)}h available`);
          }
        } else if (totalFreeMinutes > 0) {
          availScore = 10;
          reasons.push('Limited availability');
        }
      }

      if (freeWindows.length === 0) {
        availScore = 0;
        reasons.push('Fully booked');
      }

      score += availScore;

      // --- Proximity score (35%) ---
      let proximityScore = 0;
      let proximityKm: number | null = null;

      // Get job locations from team's events today
      const eventLocations = teamEvents
        .map(e => {
          const job = (e as any).job;
          return {
            lat: job?.latitude,
            lng: job?.longitude,
            address: job?.property_address,
          };
        })
        .filter(l => l.lat || l.address);

      if (latitude && longitude) {
        // Exact coordinate comparison
        let minDist = Infinity;
        for (const loc of eventLocations) {
          if (loc.lat && loc.lng) {
            const d = haversineKm(latitude, longitude, loc.lat, loc.lng);
            if (d < minDist) minDist = d;
          }
        }

        if (minDist < Infinity) {
          proximityKm = Math.round(minDist * 10) / 10;
          if (minDist < 5) { proximityScore = 35; reasons.push(`${proximityKm}km away — very close`); }
          else if (minDist < 15) { proximityScore = 28; reasons.push(`${proximityKm}km away — nearby`); }
          else if (minDist < 30) { proximityScore = 18; reasons.push(`${proximityKm}km away`); }
          else if (minDist < 60) { proximityScore = 10; reasons.push(`${proximityKm}km away`); }
          else { proximityScore = 3; reasons.push(`${proximityKm}km away — far`); }
        } else if (eventLocations.length === 0) {
          // No other jobs - neutral
          proximityScore = 15;
          reasons.push('No other jobs planned — flexible');
        }
      } else if (targetCity) {
        // City-level matching
        let cityMatch = false;
        for (const loc of eventLocations) {
          const eventCity = extractCity(loc.address);
          if (eventCity && targetCity === eventCity) {
            cityMatch = true;
            break;
          }
        }
        if (cityMatch) {
          proximityScore = 30;
          reasons.push(`Already in ${targetCity}`);
        } else if (eventLocations.length === 0) {
          proximityScore = 15;
          reasons.push('No other jobs planned — flexible');
        } else {
          proximityScore = 5;
          const eventCities = [...new Set(eventLocations.map(l => extractCity(l.address)).filter(Boolean))];
          if (eventCities.length > 0) {
            reasons.push(`Working in ${eventCities[0]} today`);
          }
        }
      } else {
        proximityScore = 15; // No address info - neutral
      }

      score += proximityScore;

      // --- Route coherence score (15%) ---
      let routeScore = 0;
      const totalJobs = teamEvents.length;
      if (totalJobs === 0) {
        routeScore = 15;
      } else if (totalJobs <= 2) {
        routeScore = 12;
      } else if (totalJobs <= 4) {
        routeScore = 8;
      } else {
        routeScore = 3;
        reasons.push(`Heavy day (${totalJobs} jobs)`);
      }
      score += routeScore;

      // --- Skill match score (10%) ---
      let skillMatch = true;
      if (serviceType && teamCaps.length > 0) {
        const hasSkill = teamCaps.some(c =>
          c.service_type === serviceType ||
          (c.skill_tags && Array.isArray(c.skill_tags) && c.skill_tags.includes(serviceType))
        );
        if (hasSkill) {
          score += 10;
          reasons.push('Skill match');
        } else {
          skillMatch = false;
          score -= 5;
          reasons.push('Service type mismatch');
        }
      } else {
        score += 7; // No skills configured - neutral
      }

      // ── Determine status ──
      let status: TeamSuggestion['status'];
      if (freeWindows.length === 0) {
        status = 'busy';
      } else if (exactSlotFit) {
        status = 'available';
      } else if (freeWindows.some(w => (w.endMin - w.startMin) >= jobDuration)) {
        status = 'partially_available';
      } else {
        status = 'busy';
      }

      // ── Sector today ──
      const cities = [...new Set(eventLocations.map(l => extractCity(l.address)).filter(Boolean))];
      const sectorToday = cities.length > 0 ? cities.join(', ') : null;

      // ── Earliest available ──
      let earliestAvail: string | null = null;
      if (earliestFreeMin !== null) {
        earliestAvail = `${String(Math.floor(earliestFreeMin / 60)).padStart(2, '0')}:${String(earliestFreeMin % 60).padStart(2, '0')}`;
      } else if (freeWindows.length > 0) {
        const first = freeWindows[0];
        earliestAvail = `${String(Math.floor(first.startMin / 60)).padStart(2, '0')}:${String(first.startMin % 60).padStart(2, '0')}`;
      }

      suggestions.push({
        team_id: team.id,
        team_name: team.name,
        team_color: team.color_hex,
        score: Math.max(0, Math.min(100, score)),
        status,
        reasons,
        earliest_available_at: earliestAvail,
        jobs_today: totalJobs,
        sector_today: sectorToday,
        availability_windows: freeWindowsFormatted,
        proximity_km: proximityKm,
        skill_match: skillMatch,
      });
    }

    // Sort by score descending
    suggestions.sort((a, b) => b.score - a.score);

    return res.json({
      suggestions,
      meta: {
        date,
        teams_checked: teams.length,
        has_coordinates: !!(latitude && longitude),
        target_city: targetCity,
      },
    });
  } catch (error: any) {
    return sendSafeError(res, error, 'Failed to get team suggestions.', '[team-suggestions]');
  }
});

export default router;
