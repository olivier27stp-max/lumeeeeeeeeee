import React, { useEffect, useState } from 'react';
import { RefreshCw, Pause, Play, Trash2, Calendar, Clock, ArrowRight } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { supabase } from '../lib/supabase';
import { useTranslation } from '../i18n';
import { PageHeader } from '../components/ui';
import type { RecurrenceRule, RecurrenceFrequency } from '../lib/recurringJobsApi';
import { deactivateRecurrenceRule } from '../lib/recurringJobsApi';

interface RuleWithJob extends RecurrenceRule {
  job_title?: string;
  client_name?: string;
}

const FREQ_LABELS: Record<RecurrenceFrequency, { en: string; fr: string }> = {
  daily:    { en: 'Daily',     fr: 'Quotidien' },
  weekly:   { en: 'Weekly',    fr: 'Hebdomadaire' },
  biweekly: { en: 'Biweekly',  fr: 'Bi-hebdomadaire' },
  monthly:  { en: 'Monthly',   fr: 'Mensuel' },
  custom:   { en: 'Custom',    fr: 'Personnalisé' },
};

const FREQ_COLORS: Record<RecurrenceFrequency, string> = {
  daily:    'bg-surface-secondary text-text-secondary',
  weekly:   'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  biweekly: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  monthly:  'bg-surface-secondary text-text-secondary',
  custom:   'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400',
};

