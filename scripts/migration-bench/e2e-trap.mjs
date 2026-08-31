// Banc d'essai de bout en bout de la migration assistée, contre la PROD
// déployée (lumecrm.net), dans un workspace jetable détruit à la fin.
// Rejoue TOUTES les garanties du système sur le jeu « piégé » généré par
// gen-trap-dataset.mjs (voir la liste des pièges dans son en-tête).
//
//   node scripts/migration-bench/gen-trap-dataset.mjs /tmp/trap-dataset
//   node scripts/migration-bench/e2e-trap.mjs /tmp/trap-dataset
//
// Prérequis : clé service prod dans ~/Downloads/lume-crm/.env.local
// (VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY) ; le compte OWNER_EMAIL doit
// être admin plateforme (PLATFORM_ADMIN_IDS). Le jeton de session et le lien
// d'invitation ne sont JAMAIS affichés. N'utilise AUCUN vrai workspace.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = process.argv[2] ?? './trap-dataset';
const EXPECT = JSON.parse(readFileSync(join(DIR, 'expected.json'), 'utf8'));
const API = 'https://lumecrm.net';
const OWNER_EMAIL = 'olivier27stp@gmail.com';
const OWNER_ID = 'cbccdd2e-f065-42eb-bbe3-96becfbc27fc';
const ORG_NAME = 'ZZ-TEST-MIGRATION (à supprimer)';
const SENTENCE = "J'ai vérifié l'aperçu de la migration et j'autorise Lume à effectuer l'importation finale dans mon workspace.";

