/* ═══════════════════════════════════════════════════════════════
   Response Cache — Avoid duplicate Gemini calls for similar questions
   TTL-based, org-scoped, normalized key matching
   ═══════════════════════════════════════════════════════════════ */

interface CachedResponse {
  response: string;
  responseType: string;
  createdAt: number;
}

const cache = new Map<string, CachedResponse>();
const TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_ENTRIES = 200;

function normalizeMessage(msg: string): string {
  return msg.trim().toLowerCase()
    .replace(/[?!.,;:]+/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\b(the|a|an|le|la|les|un|une|des|de|du)\b/g, '')
    .trim();
}

function buildKey(orgId: string, message: string): string {
  return `${orgId}:${normalizeMessage(message)}`;
}

export function getCachedResponse(orgId: string, message: string): CachedResponse | null {
  const key = buildKey(orgId, message);
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > TTL_MS) {
    cache.delete(key);
    return null;
  }
  console.log(`[cache] HIT for "${message.slice(0, 40)}..." — saved 1 Gemini call`);
  return entry;
}

export function setCachedResponse(orgId: string, message: string, response: string, responseType: string): void {
  // Don't cache very short or error responses
  if (response.length < 20) return;
  if (response.includes('error') || response.includes('erreur')) return;

  const key = buildKey(orgId, message);
  cache.set(key, { response, responseType, createdAt: Date.now() });

  // Evict oldest if over limit
  if (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
}

// Cleanup every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of cache) {
    if (now - val.createdAt > TTL_MS) cache.delete(key);
  }
}, 10 * 60 * 1000);
