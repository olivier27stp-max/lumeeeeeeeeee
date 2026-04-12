import React, { useEffect, useState } from 'react';
import { ArrowLeft, Edit2, Loader2, Package, Plus, Search, Trash2, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { cn, formatCurrency } from '../lib/utils';
import {
  listPredefinedServices,
  createPredefinedService,
  updatePredefinedService,
  deletePredefinedService,
  PredefinedService,
} from '../lib/servicesApi';

export default function ProductsServices() {
  const navigate = useNavigate();
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
  const [saving, setSaving] = useState(false);

  useEffect(() => { loadServices(); }, []);

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

  const categories = [...new Set(filtered.map((s) => s.category || 'Other'))].sort();

  function openCreate() {
    setEditingId(null);
    setFormName('');
    setFormDesc('');
    setFormPrice('');
    setFormCategory('');
    setFormDuration('');
    setShowForm(true);
  }

  function openEdit(service: PredefinedService) {
    // Reset form state first to prevent saving to wrong service
    setFormName(service.name);
    setFormDesc(service.description || '');
    setFormPrice(String(service.default_price_cents / 100));
    setFormCategory(service.category || '');
    setFormDuration(service.default_duration_minutes ? String(service.default_duration_minutes) : '');
    setEditingId(service.id);  // Set ID AFTER populating fields
    setShowForm(true);
  }

  async function handleSave() {
    if (!formName.trim()) return;
    setSaving(true);
    try {
      const priceCents = Math.round((parseFloat(formPrice) || 0) * 100);
      const durationMin = Math.max(0, parseInt(formDuration) || 0) || undefined;

      if (editingId) {
        const updated = await updatePredefinedService(editingId, {
          name: formName.trim(),
          description: formDesc.trim(),
          default_price_cents: priceCents,
          category: formCategory.trim(),
          default_duration_minutes: durationMin,
        });
        setServices((prev) => prev.map((s) => (s.id === editingId ? updated : s)));
        toast.success('Service updated');
      } else {
        const created = await createPredefinedService({
          name: formName.trim(),
          description: formDesc.trim() || undefined,
          default_price_cents: priceCents,
          category: formCategory.trim() || undefined,
          default_duration_minutes: durationMin,
        });
        setServices((prev) => [...prev, created]);
        toast.success('Service created');
      }
      setShowForm(false);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      await deletePredefinedService(id);
      setServices((prev) => prev.filter((s) => s.id !== id));
      toast.success('Service deleted');
    } catch {
      toast.error('Failed to delete');
    }
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <button onClick={() => navigate('/settings')} className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-text-secondary hover:text-text-primary transition-colors">
        <ArrowLeft size={14} /> Settings
      </button>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-surface-secondary flex items-center justify-center">
            <Package size={18} className="text-text-tertiary" />
          </div>
          <div>
            <h1 className="text-[20px] font-bold text-text-primary tracking-tight">Products & Services</h1>
            <p className="text-[12px] text-text-tertiary">Manage your predefined service catalog</p>
          </div>
        </div>
        <button onClick={openCreate} className="glass-button-primary !text-[12px] inline-flex items-center gap-1.5">
          <Plus size={13} /> New Service
        </button>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search services..."
          className="w-full bg-surface-secondary/60 border border-outline-subtle/60 rounded-lg pl-8 pr-3 py-2 text-[13px] text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-primary/40 transition-colors"
        />
      </div>

      {/* Create/Edit Form */}
      {showForm && (
        <div className="section-card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-[14px] font-semibold text-text-primary">
              {editingId ? 'Edit Service' : 'New Service'}
            </h3>
            <button onClick={() => setShowForm(false)} className="p-1 rounded-md text-text-tertiary hover:text-text-primary">
              <X size={14} />
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="md:col-span-2">
              <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">Name *</label>
              <input value={formName} onChange={(e) => setFormName(e.target.value)} className="glass-input w-full mt-1" placeholder="e.g. Lavage à pression" />
            </div>
            <div className="md:col-span-2">
              <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">Description</label>
              <input value={formDesc} onChange={(e) => setFormDesc(e.target.value)} className="glass-input w-full mt-1" placeholder="Short description..." />
            </div>
            <div>
              <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">Default Price ($)</label>
              <input value={formPrice} onChange={(e) => setFormPrice(e.target.value)} type="text" inputMode="decimal" className="glass-input w-full mt-1" placeholder="475.00" />
            </div>
            <div>
              <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">Category</label>
              <input value={formCategory} onChange={(e) => setFormCategory(e.target.value)} className="glass-input w-full mt-1" placeholder="e.g. Nettoyage" />
            </div>
            <div>
              <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">Duration (min)</label>
              <input value={formDuration} onChange={(e) => setFormDuration(e.target.value)} type="number" className="glass-input w-full mt-1" placeholder="60" />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowForm(false)} className="glass-button !text-[12px]">Cancel</button>
            <button onClick={handleSave} disabled={!formName.trim() || saving} className="glass-button-primary !text-[12px] inline-flex items-center gap-1.5">
              {saving && <Loader2 size={11} className="animate-spin" />}
              {editingId ? 'Save Changes' : 'Create Service'}
            </button>
          </div>
        </div>
      )}

      {/* Service List */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-16 rounded-xl bg-surface-secondary/40 animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="section-card p-12 text-center">
          <Package size={28} className="text-text-tertiary mx-auto mb-3 opacity-40" />
          <p className="text-[14px] font-medium text-text-secondary">No services found</p>
          <p className="text-[12px] text-text-tertiary mt-1">Create your first predefined service to speed up job creation.</p>
          <button onClick={openCreate} className="mt-3 text-[12px] text-primary font-semibold hover:underline inline-flex items-center gap-1">
            <Plus size={11} /> Create a service
          </button>
        </div>
      ) : (
        <div className="space-y-1">
          {filtered.map((service) => (
            <div
              key={service.id}
              className="flex items-center gap-4 px-4 py-3 rounded-xl hover:bg-surface-secondary/50 transition-colors group"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-[14px] font-semibold text-text-primary">{service.name}</p>
                  {service.category && (
                    <span className="text-[10px] font-medium text-text-tertiary bg-surface-secondary rounded-full px-2 py-0.5">
                      {service.category}
                    </span>
                  )}
                </div>
                {service.description && (
                  <p className="text-[12px] text-text-tertiary mt-0.5 truncate">{service.description}</p>
                )}
              </div>
              <span className="text-[14px] font-bold text-text-primary tabular-nums shrink-0">
                {formatCurrency(service.default_price_cents / 100)}
              </span>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={() => openEdit(service)} className="p-1.5 rounded-md text-text-tertiary hover:text-text-primary hover:bg-surface-secondary">
                  <Edit2 size={12} />
                </button>
                <button onClick={() => handleDelete(service.id)} className="p-1.5 rounded-md text-text-tertiary hover:text-danger hover:bg-danger/10">
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
