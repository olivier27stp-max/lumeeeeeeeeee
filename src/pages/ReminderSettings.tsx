import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, Loader2, Bell, Save } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from '../i18n';
import {
  fetchReminderSettings,
  updateReminderSettings,
  fetchReminderLog,
  type ReminderSettings,
  type ScheduleEntry,
  type ReminderChannel,
  type ReminderLogEntry,
} from '../lib/remindersApi';

const CHANNELS: ReminderChannel[] = ['email', 'sms', 'both'];

export default function ReminderSettingsPage() {
  const { t, language } = useTranslation();
  const isFr = language === 'fr';
  const tr = (t as any).reminders || {};

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [schedule, setSchedule] = useState<ScheduleEntry[]>([]);
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [smsBody, setSmsBody] = useState('');
  const [logEntries, setLogEntries] = useState<ReminderLogEntry[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [settings, log] = await Promise.all([
        fetchReminderSettings(),
        fetchReminderLog(20).catch(() => []),
      ]);
      hydrate(settings);
      setLogEntries(log);
    } catch (err: any) {
      toast.error(err?.message || (isFr ? 'Erreur de chargement' : 'Failed to load'));
    } finally {
      setLoading(false);
    }
  }, [isFr]);

  function hydrate(s: ReminderSettings) {
    setEnabled(!!s.enabled);
    setSchedule(Array.isArray(s.schedule) ? s.schedule : []);
    setEmailSubject(s.custom_email_subject || '');
    setEmailBody(s.custom_email_body || '');
    setSmsBody(s.custom_sms_body || '');
  }

  useEffect(() => { load(); }, [load]);

  const channelLabel = (c: ReminderChannel) => {
    if (c === 'email') return tr.channelEmail || 'Email';
    if (c === 'sms') return tr.channelSms || 'SMS';
    return tr.channelBoth || (isFr ? 'Les deux' : 'Both');
  };

  const addScheduleRow = () => {
    setSchedule((s) => [...s, { days_after_due: 1, channel: 'email' }]);
  };
  const removeScheduleRow = (idx: number) => {
    setSchedule((s) => s.filter((_, i) => i !== idx));
  };
  const updateScheduleRow = (idx: number, patch: Partial<ScheduleEntry>) => {
    setSchedule((s) => s.map((row, i) => (i === idx ? { ...row, ...patch } : row)));
  };

  const handleSave = async () => {
    // Sort schedule by days_after_due ascending before saving
    const sorted = [...schedule].sort((a, b) => a.days_after_due - b.days_after_due);
    setSaving(true);
    try {
      const updated = await updateReminderSettings({
        enabled,
        schedule: sorted,
        custom_email_subject: emailSubject.trim() || null,
        custom_email_body: emailBody.trim() || null,
        custom_sms_body: smsBody.trim() || null,
      });
      hydrate(updated);
      toast.success(tr.saved || (isFr ? 'Enregistré' : 'Saved'));
    } catch (err: any) {
      toast.error(err?.message || (isFr ? 'Échec de la sauvegarde' : 'Save failed'));
    } finally {
      setSaving(false);
    }
  };

  const smsCount = smsBody.length;
  const smsOver = smsCount > 160;

  const placeholders = useMemo(
    () =>
      isFr
        ? '{client_name}, {company_name}, {invoice_number}, {amount_due}, {due_date}, {pay_url}'
        : '{client_name}, {company_name}, {invoice_number}, {amount_due}, {due_date}, {pay_url}',
    [isFr],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="animate-spin text-text-secondary" size={20} />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <Bell size={20} className="text-text-secondary" />
          <h1 className="text-xl font-bold text-text-primary">
            {tr.title || (isFr ? 'Rappels de paiement' : 'Payment Reminders')}
          </h1>
        </div>
      </div>
      <p className="text-sm text-text-secondary">
        {tr.description ||
          (isFr
            ? 'Envoyez automatiquement des rappels par courriel et SMS lorsqu’une facture est en retard.'
            : 'Automatically send email and SMS reminders when an invoice goes overdue.')}
      </p>

      {/* Enabled toggle */}
      <div className="rounded-2xl border border-border bg-surface-primary p-4 flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-text-primary">
            {tr.enabled || (isFr ? 'Activer les rappels' : 'Enable reminders')}
          </div>
          <div className="text-xs text-text-secondary mt-1">
            {tr.enabledHelp ||
              (isFr
                ? 'Désactivez pour interrompre tous les rappels automatiques.'
                : 'Turn off to pause all automatic reminders.')}
          </div>
        </div>
        <label className="relative inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            className="sr-only peer"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          <div className="w-11 h-6 bg-surface-secondary rounded-full peer peer-checked:bg-accent transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-5" />
        </label>
      </div>

      {/* Schedule */}
      <div className="rounded-2xl border border-border bg-surface-primary p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-text-primary">
              {tr.schedule || (isFr ? 'Calendrier' : 'Schedule')}
            </div>
            <div className="text-xs text-text-secondary mt-1">
              {tr.scheduleHelp ||
                (isFr ? 'Définissez quand chaque rappel est envoyé.' : 'Define when each reminder fires.')}
            </div>
          </div>
          <button
            type="button"
            onClick={addScheduleRow}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-surface-secondary hover:bg-surface-secondary/80 text-text-primary"
          >
            <Plus size={14} />
            {tr.addRow || (isFr ? 'Ajouter' : 'Add')}
          </button>
        </div>

        {schedule.length === 0 ? (
          <div className="text-xs text-text-secondary py-4 text-center">
            {tr.empty || (isFr ? 'Aucun rappel programmé.' : 'No reminders scheduled.')}
          </div>
        ) : (
          <div className="space-y-2">
            {schedule.map((row, idx) => (
              <div key={idx} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center">
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    max={365}
                    value={row.days_after_due}
                    onChange={(e) =>
                      updateScheduleRow(idx, { days_after_due: Math.max(0, Math.min(365, Number(e.target.value) || 0)) })
                    }
                    className="w-20 px-2 py-1.5 rounded-lg border border-border bg-surface-primary text-sm text-text-primary"
                  />
                  <span className="text-xs text-text-secondary">
                    {tr.daysAfterDue || (isFr ? 'jours après échéance' : 'days after due')}
                  </span>
                </div>
                <select
                  value={row.channel}
                  onChange={(e) => updateScheduleRow(idx, { channel: e.target.value as ReminderChannel })}
                  className="px-2 py-1.5 rounded-lg border border-border bg-surface-primary text-sm text-text-primary"
                >
                  {CHANNELS.map((c) => (
                    <option key={c} value={c}>{channelLabel(c)}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => removeScheduleRow(idx)}
                  className="p-1.5 rounded-lg hover:bg-surface-secondary text-text-secondary hover:text-red-500"
                  aria-label={tr.remove || 'Remove'}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Custom email template */}
      <div className="rounded-2xl border border-border bg-surface-primary p-4 space-y-3">
        <div>
          <div className="text-sm font-semibold text-text-primary">
            {tr.customEmail || (isFr ? 'Modèle de courriel personnalisé' : 'Custom email template')}
          </div>
          <div className="text-xs text-text-secondary mt-1">
            {tr.templateVars || (isFr ? 'Variables disponibles' : 'Available variables')}: <code className="text-[11px]">{placeholders}</code>
          </div>
        </div>
        <input
          type="text"
          value={emailSubject}
          onChange={(e) => setEmailSubject(e.target.value)}
          placeholder={tr.emailSubjectPlaceholder || 'Payment reminder — invoice {invoice_number}'}
          className="w-full px-3 py-2 rounded-lg border border-border bg-surface-primary text-sm text-text-primary"
          maxLength={500}
        />
        <textarea
          value={emailBody}
          onChange={(e) => setEmailBody(e.target.value)}
          placeholder={tr.emailBodyPlaceholder || 'Hello {client_name}, ...'}
          rows={6}
          className="w-full px-3 py-2 rounded-lg border border-border bg-surface-primary text-sm text-text-primary"
          maxLength={5000}
        />
      </div>

      {/* Custom SMS template */}
      <div className="rounded-2xl border border-border bg-surface-primary p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold text-text-primary">
            {tr.customSMS || (isFr ? 'Modèle SMS personnalisé' : 'Custom SMS template')}
          </div>
          <div className={`text-xs ${smsOver ? 'text-red-500' : 'text-text-secondary'}`}>
            {smsCount}/160
          </div>
        </div>
        <textarea
          value={smsBody}
          onChange={(e) => setSmsBody(e.target.value)}
          placeholder={tr.smsBodyPlaceholder || 'Reminder: invoice {invoice_number} ({amount_due}) was due {due_date}. Pay: {pay_url}'}
          rows={3}
          className="w-full px-3 py-2 rounded-lg border border-border bg-surface-primary text-sm text-text-primary"
          maxLength={320}
        />
      </div>

      {/* Save */}
      <div className="flex justify-end">
        <button
          type="button"
          disabled={saving}
          onClick={handleSave}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-accent text-white text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          {tr.save || (isFr ? 'Enregistrer' : 'Save')}
        </button>
      </div>

      {/* Recent log */}
      {logEntries.length > 0 && (
        <div className="rounded-2xl border border-border bg-surface-primary p-4">
          <div className="text-sm font-semibold text-text-primary mb-3">
            {tr.recentLog || (isFr ? 'Rappels récents' : 'Recent reminders')}
          </div>
          <div className="space-y-2">
            {logEntries.map((e) => (
              <div key={e.id} className="grid grid-cols-[auto_1fr_auto] gap-2 items-center text-xs">
                <span className={`px-2 py-0.5 rounded-full font-medium ${e.status === 'sent' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                  {e.status === 'sent' ? (tr.sent || (isFr ? 'envoyé' : 'sent')) : (tr.failed || (isFr ? 'échec' : 'failed'))}
                </span>
                <span className="text-text-secondary truncate">
                  {channelLabel(e.channel)} → {e.sent_to} (D+{e.days_after_due})
                </span>
                <span className="text-text-secondary">
                  {new Date(e.sent_at).toLocaleDateString(isFr ? 'fr-CA' : 'en-CA')}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
