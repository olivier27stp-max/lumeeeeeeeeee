import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import {
  DollarSign, TrendingUp, Clock, CheckCircle2, Plus, Pencil, Trash2,
  Settings as SettingsIcon, AlertTriangle, X, Loader2, Users as UsersIcon,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { useTranslation } from '../i18n';
import { PageHeader } from '../components/ui';
import PermissionGate from '../components/PermissionGate';
import {
  getCommissionEntries, approveCommission, reverseCommission, markCommissionPaid,
  getCommissionRules, createCommissionRule, updateCommissionRule, deleteCommissionRule,
  getCommissionSettings, updateCommissionSettings,
} from '../lib/commissionsApi';
import { fetchTeamList } from '../lib/invitationsApi';
import type { FsCommissionRule, CommissionAttribution, CommissionProductOverride, CommissionPerformanceTier, CommissionBonus } from '../types';

function fmt(n: number) {
  return '$' + Number(n || 0).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' });
}

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  approved: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  paid: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
  reversed: 'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300',
};

export default function Commissions() {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [repFilter, setRepFilter] = useState<string>('');
  const [editingRule, setEditingRule] = useState<Partial<FsCommissionRule> | null>(null);

  const entriesQ = useQuery({
    queryKey: ['commission-entries', statusFilter, repFilter],
    queryFn: () => getCommissionEntries({ status: statusFilter || undefined, userId: repFilter || undefined }),
  });
  const rulesQ = useQuery({ queryKey: ['commission-rules'], queryFn: getCommissionRules });
  const settingsQ = useQuery({ queryKey: ['commission-settings'], queryFn: getCommissionSettings });
  const teamQ = useQuery({ queryKey: ['team-list'], queryFn: fetchTeamList });

  const entries = entriesQ.data ?? [];
  const rules = rulesQ.data ?? [];
  const settings = settingsQ.data;
  const team = teamQ.data?.members ?? [];

  // KPIs
  const kpis = useMemo(() => {
    const sum = (s: string) => entries.filter((e) => e.status === s).reduce((a, e) => a + Number(e.amount), 0);
    return {
      total_due: sum('pending') + sum('approved'),
      paid_month: entries.filter((e) => e.status === 'paid' && e.paid_at && new Date(e.paid_at).getMonth() === new Date().getMonth()).reduce((a, e) => a + Number(e.amount), 0),
      pending: sum('pending'),
      reversed: sum('reversed'),
    };
  }, [entries]);

  async function handleApprove(id: string) {
    try { await approveCommission(id); qc.invalidateQueries({ queryKey: ['commission-entries'] }); toast.success(fr ? 'Approuvée' : 'Approved'); }
    catch (e: any) { toast.error(e.message); }
  }
  async function handleMarkPaid(id: string) {
    try { await markCommissionPaid(id); qc.invalidateQueries({ queryKey: ['commission-entries'] }); toast.success(fr ? 'Marquée payée' : 'Marked paid'); }
    catch (e: any) { toast.error(e.message); }
  }
  async function handleReverse(id: string) {
    const reason = prompt(fr ? 'Raison de l\'inversion ?' : 'Reversal reason?') || '';
    try { await reverseCommission(id, reason); qc.invalidateQueries({ queryKey: ['commission-entries'] }); toast.success(fr ? 'Inversée' : 'Reversed'); }
    catch (e: any) { toast.error(e.message); }
  }
  async function handleDeleteRule(id: string) {
    if (!confirm(fr ? 'Supprimer cette règle ?' : 'Delete this rule?')) return;
    try { await deleteCommissionRule(id); qc.invalidateQueries({ queryKey: ['commission-rules'] }); toast.success(fr ? 'Règle supprimée' : 'Rule deleted'); }
    catch (e: any) { toast.error(e.message); }
  }
  async function handleSettingsChange(patch: { reversal_policy?: 'auto'|'keep'|'alert'; default_rule_id?: string | null }) {
    try { await updateCommissionSettings(patch); qc.invalidateQueries({ queryKey: ['commission-settings'] }); toast.success(fr ? 'Enregistré' : 'Saved'); }
    catch (e: any) { toast.error(e.message); }
  }

  return (
    <PermissionGate permission="financial.view_reports">
      <div className="space-y-6">
        <PageHeader
          title={fr ? 'Commissions' : 'Commissions'}
          subtitle={fr ? 'Gérez les commissions de vos vendeurs porte-à-porte' : 'Manage door-to-door sales commissions'}
          icon={DollarSign}
          iconColor="cyan"
        />

        {/* KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard icon={Clock}        label={fr ? 'À payer' : 'Total due'}         value={fmt(kpis.total_due)} color="amber" />
          <KpiCard icon={CheckCircle2} label={fr ? 'Payé ce mois' : 'Paid this month'} value={fmt(kpis.paid_month)} color="emerald" />
          <KpiCard icon={TrendingUp}   label={fr ? 'En attente d\'approbation' : 'Pending approval'} value={fmt(kpis.pending)} color="blue" />
          <KpiCard icon={AlertTriangle} label={fr ? 'Inversées' : 'Reversed'}        value={fmt(kpis.reversed)}  color="rose" />
        </div>

        {/* Filters + Table */}
        <div className="section-card p-5">
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <h2 className="text-base font-semibold text-text-primary mr-auto">{fr ? 'Entrées de commission' : 'Commission entries'}</h2>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="glass-input text-[13px] py-1.5">
              <option value="">{fr ? 'Tous statuts' : 'All statuses'}</option>
              <option value="pending">{fr ? 'En attente' : 'Pending'}</option>
              <option value="approved">{fr ? 'Approuvées' : 'Approved'}</option>
              <option value="paid">{fr ? 'Payées' : 'Paid'}</option>
              <option value="reversed">{fr ? 'Inversées' : 'Reversed'}</option>
            </select>
            <select value={repFilter} onChange={(e) => setRepFilter(e.target.value)} className="glass-input text-[13px] py-1.5">
              <option value="">{fr ? 'Tous les reps' : 'All reps'}</option>
              {team.map((m: any) => (<option key={m.user_id} value={m.user_id}>{m.full_name || m.email}</option>))}
            </select>
          </div>

          {entriesQ.isLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="animate-spin text-text-tertiary" size={24} /></div>
          ) : entries.length === 0 ? (
            <div className="text-center py-12 text-[13px] text-text-tertiary">
              {fr ? 'Aucune commission pour ces filtres.' : 'No commissions for these filters.'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="border-b border-outline text-[11px] uppercase tracking-wider text-text-tertiary">
                  <tr>
                    <th className="text-left py-2 px-2">{fr ? 'Rep' : 'Rep'}</th>
                    <th className="text-left py-2 px-2">{fr ? 'Base' : 'Base'}</th>
                    <th className="text-left py-2 px-2">{fr ? 'Commission' : 'Commission'}</th>
                    <th className="text-left py-2 px-2">{fr ? 'Statut' : 'Status'}</th>
                    <th className="text-left py-2 px-2">{fr ? 'Déclenchée' : 'Triggered'}</th>
                    <th className="text-right py-2 px-2">{fr ? 'Actions' : 'Actions'}</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e) => (
                    <tr key={e.id} className="border-b border-outline/40 hover:bg-surface-secondary/50">
                      <td className="py-2 px-2 font-medium text-text-primary">{e.rep_name || '—'}</td>
                      <td className="py-2 px-2 text-text-secondary tabular-nums">{fmt(Number(e.base_amount))}</td>
                      <td className="py-2 px-2 font-semibold text-text-primary tabular-nums">{fmt(Number(e.amount))}</td>
                      <td className="py-2 px-2">
                        <span className={cn('inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium', STATUS_STYLES[e.status])}>
                          {e.status}
                        </span>
                        {e.reverse_reason && e.status !== 'reversed' && (
                          <span title={e.reverse_reason} className="ml-2 inline-flex items-center text-amber-600"><AlertTriangle size={12} /></span>
                        )}
                      </td>
                      <td className="py-2 px-2 text-text-tertiary">{fmtDate(e.triggered_at)}</td>
                      <td className="py-2 px-2 text-right">
                        {e.status === 'pending' && (
                          <button onClick={() => handleApprove(e.id)} className="text-blue-600 hover:underline text-[12px] mr-3">{fr ? 'Approuver' : 'Approve'}</button>
                        )}
                        {e.status === 'approved' && (
                          <button onClick={() => handleMarkPaid(e.id)} className="text-emerald-600 hover:underline text-[12px] mr-3">{fr ? 'Marquer payée' : 'Mark paid'}</button>
                        )}
                        {(e.status === 'pending' || e.status === 'approved') && (
                          <button onClick={() => handleReverse(e.id)} className="text-rose-600 hover:underline text-[12px]">{fr ? 'Inverser' : 'Reverse'}</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Rules */}
        <div className="section-card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-text-primary">{fr ? 'Règles de commission' : 'Commission rules'}</h2>
            <button
              onClick={() => setEditingRule({ name: '', base_kind: 'percent', base_percent: 10, base_value_cents: null, product_overrides: [], performance_tiers: [], bonuses: [], attribution: { mode: 'solo' }, assigned_user_ids: [], is_active: true, priority: 0 })}
              className="glass-button inline-flex items-center gap-1.5"
            >
              <Plus size={14} /> {fr ? 'Nouvelle règle' : 'New rule'}
            </button>
          </div>
          {rulesQ.isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="animate-spin text-text-tertiary" size={20} /></div>
          ) : rules.length === 0 ? (
            <div className="text-center py-8 text-[13px] text-text-tertiary">
              {fr ? 'Aucune règle. Créez-en une pour commencer.' : 'No rules yet. Create one to get started.'}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {rules.map((r) => (
                <RuleCard key={r.id} rule={r} team={team} onEdit={() => setEditingRule(r)} onDelete={() => handleDeleteRule(r.id)} fr={fr} />
              ))}
            </div>
          )}
        </div>

        {/* Settings */}
        <div className="section-card p-5">
          <h2 className="text-base font-semibold text-text-primary mb-4 flex items-center gap-2">
            <SettingsIcon size={16} /> {fr ? 'Paramètres' : 'Settings'}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-2xl">
            <div>
              <label className="block text-[12px] font-medium text-text-secondary mb-1">
                {fr ? 'Si une facture est remboursée' : 'When an invoice is refunded'}
              </label>
              <select
                value={settings?.reversal_policy ?? 'alert'}
                onChange={(e) => handleSettingsChange({ reversal_policy: e.target.value as any })}
                className="glass-input w-full"
              >
                <option value="alert">{fr ? 'Alerter — décider manuellement' : 'Alert — decide manually'}</option>
                <option value="auto">{fr ? 'Inverser automatiquement' : 'Auto-reverse'}</option>
                <option value="keep">{fr ? 'Garder la commission' : 'Keep the commission'}</option>
              </select>
            </div>
            <div>
              <label className="block text-[12px] font-medium text-text-secondary mb-1">
                {fr ? 'Règle par défaut' : 'Default rule'}
              </label>
              <select
                value={settings?.default_rule_id ?? ''}
                onChange={(e) => handleSettingsChange({ default_rule_id: e.target.value || null })}
                className="glass-input w-full"
              >
                <option value="">{fr ? 'Aucune' : 'None'}</option>
                {rules.map((r) => (<option key={r.id} value={r.id}>{r.name}</option>))}
              </select>
            </div>
          </div>
        </div>

        {editingRule && (
          <RuleEditorModal
            rule={editingRule}
            team={team}
            onClose={() => setEditingRule(null)}
            onSaved={() => { setEditingRule(null); qc.invalidateQueries({ queryKey: ['commission-rules'] }); }}
            fr={fr}
          />
        )}
      </div>
    </PermissionGate>
  );
}

// ── KpiCard ──
function KpiCard({ icon: Icon, label, value, color }: { icon: any; label: string; value: string; color: 'amber'|'emerald'|'blue'|'rose' }) {
  const tones = {
    amber: 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300',
    emerald: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300',
    blue: 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300',
    rose: 'bg-rose-50 text-rose-700 dark:bg-rose-900/20 dark:text-rose-300',
  }[color];
  return (
    <div className="section-card p-4">
      <div className={cn('inline-flex items-center justify-center w-9 h-9 rounded-lg mb-3', tones)}>
        <Icon size={18} />
      </div>
      <p className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">{label}</p>
      <p className="text-[22px] font-bold text-text-primary tabular-nums mt-1">{value}</p>
    </div>
  );
}

// ── RuleCard ──
function RuleCard({ rule, team, onEdit, onDelete, fr }: { rule: FsCommissionRule; team: any[]; onEdit: () => void; onDelete: () => void; fr: boolean }) {
  const assignedNames = (rule.assigned_user_ids || []).map((id) => team.find((m: any) => m.user_id === id)?.full_name || '').filter(Boolean);
  const baseLabel = rule.base_kind === 'flat'
    ? `${fmt((rule.base_value_cents ?? 0) / 100)} ${fr ? 'forfait' : 'flat'}`
    : `${rule.base_percent ?? 0}%`;
  return (
    <div className="rounded-xl border border-outline bg-surface p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-text-primary truncate">{rule.name}</p>
          {rule.description && <p className="text-[12px] text-text-tertiary mt-0.5">{rule.description}</p>}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={onEdit} className="p-1.5 rounded-lg hover:bg-surface-secondary text-text-tertiary"><Pencil size={13} /></button>
          <button onClick={onDelete} className="p-1.5 rounded-lg hover:bg-rose-50 text-rose-600"><Trash2 size={13} /></button>
        </div>
      </div>
      <div className="mt-3 space-y-1.5 text-[12px]">
        <Row label={fr ? 'Base' : 'Base'} value={baseLabel} />
        {(rule.product_overrides?.length ?? 0) > 0 && <Row label={fr ? 'Taux produit' : 'Product rates'} value={`${rule.product_overrides.length} ${fr ? 'cat.' : 'cat.'}`} />}
        {(rule.performance_tiers?.length ?? 0) > 0 && <Row label={fr ? 'Paliers' : 'Tiers'} value={`${rule.performance_tiers.length}`} />}
        {(rule.bonuses?.length ?? 0) > 0 && <Row label={fr ? 'Bonus' : 'Bonuses'} value={`${rule.bonuses.length}`} />}
        <Row label={fr ? 'Attribution' : 'Attribution'} value={rule.attribution?.mode === 'split' ? (fr ? 'Partagée' : 'Split') : (fr ? 'Solo' : 'Solo')} />
        <Row label={fr ? 'Reps' : 'Reps'} value={assignedNames.length > 0 ? assignedNames.join(', ') : (fr ? 'Aucun' : 'None')} />
      </div>
    </div>
  );
}
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-text-tertiary">{label}</span>
      <span className="text-text-primary font-medium">{value}</span>
    </div>
  );
}

