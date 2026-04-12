import React, { useState, useEffect, useCallback } from 'react';
import {
  ArrowLeft,
  Save,
  Loader2,
  Check,
  Plus,
  Trash2,
  GripVertical,
  Copy,
  RefreshCw,
  Eye,
  EyeOff,
  Code,
  ClipboardCheck,
  ToggleLeft,
  ToggleRight,
  ChevronDown,
  FileText,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence, Reorder } from 'motion/react';
import { useTranslation } from '../i18n';
import { cn } from '../lib/utils';
import { fetchRequestForm, upsertRequestForm, regenerateApiKey } from '../lib/requestFormsApi';
import type { RequestForm, FormField, FormFieldType } from '../types';

// ── Constants ──────────────────────────────────────────────

const FIELD_TYPE_OPTIONS: { value: FormFieldType; label: string; labelFr: string }[] = [
  { value: 'text', label: 'Text Input', labelFr: 'Champ texte' },
  { value: 'dropdown', label: 'Dropdown', labelFr: 'Liste déroulante' },
  { value: 'multiselect', label: 'Multi-select', labelFr: 'Sélection multiple' },
  { value: 'checkbox', label: 'Checkbox', labelFr: 'Case à cocher' },
  { value: 'number', label: 'Number', labelFr: 'Nombre' },
  { value: 'paragraph', label: 'Paragraph / Long Text', labelFr: 'Paragraphe / Texte long' },
];

const COUNTRIES = [
  'Canada', 'United States', 'United Kingdom', 'France', 'Germany', 'Australia',
  'Mexico', 'Brazil', 'Japan', 'India', 'Other',
];

