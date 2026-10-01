/**
 * La limite de 60 tours de Lumi par personne et par heure existe même sans Redis.
 *
 * Mesuré en prod le 2026-10-01 (tests critiques de Lumi) : Upstash n'est pas
 * branché, le limiteur devenait un simple laissez-passer, et un compte de test a
 * joué 173 tours en une heure sans recevoir un seul 429.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Request, Response } from 'express';

vi.mock('../server/lib/logger', () => ({ logger: { info: () => {}, warn: () => {}, error: () => {} } }));

interface Reponse { statut: number | null; corps: { error?: string; retryAfter?: number } | null; entetes: Record<string, string> }

function appeler(limite: (req: Request, res: Response, next: () => void) => unknown, personne: string): { passe: boolean; reponse: Reponse } {
  const reponse: Reponse = { statut: null, corps: null, entetes: {} };
  const res = {
    set(nom: string, valeur: string) { reponse.entetes[nom] = valeur; return res; },
    status(code: number) { reponse.statut = code; return res; },
    json(corps: Reponse['corps']) { reponse.corps = corps; return res; },
  };
  let passe = false;
  limite({ personne } as unknown as Request, res as unknown as Response, () => { passe = true; });
  return { passe, reponse };
}

afterEach(() => { vi.useRealTimers(); });

describe('limite horaire de Lumi sans Redis', () => {
  it('60 tours passent, le 61e reçoit un 429 avec le délai, et une autre personne n’est pas touchée', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-01T12:00:00Z'));
    const { limiteEnMemoire } = await import('../server/lib/rate-limiter');
    const limite = limiteEnMemoire({ preset: 'lumi', keyFn: (req) => (req as unknown as { personne: string }).personne });

    for (let i = 0; i < 60; i++) {
      expect(appeler(limite, 'alice').passe, `tour ${i + 1}`).toBe(true);
      vi.advanceTimersByTime(1_000);
    }
    const refus = appeler(limite, 'alice');
    expect(refus.passe).toBe(false);
    expect(refus.reponse.statut).toBe(429);
    expect(refus.reponse.corps?.error).toMatch(/Trop de demandes/);
    // Le premier tour sort de la fenêtre 59 minutes plus tard.
    expect(refus.reponse.corps?.retryAfter).toBe(59 * 60);
    expect(refus.reponse.entetes['Retry-After']).toBe(String(59 * 60));

    expect(appeler(limite, 'bob').passe).toBe(true);
  });

  it('la fenêtre glisse : un refus ne remet pas le compteur à zéro, et la place se libère tour par tour', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-01T12:00:00Z'));
    const { limiteEnMemoire } = await import('../server/lib/rate-limiter');
    const limite = limiteEnMemoire({ preset: 'lumi', keyFn: () => 'alice' });
    for (let i = 0; i < 60; i++) { appeler(limite, 'alice'); vi.advanceTimersByTime(60_000); }
    // 60 minutes ont passé : le tout premier tour vient de sortir, une place s'est libérée.
    expect(appeler(limite, 'alice').passe).toBe(true);
    // Mais une seule : le suivant est refusé tant que le 2e tour n'est pas sorti.
    expect(appeler(limite, 'alice').passe).toBe(false);
    expect(appeler(limite, 'alice').passe).toBe(false);
    vi.advanceTimersByTime(60_000);
    expect(appeler(limite, 'alice').passe).toBe(true);
  });

  it('sans Redis, redisRateLimit applique la limite quand le repli est demandé — et seulement là', async () => {
    const { redisRateLimit } = await import('../server/lib/rate-limiter');
    if (process.env.UPSTASH_REDIS_REST_URL) return; // ce test décrit le chemin SANS Redis
    const avec = redisRateLimit({ preset: 'lumi', keyFn: () => 'carl', repliMemoire: true });
    let passes = 0;
    for (let i = 0; i < 65; i++) if (appeler(avec as never, 'carl').passe) passes++;
    expect(passes).toBe(60);
    const sans = redisRateLimit({ preset: 'lumi', keyFn: () => 'dora' });
    passes = 0;
    for (let i = 0; i < 65; i++) if (appeler(sans as never, 'dora').passe) passes++;
    expect(passes).toBe(65);
  });

  it('la route du chat demande le repli en mémoire', () => {
    const r = readFileSync(resolve(__dirname, '..', 'server', 'routes', 'lumi.ts'), 'utf8');
    expect(r).toContain("redisRateLimit({ preset: 'lumi', keyFn: (req) => `lumi:${userKey(req)}`, repliMemoire: true })");
    expect(r).toContain("router.post('/lumi/chat', limiteHoraireLumi,");
  });
});