// ── RuleEditorModal ──
function RuleEditorModal({ rule, team, onClose, onSaved, fr }: {
  rule: Partial<FsCommissionRule>; team: any[]; onClose: () => void; onSaved: () => void; fr: boolean;
}) {
  const [form, setForm] = useState<Partial<FsCommissionRule>>(rule);
  const [saving, setSaving] = useState(false);

  function update<K extends keyof FsCommissionRule>(key: K, value: FsCommissionRule[K]) {
    setForm((p) => ({ ...p, [key]: value }));
  }

  async function save() {
    if (!form.name?.trim()) { toast.error(fr ? 'Le nom est requis' : 'Name required'); return; }
    setSaving(true);
    try {
      if (form.id) await updateCommissionRule(form.id, form);
      else await createCommissionRule(form);
      toast.success(fr ? 'Règle enregistrée' : 'Rule saved');
      onSaved();
    } catch (e: any) { toast.error(e.message); }
    finally { setSaving(false); }
  }

  const overrides = form.product_overrides ?? [];
  const tiers = form.performance_tiers ?? [];
  const bonuses = form.bonuses ?? [];
  const splits = form.attribution?.splits ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-surface rounded-2xl border border-outline shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-outline sticky top-0 bg-surface z-10">
          <h3 className="text-base font-semibold">{form.id ? (fr ? 'Modifier la règle' : 'Edit rule') : (fr ? 'Nouvelle règle' : 'New rule')}</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-surface-tertiary"><X size={16} /></button>
        </div>

        <div className="p-5 space-y-5">
          {/* Name + description */}
          <div className="space-y-3">
            <input
              type="text" placeholder={fr ? 'Nom de la règle' : 'Rule name'}
              value={form.name ?? ''} onChange={(e) => update('name', e.target.value)}
              className="glass-input w-full font-semibold"
            />
            <textarea
              placeholder={fr ? 'Description (optionnelle)' : 'Description (optional)'}
              value={form.description ?? ''} onChange={(e) => update('description', e.target.value)}
              className="glass-input w-full" rows={2}
            />
          </div>

          {/* Base */}
          <Section title={fr ? 'Taux de base' : 'Base rate'}>
            <div className="flex gap-3 items-center">
              <select value={form.base_kind ?? 'percent'} onChange={(e) => update('base_kind', e.target.value as any)} className="glass-input">
                <option value="percent">{fr ? '% du revenu' : '% of revenue'}</option>
                <option value="flat">{fr ? 'Montant fixe' : 'Flat amount'}</option>
              </select>
              {form.base_kind === 'flat' ? (
                <div className="flex items-center gap-1.5 flex-1">
                  <span className="text-text-tertiary">$</span>
                  <input type="number" min={0} step={1}
                    value={form.base_value_cents != null ? (form.base_value_cents / 100) : ''}
                    onChange={(e) => update('base_value_cents', e.target.value ? Math.round(parseFloat(e.target.value) * 100) : null)}
                    className="glass-input flex-1" placeholder="50" />
                  <span className="text-text-tertiary text-[12px]">/ {fr ? 'vente' : 'sale'}</span>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 flex-1">
                  <input type="number" min={0} max={100} step={0.5}
                    value={form.base_percent ?? ''} onChange={(e) => update('base_percent', e.target.value ? parseFloat(e.target.value) : null)}
                    className="glass-input flex-1" placeholder="10" />
                  <span className="text-text-tertiary">%</span>
                </div>
              )}
            </div>
          </Section>

          {/* Product overrides */}
          <Section
            title={fr ? 'Taux par catégorie de produit' : 'Per-product category rates'}
            onAdd={() => update('product_overrides', [...overrides, { category: '', base_kind: 'percent', base_percent: 10, base_value_cents: null }])}
          >
            {overrides.length === 0 && <p className="text-[12px] text-text-tertiary">{fr ? 'Aucun. Tous les produits utilisent le taux de base.' : 'None. All products use the base rate.'}</p>}
            {overrides.map((o, i) => (
              <div key={i} className="flex items-center gap-2 mb-2">
                <input value={o.category} onChange={(e) => updateArr(overrides, i, { ...o, category: e.target.value }, (next) => update('product_overrides', next))}
                  placeholder={fr ? 'Catégorie' : 'Category'} className="glass-input flex-1" />
                <select value={o.base_kind} onChange={(e) => updateArr(overrides, i, { ...o, base_kind: e.target.value as any }, (next) => update('product_overrides', next))} className="glass-input">
                  <option value="percent">%</option><option value="flat">$</option>
                </select>
                <input type="number" min={0}
                  value={o.base_kind === 'percent' ? (o.base_percent ?? '') : (o.base_value_cents != null ? o.base_value_cents/100 : '')}
                  onChange={(e) => {
                    const v = e.target.value ? parseFloat(e.target.value) : null;
                    updateArr(overrides, i, o.base_kind === 'percent' ? { ...o, base_percent: v } : { ...o, base_value_cents: v != null ? Math.round(v*100) : null }, (next) => update('product_overrides', next));
                  }}
                  className="glass-input w-24" />
                <button onClick={() => update('product_overrides', overrides.filter((_, j) => j !== i))} className="p-1.5 text-rose-600 hover:bg-rose-50 rounded"><Trash2 size={13} /></button>
              </div>
            ))}
          </Section>

          {/* Performance tiers */}
          <Section
            title={fr ? 'Paliers de performance' : 'Performance tiers'}
            onAdd={() => update('performance_tiers', [...tiers, { metric: 'revenue_cents', threshold: 1000000, modifier_percent: 2, modifier_flat_cents: null }])}
          >
            {tiers.length === 0 && <p className="text-[12px] text-text-tertiary">{fr ? 'Aucun palier.' : 'No tiers.'}</p>}
            {tiers.map((t, i) => (
              <div key={i} className="flex items-center gap-2 mb-2 text-[12px]">
                <span className="text-text-tertiary">{fr ? 'Si' : 'When'}</span>
                <select value={t.metric} onChange={(e) => updateArr(tiers, i, { ...t, metric: e.target.value as any }, (next) => update('performance_tiers', next))} className="glass-input">
                  <option value="revenue_cents">{fr ? 'Revenus du mois' : 'Monthly revenue'}</option>
                  <option value="sale_count">{fr ? 'Nb de ventes' : 'Sale count'}</option>
                </select>
                <span className="text-text-tertiary">≥</span>
                <input type="number" min={0}
                  value={t.metric === 'revenue_cents' ? t.threshold / 100 : t.threshold}
                  onChange={(e) => {
                    const v = e.target.value ? parseFloat(e.target.value) : 0;
                    updateArr(tiers, i, { ...t, threshold: t.metric === 'revenue_cents' ? Math.round(v*100) : Math.round(v) }, (next) => update('performance_tiers', next));
                  }} className="glass-input w-24" />
                <span className="text-text-tertiary">{fr ? '→ bonus' : '→ bonus'}</span>
                <input type="number" placeholder="%" value={t.modifier_percent ?? ''}
                  onChange={(e) => updateArr(tiers, i, { ...t, modifier_percent: e.target.value ? parseFloat(e.target.value) : null }, (next) => update('performance_tiers', next))}
                  className="glass-input w-16" />
                <button onClick={() => update('performance_tiers', tiers.filter((_, j) => j !== i))} className="p-1.5 text-rose-600 hover:bg-rose-50 rounded"><Trash2 size={13} /></button>
              </div>
            ))}
          </Section>

          {/* Bonuses */}
          <Section
            title={fr ? 'Bonus conditionnels' : 'Conditional bonuses'}
            onAdd={() => update('bonuses', [...bonuses, { condition: 'min_sale_amount', value: 500000, modifier_percent: 5, modifier_flat_cents: null }])}
          >
            {bonuses.length === 0 && <p className="text-[12px] text-text-tertiary">{fr ? 'Aucun bonus.' : 'No bonuses.'}</p>}
            {bonuses.map((b, i) => (
              <div key={i} className="flex items-center gap-2 mb-2 text-[12px]">
                <select value={b.condition} onChange={(e) => updateArr(bonuses, i, { ...b, condition: e.target.value as any }, (next) => update('bonuses', next))} className="glass-input">
                  <option value="min_sale_amount">{fr ? 'Vente minimum' : 'Min sale amount'}</option>
                </select>
                <span className="text-text-tertiary">≥ $</span>
                <input type="number" min={0} value={b.value / 100}
                  onChange={(e) => updateArr(bonuses, i, { ...b, value: e.target.value ? Math.round(parseFloat(e.target.value)*100) : 0 }, (next) => update('bonuses', next))}
                  className="glass-input w-24" />
                <span className="text-text-tertiary">→ +</span>
                <input type="number" value={b.modifier_percent ?? ''}
                  onChange={(e) => updateArr(bonuses, i, { ...b, modifier_percent: e.target.value ? parseFloat(e.target.value) : null }, (next) => update('bonuses', next))}
                  className="glass-input w-16" />
                <span className="text-text-tertiary">%</span>
                <button onClick={() => update('bonuses', bonuses.filter((_, j) => j !== i))} className="p-1.5 text-rose-600 hover:bg-rose-50 rounded"><Trash2 size={13} /></button>
              </div>
            ))}
          </Section>

          {/* Attribution */}
          <Section title={fr ? 'Attribution' : 'Attribution'}>
            <div className="flex items-center gap-3 mb-2">
              <label className="text-[12px] flex items-center gap-1.5">
                <input type="radio" checked={form.attribution?.mode !== 'split'} onChange={() => update('attribution', { mode: 'solo' })} />
                {fr ? 'Solo (au rep)' : 'Solo (rep only)'}
              </label>
              <label className="text-[12px] flex items-center gap-1.5">
                <input type="radio" checked={form.attribution?.mode === 'split'} onChange={() => update('attribution', { mode: 'split', splits: splits.length ? splits : [{ user_id: null, pct: 80 }, { user_id: null, pct: 20 }] })} />
                {fr ? 'Partagée' : 'Split'}
              </label>
            </div>
            {form.attribution?.mode === 'split' && (
              <div className="space-y-2">
                {splits.map((s, i) => (
                  <div key={i} className="flex items-center gap-2 text-[12px]">
                    <select value={s.user_id ?? ''} onChange={(e) => updateArr(splits, i, { ...s, user_id: e.target.value || null }, (next) => update('attribution', { ...form.attribution!, splits: next }))} className="glass-input flex-1">
                      <option value="">{fr ? 'Sélectionner un rep' : 'Select rep'}</option>
                      {team.map((m: any) => (<option key={m.user_id} value={m.user_id}>{m.full_name || m.email}</option>))}
                    </select>
                    <input type="number" min={0} max={100} value={s.pct}
                      onChange={(e) => updateArr(splits, i, { ...s, pct: parseFloat(e.target.value) || 0 }, (next) => update('attribution', { ...form.attribution!, splits: next }))}
                      className="glass-input w-20" />
                    <span>%</span>
                    <button onClick={() => update('attribution', { ...form.attribution!, splits: splits.filter((_, j) => j !== i) })} className="p-1.5 text-rose-600 hover:bg-rose-50 rounded"><Trash2 size={13} /></button>
                  </div>
                ))}
                <button onClick={() => update('attribution', { ...form.attribution!, splits: [...splits, { user_id: null, pct: 0 }] })} className="text-[12px] text-primary hover:underline inline-flex items-center gap-1"><Plus size={12} /> {fr ? 'Ajouter un rep' : 'Add rep'}</button>
              </div>
            )}
          </Section>

          {/* Assigned reps */}
          <Section title={<span className="flex items-center gap-1.5"><UsersIcon size={13} /> {fr ? 'Reps assignés à cette règle' : 'Reps assigned to this rule'}</span>}>
            <p className="text-[11px] text-text-tertiary mb-2">{fr ? 'Si vide, utiliser la règle par défaut.' : 'If empty, the default rule applies.'}</p>
            <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto">
              {team.map((m: any) => {
                const on = (form.assigned_user_ids ?? []).includes(m.user_id);
                return (
                  <label key={m.user_id} className={cn('flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer text-[12px]', on ? 'bg-primary/10 text-primary' : 'hover:bg-surface-tertiary')}>
                    <input type="checkbox" checked={on} onChange={() => {
                      const cur = form.assigned_user_ids ?? [];
                      update('assigned_user_ids', on ? cur.filter((id) => id !== m.user_id) : [...cur, m.user_id]);
                    }} />
                    {m.full_name || m.email}
                  </label>
                );
              })}
            </div>
          </Section>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-outline sticky bottom-0 bg-surface">
          <button onClick={onClose} className="glass-button">{fr ? 'Annuler' : 'Cancel'}</button>
          <button onClick={save} disabled={saving} className="glass-button-primary inline-flex items-center gap-1.5">
            {saving && <Loader2 size={13} className="animate-spin" />}
            {fr ? 'Enregistrer' : 'Save'}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

function Section({ title, children, onAdd }: { title: React.ReactNode; children: React.ReactNode; onAdd?: () => void }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-[12px] font-semibold uppercase tracking-wider text-text-tertiary">{title}</h4>
        {onAdd && <button onClick={onAdd} className="text-[12px] text-primary hover:underline inline-flex items-center gap-1"><Plus size={12} /> {('Add')}</button>}
      </div>
      <div>{children}</div>
    </div>
  );
}

function updateArr<T>(arr: T[], idx: number, value: T, set: (next: T[]) => void) {
  const next = [...arr]; next[idx] = value; set(next);
}
