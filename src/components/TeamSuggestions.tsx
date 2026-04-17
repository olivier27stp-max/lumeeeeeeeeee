import React, { useEffect, useState } from 'react';
import { Users, MapPin, Clock, Zap, ChevronDown, ChevronUp, Loader2, AlertCircle } from 'lucide-react';
import { getTeamSuggestions, type TeamSuggestion, type SuggestionParams } from '../lib/teamSuggestionsApi';
import { useTranslation } from '../i18n';

interface TeamSuggestionsProps {
  date: string | null;
  startTime?: string;
  endTime?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  serviceType?: string;
  onSelectTeam: (teamId: string) => void;
  onSuggestionsLoaded?: (suggestions: TeamSuggestion[]) => void;
  selectedTeamId?: string | null;
  compact?: boolean;
}

const STATUS_CLASSNAMES: Record<string, string> = {
  available: 'bg-emerald-50 text-emerald-700',
  partially_available: 'bg-amber-50 text-amber-700',
  busy: 'bg-red-50 text-red-700',
  unavailable: 'bg-neutral-100 text-neutral-500',
};

export default function TeamSuggestions({
  date,
  startTime,
  endTime,
  address,
  latitude,
  longitude,
  serviceType,
  onSelectTeam,
  onSuggestionsLoaded,
  selectedTeamId,
  compact = false,
}: TeamSuggestionsProps) {
  const { t } = useTranslation();
  const STATUS_LABELS: Record<string, { label: string; className: string }> = {
    available: { label: t.teamSuggestions.available, className: STATUS_CLASSNAMES.available },
    partially_available: { label: t.teamSuggestions.partial, className: STATUS_CLASSNAMES.partially_available },
    busy: { label: t.teamSuggestions.busy, className: STATUS_CLASSNAMES.busy },
    unavailable: { label: t.teamSuggestions.off, className: STATUS_CLASSNAMES.unavailable },
  };
  const [suggestions, setSuggestions] = useState<TeamSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    if (!date) {
      setSuggestions([]);
      return;
    }

    const params: SuggestionParams = {
      date,
      startTime: startTime || undefined,
      endTime: endTime || undefined,
      address: address || undefined,
      latitude,
      longitude,
      serviceType: serviceType || undefined,
    };

    let cancelled = false;
    setLoading(true);
    setError(null);

    // Debounce
    const timer = setTimeout(() => {
      getTeamSuggestions(params)
        .then(res => {
          if (!cancelled) {
            setSuggestions(res.suggestions);
            onSuggestionsLoaded?.(res.suggestions);
          }
        })
        .catch(err => {
          if (!cancelled) setError(err?.message || t.teamSuggestions.failedLoad);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 300);

    return () => { cancelled = true; clearTimeout(timer); };
  }, [date, startTime, endTime, address, latitude, longitude, serviceType]);

  if (!date) return null;

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-3 text-[13px] text-text-tertiary">
        <Loader2 size={14} className="animate-spin" />
        <span>{t.teamSuggestions.findingBestTeams}</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 py-2 text-[12px] text-danger">
        <AlertCircle size={14} />
        <span>{error}</span>
      </div>
    );
  }

  if (suggestions.length === 0) return null;

  const topSuggestions = compact ? suggestions.slice(0, 3) : suggestions;

  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-text-tertiary uppercase tracking-wider flex items-center gap-1.5">
        <Zap size={12} />
        {t.teamSuggestions.suggestedTeams}
      </p>
      <div className="space-y-1">
        {topSuggestions.map((team) => {
          const statusInfo = STATUS_LABELS[team.status] || STATUS_LABELS.unavailable;
          const isSelected = selectedTeamId === team.team_id;
          const isExpanded = expanded === team.team_id;

          return (
            <div key={team.team_id} className="group">
              <button
                type="button"
                onClick={() => onSelectTeam(team.team_id)}
                className={`w-full text-left px-3 py-2.5 rounded-lg border transition-all text-[13px] ${
                  isSelected
                    ? 'border-brand bg-brand/5 ring-1 ring-brand/20'
                    : 'border-outline hover:border-brand/30 hover:bg-surface-secondary'
                } ${team.status === 'unavailable' ? 'opacity-50' : ''}`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5 min-w-0">
                    {/* Team color dot */}
                    <div
                      className="w-3 h-3 rounded-full shrink-0"
                      style={{ backgroundColor: team.team_color }}
                    />
                    {/* Team name */}
                    <span className="font-medium text-text-primary truncate">{team.team_name}</span>
                    {/* Status badge */}
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0 ${statusInfo.className}`}>
                      {statusInfo.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {/* Score indicator */}
                    <div className="w-8 h-1.5 rounded-full bg-neutral-200 overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${team.score}%`,
                          backgroundColor: team.score > 70 ? '#10b981' : team.score > 40 ? '#f59e0b' : '#ef4444',
                        }}
                      />
                    </div>
                    {/* Expand button */}
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setExpanded(isExpanded ? null : team.team_id); }}
                      className="p-0.5 rounded hover:bg-surface-tertiary"
                    >
                      {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                    </button>
                  </div>
                </div>

                {/* Quick info line */}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1 text-[11px] text-text-tertiary">
                  {team.availability_windows.length > 0 && (
                    <span className="flex items-center gap-1">
                      <Clock size={10} />
                      {team.availability_windows.map(w => `${w.start}-${w.end}`).join(', ')}
                    </span>
                  )}
                  {team.sector_today && (
                    <span className="flex items-center gap-1">
                      <MapPin size={10} /> {team.sector_today}
                    </span>
                  )}
                  {team.jobs_today > 0 && (
                    <span>{team.jobs_today} {team.jobs_today > 1 ? t.teamSuggestions.jobs : t.teamSuggestions.job}</span>
                  )}
                  {team.proximity_km !== null && (
                    <span>{team.proximity_km}km</span>
                  )}
                </div>

                {/* Primary reason */}
                {team.reasons.length > 0 && (
                  <p className="mt-1 text-[11px] text-text-secondary italic">{team.reasons[0]}</p>
                )}
              </button>

              {/* Expanded details */}
              {isExpanded && (
                <div className="mx-3 mt-1 mb-2 px-3 py-2.5 bg-surface-secondary rounded-lg text-[11px] space-y-2">
                  {/* All reasons */}
                  {team.reasons.length > 1 && (
                    <div>
                      <p className="font-semibold text-text-tertiary uppercase tracking-wider mb-1">{t.teamSuggestions.whyRecommended}</p>
                      <ul className="space-y-0.5">
                        {team.reasons.map((r, i) => (
                          <li key={i} className="text-text-secondary flex items-start gap-1.5">
                            <span className="text-brand mt-0.5">-</span> {r}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Free windows */}
                  {team.availability_windows.length > 0 && (
                    <div>
                      <p className="font-semibold text-text-tertiary uppercase tracking-wider mb-1">{t.teamSuggestions.availableWindows}</p>
                      <div className="flex flex-wrap gap-1">
                        {team.availability_windows.map((w, i) => (
                          <span key={i} className="bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded text-[10px] font-medium">
                            {w.start} - {w.end}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Score breakdown */}
                  <div className="flex items-center gap-3 pt-1 border-t border-outline">
                    <span className="text-text-tertiary">{t.teamSuggestions.score}<strong className="text-text-primary">{team.score}/100</strong></span>
                    {team.skill_match && <span className="text-emerald-600">{t.teamSuggestions.skillsMatched}</span>}
                    {!team.skill_match && <span className="text-amber-600">{t.teamSuggestions.skillGap}</span>}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
