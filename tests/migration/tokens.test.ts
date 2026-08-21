// Jetons d'invitation : hachage au repos, format, expiration, révocation,
// remplacement, verrouillage après tentatives.

import { describe, it, expect } from 'vitest';
import {
  generateInviteToken, hashToken, isValidTokenFormat, timingSafeCompare,
  checkInvitationUsable, expiryFromNow,
} from '../../server/lib/migration/tokens';

const base = { revoked_at: null, superseded_at: null, failed_attempts: 0 };

describe('jetons d\'invitation', () => {
  it('génère 64 hex et ne stocke que le hash', () => {
    const { token, tokenHash } = generateInviteToken();
    expect(isValidTokenFormat(token)).toBe(true);
    expect(token).toHaveLength(64);
    expect(tokenHash).not.toBe(token);
    expect(tokenHash).toBe(hashToken(token));
    expect(isValidTokenFormat(tokenHash)).toBe(true); // sha256 hex a le même format
    const again = generateInviteToken();
    expect(again.token).not.toBe(token);
  });

  it('rejette les formats invalides avant tout accès DB', () => {
    expect(isValidTokenFormat('')).toBe(false);
    expect(isValidTokenFormat('abc')).toBe(false);
    expect(isValidTokenFormat('Z'.repeat(64))).toBe(false);
    expect(isValidTokenFormat(null)).toBe(false);
    expect(isValidTokenFormat(42)).toBe(false);
  });

  it('comparaison timing-safe correcte', () => {
    const { tokenHash } = generateInviteToken();
    expect(timingSafeCompare(tokenHash, tokenHash)).toBe(true);
    expect(timingSafeCompare(tokenHash, hashToken('autre'))).toBe(false);
    expect(timingSafeCompare('a', 'ab')).toBe(false);
  });

  it('lien valide accepté', () => {
    expect(checkInvitationUsable({ ...base, expires_at: expiryFromNow(48) }, 20).ok).toBe(true);
  });

  it('lien expiré refusé', () => {
    const res = checkInvitationUsable({ ...base, expires_at: new Date(Date.now() - 1000).toISOString() }, 20);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('expired');
  });

  it('lien révoqué refusé', () => {
    const res = checkInvitationUsable({ ...base, expires_at: expiryFromNow(48), revoked_at: new Date().toISOString() }, 20);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('revoked');
  });

  it('ancien lien remplacé refusé', () => {
    const res = checkInvitationUsable({ ...base, expires_at: expiryFromNow(48), superseded_at: new Date().toISOString() }, 20);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('superseded');
  });

  it('verrouillé après la limite de tentatives', () => {
    const res = checkInvitationUsable({ ...base, expires_at: expiryFromNow(48), failed_attempts: 20 }, 20);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('locked');
  });
});
