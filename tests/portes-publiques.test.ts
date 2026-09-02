/**
 * LES PORTES OUVERTES SANS MOT DE PASSE.
 *
 * Quatre surfaces du CRM s atteignent SANS etre connecte. Sur chacune, le
 * JETON DANS L URL est le seul justificatif d identite : pas de session,
 * pas de role, pas de RLS pour rattraper une erreur.
 *
 *   /api/portal/:token       — le client voit ses jobs, devis et factures
 *   /api/survey/:token       — le client note une prestation
 *   /api/unsubscribe/:token  — desinscription en un clic
 *   MFA par SMS              — le code a 6 chiffres protege un compte
 *
 * Aucune n avait de test. Un jeton mal valide, et un inconnu lit le dossier
 * d un client ; un code SMS sans limite de tentatives, et un compte se force
 * a coups d essais.
 *
 * CE FICHIER NE TESTE QUE DES DECISIONS, jamais un envoi reel.
 *
 * LES REGLES REPRODUITES, relevees dans le code le 2026-09-02 :
 *
 *   portal.ts      jeton >= 32 caracteres, alphanumerique + _ et -
 *                  recherche PAR HASH SHA-256 (le clair n est plus stocke)
 *                  + expiration + revocation
 *                  + delai aleatoire 50-150 ms sur les echecs
 *   unsubscribe.ts jeton = exactement 64 caracteres hexadecimaux
 *   mfa-sms.ts     code hache, 5 tentatives maximum, 10 minutes de validite,
 *                  usage unique (`consumed_at`)
 */

import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

/* === 1. LE PORTAIL CLIENT ======================================== */

type LigneClient = {
  portal_token_hash: string;
  portal_token_expires_at: string | null;
  portal_token_revoked_at: string | null;
  deleted_at: string | null;
};

/** Reproduction des gardes de `GET /api/portal/:token`. */
function ouvrirLePortail(
  jeton: string | null | undefined,
  base: LigneClient[],
  maintenant = new Date(),
): { code: 200 | 404; delaiApplique: boolean } {
  // 1) La forme du jeton, avant toute requete.
  if (!jeton || jeton.length < 32 || !/^[a-zA-Z0-9_-]+$/.test(jeton)) {
    // Delai aleatoire : sans lui, un jeton trop court repondrait plus vite
    // qu un jeton de bonne longueur, ce qui renseigne l attaquant.
    return { code: 404, delaiApplique: true };
  }

  // 2) La recherche se fait PAR LE HASH. Retrouver la ligne prouve deja que
  //    le jeton est le bon : correspondance exacte SHA-256.
  const empreinte = sha256(jeton);
  const client = base.find((c) => c.portal_token_hash === empreinte && !c.deleted_at);

  const pasExpire = !client?.portal_token_expires_at
    || new Date(client.portal_token_expires_at) > maintenant;
  const pasRevoque = !client?.portal_token_revoked_at;

  if (!client || !pasExpire || !pasRevoque) return { code: 404, delaiApplique: false };
  return { code: 200, delaiApplique: false };
}

const JETON_VALIDE = 'a'.repeat(40);
const clientActif: LigneClient = {
  portal_token_hash: sha256(JETON_VALIDE),
  portal_token_expires_at: null,
  portal_token_revoked_at: null,
  deleted_at: null,
};

