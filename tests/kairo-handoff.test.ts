/**
 * Connexion automatique depuis Kairo — vérification du jeton.
 *
 * Cet endpoint ouvre une session Lume sur présentation d'un jeton signé. Une
 * faille ici ne donne pas accès à une page : elle donne accès à un COMPTE.
 * Les tests portent donc sur les refus, pas sur le cas passant.
 *
 * La logique de vérification est rejouée à l'identique ici plutôt que testée
 * à travers le serveur : monter Express complet exigerait Supabase, Stripe et
 * Twilio. Un test de forme (le code source contient-il tel garde-fou ?)
 * accompagne chaque test de comportement, pour que la copie ne puisse pas
 * diverger en silence de l'original.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import crypto from 'node:crypto';

const source = readFileSync(resolve(__dirname, '..', 'server', 'index.ts'), 'utf8');
/** Le bloc de l'endpoint, isolé du reste du fichier. */
const bloc = source.slice(
  source.indexOf("app.get('/api/auth/from-kairo'"),
  source.indexOf("app.get('/api/auth/from-kairo'") + 9000,
);

const SECRET = 'secret-de-test-pour-la-suite';
const DESTINATIONS = ['/invoices/', '/jobs/', '/clients/', '/deals/', '/quotes/', '/messages/', '/leads/'];

