import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Inbox, Mail, Phone, MapPin, Building2, ExternalLink, RefreshCw, Clock, Copy, Check, ImageIcon, X, ChevronRight, CheckSquare, Square, CheckCircle2, Circle } from 'lucide-react';
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
          <h1 className="text-[28px] font-bold text-text-primary leading-tight">{fr ? 'Demandes' : 'Requests'}{!loading && <span className="ml-2 text-[15px] font-normal text-text-tertiary tabular-nums">{submissions.length}</span>}</h1>
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
                className="group cursor-pointer overflow-hidden rounded-xl border border-border-subtle bg-surface transition-colors hover:border-primary/40 hover:bg-surface-elevated"
              >
                {/* Headbar — name · photo count · date */}
                <div className="flex items-center justify-between gap-3 bg-[#d8d0c2] px-4 py-2.5">
                  <p className="min-w-0 truncate text-sm font-semibold text-black">
                    {s.first_name} {s.last_name}
                  </p>
                  <div className="flex shrink-0 items-center gap-2">
                    {photos.length > 0 && (
                      <span className="flex items-center gap-1 rounded-full bg-black/10 px-2 py-0.5 text-[11px] font-medium text-black">
                        <ImageIcon className="h-3 w-3" /> {photos.length}
                      </span>
                    )}
                    <span className="flex items-center gap-1 text-[11px] text-black/70">
                      <Clock className="h-3 w-3" /> {fmtDate(s.created_at)}
                    </span>
                    <ChevronRight className="h-4 w-4 text-black/50 transition-transform group-hover:translate-x-0.5" />
                  </div>
                </div>

                <div className="space-y-3 p-4">
                  {s.company && (
                    <p className="flex items-center gap-1 text-xs text-text-tertiary">
                      <Building2 className="h-3 w-3" /> {s.company}
                    </p>
                  )}

                  {/* Contact */}
                  <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-text-secondary">
                    {s.email && (
                      <a href={`mailto:${s.email}`} onClick={(e) => e.stopPropagation()} className="flex items-center gap-1.5 hover:text-text-primary">
                        <Mail className="h-3.5 w-3.5 text-text-muted" /> {s.email}
                      </a>
                    )}
                    {s.phone && (
                      <>
                        <a href={`tel:${s.phone}`} onClick={(e) => e.stopPropagation()} className="md:hidden flex items-center gap-1.5 hover:text-text-primary">
                          <Phone className="h-3.5 w-3.5 text-text-muted" /> {s.phone}
                        </a>
                        <span className="hidden md:flex items-center gap-1.5">
                          <Phone className="h-3.5 w-3.5 text-text-muted" /> {s.phone}
                        </span>
                      </>
                    )}
                    {addr && (
                      <span className="flex items-center gap-1.5">
                        <MapPin className="h-3.5 w-3.5 text-text-muted" /> {addr}
                      </span>
                    )}
                  </div>

                  {/* Photo thumbnails preview */}
                  {photos.length > 0 && (
                    <div className="flex gap-2">
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
                    <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                      {customEntries.map(([k, v]) => (
                        <div key={k} className="rounded-lg bg-surface px-2.5 py-1.5">
                          <p className="text-[10px] font-medium uppercase tracking-wider text-text-muted">{labelFor(k)}</p>
                          <p className="text-xs text-text-primary">{fmtValue(v)}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Detail modal */}
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

// ── Submission detail — full list of all entered elements ──
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close bar */}
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border-subtle bg-surface px-6 py-3">
          <p className="flex items-center gap-1.5 text-[11px] text-text-muted">
            <Clock className="h-3 w-3" /> {fr ? 'Soumise le' : 'Submitted'} {fmtDate(s.created_at)}
          </p>
          <button onClick={onClose} className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-surface-elevated hover:text-text-primary">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-6 px-6 py-5">
          {/* Client info block */}
          <ClientHeader submission={s} />

          {/* Custom fields — render each per its type, choices show all options */}
          {fields.length > 0 && (
            <Group title={fr ? 'Réponses du formulaire' : 'Form answers'}>
              {fields.map((f) => (
                <CustomAnswer key={f.id} field={f} value={s.custom_responses?.[f.id]} fr={fr} />
              ))}
            </Group>
          )}

          {/* Default notes */}
          {s.notes && (
            <Group title={fr ? 'Notes additionnelles' : 'Additional notes'}>
              <p className="whitespace-pre-wrap text-sm text-text-primary">{s.notes}</p>
            </Group>
          )}

          {/* Photos */}
          {photos.length > 0 && (
            <Group title={`${fr ? 'Photos' : 'Photos'} (${photos.length})`}>
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
            </Group>
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

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-text-tertiary">{title}</h4>
      <div className="divide-y divide-border-subtle/60 rounded-xl border border-border-subtle">{children}</div>
    </div>
  );
}

/** Client identity block shown at the top of the detail, address-card style. */
function ClientHeader({ submission: s }: { submission: FormSubmission }) {
  const line1 = [s.street_address, s.unit].filter(Boolean).join(', ');
  const line2 = [s.city, [s.region, s.postal_code].filter(Boolean).join(' ').trim()]
    .filter(Boolean)
    .join(', ');
  const addressLines = [line1, line2, s.country].filter(Boolean);

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-lg font-bold text-text-primary">{s.first_name} {s.last_name}</h3>
        {s.company && <p className="text-sm text-text-tertiary">{s.company}</p>}
      </div>

      {addressLines.length > 0 && (
        <div className="text-sm leading-relaxed text-text-secondary">
          {addressLines.map((l, i) => <div key={i}>{l}</div>)}
        </div>
      )}

      {s.phone && (
        <>
          <a href={`tel:${s.phone}`} className="md:hidden block text-sm text-text-secondary hover:text-primary">{s.phone}</a>
          <span className="hidden md:block text-sm text-text-secondary">{s.phone}</span>
        </>
      )}
      {s.email && (
        <a href={`mailto:${s.email}`} className="block break-words text-sm text-primary hover:underline">{s.email}</a>
      )}
    </div>
  );
}

/** Renders one custom field answer; choice fields list every option with selection marks. */
function CustomAnswer({ field, value, fr }: { field: FormField; value: unknown; fr: boolean }) {
  const opts = field.options || [];
  const isChoiceGroup =
    field.type === 'multiselect' || (field.type === 'checkbox' && opts.length > 0) || (field.type === 'dropdown' && opts.length > 0);

  // Choice field with a list of options → show all options, mark the selected ones.
  if (isChoiceGroup) {
    const isMulti = field.type === 'multiselect' || field.type === 'checkbox';
    const selected = Array.isArray(value)
      ? (value as unknown[]).map(String)
      : value !== null && value !== undefined && value !== ''
      ? [String(value)]
      : [];
    return (
      <div className="px-3 py-2.5">
        <p className="text-sm text-text-tertiary">{field.label}</p>
        <div className="mt-1.5 space-y-1.5">
          {opts.map((o) => {
            const on = selected.includes(o);
            const OnIcon = isMulti ? CheckSquare : CheckCircle2;
            const OffIcon = isMulti ? Square : Circle;
            return (
              <div key={o} className="flex items-center gap-2 text-sm">
                {on ? <OnIcon className="h-4 w-4 shrink-0 text-primary" /> : <OffIcon className="h-4 w-4 shrink-0 text-text-muted/40" />}
                <span className={on ? 'font-medium text-text-primary' : 'text-text-tertiary'}>{o}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // Single yes/no checkbox (no options) → show as checked/unchecked.
  if (field.type === 'checkbox') {
    const on = value === true;
    return (
      <div className="flex items-center gap-2 px-3 py-2.5 text-sm">
        {on ? <CheckSquare className="h-4 w-4 shrink-0 text-primary" /> : <Square className="h-4 w-4 shrink-0 text-text-muted/40" />}
        <span className={on ? 'font-medium text-text-primary' : 'text-text-tertiary'}>{field.label}</span>
        <span className="ml-auto text-xs text-text-muted">{on ? (fr ? 'Oui' : 'Yes') : (fr ? 'Non' : 'No')}</span>
      </div>
    );
  }

  // Text / number / paragraph → label + value.
  const text = value === null || value === undefined ? '' : String(value);
  return (
    <div className="px-3 py-2.5">
      <p className="text-sm text-text-tertiary">{field.label}</p>
      <p className="mt-0.5 whitespace-pre-wrap text-sm font-medium text-text-primary">
        {text || <span className="font-normal text-text-muted">—</span>}
      </p>
    </div>
  );
}
