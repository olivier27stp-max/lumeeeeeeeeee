/**
 * Itemized expense editor for one job — list, add (free entry or picked from
 * the org's expense catalog), delete, catalog management. Shared between the
 * JobDetails hub card and the Profitability breakdown modal in Statistiques.
 * jobs.expenses_cents follows automatically via the DB trigger.
 *
 * Until migration 20260831000000 is applied the tables don't exist: the
 * editor then falls back to the legacy single-amount input (admin-only,
 * since jobs_update_org requires an admin role).
 */
import { useEffect, useMemo, useState } from 'react';
import { BookOpen, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from '../../i18n';
import { formatCents } from '../../lib/jobCalc';
import { supabase } from '../../lib/supabase';
import { updateJobExpenses } from '../../lib/profitabilityApi';
import {
  EXPENSE_CATEGORIES,
  addJobExpense,
  createExpensePreset,
  expenseCategoryLabel,
  fetchJobExpenses,
  isMissingExpensesTable,
  listExpensePresets,
  removeExpensePreset,
  removeJobExpense,
  type ExpenseCategory,
  type ExpensePreset,
  type JobExpense,
} from '../../lib/expensesApi';

function parseDollars(raw: string): number {
  const dollars = parseFloat(raw.replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(dollars) ? Math.round(dollars * 100) : 0;
}

/** Legacy fallback: single total on jobs.expenses_cents (pre-migration). */
function LegacyAmountEditor({ jobId, initialCents, onChanged }: { jobId: string; initialCents: number; onChanged?: () => void }) {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const [val, setVal] = useState(initialCents > 0 ? String(initialCents / 100) : '');
  const [saving, setSaving] = useState(false);

  const commit = async () => {
    const cents = parseDollars(val);
    setSaving(true);
    try {
      await updateJobExpenses(jobId, cents);
      onChanged?.();
      toast.success(fr ? 'Dépenses enregistrées' : 'Expenses saved');
    } catch {
      toast.error(fr ? "Échec de l'enregistrement" : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-[13px] text-text-tertiary">$</span>
        <input
          value={val}
          inputMode="decimal"
          placeholder="0"
          disabled={saving}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') commit(); }}
          className="glass-input w-28 text-right tabular-nums"
        />
        <button onClick={commit} disabled={saving} className="glass-button !text-[12px]">
          {saving ? (fr ? 'Enregistrement…' : 'Saving…') : (fr ? 'Enregistrer' : 'Save')}
        </button>
      </div>
      <p className="text-[11.5px] text-text-tertiary">
        {fr
          ? 'Détail par ligne indisponible (migration à appliquer) — montant global seulement.'
          : 'Per-line detail unavailable (migration pending) — single total only.'}
      </p>
    </div>
  );
}

export default function ExpensesEditor({ jobId, onChanged }: { jobId: string; onChanged?: () => void }) {
  const { language } = useTranslation();
  const fr = language === 'fr';

  const [rows, setRows] = useState<JobExpense[]>([]);
  const [presets, setPresets] = useState<ExpensePreset[]>([]);
  const [loading, setLoading] = useState(true);
  const [tableMissing, setTableMissing] = useState(false);
  const [legacyCents, setLegacyCents] = useState(0);
  const [showAdd, setShowAdd] = useState(false);
  const [showCatalog, setShowCatalog] = useState(false);

  // Add form
  const [presetId, setPresetId] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState<ExpenseCategory>('materiaux');
  const [amount, setAmount] = useState('');
  const [incurredOn, setIncurredOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [saveAsPreset, setSaveAsPreset] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const [lines, cat] = await Promise.all([fetchJobExpenses(jobId), listExpensePresets()]);
        if (!alive) return;
        setRows(lines);
        setPresets(cat);
      } catch (err) {
        if (!alive) return;
        if (isMissingExpensesTable(err)) {
          setTableMissing(true);
          const { data } = await supabase.from('jobs').select('expenses_cents').eq('id', jobId).maybeSingle();
          if (alive) setLegacyCents(Number((data as { expenses_cents?: number } | null)?.expenses_cents) || 0);
        } else {
          toast.error(fr ? 'Échec du chargement des dépenses' : 'Failed to load expenses');
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  const total = useMemo(() => rows.reduce((s, r) => s + r.amount_cents, 0), [rows]);

  const resetForm = () => {
    setPresetId('');
    setName('');
    setCategory('materiaux');
    setAmount('');
    setIncurredOn(new Date().toISOString().slice(0, 10));
    setSaveAsPreset(false);
  };

  const pickPreset = (id: string) => {
    setPresetId(id);
    const p = presets.find((x) => x.id === id);
    if (!p) return;
    setName(p.name);
    setCategory(p.category);
    if (p.default_amount_cents != null && p.default_amount_cents > 0) setAmount(String(p.default_amount_cents / 100));
    setSaveAsPreset(false);
  };

  const handleAdd = async () => {
    const cents = parseDollars(amount);
    if (!name.trim()) { toast.error(fr ? 'Nom requis' : 'Name required'); return; }
    if (cents <= 0) { toast.error(fr ? 'Montant requis' : 'Amount required'); return; }
    setSaving(true);
    try {
      let usedPresetId: string | null = presetId || null;
      if (!usedPresetId && saveAsPreset) {
        const created = await createExpensePreset({ name: name.trim(), category, default_amount_cents: cents });
        setPresets((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
        usedPresetId = created.id;
      }
      const line = await addJobExpense({
        job_id: jobId,
        name: name.trim(),
        category,
        amount_cents: cents,
        preset_id: usedPresetId,
        incurred_on: incurredOn,
      });
      setRows((prev) => [line, ...prev]);
      resetForm();
      setShowAdd(false);
      onChanged?.();
    } catch {
      toast.error(fr ? "Échec de l'ajout de la dépense" : 'Failed to add expense');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    const prev = rows;
    setRows((r) => r.filter((x) => x.id !== id));
    try {
      await removeJobExpense(id);
      onChanged?.();
    } catch {
      setRows(prev);
      toast.error(fr ? 'Échec de la suppression' : 'Failed to delete');
    }
  };

  const handleDeletePreset = async (id: string) => {
    const prev = presets;
    setPresets((p) => p.filter((x) => x.id !== id));
    try {
      await removeExpensePreset(id);
    } catch {
      setPresets(prev);
      toast.error(fr ? 'Échec de la suppression' : 'Failed to delete');
    }
  };

  if (loading) return <div className="h-16 rounded-lg bg-surface-secondary/40 animate-pulse" />;
  if (tableMissing) return <LegacyAmountEditor jobId={jobId} initialCents={legacyCents} onChanged={onChanged} />;

  return (
    <div className="space-y-3">
      {rows.length === 0 ? (
        <p className="text-[13px] text-text-tertiary">
          {fr ? 'Aucune dépense sur ce job.' : 'No expenses on this job.'}
        </p>
      ) : (
        <ul className="divide-y divide-outline-subtle">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center gap-3 py-2 group">
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-text-primary truncate">{r.name}</p>
                <p className="text-[11.5px] text-text-tertiary">
                  {expenseCategoryLabel(r.category, fr)} — {new Date(`${r.incurred_on}T12:00:00`).toLocaleDateString(fr ? 'fr-CA' : 'en-CA')}
                </p>
              </div>
              <span className="text-[13px] font-semibold text-text-primary tabular-nums">{formatCents(r.amount_cents)}</span>
              <button
                onClick={() => handleDelete(r.id)}
                className="p-1 rounded text-text-tertiary hover:text-danger opacity-0 group-hover:opacity-100 transition-opacity"
                title={fr ? 'Supprimer' : 'Delete'}
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {rows.length > 0 && (
        <div className="flex items-center justify-between border-t border-outline-subtle pt-2">
          <span className="text-[12px] font-semibold uppercase tracking-wide text-text-tertiary">Total</span>
          <span className="text-[13px] font-bold text-text-primary tabular-nums">{formatCents(total)}</span>
        </div>
      )}

      {showAdd ? (
        <div className="rounded-lg border border-outline-subtle p-3 space-y-2.5">
          {presets.length > 0 && (
            <select value={presetId} onChange={(e) => pickPreset(e.target.value)} className="glass-input w-full !text-[13px]">
              <option value="">{fr ? 'Choisir du catalogue…' : 'Pick from catalog…'}</option>
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}{p.default_amount_cents ? ` — ${formatCents(p.default_amount_cents)}` : ''}
                </option>
              ))}
            </select>
          )}
          <input
            value={name}
            onChange={(e) => { setName(e.target.value); if (presetId) setPresetId(''); }}
            placeholder={fr ? 'Nom de la dépense (ex. Savon, Essence…)' : 'Expense name (e.g. Soap, Fuel…)'}
            className="glass-input w-full !text-[13px]"
          />
          <div className="grid grid-cols-2 gap-2">
            <select value={category} onChange={(e) => setCategory(e.target.value as ExpenseCategory)} className="glass-input !text-[13px]">
              {EXPENSE_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>{fr ? c.fr : c.en}</option>
              ))}
            </select>
            <div className="flex items-center gap-1.5">
              <span className="text-[13px] text-text-tertiary">$</span>
              <input
                value={amount}
                inputMode="decimal"
                placeholder="0"
                onChange={(e) => setAmount(e.target.value)}
                className="glass-input w-full text-right tabular-nums !text-[13px]"
              />
            </div>
          </div>
          <input type="date" value={incurredOn} onChange={(e) => setIncurredOn(e.target.value)} className="glass-input w-full !text-[13px]" />
          {!presetId && (
            <label className="flex items-center gap-2 text-[12.5px] text-text-secondary cursor-pointer">
              <input type="checkbox" checked={saveAsPreset} onChange={(e) => setSaveAsPreset(e.target.checked)} className="accent-current" />
              {fr ? 'Ajouter au catalogue de dépenses' : 'Save to expense catalog'}
            </label>
          )}
          <div className="flex gap-2 pt-0.5">
            <button onClick={handleAdd} disabled={saving} className="glass-button-primary !text-[12px]">
              {saving ? (fr ? 'Ajout…' : 'Adding…') : (fr ? 'Ajouter' : 'Add')}
            </button>
            <button onClick={() => { setShowAdd(false); resetForm(); }} className="glass-button !text-[12px]">
              {fr ? 'Annuler' : 'Cancel'}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 print:hidden">
          <button onClick={() => setShowAdd(true)} className="glass-button !text-[12px] flex items-center gap-1.5">
            <Plus size={13} /> {fr ? 'Ajouter une dépense' : 'Add expense'}
          </button>
          {presets.length > 0 && (
            <button
              onClick={() => setShowCatalog((v) => !v)}
              className="glass-button !text-[12px] flex items-center gap-1.5"
            >
              <BookOpen size={13} /> {fr ? 'Catalogue' : 'Catalog'}
            </button>
          )}
        </div>
      )}

      {showCatalog && !showAdd && (
        <div className="rounded-lg border border-outline-subtle p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary mb-1.5">
            {fr ? 'Catalogue de dépenses' : 'Expense catalog'}
          </p>
          <ul className="divide-y divide-outline-subtle">
            {presets.map((p) => (
              <li key={p.id} className="flex items-center gap-3 py-1.5 group">
                <div className="min-w-0 flex-1">
                  <span className="text-[13px] text-text-primary">{p.name}</span>
                  <span className="text-[11.5px] text-text-tertiary ml-2">{expenseCategoryLabel(p.category, fr)}</span>
                </div>
                {p.default_amount_cents != null && p.default_amount_cents > 0 && (
                  <span className="text-[12.5px] text-text-secondary tabular-nums">{formatCents(p.default_amount_cents)}</span>
                )}
                <button
                  onClick={() => handleDeletePreset(p.id)}
                  className="p-1 rounded text-text-tertiary hover:text-danger opacity-0 group-hover:opacity-100 transition-opacity"
                  title={fr ? 'Retirer du catalogue' : 'Remove from catalog'}
                >
                  <Trash2 size={13} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
