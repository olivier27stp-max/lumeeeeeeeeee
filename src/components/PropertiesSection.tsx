import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { MapPin, Plus, Navigation, ExternalLink, Edit2, Trash2, Check, X } from 'lucide-react';
import { useTranslation } from '../i18n';
import AddressAutocomplete, { type StructuredAddress } from './AddressAutocomplete';
import {
  listPropertiesByClient,
  createProperty,
  updateProperty,
  softDeleteProperty,
  type PropertyRecord,
} from '../lib/propertiesApi';

function fullAddressLine(p: PropertyRecord): string {
  if (p.address) return p.address;
  return [p.street_number, p.street_name].filter(Boolean).join(' ');
}

function subAddressLine(p: PropertyRecord): string {
  return [p.city, p.province, p.postal_code].filter(Boolean).join(', ');
}

function mapsUrl(p: PropertyRecord): string {
  if (p.latitude != null && p.longitude != null) {
    return `https://www.google.com/maps/search/?api=1&query=${p.latitude},${p.longitude}`;
  }
  const q = encodeURIComponent([fullAddressLine(p), subAddressLine(p)].filter(Boolean).join(', '));
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
}

function directionsUrl(p: PropertyRecord): string {
  const q = encodeURIComponent([fullAddressLine(p), subAddressLine(p)].filter(Boolean).join(', '));
  return `https://www.google.com/maps/dir/?api=1&destination=${q}`;
}

interface EditorState {
  name: string;
  search: string;
  addr: StructuredAddress | null;
}

const EMPTY_EDITOR: EditorState = { name: '', search: '', addr: null };

