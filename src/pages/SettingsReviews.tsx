/* ═══════════════════════════════════════════════════════════════
   SettingsReviews — Réglages « Avis clients » (/settings/reviews)

   Workflow : job terminée → sondage d'étoiles envoyé tout de suite
     • 5 étoiles → redirection Google / Facebook + message d'invitation
     • 4 étoiles ou moins → formulaire de commentaires interne + tâche de suivi

   Cette page possède les liens de redirection, l'interrupteur principal et
   TOUS les textes vus par le client (colonnes review_* de company_settings :
   SMS, courriel, question, message note basse, remerciement, invitation),
   plus le SMS de rappel de l'automatisation review_reminder_7d.
   ═══════════════════════════════════════════════════════════════ */

import { useEffect, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Star,
  Check,
  Loader2,
  ExternalLink,
  MessageSquareText,
  Send,
  ThumbsUp,
  ThumbsDown,
  Zap,
  Facebook,
  Globe,
  Mail,
  MessageSquare,
  Pencil,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '../lib/supabase';
import { getCurrentOrgIdOrThrow } from '../lib/orgApi';
import { cn } from '../lib/utils';
import { PageHeader } from '../components/ui';
import { useTranslation } from '../i18n';
import { getAutomationRules, toggleAutomationRule, updateRuleSmsBody, type AutomationRule } from '../lib/automationRulesApi';

// Miroir de server/lib/reviews.ts (texte par défaut affiché au client).
const DEFAULT_INVITE_FR =
  'Merci beaucoup ! Votre avis compte énormément pour une petite entreprise comme la nôtre. '
  + 'Prendriez-vous 30 secondes pour partager votre expérience ? Ça nous aide vraiment.';
const DEFAULT_INVITE_EN =
  'Thank you so much! Your review means the world to a small business like ours. '
  + 'Would you take 30 seconds to share your experience? It truly helps us.';

// Défauts des messages (miroir de server/lib/reviews.ts).
const DEFAULT_SMS_FR =
  "Bonjour [client_first_name], merci d'avoir choisi [company_name] ! "
  + "Comment s'est passé notre service ? Notez-nous en 10 secondes : [survey_url]";
const DEFAULT_EMAIL_SUBJECT_FR = "[company_name] — Comment s'est passé notre service ?";
const DEFAULT_EMAIL_BODY_FR =
  'Bonjour [client_first_name],\n\n'
  + 'Nous venons de terminer [job_name] et votre opinion compte pour nous.\n\n'
  + 'Notez votre expérience en 10 secondes :\n\n'
  + '[survey_url]\n\n'
  + "Merci d'avoir choisi [company_name] !";
const DEFAULT_QUESTION_FR = "Comment s'est passé notre service ?";
const DEFAULT_QUESTION_EN = 'How did we do?';
const DEFAULT_LOW_RATING_FR =
  "Nous sommes désolés que ce ne soit pas à la hauteur. Dites-nous ce qui n'a pas fonctionné : "
  + "votre message est envoyé directement à l'équipe, il n'est pas publié.";
const DEFAULT_LOW_RATING_EN =
  "We're sorry it wasn't up to par. Tell us what went wrong: your message goes straight to the team, it is not published.";
const DEFAULT_THANK_YOU_FR = "Merci pour votre franchise. Un membre de l'équipe vous contactera rapidement.";
const DEFAULT_THANK_YOU_EN = 'Thank you for your honesty. A team member will reach out to you shortly.';

const TEMPLATE_VARIABLES = ['client_first_name', 'client_name', 'company_name', 'job_name', 'survey_url'] as const;

const SAMPLE_VARS: Record<string, string> = {
  client_first_name: 'Marie',
  client_name: 'Marie Tremblay',
  company_name: 'Votre entreprise',
  job_name: 'Lavage de vitres',
  survey_url: 'https://lumecrm.net/survey/8f3a…',
};

function resolveSample(template: string, companyName?: string): string {
  const vars: Record<string, string> = { ...SAMPLE_VARS, company_name: companyName || SAMPLE_VARS.company_name };
  return template
    .replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '')
    .replace(/\[(\w+)\]/g, (_, k) => vars[k] ?? '');
}

const REVIEW_PRESET_KEYS = ['google_review', 'review_reminder_7d'];

