import React, { useEffect, useRef, useState } from 'react';
import { Clock, Edit2, Loader2, Package, Plus, Search, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { formatCurrency } from '../lib/utils';
import { useTranslation } from '../i18n';
import {
  listPredefinedServices,
  createPredefinedService,
  updatePredefinedService,
  archivePredefinedService,
  PredefinedService,
  type ServicePricingUnit,
} from '../lib/servicesApi';

export default function ProductsServices() {
  const { language } = useTranslation();
  const isFr = language === 'fr';
  const [services, setServices] = useState<PredefinedService[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // Create/edit form
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formName, setFormName] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formPrice, setFormPrice] = useState('');
  const [formCategory, setFormCategory] = useState('');
  const [formDuration, setFormDuration] = useState('');
  const [formUnit, setFormUnit] = useState<ServicePricingUnit>('flat');
  const [formMeasureDefault, setFormMeasureDefault] = useState(false);
  const [saving, setSaving] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Archive confirmation
  const [pendingArchive, setPendingArchive] = useState<PredefinedService | null>(null);
  const [archiving, setArchiving] = useState(false);

  useEffect(() => { loadServices(); }, []);

  // The form sits above the list — without this, clicking the pencil on a row
  // far down opens the form off-screen and the click looks like a no-op.
  useEffect(() => {
    if (!showForm) return;
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    nameInputRef.current?.focus();
  }, [showForm, editingId]);

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

  const filtered = search.trim()
    ? services.filter((s) =>
        s.name.toLowerCase().includes(search.toLowerCase()) ||
        (s.description || '').toLowerCase().includes(search.toLowerCase()) ||
        (s.category || '').toLowerCase().includes(search.toLowerCase())
      )
    : services;

  const otherLabel = isFr ? 'Autre' : 'Other';
  const grouped = filtered.reduce<Record<string, PredefinedService[]>>((acc, s) => {
    const key = s.category?.trim() || otherLabel;
    (acc[key] = acc[key] || []).push(s);
    return acc;
  }, {});
  // "Other" last, the rest alphabetically.
  const categoryNames = Object.keys(grouped).sort((a, b) =>
    a === otherLabel ? 1 : b === otherLabel ? -1 : a.localeCompare(b, isFr ? 'fr' : 'en'));

  function openCreate() {
    setEditingId(null);
    setFormName('');
    setFormDesc('');
    setFormPrice('');
    setFormCategory('');
    setFormDuration('');
    setFormUnit('flat');
    setFormMeasureDefault(false);
    setShowForm(true);
  }

  function openEdit(service: PredefinedService) {
    setFormName(service.name);
    setFormDesc(service.description || '');
    setFormPrice(String(service.default_price_cents / 100));
    setFormCategory(service.category || '');
    setFormDuration(service.default_duration_minutes ? String(service.default_duration_minutes) : '');
    setFormUnit(service.pricing_unit || 'flat');
    setFormMeasureDefault(!!service.measure_default);
    setEditingId(service.id);
    setShowForm(true);
  }

  async function handleSave() {
    if (!formName.trim()) return;
    setSaving(true);
    try {
      // "475,50" is how Québec types decimals — accept both separators.
      const priceCents = Math.max(0, Math.round((parseFloat(formPrice.replace(',', '.')) || 0) * 100));
      const durationMin = Math.max(0, parseInt(formDuration) || 0) || undefined;

      if (editingId) {
        const updated = await updatePredefinedService(editingId, {
          name: formName.trim(),
          description: formDesc.trim(),
          default_price_cents: priceCents,
          category: formCategory.trim(),
          default_duration_minutes: durationMin,
          pricing_unit: formUnit,
          measure_default: formUnit !== 'flat' && formMeasureDefault,
        });
        setServices((prev) => prev.map((s) => (s.id === editingId ? updated : s)));
        toast.success(isFr ? 'Service modifié' : 'Service updated');
      } else {
        const created = await createPredefinedService({
          name: formName.trim(),
          description: formDesc.trim() || undefined,
          default_price_cents: priceCents,
          category: formCategory.trim() || undefined,
          default_duration_minutes: durationMin,
          pricing_unit: formUnit,
          measure_default: formUnit !== 'flat' && formMeasureDefault,
        });
        setServices((prev) => [...prev, created]);
        toast.success(isFr ? 'Service créé' : 'Service created');
      }
      setShowForm(false);
    } catch (err: any) {
      toast.error(err?.message || (isFr ? 'Échec de la sauvegarde' : 'Failed to save'));
    } finally {
      setSaving(false);
    }
  }

  async function confirmArchive() {
    if (!pendingArchive) return;
    setArchiving(true);
    try {
      await archivePredefinedService(pendingArchive.id);
      setServices((prev) => prev.filter((s) => s.id !== pendingArchive.id));
      toast.success(isFr ? 'Service supprimé du catalogue' : 'Service removed from catalog');
      setPendingArchive(null);
    } catch {
      toast.error(isFr ? 'Échec de la suppression' : 'Failed to delete');
    } finally {
      setArchiving(false);
    }
  }

  function fmtDuration(min: number) {
    if (min >= 60) {
      const h = Math.floor(min / 60);
      const m = min % 60;
      return m ? `${h} h ${m}` : `${h} h`;
    }
    return `${min} min`;
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-surface-secondary flex items-center justify-center">
            <Package size={18} className="text-text-tertiary" />
          </div>
          <div>
            <h1 className="text-[20px] font-bold text-text-primary tracking-tight">{isFr ? 'Produits & Services' : 'Products & Services'}</h1>
            <p className="text-[12px] text-text-tertiary">{isFr ? 'Gérez votre catalogue de services prédéfinis' : 'Manage your predefined service catalog'}</p>
          </div>
        </div>
        <button onClick={openCreate} className="glass-button-primary !text-[12px] inline-flex items-center gap-1.5">
          <Plus size={13} /> {isFr ? 'Nouveau service' : 'New Service'}
        </button>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={isFr ? 'Rechercher un service…' : 'Search services...'}
          className="w-full bg-surface-secondary/60 border border-outline-subtle/60 rounded-lg pl-8 pr-3 py-2 text-[13px] text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-primary/40 transition-colors"
        />
      </div>

      {/* Create/Edit Form */}
      {showForm && (
        <div ref={formRef} className="section-card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-[14px] font-semibold text-text-primary">
              {editingId ? (isFr ? 'Modifier le service' : 'Edit Service') : (isFr ? 'Nouveau service' : 'New Service')}
            </h3>
            <button onClick={() => setShowForm(false)} className="p-1 rounded-md text-text-tertiary hover:text-text-primary">
              <X size={14} />
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="md:col-span-2">
              <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">{isFr ? 'Nom *' : 'Name *'}</label>
              <input ref={nameInputRef} value={formName} onChange={(e) => setFormName(e.target.value)} className="glass-input w-full mt-1" placeholder={isFr ? 'ex. Lavage à pression' : 'e.g. Pressure washing'} />
            </div>
            <div className="md:col-span-2">
              <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">Description</label>
              <input value={formDesc} onChange={(e) => setFormDesc(e.target.value)} className="glass-input w-full mt-1" placeholder={isFr ? 'Courte description…' : 'Short description...'} />
            </div>
            <div>
              <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">
                {formUnit === 'linear_ft'
                  ? (isFr ? 'Prix ($ / pi linéaire)' : 'Price ($ / linear ft)')
                  : formUnit === 'sq_ft'
                    ? (isFr ? 'Prix ($ / pi²)' : 'Price ($ / sq ft)')
                    : (isFr ? 'Prix par défaut ($)' : 'Default Price ($)')}
              </label>
              <input value={formPrice} onChange={(e) => setFormPrice(e.target.value)} type="text" inputMode="decimal" className="glass-input w-full mt-1" placeholder="475,00" />
            </div>
            <div>
              <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">{isFr ? 'Catégorie' : 'Category'}</label>
              <input value={formCategory} onChange={(e) => setFormCategory(e.target.value)} className="glass-input w-full mt-1" placeholder={isFr ? 'ex. Nettoyage' : 'e.g. Cleaning'} />
            </div>
            <div>
              <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">{isFr ? 'Durée (min)' : 'Duration (min)'}</label>
              <input value={formDuration} onChange={(e) => setFormDuration(e.target.value)} type="number" className="glass-input w-full mt-1" placeholder="60" />
            </div>
            <div>
              <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">{isFr ? 'Tarification' : 'Pricing'}</label>
              <select value={formUnit} onChange={(e) => setFormUnit(e.target.value as ServicePricingUnit)} className="glass-input w-full mt-1">
                <option value="flat">{isFr ? 'Forfait' : 'Flat rate'}</option>
                <option value="linear_ft">{isFr ? '$ / pi linéaire' : '$ / linear ft'}</option>
                <option value="sq_ft">{isFr ? '$ / pi²' : '$ / sq ft'}</option>
              </select>
            </div>
            {formUnit !== 'flat' && (
              <div className="md:col-span-2 flex items-start gap-2.5 rounded-lg border border-outline-subtle/40 bg-surface-secondary/20 p-3">
                <input
                  id="measure-default"
                  type="checkbox"
                  checked={formMeasureDefault}
                  onChange={(e) => setFormMeasureDefault(e.target.checked)}
                  className="h-4 w-4 mt-0.5"
                />
                <label htmlFor="measure-default" className="cursor-pointer">
                  <span className="block text-[12.5px] text-text-primary font-medium">
                    {isFr ? 'Service par défaut pour les mesures' : 'Default service for measurements'}
                  </span>
                  <span className="block text-[11px] text-text-tertiary mt-0.5">
                    {isFr
                      ? `Ajouté automatiquement à chaque nouvelle mesure ${formUnit === 'linear_ft' ? 'linéaire (chemin, périmètre)' : 'de surface (zone)'} dans l’outil Mesure — quantité remplie, prix du catalogue.`
                      : `Automatically added to every new ${formUnit === 'linear_ft' ? 'linear measurement (path, perimeter)' : 'area measurement (zone)'} in the Measure tool — quantity filled, catalog price.`}
                  </span>
                </label>
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowForm(false)} className="glass-button !text-[12px]">{isFr ? 'Annuler' : 'Cancel'}</button>
            <button onClick={handleSave} disabled={!formName.trim() || saving} className="glass-button-primary !text-[12px] inline-flex items-center gap-1.5">
              {saving && <Loader2 size={11} className="animate-spin" />}
              {editingId ? (isFr ? 'Enregistrer' : 'Save Changes') : (isFr ? 'Créer le service' : 'Create Service')}
            </button>
          </div>
        </div>
      )}

      {/* Service list — grouped by category */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-16 rounded-xl bg-surface-secondary/40 animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="section-card p-12 text-center">
          <Package size={28} className="text-text-tertiary mx-auto mb-3 opacity-40" />
          <p className="text-[14px] font-medium text-text-secondary">{isFr ? 'Aucun service' : 'No services found'}</p>
          <p className="text-[12px] text-text-tertiary mt-1">{isFr ? 'Créez votre premier service prédéfini pour accélérer la création de jobs.' : 'Create your first predefined service to speed up job creation.'}</p>
          <button onClick={openCreate} className="mt-3 text-[12px] text-primary font-semibold hover:underline inline-flex items-center gap-1">
            <Plus size={11} /> {isFr ? 'Créer un service' : 'Create a service'}
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {categoryNames.map((cat) => (
            <div key={cat}>
              <p className="px-4 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
                {cat} <span className="font-normal normal-case">· {grouped[cat].length}</span>
              </p>
              <div className="space-y-1">
                {grouped[cat].map((service) => (
                  <div
                    key={service.id}
                    className="flex items-center gap-4 px-4 py-3 rounded-xl hover:bg-surface-secondary/50 transition-colors group"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-[14px] font-semibold text-text-primary">{service.name}</p>
                        {service.default_duration_minutes ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-text-tertiary bg-surface-secondary rounded-full px-2 py-0.5">
                            <Clock size={9} /> {fmtDuration(service.default_duration_minutes)}
                          </span>
                        ) : null}
                      </div>
                      {service.description && (
                        <p className="text-[12px] text-text-tertiary mt-0.5 truncate">{service.description}</p>
                      )}
                    </div>
                    <span className="text-[14px] font-bold text-text-primary tabular-nums shrink-0">
                      {formatCurrency(service.default_price_cents / 100)}
                      {service.pricing_unit === 'linear_ft' && <span className="text-[10px] text-text-tertiary font-normal"> {isFr ? '/pi lin' : '/lin ft'}</span>}
                      {service.pricing_unit === 'sq_ft' && <span className="text-[10px] text-text-tertiary font-normal"> /pi²</span>}
                    </span>
                    {/* Always visible on touch — hover-only controls are unusable on mobile */}
                    <div className="flex items-center gap-1 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => openEdit(service)}
                        className="p-2 rounded-md text-text-tertiary hover:text-text-primary hover:bg-surface-secondary"
                        title={isFr ? 'Modifier' : 'Edit'}
                        aria-label={isFr ? 'Modifier' : 'Edit'}
                      >
                        <Edit2 size={13} />
                      </button>
                      <button
                        onClick={() => setPendingArchive(service)}
                        className="p-2 rounded-md text-text-tertiary hover:text-danger hover:bg-danger/10"
                        title={isFr ? 'Supprimer' : 'Delete'}
                        aria-label={isFr ? 'Supprimer' : 'Delete'}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Archive confirmation */}
      {pendingArchive && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={() => !archiving && setPendingArchive(null)}>
          <div className="w-full max-w-sm rounded-2xl bg-surface-card border border-outline p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-[15px] font-semibold text-text-primary">
              {isFr ? `Supprimer « ${pendingArchive.name} »?` : `Delete “${pendingArchive.name}”?`}
            </h3>
            <p className="mt-1.5 text-[12.5px] text-text-secondary leading-relaxed">
              {isFr
                ? 'Le service ne sera plus proposé dans les devis et jobs. Les devis existants qui l\'utilisent ne sont pas touchés.'
                : 'The service will no longer be offered in quotes and jobs. Existing quotes that use it are not affected.'}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setPendingArchive(null)} disabled={archiving} className="glass-button !text-[12px]">
                {isFr ? 'Annuler' : 'Cancel'}
              </button>
              <button onClick={confirmArchive} disabled={archiving} className="glass-button !text-[12px] !bg-danger !text-white !border-danger inline-flex items-center gap-1.5">
                {archiving && <Loader2 size={11} className="animate-spin" />}
                {isFr ? 'Supprimer' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
