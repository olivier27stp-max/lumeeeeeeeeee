// Jetons d'invitation du portail de migration — même convention que
// server/routes/invitations.ts : 32 octets aléatoires en hex, stockage
// SHA-256 uniquement, comparaison timing-safe, padding aléatoire des refus.

import crypto from 'crypto';

export const TOKEN_FORMAT_RE = /^[a-f0-9]{64}$/;

export function generateInviteToken(): { token: string; tokenHash: string } {
  const token = crypto.randomBytes(32).toString('hex');
  return { token, tokenHash: hashToken(token) };
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function isValidTokenFormat(token: unknown): token is string {
  return typeof token === 'string' && TOKEN_FORMAT_RE.test(token);
}

export function timingSafeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/** Pause 50-150 ms avant toute réponse négative pour ne pas fuiter l'existence d'un jeton. */
export function randomSleep(): Promise<void> {
  const ms = 50 + Math.floor(Math.random() * 100);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function expiryFromNow(hours: number): string {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

export interface InvitationLike {
  expires_at: string;
  revoked_at: string | null;
  superseded_at: string | null;
  failed_attempts: number;
}

// `reason` déclaré sur les deux branches : le tsconfig du repo n'active pas
// `strict`, donc l'union ne se narrowe pas via `!check.ok`.
export type InvitationCheck =
  | { ok: true; reason?: undefined }
  | { ok: false; reason: 'expired' | 'revoked' | 'superseded' | 'locked' };

export function checkInvitationUsable(inv: InvitationLike, maxFailedAttempts: number): InvitationCheck {
  if (inv.revoked_at) return { ok: false, reason: 'revoked' };
  if (inv.superseded_at) return { ok: false, reason: 'superseded' };
  if (inv.failed_attempts >= maxFailedAttempts) return { ok: false, reason: 'locked' };
  if (new Date(inv.expires_at).getTime() < Date.now()) return { ok: false, reason: 'expired' };
  return { ok: true };
}
