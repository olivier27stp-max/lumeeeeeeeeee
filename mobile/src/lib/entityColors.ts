/**
 * Entity identity colours — the desktop's, copied verbatim so the mobile app
 * and the web read as one product.
 *
 * Source of truth on the web (origin/main):
 *   • src/index.css      → @theme { --color-entity-request/quote/job/invoice }
 *   • src/lib/entityColors.ts → ENTITY_ICON_CLASS ('text-entity-*')
 *
 * The Client Hub (src/pages/ClientDetails.tsx) uses exactly these three for its
 * create actions: New Quote → text-entity-quote, New Job → text-entity-job,
 * New Invoice → text-entity-invoice. Clients themselves have no entity colour
 * on the web — the hub renders them with the neutral primary (#171717,
 * --color-primary / text-text-primary), which is what `client` carries here.
 *
 * Hex values are the light-mode ones (the mobile app is light-only). The web's
 * dark-mode variants (#fb7185 / #4ade80 / #60a5fa) are noted for the day mobile
 * grows a dark theme.
 */

export type ColoredEntity = 'request' | 'quote' | 'job' | 'invoice' | 'payment' | 'client';

export const ENTITY_COLOR: Record<ColoredEntity, string> = {
  request: '#d97706', // amber
  quote: '#9f1239', // bordeaux
  job: '#15803d', // green
  invoice: '#1e3a8a', // navy
  // Payments belong to the Finances section — same navy as invoices (web parity)
  payment: '#1e3a8a',
  // No --color-entity-client on the web: the hub keeps clients neutral
  client: '#171717',
};

/** Colour for an entity if it has one, else the provided neutral fallback. */
export function entityColor(entity: string | null | undefined, fallback = '#a3a3a3'): string {
  if (entity && entity in ENTITY_COLOR) return ENTITY_COLOR[entity as ColoredEntity];
  return fallback;
}
