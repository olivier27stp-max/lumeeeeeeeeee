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
    console.log('[rate-limiter] Using Upstash Redis for persistent rate limiting');
  } catch (err: any) {
    console.warn('[rate-limiter] Failed to init Redis, falling back to in-memory:', err.message);
  }
} else {
  console.log('[rate-limiter] No UPSTASH_REDIS_REST_URL set, using in-memory rate limiting');
}

// ── Pre-configured rate limiters ──

type LimiterPreset = 'strict' | 'standard' | 'relaxed' | 'webhook' | 'public' | 'auth';

const PRESETS: Record<LimiterPreset, { requests: number; window: `${number} s` | `${number} m` | `${number} h` }> = {
  auth:     { requests: 10,  window: '60 s' },    // Login/signup: 10/min
  strict:   { requests: 10,  window: '60 s' },    // SMS, email: 10/min
  standard: { requests: 30,  window: '60 s' },    // General API: 30/min
  relaxed:  { requests: 100, window: '60 s' },    // Read endpoints: 100/min
  webhook:  { requests: 200, window: '60 s' },    // Webhooks: 200/min
  public:   { requests: 15,  window: '60 s' },    // Public pages: 15/min
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
}

/**
 * Redis-backed rate limiting middleware.
 * If Redis is not configured, returns a pass-through (in-memory limiter from security.ts handles it).
 */
export function redisRateLimit(opts: RedisRateLimitOpts) {
  const limiter = getLimiter(opts.preset);

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
          error: 'Too many requests. Please try again later.',
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
