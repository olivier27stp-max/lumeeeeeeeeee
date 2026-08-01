import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { addDays, endOfMonth, endOfWeek, format, isSameDay, isSameMonth, startOfMonth, startOfWeek } from 'date-fns';
import { frCA, enCA } from 'date-fns/locale';
import { AlertTriangle } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useTranslation } from '../../i18n';
import { isAnytimeVisit, anytimeLabel, type ScheduleEventRecord } from '../../lib/scheduleApi';
import type { TeamRecord } from '../../lib/teamsApi';
import { useJobTagColors } from '../../hooks/useJobTagColors';
import { FALLBACK_TEAM_COLOR, isHexColor, toRgba } from '../../lib/colorUtils';
import { HEADER_HEIGHT_PX } from '../dispatch-daily/dailyGeometry';
import VisitDetailModal from '../schedule/VisitDetailModal';

/**
 * Vue Mois du calendrier Dispatch — grille mensuelle traditionnelle.
 * Même langage visuel que les vues Jour et Semaine : mêmes jetons, mêmes
 * bordures, mêmes ombres, même gabarit de carte que WeekVisitCard. Seule
 * différence structurelle : X = les 7 jours de la semaine (Lun → Dim),
 * aucune colonne ressource à gauche — chaque cellule est une journée.
 * Couleurs : la couleur de route existante (team.color_hex) — fond pastel +
 * barre gauche de la carte; si la job porte un tag, la couleur vive du
 * premier tag remplace celle de la route. Jamais de couleur par statut.
 */

/** Hauteur estimée d'une carte (3 lignes compactes) — pour le calcul « +X de plus ». */
const MONTH_CARD_EST_PX = 58;
/** Espace vertical entre deux cartes (space-y-1). */
const CARD_GAP_PX = 4;
/** Rangée du numéro de jour (pastille h-7 + marge). */
const DATE_ROW_PX = 32;
/** Padding vertical de la cellule (pt-1.5 + pb-1). */
const CELL_PAD_Y_PX = 10;
/** Hauteur réservée au bouton « +X de plus ». */
const MORE_BTN_PX = 22;
/** Largeur du popover de débordement. */
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
   Même gabarit que WeekVisitCard : rayon, bordure, ombre, typographie —
   avec le fond pastel de la couleur de route + barre gauche pleine. */
