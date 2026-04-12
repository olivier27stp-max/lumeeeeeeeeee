import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Currency/locale resolved once from localStorage or defaults (safe for SSR + private browsing)
function _safeGet(key: string): string | null { try { return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null; } catch { return null; } }
const _storedLang = _safeGet('lume-language');
const _locale = _storedLang === 'fr' ? 'fr-CA' : 'en-CA';
const _currency = _safeGet('lume-currency') || 'CAD';

export function formatCurrency(value: number, currency?: string) {
  return new Intl.NumberFormat(_locale, {
    style: 'currency',
    currency: currency || _currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatDate(date: string | Date) {
  return new Date(date).toLocaleDateString(_locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/** Relative time — "2h ago", "3d ago", "just now" */
export function timeAgo(date: string | Date, fr = false): string {
  const now = Date.now();
  const d = new Date(date).getTime();
  const diff = now - d;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return fr ? "à l'instant" : 'just now';
  if (mins < 60) return `${mins}m ${fr ? '' : 'ago'}`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${fr ? '' : 'ago'}`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ${fr ? '' : 'ago'}`;
  if (days < 30) return `${Math.floor(days / 7)}w ${fr ? '' : 'ago'}`;
  return formatDate(date);
}

/** Days until a date — returns negative if overdue */
export function daysUntil(date: string | Date): number {
  const target = new Date(date).setHours(0, 0, 0, 0);
  const today = new Date().setHours(0, 0, 0, 0);
  return Math.round((target - today) / 86400000);
}

/** Expiry label — "Expires in 3 days" / "Expired 2 days ago" */
export function expiryLabel(date: string | Date, fr = false): { text: string; className: string } {
  const days = daysUntil(date);
  if (days < 0) return { text: fr ? `Expiré il y a ${Math.abs(days)}j` : `Expired ${Math.abs(days)}d ago`, className: 'expiry-urgent' };
  if (days === 0) return { text: fr ? "Expire aujourd'hui" : 'Expires today', className: 'expiry-urgent' };
  if (days <= 3) return { text: fr ? `Expire dans ${days}j` : `Expires in ${days}d`, className: 'expiry-soon' };
  if (days <= 7) return { text: fr ? `Expire dans ${days}j` : `Expires in ${days}d`, className: 'expiry-ok' };
  return { text: formatDate(date), className: 'expiry-ok' };
}

/** Quick math — evaluate simple expressions like "100+50*2" */
export function evalQuickMath(input: string): number | null {
  const cleaned = input.replace(/[^0-9+\-*/().]/g, '');
  if (!cleaned || !/\d/.test(cleaned)) return null;
  try {
    const result = new Function(`return (${cleaned})`)();
    return typeof result === 'number' && isFinite(result) ? Math.round(result * 100) / 100 : null;
  } catch { return null; }
}
