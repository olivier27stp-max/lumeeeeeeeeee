// Masquage des valeurs sources pour l'affichage et le staging d'aperçus.
// Règle : aucune valeur source complète ne sort de la zone serveur — les
// échantillons montrés au client et aux assistants sont toujours masqués.
// Fonctions pures, testables sans mock.

import type { DetectedType } from './types';

/** a***@d***.com */
export function maskEmail(value: string): string {
  const at = value.indexOf('@');
  if (at <= 0) return maskGeneric(value);
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  const dot = domain.lastIndexOf('.');
  const domainName = dot > 0 ? domain.slice(0, dot) : domain;
  const tld = dot > 0 ? domain.slice(dot) : '';
  return `${local[0]}***@${domainName[0] ?? '*'}***${tld}`;
}

/** ***-***-1234 (garde les 4 derniers chiffres) */
export function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 4) return '***';
  return `***-***-${digits.slice(-4)}`;
}

/** Prénom N*** — première lettre de chaque mot conservée. */
export function maskName(value: string): string {
  return value
    .trim()
    .split(/\s+/)
    .map((w) => (w.length <= 1 ? w : `${w[0]}***`))
    .join(' ');
}

/** 12** Rue S*** — numéro tronqué, mots masqués. */
export function maskAddress(value: string): string {
  return value
    .trim()
    .split(/\s+/)
    .map((w) => {
      if (/^\d+$/.test(w)) return w.length <= 2 ? w : `${w.slice(0, 2)}**`;
      return w.length <= 2 ? w : `${w[0]}***`;
    })
    .join(' ');
}

export function maskPostalCode(value: string): string {
  const v = value.trim();
  return v.length <= 3 ? '***' : `${v.slice(0, 3)}***`;
}

export function maskGeneric(value: string): string {
  const v = value.trim();
  if (v.length === 0) return '';
  if (v.length <= 2) return '**';
  const keep = Math.min(3, Math.floor(v.length / 3));
  return `${v.slice(0, keep)}${'*'.repeat(Math.min(8, v.length - keep))}`;
}

/**
 * Masque une valeur selon le type détecté de sa colonne. Les types non
 * sensibles (statut, booléen, nombre, date) restent lisibles : ils sont
 * nécessaires à la validation humaine et ne constituent pas de la PII isolée.
 */
export function maskValueByType(value: string, type: DetectedType): string {
  const v = sanitizeCellForDisplay(value).trim();
  if (!v) return '';
  switch (type) {
    case 'email':
      return maskEmail(v);
    case 'phone':
      return maskPhone(v);
    case 'name':
      return maskName(v);
    case 'address':
      return maskAddress(v);
    case 'postal_code':
      return maskPostalCode(v);
    case 'id':
      return v.length <= 4 ? v : `${v.slice(0, 2)}…${v.slice(-2)}`;
    case 'status':
    case 'boolean':
    case 'number':
    case 'money':
    case 'date':
    case 'datetime':
      return v.length > 40 ? `${v.slice(0, 40)}…` : v;
    default:
      return maskGeneric(v);
  }
}

const CONTROL_CHARS_RE = new RegExp('[\\x00-\\x08\\x0b\\x0c\\x0e-\\x1f\\x7f]', 'g');
const FORMULA_PREFIX_RE = new RegExp('^[\\s]*[=+\\-@\\t\\r]');
const NUMERIC_PREFIX_RE = new RegExp('^[\\s]*-?\\d');

/**
 * Neutralise l'injection de formules CSV (= + - @ et variantes tab/CR) pour
 * toute valeur destinée à l'affichage ou à un export. On préfixe d'une
 * apostrophe visible plutôt que de supprimer, pour rester fidèle à la source.
 */
export function sanitizeCellForDisplay(value: string): string {
  if (typeof value !== 'string') return '';
  // retire les caractères de contrôle (sauf tab/CR/LF), qui cassent l'affichage
  const cleaned = value.replace(CONTROL_CHARS_RE, '');
  if (FORMULA_PREFIX_RE.test(cleaned) && !NUMERIC_PREFIX_RE.test(cleaned)) {
    return `'${cleaned}`;
  }
  return cleaned;
}
