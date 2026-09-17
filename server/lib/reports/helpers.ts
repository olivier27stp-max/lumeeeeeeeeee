/**
 * Petits outils partagés par les définitions de rapports.
 */
import type { Bilingue, ReportColumn, ReportContext, Row } from './types';
import { BATCH_SIZE, EXPORT_MAX_ROWS } from './types';

export const L = (fr: string, en: string): Bilingue => ({ fr, en });

/** Raccourcis de colonnes. */
export const col = {
  text: (key: string, fr: string, en: string, extra: Partial<ReportColumn> = {}): ReportColumn => ({ key, label: L(fr, en), type: 'text', sortable: true, ...extra }),
  money: (key: string, fr: string, en: string, extra: Partial<ReportColumn> = {}): ReportColumn => ({ key, label: L(fr, en), type: 'money', sortable: true, total: 'sum', width: '120px', ...extra }),
  date: (key: string, fr: string, en: string, extra: Partial<ReportColumn> = {}): ReportColumn => ({ key, label: L(fr, en), type: 'date', sortable: true, width: '110px', ...extra }),
  datetime: (key: string, fr: string, en: string, extra: Partial<ReportColumn> = {}): ReportColumn => ({ key, label: L(fr, en), type: 'datetime', sortable: true, width: '150px', ...extra }),
  int: (key: string, fr: string, en: string, extra: Partial<ReportColumn> = {}): ReportColumn => ({ key, label: L(fr, en), type: 'integer', sortable: true, total: 'sum', width: '90px', ...extra }),
  hours: (key: string, fr: string, en: string, extra: Partial<ReportColumn> = {}): ReportColumn => ({ key, label: L(fr, en), type: 'hours', sortable: true, total: 'sum', width: '90px', ...extra }),
  percent: (key: string, fr: string, en: string, extra: Partial<ReportColumn> = {}): ReportColumn => ({ key, label: L(fr, en), type: 'percent', sortable: true, width: '90px', ...extra }),
  enum: (key: string, fr: string, en: string, labels: Record<string, Bilingue>, extra: Partial<ReportColumn> = {}): ReportColumn => ({ key, label: L(fr, en), type: 'enum', sortable: true, labels, width: '130px', ...extra }),
};

/** Libellés d'énumérations partagés. */
export const LABELS = {
  invoiceStatus: {
    draft: L('Brouillon', 'Draft'), sent: L('Envoyée', 'Sent'), partial: L('Partielle', 'Partial'),
    paid: L('Payée', 'Paid'), void: L('Annulée', 'Void'),
  },
  paymentStatus: {
    succeeded: L('Réussi', 'Succeeded'), pending: L('En attente', 'Pending'), failed: L('Échoué', 'Failed'), refunded: L('Remboursé', 'Refunded'),
  },
  paymentMethod: {
    card: L('Carte', 'Card'), 'e-transfer': L('Virement Interac', 'E-transfer'), cash: L('Comptant', 'Cash'), check: L('Chèque', 'Check'),
  },
  paymentProvider: { stripe: L('Stripe', 'Stripe'), paypal: L('PayPal', 'PayPal'), manual: L('Manuel', 'Manual') },
  jobDerived: {
    upcoming: L('À venir', 'Upcoming'), late: L('En retard', 'Late'), action_required: L('Action requise', 'Action required'),
    requires_invoicing: L('À facturer', 'Requires invoicing'), archived: L('Archivé', 'Archived'),
  },
  jobType: { one_off: L('Ponctuel', 'One-off'), service_plan: L('Plan de service', 'Service plan'), recurring: L('Récurrent', 'Recurring') },
  quoteStatus: {
    draft: L('Brouillon', 'Draft'), awaiting_response: L('En attente', 'Awaiting response'), changes_requested: L('Modifications demandées', 'Changes requested'),
    approved: L('Approuvé', 'Approved'), declined: L('Refusé', 'Declined'), expired: L('Expiré', 'Expired'),
    converted: L('Converti', 'Converted'), archived: L('Archivé', 'Archived'),
  },
  quoteType: { one_off: L('Ponctuel', 'One-off'), service_plan: L('Plan de service', 'Service plan') },
  clientStatus: { active: L('Actif', 'Active'), inactive: L('Inactif', 'Inactive'), lead: L('Prospect', 'Lead') },
  visitStatus: {
    scheduled: L('Planifiée', 'Scheduled'), completed: L('Complétée', 'Completed'),
    cancelled: L('Annulée', 'Cancelled'), canceled: L('Annulée', 'Cancelled'),
  },
  commissionStatus: { pending: L('En attente', 'Pending'), approved: L('Approuvée', 'Approved'), paid: L('Payée', 'Paid'), reversed: L('Annulée', 'Reversed') },
  timesheetStatus: { active: L('En cours', 'Active'), paused: L('En pause', 'Paused'), completed: L('Complétée', 'Completed') },
  pipelineStage: {
    new_prospect: L('Nouveau prospect', 'New lead'), no_response: L('À rappeler', 'Must recall'), quote_sent: L('Devis envoyé', 'Quote sent'),
    closed_won: L('Gagné', 'Closed won'), closed_lost: L('Perdu', 'Closed lost'),
  },
  yesNo: { yes: L('Oui', 'Yes'), no: L('Non', 'No') },
};

export function optionsFrom(labels: Record<string, Bilingue>, only?: string[]) {
  return Object.entries(labels)
    .filter(([k]) => !only || only.includes(k))
    .map(([value, label]) => ({ value, label }));
}

/** Applique un filtre « select » simple (valeur → égalité colonne), 'all' ou vide = aucun filtre. */
export function eqFilter(builder: any, value: string | undefined, column: string) {
  if (!value || value === 'all') return builder;
  return builder.eq(column, value);
}

/**
 * Recherche texte : ilike sur plusieurs colonnes. Les métacaractères du motif
 * sont échappés et les séparateurs de la syntaxe `or` PostgREST retirés.
 */
export function applySearch(builder: any, term: string | undefined, columns: string[]) {
  const t = String(term || '').trim().replace(/[%_\\]/g, (s) => `\\${s}`).replace(/[,()]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return builder;
  return builder.or(columns.map((c) => `${c}.ilike.%${t}%`).join(','));
}

/** Lit toutes les lignes d'un builder par lots (sources mémoire). Borné par EXPORT_MAX_ROWS. */
export async function readAll(makeBuilder: () => any, max = EXPORT_MAX_ROWS): Promise<Row[]> {
  const out: Row[] = [];
  for (let off = 0; off < max; off += BATCH_SIZE) {
    const { data, error } = await makeBuilder().range(off, off + BATCH_SIZE - 1);
    if (error) throw new Error(error.message);
    const rows = data || [];
    out.push(...rows);
    if (rows.length < BATCH_SIZE) break;
  }
  return out;
}

export function centsOf(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

/** Dollars décimaux (numeric) → cents entiers. */
export function dollarsToCents(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

export function hoursBetween(startIso: unknown, endIso: unknown): number | null {
  if (!startIso || !endIso) return null;
  const a = new Date(String(startIso)).getTime();
  const b = new Date(String(endIso)).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return Math.round(((b - a) / 3_600_000) * 100) / 100;
}

/** Restreint une source service-role aux lignes de l'utilisateur quand il n'est pas owner/admin. */
export function ownScope(builder: any, ctx: ReportContext, column: string) {
  return ctx.isAdmin ? builder : builder.eq(column, ctx.userId);
}