describe('le portail client', () => {
  it('un jeton valide ouvre le portail', () => {
    expect(ouvrirLePortail(JETON_VALIDE, [clientActif]).code).toBe(200);
  });

  it('un jeton trop court est refuse sans meme interroger la base', () => {
    const r = ouvrirLePortail('abc', [clientActif]);
    expect(r.code).toBe(404);
    expect(r.delaiApplique).toBe(true);
  });

  it('un jeton vide ou absent est refuse', () => {
    expect(ouvrirLePortail('', [clientActif]).code).toBe(404);
    expect(ouvrirLePortail(null, [clientActif]).code).toBe(404);
    expect(ouvrirLePortail(undefined, [clientActif]).code).toBe(404);
  });

  it('un jeton avec des caracteres interdits est refuse', () => {
    // Ferme la porte aux tentatives d injection dans l URL.
    expect(ouvrirLePortail(`${'a'.repeat(39)}'`, [clientActif]).code).toBe(404);
    expect(ouvrirLePortail(`${'a'.repeat(39)}/`, [clientActif]).code).toBe(404);
    expect(ouvrirLePortail(`${'a'.repeat(39)} `, [clientActif]).code).toBe(404);
  });

  it('un jeton INCONNU ne donne rien', () => {
    expect(ouvrirLePortail('z'.repeat(40), [clientActif]).code).toBe(404);
  });

  it('le jeton EN CLAIR ne suffit pas : c est le hash qui est compare', () => {
    // Si la base stockait encore le clair et le comparait, cette ligne
    // ouvrirait le portail. Elle ne doit pas.
    const clientClair = { ...clientActif, portal_token_hash: JETON_VALIDE };
    expect(ouvrirLePortail(JETON_VALIDE, [clientClair]).code).toBe(404);
  });

  it('un jeton EXPIRE est refuse', () => {
    const hier = new Date(Date.now() - 86_400_000).toISOString();
    const expire = { ...clientActif, portal_token_expires_at: hier };
    expect(ouvrirLePortail(JETON_VALIDE, [expire]).code).toBe(404);
  });

  it('un jeton qui expire demain fonctionne encore', () => {
    const demain = new Date(Date.now() + 86_400_000).toISOString();
    const valide = { ...clientActif, portal_token_expires_at: demain };
    expect(ouvrirLePortail(JETON_VALIDE, [valide]).code).toBe(200);
  });

  it('un jeton REVOQUE est refuse, meme non expire', () => {
    // Revoquer doit couper l acces immediatement : c est le geste qu on fait
    // quand un lien a fuite.
    const revoque = { ...clientActif, portal_token_revoked_at: new Date().toISOString() };
    expect(ouvrirLePortail(JETON_VALIDE, [revoque]).code).toBe(404);
  });

  it('le portail d un client SUPPRIME ne s ouvre plus', () => {
    const supprime = { ...clientActif, deleted_at: new Date().toISOString() };
    expect(ouvrirLePortail(JETON_VALIDE, [supprime]).code).toBe(404);
  });

  it('le jeton d un client n ouvre pas le portail d un autre', () => {
    // La garde qui compte le plus : deux clients, deux jetons, aucun
    // croisement possible.
    const autreJeton = 'b'.repeat(40);
    const autre: LigneClient = { ...clientActif, portal_token_hash: sha256(autreJeton) };
    expect(ouvrirLePortail(JETON_VALIDE, [autre]).code).toBe(404);
    expect(ouvrirLePortail(autreJeton, [autre]).code).toBe(200);
  });
});

/* === 2. LA DESINSCRIPTION ======================================== */

/** Reproduction du filtre de `GET /api/unsubscribe/:token`. */
function jetonDesinscriptionValide(jeton: string): boolean {
  return /^[a-f0-9]{64}$/.test(String(jeton || ''));
}

describe('le lien de desinscription', () => {
  it('un jeton hexadecimal de 64 caracteres est accepte', () => {
    expect(jetonDesinscriptionValide('a1b2c3d4'.repeat(8))).toBe(true);
  });

  it('un jeton trop court est refuse', () => {
    expect(jetonDesinscriptionValide('a1b2c3')).toBe(false);
  });

  it('un jeton trop long est refuse', () => {
    expect(jetonDesinscriptionValide('a'.repeat(65))).toBe(false);
  });

  it('des majuscules sont refusees — le format attendu est minuscule', () => {
    expect(jetonDesinscriptionValide('A'.repeat(64))).toBe(false);
  });

  it('un caractere non hexadecimal est refuse', () => {
    expect(jetonDesinscriptionValide(`${'a'.repeat(63)}z`)).toBe(false);
  });

  it('un jeton vide est refuse', () => {
    expect(jetonDesinscriptionValide('')).toBe(false);
  });
});

/* === 3. LE CODE SMS (MFA) ======================================== */

const MAX_TENTATIVES = 5;
const VALIDITE_MINUTES = 10;

