/**
 * Entity identity colors — one solid icon color per CRM section, applied
 * identically everywhere (sidebar, dropdowns, tables, cards, modals…).
 *
 *   Requests → amber   (#d97706)
 *   Quotes   → bordeaux (#9f1239)
 *   Jobs     → green   (#15803d)
 *   Invoices → navy    (#1e3a8a)
 *
 * The hex values live in src/index.css (@theme --color-entity-*, with
 * lifted dark-mode variants). Rules: color the bare icon only — no chip,
 * no circle, no halo, no gradient behind it.
 */

export type ColoredEntity = 'request' | 'quote' | 'job' | 'invoice' | 'payment';

/** Tailwind text-color class for an entity icon. */
export const ENTITY_ICON_CLASS: Record<ColoredEntity, string> = {
  request: 'text-entity-request',
  quote: 'text-entity-quote',
  job: 'text-entity-job',
  invoice: 'text-entity-invoice',
  // Payments belong to the Finances section — same navy as invoices
  payment: 'text-entity-invoice',
};

/** Class for an entity if it has one, else the provided neutral fallback. */
export function entityIconClass(entity: string | null | undefined, fallback = 'text-text-tertiary'): string {
  if (entity && entity in ENTITY_ICON_CLASS) return ENTITY_ICON_CLASS[entity as ColoredEntity];
  return fallback;
}
