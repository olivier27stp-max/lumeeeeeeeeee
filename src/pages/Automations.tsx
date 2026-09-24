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
  Plus, Pencil, Copy, Trash2, X, EllipsisVertical,} from 'lucide-react';
import { cn } from '../lib/utils';
import { useTranslation } from '../i18n';
import { toast } from 'sonner';
import PermissionGate from '../components/PermissionGate';
import MessageEditor from '../components/automations/MessageEditor';
import {
  chargerAutomatisations,
  creerAutomatisation,
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

/**
 * LA LISTE DES AUTOMATISATIONS — modèle GoHighLevel.
 *
 * Deux onglets : **Mes automatisations** (ce que l'entreprise a construit ou
 * adopté) et **Modèles** (les 35 fournies avec Lume). C'est la distinction
 * qui manquait : un tableau où tout est mélangé est un catalogue ; deux
 * onglets où l'on voit « les miennes » d'un côté et « à piocher » de l'autre,
 * c'est un espace de travail.
 *
 * Le tableau parle d'USAGE, pas de configuration : statut, combien de fois
 * déclenchée, combien en cours, dernière modification. C'est ce qu'on veut
 * savoir d'une automatisation qui tourne.
 */
export default function Automations() {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const navigate = useNavigate();

  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [onglet, setOnglet] = useState<'miennes' | 'modeles'>('miennes');
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [failureCounts, setFailureCounts] = useState<Record<string, number>>({});
  const [catalogue, setCatalogue] = useState<CatalogueAutomatisations | null>(null);
  const [occupeId, setOccupeId] = useState<string | null>(null);
  /** Menu « Créer » ouvert ? Cinq départs possibles, comme chez GHL. */
  const [menuCreer, setMenuCreer] = useState(false);
  /** Menu « … » ouvert sur quelle ligne ? */
  const [menuLigne, setMenuLigne] = useState<string | null>(null);
  /** Ligne dépliée : on y modifie le texte des messages sans quitter la liste. */
  const [deplieId, setDeplieId] = useState<string | null>(null);
  const [orgLang, setOrgLang] = useState<'fr' | 'en'>('fr');
  const [savingLang, setSavingLang] = useState(false);

  useEffect(() => { getAutomationLanguage().then(setOrgLang).catch(() => {}); }, []);

  const changerLangue = async (lang: 'fr' | 'en') => {
    if (lang === orgLang || savingLang) return;
    setSavingLang(true);
    const avant = orgLang;
    setOrgLang(lang);
    try {
      await setAutomationLanguage(lang);
      toast.success(fr
        ? (lang === 'en' ? 'Messages en anglais' : 'Messages en français')
        : (lang === 'en' ? 'Messages set to English' : 'Messages set to French'));
    } catch {
      setOrgLang(avant);
      toast.error(fr ? 'Impossible de changer la langue' : 'Could not change language');
    } finally {
      setSavingLang(false);
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getAutomationRules();
      const vues = new Set<string>();
      setRules(data.filter((r) => {
        if (!r.preset_key) return true;
        if (vues.has(r.preset_key)) return false;
        vues.add(r.preset_key);
        return true;
      }));
      // Les échecs 7 jours : non bloquant, la liste doit s'afficher même si
      // cette lecture échoue.
      try {
        setFailureCounts(await getFailureCountsByRule());
      } catch (e: any) {
        console.error('Failed to load automation failures:', e.message);
      }
    } catch (e: any) {
      console.error('Failed to load rules:', e.message);
      toast.error(fr ? 'Impossible de charger les automatisations' : 'Failed to load automations');
    } finally {
      setLoading(false);
    }
  }, [fr]);

  useEffect(() => { load(); }, [load]);

  // Le catalogue voyage avec les règles depuis le serveur.
  useEffect(() => {
    let vivant = true;
    chargerAutomatisations()
      .then((d) => { if (vivant) setCatalogue(d.catalogue); })
      .catch((e: unknown) => {
        console.error('[Automations] catalogue indisponible', e instanceof Error ? e.message : String(e));
      });
    return () => { vivant = false; };
  }, []);

  // Fermer les menus au clic ailleurs — sinon ils restent ouverts et masquent
  // la ligne suivante.
  useEffect(() => {
    if (!menuCreer && !menuLigne) return;
    const fermer = () => { setMenuCreer(false); setMenuLigne(null); };
    document.addEventListener('click', fermer);
    return () => document.removeEventListener('click', fermer);
  }, [menuCreer, menuLigne]);

  const handleToggle = async (rule: AutomationRule) => {
    const newActive = !rule.is_active;
    setTogglingId(rule.id);
    setRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, is_active: newActive } : r)));
    try {
      await toggleAutomationRule(rule.id, newActive);
      toast.success(newActive
        ? (fr ? 'Automatisation publiée' : 'Automation published')
        : (fr ? 'Repassée en brouillon' : 'Back to draft'));
    } catch {
      toast.error(fr ? 'Impossible de mettre à jour' : 'Could not update');
      setRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, is_active: rule.is_active } : r)));
    } finally {
      setTogglingId(null);
    }
  };

  /** Crée une automatisation vide et ouvre le builder dessus. */
  const partirDeZero = async (avecLumi: boolean) => {
    try {
      const creee = await creerAutomatisation({
        name: fr ? 'Nouvelle automatisation' : 'New automation',
        trigger_event: 'quote.sent',
        delay_seconds: 0,
        actions: [{ type: 'send_sms', config: { body: fr ? 'À compléter' : 'To complete' } }],
        steps: [],
      });
      navigate(`/automations/${creee.id}${avecLumi ? '?lumi=1' : ''}`);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const dupliquer = async (regle: AutomationRule, ouvrir = false) => {
    setOccupeId(regle.id);
    try {
      const copie = await dupliquerAutomatisation(regle.id);
      toast.success(fr ? 'Copie créée — elle est en brouillon' : 'Copy created — it is a draft');
      if (ouvrir) { navigate(`/automations/${copie.id}`); return; }
      await load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setOccupeId(null);
    }
  };

  const supprimer = async (regle: AutomationRule) => {
    const ok = await confirmer({
      title: fr ? 'Supprimer cette automatisation ?' : 'Delete this automation?',
      message: fr
        ? `« ${regle.name} » sera supprimée, et les envois déjà prévus seront annulés. C'est définitif.`
        : `“${regle.name}” will be deleted, and any queued messages cancelled. This cannot be undone.`,
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

  const getCategory = (r: AutomationRule): CategoryKey =>
    (PRESET_META[r.preset_key || '']?.category as CategoryKey) || 'Follow-up';

  // « Les miennes » = ce que l'entreprise a construit, ou un préréglage
  // qu'elle a activé. « Modèles » = le reste, à piocher.
  const miennes = rules.filter((r) => !r.is_preset || r.is_active);
  const modeles = rules.filter((r) => r.is_preset && !r.is_active);
  const visibles = (onglet === 'miennes' ? miennes : modeles).filter((r) => {
    if (search) {
      const q = search.toLowerCase();
      const nom = localizeAutomationName(r.name, language).toLowerCase();
      if (!nom.includes(q) && !(r.description || '').toLowerCase().includes(q)) return false;
    }
    if (filterCategory !== 'all' && getCategory(r) !== filterCategory) return false;
    return true;
  });

  const publiees = rules.filter((r) => r.is_active).length;

  const DEPARTS: Array<{ cle: string; fr: string; en: string; aideFr: string; aideEn: string; icone: typeof Zap }> = [
    { cle: 'zero', fr: 'Partir de zéro', en: 'Start from scratch', icone: Plus,
      aideFr: 'Un parcours vide, à construire.', aideEn: 'An empty path, to build.' },
    { cle: 'lumi', fr: 'Construire avec Lumi', en: 'Build with Lumi', icone: Sparkles,
      aideFr: 'Décris ce que tu veux, Lumi le monte.', aideEn: 'Describe it, Lumi builds it.' },
    { cle: 'modele', fr: 'Partir d’un modèle', en: 'Start from a template', icone: FileText,
      aideFr: `${modeles.length} modèles prêts à l’emploi.`, aideEn: `${modeles.length} ready-made templates.` },
    { cle: 'entreprise', fr: 'Automatisation d’entreprise', en: 'Company automation', icone: Briefcase,
      aideFr: 'Déclenchée par l’entreprise, pas par un client.', aideEn: 'Triggered by the company, not a client.' },
  ];

  const choisirDepart = (cle: string) => {
    setMenuCreer(false);
    if (cle === 'zero') { partirDeZero(false); return; }
    if (cle === 'lumi') { partirDeZero(true); return; }
    if (cle === 'modele') { setOnglet('modeles'); return; }
    toast.info(fr
      ? 'Les automatisations d’entreprise arrivent bientôt.'
      : 'Company automations are coming soon.');
  };

  return (
    <PermissionGate permission="automations.update">
      <div className="mx-auto max-w-[1200px] space-y-5">

        {/* ── En-tête ── */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-text-primary">
              {fr ? 'Automatisations' : 'Automations'}
            </h1>
            <p className="mt-0.5 text-[13px] text-text-tertiary">
              {fr
                ? 'Ce qui part tout seul chez vos clients, sans que personne y pense.'
                : 'What goes out to your clients on its own, without anyone thinking about it.'}
            </p>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {/* Langue des messages envoyés aux clients */}
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-text-tertiary">{fr ? 'Messages en' : 'Messages in'}</span>
              <div className="inline-flex overflow-hidden rounded-lg border border-outline/50 text-[12px]">
                {(['fr', 'en'] as const).map((l) => (
                  <button
                    key={l}
                    type="button"
                    onClick={() => changerLangue(l)}
                    disabled={savingLang}
                    className={`px-2.5 py-1 font-medium transition-colors ${orgLang === l ? 'bg-text-primary text-white' : 'text-text-secondary hover:bg-surface-tertiary'}`}
                  >
                    {l === 'fr' ? 'FR' : 'EN'}
                  </button>
                ))}
              </div>
            </div>

            {/* Créer — cinq départs, comme chez GHL */}
            <div className="relative">
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setMenuCreer((m) => !m); }}
                aria-haspopup="menu"
                aria-expanded={menuCreer}
                className="glass-button-primary inline-flex items-center gap-1.5"
              >
                <Plus size={14} aria-hidden="true" />
                {fr ? 'Créer' : 'Create'}
                <ChevronDown size={13} aria-hidden="true" />
              </button>

              {menuCreer && (
                <div
                  role="menu"
                  tabIndex={-1}
                  onClick={(e) => e.stopPropagation()}
                  className="absolute right-0 z-30 mt-1.5 w-[280px] overflow-hidden rounded-xl border border-border bg-surface-card p-1.5 shadow-lg"
                >
                  {DEPARTS.map((d) => (
                    <button
                      key={d.cle}
                      type="button"
                      role="menuitem"
                      onClick={() => choisirDepart(d.cle)}
                      className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-surface-tertiary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      <d.icone size={15} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
                      <span className="min-w-0">
                        <span className="block text-[13px] font-medium text-text-primary">{fr ? d.fr : d.en}</span>
                        <span className="block text-[11px] text-text-tertiary">{fr ? d.aideFr : d.aideEn}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Trois chiffres ── */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { v: miennes.length, l: fr ? 'Mes automatisations' : 'My automations' },
            { v: publiees, l: fr ? 'Publiées' : 'Published' },
            { v: modeles.length, l: fr ? 'Modèles disponibles' : 'Templates available' },
          ].map((s) => (
            <div key={s.l} className="section-card px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">{s.l}</p>
              <p className="mt-0.5 text-xl font-bold text-text-primary">{s.v}</p>
            </div>
          ))}
        </div>

        {/* ── Onglets ── */}
        <div className="tab-nav" role="tablist" aria-label={fr ? 'Vue' : 'View'}>
          <button
            type="button"
            role="tab"
            aria-selected={onglet === 'miennes'}
            onClick={() => setOnglet('miennes')}
            className={onglet === 'miennes' ? 'tab-item-active' : 'tab-item'}
          >
            {fr ? `Mes automatisations (${miennes.length})` : `My automations (${miennes.length})`}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={onglet === 'modeles'}
            onClick={() => setOnglet('modeles')}
            className={onglet === 'modeles' ? 'tab-item-active' : 'tab-item'}
          >
            {fr ? `Modèles (${modeles.length})` : `Templates (${modeles.length})`}
          </button>
        </div>

        {/* ── Recherche et filtre ── */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" aria-hidden="true" />
            <label htmlFor="rech-automations" className="sr-only">{fr ? 'Rechercher' : 'Search'}</label>
            <input
              id="rech-automations"
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={fr ? 'Rechercher…' : 'Search…'}
              className="glass-input w-full pl-9"
            />
          </div>
          <label htmlFor="filtre-categorie" className="sr-only">{fr ? 'Catégorie' : 'Category'}</label>
          <select
            id="filtre-categorie"
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="glass-input"
          >
            <option value="all">{fr ? 'Toutes les catégories' : 'All categories'}</option>
            {CATEGORY_ORDER.map((c) => (
              <option key={c} value={c}>{fr ? CATEGORY_META[c].labelFr : CATEGORY_META[c].labelEn}</option>
            ))}
          </select>
          <span className="ml-auto text-[12px] text-text-tertiary">
            {visibles.length} {fr ? 'résultat(s)' : 'result(s)'}
          </span>
        </div>

        {/* ── Le tableau ── */}
        {loading ? (
          <div className="section-card flex items-center justify-center py-16">
            <Loader2 className="h-5 w-5 animate-spin text-text-tertiary" aria-hidden="true" />
          </div>
        ) : visibles.length === 0 ? (
          <div className="section-card px-6 py-14 text-center">
            <Zap className="mx-auto mb-3 h-8 w-8 text-text-tertiary" aria-hidden="true" />
            <p className="text-sm font-medium text-text-primary">
              {onglet === 'miennes'
                ? (fr ? 'Aucune automatisation pour l’instant' : 'No automations yet')
                : (fr ? 'Aucun modèle ne correspond' : 'No template matches')}
            </p>
            <p className="mx-auto mt-1 max-w-sm text-[13px] text-text-tertiary">
              {onglet === 'miennes'
                ? (fr
                  ? 'Créez la vôtre, ou partez d’un modèle déjà écrit pour votre métier.'
                  : 'Create your own, or start from a template written for your trade.')
                : (fr ? 'Essayez un autre mot ou une autre catégorie.' : 'Try another word or category.')}
            </p>
            {onglet === 'miennes' && modeles.length > 0 && (
              <button
                type="button"
                onClick={() => setOnglet('modeles')}
                className="glass-button mt-4 inline-flex items-center gap-1.5"
              >
                <FileText size={14} aria-hidden="true" />
                {fr ? 'Voir les modèles' : 'Browse templates'}
              </button>
            )}
          </div>
        ) : (
          <div className="section-card overflow-hidden">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-outline/40 text-left text-[10px] uppercase tracking-wider text-text-tertiary">
                  <th scope="col" className="px-4 py-2.5 font-semibold">{fr ? 'Automatisation' : 'Automation'}</th>
                  <th scope="col" className="hidden px-4 py-2.5 font-semibold md:table-cell">{fr ? 'Déclencheur' : 'Trigger'}</th>
                  <th scope="col" className="hidden px-4 py-2.5 font-semibold lg:table-cell">{fr ? 'Délai' : 'Timing'}</th>
                  <th scope="col" className="hidden px-4 py-2.5 font-semibold lg:table-cell">{fr ? 'Canaux' : 'Channels'}</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">{fr ? 'Statut' : 'Status'}</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-semibold">{fr ? 'Actions' : 'Actions'}</th>
                </tr>
              </thead>
              <tbody>
                {visibles.map((r) => {
                  const meta = PRESET_META[r.preset_key || ''];
                  const Icone = meta?.icon ?? Zap;
                  const rule = r;
                  const echecs = failureCounts[rule.id] ?? 0;
                  const decl = TRIGGER_DISPLAY[r.trigger_event];
                  return (
                    <React.Fragment key={r.id}>
                    <tr className="border-b border-outline/20 transition-colors last:border-0 hover:bg-surface-secondary/40">
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => navigate(`/automations/${r.id}`)}
                          className="flex items-center gap-2.5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        >
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-surface-tertiary">
                            <Icone size={14} className="text-text-secondary" aria-hidden="true" />
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate font-medium text-text-primary hover:text-accent">
                              {localizeAutomationName(r.name, language)}
                            </span>
                            {echecs > 0 && (
                              <span className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-danger">
                                <AlertTriangle size={11} aria-hidden="true" />
                                {echecs} {fr ? 'échec(s) dans les 7 derniers jours' : 'failure(s) in the last 7 days'}
                              </span>
                            )}
                          </span>
                        </button>
                      </td>
                      <td className="hidden px-4 py-3 text-text-secondary md:table-cell">
                        {decl ? (fr ? decl.fr : decl.en) : r.trigger_event}
                      </td>
                      <td className="hidden px-4 py-3 text-text-secondary lg:table-cell">
                        {Array.isArray(r.steps) && r.steps.length > 0
                          ? (fr ? `Parcours · ${r.steps.length} étapes` : `Path · ${r.steps.length} steps`)
                          : formatDelay(r.delay_seconds, language)}
                      </td>
                      <td className="hidden px-4 py-3 lg:table-cell">
                        <span className="flex flex-wrap gap-1">
                          {getChannels(r.actions, fr).map((c) => (
                            <span key={c} className="rounded-md bg-surface-tertiary px-1.5 py-0.5 text-[10px] text-text-secondary">{c}</span>
                          ))}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn(
                          'inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium',
                          r.is_active ? 'bg-success-light text-success' : 'bg-surface-tertiary text-text-tertiary',
                        )}>
                          {r.is_active ? (fr ? 'Publiée' : 'Published') : (fr ? 'Brouillon' : 'Draft')}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-0.5">
                          <button
                            type="button"
                            onClick={() => handleToggle(r)}
                            disabled={togglingId === r.id}
                            aria-label={r.is_active
                              ? (fr ? `Repasser ${r.name} en brouillon` : `Unpublish ${r.name}`)
                              : (fr ? `Publier ${r.name}` : `Publish ${r.name}`)}
                            aria-pressed={r.is_active}
                            className="rounded-md p-1 transition-colors hover:bg-surface-tertiary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                          >
                            {togglingId === r.id
                              ? <Loader2 size={18} className="animate-spin text-text-tertiary" aria-hidden="true" />
                              : r.is_active
                                ? <ToggleRight size={20} className="text-text-primary" aria-hidden="true" />
                                : <ToggleLeft size={20} className="text-text-tertiary" aria-hidden="true" />}
                          </button>

                          {/* Voir et modifier les messages, sans quitter la liste */}
                          <button
                            type="button"
                            onClick={() => setDeplieId((d) => (d === rule.id ? null : rule.id))}
                            aria-expanded={deplieId === rule.id}
                            aria-label={fr ? `Voir les messages de ${rule.name}` : `View messages of ${rule.name}`}
                            className="rounded-md p-1.5 text-text-tertiary transition-colors hover:bg-surface-tertiary hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                          >
                            <ChevronDown
                              size={15}
                              className={cn('transition-transform', deplieId === rule.id && 'rotate-180')}
                              aria-hidden="true"
                            />
                          </button>

                          {/* Menu « … » — modifier, dupliquer, supprimer */}
                          <div className="relative">
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); setMenuLigne((m) => (m === r.id ? null : r.id)); }}
                              aria-haspopup="menu"
                              aria-expanded={menuLigne === r.id}
                              aria-label={fr ? `Actions pour ${r.name}` : `Actions for ${r.name}`}
                              className="rounded-md p-1.5 text-text-tertiary transition-colors hover:bg-surface-tertiary hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                            >
                              {occupeId === r.id
                                ? <Loader2 size={15} className="animate-spin" aria-hidden="true" />
                                : <EllipsisVertical size={15} aria-hidden="true" />}
                            </button>

                            {menuLigne === r.id && (
                              <div
                                role="menu"
                                tabIndex={-1}
                                onClick={(e) => e.stopPropagation()}
                                className="absolute right-0 z-30 mt-1 w-[200px] overflow-hidden rounded-xl border border-border bg-surface-card p-1.5 shadow-lg"
                              >
                                <button
                                  type="button"
                                  role="menuitem"
                                  onClick={() => { setMenuLigne(null); navigate(`/automations/${r.id}`); }}
                                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-text-primary transition-colors hover:bg-surface-tertiary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                                >
                                  <Pencil size={13} aria-hidden="true" />
                                  {fr ? 'Ouvrir le parcours' : 'Open the path'}
                                </button>
                                <button
                                  type="button"
                                  role="menuitem"
                                  onClick={() => { setMenuLigne(null); dupliquer(r, r.is_preset); }}
                                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-text-primary transition-colors hover:bg-surface-tertiary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                                >
                                  <Copy size={13} aria-hidden="true" />
                                  {r.is_preset
                                    ? (fr ? 'Copier et modifier' : 'Copy and edit')
                                    : (fr ? 'Dupliquer' : 'Duplicate')}
                                </button>
                                {!r.is_preset && (
                                  <button
                                    type="button"
                                    role="menuitem"
                                    onClick={() => { setMenuLigne(null); supprimer(r); }}
                                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-danger transition-colors hover:bg-surface-tertiary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                                  >
                                    <Trash2 size={13} aria-hidden="true" />
                                    {fr ? 'Supprimer' : 'Delete'}
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>

                    {/* Les messages, modifiables sur place.
                        C'est ce qu'on vient chercher le plus souvent : changer
                        une phrase, pas refaire un parcours. */}
                    {deplieId === rule.id && (
                      <tr className="bg-surface-secondary/30">
                        <td colSpan={6} className="px-4 py-4">
                          {rule.actions.filter((a) => a.type === 'send_sms' || a.type === 'send_email').length === 0 ? (
                            <p className="text-[12px] text-text-tertiary">
                              {fr
                                ? 'Cette automatisation n’envoie ni texto ni courriel.'
                                : 'This automation sends neither text nor email.'}
                            </p>
                          ) : (
                            rule.actions
                              .filter((a) => a.type === 'send_sms' || a.type === 'send_email')
                              .map((a, i) => (
                                <MessageEditor
                                  key={`${rule.id}-${a.type}-${i}`}
                                  ruleId={rule.id}
                                  ruleName={localizeAutomationName(rule.name, language)}
                                  actionType={a.type as 'send_sms' | 'send_email'}
                                  body={String(a.config?.body ?? '')}
                                  subject={a.config?.subject ? String(a.config.subject) : undefined}
                                  fr={fr}
                                  onSaved={load}
                                />
                              ))
                          )}
                        </td>
                      </tr>
                    )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </PermissionGate>
  );
}