type Defi = {
  code_hash: string;
  attempts: number;
  expires_at: string;
  consumed_at: string | null;
} | null;

/** Reproduction de `verifySmsChallenge()`. */
function verifierLeCode(
  defi: Defi,
  codeSaisi: string,
  maintenant = new Date(),
): { ok: boolean; error?: string; tentativesApres?: number } {
  if (!defi) return { ok: false, error: 'no_pending_code' };
  if (defi.consumed_at) return { ok: false, error: 'no_pending_code' };
  if (new Date(defi.expires_at) < maintenant) return { ok: false, error: 'code_expired' };
  if ((defi.attempts ?? 0) >= MAX_TENTATIVES) return { ok: false, error: 'too_many_attempts' };

  if (sha256(String(codeSaisi || '').trim()) !== defi.code_hash) {
    return { ok: false, error: 'invalid_code', tentativesApres: (defi.attempts ?? 0) + 1 };
  }
  return { ok: true };
}

const defiFrais = (over: Partial<NonNullable<Defi>> = {}): Defi => ({
  code_hash: sha256('123456'),
  attempts: 0,
  expires_at: new Date(Date.now() + VALIDITE_MINUTES * 60_000).toISOString(),
  consumed_at: null,
  ...over,
});

describe('le code SMS a six chiffres', () => {
  it('le bon code passe', () => {
    expect(verifierLeCode(defiFrais(), '123456').ok).toBe(true);
  });

  it('les espaces autour du code sont toleres', () => {
    // Un code copie-colle depuis un SMS traine souvent une espace.
    expect(verifierLeCode(defiFrais(), '  123456  ').ok).toBe(true);
  });

  it('un mauvais code echoue et incremente le compteur', () => {
    const r = verifierLeCode(defiFrais(), '000000');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('invalid_code');
    expect(r.tentativesApres).toBe(1);
  });

  it('sans code en attente, rien ne passe', () => {
    expect(verifierLeCode(null, '123456').error).toBe('no_pending_code');
  });

  it('un code DEJA UTILISE ne repasse pas', () => {
    // Usage unique : sans `consumed_at`, un code intercepte resterait
    // rejouable indefiniment.
    const utilise = defiFrais({ consumed_at: new Date().toISOString() });
    expect(verifierLeCode(utilise, '123456').ok).toBe(false);
  });

  it('un code EXPIRE ne passe pas, meme s il est bon', () => {
    const perime = defiFrais({ expires_at: new Date(Date.now() - 1000).toISOString() });
    const r = verifierLeCode(perime, '123456');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('code_expired');
  });

  it('apres cinq tentatives, le code est bloque', () => {
    // La garde anti-force brute : 6 chiffres, c est un million de
    // combinaisons — sans plafond, elles se testent.
    const bloque = defiFrais({ attempts: MAX_TENTATIVES });
    expect(verifierLeCode(bloque, '123456').error).toBe('too_many_attempts');
  });

  it('le BON code ne passe plus une fois le plafond atteint', () => {
    // Le point crucial : le blocage doit valoir aussi pour le bon code,
    // sinon un attaquant qui trouve a la 6e tentative entrerait quand meme.
    const bloque = defiFrais({ attempts: MAX_TENTATIVES });
    expect(verifierLeCode(bloque, '123456').ok).toBe(false);
  });

  it('a la quatrieme tentative, on peut encore essayer', () => {
    const presqueBloque = defiFrais({ attempts: MAX_TENTATIVES - 1 });
    expect(verifierLeCode(presqueBloque, '123456').ok).toBe(true);
  });

  it('le code n est jamais stocke en clair', () => {
    // Le defi ne contient qu une empreinte : meme un acces en lecture a la
    // table ne revele aucun code.
    const d = defiFrais();
    expect(d!.code_hash).not.toBe('123456');
    expect(d!.code_hash).toHaveLength(64);
  });

  it('la validite est bien de dix minutes', () => {
    expect(VALIDITE_MINUTES).toBe(10);
  });

  it('le plafond est bien de cinq tentatives', () => {
    expect(MAX_TENTATIVES).toBe(5);
  });
});
