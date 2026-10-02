/**
 * Coordonnées de la stack locale de l'audit Statistiques (scripts/qa/stats-stack.sh).
 * Secrets JETABLES, propres à ce conteneur local — aucun rapport avec staging ou la prod.
 */
import crypto from 'node:crypto';

export const LOCAL = {
  dbUrl: process.env.FINAL_DB_URL || 'postgres://supabase_admin:lumefinal-local-pw@localhost:49432/postgres',
  authUrl: 'http://localhost:49999',
  restUrl: 'http://localhost:49300',
  /** Proxy façon Kong (/auth/v1, /rest/v1) : scripts/qa/stats-proxy.mjs */
  proxyUrl: 'http://localhost:44921',
  jwtSecret: 'lumefinal-local-jwt-secret-at-least-32-chars-long',
};

const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');

/** JWT HS256 signé avec le secret LOCAL (anon, service_role ou un utilisateur). */
export function signerJwt(claims, secondes = 24 * 3600) {
  const now = Math.floor(Date.now() / 1000);
  const corps = { iss: 'lumefinal', iat: now, exp: now + secondes, aud: 'authenticated', ...claims };
  const tete = b64({ alg: 'HS256', typ: 'JWT' });
  const charge = b64(corps);
  const sig = crypto.createHmac('sha256', LOCAL.jwtSecret).update(`${tete}.${charge}`).digest('base64url');
  return `${tete}.${charge}.${sig}`;
}
