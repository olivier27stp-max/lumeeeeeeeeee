/* ═══════════════════════════════════════════════════════════════
   Page — Automations

   Shows ALL automation rules (from automation_rules table) in a
   single unified view, organized by functional category.
   Default presets are seeded via DB migration — the page only
   reads, never auto-seeds.

   Categories: Leads, Quotes, Jobs/Scheduling, Invoices,
   Payments, Follow-up, Reviews, Client
   ═══════════════════════════════════════════════════════════════ */

import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Zap, Clock, Mail, Bell, FileText, CalendarClock, MessageSquare,
  ToggleLeft, ToggleRight, Loader2, Send, UserPlus, AlertTriangle,
  Heart, Star, Sun, UserX, CreditCard, Banknote, Search,
  CheckCircle, Shield, Sparkles, ChevronDown, ChevronRight,
  Users, Briefcase, ReceiptText, ThumbsUp, ArrowLeft, FileSignature,
  Plus, Pencil, Copy, Trash2, X,} from 'lucide-react';
import { cn } from '../lib/utils';
import { useTranslation } from '../i18n';
import { toast } from 'sonner';
import PermissionGate from '../components/PermissionGate';
import MessageEditor from '../components/automations/MessageEditor';
import AutomationBuilder from '../components/automations/AutomationBuilder';
import {
  chargerAutomatisations,
  dupliquerAutomatisation,
  supprimerAutomatisation,
  type CatalogueAutomatisations,
} from '../lib/automationBuilderApi';
import { confirmer } from '../components/ui/ConfirmDialog';
import {
  type AutomationRule,
  getAutomationRules,
  toggleAutomationRule,
  getFailureCountsByRule,
  getRecentAutomationFailures,
  type AutomationFailure,
  getAutomationLanguage,
  setAutomationLanguage,
} from '../lib/automationRulesApi';

// ── Automation name translations (for DB-seeded English names) ──
// Couvre toutes les variantes de noms semées par les migrations
// (default_workflow_presets, advanced_automation_presets, dedup, activate_all).
const AUTOMATION_NAME_FR: Record<string, string> = {
  // Contrats — le seul preset dont le nom semé en anglais restait tel quel
  // dans l'interface française (2026-09-23).
  'Contract Signed': 'Contrat signé',
  // Leads
  'Lead — Welcome': 'Prospect — Bienvenue',
  'Welcome New Lead': 'Bienvenue au nouveau prospect',
  'Lead Alert — 7 Days Stale': 'Alerte prospect — 7 jours inactif',
  'Stale Lead Alert — 7 Days': 'Alerte prospect inactif — 7 jours',
  'Stale Lead — 7 Days': 'Prospect inactif — 7 jours',
  'Lead Final Follow-Up — 14 Days': 'Dernier suivi prospect — 14 jours',
  'Lead Follow-Up — 1 Day': 'Suivi prospect — 1 jour',
  'Lead Follow-Up — 3 Days': 'Suivi prospect — 3 jours',
  'Lost Lead Re-engagement — 90 Days': 'Réengagement prospect perdu — 90 jours',
  'Lost Lead Re-engagement': 'Réengagement prospect perdu',
  'Lost Lead — Re-engagement': 'Prospect perdu — Réengagement',
  // Quotes / Estimates
  'Estimate Follow-Up': "Suivi d'estimation",
  'Estimate Follow-Up (3 days)': "Suivi d'estimation (3 jours)",
  'Quote Follow-Up — 1 Day': 'Suivi de devis — 1 jour',
  'Quote Follow-Up — 1 Day After Sent': 'Suivi de devis — 1 jour après envoi',
  'Quote Follow-Up — 3 Days': 'Suivi de devis — 3 jours',
  'Quote Follow-Up — 7 Days': 'Suivi de devis — 7 jours',
  'Quote Follow-Up — 14 Days': 'Suivi de devis — 14 jours',
  'Quote Follow-Up — 21 Days': 'Suivi de devis — 21 jours',
  'Quote Follow-Up — 21 Days (Final)': 'Suivi de devis — 21 jours (final)',
  // Jobs / Scheduling
  'Appointment Confirmation': 'Confirmation de rendez-vous',
  'Job Reminder — 1 Week Before': 'Rappel de rendez-vous — 1 semaine avant',
  'Job Reminder — 7 Days Before': 'Rappel de rendez-vous — 7 jours avant',
  'Job Reminder — 1 Day Before': 'Rappel de rendez-vous — 1 jour avant',
  'Job Reminder — 2 Hours Before': 'Rappel de rendez-vous — 2 heures avant',
  'No-Show / Cancellation Follow-Up': "Suivi d'absence / annulation",
  'No-Show Follow-Up': "Suivi d'absence",
  // Invoices
  'Invoice Reminder — 1 Day': 'Rappel de facture — 1 jour',
  'Invoice Reminder — 1 Day After Sent': 'Rappel de facture — 1 jour après envoi',
  'Invoice Reminder — 3 Days': 'Rappel de facture — 3 jours',
  'Invoice Reminder — 3 Days After Sent': 'Rappel de facture — 3 jours après envoi',
  'Invoice Reminder — 7 Days': 'Rappel de facture — 7 jours',
  'Invoice Reminder — 7 Days After Sent': 'Rappel de facture — 7 jours après envoi',
  'Invoice Reminder — 14 Days': 'Rappel de facture — 14 jours',
  'Invoice Final Reminder — 30 Days': 'Dernier rappel de facture — 30 jours',
  'Invoice Final Reminder — 30 Days After Sent': 'Dernier rappel de facture — 30 jours après envoi',
  'Invoice Reminder (J+1)': 'Rappel de facture (J+1)',
  'Invoice Reminder (J+3)': 'Rappel de facture (J+3)',
  'Invoice Reminder (J+5)': 'Rappel de facture (J+5)',
  'Invoice Reminder (J+15)': 'Rappel de facture (J+15)',
  'Invoice Reminder (J+30)': 'Rappel de facture (J+30)',
  // Payments
  'Payment Confirmation': 'Confirmation de paiement',
  'Payment Confirmation — Thank You': 'Confirmation de paiement — Merci',
  'Deposit Received': 'Dépôt reçu',
  'Deposit Received Confirmation': 'Confirmation de dépôt reçu',
  'Deposit Reminder — Quote Approved': 'Rappel de dépôt — Devis accepté',
  'Deposit Follow-Up — 2 Days': 'Suivi de dépôt — 2 jours',
  // Follow-up
  'Thank You After Job': 'Merci après le job',
  'Thank You — After Job Completed': 'Merci — Job terminé',
  'Cross-Sell — 30 Days After Job': 'Vente croisée — 30 jours après le job',
  'Cross-Sell Follow-Up — 30 Days After Job': 'Suivi de vente croisée — 30 jours après le job',
  'Cross-Sell — 30 Days': 'Vente croisée — 30 jours',
  'Re-Engagement — 90 Days': 'Réengagement — 90 jours',
  'Post-Job Survey': 'Sondage après le job',
  'Post-Appointment Survey': 'Sondage après rendez-vous',
  'Post-Appointment Satisfaction Check': 'Vérification de satisfaction après rendez-vous',
  // Reviews
  'Google Review Request': "Demande d'avis Google",
  'Review Request — After Job': "Demande d'avis — Après le job",
  'Review Reminder — 7 Days': "Rappel d'avis — 7 jours",
  // Client
  'Client Anniversary': 'Anniversaire client',
  'Client Anniversary — 1 Year': 'Anniversaire client — 1 an',
  'Seasonal Reminder — 6 Months': 'Rappel saisonnier — 6 mois',
  'Seasonal Reminder — 6 Months After Job': 'Rappel saisonnier — 6 mois après le job',
};

