// Audit de source des routes du Creator Space (même pattern que
// tests/migration/route-guards.test.ts) : on verrouille les garanties de
// sécurité dans le texte même des handlers pour empêcher toute dérive.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '..', '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

const routerSrc = read('server/routes/creator-space.ts');
const auditSrc = read('server/routes/creator-space-audit.ts');
const featuresSrc = read('server/routes/creator-space-features.ts');
const indexSrc = read('server/index.ts');
const appSrc = read('src/App.tsx');

describe('Creator Space — chaque handler est gardé', () => {
  it('tous les handlers (sauf /check) appellent requireCreatorSpace', () => {
    const handlers = routerSrc.split(/router\.(?:get|post|patch|delete)\(/).slice(1);
    let unguarded = 0;
    for (const h of handlers) {
      if (h.includes('/creator-space/check')) continue;
      if (!h.includes('requireCreatorSpace(req, res)')) unguarded += 1;
    }
    expect(handlers.length).toBeGreaterThan(0);
    expect(unguarded).toBe(0);
  });

  it('la garde vérifie auth.user.id contre platformAdminIds et 503 sans config', () => {
    const start = routerSrc.indexOf('async function requireCreatorSpace');
    expect(start).toBeGreaterThan(-1);
    const guard = routerSrc.slice(start, routerSrc.indexOf('function cleanQ', start));
    expect(guard).toContain('platformAdminIds');
    expect(guard).toContain('platformAdminIds.has(auth.user.id)');
    expect(guard).toContain('503');
    expect(guard).toContain('403');
  });

  it("l'espace est en lecture seule : aucun handler POST/PATCH/DELETE, aucune écriture", () => {
    expect(routerSrc).not.toMatch(/router\.(post|patch|delete|put)\(/);
    expect(routerSrc).not.toMatch(/\.(insert|update|upsert|delete)\(/);
  });

  it('aucune donnée sensible dans les payloads (stripe, IP, user-agent, tokens)', () => {
    expect(routerSrc).not.toMatch(/stripe_customer_id|stripe_subscription_id|stripe_payment_intent_id|stripe_checkout_session_id|stripe_invoice_id|stripe_seat_item_id|stripe_office_item_id/);
    expect(routerSrc).not.toMatch(/ip_address|user_agent|old_values|new_values/);
    expect(routerSrc).not.toMatch(/billing_profiles|token_hash|failed_login_attempts/);
  });

  it('les identifiants sont validés (UUID) et la recherche est bornée, jamais interpolée dans .or()', () => {
    expect(routerSrc).toContain('UUID_RE.test(');
    expect(routerSrc).toContain('.slice(0, 120)');
    expect(routerSrc).not.toContain('.or(');
  });

  it("aucun nom de personne d'un autre tenant dans les journaux : actor_id seulement (Loi 25)", () => {
    // Les flux Logs / Overview / Engagement compagnie ne retournent jamais
    // actor_name — la révélation passe par creator-space-audit.ts.
    expect(routerSrc).not.toContain('actor_name');
    expect(routerSrc).toContain('actor_id');
  });
});

describe('Creator Space — journal d’accès et révélation (creator-space-audit)', () => {
  it('reveal-actor est gardé par requireCreatorSpace et exige une raison journalisée', () => {
    expect(auditSrc).toContain('requireCreatorSpace(req, res)');
    expect(auditSrc).toContain('reason.length < 5');
    expect(auditSrc).toContain('creator_space_reveal');
    // Journalisation AVANT la réponse : un échec d'écriture refuse la révélation.
    expect(auditSrc).toContain('Journalisation impossible — révélation refusée.');
  });

  it('seule table écrite : security_events (un seul insert, aucun update/upsert/delete)', () => {
    expect((auditSrc.match(/\.insert\(/g) ?? []).length).toBe(1);
    expect(auditSrc).toContain(".from('security_events').insert(");
    expect(auditSrc).not.toMatch(/\.(update|upsert|delete)\(/);
  });

  it("chaque consultation est journalisée (creator_space_view) avec l'identité posée par la garde", () => {
    expect(auditSrc).toContain('creator_space_view');
    expect(auditSrc).toContain('res.locals.creatorSpaceUserId');
    expect(routerSrc).toContain('res.locals.creatorSpaceUserId = auth.user.id');
  });
});

describe('Creator Space — fonctionnalités par workspace (creator-space-features)', () => {
  it('chaque handler est gardé par requireCreatorSpace et valide orgId + clé', () => {
    const handlers = featuresSrc.split(/router\.(?:get|post|put|patch|delete)\(/).slice(1);
    expect(handlers.length).toBe(2);
    for (const h of handlers) {
      expect(h).toContain('requireCreatorSpace(req, res)');
      expect(h).toContain('UUID_RE.test(orgId)');
    }
    expect(featuresSrc).toContain('isPlatformFeatureKey(key)');
  });

  it('toute modification exige une raison journalisée AVANT l’écriture, sinon refus', () => {
    expect(featuresSrc).toContain('reason.length < 5');
    expect(featuresSrc).toContain('creator_space_feature_override');
    expect(featuresSrc).toContain('Journalisation impossible — modification refusée.');
    const log = featuresSrc.indexOf(".from('security_events').insert(");
    const write = featuresSrc.indexOf(".from('org_features')\n        .delete()");
    expect(log).toBeGreaterThan(-1);
    expect(write).toBeGreaterThan(log);
  });

  it('seules tables écrites : org_features et security_events ; les lignes posées sont marquées platform_override', () => {
    const writes = featuresSrc.match(/\.from\('([a-z_]+)'\)\s*\.(insert|update|upsert|delete)\(/g) ?? [];
    const tables = new Set(writes.map((w) => w.match(/from\('([a-z_]+)'\)/)![1]));
    expect(tables).toEqual(new Set(['org_features', 'security_events']));
    expect(featuresSrc).toContain('platform_override: true');
    // « Hériter » ne supprime que les lignes de la plateforme, jamais une
    // activation faite par le tenant.
    expect(featuresSrc).toContain(".eq('metadata->>platform_override', 'true')");
  });

  it('le tenant ne peut pas renverser un override plateforme (PUT /api/features)', () => {
    const tenantSrc = read('server/routes/feature-flags.ts');
    expect(tenantSrc).toContain('isPlatformOverride(existing?.metadata)');
    expect(tenantSrc).toContain('platform_locked: true');
  });
});

describe('montage serveur et surface SPA', () => {
  it('le routeur est monté avec rate limiting dédié, le journal d’accès et le routeur audit', () => {
    expect(indexSrc).toContain("app.use('/api/creator-space', creatorSpaceLimiter)");
    expect(indexSrc).toContain("app.use('/api/creator-space', creatorSpaceViewLogger())");
    expect(indexSrc).toContain("app.use('/api', creatorSpaceRouter)");
    expect(indexSrc).toContain("app.use('/api', creatorSpaceAuditRouter)");
    expect(indexSrc).toContain("app.use('/api', creatorSpaceFeaturesRouter)");
  });

  it('la route SPA existe, hors nav statique ; le lien sidebar est gaté par la sonde serveur', () => {
    expect(appSrc).toContain('path="/creator-space/*"');
    // Fenêtre exacte des données de navigation statiques (navSections →
    // moreNavItems) : aucune entrée Creator Space ne doit s'y trouver.
    const navStart = appSrc.indexOf('navSections');
    const navEnd = appSrc.indexOf('moreNavItems', navStart);
    expect(navStart).toBeGreaterThan(-1);
    expect(navEnd).toBeGreaterThan(navStart);
    expect(appSrc.slice(navStart, navEnd)).not.toContain('/creator-space');
    // Le lien n'apparaît que si /api/creator-space/check répond vrai —
    // jamais une décision prise côté navigateur.
    expect(appSrc).toContain('creatorAccess.data === true && (');
    expect(appSrc).toContain('checkCreatorAccess');
  });

  it('la page se gate via la sonde /check (jamais de décision côté navigateur seul)', () => {
    const pageSrc = read('src/pages/creator-space/CreatorSpace.tsx');
    expect(pageSrc).toContain('checkCreatorAccess');
    expect(pageSrc).toContain('<Navigate to="/" replace />');
  });
});
