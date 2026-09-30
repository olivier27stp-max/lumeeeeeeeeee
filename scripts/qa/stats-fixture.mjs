#!/usr/bin/env node
/**
 * Charge le jeu de données de l'audit Statistiques dans la stack LOCALE
 * (bash scripts/qa/stats-stack.sh). Refuse toute autre base.
 *
 *   node scripts/qa/stats-fixture.mjs            → T1, T2, T3 (tests/stats/fixtures/seed.sql)
 *   node scripts/qa/stats-fixture.mjs --volume   → + T4 volumineux (tests/stats/fixtures/volume.sql)
 *
 * Mot de passe de tous les comptes : FixtureStats1234!
 */
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { STATS_LOCAL, signerJwt } from './stats-local.mjs';

const MDP = 'FixtureStats1234!';
const COMPTES = [
  ['a1000000-0000-4000-8000-0000000000a1', 'proprio@fixture.lume.test', 'Olivia Proprio'],
  ['a1000000-0000-4000-8000-0000000000a2', 'admin@fixture.lume.test', 'Adam Admin'],
  ['a1000000-0000-4000-8000-0000000000a3', 'theo@fixture.lume.test', 'Théo Technicien'],
  ['a1000000-0000-4000-8000-0000000000a4', 'tina@fixture.lume.test', 'Tina Technicienne'],
  ['a1000000-0000-4000-8000-0000000000a5', 'remi@fixture.lume.test', 'Rémi Représentant'],
  ['b2000000-0000-4000-8000-0000000000b1', 'proprio@autre.lume.test', 'Autre Proprio'],
  ['c3000000-0000-4000-8000-0000000000c1', 'proprio@vide.lume.test', 'Vide Proprio'],
  ['d4000000-0000-4000-8000-0000000000d1', 'proprio@volume.lume.test', 'Volume Proprio'],
];

const url = new URL(STATS_LOCAL.dbUrl);
if (!['localhost', '127.0.0.1'].includes(url.hostname)) {
  console.error(`REFUS : ${url.hostname} n'est pas la stack locale.`);
  process.exit(2);
}

const jetonService = signerJwt({ role: 'service_role' });
for (const [id, email, nom] of COMPTES) {
  const r = await fetch(`${STATS_LOCAL.authUrl}/admin/users`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${jetonService}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, email, password: MDP, email_confirm: true, user_metadata: { full_name: nom } }),
  });
  if (!r.ok && r.status !== 422) {
    console.error(`compte ${email} : HTTP ${r.status} ${await r.text()}`);
    process.exit(1);
  }
}
console.log(`comptes : ${COMPTES.length} (mot de passe ${MDP})`);

const client = new pg.Client({ connectionString: STATS_LOCAL.dbUrl });
await client.connect();
const deja = await client.query(`select 1 from public.orgs where id = 'a1000000-0000-4000-8000-000000000001'`);
if (deja.rowCount) {
  console.log('jeu T1/T2/T3 déjà chargé');
} else {
  await client.query(fs.readFileSync(path.resolve('tests/stats/fixtures/seed.sql'), 'utf8'));
  console.log('jeu T1/T2/T3 chargé');
}
if (process.argv.includes('--volume')) {
  const vol = await client.query(`select 1 from public.orgs where id = 'd4000000-0000-4000-8000-000000000001'`);
  if (vol.rowCount) console.log('T4 déjà chargé');
  else {
    const t0 = Date.now();
    await client.query(fs.readFileSync(path.resolve('tests/stats/fixtures/volume.sql'), 'utf8'));
    console.log(`T4 volumineux chargé en ${Math.round((Date.now() - t0) / 1000)} s`);
  }
}
const { rows } = await client.query(`
  select o.name,
    (select count(*) from public.jobs j where j.org_id = o.id) jobs,
    (select count(*) from public.invoices i where i.org_id = o.id) factures,
    (select count(*) from public.payments p where p.org_id = o.id) paiements,
    (select count(*) from public.quotes q where q.org_id = o.id) soumissions,
    (select count(*) from public.pipeline_deals d where d.org_id = o.id) deals
  from public.orgs o where o.id::text ~ '^(a1|b2|c3|d4)000000' order by o.name`);
console.table(rows);
await client.end();