function localizeAutomationName(name: string, lang: string): string {
  if (lang !== 'fr') return name;
  return AUTOMATION_NAME_FR[name] ?? name;
}

/**
 * La cause d'un échec, dite à quelqu'un qui n'est pas développeur.
 *
 * La page affichait « 2 échecs » et s'arrêtait là : l'entrepreneur voyait que
 * ça n'avait pas marché, sans jamais savoir POURQUOI ni quoi faire. Les
 * messages bruts (« SMTP not configured », « Frequency cap reached for
 * +1514… ») sont en anglais, techniques, et ne doivent jamais sortir tels
 * quels.
 *
 * Une cause non reconnue est rendue `null` : on préfère n'afficher que le
 * compteur plutôt qu'un jargon anglais qui n'aide personne.
 */
function raisonLisible(erreur: string | null, fr: boolean): string | null {
  const e = (erreur || '').toLowerCase();
  if (!e) return null;
  if (e.includes('no recipient phone')) return fr ? 'Ce client n’a pas de numéro de téléphone.' : 'This client has no phone number.';
  if (e.includes('no recipient email')) return fr ? 'Ce client n’a pas d’adresse courriel.' : 'This client has no email address.';
  if (e.includes('opted out') || e.includes('unsubscribed')) return fr ? 'Ce client s’est désabonné.' : 'This client unsubscribed.';
  if (e.includes('frequency cap')) return fr ? 'Plafond atteint : ce client a déjà reçu plusieurs messages aujourd’hui.' : 'Cap reached: this client already got several messages today.';
  if (e.includes('consentement') || e.includes('consent')) return fr ? 'Le consentement de ce client n’est pas enregistré.' : 'This client’s consent is not recorded.';
  if (e.includes('smtp') && e.includes('not configured')) return fr ? 'Courriel non configuré : impossible d’envoyer.' : 'Email not configured: cannot send.';
  if (e.includes('twilio') && e.includes('not configured')) return fr ? 'Envoi de textos non configuré : impossible d’envoyer.' : 'SMS sending not configured: cannot send.';
  if (e.includes('not configured')) return fr ? 'Envoi non configuré dans les réglages.' : 'Sending is not configured in settings.';
  if (e.includes('plan does not include')) return fr ? 'Votre forfait n’inclut pas cet envoi.' : 'Your plan does not include this send.';
  if (e.includes('are disabled')) return fr ? 'Cette fonctionnalité est désactivée dans les réglages.' : 'This feature is disabled in settings.';
  return null;
}

// ── Category definitions ────────────────────────────────────
// Order matters — this defines the display order of sections
const CATEGORY_ORDER = [
  'Leads',
  'Quotes',
  'Jobs',
  'Invoices',
  'Payments',
  'Follow-up',
  'Reviews',
  'Client',
] as const;

type CategoryKey = (typeof CATEGORY_ORDER)[number];

const CATEGORY_META: Record<CategoryKey, {
  icon: typeof Bell;
  labelEn: string;
  labelFr: string;
  descEn: string;
  descFr: string;
}> = {
  Leads: {
    icon: UserPlus,
    labelEn: 'Leads',
    labelFr: 'Leads',
    descEn: 'Lead capture, assignment, and nurturing',
    descFr: 'Capture, assignation et suivi des leads',
  },
  Quotes: {
    icon: FileText,
    labelEn: 'Quotes & Estimates',
    labelFr: 'Devis et soumissions',
    descEn: 'Follow-ups after sending quotes',
    descFr: 'Relances après envoi de devis',
  },
  Jobs: {
    icon: Briefcase,
    labelEn: 'Jobs & Scheduling',
    labelFr: 'Jobs et rendez-vous',
    descEn: 'Booking confirmations and reminders',
    descFr: 'Confirmations et rappels de rendez-vous',
  },
  Invoices: {
    icon: ReceiptText,
    labelEn: 'Invoices',
    labelFr: 'Factures',
    descEn: 'Invoice reminders and escalations',
    descFr: 'Rappels de factures et escalades',
  },
  Payments: {
    icon: CreditCard,
    labelEn: 'Payments',
    labelFr: 'Paiements',
    descEn: 'Payment confirmations and deposit tracking',
    descFr: 'Confirmations de paiement et suivi des dépôts',
  },
  'Follow-up': {
    icon: Heart,
    labelEn: 'Follow-up',
    labelFr: 'Suivi',
    descEn: 'Post-service follow-ups and cross-sell',
    descFr: 'Suivis après service et ventes croisées',
  },
  Reviews: {
    icon: Star,
    labelEn: 'Reviews',
    labelFr: 'Avis',
    descEn: 'Review requests and reputation management',
    descFr: 'Demandes d\'avis et gestion de la réputation',
  },
  Client: {
    icon: Users,
    labelEn: 'Client Engagement',
    labelFr: 'Engagement client',
    descEn: 'Anniversaries, seasonal outreach, and retention',
    descFr: 'Anniversaires, relances saisonnières et rétention',
  },
};

