import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { getCommissionRules, assignMemberToRule } from '../../lib/commissionsApi';
import type { FsCommissionRule } from '../../types';

function ruleBaseLabel(rule: FsCommissionRule, isFr: boolean): string {
  if (rule.base_kind === 'flat') {
    return `${((rule.base_value_cents || 0) / 100).toFixed(2)} $ ${isFr ? 'par vente' : 'per sale'}`;
  }
  const pct = rule.base_percent ?? rule.percentage ?? 0;
  return `${pct} % ${isFr ? 'de base' : 'base'}`;
}

/**
 * Which commission plan pays this member. Assignment lives on
 * fs_commission_rules.assigned_user_ids — the exact lookup the engine does
 * when an invoice is paid; no rule match falls back to the org default plan.
 */
export default function MemberCommissionPlan({ userId, isFr }: { userId: string; isFr: boolean }) {
  const [rules, setRules] = useState<FsCommissionRule[] | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getCommissionRules()
      .then((all) => setRules(all.filter((r) => r.is_active && !r.deleted_at)))
      .catch(() => setRules([]));
  }, []);

  if (rules === null) return <Loader2 size={14} className="animate-spin text-text-tertiary" />;

  const currentRuleId = rules.find((r) => (r.assigned_user_ids || []).includes(userId))?.id ?? '';

  async function handleChange(ruleId: string) {
    setSaving(true);
    try {
      await assignMemberToRule(userId, ruleId || null);
      setRules((prev) => (prev || []).map((r) => ({
        ...r,
        assigned_user_ids: r.id === ruleId
          ? [...new Set([...(r.assigned_user_ids || []), userId])]
          : (r.assigned_user_ids || []).filter((u) => u !== userId),
      })));
      toast.success(isFr ? 'Plan de commission mis à jour' : 'Commission plan updated');
    } catch (err: any) {
      toast.error(err?.message || (isFr ? 'Échec de la mise à jour' : 'Update failed'));
    } finally {
      setSaving(false);
    }
  }

  const selected = rules.find((r) => r.id === currentRuleId);

  return (
    <div className="max-w-xs space-y-1.5">
      <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">
        {isFr ? 'Plan de commission' : 'Commission plan'}
      </label>
      <div className="flex items-center gap-2">
        <select
          value={currentRuleId}
          disabled={saving}
          onChange={(e) => handleChange(e.target.value)}
          className="glass-input w-full disabled:opacity-60"
        >
          <option value="">{isFr ? 'Plan par défaut de l\'entreprise' : 'Company default plan'}</option>
          {rules.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name} — {ruleBaseLabel(r, isFr)}
            </option>
          ))}
        </select>
        {saving && <Loader2 size={13} className="animate-spin text-text-tertiary shrink-0" />}
      </div>
      <p className="text-[11px] text-text-tertiary">
        {selected
          ? `${isFr ? 'Ce membre est payé selon' : 'This member is paid per'} « ${selected.name} » (${ruleBaseLabel(selected, isFr)}).`
          : (isFr ? 'Aucun plan spécifique — le plan par défaut de l\'entreprise s\'applique.' : 'No specific plan — the company default applies.')}
        {' '}
        <Link to="/commissions" className="inline-flex items-center gap-0.5 underline hover:text-text-primary">
          {isFr ? 'Gérer les plans' : 'Manage plans'} <ExternalLink size={9} />
        </Link>
      </p>
    </div>
  );
}
