import { useEffect, useState, useCallback } from 'react';
import { Loader2, CheckCircle2, AlertCircle, ImagePlus, X } from 'lucide-react';
import { useTranslation } from '../i18n';
import { fetchPublicForm, submitPublicForm, uploadPublicFormPhoto, type PublicForm, type PublicFormSubmission } from '../lib/publicFormApi';
import type { FormField } from '../types';

const MAX_PHOTO_BYTES = 15 * 1024 * 1024; // 15 MB — matches the server limit

type PhotoItem = {
  id: string;
  file: File;
  preview: string;
  url: string | null;
  uploading: boolean;
  error: boolean;
};

/**
 * Public, embeddable request form rendered at `/form/:apiKey`.
 * This is the iframe target referenced by the embed snippet in
 * Settings → Request Form. It works with no authenticated session and is
 * designed to be dropped into an external site (Squarespace, Wix, etc.).
 */
export default function PublicRequestForm({ apiKey }: { apiKey: string }) {
  const { t, language } = useTranslation();
  const tr = t.requestForm;

  const [form, setForm] = useState<PublicForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Standard fields
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [company, setCompany] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [street, setStreet] = useState('');
  const [unit, setUnit] = useState('');
  const [city, setCity] = useState('');
  const [country, setCountry] = useState('');
  const [region, setRegion] = useState('');
  const [postal, setPostal] = useState('');
  const [notes, setNotes] = useState('');
  const [responses, setResponses] = useState<Record<string, unknown>>({});
  const [photos, setPhotos] = useState<PhotoItem[]>([]);

  const handlePhotos = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const items: PhotoItem[] = Array.from(files)
      .filter((f) => f.type.startsWith('image/'))
      .map((file) => ({
        id: crypto.randomUUID(),
        file,
        preview: URL.createObjectURL(file),
        url: null,
        uploading: file.size <= MAX_PHOTO_BYTES,
        error: file.size > MAX_PHOTO_BYTES,
      }));
    if (items.length === 0) return;
    setPhotos((prev) => [...prev, ...items]);

    for (const item of items) {
      if (item.error) continue; // too large — skip upload
      try {
        const url = await uploadPublicFormPhoto(apiKey, item.file);
        setPhotos((prev) => prev.map((p) => (p.id === item.id ? { ...p, url, uploading: false } : p)));
      } catch {
        setPhotos((prev) => prev.map((p) => (p.id === item.id ? { ...p, uploading: false, error: true } : p)));
      }
    }
  }, [apiKey]);

  const removePhoto = (id: string) =>
    setPhotos((prev) => {
      const target = prev.find((p) => p.id === id);
      if (target) URL.revokeObjectURL(target.preview);
      return prev.filter((p) => p.id !== id);
    });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchPublicForm(apiKey)
      .then((f) => { if (!cancelled) setForm(f); })
      .catch((err) => { if (!cancelled) setLoadError(err.message || 'Unable to load form.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [apiKey]);

  const setResponse = (id: string, value: unknown) =>
    setResponses((prev) => ({ ...prev, [id]: value }));

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    // Block while photos are still uploading
    if (photos.some((p) => p.uploading)) {
      setSubmitError(tr.uploadingPhotos);
      return;
    }

    // Validate required custom fields
    if (form) {
      for (const f of form.custom_fields) {
        if (!f.required) continue;
        const v = responses[f.id];
        const empty = v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0) || v === false;
        if (empty) {
          setSubmitError(`${f.label} ${language === 'fr' ? 'est requis.' : 'is required.'}`);
          return;
        }
      }
    }

    const payload: PublicFormSubmission = {
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      company: company.trim() || null,
      email: email.trim(),
      phone: phone.trim(),
      street_address: street.trim() || null,
      unit: unit.trim() || null,
      city: city.trim() || null,
      region: region.trim() || null,
      postal_code: postal.trim() || null,
      country: country.trim() || null,
      custom_responses: responses,
      notes: notes.trim() || null,
      photos: photos.filter((p) => p.url).map((p) => p.url as string),
    };

    setSubmitting(true);
    try {
      await submitPublicForm(apiKey, payload);
      setDone(true);
    } catch (err: any) {
      setSubmitError(err.message || 'Unable to submit. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }, [apiKey, form, responses, firstName, lastName, company, email, phone, street, unit, city, region, postal, country, notes, photos, language, tr]);

  // ── Loading / error / disabled states ──
  if (loading) {
    return (
      <Shell>
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-text-tertiary" />
        </div>
      </Shell>
    );
  }

  if (loadError || !form) {
    return (
      <Shell>
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <AlertCircle className="h-10 w-10 text-text-muted/40" />
          <p className="mt-3 text-sm font-medium text-text-secondary">{loadError || 'Form not found.'}</p>
        </div>
      </Shell>
    );
  }

  if (done) {
    return (
      <Shell>
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <CheckCircle2 className="h-12 w-12 text-green-600" />
          <p className="mt-4 text-base font-semibold text-text-primary">{form.success_message}</p>
        </div>
      </Shell>
    );
  }

  const serviceFields = form.custom_fields.filter((f) => f.section === 'service_details');
  const noteFields = form.custom_fields.filter((f) => f.section === 'final_notes');

  return (
    <Shell>
      <div className="text-center space-y-1 mb-5">
        {form.logo_url && (
          <img src={form.logo_url} alt="" className="mx-auto mb-3 max-h-40 max-w-[360px] object-contain" />
        )}
        <h1 className="text-[18px] font-bold text-text-primary">{form.title}</h1>
        {form.description && <p className="text-[13px] text-text-tertiary">{form.description}</p>}
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Contact */}
        <Section title={tr.contactDetails}>
          <div className="grid grid-cols-2 gap-3">
            <input className="glass-input w-full" placeholder={tr.firstName} value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
            <input className="glass-input w-full" placeholder={tr.lastName} value={lastName} onChange={(e) => setLastName(e.target.value)} required />
          </div>
          <input className="glass-input w-full" placeholder={t.modals.company} value={company} onChange={(e) => setCompany(e.target.value)} />
          <div className="grid grid-cols-2 gap-3">
            <input type="email" className="glass-input w-full" placeholder={tr.email} value={email} onChange={(e) => setEmail(e.target.value)} required />
            <input type="tel" className="glass-input w-full" placeholder={tr.phone} value={phone} onChange={(e) => setPhone(e.target.value)} required />
          </div>
        </Section>

        {/* Address */}
        <Section title={t.billing.address}>
          <input className="glass-input w-full" placeholder={tr.streetAddress} value={street} onChange={(e) => setStreet(e.target.value)} />
          <div className="grid grid-cols-2 gap-3">
            <input className="glass-input w-full" placeholder={tr.unitApt} value={unit} onChange={(e) => setUnit(e.target.value)} />
            <input className="glass-input w-full" placeholder={tr.city} value={city} onChange={(e) => setCity(e.target.value)} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <input className="glass-input w-full" placeholder={tr.country} value={country} onChange={(e) => setCountry(e.target.value)} />
            <input className="glass-input w-full" placeholder={tr.stateregion} value={region} onChange={(e) => setRegion(e.target.value)} />
            <input className="glass-input w-full" placeholder={tr.zipPostal} value={postal} onChange={(e) => setPostal(e.target.value)} />
          </div>
        </Section>

        {/* Service details (custom) */}
        {serviceFields.length > 0 && (
          <Section title={tr.serviceDetails}>
            {serviceFields.map((f) => (
              <CustomFieldInput key={f.id} field={f} value={responses[f.id]} onChange={(v) => setResponse(f.id, v)} selectLabel={t.billing.select} />
            ))}
          </Section>
        )}

        {/* Final notes (custom) */}
        {noteFields.length > 0 && (
          <Section title={tr.additionalNotes}>
            {noteFields.map((f) => (
              <CustomFieldInput key={f.id} field={f} value={responses[f.id]} onChange={(v) => setResponse(f.id, v)} selectLabel={t.billing.select} />
            ))}
          </Section>
        )}

        {/* Default notes */}
        <div>
          <label className="text-[12px] font-medium text-text-secondary">{tr.additionalNotes2}</label>
          <textarea className="glass-input w-full mt-1 min-h-[60px]" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        {/* Photos (client uploads) */}
        <Section title={tr.photos}>
          <p className="text-[12px] text-text-tertiary">{tr.addPhotosHint}</p>
          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-text-muted/30 py-3 text-[13px] font-medium text-text-secondary transition-colors hover:bg-surface-secondary">
            <ImagePlus className="h-4 w-4" />
            {tr.addPhotos}
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => { handlePhotos(e.target.files); e.target.value = ''; }}
            />
          </label>

          {photos.length > 0 && (
            <div className="grid grid-cols-3 gap-2">
              {photos.map((p) => (
                <div key={p.id} className="relative aspect-square overflow-hidden rounded-lg border border-text-muted/20">
                  <img src={p.preview} alt="" className="h-full w-full object-cover" />
                  {p.uploading && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                      <Loader2 className="h-5 w-5 animate-spin text-white" />
                    </div>
                  )}
                  {p.error && (
                    <div className="absolute inset-0 flex items-center justify-center bg-red-600/60 px-1 text-center text-[10px] font-medium leading-tight text-white">
                      {p.file.size > MAX_PHOTO_BYTES ? tr.photoTooLarge : tr.photoUploadFailed}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => removePhoto(p.id)}
                    className="absolute right-1 top-1 rounded-full bg-black/50 p-0.5 text-white transition-colors hover:bg-black/70"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </Section>

        {submitError && (
          <div className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-[12px] text-red-700">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {submitError}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting || photos.some((p) => p.uploading)}
          className="w-full py-2.5 rounded-xl bg-primary text-white font-semibold text-[14px] transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {submitting ? <Loader2 className="mx-auto h-5 w-5 animate-spin" /> : tr.submitRequest}
        </button>
      </form>
    </Shell>
  );
}

// ── Layout shell (standalone, iframe-friendly) ──
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen w-full bg-surface-secondary py-8 px-4">
      <div className="section-card mx-auto max-w-lg p-6">{children}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h3 className="text-[11px] font-bold uppercase tracking-wider text-text-tertiary">{title}</h3>
      {children}
    </div>
  );
}

// ── Custom field renderer ──
function CustomFieldInput({
  field,
  value,
  onChange,
  selectLabel,
}: {
  field: FormField;
  value: unknown;
  onChange: (v: unknown) => void;
  selectLabel: string;
}) {
  const label = (
    <label className="text-[12px] font-medium text-text-secondary">
      {field.label}{field.required ? ' *' : ''}
    </label>
  );

  if (field.type === 'paragraph') {
    return (
      <div>
        {label}
        <textarea className="glass-input w-full mt-1 min-h-[60px]" value={(value as string) || ''} onChange={(e) => onChange(e.target.value)} required={field.required} />
      </div>
    );
  }

  if (field.type === 'checkbox') {
    const opts = field.options || [];
    // With options → a group of checkboxes (multiple selectable, stored as string[]).
    if (opts.length > 0) {
      const selected = Array.isArray(value) ? (value as string[]) : [];
      const toggle = (opt: string) =>
        onChange(selected.includes(opt) ? selected.filter((s) => s !== opt) : [...selected, opt]);
      return (
        <div>
          {label}
          <div className="mt-1 space-y-1.5">
            {opts.map((o) => (
              <label key={o} className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" className="accent-primary" checked={selected.includes(o)} onChange={() => toggle(o)} />
                <span className="text-[12px] text-text-secondary">{o}</span>
              </label>
            ))}
          </div>
        </div>
      );
    }
    // No options → a single yes/no checkbox (stored as boolean).
    return (
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" className="accent-primary" checked={value === true} onChange={(e) => onChange(e.target.checked)} />
        <span className="text-[12px] text-text-secondary">{field.label}{field.required ? ' *' : ''}</span>
      </label>
    );
  }

  if (field.type === 'dropdown') {
    return (
      <div>
        {label}
        <select className="glass-input w-full mt-1" value={(value as string) || ''} onChange={(e) => onChange(e.target.value)} required={field.required}>
          <option value="">{selectLabel}</option>
          {(field.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>
    );
  }

  if (field.type === 'multiselect') {
    const selected = Array.isArray(value) ? (value as string[]) : [];
    const toggle = (opt: string) =>
      onChange(selected.includes(opt) ? selected.filter((s) => s !== opt) : [...selected, opt]);
    return (
      <div>
        {label}
        <div className="mt-1 space-y-1.5">
          {(field.options || []).map((o) => (
            <label key={o} className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" className="accent-primary" checked={selected.includes(o)} onChange={() => toggle(o)} />
              <span className="text-[12px] text-text-secondary">{o}</span>
            </label>
          ))}
        </div>
      </div>
    );
  }

  // text | number
  return (
    <div>
      {label}
      <input
        type={field.type === 'number' ? 'number' : 'text'}
        className="glass-input w-full mt-1"
        value={(value as string) || ''}
        onChange={(e) => onChange(e.target.value)}
        required={field.required}
        placeholder={field.label}
      />
    </div>
  );
}