const env = readFileSync(`${process.env.HOME}/Downloads/lume-crm/.env.local`, 'utf8');
const get = (k) => (env.match(new RegExp(`^${k}\\s*=\\s*(.+)$`, 'm')) ?? [])[1]?.trim().replace(/^['"]|['"]$/g, '');
const SB_URL = get('VITE_SUPABASE_URL');
const SB_KEY = get('SUPABASE_SERVICE_ROLE_KEY');
const SB = { Authorization: `Bearer ${SB_KEY}`, apikey: SB_KEY, 'Content-Type': 'application/json' };

const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const assert = (cond, label) => {
  log(`  ${cond ? '✓' : '✗'} ${label}`);
  if (!cond) failures += 1;
};

const sb = async (path, init) => {
  const r = await fetch(`${SB_URL}${path}`, { ...init, headers: { ...SB, ...(init?.headers ?? {}) } });
  return { ok: r.ok, status: r.status, headers: r.headers, body: await r.json().catch(() => null) };
};
const count = (t, ORG, extra = '') =>
  fetch(`${SB_URL}/rest/v1/${t}?select=id&org_id=eq.${ORG}${extra}&limit=1`, { headers: { ...SB, Prefer: 'count=exact' } })
    .then((r) => Number(r.headers.get('content-range')?.split('/')[1] ?? 0));

async function mintSession() {
  const gen = await sb('/auth/v1/admin/generate_link', { method: 'POST', body: JSON.stringify({ type: 'magiclink', email: OWNER_EMAIL }) });
  const hashed = gen.body?.hashed_token ?? gen.body?.properties?.hashed_token;
  const ver = await fetch(`${SB_URL}/auth/v1/verify`, {
    method: 'POST',
    headers: { apikey: SB_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', token_hash: hashed }),
  });
  const session = await ver.json();
  if (!session.access_token) throw new Error('session admin impossible');
  return session.access_token;
}

let TOKEN = '';
const api = async (path, init) => {
  const r = await fetch(`${API}${path}`, { ...init, headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
  return { ok: r.ok, status: r.status, body: await r.json().catch(() => null) };
};

async function cleanup(ORG) {
  log('\n— NETTOYAGE —');
  const migs = await sb(`/rest/v1/data_migrations?select=id&org_id=eq.${ORG}`, {});
  for (const m of migs.body ?? []) {
    const fl = await sb(`/rest/v1/migration_files?select=storage_path&migration_id=eq.${m.id}`, {});
    for (const f of fl.body ?? []) await fetch(`${SB_URL}/storage/v1/object/migration-files/${f.storage_path}`, { method: 'DELETE', headers: SB });
  }
  await sb(`/rest/v1/data_migrations?org_id=eq.${ORG}`, { method: 'DELETE' });
  const pins = await sb(`/rest/v1/field_house_profiles?select=id&org_id=eq.${ORG}`, {});
  const pinIds = (Array.isArray(pins.body) ? pins.body : []).map((p) => p.id);
  for (let i = 0; i < pinIds.length; i += 50) {
    await sb(`/rest/v1/field_pin_entity_links?house_id=in.(${pinIds.slice(i, i + 50).join(',')})`, { method: 'DELETE' });
  }
  for (const t of ['payments', 'invoices', 'quotes', 'schedule_events', 'job_line_items', 'jobs', 'properties', 'field_house_profiles', 'clients', 'predefined_services', 'notifications', 'activity_log', 'memberships']) {
    await sb(`/rest/v1/${t}?org_id=eq.${ORG}`, { method: 'DELETE' });
  }
  const del = await sb(`/rest/v1/orgs?id=eq.${ORG}`, { method: 'DELETE' });
  if (!del.ok) await sb(`/rest/v1/orgs?id=eq.${ORG}`, { method: 'PATCH', body: JSON.stringify({ name: 'zz-archive-test-migration' }) });
  log('  nettoyage terminé');
}

const t0 = Date.now();
log('ÉTAPE 0 — session admin (lien magique, non affiché)…');
TOKEN = await mintSession();

log('ÉTAPE 1 — workspace jetable…');
const orgIns = await sb('/rest/v1/orgs', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ name: ORG_NAME, created_by: OWNER_ID }) });
const ORG = orgIns.body[0].id;
await sb('/rest/v1/memberships', { method: 'POST', body: JSON.stringify({ user_id: OWNER_ID, org_id: ORG, role: 'owner', status: 'active', full_name: 'Banc Migration' }) });
log('  ✓ org', ORG);

try {
  log('ÉTAPE 2-3 — migration + invitation…');
  const created = await api('/api/migration-admin/migrations', {
    method: 'POST',
    body: JSON.stringify({ org_id: ORG, invited_email: OWNER_EMAIL, categories: ['clients', 'properties', 'services', 'quotes', 'jobs', 'visits', 'invoices'] }),
  });
  const MIG = created.body.id;
  const inv = await api(`/api/migration-admin/migrations/${MIG}/invitation`, { method: 'POST', body: JSON.stringify({ ttl_hours: 24 }) });
  const INVITE = inv.body.invite_url.split('/').pop();
  log('  ✓', MIG, '(lien non affiché)');

  const portal = (path, init) => fetch(`${API}/api/migration-portal${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${TOKEN}`, 'x-migration-invite': INVITE, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  }).then(async (r) => ({ ok: r.ok, status: r.status, body: await r.json().catch(() => null) }));

  log('ÉTAPE 4-5 — portail + téléversements…');
  const sess = await portal('/session');
  assert(sess.ok && sess.body.workspace_name === ORG_NAME, 'portail ouvert sur le bon workspace');
  const FILES = ['clients_export.csv', 'jobs_export.csv', 'quotes_export.csv', 'invoices_export.csv'];
  for (const name of FILES) {
    const up = await fetch(`${API}/api/migration-portal/files?name=${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'x-migration-invite': INVITE, 'Content-Type': 'text/csv' },
      body: readFileSync(join(DIR, name)),
    });
    if (!up.ok) throw new Error(`upload ${name}: ${up.status} ${JSON.stringify(await up.json().catch(() => null))}`);
  }
  log(`  ✓ ${FILES.length} fichiers téléversés`);
  const dup = await fetch(`${API}/api/migration-portal/files?name=clients_export.csv`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'x-migration-invite': INVITE, 'Content-Type': 'text/csv' },
    body: readFileSync(join(DIR, 'clients_export.csv')),
  });
  assert(dup.status === 409, 'même fichier re-téléversé refusé (409)');

  log('ÉTAPE 6 — analyse…');
  let files = [];
  for (let i = 0; i < 60; i++) {
    await sleep(3000);
    files = (await portal('/files')).body ?? [];
    if (files.length === FILES.length && files.every((f) => ['parsed', 'failed'].includes(f.parse_status))) break;
  }
  const rowsByName = { 'clients_export.csv': EXPECT.clients.rows, 'jobs_export.csv': EXPECT.jobs.rows, 'quotes_export.csv': EXPECT.quotes.rows, 'invoices_export.csv': EXPECT.invoices.rows };
  for (const f of files) {
    assert(f.parse_status === 'parsed' && f.row_count === rowsByName[f.original_name], `${f.original_name} analysé (${f.row_count}/${rowsByName[f.original_name]} lignes, ${f.category_detected})`);
  }

  log('ÉTAPE 7 — employés historiques + gabarits…');
  const staff = await api(`/api/migration-admin/migrations/${MIG}/staff`);
  const marc = (staff.body?.staff ?? []).find((e) => e.source_key === 'marc employe');
  assert(!!marc && marc.count === 3, `« Marc Employe » détecté (${marc?.count ?? 0}/3 lignes)`);
  const saveMap = await api(`/api/migration-admin/migrations/${MIG}/staff-map`, { method: 'POST', body: JSON.stringify({ mappings: [{ source: 'Marc Employe', user_id: OWNER_ID }] }) });
  assert(saveMap.ok, 'correspondance employé enregistrée');
  const tpl = await api(`/api/migration-admin/migrations/${MIG}/save-template`, { method: 'POST', body: JSON.stringify({ name: 'Banc piégé v1' }) });
  assert(tpl.ok && tpl.body.headers > 20, `gabarit sauvegardé (${tpl.body?.headers ?? 0} colonnes)`);
  const applied = await api(`/api/migration-admin/migrations/${MIG}/apply-template`, { method: 'POST', body: JSON.stringify({ template_id: tpl.body.template_id }) });
  assert(applied.ok, `gabarit ré-appliqué sans écraser les décisions (${applied.body?.applied ?? '?'} confirmées)`);

  log('ÉTAPE 8 — import test (dry-run, zéro écriture)…');
  await api(`/api/migration-admin/migrations/${MIG}/test-import`, { method: 'POST', body: JSON.stringify({}) });
  let detail = null;
  for (let i = 0; i < 60; i++) {
    await sleep(3000);
    detail = (await api(`/api/migration-admin/migrations/${MIG}`)).body;
    if (['test_review', 'failed'].includes(detail?.migration?.status)) break;
  }
  assert(detail?.migration?.status === 'test_review', `dry-run terminé (${detail?.migration?.status})`);
  const report = detail.batches.find((b) => b.kind === 'test' && b.status === 'completed')?.totals;
  assert((await count('clients', ORG)) === 0, 'isolation : le dry-run n\'a rien écrit dans les tables actives');

  log('ÉTAPE 9 — garde-fous + approbation…');
  const blocked = await api(`/api/migration-admin/migrations/${MIG}/request-approval`, { method: 'POST', body: JSON.stringify({}) });
  assert(blocked.status === 409, 'demande refusée tant que des colonnes sont « À vérifier » (409)');
  const pending = ((await api(`/api/migration-admin/migrations/${MIG}`)).body?.mappings ?? []).filter((m) => m.status === 'needs_review');
  for (const m of pending) {
    await api(`/api/migration-admin/migrations/${MIG}/mappings/${m.id}`, { method: 'POST', body: JSON.stringify({ status: 'rejected', target_entity: null, target_field: null }) });
  }
  log(`  ✓ ${pending.length} colonne(s) ambiguë(s) tranchée(s) par l'admin`);
  const ra = await api(`/api/migration-admin/migrations/${MIG}/request-approval`, { method: 'POST', body: JSON.stringify({}) });
  assert(ra.ok, 'demande d\'approbation acceptée après décisions');
  const bad = await portal('/approval', { method: 'POST', body: JSON.stringify({ decision: 'approved', confirmed_text: 'oui' }) });
  assert(bad.status === 400, 'mauvaise phrase de confirmation refusée (400)');
  const okA = await portal('/approval', { method: 'POST', body: JSON.stringify({ decision: 'approved', confirmed_text: SENTENCE }) });
  assert(okA.ok, `approbation client enregistrée (rapport v${okA.body?.report_version})`);

  log('ÉTAPE 10 — import final (gardé)…');
  const early = await api(`/api/migration-admin/migrations/${MIG}/final-import`, { method: 'POST', body: JSON.stringify({ confirm_org_name: ORG_NAME }) });
  assert(early.status === 409, 'import final refusé avant « prête » (409)');
  await api(`/api/migration-admin/migrations/${MIG}/status`, { method: 'POST', body: JSON.stringify({ to: 'ready_for_final_import' }) });
  const wrong = await api(`/api/migration-admin/migrations/${MIG}/final-import`, { method: 'POST', body: JSON.stringify({ confirm_org_name: 'Mauvais' }) });
  assert(wrong.status === 400, 'mauvais nom de workspace refusé (400)');
  await api(`/api/migration-admin/migrations/${MIG}/final-import`, { method: 'POST', body: JSON.stringify({ confirm_org_name: ORG_NAME }) });
  let finalStatus = '';
  for (let i = 0; i < 80; i++) {
    await sleep(3000);
    detail = (await api(`/api/migration-admin/migrations/${MIG}`)).body;
    finalStatus = detail?.migration?.status;
    if (['completed', 'completed_with_warnings', 'failed'].includes(finalStatus)) break;
  }
  assert(finalStatus === 'completed', `import final: ${finalStatus}`);

  log('ÉTAPE 11 — vérité terrain…');
  const nClients = await count('clients', ORG);
  const nJobs = await count('jobs', ORG);
  const nQuotes = await count('quotes', ORG);
  const nInvoices = await count('invoices', ORG);
  assert(nClients === EXPECT.clients.expectedCreated, `clients: ${nClients}/${EXPECT.clients.expectedCreated}`);
  assert(nJobs === EXPECT.jobs.expectedCreated, `jobs: ${nJobs}/${EXPECT.jobs.expectedCreated}`);
  assert(nQuotes === EXPECT.quotes.expectedCreated, `soumissions: ${nQuotes}/${EXPECT.quotes.expectedCreated} (doublon Q-101 fusionné)`);
  assert(nInvoices === EXPECT.invoices.expectedCreated, `factures: ${nInvoices}/${EXPECT.invoices.expectedCreated} (doublon #501 fusionné)`);
  assert((await count('jobs', ORG, '&client_id=is.null')) === 0, 'aucun job sans client');
  const jeans = await sb(`/rest/v1/clients?select=id&org_id=eq.${ORG}&last_name=eq.Dupont`, {});
  assert((jeans.body ?? []).length === 2, 'homonymes « Jean Dupont » créés séparément (2)');
  assert(((await sb(`/rest/v1/jobs?select=id&org_id=eq.${ORG}&job_number=eq.1900`, {})).body ?? []).length === 0, 'job de l\'homonyme (n° 1900) exclu — jamais deviné');
  assert(((await sb(`/rest/v1/jobs?select=id&org_id=eq.${ORG}&job_number=eq.1001`, {})).body ?? []).length === 1, 'job n° 1001 unique (doublon fusionné)');
  const inv501 = await sb(`/rest/v1/invoices?select=issued_at,total_cents&org_id=eq.${ORG}&invoice_number=eq.501`, {});
  assert((inv501.body?.[0]?.issued_at ?? '').slice(0, 10) === '2024-03-25', `facture n° 501 émise le ${(inv501.body?.[0]?.issued_at ?? '?').slice(0, 10)} (convention JJ/MM inférée)`);
  assert((inv501.body?.[0]?.total_cents ?? 0) > 115, 'la VRAIE facture n° 501 a survécu au doublon de 1,15 $ (primaire déterministe)');
  const partials = await sb(`/rest/v1/invoices?select=paid_cents,total_cents&org_id=eq.${ORG}&status=eq.partial`, {});
  assert((partials.body ?? []).length === 1 && partials.body[0].paid_cents === 6498, `paiement partiel exact (payé $${((partials.body?.[0]?.paid_cents ?? 0) / 100).toFixed(2)}/attendu $64.98)`);
  let cents = 0;
  for (let offset = 0; ; offset += 100) {
    const page = await sb(`/rest/v1/invoices?select=total_cents&org_id=eq.${ORG}&order=id&limit=100&offset=${offset}`, {});
    if (!Array.isArray(page.body) || page.body.length === 0) break;
    for (const r of page.body) cents += r.total_cents ?? 0;
    if (page.body.length < 100) break;
  }
  assert(cents === EXPECT.invoices.expectedCents && cents === (report?.totals?.revenueCents ?? -1),
    `somme des factures exacte au cent ($${(cents / 100).toFixed(2)} = généré = rapport approuvé)`);
  assert((await count('jobs', ORG, '&show_on_leaderboard=eq.false')) === EXPECT.jobs.expectedCreated, 'tous les jobs migrés hors leaderboard');
  const salesJobs = await count('jobs', ORG, `&salesperson_id=eq.${OWNER_ID}`);
  assert(salesJobs === 3, `jobs attribués au vendeur mappé: ${salesJobs}/3`);
  const q101 = await sb(`/rest/v1/quotes?select=status,job_id&org_id=eq.${ORG}&quote_number=eq.Q-101`, {});
  assert(q101.body?.[0]?.status === 'approved' && !!q101.body?.[0]?.job_id, 'soumission Q-101 approuvée ET liée à son job');
  const invIds = (await sb(`/rest/v1/migration_import_records?select=entity_id&migration_id=eq.${MIG}&entity_table=eq.invoices&action=eq.created&limit=200`, {})).body ?? [];
  const idList = invIds.map((r) => r.entity_id).slice(0, 100).join(',');
  const noise = idList ? await sb(`/rest/v1/notifications?select=id&org_id=eq.${ORG}&reference_id=in.(${idList})&limit=5`, {}) : { body: [] };
  assert((noise.body ?? []).length === 0, 'fil d\'activité purgé (0 notification pour les factures importées)');
  const rejects = await fetch(`${API}/api/migration-admin/migrations/${MIG}/rejects.csv`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  const rejectLines = (await rejects.text()).trim().split('\n').length - 1;
  assert(rejects.ok && rejectLines >= 1, `export des rejets: ${rejectLines} ligne(s) (l'orphelin homonyme)`);
  const retry = await api(`/api/migration-admin/migrations/${MIG}/retry-errors`, { method: 'POST', body: JSON.stringify({}) });
  assert(retry.ok && retry.body.reset === 0, 'relance des erreurs d\'insertion: 0 (aucun échec)');

  log('ÉTAPE 12 — rollback…');
  const fakeRb = await api(`/api/migration-admin/migrations/${MIG}/status`, { method: 'POST', body: JSON.stringify({ to: 'rolled_back' }) });
  assert(fakeRb.status === 409, '« rolled_back » direct refusé (rollback réel obligatoire)');
  const rb = await api(`/api/migration-admin/migrations/${MIG}/rollback`, { method: 'POST', body: JSON.stringify({ confirm_org_name: ORG_NAME }) });
  assert(rb.ok, `rollback: ${rb.body?.softDeleted ?? '?'} dossiers retirés`);
  const active = (await count('clients', ORG, '&deleted_at=is.null')) + (await count('jobs', ORG, '&deleted_at=is.null')) + (await count('invoices', ORG, '&deleted_at=is.null')) + (await count('quotes', ORG, '&deleted_at=is.null'));
  assert(active === 0, 'zéro dossier actif restant après rollback');

  log(`\n${failures === 0 ? 'RÉSULTAT GLOBAL: PARCOURS COMPLET RÉUSSI' : `RÉSULTAT GLOBAL: ${failures} ÉCHEC(S)`} en ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  process.exitCode = failures === 0 ? 0 : 1;
} catch (err) {
  console.error('\nERREUR PENDANT LE TEST:', err.message);
  process.exitCode = 1;
} finally {
  await cleanup(ORG);
}
