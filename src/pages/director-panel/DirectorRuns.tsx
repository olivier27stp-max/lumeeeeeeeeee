import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Play, ChevronDown, ChevronRight, AlertTriangle, Clock, Coins, Layers, RefreshCw, ExternalLink, Image as ImageIcon } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useTranslation } from '../../i18n';
import { PageHeader } from '../../components/ui';
import { supabase } from '../../lib/supabase';
import type { DirectorRun, DirectorRunStep } from '../../types/director';

// ─── Helpers ────────────────────────────────────────────────────────────────

const isSafeUrl = (url: string) => url.startsWith('https://') || url.startsWith('http://') || url.startsWith('/');

function isTableMissing(error: any): boolean {
  if (!error) return false;
  const msg = (error.message || error.code || '').toLowerCase();
  return (
    (msg.includes('relation') && msg.includes('does not exist')) ||
    msg.includes('42p01') ||
    (msg.includes('pgrst') && msg.includes('not found'))
  );
}

type RunWithFlow = DirectorRun & { director_flows?: { title: string } | null };

function formatDuration(startedAt?: string, finishedAt?: string): string {
  if (!startedAt) return '-';
  const start = new Date(startedAt).getTime();
  const end = finishedAt ? new Date(finishedAt).getTime() : Date.now();
  const ms = end - start;

  if (ms < 1000) return `${ms}ms`;
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  if (mins < 60) return `${mins}m ${remSecs}s`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hrs}h ${remMins}m`;
}

function formatDate(iso: string): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const statusDot: Record<string, string> = {
  completed: 'bg-success',
  running: 'bg-primary animate-pulse',
  failed: 'bg-danger',
  pending: 'bg-warning',
  cancelled: 'bg-text-tertiary',
};

const statusText: Record<string, string> = {
  completed: 'text-success',
  running: 'text-primary',
  failed: 'text-danger',
  pending: 'text-text-tertiary',
  cancelled: 'text-text-tertiary',
};

// ─── Steps Row ──────────────────────────────────────────────────────────────

function RunSteps({ runId }: { runId: string }) {
  const { t } = useTranslation();
  const [steps, setSteps] = useState<DirectorRunStep[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from('director_run_steps')
      .select('*')
      .eq('run_id', runId)
      .order('started_at', { ascending: true })
      .then(({ data, error }) => {
        if (error) {
          console.error('[RunSteps] error:', error);
          setSteps([]);
        } else {
          setSteps(data || []);
        }
        setLoading(false);
      });
  }, [runId]);

  if (loading) {
    return (
      <div className="px-6 py-3 space-y-2">
        {[1, 2].map((i) => (
          <div key={i} className="h-8 rounded-lg bg-surface-secondary animate-pulse" />
        ))}
      </div>
    );
  }

  if (steps.length === 0) {
    return (
      <div className="px-6 py-3 text-[12px] text-text-tertiary">{t.directorPanel.noStepsRecorded}</div>
    );
  }

  return (
    <div className="px-6 py-3">
      <table className="w-full text-[12px]">
        <thead>
          <tr className="text-text-tertiary text-left">
            <th className="pb-1.5 font-medium">{t.directorPanel.status}</th>
            <th className="pb-1.5 font-medium">{t.directorPanel.provider}</th>
            <th className="pb-1.5 font-medium">{t.directorPanel.model}</th>
            <th className="pb-1.5 font-medium text-right">{t.directorPanel.duration}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-outline/50">
          {steps.map((step) => (
            <tr key={step.id} className="text-text-secondary">
              <td className="py-1.5">
                <div className="flex items-center gap-1.5">
                  <span
                    className={cn(
                      'w-1.5 h-1.5 rounded-full',
                      statusDot[step.status] || 'bg-text-tertiary'
                    )}
                  />
                  <span
                    className={cn(
                      'capitalize text-[11px] font-medium',
                      statusText[step.status] || 'text-text-tertiary'
                    )}
                  >
                    {step.status}
                  </span>
                </div>
              </td>
              <td className="py-1.5">
                {step.provider ? (
                  <span className="px-1.5 py-0.5 rounded bg-surface-secondary text-text-secondary font-medium text-[11px]">
                    {step.provider}
                  </span>
                ) : (
                  <span className="text-text-tertiary">-</span>
                )}
              </td>
              <td className="py-1.5 text-text-tertiary truncate max-w-[200px]">
                {step.model || '-'}
              </td>
              <td className="py-1.5 text-right text-text-tertiary">
                {formatDuration(step.started_at, step.finished_at)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Show error for any failed step */}
      {steps
        .filter((s) => s.status === 'failed' && s.error_json)
        .map((s) => (
          <div
            key={`err-${s.id}`}
            className="mt-2 flex items-start gap-2 rounded-lg bg-danger/10 border border-danger/20 px-3 py-2 text-[11px] text-danger"
          >
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span className="break-all">
              {(s.error_json as any)?.message || JSON.stringify(s.error_json)}
            </span>
          </div>
        ))}

      {/* Output thumbnails from completed steps */}
      {(() => {
        const outputs = steps
          .filter((s) => s.status === 'completed' && s.output_json)
          .flatMap((s) => {
            const out = s.output_json as any;
            const urls: string[] = [];
            if (out?.url) urls.push(out.url);
            if (out?.image_url) urls.push(out.image_url);
            if (out?.video_url) urls.push(out.video_url);
            if (Array.isArray(out?.images)) urls.push(...out.images.filter((u: any) => typeof u === 'string'));
            if (Array.isArray(out?.urls)) urls.push(...out.urls.filter((u: any) => typeof u === 'string'));
            return urls;
          });
        if (outputs.length === 0) return null;
        return (
          <div className="mt-3">
            <p className="text-[11px] font-medium text-text-tertiary mb-1.5 flex items-center gap-1">
              <ImageIcon className="w-3 h-3" /> {t.directorPanel.outputs}
            </p>
            <div className="flex gap-2 flex-wrap">
              {outputs.map((url, i) =>
                isSafeUrl(url) ? (
                  <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="block w-16 h-16 rounded-md overflow-hidden border border-outline hover:border-primary transition-colors">
                    <img src={url} alt={`Output ${i + 1}`} className="w-full h-full object-cover" loading="lazy" />
                  </a>
                ) : (
                  <span key={i} className="block w-16 h-16 rounded-md overflow-hidden border border-outline text-[9px] text-text-tertiary flex items-center justify-center">
                    {t.directorPanel.invalidUrl}
                  </span>
                )
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export default function DirectorRuns({ orgId }: { orgId: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [runs, setRuns] = useState<RunWithFlow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [stepCounts, setStepCounts] = useState<Record<string, number>>({});

  const fetchRuns = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('director_runs')
        .select('*, director_flows(title)')
        .eq('org_id', orgId)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) {
        if (isTableMissing(error)) {
          setRuns([]);
          return;
        }
        throw error;
      }

      const fetchedRuns = (data || []) as RunWithFlow[];
      setRuns(fetchedRuns);

      // Fetch step counts in bulk for all runs
      if (fetchedRuns.length > 0) {
        const runIds = fetchedRuns.map((r) => r.id);
        const { data: stepsData } = await supabase
          .from('director_run_steps')
          .select('run_id')
          .in('run_id', runIds);

        if (stepsData) {
          const counts: Record<string, number> = {};
          for (const s of stepsData) {
            counts[s.run_id] = (counts[s.run_id] || 0) + 1;
          }
          setStepCounts(counts);
        }
      }
    } catch (err) {
      console.error('[DirectorRuns] fetch error:', err);
      setRuns([]);
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    fetchRuns();
  }, [fetchRuns]);

  // Realtime subscription for live run updates
  useEffect(() => {
    if (!orgId) return;
    const channel = supabase
      .channel('director-runs-realtime')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'director_runs',
        filter: `org_id=eq.${orgId}`,
      }, (payload) => {
        if (payload.eventType === 'INSERT') {
          setRuns((prev) => [payload.new as RunWithFlow, ...prev]);
        } else if (payload.eventType === 'UPDATE') {
          setRuns((prev) => prev.map((r) => r.id === (payload.new as any).id ? { ...r, ...payload.new } : r));
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [orgId]);

  const toggleExpand = (runId: string) => {
    setExpandedRunId((prev) => (prev === runId ? null : runId));
  };

  return (
    <div className="space-y-6">
      <PageHeader title={t.directorPanel.runHistoryTitle} subtitle={t.directorPanel.runHistorySubtitle} icon={Play} iconColor="amber">
        <button
          onClick={fetchRuns}
          disabled={loading}
          className="glass-button flex items-center gap-1.5 px-3 py-1.5 text-[12px]"
        >
          <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
          {t.directorPanel.refresh}
        </button>
      </PageHeader>

      {/* Loading skeleton */}
      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-14 rounded-lg bg-surface-secondary animate-pulse border border-outline"
            />
          ))}
        </div>
      ) : runs.length === 0 ? (
        /* Empty state */
        <div className="section-card flex flex-col items-center justify-center py-16">
          <Play className="w-10 h-10 text-text-tertiary mb-3" />
          <p className="text-[13px] font-medium text-text-secondary">{t.directorPanel.noRunsYet}</p>
          <p className="text-[12px] text-text-tertiary mt-1">
            {t.directorPanel.executeFlowHint}
          </p>
        </div>
      ) : (
        /* Runs list */
        <div className="section-card divide-y divide-outline overflow-hidden">
          {runs.map((run) => {
            const isExpanded = expandedRunId === run.id;
            const flowTitle = run.director_flows?.title || run.flow_id;
            const credits = run.cost_actual_credits > 0 ? run.cost_actual_credits : null;
            const steps = stepCounts[run.id] || 0;

            return (
              <div key={run.id}>
                {/* Run row */}
                <button
                  onClick={() => toggleExpand(run.id)}
                  className={cn(
                    'w-full flex items-center gap-4 px-4 py-3 text-left hover:bg-surface-secondary/50 transition-colors',
                    isExpanded && 'bg-surface-secondary/30'
                  )}
                >
                  {/* Expand icon */}
                  {isExpanded ? (
                    <ChevronDown className="w-4 h-4 text-text-tertiary shrink-0" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-text-tertiary shrink-0" />
                  )}

                  {/* Status dot */}
                  <span
                    className={cn(
                      'w-2 h-2 rounded-full shrink-0',
                      statusDot[run.status] || 'bg-text-tertiary'
                    )}
                  />

                  {/* Flow title */}
                  <span className="text-[13px] text-text-primary font-medium flex-1 truncate">
                    {flowTitle}
                  </span>

                  {/* Status label */}
                  <span
                    className={cn(
                      'text-[12px] font-medium capitalize shrink-0',
                      statusText[run.status] || 'text-text-tertiary'
                    )}
                  >
                    {run.status}
                  </span>

                  {/* Steps count */}
                  <span
                    className="flex items-center gap-1 text-[11px] text-text-tertiary shrink-0 w-14 justify-end"
                    title="Steps"
                  >
                    <Layers className="w-3 h-3" />
                    {steps}
                  </span>

                  {/* Duration */}
                  <span
                    className="flex items-center gap-1 text-[11px] text-text-tertiary shrink-0 w-16 justify-end"
                    title="Duration"
                  >
                    <Clock className="w-3 h-3" />
                    {formatDuration(run.started_at, run.finished_at)}
                  </span>

                  {/* Credits */}
                  <span
                    className="flex items-center gap-1 text-[11px] text-text-tertiary shrink-0 w-16 justify-end"
                    title="Credits used"
                  >
                    <Coins className="w-3 h-3" />
                    {credits ? `${credits} cr` : '-'}
                  </span>

                  {/* Date */}
                  <span className="text-[11px] text-text-tertiary shrink-0 w-28 text-right">
                    {formatDate(run.created_at)}
                  </span>

                  {/* View Flow link */}
                  <span
                    role="button"
                    onClick={(e) => { e.stopPropagation(); navigate(`/director-panel/flows/${run.flow_id}`); }}
                    className="shrink-0 p-1.5 rounded-md text-text-tertiary hover:text-primary hover:bg-surface-secondary transition-colors"
                    title="View Flow"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </span>
                </button>

                {/* Error display for failed runs */}
                {run.status === 'failed' && run.error_json && !isExpanded && (
                  <div className="mx-4 mb-3 flex items-start gap-2 rounded-lg bg-danger/10 border border-danger/20 px-3 py-2 text-[11px] text-danger">
                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    <span className="break-all">
                      {(run.error_json as any)?.message || JSON.stringify(run.error_json)}
                    </span>
                  </div>
                )}

                {/* Expanded steps */}
                {isExpanded && (
                  <div className="bg-surface-secondary/20 border-t border-outline/50">
                    {run.status === 'failed' && run.error_json && (
                      <div className="mx-6 mt-3 flex items-start gap-2 rounded-lg bg-danger/10 border border-danger/20 px-3 py-2 text-[11px] text-danger">
                        <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                        <span className="break-all">
                          {(run.error_json as any)?.message || JSON.stringify(run.error_json)}
                        </span>
                      </div>
                    )}
                    <RunSteps runId={run.id} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
