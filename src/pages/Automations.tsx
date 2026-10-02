/* ═══════════════════════════════════════════════════════════════
   Page — Automations

   Shows ALL automation rules (from automation_rules table) in a
   single unified view, organized by functional category.
   Default presets are seeded via DB migration — the page only
   reads, never auto-seeds.

   Categories: Leads, Quotes, Jobs/Scheduling, Invoices,
   Payments, Follow-up, Reviews, Client
   ═══════════════════════════════════════════════════════════════ */

import React, { useState, useEffect, useCallback, useRef, useId } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Zap, Clock, Mail, Bell, FileText, CalendarClock, MessageSquare,
  ToggleLeft, ToggleRight, Loader2, Send, UserPlus, AlertTriangle,
  Heart, Star, Sun, UserX, CreditCard, Banknote, Search,
  CheckCircle, Shield, Sparkles, ChevronDown, ChevronRight,
  Users, Briefcase, ReceiptText, ThumbsUp, ArrowLeft, FileSignature,
  Plus, Pencil, Copy, Trash2, RotateCcw, X, EllipsisVertical,
  FolderPlus, Filter, Building2, Link2, Eye, Trophy, ArrowUp, ArrowDown, } from 'lucide-react';
import { cn } from '../lib/utils';
import { localizeAutomationName } from '../lib/automationNames';
import { trouverDeclencheur } from '../lib/automationCatalogue';
import { remplacerVariables } from '../lib/emailBodyText';
import { raisonEchecListe as raisonLisible } from '../lib/automationJournauxApi';
import { chargerStatistiquesBureau, lirePeriodeChoisie, retenirPeriode, type StatsRegle } from '../lib/automationStatsApi';
import { PERIODES_JOURS, libelleGroupe, libelleIssue, libellePeriode, type PeriodeJours } from '../lib/automationIssues';
import type { GroupeMotif } from '../lib/automationMotifs';
import { useRafraichissementVisible } from '../hooks/useRafraichissementVisible';
import { useTranslation } from '../i18n';
import { toast } from 'sonner';
import PermissionGate from '../components/PermissionGate';
import { usePermissions } from '../hooks/usePermissions';
import { hasPermission } from '../lib/permissions';
import BandeauPause from '../components/automations/BandeauPause';
import SousNavigation from '../components/automations/SousNavigation';
import BibliothequeModeles from '../components/automations/BibliothequeModeles';
import MessageEditor from '../components/automations/MessageEditor';
import InterrupteurPublication from '../components/automations/InterrupteurPublication';
import CopierVersBureauxModal from '../components/automations/CopierVersBureauxModal';
import {
  dupliquerAutomatisation,
  supprimerAutomatisation,
  restaurerAutomatisation,
  supprimerDefinitivementAutomatisation,
  chargerDossiers,
  creerDossier,
  supprimerDossier,
  rangerDansDossier,
  chargerBureauxCibles,
  renommerDossier,
  changerPublication,
  changerPublicationEnLot,
  type BureauCible,
  type DossierAutomatisation,
} from '../lib/automationBuilderApi';
import { confirmer } from '../components/ui/ConfirmDialog';
import { textesDExemple } from '../lib/publicationAutomatisation';
import { apercuClientsInactifs } from '../lib/reservationApi';
import { creerFileBascule } from '../lib/fileBascule';
import {
  type AutomationRule,
  getAutomationRules,
  getAutomationLanguage,
  setAutomationLanguage,
  avisActives,
} from '../lib/automationRulesApi';

// ── Automation name translations (for DB-seeded English names) ──
// Couvre toutes les variantes de noms semées par les migrations
// (default_workflow_presets, advanced_automation_presets, dedup, activate_all).

// La cause d'un échec en clair : `raisonEchecListe` (src/lib/automationJournauxApi), à côté de la
// traduction de l'onglet Journaux — un même test vérifie que les deux connaissent tous les messages du moteur.

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
    labelFr: 'Devis',
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
  quote_opened_notify:      { icon: Eye,            category: 'Quotes' },
  quote_opened_move_deal:   { icon: Eye,            category: 'Quotes' },
  quote_sent_move_deal:     { icon: Send,           category: 'Quotes' },
  quote_approved_move_deal: { icon: Trophy,         category: 'Quotes' },
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
  'client.untagged':       { en: 'Tag removed',           fr: 'Étiquette retirée' },
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
  'quote.viewed':          { en: 'Quote opened by client', fr: 'Devis ouvert par le client' },
  'invoice.viewed':        { en: 'Invoice viewed by client', fr: 'Facture consultée par le client' },
  'payment.failed':        { en: 'Payment failed',        fr: 'Paiement échoué' },
  'client.inactive':       { en: 'Inactive client',       fr: 'Client inactif' },
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

/** Les colonnes triables de la liste (A-17). */
type CleTri = 'nom' | 'statut' | 'declenches' | 'en_cours' | 'modifiee' | 'creee';

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
/**
 * LE CLAVIER D'UN MENU (`role="menu"`) — « Créer » et le « ⋮ » d'une ligne.
 *
 * Le menu « ⋮ » est dessiné dans un portail en fin de page (il était coupé par le tableau) : ses
 * entrées ne suivaient plus son bouton dans l'ordre de tabulation, et Tab traversait toute la page
 * avant d'y arriver (triage `11-clavier:178`). À l'ouverture le focus ENTRE dans le menu ; ici,
 * les flèches, Début / Fin et Tab circulent entre ses entrées. En sortir (Tab après la dernière,
 * Maj+Tab avant la première) le REFERME et rend le focus au bouton — un menu ne reste jamais
 * ouvert derrière (`11-clavier:209`). Échap est géré au niveau du document.
 */
function clavierDeMenu(e: React.KeyboardEvent<HTMLElement>, fermer: () => void, ouvreur: HTMLElement | null) {
  const entrees = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])'));
  if (entrees.length === 0) return;
  // -1 : le focus est sur le menu lui-même (il vient de s'ouvrir).
  const i = entrees.indexOf(document.activeElement as HTMLElement);
  const aller = (j: number) => { e.preventDefault(); entrees[j]?.focus(); };
  switch (e.key) {
    case 'ArrowDown': aller(i < 0 ? 0 : (i + 1) % entrees.length); return;
    case 'ArrowUp': aller(i <= 0 ? entrees.length - 1 : i - 1); return;
    case 'Home': aller(0); return;
    case 'End': aller(entrees.length - 1); return;
    case 'Tab': {
      const j = e.shiftKey ? i - 1 : i + 1;
      if (j >= 0 && j < entrees.length && !(e.shiftKey && i < 0)) { aller(j); return; }
      fermer();
      ouvreur?.focus({ preventScroll: true });
      // Tab : le navigateur poursuit depuis le bouton, vers ce qui le suit. Maj+Tab : on reste sur le bouton.
      if (e.shiftKey) e.preventDefault();
      return;
    }
    default:
  }
}

/**
 * Le nom d'une ligne : un bouton qui ouvre l'éditeur — ou, pour un rôle qui ne peut que VOIR,
 * le même contenu sans rien de cliquable (l'éditeur exige le droit de modifier).
 */
function NomDeLigne({ ouvrir, children }: { ouvrir: (() => void) | null; children: React.ReactNode }) {
  if (!ouvrir) return <div className="flex items-start gap-2.5 text-left">{children}</div>;
  return (
    <button
      type="button"
      onClick={ouvrir}
      className="flex items-start gap-2.5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      {children}
    </button>
  );
}

/**
 * Un message tel que le client le lira, en LECTURE SEULE : variables remplacées par un exemple
 * (« Jean » plutôt que « [client_first_name] »), comme dans l'éditeur.
 */
function ApercuMessage({ type, sujet, corps, fr }: { type: 'send_sms' | 'send_email'; sujet?: string; corps: string; fr: boolean }) {
  return (
    <div className="rounded-md border border-outline/40 bg-surface px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
        {type === 'send_email'
          ? (fr ? 'Courriel envoyé au client' : 'Email sent to client')
          : (fr ? 'Texto envoyé au client' : 'Text sent to client')}
      </p>
      {type === 'send_email' && sujet ? (
        <p className="mt-1 text-[12px] font-medium text-text-primary">{remplacerVariables(sujet)}</p>
      ) : null}
      <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-[12px] text-text-secondary">
        {remplacerVariables(corps.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()) || (fr ? '(vide)' : '(empty)')}
      </p>
    </div>
  );
}

