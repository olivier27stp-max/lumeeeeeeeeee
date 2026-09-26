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
  Plus, Pencil, Copy, Trash2, RotateCcw, X, EllipsisVertical,
  Settings, FolderPlus, Filter, Building2, Link2, } from 'lucide-react';
import { cn } from '../lib/utils';
import { localizeAutomationName } from '../lib/automationNames';
import { useTranslation } from '../i18n';
import { toast } from 'sonner';
import PermissionGate from '../components/PermissionGate';
import BandeauPause from '../components/automations/BandeauPause';
import MessageEditor from '../components/automations/MessageEditor';
import CopierVersBureauxModal from '../components/automations/CopierVersBureauxModal';
import {
  chargerAutomatisations,
  creerAutomatisation,
  dupliquerAutomatisation,
  supprimerAutomatisation,
  restaurerAutomatisation,
  chargerDossiers,
  creerDossier,
  supprimerDossier,
  rangerDansDossier,
  chargerBureauxCibles,
  renommerDossier,
  type BureauCible,
  type CatalogueAutomatisations,
  type DossierAutomatisation,
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
  avisActives,
} from '../lib/automationRulesApi';

// ── Automation name translations (for DB-seeded English names) ──
// Couvre toutes les variantes de noms semées par les migrations
// (default_workflow_presets, advanced_automation_presets, dedup, activate_all).

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
  // Ajoutés le 2026-09-25 (QA, P2-11) : ces neuf-là manquaient, et la
  // liste affichait la CLÉ BRUTE — « deal.stage_entered », « custom_field.
  // changed » — au milieu de libellés français. Un test croise désormais
  // cette table avec le catalogue : un déclencheur neuf ne peut plus
  // arriver sans son nom.
  'client.replied':        { en: 'Client replied',        fr: 'Le client répond' },
  'client.tagged':         { en: 'Tag added',             fr: 'Étiquette ajoutée' },
  'task.completed':        { en: 'Task completed',        fr: 'Tâche terminée' },
  'note.added':            { en: 'Note added',            fr: 'Note ajoutée' },
  'webhook.received':      { en: 'Incoming webhook',      fr: 'Appel reçu de l’extérieur' },
  'date.reached':          { en: 'Date reached',          fr: 'Date atteinte' },
  'deal.stage_entered':    { en: 'Deal enters a stage',   fr: 'Opportunité entre dans une étape' },
  'deal.stage_idle':       { en: 'Deal idle in a stage',  fr: 'Opportunité qui dort' },
  'custom_field.changed':  { en: 'Custom field changed',  fr: 'Champ personnalisé modifié' },
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
 * LA LISTE DES AUTOMATISATIONS — copie de l'écran « Workflows list » de
 * GoHighLevel, relevée sur leur app le 2026-09-24.
 *
 * Décision de Rafba : on reprend LEUR structure au complet, y compris les
 * éléments qui n'ont pas encore de contenu chez nous (dossiers, corbeille,
 * listes intelligentes). Les libellés, eux, sont en français.
 *
 * Disposition, de haut en bas :
 *   1. sous-navigation  Automatisations · Vue d'ensemble · Réglages globaux
 *   2. titre + 3 boutons (Nouveau dossier · Construire avec Lumi · Créer)
 *   3. onglets          Toutes · À vérifier (N) · Corbeille · + Liste
 *   4. barre d'outils   Filtres avancés · vues · recherche
 *   5. fil d'Ariane     Accueil
 *   6. tableau          ☑ Nom · Statut · Total déclenché · En cours ·
 *                       Modifiée le · Créée le · Stats · › · ⋮
 *   7. pagination       Précédent · 1 · Suivant · 10 / page
 */
