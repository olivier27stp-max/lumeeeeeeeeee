/**
 * Compliance — PII redaction for third-party AI prompts
 *
 * Gemini, Ollama (remote), and any other external LLM/image provider
 * MUST NOT receive unredacted PII. Use `redactPii()` on any user-facing text
 * (CRM context, notes, messages) before sending to these providers.
 *
 * See: compliance_audit.md §2 — "Gemini/Ollama reçoivent du PII non expurgé"
 *
 * Design: conservative — false positives (over-redaction) are preferred to
 * false negatives (leaked PII). Call sites that need un-redacted text (e.g.,
 * internal Supabase RPCs, own-tenant display) must NOT go through this helper.
 */

// E.164 and North American phones. Matches 7+ consecutive digits with optional
// separators. Kept greedy on boundaries to avoid catching invoice numbers.
const PHONE_RE = /(\+?\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g;

// RFC-5322-ish — good enough for redaction
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

// Canadian postal code (A1A 1A1 / A1A1A1) + US ZIP (5 or 5+4)
const POSTAL_RE = /\b([A-Za-z]\d[A-Za-z][\s-]?\d[A-Za-z]\d|\d{5}(?:-\d{4})?)\b/g;

// Canadian SIN "XXX XXX XXX" / "XXX-XXX-XXX" and US SSN "XXX-XX-XXXX".
// Must be bracketed by non-digits so phone-like "514-555-1234" does NOT match.
const SIN_SSN_RE = /(?<![\d-])(?:\d{3}[\s-]\d{3}[\s-]\d{3}|\d{3}-\d{2}-\d{4})(?![\d-])/g;

// Credit card — 13-19 digit runs with optional separators (Luhn not checked)
const CC_RE = /\b(?:\d[\s-]?){13,19}\b/g;

// IPv4
const IPV4_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;

// Street address — conservative: digit(s) + space + capitalized word(s) + street suffix
const ADDR_RE = /\b\d{1,6}\s+[A-Z][A-Za-zÀ-ÿ'.-]+(?:\s+[A-Z][A-Za-zÀ-ÿ'.-]+)*\s+(?:St|Street|Rue|Ave|Avenue|Blvd|Boulevard|Rd|Road|Dr|Drive|Ln|Lane|Ct|Court|Way|Place|Pl|Hwy|Route)\.?\b/gi;

export interface RedactionResult {
  text: string;
  counts: {
    email: number;
    phone: number;
    postal: number;
    sin_ssn: number;
    credit_card: number;
    ip: number;
    address: number;
  };
}

/**
 * Replace PII with typed placeholders. Returns both redacted text and counts
 * (useful for logging "redacted 3 emails, 1 phone" without leaking content).
 */
export function redactPii(input: string | null | undefined): RedactionResult {
  const empty: RedactionResult = {
    text: input ?? '',
    counts: { email: 0, phone: 0, postal: 0, sin_ssn: 0, credit_card: 0, ip: 0, address: 0 },
  };
  if (!input || typeof input !== 'string') return empty;

  let text = input;
  const counts = { ...empty.counts };

  // Order matters: do CC/SIN before phone (they share digit patterns)
  text = text.replace(CC_RE, () => { counts.credit_card++; return '[REDACTED_CC]'; });
  text = text.replace(SIN_SSN_RE, () => { counts.sin_ssn++; return '[REDACTED_ID]'; });
  text = text.replace(EMAIL_RE, () => { counts.email++; return '[REDACTED_EMAIL]'; });
  text = text.replace(PHONE_RE, () => { counts.phone++; return '[REDACTED_PHONE]'; });
  text = text.replace(POSTAL_RE, () => { counts.postal++; return '[REDACTED_POSTAL]'; });
  text = text.replace(IPV4_RE, () => { counts.ip++; return '[REDACTED_IP]'; });
  text = text.replace(ADDR_RE, () => { counts.address++; return '[REDACTED_ADDR]'; });

  return { text, counts };
}

/**
 * Recursively redact PII in any JSON-serializable value. Useful for CRM
 * context objects (leads, clients, jobs) before inclusion in AI prompts.
 *
 * Skips fields matching `preserveKeys` (e.g. internal IDs, statuses).
 */
const DEFAULT_PRESERVE = new Set([
  'id', 'org_id', 'user_id', 'created_by', 'created_at', 'updated_at',
  'status', 'stage', 'type', 'kind', 'currency', 'amount_cents', 'role',
]);

export function redactPiiDeep<T = unknown>(value: T, preserveKeys: Set<string> = DEFAULT_PRESERVE): T {
  if (value == null) return value;
  if (typeof value === 'string') return redactPii(value).text as unknown as T;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(v => redactPiiDeep(v, preserveKeys)) as unknown as T;

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (preserveKeys.has(k)) out[k] = v;
    else out[k] = redactPiiDeep(v, preserveKeys);
  }
  return out as T;
}

/**
 * Convenience: returns true iff any PII was detected. Used by callers that
 * want to log a metric but not mutate the payload.
 */
export function containsPii(input: string | null | undefined): boolean {
  const r = redactPii(input);
  return Object.values(r.counts).some(n => n > 0);
}
