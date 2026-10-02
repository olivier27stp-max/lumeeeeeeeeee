/**
 * Coordonnées de la pile LOCALE des E2E de la section Automatisations
 * (scripts/qa/automations-e2e/pile.sh). Secrets JETABLES, propres à ces
 * conteneurs — aucun rapport avec staging ni avec la production.
 */
import crypto from 'node:crypto';

export const PILE = {
  reseau: 'lumeautoe2e',
  conteneurs: { db: 'lumeautoe2e-db', auth: 'lumeautoe2e-auth', rest: 'lumeautoe2e-rest', realtime: 'lumeautoe2e-realtime' },
  motDePasse: 'lumeautoe2e-local-pw',
  dbUrl: 'postgres://supabase_admin:lumeautoe2e-local-pw@127.0.0.1:48432/postgres',
  authUrl: 'http://127.0.0.1:48999',
  restUrl: 'http://127.0.0.1:48300',
  realtimeUrl: 'http://127.0.0.1:48400',
  /** Proxy façon Kong (/auth/v1, /rest/v1, /realtime/v1) : scripts/qa/automations-e2e/proxy.mjs */
  // Un second jeu de serveurs (autres ports) peut tourner à côté d'une passe en cours : E2E_PORT_*.
  proxyUrl: `http://127.0.0.1:${Number(process.env.E2E_PORT_PROXY || 48421)}`,
  portApi: Number(process.env.E2E_PORT_API || 48302),
  portVite: Number(process.env.E2E_PORT_VITE || 5193),
  jwtSecret: 'lumeautoe2e-local-jwt-secret-at-least-32-chars-long',
};

const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');

/** JWT HS256 signé avec le secret LOCAL (anon, service_role). */
export function signerJwt(claims, secondes = 30 * 24 * 3600) {
  const now = Math.floor(Date.now() / 1000);
  const corps = { iss: 'lumeautoe2e', iat: now, exp: now + secondes, ...claims };
  const tete = b64({ alg: 'HS256', typ: 'JWT' });
  const charge = b64(corps);
  const sig = crypto.createHmac('sha256', PILE.jwtSecret).update(`${tete}.${charge}`).digest('base64url');
  return `${tete}.${charge}.${sig}`;
}

/** Les clés « anon » et « service_role » de la pile locale (stables d'un appel à l'autre le temps d'une passe). */
export function clesLocales() {
  return { anon: signerJwt({ role: 'anon' }), service: signerJwt({ role: 'service_role' }) };
}

/**
 * L'environnement d'une passe locale, construit à partir de RIEN : seul le nécessaire au système passe.
 * Aucune clé de .env.local (fournisseurs, staging, prod) n'entre dans les serveurs ni dans les tests.
 */
export function envLocal(sorties) {
  const env = {};
  for (const k of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'TEMP', 'TMP', 'APPDATA', 'LOCALAPPDATA', 'USERPROFILE', 'HOME', 'ComSpec', 'PATHEXT', 'windir', 'PLAYWRIGHT_BROWSERS_PATH', 'CI', 'E2E_PORT_PROXY', 'E2E_PORT_API', 'E2E_PORT_VITE']) {
    if (process.env[k] !== undefined) env[k] = process.env[k];
  }
  const { anon, service } = clesLocales();
  return Object.assign(env, {
    VITE_SUPABASE_URL: PILE.proxyUrl,
    VITE_SUPABASE_ANON_KEY: anon,
    SUPABASE_SERVICE_ROLE_KEY: service,
    E2E_BASE: `http://127.0.0.1:${PILE.portVite}`,
    QA_UI_PORT_API: String(PILE.portApi),
    QA_UI_PORT_VITE: String(PILE.portVite),
    E2E_SORTIES: sorties,
    QA_UI_SORTIES: `${sorties}/serveurs`,
    E2E_WORKERS: process.env.E2E_WORKERS || '1',
    E2E_JEU: process.env.E2E_JEU || '',
    TZ: 'America/Toronto',
    // Requis au démarrage de l'API ; valeurs propres à cette passe locale.
    CRON_SECRET: 'lumeautoe2e-cron-local',
    PAYMENTS_ENCRYPTION_KEY: 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=',
  });
}