// ── Preset → Category mapping ───────────────────────────────
const PRESET_META: Record<string, {
  icon: typeof Bell;
  category: CategoryKey;
}> = {
  // Leads
  welcome_new_lead:         { icon: UserPlus,       category: 'Leads' },
  lead_followup_1d:         { icon: Mail,           category: 'Leads' },
  lead_followup_3d:         { icon: Mail,           category: 'Leads' },
  stale_lead_7d:            { icon: AlertTriangle,  category: 'Leads' },
  lead_followup_14d:        { icon: AlertTriangle,  category: 'Leads' },
  lost_lead_reengagement:   { icon: UserX,          category: 'Leads' },

  // Quotes
  quote_followup_1d:        { icon: Mail,           category: 'Quotes' },
  quote_followup_3d:        { icon: Mail,           category: 'Quotes' },
  quote_followup_7d:        { icon: Mail,           category: 'Quotes' },
  quote_followup_14d:       { icon: AlertTriangle,  category: 'Quotes' },
  quote_followup_21d:       { icon: AlertTriangle,  category: 'Quotes' },
  estimate_followup:        { icon: Mail,           category: 'Quotes' },

  // Jobs
  job_reminder_7d:          { icon: CalendarClock,  category: 'Jobs' },
  job_reminder_1d:          { icon: CalendarClock,  category: 'Jobs' },
  job_reminder_2h:          { icon: CalendarClock,  category: 'Jobs' },
  appointment_confirmation: { icon: CalendarClock,  category: 'Jobs' },
  agreement_signed:         { icon: FileSignature, category: 'Jobs' },
  no_show_followup:         { icon: UserX,          category: 'Jobs' },

  // Invoices
  invoice_sent_reminder_1d: { icon: FileText,       category: 'Invoices' },
  invoice_sent_reminder_3d: { icon: FileText,       category: 'Invoices' },
  invoice_sent_reminder_7d: { icon: FileText,       category: 'Invoices' },
  invoice_sent_reminder_14d:{ icon: AlertTriangle,  category: 'Invoices' },
  invoice_sent_reminder_30d:{ icon: AlertTriangle,  category: 'Invoices' },
  // Les `invoice_reminder_*` (sans `sent_`) ont été retirés : anciens noms de
  // presets qui n'existent plus, ni dans automationPresets.data.ts ni dans
  // aucune règle en base (vérifié prod et staging : 0 occurrence). Ils
  // laissaient croire à cinq relances de facture de plus qu'il n'y en a.

  // Payments
  payment_confirmation:     { icon: CreditCard,     category: 'Payments' },
  deposit_received:         { icon: Banknote,       category: 'Payments' },
  deposit_reminder:         { icon: Banknote,       category: 'Payments' },
  deposit_followup_2d:      { icon: Banknote,       category: 'Payments' },

  // Follow-up
  thank_you_after_job:      { icon: Heart,          category: 'Follow-up' },
  cross_sell_30d:           { icon: Send,           category: 'Follow-up' },
  reengagement_90d:         { icon: Send,           category: 'Follow-up' },
  post_appointment_survey:  { icon: Star,           category: 'Follow-up' },

  // Reviews
  google_review:            { icon: Star,           category: 'Reviews' },
  review_reminder_7d:       { icon: Star,           category: 'Reviews' },

  // Client
  client_anniversary:       { icon: Star,           category: 'Client' },
  seasonal_reminder_6m:     { icon: Sun,            category: 'Client' },
};

// All presets are ON by default
const DEFAULT_ACTIVE_PRESETS = new Set(Object.keys(PRESET_META));