export default function Automations() {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const navigate = useNavigate();

  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [loading, setLoading] = useState(true);
  /*
   * Échec de chargement ≠ liste vide. L'échec ne laissait qu'un toast
   * éphémère, puis le tableau affichait « Aucune automatisation » : on
   * croyait ses automatisations supprimées alors qu'elles tournaient.
   */
  const [echecChargement, setEchecChargement] = useState(false);
  /*
   * VOIR sans MODIFIER (triage de la liste, `12-permissions:86` et `:102`).
   *
   * Le menu et la route demandent « voir les automatisations » ; la page exigeait « modifier » :
   * on montrait la porte, puis « Accès restreint ». Qui a le droit de voir VOIT la liste, ses
   * chiffres, ses messages — sans aucun geste d'écriture : ils sont retirés, ou grisés avec la
   * raison. Le serveur, lui, refuse déjà toute écriture à ce rôle.
   */
  const acces = usePermissions();
  // Droits pas encore lus : rien n'est grisé (la garde de la page n'affiche de toute façon rien d'ici là).
  const peutModifier = acces.loading || acces.role === 'owner' || hasPermission(acces.permissions, 'automations.update', acces.role ?? undefined);
  const raisonLectureSeule = fr
    ? 'Votre rôle permet de voir les automatisations, pas de les modifier.'
    : 'Your role can view automations, not change them.';
  /*
   * Interrupteur Brouillon / Publiée martelé (Rafba, 2026-09-28) : l'écran
   * suit le dernier clic, le serveur reçoit les changements un à la fois
   * (voir fileBascule.ts). `restentAffichees` : une ligne basculée RESTE à
   * sa place tant qu'on ne change pas d'onglet ou de filtre — sinon un
   * modèle passé en brouillon partait dans « Modèles », la ligne du dessous
   * remontait sous la souris et le clic suivant basculait une AUTRE
   * automatisation.
   */
  const [restentAffichees, setRestentAffichees] = useState<Set<string>>(() => new Set());
  const [, setVersionBascule] = useState(0);
  const frRef = useRef(fr);
  useEffect(() => { frRef.current = fr; }, [fr]);
  const confirmationOuverte = useRef(false);
  const [fileBascule] = useState(() => creerFileBascule({
    // La route serveur de publication (M8) : un parcours cassé est refusé,
    // avec la liste de ses problèmes dans le message.
    envoyer: changerPublication,
    surFin: (id, actif) => {
      setRules((prev) => prev.map((r) => (r.id === id ? { ...r, is_active: actif } : r)));
      setVersionBascule((v) => v + 1);
      // Un seul toast par automatisation, remplacé à chaque fin : pas une pile.
      toast.success(actif
        ? (frRef.current ? 'Automatisation publiée' : 'Automation published')
        : (frRef.current ? 'Repassée en brouillon' : 'Back to draft'), { id: `bascule-${id}` });
    },
    surEchec: (id, retour, erreur) => {
      console.error('[Automations] bascule publication', erreur);
      setRules((prev) => prev.map((r) => (r.id === id ? { ...r, is_active: retour } : r)));
      setVersionBascule((v) => v + 1);
      // Le message du serveur NOMME ce qui empêche de publier : c'est lui
      // qu'on montre, pas un « impossible » qui n'aide personne.
      toast.error(erreur instanceof Error && erreur.message
        ? erreur.message
        : (frRef.current ? 'Impossible de mettre à jour' : 'Could not update'), { id: `bascule-${id}`, duration: 10_000 });
    },
  }));
  const [search, setSearch] = useState('');
  /** La période des chiffres (7, 30 ou 90 jours) : choisie à l'écran, retenue d'une visite à l'autre. */
  const [periode, setPeriode] = useState<PeriodeJours>(() => lirePeriodeChoisie());
  /**
   * Les chiffres réels par automatisation sur la période — déclenchées, en cours, échecs,
   * ignorées, comptés EN BASE par une seule route. `null` = pas (encore) lus.
   */
  const [stats, setStats] = useState<Record<string, StatsRegle> | null>(null);
  /**
   * La lecture des chiffres a ÉCHOUÉ : on le dit (constat D-17). Avant, des échecs illisibles
   * laissaient « À vérifier (0) » à l'écran, comme si tout allait bien.
   */
  const [statsIllisibles, setStatsIllisibles] = useState(false);
  /** Le bureau a-t-il un numéro texto ? `false` = bandeau ; `null` = inconnu, rien. */
  const [textoConfigure, setTextoConfigure] = useState<boolean | null>(null);
  const [occupeId, setOccupeId] = useState<string | null>(null);
  /**
   * La langue des messages du bureau — `null` tant qu'on ne la CONNAÎT pas.
   *
   * Elle valait « fr » d'office : lecture en panne sur un bureau réglé en
   * anglais, l'écran surlignait « FR » et affirmait que les messages partaient
   * en français (audit du 2026-10-01). Inconnue, on ne surligne rien.
   */
  const [orgLang, setOrgLang] = useState<'fr' | 'en' | null>(null);
  /** La lecture a échoué : on le dit à côté de la bascule. */
  const [langueIllisible, setLangueIllisible] = useState(false);
  const [savingLang, setSavingLang] = useState(false);

  /**
   * Onglet de la liste — les quatre de GHL. `?onglet=verifier` l'ouvre
   * directement : c'est là que mène « Voir les automatisations à vérifier »
   * de la Vue d'ensemble, qui atterrissait sur « Toutes » (audit V2, A-14).
   */
  const [parametres] = useSearchParams();
  const [onglet, setOnglet] = useState<'toutes' | 'verifier' | 'corbeille' | 'modeles'>(() => {
    const demande = parametres.get('onglet');
    return demande === 'verifier' || demande === 'corbeille' || demande === 'modeles' ? demande : 'toutes';
  });
  /** Relie les onglets à leur panneau (`aria-controls` / `aria-labelledby`). */
  const idOnglets = useId();
  /** Menu « Créer » : les cinq départs de GHL. */
  const [menuCreer, setMenuCreer] = useState(false);
  const [bibliotheque, setBibliotheque] = useState(false);
  /** Le focus revient ici à la fermeture de la bibliothèque (l'entrée du menu n'existe plus). */
  const boutonCreer = useRef<HTMLButtonElement>(null);
  /** Menu « … » ouvert sur quelle ligne ? */
  const [menuLigne, setMenuLigne] = useState<string | null>(null);
  /**
   * Où dessiner le menu « ⋮ » d'une ligne, en coordonnées de la FENÊTRE.
   *
   * Le menu était en `absolute` dans la carte du tableau, qui est en
   * `overflow-hidden` (et son conteneur en `overflow-x-auto`, donc coupé aussi
   * en hauteur) : sur les dernières lignes, ou dans une liste de 1 à 3 lignes,
   * on n'en voyait qu'un liseré (audit du 2026-10-01). Il est maintenant rendu
   * dans `document.body`, ancré au bouton, et s'ouvre VERS LE HAUT quand la
   * place manque en bas.
   */
  const [posMenuLigne, setPosMenuLigne] = useState<{ top?: number; bottom?: number; right: number } | null>(null);
  /** Le menu ouvert (« Créer » ou « ⋮ » : un seul à la fois) et le bouton qui l'a ouvert. */
  const refMenu = useRef<HTMLDivElement | null>(null);
  const ouvreurMenu = useRef<HTMLElement | null>(null);
  const fermerMenus = () => { setMenuCreer(false); setMenuLigne(null); setSousMenuDossier(null); };
  useEffect(() => {
    // À l'ouverture, le focus ENTRE dans le menu : Tab et les flèches partent de là.
    if (menuCreer || menuLigne) { refMenu.current?.focus({ preventScroll: true }); return; }
    // Refermé par le choix d'une entrée : elle a disparu avec lui, le focus retombait sur le corps de la page.
    const actif = document.activeElement;
    if ((!actif || actif === document.body) && ouvreurMenu.current?.isConnected) ouvreurMenu.current.focus({ preventScroll: true });
  }, [menuCreer, menuLigne]);

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
  /** Tri par date de création (Rafba, 2026-09-30) ; « defaut » = l'ordre d'avant. */
  const [triDate, setTriDate] = useState<'defaut' | 'recent' | 'ancien'>('defaut');
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
  /**
   * Tri par colonne (audit V2, A-17) : les en-têtes n'étaient pas
   * cliquables. `null` = l'ordre des noms affichés, ou celui choisi dans
   * « Trier » des filtres avancés ; un clic sur un en-tête l'emporte.
   * Recliquer inverse.
   */
  const [tri, setTri] = useState<{ cle: CleTri; sens: 'asc' | 'desc' } | null>(null);
  const trierPar = (cle: CleTri) => setTri((t) => (t && t.cle === cle
    ? { cle, sens: t.sens === 'asc' ? 'desc' : 'asc' }
    : { cle, sens: 'asc' }));

  useEffect(() => {
    getAutomationLanguage()
      .then(setOrgLang)
      .catch((e: unknown) => {
        console.error('[automations] langue des messages illisible', e);
        setLangueIllisible(true);
      });
  }, []);

  const changerLangue = async (lang: 'fr' | 'en') => {
    if (lang === orgLang || savingLang) return;
    setSavingLang(true);
    const avant = orgLang;
    setOrgLang(lang);
    try {
      await setAutomationLanguage(lang);
      // Enregistrée : elle est maintenant connue, même si la lecture avait échoué.
      setLangueIllisible(false);
      toast.success(fr
        ? (lang === 'en' ? 'Messages en anglais' : 'Messages en français')
        : (lang === 'en' ? 'Messages set to English' : 'Messages set to French'));
    } catch (e: unknown) {
      setOrgLang(avant);
      // La RAISON (« seul un administrateur… »), pas un « impossible » muet.
      console.error('[automations] langue des messages', e);
      toast.error(e instanceof Error && e.message
        ? e.message
        : (fr ? 'Impossible de changer la langue' : 'Could not change language'));
    } finally {
      setSavingLang(false);
    }
  };

  /*
   * Deux chargements qui se croisent (une action, puis une autre avant la
   * réponse) : seul le DERNIER a le droit d'écrire l'écran — une réponse
   * plus ancienne arrivée après ramenait une liste périmée (launch 2026-09-28).
   */
  const dernierChargement = useRef(0);
  /*
   * Les chiffres de la liste. Avant, les échecs étaient lus à part, depuis le navigateur, sur
   * les 200 lignes les plus récentes du bureau : au-delà, les pastilles étaient fausses et des
   * automatisations en échec manquaient dans « À vérifier » (constat D-02).
   * Seule la dernière lecture écrit l'écran (un changement de période pendant une lecture).
   */
  const derniersChiffres = useRef(0);
  const periodeCourante = useRef(periode);
  periodeCourante.current = periode;
  const lireChiffres = useRef(async (jours?: PeriodeJours): Promise<void> => {
    const numero = ++derniersChiffres.current;
    try {
      const s = await chargerStatistiquesBureau(jours ?? periodeCourante.current);
      if (numero !== derniersChiffres.current) return;
      setStats(s.par_regle);
      setStatsIllisibles(false);
      setTextoConfigure(s.texto_configure ?? null);
    } catch (e: unknown) {
      if (numero !== derniersChiffres.current) return;
      console.error('[automations] statistiques illisibles', e instanceof Error ? e.message : String(e));
      setStats(null);
      setStatsIllisibles(true);
    }
  });
  const changerPeriode = (jours: PeriodeJours) => {
    retenirPeriode(jours);
    setPeriode(jours);
    void lireChiffres.current(jours);
  };
  // Une exécution arrivée pendant que la liste est ouverte y apparaît sans recharger la page
  // (constat D-18) : au retour sur l'onglet, et toutes les 30 secondes tant qu'il est visible.
  useRafraichissementVisible(() => { void lireChiffres.current(); });

  const load = useCallback(async () => {
    const numero = ++dernierChargement.current;
    const perime = () => numero !== dernierChargement.current;
    setLoading(true);
    try {
      const data = await getAutomationRules();
      if (perime()) return;
      setEchecChargement(false);
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
      // Une bascule encore en vol garde l'état du dernier clic.
      }).map((r) => ({ ...r, is_active: fileBascule.etatAffiche(r.id, r.is_active) })));
      // « Déclenchées », « En cours », les échecs et le détail › : UNE route, comptée en base.
      // On ne l'ATTEND pas (triage `03-onglets-etats:143`) : la liste s'affiche dès qu'elle est lue,
      // les chiffres arrivent ensuite dans leurs colonnes (« … » d'ici là).
      void lireChiffres.current();
    } catch (e: any) {
      if (perime()) return;
      console.error('Failed to load rules:', e.message);
      setEchecChargement(true);
      toast.error(fr ? 'Impossible de charger les automatisations' : 'Failed to load automations');
    } finally {
      if (!perime()) setLoading(false);
    }
  }, [fr]);

  /*
   * Double Entrée / double clic sur « Créer » : la 2e requête arrivait sur un
   * nom déjà pris et affichait « Un dossier porte déjà ce nom » à côté du
   * succès (audit V2, A-10). Une création à la fois.
   */
  const creationDossierEnVol = useRef(false);
  const validerNouveauDossier = async () => {
    const nom = nomDossier.trim();
    if (!nom) { setSaisieDossier(false); return; }
    if (creationDossierEnVol.current) return;
    creationDossierEnVol.current = true;
    try {
      const d = await creerDossier(nom);
      setDossiers((prev) => [...prev, d].sort((a, b) => a.name.localeCompare(b.name)));
      setNomDossier('');
      setSaisieDossier(false);
      toast.success(fr ? `Dossier « ${d.name} » créé` : `Folder “${d.name}” created`);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      creationDossierEnVol.current = false;
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

  /*
   * PERF-1 (audit V2) : la liste relisait ICI toutes les règles une deuxième
   * fois (`/api/automations/rules`, 316 ko à 400 règles) pour un catalogue
   * qu'elle ne lisait jamais. Les libellés viennent du catalogue embarqué
   * (`automationCatalogue.ts`) : une seule lecture des règles suffit.
   */

  /*
   * Fermer les menus au clic ailleurs — et à la touche Échap.
   *
   * Échap ne fermait rien (audit du 2026-10-01, vu sur lumecrm.net) : au
   * clavier, le menu « ⋮ » d'une ligne restait ouvert jusqu'à ce qu'on
   * clique ailleurs. Le focus revient au bouton qui a ouvert le menu, sinon
   * il se perd en haut de page.
   */
  useEffect(() => {
    if (!menuCreer && !menuLigne) return;
    const fermer = () => { setMenuCreer(false); setMenuLigne(null); setSousMenuDossier(null); };
    const auClavier = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const ouvreur = menuCreer
        ? boutonCreer.current
        : document.querySelector<HTMLElement>('button[aria-haspopup="menu"][aria-expanded="true"]');
      fermer();
      ouvreur?.focus();
    };
    document.addEventListener('click', fermer);
    document.addEventListener('keydown', auClavier);
    // Le menu d'une ligne est ancré à la fenêtre : il ne suivrait pas un
    // défilement ou un redimensionnement. On le ferme plutôt que de le laisser flotter.
    // (Un défilement DANS le menu — le focus qui avance dans une longue liste de dossiers — ne compte pas.)
    const auDefilement = (e: Event) => {
      if (e.target instanceof Node && refMenu.current?.contains(e.target)) return;
      if (menuLigne) fermer();
    };
    window.addEventListener('scroll', auDefilement, true);
    window.addEventListener('resize', auDefilement);
    return () => {
      document.removeEventListener('click', fermer);
      document.removeEventListener('keydown', auClavier);
      window.removeEventListener('scroll', auDefilement, true);
      window.removeEventListener('resize', auDefilement);
    };
  }, [menuCreer, menuLigne]);

  // Changer d'onglet ou de filtre remet à la première page : rester en page 3
  // d'une liste qui n'en a plus qu'une donne un écran vide inexplicable.
  // Le dossier aussi (launch 2026-09-28) : rester en page 3 d'un dossier qui n'en a qu'une donnait « Aucune automatisation ».
  useEffect(() => { setPage(1); setRestentAffichees(new Set()); }, [onglet, search, filterCategory, filterStatut, dossierActif, triDate, tri]);

  // Une sélection ne survit à AUCUN changement de vue (M9) : onglet, dossier,
  // page, recherche, filtres, taille de page.
  useEffect(() => { setCochees(new Set()); }, [onglet, dossierActif, page, parPage, search, filterCategory, filterStatut]);

  /**
   * Publier une étape restée sur le TEXTE D'EXEMPLE de l'éditeur : on demande.
   *
   * L'interrupteur et le lot publiaient sans un mot ; le texte d'exemple
   * (« Bonjour [client_name], c'est [company_name]. Merci ! ») partait alors
   * à chaque client (audit du 2026-10-01, vécu en prod). Rien à signaler :
   * aucune fenêtre, comme avant.
   */
  const confirmerTextesDExemple = async (aPublier: AutomationRule[]): Promise<boolean> => {
    const concernees = aPublier
      .map((r) => ({ r, exemples: textesDExemple({ trigger_event: r.trigger_event, steps: r.steps, actions: r.actions, conditions: (r.conditions ?? null) as Record<string, unknown> | null, is_preset: r.is_preset, fr }) }))
      .filter((x) => x.exemples.length > 0);
    if (concernees.length === 0) return true;
    confirmationOuverte.current = true;
    try {
      return await confirmer({
        title: fr ? 'Publier avec le texte d’exemple ?' : 'Publish with the sample text?',
        message: [
          ...concernees.flatMap(({ r, exemples }) => exemples.map((e) => (concernees.length > 1 ? `${localizeAutomationName(r.name, language)} — ${e.message}` : e.message))),
          fr
            ? 'Ce texte partira tel quel. Ouvrez l’automatisation pour l’écrire, ou publiez si c’est bien ce que vous voulez envoyer.'
            : 'This text will go out as is. Open the automation to write it, or publish if that is what you want to send.',
        ].join('\n\n'),
        confirmLabel: fr ? 'Publier quand même' : 'Publish anyway',
      });
    } finally {
      confirmationOuverte.current = false;
    }
  };

  /**
   * « Client inactif » : dire combien de clients sont visés AVANT d'activer, et demander.
   *
   * UNE fonction pour l'interrupteur d'une ligne ET pour la publication en lot : le lot publiait
   * d'un coup, sans rien demander (triage de la liste, `07-lot:188`). Aucune publication en lot ne
   * contourne une confirmation que l'interrupteur demande.
   * `plusieurs` : le lot nomme l'automatisation dans le message (il peut en porter plusieurs).
   */
  const confirmerClientInactif = async (rule: AutomationRule, plusieurs = false): Promise<boolean> => {
    confirmationOuverte.current = true;
    try {
      let n: number | null = null;
      try {
        n = await apercuClientsInactifs(Number((rule.conditions as Record<string, unknown> | null)?.mois ?? 6));
      } catch (e) {
        console.error('[Automations] aperçu clients inactifs', e);
      }
      const combien = n === null
        ? (fr ? 'Les messages partiront par petits lots, en journée.' : 'Messages will go out in small batches, during the day.')
        : (fr
          ? `${n} client${n > 1 ? 's' : ''} correspond${n > 1 ? 'ent' : ''} aujourd’hui. Les messages partiront par petits lots, en journée.`
          : `${n} client${n > 1 ? 's' : ''} match${n > 1 ? '' : 'es'} today. Messages will go out in small batches, during the day.`);
      return await confirmer({
        title: fr ? 'Activer « Client inactif » ?' : 'Activate “Inactive client”?',
        message: plusieurs ? `${localizeAutomationName(rule.name, language)} — ${combien}` : combien,
        confirmLabel: fr ? 'Activer' : 'Activate',
      });
    } finally {
      confirmationOuverte.current = false;
    }
  };

  const handleToggle = async (rule: AutomationRule) => {
    // Une confirmation déjà à l'écran : les clics suivants n'en ouvrent pas d'autres.
    if (confirmationOuverte.current) return;
    const versActive = !fileBascule.etatAffiche(rule.id, rule.is_active);
    if (versActive && rule.trigger_event === 'client.inactive' && !(await confirmerClientInactif(rule))) return;
    if (versActive && !(await confirmerTextesDExemple([rule]))) return;
    setRestentAffichees((prev) => (prev.has(rule.id) ? prev : new Set(prev).add(rule.id)));
    const voulu = fileBascule.basculer(rule.id, rule.is_active);
    setRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, is_active: voulu } : r)));
  };

  /*
   * « Partir de zéro » et « Construire avec Lumi » ne créent RIEN en base
   * (audit 2026-09-28) : l'éditeur ouvre un brouillon local, qui ne naît
   * qu'à la première vraie sauvegarde. Plus de brouillons orphelins, plus de
   * double création au double clic, et sans Autopilot l'écran de vente de
   * Lumi passe avant toute écriture.
   */
  const partirDeZero = (avecLumi: boolean) => {
    navigate(`/automations/nouvelle${avecLumi ? '?lumi=1' : ''}`);
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

    // « Copier vers d'autres bureaux » est un geste d'écriture : sans le droit, la lecture répondrait 403.
    if (peutModifier) charger(1);
    return () => { vivant = false; if (minuterie) clearTimeout(minuterie); };
  }, [peutModifier]);

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

  /**
   * Vider une ligne de la corbeille (demande du 2026-09-30).
   *
   * Irréversible pour l'utilisateur : confirmation obligatoire. L'historique
   * d'envois est conservé côté serveur — c'est la preuve de ce qui est parti
   * chez les clients.
   */
  const supprimerDefinitivement = async (regle: AutomationRule) => {
    const ok = await confirmer({
      title: fr ? 'Supprimer définitivement ?' : 'Delete permanently?',
      message: fr
        ? `« ${regle.name} » disparaît de la corbeille et ne pourra plus être restaurée. L’historique des messages déjà envoyés est conservé.`
        : `“${regle.name}” leaves the bin and can no longer be restored. The history of messages already sent is kept.`,
      confirmLabel: fr ? 'Supprimer définitivement' : 'Delete permanently',
      danger: true,
    });
    if (!ok) return;
    setOccupeId(regle.id);
    try {
      await supprimerDefinitivementAutomatisation(regle.id);
      toast.success(fr ? 'Automatisation supprimée définitivement' : 'Automation permanently deleted');
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

  /** « À vérifier » = ce qui a un échec DÉFINITIF sur la période choisie. */
  const aVerifier = vivantes.filter((r) => (stats?.[r.id]?.echouees ?? 0) > 0);
  const mesAutos = vivantes.filter((r) => !r.is_preset || r.is_active);
  const modeles = vivantes.filter((r) => r.is_preset && !r.is_active);

  // Une ligne basculée sur cet onglet y reste (voir `restentAffichees`) ;
  // les compteurs, eux, suivent l'état réel.
  const resteIci = (r: AutomationRule) => restentAffichees.has(r.id);
  const sourceOnglet =
    onglet === 'verifier' ? aVerifier
    : onglet === 'modeles' ? vivantes.filter((r) => r.is_preset && (!r.is_active || resteIci(r)))
    : onglet === 'corbeille' ? supprimees
    : vivantes.filter((r) => !r.is_preset || r.is_active || resteIci(r));

  const filtrees = sourceOnglet.filter((r) => {
    if (search) {
      const q = search.toLowerCase();
      const nom = localizeAutomationName(r.name, language).toLowerCase();
      if (!nom.includes(q) && !(r.description || '').toLowerCase().includes(q)) return false;
    }
    if (filterCategory !== 'all' && getCategory(r) !== filterCategory) return false;
    if (filterStatut === 'publiee' && !r.is_active && !resteIci(r)) return false;
    if (filterStatut === 'brouillon' && r.is_active && !resteIci(r)) return false;
    // Le dossier affiché. `null` = tout, 'racine' = celles qui ne sont
    // rangées nulle part.
    if (dossierActif === 'racine' && r.folder_id) return false;
    if (dossierActif && dossierActif !== 'racine' && r.folder_id !== dossierActif) return false;
    return true;
  });
  /*
   * L'ordre alphabétique se lit sur le nom AFFICHÉ (audit du 2026-10-01).
   * Le serveur trie sur le nom stocké — en anglais pour les préréglages — et
   * l'écran le traduit ensuite : en français la liste paraissait mélangée
   * (« Confirmation… », « Anniversaire… », « Contrat… », « Vente croisée… »).
   * Comparaison dans la langue de l'interface : « É » se range avec « E »,
   * et « 3 jours » passe avant « 14 jours ».
   */
  const langueTri = fr ? 'fr-CA' : 'en-CA';
  const parNomAffiche = (a: AutomationRule, b: AutomationRule) => localizeAutomationName(a.name, language)
    .localeCompare(localizeAutomationName(b.name, language), langueTri, { sensitivity: 'base', numeric: true });
  if (triDate !== 'defaut') {
    const sens = triDate === 'recent' ? -1 : 1;
    filtrees.sort((a, b) => sens * (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()));
  } else {
    filtrees.sort(parNomAffiche);
  }

  /** La valeur comparée pour une colonne (nombres, dates en ms, texte). */
  const valeurTri = (r: AutomationRule, cle: CleTri): number | string => {
    switch (cle) {
      case 'nom': return localizeAutomationName(r.name, language).toLocaleLowerCase(langueTri);
      case 'statut': return r.deleted_at ? 0 : r.is_active ? 2 : 1;
      case 'declenches': return stats?.[r.id]?.declenchees ?? 0;
      case 'en_cours': return stats?.[r.id]?.en_cours ?? 0;
      case 'modifiee': return Date.parse(r.updated_at) || 0;
      case 'creee': return Date.parse(r.created_at) || 0;
    }
  };
  const triees = tri
    ? [...filtrees].sort((a, b) => {
      const va = valeurTri(a, tri.cle);
      const vb = valeurTri(b, tri.cle);
      const ecart = typeof va === 'number' && typeof vb === 'number'
        ? va - vb
        : String(va).localeCompare(String(vb), langueTri, { sensitivity: 'base', numeric: true });
      // À égalité, le nom départage : un ordre stable d'un clic à l'autre.
      return (tri.sens === 'asc' ? ecart : -ecart) || parNomAffiche(a, b);
    })
    : filtrees;

  const pages = Math.max(1, Math.ceil(filtrees.length / parPage));
  // Après une suppression (ou un déplacement) sur la dernière page, la page
  // courante peut ne plus exister : on la ramène dans les bornes au lieu
  // d'afficher « Aucune automatisation » (launch 2026-09-28).
  useEffect(() => { setPage((p) => Math.min(p, pages)); }, [pages]);

  /** Combien d'automatisations dans chaque dossier — un dossier vide se voit. */
  const compteParDossier = (id: string) => vivantes.filter((r) => r.folder_id === id).length;
  const visibles = triees.slice((page - 1) * parPage, page * parPage);

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
  /*
   * SEULEMENT CE QUI EST À L'ÉCRAN (audit M9). Cocher 3 lignes dans
   * « Toutes » puis 2 dans « Modèles » publiait 5 automatisations, dont 3
   * invisibles. La sélection se vide à chaque changement de vue (voir
   * l'effet plus haut) et le lot ne porte que sur les lignes visibles.
   */
  const reglesCochees = visibles.filter((r) => cochees.has(r.id));
  /** Ce que chaque bouton du lot touchera VRAIMENT — affiché sur le bouton. */
  const nbAPublier = reglesCochees.filter((r) => !r.deleted_at && !r.is_active).length;
  const nbADepublier = reglesCochees.filter((r) => !r.deleted_at && r.is_active).length;
  const nbASupprimer = reglesCochees.filter((r) => !r.is_preset).length;

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
  /*
   * Le lot passe par la MÊME route serveur que l'interrupteur (M8) : chaque
   * parcours cassé est refusé, nommé, avec ses problèmes.
   */
  const publierEnLot = async (actif: boolean) => {
    const cibles = reglesCochees.filter((r) => !r.deleted_at && r.is_active !== actif);
    if (cibles.length === 0) { setCochees(new Set()); return; }
    // Une confirmation déjà à l'écran : un second clic sur « Publier » n'en ouvre pas une autre.
    if (confirmationOuverte.current) return;
    if (actif) {
      // Les MÊMES confirmations que l'interrupteur d'une ligne, dans le même ordre : le nombre de
      // clients visés par chaque « Client inactif », puis le texte d'exemple. Un refus arrête le lot
      // entier : rien n'est publié.
      const inactifs = cibles.filter((r) => r.trigger_event === 'client.inactive');
      for (const r of inactifs) {
        if (!(await confirmerClientInactif(r, cibles.length > 1))) return;
      }
      if (!(await confirmerTextesDExemple(cibles))) return;
    }
    setLotEnCours(true);
    try {
      const resultats = await changerPublicationEnLot(cibles.map((r) => r.id), actif);
      const reussis = resultats.filter((r) => r.ok).length;
      const echecs = resultats.filter((r) => !r.ok);
      if (reussis > 0) {
        toast.success(actif
          ? (fr ? `${reussis} automatisation(s) publiée(s)` : `${reussis} automation(s) published`)
          : (fr ? `${reussis} automatisation(s) repassée(s) en brouillon` : `${reussis} automation(s) unpublished`));
      }
      if (echecs.length > 0) {
        const nomDe = (id: string) => {
          const r = rules.find((x) => x.id === id);
          return r ? localizeAutomationName(r.name, language) : id;
        };
        toast.error(echecs.map((e) => `« ${nomDe(e.id)} » — ${e.erreur ?? ''}`).join('\n'), { duration: 15_000 });
      }
      setCochees(new Set());
      await load();
    } catch (e: unknown) {
      console.error('[automations] publication en lot échouée', e);
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setLotEnCours(false);
    }
  };
  const publierLot = () => publierEnLot(true);
  const depublierLot = () => publierEnLot(false);

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

  const supprimerDefinitivementLot = async () => {
    const cibles = reglesCochees.filter((r) => !!r.deleted_at);
    if (cibles.length === 0) return;
    const ok = await confirmer({
      title: fr
        ? `Supprimer définitivement ${cibles.length} automatisation(s) ?`
        : `Permanently delete ${cibles.length} automation(s)?`,
      message: fr
        ? 'Elles disparaissent de la corbeille et ne pourront plus être restaurées. L’historique des messages déjà envoyés est conservé.'
        : 'They leave the bin and can no longer be restored. The history of messages already sent is kept.',
      confirmLabel: fr ? 'Supprimer définitivement' : 'Delete permanently',
      danger: true,
    });
    if (!ok) return;
    await agirEnLot(
      (r) => supprimerDefinitivementAutomatisation(r.id),
      { fr: (n) => `${n} automatisation(s) supprimée(s) définitivement`, en: (n) => `${n} automation(s) permanently deleted` },
      cibles,
    );
  };

  const DEPARTS: Array<{ cle: string; fr: string; en: string; aideFr: string; aideEn: string; icone: typeof Zap }> = [
    { cle: 'zero', fr: 'Partir de zéro', en: 'Start from scratch', icone: Plus,
      aideFr: 'Un parcours vide, à construire.', aideEn: 'An empty path, to build.' },
    { cle: 'lumi', fr: 'Construire avec Lumi', en: 'Build with Lumi', icone: Sparkles,
      aideFr: 'Décris ce que tu veux, Lumi le monte. Inclus dans Autopilot.', aideEn: 'Describe it, Lumi builds it. Included in Autopilot.' },
    { cle: 'modele', fr: 'Partir d’un modèle', en: 'Start from a template', icone: FileText,
      aideFr: 'Une bibliothèque de modèles prêts à l’emploi.', aideEn: 'A library of ready-made templates.' },
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
    // Ouvre la bibliothèque. Avant (jusqu'au 2026-09-30), ce départ basculait
    // sur l'onglet « Modèles » — les vraies automatisations en brouillon de
    // l'entreprise — et rien n'était créé.
    if (cle === 'modele') { setBibliotheque(true); return; }
    // Inatteignable : les trois départs ci-dessus couvrent tout `DEPARTS`.
    // Le garder évite qu'un ajout futur retombe dans le vide sans un mot.
    console.error('[automations] départ inconnu :', cle);
  };

  /*
   * Un compteur d'onglet ne s'affiche que s'il est CONNU (triage `03-onglets-etats:184`).
   * Lecture des automatisations en panne (ou pas encore revenue) : « Corbeille (0) » affirmait une
   * corbeille vide alors qu'elle ne l'était pas. Chiffres illisibles (ou pas encore lus) : pas de
   * compteur sur « À vérifier » — jamais un « 0 » qui dirait que tout va bien.
   */
  const listeInconnue = echecChargement || (loading && rules.length === 0);
  const ONGLETS: Array<{ cle: 'toutes' | 'verifier' | 'modeles' | 'corbeille'; fr: string; en: string; n: number | null }> = [
    { cle: 'toutes', fr: 'Toutes', en: 'All workflows', n: null },
    { cle: 'verifier', fr: 'À vérifier', en: 'Needs review', n: listeInconnue || stats === null ? null : aVerifier.length },
    // « Prêtes à publier », plus « Modèles » : ce mot désigne la bibliothèque du menu Créer (copies en
    // brouillon). Ici, ce sont les automatisations fournies pas encore publiées, qu'on publie en place.
    { cle: 'modeles', fr: 'Prêtes à publier', en: 'Ready to publish', n: listeInconnue ? null : modeles.length },
    { cle: 'corbeille', fr: 'Corbeille', en: 'Deleted', n: listeInconnue ? null : supprimees.length },
  ];

  const dateCourte = (iso: string | null | undefined) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString(fr ? 'fr-CA' : 'en-CA', {
      day: 'numeric', month: 'short', year: 'numeric',
    });
  };

  return (
    <PermissionGate permission="automations.read">
      <div className="mx-auto max-w-[1400px] space-y-4">

        {/* ══ 1. Sous-navigation ══ */}
        <SousNavigation courante="liste" fr={fr} />

        {!peutModifier && (
          <p role="note" className="flex items-center gap-2 rounded-xl border border-border bg-surface-secondary px-3 py-2 text-[13px] text-text-secondary">
            <Eye size={14} className="shrink-0" aria-hidden="true" />
            {fr ? `Lecture seule. ${raisonLectureSeule}` : `Read only. ${raisonLectureSeule}`}
          </p>
        )}

        {/*
          L'interrupteur du client, AVANT la liste : on le cherche en
          panique quand des messages partent, pas en explorant les
          réglages. En marche c'est un lien discret ; en pause, un bandeau
          rouge impossible à manquer — oublier que ses automatisations
          dorment coûte des relances pendant des jours.
        */}
        <BandeauPause fr={fr} onChange={setToutEnPause} lectureSeule={!peutModifier} />

        <BibliothequeModeles
          open={bibliotheque}
          fr={fr}
          onClose={() => { setBibliotheque(false); requestAnimationFrame(() => boutonCreer.current?.focus()); }}
          onCree={(regle) => {
            setBibliotheque(false);
            toast.success(fr ? 'Automatisation créée en brouillon' : 'Automation created as a draft');
            navigate(`/automations/${regle.id}`);
          }}
          onErreur={(message) => toast.error(message)}
        />

        {/*
          Aucun numéro texto (bloqué tant que Trust Hub n'est pas approuvé) :
          chaque étape texto est SAUTÉE et le parcours continue (M1). On le
          dit ici, une fois, plutôt que de laisser croire que les textos partent.
        */}
        {textoConfigure === false && (
          <div role="status" className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning-light px-3 py-2.5 text-[13px] text-text-primary">
            <MessageSquare size={15} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
            <span>
              {fr
                ? 'Les étapes texto sont sautées tant qu’aucun numéro n’est configuré.'
                : 'Text message steps are skipped until a number is set up.'}
            </span>
          </div>
        )}

        {statsIllisibles && (
          <div role="alert" className="flex flex-wrap items-center gap-2.5 rounded-xl border border-warning/40 bg-warning-light px-3 py-2.5 text-[13px] text-text-primary">
            <AlertTriangle size={15} className="shrink-0 text-warning" aria-hidden="true" />
            <span>
              {fr
                ? 'Les chiffres et les échecs n’ont pas pu être lus : l’onglet « À vérifier » ne peut pas être établi pour le moment.'
                : 'The numbers and failures could not be read: the “Needs review” tab cannot be worked out right now.'}
            </span>
            <button type="button" onClick={() => void lireChiffres.current()} className="glass-button text-[12px]">
              {fr ? 'Réessayer' : 'Try again'}
            </button>
          </div>
        )}

        {/* ══ 2. Titre + les trois boutons ══ */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-[26px] font-bold tracking-tight text-text-primary">
            {fr ? 'Mes automatisations' : 'Workflows list'}
          </h1>

          <div className="flex flex-wrap items-center gap-2">
            <div className="mr-1 flex items-center gap-2">
              <span className="text-[11px] text-text-tertiary">{fr ? 'Messages en' : 'Messages in'}</span>
              {/* La langue active ne se devinait qu'à la couleur : un groupe
                  nommé, et l'état de chaque bouton exposé (`aria-pressed`). */}
              <div
                role="group"
                aria-label={fr ? 'Langue des messages' : 'Message language'}
                className="inline-flex overflow-hidden rounded-lg border border-outline/50 text-[12px]"
              >
                {(['fr', 'en'] as const).map((l) => (
                  <button
                    key={l}
                    type="button"
                    onClick={() => changerLangue(l)}
                    disabled={savingLang || !peutModifier}
                    title={peutModifier ? undefined : raisonLectureSeule}
                    aria-pressed={orgLang === l}
                    className={`px-2.5 py-1 font-medium transition-colors pointer-coarse:py-2 ${orgLang === l ? 'bg-text-primary text-white' : 'text-text-secondary hover:bg-surface-tertiary'}`}
                  >
                    {l === 'fr' ? 'FR' : 'EN'}
                  </button>
                ))}
              </div>
              {langueIllisible && orgLang === null && (
                <span role="status" className="text-[11px] text-text-tertiary">
                  {fr ? 'Langue actuelle inconnue' : 'Current language unknown'}
                </span>
              )}
            </div>

            {!peutModifier ? null : saisieDossier ? (
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

            {peutModifier && (
            <button
              type="button"
              onClick={() => partirDeZero(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-accent bg-accent/5 px-3 py-1.5 text-[13px] font-semibold text-accent transition-colors hover:bg-accent/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <Sparkles size={14} aria-hidden="true" />
              {/* Le même nom que dans le menu « Créer » (c'était « Build using AI »). */}
              {fr ? 'Construire avec Lumi' : 'Build with Lumi'}
            </button>
            )}

            {peutModifier && (
            <div className="relative">
              <button
                type="button"
                ref={boutonCreer}
                onClick={(e) => {
                  e.stopPropagation();
                  ouvreurMenu.current = e.currentTarget;
                  // Un seul menu à la fois : ce clic n'atteint pas le « clic
                  // ailleurs » du document, le menu « ⋮ » d'une ligne restait ouvert.
                  setMenuLigne(null);
                  setSousMenuDossier(null);
                  setMenuCreer((m) => !m);
                }}
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
                  ref={refMenu}
                  tabIndex={-1}
                  aria-label={fr ? 'Créer une automatisation' : 'Create a workflow'}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => clavierDeMenu(e, fermerMenus, ouvreurMenu.current)}
                  className="absolute right-0 z-30 mt-1.5 w-[300px] overflow-hidden rounded-xl border border-border bg-surface-card p-1.5 shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
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
            )}
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
                id={`${idOnglets}-${o.cle}`}
                aria-controls={`${idOnglets}-panneau`}
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
                {o.n !== null && ` (${o.n})`}
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
                {peutModifier && (<>
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
                </>)}
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

          {/* La période de TOUS les chiffres de la liste (colonnes, pastilles, « À vérifier », détail ›). */}
          <label htmlFor="periode-automations" className="ml-1 text-[12px] text-text-secondary">{fr ? 'Période' : 'Period'}</label>
          <select
            id="periode-automations"
            value={periode}
            onChange={(e) => changerPeriode(Number(e.target.value) as PeriodeJours)}
            className="glass-input py-1.5 text-[12px]"
          >
            {PERIODES_JOURS.map((j) => <option key={j} value={j}>{libellePeriode(j, fr)}</option>)}
          </select>

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
            <label htmlFor="f-tri-date" className="ml-2 text-[12px] text-text-secondary">{fr ? 'Trier' : 'Sort'}</label>
            <select
              id="f-tri-date"
              value={triDate}
              onChange={(e) => setTriDate(e.target.value as typeof triDate)}
              className="glass-input"
            >
              <option value="defaut">{fr ? 'Ordre par défaut' : 'Default order'}</option>
              <option value="recent">{fr ? 'Créées le plus récemment' : 'Newest first'}</option>
              <option value="ancien">{fr ? 'Créées le plus anciennement' : 'Oldest first'}</option>
            </select>
          </div>
        )}

        {/* ══ 5. Fil d'Ariane ══ */}
        <p className="text-[13px] text-text-secondary">{fr ? 'Accueil' : 'Home'}</p>

        {/*
          La barre d'actions groupées — elle n'apparaît QUE s'il y a une
          sélection, comme chez GoHighLevel. Dans la corbeille : « Restaurer »
          et « Supprimer définitivement ».
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
                <>
                <button
                  type="button"
                  onClick={() => void restaurerLot()}
                  disabled={lotEnCours}
                  className="glass-button inline-flex items-center gap-1.5 text-[12px] disabled:opacity-50"
                >
                  <RotateCcw size={13} aria-hidden="true" />
                  {fr ? `Restaurer (${reglesCochees.length})` : `Restore (${reglesCochees.length})`}
                </button>
                <button
                  type="button"
                  onClick={() => void supprimerDefinitivementLot()}
                  disabled={lotEnCours}
                  className="glass-button inline-flex items-center gap-1.5 text-[12px] text-danger disabled:opacity-50"
                >
                  <Trash2 size={13} aria-hidden="true" />
                  {fr ? `Supprimer définitivement (${reglesCochees.length})` : `Delete permanently (${reglesCochees.length})`}
                </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => void publierLot()}
                    disabled={lotEnCours}
                    className="glass-button inline-flex items-center gap-1.5 text-[12px] disabled:opacity-50"
                  >
                    <ToggleRight size={13} aria-hidden="true" />
                    {fr ? `Publier (${nbAPublier})` : `Publish (${nbAPublier})`}
                  </button>
                  <button
                    type="button"
                    onClick={() => void depublierLot()}
                    disabled={lotEnCours}
                    className="glass-button inline-flex items-center gap-1.5 text-[12px] disabled:opacity-50"
                  >
                    <ToggleLeft size={13} aria-hidden="true" />
                    {fr ? `Repasser en brouillon (${nbADepublier})` : `Unpublish (${nbADepublier})`}
                  </button>
                  <button
                    type="button"
                    onClick={() => void supprimerLot()}
                    disabled={lotEnCours}
                    className="glass-button inline-flex items-center gap-1.5 text-[12px] text-danger disabled:opacity-50"
                  >
                    <Trash2 size={13} aria-hidden="true" />
                    {fr ? `Supprimer (${nbASupprimer})` : `Delete (${nbASupprimer})`}
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

        {/* ══ 6. Le tableau ══ — le panneau des onglets du haut. */}
        <div role="tabpanel" id={`${idOnglets}-panneau`} aria-labelledby={`${idOnglets}-${onglet}`}>
        {loading ? (
          // La roue était muette pour un lecteur d'écran (triage `03-onglets-etats:130`).
          <div role="status" className="section-card flex items-center justify-center gap-2 py-16 text-[13px] text-text-secondary">
            <Loader2 className="h-5 w-5 animate-spin text-text-tertiary" aria-hidden="true" />
            {fr ? 'Chargement…' : 'Loading…'}
          </div>
        ) : echecChargement ? (
          <div role="alert" className="section-card flex flex-col items-center justify-center gap-3 py-14 text-center">
            <AlertTriangle className="h-6 w-6 text-danger" aria-hidden="true" />
            <p className="text-[13px] font-medium text-text-primary">
              {fr ? 'Impossible de charger les automatisations pour le moment.' : 'Could not load the automations right now.'}
            </p>
            <p className="text-[12px] text-text-secondary">
              {fr ? 'Rien n’a été supprimé : c’est la lecture qui a échoué.' : 'Nothing was deleted: only loading failed.'}
            </p>
            <button type="button" onClick={() => void load()} className="glass-button">
              {fr ? 'Réessayer' : 'Try again'}
            </button>
          </div>
        ) : (
          <div className="section-card overflow-hidden">
            <div className="overflow-x-auto">
              {/* TABLETTE (mesuré sur un iPad le 2026-10-01) : une largeur minimale de
                  980 px poussait l'interrupteur, les messages et le menu « ⋮ » hors
                  écran dès 1024 px ; en portrait on ne voyait plus que « Nom ». Les
                  colonnes secondaires se replient par palier — compteurs à partir de
                  1024 px, dates à partir de 1280 px — et les actions restent là. */}
              <table className="w-full min-w-[440px] text-[13px]">
                <thead>
                  <tr className="border-b border-outline/40 text-left text-[12px] text-text-secondary">
                    <th scope="col" className="w-10 px-3 py-3">
                      <input
                        type="checkbox"
                        checked={toutCoche}
                        onChange={basculerTout}
                        disabled={!peutModifier}
                        title={peutModifier ? undefined : raisonLectureSeule}
                        aria-label={fr ? 'Tout cocher' : 'Select all'}
                        className="h-3.5 w-3.5 rounded border-outline"
                      />
                    </th>
                    {([
                      ['nom', fr ? 'Nom' : 'Name', ''],
                      ['statut', fr ? 'Statut' : 'Status', ''],
                      // La période est écrite dans l'en-tête : le chiffre ne vaut que pour elle.
                      ['declenches', fr ? `Déclenchées (${periode} j)` : `Triggered (${periode} d)`, 'hidden lg:table-cell'],
                      ['en_cours', fr ? 'En cours' : 'In progress', 'hidden lg:table-cell'],
                      ['modifiee', fr ? 'Modifiée le' : 'Last updated', 'hidden xl:table-cell'],
                      ['creee', fr ? 'Créée le' : 'Created on', 'hidden xl:table-cell'],
                    ] as const).map(([cle, libelle, classe]) => {
                      const actif = tri?.cle === cle;
                      const Fleche = actif && tri?.sens === 'desc' ? ArrowDown : ArrowUp;
                      return (
                        <th
                          key={cle}
                          scope="col"
                          aria-sort={actif ? (tri?.sens === 'asc' ? 'ascending' : 'descending') : 'none'}
                          className={cn('px-3 py-3 font-medium', classe)}
                        >
                          <button
                            type="button"
                            onClick={() => trierPar(cle)}
                            className="inline-flex items-center gap-1 rounded transition-colors hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                          >
                            {libelle}
                            <Fleche size={11} className={actif ? 'text-text-primary' : 'opacity-0'} aria-hidden="true" />
                          </button>
                        </th>
                      );
                    })}
                    <th scope="col" className="px-3 py-3 font-medium">{fr ? 'Stats' : 'Stats'}</th>
                    <th scope="col" className="w-24 px-3 py-3">
                      <span className="sr-only">{fr ? 'Actions' : 'Actions'}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visibles.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-4 py-14 text-center">
                        {onglet === 'verifier' && statsIllisibles
                          ? <AlertTriangle className="mx-auto mb-3 h-7 w-7 text-warning" aria-hidden="true" />
                          : <Zap className="mx-auto mb-3 h-7 w-7 text-text-tertiary" aria-hidden="true" />}
                        <p className="text-[13px] font-medium text-text-primary">
                          {onglet === 'corbeille'
                            ? (fr ? 'La corbeille est vide' : 'The bin is empty')
                            : onglet === 'verifier'
                              /*
                               * « Tout roule » ne s'affirme que si les échecs ONT ÉTÉ LUS et qu'il n'y en a
                               * aucun (triage `03-onglets-etats:229`, constat D-17). Lecture en panne : on dit
                               * qu'on ne sait pas ; lecture en cours : on attend.
                               */
                              ? (statsIllisibles
                                ? (fr ? 'Les échecs n’ont pas pu être lus : impossible de dire si tout va bien.' : 'The failures could not be read: no way to tell whether all is well.')
                                : stats === null
                                  ? (fr ? 'Lecture des échecs…' : 'Reading failures…')
                                  : (fr ? 'Aucune erreur — tout roule' : 'No errors — all running smoothly'))
                              : (fr ? 'Aucune automatisation' : 'No automations')}
                        </p>
                        {onglet === 'verifier' && statsIllisibles && (
                          <button type="button" onClick={() => void lireChiffres.current()} className="glass-button mt-4">
                            {fr ? 'Réessayer' : 'Try again'}
                          </button>
                        )}
                        {onglet === 'toutes' && modeles.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setOnglet('modeles')}
                            className="glass-button mt-4 inline-flex items-center gap-1.5"
                          >
                            <FileText size={13} aria-hidden="true" />
                            {fr ? 'Voir les automatisations prêtes à publier' : 'See ready-to-publish automations'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ) : visibles.map((r) => {
                    const rule = r;
                    const echecs = stats?.[rule.id]?.echouees ?? 0;
                    const causeEchec = raisonLisible(stats?.[rule.id]?.dernier_echec?.erreur ?? null, fr);
                    // Le libellé du CATALOGUE d'abord — celui de l'éditeur :
                    // « Lead créé » ici, « Nouveau prospect » là-bas, pour le
                    // même déclencheur (audit V2, A-16). La table locale ne
                    // sert plus qu'aux événements hors catalogue.
                    const decl = trouverDeclencheur(rule.trigger_event) ?? TRIGGER_DISPLAY[rule.trigger_event];
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
                              disabled={!peutModifier}
                              title={peutModifier ? undefined : raisonLectureSeule}
                              aria-label={fr ? `Cocher ${localizeAutomationName(rule.name, language)}` : `Select ${localizeAutomationName(rule.name, language)}`}
                              className="h-3.5 w-3.5 rounded border-outline"
                            />
                          </td>

                          <td className="px-3 py-3">
                            <NomDeLigne
                              ouvrir={peutModifier ? () => navigate(`/automations/${rule.id}`) : null}
                            >
                              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-surface-tertiary">
                                <Icone size={13} className="text-text-secondary" aria-hidden="true" />
                              </span>
                              <span className="min-w-0">
                                <span className={cn('block font-medium text-primary', peutModifier && 'hover:underline')}>
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
                                    {echecs} {fr ? `échec(s) dans les ${periode} derniers jours` : `failure(s) in the last ${periode} days`}
                                    {/* POURQUOI, en mots du métier — jamais le message technique brut. */}
                                    {causeEchec && ` — ${causeEchec}`}
                                  </span>
                                )}
                              </span>
                            </NomDeLigne>
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

                          {/* Déclenchées (sur la période) / En cours (maintenant) : les vrais chiffres ;
                              « … » tant qu'ils ne sont pas arrivés, « — » seulement si la lecture a échoué. */}
                          <td className="hidden px-3 py-3 tabular-nums text-primary lg:table-cell">{stats ? (stats[rule.id]?.declenchees ?? 0) : statsIllisibles ? '—' : '…'}</td>
                          <td className="hidden px-3 py-3 tabular-nums text-primary lg:table-cell">{stats ? (stats[rule.id]?.en_cours ?? 0) : statsIllisibles ? '—' : '…'}</td>

                          <td className="hidden px-3 py-3 text-text-secondary xl:table-cell">{dateCourte(rule.updated_at)}</td>
                          <td className="hidden px-3 py-3 text-text-secondary xl:table-cell">{dateCourte(rule.created_at)}</td>

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
                              {/* Rouge = brouillon, vert = publiée. Une règle à la
                                  corbeille ne se déclenche plus (le moteur la
                                  filtre) : un interrupteur qui s'allumerait sans
                                  rien changer mentirait. */}
                              <InterrupteurPublication
                                actif={rule.is_active}
                                onBascule={() => handleToggle(rule)}
                                enCours={fileBascule.enCours(rule.id)}
                                desactive={!!rule.deleted_at || !peutModifier}
                                libelle={rule.is_active
                                  ? (fr ? `Repasser ${localizeAutomationName(rule.name, language)} en brouillon` : `Unpublish ${localizeAutomationName(rule.name, language)}`)
                                  : (fr ? `Publier ${localizeAutomationName(rule.name, language)}` : `Publish ${localizeAutomationName(rule.name, language)}`)}
                                fr={fr}
                              />

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

                              {peutModifier && (
                              <div className="relative">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    ouvreurMenu.current = e.currentTarget;
                                    const r = e.currentTarget.getBoundingClientRect();
                                    // ~260 px : la hauteur du menu avec son sous-menu de dossiers.
                                    const versLeHaut = window.innerHeight - r.bottom < 260 && r.top > 260;
                                    setPosMenuLigne(versLeHaut
                                      ? { bottom: window.innerHeight - r.top + 4, right: window.innerWidth - r.right }
                                      : { top: r.bottom + 4, right: window.innerWidth - r.right });
                                    // Un seul menu à la fois (voir le bouton « Créer »).
                                    setMenuCreer(false);
                                    setSousMenuDossier(null);
                                    setMenuLigne((m) => (m === rule.id ? null : rule.id));
                                  }}
                                  aria-haspopup="menu"
                                  aria-expanded={menuLigne === rule.id}
                                  aria-label={fr ? `Actions pour ${localizeAutomationName(rule.name, language)}` : `Actions for ${localizeAutomationName(rule.name, language)}`}
                                  className="rounded-md p-1.5 text-text-tertiary transition-colors hover:bg-surface-tertiary hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                                >
                                  {occupeId === rule.id
                                    ? <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                                    : <EllipsisVertical size={14} aria-hidden="true" />}
                                </button>

                                {menuLigne === rule.id && posMenuLigne && createPortal(
                                  <div
                                    role="menu"
                                    ref={refMenu}
                                    tabIndex={-1}
                                    aria-label={fr ? `Actions pour ${localizeAutomationName(rule.name, language)}` : `Actions for ${localizeAutomationName(rule.name, language)}`}
                                    onClick={(e) => e.stopPropagation()}
                                    onKeyDown={(e) => clavierDeMenu(e, fermerMenus, ouvreurMenu.current)}
                                    style={posMenuLigne}
                                    className="fixed z-[60] max-h-[70vh] w-[210px] overflow-y-auto rounded-xl border border-border bg-surface-card p-1.5 shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                                  >
                                    {/*
                                      À la corbeille : restaurer, ou supprimer
                                      définitivement. Modifier, dupliquer ou
                                      ranger une règle supprimée n'aurait aucun
                                      effet visible : mieux vaut ne pas l'offrir.
                                    */}
                                    {rule.deleted_at ? (
                                      <>
                                      <button
                                        type="button"
                                        role="menuitem"
                                        onClick={() => { setMenuLigne(null); void restaurer(rule); }}
                                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-text-primary transition-colors hover:bg-surface-tertiary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                                      >
                                        <RotateCcw size={13} aria-hidden="true" />
                                        {fr ? 'Restaurer' : 'Restore'}
                                      </button>
                                      <button
                                        type="button"
                                        role="menuitem"
                                        onClick={() => { setMenuLigne(null); void supprimerDefinitivement(rule); }}
                                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-danger transition-colors hover:bg-surface-tertiary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                                      >
                                        <Trash2 size={13} aria-hidden="true" />
                                        {fr ? 'Supprimer définitivement' : 'Delete permanently'}
                                      </button>
                                      </>
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
                                  </div>,
                                  document.body,
                                )}
                              </div>
                              )}
                            </div>
                          </td>
                        </tr>

                        {/* Panneau de statistiques, ouvert par le chevron « › ». */}
                        {statsId === rule.id && (
                          <tr className="bg-surface-secondary/30">
                            <td colSpan={9} className="px-6 py-4">
                              {(() => {
                                const s = stats?.[rule.id];
                                if (!stats) {
                                  return (
                                    <p className="text-[12px] text-text-secondary">
                                      {statsIllisibles
                                        ? (fr ? 'Les chiffres n’ont pas pu être lus.' : 'The numbers could not be read.')
                                        : (fr ? 'Lecture des chiffres…' : 'Reading the numbers…')}
                                    </p>
                                  );
                                }
                                const n = (v: number | undefined) => v ?? 0;
                                const ORDRE: GroupeMotif[] = ['doublon', 'desabonne', 'hors_ciblage', 'donnee_manquante', 'condition_plus_valide', 'plafond', 'autre'];
                                const raisons = ORDRE.filter((g) => n(s?.ignorees_par_groupe[g]) > 0);
                                const reports = Object.entries(s?.reportees_par_code ?? {}).filter(([, c]) => c > 0);
                                const dernierIgnore = s?.dernier_ignore ?? null;
                                return (
                                  <div className="space-y-1 text-[12px] text-text-secondary">
                                    <p>
                                      {fr
                                        ? `${libellePeriode(periode, true)} : ${n(s?.declenchees)} déclenchée(s), ${n(s?.envoyees)} message(s) envoyé(s), ${n(s?.echouees)} échec(s), ${n(s?.ignorees)} ignorée(s), ${n(s?.reportees)} reportée(s), ${n(s?.actions)} action(s) interne(s) faite(s). ${n(s?.en_cours)} en cours.`
                                        : `${libellePeriode(periode, false)}: ${n(s?.declenchees)} triggered, ${n(s?.envoyees)} message(s) sent, ${n(s?.echouees)} failure(s), ${n(s?.ignorees)} skipped, ${n(s?.reportees)} postponed, ${n(s?.actions)} internal action(s) done. ${n(s?.en_cours)} in progress.`}
                                    </p>
                                    {/* Les envois ignorés, PAR RAISON — pas seulement un total (constat D-25). */}
                                    {raisons.length > 0 && (
                                      <p>
                                        {fr ? 'Ignorées, par raison : ' : 'Skipped, by reason: '}
                                        {raisons.map((g) => `${libelleGroupe(g, fr)} (${n(s?.ignorees_par_groupe[g])})`).join(' · ')}
                                      </p>
                                    )}
                                    {reports.length > 0 && (
                                      <p>
                                        {fr ? 'Reportées : ' : 'Postponed: '}
                                        {reports.map(([code, c]) => `${libelleIssue(code, fr)} (${c})`).join(' · ')}
                                      </p>
                                    )}
                                    {causeEchec && (
                                      <p>{fr ? 'Dernier échec : ' : 'Last failure: '}{causeEchec}</p>
                                    )}
                                    {/* Un envoi ignoré n'est pas un échec : sa raison, dans la langue de l'écran. */}
                                    {dernierIgnore && (
                                      <p>
                                        {fr ? 'Dernier envoi ignoré : ' : 'Last skipped send: '}
                                        {libelleIssue(dernierIgnore.issue, fr, dernierIgnore.detail)}
                                      </p>
                                    )}
                                    <p>
                                      <Link
                                        to={`/automations/activite?regle=${rule.id}`}
                                        className="font-medium text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                                      >
                                        {fr ? 'Voir l’historique, client par client' : 'See the history, client by client'}
                                      </Link>
                                    </p>
                                  </div>
                                );
                              })()}
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
                                        <ApercuMessage
                                          key={`${rule.id}-apercu-${i}`}
                                          type={e.action?.type === 'send_email' ? 'send_email' : 'send_sms'}
                                          sujet={e.action?.config?.subject ? String(e.action.config.subject) : undefined}
                                          corps={String(e.action?.config?.body ?? '')}
                                          fr={fr}
                                        />
                                      ))}
                                      {peutModifier && (
                                      <button
                                        type="button"
                                        onClick={() => navigate(`/automations/${rule.id}`)}
                                        className="text-[12px] font-medium text-accent hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                                      >
                                        {fr ? 'Modifier dans l’éditeur' : 'Edit in the editor'}
                                      </button>
                                      )}
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
                                  .map((a, i) => (!peutModifier ? (
                                    // Lecture seule : le message tel que le client le lira, sans champ ni « Enregistrer ».
                                    <ApercuMessage
                                      key={`${rule.id}-${a.type}-${i}`}
                                      type={a.type as 'send_sms' | 'send_email'}
                                      sujet={a.config?.subject ? String(a.config.subject) : undefined}
                                      corps={String(a.config?.body ?? '')}
                                      fr={fr}
                                    />
                                  ) : (
                                    <MessageEditor
                                      key={`${rule.id}-${a.type}-${i}`}
                                      ruleId={rule.id}
                                      ruleName={localizeAutomationName(rule.name, language)}
                                      actionType={a.type as 'send_sms' | 'send_email'}
                                      body={String(a.config?.body ?? '')}
                                      subject={a.config?.subject ? String(a.config.subject) : undefined}
                                      fr={fr}
                                      onSaved={load}
                                      declencheur={rule.trigger_event}
                                    />
                                  )))
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

            {/* ══ 7. Pagination ══
                `pr-20` : la place de la bulle « Aide et support » (fixe, à
                20 px du bord, 48 px de large). Quand la pagination est en bas
                de la fenêtre, la bulle recouvrait la flèche de « 10 / page »
                (audit du 2026-10-01). */}
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-outline/30 py-3 pl-4 pr-20 text-[12px]">
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
