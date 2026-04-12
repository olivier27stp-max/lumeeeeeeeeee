// ── Centralised job financial calculations ──
// Used by: NewJobModal (live preview), createJob (persist), JobDetails (display), invoice creation.

export interface CalcLineItem {
  qty: number;
  unit_price_cents: number;
}

export interface TaxLine {
  code: string;
  label: string;
  rate: number;
  enabled: boolean;
}

export interface TaxBreakdownEntry {
  code: string;
  label: string;
  rate: number;
  amount_cents: number;
  amount: number;
}

export interface JobFinancials {
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  /** Dollar values rounded to 2 decimals */
  subtotal: number;
  tax_amount: number;
  total: number;
  tax_breakdown: TaxBreakdownEntry[];
}

/** Line total in cents: qty × unit_price_cents, floored to 0. */
export function calcLineTotalCents(qty: number, unitPriceCents: number): number {
  return Math.max(0, Math.round(qty * unitPriceCents));
}

/**
 * Compute subtotal, per-tax amounts, and grand total from line items + tax config.
 *
 * Rules:
 * - line_total = qty × unit_price_cents  (in cents)
 * - subtotal   = Σ line_total
 * - per tax    = round(subtotal × rate / 100)
 * - total      = subtotal + Σ taxes
 * - All cent values are integers; dollar values are cents/100 rounded to 2 dp.
 */
export function calculateJobFinancials(
  lineItems: CalcLineItem[],
  taxLines: TaxLine[],
): JobFinancials {
  const subtotalCents = lineItems.reduce(
    (sum, item) => sum + calcLineTotalCents(item.qty, item.unit_price_cents),
    0,
  );

  const taxBreakdown: TaxBreakdownEntry[] = taxLines
    .filter((t) => t.enabled && t.rate > 0)
    .map((t) => {
      const amountCents = Math.round(subtotalCents * (t.rate / 100));
      return {
        code: t.code,
        label: t.label,
        rate: t.rate,
        amount_cents: amountCents,
        amount: roundMoney(amountCents / 100),
      };
    });

  const taxCents = taxBreakdown.reduce((sum, t) => sum + t.amount_cents, 0);
  const totalCents = subtotalCents + taxCents;

  return {
    subtotal_cents: subtotalCents,
    tax_cents: taxCents,
    total_cents: totalCents,
    subtotal: roundMoney(subtotalCents / 100),
    tax_amount: roundMoney(taxCents / 100),
    total: roundMoney(totalCents / 100),
    tax_breakdown: taxBreakdown,
  };
}

/** Round to 2 decimal places (banker-safe). */
export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Format cents to a display string like "$475.00". */
export function formatCents(cents: number, currency = 'CAD'): string {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

/** Default tax lines — empty until configured in Settings > Taxes. */
export const DEFAULT_TAX_LINES: TaxLine[] = [];
