/**
 * Les mots de Lumi — copiés à l'identique du web pour que les deux plateformes
 * disent exactement la même chose.
 *
 * Source : `src/pages/Lumi.tsx` (LIBELLES_OUTILS) et
 * `src/components/lumi/CarteAutorisation.tsx` (VERBES).
 *
 * Note : Lumi web n'utilise PAS le dictionnaire i18n — tous ses textes sont des
 * ternaires `fr ? … : …` dans le composant. On reproduit ce choix ici, sinon
 * les deux dictionnaires devraient rester synchronisés pour rien.
 */
import type { NomIconeLumi } from '@/components/lumi/IconeLumi';

/* ── Ce qu'un outil est en train de faire ─────────────────────────────── */
const LIBELLES_OUTILS: Record<string, [string, string]> = {
  search_clients: ['Recherche des clients', 'Searching clients'],
  search_leads: ['Recherche des prospects', 'Searching leads'],
  list_jobs: ['Consulte les jobs', 'Checking jobs'],
  get_job: ['Consulte un job', 'Checking a job'],
  query_schedule: ["Consulte l'horaire", 'Checking the schedule'],
  find_dates_in_location: ['Cherche des dates', 'Finding dates'],
  list_quotes: ['Consulte les devis', 'Checking quotes'],
  list_invoices: ['Consulte les factures', 'Checking invoices'],
  get_overdue_payments: ['Consulte les paiements en retard', 'Checking overdue payments'],
  get_revenue_summary: ['Calcule les revenus', 'Computing revenue'],
  get_financial_overview: ['Consulte les finances', 'Checking finances'],
  get_day_route: ['Prépare la tournée', 'Preparing the route'],
  get_company_info: ["Consulte l'entreprise", 'Checking company info'],
  get_morning_briefing: ['Prépare le survol du jour', 'Preparing the daily brief'],
  get_team: ["Consulte l'équipe", 'Checking the team'],
  recall_notes: ['Se souvient', 'Recalling notes'],
  build_report: ['Prépare le rapport', 'Building the report'],
};

export function libelleOutil(name: string, fr: boolean): string {
  const l = LIBELLES_OUTILS[name];
  if (l) return fr ? l[0] : l[1];
  return name.replace(/_/g, ' ');
}

/* ── Ce que Lumi veut faire, en mots courants ─────────────────────────── */
export interface VerbeLumi {
  fr: string;
  en: string;
  /** « Toujours confirmer LES SOUMISSIONS ». */
  type: string;
  typeEn: string;
  icone: NomIconeLumi;
}

const VERBES: Record<string, VerbeLumi> = {
  create_quote: { fr: 'créer une soumission', en: 'create a quote', type: 'les soumissions', typeEn: 'quotes', icone: 'document' },
  create_invoice: { fr: 'créer une facture', en: 'create an invoice', type: 'les factures', typeEn: 'invoices', icone: 'document' },
  create_invoice_from_job: { fr: 'facturer un job', en: 'invoice a job', type: 'les factures', typeEn: 'invoices', icone: 'document' },
  send_quote: { fr: 'envoyer une soumission', en: 'send a quote', type: 'les envois de soumissions', typeEn: 'quote sends', icone: 'envoyer' },
  send_invoice: { fr: 'envoyer une facture', en: 'send an invoice', type: 'les envois de factures', typeEn: 'invoice sends', icone: 'envoyer' },
  send_payment_reminders: { fr: 'envoyer des relances', en: 'send payment reminders', type: 'les relances', typeEn: 'reminders', icone: 'courriel' },
  send_sms: { fr: 'envoyer un texto', en: 'send a text message', type: 'les textos', typeEn: 'text messages', icone: 'texto' },
  send_email: { fr: 'envoyer un courriel', en: 'send an email', type: 'les courriels', typeEn: 'emails', icone: 'courriel' },
  create_job: { fr: 'créer un job', en: 'create a job', type: 'les jobs', typeEn: 'jobs', icone: 'job' },
  update_job: { fr: 'modifier un job', en: 'update a job', type: 'les modifications de jobs', typeEn: 'job updates', icone: 'job' },
  reschedule_job: { fr: 'déplacer un job', en: 'reschedule a job', type: 'les déplacements de jobs', typeEn: 'job reschedules', icone: 'job' },
  create_task: { fr: 'créer une tâche', en: 'create a task', type: 'les tâches', typeEn: 'tasks', icone: 'tache' },
  update_task: { fr: 'modifier une tâche', en: 'update a task', type: 'les modifications de tâches', typeEn: 'task updates', icone: 'tache' },
  create_client: { fr: 'créer un client', en: 'create a client', type: 'les nouveaux clients', typeEn: 'new clients', icone: 'client' },
  update_client: { fr: 'modifier un client', en: 'update a client', type: 'les modifications de clients', typeEn: 'client updates', icone: 'client' },
  mark_invoice_paid: { fr: 'marquer une facture payée', en: 'mark an invoice paid', type: 'les paiements', typeEn: 'payments', icone: 'document' },
  remember_this: { fr: 'retenir quelque chose', en: 'remember something', type: 'les notes', typeEn: 'notes', icone: 'crayon' },
  merge_clients: { fr: 'fusionner deux fiches clients', en: 'merge two client records', type: 'les fusions de fiches', typeEn: 'client merges', icone: 'fusion' },
  forget_note: { fr: 'oublier une note', en: 'forget a note', type: 'les notes', typeEn: 'notes', icone: 'crayon' },
};

export function verbe(tool: string, capacite: string | null): VerbeLumi {
  const v = VERBES[tool];
  if (v) return v;
  const humain = capacite || tool.replace(/_/g, ' ');
  return { fr: humain, en: humain, type: humain, typeEn: humain, icone: 'crayon' };
}

/* ── Formats ──────────────────────────────────────────────────────────── */

/** Les montants arrivent en cents et s'affichent en dollars canadiens. */
export function fmtMontant(cents: number): string {
  const v = (cents / 100).toLocaleString('fr-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${v} $`;
}

export function fmtDollars(cents: number): string {
  return `${(cents / 100).toFixed(2)} $`;
}

export function fmtTokens(n: number, fr: boolean): string {
  return n.toLocaleString(fr ? 'fr-CA' : 'en-CA');
}

/** « claude-sonnet-5 » → « Sonnet 5 ». */
export function nomModele(m: string | null | undefined): string {
  if (!m) return '';
  const x = m.replace(/^claude-/, '').replace(/-(\d+)-(\d+)$/, ' $1.$2').replace(/-(\d+)$/, ' $1');
  return x.charAt(0).toUpperCase() + x.slice(1);
}

export function fmtDate(d: Date, fr: boolean): string {
  return d.toLocaleDateString(fr ? 'fr-CA' : 'en-CA', { day: 'numeric', month: 'short', year: 'numeric' });
}

/* ── Les 4 suggestions de départ — les mêmes qu'au web ────────────────── */
export const TYPE_FICHE: Record<string, [string, string]> = {
  client: ['Client', 'Client'],
  lead: ['Prospect', 'Lead'],
  job: ['Job', 'Job'],
  quote: ['Soumission', 'Quote'],
  invoice: ['Facture', 'Invoice'],
  task: ['Tâche', 'Task'],
};
