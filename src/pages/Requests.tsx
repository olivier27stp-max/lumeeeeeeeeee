import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Inbox, Mail, Phone, MapPin, Building2, ExternalLink, RefreshCw, Clock, Copy, Check, ImageIcon, X, ChevronRight } from 'lucide-react';
import { useTranslation } from '../i18n';
import { fetchFormSubmissions, fetchRequestForm } from '../lib/requestFormsApi';
import type { FormSubmission, RequestForm, FormField } from '../types';

/** Reserved custom_responses key where the public form stores uploaded photo URLs. */
const PHOTOS_KEY = '__photos';

const photosOf = (s: FormSubmission): string[] => {
  const v = s.custom_responses?.[PHOTOS_KEY];
  return Array.isArray(v) ? v.filter((u) => typeof u === 'string') : [];
};

/** Visible custom answers, excluding reserved (`__`) keys and empties. */
const customEntriesOf = (s: FormSubmission): Array<[string, unknown]> =>
  Object.entries(s.custom_responses || {}).filter(
    ([k, v]) => !k.startsWith('__') && v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0),
  );

const fullAddress = (s: FormSubmission) =>
  [s.street_address, s.unit, s.city, s.region, s.postal_code, s.country].filter(Boolean).join(', ');

const fmtValue = (v: unknown): string =>
  Array.isArray(v) ? v.join(', ') : v === true ? '✓' : v === false ? '' : String(v ?? '');

