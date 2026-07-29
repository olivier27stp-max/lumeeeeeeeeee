/**
 * Petit texte « qui est dans cette équipe ce jour-là » — affiché sous les
 * sélecteurs d'équipe (form de job, ajout de visite, modals d'assignation du
 * calendrier). Source : onglet Horaire (teamScheduleApi). Une seule requête
 * par date (clé partagée avec la vue Jour du dispatch), silencieux tant que
 * la migration team_daily_schedule n'est pas appliquée.
 */
import { useMemo } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { cn } from '../lib/utils';
import { useCompany } from '../contexts/CompanyContext';
import { getRosterForDate } from '../lib/teamScheduleApi';
import { fetchTeamList } from '../lib/invitationsApi';

interface Props {
  teamId: string | null | undefined;
  /** Date de la visite au format YYYY-MM-DD. */
  date: string | null | undefined;
  fr: boolean;
  className?: string;
}

export default function TeamDayRoster({ teamId, date, fr, className }: Props) {
  const { currentOrgId } = useCompany();
  const validDate = !!date && /^\d{4}-\d{2}-\d{2}$/.test(date);

  const rosterQuery = useQuery({
    queryKey: ['team-schedule-roster', currentOrgId, date],
    queryFn: () => getRosterForDate(date as string),
    enabled: !!currentOrgId && validDate && !!teamId,
    staleTime: 60_000,
    retry: false,
  });
  const membersQuery = useQuery({
    queryKey: ['org-members', currentOrgId],
    queryFn: fetchTeamList,
    enabled: !!currentOrgId && !!rosterQuery.data && !rosterQuery.data.missing,
    staleTime: 5 * 60_000,
    retry: false,
  });

  const firstName = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of membersQuery.data?.members ?? []) {
      const name = (m.full_name || '').trim() || m.email || '';
      map.set(m.user_id, name.split(/\s+/)[0] || name);
    }
    return map;
  }, [membersQuery.data]);

  if (!teamId || !validDate || !rosterQuery.data || rosterQuery.data.missing) return null;

  const roster = (rosterQuery.data.byTeam.get(teamId) || [])
    .filter((e) => e.status === 'available' || e.status === 'partial');

  if (!roster.length) {
    return (
      <p className={cn('flex items-center gap-1.5 text-[11px] font-medium text-[#c2410c]', className)}>
        <AlertTriangle size={11} className="shrink-0" />
        {fr ? 'Aucun membre assigné à cette équipe ce jour-là' : 'No members assigned to this team that day'}
      </p>
    );
  }

  // Un membre = présent ou non ce jour-là; les heures appartiennent à
  // l'équipe-journée (affichées ailleurs), donc on ne liste que les noms.
  const names = [...new Set(roster.map((e) => firstName.get(e.user_id) || (fr ? 'Membre' : 'Member')))];

  return (
    <p className={cn('text-[11px] text-text-tertiary leading-relaxed', className)}>
      <span className="mr-1">{fr ? 'Ce jour-là :' : 'That day:'}</span>
      {names.map((name, i) => (
        <span key={name + i}>
          {i > 0 && <span className="mx-1 text-text-tertiary/50">·</span>}
          <span className="font-medium text-text-secondary">{name}</span>
        </span>
      ))}
    </p>
  );
}
