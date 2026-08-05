/**
 * Sélecteur d'équipe du form de job — remplace le <select> natif pour pouvoir
 * afficher, SOUS chaque équipe disponible, les membres assignés à l'équipe
 * pour la date de la visite (onglet Horaire). Bouton volontairement plus
 * gros, fond blanc, texte bold (demande d'Olivier).
 *
 * Statut par équipe = suggestions serveur (/api/team-suggestions) quand
 * chargées; membres = même source/cache que TeamDayRoster.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, ChevronDown } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { cn } from '../lib/utils';
import { useCompany } from '../contexts/CompanyContext';
import { getRosterForDate, fetchMemberNames, firstNameOf } from '../lib/teamScheduleApi';
import UnifiedAvatar from './ui/UnifiedAvatar';
import type { TeamRecord } from '../lib/teamsApi';
import type { TeamSuggestion } from '../lib/teamSuggestionsApi';

interface Props {
  teams: TeamRecord[];
  value: string;
  onChange: (value: string) => void;
  /** Date de la 1re visite (YYYY-MM-DD) — pilote membres et statuts. */
  date: string | null;
  fr: boolean;
  suggestions?: TeamSuggestion[] | null;
  /** Job multi-visites (plan de service) — libellés au pluriel. */
  plural?: boolean;
  placeholder: string;
  unassignedLabel: string;
  unassignedValue: string;
}

export default function TeamSelectDropdown({
  teams, value, onChange, date, fr, suggestions, plural, placeholder, unassignedLabel, unassignedValue,
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const { currentOrgId } = useCompany();
  const validDate = !!date && /^\d{4}-\d{2}-\d{2}$/.test(date);

  // Fermer au clic extérieur / Échap.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  // Membres du jour — mêmes clés de cache que TeamDayRoster / vue Jour.
  const rosterQuery = useQuery({
    queryKey: ['team-schedule-roster', currentOrgId, date],
    queryFn: () => getRosterForDate(date as string),
    enabled: !!currentOrgId && validDate,
    staleTime: 60_000,
    retry: false,
  });
  // Noms en direct Supabase (memberships → profiles) — pas de dépendance à
  // l'API serveur, qui laissait des « Membre » génériques quand elle échouait.
  const namesQuery = useQuery({
    queryKey: ['member-names', currentOrgId],
    queryFn: fetchMemberNames,
    enabled: !!currentOrgId,
    staleTime: 5 * 60_000,
  });
  const firstName = useMemo(() => {
    const map = new Map<string, string>();
    for (const [id, name] of namesQuery.data ?? new Map<string, string>()) {
      map.set(id, firstNameOf(name));
    }
    return map;
  }, [namesQuery.data]);

  const rosterReady = !!rosterQuery.data && !rosterQuery.data.missing;
  const membersFor = (teamId: string): string[] => {
    if (!rosterReady) return [];
    const roster = (rosterQuery.data!.byTeam.get(teamId) || [])
      .filter((e) => e.status === 'available' || e.status === 'partial');
    return [...new Map(roster.map((e) => [e.user_id, firstName.get(e.user_id) || (fr ? 'Membre' : 'Member')])).entries()]
      .map(([id, name]) => `${id}|${name}`);
  };

  const suggestionFor = (teamId: string): TeamSuggestion | null =>
    suggestions?.find((s) => s.team_id === teamId) || null;

  const selectedTeam = teams.find((t) => t.id === value) || null;
  const buttonLabel = selectedTeam
    ? selectedTeam.name
    : value === unassignedValue
      ? unassignedLabel
      : placeholder;

  return (
    <div ref={rootRef} className="relative">
      {/* Bouton principal — gros, blanc, bold */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex h-12 w-full items-center justify-between gap-3 rounded-xl border border-outline px-4 text-left shadow-sm transition-colors',
          '!bg-white dark:!bg-surface-card hover:border-text-tertiary'
        )}
      >
        <span className="flex min-w-0 items-center gap-2.5">
          {selectedTeam && (
            <span className="h-3 w-3 shrink-0 rounded-full ring-2 ring-white shadow-sm" style={{ backgroundColor: selectedTeam.color_hex }} />
          )}
          <span className={cn(
            'truncate text-[15px]',
            selectedTeam || value === unassignedValue ? 'font-bold !text-black dark:!text-white' : 'font-medium text-text-tertiary'
          )}>
            {buttonLabel}
          </span>
        </span>
        <ChevronDown size={17} className={cn('shrink-0 text-text-tertiary transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute z-50 mt-1.5 w-full overflow-y-auto rounded-xl border border-outline !bg-white dark:!bg-surface-card p-1.5 shadow-2xl max-h-[340px]">
          {/* Non assignée */}
          <button
            type="button"
            onClick={() => { onChange(unassignedValue); setOpen(false); }}
            className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-surface-secondary"
          >
            <span className="text-[14px] font-semibold text-text-secondary">{unassignedLabel}</span>
            {value === unassignedValue && <Check size={15} className="text-text-primary shrink-0" />}
          </button>

          {teams.map((team) => {
            const sug = suggestionFor(team.id);
            const unavailable = sug?.status === 'unavailable';
            const windows = sug?.availability_windows || [];
            const members = unavailable ? [] : membersFor(team.id);
            return (
              <button
                key={team.id}
                type="button"
                onClick={() => { onChange(team.id); setOpen(false); }}
                className={cn(
                  'flex w-full flex-col gap-1 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-surface-secondary',
                  unavailable && 'opacity-55'
                )}
              >
                <span className="flex w-full items-center gap-2.5">
                  <span className="h-3 w-3 shrink-0 rounded-full ring-2 ring-white shadow-sm" style={{ backgroundColor: team.color_hex }} />
                  <span className="truncate text-[14.5px] font-bold !text-black dark:!text-white">{team.name}</span>
                  <span className="ml-auto flex items-center gap-2 shrink-0">
                    {sug && (
                      unavailable ? (
                        <span className="text-[11px] font-medium text-text-tertiary">{fr
                          ? (plural ? 'Indisponible ces jours-là' : 'Indisponible ce jour-là')
                          : (plural ? 'Unavailable those days' : 'Unavailable that day')}</span>
                      ) : windows.length > 0 ? (
                        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-[2px] text-[11px] font-semibold tabular-nums text-emerald-700">
                          {windows[0].start}–{windows[0].end}
                        </span>
                      ) : null
                    )}
                    {value === team.id && <Check size={15} className="text-text-primary" />}
                  </span>
                </span>
                {/* Membres de l'équipe pour la date de la visite */}
                {!unavailable && rosterReady && (
                  members.length > 0 ? (
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 pl-[22px]">
                      {members.map((entry) => {
                        const [id, name] = entry.split('|');
                        return (
                          <span key={id} className="inline-flex items-center gap-1">
                            <UnifiedAvatar id={id} name={name} size={15} />
                            <span className="text-[11.5px] font-medium text-text-secondary">{name}</span>
                          </span>
                        );
                      })}
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 pl-[22px] text-[11px] font-medium text-[#c2410c]">
                      <AlertTriangle size={10} className="shrink-0" />
                      {fr
                        ? (plural ? 'Aucun membre assigné ces jours-là' : 'Aucun membre assigné ce jour-là')
                        : (plural ? 'No members assigned those days' : 'No members assigned that day')}
                    </span>
                  )
                )}
              </button>
            );
          })}

          {teams.length === 0 && (
            <p className="px-3 py-3 text-[12px] text-text-tertiary">{fr ? 'Aucune équipe.' : 'No teams.'}</p>
          )}
        </div>
      )}
    </div>
  );
}
