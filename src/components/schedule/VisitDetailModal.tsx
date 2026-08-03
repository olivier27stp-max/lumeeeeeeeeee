import React, { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { frCA, enCA } from 'date-fns/locale';
import { CheckCircle2, X as XIcon } from 'lucide-react';
import { toast } from 'sonner';
import { formatCurrency } from '../../lib/utils';
import { useTranslation } from '../../i18n';
import { supabase } from '../../lib/supabase';
import { invalidateScheduleCache, isAnytimeVisit, anytimeLabel, type ScheduleEventRecord } from '../../lib/scheduleApi';
import { createInvoiceForVisit } from '../../lib/jobBillingApi';
import { updateJob } from '../../lib/jobsApi';
import { listTeams, type TeamRecord } from '../../lib/teamsApi';
import { isHexColor, toRgba } from '../../lib/colorUtils';
import FinalVisitDialog from './FinalVisitDialog';
import AddVisitModal from '../AddVisitModal';

/**
 * Modale « Voir la visite » — partagée par les vues Semaine et Mois.
 * Extraite telle quelle de WeeklyDispatchView : mêmes jetons, même layout.
 * Depuis 2026-08 : « Marquer la visite terminée » directement ici — pour les
 * jobs en facturation par visite (billing_mode = 'per_visit'), compléter la
 * visite crée aussi sa facture (envoyée d'emblée si auto_charge).
 */

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

interface VisitLineItem {
  id: string;
  name: string;
  qty: number;
  total_cents: number;
}

export default function VisitDetailModal({ ev, color, teamName, onClose, onView, onStatusChanged }: {
  ev: ScheduleEventRecord;
  color: string;
  teamName: string | null;
  timeLabel: string;
  onClose: () => void;
  onView: () => void;
  /** Appelé après un changement de statut (terminée / remise à faire). */
  onStatusChanged?: () => void;
}) {
  const { t, language } = useTranslation();
  const isFr = language === 'fr';
  const locale = isFr ? frCA : enCA;
  const s = new Date(ev.start_at);
  const end = new Date(ev.end_at);
  const anytime = isAnytimeVisit(ev.start_at, ev.end_at);
  const clientName = ev.job?.client_name || ev.job?.title || 'Job';
  const jobTitle = ev.job?.title && ev.job.title !== clientName ? ev.job.title : null;
  const address = (ev.job?.property_address || '').trim() || null;
  const jobNumber = ev.job?.job_number ? `#${ev.job.job_number}` : null;
  const [completed, setCompleted] = useState((ev.status || '').toLowerCase() === 'completed');
  const [lineItems, setLineItems] = useState<VisitLineItem[] | null>(null);
  const [memberNames, setMemberNames] = useState<string[] | null>(null);
  // Équipe de CETTE visite seulement — la réassigner écrit schedule_events.team_id
  // de cet event; jobs.team_id et les autres visites du job (service plan
  // inclus) ne bougent jamais.
  const [teams, setTeams] = useState<TeamRecord[]>([]);
  const [teamId, setTeamId] = useState<string | null>(ev.team_id || null);
  const [teamBusy, setTeamBusy] = useState(false);

  useEffect(() => {
    setTeamId(ev.team_id || null);
  }, [ev.id]);

  useEffect(() => {
    listTeams()
      .then((rows) => setTeams(rows.filter((tm) => tm.is_active !== false)))
      .catch(() => setTeams([]));
  }, []);

  const changeTeam = async (nextId: string | null) => {
    if (teamBusy || nextId === teamId) return;
    const prev = teamId;
    setTeamBusy(true);
    setTeamId(nextId);
    try {
      const { error } = await supabase
        .from('schedule_events')
        .update({ team_id: nextId, updated_at: new Date().toISOString() })
        .eq('id', ev.id);
      if (error) throw error;
      invalidateScheduleCache();
      toast.success(nextId
        ? (isFr
          ? 'Équipe de la visite mise à jour — les autres visites du job ne changent pas.'
          : "Visit team updated — the job's other visits are unchanged.")
        : (isFr
          ? 'Visite désassignée — les autres visites du job ne changent pas.'
          : "Visit unassigned — the job's other visits are unchanged."));
      onStatusChanged?.();
    } catch (err: any) {
      setTeamId(prev);
      toast.error(err?.message || (isFr ? "Impossible de changer l'équipe de la visite." : 'Could not change the visit team.'));
    } finally {
      setTeamBusy(false);
    }
  };

  const selectedTeam = teamId ? teams.find((tm) => tm.id === teamId) || null : null;
  const teamColor = selectedTeam && isHexColor(selectedTeam.color_hex) ? selectedTeam.color_hex : color;
  const displayTeamName = selectedTeam?.name ?? teamName;

  // Détails Jobber-style : line items du job + membres de l'équipe assignée.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { data } = await supabase
          .from('job_line_items')
          .select('id,name,qty,total_cents')
          .eq('job_id', ev.job_id)
          .is('deleted_at', null)
          .eq('included', true)
          .order('created_at', { ascending: true });
        if (!cancelled) {
          setLineItems(((data || []) as any[]).map((r) => ({
            id: r.id, name: r.name, qty: Number(r.qty) || 1, total_cents: Number(r.total_cents) || 0,
          })));
        }
      } catch { if (!cancelled) setLineItems([]); }
    })();
    return () => { cancelled = true; };
  }, [ev.id, ev.job_id]);

  // Membres de l'équipe sélectionnée — suit le select d'équipe de la visite.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!teamId) { setMemberNames([]); return; }
      try {
        // Équipe permanente = memberships.team_id ∪ team_assignments (N→N).
        const [m1, m2] = await Promise.all([
          supabase.from('memberships').select('user_id').eq('team_id', teamId),
          supabase.from('team_assignments').select('user_id').eq('team_id', teamId),
        ]);
        const ids = [...new Set([...(m1.data || []), ...(m2.data || [])]
          .map((r: any) => r.user_id).filter(Boolean))] as string[];
        if (!ids.length) { if (!cancelled) setMemberNames([]); return; }
        const { data: profiles } = await supabase.from('profiles').select('id, full_name').in('id', ids);
        if (!cancelled) {
          setMemberNames(ids.map((id) => {
            const p = ((profiles || []) as any[]).find((x) => x.id === id);
            return (p?.full_name || '').trim() || (isFr ? 'Membre' : 'Member');
          }));
        }
      } catch { if (!cancelled) setMemberNames([]); }
    })();
    return () => { cancelled = true; };
  }, [teamId, isFr]);

  const itemsTotalCents = (lineItems || []).reduce((sum, it) => sum + it.total_cents, 0);
  const totalCents = lineItems && lineItems.length ? itemsTotalCents : (ev.job?.total_cents || 0);
  const fmtTime = (d: Date) => {
    const h = d.getHours(); const m = d.getMinutes();
    if (isFr) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
  };
  const fmtDate = (d: Date) => cap(format(d, isFr ? 'EEE d MMM yyyy' : 'EEE, MMM d, yyyy', { locale }));
  const [busy, setBusy] = useState(false);
  const isCancelled = (ev.status || '').toLowerCase() === 'cancelled';
  // « Dernière visite complétée » : fermer le job / nouvelle visite / laisser.
  const [finalPromptOpen, setFinalPromptOpen] = useState(false);
  const [finalBusy, setFinalBusy] = useState(false);
  const [addVisitOpen, setAddVisitOpen] = useState(false);

  const toggleCompleted = async () => {
    if (busy) return;
    const next = !completed;
    setBusy(true);
    try {
      const { error } = await supabase
        .from('schedule_events')
        .update({ status: next ? 'completed' : 'scheduled', updated_at: new Date().toISOString() })
        .eq('id', ev.id);
      if (error) throw error;
      setCompleted(next);
      invalidateScheduleCache();
      toast.success(next
        ? (isFr ? 'Visite complétée.' : 'Visit completed.')
        : (isFr ? 'Visite remise à faire.' : 'Visit set back to scheduled.'));
      if (next && ev.job_id) {
        // Facturation par visite : billing_mode/auto_charge lus sur la table
        // jobs (colonnes absentes tant que la migration 20260802200000 n'est
        // pas appliquée → on saute sans bruit).
        try {
          const { data: billingRow } = await supabase
            .from('jobs')
            .select('*')
            .eq('id', ev.job_id)
            .maybeSingle();
          if ((billingRow as any)?.billing_mode === 'per_visit') {
            const sendNow = Boolean((billingRow as any)?.auto_charge);
            const result = await createInvoiceForVisit({ jobId: ev.job_id, visitId: ev.id, sendNow });
            if (!result.already_exists) {
              toast.success(sendNow
                ? (isFr ? 'Facture de la visite créée et envoyée au client.' : 'Visit invoice created and sent to the client.')
                : (isFr ? 'Facture de la visite créée (brouillon).' : 'Visit invoice created (draft).'));
            }
          }
        } catch (err: any) {
          console.error('[schedule] per-visit invoice failed', err);
          toast.error(err?.message || (isFr ? 'La facture de la visite n’a pas pu être créée.' : 'The visit invoice could not be created.'));
        }
        // Dernière visite active du job ? → proposer la suite.
        try {
          const { data: others } = await supabase
            .from('schedule_events')
            .select('id,status')
            .eq('job_id', ev.job_id)
            .is('deleted_at', null)
            .neq('id', ev.id);
          const allDone = (others || []).every((o: any) =>
            ['completed', 'cancelled'].includes(String(o.status || '').toLowerCase()));
          if (allDone) setFinalPromptOpen(true);
        } catch { /* best-effort */ }
      }
      onStatusChanged?.();
    } catch (err: any) {
      toast.error(err?.message || (isFr ? 'Impossible de mettre à jour la visite.' : 'Could not update the visit.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[2px]" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl border border-border bg-surface p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
              <h2 className="truncate text-[15px] font-bold text-text-primary">
                {clientName}{jobTitle ? ` – ${jobTitle}` : ''}
              </h2>
              {completed && (
                <span className="text-[10px] font-bold uppercase tracking-wide text-success bg-success/10 border border-success/30 rounded-full px-2 py-0.5 shrink-0">
                  {isFr ? 'Complétée' : 'Completed'}
                </span>
              )}
            </div>
            <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">
              {isFr ? 'Visite' : 'Visit'}
            </p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-text-secondary hover:bg-surface-tertiary">
            <XIcon size={16} />
          </button>
        </div>

        <div className="rounded-xl bg-surface-secondary p-3">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-text-tertiary">
            {isFr ? 'Détails' : 'Details'}
          </p>
          <div className="space-y-2.5">
            <div className="flex items-start justify-between gap-3">
              <span className="shrink-0 text-[12px] text-text-tertiary">Client</span>
              <span className="min-w-0 truncate text-right text-[12px] font-semibold text-text-primary">{clientName}</span>
            </div>
            <div className="flex items-start justify-between gap-3">
              <span className="shrink-0 text-[12px] text-text-tertiary">Job</span>
              <span className="text-right text-[12px] font-semibold text-text-primary">{jobNumber || '—'}</span>
            </div>
            <div className="flex items-start justify-between gap-3">
              <span className="shrink-0 text-[12px] text-text-tertiary">{isFr ? 'Équipe' : 'Team'}</span>
              <span className="min-w-0 text-right">
                {teams.length > 0 ? (
                  <span
                    className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-semibold"
                    style={{ backgroundColor: toRgba(teamColor, 0.12) }}
                  >
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: teamColor }} />
                    <select
                      value={teamId ?? ''}
                      disabled={teamBusy}
                      onChange={(e) => void changeTeam(e.target.value || null)}
                      className="max-w-[180px] cursor-pointer truncate border-0 p-0 text-[11px] font-semibold outline-none disabled:opacity-50"
                      style={{ color: teamColor, background: 'transparent' }}
                      title={isFr ? "Changer l'équipe de cette visite seulement" : 'Change the team for this visit only'}
                    >
                      <option value="">{t.schedule.unassigned}</option>
                      {teams.map((tm) => <option key={tm.id} value={tm.id}>{tm.name}</option>)}
                    </select>
                  </span>
                ) : (
                  <span
                    className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-semibold"
                    style={{ backgroundColor: toRgba(teamColor, 0.12), color: teamColor }}
                  >
                    <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: teamColor }} />
                    {displayTeamName || t.schedule.unassigned}
                  </span>
                )}
                {memberNames && memberNames.length > 0 && (
                  <span className="mt-0.5 block text-[11px] leading-snug text-text-secondary">
                    {memberNames.length} {isFr ? (memberNames.length > 1 ? 'membres' : 'membre') : (memberNames.length > 1 ? 'members' : 'member')} · {memberNames.join(', ')}
                  </span>
                )}
              </span>
            </div>
            {address && (
              <div className="flex items-start justify-between gap-3">
                <span className="shrink-0 text-[12px] text-text-tertiary">{isFr ? 'Emplacement' : 'Location'}</span>
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="min-w-0 text-right text-[12px] font-medium text-text-primary underline-offset-2 hover:underline"
                >
                  {address}
                </a>
              </div>
            )}
            <div className="flex items-start justify-between gap-3">
              <span className="shrink-0 text-[12px] text-text-tertiary">{isFr ? 'Début' : 'Start'}</span>
              <span className="text-right text-[12px] font-semibold text-text-primary">
                {fmtDate(s)}
                <span className="block text-[11px] font-medium text-text-secondary">{anytime ? anytimeLabel(isFr) : fmtTime(s)}</span>
              </span>
            </div>
            <div className="flex items-start justify-between gap-3">
              <span className="shrink-0 text-[12px] text-text-tertiary">{isFr ? 'Fin' : 'End'}</span>
              <span className="text-right text-[12px] font-semibold text-text-primary">
                {fmtDate(end)}
                <span className="block text-[11px] font-medium text-text-secondary">{anytime ? anytimeLabel(isFr) : fmtTime(end)}</span>
              </span>
            </div>
          </div>
          {ev.notes && <p className="mt-2.5 border-t border-border pt-2 text-[11px] leading-relaxed text-text-tertiary">{ev.notes}</p>}
        </div>

        {(lineItems === null || lineItems.length > 0 || totalCents > 0) && (
          <div className="mt-2.5 rounded-xl bg-surface-secondary p-3">
            <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-text-tertiary">
              {isFr ? 'Produits et services' : 'Line items'}
            </p>
            {lineItems === null ? (
              <p className="text-[11px] text-text-tertiary">{isFr ? 'Chargement…' : 'Loading…'}</p>
            ) : (
              <div className="space-y-1.5">
                {lineItems.map((it) => (
                  <div key={it.id} className="flex items-start justify-between gap-3">
                    <span className="min-w-0 text-[12px] text-text-primary">
                      <span className="font-semibold tabular-nums">{it.qty}×</span> {it.name}
                    </span>
                    <span className="shrink-0 text-[12px] font-medium tabular-nums text-text-primary">
                      {formatCurrency(it.total_cents / 100)}
                    </span>
                  </div>
                ))}
                <div className="flex items-center justify-between gap-3 border-t border-border pt-1.5">
                  <span className="text-[12px] font-bold text-text-primary">Total</span>
                  <span className="text-[12px] font-bold tabular-nums text-text-primary">{formatCurrency(totalCents / 100)}</span>
                </div>
              </div>
            )}
          </div>
        )}
        <div className="mt-4 space-y-2">
          {!isCancelled && (
            <button
              onClick={() => void toggleCompleted()}
              disabled={busy}
              className={completed
                ? 'w-full rounded-lg border border-outline-subtle bg-surface-secondary px-3.5 py-2 text-[13px] font-semibold text-text-secondary transition-colors hover:text-text-primary disabled:opacity-50'
                : 'w-full rounded-lg bg-success px-3.5 py-2 text-[13px] font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50 inline-flex items-center justify-center gap-2'}
            >
              {!completed && <CheckCircle2 size={15} />}
              {busy
                ? (isFr ? 'Mise à jour…' : 'Updating…')
                : completed
                  ? (isFr ? 'Remettre à faire' : 'Set back to scheduled')
                  : (isFr ? 'Marquer la visite terminée' : 'Mark visit complete')}
            </button>
          )}
          <button
            onClick={onView}
            className="w-full rounded-lg bg-text-primary px-3.5 py-2 text-[13px] font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
          >
            {isFr ? 'Voir le job' : 'View Job'}
          </button>
        </div>
      </div>
    </div>

      <FinalVisitDialog
        open={finalPromptOpen}
        fr={isFr}
        busy={finalBusy}
        onCloseJob={() => {
          void (async () => {
            if (finalBusy) return;
            setFinalBusy(true);
            try {
              await updateJob(ev.job_id, { status: 'completed' });
              toast.success(isFr ? 'Job fermé.' : 'Job closed.');
              invalidateScheduleCache();
              setFinalPromptOpen(false);
              onStatusChanged?.();
            } catch (err: any) {
              toast.error(err?.message || (isFr ? 'Impossible de fermer le job.' : 'Could not close the job.'));
            } finally {
              setFinalBusy(false);
            }
          })();
        }}
        onScheduleNewVisit={() => {
          setFinalPromptOpen(false);
          setAddVisitOpen(true);
        }}
        onLeave={() => setFinalPromptOpen(false)}
      />

      <AddVisitModal
        open={addVisitOpen}
        onClose={() => setAddVisitOpen(false)}
        onAdded={() => {
          invalidateScheduleCache();
          onStatusChanged?.();
        }}
        job={{ id: ev.job_id, label: clientName }}
      />
    </>
  );
}
