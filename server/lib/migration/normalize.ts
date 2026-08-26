// Normalisation des lignes de staging : conversion des valeurs sources vers
// les types Lume (cents, dates ISO, courriels, téléphones) + extraction des
// clés de relation. Fonctions pures — testables vitest sans mock.

import type { TargetEntity } from './types';

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, janvier: 1,
  feb: 2, february: 2, fev: 2, fevrier: 2, ['fév']: 2, ['février']: 2,
  mar: 3, march: 3, mars: 3,
  apr: 4, april: 4, avr: 4, avril: 4,
  may: 5, mai: 5,
  jun: 6, june: 6, juin: 6,
  jul: 7, july: 7, juil: 7, juillet: 7,
  aug: 8, august: 8, aout: 8, ['août']: 8,
  sep: 9, sept: 9, september: 9, septembre: 9,
  oct: 10, october: 10, octobre: 10,
  nov: 11, november: 11, novembre: 11,
  dec: 12, december: 12, ['déc']: 12, decembre: 12, ['décembre']: 12,
};

export function normalizeDigits(v: string): string {
  return (v ?? '').replace(/\D/g, '');
}

/**
 * '$1,234.56' | '1 234,56 $' | '1234.5' | '(45.00)' → cents (int) ; null si invalide.
 */
export function parseMoneyToCents(v: string): number | null {
  if (typeof v !== 'string') return null;
  let s = v.trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
  if (/^-/.test(s)) { negative = true; s = s.slice(1); }
  s = s.replace(/[$€£\s ]|CAD|USD/gi, '');
  if (!s) return null;
  // format fr : 1.234,56 ou 1234,56 — format en : 1,234.56 ou 1234.56
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > lastDot) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else {
    s = s.replace(/,/g, '');
  }
  if (!/^\d*(\.\d+)?$/.test(s) || s === '' || s === '.') return null;
  const num = Number.parseFloat(s);
  if (!Number.isFinite(num)) return null;
  const cents = Math.round(num * 100);
  return negative ? -cents : cents;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function ymd(y: number, m: number, d: number): string | null {
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/**
 * → 'YYYY-MM-DD'. Supporte ISO, MM/DD/YYYY (défaut nord-américain), DD/MM/YYYY
 * lorsque non ambigu (jour > 12), et mois textuels fr/en ('Mar 5, 2024',
 * '5 mars 2024'). null si invalide.
 */
export type DateConvention = 'mdy' | 'dmy';

export function parseDateFlexible(v: string, convention: DateConvention = 'mdy'): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s) return null;

  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/);
  if (m) return ymd(Number(m[1]), Number(m[2]), Number(m[3]));

  m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const y = Number(m[3]);
    if (a > 12 && b <= 12) return ymd(y, b, a); // JJ/MM certain quel que soit l'indice
    if (b > 12 && a <= 12) return ymd(y, a, b); // MM/JJ certain
    return convention === 'dmy' ? ymd(y, b, a) : ymd(y, a, b);
  }

  m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2})$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const y = 2000 + Number(m[3]);
    if (a > 12 && b <= 12) return ymd(y, b, a);
    if (b > 12 && a <= 12) return ymd(y, a, b);
    return convention === 'dmy' ? ymd(y, b, a) : ymd(y, a, b);
  }

  // 'Mar 5, 2024' | 'March 5 2024'
  m = s.match(/^([A-Za-zÀ-ÿ]+)\.?\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m) {
    const month = MONTHS[m[1].toLowerCase()];
    if (month) return ymd(Number(m[3]), month, Number(m[2]));
  }
  // '5 mars 2024'
  m = s.match(/^(\d{1,2})\s+([A-Za-zÀ-ÿ]+)\.?\s+(\d{4})$/);
  if (m) {
    const month = MONTHS[m[2].toLowerCase()];
    if (month) return ymd(Number(m[3]), month, Number(m[1]));
  }
  return null;
}

/**
 * → ISO datetime. Date seule → 'T00:00:00' (convention « pas d'heure précise »
 * gérée en aval). Heures 'h:mm AM/PM' et 'HH:mm' supportées.
 */
export function parseDateTimeFlexible(v: string, convention: DateConvention = 'mdy'): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s) return null;

  const iso = s.match(/^(\d{4}-\d{2}-\d{2})[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (iso) {
    const date = parseDateFlexible(iso[1], convention);
    if (!date) return null;
    return `${date}T${pad2(Number(iso[2]))}:${iso[3]}:${iso[4] ?? '00'}`;
  }

  const withTime = s.match(/^(.*?)\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM|am|pm)?$/);
  if (withTime) {
    const date = parseDateFlexible(withTime[1].replace(/,\s*$/, ''), convention);
    if (date) {
      let h = Number(withTime[2]);
      const min = withTime[3];
      const ampm = (withTime[5] ?? '').toLowerCase();
      if (ampm === 'pm' && h < 12) h += 12;
      if (ampm === 'am' && h === 12) h = 0;
      if (h > 23 || Number(min) > 59) return null;
      return `${date}T${pad2(h)}:${min}:${withTime[4] ?? '00'}`;
    }
  }

  const dateOnly = parseDateFlexible(s, convention);
  if (dateOnly) return `${dateOnly}T00:00:00`;
  return null;
}

const STREET_ABBREVIATIONS: Record<string, string> = {
  street: 'st', avenue: 'ave', av: 'ave', boulevard: 'blvd', boul: 'blvd',
  road: 'rd', drive: 'dr', route: 'rte', chemin: 'ch', rue: 'rue',
  apartment: 'apt', appartement: 'apt', suite: 'ste', unit: 'unit',
  east: 'e', west: 'w', north: 'n', south: 's', est: 'e', ouest: 'o', nord: 'n', sud: 's',
};

