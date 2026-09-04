// Analyse CSV côté serveur : encodage, délimiteur, types de colonnes,
// catégorie du fichier. Fonctions pures (Buffer/string → données), aucun
// accès fs/DB — testables vitest sans mock. Les échantillons sortants
// passent TOUJOURS par maskValueByType (aucune valeur source complète).

import Papa from 'papaparse';
import type { AnalyzedColumn, AnalyzedFile, DetectedType, MigrationCategory } from './types';
import { MASKED_SAMPLE_COUNT, MAX_STAGED_ROWS } from './types';
import { maskValueByType } from './masks';
import { isNullLikeValue } from './normalize';

// ---------------------------------------------------------------------------
// Encodage / binaire / PDF

export function detectEncoding(buf: Buffer): 'utf-8' | 'utf-16le' | 'utf-16be' | 'latin1' {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return 'utf-8';
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return 'utf-16le';
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return 'utf-16be';
  // Sans BOM : UTF-8 si le décodage ne produit pas de caractère de
  // remplacement, sinon latin1 (exports Windows/Excel francophones).
  const limit = Math.min(buf.length, 64 * 1024);
  let sample = buf.subarray(0, limit).toString('utf8');
  if (limit < buf.length) {
    // la coupe peut scinder un caractère multi-octets : on ignore la fin
    sample = sample.replace(/\uFFFD{1,3}$/, '');
  }
  return sample.includes('\uFFFD') ? 'latin1' : 'utf-8';
}

export function sniffIsPdf(buf: Buffer): boolean {
  return buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-';
}

