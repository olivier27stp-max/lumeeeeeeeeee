import React, { useEffect, useState } from 'react';
import { Plus, Palette, Trash2, Edit3, Save, X, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../../lib/utils';
import { PageHeader } from '../../components/ui';
import {
  listStyleDna,
  createStyleDna,
  updateStyleDna,
  deleteStyleDna,
  type StyleDnaRecord,
} from '../../lib/directorApi';
import { supabase } from '../../lib/supabase';

const CONTRAST_OPTIONS = ['low', 'medium', 'high', 'extreme'] as const;

function TagInput({ value, onChange, placeholder }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [draft, setDraft] = useState('');
  return (
    <div className="flex flex-wrap gap-1.5 items-center">
      {value.map((tag, i) => (
        <span key={i} className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface-tertiary border border-outline text-[11px] text-text-secondary">
          {tag}
          <button type="button" onClick={() => onChange(value.filter((_, j) => j !== i))} className="text-text-tertiary hover:text-danger">
            <X className="w-2.5 h-2.5" />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && draft.trim()) {
            e.preventDefault();
            onChange([...value, draft.trim()]);
            setDraft('');
          }
        }}
        placeholder={placeholder}
        className="bg-transparent text-[12px] text-text-primary placeholder:text-text-tertiary outline-none min-w-[100px] flex-1"
      />
    </div>
  );
}

interface StyleFormData {
  name: string;
  description: string;
  color_palette: string[];
  lighting: string;
  contrast: string;
  texture: string;
  camera_style: string;
  composition: string;
  realism_level: number;
  brand_descriptors: string[];
  visual_rules: string[];
  negative_rules: string[];
}

const EMPTY_FORM: StyleFormData = {
  name: '', description: '', color_palette: [], lighting: '', contrast: 'medium',
  texture: '', camera_style: '', composition: '', realism_level: 8,
  brand_descriptors: [], visual_rules: [], negative_rules: [],
};

export default function DirectorStyles() {
  const [orgId, setOrgId] = useState<string | null>(null);
  const [styles, setStyles] = useState<StyleDnaRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<StyleFormData>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.rpc('current_org_id').then(({ data }) => {
      if (data) {
        setOrgId(String(data));
        listStyleDna(String(data)).then(setStyles).catch(() => {}).finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });
  }, []);

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setCreating(true);
    setEditingId(null);
  };

  const openEdit = (style: StyleDnaRecord) => {
    setForm({
      name: style.name,
      description: style.description || '',
      color_palette: style.color_palette || [],
      lighting: style.lighting || '',
      contrast: style.contrast || 'medium',
      texture: style.texture || '',
      camera_style: style.camera_style || '',
      composition: style.composition || '',
      realism_level: style.realism_level || 8,
      brand_descriptors: style.brand_descriptors || [],
      visual_rules: style.visual_rules || [],
      negative_rules: style.negative_rules || [],
    });
    setEditingId(style.id);
    setCreating(false);
  };

  const handleSave = async () => {
    if (!orgId || !form.name.trim()) { toast.error('Name is required'); return; }
    setSaving(true);
    try {
      if (editingId) {
        const updated = await updateStyleDna(editingId, {
          name: form.name, description: form.description || null,
          color_palette: form.color_palette, lighting: form.lighting || null,
          contrast: (form.contrast as any) || null, texture: form.texture || null,
          camera_style: form.camera_style || null, composition: form.composition || null,
          realism_level: form.realism_level, brand_descriptors: form.brand_descriptors,
          visual_rules: form.visual_rules, negative_rules: form.negative_rules,
        });
        setStyles((prev) => prev.map((s) => s.id === editingId ? updated : s));
        toast.success('Style updated');
      } else {
        const created = await createStyleDna({
          org_id: orgId, name: form.name, description: form.description || null,
          color_palette: form.color_palette, lighting: form.lighting || null,
          contrast: (form.contrast as any) || null, texture: form.texture || null,
          camera_style: form.camera_style || null, composition: form.composition || null,
          realism_level: form.realism_level, brand_descriptors: form.brand_descriptors,
          visual_rules: form.visual_rules, negative_rules: form.negative_rules,
          config_json: {},
        });
        setStyles((prev) => [created, ...prev]);
        toast.success('Style created');
      }
      setEditingId(null);
      setCreating(false);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete style "${name}"?`)) return;
    try {
      await deleteStyleDna(id);
      setStyles((prev) => prev.filter((s) => s.id !== id));
      if (editingId === id) { setEditingId(null); }
      toast.success('Style deleted');
    } catch {
      toast.error('Failed to delete');
    }
  };

  const isEditing = editingId || creating;

  const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="space-y-1.5">
      <label className="text-xs font-medium uppercase tracking-wider text-text-secondary">{label}</label>
      {children}
    </div>
  );

  return (
    <div className="space-y-6 max-w-4xl">
      <PageHeader title="Style DNA" subtitle="Reusable visual identity profiles for consistent generations" icon={Palette} iconColor="pink">
        <button onClick={openCreate} className="glass-button-primary flex items-center gap-1.5 text-[13px]">
          <Plus className="w-4 h-4" />
          New Style
        </button>
      </PageHeader>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.2fr] gap-6">
        {/* List */}
        <div className="space-y-2">
          {loading ? (
            <div className="space-y-2">{[1, 2, 3].map((i) => <div key={i} className="h-20 rounded-xl bg-surface-secondary animate-pulse border border-outline" />)}</div>
          ) : styles.length === 0 && !creating ? (
            <div className="section-card p-8 text-center">
              <Palette className="w-8 h-8 text-text-tertiary/40 mx-auto mb-3" />
              <p className="text-[13px] text-text-tertiary">No styles yet</p>
              <button onClick={openCreate} className="mt-3 text-[12px] text-primary font-medium hover:underline">Create your first style</button>
            </div>
          ) : (
            styles.map((style) => (
              <button
                key={style.id}
                onClick={() => openEdit(style)}
                className={cn(
                  'w-full text-left section-card p-4 hover:border-primary/30 transition-all',
                  editingId === style.id && 'border-primary/50 bg-primary/5',
                )}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-[13px] font-semibold text-text-primary">{style.name}</p>
                    {style.description && <p className="text-[11px] text-text-tertiary mt-0.5 line-clamp-1">{style.description}</p>}
                  </div>
                  <div className="flex gap-1 shrink-0 ml-2">
                    <button onClick={(e) => { e.stopPropagation(); handleDelete(style.id, style.name); }} className="p-1 rounded text-text-tertiary hover:text-danger hover:bg-danger-light transition-colors">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
                {style.color_palette.length > 0 && (
                  <div className="flex gap-1 mt-2">
                    {style.color_palette.slice(0, 6).map((c, i) => (
                      <span key={i} className="w-4 h-4 rounded-full border border-outline" style={{ backgroundColor: c }} title={c} />
                    ))}
                  </div>
                )}
                <div className="flex gap-2 mt-2 flex-wrap">
                  {style.contrast && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-surface-tertiary text-text-tertiary">{style.contrast} contrast</span>}
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-surface-tertiary text-text-tertiary">realism {style.realism_level}/10</span>
                </div>
              </button>
            ))
          )}
        </div>

        {/* Editor */}
        {isEditing && (
          <div className="section-card p-5 space-y-4 sticky top-4">
            <div className="flex items-center justify-between">
              <h3 className="text-[14px] font-semibold text-text-primary">{editingId ? 'Edit Style' : 'New Style'}</h3>
              <button onClick={() => { setEditingId(null); setCreating(false); }} className="p-1 rounded hover:bg-surface-tertiary text-text-tertiary">
                <X className="w-4 h-4" />
              </button>
            </div>

            <Field label="Name">
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="glass-input w-full" placeholder="e.g., Luxury Gold" />
            </Field>

            <Field label="Description">
              <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="glass-input w-full" placeholder="Visual identity for premium campaigns" />
            </Field>

            <Field label="Color Palette (press Enter to add)">
              <TagInput value={form.color_palette} onChange={(v) => setForm({ ...form, color_palette: v })} placeholder="#D4AF37, deep navy, ivory..." />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Lighting">
                <input value={form.lighting} onChange={(e) => setForm({ ...form, lighting: e.target.value })} className="glass-input w-full" placeholder="Soft golden hour" />
              </Field>
              <Field label="Contrast">
                <select value={form.contrast} onChange={(e) => setForm({ ...form, contrast: e.target.value })} className="glass-input w-full">
                  {CONTRAST_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Texture">
                <input value={form.texture} onChange={(e) => setForm({ ...form, texture: e.target.value })} className="glass-input w-full" placeholder="Film grain, smooth skin" />
              </Field>
              <Field label="Camera Style">
                <input value={form.camera_style} onChange={(e) => setForm({ ...form, camera_style: e.target.value })} className="glass-input w-full" placeholder="35mm, shallow DOF" />
              </Field>
            </div>

            <Field label="Composition">
              <input value={form.composition} onChange={(e) => setForm({ ...form, composition: e.target.value })} className="glass-input w-full" placeholder="Centered, negative space" />
            </Field>

            <Field label={`Realism Level: ${form.realism_level}/10`}>
              <input type="range" min={1} max={10} value={form.realism_level} onChange={(e) => setForm({ ...form, realism_level: Number(e.target.value) })} className="w-full accent-primary" />
            </Field>

            <Field label="Brand Descriptors (Enter to add)">
              <TagInput value={form.brand_descriptors} onChange={(v) => setForm({ ...form, brand_descriptors: v })} placeholder="luxury, premium, minimal..." />
            </Field>

            <Field label="Visual Rules (Enter to add)">
              <TagInput value={form.visual_rules} onChange={(v) => setForm({ ...form, visual_rules: v })} placeholder="always include product in center..." />
            </Field>

            <Field label="Negative Rules (Enter to add)">
              <TagInput value={form.negative_rules} onChange={(v) => setForm({ ...form, negative_rules: v })} placeholder="no text overlays, no cartoons..." />
            </Field>

            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => { setEditingId(null); setCreating(false); }} className="glass-button text-[12px]">Cancel</button>
              <button onClick={() => void handleSave()} disabled={saving} className="glass-button-primary text-[12px] flex items-center gap-1.5">
                <Save className="w-3.5 h-3.5" />
                {saving ? 'Saving...' : 'Save Style'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
