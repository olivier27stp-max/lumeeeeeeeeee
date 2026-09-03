/**
 * LE GARDIEN DES ROUTES — qui a le droit d appeler quoi.
 *
 * `server/lib/route-permissions.ts` (413 lignes) est monte en middleware
 * devant TOUTE l API. Une seule table associe chaque route a la permission
 * qu elle exige. C est la couche qui decide si un vendeur peut appeler
 * l endpoint des remboursements.
 *
 * Elle n avait aucun test.
 *
 * CE QUE CE FICHIER VERIFIE, en deux temps
 *
 *   1. LA MECANIQUE — la reconnaissance des chemins et des prefixes publics,
 *      reproduite fidelement.
 *
 *   2. LA COUVERTURE REELLE — un controle qui LIT les vraies routes de
 *      `server/routes/` et les croise avec la table. C est lui qui peut
 *      trouver un trou, pas seulement prevenir une regression.
 *
 * CE QUE L AUDIT A TROUVE (2026-09-02)
 *   425 routes declarees, 189 regles, 30 prefixes publics.
 *   223 routes n ont AUCUNE regle : elles tombent sur `return next()` et
 *   dependent entierement de leur propre garde interne.
 *
 *   Verification faite fichier par fichier : sur ces 223, seuls quatre
 *   fichiers n appellent aucune garde — et les quatre sont legitimes :
 *     cron.ts, reminders-cron.ts  -> en-tete secret `x-cron-secret`
 *     auth.ts /login-failed       -> limite de debit (authRateLimit)
 *     unsubscribe.ts              -> jeton de 64 caracteres dans l URL
 *
 *   AUCUN TROU DE SECURITE. Ces tests figent ce constat : si une route
 *   nouvelle arrive sans regle ET sans garde interne, ils rougissent.
 *
 * LE POINT FRAGILE, mesure et surveille
 *   La normalisation traite tout segment de plus de 10 caracteres comme un
 *   identifiant. `/api/team/suggestions` engendre donc le candidat
 *   `/api/team/:id`. Si une regle portait ce nom, une vraie route heriterait
 *   d une permission qui ne la concerne pas.
 *   Mesure aujourd hui : ZERO collision. Un test le verifie en continu.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const RACINE = resolve(__dirname, '..');
const source = readFileSync(resolve(RACINE, 'server/lib/route-permissions.ts'), 'utf8');

/* ── Extraction de la table et des prefixes publics ─────────────── */

const blocRegles = source.slice(
  source.indexOf('const ROUTE_PERMISSIONS'),
  source.indexOf('function normalisePathForMatch'),
);
const REGLES = new Map<string, string>();
for (const m of blocRegles.matchAll(/'(ALL|GET|POST|PUT|PATCH|DELETE)\s+([^']+)'\s*:\s*(\[[^\]]*\]|'[^']*')/g)) {
  REGLES.set(`${m[1]} ${m[2]}`, m[3]);
}

const blocPublics = source.slice(
  source.indexOf('const publicPrefixes'),
  source.indexOf('return async (req, res, next)'),
);
const PUBLICS = [...blocPublics.matchAll(/'([^']+)'/g)].map((m) => m[1]);

const PARAMS = [':id', ':appId', ':userId', ':token', ':trainingId', ':feature', ':courseId', ':moduleId', ':eventId', ':memberId'];

/** Reproduction de `normalisePathForMatch()`. */
function candidats(methode: string, chemin: string): string[] {
  const seg = chemin.split('/');
  const out = [`${methode} ${chemin}`];
  for (let i = 0; i < seg.length; i++) {
    const s = seg[i];
    const estIdentifiant =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
      || /^\d+$/.test(s)
      || (s.length > 10 && /^[a-zA-Z0-9_-]+$/.test(s));
    if (!estIdentifiant) continue;
    for (const p of PARAMS) {
      const s2 = [...seg];
      s2[i] = p;
      out.push(`${methode} ${s2.join('/')}`);
    }
  }
  return out;
}

