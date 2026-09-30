/**
 * Coordonnées de la stack locale de l'audit Statistiques (scripts/qa/stats-stack.sh).
 * Secrets JETABLES, propres à ce conteneur local — aucun rapport avec staging ou la prod.
 */
import crypto from 'node:crypto';

export const STATS_LOCAL = {
  dbUrl: process.env.STATS_DB_URL || 'postgres://supabase_admin:lumestats-local-pw@localhost:47432/postgres',
  authUrl: 'http://localhost:47999',
  restUrl: 'http://localhost:47300',
  /** Proxy façon Kong (/auth/v1, /rest/v1) : scripts/qa/stats-proxy.mjs */
  proxyUrl: 'http://localhost:47421',
  jwtSecret: 'lumestats-local-jwt-secret-at-least-32-chars-long',
};

const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');

/** JWT HS256 signé avec le secret LOCAL (anon, service_role ou un utilisateur). */
export function signerJwt(claims, secondes = 24 * 3600) {
  const now = Math.floor(Date.now() / 1000);
  const corps = { iss: 'lumestats', iat: now, exp: now + secondes, aud: 'authenticated', ...claims };
  const tete = b64({ alg: 'HS256', typ: 'JWT' });
  const charge = b64(corps);
  const sig = crypto.createHmac('sha256', STATS_LOCAL.jwtSecret).update(`${tete}.${charge}`).digest('base64url');
  return `${tete}.${charge}.${sig}`;
}