function generateId() {
  return `field_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ── Field Editor Row ───────────────────────────────────────

function FieldEditor({
  field,
  isFr,
  onUpdate,
  onRemove,
}: {
  field: FormField;
  isFr: boolean;
  onUpdate: (updated: FormField) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const needsOptions = field.type === 'dropdown' || field.type === 'multiselect';

  return (
    <div className="section-card p-4 space-y-3">
      <div className="flex items-start gap-3">
        <div className="mt-2 cursor-grab text-text-tertiary hover:text-text-secondary">
          <GripVertical size={16} />
        </div>
        <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
              {t.requestForm.label}
            </label>
            <input
              type="text"
              value={field.label}
              onChange={(e) => onUpdate({ ...field, label: e.target.value })}
              className="glass-input w-full mt-1"
              placeholder={t.requestForm.egPropertyType}
            />
          </div>
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
              {t.customFields.type}
            </label>
            <select
              value={field.type}
              onChange={(e) => onUpdate({ ...field, type: e.target.value as FormFieldType, options: [] })}
              className="glass-input w-full mt-1"
            >
              {FIELD_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {isFr ? opt.labelFr : opt.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end gap-3">
            <label className="flex items-center gap-2 cursor-pointer text-[12px] text-text-secondary">
              <input
                type="checkbox"
                checked={field.required}
                onChange={(e) => onUpdate({ ...field, required: e.target.checked })}
                className="accent-primary"
              />
              {t.customFields.required}
            </label>
            <button
              onClick={onRemove}
              className="p-1.5 rounded-lg text-text-tertiary hover:text-red-500 hover:bg-red-500/10 transition-colors"
              title={t.companySettings.remove}
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>
      </div>

      {needsOptions && (
        <div className="ml-7">
          <label className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
            {t.requestForm.optionsOnePerLine}
          </label>
          <textarea
            value={(field.options || []).join('\n')}
            onChange={(e) => onUpdate({ ...field, options: e.target.value.split('\n').filter(Boolean) })}
            className="glass-input w-full mt-1 min-h-[72px]"
            placeholder={t.requestForm.housenchaletnmultiunit}
          />
        </div>
      )}
    </div>
  );
}

// ── Form Preview ───────────────────────────────────────────

function FormPreview({
  title,
  description,
  customFields,
  isFr,
}: {
  title: string;
  description: string;
  customFields: FormField[];
  isFr: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="section-card p-6 space-y-5 max-w-lg mx-auto">
      <div className="text-center space-y-1">
        <h2 className="text-[17px] font-bold text-text-primary">{title || 'Service Request'}</h2>
        {description && <p className="text-[13px] text-text-tertiary">{description}</p>}
      </div>

      {/* Contact */}
      <div className="space-y-3">
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-text-tertiary">
          {t.requestForm.contactDetails}
        </h3>
        <div className="grid grid-cols-2 gap-3">
          <input className="glass-input" placeholder={t.requestForm.firstName} disabled />
          <input className="glass-input" placeholder={t.requestForm.lastName} disabled />
        </div>
        <input className="glass-input w-full" placeholder={t.modals.company} disabled />
        <div className="grid grid-cols-2 gap-3">
          <input className="glass-input" placeholder={t.requestForm.email} disabled />
          <input className="glass-input" placeholder={t.requestForm.phone} disabled />
        </div>
      </div>

      {/* Address */}
      <div className="space-y-3">
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-text-tertiary">
          {t.billing.address}
        </h3>
        <input className="glass-input w-full" placeholder={t.requestForm.streetAddress} disabled />
        <div className="grid grid-cols-2 gap-3">
          <input className="glass-input" placeholder={t.requestForm.unitApt} disabled />
          <input className="glass-input" placeholder={t.requestForm.city} disabled />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <input className="glass-input" placeholder={t.requestForm.country} disabled />
          <input className="glass-input" placeholder={t.requestForm.stateregion} disabled />
          <input className="glass-input" placeholder={t.requestForm.zipPostal} disabled />
        </div>
      </div>

      {/* Custom Fields */}
      {customFields.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-text-tertiary">
            {t.requestForm.serviceDetails}
          </h3>
          {customFields.filter(f => f.section === 'service_details').map((f) => (
            <div key={f.id}>
              <label className="text-[12px] font-medium text-text-secondary">
                {f.label}{f.required ? ' *' : ''}
              </label>
              {f.type === 'paragraph' ? (
                <textarea className="glass-input w-full mt-1 min-h-[60px]" disabled />
              ) : f.type === 'checkbox' ? (
                <div className="flex items-center gap-2 mt-1">
                  <input type="checkbox" disabled className="accent-primary" />
                  <span className="text-[12px] text-text-tertiary">{f.label}</span>
                </div>
              ) : f.type === 'dropdown' ? (
                <select className="glass-input w-full mt-1" disabled>
                  <option>{t.billing.select}</option>
                  {(f.options || []).map((o) => <option key={o}>{o}</option>)}
                </select>
              ) : (
                <input className="glass-input w-full mt-1" disabled placeholder={f.label} />
              )}
            </div>
          ))}
        </div>
      )}

      {/* Notes */}
      {customFields.some(f => f.section === 'final_notes') && (
        <div className="space-y-3">
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-text-tertiary">
            {t.requestForm.additionalNotes}
          </h3>
          {customFields.filter(f => f.section === 'final_notes').map((f) => (
            <div key={f.id}>
              <label className="text-[12px] font-medium text-text-secondary">{f.label}</label>
              <textarea className="glass-input w-full mt-1 min-h-[60px]" disabled />
            </div>
          ))}
        </div>
      )}

      {/* Default notes field */}
      <div>
        <label className="text-[12px] font-medium text-text-secondary">
          {t.requestForm.additionalNotes2}
        </label>
        <textarea className="glass-input w-full mt-1 min-h-[60px]" disabled />
      </div>

      <button className="w-full py-2.5 rounded-xl bg-primary text-white font-semibold text-[14px] opacity-70 cursor-not-allowed">
        {t.requestForm.submitRequest}
      </button>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────

export default function RequestFormSettings() {
  const navigate = useNavigate();
  const { t, language } = useTranslation();
  const isFr = language === 'fr';

  // State
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [form, setForm] = useState<RequestForm | null>(null);
  const [activeSection, setActiveSection] = useState<'builder' | 'embed' | 'preview' | 'submissions'>('builder');

  // Form fields
  const [title, setTitle] = useState('Service Request');
  const [description, setDescription] = useState('');
  const [successMessage, setSuccessMessage] = useState('Thank you! We will get back to you shortly.');
  const [enabled, setEnabled] = useState(true);
  const [customFields, setCustomFields] = useState<FormField[]>([]);
  const [notifyEmail, setNotifyEmail] = useState(true);
  const [notifyInApp, setNotifyInApp] = useState(true);
  const [apiKey, setApiKey] = useState('');
  const [copied, setCopied] = useState<string | null>(null);

  // Load form
  useEffect(() => {
    async function load() {
      try {
        const data = await fetchRequestForm();
        if (data) {
          setForm(data);
          setTitle(data.title);
          setDescription(data.description || '');
          setSuccessMessage(data.success_message);
          setEnabled(data.enabled);
          setCustomFields(data.custom_fields || []);
          setNotifyEmail(data.notify_email);
          setNotifyInApp(data.notify_in_app);
          setApiKey(data.api_key);
        }
      } catch (err) {
        console.error('Failed to load form:', err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // Save form
  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaved(false);
    try {
      const result = await upsertRequestForm({
        title,
        description: description || null,
        success_message: successMessage,
        enabled,
        custom_fields: customFields,
        notify_email: notifyEmail,
        notify_in_app: notifyInApp,
      });
      setForm(result);
      setApiKey(result.api_key);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error('Failed to save form:', err);
    } finally {
      setSaving(false);
    }
  }, [title, description, successMessage, enabled, customFields, notifyEmail, notifyInApp]);

  // Regenerate API key
  const handleRegenKey = async () => {
    if (!confirm(isFr ? 'Regénérer la clé API ? L\'ancien code embed cessera de fonctionner.' : 'Regenerate API key? The old embed code will stop working.')) return;
    try {
      const newKey = await regenerateApiKey();
      setApiKey(newKey);
    } catch (err) {
      console.error('Failed to regenerate key:', err);
    }
  };

  // Copy to clipboard
  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  // Add custom field
  const addField = (section: 'service_details' | 'final_notes') => {
    setCustomFields((prev) => [
      ...prev,
      {
        id: generateId(),
        label: '',
        type: 'text',
        required: false,
        options: [],
        section,
      },
    ]);
  };

  // Update field
  const updateField = (id: string, updated: FormField) => {
    setCustomFields((prev) => prev.map((f) => (f.id === id ? updated : f)));
  };

  // Remove field
  const removeField = (id: string) => {
    setCustomFields((prev) => prev.filter((f) => f.id !== id));
  };

  // Embed code
  const baseUrl = typeof window !== 'undefined' ? window.location.origin : 'https://loomapp.com';
  const scriptEmbed = `<script src="${baseUrl}/form.js" data-api-key="${apiKey}"></script>`;
  const iframeEmbed = `<iframe src="${baseUrl}/form/${apiKey}" style="width:100%;min-height:800px;border:none;" title="Service Request Form"></iframe>`;

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 size={24} className="animate-spin text-text-tertiary" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate('/settings')}
          className="w-9 h-9 rounded-xl bg-surface-secondary flex items-center justify-center hover:bg-surface-secondary/80 transition-colors"
        >
          <ArrowLeft size={16} className="text-text-secondary" />
        </button>
        <div className="flex-1">
          <h1 className="text-[20px] font-bold text-text-primary tracking-tight">
            {t.requestForm.requestForm}
          </h1>
          <p className="text-[12px] text-text-tertiary">
            {t.requestForm.buildAndCustomizeYourServiceRequestForm}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Enable/Disable toggle */}
          <button
            onClick={() => setEnabled(!enabled)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors',
              enabled ? 'bg-green-500/10 text-green-600' : 'bg-surface-secondary text-text-tertiary'
            )}
          >
            {enabled ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
            {enabled ? (t.requestForm.active) : (t.requestForm.disabled)}
          </button>

          <button
            onClick={handleSave}
            disabled={saving}
            className={cn(
              'glass-button inline-flex items-center gap-1.5',
              saved && '!bg-green-600 !text-white !border-green-600'
            )}
          >
            {saving ? <Loader2 size={13} className="animate-spin" /> : saved ? <Check size={13} /> : <Save size={13} />}
            {saving ? (t.invoiceEdit.saving) : saved ? (t.requestForm.saved) : (t.requestForm.save)}
          </button>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 p-1 bg-surface-secondary rounded-xl w-fit">
        {([
          { id: 'builder' as const, label: t.requestForm.builder, icon: FileText },
          { id: 'embed' as const, label: t.requestForm.embed, icon: Code },
          { id: 'preview' as const, label: t.invoiceDetails.preview, icon: Eye },
        ]).map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveSection(tab.id)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all',
              activeSection === tab.id
                ? 'bg-surface-card dark:bg-surface-primary text-text-primary shadow-sm'
                : 'text-text-tertiary hover:text-text-secondary'
            )}
          >
            <tab.icon size={13} />
            {tab.label}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {/* ═══ BUILDER ═══ */}
        {activeSection === 'builder' && (
          <motion.div
            key="builder"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="space-y-6 max-w-2xl"
          >
            {/* A. Form Header Settings */}
            <div className="section-card p-5 space-y-4">
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-text-tertiary">
                {t.requestForm.formHeader}
              </h3>
              <div>
                <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">
                  {t.requestForm.formTitle}
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="glass-input w-full mt-1"
                  placeholder={t.requestForm.serviceRequest}
                />
              </div>
              <div>
                <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">
                  {t.quoteTemplates.descriptionOptional}
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="glass-input w-full mt-1 min-h-[60px]"
                  placeholder={t.requestForm.fillOutThisFormToRequestAService}
                />
              </div>
              <div>
                <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">
                  {t.requestForm.successMessage}
                </label>
                <textarea
                  value={successMessage}
                  onChange={(e) => setSuccessMessage(e.target.value)}
                  className="glass-input w-full mt-1 min-h-[60px]"
                  placeholder={t.requestForm.thankYouWeWillGetBackToYouShortly}
                />
              </div>
            </div>

            {/* B. Contact Details (default, read-only info) */}
            <div className="section-card p-5 space-y-3">
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-text-tertiary">
                {t.requestForm.contactDetailsDefaultFields}
              </h3>
              <p className="text-[12px] text-text-tertiary">
                {isFr
                  ? 'Ces champs sont toujours inclus: Prénom, Nom, Entreprise, Courriel, Téléphone'
                  : 'These fields are always included: First Name, Last Name, Company, Email, Phone'}
              </p>
              <div className="flex flex-wrap gap-2">
                {[
                  t.requestForm.firstName,
                  t.requestForm.lastName,
                  t.modals.company,
                  t.requestForm.email,
                  t.requestForm.phone,
                ].map((f) => (
                  <span key={f} className="badge-neutral text-[10px]">{f}</span>
                ))}
              </div>
            </div>

            {/* C. Address Section (default, read-only info) */}
            <div className="section-card p-5 space-y-3">
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-text-tertiary">
                {t.requestForm.addressDefaultFields}
              </h3>
              <p className="text-[12px] text-text-tertiary">
                {isFr
                  ? 'Inclut: Adresse, Unité, Ville, Pays (avec logique Province/État), Code postal'
                  : 'Includes: Street Address, Unit, City, Country (with State/Province logic), Postal Code'}
              </p>
              <div className="flex flex-wrap gap-2">
                {[
                  t.requestForm.streetAddress,
                  isFr ? 'Unité' : 'Unit / Apt',
                  t.requestForm.city,
                  t.requestForm.country,
                  t.requestForm.stateProvince,
                  t.requestForm.postalCode,
                ].map((f) => (
                  <span key={f} className="badge-neutral text-[10px]">{f}</span>
                ))}
              </div>
            </div>

            {/* D. Service Details (custom fields) */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-text-tertiary">
                  {t.requestForm.serviceDetailsCustomizable}
                </h3>
                <button
                  onClick={() => addField('service_details')}
                  className="glass-button text-[11px] inline-flex items-center gap-1"
                >
                  <Plus size={12} />
                  {t.requestForm.addField}
                </button>
              </div>

              {customFields.filter(f => f.section === 'service_details').length === 0 ? (
                <div className="section-card p-6 text-center">
                  <p className="text-[12px] text-text-tertiary">
                    {isFr ? 'Aucun champ personnalisé. Cliquez "Ajouter un champ" pour commencer.' : 'No custom fields yet. Click "Add Field" to start.'}
                  </p>
                </div>
              ) : (
                <Reorder.Group
                  axis="y"
                  values={customFields.filter(f => f.section === 'service_details')}
                  onReorder={(reordered) => {
                    setCustomFields(prev => {
                      const otherFields = prev.filter(f => f.section !== 'service_details');
                      return [...reordered, ...otherFields];
                    });
                  }}
                  className="space-y-2"
                >
                  {customFields.filter(f => f.section === 'service_details').map((field) => (
                    <Reorder.Item key={field.id} value={field}>
                      <FieldEditor
                        field={field}
                        isFr={isFr}
                        onUpdate={(u) => updateField(field.id, u)}
                        onRemove={() => removeField(field.id)}
                      />
                    </Reorder.Item>
                  ))}
                </Reorder.Group>
              )}
            </div>

            {/* E. Final Notes (custom fields) */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-text-tertiary">
                  {t.requestForm.finalNotesCustomizable}
                </h3>
                <button
                  onClick={() => addField('final_notes')}
                  className="glass-button text-[11px] inline-flex items-center gap-1"
                >
                  <Plus size={12} />
                  {t.requestForm.addField}
                </button>
              </div>

              {customFields.filter(f => f.section === 'final_notes').length === 0 ? (
                <div className="section-card p-6 text-center">
                  <p className="text-[12px] text-text-tertiary">
                    {isFr ? 'Aucun champ de notes. Un champ "Notes supplémentaires" est toujours inclus par défaut.' : 'No custom note fields. A default "Additional notes" field is always included.'}
                  </p>
                </div>
              ) : (
                <Reorder.Group
                  axis="y"
                  values={customFields.filter(f => f.section === 'final_notes')}
                  onReorder={(reordered) => {
                    const otherFields = customFields.filter(f => f.section !== 'final_notes');
                    setCustomFields([...otherFields, ...reordered]);
                  }}
                  className="space-y-2"
                >
                  {customFields.filter(f => f.section === 'final_notes').map((field) => (
                    <Reorder.Item key={field.id} value={field}>
                      <FieldEditor
                        field={field}
                        isFr={isFr}
                        onUpdate={(u) => updateField(field.id, u)}
                        onRemove={() => removeField(field.id)}
                      />
                    </Reorder.Item>
                  ))}
                </Reorder.Group>
              )}
            </div>

            {/* Notification Settings */}
            <div className="section-card p-5 space-y-3">
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-text-tertiary">
                {t.requestForm.notifications}
              </h3>
              <label className="flex items-center gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={notifyEmail}
                  onChange={(e) => setNotifyEmail(e.target.checked)}
                  className="accent-primary"
                />
                <span className="text-[13px] text-text-secondary">
                  {isFr ? 'Notification par courriel lors d\'une nouvelle demande' : 'Email notification on new submission'}
                </span>
              </label>
              <label className="flex items-center gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={notifyInApp}
                  onChange={(e) => setNotifyInApp(e.target.checked)}
                  className="accent-primary"
                />
                <span className="text-[13px] text-text-secondary">
                  {isFr ? 'Notification dans l\'application' : 'In-app notification'}
                </span>
              </label>
            </div>
          </motion.div>
        )}

        {/* ═══ EMBED ═══ */}
        {activeSection === 'embed' && (
          <motion.div
            key="embed"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="space-y-6 max-w-2xl"
          >
            {!form ? (
              <div className="section-card p-8 text-center">
                <Code size={28} className="text-text-tertiary mx-auto mb-3 opacity-30" />
                <p className="text-[13px] text-text-tertiary">
                  {isFr ? 'Sauvegardez d\'abord votre formulaire pour obtenir le code d\'intégration.' : 'Save your form first to get the embed code.'}
                </p>
              </div>
            ) : (
              <>
                {/* API Key */}
                <div className="section-card p-5 space-y-3">
                  <h3 className="text-[11px] font-bold uppercase tracking-wider text-text-tertiary">
                    {t.requestForm.apiKey}
                  </h3>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 bg-surface-secondary rounded-lg px-3 py-2 text-[12px] font-mono text-text-secondary break-all">
                      {apiKey}
                    </code>
                    <button
                      onClick={() => copyToClipboard(apiKey, 'apiKey')}
                      className="glass-button p-2"
                      title={t.noteCanvas.copy}
                    >
                      {copied === 'apiKey' ? <ClipboardCheck size={14} className="text-green-600" /> : <Copy size={14} />}
                    </button>
                    <button
                      onClick={handleRegenKey}
                      className="glass-button p-2"
                      title={t.requestForm.regenerate}
                    >
                      <RefreshCw size={14} />
                    </button>
                  </div>
                </div>

                {/* Script Embed */}
                <div className="section-card p-5 space-y-3">
                  <h3 className="text-[11px] font-bold uppercase tracking-wider text-text-tertiary">
                    {t.requestForm.scriptEmbedRecommended}
                  </h3>
                  <p className="text-[12px] text-text-tertiary">
                    {t.requestForm.copyThisCodeAndPasteItIntoYourWebsite}
                  </p>
                  <div className="relative">
                    <pre className="bg-surface-secondary rounded-lg px-4 py-3 text-[11px] font-mono text-text-secondary overflow-x-auto whitespace-pre-wrap break-all">
                      {scriptEmbed}
                    </pre>
                    <button
                      onClick={() => copyToClipboard(scriptEmbed, 'script')}
                      className="absolute top-2 right-2 glass-button p-1.5"
                    >
                      {copied === 'script' ? <ClipboardCheck size={12} className="text-green-600" /> : <Copy size={12} />}
                    </button>
                  </div>
                </div>

                {/* Iframe Embed */}
                <div className="section-card p-5 space-y-3">
                  <h3 className="text-[11px] font-bold uppercase tracking-wider text-text-tertiary">
                    {t.requestForm.iframeEmbedFallback}
                  </h3>
                  <div className="relative">
                    <pre className="bg-surface-secondary rounded-lg px-4 py-3 text-[11px] font-mono text-text-secondary overflow-x-auto whitespace-pre-wrap break-all">
                      {iframeEmbed}
                    </pre>
                    <button
                      onClick={() => copyToClipboard(iframeEmbed, 'iframe')}
                      className="absolute top-2 right-2 glass-button p-1.5"
                    >
                      {copied === 'iframe' ? <ClipboardCheck size={12} className="text-green-600" /> : <Copy size={12} />}
                    </button>
                  </div>
                </div>
              </>
            )}
          </motion.div>
        )}

        {/* ═══ PREVIEW ═══ */}
        {activeSection === 'preview' && (
          <motion.div
            key="preview"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
          >
            <FormPreview
              title={title}
              description={description}
              customFields={customFields}
              isFr={isFr}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
