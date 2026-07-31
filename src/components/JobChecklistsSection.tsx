/* ═══════════════════════════════════════════════════════════════
   Job Checklists Section — embedded in JobDetails
   Technicians fill out attached checklists on-site.
   ═══════════════════════════════════════════════════════════════ */
import React, { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ClipboardList, Plus, Trash2, Check, X, Camera } from 'lucide-react';
import { cn } from '../lib/utils';
import { useTranslation } from '../i18n';
import { uploadFile, STORAGE_BUCKETS } from '../lib/storage';
import {
  listChecklistTemplates,
  listJobChecklists,
  createJobChecklist,
  updateJobChecklist,
  deleteJobChecklist,
  type ChecklistTemplate,
  type JobChecklist,
  type ChecklistItem,
} from '../lib/checklistsApi';

// ─── Signature pad ───────────────────────────────────────────────
function SignaturePad({
  value,
  onChange,
  disabled,
}: {
  value: string | null;
  onChange: (dataUrl: string | null) => void;
  disabled?: boolean;
}) {
  const { language } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const cv = canvasRef.current; if (!cv) return;
    const ctx = cv.getContext('2d'); if (!ctx) return;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, cv.width, cv.height);
    if (value) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, cv.width, cv.height);
      img.src = value;
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function pos(e: React.PointerEvent<HTMLCanvasElement>) {
    const cv = canvasRef.current!;
    const rect = cv.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * cv.width,
      y: ((e.clientY - rect.top) / rect.height) * cv.height,
    };
  }

  function down(e: React.PointerEvent<HTMLCanvasElement>) {
    if (disabled) return;
    drawing.current = true;
    last.current = pos(e);
    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current || disabled) return;
    const ctx = canvasRef.current!.getContext('2d')!;
    const p = pos(e);
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(last.current!.x, last.current!.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
  }

  function up() {
    if (!drawing.current) return;
    drawing.current = false;
    const cv = canvasRef.current!;
    onChange(cv.toDataURL('image/png'));
  }

  function clear() {
    const cv = canvasRef.current!;
    const ctx = cv.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, cv.width, cv.height);
    onChange(null);
  }

  return (
    <div className="space-y-1.5">
      <canvas
        ref={canvasRef}
        width={400}
        height={120}
        className={cn('w-full max-w-md rounded-lg border border-outline bg-white touch-none',
          disabled ? 'opacity-60' : 'cursor-crosshair')}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerLeave={up}
      />
      {!disabled && (
        <button type="button" onClick={clear} className="text-[11px] text-text-tertiary hover:text-text-primary">
          {language === 'fr' ? 'Effacer' : 'Clear'}
        </button>
      )}
    </div>
  );
}

// ─── Photo response ───────────────────────────────────────────────
function PhotoResponse({
  jobId,
  itemId,
  value,
  onChange,
  disabled,
  t,
}: {
  jobId: string;
  itemId: string;
  value: string | null;
  onChange: (url: string | null) => void;
  disabled?: boolean;
  t: any;
}) {
  const { language } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function pickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const path = `checklists/${jobId}/${itemId}-${Date.now()}-${file.name}`;
      const { url } = await uploadFile(STORAGE_BUCKETS.ATTACHMENTS, path, file);
      onChange(url);
    } catch (err: any) {
      toast.error(err?.message || (language === 'fr' ? 'Échec du téléversement' : 'Upload failed'));
    } finally { setUploading(false); }
  }

  return (
    <div className="space-y-1.5">
      {value ? (
        <div className="relative inline-block">
          <img src={value} alt="" className="max-h-40 rounded-lg border border-outline" />
          {!disabled && (
            <button type="button" onClick={() => onChange(null)}
              className="absolute -top-2 -right-2 bg-surface border border-outline rounded-full p-1">
              <X size={12} />
            </button>
          )}
        </div>
      ) : (
        <button
          type="button"
          disabled={disabled || uploading}
          onClick={() => inputRef.current?.click()}
          className="glass-button !text-[12px]"
        >
          <Camera size={13} /> {uploading ? t.checklists.uploading : t.checklists.uploadPhoto}
        </button>
      )}
      <input ref={inputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={pickFile} />
    </div>
  );
}

