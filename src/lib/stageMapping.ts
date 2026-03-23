/**
 * Centralized stage/status mapping for leads and pipeline deals.
 * Single source of truth — replaces duplicated maps in pipelineApi, leadsApi, and server/routes/leads.
 */

// ── DB slugs (what the database stores) ──
export const STAGE_SLUGS = ['new_prospect', 'no_response', 'quote_sent', 'closed_won', 'closed_lost'] as const;
export type StageSlug = (typeof STAGE_SLUGS)[number];

// ── Display labels ──
export const STAGE_LABELS = ['New Prospect', 'No Response', 'Quote Sent', 'Closed Won', 'Closed Lost'] as const;
export type StageLabel = (typeof STAGE_LABELS)[number];

// ── Slug → Label ──
export const SLUG_TO_LABEL: Record<string, StageLabel> = {
  new_prospect: 'New Prospect',
  no_response: 'No Response',
  quote_sent: 'Quote Sent',
  closed_won: 'Closed Won',
  closed_lost: 'Closed Lost',
};

// ── Label → Slug ──
export const LABEL_TO_SLUG: Record<string, StageSlug> = {
  'New Prospect': 'new_prospect',
  'No Response': 'no_response',
  'Quote Sent': 'quote_sent',
  'Closed Won': 'closed_won',
  'Closed Lost': 'closed_lost',
};

// ── Legacy value aliases → canonical slug ──
const LEGACY_ALIASES: Record<string, StageSlug> = {
  new: 'new_prospect',
  follow_up_1: 'no_response',
  follow_up_2: 'quote_sent',
  follow_up_3: 'quote_sent',
  closed: 'closed_won',
  lost: 'closed_lost',
  contacted: 'no_response',
  contact: 'no_response',
  estimate_sent: 'quote_sent',
  follow_up: 'no_response',
  won: 'closed_won',
  qualified: 'new_prospect',
  archived: 'closed_lost',
  lead: 'new_prospect',
  proposal: 'no_response',
  negotiation: 'quote_sent',
};

/** Convert any stage/status string (display label, legacy, or slug) to canonical DB slug */
export function toSlug(value: string | null | undefined): StageSlug {
  if (!value) return 'new_prospect';
  const raw = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
  // Direct slug match
  if (SLUG_TO_LABEL[raw]) return raw as StageSlug;
  // Label match
  const fromLabel = LABEL_TO_SLUG[value.trim()];
  if (fromLabel) return fromLabel;
  // Legacy alias
  const fromLegacy = LEGACY_ALIASES[raw];
  if (fromLegacy) return fromLegacy;
  return 'new_prospect';
}

/** Convert any stage/status string to display label */
export function toLabel(value: string | null | undefined): StageLabel {
  return SLUG_TO_LABEL[toSlug(value)] || 'New Prospect';
}

/** Check if a value is a valid stage slug */
export function isValidSlug(value: string): value is StageSlug {
  return (STAGE_SLUGS as readonly string[]).includes(value);
}
