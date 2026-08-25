// Audit de source des routes de migration (pattern maison — voir
// tests/emails/email-send-contract.test.ts pour la justification) : on
// verrouille les garanties de sécurité dans le texte même des handlers.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '..', '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

const adminSrc = read('server/routes/migration-admin.ts');
const portalSrc = read('server/routes/migration-portal.ts');
const indexSrc = read('server/index.ts');
const tokenRoutesSrc = read('src/routes/TokenRoutes.tsx');
const mobileGateSrc = read('src/lib/mobileGate.ts');

function routeBody(source: string, startNeedle: string, endNeedle = "router."): string {
  const start = source.indexOf(startNeedle);
  expect(start, `introuvable: ${startNeedle}`).toBeGreaterThan(-1);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  return source.slice(start, end === -1 ? undefined : end);
}

describe('console interne — chaque handler est gardé', () => {
  it('tous les handlers (sauf /check) appellent requirePlatformAdmin', () => {
    const handlers = adminSrc.split(/router\.(?:get|post|patch|delete)\(/).slice(1);
    let unguarded = 0;
    for (const h of handlers) {
      const path = h.slice(0, h.indexOf("'", 1) + 1);
      if (h.includes('/migration-admin/check')) continue;
      if (!h.includes('requirePlatformAdmin(req, res)')) unguarded += 1;
      void path;
    }
    expect(unguarded).toBe(0);
  });

  it('la garde vérifie auth.user.id contre platformAdminIds et 503 sans config', () => {
    const guard = routeBody(adminSrc, 'async function requirePlatformAdmin');
    expect(guard).toContain('platformAdminIds');
    expect(guard).toContain('platformAdminIds.has(auth.user.id)');
    expect(guard).toContain('503');
    expect(guard).toContain('403');
  });

  it("l'import final exige statut prêt + approbation client + nom du workspace", () => {
    const body = routeBody(adminSrc, "'/migration-admin/migrations/:id/final-import'");
    expect(body).toContain("'ready_for_final_import'");
    expect(body).toContain("decision !== 'approved'");
    expect(body).toContain('confirm_org_name');
    expect(body).toContain('blocking');
  });

  it('la route générique de statut ne permet jamais de démarrer un import', () => {
    const body = routeBody(adminSrc, "'/migration-admin/migrations/:id/status'");
    expect(body).toContain("to === 'importing'");
    expect(body).toContain('assertTransition');
  });

  it('le jeton brut n\'est renvoyé qu\'une fois et jamais journalisé', () => {
    expect(adminSrc).not.toMatch(/console\.(log|error)\([^)]*\btoken\b/);
    const gen = routeBody(adminSrc, "'/migration-admin/migrations/:id/invitation'");
    expect(gen).toContain('generateInviteToken');
    expect(gen).toContain('superseded_at');
  });
});

describe('portail — chaîne de validation complète', () => {
  it('vérifie le format du jeton avant tout accès DB, avec délai aléatoire', () => {
    const guard = routeBody(portalSrc, 'async function requirePortalAccess');
    const formatIdx = guard.indexOf('isValidTokenFormat');
    const dbIdx = guard.indexOf(".from('migration_invitations')");
    expect(formatIdx).toBeGreaterThan(-1);
    expect(dbIdx).toBeGreaterThan(formatIdx);
    expect(guard).toContain('randomSleep');
    expect(guard).toContain('hashToken');
  });

  it('exige la session Lume + membership owner/admin du BON workspace + invité prévu', () => {
    const guard = routeBody(portalSrc, 'async function requirePortalAccess');
    expect(guard).toContain('buildSupabaseWithAuth');
    expect(guard).toContain("migration.org_id");
    expect(guard).toContain("'owner'");
    expect(guard).toContain('invited_user_id');
    expect(guard).toContain('invited_email');
    expect(guard).toContain('failed_attempts');
  });

  it('le jeton voyage en header x-migration-invite et n\'est jamais loggé', () => {
    expect(portalSrc).toContain("req.header('x-migration-invite')");
    expect(portalSrc).not.toMatch(/console\.(log|error)\([^)]*\btoken\b/);
  });

  it('téléversement : extensions limitées, sniff du contenu, dédup sha256, limite de taille', () => {
    const body = routeBody(portalSrc, "'/migration-portal/files', rawParser");
    expect(body).toContain("['csv', 'pdf']");
    expect(body).toContain('unsupported_type');
    expect(body).toContain('looksBinary');
    expect(body).toContain('sniffIsPdf');
    expect(body).toContain('sha256');
    expect(body).toContain('MAX_FILE_SIZE_BYTES');
    expect(body).toContain('MAX_FILES_PER_MIGRATION');
  });

  it("l'approbation exige la phrase exacte et journalise IP + user-agent", () => {
    const body = routeBody(portalSrc, "'/migration-portal/approval'");
    expect(body).toContain('APPROVAL_SENTENCE_FR');
    expect(body).toContain('APPROVAL_SENTENCE_EN');
    expect(body).toContain('confirmation_required');
    expect(body).toContain('extractIP');
    expect(body).toContain('user-agent');
    expect(body).toContain('report_version');
  });

  it('le portail ne peut JAMAIS déclencher l\'import final', () => {
    expect(portalSrc).not.toContain('runFinalImport');
    expect(portalSrc).not.toContain('final-import');
  });
});

describe('montage serveur et surface publique', () => {
  it('les deux routeurs sont montés avec rate limiting', () => {
    expect(indexSrc).toContain("app.use('/api/migration-admin', migrationAdminLimiter)");
    expect(indexSrc).toContain("app.use('/api', migrationAdminRouter)");
    expect(indexSrc).toContain("app.use('/api/migration-portal', migrationPortalLimiter)");
    expect(indexSrc).toContain("app.use('/api', migrationPortalRouter)");
    expect(indexSrc).toMatch(/migration-portal\/session.*preset: 'auth'/s);
  });

  it('le nettoyage quotidien est branché (advisory lock + capture)', () => {
    expect(indexSrc).toContain("import('./lib/migration/cleanup')");
    expect(indexSrc).toContain("withAdvisoryLock('migration-cleanup'");
    expect(indexSrc).toContain("captureCronFailure('migration-cleanup-import'");
  });

  it('la route du portail est déclarée côté SPA et whitelist mobile', () => {
    expect(tokenRoutesSrc).toContain("'/migration/invite/:token'");
    expect(tokenRoutesSrc).toContain("startsWith('/migration/invite/')");
    expect(mobileGateSrc).toContain("'/migration/invite/'");
  });

  it('aucun bouton d\'import permanent dans le CRM : la route admin est hors navigation', () => {
    const appSrc = read('src/App.tsx');
    expect(appSrc).toContain("path=\"/admin/migrations\"");
    // pas d'entrée de navigation ('id: …migrations…') dans les navSections
    const navSlice = appSrc.slice(appSrc.indexOf('navSections'), appSrc.indexOf('navSections') + 6000);
    expect(navSlice).not.toContain('/admin/migrations');
  });
});

describe('SQL — RLS deny-all et bucket privé', () => {
  const sql = read('supabase/migrations/20260820000000_migration_assistee.sql');
  it('active et force RLS sur toutes les tables de migration, sans policy authenticated', () => {
    expect(sql).toContain('enable row level security');
    expect(sql).toContain('force row level security');
    expect(sql).toContain('to service_role using (true) with check (true)');
    expect(sql).not.toMatch(/create policy[^;]*to authenticated/s);
  });
  it('le jeton n\'est stocké que haché et le bucket est privé', () => {
    expect(sql).toContain('token_hash text not null unique');
    expect(sql).not.toMatch(/\btoken text\b/);
    expect(sql).toMatch(/insert into storage\.buckets[^;]*false/s);
  });
});