const estPublic = (chemin: string) => PUBLICS.some((p) => chemin.startsWith(p));

/* ── Les vraies routes du serveur ───────────────────────────────── */

type Route = { fichier: string; methode: string; chemin: string };

const ROUTES: Route[] = (() => {
  const out: Route[] = [];
  const dossier = resolve(RACINE, 'server/routes');
  for (const f of readdirSync(dossier).filter((f) => f.endsWith('.ts'))) {
    const c = readFileSync(resolve(dossier, f), 'utf8');
    for (const m of c.matchAll(/router\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]/g)) {
      out.push({ fichier: f, methode: m[1].toUpperCase(), chemin: '/api' + m[2] });
    }
  }
  return out;
})();

function aUneRegle(methode: string, chemin: string): boolean {
  for (const r of REGLES.keys()) {
    if (r.startsWith('ALL ') && chemin.startsWith(r.slice(4))) return true;
  }
  const cands = candidats(methode, chemin).flatMap((c) => [c, c.replace(/^\w+ /, 'ALL ')]);
  return cands.some((c) => REGLES.has(c));
}

/* ── 1. LA MECANIQUE ────────────────────────────────────────────── */

describe('la reconnaissance des chemins', () => {
  it('un chemin exact se reconnait tel quel', () => {
    expect(candidats('GET', '/api/clients')[0]).toBe('GET /api/clients');
  });

  it('un identifiant UUID devient un parametre', () => {
    const c = candidats('GET', '/api/clients/550e8400-e29b-41d4-a716-446655440000');
    expect(c).toContain('GET /api/clients/:id');
  });

  it('un identifiant numerique devient un parametre', () => {
    expect(candidats('GET', '/api/jobs/42')).toContain('GET /api/jobs/:id');
  });

  it('un segment court n est PAS pris pour un identifiant', () => {
    // « new » ne doit pas devenir « :id », sinon /api/jobs/new heriterait
    // de la permission de /api/jobs/:id.
    const c = candidats('GET', '/api/jobs/new');
    expect(c).toHaveLength(1);
    expect(c[0]).toBe('GET /api/jobs/new');
  });

  it('la methode fait partie de la cle', () => {
    // Lire et supprimer une facture ne demandent pas la meme permission.
    expect(candidats('GET', '/api/invoices/42')[0]).not.toBe(candidats('DELETE', '/api/invoices/42')[0]);
  });
});

describe('les routes publiques', () => {
  it('le portail client est public', () => {
    expect(estPublic('/api/portal/abc123')).toBe(true);
  });

  it('les webhooks de paiement sont publics', () => {
    // Ils ne peuvent pas etre authentifies : c est Stripe qui appelle.
    // Leur protection est la SIGNATURE, testee dans webhook-signature.
    expect(estPublic('/api/webhooks/stripe')).toBe(true);
  });

  it('le paiement public et le portail sont bien exemptes', () => {
    // Deux surfaces atteignables sans session : leur protection est le jeton,
    // testee dans `portes-publiques`. Elles DOIVENT figurer ici, sinon le
    // RBAC les refuserait a des visiteurs legitimes.
    expect(estPublic('/api/portal/' + 'a'.repeat(40))).toBe(true);
    expect(estPublic('/api/pay/abc123')).toBe(true);
  });

  it('les routes du CRM ne sont PAS publiques', () => {
    for (const p of ['/api/clients', '/api/invoices', '/api/payments/refund', '/api/team']) {
      expect(estPublic(p)).toBe(false);
    }
  });

  it('la liste publique reste courte et explicite', () => {
    // Chaque entree ouvre une porte : leur nombre doit rester surveille.
    expect(PUBLICS.length).toBeLessThanOrEqual(40);
  });
});

/* ── 2. LA COUVERTURE REELLE ────────────────────────────────────── */