const MonthVisitCard = React.memo(function MonthVisitCard({
  ev, color, tagName, timeLabel, attention, onOpen,
}: {
  ev: ScheduleEventRecord;
  color: string;
  /** Nom du premier tag de la job — affiché en haut de la carte dans `color`. */
  tagName?: string | null;
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
        'flex w-full cursor-pointer select-none flex-col justify-center overflow-hidden rounded-lg border border-border py-1 pl-3 pr-2 text-left',
        'shadow-[0_1px_2px_rgba(15,23,42,0.05)] transition-shadow hover:z-10 hover:shadow-md',
      )}
      style={{ backgroundColor: toRgba(color, 0.12), borderLeft: `3px solid ${color}` }}
      onClick={(e) => { e.stopPropagation(); onOpen(); }}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen(); }}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        {tagName && (
          <span className="truncate text-[10px] font-bold leading-[1.4]" style={{ color }}>{tagName}</span>
        )}
        <span className="shrink-0 truncate text-[10px] font-medium tabular-nums leading-[1.4] text-text-tertiary">{timeLabel}</span>
        {attention && <AlertTriangle size={9} className="shrink-0 text-[#c2410c]" />}
      </div>
      <div className="truncate text-[12.5px] font-semibold leading-[1.35] text-text-primary">{clientName}</div>
      {title && title !== clientName && (
        <div className="truncate text-[11px] leading-[1.4] text-text-secondary">{title}</div>
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

  /* ── Débordement : nombre de cartes visibles selon la hauteur de cellule ── */
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [cellH, setCellH] = useState(0);
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const measure = () => setCellH(el.clientHeight / numWeeks);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [numWeeks]);

  const visibleCount = useCallback((count: number): number => {
    if (!cellH) return Math.min(count, 3);
    const avail = cellH - DATE_ROW_PX - CELL_PAD_Y_PX;
    const per = MONTH_CARD_EST_PX + CARD_GAP_PX;
    const fitAll = Math.max(0, Math.floor((avail + CARD_GAP_PX) / per));
    if (count <= fitAll) return count;
    return Math.max(0, Math.floor((avail - MORE_BTN_PX + CARD_GAP_PX) / per));
  }, [cellH]);

  /* ── Popover « +X de plus » + modale de détails ── */
  const [morePop, setMorePop] = useState<{ dayKey: string; left: number; top: number } | null>(null);
  const [detailEv, setDetailEv] = useState<ScheduleEventRecord | null>(null);

  const openMore = useCallback((dayKey: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - MORE_POP_W_PX - 8);
    const top = Math.min(rect.bottom + 6, window.innerHeight - 336);
    setMorePop({ dayKey, left, top });
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
          <div key={label} className={cn('flex min-w-0 flex-1 items-end border-l border-border/50 pb-2 pl-2', i === 0 && 'border-l-0')}>
            <span className="truncate text-[10.5px] font-medium text-text-tertiary">{label}</span>
          </div>
        ))}
      </div>

      {/* ── Grille du mois ── */}
      <div ref={bodyRef} className="min-h-0 flex-1">
        <div className="grid h-full grid-cols-7" style={{ gridTemplateRows: `repeat(${numWeeks}, minmax(0, 1fr))` }}>
          {days.map((day, i) => {
            const dayKey = format(day, 'yyyy-MM-dd');
            const cur = isSameMonth(day, date);
            const today = isSameDay(day, new Date());
            const dayEvents = eventsByDay.get(dayKey) || [];
            const shown = visibleCount(dayEvents.length);
            const hidden = dayEvents.length - shown;
            return (
              <div
                key={dayKey}
                onClick={() => onDayClick(day)}
                className={cn(
                  'flex min-w-0 cursor-pointer flex-col overflow-hidden border-b border-border/70 border-l border-l-border/40 px-1.5 pb-1 pt-1.5 transition-colors hover:bg-surface-secondary/30',
                  i % 7 === 0 && 'border-l-0',
                  !cur && 'bg-surface-secondary/10',
                  today && 'bg-primary/[0.02]',
                )}
              >
                <div className="mb-1 flex shrink-0">
                  <span className={cn(
                    'flex h-7 w-7 items-center justify-center rounded-full text-[13px] tabular-nums',
                    today ? 'bg-primary font-bold text-white' : cur ? 'font-medium text-text-primary' : 'text-text-tertiary/40',
                  )}>
                    {format(day, 'd')}
                  </span>
                </div>
                <div className="min-h-0 space-y-1">
                  {dayEvents.slice(0, shown).map((ev) => {
                    const tag = firstTagFor(ev.job?.tag_ids);
                    return (
                      <MonthVisitCard
                        key={ev.id}
                        ev={ev}
                        color={tag?.hex || teamColorFor(ev)}
                        tagName={tag?.name ?? null}
                        timeLabel={startLabelFor(ev)}
                        attention={attentionFor(ev)}
                        onOpen={() => setDetailEv(ev)}
                      />
                    );
                  })}
                  {hidden > 0 && (
                    <button
                      onClick={(e) => openMore(dayKey, e)}
                      className="w-full rounded px-1.5 py-0.5 text-left text-[10px] font-semibold text-primary transition-colors hover:bg-primary/5"
                    >
                      + {hidden} {isFr ? 'de plus' : 'more'}
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
              <div className="space-y-1">
                {dayEvents.map((ev) => {
                  const tag = firstTagFor(ev.job?.tag_ids);
                  return (
                    <MonthVisitCard
                      key={ev.id}
                      ev={ev}
                      color={tag?.hex || teamColorFor(ev)}
                      tagName={tag?.name ?? null}
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