export default function Requests() {
  const { language } = useTranslation();
  const fr = language === 'fr';

  const [submissions, setSubmissions] = useState<FormSubmission[]>([]);
  const [form, setForm] = useState<RequestForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [selected, setSelected] = useState<FormSubmission | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Form config is best-effort — never block the submissions list on it
      const [data, formCfg] = await Promise.all([
        fetchFormSubmissions(),
        fetchRequestForm().catch(() => null),
      ]);
      setSubmissions(data);
      setForm(formCfg);
    } catch (err: any) {
      setError(err.message || (fr ? 'Impossible de charger les demandes.' : 'Unable to load requests.'));
    } finally {
      setLoading(false);
    }
  }, [fr]);

  const formUrl = form?.api_key ? `${window.location.origin}/form/${form.api_key}` : null;
  const copyUrl = () => {
    if (!formUrl) return;
    navigator.clipboard.writeText(formUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  useEffect(() => { load(); }, [load]);

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleString(fr ? 'fr-CA' : 'en-CA', {
      year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });

  /** Map a custom_responses key to its human label using the form config. */
  const labelFor = (key: string) => form?.custom_fields.find((f) => f.id === key)?.label || key;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-text-primary">{fr ? 'Demandes' : 'Requests'}</h2>
          <p className="mt-1 text-sm text-text-tertiary">
            {fr ? 'Soumissions reçues via votre formulaire de demande' : 'Submissions received through your request form'}
          </p>
        </div>
        <button
          onClick={load}
          className="flex items-center gap-1.5 rounded-lg border border-border-subtle px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-elevated"
        >
          <RefreshCw className="h-3.5 w-3.5" /> {fr ? 'Actualiser' : 'Refresh'}
        </button>
      </div>

      {/* States */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-text-muted" />
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Inbox className="h-10 w-10 text-text-muted/30" />
          <p className="mt-3 text-sm font-medium text-text-secondary">{error}</p>
        </div>
      ) : submissions.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Inbox className="h-10 w-10 text-text-muted/30" />
          <p className="mt-3 text-sm font-medium text-text-secondary">{fr ? 'Aucune demande' : 'No requests yet'}</p>
          {formUrl ? (
            <>
              <p className="mt-1 max-w-sm text-xs text-text-muted">
                {fr
                  ? 'Les demandes apparaîtront ici dès qu’un prospect remplira votre formulaire. Partagez ce lien ou intégrez-le à votre site :'
                  : 'Requests will appear here as soon as a prospect fills out your form. Share this link or embed it on your site:'}
              </p>
              <div className="mt-3 flex w-full max-w-md items-center gap-2">
                <code className="flex-1 truncate rounded-lg border border-border-subtle bg-surface-elevated px-3 py-2 text-left text-[11px] font-mono text-text-secondary">
                  {formUrl}
                </code>
                <button
                  onClick={copyUrl}
                  className="flex items-center gap-1 rounded-lg border border-border-subtle px-2.5 py-2 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-elevated"
                  title={fr ? 'Copier' : 'Copy'}
                >
                  {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
                <a
                  href={formUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 rounded-lg border border-border-subtle px-2.5 py-2 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-elevated"
                  title={fr ? 'Ouvrir' : 'Open'}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
              {form && !form.enabled && (
                <p className="mt-3 text-xs font-medium text-amber-600">
                  {fr ? '⚠️ Ce formulaire est actuellement désactivé.' : '⚠️ This form is currently disabled.'}
                </p>
              )}
              <Link to="/settings/request-form" className="mt-4 text-xs font-semibold text-primary hover:underline">
                {fr ? 'Modifier le formulaire' : 'Edit form'}
              </Link>
            </>
          ) : (
            <>
              <p className="mt-1 max-w-sm text-xs text-text-muted">
                {fr
                  ? 'Les demandes apparaîtront ici dès qu’un prospect remplira votre formulaire. Configurez-le dans Réglages → Formulaire de demande.'
                  : 'Requests will appear here as soon as a prospect fills out your form. Configure it in Settings → Request Form.'}
              </p>
              <Link to="/settings/request-form" className="mt-4 text-xs font-semibold text-primary hover:underline">
                {fr ? 'Configurer le formulaire' : 'Configure form'}
              </Link>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {submissions.map((s) => {
            const addr = fullAddress(s);
            const customEntries = customEntriesOf(s);
            const photos = photosOf(s);
            return (
              <div
                key={s.id}
                onClick={() => setSelected(s)}
                className="group cursor-pointer rounded-xl border border-border-subtle bg-surface p-4 transition-colors hover:border-primary/40 hover:bg-surface-elevated"
              >
                {/* Top row */}
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-text-primary">
                      {s.first_name} {s.last_name}
                    </p>
                    {s.company && (
                      <p className="mt-0.5 flex items-center gap-1 text-xs text-text-tertiary">
                        <Building2 className="h-3 w-3" /> {s.company}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {photos.length > 0 && (
                      <span className="flex items-center gap-1 rounded-full bg-surface px-2 py-0.5 text-[11px] font-medium text-text-tertiary">
                        <ImageIcon className="h-3 w-3" /> {photos.length}
                      </span>
                    )}
                    <span className="flex items-center gap-1 text-[11px] text-text-muted">
                      <Clock className="h-3 w-3" /> {fmtDate(s.created_at)}
                    </span>
                    <ChevronRight className="h-4 w-4 text-text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                  </div>
                </div>

                {/* Contact */}
                <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-text-secondary">
                  {s.email && (
                    <a href={`mailto:${s.email}`} onClick={(e) => e.stopPropagation()} className="flex items-center gap-1.5 hover:text-text-primary">
                      <Mail className="h-3.5 w-3.5 text-text-muted" /> {s.email}
                    </a>
                  )}
                  {s.phone && (
                    <a href={`tel:${s.phone}`} onClick={(e) => e.stopPropagation()} className="flex items-center gap-1.5 hover:text-text-primary">
                      <Phone className="h-3.5 w-3.5 text-text-muted" /> {s.phone}
                    </a>
                  )}
                  {addr && (
                    <span className="flex items-center gap-1.5">
                      <MapPin className="h-3.5 w-3.5 text-text-muted" /> {addr}
                    </span>
                  )}
                </div>

                {/* Photo thumbnails preview */}
                {photos.length > 0 && (
                  <div className="mt-3 flex gap-2">
                    {photos.slice(0, 4).map((url) => (
                      <div key={url} className="h-14 w-14 overflow-hidden rounded-lg border border-border-subtle">
                        <img src={url} alt="" className="h-full w-full object-cover" />
                      </div>
                    ))}
                    {photos.length > 4 && (
                      <div className="flex h-14 w-14 items-center justify-center rounded-lg border border-border-subtle bg-surface text-xs font-medium text-text-tertiary">
                        +{photos.length - 4}
                      </div>
                    )}
                  </div>
                )}

                {/* Custom responses (labeled) */}
                {customEntries.length > 0 && (
                  <div className="mt-3 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                    {customEntries.map(([k, v]) => (
                      <div key={k} className="rounded-lg bg-surface px-2.5 py-1.5">
                        <p className="text-[10px] font-medium uppercase tracking-wider text-text-muted">{labelFor(k)}</p>
                        <p className="text-xs text-text-primary">{fmtValue(v)}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Detail modal — rebuilds the filled-in form */}
      {selected && (
        <SubmissionDetail
          submission={selected}
          form={form}
          fr={fr}
          fmtDate={fmtDate}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

// ── Submission detail — read-only reconstruction of the filled form ──
function SubmissionDetail({
  submission: s,
  form,
  fr,
  fmtDate,
  onClose,
}: {
  submission: FormSubmission;
  form: RequestForm | null;
  fr: boolean;
  fmtDate: (iso: string) => string;
  onClose: () => void;
}) {
  const photos = photosOf(s);
  const fields = form?.custom_fields || [];
  const serviceFields = fields.filter((f) => f.section === 'service_details');
  const noteFields = fields.filter((f) => f.section === 'final_notes');

  const val = (f: FormField) => fmtValue(s.custom_responses?.[f.id]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-border-subtle bg-surface px-6 py-4">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-text-primary">{form?.title || (fr ? 'Demande' : 'Request')}</h3>
            <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-text-muted">
              <Clock className="h-3 w-3" /> {fr ? 'Soumise le' : 'Submitted'} {fmtDate(s.created_at)}
            </p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-surface-elevated hover:text-text-primary">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-6 px-6 py-5">
          {/* Contact */}
          <FormSection title={fr ? 'Coordonnées' : 'Contact details'}>
            <div className="grid grid-cols-2 gap-3">
              <FilledField label={fr ? 'Prénom' : 'First name'} value={s.first_name} />
              <FilledField label={fr ? 'Nom' : 'Last name'} value={s.last_name} />
            </div>
            <FilledField label={fr ? 'Entreprise' : 'Company'} value={s.company} optional />
            <div className="grid grid-cols-2 gap-3">
              <FilledField label={fr ? 'Courriel' : 'Email'} value={s.email} href={s.email ? `mailto:${s.email}` : undefined} />
              <FilledField label={fr ? 'Téléphone' : 'Phone'} value={s.phone} href={s.phone ? `tel:${s.phone}` : undefined} />
            </div>
          </FormSection>

          {/* Address */}
          {(s.street_address || s.unit || s.city || s.region || s.postal_code || s.country) && (
            <FormSection title={fr ? 'Adresse' : 'Address'}>
              <FilledField label={fr ? 'Adresse' : 'Street address'} value={s.street_address} optional />
              <div className="grid grid-cols-2 gap-3">
                <FilledField label={fr ? 'Unité / App.' : 'Unit / Apt'} value={s.unit} optional />
                <FilledField label={fr ? 'Ville' : 'City'} value={s.city} optional />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <FilledField label={fr ? 'Pays' : 'Country'} value={s.country} optional />
                <FilledField label={fr ? 'Province / État' : 'State / Region'} value={s.region} optional />
                <FilledField label={fr ? 'Code postal' : 'Postal code'} value={s.postal_code} optional />
              </div>
            </FormSection>
          )}

          {/* Service details (custom) */}
          {serviceFields.length > 0 && (
            <FormSection title={fr ? 'Détails du service' : 'Service details'}>
              {serviceFields.map((f) => (
                <FilledField key={f.id} label={f.label} value={val(f)} optional />
              ))}
            </FormSection>
          )}

          {/* Final notes (custom) */}
          {noteFields.length > 0 && (
            <FormSection title={fr ? 'Notes' : 'Notes'}>
              {noteFields.map((f) => (
                <FilledField key={f.id} label={f.label} value={val(f)} optional multiline />
              ))}
            </FormSection>
          )}

          {/* Default notes */}
          {s.notes && (
            <FormSection title={fr ? 'Notes additionnelles' : 'Additional notes'}>
              <FilledField label="" value={s.notes} multiline />
            </FormSection>
          )}

          {/* Photos */}
          {photos.length > 0 && (
            <FormSection title={`${fr ? 'Photos' : 'Photos'} (${photos.length})`}>
              <div className="grid grid-cols-3 gap-2">
                {photos.map((url) => (
                  <a
                    key={url}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group relative aspect-square overflow-hidden rounded-lg border border-border-subtle"
                  >
                    <img src={url} alt="" className="h-full w-full object-cover transition-transform group-hover:scale-105" />
                    <span className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:bg-black/30 group-hover:opacity-100">
                      <ExternalLink className="h-4 w-4 text-white" />
                    </span>
                  </a>
                ))}
              </div>
            </FormSection>
          )}

          {/* Linked CRM entity */}
          {s.client_id && (
            <Link
              to={`/clients/${s.client_id}`}
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
            >
              {fr ? 'Voir le client dans le CRM' : 'View client in CRM'} <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h4 className="text-[11px] font-bold uppercase tracking-wider text-text-tertiary">{title}</h4>
      {children}
    </div>
  );
}

/** A read-only "filled input" that mirrors the public form's field styling. */
function FilledField({
  label,
  value,
  href,
  optional,
  multiline,
}: {
  label: string;
  value?: string | null;
  href?: string;
  optional?: boolean;
  multiline?: boolean;
}) {
  const empty = value === null || value === undefined || value === '';
  if (empty && optional) return null;
  return (
    <div>
      {label && <label className="text-[12px] font-medium text-text-secondary">{label}</label>}
      <div
        className={`mt-1 rounded-lg border border-border-subtle bg-surface-elevated px-3 py-2 text-sm text-text-primary break-words ${multiline ? 'whitespace-pre-wrap min-h-[44px]' : ''}`}
      >
        {empty ? (
          <span className="text-text-muted">—</span>
        ) : href ? (
          <a href={href} className="text-primary hover:underline">{value}</a>
        ) : (
          value
        )}
      </div>
    </div>
  );
}
