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
import { useLangueMessages } from '../hooks/useLangueMessages';
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
/** La catégorie d'une automatisation sans préréglage, d'après la famille de son déclencheur (`quote.sent` → `quote`). */
const CATEGORIE_PAR_FAMILLE: Record<string, CategoryKey> = {
  lead: 'Leads',
  quote: 'Quotes', estimate: 'Quotes',
  job: 'Jobs', appointment: 'Jobs', agreement: 'Jobs',
  invoice: 'Invoices',
  payment: 'Payments', deposit: 'Payments',
  review: 'Reviews',
  client: 'Client',
};

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
 * Un texte tel que la RECHERCHE le compare : sans accents, sans casse, apostrophes et espaces
 * unifiés, sans espaces autour. « elan d'ete » trouve « Élan d’été » ; un nom collé avec ses
 * espaces autour se retrouve (triage `04-filtres-recherche-tri:99` et `:106`).
 */
function pourRecherche(s: string): string {
  return s
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * « Ce bureau a-t-il un numéro texto ? », RETENU d'une visite à l'autre (par bureau).
 *
 * La réponse arrive avec les chiffres, que la liste n'attend plus pour s'afficher : le bandeau
 * « Les étapes texto sont sautées… » naissait donc APRÈS le tableau et le poussait de 58 px sous la
 * souris (mesuré au navigateur). Retenue, elle est là dès le premier affichage ; les chiffres la
 * confirment ou la corrigent ensuite. Stockage indisponible : on retombe sur « inconnu », sans bandeau.
 */
const cleTexto = (): string => `lume-automations-texto:${localStorage.getItem('lume-active-org') ?? ''}`;
function lireTextoRetenu(): boolean | null {
  try {
    const v = localStorage.getItem(cleTexto());
    return v === '1' ? true : v === '0' ? false : null;
  } catch {
    return null;
  }
}
function retenirTexto(configure: boolean | null): void {
  try {
    if (configure === null) localStorage.removeItem(cleTexto());
    else localStorage.setItem(cleTexto(), configure ? '1' : '0');
  } catch { /* préférence d'affichage perdue, sans conséquence : le bandeau arrivera avec les chiffres */ }
}

/**
 * LE MESSAGE D'UNE ERREUR, dans la langue de l'écran.
 *
 * Quand le serveur ne donne aucun message (passerelle en panne, corps illisible), le client de
 * l'API (`automationBuilderApi`) rend un REPLI écrit en français seulement : en interface anglaise,
 * « Duplicate » en panne disait « Impossible de dupliquer l'automatisation. » (triage
 * `13-libelles-et-complements:143`). Ces replis-là sont connus : on les dit en anglais.
 * Un message précis venu du serveur est gardé tel quel.
 */
const REPLIS_EN: Record<string, string> = {
  'Impossible de charger les automatisations.': 'Could not load the automations.',
  'Impossible de dupliquer l\'automatisation.': 'Could not duplicate the automation.',
  'Impossible de supprimer l\'automatisation.': 'Could not delete the automation.',
  'Impossible de restaurer l\'automatisation.': 'Could not restore the automation.',
  'Impossible de supprimer définitivement l’automatisation.': 'Could not permanently delete the automation.',
  'Impossible de changer le statut de l’automatisation.': 'Could not change the automation status.',
  'Impossible de changer le statut des automatisations.': 'Could not change the status of the automations.',
  'Impossible de copier l’automatisation.': 'Could not copy the automation.',
  'Impossible de lister vos bureaux.': 'Could not list your offices.',
  'Impossible de lire les dossiers.': 'Could not read the folders.',
  'Impossible de créer le dossier.': 'Could not create the folder.',
  'Impossible de renommer le dossier.': 'Could not rename the folder.',
  'Impossible de supprimer le dossier.': 'Could not delete the folder.',
  // « Déplacer dans un dossier » passe par la modification de l'automatisation.
  'Impossible de modifier l\'automatisation.': 'Could not update the automation.',
};
function messageDErreur(e: unknown, fr: boolean): string {
  const m = e instanceof Error ? e.message : String(e);
  return fr ? m : (REPLIS_EN[m] ?? m);
}

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

/**
 * Le message d'une automatisation à la CORBEILLE : son texte tel qu'il est enregistré, dans un champ
 * en LECTURE SEULE. Le texto d'une automatisation supprimée était modifiable et enregistrable
 * (triage `06-menu-actions:433`) — pour une règle que le moteur ignore.
 */
function MessageFige({ type, sujet, corps, fr }: { type: 'send_sms' | 'send_email'; sujet?: string; corps: string; fr: boolean }) {
  const id = useId();
  return (
    <div className="mb-3 last:mb-0">
      <label htmlFor={id} className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
        {type === 'send_email' ? (fr ? 'Courriel' : 'Email') : (fr ? 'Texto' : 'Text message')}
        {fr ? ' — lecture seule' : ' — read only'}
      </label>
      {type === 'send_email' && sujet ? (
        <p className="mt-1 text-[12px] font-medium text-text-primary">{sujet}</p>
      ) : null}
      <textarea
        id={id}
        readOnly
        rows={3}
        value={corps.replace(/<[^>]+>/g, ' ').replace(/[ \t]+/g, ' ').trim()}
        className="glass-input mt-1 w-full resize-none bg-surface-secondary text-[12px] text-text-secondary"
      />
      <p className="mt-1 text-[11px] text-text-tertiary">
        {fr
          ? 'Cette automatisation est à la corbeille : son message ne se modifie pas. Restaurez-la pour le corriger.'
          : 'This automation is in the bin: its message cannot be edited. Restore it to change it.'}
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
        ? messageDErreur(erreur, frRef.current)
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
  const [textoConfigure, setTextoConfigure] = useState<boolean | null>(() => lireTextoRetenu());
  const [occupeId, setOccupeId] = useState<string | null>(null);
  /** L'automatisation « Client inactif » dont le serveur compte les clients visés, avant la confirmation. */
  const [decompteId, setDecompteId] = useState<string | null>(null);
  /**
   * La langue des messages du bureau — `null` tant qu'on ne la CONNAÎT pas.
   *
   * Elle valait « fr » d'office : lecture en panne sur un bureau réglé en
   * anglais, l'écran surlignait « FR » et affirmait que les messages partaient
   * en français (audit du 2026-10-01). Inconnue, on ne surligne rien.
   */
  /*
   * UNE source, partagée avec la carte des Réglages globaux (`lib/langueMessages.ts`) : le sélecteur
   * d'ici et la carte de là-bas ne peuvent plus dire deux choses (`06-reglages-globaux:116`).
   * `langueIllisible` : la lecture a échoué, on le dit à côté de la bascule.
   */
  const {
    langue: orgLang, illisible: langueIllisible, ecriture: savingLang, changer: ecrireLangue,
  } = useLangueMessages('[automations] langue des messages illisible');

  /**
   * Onglet de la liste — les quatre de GHL. `?onglet=verifier` l'ouvre
   * directement : c'est là que mène « Voir les automatisations à vérifier »
   * de la Vue d'ensemble, qui atterrissait sur « Toutes » (audit V2, A-14).
   */
  /*
   * L'onglet ouvert EST dans l'adresse (triage `03-onglets-etats:86` et `:96`). Il n'y était que LU,
   * à l'arrivée : recharger la page ramenait sur « Toutes », et l'adresse gardait `?onglet=verifier`
   * après un clic sur « Toutes » — un lien copié rouvrait le mauvais onglet. L'adresse est maintenant
   * la seule source : changer d'onglet l'écrit (« Toutes » = pas de paramètre), sans empiler l'historique.
   */
  const [parametres, setParametres] = useSearchParams();
  const demande = parametres.get('onglet');
  const onglet: 'toutes' | 'verifier' | 'corbeille' | 'modeles' =
    demande === 'verifier' || demande === 'corbeille' || demande === 'modeles' ? demande : 'toutes';
  const setOnglet = (cle: 'toutes' | 'verifier' | 'corbeille' | 'modeles') => {
    setParametres((avant) => {
      const suivant = new URLSearchParams(avant);
      if (cle === 'toutes') suivant.delete('onglet'); else suivant.set('onglet', cle);
      return suivant;
    }, { replace: true });
  };
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

  /**
   * La lecture des dossiers a ÉCHOUÉ — ce n'est pas « aucun dossier » (triage `02-dossiers:354`).
   * La barre de dossiers disparaissait sans un mot, et « Déplacer dans un dossier » répondait
   * « Créez d'abord un dossier. » alors qu'il en existait.
   */
  const [dossiersIllisibles, setDossiersIllisibles] = useState(false);
  const lireDossiers = useCallback(() => {
    // Un échec ici ne doit PAS empêcher la page de s'afficher : sans
    // dossiers, la liste reste simplement à plat — et l'écran le dit.
    chargerDossiers()
      .then((d) => { setDossiers(d); setDossiersIllisibles(false); })
      .catch((e: unknown) => {
        console.error('[automations] dossiers', e instanceof Error ? e.message : String(e));
        setDossiersIllisibles(true);
      });
  }, []);
  useEffect(() => { lireDossiers(); }, [lireDossiers]);


  /** Lignes cochées — GHL les utilise pour les actions en lot. */
  const [cochees, setCochees] = useState<Set<string>>(new Set());
  /**
   * La sélection a été ÉTENDUE à toutes les pages de la vue (« Sélectionner les 60 »).
   *
   * « Tout cocher » ne coche que la page affichée : dépublier 60 automatisations demandait six tours
   * (triage `10-volume:164`). L'extension est un geste EXPLICITE, annoncé avec son nombre ; elle ne
   * porte que sur la vue en cours (onglet, dossier, recherche, filtres) et tombe au moindre changement
   * de vue ou de page, comme toute sélection (audit M9 : jamais d'action sur des lignes d'une AUTRE vue).
   */
  const [selectionEtendue, setSelectionEtendue] = useState(false);
  const viderSelection = () => { setCochees(new Set<string>()); setSelectionEtendue(false); };
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
  /** Combien de filtres avancés sont posés (le tri n'en est pas un : il ne retire aucune ligne). */
  const nbFiltres = (filterCategory !== 'all' ? 1 : 0) + (filterStatut !== 'all' ? 1 : 0);
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
   *
   * UN SEUL TRI AFFICHÉ À LA FOIS (triage `04-filtres-recherche-tri:264` et `:413`). Un clic sur un
   * en-tête l'emportait, mais « Trier » continuait d'afficher « Créées le plus récemment » ; et le
   * tri par colonne ne se levait plus (croissant ⇄ décroissant, sans retour à l'ordre par défaut).
   * Trier par une colonne remet « Trier » sur « Ordre par défaut » ; choisir dans « Trier » lève le
   * tri par colonne ; le troisième clic sur un en-tête lève le tri (aucun → croissant → décroissant → aucun).
   */
  const [tri, setTri] = useState<{ cle: CleTri; sens: 'asc' | 'desc' } | null>(null);
  const trierPar = (cle: CleTri) => {
    setTriDate('defaut');
    setTri((t) => (t && t.cle === cle
      ? (t.sens === 'asc' ? { cle, sens: 'desc' } : null)
      : { cle, sens: 'asc' }));
  };
  const choisirTriDate = (valeur: 'defaut' | 'recent' | 'ancien') => {
    setTri(null);
    setTriDate(valeur);
  };

  const changerLangue = async (lang: 'fr' | 'en') => {
    if (lang === orgLang || savingLang) return;
    try {
      // L'écran suit le clic ; il revient en arrière si le serveur refuse (voir `lib/langueMessages.ts`).
      await ecrireLangue(lang);
      toast.success(fr
        ? (lang === 'en' ? 'Messages en anglais' : 'Messages en français')
        : (lang === 'en' ? 'Messages set to English' : 'Messages set to French'));
    } catch (e: unknown) {
      // La RAISON (« seul un administrateur… »), pas un « impossible » muet.
      console.error('[automations] langue des messages', e);
      toast.error(e instanceof Error && e.message
        ? e.message
        : (fr ? 'Impossible de changer la langue' : 'Could not change language'));
    }
  };

  /*
   * Deux chargements qui se croisent (une action, puis une autre avant la
   * réponse) : seul le DERNIER a le droit d'écrire l'écran — une réponse
   * plus ancienne arrivée après ramenait une liste périmée (launch 2026-09-28).
   */
  const dernierChargement = useRef(0);
  /**
   * La liste a déjà été lue une fois : un RECHARGEMENT (après « Dupliquer », une suppression, un
   * rangement…) ne retire plus le tableau pour le remplacer par une roue. L'écran clignotait et la
   * position de lecture était perdue (triage `06-menu-actions:255`). La roue ne sert qu'à la
   * première lecture, et après une panne.
   */
  const dejaLue = useRef(false);
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
      retenirTexto(s.texto_configure ?? null);
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

  const load = useCallback(async (options: { silencieux?: boolean } = {}) => {
    const numero = ++dernierChargement.current;
    const perime = () => numero !== dernierChargement.current;
    /* Un rechargement SILENCIEUX (après l'enregistrement d'un message) ne remplace JAMAIS le tableau
       par la roue : la roue démontait la ligne dépliée, donc l'éditeur de courriel resté ouvert — il
       « disparaissait tout seul » (triage « modèles », `04-courriel:260`, report de l'agent T). Depuis
       `06-menu-actions:255` un rechargement garde déjà le tableau ; `silencieux` le garantit aussi
       quand la lecture précédente avait échoué. */
    if (!dejaLue.current && !options.silencieux) setLoading(true);
    // « Déclenchées », « En cours », les échecs et le détail › : UNE route, comptée en base. Elle part
    // EN MÊME TEMPS que la lecture de la liste, et la liste ne l'ATTEND pas (triage
    // `03-onglets-etats:143`) : le tableau s'affiche dès qu'il est lu, les chiffres se posent ensuite
    // dans leurs colonnes (« … » d'ici là).
    void lireChiffres.current();
    try {
      const data = await getAutomationRules();
      if (perime()) return;
      dejaLue.current = true;
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
    } catch (e: any) {
      if (perime()) return;
      console.error('Failed to load rules:', e.message);
      // Après une panne, « Réessayer » repasse par la roue : il n'y a plus de tableau à garder.
      dejaLue.current = false;
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
  /*
   * Le champ de nom REMPLACE le bouton « Nouveau dossier » : à sa fermeture (Échap, « Annuler », ou
   * le dossier créé) le focus retombait sur le corps de la page — au clavier, on repartait du tout
   * début (triage `11-clavier:113`). Il revient sur le bouton.
   */
  const boutonNouveauDossier = useRef<HTMLButtonElement>(null);
  const focusAuBoutonDossier = useRef(false);
  const fermerSaisieDossier = () => {
    focusAuBoutonDossier.current = true;
    setSaisieDossier(false);
    setNomDossier('');
  };
  useEffect(() => {
    if (saisieDossier || !focusAuBoutonDossier.current) return;
    focusAuBoutonDossier.current = false;
    boutonNouveauDossier.current?.focus();
  }, [saisieDossier]);
  const validerNouveauDossier = async () => {
    const nom = nomDossier.trim();
    if (!nom) { fermerSaisieDossier(); return; }
    if (creationDossierEnVol.current) return;
    creationDossierEnVol.current = true;
    try {
      const d = await creerDossier(nom);
      setDossiers((prev) => [...prev, d].sort((a, b) => a.name.localeCompare(b.name)));
      fermerSaisieDossier();
      toast.success(fr ? `Dossier « ${d.name} » créé` : `Folder “${d.name}” created`);
    } catch (e: unknown) {
      toast.error(messageDErreur(e, fr));
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
      toast.error(messageDErreur(e, fr));
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
      // Créer un dossier disait « Dossier créé » ; le supprimer ne disait rien (triage `02-dossiers:283`).
      toast.success(fr ? `Dossier « ${nom} » supprimé` : `Folder “${nom}” deleted`);
      await load();
    } catch (e: unknown) {
      toast.error(messageDErreur(e, fr));
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
      toast.error(messageDErreur(e, fr));
    }
  };

  useEffect(() => { void load(); }, [load]);

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
  useEffect(() => { viderSelection(); }, [onglet, dossierActif, page, parPage, search, filterCategory, filterStatut]);

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
      // Le serveur compte les clients : tant qu'il n'a pas répondu, l'interrupteur MONTRE qu'il travaille.
      // Rien ne bougeait, on croyait que le clic n'avait pas pris (triage `05-lignes:336`).
      setDecompteId(rule.id);
      try {
        n = await apercuClientsInactifs(Number((rule.conditions as Record<string, unknown> | null)?.mois ?? 6));
      } catch (e) {
        console.error('[Automations] aperçu clients inactifs', e);
      } finally {
        setDecompteId(null);
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

  /*
   * UNE copie à la fois par automatisation (triage `06-menu-actions:217`). Pendant que la copie se
   * crée, la roue remplace « ⋮ » mais le bouton reste cliquable : rouvrir le menu et recliquer
   * « Dupliquer » créait une seconde copie.
   */
  const duplicationsEnVol = useRef(new Set<string>());
  const dupliquer = async (regle: AutomationRule, ouvrir = false) => {
    if (duplicationsEnVol.current.has(regle.id)) {
      toast.info(fr ? 'La copie est déjà en cours de création.' : 'The copy is already being created.', { id: `copie-${regle.id}` });
      return;
    }
    duplicationsEnVol.current.add(regle.id);
    setOccupeId(regle.id);
    try {
      const copie = await dupliquerAutomatisation(regle.id);
      toast.success(fr ? 'Copie créée — elle est en brouillon' : 'Copy created — it is a draft');
      if (ouvrir) { navigate(`/automations/${copie.id}`); return; }
      await load();
    } catch (e: unknown) {
      toast.error(messageDErreur(e, fr));
    } finally {
      duplicationsEnVol.current.delete(regle.id);
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
      toast.error(messageDErreur(e, fr));
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
      toast.error(messageDErreur(e, fr));
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
      toast.error(messageDErreur(e, fr));
    } finally {
      setOccupeId(null);
    }
  };

  /*
   * La catégorie d'une automatisation : celle de son préréglage, sinon celle de son DÉCLENCHEUR.
   * Toute automatisation créée par l'utilisateur tombait dans « Suivi » : une relance bâtie sur
   * « Devis envoyé » n'apparaissait pas sous le filtre « Devis » (triage `04-filtres-recherche-tri:205`).
   */
  const getCategory = (r: AutomationRule): CategoryKey =>
    (PRESET_META[r.preset_key || '']?.category as CategoryKey | undefined)
    ?? CATEGORIE_PAR_FAMILLE[(r.trigger_event || '').split('.')[0]]
    ?? 'Follow-up';

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

  /**
   * Le déclencheur d'une ligne, tel qu'il est écrit sous son nom. Le libellé du CATALOGUE d'abord —
   * celui de l'éditeur : « Lead créé » ici, « Nouveau prospect » là-bas, pour le même déclencheur
   * (audit V2, A-16). La table locale ne sert plus qu'aux événements hors catalogue.
   */
  const libelleDeclencheur = (r: AutomationRule): string => {
    const d = trouverDeclencheur(r.trigger_event) ?? TRIGGER_DISPLAY[r.trigger_event];
    // Hors catalogue ET hors table locale : jamais la clé technique (« e2e.declencheur_inconnu »)
    // sous le nom d'une ligne (triage `05-lignes:119`).
    return d ? (fr ? d.fr : d.en) : (fr ? 'Déclencheur inconnu' : 'Unknown trigger');
  };
  /** Le sous-titre d'une ligne : le déclencheur, puis le délai ou le nombre d'étapes. */
  const sousTitre = (r: AutomationRule): string => {
    const n = Array.isArray(r.steps) ? r.steps.length : 0;
    const suite = n > 0
      // « 1 étapes » (QA 2026-09-25, P2-11).
      ? (fr ? `${n} étape${n > 1 ? 's' : ''}` : `${n} step${n > 1 ? 's' : ''}`)
      : formatDelay(r.delay_seconds, language);
    return `${libelleDeclencheur(r)} · ${suite}`;
  };

  /** Ce qu'on cherche, tel qu'on le compare (vide = pas de recherche, même si le champ ne contient que des espaces). */
  const recherche = pourRecherche(search);
  /*
   * ON TROUVE CE QU'ON VOIT, ET ON VOIT POURQUOI (triage `04-filtres-recherche-tri:113` et `:123`).
   * La recherche fouillait le nom et la description interne — que la liste n'affiche nulle part —
   * mais pas le sous-titre (« Facture payée · 30 min après »), écrit sous chaque nom. Elle fouille
   * maintenant les trois ; une ligne trouvée par sa SEULE description montre l'extrait qui l'a fait
   * trouver (`extraitTrouve`).
   */
  const extraitTrouve = (r: AutomationRule): string | null => {
    if (!recherche || !r.description) return null;
    if (pourRecherche(localizeAutomationName(r.name, language)).includes(recherche)) return null;
    if (pourRecherche(sousTitre(r)).includes(recherche)) return null;
    const i = pourRecherche(r.description).indexOf(recherche);
    if (i < 0) return null;
    // Les positions sont celles du texte comparé (sans accents) : à quelques caractères près, la fenêtre suffit.
    const debut = Math.max(0, i - 40);
    const fin = Math.min(r.description.length, i + recherche.length + 60);
    return `${debut > 0 ? '… ' : ''}${r.description.slice(debut, fin).trim()}${fin < r.description.length ? ' …' : ''}`;
  };
  const filtrees = sourceOnglet.filter((r) => {
    if (recherche) {
      const trouve = pourRecherche(localizeAutomationName(r.name, language)).includes(recherche)
        || pourRecherche(sousTitre(r)).includes(recherche)
        || pourRecherche(r.description || '').includes(recherche);
      if (!trouve) return false;
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
    if (toutCoche) { viderSelection(); return; }
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
  const reglesCochees = (selectionEtendue ? triees : visibles).filter((r) => cochees.has(r.id));
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
      viderSelection();
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
    if (cibles.length === 0) { viderSelection(); return; }
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
      // Le serveur accepte 200 automatisations par appel : une sélection étendue part par tranches.
      const ids = cibles.map((r) => r.id);
      const resultats: Awaited<ReturnType<typeof changerPublicationEnLot>> = [];
      for (let i = 0; i < ids.length; i += 200) {
        resultats.push(...await changerPublicationEnLot(ids.slice(i, i + 200), actif));
      }
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
        // UN REFUS PAR LIGNE (triage `07-lot:159`). Les refus étaient joints par un saut de ligne que le
        // toast n'affiche pas : deux refus tenaient sur une ligne continue, illisible.
        toast.error(
          <span className="whitespace-pre-line">{echecs.map((e) => `« ${nomDe(e.id)} » — ${e.erreur ?? ''}`).join('\n')}</span>,
          { duration: 15_000 },
        );
      }
      viderSelection();
      await load();
    } catch (e: unknown) {
      console.error('[automations] publication en lot échouée', e);
      toast.error(messageDErreur(e, fr));
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
                    if (e.key === 'Escape') fermerSaisieDossier();
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
                  onClick={fermerSaisieDossier}
                  className="text-[13px] text-text-secondary hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  {fr ? 'Annuler' : 'Cancel'}
                </button>
              </span>
            ) : (
              <button
                type="button"
                ref={boutonNouveauDossier}
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
                /*
                 * Des onglets (`role="tab"`) se parcourent aux FLÈCHES (triage `11-clavier:50`) : un
                 * seul arrêt de tabulation — l'onglet ouvert —, flèches gauche / droite (en boucle),
                 * Début / Fin ; l'onglet atteint s'ouvre. C'étaient quatre arrêts de tabulation.
                 */
                tabIndex={onglet === o.cle ? 0 : -1}
                onKeyDown={(e) => {
                  const i = ONGLETS.findIndex((x) => x.cle === o.cle);
                  const vers = e.key === 'ArrowRight' ? (i + 1) % ONGLETS.length
                    : e.key === 'ArrowLeft' ? (i - 1 + ONGLETS.length) % ONGLETS.length
                    : e.key === 'Home' ? 0
                    : e.key === 'End' ? ONGLETS.length - 1
                    : -1;
                  if (vers < 0) return;
                  e.preventDefault();
                  setOnglet(ONGLETS[vers].cle);
                  document.getElementById(`${idOnglets}-${ONGLETS[vers].cle}`)?.focus();
                }}
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

        {dossiersIllisibles && (
          <div role="alert" className="flex flex-wrap items-center gap-2.5 rounded-xl border border-warning/40 bg-warning-light px-3 py-2 text-[13px] text-text-primary">
            <AlertTriangle size={15} className="shrink-0 text-warning" aria-hidden="true" />
            <span>
              {fr
                ? 'Impossible de lire les dossiers pour le moment : la liste est affichée sans eux. Aucun dossier n’a été supprimé.'
                : 'The folders could not be read right now: the list is shown without them. No folder was deleted.'}
            </span>
            <button type="button" onClick={lireDossiers} className="glass-button text-[12px]">
              {fr ? 'Réessayer' : 'Try again'}
            </button>
          </div>
        )}

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
            {/* Panneau fermé, un filtre actif vidait la liste sans que rien ne le rappelle
                (triage `04-filtres-recherche-tri:160`) : le bouton dit combien de filtres sont posés. */}
            {nbFiltres > 0 && (
              <span className="rounded-full bg-text-primary px-1.5 text-[11px] font-semibold tabular-nums text-white">
                <span aria-hidden="true">(</span>{nbFiltres}<span aria-hidden="true">)</span>
                <span className="sr-only">{fr ? ` filtre${nbFiltres > 1 ? 's' : ''} actif${nbFiltres > 1 ? 's' : ''}` : ` active filter${nbFiltres > 1 ? 's' : ''}`}</span>
              </span>
            )}
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
              onChange={(e) => choisirTriDate(e.target.value as typeof triDate)}
              className="glass-input"
            >
              <option value="defaut">{fr ? 'Ordre par défaut' : 'Default order'}</option>
              <option value="recent">{fr ? 'Créées le plus récemment' : 'Newest first'}</option>
              <option value="ancien">{fr ? 'Créées le plus anciennement' : 'Oldest first'}</option>
            </select>
          </div>
        )}

        {/*
          LE FIL D'ARIANE ET LA BARRE DE LOT PARTAGENT UNE RANGÉE, de hauteur réservée.
          La barre s'insérait AU-DESSUS du tableau à la première case cochée : toutes les lignes
          descendaient de 70 px sous la souris, et le clic suivant tombait sur une autre ligne
          (triage `07-lot:97`). Elle apparaît maintenant à droite du fil d'Ariane, dans une rangée
          qui a déjà sa hauteur : le tableau ne bouge pas.
          À TOUTE LARGEUR : sur une tablette la barre ne tient pas sur une ligne ; plutôt que de passer
          sur deux lignes (et de repousser le tableau), elle défile à l'horizontale dans sa rangée.
        */}
        <div data-rangee-lot className="flex min-h-[48px] items-center justify-between gap-x-4">
        {/* ══ 5. Fil d'Ariane ══
            C'était « Accueil », texte fixe : il ne disait pas où l'on est et ne ramenait nulle part
            (triage `02-dossiers:150`). Il nomme le dossier ouvert, et « Accueil » en fait sortir. */}
        <nav aria-label={fr ? 'Fil d’Ariane' : 'Breadcrumb'} className="flex shrink-0 items-center gap-1.5 text-[13px] text-text-secondary">
          {dossierActif === null ? (
            <span aria-current="page">{fr ? 'Accueil' : 'Home'}</span>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setDossierActif(null)}
                className="rounded underline hover:text-text-primary hover:no-underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                {fr ? 'Accueil' : 'Home'}
              </button>
              <ChevronRight size={12} aria-hidden="true" />
              <span aria-current="page" className="font-medium text-text-primary">
                {dossierActif === 'racine'
                  ? (fr ? 'Sans dossier' : 'No folder')
                  : (dossiers.find((d) => d.id === dossierActif)?.name ?? '…')}
              </span>
            </>
          )}
        </nav>

        {/*
          La barre d'actions groupées — elle n'apparaît QUE s'il y a une
          sélection, comme chez GoHighLevel. Dans la corbeille : « Restaurer »
          et « Supprimer définitivement ».
        */}
        {reglesCochees.length > 0 && (
          <div className="flex min-w-0 items-center gap-2 overflow-x-auto whitespace-nowrap rounded-xl border border-border bg-surface-secondary px-3 py-1 [scrollbar-width:none]">
            <span className="text-[13px] font-medium text-text-primary">
              {fr
                ? `${reglesCochees.length} sélectionnée(s)`
                : `${reglesCochees.length} selected`}
              {selectionEtendue && (fr ? ', sur toutes les pages' : ', across all pages')}
            </span>
            {toutCoche && !selectionEtendue && triees.length > visibles.length && (
              <button
                type="button"
                onClick={() => { setCochees(new Set(triees.map((r) => r.id))); setSelectionEtendue(true); }}
                disabled={lotEnCours}
                className="rounded text-[12px] font-medium text-primary underline hover:no-underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
              >
                {fr ? `Sélectionner les ${triees.length}` : `Select all ${triees.length}`}
              </button>
            )}
            <div className="flex items-center gap-1.5">
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
                    /* « Publier (0) » était actif : son clic vidait la sélection sans un mot
                       (triage `07-lot:179`). Rien à faire = bouton grisé, avec la raison. */
                    disabled={lotEnCours || nbAPublier === 0}
                    title={nbAPublier === 0 ? (fr ? 'Aucune des automatisations cochées n’est en brouillon.' : 'None of the selected automations is a draft.') : undefined}
                    className="glass-button inline-flex items-center gap-1.5 text-[12px] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <ToggleRight size={13} aria-hidden="true" />
                    {fr ? `Publier (${nbAPublier})` : `Publish (${nbAPublier})`}
                  </button>
                  <button
                    type="button"
                    onClick={() => void depublierLot()}
                    disabled={lotEnCours || nbADepublier === 0}
                    title={nbADepublier === 0 ? (fr ? 'Aucune des automatisations cochées n’est publiée.' : 'None of the selected automations is published.') : undefined}
                    className="glass-button inline-flex items-center gap-1.5 text-[12px] disabled:cursor-not-allowed disabled:opacity-50"
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
                onClick={() => viderSelection()}
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
        </div>

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
                        /* Une partie des lignes cochées : l'état INTERMÉDIAIRE (tiret), pas une case vide
                           (triage `07-lot:66`). Il n'existe qu'en propriété du champ, pas en attribut. */
                        ref={(el) => { if (el) el.indeterminate = !toutCoche && visibles.some((r) => cochees.has(r.id)); }}
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
                          {/*
                            Une recherche ou un filtre qui ne trouve rien n'est PAS « Aucune automatisation »
                            (triage `03-onglets-etats:277`) : le bureau en a peut-être 35. On dit ce qui a
                            vidé la liste — dans n'importe quel onglet —, et on propose de le lever.
                          */}
                          {search.trim() !== ''
                            ? (fr ? `Aucun résultat pour « ${search.trim()} »` : `No results for “${search.trim()}”`)
                            : filterCategory !== 'all' || filterStatut !== 'all'
                              ? (fr ? 'Aucune automatisation ne correspond à ces filtres' : 'No automation matches these filters')
                            : onglet === 'corbeille'
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
                        {search.trim() !== '' ? (
                          <button type="button" onClick={() => setSearch('')} className="glass-button mt-4">
                            {fr ? 'Effacer la recherche' : 'Clear the search'}
                          </button>
                        ) : (filterCategory !== 'all' || filterStatut !== 'all') && (
                          <button
                            type="button"
                            onClick={() => { setFilterCategory('all'); setFilterStatut('all'); }}
                            className="glass-button mt-4"
                          >
                            {fr ? 'Réinitialiser les filtres' : 'Reset the filters'}
                          </button>
                        )}
                        {/*
                          Un bureau sans aucune automatisation : « Aucune automatisation », seul, ne
                          disait ni pourquoi ni quoi faire (triage `03-onglets-etats:266`). L'état vide
                          propose lui-même de créer — à qui en a le droit, et seulement quand la liste
                          est vraiment vide (ni recherche, ni filtre, ni dossier ouvert).
                        */}
                        {onglet === 'toutes' && peutModifier && search.trim() === '' && filterCategory === 'all' && filterStatut === 'all' && dossierActif === null && (
                          <>
                            <p className="mt-1 text-[12px] text-text-secondary">
                              {fr
                                ? 'Partez de zéro, ou choisissez un modèle prêt à l’emploi dans le menu « Créer ».'
                                : 'Start from scratch, or pick a ready-made template from the “Create workflow” menu.'}
                            </p>
                            <button
                              type="button"
                              onClick={() => partirDeZero(false)}
                              className="glass-button-primary mt-4 inline-flex items-center gap-1.5"
                            >
                              <Plus size={13} aria-hidden="true" />
                              {fr ? 'Créer une automatisation' : 'Create an automation'}
                            </button>
                          </>
                        )}
                        {onglet === 'toutes' && modeles.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setOnglet('modeles')}
                            className="glass-button ml-2 mt-4 inline-flex items-center gap-1.5"
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
                    const extrait = extraitTrouve(rule);
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
                                <span className="block text-[11px] text-text-tertiary">{sousTitre(rule)}</span>
                                {extrait && (
                                  <span className="block text-[11px] text-text-tertiary">
                                    {fr ? 'Description : ' : 'Description: '}{extrait}
                                  </span>
                                )}
                              </span>
                            </NomDeLigne>
                            {/*
                              Les mentions de la ligne, HORS du bouton du nom. Elles étaient dedans :
                              cliquer « Activez-les dans Paramètres › Avis clients. » ouvrait l'éditeur de
                              l'automatisation (triage `05-lignes:148`). L'avertissement mène maintenant
                              aux réglages d'avis. `pl-[34px]` : sous le nom, après l'icône.
                            */}
                            {avisOk === false && rule.is_active && !rule.deleted_at && demandeUnAvis(rule) && (
                              <p className="mt-0.5 flex items-start gap-1 pl-[34px] text-[11px] text-amber-700 dark:text-amber-400">
                                <AlertTriangle size={11} className="mt-px shrink-0" aria-hidden="true" />
                                <span>
                                  {fr ? 'Les demandes d’avis sont désactivées : rien ne part. ' : 'Review requests are turned off: nothing goes out. '}
                                  <Link
                                    to="/settings/reviews"
                                    className="font-medium underline hover:no-underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                                  >
                                    {fr ? 'Activez-les dans Paramètres › Avis clients.' : 'Turn them on in Settings › Customer reviews.'}
                                  </Link>
                                </span>
                              </p>
                            )}
                            {rule.modele_id && (
                              <p className="mt-0.5 flex items-center gap-1 pl-[34px] text-[11px] text-text-tertiary" title={fr ? 'Suit l’automatisation d’un autre bureau ; la modifier ici la détache.' : 'Follows an automation from another office; editing it here detaches it.'}>
                                <Link2 size={11} aria-hidden="true" />
                                {fr ? 'Copie liée à un autre bureau' : 'Linked copy from another office'}
                              </p>
                            )}
                            {echecs > 0 && (
                              <p className="mt-0.5 flex items-center gap-1 pl-[34px] text-[11px] text-danger">
                                <AlertTriangle size={11} className="shrink-0" aria-hidden="true" />
                                <span>
                                  {echecs} {fr ? `échec(s) dans les ${periode} derniers jours` : `failure(s) in the last ${periode} days`}
                                  {/* POURQUOI, en mots du métier — jamais le message technique brut. */}
                                  {causeEchec && ` — ${causeEchec}`}
                                </span>
                              </p>
                            )}
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
                              {/* À la corbeille, l'interrupteur est ÉTEINT quoi que dise `is_active` en base :
                                  « Supprimée » à gauche et un interrupteur vert à droite se contredisaient
                                  (triage `05-lignes:78`). */}
                              {/* Grisé, l'interrupteur DIT POURQUOI : au survol (`title`) et à un lecteur d'écran
                                  (texte masqué) — rôle en lecture seule, ou automatisation à la corbeille. */}
                              <span
                                className="inline-flex"
                                title={!peutModifier ? raisonLectureSeule
                                  : rule.deleted_at ? (fr ? 'À la corbeille : restaurez-la pour la publier.' : 'In the bin: restore it to publish it.')
                                  : undefined}
                              >
                              <InterrupteurPublication
                                actif={rule.is_active && !rule.deleted_at}
                                onBascule={() => handleToggle(rule)}
                                enCours={fileBascule.enCours(rule.id) || decompteId === rule.id}
                                desactive={!!rule.deleted_at || !peutModifier}
                                libelle={rule.is_active && !rule.deleted_at
                                  ? (fr ? `Repasser ${localizeAutomationName(rule.name, language)} en brouillon` : `Unpublish ${localizeAutomationName(rule.name, language)}`)
                                  : (fr ? `Publier ${localizeAutomationName(rule.name, language)}` : `Publish ${localizeAutomationName(rule.name, language)}`)}
                                fr={fr}
                              />
                              {(!peutModifier || rule.deleted_at) && (
                                <span className="sr-only">
                                  {!peutModifier ? raisonLectureSeule : (fr ? 'À la corbeille : restaurez-la pour la publier.' : 'In the bin: restore it to publish it.')}
                                </span>
                              )}
                              </span>

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
                                  aria-busy={occupeId === rule.id}
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
                                        // Dossiers illisibles : on ne prétend pas qu'il n'y en a aucun.
                                        if (dossiersIllisibles) {
                                          setMenuLigne(null);
                                          toast.error(fr
                                            ? 'Les dossiers n’ont pas pu être lus : réessayez avant de ranger cette automatisation.'
                                            : 'The folders could not be read: try again before moving this automation.');
                                          lireDossiers();
                                          return;
                                        }
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
                                    {/* La phrase renvoyait à un onglet sans y mener (triage `05-lignes:409`) :
                                        « Journaux » est un lien, vers les journaux de CETTE automatisation. */}
                                    <p>
                                      {fr ? 'Le détail est dans l’onglet « ' : 'The detail is in the “'}
                                      <Link
                                        to={`/automations/activite?regle=${rule.id}&vue=journaux`}
                                        className="font-medium text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                                      >
                                        {fr ? 'Journaux' : 'Logs'}
                                      </Link>
                                      {fr ? ' » de l’automatisation.' : '” tab of the automation.'}
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
                                      {peutModifier && !rule.deleted_at && (
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
                                  .map((a, i, messages) => (rule.deleted_at ? (
                                    <MessageFige
                                      key={`${rule.id}-${a.type}-${i}`}
                                      type={a.type as 'send_sms' | 'send_email'}
                                      sujet={a.config?.subject ? String(a.config.subject) : undefined}
                                      corps={String(a.config?.body ?? '')}
                                      fr={fr}
                                    />
                                  ) : !peutModifier ? (
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
                                      // LE message de cette ligne : son rang parmi ceux du même type (deux textos ne s'écrasent plus).
                                      rang={messages.slice(0, i).filter((m) => m.type === a.type).length}
                                      // La version anglaise et la langue du bureau : le champ montre le texte qui PART.
                                      bodyEn={typeof a.config?.body_en === 'string' ? a.config.body_en : undefined}
                                      langueBureau={langueIllisible ? null : orgLang ?? undefined}
                                      // À la corbeille : on lit, on ne modifie pas. (Aujourd'hui la corbeille passe par
                                      // `MessageFige`, plus haut ; la propriété est là pour le jour où l'éditeur la porte.)
                                      lectureSeule={!!rule.deleted_at}
                                      ruleId={rule.id}
                                      ruleName={localizeAutomationName(rule.name, language)}
                                      actionType={a.type as 'send_sms' | 'send_email'}
                                      body={String(a.config?.body ?? '')}
                                      subject={a.config?.subject ? String(a.config.subject) : undefined}
                                      fr={fr}
                                      onSaved={() => { void load({ silencieux: true }); }}
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
          // La modale s'ouvre depuis le menu « ⋮ », qui a disparu : le focus revient à son bouton.
          onClose={() => { setCopieVers(null); ouvreurMenu.current?.focus({ preventScroll: true }); }}
          onFini={() => { void load(); }}
        />
      )}
    </PermissionGate>
  );
}
