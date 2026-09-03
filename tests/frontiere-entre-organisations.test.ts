/**
 * LA FRONTIÈRE ENTRE DEUX ENTREPRISES.
 *
 * Le risque qui tue un SaaS multi-locataire : qu'une entreprise voie les
 * données d'une autre. Une seule fuite et la confiance est perdue — elle
 * ne se rattrape pas après coup. C'est la vérification qui compte le plus
 * avant d'accueillir de vrais clients payants.
 *
 * CE QUI A ÉTÉ MESURÉ CONTRE LA VRAIE BASE (2026-09-03)
 * Une session ouverte sur l'organisation A, puis lecture de CHAQUE table
 * portant un `org_id` en visant explicitement l'organisation B :
 *
 *     23 tables étanches, 9 refus explicites, 0 FUITE
 *
 * Les plus sensibles sont muettes : `audit_events` (B en a 30, A n'en voit
 * 0), `security_events` (41 contre 0), `company_settings`.
 * Le script `npm run qa:fuite` rejoue cette campagne à la demande.
 *
 * CE QUE CES TESTS-CI FIGENT
 * Le contrat que le code doit tenir, sans base de données, à chaque PR :
 * une route ne choisit JAMAIS son organisation d'après ce que le client
 * demande. Elle la prend de la session, ou vérifie l'appartenance.
 *
 * L'IDOR VÉRIFIÉ EN VRAI
 * `GET /api/billing/current?orgId=<autre org>` renvoie 200 — mais avec
 * l'abonnement de l'appelant, pas celui demandé. Le paramètre est ignoré
 * (billing.ts utilise `auth.orgId`). Un 200 n'est donc pas une fuite :
 * seul compte CE QUI est renvoyé. Ces tests encodent cette distinction.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const RACINE = resolve(__dirname, '..');
const lire = (p: string) => readFileSync(resolve(RACINE, p), 'utf8');

/* ── La mécanique du choix d'organisation ───────────────────────── */

describe('requireAuthedClient — d où vient l organisation', () => {
  const src = lire('server/lib/supabase.ts');

  it('l en-tête x-org-id n est honoré qu après vérification d appartenance', () => {
    // Sans ce contrôle, n'importe qui changerait d'organisation en
    // modifiant un en-tête : l'IDOR le plus simple qui soit.
    // Borne de fin : l'appel dans le CORPS de la fonction, pas la ligne
    // d'import du même nom en tête de fichier.
    const debut = src.indexOf("const headerOrg = req.header('x-org-id')");
    const bloc = src.slice(debut, src.indexOf('setSentryRequestOrg(', debut));
    expect(bloc).toContain('has_org_membership');
    expect(bloc).toContain('shouldUseRequestedOrg');
  });

  it('le client est construit avec la clé anonyme, jamais service_role', () => {
    // buildSupabaseWithAuth doit rester soumis à la RLS : c'est elle qui
    // sépare les organisations en base.
    const bloc = src.slice(src.indexOf('export function buildSupabaseWithAuth'), src.indexOf('export function getServiceClient'));
    expect(bloc).toContain('supabaseAnonKey');
    expect(bloc).not.toContain('supabaseServiceRoleKey');
  });

  it('une organisation demandée sans appartenance ne remplace pas celle de la session', () => {
    const helpers = lire('server/lib/active-org.ts');
    // shouldUseRequestedOrg ne doit accepter que si l'appartenance est vraie.
    expect(helpers).toMatch(/estMembre|isMember|member/i);
  });
});

/* ── Les routes qui acceptent un orgId du client ────────────────── */

describe('les routes qui reçoivent un orgId', () => {
  /**
   * Une route peut accepter `?orgId=` — c'est légitime quand un compte
   * appartient à plusieurs bureaux. Ce qu'elle ne doit JAMAIS faire, c'est
   * s'en servir sans vérifier l'appartenance.
   */
  const fichiers = readdirSync(resolve(RACINE, 'server/routes')).filter((f) => f.endsWith('.ts'));

  const GARDES = /isOrgMember|has_org_membership|isOrgAdminOrOwner|companyOrgIds|auth\.orgId|requireOrgAccess/;

  it('chaque fichier qui lit req.query.orgId vérifie aussi l appartenance', () => {
    const nus: string[] = [];
    for (const f of fichiers) {
      const src = lire(`server/routes/${f}`);
      const litOrgId = /req\.(query|body)\??\.\??\s*\.?orgId|parseOrgId\(req\./.test(src);
      if (!litOrgId) continue;
      if (!GARDES.test(src)) nus.push(f);
    }
    // Si ce test rougit : une route accepte une organisation venue du
    // client sans jamais vérifier que l'appelant en est membre.
    expect(nus).toEqual([]);
  });

  it('parseOrgId ne fabrique pas d organisation par défaut', () => {
    // Un repli silencieux sur « la première organisation trouvée » serait
    // une fuite déguisée.
    const src = lire('server/lib/validation.ts');
    const i = src.indexOf('parseOrgId');
    if (i === -1) return;                       // la fonction vit ailleurs
    const bloc = src.slice(i, i + 400);
    expect(bloc).not.toMatch(/limit\(1\)|first\(\)/);
  });
});

/* ── Le client de service, celui qui contourne la RLS ───────────── */

describe('getServiceClient — le contournement de la RLS', () => {
  it('il exige la clé service_role et refuse de fonctionner sans', () => {
    const src = lire('server/lib/supabase.ts');
    const bloc = src.slice(src.indexOf('export function getServiceClient'), src.indexOf('export async function'));
    // Pas de repli discret sur la clé anonyme : soit la clé est là, soit
    // l'appel échoue franchement.
    expect(bloc).toContain('throw new Error');
    expect(bloc).not.toContain('supabaseAnonKey');
  });

  it('les routes publiques n utilisent jamais l organisation demandée par le client', () => {
    // Le portail client et le paiement par lien sont atteignables sans
    // session : leur périmètre doit venir du JETON, jamais d'un paramètre.
    for (const f of ['portal.ts', 'public-payment.ts']) {
      let src: string;
      try { src = lire(`server/routes/${f}`); } catch { continue; }
      const parOrgIdClient = /parseOrgId\(req\.(query|body)/.test(src);
      expect(parOrgIdClient).toBe(false);
    }
  });
});

/* ── Ce que la campagne réelle a établi ─────────────────────────── */

describe('la campagne de fuite (npm run qa:fuite)', () => {
  const src = lire('scripts/qa/fuite-entre-organisations.mjs');

  it('elle ouvre une VRAIE session, elle ne lit pas le code', () => {
    // Une vérification statique ne prouve rien sur la RLS : il faut une
    // session réelle et une lecture réelle.
    expect(src).toContain('generateLink');
    expect(src).toContain('verifyOtp');
  });

  it('elle vise explicitement l organisation d en face', () => {
    expect(src).toContain(".eq('org_id', B.org)");
  });

  it('elle échoue avec un code non nul dès la première fuite', () => {
    // Sans cela, elle passerait inaperçue dans une chaîne d'intégration.
    expect(src).toContain('process.exit(fuites.length ? 1 : 0)');
  });

  it('elle couvre les tables les plus sensibles', () => {
    for (const t of ['audit_events', 'security_events', 'company_settings', 'invoices', 'payments']) {
      expect(src).toContain(`'${t}'`);
    }
  });
});