interface ReviewSettings {
  id?: string;
  review_enabled: boolean;
  google_review_url: string;
  facebook_review_url: string;
  review_invite_message: string;
  review_sms_body: string;
  review_email_subject: string;
  review_email_body: string;
  review_survey_question: string;
  review_low_rating_message: string;
  review_thank_you_message: string;
  company_name: string;
}

const EMPTY: ReviewSettings = {
  review_enabled: false,
  google_review_url: '',
  facebook_review_url: '',
  review_invite_message: '',
  review_sms_body: '',
  review_email_subject: '',
  review_email_body: '',
  review_survey_question: '',
  review_low_rating_message: '',
  review_thank_you_message: '',
  company_name: '',
};

function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function isValidUrl(url: string): boolean {
  return /^https:\/\/[^\s.]+\.\S{2,}$/i.test(url);
}

function humanDelay(seconds: number, isFr: boolean): string {
  if (seconds === 0) return isFr ? 'immédiatement' : 'immediately';
  if (seconds >= 86400) {
    const d = Math.round(seconds / 86400);
    return isFr ? `${d} jour${d > 1 ? 's' : ''} après` : `${d} day${d > 1 ? 's' : ''} after`;
  }
  const h = Math.round(seconds / 3600);
  return isFr ? `${h} h après` : `${h} h after`;
}