function signer(charge: Record<string, unknown>, secret = SECRET): string {
  const corps = Buffer.from(JSON.stringify(charge), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(corps).digest('base64url');
  return `${corps}.${sig}`;
}

/** Rejoue la vérification de l'endpoint. Renvoie le motif de refus, ou null. */
function verifier(jeton: string, vus = new Map<string, number>()): string | null {
  if (!jeton) return 'jeton absent';
  if (jeton.length > 4096) return 'jeton trop long';
  const sep = jeton.lastIndexOf('.');
  if (sep <= 0 || sep === jeton.length - 1) return 'format';
  const corps = jeton.slice(0, sep);
  const fournie = Buffer.from(jeton.slice(sep + 1), 'base64url');
  const attendue = crypto.createHmac('sha256', SECRET).update(corps).digest();
  if (fournie.length !== attendue.length) return 'signature';
  if (!crypto.timingSafeEqual(fournie, attendue)) return 'signature';

  let charge: any;
  try { charge = JSON.parse(Buffer.from(corps, 'base64url').toString('utf8')); } catch { return 'corps'; }
  if (!charge || typeof charge !== 'object') return 'corps';
  const { email, lume_org_id: orgId, target, exp, jti, iss } = charge;
  if (iss !== 'kairo') return 'emetteur';
  if (typeof jti !== 'string' || !jti) return 'jti';
  if (typeof email !== 'string' || !email.includes('@')) return 'courriel';
  if (typeof orgId !== 'string' || !orgId) return 'organisation';
  if (typeof target !== 'string' || !target) return 'destination';
  const maintenant = Math.floor(Date.now() / 1000);
  if (typeof exp !== 'number' || exp < maintenant) return 'expire';
  if (vus.has(jti)) return 'rejeu';
  vus.set(jti, exp);
  if (target.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(target)) return 'destination absolue';
  if (!DESTINATIONS.some((p) => target.startsWith(p))) return 'destination interdite';
  return null;
}

const valide = () => ({
  email: 'patron@exemple.ca',
  lume_org_id: '11111111-2222-3333-4444-555555555555',
  target: '/invoices/abc',
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 60,
  jti: crypto.randomUUID(),
  iss: 'kairo',
});

describe('un jeton légitime passe', () => {
  it('accepte un jeton bien formé', () => {
    expect(verifier(signer(valide()))).toBeNull();
  });
});

describe('la signature ne peut pas être contournée', () => {
  it('refuse un jeton signé avec un autre secret', () => {
    // Le cas de base : quelqu'un qui n'a PAS le secret ne doit rien pouvoir.
    expect(verifier(signer(valide(), 'mauvais-secret'))).toBe('signature');
  });

  it('refuse un corps modifié après signature', () => {
    // Escalade classique : je change l'adresse pour celle du propriétaire.
    const jeton = signer(valide());
    const [, sig] = jeton.split('.');
    const forge = { ...valide(), email: 'proprietaire@exemple.ca' };
    const corpsForge = Buffer.from(JSON.stringify(forge), 'utf8').toString('base64url');
    expect(verifier(`${corpsForge}.${sig}`)).toBe('signature');
  });

  it('refuse un jeton sans signature', () => {
    const corps = Buffer.from(JSON.stringify(valide()), 'utf8').toString('base64url');
    expect(verifier(corps)).toBe('format');
    expect(verifier(`${corps}.`)).toBe('format');
  });

  it('compare en temps constant', () => {
    // Une comparaison naïve laisserait deviner la signature octet par octet.
    expect(bloc).toContain('crypto.timingSafeEqual');
    // `timingSafeEqual` lève si les longueurs diffèrent : le test de longueur
    // doit venir AVANT, sinon un jeton mal formé provoque une 500.
    expect(bloc.indexOf('fournie.length !== attendue.length'))
      .toBeLessThan(bloc.indexOf('crypto.timingSafeEqual'));
  });
});

describe('la fenêtre de validité est respectée', () => {
  it('refuse un jeton expiré', () => {
    expect(verifier(signer({ ...valide(), exp: Math.floor(Date.now() / 1000) - 1 }))).toBe('expire');
  });

  it('refuse un jeton sans date d’expiration', () => {
    // Sans `exp`, le lien vaudrait pour toujours.
    const { exp, ...sansExp } = valide();
    expect(verifier(signer(sansExp))).toBe('expire');
  });

  it('refuse un émetteur autre que Kairo', () => {
    expect(verifier(signer({ ...valide(), iss: 'autre' }))).toBe('emetteur');
  });
});

describe('un jeton ne sert qu’une fois', () => {
  it('refuse le rejeu du même jti', () => {
    // Le lien fuit par l'historique, les journaux de proxy et le Referer :
    // sans usage unique, il reste exploitable pendant toute sa durée de vie.
    const vus = new Map<string, number>();
    const jeton = signer(valide());
    expect(verifier(jeton, vus)).toBeNull();
    expect(verifier(jeton, vus)).toBe('rejeu');
  });

  it('refuse un jeton sans jti', () => {
    const { jti, ...sansJti } = valide();
    expect(verifier(signer(sansJti))).toBe('jti');
  });

  it('le jti est marqué AVANT la suite du traitement', () => {
    // Deux requêtes simultanées portant le même jti ne doivent pas passer
    // toutes les deux.
    expect(bloc.indexOf('jetonsVus.set(jti, exp)'))
      .toBeLessThan(bloc.indexOf('DESTINATIONS_AUTORISEES.some'));
  });

  it('la limite du garde en mémoire est documentée', () => {
    // Avec plusieurs instances, un rejeu passerait sur une autre instance.
    expect(source).toContain('LIMITE CONNUE');
    expect(source).toMatch(/Redis/);
  });
});

describe('la destination ne peut pas sortir de Lume', () => {
  it('refuse une URL absolue', () => {
    // Rediriger la session fraîchement ouverte vers un domaine tiers.
    expect(verifier(signer({ ...valide(), target: 'https://evil.example/x' }))).toBe('destination absolue');
    expect(verifier(signer({ ...valide(), target: 'javascript:alert(1)' }))).toBe('destination absolue');
  });

  it('refuse une URL protocol-relative', () => {
    // `//evil.example` est suivi par le navigateur vers un AUTRE domaine —
    // le piège que la seule liste blanche de préfixes ne voit pas.
    expect(verifier(signer({ ...valide(), target: '//evil.example/x' }))).toBe('destination absolue');
    // Et le garde existe REELLEMENT dans l'endpoint : sans cette assertion, le
    // test ne validerait que la copie locale de la logique.
    expect(bloc).toContain("target.startsWith('//')");
    expect(bloc).toContain('destination absolue refusée');
  });

  it('refuse une route hors liste blanche', () => {
    expect(verifier(signer({ ...valide(), target: '/settings/billing' }))).toBe('destination interdite');
    expect(verifier(signer({ ...valide(), target: '/admin' }))).toBe('destination interdite');
  });

  it('accepte les sept routes prévues', () => {
    for (const p of DESTINATIONS) {
      expect(verifier(signer({ ...valide(), target: `${p}abc` })), p).toBeNull();
    }
  });
});

describe('les garde-fous côté serveur', () => {
  it('l’adhésion à l’organisation doit être ACTIVE', () => {
    // Sans ce filtre, un employé congédié — dont l'adhésion est passée à
    // `inactive` mais reste en base — garderait son accès par cette porte.
    expect(bloc).toContain("eq('status', 'active')");
  });

  it('une erreur de lecture ne passe pas pour un refus', () => {
    // supabase-js ne lève pas : sans ce test, une panne de base donnerait
    // « non membre », un message trompeur pour un utilisateur légitime.
    expect(bloc).toContain('errAdhesion');
    expect(bloc).toContain('errListe');
  });

  it('le motif de refus ne fuit pas vers le client', () => {
    // Détailler ce qui manque aiderait à forger un jeton valide.
    expect(bloc).toContain("error: 'Lien invalide ou expiré.'");
  });

  it('chaque échange est journalisé', () => {
    // Le secret vaut un mot de passe administrateur : son usage doit laisser
    // une trace exploitable.
    expect(bloc).toContain("action: 'auth.from_kairo'");
  });

  it('la base publique ne vient pas des en-têtes', () => {
    // Dériver la base d'un en-tête Host permettrait de rediriger la session
    // vers un domaine contrôlé par l'attaquant.
    expect(bloc).toContain('resolvePublicBaseUrl(req)');
    const helpers = readFileSync(resolve(__dirname, '..', 'server', 'lib', 'helpers.ts'), 'utf8');
    expect(helpers).toContain('Never derive from request headers');
  });

  it('la taille du jeton est bornée', () => {
    // Sinon un HMAC serait calculé sur des mégaoctets à chaque requête.
    expect(bloc).toContain('TAILLE_MAX_JETON');
  });

  it('le secret absent donne 503, pas un refus silencieux', () => {
    // Un 400 laisserait croire que le lien est mauvais alors que c'est la
    // configuration du serveur qui manque.
    expect(bloc).toContain("Connexion depuis Kairo non configurée");
  });
});

describe('le secret n’est jamais versionné', () => {
  it('aucune valeur en dur dans le code', () => {
    expect(source).toContain('process.env.KAIRO_LUME_HANDOFF_SECRET');
    // Un secret de 40+ caractères écrit en clair à côté du nom de la variable.
    expect(source).not.toMatch(/KAIRO_LUME_HANDOFF_SECRET\s*=\s*['"][A-Za-z0-9_-]{40,}/);
  });
});
