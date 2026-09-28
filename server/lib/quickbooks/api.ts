/* ═══════════════════════════════════════════════════════════════
   QuickBooks Online — client HTTP de l'API comptable.

   Toujours passer par getValidAccessToken : un jeton Intuit vit une heure,
   celui lu directement dans app_connections est presque toujours expiré.
   Un 401 en cours de route force un renouvellement puis un seul nouvel essai.
   ═══════════════════════════════════════════════════════════════ */

import { getValidAccessToken, refreshOAuthToken } from '../integrations/service';

// Intuit a retiré les minor versions < 75 (août 2025).
const MINOR_VERSION = 75;

function apiBaseUrl(): string {
  return process.env.QUICKBOOKS_ENV === 'production'
    ? 'https://quickbooks.api.intuit.com'
    : 'https://sandbox-quickbooks.api.intuit.com';
}

/**
 * `retryable` : panne passagère (réseau, 429, 5xx) — le worker réessaie plus
 * tard. `auth` : plus de jeton utilisable — il faut reconnecter, inutile de
 * brûler les essais. Le reste (400 de validation) va en erreur visible.
 */
export class QboError extends Error {
  status: number;
  code: string | null;
  retryable: boolean;
  auth: boolean;
  constructor(message: string, opts: { status?: number; code?: string | null; retryable?: boolean; auth?: boolean } = {}) {
    super(message);
    this.name = 'QboError';
    this.status = opts.status ?? 0;
    this.code = opts.code ?? null;
    this.retryable = opts.retryable ?? false;
    this.auth = opts.auth ?? false;
  }
}

export interface QboContext {
  orgId: string;
  realmId: string;
}

async function tokenFor(orgId: string): Promise<{ token: string; realmId: string }> {
  const creds = await getValidAccessToken(orgId, 'quickbooks');
  const realmId = creds?.extra?.realm_id;
  if (!creds?.access_token) {
    throw new QboError('QuickBooks n\'est plus autorisé — reconnectez l\'intégration.', { auth: true });
  }
  if (!realmId) {
    throw new QboError('Compagnie QuickBooks inconnue — reconnectez l\'intégration.', { auth: true });
  }
  return { token: creds.access_token, realmId };
}

/** Compagnie QuickBooks du bureau (sans appel à Intuit au-delà d'un éventuel renouvellement). */
export async function qboContext(orgId: string): Promise<QboContext> {
  const { realmId } = await tokenFor(orgId);
  return { orgId, realmId };
}

async function toError(res: Response): Promise<QboError> {
  const tid = res.headers.get('intuit_tid');
  const suffix = tid ? ` [intuit_tid: ${tid}]` : '';
  const body = await res.text();
  let message = `HTTP ${res.status}`;
  let code: string | null = null;
  try {
    const json = JSON.parse(body);
    const fault = json?.Fault?.Error?.[0];
    if (fault) {
      code = fault.code ? String(fault.code) : null;
      message = fault.Detail || fault.Message || message;
    } else if (json?.error_description || json?.error) {
      message = json.error_description || json.error;
    }
  } catch {
    if (body) message = `${message}: ${body.slice(0, 200)}`;
  }
  const retryable = res.status === 429 || res.status >= 500;
  return new QboError(`${message}${code ? ` (code ${code})` : ''}${suffix}`, {
    status: res.status,
    code,
    retryable,
    auth: res.status === 401 || res.status === 403,
  });
}

/**
 * Appel à l'API comptable. `path` est relatif à /v3/company/{realm}/
 * (ex. 'invoice', 'invoice?operation=void', 'query?query=…').
 */
export async function qboRequest<T = any>(
  orgId: string,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<T> {
  let { token, realmId } = await tokenFor(orgId);

  for (let attempt = 0; attempt < 2; attempt++) {
    const sep = path.includes('?') ? '&' : '?';
    const url = `${apiBaseUrl()}/v3/company/${realmId}/${path}${sep}minorversion=${MINOR_VERSION}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      throw new QboError(`QuickBooks injoignable : ${err instanceof Error ? err.message : String(err)}`, {
        retryable: true,
      });
    }

    if (res.status === 401 && attempt === 0) {
      // Jeton révoqué ou expiré avant l'heure : un renouvellement, un essai.
      const ok = await refreshOAuthToken(orgId, 'quickbooks');
      if (!ok) throw new QboError('QuickBooks n\'est plus autorisé — reconnectez l\'intégration.', { status: 401, auth: true });
      ({ token, realmId } = await tokenFor(orgId));
      continue;
    }
    if (!res.ok) throw await toError(res);
    return (await res.json()) as T;
  }
  throw new QboError('QuickBooks : accès refusé après renouvellement.', { status: 401, auth: true });
}

/** Échappe une valeur pour le langage de requête QuickBooks (guillemets simples). */
export function qboQuote(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/** SELECT … — renvoie la liste de l'entité demandée (vide si aucune). */
export async function qboQuery<T = any>(orgId: string, entity: string, where = '', maxResults = 1000): Promise<T[]> {
  const q = `select * from ${entity}${where ? ` where ${where}` : ''} maxresults ${maxResults}`;
  const data = await qboRequest<{ QueryResponse?: Record<string, T[]> }>(
    orgId,
    'GET',
    `query?query=${encodeURIComponent(q)}`,
  );
  return (data.QueryResponse?.[entity] as T[] | undefined) ?? [];
}

/** Lecture d'une entité par id (SyncToken courant compris). null si introuvable. */
export async function qboRead<T = any>(orgId: string, entity: string, id: string): Promise<T | null> {
  try {
    const data = await qboRequest<Record<string, T>>(orgId, 'GET', `${entity.toLowerCase()}/${encodeURIComponent(id)}`);
    return (data[entity] as T | undefined) ?? null;
  } catch (err) {
    // 610 = « Object Not Found » (supprimé côté QuickBooks).
    if (err instanceof QboError && (err.code === '610' || err.status === 404)) return null;
    throw err;
  }
}
