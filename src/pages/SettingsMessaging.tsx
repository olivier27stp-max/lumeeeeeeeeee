import { useEffect, useState } from 'react';
import {
  MessageSquare,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Send,
  Copy,
  Check,
  ShieldCheck,
  Clock,
  XCircle,
  RefreshCw,
} from 'lucide-react';
import BackToSettings from '../components/ui/BackToSettings';
import {
  fetchChannels,
  sendSms,
  fetchA2PStatus,
  submitA2PBrand,
  submitA2PCampaign,
  refreshA2PStatus,
  type CommunicationChannel,
  type A2PRegistration,
  type A2PBrandPayload,
  type A2PCampaignPayload,
} from '../lib/communicationsApi';
import { useTranslation } from '../i18n';
import { supabase } from '../lib/supabase';
import { getCurrentOrgId } from '../lib/orgApi';

export default function SettingsMessaging() {
  const { language } = useTranslation();
  const isFr = language === 'fr';

  const [loading, setLoading] = useState(true);
  const [channel, setChannel] = useState<CommunicationChannel | null>(null);
  const [loadError, setLoadError] = useState('');
  const [copied, setCopied] = useState(false);

  const [orgCountry, setOrgCountry] = useState<string | null>(null);
  const [a2p, setA2p] = useState<A2PRegistration | null>(null);

  const [testPhone, setTestPhone] = useState('');
  const [testBody, setTestBody] = useState(
    isFr ? 'Test depuis Lume CRM ✅' : 'Test from Lume CRM ✅',
  );
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ ok: boolean; msg: string } | null>(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    setLoadError('');
    try {
      const orgId = await getCurrentOrgId();
      let country: string | null = null;
      if (orgId) {
        const { data: org } = await supabase
          .from('orgs')
          .select('country')
          .eq('id', orgId)
          .maybeSingle();
        country = (org?.country || 'CA').toUpperCase();
        setOrgCountry(country);
      }

      const channels = await fetchChannels();
      const sms = channels.find((c) => c.channel_type === 'sms' && c.is_default) || null;
      setChannel(sms);

      if (country === 'US') {
        try {
          const status = await fetchA2PStatus();
          setA2p(status);
        } catch {
          // Non-blocking — user can still see number info
        }
      }
    } catch (err: any) {
      setLoadError(err?.message || 'Failed to load channel');
    } finally {
      setLoading(false);
    }
  }

  async function handleCopy() {
    if (!channel?.phone_number) return;
    try {
      await navigator.clipboard.writeText(channel.phone_number);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard denied — ignore
    }
  }

  async function handleSendTest() {
    if (!testPhone.trim() || !testBody.trim()) return;
    setSending(true);
    setSendResult(null);
    try {
      await sendSms({ to: testPhone.trim(), body: testBody.trim() });
      setSendResult({ ok: true, msg: isFr ? 'Message envoyé.' : 'Message sent.' });
    } catch (err: any) {
      setSendResult({
        ok: false,
        msg: err?.message || (isFr ? 'Échec de l\'envoi.' : 'Send failed.'),
      });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6 px-6 py-8">
      <div className="flex items-center gap-3">
        <BackToSettings />
        <div className="w-11 h-11 rounded-2xl bg-surface-secondary flex items-center justify-center">
          <MessageSquare size={20} className="text-text-tertiary" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-text-primary tracking-tight">
            {isFr ? 'Messagerie SMS' : 'SMS Messaging'}
          </h1>
          <p className="text-[12px] text-text-tertiary mt-0.5">
            {isFr
              ? 'Votre numéro dédié pour envoyer et recevoir des SMS.'
              : 'Your dedicated number for sending and receiving SMS.'}
          </p>
        </div>
      </div>

      {/* ── Number card ─────────────────────────────────────────── */}
      <div className="glass-card rounded-2xl p-6 space-y-4">
        <p className="text-xs font-medium text-text-tertiary uppercase tracking-wider">
          {isFr ? 'Votre numéro' : 'Your number'}
        </p>

        {loading && (
          <div className="flex items-center gap-2 text-sm text-text-tertiary py-4">
            <Loader2 size={16} className="animate-spin" />
            {isFr ? 'Chargement…' : 'Loading…'}
          </div>
        )}

        {!loading && loadError && (
          <div className="flex items-start gap-2 text-sm text-red-600 bg-red-50 rounded-lg px-4 py-3">
            <AlertCircle size={16} className="shrink-0 mt-0.5" />
            <span>{loadError}</span>
          </div>
        )}

        {!loading && !loadError && !channel && (
          <div className="space-y-3">
            <div className="flex items-start gap-2 text-sm text-amber-700 bg-amber-50 rounded-lg px-4 py-3">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <span>
                {isFr
                  ? "Aucun numéro SMS n'est encore attribué. Votre numéro sera prêt dans quelques minutes après l'activation de votre plan."
                  : 'No SMS number assigned yet. Your number will be ready within a few minutes after plan activation.'}
              </span>
            </div>
            <button
              onClick={load}
              className="text-xs font-medium text-[#1F5F4F] hover:underline"
            >
              {isFr ? 'Actualiser' : 'Refresh'}
            </button>
          </div>
        )}

        {!loading && channel?.phone_number && (
          <div className="flex items-center justify-between bg-surface-secondary rounded-xl px-4 py-4">
            <div>
              <div className="text-2xl font-semibold text-text-primary tracking-tight">
                {channel.phone_number}
              </div>
              <div className="flex items-center gap-2 mt-1 text-xs text-text-tertiary">
                <CheckCircle2 size={12} className="text-[#3FAF97]" />
                <span>
                  {isFr ? 'Actif' : 'Active'} ·{' '}
                  {(channel.provider || 'twilio').charAt(0).toUpperCase() +
                    (channel.provider || 'twilio').slice(1)}
                </span>
              </div>
            </div>
            <button
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 px-3 h-9 rounded-lg bg-surface border border-outline text-xs font-medium text-text-primary hover:bg-surface-secondary transition"
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? (isFr ? 'Copié' : 'Copied') : (isFr ? 'Copier' : 'Copy')}
            </button>
          </div>
        )}
      </div>

      {/* ── A2P 10DLC wizard (US only) ──────────────────────────── */}
      {orgCountry === 'US' && channel?.phone_number && (
        <A2PSection a2p={a2p} onChange={setA2p} isFr={isFr} />
      )}

      {/* ── Test SMS card ───────────────────────────────────────── */}
      {channel?.phone_number && (
        <div className="glass-card rounded-2xl p-6 space-y-4">
          <div>
            <p className="text-xs font-medium text-text-tertiary uppercase tracking-wider">
              {isFr ? 'Tester votre numéro' : 'Test your number'}
            </p>
            <p className="text-[12px] text-text-tertiary mt-1">
              {isFr
                ? 'Envoyez un SMS à votre propre téléphone pour vérifier que tout fonctionne.'
                : 'Send an SMS to your own phone to verify everything works.'}
            </p>
          </div>

          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-text-tertiary">
                {isFr ? 'Numéro de destination' : 'Destination number'}
              </label>
              <input
                type="tel"
                value={testPhone}
                onChange={(e) => setTestPhone(e.target.value)}
                placeholder="+1 514 555 0100"
                className="glass-input w-full mt-1.5"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-text-tertiary">
                {isFr ? 'Message' : 'Message'}
              </label>
              <textarea
                value={testBody}
                onChange={(e) => setTestBody(e.target.value)}
                rows={3}
                maxLength={320}
                className="glass-input w-full mt-1.5 resize-none"
              />
              <div className="text-[11px] text-text-tertiary mt-1 text-right">
                {testBody.length} / 320
              </div>
            </div>

            <button
              onClick={handleSendTest}
              disabled={sending || !testPhone.trim() || !testBody.trim()}
              className="inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-[#1F5F4F] text-white text-sm font-medium hover:bg-[#1A4F41] disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              {sending
                ? isFr ? 'Envoi…' : 'Sending…'
                : isFr ? 'Envoyer le test' : 'Send test'}
            </button>

            {sendResult && (
              <div
                className={`flex items-start gap-2 text-sm rounded-lg px-4 py-3 ${
                  sendResult.ok
                    ? 'text-[#1F5F4F] bg-[#E8F4F0]'
                    : 'text-red-600 bg-red-50'
                }`}
              >
                {sendResult.ok ? (
                  <CheckCircle2 size={16} className="shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle size={16} className="shrink-0 mt-0.5" />
                )}
                <span>{sendResult.msg}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── CASL / compliance footer ────────────────────────────── */}
      <div className="glass-card rounded-2xl p-5 space-y-2">
        <p className="text-xs font-medium text-text-tertiary uppercase tracking-wider">
          {isFr ? 'Conformité LCAP / CASL' : 'CASL / Compliance'}
        </p>
        <p className="text-[12px] text-text-secondary leading-relaxed">
          {isFr
            ? "Les destinataires doivent avoir consenti à recevoir des SMS de votre entreprise. Incluez toujours l'option de désabonnement : « Répondez STOP pour arrêter. » Les réponses STOP sont traitées automatiquement et consignées."
            : 'Recipients must have consented to receive SMS from your business. Always include the opt-out: "Reply STOP to unsubscribe." STOP replies are handled automatically and logged.'}
        </p>
      </div>
    </div>
  );
}

// ─── A2P Section ────────────────────────────────────────────────────────
function A2PSection({
  a2p,
  onChange,
  isFr,
}: {
  a2p: A2PRegistration | null;
  onChange: (a: A2PRegistration | null) => void;
  isFr: boolean;
}) {
  const [step, setStep] = useState<'intro' | 'brand' | 'campaign'>('intro');
  const [submitting, setSubmitting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const brandStatus = a2p?.brand_status || 'not_started';
  const campaignStatus = a2p?.campaign_status || 'not_started';
  const brandVerified = brandStatus === 'verified';
  const campaignVerified = campaignStatus === 'verified';

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await refreshA2PStatus();
      const latest = await fetchA2PStatus();
      onChange(latest);
    } catch (err: any) {
      setError(err?.message || 'Refresh failed');
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="glass-card rounded-2xl p-6 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-text-tertiary uppercase tracking-wider flex items-center gap-1.5">
            <ShieldCheck size={12} /> A2P 10DLC
          </p>
          <p className="text-[12px] text-text-tertiary mt-1">
            {isFr
              ? 'Obligatoire pour envoyer des SMS aux USA. Enregistrement auprès des opérateurs.'
              : 'Required to send SMS to US numbers. Registration with US carriers.'}
          </p>
        </div>
        {a2p && (
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 px-3 h-8 rounded-lg bg-surface border border-outline text-xs font-medium text-text-primary hover:bg-surface-secondary disabled:opacity-50"
          >
            <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
            {isFr ? 'Actualiser' : 'Refresh'}
          </button>
        )}
      </div>

      {/* Status pills */}
      <div className="grid grid-cols-2 gap-3">
        <StatusPill label={isFr ? 'Marque' : 'Brand'} status={brandStatus} isFr={isFr} />
        <StatusPill label={isFr ? 'Campagne' : 'Campaign'} status={campaignStatus} isFr={isFr} />
      </div>

      {a2p?.brand_error && brandStatus === 'failed' && (
        <div className="flex items-start gap-2 text-sm text-red-600 bg-red-50 rounded-lg px-4 py-3">
          <AlertCircle size={14} className="shrink-0 mt-0.5" />
          <span>{a2p.brand_error}</span>
        </div>
      )}
      {a2p?.campaign_error && campaignStatus === 'failed' && (
        <div className="flex items-start gap-2 text-sm text-red-600 bg-red-50 rounded-lg px-4 py-3">
          <AlertCircle size={14} className="shrink-0 mt-0.5" />
          <span>{a2p.campaign_error}</span>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 text-sm text-red-600 bg-red-50 rounded-lg px-4 py-3">
          <AlertCircle size={14} className="shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Action area */}
      {brandStatus === 'not_started' && step === 'intro' && (
        <div className="space-y-3">
          <p className="text-sm text-text-secondary leading-relaxed">
            {isFr
              ? "Pour envoyer aux USA, vous devez enregistrer votre marque et votre campagne. Prévoyez 5-10 minutes. L'approbation prend ensuite 1-7 jours ouvrables."
              : 'To send to US numbers, you must register your brand and campaign. Takes 5-10 minutes. Approval then takes 1-7 business days.'}
          </p>
          <button
            onClick={() => setStep('brand')}
            className="inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-[#1F5F4F] text-white text-sm font-medium hover:bg-[#1A4F41]"
          >
            {isFr ? "Commencer l'enregistrement" : 'Start registration'}
          </button>
        </div>
      )}

      {step === 'brand' && !brandVerified && (
        <BrandForm
          isFr={isFr}
          initial={a2p}
          submitting={submitting}
          onSubmit={async (payload) => {
            setSubmitting(true);
            setError('');
            try {
              await submitA2PBrand(payload);
              const latest = await fetchA2PStatus();
              onChange(latest);
              setStep('intro');
            } catch (err: any) {
              setError(err?.message || 'Submit failed');
            } finally {
              setSubmitting(false);
            }
          }}
          onCancel={() => setStep('intro')}
        />
      )}

      {brandVerified && !campaignVerified && step !== 'campaign' && campaignStatus === 'not_started' && (
        <div className="space-y-3">
          <div className="flex items-start gap-2 text-sm text-[#1F5F4F] bg-[#E8F4F0] rounded-lg px-4 py-3">
            <CheckCircle2 size={14} className="shrink-0 mt-0.5" />
            <span>
              {isFr
                ? 'Marque vérifiée. Enregistrez maintenant votre campagne pour pouvoir envoyer des SMS.'
                : 'Brand verified. Now register your campaign to start sending SMS.'}
            </span>
          </div>
          <button
            onClick={() => setStep('campaign')}
            className="inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-[#1F5F4F] text-white text-sm font-medium hover:bg-[#1A4F41]"
          >
            {isFr ? 'Enregistrer la campagne' : 'Register campaign'}
          </button>
        </div>
      )}

      {step === 'campaign' && brandVerified && !campaignVerified && (
        <CampaignForm
          isFr={isFr}
          initial={a2p}
          submitting={submitting}
          onSubmit={async (payload) => {
            setSubmitting(true);
            setError('');
            try {
              await submitA2PCampaign(payload);
              const latest = await fetchA2PStatus();
              onChange(latest);
              setStep('intro');
            } catch (err: any) {
              setError(err?.message || 'Submit failed');
            } finally {
              setSubmitting(false);
            }
          }}
          onCancel={() => setStep('intro')}
        />
      )}

      {(brandStatus === 'in_review' || brandStatus === 'submitted') && campaignStatus === 'not_started' && (
        <div className="flex items-start gap-2 text-sm text-amber-700 bg-amber-50 rounded-lg px-4 py-3">
          <Clock size={14} className="shrink-0 mt-0.5" />
          <span>
            {isFr
              ? 'Marque en cours de vérification (1-5 jours ouvrables). Nous vous enverrons un courriel dès que c\'est approuvé.'
              : 'Brand under review (1-5 business days). We\'ll email you as soon as it\'s approved.'}
          </span>
        </div>
      )}

      {campaignVerified && brandVerified && (
        <div className="flex items-start gap-2 text-sm text-[#1F5F4F] bg-[#E8F4F0] rounded-lg px-4 py-3">
          <CheckCircle2 size={14} className="shrink-0 mt-0.5" />
          <span>
            {isFr
              ? 'Enregistrement complet. Vous pouvez envoyer des SMS à des numéros US.'
              : 'Fully registered. You can now send SMS to US numbers.'}
          </span>
        </div>
      )}
    </div>
  );
}

function StatusPill({ label, status, isFr }: { label: string; status: string; isFr: boolean }) {
  const { icon, text, cls } = statusMeta(status, isFr);
  return (
    <div className={`rounded-lg px-4 py-3 ${cls}`}>
      <div className="text-[11px] font-medium uppercase tracking-wider opacity-70">{label}</div>
      <div className="flex items-center gap-1.5 mt-1 text-sm font-medium">
        {icon}
        <span>{text}</span>
      </div>
    </div>
  );
}

function statusMeta(status: string, isFr: boolean) {
  switch (status) {
    case 'verified':
      return {
        icon: <CheckCircle2 size={14} />,
        text: isFr ? 'Vérifié' : 'Verified',
        cls: 'bg-[#E8F4F0] text-[#1F5F4F]',
      };
    case 'failed':
      return {
        icon: <XCircle size={14} />,
        text: isFr ? 'Rejeté' : 'Failed',
        cls: 'bg-red-50 text-red-600',
      };
    case 'in_review':
      return {
        icon: <Clock size={14} />,
        text: isFr ? 'En revue' : 'In review',
        cls: 'bg-amber-50 text-amber-700',
      };
    case 'submitted':
      return {
        icon: <Clock size={14} />,
        text: isFr ? 'Soumis' : 'Submitted',
        cls: 'bg-amber-50 text-amber-700',
      };
    default:
      return {
        icon: <AlertCircle size={14} />,
        text: isFr ? 'Non commencé' : 'Not started',
        cls: 'bg-surface-secondary text-text-tertiary',
      };
  }
}

// ─── Brand form ────────────────────────────────────────────────────────
function BrandForm({
  isFr,
  initial,
  submitting,
  onSubmit,
  onCancel,
}: {
  isFr: boolean;
  initial: A2PRegistration | null;
  submitting: boolean;
  onSubmit: (p: A2PBrandPayload) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<A2PBrandPayload>({
    legal_business_name: initial?.legal_business_name || '',
    ein: initial?.ein || '',
    business_type: initial?.business_type || 'PRIVATE_PROFIT',
    vertical: initial?.vertical || 'TECHNOLOGY',
    street: initial?.street || '',
    city: initial?.city || '',
    region: initial?.region || '',
    postal_code: initial?.postal_code || '',
    country: initial?.country || 'US',
    website: initial?.website || '',
    support_email: initial?.support_email || '',
    support_phone: initial?.support_phone || '',
  });

  const set = (k: keyof A2PBrandPayload) => (e: any) =>
    setForm({ ...form, [k]: e.target.value });

  return (
    <div className="space-y-3 border-t border-outline pt-4">
      <h3 className="text-sm font-semibold text-text-primary">
        {isFr ? 'Informations de la marque' : 'Brand information'}
      </h3>

      <div className="grid grid-cols-2 gap-3">
        <Field label={isFr ? 'Raison sociale' : 'Legal business name'}>
          <input className="glass-input w-full" value={form.legal_business_name} onChange={set('legal_business_name')} />
        </Field>
        <Field label="EIN">
          <input className="glass-input w-full" placeholder="12-3456789" value={form.ein} onChange={set('ein')} />
        </Field>
        <Field label={isFr ? "Type d'entreprise" : 'Business type'}>
          <select className="glass-input w-full" value={form.business_type} onChange={set('business_type')}>
            <option value="PRIVATE_PROFIT">Private for-profit</option>
            <option value="PUBLIC_PROFIT">Public for-profit</option>
            <option value="NON_PROFIT">Non-profit</option>
            <option value="SOLE_PROPRIETOR">Sole proprietor</option>
          </select>
        </Field>
        <Field label={isFr ? 'Secteur' : 'Vertical'}>
          <select className="glass-input w-full" value={form.vertical} onChange={set('vertical')}>
            {['TECHNOLOGY', 'RETAIL', 'HEALTHCARE', 'REAL_ESTATE', 'PROFESSIONAL', 'CONSTRUCTION', 'EDUCATION', 'NON_PROFIT', 'FINANCIAL', 'HOSPITALITY', 'OTHER'].map(v => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </Field>
        <Field label={isFr ? 'Adresse' : 'Street'}>
          <input className="glass-input w-full" value={form.street} onChange={set('street')} />
        </Field>
        <Field label={isFr ? 'Ville' : 'City'}>
          <input className="glass-input w-full" value={form.city} onChange={set('city')} />
        </Field>
        <Field label={isFr ? 'État' : 'State'}>
          <input className="glass-input w-full" placeholder="NY" maxLength={2} value={form.region} onChange={set('region')} />
        </Field>
        <Field label="ZIP">
          <input className="glass-input w-full" value={form.postal_code} onChange={set('postal_code')} />
        </Field>
        <Field label={isFr ? 'Site web' : 'Website'}>
          <input className="glass-input w-full" placeholder="https://…" value={form.website} onChange={set('website')} />
        </Field>
        <Field label={isFr ? 'Courriel support' : 'Support email'}>
          <input className="glass-input w-full" type="email" value={form.support_email} onChange={set('support_email')} />
        </Field>
        <Field label={isFr ? 'Téléphone support' : 'Support phone'}>
          <input className="glass-input w-full" value={form.support_phone} onChange={set('support_phone')} />
        </Field>
      </div>

      <div className="flex items-center gap-2 pt-2">
        <button
          onClick={() => onSubmit(form)}
          disabled={submitting}
          className="inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-[#1F5F4F] text-white text-sm font-medium hover:bg-[#1A4F41] disabled:opacity-50"
        >
          {submitting && <Loader2 size={14} className="animate-spin" />}
          {isFr ? 'Soumettre la marque' : 'Submit brand'}
        </button>
        <button
          onClick={onCancel}
          className="h-10 px-4 rounded-lg bg-surface border border-outline text-sm text-text-primary hover:bg-surface-secondary"
        >
          {isFr ? 'Annuler' : 'Cancel'}
        </button>
      </div>
    </div>
  );
}

// ─── Campaign form ────────────────────────────────────────────────────
function CampaignForm({
  isFr,
  initial,
  submitting,
  onSubmit,
  onCancel,
}: {
  isFr: boolean;
  initial: A2PRegistration | null;
  submitting: boolean;
  onSubmit: (p: A2PCampaignPayload) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<A2PCampaignPayload>({
    use_case: initial?.use_case || 'CUSTOMER_CARE',
    description: initial?.campaign_description || '',
    message_samples:
      initial?.message_samples && initial.message_samples.length >= 2
        ? initial.message_samples
        : ['', ''],
    opt_in_keywords: initial?.opt_in_keywords || ['START'],
    opt_in_message:
      initial?.opt_in_message || 'You are now subscribed. Reply STOP to unsubscribe.',
    opt_out_message:
      initial?.opt_out_message || 'You have been unsubscribed. Reply START to resubscribe.',
    has_embedded_links: initial?.has_embedded_links || false,
    has_embedded_phone: initial?.has_embedded_phone || false,
  });

  const updateSample = (idx: number, v: string) => {
    const next = [...form.message_samples];
    next[idx] = v;
    setForm({ ...form, message_samples: next });
  };

  return (
    <div className="space-y-3 border-t border-outline pt-4">
      <h3 className="text-sm font-semibold text-text-primary">
        {isFr ? 'Informations de la campagne' : 'Campaign information'}
      </h3>

      <Field label={isFr ? "Cas d'usage" : 'Use case'}>
        <select
          className="glass-input w-full"
          value={form.use_case}
          onChange={(e) => setForm({ ...form, use_case: e.target.value })}
        >
          <option value="CUSTOMER_CARE">Customer care</option>
          <option value="MARKETING">Marketing</option>
          <option value="MIXED">Mixed</option>
          <option value="LOW_VOLUME">Low volume / testing</option>
        </select>
      </Field>

      <Field label={isFr ? 'Description (min 40 caractères)' : 'Description (min 40 chars)'}>
        <textarea
          className="glass-input w-full resize-none"
          rows={3}
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          placeholder={
            isFr
              ? 'Expliquez quel type de messages vous envoyez et à qui.'
              : 'Describe what kind of messages you send and to whom.'
          }
        />
      </Field>

      <div>
        <label className="text-xs font-medium text-text-tertiary">
          {isFr ? 'Exemples de messages (2 min.)' : 'Message samples (2 min.)'}
        </label>
        {form.message_samples.map((s, i) => (
          <textarea
            key={i}
            rows={2}
            className="glass-input w-full mt-1.5 resize-none"
            value={s}
            onChange={(e) => updateSample(i, e.target.value)}
            placeholder={isFr ? `Exemple #${i + 1}` : `Sample #${i + 1}`}
          />
        ))}
        {form.message_samples.length < 5 && (
          <button
            onClick={() =>
              setForm({ ...form, message_samples: [...form.message_samples, ''] })
            }
            className="mt-2 text-xs font-medium text-[#1F5F4F] hover:underline"
          >
            {isFr ? '+ Ajouter un exemple' : '+ Add sample'}
          </button>
        )}
      </div>

      <Field label={isFr ? "Message d'opt-in" : 'Opt-in message'}>
        <input
          className="glass-input w-full"
          value={form.opt_in_message}
          onChange={(e) => setForm({ ...form, opt_in_message: e.target.value })}
        />
      </Field>

      <div className="flex items-center gap-4 text-sm text-text-secondary">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={form.has_embedded_links}
            onChange={(e) =>
              setForm({ ...form, has_embedded_links: e.target.checked })
            }
          />
          {isFr ? 'Liens dans les messages' : 'Embedded links'}
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={form.has_embedded_phone}
            onChange={(e) =>
              setForm({ ...form, has_embedded_phone: e.target.checked })
            }
          />
          {isFr ? 'Numéros de tél. dans les messages' : 'Embedded phone numbers'}
        </label>
      </div>

      <div className="flex items-center gap-2 pt-2">
        <button
          onClick={() => onSubmit(form)}
          disabled={submitting}
          className="inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-[#1F5F4F] text-white text-sm font-medium hover:bg-[#1A4F41] disabled:opacity-50"
        >
          {submitting && <Loader2 size={14} className="animate-spin" />}
          {isFr ? 'Soumettre la campagne' : 'Submit campaign'}
        </button>
        <button
          onClick={onCancel}
          className="h-10 px-4 rounded-lg bg-surface border border-outline text-sm text-text-primary hover:bg-surface-secondary"
        >
          {isFr ? 'Annuler' : 'Cancel'}
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs font-medium text-text-tertiary">{label}</label>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}
