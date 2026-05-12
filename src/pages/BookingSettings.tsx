import React, { useEffect, useState, useCallback } from 'react';
import { Loader2, Plus, Trash2, Copy, ExternalLink, Save, CheckCircle2, XCircle, Calendar as CalendarIcon } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from '../i18n';
import BackToSettings from '../components/ui/BackToSettings';
import {
  fetchBookingPages,
  upsertBookingPage,
  deleteBookingPage,
  fetchBookings,
  updateBookingStatus,
  type BookingPage,
  type Booking,
  type Availability,
  type WeekKey,
} from '../lib/bookingApi';

const DAY_KEYS: WeekKey[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

const defaultAvailability: Availability = {
  monday: [{ start: '09:00', end: '17:00' }],
  tuesday: [{ start: '09:00', end: '17:00' }],
  wednesday: [{ start: '09:00', end: '17:00' }],
  thursday: [{ start: '09:00', end: '17:00' }],
  friday: [{ start: '09:00', end: '17:00' }],
};

type DraftPage = {
  id?: string;
  slug: string;
  title: string;
  description: string;
  service_type: string;
  duration_minutes: number;
  buffer_minutes: number;
  advance_notice_hours: number;
  max_days_ahead: number;
  availability: Availability;
  is_active: boolean;
};

const emptyDraft: DraftPage = {
  slug: '',
  title: '',
  description: '',
  service_type: '',
  duration_minutes: 60,
  buffer_minutes: 15,
  advance_notice_hours: 24,
  max_days_ahead: 30,
  availability: defaultAvailability,
  is_active: true,
};

function toDraft(p: BookingPage): DraftPage {
  return {
    id: p.id,
    slug: p.slug,
    title: p.title,
    description: p.description || '',
    service_type: p.service_type || '',
    duration_minutes: p.duration_minutes,
    buffer_minutes: p.buffer_minutes,
    advance_notice_hours: p.advance_notice_hours,
    max_days_ahead: p.max_days_ahead,
    availability: p.availability || {},
    is_active: p.is_active,
  };
}

export default function BookingSettings() {
  const { t, language } = useTranslation();
  const isFr = language === 'fr';

  const [pages, setPages] = useState<BookingPage[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<DraftPage | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, b] = await Promise.all([fetchBookingPages(), fetchBookings()]);
      setPages(p);
      setBookings(b);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const startNew = () => setDraft({ ...emptyDraft, availability: JSON.parse(JSON.stringify(defaultAvailability)) });
  const editPage = (p: BookingPage) => setDraft(toDraft(p));

  async function handleSave() {
    if (!draft) return;
    if (!draft.title.trim()) { toast.error(isFr ? 'Titre requis' : 'Title required'); return; }
    if (!draft.slug.trim()) { toast.error(isFr ? 'URL requise' : 'URL slug required'); return; }
    setSaving(true);
    try {
      await upsertBookingPage({
        id: draft.id,
        slug: draft.slug.trim().toLowerCase(),
        title: draft.title.trim(),
        description: draft.description.trim() || null,
        service_type: draft.service_type.trim() || null,
        duration_minutes: draft.duration_minutes,
        buffer_minutes: draft.buffer_minutes,
        advance_notice_hours: draft.advance_notice_hours,
        max_days_ahead: draft.max_days_ahead,
        availability: draft.availability,
        is_active: draft.is_active,
      });
      toast.success(isFr ? 'Page enregistrée' : 'Page saved');
      setDraft(null);
      await load();
    } catch (err: any) {
      toast.error(err?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm(isFr ? 'Désactiver cette page ?' : 'Disable this page?')) return;
    try {
      await deleteBookingPage(id);
      toast.success(isFr ? 'Page désactivée' : 'Page disabled');
      await load();
    } catch (err: any) {
      toast.error(err?.message || 'Delete failed');
    }
  }

  async function handleBookingAction(id: string, status: Booking['status']) {
    try {
      await updateBookingStatus(id, status);
      await load();
      toast.success(isFr ? 'Mise à jour' : 'Updated');
    } catch (err: any) {
      toast.error(err?.message || 'Update failed');
    }
  }

  function copyUrl(slug: string) {
    const url = `${window.location.origin}/book/${slug}`;
    navigator.clipboard.writeText(url);
    toast.success(isFr ? 'URL copiée' : 'URL copied');
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-text-muted" />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      <BackToSettings />
      <div className="flex items-center justify-between mb-6 mt-4">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary flex items-center gap-2">
            <CalendarIcon className="w-6 h-6" /> {t.booking.title}
          </h1>
          <p className="text-sm text-text-muted mt-1">{t.booking.subtitle}</p>
        </div>
        {!draft && (
          <button
            onClick={startNew}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-text-primary text-bg-elevated text-sm font-medium hover:opacity-90"
          >
            <Plus className="w-4 h-4" /> {t.booking.newPage}
          </button>
        )}
      </div>

      {draft ? (
        <DraftEditor
          draft={draft}
          onChange={setDraft}
          onCancel={() => setDraft(null)}
          onSave={handleSave}
          saving={saving}
          isFr={isFr}
          t={t}
        />
      ) : (
        <>
          {/* Pages list */}
          <section className="mb-10">
            <h2 className="text-sm font-medium text-text-secondary mb-3">{t.booking.pages}</h2>
            {pages.length === 0 ? (
              <div className="border border-dashed border-outline rounded-2xl p-10 text-center">
                <p className="text-text-muted text-sm">{t.booking.noPages}</p>
              </div>
            ) : (
              <div className="space-y-3">
                {pages.map((p) => (
                  <div key={p.id} className="glass-card rounded-2xl p-4 flex items-center justify-between gap-4 flex-wrap">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-text-primary truncate">{p.title}</h3>
                        {!p.is_active && (
                          <span className="px-2 py-0.5 text-[10px] rounded bg-text-muted/15 text-text-muted">{t.booking.inactive}</span>
                        )}
                      </div>
                      <p className="text-xs text-text-muted mt-0.5">{p.duration_minutes} min · /book/{p.slug}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => copyUrl(p.slug)} className="p-2 rounded-lg hover:bg-text-muted/10" title={t.booking.copyUrl}>
                        <Copy className="w-4 h-4 text-text-muted" />
                      </button>
                      <a href={`/book/${p.slug}`} target="_blank" rel="noreferrer" className="p-2 rounded-lg hover:bg-text-muted/10" title={t.booking.openPage}>
                        <ExternalLink className="w-4 h-4 text-text-muted" />
                      </a>
                      <button onClick={() => editPage(p)} className="px-3 py-1.5 text-sm rounded-lg border border-outline hover:bg-text-muted/5">
                        {t.common.edit}
                      </button>
                      <button onClick={() => handleDelete(p.id)} className="p-2 rounded-lg hover:bg-red-500/10" title={t.common.delete}>
                        <Trash2 className="w-4 h-4 text-red-500" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Bookings list */}
          <section>
            <h2 className="text-sm font-medium text-text-secondary mb-3">{t.booking.incoming}</h2>
            {bookings.length === 0 ? (
              <div className="border border-dashed border-outline rounded-2xl p-10 text-center">
                <p className="text-text-muted text-sm">{t.booking.noBookings}</p>
              </div>
            ) : (
              <div className="space-y-2">
                {bookings.map((b) => (
                  <div key={b.id} className="glass-card rounded-xl p-4 flex items-center justify-between gap-4 flex-wrap">
                    <div className="min-w-0">
                      <div className="font-medium text-text-primary">{b.customer_first_name} {b.customer_last_name}</div>
                      <div className="text-xs text-text-muted">
                        {new Date(b.scheduled_at).toLocaleString()} · {b.duration_minutes} min · {b.customer_email}
                      </div>
                      {b.service_address && <div className="text-xs text-text-muted">{b.service_address}</div>}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 text-[10px] rounded ${
                        b.status === 'confirmed' ? 'bg-green-500/15 text-green-600' :
                        b.status === 'cancelled' ? 'bg-red-500/15 text-red-600' :
                        b.status === 'completed' ? 'bg-blue-500/15 text-blue-600' :
                        'bg-yellow-500/15 text-yellow-700'
                      }`}>{b.status}</span>
                      {b.status === 'pending' && (
                        <>
                          <button onClick={() => handleBookingAction(b.id, 'confirmed')} className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg bg-green-600 text-white">
                            <CheckCircle2 className="w-3.5 h-3.5" /> {t.booking.confirm}
                          </button>
                          <button onClick={() => handleBookingAction(b.id, 'cancelled')} className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg border border-outline">
                            <XCircle className="w-3.5 h-3.5" /> {t.booking.cancelAction}
                          </button>
                        </>
                      )}
                      {b.status === 'confirmed' && (
                        <button onClick={() => handleBookingAction(b.id, 'completed')} className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg border border-outline">
                          {t.booking.markCompleted}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

// ── Draft editor ────────────────────────────────────────────

function DraftEditor({
  draft, onChange, onCancel, onSave, saving, isFr, t,
}: {
  draft: DraftPage;
  onChange: (d: DraftPage) => void;
  onCancel: () => void;
  onSave: () => void;
  saving: boolean;
  isFr: boolean;
  t: any;
}) {
  function patch(p: Partial<DraftPage>) { onChange({ ...draft, ...p }); }

  function setWindow(day: WeekKey, idx: number, key: 'start' | 'end', value: string) {
    const windows = [...(draft.availability[day] || [])];
    windows[idx] = { ...windows[idx], [key]: value };
    patch({ availability: { ...draft.availability, [day]: windows } });
  }
  function addWindow(day: WeekKey) {
    const windows = [...(draft.availability[day] || []), { start: '09:00', end: '17:00' }];
    patch({ availability: { ...draft.availability, [day]: windows } });
  }
  function removeWindow(day: WeekKey, idx: number) {
    const windows = [...(draft.availability[day] || [])];
    windows.splice(idx, 1);
    const next = { ...draft.availability };
    if (windows.length === 0) delete next[day];
    else next[day] = windows;
    patch({ availability: next });
  }

  const dayLabel = (k: WeekKey) => isFr
    ? { monday: 'Lundi', tuesday: 'Mardi', wednesday: 'Mercredi', thursday: 'Jeudi', friday: 'Vendredi', saturday: 'Samedi', sunday: 'Dimanche' }[k]
    : { monday: 'Monday', tuesday: 'Tuesday', wednesday: 'Wednesday', thursday: 'Thursday', friday: 'Friday', saturday: 'Saturday', sunday: 'Sunday' }[k];

  return (
    <div className="glass-card rounded-2xl p-6 space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label={t.booking.fieldTitle}>
          <input value={draft.title} onChange={(e) => patch({ title: e.target.value })} className="input" placeholder={isFr ? 'Estimation gratuite' : 'Free estimate'} />
        </Field>
        <Field label={t.booking.fieldSlug} hint={`/book/${draft.slug || '...'}`}>
          <input value={draft.slug} onChange={(e) => patch({ slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })} className="input" placeholder="my-service" />
        </Field>
      </div>

      <Field label={t.booking.fieldDescription}>
        <textarea value={draft.description} onChange={(e) => patch({ description: e.target.value })} rows={3} className="input resize-none" />
      </Field>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Field label={t.booking.duration}>
          <input type="number" min={15} max={480} step={15} value={draft.duration_minutes} onChange={(e) => patch({ duration_minutes: Number(e.target.value) || 60 })} className="input" />
        </Field>
        <Field label={t.booking.buffer}>
          <input type="number" min={0} max={240} step={5} value={draft.buffer_minutes} onChange={(e) => patch({ buffer_minutes: Number(e.target.value) || 0 })} className="input" />
        </Field>
        <Field label={t.booking.advanceNotice}>
          <input type="number" min={0} max={720} value={draft.advance_notice_hours} onChange={(e) => patch({ advance_notice_hours: Number(e.target.value) || 0 })} className="input" />
        </Field>
        <Field label={t.booking.maxDaysAhead}>
          <input type="number" min={1} max={365} value={draft.max_days_ahead} onChange={(e) => patch({ max_days_ahead: Number(e.target.value) || 30 })} className="input" />
        </Field>
      </div>

      <div>
        <h3 className="text-sm font-medium text-text-secondary mb-3">{t.booking.availability}</h3>
        <div className="space-y-2">
          {DAY_KEYS.map((day) => {
            const windows = draft.availability[day] || [];
            return (
              <div key={day} className="flex items-center gap-2 flex-wrap py-1">
                <div className="w-24 text-sm text-text-muted">{dayLabel(day)}</div>
                {windows.length === 0 ? (
                  <button onClick={() => addWindow(day)} className="text-xs text-text-muted hover:text-text-primary underline">
                    + {t.booking.addWindow}
                  </button>
                ) : (
                  <>
                    {windows.map((w, i) => (
                      <div key={i} className="flex items-center gap-1">
                        <input type="time" value={w.start} onChange={(e) => setWindow(day, i, 'start', e.target.value)} className="input-sm" />
                        <span className="text-text-muted">–</span>
                        <input type="time" value={w.end} onChange={(e) => setWindow(day, i, 'end', e.target.value)} className="input-sm" />
                        <button onClick={() => removeWindow(day, i)} className="p-1 rounded hover:bg-red-500/10">
                          <Trash2 className="w-3.5 h-3.5 text-red-500" />
                        </button>
                      </div>
                    ))}
                    <button onClick={() => addWindow(day)} className="text-xs text-text-muted hover:text-text-primary underline">
                      + {t.booking.addWindow}
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex items-center gap-3 pt-4 border-t border-outline">
        <label className="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" checked={draft.is_active} onChange={(e) => patch({ is_active: e.target.checked })} />
          {t.booking.activeLabel}
        </label>
        <div className="flex-1" />
        <button onClick={onCancel} className="px-4 py-2 rounded-lg border border-outline text-sm">{t.common.cancel}</button>
        <button onClick={onSave} disabled={saving} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-text-primary text-bg-elevated text-sm font-medium disabled:opacity-60">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {t.common.save}
        </button>
      </div>

      <style>{`
        .input {
          width: 100%; padding: 0.625rem 0.75rem; border-radius: 0.5rem;
          border: 1px solid var(--outline, rgba(0,0,0,0.1));
          background: var(--bg-elevated, white); font-size: 0.875rem;
          color: var(--text-primary, #111);
        }
        .input:focus { outline: none; box-shadow: 0 0 0 2px rgba(63, 175, 151, 0.25); }
        .input-sm {
          padding: 0.25rem 0.5rem; border-radius: 0.375rem;
          border: 1px solid var(--outline, rgba(0,0,0,0.1));
          background: var(--bg-elevated, white); font-size: 0.8125rem;
          color: var(--text-primary, #111);
        }
      `}</style>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-text-secondary block mb-1">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-text-muted mt-1 block">{hint}</span>}
    </label>
  );
}