const TRIGGER_DISPLAY: Record<string, { en: string; fr: string }> = {
  'appointment.created':   { en: 'Appointment created',   fr: 'Rendez-vous créé' },
  'appointment.updated':   { en: 'Appointment updated',   fr: 'Rendez-vous modifié' },
  'appointment.cancelled': { en: 'Appointment cancelled', fr: 'Rendez-vous annulé' },
  'estimate.sent':         { en: 'Quote sent',            fr: 'Devis envoyé' },
  'quote.sent':            { en: 'Quote sent',            fr: 'Devis envoyé' },
  'quote.approved':        { en: 'Quote approved',        fr: 'Devis accepté' },
  'quote.declined':        { en: 'Quote declined',        fr: 'Devis refusé' },
  'invoice.sent':          { en: 'Invoice sent',          fr: 'Facture envoyée' },
  'invoice.paid':          { en: 'Invoice paid',          fr: 'Facture payée' },
  'invoice.overdue':       { en: 'Invoice overdue',       fr: 'Facture en retard' },
  'job.completed':         { en: 'Job completed',         fr: 'Job terminé' },
  'job.scheduled':         { en: 'Job scheduled',         fr: 'Job planifié' },
  'lead.created':          { en: 'Lead created',          fr: 'Lead créé' },
  'lead.status_changed':   { en: 'Lead status changed',   fr: 'Statut du lead changé' },
  'payment.received':      { en: 'Payment received',      fr: 'Paiement reçu' },
  // Ajoutés le 2026-09-23 : 14 des 27 déclencheurs du bus n'avaient pas
  // d'entrée ici et s'affichaient en CLÉ TECHNIQUE dans la colonne
  // « Déclencheur » — une règle sur `invoice.created` montrait littéralement
  // « invoice.created » à l'entrepreneur. Le repli existait (`|| rule.trigger_event`)
  // mais il n'était jamais censé servir de traduction.
  'agreement.signed':      { en: 'Contract signed',       fr: 'Contrat signé' },
  'client.archived':       { en: 'Client archived',       fr: 'Client archivé' },
  'client.deleted':        { en: 'Client deleted',        fr: 'Client supprimé' },
  'estimate.accepted':     { en: 'Quote accepted',        fr: 'Devis accepté' },
  'estimate.rejected':     { en: 'Quote rejected',        fr: 'Devis refusé' },
  'invoice.created':       { en: 'Invoice created',       fr: 'Facture créée' },
  'job.created':           { en: 'Job created',           fr: 'Job créé' },
  'job.ready_for_invoicing': { en: 'Job ready to invoice', fr: 'Job prêt à facturer' },
  'lead.converted':        { en: 'Lead converted',        fr: 'Lead converti en client' },
  'lead.updated':          { en: 'Lead updated',          fr: 'Lead modifié' },
  'pipeline_deal.stage_changed': { en: 'Deal stage changed', fr: 'Étape du pipeline changée' },
  'quote.changes_requested': { en: 'Changes requested on quote', fr: 'Modifications demandées au devis' },
  'quote.converted':       { en: 'Quote converted',       fr: 'Devis converti' },
  'quote.created':         { en: 'Quote created',         fr: 'Devis créé' },
};

function formatDelay(seconds: number, lang: string): string {
  if (seconds === 0) return lang === 'fr' ? 'Immédiat' : 'Immediate';
  const abs = Math.abs(seconds);
  const before = seconds < 0;
  const dir = before ? (lang === 'fr' ? 'avant' : 'before') : (lang === 'fr' ? 'après' : 'after');
  if (abs < 3600) return `${Math.round(abs / 60)} min ${dir}`;
  if (abs < 86400) return `${Math.round(abs / 3600)}h ${dir}`;
  if (abs < 2592000) {
    const d = Math.round(abs / 86400);
    return `${d} ${lang === 'fr' ? (d > 1 ? 'jours' : 'jour') : (d > 1 ? 'days' : 'day')} ${dir}`;
  }
  const m = Math.round(abs / 2592000);
  return `${m} ${lang === 'fr' ? 'mois' : (m > 1 ? 'months' : 'month')} ${dir}`;
}

function getChannels(actions: AutomationRule['actions'], fr: boolean): string[] {
  const taskLabel = fr ? 'Tâche' : 'Task';
  const reviewLabel = fr ? 'Avis' : 'Review';
  const channels: string[] = [];
  for (const a of actions) {
    if (a.type === 'send_sms' && !channels.includes('SMS')) channels.push('SMS');
    if (a.type === 'send_email' && !channels.includes('Email')) channels.push('Email');
    if (a.type === 'create_notification' && !channels.includes('Notif')) channels.push('Notif');
    if (a.type === 'create_task' && !channels.includes(taskLabel)) channels.push(taskLabel);
    if (a.type === 'request_review' && !channels.includes(reviewLabel)) channels.push(reviewLabel);
  }
  return channels;
}

function getActionLabel(type: string, fr: boolean): string {
  const labels: Record<string, { en: string; fr: string }> = {
    send_sms: { en: 'Send SMS', fr: 'Envoyer un SMS' },
    send_email: { en: 'Send Email', fr: 'Envoyer un courriel' },
    create_notification: { en: 'Notification', fr: 'Notification' },
    create_task: { en: 'Create Task', fr: 'Créer une tâche' },
    request_review: { en: 'Request Review', fr: 'Demander un avis' },
    update_status: { en: 'Update Status', fr: 'Mettre à jour le statut' },
    add_tag: { en: 'Add Tag', fr: 'Ajouter une étiquette' },
    assign_user: { en: 'Assign User', fr: 'Assigner un utilisateur' },
  };
  const label = labels[type];
  if (label) return fr ? label.fr : label.en;
  return type.replace(/_/g, ' ');
}

// ═════════════════════════════════════════════════════════════