export default function RecurringJobs() {
  const { t, language } = useTranslation();
  const fr = language === 'fr';
  const [rules, setRules] = useState<RuleWithJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'active' | 'paused'>('all');

  async function fetchRules() {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('job_recurrence_rules')
        .select('*, jobs(title, client_name)')
        .order('next_run_at', { ascending: true });

      if (error) throw error;

      const mapped: RuleWithJob[] = (data || []).map((r: any) => ({
        ...r,
        job_title: r.jobs?.title || 'Untitled Job',
        client_name: r.jobs?.client_name || null,
      }));
      setRules(mapped);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to load recurring jobs');
    }
    setLoading(false);
  }

  useEffect(() => { fetchRules(); }, []);

  const handleToggle = async (rule: RuleWithJob) => {
    try {
      const newActive = !rule.is_active;
      const { error } = await supabase
        .from('job_recurrence_rules')
        .update({ is_active: newActive, updated_at: new Date().toISOString() })
        .eq('id', rule.id);
      if (error) throw error;
      setRules((prev) => prev.map((r) => r.id === rule.id ? { ...r, is_active: newActive } : r));
      toast.success(newActive ? (fr ? 'Règle activée' : 'Rule activated') : (fr ? 'Règle pausée' : 'Rule paused'));
    } catch (err: any) {
      toast.error(err?.message || 'Failed to update rule');
    }
  };

  const handleDelete = async (rule: RuleWithJob) => {
    if (!confirm(fr ? `Supprimer la récurrence pour "${rule.job_title}" ?` : `Delete recurrence for "${rule.job_title}"?`)) return;
    try {
      await deactivateRecurrenceRule(rule.id);
      setRules((prev) => prev.filter((r) => r.id !== rule.id));
      toast.success(fr ? 'Récurrence supprimée' : 'Recurrence deleted');
    } catch (err: any) {
      toast.error(err?.message || 'Failed to delete');
    }
  };

  const filtered = rules.filter((r) => {
    if (filter === 'active') return r.is_active;
    if (filter === 'paused') return !r.is_active;
    return true;
  });

  const activeCount = rules.filter((r) => r.is_active).length;
  const pausedCount = rules.filter((r) => !r.is_active).length;

  const formatDate = (d: string | null) => {
    if (!d) return '—';
    return new Date(d).toLocaleDateString(fr ? 'fr-CA' : 'en-CA', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const timeUntil = (d: string | null) => {
    if (!d) return fr ? 'Pas planifié' : 'Not scheduled';
    const diff = new Date(d).getTime() - Date.now();
    if (diff < 0) return fr ? 'En retard' : 'Overdue';
    const hours = Math.floor(diff / 3600000);
    if (hours < 1) return fr ? 'Bientôt' : 'Soon';
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    return `${days}${fr ? 'j' : 'd'}`;
  };

  return (
    <div className="space-y-8">
      <PageHeader
        title={fr ? 'Jobs récurrents' : 'Recurring Jobs'}
        subtitle={`${activeCount} ${fr ? 'actifs' : 'active'} · ${pausedCount} ${fr ? 'en pause' : 'paused'}`}
        icon={RefreshCw}
        iconColor="blue"
      />

      {/* Filter pills */}
      <div className="flex items-center gap-2">
        {(['all', 'active', 'paused'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              filter === f
                ? 'bg-primary text-white'
                : 'bg-surface-secondary text-text-secondary hover:bg-surface-secondary/80'
            }`}
          >
            {f === 'all' ? (fr ? 'Tous' : 'All') : f === 'active' ? (fr ? 'Actifs' : 'Active') : (fr ? 'En pause' : 'Paused')}
            <span className="ml-1 opacity-60">
              {f === 'all' ? rules.length : f === 'active' ? activeCount : pausedCount}
            </span>
          </button>
        ))}
      </div>

      {/* List */}
      {loading ? (
        <div className="section-card p-8 text-center text-text-tertiary text-sm">
          {fr ? 'Chargement...' : 'Loading...'}
        </div>
      ) : filtered.length === 0 ? (
        <div className="section-card p-12 text-center">
          <RefreshCw size={32} className="mx-auto text-text-tertiary opacity-30 mb-3" />
          <p className="text-sm text-text-tertiary">
            {fr ? 'Aucun job récurrent trouvé' : 'No recurring jobs found'}
          </p>
          <p className="text-xs text-text-tertiary mt-1">
            {fr ? 'Ajoutez une récurrence depuis la page d\'un job' : 'Add recurrence from a job\'s detail page'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <AnimatePresence>
            {filtered.map((rule) => (
              <motion.div
                key={rule.id}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className={`section-card p-4 ${!rule.is_active ? 'opacity-50' : ''}`}
              >
                <div className="flex items-center gap-4">
                  {/* Icon */}
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                    rule.is_active ? 'bg-surface-secondary' : 'bg-surface-secondary'
                  }`}>
                    <RefreshCw size={18} className={rule.is_active ? 'text-text-primary' : 'text-text-tertiary'} />
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-text-primary truncate">{rule.job_title}</p>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${FREQ_COLORS[rule.frequency]}`}>
                        {FREQ_LABELS[rule.frequency]?.[fr ? 'fr' : 'en'] || rule.frequency}
                      </span>
                      {!rule.is_active && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-400">
                          {fr ? 'Pausé' : 'Paused'}
                        </span>
                      )}
                    </div>
                    {rule.client_name && (
                      <p className="text-xs text-text-tertiary mt-0.5">{rule.client_name}</p>
                    )}
                    <div className="flex items-center gap-3 mt-1.5 text-[11px] text-text-tertiary">
                      <span className="flex items-center gap-1">
                        <Calendar size={11} />
                        {formatDate(rule.start_date)}
                        {rule.end_date && (
                          <>
                            <ArrowRight size={9} />
                            {formatDate(rule.end_date)}
                          </>
                        )}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock size={11} />
                        {fr ? 'Prochain' : 'Next'}: {timeUntil(rule.next_run_at)}
                      </span>
                      <span>{rule.occurrences_created} {fr ? 'créés' : 'created'}</span>
                      {rule.max_occurrences && (
                        <span>/ {rule.max_occurrences} max</span>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => handleToggle(rule)}
                      className="p-2 rounded-lg hover:bg-surface-secondary text-text-tertiary transition-colors"
                      title={rule.is_active ? (fr ? 'Pauser' : 'Pause') : (fr ? 'Activer' : 'Activate')}
                    >
                      {rule.is_active ? <Pause size={15} /> : <Play size={15} />}
                    </button>
                    <button
                      onClick={() => handleDelete(rule)}
                      className="p-2 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-900/20 text-text-tertiary hover:text-rose-500 transition-colors"
                      title={fr ? 'Supprimer' : 'Delete'}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
