/**
 * Identités de domaine chez Amazon SES — l'équivalent de l'API Domains de
 * Resend, dont ce module prend la relève : la plateforme envoie par SES
 * depuis la migration, alors que `domaines.ts` déclarait encore les domaines
 * des entreprises chez Resend. Sans `RESEND_API_KEY`, aucune entreprise ne
 * pouvait donc faire partir ses courriels de son propre domaine.
 *
 * Trois opérations suffisent :
 *   - `creerIdentite`  → CreateEmailIdentity, rend les 3 CNAME DKIM à coller
 *   - `lireIdentite`   → GetEmailIdentity, dit si SES a vu les CNAME
 *   - `supprimerIdentite` → DeleteEmailIdentity
 *
 * On appelle l'API v2 en HTTP signé SigV4 avec `node:crypto` plutôt que
 * d'ajouter le SDK AWS (~3 Mo) pour trois requêtes.
 *
 * Identifiants : `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`. Attention,
 * `SES_SMTP_PASS` n'est PAS un secret IAM mais un mot de passe SMTP dérivé —
 * il ne peut pas signer un appel API.
 */
import { createHash, createHmac } from 'node:crypto';
import { logger } from '../logger';

const SERVICE = 'ses';

export interface IdentiteSes {
  /** Les 3 CNAME DKIM à publier chez le registraire du client. */
  dkim: Array<{ name: string; value: string }>;
  /** SES a vu les CNAME et signe ce domaine. */
  verifie: boolean;
  /** SUCCESS | PENDING | FAILED | TEMPORARY_FAILURE | NOT_STARTED */
  statut: string;
}

function region(): string {
  return (process.env.SES_REGION || 'ca-central-1').trim();
}

function identifiants(): { cle: string; secret: string } {
  const cle = (process.env.AWS_ACCESS_KEY_ID || '').trim();
  const secret = (process.env.AWS_SECRET_ACCESS_KEY || '').trim();
  if (!cle || !secret) {
    const err: any = new Error('SES API credentials are not configured.');
    err.status = 503;
    throw err;
  }
  return { cle, secret };
}

/** Vrai si la plateforme peut déclarer des domaines (sinon la carte des réglages se désactive). */
export function sesIdentitesDisponible(): boolean {
  return Boolean((process.env.AWS_ACCESS_KEY_ID || '').trim() && (process.env.AWS_SECRET_ACCESS_KEY || '').trim());
}

function hex(b: Buffer): string {
  return b.toString('hex');
}

function sha256(s: string): string {
  return hex(createHash('sha256').update(s, 'utf8').digest());
}

function hmac(cle: Buffer | string, donnee: string): Buffer {
  return createHmac('sha256', cle).update(donnee, 'utf8').digest();
}

/**
 * Signature AWS SigV4. Le canonical request doit être reproduit au caractère
 * près : toute divergence rend un 403 sans indice sur la cause.
 */
function signer(methode: string, chemin: string, corps: string, hote: string, reg: string): Record<string, string> {
  const { cle, secret } = identifiants();
  const maintenant = new Date();
  const ts = maintenant.toISOString().replace(/[:-]|\.\d{3}/g, ''); // 20260924T120000Z
  const jour = ts.slice(0, 8);

  const empreinteCorps = sha256(corps);
  const enTetesCanoniques = `content-type:application/json\nhost:${hote}\nx-amz-date:${ts}\n`;
  const signes = 'content-type;host;x-amz-date';
  const requeteCanonique = [methode, chemin, '', enTetesCanoniques, signes, empreinteCorps].join('\n');

  const portee = `${jour}/${reg}/${SERVICE}/aws4_request`;
  const aSigner = ['AWS4-HMAC-SHA256', ts, portee, sha256(requeteCanonique)].join('\n');

  const kDate = hmac(`AWS4${secret}`, jour);
  const kRegion = hmac(kDate, reg);
  const kService = hmac(kRegion, SERVICE);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = hex(hmac(kSigning, aSigner));

  return {
    'Content-Type': 'application/json',
    'X-Amz-Date': ts,
    Authorization: `AWS4-HMAC-SHA256 Credential=${cle}/${portee}, SignedHeaders=${signes}, Signature=${signature}`,
  };
}

async function appeler<T>(methode: 'GET' | 'POST' | 'DELETE', chemin: string, corps?: Record<string, unknown>): Promise<T> {
  const reg = region();
  const hote = `email.${reg}.amazonaws.com`;
  const charge = corps ? JSON.stringify(corps) : '';
  const res = await fetch(`https://${hote}${chemin}`, {
    method: methode,
    headers: signer(methode, chemin, charge, hote, reg),
    ...(corps ? { body: charge } : {}),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = json?.message || json?.Message || `HTTP ${res.status}`;
    logger.warn('[ses-identites] SES a refusé', { methode, chemin, status: res.status, message });
    const err: any = new Error(`SES ${res.status}: ${message}`);
    // 404 : identité déjà retirée à la main — l'appelant décide quoi en faire.
    err.status = res.status === 404 ? 404 : 502;
    throw err;
  }
  return json as T;
}

/** Les CNAME que SES attend, tels qu'on les affiche au client. */
function cnameDepuis(domaine: string, jetons: string[] | undefined, reg: string): Array<{ name: string; value: string }> {
  return (jetons ?? []).map((jeton) => ({
    name: `${jeton}._domainkey.${domaine}`,
    value: `${jeton}.dkim.${reg}.amazonses.com`,
  }));
}

/**
 * Déclare le domaine et rend les 3 CNAME DKIM. SES ne vérifie rien tout de
 * suite : le client publie les CNAME, puis `lireIdentite` dira quand c'est bon.
 */
export async function creerIdentite(domaine: string): Promise<IdentiteSes> {
  const rep = await appeler<any>('POST', '/v2/email/identities', {
    EmailIdentity: domaine,
    DkimSigningAttributes: { NextSigningKeyLength: 'RSA_2048' },
  });
  const attr = rep?.DkimAttributes ?? {};
  return {
    dkim: cnameDepuis(domaine, attr.Tokens, region()),
    verifie: attr.Status === 'SUCCESS',
    statut: attr.Status || 'NOT_STARTED',
  };
}

/** L'état courant chez SES. `verifie` devient vrai dès que les CNAME sont publiés. */
export async function lireIdentite(domaine: string): Promise<IdentiteSes> {
  const rep = await appeler<any>('GET', `/v2/email/identities/${encodeURIComponent(domaine)}`);
  const attr = rep?.DkimAttributes ?? {};
  return {
    dkim: cnameDepuis(domaine, attr.Tokens, region()),
    // VerifiedForSendingStatus est la seule garantie qu'un envoi partira.
    verifie: Boolean(rep?.VerifiedForSendingStatus) && attr.Status === 'SUCCESS',
    statut: attr.Status || 'NOT_STARTED',
  };
}

export async function supprimerIdentite(domaine: string): Promise<void> {
  await appeler('DELETE', `/v2/email/identities/${encodeURIComponent(domaine)}`);
}
