import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Search, X, Plus, Package, Check, Loader2, Minus } from 'lucide-react';
import { cn, formatCurrency } from '../lib/utils';
import { listPredefinedServices, createPredefinedService, PredefinedService, CatalogItemType } from '../lib/servicesApi';
import { useTranslation } from '../i18n';

interface ServicePickerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (service: PredefinedService) => void;
  /** Called when user toggles off an already-added service */
  onRemove?: (serviceId: string) => void;
  /** IDs of services already added (to show check marks) */
  addedIds?: Set<string>;
  /** When true, picking a service selects it and closes immediately (one item per line). */
  singleSelect?: boolean;
}

export default function ServicePicker({ isOpen, onClose, onSelect, onRemove, addedIds = new Set(), singleSelect = false }: ServicePickerProps) {
  const { t } = useTranslation();
  const tp = t.servicePicker;
  const [services, setServices] = useState<PredefinedService[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [newType, setNewType] = useState<CatalogItemType>('service');
  const [newName, setNewName] = useState('');
  const [newPrice, setNewPrice] = useState('');
  const [newCost, setNewCost] = useState('');
  const [newTaxable, setNewTaxable] = useState(true);
  const [newCategory, setNewCategory] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setSearch('');
    setShowCreate(false);
    loadServices();
  }, [isOpen]);

  async function loadServices() {
    setLoading(true);
    try {
      const data = await listPredefinedServices();
      setServices(data);
    } catch {
      setServices([]);
    } finally {
      setLoading(false);
    }
  }

  const filtered = useMemo(() => {
    if (!search.trim()) return services;
    const q = search.toLowerCase();
    return services.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.description || '').toLowerCase().includes(q) ||
        (s.category || '').toLowerCase().includes(q)
    );
  }, [services, search]);

  const categories = useMemo(() => {
    const cats = new Set<string>();
    filtered.forEach((s) => { if (s.category) cats.add(s.category); });
    return Array.from(cats).sort();
  }, [filtered]);

  const groupedByCategory = useMemo((): Record<string, PredefinedService[]> => {
    const groups: Record<string, PredefinedService[]> = {};
    filtered.forEach((s) => {
      const cat = s.category || 'Other';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(s);
    });
    return groups;
  }, [filtered]);

  const handleCreate = async () => {
    if (!newName.trim() || creating) return;
    setCreating(true);
    try {
      const priceCents = Math.round((parseFloat(newPrice.replace(',', '.')) || 0) * 100);
      const costValue = parseFloat(newCost.replace(',', '.'));
      const created = await createPredefinedService({
        name: newName.trim(),
        default_price_cents: priceCents,
        category: newCategory.trim() || undefined,
        item_type: newType,
        default_cost_cents: Number.isFinite(costValue) ? Math.round(costValue * 100) : null,
        taxable: newTaxable,
      });
      setServices((prev) => [...prev, created]);
      onSelect(created);
      setNewType('service');
      setNewName('');
      setNewPrice('');
      setNewCost('');
      setNewTaxable(true);
      setNewCategory('');
      setShowCreate(false);
      if (singleSelect) onClose();
    } catch {
      // silently fail
    } finally {
      setCreating(false);
    }
  };

  const handleToggle = (service: PredefinedService) => {
    if (singleSelect) {
      onSelect(service);
      onClose();
      return;
    }
    if (addedIds.has(service.id)) {
      onRemove?.(service.id);
    } else {
      onSelect(service);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 12, scale: 0.97 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-surface w-full max-w-lg max-h-[80vh] rounded-2xl border border-outline shadow-2xl flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-outline-subtle/60">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-primary text-white flex items-center justify-center">
                <Package size={16} />
              </div>
              <h2 className="text-[16px] font-bold text-text-primary">{tp.title}</h2>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-md text-text-tertiary hover:text-text-primary hover:bg-surface-secondary transition-colors">
              <X size={16} />
            </button>
          </div>

          {/* Search */}
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={tp.search}
              className="w-full bg-surface-secondary/60 border border-outline-subtle/60 rounded-lg pl-9 pr-3 py-2.5 text-[14px] text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-primary/40 transition-colors"
              autoFocus
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-primary">
                <X size={12} />
              </button>
            )}
          </div>

          {/* Create product/service — the only way to add a custom item */}
          <button
            onClick={() => setShowCreate((v) => !v)}
            className={cn(
              'mt-3 w-full inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-[13px] font-semibold border transition-colors',
              showCreate
                ? 'bg-primary/10 text-primary border-primary/30'
                : 'bg-primary text-white border-primary hover:bg-primary/90'
            )}
          >
            <Plus size={14} /> {tp.createProductService}
          </button>
        </div>

        {/* Create new service form */}
        <AnimatePresence>
          {showCreate && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden border-b border-outline-subtle/60"
            >
              <div className="p-4 space-y-3.5 bg-surface-secondary/30">
                <p className="text-xs font-medium text-text-tertiary uppercase tracking-wider">{tp.newProductService}</p>

                {/* Type — deux options fixes, une seule active à la fois */}
                <div className="space-y-1.5">
                  <label className="text-[11px] font-medium text-text-tertiary">{tp.typeLabel}</label>
                  <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-surface border border-outline-subtle">
                    {([
                      { key: 'product' as const, label: tp.typeProduct },
                      { key: 'service' as const, label: tp.typeService },
                    ]).map((opt) => (
                      <button
                        key={opt.key}
                        type="button"
                        onClick={() => setNewType(opt.key)}
                        className={cn(
                          'py-1.5 rounded-md text-[12.5px] font-semibold transition-colors',
                          newType === opt.key
                            ? 'bg-primary text-white shadow-sm'
                            : 'text-text-secondary hover:text-text-primary hover:bg-surface-secondary'
                        )}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[11px] font-medium text-text-tertiary">{tp.nameLabel} <span className="text-danger">*</span></label>
                  <input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder={newType === 'product' ? tp.typeProduct : tp.typeService}
                    className="w-full bg-surface border border-outline-subtle rounded-lg px-3 py-2 text-[13px] text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-primary/40"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-medium text-text-tertiary">{tp.priceLabel} <span className="text-danger">*</span></label>
                    <input
                      value={newPrice}
                      onChange={(e) => setNewPrice(e.target.value)}
                      placeholder="0.00"
                      type="text"
                      inputMode="decimal"
                      className="w-full bg-surface border border-outline-subtle rounded-lg px-3 py-2 text-[13px] text-text-primary placeholder:text-text-tertiary tabular-nums focus:outline-none focus:border-primary/40"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-medium text-text-tertiary">{tp.costLabel} <span className="normal-case text-text-tertiary/70">({tp.optionalTag})</span></label>
                    <input
                      value={newCost}
                      onChange={(e) => setNewCost(e.target.value)}
                      placeholder="0.00"
                      type="text"
                      inputMode="decimal"
                      className="w-full bg-surface border border-outline-subtle rounded-lg px-3 py-2 text-[13px] text-text-primary placeholder:text-text-tertiary tabular-nums focus:outline-none focus:border-primary/40"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2.5 items-end">
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-medium text-text-tertiary">{tp.categoryLabel} <span className="normal-case text-text-tertiary/70">({tp.optionalTag})</span></label>
                    <input
                      value={newCategory}
                      onChange={(e) => setNewCategory(e.target.value)}
                      placeholder={tp.categoryPlaceholder}
                      className="w-full bg-surface border border-outline-subtle rounded-lg px-3 py-2 text-[13px] text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-primary/40"
                    />
                  </div>
                  <label className="flex items-center gap-2.5 cursor-pointer rounded-lg border border-outline-subtle bg-surface px-3 py-2">
                    <input
                      type="checkbox"
                      checked={newTaxable}
                      onChange={(e) => setNewTaxable(e.target.checked)}
                      className="h-4 w-4 rounded accent-primary"
                    />
                    <span className="text-[13px] font-medium text-text-primary">{tp.taxableLabel}</span>
                  </label>
                </div>

                <div className="flex justify-end gap-2 pt-0.5">
                  <button onClick={() => setShowCreate(false)} className="glass-button !text-[12px] !py-1.5">{tp.cancel}</button>
                  <button
                    onClick={handleCreate}
                    disabled={!newName.trim() || creating}
                    className="glass-button-primary !text-[12px] !py-1.5 inline-flex items-center gap-1.5"
                  >
                    {creating ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
                    {tp.createAndAdd}
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Service list */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-8 text-center">
              <Loader2 size={20} className="animate-spin text-text-tertiary mx-auto" />
              <p className="text-[12px] text-text-tertiary mt-2">{tp.loading}</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center">
              <Package size={24} className="text-text-tertiary mx-auto mb-2 opacity-40" />
              <p className="text-[13px] text-text-secondary">
                {search ? tp.noMatch : tp.empty}
              </p>
              <button
                onClick={() => setShowCreate(true)}
                className="mt-3 text-[12px] text-primary font-semibold hover:underline inline-flex items-center gap-1"
              >
                <Plus size={11} /> {tp.createProductService}
              </button>
            </div>
          ) : (
            <div>
              {categories.length > 1 ? (
                // Grouped by category
                (Object.entries(groupedByCategory) as [string, PredefinedService[]][]).map(([cat, items]) => (
                  <div key={cat}>
                    <div className="px-5 py-2 bg-surface-secondary/40">
                      <p className="text-[10px] font-bold text-text-tertiary uppercase tracking-wider">{cat}</p>
                    </div>
                    {items.map((service) => (
                      <ServiceRow
                        key={service.id}
                        service={service}
                        isAdded={!singleSelect && addedIds.has(service.id)}
                        singleSelect={singleSelect}
                        onToggle={() => handleToggle(service)}
                      />
                    ))}
                  </div>
                ))
              ) : (
                // Flat list
                filtered.map((service) => (
                  <ServiceRow
                    key={service.id}
                    service={service}
                    isAdded={!singleSelect && addedIds.has(service.id)}
                    singleSelect={singleSelect}
                    onToggle={() => handleToggle(service)}
                  />
                ))
              )}
            </div>
          )}
        </div>

        {/* Footer hint */}
        <div className="px-5 py-2.5 border-t border-outline-subtle/60 bg-surface-secondary/30">
          <p className="text-[11px] text-text-tertiary text-center">
            {tp.footerHint}
          </p>
        </div>
      </motion.div>
    </div>
  );
}

// ─── Service Row ─────────────────────────────────────────────────
interface ServiceRowProps {
  service: PredefinedService;
  isAdded: boolean;
  onToggle: () => void;
  singleSelect?: boolean;
}

const ServiceRow: React.FC<ServiceRowProps> = ({ service, isAdded, onToggle, singleSelect = false }) => {
  const { language } = useTranslation();
  return (
    <button
      onClick={onToggle}
      className={cn(
        'w-full flex items-center gap-3 px-5 py-3.5 text-left border-b border-outline-subtle/30 transition-colors group',
        isAdded
          ? 'bg-surface-tertiary/50 hover:bg-surface-tertiary'
          : 'hover:bg-surface-secondary/50'
      )}
    >
      {/* Toggle checkbox (multi-select only) */}
      {!singleSelect && (
        <div
          className={cn(
            'w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-all',
            isAdded
              ? 'bg-primary border-text-primary'
              : 'border-outline bg-surface group-hover:border-text-tertiary'
          )}
        >
          {isAdded ? (
            <Check size={11} className="text-white" />
          ) : null}
        </div>
      )}

      <div className="flex-1 min-w-0">
        <p className={cn('text-[14px] font-semibold leading-snug', isAdded ? 'text-text-primary' : 'text-text-primary')}>
          {service.name}
        </p>
        {service.description && (
          <p className="text-[12px] text-text-tertiary mt-0.5 line-clamp-1">{service.description}</p>
        )}
      </div>
      <div className="flex items-center gap-2.5 shrink-0">
        <span className="text-[14px] font-semibold text-text-primary tabular-nums">
          {formatCurrency(service.default_price_cents / 100)}
        </span>
        {isAdded && (
          <span className="text-[10px] font-medium text-text-tertiary group-hover:text-danger transition-colors">
            {/* Show "remove" hint on hover */}
            <Minus size={12} className="hidden group-hover:block" />
            <span className="block group-hover:hidden text-[10px] uppercase tracking-wide">{language === 'fr' ? 'Ajouté' : 'Added'}</span>
          </span>
        )}
      </div>
    </button>
  );
};