export default function SettingsReviews() {
  const id = useId();
  const { language } = useTranslation();
  const isFr = language === 'fr';

  const [form, setForm] = useState<ReviewSettings>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [ruleDraft, setRuleDraft] = useState('');
  const [savingRule, setSavingRule] = useState(false);

  const update = <K extends keyof ReviewSettings>(key: K, value: ReviewSettings[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
    setSaved(false);
  };

  async function load() {
    setLoading(true);
    setLoadFailed(false);
    try {
      const orgId = await getCurrentOrgIdOrThrow();
      const [{ data, error }, allRules] = await Promise.all([
        supabase
          .from('company_settings')
          .select('id, company_name, review_enabled, google_review_url, facebook_review_url, review_invite_message, review_sms_body, review_email_subject, review_email_body, review_survey_question, review_low_rating_message, review_thank_you_message')
          .eq('org_id', orgId)
          .limit(1)
          .maybeSingle(),
        getAutomationRules().catch(() => [] as AutomationRule[]),
      ]);
      if (error) throw error;
      if (data) {
        setForm({
          id: data.id,
          review_enabled: data.review_enabled ?? false,
          google_review_url: data.google_review_url || '',
          facebook_review_url: data.facebook_review_url || '',
          review_invite_message: data.review_invite_message || '',
          review_sms_body: data.review_sms_body || '',
          review_email_subject: data.review_email_subject || '',
          review_email_body: data.review_email_body || '',
          review_survey_question: data.review_survey_question || '',
          review_low_rating_message: data.review_low_rating_message || '',
          review_thank_you_message: data.review_thank_you_message || '',
          company_name: data.company_name || '',
        });
      }
      setRules(allRules.filter((r) => r.preset_key && REVIEW_PRESET_KEYS.includes(r.preset_key)));
      setDirty(false);
    } catch (e: any) {
      setLoadFailed(true);
      toast.error(e?.message || (isFr ? 'Échec du chargement des réglages d’avis.' : 'Failed to load review settings.'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const google = normalizeUrl(form.google_review_url);
  const facebook = normalizeUrl(form.facebook_review_url);
  const hasDestination = Boolean(google || facebook);

  async function handleSave() {
    if (google && !isValidUrl(google)) {
      toast.error(isFr ? 'Lien Google invalide (doit commencer par https://).' : 'Invalid Google link (must start with https://).');
      return;
    }
    if (facebook && !isValidUrl(facebook)) {
      toast.error(isFr ? 'Lien Facebook invalide (doit commencer par https://).' : 'Invalid Facebook link (must start with https://).');
      return;
    }
    if (form.review_enabled && !hasDestination) {
      toast.error(isFr
        ? 'Ajoutez au moins un lien (Google ou Facebook) avant d’activer les demandes d’avis.'
        : 'Add at least one link (Google or Facebook) before enabling review requests.');
      return;
    }

    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const orgId = await getCurrentOrgIdOrThrow();

      const payload = {
        review_enabled: form.review_enabled,
        google_review_url: google,
        facebook_review_url: facebook,
        review_invite_message: form.review_invite_message.trim() || null,
        review_sms_body: form.review_sms_body.trim() || null,
        review_email_subject: form.review_email_subject.trim() || null,
        review_email_body: form.review_email_body.trim() || null,
        review_survey_question: form.review_survey_question.trim() || null,
        review_low_rating_message: form.review_low_rating_message.trim() || null,
        review_thank_you_message: form.review_thank_you_message.trim() || null,
        updated_at: new Date().toISOString(),
      };

      if (form.id) {
        const { error } = await supabase.from('company_settings').update(payload).eq('id', form.id);
        if (error) throw error;
      } else {
        // Upsert sur org_id : jamais de 2e ligne company_settings pour une org.
        const { data, error } = await supabase
          .from('company_settings')
          .upsert({ ...payload, org_id: orgId, created_by: user.id }, { onConflict: 'org_id' })
          .select('id')
          .single();
        if (error) throw error;
        if (data) setForm((prev) => ({ ...prev, id: data.id }));
      }

      setForm((prev) => ({ ...prev, google_review_url: google, facebook_review_url: facebook }));
      setSaved(true);
      setDirty(false);
      toast.success(isFr ? 'Réglages d’avis enregistrés.' : 'Review settings saved.');
      setTimeout(() => setSaved(false), 2000);
    } catch (e: any) {
      toast.error(e?.message || (isFr ? 'Erreur lors de l’enregistrement.' : 'Failed to save.'));
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleRule(rule: AutomationRule) {
    setTogglingId(rule.id);
    try {
      await toggleAutomationRule(rule.id, !rule.is_active);
      setRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, is_active: !r.is_active } : r)));
    } catch (e: any) {
      toast.error(e?.message || (isFr ? 'Impossible de modifier l’automatisation.' : 'Could not update automation.'));
    } finally {
      setTogglingId(null);
    }
  }

  function smsBodyOf(rule: AutomationRule): string {
    return String(rule.actions.find((a) => a.type === 'send_sms')?.config?.body || '');
  }

  async function handleSaveRuleSms(rule: AutomationRule) {
    setSavingRule(true);
    try {
      await updateRuleSmsBody(rule.id, ruleDraft.trim());
      setRules((prev) => prev.map((r) => (r.id === rule.id
        ? { ...r, actions: r.actions.map((a) => (a.type === 'send_sms' ? { ...a, config: { ...a.config, body: ruleDraft.trim() } } : a)) }
        : r)));
      setEditingRuleId(null);
      toast.success(isFr ? 'SMS de rappel enregistré.' : 'Reminder SMS saved.');
    } catch (e: any) {
      toast.error(e?.message || (isFr ? 'Impossible d’enregistrer le SMS.' : 'Could not save the SMS.'));
    } finally {
      setSavingRule(false);
    }
  }

  const inviteDefault = isFr ? DEFAULT_INVITE_FR : DEFAULT_INVITE_EN;
  const invitePreview = form.review_invite_message.trim() || inviteDefault;
  const smsPreview = resolveSample(form.review_sms_body.trim() || DEFAULT_SMS_FR, form.company_name);
  const emailSubjectPreview = resolveSample(form.review_email_subject.trim() || DEFAULT_EMAIL_SUBJECT_FR, form.company_name);
  const emailBodyPreview = resolveSample(form.review_email_body.trim() || DEFAULT_EMAIL_BODY_FR, form.company_name);
  const questionDefault = isFr ? DEFAULT_QUESTION_FR : DEFAULT_QUESTION_EN;
  const lowRatingDefault = isFr ? DEFAULT_LOW_RATING_FR : DEFAULT_LOW_RATING_EN;
  const thankYouDefault = isFr ? DEFAULT_THANK_YOU_FR : DEFAULT_THANK_YOU_EN;

  const variablesHint = (
    <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-text-tertiary">
      <span>{isFr ? 'Variables :' : 'Variables:'}</span>
      {TEMPLATE_VARIABLES.map((v) => (
        <code key={v} className="rounded-md bg-surface-secondary border border-outline px-1.5 py-0.5 text-[11px] text-text-secondary">[{v}]</code>
      ))}
    </div>
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={20} className="animate-spin text-text-tertiary" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader
        title={isFr ? 'Avis clients' : 'Customer reviews'}
        subtitle={isFr
          ? 'Sondage d’étoiles envoyé dès la fin de la job, puis redirection vers vos pages d’avis.'
          : 'Star survey sent as soon as the job is done, then redirect to your review pages.'}
        icon={Star}
        iconColor="amber"
      />

      {/* ── Comment ça marche ── */}
      <div className="section-card p-6 space-y-4">
        <h3 className="text-[13px] font-semibold uppercase tracking-wider text-text-tertiary flex items-center gap-1.5">
          <Zap size={12} /> {isFr ? 'Comment ça marche' : 'How it works'}
        </h3>
        <ol className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-[13px]">
          <li className="rounded-xl border border-outline bg-surface-subtle p-4 space-y-1.5">
            <div className="flex items-center gap-2 font-semibold text-text-primary">
              <span className="h-6 w-6 rounded-full bg-primary text-white text-[12px] flex items-center justify-center">1</span>
              <Send size={14} />
              {isFr ? 'Job terminée' : 'Job completed'}
            </div>
            <p className="text-text-secondary">
              {isFr
                ? 'Le client reçoit tout de suite, par courriel et SMS, un lien pour noter de 1 à 5 étoiles.'
                : 'The client immediately gets an email and SMS link to rate from 1 to 5 stars.'}
            </p>
          </li>
          <li className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50/60 dark:bg-emerald-900/20 p-4 space-y-1.5">
            <div className="flex items-center gap-2 font-semibold text-text-primary">
              <span className="h-6 w-6 rounded-full bg-emerald-600 text-white text-[12px] flex items-center justify-center">2</span>
              <ThumbsUp size={14} />
              {isFr ? '5 étoiles' : '5 stars'}
            </div>
            <p className="text-text-secondary">
              {isFr
                ? 'Votre message d’invitation s’affiche, puis le client est redirigé vers Google ou Facebook pour laisser son avis.'
                : 'Your invite message shows, then the client is redirected to Google or Facebook to leave a review.'}
            </p>
          </li>
          <li className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-900/20 p-4 space-y-1.5">
            <div className="flex items-center gap-2 font-semibold text-text-primary">
              <span className="h-6 w-6 rounded-full bg-amber-500 text-white text-[12px] flex items-center justify-center">3</span>
              <ThumbsDown size={14} />
              {isFr ? '4 étoiles ou moins' : '4 stars or less'}
            </div>
            <p className="text-text-secondary">
              {isFr
                ? 'Aucune redirection publique : un formulaire de commentaires interne s’ouvre et une tâche de suivi est créée pour vous.'
                : 'No public redirect: an internal feedback form opens and a follow-up task is created for you.'}
            </p>
          </li>
        </ol>
      </div>

      {/* ── Activation ── */}
      <div className="section-card p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-text-primary">
              {isFr ? 'Demander un avis à la fin de chaque job' : 'Ask for a review after every job'}
            </p>
            <p className="text-[12px] text-text-tertiary">
              {isFr
                ? 'Interrupteur principal. Désactivé, aucun sondage ni rappel d’avis ne part.'
                : 'Master switch. When off, no survey or review reminder is sent.'}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={form.review_enabled}
            onClick={() => {
              if (!form.review_enabled && !hasDestination) {
                toast.error(isFr ? 'Ajoutez d’abord un lien Google ou Facebook.' : 'Add a Google or Facebook link first.');
                return;
              }
              update('review_enabled', !form.review_enabled);
            }}
            className={cn(
              'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors',
              form.review_enabled ? 'bg-primary' : 'bg-gray-300 dark:bg-gray-600',
            )}
          >
            <span className={cn(
              'inline-block h-4 w-4 transform rounded-full bg-surface-card transition-transform',
              form.review_enabled ? 'translate-x-6' : 'translate-x-1',
            )} />
          </button>
        </div>
        {!hasDestination && (
          <div className="mt-4 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-3 py-2">
            <p className="text-[12px] text-amber-700 dark:text-amber-300">
              {isFr
                ? 'Aucun lien configuré : les clients satisfaits n’auront nulle part où laisser leur avis. Ajoutez Google, Facebook ou les deux ci-dessous.'
                : 'No link configured: happy clients will have nowhere to leave a review. Add Google, Facebook or both below.'}
            </p>
          </div>
        )}
      </div>

      {/* ── Liens de redirection ── */}
      <div className="section-card p-6 space-y-5">
        <h3 className="text-[13px] font-semibold uppercase tracking-wider text-text-tertiary flex items-center gap-1.5">
          <ExternalLink size={12} /> {isFr ? 'Pages d’avis (5 étoiles)' : 'Review pages (5 stars)'}
        </h3>

        <div>
          <label htmlFor={`${id}-google`} className="text-xs font-medium text-text-tertiary uppercase tracking-wider flex items-center gap-1">
            <Globe size={10} /> {isFr ? 'Fiche Google (Google Business Profile)' : 'Google Business Profile'}
          </label>
          <input
            id={`${id}-google`}
            type="url"
            value={form.google_review_url}
            onChange={(e) => update('google_review_url', e.target.value)}
            className="glass-input w-full mt-1"
            placeholder="https://g.page/r/XXXXXXXX/review"
          />
          <p className="text-[12px] text-text-tertiary mt-1">
            {isFr
              ? 'Dans votre fiche Google Business → « Demander des avis » → copiez le lien court.'
              : 'In your Google Business Profile → “Ask for reviews” → copy the short link.'}
          </p>
        </div>

        <div>
          <label htmlFor={`${id}-facebook`} className="text-xs font-medium text-text-tertiary uppercase tracking-wider flex items-center gap-1">
            <Facebook size={10} /> {isFr ? 'Page Facebook (onglet Avis)' : 'Facebook page (Reviews tab)'}
          </label>
          <input
            id={`${id}-facebook`}
            type="url"
            value={form.facebook_review_url}
            onChange={(e) => update('facebook_review_url', e.target.value)}
            className="glass-input w-full mt-1"
            placeholder="https://www.facebook.com/votre-page/reviews"
          />
          <p className="text-[12px] text-text-tertiary mt-1">
            {isFr
              ? 'L’adresse de votre page suivie de /reviews. Les avis doivent être activés sur la page.'
              : 'Your page address followed by /reviews. Reviews must be enabled on the page.'}
          </p>
        </div>

        <p className="text-[12px] text-text-secondary rounded-lg bg-surface-subtle border border-outline px-3 py-2">
          {google && facebook
            ? (isFr
              ? 'Deux liens configurés : le client choisit la plateforme (Google proposé en premier).'
              : 'Two links configured: the client picks the platform (Google offered first).')
            : (isFr
              ? 'Un seul lien configuré : le client y est redirigé automatiquement après votre message.'
              : 'One link configured: the client is redirected there automatically after your message.')}
        </p>
      </div>

      {/* ── Message d'invitation ── */}
      <div className="section-card p-6 space-y-4">
        <h3 className="text-[13px] font-semibold uppercase tracking-wider text-text-tertiary flex items-center gap-1.5">
          <MessageSquareText size={12} /> {isFr ? 'Message d’invitation (5 étoiles)' : 'Invite message (5 stars)'}
        </h3>
        <textarea
          value={form.review_invite_message}
          onChange={(e) => update('review_invite_message', e.target.value)}
          aria-label={isFr ? 'Message d’invitation (5 étoiles)' : 'Invite message (5 stars)'}
          rows={3}
          maxLength={400}
          placeholder={inviteDefault}
          className="glass-input w-full resize-none"
        />
        <div className="flex items-center justify-between text-[12px] text-text-tertiary">
          <span>{isFr ? 'Vide = texte par défaut ci-dessus.' : 'Empty = default text above.'}</span>
          <span>{form.review_invite_message.length}/400</span>
        </div>

        {/* Aperçu côté client */}
        <div className="rounded-2xl border border-outline bg-surface-subtle p-5 text-center space-y-3">
          <p className="text-[11px] uppercase tracking-wider text-text-tertiary">{isFr ? 'Aperçu client' : 'Client preview'}</p>
          <div className="flex justify-center gap-0.5">
            {[1, 2, 3, 4, 5].map((s) => <Star key={s} size={18} className="text-yellow-400 fill-yellow-400" />)}
          </div>
          <p className="text-sm text-text-primary">{invitePreview}</p>
          <div className="flex flex-wrap justify-center gap-2">
            {google && (
              <span className="inline-flex items-center gap-1.5 rounded-xl bg-neutral-900 text-white text-[12px] font-semibold px-4 py-2">
                <Globe size={13} /> {isFr ? 'Laisser un avis Google' : 'Leave a Google review'}
              </span>
            )}
            {facebook && (
              <span className="inline-flex items-center gap-1.5 rounded-xl bg-[#1877F2] text-white text-[12px] font-semibold px-4 py-2">
                <Facebook size={13} /> {isFr ? 'Laisser un avis Facebook' : 'Leave a Facebook review'}
              </span>
            )}
            {!hasDestination && (
              <span className="text-[12px] text-text-tertiary italic">{isFr ? '(aucun bouton : aucun lien configuré)' : '(no button: no link configured)'}</span>
            )}
          </div>
        </div>
      </div>

      {/* ── Messages du sondage (SMS + courriel) ── */}
      <div className="section-card p-6 space-y-5">
        <h3 className="text-[13px] font-semibold uppercase tracking-wider text-text-tertiary flex items-center gap-1.5">
          <Send size={12} /> {isFr ? 'Messages envoyés à la fin de la job' : 'Messages sent when the job is done'}
        </h3>
        {variablesHint}

        <div className="space-y-2">
          <label htmlFor={`${id}-sms`} className="text-xs font-medium text-text-tertiary uppercase tracking-wider flex items-center gap-1">
            <MessageSquare size={10} /> SMS
          </label>
          <textarea
            id={`${id}-sms`}
            value={form.review_sms_body}
            onChange={(e) => update('review_sms_body', e.target.value)}
            rows={3}
            maxLength={320}
            placeholder={DEFAULT_SMS_FR}
            className="glass-input w-full resize-none"
          />
          <div className="flex items-center justify-between text-[12px] text-text-tertiary">
            <span>{isFr ? 'Le lien [survey_url] est ajouté à la fin s’il manque.' : 'The [survey_url] link is appended if missing.'}</span>
            <span>{form.review_sms_body.length}/320</span>
          </div>
          <div className="rounded-2xl border border-outline bg-surface-subtle p-4">
            <p className="text-[11px] uppercase tracking-wider text-text-tertiary mb-2">{isFr ? 'Aperçu' : 'Preview'}</p>
            <div className="max-w-[320px] rounded-2xl rounded-bl-sm bg-[#e5e5ea] text-black px-3.5 py-2.5 text-[14px] leading-snug">{smsPreview}</div>
          </div>
        </div>

        <div className="space-y-2">
          <label htmlFor={`${id}-email-subject`} className="text-xs font-medium text-text-tertiary uppercase tracking-wider flex items-center gap-1">
            <Mail size={10} /> {isFr ? 'Courriel — objet' : 'Email — subject'}
          </label>
          <input
            id={`${id}-email-subject`}
            type="text"
            value={form.review_email_subject}
            onChange={(e) => update('review_email_subject', e.target.value)}
            maxLength={200}
            placeholder={DEFAULT_EMAIL_SUBJECT_FR}
            className="glass-input w-full"
          />
          <label htmlFor={`${id}-email-body`} className="text-xs font-medium text-text-tertiary uppercase tracking-wider flex items-center gap-1 pt-2">
            <Mail size={10} /> {isFr ? 'Courriel — corps' : 'Email — body'}
          </label>
          <textarea
            id={`${id}-email-body`}
            value={form.review_email_body}
            onChange={(e) => update('review_email_body', e.target.value)}
            rows={7}
            maxLength={2000}
            placeholder={DEFAULT_EMAIL_BODY_FR}
            className="glass-input w-full resize-y"
          />
          <div className="flex items-center justify-between text-[12px] text-text-tertiary">
            <span>{isFr ? 'Texte simple. Une ligne vide = nouveau paragraphe. [survey_url] devient le bouton « Noter mon expérience ».' : 'Plain text. A blank line = new paragraph. [survey_url] becomes the “Rate my experience” button.'}</span>
            <span>{form.review_email_body.length}/2000</span>
          </div>
          <div className="rounded-2xl border border-outline bg-surface-subtle p-4 space-y-3">
            <p className="text-[11px] uppercase tracking-wider text-text-tertiary">{isFr ? 'Aperçu' : 'Preview'}</p>
            <div className="rounded-xl border border-outline bg-surface-card overflow-hidden">
              <div className="px-4 py-2.5 border-b border-outline text-[13px]"><span className="text-text-tertiary">{isFr ? 'Objet :' : 'Subject:'}</span> <strong>{emailSubjectPreview}</strong></div>
              <div className="px-5 py-4 text-[14px] leading-relaxed text-text-primary space-y-3">
                {emailBodyPreview.split(/\n{2,}/).map((para, i) => (
                  para.trim() === SAMPLE_VARS.survey_url
                    ? (
                      <div key={i} className="flex justify-center py-1">
                        <span className="rounded-lg bg-neutral-900 text-white text-[13px] font-bold px-8 py-3">{isFr ? 'Noter mon expérience' : 'Rate my experience'}</span>
                      </div>
                    )
                    : <p key={i} className="whitespace-pre-line">{para}</p>
                ))}
                {!emailBodyPreview.includes(SAMPLE_VARS.survey_url) && (
                  <div className="flex justify-center py-1">
                    <span className="rounded-lg bg-neutral-900 text-white text-[13px] font-bold px-8 py-3">{isFr ? 'Noter mon expérience' : 'Rate my experience'}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Textes de la page du sondage ── */}
      <div className="section-card p-6 space-y-5">
        <h3 className="text-[13px] font-semibold uppercase tracking-wider text-text-tertiary flex items-center gap-1.5">
          <Star size={12} /> {isFr ? 'Textes de la page du sondage' : 'Survey page texts'}
        </h3>

        <div className="space-y-1">
          <label htmlFor={`${id}-question`} className="text-xs font-medium text-text-tertiary uppercase tracking-wider">
            {isFr ? 'Question au-dessus des étoiles' : 'Question above the stars'}
          </label>
          <input
            id={`${id}-question`}
            type="text"
            value={form.review_survey_question}
            onChange={(e) => update('review_survey_question', e.target.value)}
            maxLength={160}
            placeholder={questionDefault}
            className="glass-input w-full"
          />
          <p className="text-[12px] text-text-tertiary">{isFr ? 'Précédée de « Bonjour Prénom, » quand le prénom est connu.' : 'Preceded by “Hi First name,” when the first name is known.'}</p>
        </div>

        <div className="space-y-1">
          <label htmlFor={`${id}-low`} className="text-xs font-medium text-text-tertiary uppercase tracking-wider">
            {isFr ? 'Message note basse (4 étoiles ou moins)' : 'Low rating message (4 stars or less)'}
          </label>
          <textarea
            id={`${id}-low`}
            value={form.review_low_rating_message}
            onChange={(e) => update('review_low_rating_message', e.target.value)}
            rows={3}
            maxLength={400}
            placeholder={lowRatingDefault}
            className="glass-input w-full resize-none"
          />
          <p className="text-[12px] text-text-tertiary">{isFr ? 'Affiché au-dessus du formulaire de commentaires.' : 'Shown above the feedback form.'}</p>
        </div>

        <div className="space-y-1">
          <label htmlFor={`${id}-thanks`} className="text-xs font-medium text-text-tertiary uppercase tracking-wider">
            {isFr ? 'Remerciement après les commentaires' : 'Thank-you after feedback'}
          </label>
          <textarea
            id={`${id}-thanks`}
            value={form.review_thank_you_message}
            onChange={(e) => update('review_thank_you_message', e.target.value)}
            rows={2}
            maxLength={300}
            placeholder={thankYouDefault}
            className="glass-input w-full resize-none"
          />
        </div>

        <p className="text-[12px] text-text-tertiary">{isFr ? 'Vide = texte par défaut affiché en gris.' : 'Empty = the default text shown in grey.'}</p>
      </div>

      {/* ── Automatisations liées ── */}
      <div className="section-card p-6 space-y-3">
        <h3 className="text-[13px] font-semibold uppercase tracking-wider text-text-tertiary flex items-center gap-1.5">
          <Zap size={12} /> {isFr ? 'Automatisations liées' : 'Related automations'}
        </h3>
        {rules.length === 0 ? (
          <p className="text-[13px] text-text-tertiary">
            {isFr ? 'Aucune automatisation d’avis trouvée pour cette entreprise.' : 'No review automation found for this company.'}
          </p>
        ) : (
          <ul className="divide-y divide-outline">
            {rules.map((rule) => (
              <li key={rule.id} className="py-3 space-y-3">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-text-primary">
                    {rule.preset_key === 'google_review'
                      ? (isFr ? 'Sondage d’étoiles' : 'Star survey')
                      : (isFr ? 'Rappel d’avis' : 'Review reminder')}
                  </p>
                  <p className="text-[12px] text-text-tertiary">
                    {rule.preset_key === 'google_review'
                      ? (isFr ? 'Courriel + SMS, ' : 'Email + SMS, ')
                      : (isFr ? 'SMS avec le lien de votre page d’avis, ' : 'SMS with your review page link, ')}
                    {humanDelay(rule.delay_seconds, isFr)} {isFr ? 'la fin de la job' : 'job completion'}
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={rule.is_active}
                  disabled={togglingId === rule.id}
                  onClick={() => handleToggleRule(rule)}
                  className={cn(
                    'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50',
                    rule.is_active ? 'bg-primary' : 'bg-gray-300 dark:bg-gray-600',
                  )}
                >
                  <span className={cn(
                    'inline-block h-4 w-4 transform rounded-full bg-surface-card transition-transform',
                    rule.is_active ? 'translate-x-6' : 'translate-x-1',
                  )} />
                </button>
              </div>
              {rule.preset_key !== 'google_review' && rule.actions.some((a) => a.type === 'send_sms') && (
                editingRuleId === rule.id ? (
                  <div className="space-y-2">
                    <textarea
                      value={ruleDraft}
                      onChange={(e) => setRuleDraft(e.target.value)}
                      aria-label={isFr ? 'Texte du SMS de rappel' : 'Reminder SMS text'}
                      rows={3}
                      maxLength={320}
                      className="glass-input w-full resize-none"
                    />
                    <div className="flex items-center justify-between gap-2 text-[11px] text-text-tertiary">
                      <span>{isFr ? 'Variables : [client_first_name] [company_name] [review_page_url]' : 'Variables: [client_first_name] [company_name] [review_page_url]'}</span>
                      <div className="flex gap-2">
                        <button type="button" onClick={() => setEditingRuleId(null)} className="glass-button text-[12px]">{isFr ? 'Annuler' : 'Cancel'}</button>
                        <button type="button" onClick={() => handleSaveRuleSms(rule)} disabled={savingRule || !ruleDraft.trim()} className="glass-button text-[12px] !bg-primary !text-white !border-primary disabled:opacity-50">
                          {savingRule ? (isFr ? 'Enregistrement…' : 'Saving…') : (isFr ? 'Enregistrer le SMS' : 'Save SMS')}
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-3 rounded-xl border border-outline bg-surface-subtle px-3 py-2">
                    <p className="text-[13px] text-text-secondary whitespace-pre-line">{smsBodyOf(rule)}</p>
                    <button
                      type="button"
                      onClick={() => { setEditingRuleId(rule.id); setRuleDraft(smsBodyOf(rule)); }}
                      className="glass-button inline-flex items-center gap-1 text-[12px] shrink-0"
                    >
                      <Pencil size={11} /> {isFr ? 'Modifier' : 'Edit'}
                    </button>
                  </div>
                )
              )}
              </li>
            ))}
          </ul>
        )}
        <p className="text-[12px] text-text-tertiary">
          {isFr ? 'Délais et autres automatisations : ' : 'Delays and other automations: '}
          <Link to="/settings/messaging" className="text-primary hover:underline">
            {isFr ? 'Réglages → Messagerie SMS' : 'Settings → SMS Messaging'}
          </Link>
        </p>
      </div>

      {/* ── Save bar ── */}
      <div className={cn(
        'sticky bottom-4 z-30 flex items-center justify-between gap-3 rounded-xl border px-4 py-3 backdrop-blur',
        dirty
          ? 'border-amber-300 bg-amber-50/95 dark:border-amber-700 dark:bg-amber-900/40'
          : 'border-outline bg-surface-card/90',
      )}>
        <span className="text-[13px] text-text-secondary">
          {loadFailed
            ? (isFr ? 'Chargement échoué — sauvegarde bloquée pour protéger vos données' : 'Load failed — saving is blocked to protect your data')
            : dirty
              ? (isFr ? 'Modifications non sauvegardées' : 'Unsaved changes')
              : (isFr ? 'Tout est à jour' : 'All changes saved')}
        </span>
        {loadFailed && (
          <button onClick={() => { void load(); }} className="glass-button text-[12px]">
            {isFr ? 'Réessayer' : 'Retry'}
          </button>
        )}
        <button
          onClick={handleSave}
          disabled={saving || !dirty || loadFailed}
          className={cn(
            'glass-button inline-flex items-center gap-1.5',
            saved && '!bg-success !text-white !border-success',
            dirty && !saving && !saved && '!bg-primary !text-white !border-primary',
          )}
        >
          {saving ? <Loader2 size={13} className="animate-spin" /> : saved ? <Check size={13} /> : null}
          {saving ? (isFr ? 'Enregistrement…' : 'Saving…') : saved ? (isFr ? 'Enregistré' : 'Saved') : (isFr ? 'Enregistrer' : 'Save')}
        </button>
      </div>
    </div>
  );
}
