import React, { useCallback, useMemo, useState } from 'react';
import { addDays, endOfMonth, endOfWeek, format, isSameDay, isSameMonth, startOfMonth, startOfWeek } from 'date-fns';
import { frCA, enCA } from 'date-fns/locale';
import { AlertTriangle } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useTranslation } from '../../i18n';
import { isAnytimeVisit, anytimeLabel, type ScheduleEventRecord } from '../../lib/scheduleApi';
import type { TeamRecord } from '../../lib/teamsApi';
import { useJobTagColors } from '../../hooks/useJobTagColors';
import { FALLBACK_TEAM_COLOR, isHexColor } from '../../lib/colorUtils';
import { HEADER_HEIGHT_PX } from '../dispatch-daily/dailyGeometry';
import VisitDetailModal from '../schedule/VisitDetailModal';

/**
 * Vue Mois du calendrier Dispatch — grille mensuelle traditionnelle.
 * Même langage visuel que les vues Jour et Semaine : mêmes jetons, mêmes
 * bordures, mêmes ombres, même gabarit de carte que WeekVisitCard. Seule
 * différence structurelle : X = les 7 jours de la semaine (Lun → Dim),
 * aucune colonne ressource à gauche — chaque cellule est une journée.
 * Style Jobber : cartes blanches compactes à hauteur fixe, barre gauche à la
 * couleur de route existante (team.color_hex); si la job porte un tag, son
 * nom s'affiche en tête dans la couleur vive du tag. Jamais de couleur par
 * statut, jamais de nouvelle couleur.
 */

/** Hauteur FIXE d'une carte (3 lignes compactes, style Jobber). */
const MONTH_CARD_PX = 50;
/** Hauteur minimale d'une rangée semaine — les rangées s'allongent avec les
    visites (jusqu'à MAX_CARDS_PER_DAY cartes), la grille défile. */
const ROW_MIN_PX = 112;
/** Cartes affichées au maximum par case — au-delà : « +X de plus ». */
const MAX_CARDS_PER_DAY = 8;
/** Largeur du popover « +X de plus ». */
const MORE_POP_W_PX = 288;

interface MonthlyDispatchViewProps {
  date: Date;
  events: ScheduleEventRecord[];
  teams: TeamRecord[];
  isError?: boolean;
  /** Clic sur une cellule vide → naviguer vers la vue Jour. */
  onDayClick: (d: Date) => void;
  /** « Voir la visite » dans la modale → hub de la job. */
  onEventClick: (jobId: string) => void;
}

/* ── Carte de visite (empilée dans une cellule jour) ──
   Style Jobber : carte blanche compacte à hauteur fixe, bordure pâle, petit
   rayon, barre gauche pleine à la couleur de route. Le hover assombrit
   légèrement le fond (150 ms) — mêmes jetons que le reste du calendrier. */
const MonthVisitCard = React.memo(function MonthVisitCard({
  ev, barColor, tagName, tagColor, timeLabel, attention, onOpen,
}: {
  ev: ScheduleEventRecord;
  /** Couleur de la barre gauche — TOUJOURS la couleur d'équipe assignée. */
  barColor: string;
  /** Nom du premier tag de la job — affiché en tête dans sa couleur. */
  tagName?: string | null;
  tagColor?: string | null;
  timeLabel: string;
  attention: boolean;
  onOpen: () => void;
}) {
  const clientName = ev.job?.client_name || ev.job?.title || 'Job';
  const title = (ev.job?.title || '').trim() || null;
  const tooltip = [tagName, timeLabel, clientName, title && title !== clientName ? title : null].filter(Boolean).join(' · ');
  return (
    <div
      role="button"
      tabIndex={0}
      title={tooltip}
      className={cn(
        'flex w-full cursor-pointer select-none flex-col justify-center overflow-hidden rounded-md border border-border bg-surface py-0.5 pl-2 pr-1.5 text-left',
        'shadow-[0_1px_2px_rgba(15,23,42,0.05)] transition-colors duration-150 hover:bg-surface-secondary',
      )}
      style={{ height: MONTH_CARD_PX, borderLeft: `3px solid ${barColor}` }}
      onClick={(e) => { e.stopPropagation(); onOpen(); }}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen(); }}
    >
      <div className="flex min-w-0 items-center gap-1">
        {tagName && (
          <span className="truncate text-[10px] font-bold leading-[1.3]" style={tagColor ? { color: tagColor } : undefined}>{tagName}</span>
        )}
        <span className="shrink-0 truncate text-[10px] font-medium tabular-nums leading-[1.3] text-text-tertiary">{timeLabel}</span>
        {attention && <AlertTriangle size={9} className="shrink-0 text-[#c2410c]" />}
      </div>
      <div className="truncate text-[12px] font-medium leading-[1.3] text-text-primary">{clientName}</div>
      {title && title !== clientName && (
        <div className="truncate text-[11px] leading-[1.3] text-text-secondary">{title}</div>
      )}
    </div>
  );
});

