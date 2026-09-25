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

  it('la route générique de statut ne permet ni import ni rollback direct', () => {
    const body = routeBody(adminSrc, "'/migration-admin/migrations/:id/status'");
    expect(body).toContain("to === 'importing'");
    expect(body).toContain("to === 'rolled_back'");
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

  it('téléversement : extensions limitées, sniff du contenu, dédup sha256, limite de taille (réception partagée)', () => {
    // La réception vit dans pipeline.ts (receptionnerFichierMigration) : portail ET console y passent.
    const pipelineSrc = read('server/lib/migration/pipeline.ts');
    const start = pipelineSrc.indexOf('export async function receptionnerFichierMigration');
    expect(start).toBeGreaterThan(0);
    const body = pipelineSrc.slice(start, pipelineSrc.indexOf('return { ok: true, file:', start));
    expect(body).toContain("['csv', 'pdf', ...EXCEL_EXTENSIONS]");
    expect(body).toContain('unsupported_type');
    expect(body).toContain('looksBinary');
    expect(body).toContain('sniffIsPdf');
    expect(body).toContain('sniffIsExcel'); // Excel vérifié à sa signature, jamais à l'extension
    expect(body).toContain('sha256');
    expect(body).toContain('MAX_FILE_SIZE_BYTES');
    expect(body).toContain('MAX_FILES_PER_MIGRATION');
    expect(body).toContain('UPLOAD_ALLOWED_STATUSES');
    expect(routeBody(portalSrc, "'/migration-portal/files', rawParser")).toContain('receptionnerFichierMigration');
    expect(routeBody(adminSrc, "'/migration-admin/migrations/:id/files', rawFileParser")).toContain('receptionnerFichierMigration');
    // la console exige toujours l'admin plateforme avant de recevoir quoi que ce soit
    expect(routeBody(adminSrc, "'/migration-admin/migrations/:id/files', rawFileParser")).toContain('requirePlatformAdmin');
  });

  it('formulaire d\'importation : résumé, catégorie de fichier et catégories cochées passent par le jeton + session, et respectent les statuts', () => {
    for (const needle of ["'/migration-portal/files/:fileId/summary'", "'/migration-portal/files/:fileId/category'", "'/migration-portal/categories'"]) {
      const body = routeBody(portalSrc, needle);
      expect(body).toContain('requirePortalAccess');
    }
    expect(routeBody(portalSrc, "'/migration-portal/files/:fileId/category'")).toContain('UPLOAD_ALLOWED_STATUSES');
    expect(routeBody(portalSrc, "'/migration-portal/categories'")).toContain('UPLOAD_ALLOWED_STATUSES');
    // la catégorie déclarée est validée côté serveur avant tout usage
    expect(routeBody(portalSrc, "'/migration-portal/files', rawParser")).toContain('estCategorieValide');
  });

  it('reprise après rollback : le registre du lot annulé ne compte plus et est effacé, le staging repasse à ready', () => {
    const src = read('server/lib/migration/importer.ts');
    const final = src.slice(src.indexOf('export async function runFinalImport'), src.indexOf('export async function rollbackFinalBatch'));
    expect(final).toContain(".neq('status', 'rolled_back')");
    expect(final).toContain(".in('batch_id', idsLotsEnPlace)");
    const rollback = src.slice(src.indexOf('export async function rollbackFinalBatch'));
    expect(rollback).toContain("from('migration_import_records').delete().eq('batch_id', batchId)");
    expect(rollback).toContain(".in('status', ['imported', 'merged'])");
    // identifiants déterministes : la réimportation d'une fiche annulée (suppression douce) la ressuscite
    expect(final).toContain("ignoreDuplicates: false");
    expect(final).not.toContain("onConflict: 'id', ignoreDuplicates: true");
    expect(src).toContain('{ ...row, deleted_at: null }');
    // plusieurs factures Jobber par job : la 2e reste rattachée au client, jamais refusée par l'index unique
    expect(src.split('detacherFactureSurJobDejaFacture(built.row, jobsFactures)').length - 1).toBe(2); // dry-run + final
    expect(src).toContain('jobsDejaFactures(admin, migration.org_id)');
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
    // La console vit dans le Creator Space (onglet Migrations, gate platformAdminIds) ;
    // l'ancienne URL redirige.
    expect(appSrc).toContain("pathname: '/creator-space/migrations'");
    const creatorSrc = read('src/pages/creator-space/CreatorSpace.tsx');
    expect(creatorSrc).toContain('<Route path="migrations" element={<AdminMigrations embedded />} />');
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

describe('post-audit — garde-fous et neutralité des données migrées', () => {
  it('la demande d\'approbation refuse fichiers tronqués et colonnes non tranchées', () => {
    // Les gardes vivent désormais dans server/lib/migration/execution.ts (partagées avec le bot) ;
    // la route doit y déléguer, et le module doit porter les deux gardes.
    const body = routeBody(adminSrc, "'/migration-admin/migrations/:id/request-approval'");
    expect(body).toContain('demanderApprobation(');
    const execSrc = read('server/lib/migration/execution.ts');
    const garde = execSrc.slice(execSrc.indexOf('export async function demanderApprobation'));
    expect(garde).toContain("'truncated'");
    expect(garde).toContain("'needs_review'");
  });

  it('l\'import final purge le bruit d\'activité après validation', () => {
    const body = routeBody(adminSrc, "'/migration-admin/migrations/:id/final-import'");
    expect(body).toContain('purgeImportActivityNoise');
    expect(body).toContain('import.noise_purged');
  });

  it('le rollback purge aussi le bruit re-déclenché par les soft-deletes', () => {
    const body = routeBody(adminSrc, "'/migration-admin/migrations/:id/rollback'");
    expect(body).toContain('purgeImportActivityNoise');
  });

  it('le moteur du leaderboard applique la case show_on_leaderboard sur ses 3 requêtes jobs', () => {
    const engine = read('server/lib/field-sales/leaderboard-engine.ts');
    const matches = engine.match(/or\('show_on_leaderboard\.is\.null,show_on_leaderboard\.eq\.true'\)/g) ?? [];
    expect(matches.length).toBe(3);
  });

  it('la validation post-import vérifie la somme monétaire contre le rapport approuvé', () => {
    const importer = read('server/lib/migration/importer.ts');
    expect(importer).toContain("'money:invoices_total_cents'");
  });
});

describe('post-audit — téléversements volumineux non bloqués par maxBodySize', () => {
  it('le garde partagé exempte le portail de migration (limite propre 25 Mo à la route)', () => {
    const guards = read('server/lib/validation-guards.ts');
    expect(guards).toContain("req.path === '/migration-portal/files'");
  });
});

describe('P1 déclenchés — nouveaux endpoints gardés et sûrs', () => {
  it('export des rejets : CSV en pièce jointe, cellules anti-injection, journalisé', () => {
    const body = routeBody(adminSrc, "'/migration-admin/migrations/:id/rejects.csv'");
    expect(body).toContain('requirePlatformAdmin');
    expect(body).toContain('text/csv');
    expect(body).toContain('rejects.export');
    expect(body).toContain('buildRejectsCsv'); // neutralisation des préfixes de formule
  });
  it('retry-errors ne relance QUE les échecs d\'insertion (import_failed:%)', () => {
    const body = routeBody(adminSrc, "'/migration-admin/migrations/:id/retry-errors'");
    expect(body).toContain("'import_failed:%'");
  });
  it('gabarits : jamais d\'écrasement d\'une décision humaine, résolution PAR CATÉGORIE', () => {
    const body = routeBody(adminSrc, "'/migration-admin/migrations/:id/apply-template'");
    expect(body).toContain("m.status !== 'suggested' && m.status !== 'needs_review'");
    expect(body).toContain('normalizeHeader');
    // « Job # » de jobs ≠ « Job # » de quotes : la catégorie du fichier fait foi
    expect(body).toContain('catByFile');
    expect(body).toContain('entityForCategory');
    const save = routeBody(adminSrc, "'/migration-admin/migrations/:id/save-template'");
    expect(save).toContain('catByFile');
  });

  it('détection des employés : repli sur les données brutes avant la normalisation', () => {
    const body = routeBody(adminSrc, "'/migration-admin/migrations/:id/staff'");
    expect(body).toContain('staffHeadersByFile');
    expect(body).toContain('payload');
  });
  it('correspondance employés : upsert par (migration, source_key), 503 clair sans la table', () => {
    const body = routeBody(adminSrc, "'/migration-admin/migrations/:id/staff-map'");
    expect(body).toContain("onConflict: 'migration_id,source_key'");
    expect(body).toContain('not_provisioned');
  });
});

describe('déterminisme du dossier primaire (bug loterie round 8b)', () => {
  it('loadStaging trie par ordre source (fichier, ligne), jamais par uuid', () => {
    const importer = read('server/lib/migration/importer.ts');
    expect(importer).toContain(".order('file_id', { ascending: true })");
    expect(importer).toContain(".order('row_number', { ascending: true })");
    expect(importer).not.toMatch(/entity_type[\s\S]{0,200}\.order\('id', \{ ascending: true \}\)/);
  });
});

describe('portail — le bouton de connexion pointe vers la vraie page', () => {
  it('« Se connecter » mène à /auth (la route /login n\'existe pas)', () => {
    const portalPage = read('src/pages/MigrationPortal.tsx');
    expect(portalPage).toContain('href="/auth"');
    expect(portalPage).not.toContain('/login?next=');
  });
});

describe('audit sections 1-5 — garde-fous ajoutés', () => {
  const importerSrc = read('server/lib/migration/importer.ts');
  const pipelineSrc = read('server/lib/migration/pipeline.ts');
  const rejectsSrc = read('server/lib/migration/rejects.ts');

  it("S4 — l'import final refuse un taux d'échec > 25 % et un fichier jamais retesté", () => {
    const body = routeBody(adminSrc, "'/migration-admin/migrations/:id/final-import'");
    expect(body).toContain('MAX_IMPORT_ERROR_RATIO');
    expect(body).toContain("in('status', ['error', 'orphan'])");
    expect(body).toContain("gt('created_at', lastTest.finished_at)");
    expect(body).toContain('refaites un import test');
  });

  it('S4 — le portail expose le rapport d\'erreurs et l\'aperçu masqué, tous deux gardés et journalisés', () => {
    const rejects = routeBody(portalSrc, "'/migration-portal/rejects.csv'");
    expect(rejects).toContain('requirePortalAccess');
    expect(rejects).toContain("action: 'rejects.export'");
    expect(rejects).toContain('buildRejectsCsv');
    const preview = routeBody(portalSrc, "'/migration-portal/preview-rows'");
    expect(preview).toContain('requirePortalAccess');
    expect(preview).toContain('maskNormalizedRecord'); // PII jamais en clair
  });

  it('S13 — le CSV des rejets donne la ligne Excel (décalage d\'en-tête corrigé) et reste anti-injection', () => {
    expect(rejectsSrc).toContain('ligne_excel');
    expect(rejectsSrc).toContain('r.row_number + 1');
    expect(rejectsSrc).toMatch(/\^\[=\+\\-@/); // préfixes de formule neutralisés
  });

  it('S2 — la réponse humaine aux issues date_format est réellement consommée', () => {
    expect(pipelineSrc).toContain("eq('type', 'date_format')");
    expect(pipelineSrc).toContain('client_answer, resolution');
    expect(pipelineSrc).toContain('answeredKeys');
  });

  it('S2 — les visites sont converties en UTC avant insertion', () => {
    expect(importerSrc).toContain('localToUtcIso(startAt)');
    expect(importerSrc).toContain('localToUtcIso(endAt)');
    expect(importerSrc).toContain("timezone: 'America/Toronto'");
    expect(importerSrc).not.toContain("timezone: 'America/Montreal'");
  });

  it('S5 — fusion enrichissante : jamais d\'écrasement, valeurs d\'origine consignées, rollback restaure', () => {
    expect(importerSrc).toContain('ENRICHABLE_CLIENT_FIELDS');
    expect(importerSrc).toContain('curEmpty'); // seuls les champs vides sont comblés
    expect(importerSrc).toContain('previous_values');
    expect(importerSrc).toMatch(/action', 'merged'\)[\s\S]{0,200}previous_values/); // le rollback relit les fusions
  });

  it('S3 — statuts sources inconnus signalés au dry-run au lieu d\'une coercition silencieuse', () => {
    expect(importerSrc).toContain('statusRecognized');
    expect(importerSrc).toContain("type: 'unknown_status'");
  });

  it('S1 — en-têtes dupliqués et fichier sans en-tête produisent des issues visibles', () => {
    expect(pipelineSrc).toContain("type: 'duplicate_headers'");
    expect(pipelineSrc).toContain("'missing_header_row'");
  });
});

describe('audit sections 6-14 — garde-fous ajoutés', () => {
  const importerSrc2 = read('server/lib/migration/importer.ts');
  const mappingSrc = read('server/lib/migration/mapping.ts');
  const dsrSrc = read('server/routes/dsr.ts');
  const benchSrc = read('scripts/migration-bench/e2e-trap.mjs');
  const analyzerSrc = read('server/lib/migration/analyzer.ts');

  it('S7 — watchdog zombie branché au boot (10 min, advisory lock) et heartbeat par lot', () => {
    expect(indexSrc).toContain("withAdvisoryLock('migration-recovery'");
    expect(indexSrc).toContain('recoverZombieMigrations');
    // Heartbeat enrichi (étape + types de données) : même colonne totals.progress, même filtre running.
    expect(importerSrc2).toContain("etape: `Écriture — ${libelle}`, processed: i, total: toInsert.length");
    expect(importerSrc2).toContain(".eq('status', 'running')");
  });

  it('S10 — l\'effacement DSR purge aussi les traces de migration (staging + previous_values)', () => {
    expect(dsrSrc.split('purgeMigrationTracesForEntity').length - 1).toBeGreaterThanOrEqual(3); // import + 2 routes
    const erasureSrc = read('server/lib/migration/erasure.ts');
    expect(erasureSrc).toContain("from('migration_staging_records')");
    expect(erasureSrc).toContain('previous_values: null');
  });

  it('S10 — la phrase d\'approbation fait déclarer le droit de transférer, et le banc est synchronisé', () => {
    const m = portalSrc.match(/APPROVAL_SENTENCE_FR =\s*"([^"]+)"/);
    expect(m, 'phrase FR introuvable').toBeTruthy();
    expect(m![1]).toContain('le droit de transférer ces renseignements');
    expect(benchSrc).toContain(m![1]); // le banc E2E utilise EXACTEMENT la même phrase
  });

  it('S11 — le rollback purge les pins D2D auto-créés (maisons du client importé seulement)', () => {
    expect(importerSrc2).toContain('purgeAutoPinsForClients');
    expect(importerSrc2).toContain("meta.source === 'crm_client'");
    expect(importerSrc2).toContain('pinsPurged');
    expect(benchSrc).toContain('pins D2D purgés au rollback');
  });

  it('S6 — created_at historique (createdAtPatch) sur client, job, quote, invoice et payment', () => {
    expect(importerSrc2.split('...createdAtPatch(').length - 1).toBe(5);
  });

  it('S6 — le champ fantôme « tags » est retiré du catalogue (aucune promesse non tenue)', () => {
    expect(mappingSrc).not.toContain("field: 'tags'");
  });

  it('S9 — les champs texte des rangées actives passent par safeStr (anti-formule)', () => {
    expect(importerSrc2).toContain('function safeStr');
    expect(importerSrc2).toContain('notes: joinNotes(safeStr(n.notes)');
  });

  it('S12 — le parse CSV est en flux (Readable), plus de Papa.parse(string) bloquant', () => {
    expect(analyzerSrc).toContain('Readable.from(slices)');
    expect(analyzerSrc).toContain('setImmediate');
    expect(analyzerSrc).not.toMatch(/Papa\.parse\(text,/);
  });
});