export function looksBinary(buf: Buffer): boolean {
  if (buf.length === 0) return false;
  // UTF-16 avec BOM contient des NUL légitimes : ce n'est pas du binaire.
  if (buf.length >= 2 && ((buf[0] === 0xff && buf[1] === 0xfe) || (buf[0] === 0xfe && buf[1] === 0xff))) {
    return false;
  }
  const limit = Math.min(buf.length, 8192);
  for (let i = 0; i < limit; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Délimiteur

const DELIMITER_CANDIDATES = [',', ';', '\t', '|'] as const;
type Delimiter = (typeof DELIMITER_CANDIDATES)[number];

function countOutsideQuotes(line: string, ch: string): number {
  let count = 0;
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQuotes = !inQuotes;
    else if (c === ch && !inQuotes) count++;
  }
  return count;
}

export function detectDelimiter(firstLines: string): ',' | ';' | '\t' | '|' {
  const lines = firstLines
    .split(/\r\n|\r|\n/) // \r seul = vieux exports Mac
    .filter((l) => l.trim().length > 0)
    .slice(0, 10);
  if (lines.length === 0) return ',';
  let best: Delimiter = ',';
  let bestScore = -1;
  for (const cand of DELIMITER_CANDIDATES) {
    const counts = lines.map((l) => countOutsideQuotes(l, cand));
    const first = counts[0] ?? 0;
    if (first === 0) continue;
    const avg = counts.reduce((a, b) => a + b, 0) / counts.length;
    // bonus si le compte est identique sur toutes les lignes (CSV régulier)
    const consistent = counts.every((c) => c === first);
    const score = avg + (consistent ? avg : 0);
    if (score > bestScore) {
      bestScore = score;
      best = cand;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Inférence de type par colonne (seuil : 70 % des valeurs non vides)

const TYPE_MATCH_THRESHOLD = 0.7;

/** minuscule + accents retirés, pour comparaisons insensibles. */
function fold(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

const BOOLEAN_TOKENS = new Set(['yes', 'no', 'oui', 'non', 'true', 'false', '0', '1']);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MONTH_NAME_RE =
  /\b(jan(v|vier|uary)?|feb(ruary)?|fevr?(ier)?|mar(s|ch)?|apr(il)?|avr(il)?|may|mai|juin|june?|juil(let)?|jul(y)?|aug(ust)?|aout|sep(t|tember|tembre)?|oct(ober|obre)?|nov(ember|embre)?|dec(ember|embre)?)\b/i;
const STREET_WORD_RE =
  /\b(rue|ave?|avenue|st|street|blvd|boul|boulevard|road|rd|dr|drive|chemin|ch|court|crt|ct|lane|ln|way|place|pl|montee|rang|terrasse|cres|crescent|circle|cir|hwy|route|apt|suite|unit)\b/;

function isBooleanToken(v: string): boolean {
  return BOOLEAN_TOKENS.has(v.toLowerCase());
}

function isEmailValue(v: string): boolean {
  return EMAIL_RE.test(v);
}

function isPhoneValue(v: string): boolean {
  if (!/^\+?[\d\s\-().]+$/.test(v)) return false;
  if (!/[\s\-().+]/.test(v)) return false; // exige des séparateurs
  if (isDateValue(v) || isDateTimeValue(v)) return false; // « 2024-01-05 » n'est pas un téléphone
  const digits = v.replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 15;
}

function isDateTimeValue(v: string): boolean {
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{1,2}:\d{2}/.test(v)) return true;
  return /^\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}\s+\d{1,2}:\d{2}/.test(v);
}

function isDateValue(v: string): boolean {
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return true; // ISO
  if (/^\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}$/.test(v)) return true; // US ou FR
  if (/^\d{4}[/.]\d{1,2}[/.]\d{1,2}$/.test(v)) return true;
  return v.length <= 30 && /\d/.test(v) && MONTH_NAME_RE.test(v); // « 12 mars 2025 »
}

function isMoneyValue(v: string): boolean {
  if (/^-?\$\s?[\d\s ]+([.,]\d{1,2})?$/.test(v)) return true; // $1 234,56
  if (/^-?[\d\s ]+([.,]\d{1,2})?\s?\$$/.test(v)) return true; // 1 234,56 $
  const s = v.replace(/[\s ]/g, '');
  if (/^-?\$?\d{1,3}(,\d{3})+(\.\d{1,2})?\$?$/.test(s)) return true; // 1,234.56
  return /^-?\d+[.,]\d{2}$/.test(s); // deux décimales exactes
}

function isPostalCodeValue(v: string): boolean {
  return /^[A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d$/.test(v) || /^\d{5}(-\d{4})?$/.test(v);
}

function isNumberValue(v: string): boolean {
  return /^-?\d+([.,]\d+)?$/.test(v);
}

function isAddressValue(v: string): boolean {
  return /\d/.test(v) && STREET_WORD_RE.test(fold(v));
}

const NAME_PARTICLE_RE = /^(de|du|des|la|le|van|von|der|da|di|el|al|st\.?|mc|o')$/i;

function isPersonNameValue(v: string): boolean {
  if (/\d/.test(v)) return false;
  const words = v.trim().split(/\s+/);
  if (words.length < 2 || words.length > 5) return false;
  return words.every((w) => /^[A-ZÀ-ÖØ-Þ]/.test(w) || NAME_PARTICLE_RE.test(w));
}

/** uuid, ou alphanum courts quasi uniques à préfixe commun (JOB-1001…). */
function isIdColumn(nonEmpty: string[]): boolean {
  const uuidCount = nonEmpty.filter((v) => UUID_RE.test(v)).length;
  if (uuidCount / nonEmpty.length >= TYPE_MATCH_THRESHOLD) return true;
  const idLike = nonEmpty.filter((v) => /^[A-Za-z0-9#_-]{2,24}$/.test(v));
  if (idLike.length / nonEmpty.length < TYPE_MATCH_THRESHOLD) return false;
  let prefix = idLike[0] ?? '';
  for (const v of idLike) {
    while (prefix.length > 0 && !v.startsWith(prefix)) prefix = prefix.slice(0, -1);
    if (prefix.length === 0) return false;
  }
  if (prefix.length < 2 || !/[A-Za-z#_-]/.test(prefix)) return false;
  const distinct = new Set(idLike.map((v) => v.toLowerCase()));
  return distinct.size >= idLike.length * 0.9;
}

/** ≤ 12 valeurs distinctes, courtes, répétées — typique d'un statut. */
function isStatusColumn(nonEmpty: string[]): boolean {
  if (nonEmpty.length < 4) return false;
  const distinct = new Set(nonEmpty.map((v) => fold(v)));
  if (distinct.size > 12 || distinct.size >= nonEmpty.length) return false;
  for (const v of distinct) {
    if (v.length > 24 || !/^[a-z0-9' /_-]+$/.test(v)) return false;
  }
  return true;
}

/**
 * Fichier probablement SANS ligne d'en-tête : si les « en-têtes » ressemblent à
 * des données (courriels, téléphones, dates, montants, codes postaux), la 1re
 * ligne de données a été avalée comme en-tête — signalé, jamais deviné.
 */
export function headersLookLikeData(headers: string[]): boolean {
  if (headers.length < 2) return false;
  const dataish = headers.filter(
    (h) => isEmailValue(h) || isPhoneValue(h) || isDateValue(h) || isDateTimeValue(h) || isMoneyValue(h) || isPostalCodeValue(h),
  ).length;
  return dataish >= 2 && dataish / headers.length >= 0.4;
}

export function detectColumnType(values: string[]): DetectedType {
  const nonEmpty = values
    .map((v) => (v ?? '').trim())
    .filter((v) => v.length > 0 && !isNullLikeValue(v)); // N/A, -, #REF! = vide
  if (nonEmpty.length === 0) return 'text';
  const ratioOf = (pred: (v: string) => boolean): number =>
    nonEmpty.filter(pred).length / nonEmpty.length;

  // du plus spécifique au plus générique — dates avant téléphones : une
  // colonne « 2024-01-05 » est faite de chiffres et de tirets elle aussi.
  if (ratioOf(isBooleanToken) >= TYPE_MATCH_THRESHOLD) return 'boolean';
  if (ratioOf(isEmailValue) >= TYPE_MATCH_THRESHOLD) return 'email';
  if (ratioOf(isDateTimeValue) >= TYPE_MATCH_THRESHOLD) return 'datetime';
  if (ratioOf(isDateValue) >= TYPE_MATCH_THRESHOLD) return 'date';
  if (ratioOf(isPhoneValue) >= TYPE_MATCH_THRESHOLD) return 'phone';
  if (ratioOf(isMoneyValue) >= TYPE_MATCH_THRESHOLD) return 'money';
  if (ratioOf(isPostalCodeValue) >= TYPE_MATCH_THRESHOLD) return 'postal_code';
  if (isIdColumn(nonEmpty)) return 'id';
  if (ratioOf(isNumberValue) >= TYPE_MATCH_THRESHOLD) return 'number';
  if (ratioOf(isAddressValue) >= TYPE_MATCH_THRESHOLD) return 'address';
  if (isStatusColumn(nonEmpty)) return 'status';
  if (ratioOf(isPersonNameValue) >= TYPE_MATCH_THRESHOLD) return 'name';
  return 'text';
}

// ---------------------------------------------------------------------------
// Analyse complète d'un buffer CSV

interface PapaError {
  type?: string;
  code?: string;
  message?: string;
  row?: number;
}

interface PapaResult {
  data: Record<string, unknown>[];
  errors: PapaError[];
  meta: { fields?: string[]; delimiter?: string };
}

function decodeBuffer(buf: Buffer, encoding: 'utf-8' | 'utf-16le' | 'utf-16be' | 'latin1'): string {
  if (encoding === 'utf-16le') return buf.toString('utf16le').replace(/^\uFEFF/, '');
  if (encoding === 'utf-16be') {
    // Node ne d\u00E9code que LE : on permute les paires d'octets avant.
    const even = buf.length % 2 === 0 ? buf : buf.subarray(0, buf.length - 1);
    const swapped = Buffer.from(even);
    swapped.swap16();
    return swapped.toString('utf16le').replace(/^\uFEFF/, '');
  }
  if (encoding === 'latin1') {
    // Windows-1252 (surensemble pratique de latin1) : les exports Excel FR
    // utilisent \u2019 \u201C \u201D \u2026 (0x80-0x9F) qui sont des contr\u00F4les en vrai latin1.
    return new TextDecoder('windows-1252').decode(buf);
  }
  return buf.toString('utf8').replace(/^\uFEFF/, '');
}

export function analyzeCsvBuffer(buf: Buffer): AnalyzedFile {
  const encoding = detectEncoding(buf);
  const text = decodeBuffer(buf, encoding);

  if (text.trim().length === 0) {
    return {
      encoding,
      delimiter: ',',
      headers: [],
      rowCount: 0,
      columnCount: 0,
      columns: [],
      rows: [],
      warnings: ['empty_file'],
      truncated: false,
    };
  }

  // sniff sur les premières lignes complètes seulement
  let sniffChunk = text.slice(0, 16384);
  if (text.length > sniffChunk.length) {
    const lastNl = Math.max(sniffChunk.lastIndexOf('\n'), sniffChunk.lastIndexOf('\r'));
    if (lastNl > 0) sniffChunk = sniffChunk.slice(0, lastNl);
  }
  const delimiter = detectDelimiter(sniffChunk);

  // En-têtes dupliqués : Papa écrase la valeur précédente sous la même clé
  // (perte silencieuse) — on suffixe « (2) », « (3) »… dès la 2e occurrence.
  // Idempotent PAR INDEX : Papa peut rappeler transformHeader sur la même
  // ligne d'en-tête (constaté aux tests) — sans cache, tout devenait « (2) ».
  const headerSeen = new Map<string, number>();
  const headerByIndex = new Map<number, string>();
  let hadDuplicateHeaders = false;
  const parsed = Papa.parse(text, {
    header: true,
    delimiter,
    skipEmptyLines: 'greedy',
    transformHeader: (h: string, index: number) => {
      const cached = headerByIndex.get(index);
      if (cached !== undefined) return cached;
      const t = h.trim();
      const n = (headerSeen.get(t.toLowerCase()) ?? 0) + 1;
      headerSeen.set(t.toLowerCase(), n);
      const name = n === 1 ? t : `${t} (${n})`;
      if (n > 1) hadDuplicateHeaders = true;
      headerByIndex.set(index, name);
      return name;
    },
    preview: MAX_STAGED_ROWS + 1, // borne le travail sur les très gros fichiers
  }) as PapaResult;

  const headers = (parsed.meta.fields ?? []).map((h) => h.trim());
  const warnings: string[] = [];
  if (hadDuplicateHeaders) warnings.push('duplicate_headers');
  if (headersLookLikeData(headers)) warnings.push('missing_header_row');

  const truncated = parsed.data.length > MAX_STAGED_ROWS;
  const rawRows = truncated ? parsed.data.slice(0, MAX_STAGED_ROWS) : parsed.data;

  // normalise chaque ligne : toute valeur devient une string, extras ignorés
  const rows: Record<string, string>[] = rawRows.map((raw) => {
    const row: Record<string, string> = {};
    for (const header of headers) {
      const v = raw[header];
      row[header] = typeof v === 'string' ? v : v == null ? '' : String(v);
    }
    return row;
  });

  if (rows.length === 0) warnings.push('empty_file');
  if (truncated) warnings.push('truncated');
  if (parsed.errors.some((e) => e.type === 'FieldMismatch')) warnings.push('ragged_rows');

  const columns: AnalyzedColumn[] = headers.map((header, position) => {
    const all = rows.map((r) => r[header] ?? '');
    const detectedType = detectColumnType(all.slice(0, 500));
    const emptyCount = all.reduce((n, v) => (v.trim().length === 0 || isNullLikeValue(v) ? n + 1 : n), 0);
    const emptyRatio = all.length === 0 ? 0 : Math.round((emptyCount / all.length) * 10000) / 10000;
    const samplesMasked: string[] = [];
    for (const v of all) {
      if (samplesMasked.length >= MASKED_SAMPLE_COUNT) break;
      if (v.trim().length === 0 || isNullLikeValue(v)) continue;
      samplesMasked.push(maskValueByType(v, detectedType));
    }
    return { position, header, detectedType, emptyRatio, samplesMasked };
  });

  return {
    encoding,
    delimiter,
    headers,
    rowCount: rows.length,
    columnCount: headers.length,
    columns,
    rows,
    warnings,
    truncated,
  };
}

// ---------------------------------------------------------------------------
// Catégorie du fichier : nom de fichier puis signature d'en-têtes (fr + en)

// ordre voulu : les catégories « entité » spécifiques avant les génériques
// (« customer_invoices » → invoices, « client_notes » → notes… clients en dernier)
const FILENAME_PATTERNS: [RegExp, MigrationCategory][] = [
  [/propriet|propert|service address/, 'properties'],
  [/invoice|facture/, 'invoices'],
  [/payment|paiement/, 'payments'],
  [/quote|estimate|soumission|devis/, 'quotes'],
  [/\bjobs?\b|work orders?|travaux/, 'jobs'],
  [/visit|appointment|schedule|rendez/, 'visits'],
  [/\bproducts?\b|\bservices?\b|\bitems?\b|catalog/, 'services'],
  [/\bteam\b|employee|employes?\b|\busers?\b|staff|technician|technicien/, 'team_members'],
  [/\bnotes?\b/, 'notes'],
  [/client|customer|contact/, 'clients'],
];

export function detectCategory(fileName: string, headers: string[]): MigrationCategory | null {
  const base = fold(fileName.replace(/\.[a-z0-9]+$/i, '')).replace(/[^a-z0-9#]+/g, ' ');
  for (const [re, category] of FILENAME_PATTERNS) {
    if (re.test(base)) return category;
  }

  const h = headers.map((x) => fold(x).replace(/[^a-z0-9#]+/g, ' ').trim());
  const has = (re: RegExp): boolean => h.some((x) => re.test(x));

  // payments avant invoices : un export de paiements référence des factures
  if (has(/payment method|payment date|mode de paiement|date de paiement/)) return 'payments';
  if (has(/invoice (number|no|num|#)|numero de facture|no de facture/)) return 'invoices';
  if (has(/job (number|no|num|#)|work order|numero de job|no de job/)) return 'jobs';
  if (has(/quote (number|no|#)|estimate (number|no|#)|numero de (soumission|devis)/)) return 'quotes';
  if ((has(/start time|heure de debut/) && has(/end time|heure de fin/)) || has(/appointment|rendez vous/)) {
    return 'visits';
  }
  if (has(/\bproperty\b|propriete|service address|adresse de service/)) return 'properties';
  if (has(/unit price|prix unitaire|default price/) && has(/item|service|product|produit|\bname\b|\bnom\b/)) {
    return 'services';
  }
  if (has(/first name|prenom/) && has(/last name|nom de famille|\bnom\b/)) return 'clients';
  if (has(/email|courriel/) && has(/phone|telephone/)) return 'clients';
  return null;
}
