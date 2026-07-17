import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, Star, Check, Loader2, Pencil, X, MapPin, Info, DollarSign } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { cn } from '../lib/utils';
import { supabase } from '../lib/supabase';
import { useTranslation } from '../i18n';
import { getCurrentOrgIdOrThrow } from '../lib/orgApi';
import {
  listTaxes, setupTaxPreset, updateTaxConfig, deleteTaxConfig, deleteTaxGroup, setDefaultTaxGroup, createTaxConfig, updateTaxRegistrationNumber, calculateTaxes,
  type TaxConfig, type TaxGroup, type TaxGroupItem, type TaxPreset,
} from '../lib/taxApi';

function formatMoney(cents: number, currency: string = 'CAD') {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency }).format(cents / 100);
}

// Example formats for Canadian registration numbers — typos here end up on
// official invoices, so show the expected shape.
function regNumPlaceholder(taxName: string, fr: boolean): string {
  const n = taxName.toUpperCase();
  if (n.includes('TVQ') || n.includes('QST')) return fr ? 'ex. 1234567890 TQ0001' : 'e.g. 1234567890 TQ0001';
  if (n.includes('TPS') || n.includes('GST') || n.includes('HST') || n.includes('TVH')) return fr ? 'ex. 123456789 RT0001' : 'e.g. 123456789 RT0001';
  return fr ? "Numéro d'enregistrement" : 'Registration number';
}