export default function Automations() {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const navigate = useNavigate();

  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [failureCounts, setFailureCounts] = useState<Record<string, number>>({});
  const [catalogue, setCatalogue] = useState<CatalogueAutomatisations | null>(null);
  const [occupeId, setOccupeId] = useState<string | null>(null);
  const [orgLang, setOrgLang] = useState<'fr' | 'en'>('fr');
  const [savingLang, setSavingLang] = useState(false);

  /** Onglet de la liste — les quatre de GHL. */
  const [onglet, setOnglet] = useState<'toutes' | 'verifier' | 'corbeille' | 'modeles'>('toutes');
  /** Menu « Créer » : les cinq départs de GHL. */
  const [menuCreer, setMenuCreer] = useState(false);
  /** Menu « … » ouvert sur quelle ligne ? */
  const [menuLigne, setMenuLigne] = useState<string | null>(null);

  // ── Dossiers ──
  // Le bouton existait depuis #525 et ne faisait qu'afficher « bientôt ».
  const [dossiers, setDossiers] = useState<DossierAutomatisation[]>([]);
  /** Le champ de nom est ouvert ? (pas de `prompt()` natif : test `dialogues-natifs-bannis`) */
  const [saisieDossier, setSaisieDossier] = useState(false);
  /** La ligne dont le sous-menu « Déplacer vers » est déplié. */
  const [sousMenuDossier, setSousMenuDossier] = useState<string | null>(null);
  const [nomDossier, setNomDossier] = useState('');
  /** Le dossier affiché — `null` = tout, `'racine'` = celles sans dossier. */
  const [dossierActif, setDossierActif] = useState<string | null>(null);

  useEffect(() => {
    // Un échec ici ne doit PAS empêcher la page de s'afficher : sans
    // dossiers, la liste reste simplement à plat.
    chargerDossiers()
      .then(setDossiers)
      .catch((e: unknown) => console.error('[automations] dossiers', e instanceof Error ? e.message : String(e)));
  }, []);


  /** Lignes cochées — GHL les utilise pour les actions en lot. */
  const [cochees, setCochees] = useState<Set<string>>(new Set());
  /** Un lot en cours : on désarme la barre pour éviter le double clic. */
  const [lotEnCours, setLotEnCours] = useState(false);
  /** Ligne dont le panneau de statistiques est déroulé (le chevron « › »). */
  const [statsId, setStatsId] = useState<string | null>(null);
  /** Ligne dépliée pour corriger le texte des messages. */
  const [deplieId, setDeplieId] = useState<string | null>(null);
  /** Filtres avancés visibles ? */
  const [filtresOuverts, setFiltresOuverts] = useState(false);
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [filterStatut, setFilterStatut] = useState<'all' | 'publiee' | 'brouillon'>('all');
  /** Pagination, comme GHL : 10 par page par défaut. */
  /**
   * Combien de lignes par page — RETENU d'une visite à l'autre.
   *
   * Signalé le 2026-09-25 : choisir « 50 par page » et retrouver « 10 » au
   * retour oblige à refaire le geste à chaque fois. C'est une préférence
   * d'affichage propre au navigateur : `localStorage` suffit, et une valeur
   * illisible (stockage bloqué, mode privé, valeur trafiquée) retombe
   * proprement sur 10.
   */
  const [parPage, setParPage] = useState(() => {
    try {
      const n = Number(localStorage.getItem('lume-automations-par-page'));
      return [10, 25, 50].includes(n) ? n : 10;
    } catch {
      return 10;
    }
  });
  const [page, setPage] = useState(1);

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
      /*
       * Dédoublonnage par `preset_key` : d'anciennes migrations ont semé le
       * même préréglage plusieurs fois.
       *
       * Les règles à la CORBEILLE sont écartées du dédoublonnage : sinon une
       * copie supprimée peut arriver la première et masquer sa jumelle
       * vivante, qui disparaîtrait de la liste tout en continuant de
       * s'exécuter. On garde les supprimées telles quelles — la corbeille
       * doit montrer ce qu'on y a mis.
       */
      const vues = new Set<string>();
      setRules(data.filter((r) => {
        if (r.deleted_at) return true;
        if (!r.preset_key) return true;
        if (vues.has(r.preset_key)) return false;
        vues.add(r.preset_key);
        return true;
      }));
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

  const validerNouveauDossier = async () => {
    const nom = nomDossier.trim();
    if (!nom) { setSaisieDossier(false); return; }
    try {
      const d = await creerDossier(nom);
      setDossiers((prev) => [...prev, d].sort((a, b) => a.name.localeCompare(b.name)));
      setNomDossier('');
      setSaisieDossier(false);
      toast.success(fr ? `Dossier « ${d.name} » créé` : `Folder “${d.name}” created`);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  /*
   * RENOMMER UN DOSSIER.
   *
   * La route (PATCH /automations/folders/:id) et le client existaient
   * déjà — il n'y avait simplement aucun bouton : seul « Supprimer »
   * était proposé, donc corriger une faute de frappe obligeait à
   * détruire le dossier et à tout reclasser. QA du 2026-09-25 (P2-8).
   *
   * La saisie se fait EN LIGNE : `prompt()` natif est banni (test
   * `dialogues-natifs-bannis`), et c'est tant mieux — il ne se traduit
   * pas et ne ressemble à rien.
   */
  const [dossierRenomme, setDossierRenomme] = useState<string | null>(null);
  const [nouveauNom, setNouveauNom] = useState('');

  const validerRenommage = async (id: string) => {
    const nom = nouveauNom.trim();
    setDossierRenomme(null);
    if (!nom) return;
    const avant = dossiers;
    // On affiche le nouveau nom tout de suite ; on revient en arrière si
    // le serveur refuse.
    setDossiers((prev) => prev.map((d) => (d.id === id ? { ...d, name: nom } : d))
      .sort((a, b) => a.name.localeCompare(b.name)));
    try {
      await renommerDossier(id, nom);
    } catch (e: unknown) {
      setDossiers(avant);
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const retirerDossier = async (id: string, nom: string) => {
    const ok = await confirmer({
      title: fr ? `Supprimer le dossier « ${nom} » ?` : `Delete folder “${nom}”?`,
      message: fr
        ? 'Les automatisations qu’il contient reviennent à la racine et continuent de tourner. Rien n’est supprimé.'
        : 'The automations inside move back to the root and keep running. Nothing is deleted.',
      confirmLabel: fr ? 'Supprimer' : 'Delete',
    });
    if (!ok) return;
    try {
      await supprimerDossier(id);
      setDossiers((prev) => prev.filter((d) => d.id !== id));
      if (dossierActif === id) setDossierActif(null);
      await load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const deplacerVers = async (ruleId: string, folderId: string | null) => {
    setMenuLigne(null);
    try {
      await rangerDansDossier(ruleId, folderId);
      await load();
      toast.success(folderId
        ? (fr ? 'Rangée dans le dossier' : 'Moved to folder')
        : (fr ? 'Remise à la racine' : 'Moved back to root'));
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    let vivant = true;
    chargerAutomatisations()
      .then((d) => { if (vivant) setCatalogue(d.catalogue); })
      .catch((e: unknown) => {
        console.error('[Automations] catalogue indisponible', e instanceof Error ? e.message : String(e));
      });
    return () => { vivant = false; };
  }, []);

  // Fermer les menus au clic ailleurs.
  useEffect(() => {
    if (!menuCreer && !menuLigne) return;
    const fermer = () => { setMenuCreer(false); setMenuLigne(null); };
    document.addEventListener('click', fermer);
    return () => document.removeEventListener('click', fermer);
  }, [menuCreer, menuLigne]);

  // Changer d'onglet ou de filtre remet à la première page : rester en page 3
  // d'une liste qui n'en a plus qu'une donne un écran vide inexplicable.
  useEffect(() => { setPage(1); }, [onglet, search, filterCategory, filterStatut]);

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

  // Multi-bureaux : bureaux où l'on peut copier (vide = un seul bureau, l'option n'apparaît pas).
  /*
   * « Tout arrêter » actif ? Pendant la pause, chaque ligne publiée restait
   * étiquetée « Publiée » malgré le bandeau rouge : on ne savait plus ce
   * qui tournait vraiment. QA du 2026-09-25 (P2-9).
   */
  const [toutEnPause, setToutEnPause] = useState(false);

  /*
   * Les demandes d'avis sont-elles activées ? `review_enabled` vaut FAUX par
   * défaut alors que le préréglage d'avis est actif par défaut : mesuré le
   * 2026-09-25, 6 entreprises sur 7 avaient une règle d'avis « Publiée »
   * qui échouait à chaque fois, sans que rien ne le montre. `null` =
   * inconnu : on n'affiche alors aucun avertissement plutôt qu'un faux.
   */
  const [avisOk, setAvisOk] = useState<boolean | null>(null);
  useEffect(() => {
    let vivant = true;
    avisActives()
      .then((v) => { if (vivant) setAvisOk(v); })
      // Inconnu = aucun avertissement, jamais un plantage de la page.
      .catch(() => { if (vivant) setAvisOk(null); });
    return () => { vivant = false; };
  }, []);

  /** La règle demande-t-elle un avis (ancien format OU parcours) ? */
  const demandeUnAvis = (r: AutomationRule): boolean =>
    JSON.stringify(r.actions ?? []).includes('"request_review"')
    || JSON.stringify((r as { steps?: unknown }).steps ?? []).includes('"request_review"');
  const [bureauxCibles, setBureauxCibles] = useState<BureauCible[]>([]);
  const [copieVers, setCopieVers] = useState<AutomationRule | null>(null);
  /*
   * LA LISTE DES BUREAUX SE RÉCUPÈRE D'UN ÉCHEC.
   *
   * Un seul appel au montage : s'il échouait, `bureauxCibles` restait
   * vide POUR TOUJOURS et « Copier vers d'autres bureaux » n'apparaissait
   * jamais — sur un compte qui a pourtant deux bureaux. Vu 1 fois sur 6
   * au QA du 2026-09-25 (P1-5), sans que personne comprenne pourquoi.
   *
   * La cause la plus probable est celle de P0-1 : au chargement direct,
   * le bureau n'est pas encore publié et le serveur répond 400
   * `org_required`. Ce correctif-là règle la course ; celui-ci rend
   * l'échec RÉPARABLE, ce qui vaut pour n'importe quelle autre panne
   * passagère (réseau, jeton en cours de rafraîchissement).
   */
  useEffect(() => {
    let vivant = true;
    let minuterie: ReturnType<typeof setTimeout> | null = null;

    const charger = (essai: number) => {
      chargerBureauxCibles()
        .then((b) => { if (vivant) setBureauxCibles(b); })
        .catch((e: unknown) => {
          console.error('[automatisations] bureaux cibles illisibles', e);
          // Trois essais, espacés : le temps que le bureau soit connu.
          if (vivant && essai < 3) {
            minuterie = setTimeout(() => charger(essai + 1), 800 * essai);
          }
        });
    };

    charger(1);
    return () => { vivant = false; if (minuterie) clearTimeout(minuterie); };
  }, []);

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
        ? `« ${regle.name} » part à la corbeille : elle cesse de se déclencher et les envois déjà prévus sont annulés. Tu pourras la restaurer.`
        : `“${regle.name}” goes to the bin: it stops triggering and any queued messages are cancelled. You can restore it later.`,
      confirmLabel: fr ? 'Supprimer' : 'Delete',
      danger: true,
    });
    if (!ok) return;
    setOccupeId(regle.id);
    try {
      await supprimerAutomatisation(regle.id);
      toast.success(fr ? 'Automatisation mise à la corbeille' : 'Automation moved to the bin');
      await load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setOccupeId(null);
    }
  };

  /**
   * Sortir une automatisation de la corbeille.
   *
   * Elle revient en BROUILLON, jamais publiée — décision côté serveur. Une
   * règle restaurée qui se remettrait à écrire aux clients sans qu'on l'ait
   * relue serait exactement la surprise qu'une corbeille doit éviter.
   */
  const restaurer = async (regle: AutomationRule) => {
    setOccupeId(regle.id);
    try {
      await restaurerAutomatisation(regle.id);
      toast.success(fr
        ? 'Automatisation restaurée — elle est en brouillon'
        : 'Automation restored — it is a draft');
      await load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setOccupeId(null);
    }
  };

  const getCategory = (r: AutomationRule): CategoryKey =>
    (PRESET_META[r.preset_key || '']?.category as CategoryKey) || 'Follow-up';

  /*
   * La corbeille se sépare AVANT tout le reste.
   *
   * Le serveur renvoie les règles vivantes ET celles à la corbeille dans la
   * même liste : c'est ici qu'on les départage, une seule fois. Une règle
   * supprimée ne doit apparaître dans AUCUN autre onglet — ni dans « Toutes »,
   * ni dans « À vérifier » où ses échecs passés la feraient remonter.
   */
  const vivantes = rules.filter((r) => !r.deleted_at);
  const supprimees = rules.filter((r) => r.deleted_at);

  /** « À vérifier » = ce qui a échoué ces 7 derniers jours. */
  const aVerifier = vivantes.filter((r) => (failureCounts[r.id] ?? 0) > 0);
  const mesAutos = vivantes.filter((r) => !r.is_preset || r.is_active);
  const modeles = vivantes.filter((r) => r.is_preset && !r.is_active);

  const sourceOnglet =
    onglet === 'verifier' ? aVerifier
    : onglet === 'modeles' ? modeles
    : onglet === 'corbeille' ? supprimees
    : mesAutos;

  const filtrees = sourceOnglet.filter((r) => {
    if (search) {
      const q = search.toLowerCase();
      const nom = localizeAutomationName(r.name, language).toLowerCase();
      if (!nom.includes(q) && !(r.description || '').toLowerCase().includes(q)) return false;
    }
    if (filterCategory !== 'all' && getCategory(r) !== filterCategory) return false;
    if (filterStatut === 'publiee' && !r.is_active) return false;
    if (filterStatut === 'brouillon' && r.is_active) return false;
    // Le dossier affiché. `null` = tout, 'racine' = celles qui ne sont
    // rangées nulle part.
    if (dossierActif === 'racine' && r.folder_id) return false;
    if (dossierActif && dossierActif !== 'racine' && r.folder_id !== dossierActif) return false;
    return true;
  });

  const pages = Math.max(1, Math.ceil(filtrees.length / parPage));

  /** Combien d'automatisations dans chaque dossier — un dossier vide se voit. */
  const compteParDossier = (id: string) => vivantes.filter((r) => r.folder_id === id).length;
  const visibles = filtrees.slice((page - 1) * parPage, page * parPage);

  const toutCoche = visibles.length > 0 && visibles.every((r) => cochees.has(r.id));
  const basculerTout = () => {
    setCochees((prev) => {
      const n = new Set(prev);
      if (toutCoche) visibles.forEach((r) => n.delete(r.id));
      else visibles.forEach((r) => n.add(r.id));
      return n;
    });
  };

  /**
   * Les actions sur plusieurs automatisations à la fois.
   *
   * Les cases à cocher existaient déjà mais ne commandaient rien : cocher
   * trente lignes et n'avoir aucun bouton est pire que pas de case du tout.
   *
   * On travaille sur les règles RÉELLEMENT cochées et encore présentes —
   * une coche peut survivre à un changement de filtre ou à un rechargement,
   * et agir sur un identifiant disparu échouerait ligne par ligne.
   */
  const reglesCochees = rules.filter((r) => cochees.has(r.id));

  /**
   * Applique `action` à chaque règle cochée, en SÉQUENCE.
   *
   * En parallèle, trente écritures partiraient d'un coup sur la même table :
   * on préfère un peu plus lent et un décompte exact de ce qui a marché.
   * Une ligne en échec n'arrête pas les autres — sinon une seule règle
   * verrouillée bloquerait tout le lot sans qu'on sache où ça s'est arrêté.
   */
  const agirEnLot = async (
    action: (r: AutomationRule) => Promise<unknown>,
    messages: { fr: (n: number) => string; en: (n: number) => string },
    cibles: AutomationRule[] = reglesCochees,
  ) => {
    let reussis = 0;
    const echoues: string[] = [];
    setLotEnCours(true);
    try {
      for (const r of cibles) {
        try {
          await action(r);
          reussis += 1;
        } catch (e: unknown) {
          echoues.push(localizeAutomationName(r.name, language));
          console.error('[automations] action en lot échouée', r.id, e);
        }
      }
      if (reussis > 0) toast.success(fr ? messages.fr(reussis) : messages.en(reussis));
      if (echoues.length > 0) {
        // On NOMME ce qui a échoué : « 3 erreurs » n'aide personne à corriger.
        toast.error(fr
          ? `Échec sur : ${echoues.join(', ')}`
          : `Failed on: ${echoues.join(', ')}`);
      }
      setCochees(new Set());
      await load();
    } finally {
      setLotEnCours(false);
    }
  };

  /*
   * Publier ou dépublier ne concerne que les règles VIVANTES : une règle à
   * la corbeille est ignorée par le moteur, la publier ne changerait rien.
   */
  const publierLot = () => agirEnLot(
    (r) => (r.is_active ? Promise.resolve() : toggleAutomationRule(r.id, true)),
    { fr: (n) => `${n} automatisation(s) publiée(s)`, en: (n) => `${n} automation(s) published` },
    reglesCochees.filter((r) => !r.deleted_at),
  );

  const depublierLot = () => agirEnLot(
    (r) => (r.is_active ? toggleAutomationRule(r.id, false) : Promise.resolve()),
    { fr: (n) => `${n} automatisation(s) repassée(s) en brouillon`, en: (n) => `${n} automation(s) unpublished` },
    reglesCochees.filter((r) => !r.deleted_at),
  );

  const supprimerLot = async () => {
    /*
     * Les modèles ne se suppriment pas — le menu d'une ligne le refuse déjà.
     * Sans ce garde, cocher « tout » enverrait des suppressions vouées à
     * échouer, et la barre afficherait des erreurs pour des lignes que
     * l'utilisateur n'a jamais voulu toucher.
     */
    const supprimables = reglesCochees.filter((r) => !r.is_preset);
    if (supprimables.length === 0) {
      toast.info(fr ? 'Un modèle ne se supprime pas.' : 'A template cannot be deleted.');
      return;
    }
    const ok = await confirmer({
      title: fr
        ? `Supprimer ${supprimables.length} automatisation(s) ?`
        : `Delete ${supprimables.length} automation(s)?`,
      message: fr
        ? 'Elles partent à la corbeille : elles cessent de se déclencher et les envois déjà prévus sont annulés. Tu pourras les restaurer.'
        : 'They go to the bin: they stop triggering and any queued messages are cancelled. You can restore them later.',
      confirmLabel: fr ? 'Supprimer' : 'Delete',
      danger: true,
    });
    if (!ok) return;
    await agirEnLot(
      (r) => supprimerAutomatisation(r.id),
      { fr: (n) => `${n} automatisation(s) à la corbeille`, en: (n) => `${n} automation(s) moved to the bin` },
      supprimables,
    );
  };

  const restaurerLot = () => agirEnLot(
    (r) => restaurerAutomatisation(r.id),
    { fr: (n) => `${n} automatisation(s) restaurée(s) en brouillon`, en: (n) => `${n} automation(s) restored as drafts` },
    reglesCochees.filter((r) => !!r.deleted_at),
  );

  const DEPARTS: Array<{ cle: string; fr: string; en: string; aideFr: string; aideEn: string; icone: typeof Zap }> = [
    { cle: 'zero', fr: 'Partir de zéro', en: 'Start from scratch', icone: Plus,
      aideFr: 'Un parcours vide, à construire.', aideEn: 'An empty path, to build.' },
    { cle: 'lumi', fr: 'Construire avec Lumi', en: 'Build with Lumi', icone: Sparkles,
      aideFr: 'Décris ce que tu veux, Lumi le monte.', aideEn: 'Describe it, Lumi builds it.' },
    { cle: 'modele', fr: 'Partir d’un modèle', en: 'Start from a template', icone: FileText,
      aideFr: `${modeles.length} modèles prêts à l’emploi.`, aideEn: `${modeles.length} ready-made templates.` },
    /*
     * GoHighLevel en offre deux de plus : « Importer d'une campagne » et
     * « Automatisation d'entreprise ». Ni l'un ni l'autre n'a d'équivalent
     * ici — Lume n'a pas de campagnes, et toutes nos automatisations
     * appartiennent déjà à l'entreprise.
     *
     * On les RETIRE au lieu d'afficher « bientôt » : un menu qui promet ce
     * qu'il ne fait pas est exactement le défaut qu'on reproche au leur.
     */
  ];

  const choisirDepart = (cle: string) => {
    setMenuCreer(false);
    if (cle === 'zero') { partirDeZero(false); return; }
    if (cle === 'lumi') { partirDeZero(true); return; }
    if (cle === 'modele') { setOnglet('modeles'); return; }
    // Inatteignable : les trois départs ci-dessus couvrent tout `DEPARTS`.
    // Le garder évite qu'un ajout futur retombe dans le vide sans un mot.
    console.error('[automations] départ inconnu :', cle);
  };

  const ONGLETS = [
    { cle: 'toutes' as const, fr: 'Toutes', en: 'All workflows', n: mesAutos.length },
    { cle: 'verifier' as const, fr: 'À vérifier', en: 'Needs review', n: aVerifier.length },
    { cle: 'modeles' as const, fr: 'Modèles', en: 'Templates', n: modeles.length },
    { cle: 'corbeille' as const, fr: 'Corbeille', en: 'Deleted', n: supprimees.length },
  ];

  const dateCourte = (iso: string | null | undefined) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString(fr ? 'fr-CA' : 'en-CA', {
      day: 'numeric', month: 'short', year: 'numeric',
    });
  };

  return (
    <PermissionGate permission="automations.update">
      <div className="mx-auto max-w-[1400px] space-y-4">

        {/* ══ 1. Sous-navigation ══ */}
        <div className="flex flex-wrap items-center gap-5 border-b border-border pb-0">
          <span className="pb-3 text-[15px] font-semibold text-text-primary">
            {fr ? 'Automatisation' : 'Automation'}
          </span>
          <nav className="flex items-center gap-1" aria-label={fr ? 'Sections' : 'Sections'}>
            <span className="border-b-2 border-primary px-3 pb-3 pt-1 text-[13px] font-semibold text-primary">
              {fr ? 'Automatisations' : 'Workflows'}
            </span>
            <button
              type="button"
              onClick={() => navigate('/automations/apercu')}
              className="inline-flex items-center gap-1.5 border-b-2 border-transparent px-3 pb-3 pt-1 text-[13px] text-text-secondary transition-colors hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {fr ? 'Vue d’ensemble' : 'Overview'}
              <span className="rounded bg-warning-light px-1 py-0.5 text-[9px] font-bold uppercase text-warning">
                {fr ? 'Bêta' : 'Beta'}
              </span>
            </button>
            <button
              type="button"
              onClick={() => navigate('/automations/reglages')}
              className="inline-flex items-center gap-1.5 border-b-2 border-transparent px-3 pb-3 pt-1 text-[13px] text-text-secondary transition-colors hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <Settings size={13} aria-hidden="true" />
              {fr ? 'Réglages globaux' : 'Global settings'}
            </button>
          </nav>
        </div>

        {/*
          L'interrupteur du client, AVANT la liste : on le cherche en
          panique quand des messages partent, pas en explorant les
          réglages. En marche c'est un lien discret ; en pause, un bandeau
          rouge impossible à manquer — oublier que ses automatisations
          dorment coûte des relances pendant des jours.
        */}
        <BandeauPause fr={fr} onChange={setToutEnPause} />

        {/* ══ 2. Titre + les trois boutons ══ */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-[26px] font-bold tracking-tight text-text-primary">
            {fr ? 'Mes automatisations' : 'Workflows list'}
          </h1>

          <div className="flex flex-wrap items-center gap-2">
            <div className="mr-1 flex items-center gap-2">
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

            {saisieDossier ? (
              <span className="inline-flex items-center gap-1.5">
                <label htmlFor="nouveau-dossier" className="sr-only">
                  {fr ? 'Nom du dossier' : 'Folder name'}
                </label>
                <input
                  id="nouveau-dossier"
                  type="text"
                  autoFocus
                  maxLength={60}
                  value={nomDossier}
                  onChange={(e) => setNomDossier(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void validerNouveauDossier();
                    if (e.key === 'Escape') { setSaisieDossier(false); setNomDossier(''); }
                  }}
                  placeholder={fr ? 'Nom du dossier' : 'Folder name'}
                  className="w-44 rounded-lg border border-border bg-surface-primary px-2.5 py-1.5 text-[13px] text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                />
                <button
                  type="button"
                  onClick={() => void validerNouveauDossier()}
                  className="glass-button-primary text-[13px]"
                >
                  {fr ? 'Créer' : 'Create'}
                </button>
                <button
                  type="button"
                  onClick={() => { setSaisieDossier(false); setNomDossier(''); }}
                  className="text-[13px] text-text-secondary hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  {fr ? 'Annuler' : 'Cancel'}
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setSaisieDossier(true)}
                className="glass-button inline-flex items-center gap-1.5"
              >
                <FolderPlus size={14} aria-hidden="true" />
                {fr ? 'Nouveau dossier' : 'Create folder'}
              </button>
            )}

            <button
              type="button"
              onClick={() => partirDeZero(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-accent bg-accent/5 px-3 py-1.5 text-[13px] font-semibold text-accent transition-colors hover:bg-accent/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <Sparkles size={14} aria-hidden="true" />
              {fr ? 'Construire avec Lumi' : 'Build using AI'}
            </button>

            <div className="relative">
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setMenuCreer((m) => !m); }}
                aria-haspopup="menu"
                aria-expanded={menuCreer}
                className="glass-button-primary inline-flex items-center gap-1.5"
              >
                <Plus size={14} aria-hidden="true" />
                {fr ? 'Créer' : 'Create workflow'}
                <ChevronDown size={13} aria-hidden="true" />
              </button>

              {menuCreer && (
                <div
                  role="menu"
                  tabIndex={-1}
                  onClick={(e) => e.stopPropagation()}
                  className="absolute right-0 z-30 mt-1.5 w-[300px] overflow-hidden rounded-xl border border-border bg-surface-card p-1.5 shadow-lg"
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

        {/* ══ 3. Onglets ══ */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border">
          <nav className="flex items-center gap-1" role="tablist" aria-label={fr ? 'Filtres' : 'Filters'}>
            {ONGLETS.map((o) => (
              <button
                key={o.cle}
                type="button"
                role="tab"
                aria-selected={onglet === o.cle}
                onClick={() => setOnglet(o.cle)}
                className={cn(
                  'border-b-2 px-3 pb-2.5 pt-1 text-[13px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                  onglet === o.cle
                    ? 'border-primary font-semibold text-primary'
                    : 'border-transparent text-text-secondary hover:text-text-primary',
                )}
              >
                {fr ? o.fr : o.en}
                {o.cle !== 'toutes' && ` (${o.n})`}
              </button>
            ))}
            {/* GoHighLevel a ici « Nouvelle liste » (des vues filtrées
                enregistrées). Ce sont nos DOSSIERS, juste au-dessous — et
                eux fonctionnent. Un second mécanisme de rangement, à moitié
                fait, n'aiderait personne. */}
          </nav>


        </div>

        {/* Les dossiers — n'apparaissent qu'une fois qu'il y en a.
            Une barre vide occuperait de la place pour rien. */}
        {dossiers.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5" aria-label={fr ? 'Dossiers' : 'Folders'}>
            {([
              [null, fr ? 'Tout' : 'All'],
              ['racine', fr ? 'Sans dossier' : 'No folder'],
            ] as const).map(([cle, libelle]) => (
              <button
                key={libelle}
                type="button"
                onClick={() => setDossierActif(cle)}
                aria-pressed={dossierActif === cle}
                className={cn(
                  'rounded-full border px-3 py-1 text-[12px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                  dossierActif === cle
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-text-secondary hover:text-text-primary',
                )}
              >
                {libelle}
              </button>
            ))}
            {dossiers.map((d) => (
              <span
                key={d.id}
                className={cn(
                  'inline-flex items-center gap-1 rounded-full border pl-3 pr-1 text-[12px] transition-colors',
                  dossierActif === d.id
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-text-secondary',
                )}
              >
                {dossierRenomme === d.id ? (
                  <input
                    type="text"
                    value={nouveauNom}
                    onChange={(e) => setNouveauNom(e.target.value)}
                    onBlur={() => void validerRenommage(d.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void validerRenommage(d.id);
                      // Échap annule : on ne renomme pas par accident en
                      // quittant le champ.
                      if (e.key === 'Escape') setDossierRenomme(null);
                    }}
                    aria-label={fr ? `Nouveau nom du dossier ${d.name}` : `New name for folder ${d.name}`}
                    maxLength={60}
                    autoFocus
                    className="w-[140px] rounded bg-surface px-1.5 py-0.5 text-[12px] text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setDossierActif(d.id)}
                    aria-pressed={dossierActif === d.id}
                    className="py-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    {d.name}
                    <span className="ml-1 tabular-nums opacity-60">{compteParDossier(d.id)}</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => { setDossierRenomme(d.id); setNouveauNom(d.name); }}
                  aria-label={fr ? `Renommer le dossier ${d.name}` : `Rename folder ${d.name}`}
                  className="rounded-full p-1 text-text-tertiary transition-colors hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <Pencil size={11} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => void retirerDossier(d.id, d.name)}
                  aria-label={fr ? `Supprimer le dossier ${d.name}` : `Delete folder ${d.name}`}
                  className="rounded-full p-1 text-text-tertiary transition-colors hover:text-danger focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <Trash2 size={11} aria-hidden="true" />
                </button>
              </span>
            ))}
          </div>
        )}

        {/* ══ 4. Barre d'outils ══ */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setFiltresOuverts((f) => !f)}
            aria-expanded={filtresOuverts}
            className="glass-button inline-flex items-center gap-1.5"
          >
            <Filter size={13} aria-hidden="true" />
            {fr ? 'Filtres avancés' : 'Advanced filters'}
          </button>

          <div className="ml-auto flex items-center gap-2">
            <div className="relative w-[260px]">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" aria-hidden="true" />
              <label htmlFor="rech-automations" className="sr-only">{fr ? 'Rechercher' : 'Search'}</label>
              <input
                id="rech-automations"
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={fr ? 'Rechercher' : 'Search'}
                className="glass-input w-full pl-9"
              />
            </div>
          </div>
        </div>

        {filtresOuverts && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface-secondary p-3">
            <label htmlFor="f-categorie" className="text-[12px] text-text-secondary">{fr ? 'Catégorie' : 'Category'}</label>
            <select
              id="f-categorie"
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="glass-input"
            >
              <option value="all">{fr ? 'Toutes' : 'All'}</option>
              {CATEGORY_ORDER.map((c) => (
                <option key={c} value={c}>{fr ? CATEGORY_META[c].labelFr : CATEGORY_META[c].labelEn}</option>
              ))}
            </select>
            <label htmlFor="f-statut" className="ml-2 text-[12px] text-text-secondary">{fr ? 'Statut' : 'Status'}</label>
            <select
              id="f-statut"
              value={filterStatut}
              onChange={(e) => setFilterStatut(e.target.value as typeof filterStatut)}
              className="glass-input"
            >
              <option value="all">{fr ? 'Tous' : 'All'}</option>
              <option value="publiee">{fr ? 'Publiée' : 'Published'}</option>
              <option value="brouillon">{fr ? 'Brouillon' : 'Draft'}</option>
            </select>
          </div>
        )}

        {/* ══ 5. Fil d'Ariane ══ */}
        <p className="text-[13px] text-text-secondary">{fr ? 'Accueil' : 'Home'}</p>

        {/*
          La barre d'actions groupées — elle n'apparaît QUE s'il y a une
          sélection, comme chez GoHighLevel. Dans la corbeille, la seule
          action offerte est « Restaurer ».
        */}
        {reglesCochees.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface-secondary px-3 py-2">
            <span className="text-[13px] font-medium text-text-primary">
              {fr
                ? `${reglesCochees.length} sélectionnée(s)`
                : `${reglesCochees.length} selected`}
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              {onglet === 'corbeille' ? (
                <button
                  type="button"
                  onClick={() => void restaurerLot()}
                  disabled={lotEnCours}
                  className="glass-button inline-flex items-center gap-1.5 text-[12px] disabled:opacity-50"
                >
                  <RotateCcw size={13} aria-hidden="true" />
                  {fr ? 'Restaurer' : 'Restore'}
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => void publierLot()}
                    disabled={lotEnCours}
                    className="glass-button inline-flex items-center gap-1.5 text-[12px] disabled:opacity-50"
                  >
                    <ToggleRight size={13} aria-hidden="true" />
                    {fr ? 'Publier' : 'Publish'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void depublierLot()}
                    disabled={lotEnCours}
                    className="glass-button inline-flex items-center gap-1.5 text-[12px] disabled:opacity-50"
                  >
                    <ToggleLeft size={13} aria-hidden="true" />
                    {fr ? 'Repasser en brouillon' : 'Unpublish'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void supprimerLot()}
                    disabled={lotEnCours}
                    className="glass-button inline-flex items-center gap-1.5 text-[12px] text-danger disabled:opacity-50"
                  >
                    <Trash2 size={13} aria-hidden="true" />
                    {fr ? 'Supprimer' : 'Delete'}
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() => setCochees(new Set())}
                disabled={lotEnCours}
                className="rounded-lg px-2 py-1 text-[12px] text-text-secondary transition-colors hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
              >
                {fr ? 'Tout décocher' : 'Clear selection'}
              </button>
              {lotEnCours && (
                <Loader2 size={14} className="animate-spin text-text-tertiary" aria-hidden="true" />
              )}
            </div>
          </div>
        )}

        {/* ══ 6. Le tableau ══ */}
        {loading ? (
          <div className="section-card flex items-center justify-center py-16">
            <Loader2 className="h-5 w-5 animate-spin text-text-tertiary" aria-hidden="true" />
          </div>
        ) : (
          <div className="section-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-[13px]">
                <thead>
                  <tr className="border-b border-outline/40 text-left text-[12px] text-text-secondary">
                    <th scope="col" className="w-10 px-3 py-3">
                      <input
                        type="checkbox"
                        checked={toutCoche}
                        onChange={basculerTout}
                        aria-label={fr ? 'Tout cocher' : 'Select all'}
                        className="h-3.5 w-3.5 rounded border-outline"
                      />
                    </th>
                    <th scope="col" className="px-3 py-3 font-medium">{fr ? 'Nom' : 'Name'}</th>
                    <th scope="col" className="px-3 py-3 font-medium">{fr ? 'Statut' : 'Status'}</th>
                    <th scope="col" className="px-3 py-3 font-medium">{fr ? 'Total déclenché' : 'Total enrolled'}</th>
                    <th scope="col" className="px-3 py-3 font-medium">{fr ? 'En cours' : 'Active enrolled'}</th>
                    <th scope="col" className="hidden px-3 py-3 font-medium lg:table-cell">{fr ? 'Modifiée le' : 'Last updated'}</th>
                    <th scope="col" className="hidden px-3 py-3 font-medium lg:table-cell">{fr ? 'Créée le' : 'Created on'}</th>
                    <th scope="col" className="px-3 py-3 font-medium">{fr ? 'Stats' : 'Stats'}</th>
                    <th scope="col" className="w-24 px-3 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {visibles.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-4 py-14 text-center">
                        <Zap className="mx-auto mb-3 h-7 w-7 text-text-tertiary" aria-hidden="true" />
                        <p className="text-[13px] font-medium text-text-primary">
                          {onglet === 'corbeille'
                            ? (fr ? 'La corbeille est vide' : 'The bin is empty')
                            : onglet === 'verifier'
                              ? (fr ? 'Aucune erreur — tout roule' : 'No errors — all running smoothly')
                              : (fr ? 'Aucune automatisation' : 'No automations')}
                        </p>
                        {onglet === 'toutes' && modeles.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setOnglet('modeles')}
                            className="glass-button mt-4 inline-flex items-center gap-1.5"
                          >
                            <FileText size={13} aria-hidden="true" />
                            {fr ? 'Voir les modèles' : 'Browse templates'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ) : visibles.map((r) => {
                    const rule = r;
                    const echecs = failureCounts[rule.id] ?? 0;
                    const decl = TRIGGER_DISPLAY[rule.trigger_event];
                    const meta = PRESET_META[rule.preset_key || ''];
                    const Icone = meta?.icon ?? Zap;
                    return (
                      <React.Fragment key={rule.id}>
                        <tr className="border-b border-outline/20 transition-colors last:border-0 hover:bg-surface-secondary/40">
                          <td className="px-3 py-3">
                            <input
                              type="checkbox"
                              checked={cochees.has(rule.id)}
                              onChange={() => setCochees((prev) => {
                                const n = new Set(prev);
                                if (n.has(rule.id)) n.delete(rule.id); else n.add(rule.id);
                                return n;
                              })}
                              aria-label={fr ? `Cocher ${localizeAutomationName(rule.name, language)}` : `Select ${localizeAutomationName(rule.name, language)}`}
                              className="h-3.5 w-3.5 rounded border-outline"
                            />
                          </td>

                          <td className="px-3 py-3">
                            <button
                              type="button"
                              onClick={() => navigate(`/automations/${rule.id}`)}
                              className="flex items-start gap-2.5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                            >
                              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-surface-tertiary">
                                <Icone size={13} className="text-text-secondary" aria-hidden="true" />
                              </span>
                              <span className="min-w-0">
                                <span className="block font-medium text-primary hover:underline">
                                  {localizeAutomationName(rule.name, language)}
                                </span>
                                <span className="block text-[11px] text-text-tertiary">
                                  {decl ? (fr ? decl.fr : decl.en) : rule.trigger_event}
                                  {' · '}
                                  {Array.isArray(rule.steps) && rule.steps.length > 0
                                    ? (fr
                                      // « 1 étapes » (QA 2026-09-25, P2-11).
                                      ? `${rule.steps.length} étape${rule.steps.length > 1 ? 's' : ''}`
                                      : `${rule.steps.length} step${rule.steps.length > 1 ? 's' : ''}`)
                                    : formatDelay(rule.delay_seconds, language)}
                                </span>
                                {avisOk === false && rule.is_active && !rule.deleted_at && demandeUnAvis(rule) && (
                                  <span className="mt-0.5 inline-flex items-start gap-1 text-[11px] text-amber-700 dark:text-amber-400">
                                    <AlertTriangle size={11} className="mt-px shrink-0" aria-hidden="true" />
                                    {fr
                                      ? 'Les demandes d’avis sont désactivées : rien ne part. Activez-les dans Paramètres › Avis clients.'
                                      : 'Review requests are turned off: nothing goes out. Turn them on in Settings › Customer reviews.'}
                                  </span>
                                )}
                                {rule.modele_id && (
                                  <span className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-text-tertiary" title={fr ? 'Suit l’automatisation d’un autre bureau ; la modifier ici la détache.' : 'Follows an automation from another office; editing it here detaches it.'}>
                                    <Link2 size={11} aria-hidden="true" />
                                    {fr ? 'Copie liée à un autre bureau' : 'Linked copy from another office'}
                                  </span>
                                )}
                                {echecs > 0 && (
                                  <span className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-danger">
                                    <AlertTriangle size={11} aria-hidden="true" />
                                    {echecs} {fr ? 'échec(s) dans les 7 derniers jours' : 'failure(s) in the last 7 days'}
                                  </span>
                                )}
                              </span>
                            </button>
                          </td>

                          <td className="px-3 py-3">
                            <span className={cn(
                              'inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium',
                              rule.deleted_at ? 'bg-surface-tertiary text-text-tertiary'
                                : rule.is_active && toutEnPause ? 'bg-danger-light text-danger'
                                : rule.is_active ? 'bg-success-light text-success'
                                : 'bg-surface-tertiary text-text-tertiary',
                            )}>
                              {rule.deleted_at ? (fr ? 'Supprimée' : 'Deleted')
                                // Publiée, mais rien ne part tant que la pause dure.
                                : rule.is_active && toutEnPause ? (fr ? 'Publiée · en pause' : 'Published · paused')
                                : rule.is_active ? (fr ? 'Publiée' : 'Published')
                                : (fr ? 'Brouillon' : 'Draft')}
                            </span>
                          </td>

                          {/* Total déclenché / En cours : les chiffres arrivent avec
                              l'onglet Historique (les données sont déjà en base). */}
                          <td className="px-3 py-3 text-primary">—</td>
                          <td className="px-3 py-3 text-primary">—</td>

                          <td className="hidden px-3 py-3 text-text-secondary lg:table-cell">{dateCourte(rule.updated_at)}</td>
                          <td className="hidden px-3 py-3 text-text-secondary lg:table-cell">{dateCourte(rule.created_at)}</td>

                          <td className="px-3 py-3">
                            <button
                              type="button"
                              onClick={() => setStatsId((s) => (s === rule.id ? null : rule.id))}
                              aria-expanded={statsId === rule.id}
                              aria-label={fr ? `Statistiques de ${localizeAutomationName(rule.name, language)}` : `Stats for ${localizeAutomationName(rule.name, language)}`}
                              className="rounded-md p-1 text-text-tertiary transition-colors hover:bg-surface-tertiary hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                            >
                              <ChevronRight
                                size={15}
                                className={cn('transition-transform', statsId === rule.id && 'rotate-90')}
                                aria-hidden="true"
                              />
                            </button>
                          </td>

                          <td className="px-3 py-3">
                            <div className="flex items-center justify-end gap-0.5">
                              <button
                                type="button"
                                onClick={() => handleToggle(rule)}
                                /*
                                 * Une règle à la corbeille ne se déclenche plus :
                                 * le moteur la filtre. Un interrupteur qui
                                 * s'allume sans rien changer mentirait.
                                 */
                                disabled={togglingId === rule.id || !!rule.deleted_at}
                                aria-label={rule.is_active
                                  ? (fr ? `Repasser ${rule.name} en brouillon` : `Unpublish ${rule.name}`)
                                  : (fr ? `Publier ${rule.name}` : `Publish ${rule.name}`)}
                                aria-pressed={rule.is_active}
                                className="rounded-md p-1 transition-colors hover:bg-surface-tertiary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                              >
                                {togglingId === rule.id
                                  ? <Loader2 size={17} className="animate-spin text-text-tertiary" aria-hidden="true" />
                                  : rule.is_active
                                    ? <ToggleRight size={19} className="text-text-primary" aria-hidden="true" />
                                    : <ToggleLeft size={19} className="text-text-tertiary" aria-hidden="true" />}
                              </button>

                              <button
                                type="button"
                                onClick={() => setDeplieId((d) => (d === rule.id ? null : rule.id))}
                                aria-expanded={deplieId === rule.id}
                                aria-label={fr ? `Voir les messages de ${localizeAutomationName(rule.name, language)}` : `View messages of ${localizeAutomationName(rule.name, language)}`}
                                className="rounded-md p-1.5 text-text-tertiary transition-colors hover:bg-surface-tertiary hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                              >
                                <ChevronDown
                                  size={14}
                                  className={cn('transition-transform', deplieId === rule.id && 'rotate-180')}
                                  aria-hidden="true"
                                />
                              </button>

                              <div className="relative">
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); setMenuLigne((m) => (m === rule.id ? null : rule.id)); }}
                                  aria-haspopup="menu"
                                  aria-expanded={menuLigne === rule.id}
                                  aria-label={fr ? `Actions pour ${localizeAutomationName(rule.name, language)}` : `Actions for ${localizeAutomationName(rule.name, language)}`}
                                  className="rounded-md p-1.5 text-text-tertiary transition-colors hover:bg-surface-tertiary hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                                >
                                  {occupeId === rule.id
                                    ? <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                                    : <EllipsisVertical size={14} aria-hidden="true" />}
                                </button>

                                {menuLigne === rule.id && (
                                  <div
                                    role="menu"
                                    tabIndex={-1}
                                    onClick={(e) => e.stopPropagation()}
                                    className="absolute right-0 z-30 mt-1 w-[210px] overflow-hidden rounded-xl border border-border bg-surface-card p-1.5 shadow-lg"
                                  >
                                    {/*
                                      À la corbeille, une seule action a du sens.
                                      Modifier, dupliquer ou ranger une règle
                                      supprimée n'aurait aucun effet visible :
                                      mieux vaut ne pas l'offrir.
                                    */}
                                    {rule.deleted_at ? (
                                      <button
                                        type="button"
                                        role="menuitem"
                                        onClick={() => { setMenuLigne(null); void restaurer(rule); }}
                                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-text-primary transition-colors hover:bg-surface-tertiary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                                      >
                                        <RotateCcw size={13} aria-hidden="true" />
                                        {fr ? 'Restaurer' : 'Restore'}
                                      </button>
                                    ) : (
                                    <>
                                    <button
                                      type="button"
                                      role="menuitem"
                                      onClick={() => { setMenuLigne(null); navigate(`/automations/${rule.id}`); }}
                                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-text-primary transition-colors hover:bg-surface-tertiary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                                    >
                                      <Pencil size={13} aria-hidden="true" />
                                      {fr ? 'Modifier' : 'Edit'}
                                    </button>
                                    <button
                                      type="button"
                                      role="menuitem"
                                      onClick={() => { setMenuLigne(null); dupliquer(rule, rule.is_preset); }}
                                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-text-primary transition-colors hover:bg-surface-tertiary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                                    >
                                      <Copy size={13} aria-hidden="true" />
                                      {fr ? 'Dupliquer' : 'Duplicate'}
                                    </button>
                                    {bureauxCibles.length > 0 && (
                                      <button
                                        type="button"
                                        role="menuitem"
                                        onClick={() => { setMenuLigne(null); setCopieVers(rule); }}
                                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-text-primary transition-colors hover:bg-surface-tertiary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                                      >
                                        <Building2 size={13} aria-hidden="true" />
                                        {fr ? 'Copier vers d’autres bureaux' : 'Copy to other offices'}
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      role="menuitem"
                                      onClick={() => {
                                        // Sans dossier, créer d'abord : proposer
                                        // « déplacer vers rien » n'aurait aucun sens.
                                        if (dossiers.length === 0) {
                                          setMenuLigne(null);
                                          setSaisieDossier(true);
                                          toast.info(fr ? 'Créez d’abord un dossier.' : 'Create a folder first.');
                                          return;
                                        }
                                        setSousMenuDossier(rule.id);
                                      }}
                                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-text-primary transition-colors hover:bg-surface-tertiary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                                    >
                                      <FolderPlus size={13} aria-hidden="true" />
                                      {fr ? 'Déplacer dans un dossier' : 'Move to folder'}
                                    </button>
                                    {/* Les dossiers, en sous-liste. « Racine »
                                        n'apparaît que si la règle est rangée
                                        quelque part — sinon l'option ne ferait
                                        rien. */}
                                    {sousMenuDossier === rule.id && (
                                      <div className="ml-4 border-l border-border pl-2">
                                        {rule.folder_id && (
                                          <button
                                            type="button"
                                            role="menuitem"
                                            onClick={() => { setSousMenuDossier(null); void deplacerVers(rule.id, null); }}
                                            className="block w-full rounded-lg px-2.5 py-1.5 text-left text-[12px] text-text-secondary transition-colors hover:bg-surface-tertiary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                                          >
                                            {fr ? '↑ Remettre à la racine' : '↑ Move back to root'}
                                          </button>
                                        )}
                                        {dossiers.filter((d) => d.id !== rule.folder_id).map((d) => (
                                          <button
                                            key={d.id}
                                            type="button"
                                            role="menuitem"
                                            onClick={() => { setSousMenuDossier(null); void deplacerVers(rule.id, d.id); }}
                                            className="block w-full truncate rounded-lg px-2.5 py-1.5 text-left text-[12px] text-text-primary transition-colors hover:bg-surface-tertiary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                                          >
                                            {d.name}
                                          </button>
                                        ))}
                                      </div>
                                    )}
                                    {!rule.is_preset && (
                                      <button
                                        type="button"
                                        role="menuitem"
                                        onClick={() => { setMenuLigne(null); supprimer(rule); }}
                                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-danger transition-colors hover:bg-surface-tertiary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                                      >
                                        <Trash2 size={13} aria-hidden="true" />
                                        {fr ? 'Supprimer' : 'Delete'}
                                      </button>
                                    )}
                                    </>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>

                        {/* Panneau de statistiques, ouvert par le chevron « › ». */}
                        {statsId === rule.id && (
                          <tr className="bg-surface-secondary/30">
                            <td colSpan={9} className="px-6 py-4">
                              <p className="text-[12px] text-text-secondary">
                                {echecs > 0
                                  ? (fr
                                    ? `${echecs} envoi(s) ont échoué ces 7 derniers jours. Le détail arrivera dans l’onglet « Journaux » de l’automatisation.`
                                    : `${echecs} send(s) failed in the last 7 days. Details will appear in the automation’s “Logs” tab.`)
                                  : (fr
                                    ? 'Aucun échec ces 7 derniers jours. Les chiffres d’envoi arrivent avec l’onglet « Historique ».'
                                    : 'No failures in the last 7 days. Send counts are coming with the “History” tab.')}
                              </p>
                            </td>
                          </tr>
                        )}

                        {/* Les messages, modifiables sur place. */}
                        {deplieId === rule.id && (
                          <tr className="bg-surface-secondary/30">
                            <td colSpan={9} className="px-6 py-4">
                              {Array.isArray(rule.steps) && rule.steps.length > 0 ? (
                                /*
                                 * UNE AUTOMATISATION BÂTIE DANS L'ÉDITEUR : on montre SON parcours.
                                 *
                                 * Créée de zéro, une règle reçoit une action de remplissage
                                 * « À compléter » dans l'ancien format (`actions`). On bâtit
                                 * ensuite le vrai parcours (`steps`) — mais la liste lisait
                                 * toujours l'ancien, et affichait ce texto fantôme pour une
                                 * automatisation qui n'envoie qu'un courriel. QA du 2026-09-25
                                 * (P2-2).
                                 *
                                 * LECTURE SEULE, et c'est voulu : l'édition depuis la liste
                                 * écrit dans `actions`, que le moteur IGNORE dès qu'un parcours
                                 * existe. Une modification faite ici ne partirait jamais.
                                 */
                                (() => {
                                  const envois = (rule.steps as Array<{ type?: string; action?: { type?: string; config?: Record<string, unknown> } }>)
                                    .filter((e) => e.type === 'action' && (e.action?.type === 'send_sms' || e.action?.type === 'send_email'));
                                  return (
                                    <div className="space-y-2">
                                      {envois.length === 0 ? (
                                        <p className="text-[12px] text-text-tertiary">
                                          {fr ? 'Ce parcours n’envoie ni texto ni courriel.' : 'This journey sends neither text nor email.'}
                                        </p>
                                      ) : envois.map((e, i) => (
                                        <div key={`${rule.id}-apercu-${i}`} className="rounded-md border border-outline/40 bg-surface px-3 py-2">
                                          <p className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
                                            {e.action?.type === 'send_email'
                                              ? (fr ? 'Courriel envoyé au client' : 'Email sent to client')
                                              : (fr ? 'Texto envoyé au client' : 'Text sent to client')}
                                          </p>
                                          {e.action?.type === 'send_email' && e.action.config?.subject ? (
                                            <p className="mt-1 text-[12px] font-medium text-text-primary">{String(e.action.config.subject)}</p>
                                          ) : null}
                                          <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-[12px] text-text-secondary">
                                            {String(e.action?.config?.body ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
                                              || (fr ? '(vide)' : '(empty)')}
                                          </p>
                                        </div>
                                      ))}
                                      <button
                                        type="button"
                                        onClick={() => navigate(`/automations/${rule.id}`)}
                                        className="text-[12px] font-medium text-accent hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                                      >
                                        {fr ? 'Modifier dans l’éditeur' : 'Edit in the editor'}
                                      </button>
                                    </div>
                                  );
                                })()
                              ) : rule.actions.filter((a) => a.type === 'send_sms' || a.type === 'send_email').length === 0 ? (
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

            {/* ══ 7. Pagination ══ */}
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-outline/30 px-4 py-3 text-[12px]">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="rounded-lg px-2.5 py-1 text-text-secondary transition-colors hover:bg-surface-tertiary disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                {fr ? 'Précédent' : 'Previous'}
              </button>
              <span className="rounded-lg border border-primary px-2.5 py-1 font-medium text-primary">{page}</span>
              <span className="text-text-tertiary">{fr ? `sur ${pages}` : `of ${pages}`}</span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(pages, p + 1))}
                disabled={page >= pages}
                className="rounded-lg px-2.5 py-1 text-text-secondary transition-colors hover:bg-surface-tertiary disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                {fr ? 'Suivant' : 'Next'}
              </button>
              <label htmlFor="par-page" className="sr-only">{fr ? 'Lignes par page' : 'Rows per page'}</label>
              <select
                id="par-page"
                value={parPage}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  setParPage(n);
                  setPage(1);
                  // Retenu pour les prochaines visites. Le stockage peut être
                  // indisponible (mode privé, cookies bloqués) : ça ne doit
                  // jamais empêcher de changer la pagination.
                  try { localStorage.setItem('lume-automations-par-page', String(n)); } catch { /* préférence perdue, sans conséquence */ }
                }}
                className="glass-input ml-1 py-1 text-[12px]"
              >
                {[10, 25, 50].map((n) => (
                  <option key={n} value={n}>{fr ? `${n} / page` : `${n} / page`}</option>
                ))}
              </select>
            </div>
          </div>
        )}
      </div>
      {copieVers && (
        <CopierVersBureauxModal
          ruleId={copieVers.id}
          ruleName={localizeAutomationName(copieVers.name, language)}
          bureaux={bureauxCibles}
          fr={fr}
          onClose={() => setCopieVers(null)}
          onFini={() => { void load(); }}
        />
      )}
    </PermissionGate>
  );
}
