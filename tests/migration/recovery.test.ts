// Audit S7 — détection des imports zombies : un redéploiement pendant un
// import ne doit plus laisser une migration en « importing » pour l'éternité.

import { describe, it, expect } from 'vitest';
import { isZombieBatch, FINAL_ZOMBIE_AFTER_MS, TEST_ZOMBIE_AFTER_MS } from '../../server/lib/migration/recovery';

const T0 = Date.parse('2026-09-07T12:00:00Z');
const iso = (msAgo: number) => new Date(T0 - msAgo).toISOString();

describe('isZombieBatch', () => {
  it('lot final avec heartbeat récent → vivant', () => {
    expect(isZombieBatch({ kind: 'final', started_at: iso(60 * 60_000), updated_at: iso(2 * 60_000) }, T0)).toBe(false);
  });
  it('lot final silencieux depuis plus de 15 min → zombie', () => {
    expect(isZombieBatch({ kind: 'final', started_at: iso(60 * 60_000), updated_at: iso(FINAL_ZOMBIE_AFTER_MS + 60_000) }, T0)).toBe(true);
  });
  it('lot test : 30 min depuis le départ (pas de heartbeat fin au dry-run)', () => {
    expect(isZombieBatch({ kind: 'test', started_at: iso(TEST_ZOMBIE_AFTER_MS - 60_000), updated_at: null }, T0)).toBe(false);
    expect(isZombieBatch({ kind: 'test', started_at: iso(TEST_ZOMBIE_AFTER_MS + 60_000), updated_at: null }, T0)).toBe(true);
  });
  it('le plus récent de started_at/updated_at fait foi', () => {
    // démarré il y a longtemps mais heartbeat frais = vivant
    expect(isZombieBatch({ kind: 'final', started_at: iso(3 * 60 * 60_000), updated_at: iso(30_000) }, T0)).toBe(false);
  });
  it('dates illisibles → zombie (ne jamais bloquer pour l\'éternité)', () => {
    expect(isZombieBatch({ kind: 'final', started_at: 'n/a', updated_at: null }, T0)).toBe(true);
  });
});
