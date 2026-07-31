import { useEffect, useState } from 'react';
import { Loader2, Check, CalendarClock } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useCompany } from '../../contexts/CompanyContext';
import { useTranslation } from '../../i18n';
import {
  getPayrollSettings,
  updatePayrollSettings,
  type PayrollSettings,
  type PayPeriodType,
} from '../../lib/payrollApi';
import PayrollSummaryCard from './PayrollSummaryCard';

const PERIOD_TYPES: PayPeriodType[] = ['weekly', 'biweekly', 'semimonthly', 'monthly'];

/**
 * Admin payroll configuration (Settings → Payroll). Owners/admins set the pay
 * period frequency, cycle anchor, and pay-day offset. Everyone else sees a
 * read-only summary of the active period.
 */
export default function PayrollSettingsPanel() {
  const { t, language } = useTranslation();
  const fr = language === 'fr';
  const tp = (t as any).payroll || {};
  const { currentRole } = useCompany();
  const isAdmin = currentRole === 'owner' || currentRole === 'admin';

  const [form, setForm] = useState<PayrollSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const s = await getPayrollSettings();
        setForm(s);
      } catch (err: any) {
        setError(err?.message || (fr ? 'Erreur de chargement' : 'Failed to load'));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleSave = async () => {
    if (!form) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await updatePayrollSettings({
        pay_period_type: form.pay_period_type,
        anchor_date: form.anchor_date,
        pay_day_offset: form.pay_day_offset,
        timezone: form.timezone,
      });
      setForm(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err: any) {
      setError(err?.message || (fr ? "Échec de l'enregistrement" : 'Failed to save'));
    } finally {
      setSaving(false);
    }
  };

  if (loading || !form) {
    return (
      <div className="glass-card rounded-2xl p-6 flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-text-muted" />
      </div>
    );
  }

  const periodLabel = (type: PayPeriodType) => tp[type] || type;
  const showAnchor = form.pay_period_type === 'weekly' || form.pay_period_type === 'biweekly';

  return (
    <div className="space-y-6">
      {/* Live preview of the current period for the admin's own account */}
      <PayrollSummaryCard />

      <div className="glass-card rounded-2xl p-6 space-y-6">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
            <CalendarClock size={17} className="text-primary" />
          </div>
          <div>
            <h3 className="text-[14px] font-bold text-text-primary">{tp.title || 'Payroll'}</h3>
            <p className="text-[12px] text-text-tertiary">{tp.subtitle}</p>
          </div>
        </div>

        {!isAdmin && (
          <p className="text-[12px] text-amber-600 bg-amber-50 rounded-lg px-3 py-2">{tp.adminOnly}</p>
        )}

        {/* Pay period frequency */}
        <div>
          <label className="text-xs font-medium text-text-tertiary">{tp.payPeriodType}</label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
            {PERIOD_TYPES.map((type) => (
              <button
                key={type}
                disabled={!isAdmin}
                onClick={() => setForm({ ...form, pay_period_type: type })}
                className={cn(
                  'rounded-xl border px-3 py-2.5 text-[13px] font-medium text-left transition-all disabled:opacity-60 disabled:cursor-not-allowed',
                  form.pay_period_type === type
                    ? 'border-primary bg-primary/5 text-text-primary'
                    : 'border-outline-subtle text-text-secondary hover:border-outline hover:bg-surface-secondary/40'
                )}
              >
                {periodLabel(type)}
              </button>
            ))}
          </div>
        </div>

        {/* Cycle anchor — only relevant for weekly/biweekly */}
        {showAnchor && (
          <div>
            <label className="text-xs font-medium text-text-tertiary">{tp.anchorDate}</label>
            <input
              type="date"
              disabled={!isAdmin}
              value={form.anchor_date}
              onChange={(e) => setForm({ ...form, anchor_date: e.target.value })}
              className="glass-input w-full mt-1.5 disabled:opacity-60"
            />
            <p className="text-[11px] text-text-tertiary mt-1">{tp.anchorDateHint}</p>
          </div>
        )}

        {/* Pay-day offset */}
        <div>
          <label className="text-xs font-medium text-text-tertiary">{tp.payDayOffset}</label>
          <input
            type="number"
            min={0}
            max={31}
            disabled={!isAdmin}
            value={form.pay_day_offset}
            onChange={(e) => setForm({ ...form, pay_day_offset: Math.max(0, Math.min(31, Number(e.target.value) || 0)) })}
            className="glass-input w-full mt-1.5 disabled:opacity-60"
          />
          <p className="text-[11px] text-text-tertiary mt-1">{tp.payDayOffsetHint}</p>
        </div>

        {/* Timezone — payroll_settings.timezone was saved & used by the server
            pay-period calculation, but had no input control. */}
        <div>
          <label className="text-xs font-medium text-text-tertiary">{fr ? 'Fuseau horaire' : 'Timezone'}</label>
          <select
            disabled={!isAdmin}
            value={form.timezone}
            onChange={(e) => setForm({ ...form, timezone: e.target.value })}
            className="glass-input w-full mt-1.5 disabled:opacity-60"
          >
            <option value="America/Toronto">{fr ? 'Est (Toronto / Montréal)' : 'Eastern (Toronto / Montréal)'}</option>
            <option value="America/Halifax">{fr ? 'Atlantique (Halifax)' : 'Atlantic (Halifax)'}</option>
            <option value="America/St_Johns">{fr ? 'Terre-Neuve (St. John’s)' : 'Newfoundland (St. John’s)'}</option>
            <option value="America/Winnipeg">{fr ? 'Centre (Winnipeg)' : 'Central (Winnipeg)'}</option>
            <option value="America/Edmonton">{fr ? 'Rocheuses (Edmonton / Calgary)' : 'Mountain (Edmonton / Calgary)'}</option>
            <option value="America/Vancouver">{fr ? 'Pacifique (Vancouver)' : 'Pacific (Vancouver)'}</option>
          </select>
          <p className="text-[11px] text-text-tertiary mt-1">
            {fr ? 'Utilisé pour délimiter les périodes de paie.' : 'Used to bound pay periods.'}
          </p>
        </div>

        {error && <p className="text-[12px] text-danger">{error}</p>}

        {isAdmin && (
          <button
            onClick={handleSave}
            disabled={saving}
            className={cn('glass-button-primary inline-flex items-center gap-2', saved && '!bg-success !text-white !border-success')}
          >
            {saving ? <Loader2 size={13} className="animate-spin" /> : saved ? <Check size={13} /> : null}
            {saving ? (fr ? 'Enregistrement...' : 'Saving...') : saved ? (fr ? 'Enregistré' : 'Saved') : tp.saveSettings}
          </button>
        )}
      </div>
    </div>
  );
}
