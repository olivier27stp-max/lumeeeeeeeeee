#!/usr/bin/env node
/**
 * Montre où le corps d'une fonction diffère entre la prod et la pile locale.
 *   node --env-file=D:/lume-final/env.reel outils/diff-fonction.mjs "public.settle_ai_budget(uuid,numeric)" [--aligner]
 * --aligner : applique la définition de PROD à la pile LOCALE (jamais l'inverse).
 */
import { execFileSync } from 'node:child_process';

const [signature, option] = process.argv.slice(2);
const REF = process.env.SUPABASE_PROJECT_REF_PROD || 'bbzcuzqfgsdvjsymfwmr';
const jeton = process.env.SUPABASE_ACCESS_TOKEN;
if (!signature || !jeton) { console.error('usage : diff-fonction.mjs "<schema.fonction(args)>" [--aligner]'); process.exit(2); }
if (!/^[a-z_.]+\([a-z_, ]*\)$/i.test(signature)) { console.error('signature refusée'); process.exit(2); }

const sql = `select pg_get_functiondef('${signature}'::regprocedure) as d`;
const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query/read-only`, {
  method: 'POST', headers: { Authorization: `Bearer ${jeton}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }),
});
if (!r.ok) throw new Error(`prod ${r.status}`);
const prod = (await r.json())[0].d;
const psql = (args, input) => execFileSync('docker', ['exec', '-i', '-u', 'postgres', 'lumefinal-db', 'psql', '-U', 'supabase_admin', '-d', 'postgres', ...args], { encoding: 'utf8', input, maxBuffer: 16 * 1024 * 1024 });
const local = psql(['-tA', '-c', sql]).replace(/\n$/, '');

const lp = prod.split('\n'); const ll = local.split('\n');
let n = 0;
for (let i = 0; i < Math.max(lp.length, ll.length); i++) {
  if ((lp[i] ?? '') !== (ll[i] ?? '')) { n++; if (n <= 12) console.log(`l.${i + 1}\n  prod  : ${(lp[i] ?? '∅').slice(0, 200)}\n  local : ${(ll[i] ?? '∅').slice(0, 200)}`); }
}
console.log(`${signature} : ${n} ligne(s) différente(s) (prod ${lp.length} lignes, local ${ll.length}).`);
if (option === '--aligner' && n > 0) {
  psql(['-v', 'ON_ERROR_STOP=1'], prod + ';\n');
  console.log('→ définition de la prod appliquée à la pile locale.');
}