/** Clé de comparaison d'adresses : minuscule, sans accents, abréviations unifiées. */
export function normalizeAddressKey(v: string): string {
  if (typeof v !== 'string') return '';
  return v
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => STREET_ABBREVIATIONS[w] ?? w)
    .join(' ');
}


/**
 * Infère la convention de date d'une COLONNE entière : si un premier segment
 * dépasse 12, la colonne est JJ/MM ; si un deuxième segment dépasse 12, MM/JJ.
 * 'mixed' = contradiction (données incohérentes), 'ambiguous' = aucune preuve
 * (validation humaine recommandée), 'none' = pas de dates à barres oblique.
 */
export function inferDateConvention(values: string[]): 'mdy' | 'dmy' | 'ambiguous' | 'mixed' | 'none' {
  let sawSlash = false;
  let firstGT12 = false;
  let secondGT12 = false;
  const re = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})(?:\s|$)/;
  for (const raw of values) {
    const v = (raw ?? '').trim();
    const m = v.match(re);
    if (!m) continue;
    sawSlash = true;
    if (Number(m[1]) > 12) firstGT12 = true;
    if (Number(m[2]) > 12) secondGT12 = true;
  }
  if (!sawSlash) return 'none';
  if (firstGT12 && secondGT12) return 'mixed';
  if (firstGT12) return 'dmy';
  if (secondGT12) return 'mdy';
  return 'ambiguous';
}

export interface NormalizedRecord {
  normalized: Record<string, unknown>;
  relations: Record<string, string>;
  problems: string[];
}

const MONEY_FIELDS = new Set(['total', 'subtotal', 'tax', 'price', 'cost', 'amount', 'paid_amount', 'balance', 'unit_price', 'line_total']);
const DATE_FIELDS = new Set(['created_date', 'sale_date', 'start_date', 'end_date', 'issued_date', 'due_date', 'valid_until', 'date']);
const DATETIME_FIELDS = new Set(['start_at', 'end_at']);
const RELATION_FIELDS = new Set(['client_ref', 'property_ref', 'job_ref', 'invoice_ref']);

/**
 * Applique les correspondances (header → target_field) à une ligne brute et
 * produit les champs normalisés + clés de relation + problèmes détectés.
 */
export function normalizeRow(
  entity: TargetEntity,
  row: Record<string, string>,
  fieldByHeader: Record<string, string>,
  dateConventionByField: Record<string, DateConvention> = {},
): NormalizedRecord {
  const normalized: Record<string, unknown> = {};
  const relations: Record<string, string> = {};
  const problems: string[] = [];

  for (const [header, rawValue] of Object.entries(row)) {
    const field = fieldByHeader[header];
    if (!field) continue;
    const value = typeof rawValue === 'string' ? rawValue.trim() : '';
    if (!value) continue;

    if (RELATION_FIELDS.has(field)) {
      relations[field] = value.slice(0, 200);
      continue;
    }
    if (field === 'external_id') {
      relations.external_id = value.slice(0, 120);
      normalized.external_id = value.slice(0, 120);
      continue;
    }
    if (MONEY_FIELDS.has(field)) {
      const cents = parseMoneyToCents(value);
      if (cents === null) problems.push(`invalid_money:${field}`);
      else normalized[`${field}_cents`] = cents;
      continue;
    }
    if (DATETIME_FIELDS.has(field)) {
      const dt = parseDateTimeFlexible(value, dateConventionByField[field] ?? 'mdy');
      if (dt === null) problems.push(`invalid_datetime:${field}`);
      else normalized[field] = dt;
      continue;
    }
    if (DATE_FIELDS.has(field)) {
      const convention = dateConventionByField[field] ?? 'mdy';
      const d = parseDateFlexible(value, convention);
      if (d !== null) {
        normalized[field] = d;
        continue;
      }
      // valeur avec heure (« 05/12/2024 9:00 AM ») : on récupère date ET heure
      const dt = parseDateTimeFlexible(value, convention);
      if (dt === null) {
        problems.push(`invalid_date:${field}`);
      } else {
        normalized[field] = dt.slice(0, 10);
        if (field === 'start_date') normalized.start_at = dt;
        if (field === 'end_date') normalized.end_at = dt;
      }
      continue;
    }
    if (field === 'email') {
      const email = value.toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) problems.push('invalid_email:email');
      else normalized.email = email;
      continue;
    }
    if (field === 'phone' || field === 'phone_secondary') {
      normalized[field] = value.slice(0, 40);
      const digits = normalizeDigits(value);
      if (digits.length >= 7) normalized[`${field}_digits`] = digits.slice(-10);
      continue;
    }
    normalized[field] = value.length > 2000 ? `${value.slice(0, 2000)}…` : value;
  }

  // Client : reconstruire first/last à partir de full_name si nécessaire.
  if (entity === 'client') {
    if (!normalized.first_name && !normalized.last_name && typeof normalized.full_name === 'string') {
      const parts = (normalized.full_name as string).trim().split(/\s+/);
      if (parts.length === 1) {
        normalized.first_name = parts[0];
      } else {
        normalized.last_name = parts.pop();
        normalized.first_name = parts.join(' ');
      }
    }
  }

  // Visite : date + heures séparées → start_at/end_at.
  if (entity === 'visit' && !normalized.start_at && typeof normalized.date === 'string') {
    const base = normalized.date as string;
    const start = typeof row['start_time'] === 'string' ? row['start_time'] : '';
    normalized.start_at = start ? parseDateTimeFlexible(`${base} ${start}`) ?? `${base}T00:00:00` : `${base}T00:00:00`;
  }

  return { normalized, relations, problems };
}