// ─── Single instance card ──────────────────────────────────────────
function ChecklistInstance({
  instance,
  jobId,
  onUpdate,
  onDelete,
}: {
  instance: JobChecklist;
  jobId: string;
  onUpdate: (updated: JobChecklist) => void;
  onDelete: () => void;
}) {
  const { t, language } = useTranslation();
  const fr = language === 'fr';
  const [responses, setResponses] = useState<Record<string, any>>(instance.responses || {});
  const [saving, setSaving] = useState(false);
  const completed = !!instance.completed_at;

  // Auto-save debounced
  const saveTimer = useRef<any>(null);
  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await updateJobChecklist(jobId, instance.id, { responses });
      } catch (err: any) {
        console.warn('autosave failed', err?.message);
      }
    }, 800);
    return () => clearTimeout(saveTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [responses]);

  function setItemValue(itemId: string, v: any) {
    setResponses((prev) => ({ ...prev, [itemId]: v }));
  }

  async function markComplete() {
    // Validate required
    const missing = (instance.items || []).filter(
      (it) => it.required && (responses[it.id] === undefined || responses[it.id] === null || responses[it.id] === '' || responses[it.id] === false),
    );
    if (missing.length > 0) {
      toast.error(fr ? `${missing.length} élément(s) requis manquants` : `${missing.length} required item(s) missing`);
      return;
    }
    setSaving(true);
    try {
      const updated = await updateJobChecklist(jobId, instance.id, { responses, completed: true });
      onUpdate(updated);
      toast.success(t.checklists.markedComplete);
    } catch (err: any) { toast.error(err?.message || (fr ? 'Échec' : 'Failed')); }
    finally { setSaving(false); }
  }

  async function reopen() {
    setSaving(true);
    try {
      const updated = await updateJobChecklist(jobId, instance.id, { completed: false });
      onUpdate(updated);
    } catch (err: any) { toast.error(err?.message || (fr ? 'Échec' : 'Failed')); }
    finally { setSaving(false); }
  }

  async function remove() {
    if (!confirm(fr ? 'Supprimer cette checklist ?' : 'Delete this checklist?')) return;
    try {
      await deleteJobChecklist(jobId, instance.id);
      onDelete();
    } catch (err: any) { toast.error(err?.message || (fr ? 'Échec de la suppression' : 'Delete failed')); }
  }

  return (
    <div className="rounded-xl border border-outline bg-surface overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-outline-subtle">
        <div className="flex items-center gap-2">
          <ClipboardList size={15} className="text-text-tertiary" />
          <span className="text-[13px] font-semibold text-text-primary">
            {t.checklists.checklist}
          </span>
          {completed && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">
              <Check size={10} className="inline mr-0.5" /> {t.checklists.completed}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {!completed ? (
            <button onClick={markComplete} disabled={saving} className="glass-button-primary !text-[12px] !px-2.5 !py-1">
              {saving ? '...' : t.checklists.markAsComplete}
            </button>
          ) : (
            <button onClick={reopen} disabled={saving} className="glass-button !text-[12px] !px-2.5 !py-1">
              {t.checklists.reopen}
            </button>
          )}
          <button onClick={remove} className="glass-button !text-[12px] !text-danger hover:bg-danger-light !p-1.5">
            <Trash2 size={12} />
          </button>
        </div>
      </div>
      <div className="p-5 space-y-3">
        {(instance.items || []).map((item: ChecklistItem) => {
          const value = responses[item.id];
          return (
            <div key={item.id} className="space-y-1">
              <label className="text-[12.5px] font-medium text-text-secondary block">
                {item.label}
                {item.required && <span className="text-danger ml-1">*</span>}
              </label>
              {item.type === 'checkbox' && (
                <input type="checkbox" checked={!!value} disabled={completed}
                  onChange={(e) => setItemValue(item.id, e.target.checked)} />
              )}
              {item.type === 'text' && (
                <input type="text" value={value ?? ''} disabled={completed}
                  onChange={(e) => setItemValue(item.id, e.target.value)}
                  className="glass-input w-full" />
              )}
              {item.type === 'number' && (
                <input type="number" value={value ?? ''} disabled={completed}
                  onChange={(e) => setItemValue(item.id, e.target.value === '' ? null : Number(e.target.value))}
                  className="glass-input w-full max-w-xs" />
              )}
              {item.type === 'photo' && (
                <PhotoResponse
                  jobId={jobId}
                  itemId={item.id}
                  value={value || null}
                  onChange={(url) => setItemValue(item.id, url)}
                  disabled={completed}
                  t={t}
                />
              )}
              {item.type === 'signature' && (
                <SignaturePad
                  value={value || null}
                  onChange={(dataUrl) => setItemValue(item.id, dataUrl)}
                  disabled={completed}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Section root ──────────────────────────────────────────────────
export default function JobChecklistsSection({ jobId }: { jobId: string }) {
  const { t, language } = useTranslation();
  const [instances, setInstances] = useState<JobChecklist[]>([]);
  const [templates, setTemplates] = useState<ChecklistTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [attaching, setAttaching] = useState(false);
  const [showPicker, setShowPicker] = useState(false);

  useEffect(() => { load(); }, [jobId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    setLoading(true);
    try {
      const [insts, tpls] = await Promise.all([
        listJobChecklists(jobId),
        listChecklistTemplates(false),
      ]);
      setInstances(insts);
      setTemplates(tpls);
    } catch (err: any) {
      console.error('[checklists] load failed', err?.message);
    } finally { setLoading(false); }
  }

  async function attach(templateId: string) {
    setAttaching(true);
    try {
      const created = await createJobChecklist(jobId, { template_id: templateId });
      setInstances((prev) => [...prev, created]);
      setShowPicker(false);
      toast.success(t.checklists.checklistAttached);
    } catch (err: any) {
      toast.error(err?.message || (language === 'fr' ? 'Impossible de joindre la checklist' : 'Failed to attach'));
    } finally { setAttaching(false); }
  }

  return (
    <div className="rounded-xl border border-outline bg-surface overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-outline-subtle">
        <h2 className="text-[13px] font-semibold text-text-primary flex items-center gap-2">
          <ClipboardList size={14} className="text-text-tertiary" />
          {t.checklists.sectionTitle}
        </h2>
        <div className="relative">
          <button
            onClick={() => setShowPicker((v) => !v)}
            disabled={attaching || templates.length === 0}
            className="glass-button !text-[12px] !px-2.5 !py-1 print:hidden"
          >
            <Plus size={13} /> {t.checklists.attachTemplate}
          </button>
          {showPicker && (
            <div className="absolute right-0 top-full mt-1 w-64 max-h-64 overflow-y-auto rounded-lg border border-outline bg-surface-elevated shadow-lg z-10">
              {templates.length === 0 ? (
                <div className="p-3 text-[12px] text-text-tertiary">{t.checklists.noTemplatesAvailable}</div>
              ) : templates.map((tpl) => (
                <button
                  key={tpl.id}
                  onClick={() => attach(tpl.id)}
                  className="w-full text-left px-3 py-2 hover:bg-surface-tertiary text-[13px] text-text-primary border-b border-outline-subtle last:border-b-0"
                >
                  <div className="font-medium truncate">{tpl.name}</div>
                  <div className="text-[11px] text-text-tertiary">{tpl.items?.length || 0} {t.checklists.itemsCount}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="p-5 space-y-3">
        {loading ? (
          <div className="text-[12px] text-text-tertiary">{t.common.loading}</div>
        ) : instances.length === 0 ? (
          <div className="text-[12.5px] text-text-tertiary">{t.checklists.noChecklists}</div>
        ) : (
          instances.map((inst) => (
            <ChecklistInstance
              key={inst.id}
              instance={inst}
              jobId={jobId}
              onUpdate={(updated) => setInstances((prev) => prev.map((i) => (i.id === updated.id ? updated : i)))}
              onDelete={() => setInstances((prev) => prev.filter((i) => i.id !== inst.id))}
            />
          ))
        )}
      </div>
    </div>
  );
}
