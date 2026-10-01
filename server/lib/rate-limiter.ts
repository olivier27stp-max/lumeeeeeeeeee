/**
 * LUME CRM — Persistent Rate Limiting via Upstash Redis
 * ======================================================
 * Falls back to in-memory if UPSTASH_REDIS_REST_URL is not set.
 * Uses sliding window algorithm for precise rate limiting.
 */

import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { Request, Response, NextFunction } from 'express';
import { extractIP } from './security';
import { logger } from './logger';
import { messageTropDeDemandes } from './message-429';

// ── Redis client (optional — falls back to in-memory) ──
let redis: Redis | null = null;
let useRedis = false;

if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
  try {
    redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
    useRedis = true;
    logger.info('[rate-limiter] Using Upstash Redis for persistent rate limiting');
  } catch (err: any) {
    console.warn('[rate-limiter] Failed to init Redis, falling back to in-memory:', err.message);
  }
} else {
  logger.info('[rate-limiter] No UPSTASH_REDIS_REST_URL set, using in-memory rate limiting');
}

// ── Pre-configured rate limiters ──

type LimiterPreset = 'strict' | 'standard' | 'relaxed' | 'webhook' | 'public' | 'auth' | 'lumi';

const PRESETS: Record<LimiterPreset, { requests: number; window: `${number} s` | `${number} m` | `${number} h` }> = {
  auth:     { requests: 10,  window: '60 s' },    // Login/signup: 10/min
  strict:   { requests: 10,  window: '60 s' },    // SMS, email: 10/min
  standard: { requests: 30,  window: '60 s' },    // General API: 30/min
  relaxed:  { requests: 100, window: '60 s' },    // Read endpoints: 100/min
  webhook:  { requests: 200, window: '60 s' },    // Webhooks: 200/min
  public:   { requests: 15,  window: '60 s' },    // Public pages: 15/min
  lumi:     { requests: 60,  window: '60 m' },    // Lumi : 60 tours par personne et par heure (anti-script, jamais un humain)
};

function createLimiter(preset: LimiterPreset): Ratelimit {
  const { requests, window } = PRESETS[preset];

  if (useRedis && redis) {
    return new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(requests, window),
      analytics: true,
      prefix: `lume:ratelimit:${preset}`,
    });
  }

  // In-memory fallback (ephemeral — lost on restart)
  return new Ratelimit({
    redis: Redis.fromEnv(), // Will error — handled by ephemeral cache below
    limiter: Ratelimit.slidingWindow(requests, window),
    ephemeralCache: new Map(),
    prefix: `lume:ratelimit:${preset}`,
  });
}

// Cache limiters to avoid re-creating
const limiterCache = new Map<string, Ratelimit>();

function getLimiter(preset: LimiterPreset): Ratelimit | null {
  if (!useRedis) return null; // Use in-memory fallback from security.ts

  if (!limiterCache.has(preset)) {
    limiterCache.set(preset, createLimiter(preset));
  }
  return limiterCache.get(preset)!;
}

// ── Express middleware factory ──

interface RedisRateLimitOpts {
  preset: LimiterPreset;
  keyFn?: (req: Request) => string;
  /**
   * Sans Redis, appliquer QUAND MÊME la limite du préréglage, en mémoire du
   * processus. Sans cette option, « pas de Redis » = aucune limite propre (seul
   * reste le limiteur général, 1 500 demandes).
   */
  repliMemoire?: boolean;
}

function fenetreEnMs(fenetre: string): number {
  const [n, unite] = fenetre.split(' ');
  return Number(n) * (unite === 'h' ? 3_600_000 : unite === 'm' ? 60_000 : 1_000);
}

/**
 * La même fenêtre glissante, tenue en mémoire. Mesuré en prod le 2026-10-01 :
 * Upstash n'y est pas branché, donc la limite « 60 tours de Lumi par personne et
 * par heure » n'existait pas — un compte de test a joué 173 tours en une heure
 * sans un seul 429. La mémoire du processus suffit tant que l'API tourne sur une
 * instance ; un redéploiement remet le compteur à zéro, ce qui reste infiniment
 * mieux que pas de limite.
 */
export function limiteEnMemoire(opts: { preset: LimiterPreset; keyFn?: (req: Request) => string }) {
  const { requests, window } = PRESETS[opts.preset];
  const fenetre = fenetreEnMs(window);
  const passages = new Map<string, number[]>();
  const menage = setInterval(() => {
    const limite = Date.now() - fenetre;
    for (const [cle, instants] of passages) {
      if (!instants.length || instants[instants.length - 1] < limite) passages.delete(cle);
    }
  }, 600_000);
  menage.unref?.();

  return (req: Request, res: Response, next: NextFunction) => {
    const cle = opts.keyFn ? opts.keyFn(req) : extractIP(req);
    const maintenant = Date.now();
    const recents = (passages.get(cle) ?? []).filter((t) => maintenant - t < fenetre);
    if (recents.length >= requests) {
      passages.set(cle, recents);
      const retryAfter = Math.max(1, Math.ceil((recents[0] + fenetre - maintenant) / 1000));
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({ error: messageTropDeDemandes(retryAfter), retryAfter });
    }
    recents.push(maintenant);
    passages.set(cle, recents);
    res.set('X-RateLimit-Limit', String(requests));
    res.set('X-RateLimit-Remaining', String(requests - recents.length));
    res.set('X-RateLimit-Reset', String(recents[0] + fenetre));
    next();
  };
}

/**
 * Redis-backed rate limiting middleware.
 * If Redis is not configured, returns a pass-through (in-memory limiter from security.ts handles it).
 */
export function redisRateLimit(opts: RedisRateLimitOpts) {
  const limiter = getLimiter(opts.preset);

  if (!limiter && opts.repliMemoire) return limiteEnMemoire(opts);

  if (!limiter) {
    // No Redis — pass through, rely on in-memory limiter
    return (_req: Request, _res: Response, next: NextFunction) => next();
  }

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const key = opts.keyFn ? opts.keyFn(req) : extractIP(req);
      const { success, limit, remaining, reset } = await limiter.limit(key);

      // Set rate limit headers
      res.set('X-RateLimit-Limit', String(limit));
      res.set('X-RateLimit-Remaining', String(remaining));
      res.set('X-RateLimit-Reset', String(reset));

      if (!success) {
        const retryAfter = Math.ceil((reset - Date.now()) / 1000);
        res.set('Retry-After', String(Math.max(1, retryAfter)));
        return res.status(429).json({
          error: messageTropDeDemandes(Math.max(1, retryAfter)),
          retryAfter: Math.max(1, retryAfter),
        });
      }

      next();
    } catch (err) {
      // Rate limiter failure should never block requests — fail open
      console.error('[rate-limiter] Redis error, failing open:', err);
      next();
    }
  };
}

/**
 * Check if Redis is connected and healthy
 */
export async function checkRedisHealth(): Promise<boolean> {
  if (!useRedis || !redis) return false;
  try {
    await redis.ping();
    return true;
  } catch {
    return false;
  }
}

export { useRedis };
