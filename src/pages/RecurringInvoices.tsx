/**
 * Recurring Invoices — list + create/edit schedules that auto-generate invoices.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Play, Pause, Trash2, Edit2, X, Repeat, Calendar } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from '../i18n';
import { cn, formatDate } from '../lib/utils';
import { formatMoneyFromCents, searchActiveClients } from '../lib/invoicesApi';
import {
  listRecurringSchedules,
  createRecurringSchedule,
  updateRecurringSchedule,
  deleteRecurringSchedule,
  runRecurringScheduleNow,
  type RecurringInvoiceSchedule,
  type RecurringInvoiceItem,
  type RecurringFrequency,
} from '../lib/recurringInvoicesApi';

interface ClientOption { id: string; name: string }

function clientLabel(s: RecurringInvoiceSchedule): string {
  const c = s.clients;
  if (!c) return 'Unknown client';
  const fullName = `${c.first_name || ''} ${c.last_name || ''}`.trim();
  return fullName || c.company || c.email || 'Unknown client';
}

export default function RecurringInvoices({ initialClientId }: { initialClientId?: string }) {
  const { t, language } = useTranslation();
  const tr = (t as any).recurringInvoices || {};

  const [schedules, setSchedules] = useState<RecurringInvoiceSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<RecurringInvoiceSchedule | null>(null);

  const reload = async () => {
    try {
      setLoading(true);
      const rows = await listRecurringSchedules({ clientId: initialClientId });
      setSchedules(rows);
    } catch (err: any) {
      toast.error(err.message || 'Failed to load schedules');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [initialClientId]);

  const handleToggleActive = async (s: RecurringInvoiceSchedule) => {
    try {
      await updateRecurringSchedule(s.id, { is_active: !s.is_active });
      toast.success(s.is_active ? (tr.paused || 'Paused') : (tr.resumed || 'Resumed'));
      reload();
    } catch (err: any) { toast.error(err.message); }
  };

  const handleRunNow = async (s: RecurringInvoiceSchedule) => {
    try {
      const r = await runRecurringScheduleNow(s.id);
      toast.success(`${tr.invoiceCreated || 'Invoice created'} ${r.invoice_number || ''}`.trim());
      reload();
    } catch (err: any) { toast.error(err.message); }
  };

  const handleDelete = async (s: RecurringInvoiceSchedule) => {
    if (!confirm(tr.confirmDelete || 'Delete this schedule? Existing invoices are kept.')) return;
    try {
      await deleteRecurringSchedule(s.id);
      toast.success(tr.deleted || 'Schedule deleted');
      reload();
    } catch (err: any) { toast.error(err.message); }
  };

  const freqLabel = (f: RecurringFrequency) =>
    tr[f] || (language === 'fr'
      ? ({ weekly: 'Hebdo', biweekly: 'Aux 2 semaines', monthly: 'Mensuel', quarterly: 'Trimestriel', yearly: 'Annuel' } as any)[f]
      : ({ weekly: 'Weekly', biweekly: 'Biweekly', monthly: 'Monthly', quarterly: 'Quarterly', yearly: 'Yearly' } as any)[f]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2">
            <Repeat size={22} /> {tr.title || (language === 'fr' ? 'Factures récurrentes' : 'Recurring Invoices')}
          </h1>
          <p className="text-[13px] text-text-tertiary mt-1">
            {tr.subtitle || (language === 'fr'
              ? 'Génère automatiquement des factures selon une cadence.'
              : 'Automatically generate invoices on a schedule.')}
          </p>
        </div>
        <button
          onClick={() => { setEditing(null); setModalOpen(true); }}
          className="btn btn-primary inline-flex items-center gap-1.5"
        >
          <Plus size={16} /> {tr.newSchedule || (language === 'fr' ? 'Nouvelle planification' : 'New schedule')}
        </button>
      </div>

      <div className="section-card overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-text-tertiary text-sm">Loading…</div>
        ) : schedules.length === 0 ? (
          <div className="p-8 text-center text-text-tertiary text-sm">
            {tr.empty || (language === 'fr' ? 'Aucune planification. Créez-en une pour commencer.' : 'No schedules yet. Create one to get started.')}
          </div>
        ) : (
          <div className="divide-y divide-outline-subtle">
            <div className="grid grid-cols-[1.5fr_1fr_1fr_1fr_auto] gap-3 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary bg-surface-secondary">
              <div>{tr.client || (language === 'fr' ? 'Client' : 'Client')}</div>
              <div>{tr.frequency || (language === 'fr' ? 'Fréquence' : 'Frequency')}</div>
              <div>{tr.nextRun || (language === 'fr' ? 'Prochain envoi' : 'Next run')}</div>
              <div>{tr.status || 'Status'}</div>
              <div></div>
            </div>
            {schedules.map((s) => (
              <div key={s.id} className="grid grid-cols-[1.5fr_1fr_1fr_1fr_auto] gap-3 px-4 py-3 items-center hover:bg-surface-secondary/40 transition-colors">
                <div>
                  <div className="text-[13px] font-semibold text-text-primary">{clientLabel(s)}</div>
                  <div className="text-[12px] text-text-tertiary truncate">{s.subject}</div>
                </div>
                <div className="text-[13px] text-text-secondary">{freqLabel(s.frequency)}</div>
                <div className="text-[13px] text-text-secondary inline-flex items-center gap-1.5">
                  <Calendar size={12} className="text-text-tertiary" />
                  {formatDate(s.next_run_date)}
                </div>
                <div>
                  <button
                    onClick={() => handleToggleActive(s)}
                    className={cn(
                      'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold',
                      s.is_active
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                        : 'bg-surface-tertiary text-text-tertiary',
                    )}
                  >
                    {s.is_active ? (tr.active || 'Active') : (tr.paused || 'Paused')}
                  </button>
                </div>
                <div className="flex items-center gap-1">
                  <button title={tr.runNow || 'Run now'} onClick={() => handleRunNow(s)}
                    className="p-1.5 rounded hover:bg-surface-tertiary text-text-tertiary hover:text-text-primary">
                    <Play size={14} />
                  </button>
                  <button title={s.is_active ? (tr.pause || 'Pause') : (tr.resume || 'Resume')} onClick={() => handleToggleActive(s)}
                    className="p-1.5 rounded hover:bg-surface-tertiary text-text-tertiary hover:text-text-primary">
                    <Pause size={14} />
                  </button>
                  <button title={tr.edit || 'Edit'} onClick={() => { setEditing(s); setModalOpen(true); }}
                    className="p-1.5 rounded hover:bg-surface-tertiary text-text-tertiary hover:text-text-primary">
                    <Edit2 size={14} />
                  </button>
                  <button title={tr.delete || 'Delete'} onClick={() => handleDelete(s)}
                    className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-950/30 text-text-tertiary hover:text-red-600">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {modalOpen && (
        <ScheduleModal
          schedule={editing}
          initialClientId={initialClientId}
          onClose={() => setModalOpen(false)}
          onSaved={() => { setModalOpen(false); reload(); }}
        />
      )}
    </div>
  );
}

// ─── Schedule create/edit modal ───────────────────────────────────

function ScheduleModal({
  schedule, initialClientId, onClose, onSaved,
}: {
  schedule: RecurringInvoiceSchedule | null;
  initialClientId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t, language } = useTranslation();
  const tr = (t as any).recurringInvoices || {};
  const isEdit = !!schedule;

  const [clientId, setClientId] = useState<string>(schedule?.client_id || initialClientId || '');
  const [clientQuery, setClientQuery] = useState('');
  const [clientOptions, setClientOptions] = useState<ClientOption[]>([]);
  const [selectedClientLabel, setSelectedClientLabel] = useState<string>('');
  const [subject, setSubject] = useState(schedule?.subject || '');
  const [items, setItems] = useState<RecurringInvoiceItem[]>(
    schedule?.items?.length ? schedule.items : [{ description: '', qty: 1, unit_price_cents: 0 }],
  );
  const [frequency, setFrequency] = useState<RecurringFrequency>(schedule?.frequency || 'monthly');
  const today = new Date().toISOString().slice(0, 10);
  const [startDate, setStartDate] = useState(schedule?.start_date || today);
  const [endDate, setEndDate] = useState<string>(schedule?.end_date || '');
  const [dueDaysOffset, setDueDaysOffset] = useState(schedule?.due_days_offset ?? 30);
  const [autoSend, setAutoSend] = useState(schedule?.auto_send ?? false);
  const [saving, setSaving] = useState(false);

  // Search clients on query change
  useEffect(() => {
    if (isEdit || initialClientId) return;
    let cancel = false;
    (async () => {
      try {
        const r = await searchActiveClients({ q: clientQuery, page: 1, pageSize: 10 });
        if (!cancel) setClientOptions(r.items.map((c) => ({ id: c.id, name: c.name })));
      } catch { /* silent */ }
    })();
    return () => { cancel = true; };
  }, [clientQuery, isEdit, initialClientId]);

  // Load label for editing
  useEffect(() => {
    if (!schedule?.clients) return;
    const c = schedule.clients;
    const full = `${c.first_name || ''} ${c.last_name || ''}`.trim();
    setSelectedClientLabel(full || c.company || c.email || '');
  }, [schedule]);

  const total = useMemo(
    () => items.reduce((sum, it) => sum + Math.round((Number(it.qty) || 0) * (Number(it.unit_price_cents) || 0)), 0),
    [items],
  );

  const updateItem = (idx: number, patch: Partial<RecurringInvoiceItem>) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  };
  const addItem = () => setItems((prev) => [...prev, { description: '', qty: 1, unit_price_cents: 0 }]);
  const removeItem = (idx: number) => setItems((prev) => prev.filter((_, i) => i !== idx));

  const canSave = clientId && subject.trim() && items.length > 0
    && items.every((i) => i.description.trim() && Number(i.qty) > 0);

  const submit = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const cleanedItems = items.map((i) => ({
        description: i.description.trim(),
        qty: Number(i.qty),
        unit_price_cents: Math.round(Number(i.unit_price_cents) || 0),
      }));
      if (isEdit) {
        await updateRecurringSchedule(schedule!.id, {
          subject: subject.trim(),
          items: cleanedItems,
          frequency,
          start_date: startDate,
          end_date: endDate || null,
          due_days_offset: dueDaysOffset,
          auto_send: autoSend,
        });
        toast.success(tr.saved || 'Schedule updated');
      } else {
        await createRecurringSchedule({
          client_id: clientId,
          subject: subject.trim(),
          items: cleanedItems,
          frequency,
          start_date: startDate,
          end_date: endDate || null,
          due_days_offset: dueDaysOffset,
          auto_send: autoSend,
        });
        toast.success(tr.created || 'Schedule created');
      }
      onSaved();
    } catch (err: any) {
      toast.error(err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-surface w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl shadow-2xl">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-outline">
          <h2 className="text-[15px] font-bold text-text-primary">
            {isEdit ? (tr.editSchedule || (language === 'fr' ? 'Modifier la planification' : 'Edit schedule'))
                    : (tr.newSchedule || (language === 'fr' ? 'Nouvelle planification' : 'New schedule'))}
          </h2>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-surface-tertiary"><X size={16} /></button>
        </div>

        <div className="p-5 space-y-4">
          {/* Client picker */}
          {!isEdit && !initialClientId ? (
            <div>
              <label className="form-label">{tr.client || (language === 'fr' ? 'Client' : 'Client')} *</label>
              {clientId ? (
                <div className="flex items-center justify-between gap-2 p-2.5 rounded-lg border border-outline bg-surface-secondary">
                  <span className="text-[13px] font-medium text-text-primary">{selectedClientLabel}</span>
                  <button onClick={() => { setClientId(''); setSelectedClientLabel(''); }}
                    className="text-text-tertiary hover:text-text-primary"><X size={14} /></button>
                </div>
              ) : (
                <>
                  <input
                    type="text"
                    className="form-input"
                    placeholder={language === 'fr' ? 'Rechercher un client...' : 'Search a client...'}
                    value={clientQuery}
                    onChange={(e) => setClientQuery(e.target.value)}
                  />
                  {clientOptions.length > 0 && (
                    <div className="mt-1 max-h-48 overflow-y-auto border border-outline rounded-lg bg-surface">
                      {clientOptions.map((c) => (
                        <button key={c.id} type="button"
                          onClick={() => { setClientId(c.id); setSelectedClientLabel(c.name); setClientOptions([]); }}
                          className="w-full text-left px-3 py-2 text-[13px] hover:bg-surface-secondary">
                          {c.name}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          ) : null}

          {/* Subject */}
          <div>
            <label className="form-label">{tr.subject || (language === 'fr' ? 'Objet' : 'Subject')} *</label>
            <input type="text" className="form-input" value={subject} onChange={(e) => setSubject(e.target.value)}
              placeholder={language === 'fr' ? 'Ex : Forfait mensuel...' : 'e.g. Monthly retainer...'} />
          </div>

          {/* Items */}
          <div>
            <label className="form-label">{tr.items || (language === 'fr' ? 'Lignes' : 'Items')} *</label>
            <div className="space-y-1.5">
              {items.map((it, i) => (
                <div key={i} className="grid grid-cols-[1fr_70px_110px_auto] gap-2 items-center">
                  <input type="text" className="form-input" placeholder={language === 'fr' ? 'Description' : 'Description'}
                    value={it.description} onChange={(e) => updateItem(i, { description: e.target.value })} />
                  <input type="number" min={0} step="0.01" className="form-input" placeholder="Qty"
                    value={it.qty} onChange={(e) => updateItem(i, { qty: Number(e.target.value) })} />
                  <input type="number" min={0} step="0.01" className="form-input" placeholder={language === 'fr' ? 'Prix unitaire' : 'Unit price'}
                    value={it.unit_price_cents / 100}
                    onChange={(e) => updateItem(i, { unit_price_cents: Math.round((Number(e.target.value) || 0) * 100) })} />
                  <button type="button" onClick={() => removeItem(i)} disabled={items.length === 1}
                    className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-950/30 text-text-tertiary hover:text-red-600 disabled:opacity-30">
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
            <button type="button" onClick={addItem} className="mt-2 text-[12px] text-primary hover:underline inline-flex items-center gap-1">
              <Plus size={12} /> {tr.addItem || (language === 'fr' ? 'Ajouter une ligne' : 'Add item')}
            </button>
            <div className="mt-3 text-right text-[13px] font-semibold text-text-primary">
              {tr.total || 'Total'}: {formatMoneyFromCents(total)}
            </div>
          </div>

          {/* Frequency + Dates */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="form-label">{tr.frequency || (language === 'fr' ? 'Fréquence' : 'Frequency')} *</label>
              <select className="form-input" value={frequency} onChange={(e) => setFrequency(e.target.value as RecurringFrequency)}>
                <option value="weekly">{language === 'fr' ? 'Hebdomadaire' : 'Weekly'}</option>
                <option value="biweekly">{language === 'fr' ? 'Aux 2 semaines' : 'Biweekly'}</option>
                <option value="monthly">{language === 'fr' ? 'Mensuelle' : 'Monthly'}</option>
                <option value="quarterly">{language === 'fr' ? 'Trimestrielle' : 'Quarterly'}</option>
                <option value="yearly">{language === 'fr' ? 'Annuelle' : 'Yearly'}</option>
              </select>
            </div>
            <div>
              <label className="form-label">{tr.dueDaysOffset || (language === 'fr' ? 'Échéance (jours)' : 'Due in (days)')}</label>
              <input type="number" min={0} max={365} className="form-input"
                value={dueDaysOffset} onChange={(e) => setDueDaysOffset(Number(e.target.value) || 0)} />
            </div>
            <div>
              <label className="form-label">{tr.startDate || (language === 'fr' ? 'Date de début' : 'Start date')} *</label>
              <input type="date" className="form-input" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div>
              <label className="form-label">{tr.endDate || (language === 'fr' ? 'Date de fin (optionnel)' : 'End date (optional)')}</label>
              <input type="date" className="form-input" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </div>

          {/* Auto-send */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={autoSend} onChange={(e) => setAutoSend(e.target.checked)} />
            <span className="text-[13px] text-text-primary">
              {tr.autoSend || (language === 'fr' ? 'Envoyer automatiquement par courriel' : 'Auto-send by email')}
            </span>
          </label>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-outline">
          <button onClick={onClose} className="btn btn-secondary">{(t.common as any).cancel || 'Cancel'}</button>
          <button onClick={submit} disabled={!canSave || saving} className="btn btn-primary">
            {saving ? '…' : isEdit ? ((t.common as any).save || 'Save') : (tr.create || (language === 'fr' ? 'Créer' : 'Create'))}
          </button>
        </div>
      </div>
    </div>
  );
}
