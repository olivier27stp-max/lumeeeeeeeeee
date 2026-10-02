#!/usr/bin/env node
/**
 * Copie des tables de RÉFÉRENCE (sans donnée de client) de la prod vers la pile locale.
 * Lecture seule côté prod (API de gestion, /database/query/read-only).
 *
 *   node --env-file=D:/lume-final/env.reel outils/copier-reference.mjs plans role_permission_defaults
 */
import { readFileSync } from 'node:fs';
import { LOCAL, signerJwt } from './local.mjs';

const REF = process.env.SUPABASE_PROJECT_REF_PROD || 'bbzcuzqfgsdvjsymfwmr';
const jeton = process.env.SUPABASE_ACCESS_TOKEN;
if (!jeton) { console.error('SUPABASE_ACCESS_TOKEN requis'); process.exit(2); }
const service = signerJwt({ role: 'service_role' }, 3600);

async function lireProd(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query/read-only`, {
    method: 'POST', headers: { Authorization: `Bearer ${jeton}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }),
  });
  if (!r.ok) throw new Error(`prod ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

for (const table of process.argv.slice(2)) {
  if (!/^[a-z_]+$/.test(table)) throw new Error(`nom de table refusé : ${table}`);
  const lignes = await lireProd(`select * from public.${table}`);
  if (!lignes.length) { console.log(`${table} : vide en prod`); continue; }
  const r = await fetch(`${LOCAL.restUrl}/${table}`, {
    method: 'POST',
    headers: { apikey: service, Authorization: `Bearer ${service}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(lignes),
  });
  console.log(`${table} : ${lignes.length} ligne(s) → local ${r.status}${r.ok ? '' : ' ' + (await r.text()).slice(0, 300)}`);
}
