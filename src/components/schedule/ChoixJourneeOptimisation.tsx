/**
 * « Optimiser la journée » : on CHOISIT la journée (et l'équipe) avant d'ouvrir
 * Lumi. Le bouton prenait silencieusement le jour sélectionné du Calendrier —
 * en vue Semaine ou Mois, on ne savait pas lequel partait (2026-09-30).
 *
 * Chaque jour montre son nombre de visites : un jour vide ne s'optimise pas,
 * on le voit avant de cliquer.
 */
import React, { useId, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MapPin } from 'lucide-react';
import { listScheduleEventsRange, type ScheduleEventRecord } from '../../lib/scheduleApi';
import { instantDepuisSaisie } from '../../lib/fuseauEntreprise';
import type { TeamRecord } from '../../lib/teamsApi';

const JOURS_PROPOSES = 7;

/** « AAAA-MM-JJ » du jour d'un instant, au fuseau de l'entreprise. */
export function jourDansFuseau(instant: Date | string, fuseau: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: fuseau, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(instant));
}

/** Jour + n jours (calendrier, sans fuseau). */
export function ajouterJours(jour: string, n: number): string {
  const d = new Date(`${jour}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Visites comptées par jour (annulées exclues), pour une équipe ou toutes. */
export function visitesParJour(evenements: ScheduleEventRecord[], fuseau: string, equipe: string | null): Map<string, number> {
  const n = new Map<string, number>();
  for (const e of evenements) {
    if (e.deleted_at || e.status === 'cancelled') continue;
    if (equipe && (e.team_id ?? e.job?.team_id ?? null) !== equipe) continue;
    const jour = jourDansFuseau(e.start_at, fuseau);
    n.set(jour, (n.get(jour) ?? 0) + 1);
  }
  return n;
}

async function chargerJours(debut: string, finExclue: string, fuseau: string): Promise<ScheduleEventRecord[]> {
  return listScheduleEventsRange({ startAt: instantDepuisSaisie(debut, '00:00', fuseau), endAt: instantDepuisSaisie(finExclue, '00:00', fuseau) });
}

interface Props {
  fuseau: string;
  teams: TeamRecord[];
  /** Jour affiché dans le Calendrier (AAAA-MM-JJ). */
  jourAffiche: string;
  /** Équipe présélectionnée (une seule équipe cochée dans le Calendrier). */
  equipeInitiale: string | null;
  fr: boolean;
  onChoisir: (jour: string, equipe: string | null) => void;
}

export default function ChoixJourneeOptimisation({ fuseau, teams, jourAffiche, equipeInitiale, fr, onChoisir }: Props) {
  const uid = useId();
  const [equipe, setEquipe] = useState<string | null>(equipeInitiale);
  const aujourdhui = jourDansFuseau(new Date(), fuseau);
  const [autreJour, setAutreJour] = useState('');

  const prochains = useMemo(() => Array.from({ length: JOURS_PROPOSES }, (_, i) => ajouterJours(aujourdhui, i)), [aujourdhui]);
  const afficheHorsListe = !prochains.includes(jourAffiche);
  const jours = afficheHorsListe ? [jourAffiche, ...prochains] : prochains;

  const prochainsQ = useQuery({
    queryKey: ['optimiserChoixJours', 'prochains', fuseau, aujourdhui],
    staleTime: 30_000,
    queryFn: () => chargerJours(aujourdhui, ajouterJours(aujourdhui, JOURS_PROPOSES), fuseau),
  });
  const afficheQ = useQuery({
    queryKey: ['optimiserChoixJours', 'affiche', fuseau, jourAffiche],
    enabled: afficheHorsListe,
    staleTime: 30_000,
    queryFn: () => chargerJours(jourAffiche, ajouterJours(jourAffiche, 1), fuseau),
  });

  const comptes = useMemo(
    () => visitesParJour([...(prochainsQ.data ?? []), ...(afficheHorsListe ? afficheQ.data ?? [] : [])], fuseau, equipe),
    [prochainsQ.data, afficheQ.data, afficheHorsListe, fuseau, equipe],
  );
  const chargement = prochainsQ.isLoading || (afficheHorsListe && afficheQ.isLoading);

  const libelleJour = (jour: string) => {
    const nom = new Intl.DateTimeFormat(fr ? 'fr-CA' : 'en-CA', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${jour}T12:00:00Z`));
    if (jour === aujourdhui) return `${fr ? 'Aujourd’hui' : 'Today'} — ${nom}`;
    if (jour === ajouterJours(aujourdhui, 1)) return `${fr ? 'Demain' : 'Tomorrow'} — ${nom}`;
    return nom.charAt(0).toUpperCase() + nom.slice(1);
  };
  const libelleVisites = (n: number) => (n === 0
    ? (fr ? 'Aucune visite' : 'No visits')
    : fr ? `${n} visite${n > 1 ? 's' : ''}` : `${n} visit${n > 1 ? 's' : ''}`);

  return (
    <div data-testid="choix-journee" className="w-80 rounded-xl border border-border bg-surface p-3 shadow-xl">
      <p className="mb-2 text-[13px] font-semibold text-text-primary">{fr ? 'Quelle journée optimiser ?' : 'Which day should we optimize?'}</p>

      {teams.length > 1 && (
        <div className="mb-2">
          <label htmlFor={`${uid}-equipe`} className="mb-1 block text-[11px] font-medium text-text-tertiary">{fr ? 'Équipe' : 'Team'}</label>
          <select
            id={`${uid}-equipe`}
            value={equipe ?? ''}
            onChange={(e) => setEquipe(e.target.value || null)}
            className="w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-[13px] text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <option value="">{fr ? 'Toutes les équipes' : 'All teams'}</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
      )}

      <ul className="space-y-0.5">
        {jours.map((jour) => {
          const n = comptes.get(jour) ?? 0;
          const vide = !chargement && n === 0;
          return (
            <li key={jour}>
              <button
                type="button"
                data-testid={`jour-${jour}`}
                disabled={vide}
                onClick={() => onChoisir(jour, equipe)}
                className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors enabled:hover:bg-surface-secondary disabled:cursor-not-allowed disabled:opacity-45"
              >
                <span className="truncate text-text-primary">
                  {libelleJour(jour)}
                  {jour === jourAffiche && <span className="ml-1.5 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">{fr ? 'affiché' : 'shown'}</span>}
                </span>
                <span className="shrink-0 text-[12px] text-text-tertiary">{chargement ? '…' : libelleVisites(n)}</span>
              </button>
            </li>
          );
        })}
      </ul>

      <form
        className="mt-2 flex items-end gap-2 border-t border-border pt-2"
        onSubmit={(e) => { e.preventDefault(); if (/^\d{4}-\d{2}-\d{2}$/.test(autreJour)) onChoisir(autreJour, equipe); }}
      >
        <div className="flex-1">
          <label htmlFor={`${uid}-autre`} className="mb-1 block text-[11px] font-medium text-text-tertiary">{fr ? 'Autre date' : 'Other date'}</label>
          <input
            id={`${uid}-autre`}
            type="date"
            min={aujourdhui}
            value={autreJour}
            onChange={(e) => setAutreJour(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-[13px] text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          />
        </div>
        <button
          type="submit"
          disabled={!autreJour}
          className="flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          <MapPin size={13} />{fr ? 'Optimiser' : 'Optimize'}
        </button>
      </form>
    </div>
  );
}