export default function Automations() {
  const { t, language } = useTranslation();
  const fr = language === 'fr';
  const navigate = useNavigate();

  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'inactive'>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  /** Échecs par règle sur 7 jours — alimente le badge d'alerte. */
  const [failureCounts, setFailureCounts] = useState<Record<string, number>>({});
  /** Les échecs récents, pour DIRE pourquoi — le compteur seul ne sert à rien. */
  const [failures, setFailures] = useState<AutomationFailure[]>([]);
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  // ── Construire ses propres automatisations ──
  // Le catalogue (déclencheurs et actions offerts) vient du serveur avec les
  // règles : l'interface n'en garde pas de copie, donc retirer un déclencheur
  // côté serveur le fait disparaître du formulaire sans redéploiement du front.
  const [catalogue, setCatalogue] = useState<CatalogueAutomatisations | null>(null);
  /** Règle en cours d'édition ; `null` = création ; `undefined` = panneau fermé. */
  const [enEdition, setEnEdition] = useState<AutomationRule | null | undefined>(undefined);
  const [occupeId, setOccupeId] = useState<string | null>(null);
  // Langue dans laquelle les messages d'automatisation partent aux clients.
  const [orgLang, setOrgLang] = useState<'fr' | 'en'>('fr');
  const [savingLang, setSavingLang] = useState(false);
  useEffect(() => { getAutomationLanguage().then(setOrgLang).catch(() => {}); }, []);
  const changerLangue = async (lang: 'fr' | 'en') => {
    if (lang === orgLang || savingLang) return;
    setSavingLang(true);
    const avant = orgLang;
    setOrgLang(lang); // optimiste
    try {
      await setAutomationLanguage(lang);
      toast.success(fr ? (lang === 'en' ? 'Messages en anglais' : 'Messages en français') : (lang === 'en' ? 'Messages set to English' : 'Messages set to French'));
    } catch {
      setOrgLang(avant); // rollback si échec
      toast.error(fr ? 'Impossible de changer la langue' : 'Could not change language');
    } finally {
      setSavingLang(false);
    }
  };

  // ── Load (read only — no auto-seed) ──
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getAutomationRules();
      // Client-side safety: deduplicate by preset_key (keep first per key)
      const seen = new Set<string>();
      const deduped = data.filter((r) => {
        if (!r.preset_key) return true;
        if (seen.has(r.preset_key)) return false;
        seen.add(r.preset_key);
        return true;
      });
      setRules(deduped);

      // Échecs des 7 derniers jours. Le moteur les journalisait déjà, mais
      // aucune page ne lisait la table : une automatisation cassée restait
      // affichée « active » avec un badge vert, et l'utilisateur n'apprenait
      // jamais que ses clients n'avaient rien reçu.
      // Non bloquant : la liste doit s'afficher même si ce chargement échoue.
      try {
        const recents = await getRecentAutomationFailures(200);
        setFailures(recents);
        setFailureCounts(await getFailureCountsByRule());
      } catch (e: any) {
        console.error('Failed to load automation failures:', e.message);
      }
    } catch (e: any) {
      console.error('Failed to load rules:', e.message);
      toast.error(language === 'fr' ? 'Impossible de charger les automatisations' : 'Failed to load automations');
    } finally {
      setLoading(false);
    }
  }, [language]);

  useEffect(() => { load(); }, [load]);

  // Le catalogue arrive avec la même requête que les règles, côté serveur.
  // Non bloquant : si l'appel échoue, la liste reste utilisable et seul le
  // bouton « Créer » disparaît — plutôt qu'une page blanche.
  useEffect(() => {
    let vivant = true;
    chargerAutomatisations()
      .then((d) => { if (vivant) setCatalogue(d.catalogue); })
      .catch((e: unknown) => {
        console.error('[Automations] catalogue indisponible',
          e instanceof Error ? e.message : String(e));
      });
    return () => { vivant = false; };
  }, []);

  // ── Dupliquer ──
  // Le seul chemin pour s'approprier une automatisation fournie : la copie
  // perd son `preset_key`, donc le seeder ne la réécrira plus et TOUT y est
  // modifiable, déclencheur compris.
  const dupliquer = async (regle: AutomationRule) => {
    setOccupeId(regle.id);
    try {
      await dupliquerAutomatisation(regle.id);
      toast.success(fr ? 'Copie créée — elle est en pause' : 'Copy created — it is paused');
      await load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setOccupeId(null);
    }
  };

  // ── Supprimer ──
  const supprimer = async (regle: AutomationRule) => {
    const ok = await confirmer({
      title: fr ? 'Supprimer cette automatisation ?' : 'Delete this automation?',
      message: fr
        ? `« ${regle.name} » sera supprimée, et les envois déjà prévus seront annulés. C'est définitif.`
        : `“${regle.name}” will be deleted, and any messages already queued will be cancelled. This cannot be undone.`,
      confirmLabel: fr ? 'Supprimer' : 'Delete',
      danger: true,
    });
    if (!ok) return;
    setOccupeId(regle.id);
    try {
      await supprimerAutomatisation(regle.id);
      toast.success(fr ? 'Automatisation supprimée' : 'Automation deleted');
      await load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setOccupeId(null);
    }
  };

  // ── Toggle ──
  const handleToggle = async (rule: AutomationRule) => {
    const newActive = !rule.is_active;
    setTogglingId(rule.id);
    setRules((prev) => prev.map((r) => r.id === rule.id ? { ...r, is_active: newActive } : r));
    try {
      await toggleAutomationRule(rule.id, newActive);
      toast.success(newActive
        ? (t.automations.workflowEnabled)
        : (t.automations.workflowDisabled));
    } catch {
      toast.error(t.automations.failedToUpdate);
      setRules((prev) => prev.map((r) => r.id === rule.id ? { ...r, is_active: rule.is_active } : r));
    } finally {
      setTogglingId(null);
    }
  };

  // ── Category resolution ──
  const getCategory = (r: AutomationRule): CategoryKey => {
    const meta = PRESET_META[r.preset_key || ''];
    return meta?.category || 'Follow-up';
  };

  // ── Filter ──
  const filtered = rules.filter((r) => {
    if (search) {
      const q = search.toLowerCase();
      if (!r.name.toLowerCase().includes(q) && !(r.description || '').toLowerCase().includes(q)) return false;
    }
    if (filterStatus === 'active' && !r.is_active) return false;
    if (filterStatus === 'inactive' && r.is_active) return false;
    if (filterCategory !== 'all' && getCategory(r) !== filterCategory) return false;
    return true;
  });

  // ── Group by category, sorted alphabetically within each ──
  const grouped: Record<string, AutomationRule[]> = {};
  for (const r of filtered) {
    const cat = getCategory(r);
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(r);
  }
  // Sort rules alphabetically within each category
  for (const cat of Object.keys(grouped)) {
    grouped[cat].sort((a, b) => a.name.localeCompare(b.name));
  }

  // ── Counts ──
  const totalCount = rules.length;
  const activeCount = rules.filter((r) => r.is_active).length;
  const inactiveCount = totalCount - activeCount;

  const toggleCategory = (cat: string) => {
    setCollapsedCategories(prev => {
      const next = new Set(prev);
      next.has(cat) ? next.delete(cat) : next.add(cat);
      return next;
    });
  };

  return (
    <PermissionGate permission="automations.update">
    <div className="space-y-6 max-w-[1100px] mx-auto">

      {/* ── Construire son automatisation ──
          Panneau plein écran plutôt qu'une boîte étroite : il y a trois blocs
          à lire et des textes à écrire, et sur un téléphone une modale de la
          taille d'une carte rendrait la saisie pénible. */}
      {enEdition !== undefined && catalogue && (
        <div
          className="fixed inset-0 z-50 overflow-y-auto bg-black/40 backdrop-blur-sm p-4 sm:p-8"
          role="dialog"
          aria-modal="true"
          aria-label={enEdition ? (fr ? 'Modifier l’automatisation' : 'Edit automation') : (fr ? 'Créer une automatisation' : 'Create an automation')}
        >
          <div className="mx-auto w-full max-w-[680px] rounded-2xl border border-border bg-surface-primary p-5 shadow-xl">
            <div className="mb-4 flex items-start justify-between gap-4">
              <h2 className="text-lg font-semibold text-text-primary">
                {enEdition
                  ? (fr ? 'Modifier l’automatisation' : 'Edit automation')
                  : (fr ? 'Créer une automatisation' : 'Create an automation')}
              </h2>
              <button
                type="button"
                onClick={() => setEnEdition(undefined)}
                aria-label={fr ? 'Fermer' : 'Close'}
                className="rounded-lg p-1.5 text-text-secondary hover:bg-surface-tertiary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            <AutomationBuilder
              regle={enEdition}
              catalogue={catalogue}
              fr={fr}
              onFerme={() => setEnEdition(undefined)}
              onEnregistre={load}
            />
          </div>
        </div>
      )}

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-text-primary">
            {fr ? 'Automatisations' : 'Automations'}
          </h1>
          <p className="text-[13px] text-text-tertiary mt-0.5">
            {fr
              ? 'Automatisations événementielles pour votre entreprise'
              : 'Event-driven automations for your business'}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {/* Langue dans laquelle les messages partent aux clients */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-text-tertiary">{fr ? 'Messages en' : 'Messages in'}</span>
            <div className="inline-flex rounded-lg border border-outline/50 overflow-hidden text-[12px]">
              {(['fr', 'en'] as const).map((l) => (
                <button
                  key={l}
                  onClick={() => changerLangue(l)}
                  disabled={savingLang}
                  className={`px-2.5 py-1 font-medium transition-colors ${orgLang === l ? 'bg-text-primary text-surface-primary' : 'text-text-secondary hover:bg-surface-tertiary'}`}
                >
                  {l === 'fr' ? 'FR' : 'EN'}
                </button>
              ))}
            </div>
          </div>
          {/* Créer la sienne. Absent tant que le catalogue n'a pas répondu :
              ouvrir un formulaire sans liste de déclencheurs ne mène à rien. */}
          {catalogue && (
            <button
              onClick={() => setEnEdition(null)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-text-primary px-3 py-1.5 text-[12px] font-medium text-surface-primary hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <Plus size={14} aria-hidden="true" />
              {fr ? 'Créer' : 'Create'}
            </button>
          )}
          <button
            onClick={() => navigate('/settings')}
            className="glass-button-ghost inline-flex items-center gap-1.5 text-[12px]"
          >
            <ArrowLeft size={14} />
            {fr ? 'Retour' : 'Back'}
          </button>
        </div>
      </div>

      {/* ── Stats row ── */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Total', value: totalCount },
          { label: fr ? 'Actives' : 'Active', value: activeCount },
          { label: fr ? 'Inactives' : 'Inactive', value: inactiveCount },
        ].map((s) => (
          <div key={s.label} className="section-card px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">{s.label}</p>
            <p className="text-lg font-bold text-text-primary tabular-nums mt-0.5">{s.value}</p>
          </div>
        ))}
      </div>

      {/* ── Filters ── */}
      <div className="flex items-center gap-2.5 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-[300px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
          <input
            type="text"
            placeholder={t.automations.search}
            aria-label={t.common.search}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="glass-input w-full pl-9 text-[13px]"
          />
        </div>
        <select
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
          aria-label={t.automations.category}
          className="glass-input text-[13px] py-2"
        >
          <option value="all">{t.automations.allCategories}</option>
          {CATEGORY_ORDER.map((c) => (
            <option key={c} value={c}>
              {fr ? CATEGORY_META[c].labelFr : CATEGORY_META[c].labelEn}
            </option>
          ))}
        </select>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value as any)}
          aria-label={t.automations.status}
          className="glass-input text-[13px] py-2"
        >
          <option value="all">{fr ? 'Toutes' : 'All'}</option>
          <option value="active">{fr ? 'Actives' : 'Active'}</option>
          <option value="inactive">{fr ? 'Inactives' : 'Inactive'}</option>
        </select>
        <span className="text-[11px] text-text-tertiary ml-auto">
          {filtered.length} {t.automations.results}
        </span>
      </div>

      {/* ── Content ── */}
      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 size={20} className="animate-spin text-text-tertiary" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="section-card p-10 text-center">
          <Zap size={28} className="mx-auto text-text-tertiary/30 mb-3" />
          <p className="text-[13px] text-text-tertiary">
            {search
              ? (t.automations.noResults)
              : (t.automations.noWorkflows)}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {CATEGORY_ORDER.filter(cat => grouped[cat]?.length).map((cat) => {
            const catMeta = CATEGORY_META[cat];
            const CatIcon = catMeta.icon;
            const catRules = grouped[cat];
            const isCollapsed = collapsedCategories.has(cat);
            const catActiveCount = catRules.filter(r => r.is_active).length;

            return (
              <div key={cat} className="section-card overflow-hidden">
                {/* Category header */}
                <button
                  onClick={() => toggleCategory(cat)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-secondary/30 transition-colors"
                >
                  <div className="w-8 h-8 rounded-lg bg-surface-tertiary flex items-center justify-center shrink-0">
                    <CatIcon size={15} className="text-text-secondary" />
                  </div>
                  <div className="text-left min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[14px] font-semibold text-text-primary">
                        {fr ? catMeta.labelFr : catMeta.labelEn}
                      </span>
                      <span className="text-[11px] text-text-tertiary">
                        {catActiveCount}/{catRules.length} {fr ? 'actives' : 'active'}
                      </span>
                    </div>
                    <p className="text-[11px] text-text-tertiary mt-0.5 truncate">
                      {fr ? catMeta.descFr : catMeta.descEn}
                    </p>
                  </div>
                  {isCollapsed ? (
                    <ChevronRight size={16} className="text-text-tertiary shrink-0" />
                  ) : (
                    <ChevronDown size={16} className="text-text-tertiary shrink-0" />
                  )}
                </button>

                {/* Rules table */}
                {!isCollapsed && (
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr className="border-t border-b border-outline bg-surface-secondary/40">
                        {[
                          { label: fr ? 'Automatisation' : 'Automation', cls: 'text-left' },
                          { label: t.automations.trigger, cls: 'text-left hidden md:table-cell' },
                          { label: t.automations.timing, cls: 'text-left hidden lg:table-cell' },
                          { label: t.automations.channels, cls: 'text-left hidden lg:table-cell' },
                          { label: t.automations.status, cls: 'text-center w-[80px]' },
                          { label: '', cls: 'text-right w-[60px]' },
                        ].map((col) => (
                          <th key={col.label || 'action'} className={cn('px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-text-tertiary', col.cls)}>
                            {col.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {catRules.map((rule) => {
                        const meta = PRESET_META[rule.preset_key || ''];
                        const Icon = meta?.icon || Zap;
                        const trigger = TRIGGER_DISPLAY[rule.trigger_event];
                        const isDefault = rule.is_preset && DEFAULT_ACTIVE_PRESETS.has(rule.preset_key || '');
                        const channels = getChannels(rule.actions, fr);
                        const isExpanded = expandedId === rule.id;

                        return (
                          <React.Fragment key={rule.id}>
                            <tr
                              className={cn(
                                'border-b border-outline/40 transition-colors cursor-pointer',
                                !rule.is_active && 'opacity-50',
                                isExpanded ? 'bg-surface-secondary/50' : 'hover:bg-surface-secondary/30',
                              )}
                              role="button"
                              tabIndex={0}
                              aria-expanded={isExpanded}
                              onClick={() => setExpandedId(isExpanded ? null : rule.id)}
                              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpandedId(isExpanded ? null : rule.id); } }}
                            >
                              {/* Name */}
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-2.5">
                                  <div className="w-7 h-7 rounded-md bg-surface-tertiary flex items-center justify-center shrink-0">
                                    <Icon size={13} className="text-text-secondary" />
                                  </div>
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-1.5">
                                      <span className="font-semibold text-text-primary truncate">{localizeAutomationName(rule.name, language)}</span>
                                      {isDefault && (
                                        <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-surface-tertiary text-text-secondary shrink-0">
                                          {t.automations.default}
                                        </span>
                                      )}
                                      {rule.is_preset && !isDefault && (
                                        <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-surface-tertiary text-text-tertiary shrink-0">
                                          {t.automations.optional}
                                        </span>
                                      )}
                                      {/* Échecs récents : sans ce badge, une automatisation
                                          cassée restait « active » en vert et l'utilisateur
                                          ignorait que ses clients n'avaient rien reçu. */}
                                      {(failureCounts[rule.id] || 0) > 0 && (
                                        <span
                                          title={fr
                                            ? `${failureCounts[rule.id]} échec(s) dans les 7 derniers jours`
                                            : `${failureCounts[rule.id]} failure(s) in the last 7 days`}
                                          className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300 shrink-0"
                                        >
                                          {fr ? `${failureCounts[rule.id]} échec` : `${failureCounts[rule.id]} failed`}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </td>

                              {/* Trigger */}
                              <td className="px-4 py-3 text-[12px] text-text-secondary hidden md:table-cell">
                                {trigger ? (fr ? trigger.fr : trigger.en) : rule.trigger_event}
                              </td>

                              {/* Timing */}
                              <td className="px-4 py-3 hidden lg:table-cell">
                                <span className="text-[12px] text-text-tertiary flex items-center gap-1">
                                  <Clock size={10} />
                                  {formatDelay(rule.delay_seconds, language)}
                                </span>
                              </td>

                              {/* Channels */}
                              <td className="px-4 py-3 hidden lg:table-cell">
                                <div className="flex gap-1">
                                  {channels.map((ch) => (
                                    <span key={ch} className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-surface-tertiary text-text-secondary">
                                      {ch}
                                    </span>
                                  ))}
                                </div>
                              </td>

                              {/* Status */}
                              <td className="px-4 py-3 text-center">
                                <span className={cn(
                                  'inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full',
                                  rule.is_active
                                    ? 'bg-primary/8 text-text-primary'
                                    : 'bg-surface-tertiary text-text-tertiary',
                                )}>
                                  {rule.is_active ? 'Active' : (t.automations.off)}
                                </span>
                              </td>

                              {/* Modifier · dupliquer · supprimer, puis la bascule.
                                  Une automatisation fournie se modifie et se
                                  désactive, mais ne se supprime pas : le seeder
                                  la recréerait au prochain démarrage et on
                                  croirait à un bogue. */}
                              <td className="px-4 py-3 text-right" role="presentation" tabIndex={-1} onClick={(e) => e.stopPropagation()}>
                                <div className="inline-flex items-center gap-0.5">
                                  {catalogue && (
                                    <>
                                      <button
                                        onClick={() => setEnEdition(rule)}
                                        aria-label={fr ? `Modifier ${rule.name}` : `Edit ${rule.name}`}
                                        className="p-1.5 rounded-md text-text-tertiary hover:text-text-primary hover:bg-surface-tertiary transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                                      >
                                        <Pencil size={15} aria-hidden="true" />
                                      </button>
                                      <button
                                        onClick={() => dupliquer(rule)}
                                        disabled={occupeId === rule.id}
                                        aria-label={fr ? `Dupliquer ${rule.name}` : `Duplicate ${rule.name}`}
                                        className="p-1.5 rounded-md text-text-tertiary hover:text-text-primary hover:bg-surface-tertiary transition-colors disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                                      >
                                        {occupeId === rule.id
                                          ? <Loader2 size={15} className="animate-spin" aria-hidden="true" />
                                          : <Copy size={15} aria-hidden="true" />}
                                      </button>
                                      {!rule.is_preset && (
                                        <button
                                          onClick={() => supprimer(rule)}
                                          disabled={occupeId === rule.id}
                                          aria-label={fr ? `Supprimer ${rule.name}` : `Delete ${rule.name}`}
                                          className="p-1.5 rounded-md text-text-tertiary hover:text-red-500 hover:bg-surface-tertiary transition-colors disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                                        >
                                          <Trash2 size={15} aria-hidden="true" />
                                        </button>
                                      )}
                                    </>
                                  )}
                                <button
                                  onClick={() => handleToggle(rule)}
                                  disabled={togglingId === rule.id}
                                  aria-label={rule.is_active ? (fr ? 'Désactiver' : 'Deactivate') : (fr ? 'Activer' : 'Activate')}
                                  aria-pressed={rule.is_active}
                                  className="p-1 rounded-md hover:bg-surface-tertiary transition-colors inline-flex"
                                >
                                  {togglingId === rule.id ? (
                                    <Loader2 size={18} className="animate-spin text-text-tertiary" />
                                  ) : rule.is_active ? (
                                    <ToggleRight size={20} className="text-text-primary" />
                                  ) : (
                                    <ToggleLeft size={20} className="text-text-tertiary" />
                                  )}
                                </button>
                                </div>
                              </td>
                            </tr>

                            {/* Expanded detail row */}
                            {isExpanded && (
                              <tr className="bg-surface-secondary/30">
                                <td colSpan={6} className="px-6 py-4">
                                  {/* POURQUOI ça n'a pas marché. Le badge rouge disait
                                      « 2 échecs » et s'arrêtait là : l'entrepreneur voyait
                                      que ses clients n'avaient rien reçu sans jamais savoir
                                      quoi corriger. Les causes techniques anglaises ne
                                      sortent jamais telles quelles — une cause non traduite
                                      n'est simplement pas affichée. */}
                                  {(() => {
                                    const raisons = [...new Set(
                                      failures
                                        .filter((f) => f.automation_rule_id === rule.id)
                                        .map((f) => raisonLisible(f.result_error, fr))
                                        .filter((r): r is string => !!r),
                                    )];
                                    if (!raisons.length) return null;
                                    return (
                                      <div className="mb-4 rounded-md border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-900/20 px-3 py-2">
                                        <p className="text-[10px] font-semibold uppercase tracking-wider text-red-700 dark:text-red-300 mb-1">
                                          {fr ? 'Pourquoi ça n’a pas marché' : 'Why it did not work'}
                                        </p>
                                        <ul className="space-y-0.5">
                                          {raisons.map((r) => (
                                            <li key={r} className="text-[12px] text-red-800 dark:text-red-200 leading-relaxed">{r}</li>
                                          ))}
                                        </ul>
                                      </div>
                                    );
                                  })()}
                                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-[12px]">
                                    <div>
                                      <p className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary mb-1">
                                        {t.automations.description}
                                      </p>
                                      <p className="text-text-secondary leading-relaxed">
                                        {rule.description || (t.automations.noDescription)}
                                      </p>
                                    </div>
                                    <div>
                                      <p className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary mb-1">
                                        {t.automations.actions}
                                      </p>
                                      <div className="space-y-1">
                                        {rule.actions.map((a, i) => (
                                          <div key={i} className="flex items-center gap-1.5 text-text-secondary">
                                            <span className="w-1 h-1 rounded-full bg-text-tertiary shrink-0" />
                                            <span>{getActionLabel(a.type, fr)}</span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                    <div>
                                      <p className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary mb-1">
                                        {t.automations.details}
                                      </p>
                                      <div className="space-y-1 text-text-secondary">
                                        <div className="flex items-center gap-1.5">
                                          <Clock size={10} className="text-text-tertiary" />
                                          {formatDelay(rule.delay_seconds, language)}
                                        </div>
                                        {rule.preset_key && (
                                          <div className="flex items-center gap-1.5">
                                            <span className="text-text-tertiary text-[10px]">key:</span>
                                            <code className="text-[10px] bg-surface-tertiary px-1 py-0.5 rounded">{rule.preset_key}</code>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  </div>

                                  {/* Le texte réellement envoyé au client, éditable.
                                      La page n'affichait que le TYPE d'action
                                      (« Envoyer un courriel ») : l'utilisateur ne
                                      pouvait ni relire ni corriger ce qui partait en
                                      son nom. */}
                                  {rule.actions
                                    .filter((a) => a.type === 'send_sms' || a.type === 'send_email')
                                    .map((a, i) => (
                                      <MessageEditor
                                        ruleName={localizeAutomationName(rule.name, language)}
                                        key={`${rule.id}-${a.type}-${i}`}
                                        ruleId={rule.id}
                                        actionType={a.type as 'send_sms' | 'send_email'}
                                        body={String(a.config?.body ?? '')}
                                        subject={a.type === 'send_email' ? String(a.config?.subject ?? '') : undefined}
                                        fr={fr}
                                        onSaved={load}
                                      />
                                    ))}
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
    </PermissionGate>
  );
}