export default function MonthlyDispatchView({
  date, events, teams, isError, onDayClick, onEventClick,
}: MonthlyDispatchViewProps) {
  const { t, language } = useTranslation();
  const isFr = language === 'fr';
  const { firstTagFor } = useJobTagColors();

  /* ── Grille des jours (Lun → Dim, comme la vue Semaine) ── */
  const days = useMemo(() => {
    const gStart = startOfWeek(startOfMonth(date), { weekStartsOn: 1 });
    const gEnd = endOfWeek(endOfMonth(date), { weekStartsOn: 1 });
    const list: Date[] = [];
    for (let d = gStart; d <= gEnd; d = addDays(d, 1)) list.push(d);
    return list;
  }, [date]);
  const numWeeks = Math.ceil(days.length / 7);
  const weekdayLabels = isFr
    ? ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']
    : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  /* ── Visites par jour — dédup par id, tri par heure de début ── */
  const eventsByDay = useMemo(() => {
    const seen = new Set<string>();
    const m = new Map<string, ScheduleEventRecord[]>();
    for (const ev of events) {
      if (seen.has(ev.id)) continue;
      seen.add(ev.id);
      // Comparer sur la date LOCALE de l'event (start_at est en UTC).
      const dayKey = format(new Date(ev.start_at), 'yyyy-MM-dd');
      if (!m.has(dayKey)) m.set(dayKey, []);
      m.get(dayKey)!.push(ev);
    }
    for (const list of m.values()) {
      list.sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime());
    }
    return m;
  }, [events]);

  /* ── Couleurs — couleur de route, remplacée par le 1er tag de la job ── */
  const teamColorFor = useCallback((ev: ScheduleEventRecord): string => {
    const tid = ev.team_id || ev.job?.team_id || null;
    const team = tid ? teams.find((tm) => tm.id === tid) : null;
    return team && isHexColor(team.color_hex) ? team.color_hex : FALLBACK_TEAM_COLOR;
  }, [teams]);

  /* ── Formats horaires — identiques aux vues Jour et Semaine ── */
  const fmtTime = useCallback((d: Date) => {
    const h = d.getHours();
    const m = d.getMinutes();
    if (isFr) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
  }, [isFr]);
  /** Heure d'arrivée seule — les cartes du mois restent compactes. */
  const startLabelFor = useCallback(
    (ev: ScheduleEventRecord) => (isAnytimeVisit(ev.start_at, ev.end_at)
      ? anytimeLabel(isFr)
      : fmtTime(new Date(ev.start_at))),
    [fmtTime, isFr],
  );
  /** Plage complète — pour la modale de détails (même format que la vue Semaine). */
  const rangeLabelFor = useCallback((ev: ScheduleEventRecord) => {
    if (isAnytimeVisit(ev.start_at, ev.end_at)) return anytimeLabel(isFr);
    const s = new Date(ev.start_at);
    let dur = (new Date(ev.end_at).getTime() - s.getTime());
    if (!Number.isFinite(dur) || dur <= 0) dur = 60 * 60000;
    return `${fmtTime(s)} – ${fmtTime(new Date(s.getTime() + dur))}`;
  }, [fmtTime, isFr]);

  const attentionFor = (ev: ScheduleEventRecord) => {
    const st = String(ev.job?.status || ev.status || '').trim().toLowerCase().replace(/\s+/g, '_');
    return st === 'blocked' || st === 'late' || st === 'action_required';
  };

  /* ── Popover « +X de plus » + modale de détails ── */
  const [morePop, setMorePop] = useState<{ dayKey: string; left: number; top: number } | null>(null);
  const [detailEv, setDetailEv] = useState<ScheduleEventRecord | null>(null);

  const openMore = useCallback((dayKey: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - MORE_POP_W_PX - 8);
    const top = Math.min(rect.bottom + 6, window.innerHeight - 336);
    setMorePop({ dayKey, left, top: Math.max(8, top) });
  }, []);

  /* ── États particuliers ── */
  if (isError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-text-tertiary">
        <AlertTriangle size={28} className="opacity-40" />
        <p className="text-sm font-medium">{t.schedule.calendarError}</p>
      </div>
    );
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col" data-dispatch-monthly>
      {/* ── En-tête des jours de semaine ── */}
      <div className="flex shrink-0 border-b border-border bg-surface" style={{ height: HEADER_HEIGHT_PX }}>
        {weekdayLabels.map((label, i) => (
          <div key={label} className={cn('flex min-w-0 flex-1 items-center justify-center border-l border-border/50', i === 0 && 'border-l-0')}>
            <span className="truncate text-[14px] font-bold text-black">{label}</span>
          </div>
        ))}
      </div>

      {/* ── Grille du mois — les rangées s'allongent, la grille défile ── */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="grid min-h-full grid-cols-7" style={{ gridTemplateRows: `repeat(${numWeeks}, minmax(${ROW_MIN_PX}px, auto))` }}>
          {days.map((day, i) => {
            const dayKey = format(day, 'yyyy-MM-dd');
            const cur = isSameMonth(day, date);
            const today = isSameDay(day, new Date());
            const dayEvents = eventsByDay.get(dayKey) || [];
            return (
              <div
                key={dayKey}
                onClick={() => onDayClick(day)}
                className={cn(
                  'flex min-w-0 cursor-pointer flex-col overflow-hidden border-b border-l border-border/60 px-1 pb-0.5 pt-1 transition-colors hover:bg-surface-secondary/30',
                  i % 7 === 0 && 'border-l-0',
                  !cur && 'bg-surface-secondary/10',
                  today && 'bg-primary/[0.02]',
                )}
              >
                <div className="mb-0.5 flex shrink-0">
                  <span className={cn(
                    'flex h-6 min-w-6 items-center justify-center rounded-full px-0.5 text-[12px] font-bold tabular-nums',
                    today ? 'bg-primary text-white' : cur ? 'text-text-primary' : 'text-text-tertiary/50',
                  )}>
                    {format(day, 'd')}
                  </span>
                </div>
                <div className="space-y-0.5">
                  {dayEvents.slice(0, MAX_CARDS_PER_DAY).map((ev) => {
                    const tag = firstTagFor(ev.job?.tag_ids);
                    return (
                      <MonthVisitCard
                        key={ev.id}
                        ev={ev}
                        barColor={teamColorFor(ev)}
                        tagName={tag?.name ?? null}
                        tagColor={tag?.hex ?? null}
                        timeLabel={startLabelFor(ev)}
                        attention={attentionFor(ev)}
                        onOpen={() => setDetailEv(ev)}
                      />
                    );
                  })}
                  {dayEvents.length > MAX_CARDS_PER_DAY && (
                    <button
                      onClick={(e) => openMore(dayKey, e)}
                      className="w-full rounded px-1 py-px text-left text-[10px] font-semibold text-primary transition-colors duration-150 hover:bg-primary/5"
                    >
                      + {dayEvents.length - MAX_CARDS_PER_DAY} {isFr ? 'de plus' : 'more'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Popover « +X de plus » — toutes les visites de la journée ── */}
      {morePop && (() => {
        const day = new Date(morePop.dayKey + 'T12:00:00');
        const dayEvents = eventsByDay.get(morePop.dayKey) || [];
        const locale = isFr ? frCA : enCA;
        const label = format(day, isFr ? 'EEEE d MMMM' : 'EEEE, MMMM d', { locale });
        return (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setMorePop(null)} />
            <div
              className="fixed z-40 max-h-80 overflow-y-auto rounded-xl border border-border bg-surface p-2 shadow-xl"
              style={{ left: morePop.left, top: morePop.top, width: MORE_POP_W_PX }}
            >
              <div className="mb-1.5 flex items-center justify-between px-1">
                <span className="truncate text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
                  {label.charAt(0).toUpperCase() + label.slice(1)}
                </span>
                <span className="rounded-md bg-surface-tertiary px-1.5 py-0.5 text-[10px] font-bold text-text-secondary">{dayEvents.length}</span>
              </div>
              <div className="space-y-0.5">
                {dayEvents.map((ev) => {
                  const tag = firstTagFor(ev.job?.tag_ids);
                  return (
                    <MonthVisitCard
                      key={ev.id}
                      ev={ev}
                      barColor={teamColorFor(ev)}
                      tagName={tag?.name ?? null}
                      tagColor={tag?.hex ?? null}
                      timeLabel={startLabelFor(ev)}
                      attention={attentionFor(ev)}
                      onOpen={() => { setMorePop(null); setDetailEv(ev); }}
                    />
                  );
                })}
              </div>
            </div>
          </>
        );
      })()}

      {/* ── Détails de la visite — même modale que la vue Semaine ── */}
      {detailEv && (() => {
        const tid = detailEv.team_id || detailEv.job?.team_id || null;
        const team = tid ? teams.find((tm) => tm.id === tid) || null : null;
        return (
          <VisitDetailModal
            ev={detailEv}
            color={teamColorFor(detailEv)}
            teamName={team?.name || null}
            timeLabel={rangeLabelFor(detailEv)}
            onClose={() => setDetailEv(null)}
            onView={() => {
              const jobId = detailEv.job_id;
              setDetailEv(null);
              if (jobId) onEventClick(jobId);
            }}
          />
        );
      })()}
    </div>
  );
}