export default function TaxSettings() {
  const navigate = useNavigate();
  const { language } = useTranslation();
  const fr = language === 'fr';
  const [loading, setLoading] = useState(true);
  const [configs, setConfigs] = useState<TaxConfig[]>([]);
  const [groups, setGroups] = useState<TaxGroup[]>([]);
  const [groupItems, setGroupItems] = useState<TaxGroupItem[]>([]);
  const [presets, setPresets] = useState<TaxPreset[]>([]);
  const [busy, setBusy] = useState(false);
  const [showAddRegion, setShowAddRegion] = useState(false);
  const [showCustomTax, setShowCustomTax] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customRate, setCustomRate] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editRate, setEditRate] = useState('');
  const [editingNameId, setEditingNameId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editingRegNumId, setEditingRegNumId] = useState<string | null>(null);
  const [editRegNum, setEditRegNum] = useState('');
  // Org display currency (Company Settings > Regional) — was hardcoded CAD.
  const [currency, setCurrency] = useState('CAD');

  const load = useCallback(async () => {
    try {
      const data = await listTaxes();
      setConfigs(data.configs);
      setGroups(data.groups);
      setGroupItems(data.group_items);
      setPresets(data.presets);
      getCurrentOrgIdOrThrow().then((orgId) =>
        supabase
          .from('company_settings')
          .select('currency')
          .eq('org_id', orgId)
          .limit(1)
          .maybeSingle()
          .then(({ data: cs }) => { if (cs?.currency) setCurrency(cs.currency); })
      ).catch(() => {});
    } catch (err: any) {
      toast.error(err.message || (fr ? 'Échec du chargement des taxes' : 'Failed to load taxes'));
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSetupPreset = async (key: string) => {
    setBusy(true);
    try {
      await setupTaxPreset(key, groups.length === 0);
      toast.success(fr ? 'Région de taxe ajoutée' : 'Tax region added');
      await load();
      setShowAddRegion(false);
    } catch (err: any) { toast.error(err.message); }
    finally { setBusy(false); }
  };

  const handleSetDefault = async (id: string) => {
    setBusy(true);
    try {
      await setDefaultTaxGroup(id);
      toast.success(fr ? 'Région par défaut mise à jour' : 'Default tax region updated');
      await load();
    } catch (err: any) { toast.error(err.message); }
    finally { setBusy(false); }
  };

  const handleDeleteGroup = async (id: string, name: string) => {
    if (!confirm(fr ? `Supprimer la région « ${name} » et toutes ses taxes ?` : `Delete tax region "${name}" and all its taxes?`)) return;
    setBusy(true);
    try {
      await deleteTaxGroup(id);
      toast.success(fr ? 'Région de taxe supprimée' : 'Tax region removed');
      await load();
    } catch (err: any) { toast.error(err.message); }
    finally { setBusy(false); }
  };

  const handleToggleTax = async (config: TaxConfig) => {
    try {
      await updateTaxConfig(config.id, { is_active: !config.is_active });
      setConfigs(prev => prev.map(c => c.id === config.id ? { ...c, is_active: !c.is_active } : c));
      toast.success(config.is_active
        ? (fr ? `${config.name} désactivée` : `${config.name} disabled`)
        : (fr ? `${config.name} activée` : `${config.name} enabled`));
    } catch (err: any) { toast.error(err.message); }
  };

  const handleSaveRate = async (config: TaxConfig) => {
    const newRate = parseFloat(editRate);
    if (isNaN(newRate) || newRate < 0 || newRate > 100) { toast.error(fr ? 'Le taux doit être entre 0 % et 100 %' : 'Rate must be between 0% and 100%'); return; }
    try {
      await updateTaxConfig(config.id, { rate: newRate });
      setConfigs(prev => prev.map(c => c.id === config.id ? { ...c, rate: newRate } : c));
      setEditingId(null);
      toast.success(fr ? 'Taux mis à jour' : 'Rate updated');
    } catch (err: any) { toast.error(err.message); }
  };

  const handleSaveName = async (config: TaxConfig) => {
    if (!editName.trim()) { toast.error(fr ? 'Nom requis' : 'Name required'); return; }
    try {
      await updateTaxConfig(config.id, { name: editName.trim() });
      setConfigs(prev => prev.map(c => c.id === config.id ? { ...c, name: editName.trim() } : c));
      setEditingNameId(null);
      toast.success(fr ? 'Nom mis à jour' : 'Name updated');
    } catch (err: any) { toast.error(err.message); }
  };

  const handleSaveRegNum = async (config: TaxConfig) => {
    try {
      await updateTaxRegistrationNumber(config.id, editRegNum.trim());
      setConfigs(prev => prev.map(c => c.id === config.id ? { ...c, registration_number: editRegNum.trim() || null } : c));
      setEditingRegNumId(null);
      toast.success(fr ? "Numéro d'enregistrement mis à jour" : 'Registration number updated');
    } catch (err: any) { toast.error(err.message); }
  };

  const handleDeleteTax = async (config: TaxConfig) => {
    if (!confirm(fr ? `Supprimer la taxe « ${config.name} » ?` : `Remove tax "${config.name}"?`)) return;
    try {
      // Real delete (was a deactivate stub — the "removed" tax reappeared
      // struck-through on the next load).
      await deleteTaxConfig(config.id);
      setConfigs(prev => prev.filter(c => c.id !== config.id));
      toast.success(fr ? `${config.name} supprimée` : `${config.name} removed`);
      await load();
    } catch (err: any) { toast.error(err.message); }
  };

  const handleAddCustom = async () => {
    if (!customName.trim()) { toast.error(fr ? 'Nom requis' : 'Name required'); return; }
    const rate = parseFloat(customRate);
    if (isNaN(rate) || rate < 0) { toast.error(fr ? 'Taux invalide' : 'Invalid rate'); return; }
    setBusy(true);
    try {
      await createTaxConfig({ name: customName.trim(), rate });
      toast.success(fr ? 'Taxe personnalisée ajoutée' : 'Custom tax added');
      setCustomName(''); setCustomRate(''); setShowCustomTax(false);
      await load();
    } catch (err: any) { toast.error(err.message); }
    finally { setBusy(false); }
  };

  // Build region data
  const setupRegions = groups.map(g => {
    const taxes = groupItems
      .filter(i => i.tax_group_id === g.id)
      .map(i => i.tax_configs || configs.find(c => c.id === i.tax_config_id))
      .filter(Boolean) as TaxConfig[];
    // Use latest config state (toggle may have changed is_active)
    const enrichedTaxes = taxes.map(t => configs.find(c => c.id === t.id) || t);
    const activeTaxes = enrichedTaxes.filter(t => t.is_active);
    const combinedRate = activeTaxes.reduce((s, t) => s + t.rate, 0);
    return { group: g, taxes: enrichedTaxes, activeTaxes, combinedRate };
  });

  const availablePresets = presets.filter(p => !groups.some(g => g.region === p.region) && p.key !== 'NONE');

  // Preview calc — same engine as quotes/invoices so compound taxes match.
  const defaultRegion = setupRegions.find(r => r.group.is_default);
  const previewSubtotal = 100000; // $1,000
  const previewTaxes = defaultRegion
    ? calculateTaxes(previewSubtotal, 0, defaultRegion.activeTaxes).map(t => ({ name: t.name, amount: t.amount_cents }))
    : [];
  const previewTotal = previewSubtotal + previewTaxes.reduce((s, t) => s + t.amount, 0);

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <h1 className="text-[22px] font-bold text-text-primary tracking-tight">{fr ? 'Paramètres de taxe' : 'Tax Settings'}</h1>
          <p className="text-[12px] text-text-tertiary mt-0.5">
            {fr ? 'Configurez les taux de taxe par région. Appliqués automatiquement aux nouveaux devis, factures et jobs.' : 'Configure tax rates by region. Auto-applied to all new quotes, invoices, and jobs.'}
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={24} className="animate-spin text-text-tertiary" />
        </div>
      ) : (
        <>
          {/* ── Info banner ── */}
          <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-primary/5 border border-primary/10">
            <Info size={16} className="text-primary shrink-0 mt-0.5" />
            <div className="text-[12px] text-text-secondary leading-relaxed">
              {fr ? <>Les taxes configurées ici sont <span className="font-semibold text-text-primary">appliquées automatiquement</span> aux nouveaux devis, factures et jobs. La région par défaut est utilisée quand aucune région client n'est détectée.</>
                : <>Taxes configured here are <span className="font-semibold text-text-primary">automatically applied</span> to all new quotes, invoices, and jobs. The default region is used when no specific client region is detected.</>}
            </div>
          </div>

          {/* ── Active Regions ── */}
          {setupRegions.length > 0 ? (
            <div className="space-y-3">
              {setupRegions.map(({ group, taxes, activeTaxes, combinedRate }) => (
                <div key={group.id} className="section-card overflow-hidden">
                  {/* Region header */}
                  <div className="px-5 py-3.5 flex items-center justify-between border-b border-outline/50">
                    <div className="flex items-center gap-2.5">
                      <MapPin size={14} className="text-text-tertiary" />
                      <span className="text-[14px] font-semibold text-text-primary">{group.name}</span>
                      {group.is_default && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-amber-100 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 text-[9px] font-bold uppercase tracking-wider">
                          <Star size={8} className="fill-current" /> {fr ? 'Défaut' : 'Default'}
                        </span>
                      )}
                      {activeTaxes.length > 0 && (
                        <span className="text-[11px] text-text-tertiary font-medium tabular-nums">
                          {combinedRate.toFixed(3)}% {fr ? 'combiné' : 'combined'}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {!group.is_default && (
                        <button onClick={() => handleSetDefault(group.id)} disabled={busy}
                          className="text-[11px] text-text-tertiary hover:text-amber-500 transition-colors flex items-center gap-1">
                          <Star size={10} /> {fr ? 'Définir par défaut' : 'Set default'}
                        </button>
                      )}
                      <button onClick={() => handleDeleteGroup(group.id, group.name)} disabled={busy}
                        className="text-text-tertiary hover:text-red-500 transition-colors p-1">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>

                  {/* Tax lines */}
                  <div className="divide-y divide-outline/30">
                    {taxes.map(tax => (
                      <div key={tax.id} className="px-5 py-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <button onClick={() => handleToggleTax(tax)}
                              className={cn('w-8 h-[18px] rounded-full transition-colors relative', tax.is_active ? 'bg-primary' : 'bg-surface-tertiary')}>
                              <span className={cn('absolute top-[2px] w-[14px] h-[14px] rounded-full bg-surface-card transition-all shadow-sm', tax.is_active ? 'left-[17px]' : 'left-[2px]')} />
                            </button>
                            <div className="flex items-center gap-1.5">
                              {editingNameId === tax.id ? (
                                <div className="flex items-center gap-1">
                                  <input type="text" value={editName} onChange={e => setEditName(e.target.value)}
                                    className="glass-input w-28 text-[12px]" autoFocus
                                    onKeyDown={e => { if (e.key === 'Enter') handleSaveName(tax); if (e.key === 'Escape') setEditingNameId(null); }} />
                                  <button onClick={() => handleSaveName(tax)} className="p-0.5 text-primary"><Check size={12} /></button>
                                  <button onClick={() => setEditingNameId(null)} className="p-0.5 text-text-tertiary"><X size={12} /></button>
                                </div>
                              ) : (
                                <button onClick={() => { setEditingNameId(tax.id); setEditName(tax.name); }}
                                  className={cn('text-[13px] font-medium group flex items-center gap-1', tax.is_active ? 'text-text-primary' : 'text-text-tertiary line-through')}>
                                  {tax.name}
                                  <Pencil size={10} className="md:opacity-0 md:group-hover:opacity-100 text-text-tertiary" />
                                </button>
                              )}
                              {tax.is_compound && <span className="text-[10px] text-text-tertiary">(compound)</span>}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {editingId === tax.id ? (
                              <div className="flex items-center gap-1.5">
                                <input type="number" step="0.001" value={editRate}
                                  onChange={e => setEditRate(e.target.value)}
                                  className="glass-input w-20 text-[12px] text-right" autoFocus
                                  onKeyDown={e => { if (e.key === 'Enter') handleSaveRate(tax); if (e.key === 'Escape') setEditingId(null); }} />
                                <span className="text-[12px] text-text-tertiary">%</span>
                                <button onClick={() => handleSaveRate(tax)} className="p-1 text-primary hover:text-primary/80"><Check size={13} /></button>
                                <button onClick={() => setEditingId(null)} className="p-1 text-text-tertiary hover:text-text-primary"><X size={13} /></button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-2">
                                <button onClick={() => { setEditingId(tax.id); setEditRate(String(tax.rate)); }}
                                  className="flex items-center gap-1.5 text-[13px] text-text-secondary hover:text-text-primary transition-colors group">
                                  <span className="tabular-nums font-medium">{tax.rate}%</span>
                                  <Pencil size={11} className="md:opacity-0 md:group-hover:opacity-100 transition-opacity" />
                                </button>
                                <button onClick={() => handleDeleteTax(tax)}
                                  className="p-1 text-text-tertiary hover:text-red-500 md:opacity-0 md:group-hover:opacity-100 transition-all">
                                  <Trash2 size={11} />
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                        {/* Registration number */}
                        <div className="ml-11 mt-1">
                          {editingRegNumId === tax.id ? (
                            <div className="flex items-center gap-1.5">
                              <input type="text" value={editRegNum} onChange={e => setEditRegNum(e.target.value)}
                                className="glass-input w-52 text-[11px]" placeholder={regNumPlaceholder(tax.name, fr)} autoFocus
                                onKeyDown={e => { if (e.key === 'Enter') handleSaveRegNum(tax); if (e.key === 'Escape') setEditingRegNumId(null); }} />
                              <button onClick={() => handleSaveRegNum(tax)} className="p-0.5 text-primary"><Check size={11} /></button>
                              <button onClick={() => setEditingRegNumId(null)} className="p-0.5 text-text-tertiary"><X size={11} /></button>
                            </div>
                          ) : (
                            <button onClick={() => { setEditingRegNumId(tax.id); setEditRegNum(tax.registration_number || ''); }}
                              className="text-[11px] text-text-tertiary hover:text-text-secondary transition-colors flex items-center gap-1 group">
                              {tax.registration_number
                                ? <><span>{fr ? 'N°' : 'No.'} {tax.registration_number}</span><Pencil size={9} className="md:opacity-0 md:group-hover:opacity-100" /></>
                                : <><Plus size={9} /><span>{fr ? "Ajouter un numéro d'enregistrement" : 'Add registration number'}</span></>}
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                    {taxes.length === 0 && (
                      <div className="px-5 py-4 text-[12px] text-text-tertiary text-center">{fr ? 'Aucune taxe dans cette région' : 'No taxes in this region'}</div>
                    )}
                  </div>

                  {/* Combined rate footer */}
                  {activeTaxes.length > 0 && (
                    <div className="px-5 py-2.5 bg-surface-secondary/50 border-t border-outline/30 flex items-center justify-between text-[12px]">
                      <span className="text-text-tertiary">
                        {fr
                          ? `${activeTaxes.length} taxe${activeTaxes.length !== 1 ? 's' : ''} active${activeTaxes.length !== 1 ? 's' : ''}`
                          : `${activeTaxes.length} tax${activeTaxes.length !== 1 ? 'es' : ''} active`}
                      </span>
                      <span className="font-semibold text-text-primary tabular-nums">
                        {fr ? 'Combiné' : 'Combined'} : {combinedRate.toFixed(3)}%
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="section-card p-10 text-center">
              <MapPin size={32} className="text-text-tertiary/30 mx-auto mb-3" />
              <h3 className="text-[15px] font-semibold text-text-primary">{fr ? 'Aucune région de taxe configurée' : 'No tax regions configured'}</h3>
              <p className="text-[12px] text-text-tertiary mt-1 max-w-sm mx-auto">
                {fr
                  ? 'Sélectionnez votre région ci-dessous pour appliquer automatiquement les bonnes taxes aux devis, factures et jobs.'
                  : 'Select your business region below to automatically apply the correct taxes to quotes, invoices, and jobs.'}
              </p>
            </div>
          )}

          {/* ── Tax Preview Calculator ── */}
          {defaultRegion && defaultRegion.activeTaxes.length > 0 && (
            <div className="section-card p-5">
              <div className="flex items-center gap-2 mb-3">
                <DollarSign size={14} className="text-text-tertiary" />
                <p className="text-[13px] font-semibold text-text-primary">{fr ? 'Aperçu des taxes' : 'Tax Preview'}</p>
                <span className="text-[11px] text-text-tertiary">{fr ? 'sur une facture de $1,000' : 'on a $1,000 invoice'}</span>
              </div>
              <div className="bg-surface-secondary/50 rounded-lg p-4 space-y-1.5 text-[12px]">
                <div className="flex justify-between">
                  <span className="text-text-secondary">{fr ? 'Sous-total' : 'Subtotal'}</span>
                  <span className="tabular-nums font-medium text-text-primary">{formatMoney(previewSubtotal, currency)}</span>
                </div>
                {previewTaxes.map((t, i) => (
                  <div key={i} className="flex justify-between">
                    <span className="text-text-tertiary">{t.name}</span>
                    <span className="tabular-nums text-text-secondary">{formatMoney(t.amount, currency)}</span>
                  </div>
                ))}
                <div className="flex justify-between pt-1.5 mt-1 border-t border-outline/50 font-semibold text-[13px]">
                  <span className="text-text-primary">{fr ? 'Total' : 'Total'}</span>
                  <span className="tabular-nums text-text-primary">{formatMoney(previewTotal, currency)}</span>
                </div>
              </div>
            </div>
          )}

          {/* ── Add Region ── */}
          {showAddRegion ? (
            <div className="section-card p-5 space-y-5">
              <div className="flex items-center justify-between">
                <p className="text-[13px] font-semibold text-text-primary">{fr ? 'Ajouter une région de taxe' : 'Add Tax Region'}</p>
                <button onClick={() => setShowAddRegion(false)} className="p-1 text-text-tertiary hover:text-text-primary"><X size={14} /></button>
              </div>

              {/* Canada */}
              {availablePresets.filter(p => p.country === 'CA').length > 0 && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-text-tertiary mb-2">Canada</p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {availablePresets.filter(p => p.country === 'CA').map(p => (
                      <button key={p.key} onClick={() => handleSetupPreset(p.key)} disabled={busy}
                        className="text-left p-3 rounded-lg border border-outline hover:border-primary/30 hover:bg-primary/5 transition-all">
                        <p className="text-[12px] font-semibold text-text-primary">{p.name.split('(')[0].trim()}</p>
                        <p className="text-[10px] text-text-tertiary mt-0.5">{p.taxes.map(t => `${t.name} ${t.rate}%`).join(' + ') || 'No tax'}</p>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* USA */}
              {availablePresets.filter(p => p.country === 'US').length > 0 && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-text-tertiary mb-2">United States</p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {availablePresets.filter(p => p.country === 'US').map(p => (
                      <button key={p.key} onClick={() => handleSetupPreset(p.key)} disabled={busy}
                        className="text-left p-3 rounded-lg border border-outline hover:border-primary/30 hover:bg-primary/5 transition-all">
                        <p className="text-[12px] font-semibold text-text-primary">{p.name.split('(')[0].trim()}</p>
                        <p className="text-[10px] text-text-tertiary mt-0.5">{p.taxes.map(t => `${t.name} ${t.rate}%`).join(' + ') || 'No sales tax'}</p>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* International */}
              {availablePresets.filter(p => !['CA', 'US', ''].includes(p.country)).length > 0 && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-text-tertiary mb-2">International</p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {availablePresets.filter(p => !['CA', 'US', ''].includes(p.country)).map(p => (
                      <button key={p.key} onClick={() => handleSetupPreset(p.key)} disabled={busy}
                        className="text-left p-3 rounded-lg border border-outline hover:border-primary/30 hover:bg-primary/5 transition-all">
                        <p className="text-[12px] font-semibold text-text-primary">{p.name.split('(')[0].trim()}</p>
                        <p className="text-[10px] text-text-tertiary mt-0.5">{p.taxes.map(t => `${t.name} ${t.rate}%`).join(' + ')}</p>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button onClick={() => setShowAddRegion(true)}
                className="glass-button inline-flex items-center gap-1.5 text-[13px]">
                <Plus size={14} /> {fr ? 'Ajouter une région' : 'Add Region'}
              </button>
              {!showCustomTax && (
                <button onClick={() => setShowCustomTax(true)}
                  className="glass-button inline-flex items-center gap-1.5 text-[13px]">
                  <Plus size={14} /> {fr ? 'Taxe personnalisée' : 'Custom Tax'}
                </button>
              )}
            </div>
          )}

          {/* ── Custom Tax ── */}
          {showCustomTax && (
            <div className="section-card p-5">
              <div className="flex items-center justify-between mb-3">
                <p className="text-[13px] font-semibold text-text-primary">{fr ? 'Ajouter une taxe personnalisée' : 'Add Custom Tax'}</p>
                <button onClick={() => setShowCustomTax(false)} className="p-1 text-text-tertiary hover:text-text-primary"><X size={14} /></button>
              </div>
              <p className="text-[11px] text-text-tertiary mb-3">
                {fr
                  ? 'Cette taxe sera ajoutée à votre région par défaut et appliquée aux nouveaux documents.'
                  : 'This tax will be added to your default region and applied to all new documents.'}
              </p>
              <div className="flex items-end gap-3">
                <div className="flex-1">
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary block mb-1">{fr ? 'Nom' : 'Name'}</label>
                  <input type="text" value={customName} onChange={e => setCustomName(e.target.value)}
                    className="glass-input w-full text-[13px]" placeholder={fr ? 'ex. Taxe de service' : 'e.g. Service Tax'}
                    onKeyDown={e => { if (e.key === 'Enter') handleAddCustom(); }} />
                </div>
                <div className="w-28">
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary block mb-1">{fr ? 'Taux %' : 'Rate %'}</label>
                  <input type="number" step="0.001" value={customRate} onChange={e => setCustomRate(e.target.value)}
                    className="glass-input w-full text-[13px]" placeholder="0"
                    onKeyDown={e => { if (e.key === 'Enter') handleAddCustom(); }} />
                </div>
                <button onClick={handleAddCustom} disabled={busy || !customName.trim()}
                  className={cn('glass-button-primary text-[13px] px-4 py-2', (!customName.trim() || busy) && 'opacity-50')}>
                  {fr ? 'Ajouter' : 'Add'}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