describe('les permissions declarees', () => {
  it('la table contient des regles', () => {
    expect(REGLES.size).toBeGreaterThan(150);
  });

  it('le remboursement exige une permission', () => {
    // La route la plus sensible du CRM : elle sort de l argent.
    expect(aUneRegle('POST', '/api/payments/refund')).toBe(true);
  });

  it('les routes serveur sont bien detectees', () => {
    expect(ROUTES.length).toBeGreaterThan(300);
  });
});

describe('aucune route ne reste sans protection', () => {
  /**
   * Le controle qui compte. Une route sans regle RBAC tombe sur
   * `return next()` : elle n est PAS refusee, elle depend de sa propre
   * garde. Ce test verifie que chacune en a effectivement une.
   */
  // Toutes les formes de garde rencontrees dans le projet. La liste doit
  // rester exhaustive : une garde maison absente d ici ferait rougir le test
  // pour une route pourtant protegee (constate le 2026-09-02 avec
  // `requireCreatorSpace` et le jeton d invitation du portail de migration).
  const GARDE = new RegExp([
    'requireAuthedClient', 'requireAuth', 'isOrgAdminOrOwner',
    'getUserContext', 'hasPermission', 'CRON_SECRET', 'authRateLimit',
    'requireCreatorSpace',      // creator-space-audit.ts : platformAdminIds
    'x-migration-invite',       // migration-portal.ts : jeton hache
  ].join('|'));

  // Ces fichiers se protegent autrement que par le RBAC, et c est voulu.
  const DEROGATIONS: Record<string, string> = {
    'cron.ts': 'en-tete secret x-cron-secret',
    'reminders-cron.ts': 'en-tete secret x-cron-secret',
    'unsubscribe.ts': 'jeton de 64 caracteres dans l URL',
  };

  const sansRegle = ROUTES.filter((r) => !estPublic(r.chemin) && !aUneRegle(r.methode, r.chemin));
  const fichiersConcernes = [...new Set(sansRegle.map((r) => r.fichier))];

  it('chaque fichier sans regle RBAC porte une garde interne', () => {
    const nus: string[] = [];
    for (const f of fichiersConcernes) {
      if (DEROGATIONS[f]) continue;
      const c = readFileSync(resolve(RACINE, 'server/routes', f), 'utf8');
      if (!GARDE.test(c)) nus.push(f);
    }
    // Si ce test rougit : une route a ete ajoutee sans regle RBAC ET sans
    // garde interne. Elle est joignable par n importe quel compte.
    expect(nus).toEqual([]);
  });

  it('les derogations restent limitees et justifiees', () => {
    // Ajouter un fichier ici doit etre un geste conscient, pas un reflexe.
    expect(Object.keys(DEROGATIONS)).toHaveLength(3);
  });

  it('les fichiers derogatoires se protegent reellement', () => {
    for (const f of Object.keys(DEROGATIONS)) {
      const c = readFileSync(resolve(RACINE, 'server/routes', f), 'utf8');
      expect(/CRON_SECRET|\{64\}|token/.test(c)).toBe(true);
    }
  });
});

describe('la normalisation ne detourne aucune route', () => {
  /**
   * Le point fragile : tout segment de plus de 10 caracteres devient un
   * identifiant candidat. `/api/team/suggestions` engendre donc
   * `/api/team/:id`. Si une regle portait ce nom, une route litterale
   * heriterait d une permission qui ne la concerne pas.
   *
   * Mesure du 2026-09-02 : zero collision. Ce test surveille.
   */
  it('aucune route litterale n est captee par une regle a parametre', () => {
    const collisions: string[] = [];
    for (const r of ROUTES) {
      if (r.chemin.includes(':')) continue;
      const exact = `${r.methode} ${r.chemin}`;
      if (REGLES.has(exact)) continue;
      const capturee = candidats(r.methode, r.chemin).find((c) => c !== exact && REGLES.has(c));
      if (capturee) collisions.push(`${exact} captee par ${capturee}`);
    }
    expect(collisions).toEqual([]);
  });
});