export default function PropertiesSection({ clientId }: { clientId: string }) {
  const { t } = useTranslation();
  const cd = t.clientDetails as any;
  const [properties, setProperties] = useState<PropertyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState>(EMPTY_EDITOR);
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    if (!clientId) return;
    setLoading(true);
    try {
      setProperties(await listPropertiesByClient(clientId));
    } catch (err: any) {
      toast.error(err?.message || cd.savePropertyFailed);
    } finally {
      setLoading(false);
    }
  }, [clientId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    reload();
  }, [reload]);

  function openAdd() {
    setEditingId(null);
    setEditor(EMPTY_EDITOR);
    setAdding(true);
  }

  function openEdit(p: PropertyRecord) {
    setAdding(false);
    setEditingId(p.id);
    setEditor({
      name: p.name || '',
      search: fullAddressLine(p),
      addr: null,
    });
  }

  function cancel() {
    setAdding(false);
    setEditingId(null);
    setEditor(EMPTY_EDITOR);
  }

  async function save() {
    if (!editor.name.trim()) {
      toast.error(cd.propertyNameRequired);
      return;
    }
    setSaving(true);
    try {
      const addr = editor.addr;
      const base = {
        name: editor.name.trim(),
        // When an address suggestion was picked, persist structured fields;
        // otherwise keep the typed free-text address.
        address: addr?.formatted_address ?? editor.search ?? null,
        street_number: addr?.street_number ?? undefined,
        street_name: addr?.street_name ?? undefined,
        city: addr?.city ?? undefined,
        province: addr?.province ?? undefined,
        postal_code: addr?.postal_code ?? undefined,
        country: addr?.country ?? undefined,
        latitude: addr?.latitude ?? undefined,
        longitude: addr?.longitude ?? undefined,
        place_id: addr?.place_id ?? undefined,
      };
      if (editingId) {
        await updateProperty(editingId, base);
        toast.success(cd.propertyUpdated);
      } else {
        await createProperty({ client_id: clientId, ...base });
        toast.success(cd.propertyAdded);
      }
      cancel();
      await reload();
    } catch (err: any) {
      toast.error(err?.message || cd.savePropertyFailed);
    } finally {
      setSaving(false);
    }
  }

  async function remove(p: PropertyRecord) {
    if (!window.confirm(cd.confirmDeleteProperty)) return;
    try {
      await softDeleteProperty(p.id);
      toast.success(cd.propertyDeleted);
      await reload();
    } catch (err: any) {
      toast.error(err?.message || cd.savePropertyFailed);
    }
  }

  const isEditing = adding || editingId !== null;

  return (
    <div className="section-card">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-outline">
        <h2 className="text-[13px] font-semibold text-text-primary flex items-center gap-2">
          <MapPin size={15} className="text-text-secondary" />
          {t.clientDetails.properties}
        </h2>
        {!isEditing && (
          <button
            className="inline-flex items-center gap-1 h-7 px-2.5 bg-surface border border-outline rounded-md text-[12px] text-text-primary hover:bg-surface-secondary transition-colors"
            onClick={openAdd}
          >
            <Plus size={12} /> {cd.addProperty}
          </button>
        )}
      </div>

      <div className="p-5 space-y-3">
        {loading ? (
          <p className="text-[13px] text-text-tertiary">…</p>
        ) : (
          <>
            {properties.length === 0 && !adding && (
              <p className="text-[13px] text-text-tertiary">{cd.noPropertiesYet}</p>
            )}

            {properties.map((p) =>
              editingId === p.id ? (
                <PropertyEditor
                  key={p.id}
                  editor={editor}
                  setEditor={setEditor}
                  onSave={save}
                  onCancel={cancel}
                  saving={saving}
                />
              ) : (
                <div
                  key={p.id}
                  className="flex items-start gap-3 rounded-lg border border-outline bg-surface-secondary p-3.5"
                >
                  <span className="mt-0.5 text-text-secondary">
                    <MapPin size={15} />
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-text-primary flex items-center gap-2">
                      {p.name}
                      {p.is_primary && (
                        <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-surface border border-outline text-text-tertiary">
                          {t.clientDetails.primary}
                        </span>
                      )}
                    </p>
                    {fullAddressLine(p) && (
                      <p className="text-[12px] text-text-secondary mt-0.5">{fullAddressLine(p)}</p>
                    )}
                    {subAddressLine(p) && (
                      <p className="text-[12px] text-text-tertiary mt-0.5">{subAddressLine(p)}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {fullAddressLine(p) && (
                      <>
                        <a
                          href={directionsUrl(p)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 h-6 px-2 bg-surface border border-outline rounded text-[11px] text-text-secondary hover:bg-surface-secondary transition-colors"
                          title={t.clientDetails.directions}
                        >
                          <Navigation size={11} /> {t.clientDetails.directions}
                        </a>
                        <a
                          href={mapsUrl(p)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 h-6 px-2 bg-surface border border-outline rounded text-[11px] text-text-secondary hover:bg-surface-secondary transition-colors"
                          title={t.clientDetails.viewOnMap}
                        >
                          <ExternalLink size={11} /> {t.clientDetails.viewOnMap}
                        </a>
                      </>
                    )}
                    <button
                      onClick={() => openEdit(p)}
                      className="inline-flex items-center justify-center h-6 w-6 bg-surface border border-outline rounded text-text-secondary hover:bg-surface-secondary transition-colors"
                      title={cd.editProperty}
                    >
                      <Edit2 size={11} />
                    </button>
                    <button
                      onClick={() => remove(p)}
                      className="inline-flex items-center justify-center h-6 w-6 bg-surface border border-outline rounded text-text-secondary hover:bg-danger-light hover:text-danger transition-colors"
                      title={cd.deleteProperty}
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                </div>
              ),
            )}

            {adding && (
              <PropertyEditor
                editor={editor}
                setEditor={setEditor}
                onSave={save}
                onCancel={cancel}
                saving={saving}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function PropertyEditor({
  editor,
  setEditor,
  onSave,
  onCancel,
  saving,
}: {
  editor: EditorState;
  setEditor: React.Dispatch<React.SetStateAction<EditorState>>;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const { t } = useTranslation();
  const cd = t.clientDetails as any;
  return (
    <div className="rounded-lg border border-outline bg-surface p-3.5 space-y-2.5">
      <input
        autoFocus
        value={editor.name}
        onChange={(e) => setEditor((s) => ({ ...s, name: e.target.value }))}
        className="glass-input w-full"
        placeholder={cd.propertyNamePlaceholder}
      />
      <AddressAutocomplete
        value={editor.search}
        onChange={(v) => setEditor((s) => ({ ...s, search: v }))}
        onSelect={(addr) => setEditor((s) => ({ ...s, addr, search: addr.formatted_address }))}
      />
      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          onClick={onCancel}
          disabled={saving}
          className="inline-flex items-center gap-1 h-7 px-2.5 bg-surface border border-outline rounded-md text-[12px] text-text-secondary hover:bg-surface-secondary transition-colors disabled:opacity-50"
        >
          <X size={12} /> {t.common.cancel}
        </button>
        <button
          onClick={onSave}
          disabled={saving}
          className="inline-flex items-center gap-1 h-7 px-2.5 bg-primary text-white rounded-md text-[12px] hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          <Check size={12} /> {t.common.save}
        </button>
      </div>
    </div>
  );
}
